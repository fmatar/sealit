import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertNoSymlinkAncestors,
  cleanGitEnv,
  computeAlignmentHashes,
  computeContentTreeSha,
  fileExists,
  getCurrentGitBranch,
  gitExec,
  gitOutput,
  hasDirtyNonGovernanceFiles,
  isDocsOnlyDiff,
  normalizeTicketId,
  parseEnvFile,
  parseTicketId,
  readBlobs,
  readChangeSet,
  readFileSafe,
  resolveEffectiveDiffBase,
  resolveGitCommonRepoRoot,
  resolveRange,
  sameShaPrefix,
  verifyCleanThreeWayMergeTrees,
  withFileLock,
  writeFileAtomic
} from './git.mjs';
import { loadEffectivePolicy } from './config.mjs';
import { spawnSync } from 'node:child_process';

export const AUDIT_LEDGER_FILE = 'docs/AUDIT_CHAIN.jsonl';
export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
export const RECEIPT_KEY_FILE = '.agent/.receipt-key';

const CACHE_EXCLUDED_PATHS = new Set([
  'docs/AUDIT_CHAIN.jsonl', '.agent/.sealit-session.json', '.agent/.sealit-session.lock', '.agent/.sealit-config.lock',
  '.agent/.sdlc-session.json', '.agent/.sdlc-session.lock', '.agent/.receipt-key', '.agent/.audit-chain.lock', '.agent/.sdlc-config.lock'
]);

export function calculateRecordHash({ index, timestamp, event, metadata, previousHash }) {
  const payload = JSON.stringify({ index, timestamp, event, metadata, previousHash });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function keyFileCommitState(checkRoot, relFile = RECEIPT_KEY_FILE, atRef = 'HEAD') {
  const ls = spawnSync('git', ['-C', checkRoot, 'ls-files', '--error-unmatch', '--', relFile], {
    cwd: checkRoot,
    env: cleanGitEnv(),
    stdio: 'pipe'
  });
  if (ls.error || (ls.status !== 0 && ls.status !== 1)) return 'unknown';
  if (ls.status === 0) return 'committed';

  const head = spawnSync('git', ['-C', checkRoot, 'cat-file', '-e', '--end-of-options', `${atRef}:${relFile}`], {
    cwd: checkRoot,
    env: cleanGitEnv(),
    stdio: 'pipe'
  });
  if (head.error || (head.status !== 0 && head.status !== 128)) return 'unknown';
  return head.status === 0 ? 'committed' : 'clean';
}

function makeUnusableKeyError(state, relFile = RECEIPT_KEY_FILE) {
  const err = new Error(
    state === 'committed'
      ? `${relFile} is committed to git; run 'git rm --cached ${relFile}' and rotate the key.`
      : `Cannot confirm ${relFile} is untracked (git unavailable or repository unreadable); refusing to trust key file.`
  );
  err.code = 'RECEIPT_KEY_UNUSABLE';
  return err;
}

function readKeyFromObj(obj = {}) {
  for (const k of ['SEALIT_RECEIPT_KEY', 'SDLC_RECEIPT_KEY']) {
    if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined) {
      const val = String(obj[k]).trim();
      if (val) return val;
    }
  }
  return null;
}

