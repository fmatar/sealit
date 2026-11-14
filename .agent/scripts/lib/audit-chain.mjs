import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolveQualityThresholds, parseTicketId } from './core.mjs';

export const AUDIT_LEDGER_FILE = 'docs/AUDIT_CHAIN.jsonl';
export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export function calculateRecordHash({ index, timestamp, event, metadata, previousHash }) {
  const payload = JSON.stringify({ index, timestamp, event, metadata, previousHash });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function withAuditChainLock(repoRoot, fn) {
  const lockDir = path.resolve(repoRoot, '.agent');
  fs.mkdirSync(lockDir, { recursive: true });
  const lockPath = path.join(lockDir, '.audit-chain.lock');
  const waitBuf = new Int32Array(new SharedArrayBuffer(4));
  let fd = null;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      fd = fs.openSync(lockPath, 'wx');
      break;
    } catch (err) {
      if (err && err.code !== 'EEXIST') throw err;
      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > 5000) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {}
      Atomics.wait(waitBuf, 0, 0, 15);
    }
  }
  if (fd === null) {
    throw new Error(`Timed out waiting for audit chain lock: ${lockPath}`);
  }
  try {
    fs.writeFileSync(fd, `${process.pid}\n`);
    return fn();
  } finally {
    try {
      fs.closeSync(fd);
    } catch {}
    try {
      fs.unlinkSync(lockPath);
    } catch {}
  }
}

export function appendAuditRecord({ event, metadata = {}, repoRoot = '.' } = {}) {
  return withAuditChainLock(repoRoot, () => {
    const auditPath = path.resolve(repoRoot, AUDIT_LEDGER_FILE);
    fs.mkdirSync(path.dirname(auditPath), { recursive: true });

    let previousHash = GENESIS_HASH;
    let index = 0;

    if (fs.existsSync(auditPath)) {
      const content = fs.readFileSync(auditPath, 'utf8').trim();
      if (content) {
        const integrity = verifyAuditChain(repoRoot);
        if (!integrity.valid) {
          throw new Error(`Refusing to append to corrupted audit ledger (${AUDIT_LEDGER_FILE}): ${integrity.error}`);
        }
        const lines = content.split('\n').filter(Boolean);
        if (lines.length > 0) {
          const lastEntry = JSON.parse(lines[lines.length - 1]);
          index = typeof lastEntry.index === 'number' ? lastEntry.index + 1 : lines.length;
          previousHash = lastEntry.currentHash || lastEntry.hash || GENESIS_HASH;
        }
      }
    }

    const timestamp = new Date().toISOString();
    const currentHash = calculateRecordHash({ index, timestamp, event, metadata, previousHash });

    const record = {
      index,
      timestamp,
      event,
      metadata,
      previousHash,
      currentHash
    };

    fs.appendFileSync(auditPath, JSON.stringify(record) + '\n', 'utf8');

    return {
      success: true,
      record,
      auditPath
    };
  });
}

export function verifyAuditChain(repoRoot = '.') {
  const auditPath = path.resolve(repoRoot, AUDIT_LEDGER_FILE);
  if (!fs.existsSync(auditPath)) {
    return {
      valid: true,
      recordsCount: 0,
      chainHead: GENESIS_HASH,
      merkleRoot: GENESIS_HASH,
      records: [],
      message: 'No audit records present (chain empty).'
    };
  }

  const content = fs.readFileSync(auditPath, 'utf8').trim();
  if (!content) {
    return {
      valid: true,
      recordsCount: 0,
      chainHead: GENESIS_HASH,
      merkleRoot: GENESIS_HASH,
      records: [],
      message: 'Audit chain is empty.'
    };
  }

  const lines = content.split('\n').filter(Boolean);
  let expectedPrevHash = GENESIS_HASH;
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
        recordsCount: lines.length
      };
    }

    if (parsed.index !== i) {
      return {
        valid: false,
        errorIndex: i,
        error: `Index mismatch at record ${i}: expected ${i}, found ${parsed.index}`,
        recordsCount: lines.length
      };
    }

    if (parsed.previousHash !== expectedPrevHash) {
      return {
        valid: false,
        errorIndex: i,
        error: `Cryptographic chain broken at record ${i}: previousHash mismatch. Expected ${expectedPrevHash}, found ${parsed.previousHash}`,
        recordsCount: lines.length
      };
    }

    const recalculatedHash = calculateRecordHash({
      index: parsed.index,
      timestamp: parsed.timestamp,
      event: parsed.event,
      metadata: parsed.metadata,
      previousHash: parsed.previousHash
    });

    if (recalculatedHash !== parsed.currentHash) {
      return {
        valid: false,
        errorIndex: i,
        error: `SHA-256 tampering detected at record ${i}: calculated ${recalculatedHash}, recorded ${parsed.currentHash}`,
        recordsCount: lines.length
      };
    }

    expectedPrevHash = parsed.currentHash;
    records.push(parsed);
  }

  return {
    valid: true,
    recordsCount: records.length,
    chainHead: expectedPrevHash,
    // Deprecated alias: this is a linear hash chain, not a Merkle tree.
    merkleRoot: expectedPrevHash,
    records,
    message: `Audit chain verified successfully (${records.length} immutable records).`
  };
}

