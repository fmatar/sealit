import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
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
  withFileLock
} from './git.mjs';
import { loadEffectivePolicy } from './config.mjs';
import {
  computeKernelDigest,
  computeTreeHash,
  readActiveSession,
  readGateCache,
  readSessionStore,
  writeActiveSession,
  writeGateCache
} from './session.mjs';

export {
  computeKernelDigest,
  computeTreeHash,
  readActiveSession,
  readGateCache,
  readSessionStore,
  writeActiveSession,
  writeGateCache
};

export const AUDIT_LEDGER_FILE = 'docs/AUDIT_CHAIN.jsonl';
export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
export const RECEIPT_KEY_FILE = '.agent/.receipt-key';
export const ALLOWED_SIGNERS_FILE = '.agent/allowed_signers';
export const SSHSIG_NAMESPACE = 'sealit-receipt';

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

function hasAllowedSignersContent(raw) {
  return Boolean(raw && String(raw).split(/\r?\n/).some((l) => l.trim() && !l.trim().startsWith('#')));
}

function expandUserPath(rawPath) {
  const s = String(rawPath || '').trim();
  if (s === '~') return os.homedir();
  if (s.startsWith('~/') || s.startsWith('~\\')) return path.join(os.homedir(), s.slice(2));
  return s;
}

export function resolveSshSigningKey(repoRoot = '.') {
  const envKey = String(process.env.SEALIT_SIGNING_KEY || '').trim();
  if (envKey) return envKey.startsWith('key::') ? envKey : expandUserPath(envKey);
  const gpgFmt = (gitOutput(['config', '--get', 'gpg.format'], repoRoot) || '').trim().toLowerCase();
  const gitKey = (gitOutput(['config', '--get', 'user.signingkey'], repoRoot) || '').trim();
  if (gitKey && (gpgFmt === 'ssh' || gitKey.endsWith('.pub') || gitKey.startsWith('key::'))) {
    return gitKey.startsWith('key::') ? gitKey : expandUserPath(gitKey);
  }
  return null;
}

function findPrincipalForPubKey(keyPath, allowedSignersRaw) {
  const pubRaw = keyPath.startsWith('key::') ? keyPath.slice(5) : readFileSafe(keyPath.endsWith('.pub') ? keyPath : `${keyPath}.pub`);
  if (!pubRaw) return null;
  const parts = pubRaw.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const needle = `${parts[0]} ${parts[1]}`;
  for (const line of String(allowedSignersRaw || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.includes(needle)) {
      const principal = trimmed.split(/\s+/)[0].split(',')[0].trim();
      if (principal) return { principal, keyId: crypto.createHash('sha256').update(needle).digest('hex').slice(0, 16) };
    }
  }
  return null;
}