export function loadReceiptKey(repoRoot = '.', { create = false } = {}) {
  const procVal = readKeyFromObj(process.env);
  if (procVal) return Buffer.from(procVal, 'utf8');

  const absRoot = path.resolve(repoRoot);
  const commonRoot = resolveGitCommonRepoRoot(absRoot);
  const dotEnvVal = readKeyFromObj(parseEnvFile(absRoot));
  if (dotEnvVal) {
    const envState = keyFileCommitState(absRoot, '.env');
    if (envState !== 'clean') throw makeUnusableKeyError(envState, '.env');
    return Buffer.from(dotEnvVal, 'utf8');
  }
  const localKeyPath = path.resolve(absRoot, RECEIPT_KEY_FILE);
  const sharedKeyPath = path.resolve(commonRoot, RECEIPT_KEY_FILE);
  const keyPath = fileExists(localKeyPath) ? localKeyPath : sharedKeyPath;
  const checkRoot = keyPath === sharedKeyPath ? commonRoot : absRoot;

  if (fileExists(keyPath)) {
    const commitState = keyFileCommitState(checkRoot);
    if (commitState !== 'clean') {
      throw makeUnusableKeyError(commitState);
    }
    const raw = fs.readFileSync(keyPath, 'utf8').trim();
    if (raw) return Buffer.from(raw, 'utf8');
  }

  if (!create) return null;

  const targetCreatePath = sharedKeyPath;
  assertNoSymlinkAncestors(commonRoot, path.dirname(targetCreatePath));
  const key = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(targetCreatePath), { recursive: true });
  try {
    fs.writeFileSync(targetCreatePath, key + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    if (process.platform !== 'win32') {
      fs.chmodSync(targetCreatePath, 0o600);
    }
    return Buffer.from(key, 'utf8');
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      const stateAfterRace = keyFileCommitState(commonRoot);
      if (stateAfterRace !== 'clean') throw makeUnusableKeyError(stateAfterRace);
      const existing = fs.readFileSync(targetCreatePath, 'utf8').trim();
      if (existing) return Buffer.from(existing, 'utf8');
    }
    throw err;
  }
}

export function inspectReceiptKeyStatus(repoRoot = '.') {
  if (readKeyFromObj(process.env)) {
    return { source: 'env', usable: true, committed: false, mode: null, error: null };
  }
  const absRoot = path.resolve(repoRoot);
  if (readKeyFromObj(parseEnvFile(absRoot))) {
    const envState = keyFileCommitState(absRoot, '.env');
    if (envState !== 'clean') {
      return { source: 'dotenv', usable: false, committed: envState === 'committed', mode: null, error: makeUnusableKeyError(envState, '.env').message };
    }
    return { source: 'env', usable: true, committed: false, mode: null, error: null };
  }
  const commonRoot = resolveGitCommonRepoRoot(absRoot);
  const localKeyPath = path.resolve(absRoot, RECEIPT_KEY_FILE);
  const sharedKeyPath = path.resolve(commonRoot, RECEIPT_KEY_FILE);
  const keyPath = fileExists(localKeyPath) ? localKeyPath : sharedKeyPath;
  const checkRoot = keyPath === sharedKeyPath ? commonRoot : absRoot;

  if (!fileExists(keyPath)) {
    return { source: 'none', usable: false, committed: false, mode: null, error: null };
  }

  let mode = null;
  try {
    mode = fs.statSync(keyPath).mode & 0o777;
  } catch {}
  const state = keyFileCommitState(checkRoot);
  if (state !== 'clean') {
    return {
      source: 'file',
      usable: false,
      committed: state === 'committed',
      mode,
      error: makeUnusableKeyError(state).message
    };
  }
  const hasContent = Boolean((readFileSafe(keyPath) || '').trim());
  return {
    source: 'file',
    usable: hasContent,
    committed: false,
    mode,
    error: hasContent ? null : `${RECEIPT_KEY_FILE} is empty.`
  };
}

function canonicalJSON(value) {
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : canonicalJSON(v))).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

export function signReceiptPayload(payload, key) {
  return crypto.createHmac('sha256', key).update(canonicalJSON(payload)).digest('hex');
}

