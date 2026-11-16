import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  cleanGitEnv,
  computeContentTreeSha,
  fileExists,
  getCurrentGitBranch,
  getModifiedFiles,
  getRepoEnv,
  gitExec,
  gitOutput,
  hasDirtyNonGovernanceFiles,
  isDocsOnlyDiff,
  normalizeTicketId,
  parseTicketId,
  readFileSafe,
  resolveEffectiveDiffBase,
  resolveGitCommonRepoRoot,
  sameShaPrefix,
   unquoteGitPath,
  withFileLock,
  writeFileAtomic
} from './git.mjs';
import { loadConfig } from './config.mjs';
import { spawnSync } from 'node:child_process';

export const AUDIT_LEDGER_FILE = 'docs/AUDIT_CHAIN.jsonl';
export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
export const RECEIPT_KEY_FILE = '.agent/.receipt-key';

const CACHE_EXCLUDED_PATHS = new Set([
  'docs/AUDIT_CHAIN.jsonl',
  '.agent/.sdlc-session.json',
  '.agent/.sdlc-session.lock',
  '.agent/.receipt-key',
  '.agent/.audit-chain.lock',
  '.agent/.sdlc-config.lock'
]);

export function calculateRecordHash({ index, timestamp, event, metadata, previousHash }) {
  const payload = JSON.stringify({ index, timestamp, event, metadata, previousHash });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function keyFileCommitState(checkRoot) {
  const ls = spawnSync('git', ['-C', checkRoot, 'ls-files', '--error-unmatch', '--', RECEIPT_KEY_FILE], {
    cwd: checkRoot,
    env: cleanGitEnv(),
    stdio: 'pipe'
  });
  if (ls.error || (ls.status !== 0 && ls.status !== 1)) return 'unknown';
  if (ls.status === 0) return 'committed';

  const head = spawnSync('git', ['-C', checkRoot, 'cat-file', '-e', `HEAD:${RECEIPT_KEY_FILE}`], {
    cwd: checkRoot,
    env: cleanGitEnv(),
    stdio: 'pipe'
  });
  if (head.error || (head.status !== 0 && head.status !== 128)) return 'unknown';
  return head.status === 0 ? 'committed' : 'clean';
}

function makeUnusableKeyError(state) {
  const err = new Error(
    state === 'committed'
      ? `${RECEIPT_KEY_FILE} is committed to git; run 'git rm --cached ${RECEIPT_KEY_FILE}' and rotate the key.`
      : `Cannot confirm ${RECEIPT_KEY_FILE} is untracked (git unavailable or repository unreadable); refusing to trust key file.`
  );
  err.code = 'RECEIPT_KEY_UNUSABLE';
  return err;
}

export function loadReceiptKey(repoRoot = '.', { create = false } = {}) {
  const envRaw = getRepoEnv('SDLC_RECEIPT_KEY', repoRoot).trim();
  if (envRaw) {
    return Buffer.from(envRaw, 'utf8');
  }

  const absRoot = path.resolve(repoRoot);
  const commonRoot = resolveGitCommonRepoRoot(absRoot);
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
  const envRaw = getRepoEnv('SDLC_RECEIPT_KEY', repoRoot).trim();
  if (envRaw) {
    return { source: 'env', usable: true, committed: false, mode: null, error: null };
  }
  const absRoot = path.resolve(repoRoot);
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
  if (signature.alg !== 'HMAC-SHA256' || typeof signature.value !== 'string') return false;
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

    if (fileExists(auditPath)) {
      const content = fs.readFileSync(auditPath, 'utf8').trim();
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
    fs.appendFileSync(auditPath, JSON.stringify(record) + '\n', 'utf8');
    return { success: true, record, auditPath };
  });
}