export const RECEIPT_KEY_FILE = '.agent/.receipt-key';

/**
 * Loads the HMAC key used to sign gate receipts.
 * Order: SDLC_RECEIPT_KEY env var (e.g. a CI secret), then `.agent/.receipt-key`
 * (gitignored, mode 0600). With `create: true` a random 256-bit key is generated.
 * Returns null when no key exists and none may be created.
 */
export function loadReceiptKey(repoRoot = '.', { create = false } = {}) {
  if (process.env.SDLC_RECEIPT_KEY) return Buffer.from(process.env.SDLC_RECEIPT_KEY, 'utf8');
  const keyPath = path.resolve(repoRoot, RECEIPT_KEY_FILE);
  if (fs.existsSync(keyPath)) {
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', '--', RECEIPT_KEY_FILE], {
        cwd: repoRoot,
        stdio: 'pipe'
      });
      return null;
    } catch {}
    try {
      execFileSync('git', ['cat-file', '-e', `HEAD:${RECEIPT_KEY_FILE}`], {
        cwd: repoRoot,
        stdio: 'pipe'
      });
      return null;
    } catch {}
    const raw = fs.readFileSync(keyPath, 'utf8').trim();
    if (raw) return Buffer.from(raw, 'utf8');
  }
  if (!create) return null;
  const key = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, key + '\n', { encoding: 'utf8', mode: 0o600 });
  return Buffer.from(key, 'utf8');
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
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const VALID_RECEIPT_LANES = ['trivial', 'standard', 'full'];

function resolveReceiptThresholds(repoRoot = '.') {
  const thresholds = resolveQualityThresholds(repoRoot);
  return thresholds.configExists ? thresholds : { minCov: null, minMut: null };
}

export function issueGateReceipt({
  issueId,
  branch,
  headSha = null,
  lane = 'full',
  laneReason = null,
  coveragePct,
  coverage,
  mutationPct,
  mutationScore,
  docsOnly,
  peerReviewApproved,
  reviewer = null,
  driftCheckPassed,
  repoRoot = '.'
} = {}) {
  const resolvedLane = VALID_RECEIPT_LANES.includes(lane) ? lane : 'full';
  const isTrivialLane = resolvedLane === 'trivial';
  const isStandardLane = resolvedLane === 'standard';
  const rawCov = coveragePct !== undefined ? coveragePct : coverage;
  const rawMut = mutationPct !== undefined ? mutationPct : mutationScore;
  const resolvedDocsOnly = docsOnly !== undefined ? Boolean(docsOnly) : !isTrivialLane && rawCov === null && rawMut === null;
  const resolvedCoverage = (resolvedDocsOnly || isTrivialLane) && rawCov === undefined ? null : rawCov;
  const resolvedMutation = (resolvedDocsOnly || isTrivialLane || isStandardLane) && rawMut === undefined ? null : rawMut;
  const resolvedPeerReview = isTrivialLane && peerReviewApproved === undefined ? true : peerReviewApproved;
  const resolvedReviewer = reviewer || (isTrivialLane ? '@auto-trivial-gate' : null);

  const missing = [];
  if (!resolvedDocsOnly && !isTrivialLane && !Number.isFinite(resolvedCoverage)) missing.push('coveragePct');
  if (!resolvedDocsOnly && !isTrivialLane && !isStandardLane && resolvedMutation !== null && !Number.isFinite(resolvedMutation)) {
    missing.push('mutationPct');
  }
  if (typeof resolvedPeerReview !== 'boolean') missing.push('peerReviewApproved');
  if (typeof driftCheckPassed !== 'boolean') missing.push('driftCheckPassed');
  if (missing.length > 0) {
    return {
      success: false,
      missing,
      reason: `Refusing to issue gate receipt: unmeasured value(s): ${missing.join(', ')}. Run 'coverage', 'mutation' and 'review record' first.`
    };
  }

  if (!resolvedDocsOnly && !isTrivialLane) {
    const { minCov, minMut } = resolveReceiptThresholds(repoRoot);
    if (Number.isFinite(minCov) && Number.isFinite(resolvedCoverage) && resolvedCoverage < minCov) {
      return {
        success: false,
        missing: ['coveragePct'],
        reason: `Refusing to issue gate receipt: coverage ${resolvedCoverage}% is below configured threshold ${minCov}%.`
      };
    }
    if (!isStandardLane && resolvedMutation !== null && minMut !== null && Number.isFinite(minMut) && Number.isFinite(resolvedMutation) && resolvedMutation < minMut) {
      return {
        success: false,
        missing: ['mutationPct'],
        reason: `Refusing to issue gate receipt: mutation score ${resolvedMutation}% is below configured threshold ${minMut}%.`
      };
    }
  }

  let resolvedSha = headSha;
  if (!resolvedSha) {
    try {
      resolvedSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' }).trim();
    } catch {
      return { success: false, missing: ['headSha'], reason: 'Refusing to issue gate receipt: cannot resolve HEAD commit.' };
    }
  }

  const productMdPath = path.resolve(repoRoot, 'PRODUCT.md');
  const productMdHash = fs.existsSync(productMdPath)
    ? crypto.createHash('sha256').update(fs.readFileSync(productMdPath, 'utf8')).digest('hex')
    : null;

  const mutationStatus = resolvedDocsOnly
    ? 'docs-only'
    : isTrivialLane && resolvedMutation === null
      ? 'trivial-lane'
      : isStandardLane && resolvedMutation === null
        ? 'standard-lane-skipped'
        : resolvedMutation === null
          ? 'not-configured'
          : 'measured';

  const key = loadReceiptKey(repoRoot, { create: true });
  const parsedIssueId = parseTicketId(issueId) ?? issueId;
  const issueRef = typeof parsedIssueId === 'number' ? `#${parsedIssueId}` : String(parsedIssueId);
  const payload = {
    receiptId: `GATE-RECEIPT-${issueRef}-${resolvedSha.slice(0, 8)}`,
    issueId: parsedIssueId,
    branch: branch || 'feature/unknown',
    headSha: resolvedSha,
    productMdHash,
    stage: 7,
    lane: resolvedLane,
    ...(laneReason ? { laneReason } : {}),
    coveragePct: resolvedCoverage,
    mutationPct: resolvedMutation,
    docsOnly: resolvedDocsOnly,
    mutationStatus,
    peerReviewApproved: resolvedPeerReview,
    reviewer: resolvedReviewer,
    driftCheckPassed,
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
    receipt: {
      ...receipt,
      chainHash: auditRes.record.currentHash
    },
    auditRecord: auditRes.record
  };
}