export function verifyReceiptSignature(receipt, key) {
  if (!receipt || !receipt.signature || !key) return false;
  const { signature, ...payload } = receipt;
  if (signature.alg !== 'HMAC-SHA256' || typeof signature.value !== 'string' || !/^[0-9a-f]{64}$/i.test(signature.value)) {
    return false;
  }
  const expected = signReceiptPayload(payload, key);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature.value, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

export function verifyAuditChainContent(rawContent = '') {
  const content = String(rawContent || '').trim();
  if (!content) {
    return {
      valid: true,
      recordsCount: 0,
      gateReceiptsCount: 0,
      chainHead: GENESIS_HASH,
      merkleRoot: GENESIS_HASH,
      records: [],
      message: 'Audit chain is empty.'
    };
  }

  const lines = content.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
  let expectedPrevHash = GENESIS_HASH;
  let gateReceiptsCount = 0;
  const records = [];

  for (let i = 0; i < lines.length; i++) {
    let parsed;
    try {
      parsed = JSON.parse(lines[i]);
    } catch (err) {
      return {
        valid: false,
        errorIndex: i,
        error: `Malformed JSON at line ${i + 1}: ${err.message}`,
        recordsCount: lines.length,
        gateReceiptsCount
      };
    }

    if (parsed.index !== i) {
      return {
        valid: false,
        errorIndex: i,
        error: `Index mismatch at record ${i}: expected ${i}, found ${parsed.index}`,
        recordsCount: lines.length,
        gateReceiptsCount
      };
    }

    if (parsed.previousHash !== expectedPrevHash) {
      return {
        valid: false,
        errorIndex: i,
        error: `Cryptographic chain broken at record ${i}: previousHash mismatch.`,
        recordsCount: lines.length,
        gateReceiptsCount
      };
    }

    const recalculated = calculateRecordHash({
      index: parsed.index,
      timestamp: parsed.timestamp,
      event: parsed.event,
      metadata: parsed.metadata,
      previousHash: parsed.previousHash
    });

    if (recalculated !== parsed.currentHash) {
      return {
        valid: false,
        errorIndex: i,
        error: `SHA-256 tampering detected at record ${i}.`,
        recordsCount: lines.length,
        gateReceiptsCount
      };
    }

    if (parsed.event === 'STAGE_7_GATE_RECEIPT_SIGNED' || parsed.event === 'GATE_RECEIPT_ISSUED') {
      gateReceiptsCount++;
    }
    expectedPrevHash = parsed.currentHash;
    records.push(parsed);
  }

  return {
    valid: true,
    recordsCount: records.length,
    gateReceiptsCount,
    chainHead: expectedPrevHash,
    merkleRoot: expectedPrevHash,
    records,
    message: `Audit chain verified (${records.length} records, ${gateReceiptsCount} signed gate receipts).`
  };
}

export function verifyAuditChain(repoRoot = '.') {
  const auditPath = path.resolve(repoRoot, AUDIT_LEDGER_FILE);
  if (!fileExists(auditPath)) {
    return verifyAuditChainContent('');
  }
  return verifyAuditChainContent(fs.readFileSync(auditPath, 'utf8'));
}

export function appendAuditRecord({ event, metadata = {}, repoRoot = '.' } = {}) {
  const lockPath = path.join(resolveGitCommonRepoRoot(repoRoot), '.agent', '.audit-chain.lock');
  return withFileLock(lockPath, () => {
    const auditPath = path.resolve(repoRoot, AUDIT_LEDGER_FILE);
    fs.mkdirSync(path.dirname(auditPath), { recursive: true });

    let previousHash = GENESIS_HASH;
    let index = 0;
    let separator = '';

    if (fileExists(auditPath)) {
      const rawContent = fs.readFileSync(auditPath, 'utf8');
      const content = rawContent.trim();
      if (rawContent.length > 0 && !rawContent.endsWith('\n')) separator = '\n';
      if (content) {
        const integrity = verifyAuditChain(repoRoot);
        if (!integrity.valid) {
          throw new Error(`Refusing to append to corrupted audit ledger (${AUDIT_LEDGER_FILE}): ${integrity.error}`);
        }
        const last = integrity.records[integrity.records.length - 1];
        if (last) {
          index = last.index + 1;
          previousHash = last.currentHash;
        }
      }
    }

    const timestamp = new Date().toISOString();
    const currentHash = calculateRecordHash({ index, timestamp, event, metadata, previousHash });
    const record = { index, timestamp, event, metadata, previousHash, currentHash };
    fs.appendFileSync(auditPath, `${separator}${JSON.stringify(record)}\n`, 'utf8');
    return { success: true, record, auditPath };
  });
}

function resolveSessionPaths(repoRoot = '.') {
  const commonRoot = resolveGitCommonRepoRoot(repoRoot);
  return {
    sessionPath: path.join(commonRoot, '.agent', '.sealit-session.json'),
    lockPath: path.join(commonRoot, '.agent', '.sealit-session.lock')
  };
}

export function readSessionStore(repoRoot = '.') {
  const { sessionPath } = resolveSessionPaths(repoRoot);
  if (!fileExists(sessionPath)) {
    return { activeSessionId: null, sessions: {} };
  }
  const raw = fs.readFileSync(sessionPath, 'utf8').trim();
  if (!raw) return { activeSessionId: null, sessions: {} };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const corruptErr = new Error(`Corrupted session store at '${sessionPath}': ${err.message}`);
    corruptErr.code = 'SESSION_CORRUPT';
    throw corruptErr;
  }
  if (parsed && typeof parsed === 'object' && parsed.sessions && typeof parsed.sessions === 'object') {
    return {
      activeSessionId: parsed.activeSessionId !== undefined && parsed.activeSessionId !== null ? String(parsed.activeSessionId) : null,
      sessions: parsed.sessions
    };
  }
  if (parsed && typeof parsed === 'object' && parsed.issueId !== undefined) {
    const id = String(normalizeTicketId(parsed.issueId) || parsed.issueId);
    return {
      activeSessionId: id,
      sessions: { [id]: parsed }
    };
  }
  return { activeSessionId: null, sessions: {} };
}