function resolveSessionPaths(repoRoot = '.') {
  const commonRoot = resolveGitCommonRepoRoot(repoRoot);
  return {
    sessionPath: path.join(commonRoot, '.agent', '.sdlc-session.json'),
    lockPath: path.join(commonRoot, '.agent', '.sdlc-session.lock')
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
  let store;
  try {
    store = readSessionStore(repoRoot);
  } catch {
    return null;
  }
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

function isCacheExcludedPath(relPath = '') {
  const norm = String(relPath || '').replace(/\\/g, '/').replace(/^\.\//, '');
  return CACHE_EXCLUDED_PATHS.has(norm) || norm.startsWith('.agent/.cache/');
}

export function computeTreeHash({ repoRoot = '.', modulePath = '.', checkType = '' } = {}) {
  const absRoot = path.resolve(repoRoot);
  const hash = crypto.createHash('sha256');
  hash.update(`module:${modulePath}\nnode:${process.version}\ncheckType:${checkType}\n`);

  for (const cfgRel of ['.agent/sdlc-config.json', '.archlens/policy.json', 'stryker.config.json', 'package.json']) {
    const cfgAbs = path.join(absRoot, cfgRel);
    hash.update(`cfg:${cfgRel}:${fileExists(cfgAbs) ? readFileSafe(cfgAbs) || '' : ''}\n`);
  }

  const headRes = gitExec(['rev-parse', '--verify', 'HEAD'], absRoot);
  if (headRes.error || headRes.status !== 0) {
    return { hash: hash.digest('hex'), cacheable: false };
  }
  const headSha = headRes.stdout.trim();
  const effBase = resolveEffectiveDiffBase(null, absRoot);
  const mbOut = effBase ? gitOutput(['merge-base', effBase, 'HEAD'], absRoot) : '';

  const statusRes = gitExec(['status', '--porcelain', '--untracked-files=all', '--', modulePath], absRoot);
  if (statusRes.error || statusRes.status !== 0) {
    return { hash: hash.digest('hex'), cacheable: false };
  }
  const filteredStatus = statusRes.stdout
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => {
      if (!line.trim()) return false;
      const rel = unquoteGitPath(line.slice(3).trim());
      return !isCacheExcludedPath(rel);
    });

  const excludeSpecs = [...CACHE_EXCLUDED_PATHS].map((p) => `:(exclude)${p}`);
  const diffRes = gitExec(['diff', 'HEAD', '--', modulePath, ...excludeSpecs], absRoot);
  if (diffRes.error || diffRes.status !== 0) {
    return { hash: hash.digest('hex'), cacheable: false };
  }

  hash.update(`head:${headSha}\nmb:${(mbOut || '').trim()}\nstatus:${filteredStatus.join('\n')}\ndiff:${diffRes.stdout}\n`);

  for (const line of filteredStatus) {
    if (line.startsWith('?? ')) {
      const rel = unquoteGitPath(line.slice(3).trim());
      if (isCacheExcludedPath(rel)) continue;
      const full = path.resolve(absRoot, rel);
      if (fileExists(full) && fs.statSync(full).isFile()) {
        hash.update(`untracked:${rel}:`);
        hash.update(fs.readFileSync(full));
        hash.update('\n');
      }
    }
  }

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
  const diffRes = gitExec(['diff', '--name-only', '--end-of-options', `${fromSha}..${toSha}`], repoRoot);
  if (diffRes.error || diffRes.status !== 0) return false;
  const changed = diffRes.stdout
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((s) => unquoteGitPath(s).replace(/\\/g, '/'))
    .filter(Boolean);
  return changed.every((f) => f === AUDIT_LEDGER_FILE);
}

function readTreeBlobMap(commitSha, repoRoot) {
  const out = gitOutput(['ls-tree', '-r', '--full-tree', '--end-of-options', commitSha], repoRoot);
  if (out === null) return null;
  const map = new Map();
  for (const line of out.replace(/\r\n/g, '\n').split('\n')) {
    if (!line.trim()) continue;
    const tabIdx = line.indexOf('\t');
    if (tabIdx === -1) continue;
    const meta = line.slice(0, tabIdx).trim();
    const rel = unquoteGitPath(line.slice(tabIdx + 1)).replace(/\\/g, '/');
    if (rel === AUDIT_LEDGER_FILE) continue;
    map.set(rel, meta);
  }
  return map;
}

function verifyTwoParentCleanMerge(receiptHeadSha, targetSha, repoRoot) {
  const p1 = (gitOutput(['rev-parse', '--verify', '-q', `${targetSha}^1`], repoRoot) || '').trim();
  const p2 = (gitOutput(['rev-parse', '--verify', '-q', `${targetSha}^2`], repoRoot) || '').trim();
  const p3 = (gitOutput(['rev-parse', '--verify', '-q', `${targetSha}^3`], repoRoot) || '').trim();
  if (!p1 || !p2 || p3) return false;
  if (receiptHeadSha !== p2 && !isAuditOnlyCommitRange(receiptHeadSha, p2, repoRoot)) {
    return false;
  }

  const mapP1 = readTreeBlobMap(p1, repoRoot);
  const mapP2 = readTreeBlobMap(p2, repoRoot);
  const mapTarget = readTreeBlobMap(targetSha, repoRoot);
  if (!mapP1 || !mapP2 || !mapTarget) return false;

  for (const [file, entry] of mapTarget.entries()) {
    if (entry !== mapP1.get(file) && entry !== mapP2.get(file)) {
      return false;
    }
  }

  const allParentFiles = new Set([...mapP1.keys(), ...mapP2.keys()]);
  for (const file of allParentFiles) {
    if (!mapTarget.has(file) && mapP1.has(file) && mapP2.has(file)) {
      return false;
    }
  }

  const mb = (gitOutput(['merge-base', p1, p2], repoRoot) || '').trim();
  if (mb) {
    const mapMb = readTreeBlobMap(mb, repoRoot);
    if (mapMb) {
      for (const [file, p2Entry] of mapP2.entries()) {
        if (mapMb.get(file) !== p2Entry && mapP1.get(file) === mapMb.get(file)) {
          if (mapTarget.get(file) !== p2Entry) return false;
        }
      }
    }
  }
  return true;
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
      reason: `Refusing to issue gate receipt: no active session found for branch '${branch}'. Run 'sdlc begin' and 'sdlc gate' first.`
    };
  }

  const modFiles = getModifiedFiles(session.baseBranch || null, repoRoot);
  const isDocsDiff = modFiles.length > 0 && isDocsOnlyDiff(modFiles);
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
      reason: 'Refusing to issue gate receipt: no passing sdlc gate measurement recorded for this session.'
    };
  }

  if (lastGate.headSha !== headSha && !isAuditOnlyCommitRange(lastGate.headSha, headSha, repoRoot)) {
    return {
      success: false,
      reason: `Refusing to issue gate receipt: lastGate measurement (${lastGate.headSha}) does not match current HEAD (${headSha}). Re-run 'sdlc gate'.`
    };
  }

  const effectiveMode = lastGate.mode || (isDocsDiff ? 'docs-only' : 'code');
  const { config } = loadConfig(repoRoot);
  const mods = config?.modules || [];

  if (effectiveMode === 'code') {
    const covThresholds = mods.map((m) => m.thresholds?.diffCoverage).filter((v) => typeof v === 'number');
    const minCov = covThresholds.length > 0 ? Math.max(...covThresholds) : null;
    if (minCov !== null && (typeof lastGate.diffCoveragePct !== 'number' || lastGate.diffCoveragePct < minCov)) {
      return {
        success: false,
        reason: `Refusing to issue gate receipt: diff coverage (${lastGate.diffCoveragePct ?? 'unmeasured'}%) is below threshold ${minCov}%.`
      };
    }

    const mutThresholds = mods
      .filter((m) => Boolean(m.commands?.mutation) && typeof m.thresholds?.mutationScore === 'number')
      .map((m) => m.thresholds.mutationScore);
    const minMut = mutThresholds.length > 0 ? Math.max(...mutThresholds) : null;
    const emptyMutSkip =
      lastGate.mutationStatus === 'diff-no-mutated-sources' || lastGate.mutationStatus === 'diff-zero-mutants';
    if (minMut !== null && !emptyMutSkip && (typeof lastGate.mutationPct !== 'number' || lastGate.mutationPct < minMut)) {
      return {
        success: false,
        reason: `Refusing to issue gate receipt: mutation score (${lastGate.mutationPct ?? 'unmeasured'}%) is below threshold ${minMut}%.`
      };
    }
  }

  let reviewer = reviewerOverride || null;
  if (effectiveMode === 'code') {
    const pr = session.peerReview;
    if (!pr || pr.verdict !== 'approve') {
      return {
        success: false,
        reason: "Refusing to issue gate receipt: code changes require an approved peer review ('sdlc review record --verdict approve')."
      };
    }
    if (pr.headSha !== headSha && !isAuditOnlyCommitRange(pr.headSha, headSha, repoRoot)) {
      return {
        success: false,
        reason: `Refusing to issue gate receipt: peer review was recorded for ${pr.headSha}, which does not match HEAD ${headSha}.`
      };
    }
    reviewer = reviewer || pr.reviewer || '@sdlc-gate';
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
    if (expanded) targetSha = expanded;
  } else if (targetSha && !isHexSha(targetSha)) {
    const resolved = (gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', targetSha], absRoot) || '').trim();
    if (resolved) targetSha = resolved;
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
      reason: `No receipt signing key (${RECEIPT_KEY_FILE} or SDLC_RECEIPT_KEY); cannot verify receipts.`
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

  const effectiveBranch =
    branch && !['HEAD', 'develop', 'main', 'master'].includes(branch) ? String(branch).trim() : null;
  const targetTreeSha = computeContentTreeSha(targetSha, absRoot);

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
        if (m.treeSha && targetTreeSha && m.treeSha === targetTreeSha) return true;
        if (verifyTwoParentCleanMerge(m.headSha, targetSha, absRoot)) return true;
        return false;
      });

  let matched = findMatchingReceipt(activeChain.records);
  if (!matched && targetSha) {
    const commitLedgerRaw = gitOutput(['show', `${targetSha}:${AUDIT_LEDGER_FILE}`], absRoot);
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

  return {
    valid: true,
    targetSha,
    receipt: matched.metadata,
    chainHash: matched.currentHash,
    chainHead: activeChain.chainHead
  };
}