/**
 * Verifies that a valid, untampered Stage 7 Cryptographic Gate Receipt exists
 * in the hash-chained audit ledger for the given commit SHA or branch,
 * with a valid HMAC signature under the local receipt key.
 */
export function verifyGateReceipt({ headSha = null, branch = null, repoRoot = '.' } = {}) {
  const chain = verifyAuditChain(repoRoot);
  if (!chain.valid) {
    return {
      valid: false,
      reason: `Audit hash chain corrupted: ${chain.error}`
    };
  }

  const isHexSha = (sha) => /^[0-9a-f]{7,64}$/i.test(String(sha || '').trim());
  const branchForLookup = branch && branch !== 'HEAD' ? branch : null;
  let targetSha = headSha ? String(headSha).trim() : null;
  if (targetSha && !isHexSha(targetSha)) {
    try {
      const resolvedRef = execFileSync('git', ['rev-parse', '--verify', '-q', '--end-of-options', targetSha], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe'
      }).trim();
      if (resolvedRef) targetSha = resolvedRef;
    } catch {}
  } else if (!targetSha && branchForLookup) {
    try {
      targetSha = execFileSync('git', ['rev-parse', '--verify', '-q', '--end-of-options', branchForLookup], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe'
      }).trim();
    } catch {}
  }

  const effectiveBranch =
    targetSha && branch && ['HEAD', 'develop', 'main', 'master'].includes(branch) ? null : branch;

  const key = loadReceiptKey(repoRoot);
  if (!key) {
    return { valid: false, targetSha, branch, reason: `No receipt signing key (${RECEIPT_KEY_FILE} or SDLC_RECEIPT_KEY); cannot verify receipts.` };
  }

  const receipts = (chain.records || [])
    .filter((r) => r.event === 'STAGE_7_GATE_RECEIPT_SIGNED' && r.metadata)
    .reverse();

  const matched = receipts.find((r) => {
    const m = r.metadata;
    const branchMatch = effectiveBranch ? m.branch === effectiveBranch : true;
    if (!branchMatch || m.peerReviewApproved !== true || m.driftCheckPassed !== true || !verifyReceiptSignature(m, key)) {
      return false;
    }
    if (!targetSha) return true;
    if (m.headSha === targetSha) return true;
    if (isHexSha(m.headSha) && isHexSha(targetSha)) {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', '--', m.headSha, targetSha], { cwd: repoRoot, stdio: 'pipe' });
        const diffFiles = execFileSync('git', ['diff', '--name-only', m.headSha, targetSha, '--'], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: 'pipe'
        })
          .trim()
          .split('\n')
          .filter(Boolean);
        if (
          diffFiles.length > 0 &&
          diffFiles.every(
            (f) =>
              f === 'docs/AUDIT_CHAIN.jsonl' ||
              f === 'docs/ARCH_TRACE.md' ||
              f === 'docs/DECISION_MAP.md' ||
              f === 'docs/KANBAN.md' ||
              f === '.agent/arch-trace.jsonl' ||
              f === '.agent/decision-graph.jsonl' ||
              f === '.agent/.sdlc-session.json'
          )
        ) {
          return true;
        }
      } catch {}
    }
    return false;
  });

  if (!matched) {
    return {
      valid: false,
      targetSha,
      branch,
      reason: `No valid signed Stage 7 gate receipt found for ${targetSha || branch || 'HEAD'}.`
    };
  }

  return {
    valid: true,
    receipt: matched.metadata,
    chainHash: matched.currentHash,
    chainHead: chain.chainHead
  };
}