export function readActiveSession(repoRoot = '.', targetBranch = null) {
  const store = readSessionStore(repoRoot);
  const branch = targetBranch || getCurrentGitBranch(repoRoot);
  const entries = Object.values(store.sessions || {});
  if (branch) {
    const byBranch = entries.filter((s) => s && s.active !== false && s.branch === branch);
    if (byBranch.length > 0) {
      const preferred = byBranch.find((s) => String(normalizeTicketId(s.issueId) || s.issueId) === store.activeSessionId);
      return preferred || byBranch[byBranch.length - 1];
    }
  }
  if (store.activeSessionId && store.sessions[store.activeSessionId] && store.sessions[store.activeSessionId].active !== false) {
    if (!branch) return store.sessions[store.activeSessionId];
  }
  return null;
}

export function writeActiveSession(repoRoot, updater) {
  const { sessionPath, lockPath } = resolveSessionPaths(repoRoot);
  return withFileLock(lockPath, () => {
    const current = readSessionStore(repoRoot);
    const updated = updater(structuredClone(current)) || current;
    writeFileAtomic(sessionPath, JSON.stringify(updated, null, 2) + '\n', 0o600);
    return updated;
  });
}

export function computeTreeHash({ repoRoot = '.', modulePath = '.', checkType = '', baseBranch = null } = {}) {
  const absRoot = path.resolve(repoRoot);
  const hash = crypto.createHash('sha256');
  hash.update(`module:${modulePath}\nnode:${process.version}\ncheckType:${checkType}\nbase:${baseBranch || ''}\n`);

  const range = resolveRange({ baseBranch, head: 'HEAD', repoRoot: absRoot });
  if (!range.headSha || hasDirtyNonGovernanceFiles(absRoot, { allowAuditChain: true })) {
    return { hash: hash.digest('hex'), cacheable: false };
  }
  const treeSha = computeContentTreeSha(range.headSha, absRoot);
  if (!treeSha) return { hash: hash.digest('hex'), cacheable: false };
  hash.update(`head:${range.headSha}\nmb:${range.baseSha}\ntree:${treeSha}\n`);
  return { hash: hash.digest('hex'), cacheable: true };
}

function resolveGateCachePath(repoRoot = '.') {
  return path.join(resolveGitCommonRepoRoot(repoRoot), '.agent', '.cache', 'gate-cache.json');
}