export function signReceiptSsh(payload, keyPath, allowedSignersContent) {
  const canonical = canonicalJSON(payload);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sealit-sshsig-'));
  try {
    let keyArg = keyPath;
    if (keyPath.startsWith('key::')) {
      keyArg = path.join(tmpDir, 'signing.pub');
      fs.writeFileSync(keyArg, `${keyPath.slice(5).trim()}\n`, { encoding: 'utf8', mode: 0o600 });
    }
    const sig = execFileSync('ssh-keygen', ['-Y', 'sign', '-f', keyArg, '-n', SSHSIG_NAMESPACE], {
      input: canonical,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    const signersFile = path.join(tmpDir, 'allowed_signers');
    const sigFile = path.join(tmpDir, 'receipt.sig');
    fs.writeFileSync(signersFile, allowedSignersContent, { encoding: 'utf8', mode: 0o600 });
    fs.writeFileSync(sigFile, `${sig}\n`, { encoding: 'utf8', mode: 0o600 });
    const principalsOut = execFileSync('ssh-keygen', ['-Y', 'find-principals', '-f', signersFile, '-s', sigFile], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    const principal = principalsOut.split(/\r?\n/)[0]?.split(',')[0]?.trim();
    if (!principal) throw new Error(`Signing key '${keyPath}' is not authorized in ${ALLOWED_SIGNERS_FILE}.`);
    const pubMatch = findPrincipalForPubKey(keyPath, allowedSignersContent);
    const keyId = pubMatch?.keyId || crypto.createHash('sha256').update(principal).digest('hex').slice(0, 16);
    return { alg: 'SSHSIG', principal, keyId, value: sig };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

export function verifyReceiptSsh(receipt, allowedSignersContent) {
  if (!receipt || !receipt.signature || !hasAllowedSignersContent(allowedSignersContent)) return false;
  const { signature, ...payload } = receipt;
  if (signature.alg !== 'SSHSIG' || typeof signature.value !== 'string' || !signature.value.includes('BEGIN SSH SIGNATURE') || typeof signature.principal !== 'string' || !signature.principal.trim()) {
    return false;
  }
  if (payload.reviewer !== signature.principal) return false;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sealit-sshsig-ver-'));
  try {
    const signersFile = path.join(tmpDir, 'allowed_signers');
    const sigFile = path.join(tmpDir, 'receipt.sig');
    fs.writeFileSync(signersFile, allowedSignersContent, { encoding: 'utf8', mode: 0o600 });
    fs.writeFileSync(sigFile, `${signature.value.trim()}\n`, { encoding: 'utf8', mode: 0o600 });
    const fp = spawnSync('ssh-keygen', ['-Y', 'find-principals', '-f', signersFile, '-s', sigFile], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    if (fp.error || fp.status !== 0) return false;
    const matchedPrincipals = fp.stdout.trim().split(/\r?\n/).flatMap((l) => l.split(',')).map((s) => s.trim()).filter(Boolean);
    if (!matchedPrincipals.includes(signature.principal)) return false;
    const vr = spawnSync('ssh-keygen', ['-Y', 'verify', '-f', signersFile, '-I', signature.principal, '-n', SSHSIG_NAMESPACE, '-s', sigFile], {
      input: canonicalJSON(payload),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return !vr.error && vr.status === 0;
  } catch {
    return false;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
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
    return { valid: true, recordsCount: 0, gateReceiptsCount: 0, chainHead: GENESIS_HASH, merkleRoot: GENESIS_HASH, records: [], message: 'Audit chain is empty.' };
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
      return { valid: false, errorIndex: i, error: `Malformed JSON at line ${i + 1}: ${err.message}`, recordsCount: lines.length, gateReceiptsCount };
    }
    if (parsed.index !== i) {
      return { valid: false, errorIndex: i, error: `Index mismatch at record ${i}: expected ${i}, found ${parsed.index}`, recordsCount: lines.length, gateReceiptsCount };
    }
    if (parsed.previousHash !== expectedPrevHash) {
      return { valid: false, errorIndex: i, error: `Cryptographic chain broken at record ${i}: previousHash mismatch.`, recordsCount: lines.length, gateReceiptsCount };
    }
    const recalculated = calculateRecordHash({ index: parsed.index, timestamp: parsed.timestamp, event: parsed.event, metadata: parsed.metadata, previousHash: parsed.previousHash });
    if (recalculated !== parsed.currentHash) {
      return { valid: false, errorIndex: i, error: `SHA-256 tampering detected at record ${i}.`, recordsCount: lines.length, gateReceiptsCount };
    }
    if (parsed.event === 'STAGE_7_GATE_RECEIPT_SIGNED' || parsed.event === 'GATE_RECEIPT_ISSUED') gateReceiptsCount++;
    expectedPrevHash = parsed.currentHash;
    records.push(parsed);
  }

  return { valid: true, recordsCount: records.length, gateReceiptsCount, chainHead: expectedPrevHash, merkleRoot: expectedPrevHash, records, message: `Audit chain verified (${records.length} records, ${gateReceiptsCount} signed gate receipts).` };
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

function readCommitChain(commitSha, repoRoot) {
  if (!commitSha) return { present: false, valid: true, records: [], recordsCount: 0, chainHead: GENESIS_HASH };
  const raw = readBlobs([`${commitSha}:${AUDIT_LEDGER_FILE}`], repoRoot).get(`${commitSha}:${AUDIT_LEDGER_FILE}`);
  if (raw === null || raw === undefined) return { present: false, valid: true, records: [], recordsCount: 0, chainHead: GENESIS_HASH };
  return { present: true, ...verifyAuditChainContent(raw) };
}

function hasReceiptSig(chainObj, sigValue) {
  return Boolean(sigValue && chainObj?.valid && (chainObj.records || []).some((r) => r.metadata?.signature?.value === sigValue));
}

function extendsLedgerStrict(activeChain, baseChain) {
  if (!baseChain?.present) return true;
  if (!baseChain.valid) return false;
  return baseChain.recordsCount === 0 || (activeChain.recordsCount >= baseChain.recordsCount && activeChain.records[baseChain.recordsCount - 1]?.currentHash === baseChain.chainHead);
}

function preservesLedgerRecords(activeChain, otherChain) {
  if (extendsLedgerStrict(activeChain, otherChain)) return true;
  if (!otherChain?.valid || activeChain.recordsCount < otherChain.recordsCount) return false;
  const activeSet = new Set((activeChain.records || []).map((r) => `${r.event}:${canonicalJSON(r.metadata)}`));
  return (otherChain.records || []).every((r) => activeSet.has(`${r.event}:${canonicalJSON(r.metadata)}`));
}

function verifySquashedProtectedParent(receipt, p1, p2, repoRoot) {
  if (!receipt?.treeSha || !isProtectedBranchHistory(p2, repoRoot) || computeContentTreeSha(p2, repoRoot) !== receipt.treeSha) return false;
  const sigVal = receipt.signature?.value;
  const p2Chain = readCommitChain(p2, repoRoot);
  if (!p2Chain.present || !p2Chain.valid || !hasReceiptSig(p2Chain, sigVal) || hasReceiptSig(readCommitChain(p1, repoRoot), sigVal)) return false;
  let sqCommit = p2;
  while (true) {
    const prev = (gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', `${sqCommit}^1`], repoRoot) || '').trim();
    const prev2 = prev ? (gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', `${sqCommit}^2`], repoRoot) || '').trim() : '';
    if (!prev || prev2 || !isAuditOnlyCommitRange(prev, sqCommit, repoRoot)) break;
    sqCommit = prev;
  }
  const sqParent = (gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', `${sqCommit}^1`], repoRoot) || '').trim();
  if (sqParent) {
    const sqParentChain = readCommitChain(sqParent, repoRoot);
    if (hasReceiptSig(sqParentChain, sigVal) || !preservesLedgerRecords(p2Chain, sqParentChain)) return false;
    const resolvedHead = receipt.headSha ? (gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', `${receipt.headSha}^{commit}`], repoRoot) || '').trim() : '';
    if (resolvedHead) {
      const sqMb = (gitOutput(['merge-base', '--end-of-options', sqParent, resolvedHead], repoRoot) || '').trim();
      if (!verifyCleanThreeWayMergeTrees({ mbSha: sqMb, p1Ref: sqParent, p2Ref: resolvedHead, targetRef: sqCommit, repoRoot })) return false;
    }
  }
  return true;
}

function verifyTwoParentCleanMerge(receipt, targetSha, repoRoot, depth = 0) {
  const receiptHeadSha = receipt?.headSha;
  const p1 = (gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', `${targetSha}^1`], repoRoot) || '').trim();
  const p2 = (gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', `${targetSha}^2`], repoRoot) || '').trim();
  const p3 = (gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', `${targetSha}^3`], repoRoot) || '').trim();
  if (!p1 || !p2 || p3 || !isProtectedBranchHistory(p1, repoRoot)) return false;

  const p2MultiParent = Boolean((gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', `${p2}^2`], repoRoot) || '').trim());
  const p2Matches =
    receiptHeadSha === p2 ||
    isAuditOnlyCommitRange(receiptHeadSha, p2, repoRoot) ||
    (depth === 0 && !p2MultiParent && verifySquashedProtectedParent(receipt, p1, p2, repoRoot)) ||
    (depth < 1 && p2MultiParent && verifyTwoParentCleanMerge(receipt, p2, repoRoot, depth + 1));
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

  const treeSha = computeContentTreeSha(headSha, repoRoot);
  if (!treeSha || (lastGate.treeSha && lastGate.treeSha !== treeSha)) {
    return {
      success: false,
      reason: 'Refusing to issue gate receipt: lastGate treeSha does not match current HEAD content tree. Re-run sealit gate.'
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

  const parsedIssueId = parseTicketId(session.issueId) ?? session.issueId;
  const issueRef = typeof parsedIssueId === 'number' ? `#${parsedIssueId}` : String(parsedIssueId);
  const absRoot = path.resolve(repoRoot);
  const trust = resolveReceiptTrustContext({ absRoot, targetSha: headSha, baseBranch: session.baseBranch || null, isMultiParent: false });

  let key = null;
  let keyLoadErr = null;
  try { key = loadReceiptKey(absRoot, { create: false }); } catch (err) { keyLoadErr = err; }
  const activeAllowedSigners = selectActiveAllowedSigners(trust, key);
  const useSsh = Boolean(activeAllowedSigners);
  let sshKeyPath = null;

  if (useSsh) {
    sshKeyPath = resolveSshSigningKey(absRoot);
    if (!sshKeyPath) {
      return {
        success: false,
        reason: `${ALLOWED_SIGNERS_FILE} is configured, but no SSH signing key found. Set SEALIT_SIGNING_KEY or 'git config gpg.format ssh && git config user.signingkey <path>'.`
      };
    }
    const pubMatch = findPrincipalForPubKey(sshKeyPath, activeAllowedSigners);
    if (pubMatch?.principal) reviewer = pubMatch.principal;
  } else {
    if (keyLoadErr) return { success: false, reason: keyLoadErr.message };
    if (!key) {
      try { key = loadReceiptKey(absRoot, { create: true }); } catch (err) { return { success: false, reason: err.message }; }
    }
    if (!key) return { success: false, reason: 'No usable receipt signing key available.' };
  }

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

  let signature;
  if (useSsh) {
    try {
      signature = signReceiptSsh(payload, sshKeyPath, activeAllowedSigners);
      if (signature.principal !== payload.reviewer) {
        payload.reviewer = signature.principal;
        signature = signReceiptSsh(payload, sshKeyPath, activeAllowedSigners);
      }
    } catch (err) {
      return { success: false, reason: `SSH receipt signing failed: ${err.message}` };
    }
  } else {
    signature = {
      alg: 'HMAC-SHA256',
      keyId: crypto.createHash('sha256').update(key).digest('hex').slice(0, 16),
      value: signReceiptPayload(payload, key)
    };
  }

  const receipt = { ...payload, signature };

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

function resolveReceiptTrustContext({ absRoot, targetSha, baseBranch = null, isMultiParent = false }) {
  const effBase = resolveEffectiveDiffBase(baseBranch, absRoot);
  let baseTip = '';
  for (const cand of [`origin/${effBase}`, effBase]) {
    const cSha = (gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', `${cand}^{commit}`], absRoot) || '').trim();
    if (cSha) { baseTip = cSha; break; }
  }
  const parentOfTarget = (gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', isMultiParent ? `${targetSha}^1` : `${targetSha}~1`], absRoot) || '').trim();
  let trustAnchorCommit = '';
  let ledgerBaseCommit = '';
  let orphanCommit = false;
  if (baseTip && baseTip !== targetSha) {
    trustAnchorCommit = baseTip;
    const mb = (gitOutput(['merge-base', '--end-of-options', baseTip, targetSha], absRoot) || '').trim();
    orphanCommit = !mb;
    ledgerBaseCommit = isMultiParent ? (parentOfTarget || mb) : mb;
  } else {
    trustAnchorCommit = parentOfTarget;
    ledgerBaseCommit = parentOfTarget;
  }
  const signerSpecs = [...new Set([...(trustAnchorCommit ? [`${trustAnchorCommit}:${ALLOWED_SIGNERS_FILE}`] : []), `${targetSha}:${ALLOWED_SIGNERS_FILE}`])];
  const signerBlobs = readBlobs(signerSpecs, absRoot);
  const anchorSignersRaw = trustAnchorCommit ? signerBlobs.get(`${trustAnchorCommit}:${ALLOWED_SIGNERS_FILE}`) ?? null : null;
  const headSignersRaw = signerBlobs.get(`${targetSha}:${ALLOWED_SIGNERS_FILE}`) ?? null;
  const anchorChain = trustAnchorCommit ? readCommitChain(trustAnchorCommit, absRoot) : { present: false, valid: true, recordsCount: 0, gateReceiptsCount: 0 };
  const baseChain = ledgerBaseCommit === trustAnchorCommit ? anchorChain : (ledgerBaseCommit ? readCommitChain(ledgerBaseCommit, absRoot) : { present: false, valid: true, recordsCount: 0, gateReceiptsCount: 0 });
  return { trustAnchorCommit, ledgerBaseCommit, orphanCommit, anchorSignersRaw, headSignersRaw, anchorChain, baseChain };
}

function selectActiveAllowedSigners(trust, hmacKey) {
  if (hasAllowedSignersContent(trust.anchorSignersRaw)) return trust.anchorSignersRaw;
  if (!trust.orphanCommit && !hmacKey && trust.anchorChain.gateReceiptsCount === 0 && hasAllowedSignersContent(trust.headSignersRaw)) {
    return trust.headSignersRaw;
  }
  return null;
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
    return { valid: false, targetSha, branch, reason: 'Short commit SHA prefix must be at least 7 hex characters.' };
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
      if (resolved) { targetSha = resolved; break; }
    }
  } else if (!targetSha) {
    targetSha = (gitOutput(['rev-parse', '--verify', '-q', 'HEAD'], absRoot) || '').trim() || null;
  }
  if (!targetSha) return { valid: false, targetSha: null, branch, reason: 'No target commit SHA or branch ref resolved for receipt verification.' };

  const effectiveBranch = branch && !['HEAD', 'develop', 'main', 'master'].includes(branch) ? String(branch).trim() : null;
  const targetTreeSha = computeContentTreeSha(targetSha, absRoot);
  const isMultiParent = Boolean((gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', `${targetSha}^2`], absRoot) || '').trim());
  const trust = resolveReceiptTrustContext({ absRoot, targetSha, baseBranch: null, isMultiParent });
  const baseCommit = trust.ledgerBaseCommit;
  const baseChain = trust.baseChain;

  let key = null;
  let keyLoadErr = null;
  try { key = loadReceiptKey(absRoot, { create: false }); } catch (err) { keyLoadErr = err; }
  const activeAllowedSigners = selectActiveAllowedSigners(trust, key);

  if (!activeAllowedSigners) {
    if (keyLoadErr) return { valid: false, targetSha, branch, reason: keyLoadErr.message };
    if (!key) return { valid: false, targetSha, branch, reason: `No receipt signing key (${RECEIPT_KEY_FILE}, SEALIT_RECEIPT_KEY, or ${ALLOWED_SIGNERS_FILE}); cannot verify receipts.` };
    if (keyFileCommitState(absRoot, RECEIPT_KEY_FILE, targetSha) === 'committed') {
      return { valid: false, targetSha, branch, reason: makeUnusableKeyError('committed', RECEIPT_KEY_FILE).message };
    }
  }

  const verifySig = (m) => (activeAllowedSigners ? verifyReceiptSsh(m, activeAllowedSigners) : verifyReceiptSignature(m, key));

  let activeChain = chain;
  const findMatchingReceipt = (recordsList) =>
    (recordsList || [])
      .filter((r) => (r.event === 'STAGE_7_GATE_RECEIPT_SIGNED' || r.event === 'GATE_RECEIPT_ISSUED') && r.metadata)
      .reverse()
      .find((r) => {
        const m = r.metadata;
        if (effectiveBranch && m.branch !== effectiveBranch) return false;
        const driftOk = m.driftPassed === true || m.driftCheckPassed === true;
        if (m.peerReviewApproved !== true || !driftOk || !verifySig(m)) return false;
        if (sameShaPrefix(m.headSha, targetSha) && m.headSha.length === targetSha.length) return true;
        if (isAuditOnlyCommitRange(m.headSha, targetSha, absRoot)) return true;
        if (!isMultiParent && m.treeSha && targetTreeSha && m.treeSha === targetTreeSha) return true;
        if (!effectiveBranch && verifyTwoParentCleanMerge(m, targetSha, absRoot)) return true;
        return false;
      });

  let matched = null;
  if (isMultiParent) {
    const commitChain = readCommitChain(targetSha, absRoot);
    if (!commitChain.present || !commitChain.valid) return { valid: false, targetSha, branch, reason: `Missing or corrupted committed audit hash chain in merge commit ${targetSha}.` };
    activeChain = commitChain;
    matched = findMatchingReceipt(commitChain.records);
  } else {
    matched = findMatchingReceipt(activeChain.records);
    if (!matched && targetSha) {
      const commitChain = readCommitChain(targetSha, absRoot);
      if (commitChain.present) {
        if (!commitChain.valid) return { valid: false, targetSha, branch, reason: `Audit hash chain in ${targetSha} corrupted: ${commitChain.error}` };
        matched = findMatchingReceipt(commitChain.records);
        if (matched) activeChain = commitChain;
      }
    }
  }
  if (!matched) return { valid: false, targetSha, branch, reason: `No valid signed Stage 7 gate receipt found for ${targetSha}.` };

  if (baseCommit && !extendsLedgerStrict(activeChain, baseChain)) {
    return { valid: false, targetSha, branch, reason: 'Audit ledger continuity broken: historical records from base commit were truncated or rewritten.' };
  }
  if (isMultiParent) {
    const p2Commit = (gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', `${targetSha}^2`], absRoot) || '').trim();
    if (p2Commit && !preservesLedgerRecords(activeChain, readCommitChain(p2Commit, absRoot))) {
      return { valid: false, targetSha, branch, reason: 'Audit ledger continuity broken: records from merged branch were truncated or omitted.' };
    }
  }
  return { valid: true, targetSha, receipt: matched.metadata, chainHash: matched.currentHash, chainHead: activeChain.chainHead };
}