export function readGateCache(repoRoot = '.', moduleName = 'root', treeHash = '') {
  if (!treeHash) return null;
  const cachePath = resolveGateCachePath(repoRoot);
  if (!fileExists(cachePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return parsed?.entries?.[`${moduleName}:${treeHash}`] ?? null;
  } catch {
    return null;
  }
}

export function writeGateCache(repoRoot = '.', moduleName = 'root', treeHash = '', value = {}) {
  if (!treeHash) return;
  const cachePath = resolveGateCachePath(repoRoot);
  let existing = { entries: {} };
  if (fileExists(cachePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.entries && typeof parsed.entries === 'object') {
        existing = parsed;
      }
    } catch {
      existing = { entries: {} };
    }
  }
  existing.entries[`${moduleName}:${treeHash}`] = {
    ...value,
    cachedAt: new Date().toISOString()
  };
  writeFileAtomic(cachePath, JSON.stringify(existing, null, 2) + '\n');
}

function isAuditOnlyCommitRange(fromSha, toSha, repoRoot) {
  if (!fromSha || !toSha) return false;
  if (fromSha === toSha) return true;
  const anc = gitExec(['merge-base', '--is-ancestor', '--end-of-options', fromSha, toSha], repoRoot);
  if (anc.error || anc.status !== 0) return false;
  const merges = gitOutput(['rev-list', '--merges', '--end-of-options', `${fromSha}..${toSha}`], repoRoot);
  if (merges === null || merges.trim() !== '') return false;
  try {
    const cs = readChangeSet({ baseSha: fromSha, headSha: toSha, source: 'commit', repoRoot });
    return cs.paths.every((f) => f === AUDIT_LEDGER_FILE);
  } catch {
    return false;
  }
}

function isProtectedBranchHistory(commitSha, repoRoot) {
  for (const ref of ['refs/heads/main', 'refs/heads/master', 'refs/heads/develop', 'refs/remotes/origin/main', 'refs/remotes/origin/master', 'refs/remotes/origin/develop']) {
    const res = gitExec(['merge-base', '--is-ancestor', '--end-of-options', commitSha, ref], repoRoot);
    if (!res.error && res.status === 0) return true;
  }
  return false;
}

function verifyTwoParentCleanMerge(receiptHeadSha, targetSha, repoRoot, depth = 0) {
  const p1 = (gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', `${targetSha}^1`], repoRoot) || '').trim();
  const p2 = (gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', `${targetSha}^2`], repoRoot) || '').trim();
  const p3 = (gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', `${targetSha}^3`], repoRoot) || '').trim();
  if (!p1 || !p2 || p3) return false;
  if (!isProtectedBranchHistory(p1, repoRoot)) return false;

  const p2Matches =
    receiptHeadSha === p2 ||
    isAuditOnlyCommitRange(receiptHeadSha, p2, repoRoot) ||
    (depth < 1 && verifyTwoParentCleanMerge(receiptHeadSha, p2, repoRoot, depth + 1));
  if (!p2Matches) return false;

  const mb = (gitOutput(['merge-base', '--end-of-options', p1, p2], repoRoot) || '').trim();
  return verifyCleanThreeWayMergeTrees({ mbSha: mb, p1Ref: p1, p2Ref: p2, targetRef: targetSha, repoRoot });
}

export function issueGateReceipt({ repoRoot = '.', docsOnly = false, reviewerOverride = null } = {}) {
  if (hasDirtyNonGovernanceFiles(repoRoot, { allowAuditChain: true })) {
    return {
      success: false,
      reason: 'Refusing to issue gate receipt: working tree has dirty uncommitted non-governance files.'
    };
  }

  const headSha = (gitOutput(['rev-parse', '--verify', 'HEAD'], repoRoot) || '').trim();
  if (!headSha) {
    return { success: false, reason: 'Refusing to issue gate receipt: cannot resolve HEAD commit.' };
  }

  const branch = getCurrentGitBranch(repoRoot) || 'feature/unknown';
  const session = readActiveSession(repoRoot, branch);
  if (!session) {
    return {
      success: false,
      reason: `Refusing to issue gate receipt: no active session found for branch '${branch}'. Run 'sealit begin' and 'sealit gate' first.`
    };
  }

  const range = resolveRange({ baseBranch: session.baseBranch || null, head: headSha, branchHint: branch, repoRoot });
  const cs = readChangeSet({ ...range, source: 'commit', repoRoot });
  const isDocsDiff = isDocsOnlyDiff(cs);
  if (docsOnly && !isDocsDiff) {
    return {
      success: false,
      reason: 'Refusing --docs-only receipt: git diff contains non-documentation, spec, manifest, or contract files.'
    };
  }

  const lastGate = session.lastGate;
  if (!lastGate || lastGate.passed !== true) {
    return {
      success: false,
      reason: 'Refusing to issue gate receipt: no passing sealit gate measurement recorded for this session.'
    };
  }

  if (lastGate.headSha !== headSha && !isAuditOnlyCommitRange(lastGate.headSha, headSha, repoRoot)) {
    return {
      success: false,
      reason: `Refusing to issue gate receipt: lastGate measurement (${lastGate.headSha}) does not match current HEAD (${headSha}). Re-run 'sealit gate'.`
    };
  }

  const liveHashes = computeAlignmentHashes({ sha: headSha, repoRoot });
  if (!lastGate.specHash || lastGate.specHash !== liveHashes.specHash || lastGate.adrHashes !== liveHashes.adrHashes) {
    return {
      success: false,
      reason: 'Refusing to issue gate receipt: specHash or adrHashes changed since lastGate measurement. Re-run sealit gate.'
    };
  }

  const effectiveMode = lastGate.mode || (isDocsDiff ? 'docs-only' : 'code');
  const { config } = loadEffectivePolicy({ repoRoot, baseSha: range.baseSha, headSha, changedPaths: cs.paths });
  const mods = config?.modules || [];

  if (effectiveMode === 'code') {
    const measuredByMod = new Map((lastGate.modules || []).map((m) => [m.module, m]));
    for (const mod of mods) {
      const mRec = measuredByMod.get(mod.name);
      const covFloor = typeof mod.thresholds?.diffCoverage === 'number' ? mod.thresholds.diffCoverage : null;
      const actualCov = mRec ? mRec.diffCoveragePct : lastGate.diffCoveragePct;
      if (covFloor !== null && (typeof actualCov !== 'number' || actualCov < covFloor)) {
        return {
          success: false,
          reason: `Refusing to issue gate receipt: module '${mod.name}' diff coverage (${actualCov ?? 'unmeasured'}%) is below threshold ${covFloor}%.`
        };
      }
      const mutFloor = typeof mod.thresholds?.mutationScore === 'number' ? mod.thresholds.mutationScore : null;
      const actualMut = mRec ? mRec.mutationPct : lastGate.mutationPct;
      const mutStat = mRec ? mRec.mutationStatus : lastGate.mutationStatus;
      const emptyMutSkip = mutStat === 'diff-no-mutated-sources' || mutStat === 'diff-zero-mutants';
      if (mutFloor !== null && !emptyMutSkip && (typeof actualMut !== 'number' || actualMut < mutFloor)) {
        return {
          success: false,
          reason: `Refusing to issue gate receipt: module '${mod.name}' mutation score (${actualMut ?? 'unmeasured'}%) is below threshold ${mutFloor}%.`
        };
      }
    }
  }

  let reviewer = reviewerOverride || null;
  if (effectiveMode === 'code') {
    const pr = session.peerReview;
    if (!pr || pr.verdict !== 'approve') {
      return {
        success: false,
        reason: "Refusing to issue gate receipt: code changes require an approved peer review ('sealit review record --verdict approve')."
      };
    }
    if (pr.headSha !== headSha && !isAuditOnlyCommitRange(pr.headSha, headSha, repoRoot)) {
      return {
        success: false,
        reason: `Refusing to issue gate receipt: peer review was recorded for ${pr.headSha}, which does not match HEAD ${headSha}.`
      };
    }
    reviewer = reviewer || pr.reviewer || '@sealit-gate';
  } else {
    reviewer = reviewer || session.peerReview?.reviewer || '@docs-only-gate';
  }

  let key;
  try {
    key = loadReceiptKey(repoRoot, { create: true });
  } catch (err) {
    return { success: false, reason: err.message };
  }
  if (!key) {
    return { success: false, reason: 'No usable receipt signing key available.' };
  }

  const parsedIssueId = parseTicketId(session.issueId) ?? session.issueId;
  const issueRef = typeof parsedIssueId === 'number' ? `#${parsedIssueId}` : String(parsedIssueId);
  const treeSha = computeContentTreeSha(headSha, repoRoot);

  const payload = {
    receiptId: `GATE-RECEIPT-${issueRef}-${headSha.slice(0, 8)}`,
    version: '0.1.0',
    issueId: parsedIssueId,
    branch,
    headSha,
    treeSha,
    mode: effectiveMode,
    specHash: lastGate.specHash || null,
    adrHashes: lastGate.adrHashes || null,
    diffCoveragePct: lastGate.diffCoveragePct ?? null,
    mutationPct: lastGate.mutationPct ?? null,
    mutationStatus: lastGate.mutationStatus || (effectiveMode === 'docs-only' ? 'docs-only' : 'not-configured'),
    peerReviewApproved: true,
    reviewer,
    driftPassed: true,
    driftCheckPassed: true,
    archPassed: lastGate.archPassed !== false,
    issuedAt: new Date().toISOString()
  };

  const receipt = {
    ...payload,
    signature: {
      alg: 'HMAC-SHA256',
      keyId: crypto.createHash('sha256').update(key).digest('hex').slice(0, 16),
      value: signReceiptPayload(payload, key)
    }
  };

  const auditRes = appendAuditRecord({
    event: 'STAGE_7_GATE_RECEIPT_SIGNED',
    metadata: receipt,
    repoRoot
  });

  return {
    success: true,
    receipt: { ...receipt, chainHash: auditRes.record.currentHash },
    auditRecord: auditRes.record
  };
}

export function verifyGateReceipt({ headSha = null, branch = null, repoRoot = '.' } = {}) {
  const chain = verifyAuditChain(repoRoot);
  if (!chain.valid) {
    return { valid: false, reason: `Audit hash chain corrupted: ${chain.error}` };
  }

  const absRoot = path.resolve(repoRoot);
  const isHexSha = (s) => /^[0-9a-f]{7,64}$/i.test(String(s || '').trim());
  let targetSha = headSha ? String(headSha).trim() : null;

  if (targetSha && /^[0-9a-f]{1,6}$/i.test(targetSha)) {
    return {
      valid: false,
      targetSha,
      branch,
      reason: 'Short commit SHA prefix must be at least 7 hex characters.'
    };
  }

  if (targetSha && isHexSha(targetSha) && targetSha.length < 40) {
    const expanded = (gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', `${targetSha}^{commit}`], absRoot) || '').trim();
    if (!expanded) return { valid: false, targetSha, branch, reason: `Cannot resolve commit '${targetSha}'.` };
    targetSha = expanded;
  } else if (targetSha && !isHexSha(targetSha)) {
    const resolved = (gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', `${targetSha}^{commit}`], absRoot) || '').trim();
    if (!resolved) return { valid: false, targetSha, branch, reason: `Cannot resolve target ref '${targetSha}'.` };
    targetSha = resolved;
  } else if (!targetSha && branch && branch !== 'HEAD') {
    for (const candidate of [branch, `refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
      const resolved = (gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', candidate], absRoot) || '').trim();
      if (resolved) {
        targetSha = resolved;
        break;
      }
    }
  } else if (!targetSha) {
    targetSha = (gitOutput(['rev-parse', '--verify', '-q', 'HEAD'], absRoot) || '').trim() || null;
  }

  let key;
  try {
    key = loadReceiptKey(absRoot, { create: false });
  } catch (err) {
    return { valid: false, targetSha, branch, reason: err.message };
  }
  if (!key) {
    return {
      valid: false,
      targetSha,
      branch,
      reason: `No receipt signing key (${RECEIPT_KEY_FILE} or SEALIT_RECEIPT_KEY); cannot verify receipts.`
    };
  }

  if (!targetSha) {
    return {
      valid: false,
      targetSha: null,
      branch,
      reason: 'No target commit SHA or branch ref resolved for receipt verification.'
    };
  }

  if (keyFileCommitState(absRoot, RECEIPT_KEY_FILE, targetSha) === 'committed') {
    return { valid: false, targetSha, branch, reason: makeUnusableKeyError('committed', RECEIPT_KEY_FILE).message };
  }

  const effectiveBranch =
    branch && !['HEAD', 'develop', 'main', 'master'].includes(branch) ? String(branch).trim() : null;
  const targetTreeSha = computeContentTreeSha(targetSha, absRoot);
  const isMultiParent = Boolean((gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', `${targetSha}^2`], absRoot) || '').trim());

  let activeChain = chain;
  const findMatchingReceipt = (recordsList) =>
    (recordsList || [])
      .filter((r) => (r.event === 'STAGE_7_GATE_RECEIPT_SIGNED' || r.event === 'GATE_RECEIPT_ISSUED') && r.metadata)
      .reverse()
      .find((r) => {
        const m = r.metadata;
        if (effectiveBranch && m.branch !== effectiveBranch) return false;
        const driftOk = m.driftPassed === true || m.driftCheckPassed === true;
        if (m.peerReviewApproved !== true || !driftOk || !verifyReceiptSignature(m, key)) {
          return false;
        }
        if (sameShaPrefix(m.headSha, targetSha) && m.headSha.length === targetSha.length) return true;
        if (isAuditOnlyCommitRange(m.headSha, targetSha, absRoot)) return true;
        if (!isMultiParent && m.treeSha && targetTreeSha && m.treeSha === targetTreeSha) return true;
        if (!effectiveBranch && verifyTwoParentCleanMerge(m.headSha, targetSha, absRoot)) return true;
        return false;
      });

  let matched = findMatchingReceipt(activeChain.records);
  if (!matched && targetSha) {
    const commitLedgerRaw = readBlobs([`${targetSha}:${AUDIT_LEDGER_FILE}`], absRoot).get(`${targetSha}:${AUDIT_LEDGER_FILE}`);
    if (commitLedgerRaw) {
      const commitChain = verifyAuditChainContent(commitLedgerRaw);
      if (!commitChain.valid) {
        return { valid: false, targetSha, branch, reason: `Audit hash chain in ${targetSha} corrupted: ${commitChain.error}` };
      }
      matched = findMatchingReceipt(commitChain.records);
      if (matched) activeChain = commitChain;
    }
  }

  if (!matched) {
    return {
      valid: false,
      targetSha,
      branch,
      reason: `No valid signed Stage 7 gate receipt found for ${targetSha}.`
    };
  }

  let baseCommit = isMultiParent ? (gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', `${targetSha}^1`], absRoot) || '').trim() : '';
  if (!baseCommit) {
    const effBase = resolveEffectiveDiffBase(null, absRoot);
    for (const cand of [`origin/${effBase}`, effBase]) {
      const cSha = (gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', `${cand}^{commit}`], absRoot) || '').trim();
      if (!cSha) continue;
      baseCommit = cSha === targetSha
        ? (gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', `${targetSha}~1`], absRoot) || '').trim()
        : (gitOutput(['merge-base', '--end-of-options', cand, targetSha], absRoot) || '').trim();
      if (baseCommit) break;
    }
  }
  if (baseCommit) {
    const baseLedgerRaw = readBlobs([`${baseCommit}:${AUDIT_LEDGER_FILE}`], absRoot).get(`${baseCommit}:${AUDIT_LEDGER_FILE}`);
    if (baseLedgerRaw) {
      const baseChain = verifyAuditChainContent(baseLedgerRaw);
      if (baseChain.valid && baseChain.recordsCount > 0 && (activeChain.recordsCount < baseChain.recordsCount || activeChain.records[baseChain.recordsCount - 1]?.currentHash !== baseChain.chainHead)) {
        return { valid: false, targetSha, branch, reason: 'Audit ledger continuity broken: historical records from base commit were truncated or rewritten.' };
      }
    }
  }

  return {
    valid: true,
    targetSha,
    receipt: matched.metadata,
    chainHash: matched.currentHash,
    chainHead: activeChain.chainHead
  };
}
