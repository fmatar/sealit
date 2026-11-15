import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  GENESIS_HASH,
  AUDIT_LEDGER_FILE,
  RECEIPT_KEY_FILE,
  calculateRecordHash,
  appendAuditRecord,
  verifyAuditChain,
  loadReceiptKey,
  signReceiptPayload,
  verifyReceiptSignature,
  issueGateReceipt,
  verifyGateReceipt
} from '../../.agent/scripts/lib/audit-chain.mjs';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-unit-audit-'));
}

function initMinimalGitHead(dir, branch = 'feature/issue-#77', headSha = 'abcdef1234567890abcdef1234567890abcdef12') {
  fs.mkdirSync(path.join(dir, '.git/refs/heads/feature'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git/HEAD'), `ref: refs/heads/${branch}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, '.git/refs/heads', branch), `${headSha}\n`, 'utf8');
}

describe('Unit: audit-chain.mjs', () => {
  let tmpDir;
  let prevKey;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    prevKey = process.env.SDLC_RECEIPT_KEY;
    delete process.env.SDLC_RECEIPT_KEY;
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env.SDLC_RECEIPT_KEY;
    else process.env.SDLC_RECEIPT_KEY = prevKey;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('calculateRecordHash is deterministic and sensitive to all payload fields', () => {
    const base = {
      index: 0,
      timestamp: '2026-11-14T00:00:00.000Z',
      event: 'EVT',
      metadata: { a: 1 },
      previousHash: GENESIS_HASH
    };
    const h0 = calculateRecordHash(base);
    assert.equal(h0.length, 64);
    assert.equal(h0, calculateRecordHash(base));
    assert.notEqual(h0, calculateRecordHash({ ...base, index: 1 }));
    assert.notEqual(h0, calculateRecordHash({ ...base, timestamp: '2026-11-14T00:00:01.000Z' }));
    assert.notEqual(h0, calculateRecordHash({ ...base, event: 'EVT2' }));
    assert.notEqual(h0, calculateRecordHash({ ...base, metadata: { a: 2 } }));
    assert.notEqual(h0, calculateRecordHash({ ...base, previousHash: 'f'.repeat(64) }));
  });

  it('appends records sequentially, exposes chainHead + merkleRoot alias, and detects ledger tampering', () => {
    const missing = verifyAuditChain(tmpDir);
    assert.equal(missing.valid, true);
    assert.equal(missing.recordsCount, 0);
    assert.equal(missing.chainHead, GENESIS_HASH);
    assert.equal(missing.merkleRoot, GENESIS_HASH);

    const ledgerPath = path.join(tmpDir, AUDIT_LEDGER_FILE);
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(ledgerPath, '', 'utf8');
    assert.equal(verifyAuditChain(tmpDir).valid, true);
    assert.equal(verifyAuditChain(tmpDir).chainHead, GENESIS_HASH);

    const r0 = appendAuditRecord({ event: 'FIRST', metadata: { step: 1 }, repoRoot: tmpDir });
    assert.equal(r0.success, true);
    assert.equal(r0.record.index, 0);
    assert.equal(r0.record.previousHash, GENESIS_HASH);
    assert.equal(r0.record.currentHash.length, 64);

    const r1 = appendAuditRecord({ event: 'SECOND', metadata: { step: 2 }, repoRoot: tmpDir });
    assert.equal(r1.record.index, 1);
    assert.equal(r1.record.previousHash, r0.record.currentHash);

    const valid = verifyAuditChain(tmpDir);
    assert.equal(valid.valid, true);
    assert.equal(valid.recordsCount, 2);
    assert.equal(valid.chainHead, r1.record.currentHash);
    assert.equal(valid.merkleRoot, r1.record.currentHash);

    const lines = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n');

    // Break hash on record 1
    const rec1 = JSON.parse(lines[1]);
    fs.writeFileSync(ledgerPath, `${lines[0]}\n${JSON.stringify({ ...rec1, metadata: { step: 999 } })}\n`, 'utf8');
    const hashTamper = verifyAuditChain(tmpDir);
    assert.equal(hashTamper.valid, false);
    assert.equal(hashTamper.errorIndex, 1);
    assert.match(hashTamper.error, /SHA-256 tampering detected at record 1/i);
    assert.throws(() => appendAuditRecord({ event: 'BLOCKED', repoRoot: tmpDir }), /Refusing to append to corrupted audit ledger/i);

    // Break previousHash link with recomputed hash so chain check runs
    const brokenPrevRec = { ...rec1, previousHash: '0'.repeat(64) };
    brokenPrevRec.currentHash = calculateRecordHash(brokenPrevRec);
    fs.writeFileSync(ledgerPath, `${lines[0]}\n${JSON.stringify(brokenPrevRec)}\n`, 'utf8');
    const prevBreak = verifyAuditChain(tmpDir);
    assert.equal(prevBreak.valid, false);
    assert.match(prevBreak.error, /previousHash mismatch/i);

    // Break sequential index
    const brokenIdxRec = { ...rec1, index: 5 };
    brokenIdxRec.currentHash = calculateRecordHash(brokenIdxRec);
    fs.writeFileSync(ledgerPath, `${lines[0]}\n${JSON.stringify(brokenIdxRec)}\n`, 'utf8');
    const idxBreak = verifyAuditChain(tmpDir);
    assert.equal(idxBreak.valid, false);
    assert.match(idxBreak.error, /Index mismatch at record 1/i);

    // Malformed JSON line
    fs.writeFileSync(ledgerPath, '{not-json\n', 'utf8');
    const malformed = verifyAuditChain(tmpDir);
    assert.equal(malformed.valid, false);
    assert.match(malformed.error, /Malformed JSON at line 1/i);
  });

  it('loads receipt keys from env or disk and verifies canonical HMAC signatures', () => {
    assert.equal(loadReceiptKey(tmpDir, { create: false }), null);

    const createdKey = loadReceiptKey(tmpDir, { create: true });
    assert.equal(Buffer.isBuffer(createdKey), true);
    assert.equal(createdKey.length, 64);
    assert.equal(fs.existsSync(path.join(tmpDir, RECEIPT_KEY_FILE)), true);
    assert.equal(Buffer.compare(loadReceiptKey(tmpDir, { create: false }), createdKey), 0);

    process.env.SDLC_RECEIPT_KEY = 'explicit-ci-secret-key';
    assert.equal(loadReceiptKey(tmpDir, { create: false }).toString('utf8'), 'explicit-ci-secret-key');
    delete process.env.SDLC_RECEIPT_KEY;

    const payloadA = { b: 2, nested: { y: true, x: [1, { d: 4, c: 3 }] }, a: 1 };
    const payloadB = { a: 1, nested: { x: [1, { c: 3, d: 4 }], y: true }, b: 2 };
    const sigA = signReceiptPayload(payloadA, createdKey);
    const sigB = signReceiptPayload(payloadB, createdKey);
    assert.equal(sigA, sigB);
    assert.equal(sigA.length, 64);

    assert.equal(verifyReceiptSignature({ ...payloadA, signature: { alg: 'HMAC-SHA256', value: sigA } }, createdKey), true);
    assert.equal(verifyReceiptSignature({ ...payloadA }, createdKey), false);
    assert.equal(verifyReceiptSignature({ ...payloadA, signature: { alg: 'HMAC-SHA256', value: 'a'.repeat(64) } }, createdKey), false);
    assert.equal(verifyReceiptSignature({ ...payloadA, signature: { alg: 'HMAC-SHA256', value: sigA } }, ''), false);
    assert.equal(verifyReceiptSignature({ ...payloadA, a: 99, signature: { alg: 'HMAC-SHA256', value: sigA } }, createdKey), false);
  });

  it('enforces gate receipt thresholds across trivial/standard/full lanes and verifies SHA/signature boundaries', () => {
    // Prepare a real single-commit git repo once inside this test so HEAD SHA & branch resolve natively
    execFileSync('git', ['init', '-b', 'develop'], { cwd: tmpDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'init\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir, stdio: 'pipe' });
    execFileSync('git', ['checkout', '-b', 'feature/issue-#77'], { cwd: tmpDir, stdio: 'pipe' });
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir, encoding: 'utf8' }).trim();

    fs.mkdirSync(path.join(tmpDir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.agent/sdlc-config.json'),
      JSON.stringify({ gates: { minDiffCoverage: 80, minMutationScore: 52 } }),
      'utf8'
    );

    // No receipt yet -> fails closed
    assert.equal(verifyGateReceipt({ repoRoot: tmpDir, branch: 'feature/issue-#77', headSha }).valid, false);

    // Non-trivial lane fails closed without coveragePct
    const missingCov = issueGateReceipt({
      issueId: 77,
      branch: 'feature/issue-#77',
      lane: 'standard',
      driftCheckPassed: true,
      peerReviewApproved: true,
      repoRoot: tmpDir
    });
    assert.equal(missingCov.success, false);
    assert.deepEqual(missingCov.missing, ['coveragePct']);

    // Boundary check: 79.9% < 80% is refused at receipt issuance
    const lowCov = issueGateReceipt({
      issueId: 77,
      branch: 'feature/issue-#77',
      lane: 'standard',
      coveragePct: 79.9,
      driftCheckPassed: true,
      peerReviewApproved: true,
      repoRoot: tmpDir
    });
    assert.equal(lowCov.success, false);
    assert.match(lowCov.reason, /below configured threshold 80%/i);

    // Rejected review signs receipt with peerReviewApproved=false and fails verification
    const rejectedReview = issueGateReceipt({
      issueId: 77,
      branch: 'feature/issue-#77',
      lane: 'standard',
      coveragePct: 85,
      driftCheckPassed: true,
      peerReviewApproved: false,
      repoRoot: tmpDir
    });
    assert.equal(rejectedReview.success, true);
    assert.equal(verifyGateReceipt({ headSha, branch: 'feature/issue-#77', repoRoot: tmpDir }).valid, false);

    // Full lane with mutationPct 51.9% < 52% is refused at receipt issuance
    const lowMut = issueGateReceipt({
      issueId: 77,
      branch: 'feature/issue-#77',
      lane: 'full',
      coveragePct: 85,
      mutationPct: 51.9,
      mutationConfigured: true,
      driftCheckPassed: true,
      peerReviewApproved: true,
      repoRoot: tmpDir
    });
    assert.equal(lowMut.success, false);
    assert.match(lowMut.reason, /below configured threshold 52%/i);

    // Missing driftCheckPassed refused without signing receipt
    const missingDrift = issueGateReceipt({
      issueId: 77,
      branch: 'feature/issue-#77',
      lane: 'standard',
      coveragePct: 85,
      peerReviewApproved: true,
      repoRoot: tmpDir
    });
    assert.equal(missingDrift.success, false);
    assert.ok(missingDrift.missing.includes('driftCheckPassed'));

    // Explicit driftCheckPassed=false signs receipt that fails verification
    const badDrift = issueGateReceipt({
      issueId: 77,
      branch: 'feature/issue-#77',
      lane: 'standard',
      coveragePct: 85,
      driftCheckPassed: false,
      peerReviewApproved: true,
      repoRoot: tmpDir
    });
    assert.equal(badDrift.success, true);
    assert.equal(verifyGateReceipt({ headSha, branch: 'feature/issue-#77', repoRoot: tmpDir }).valid, false);

    // Trivial lane issues cleanly without coverage/mutation/reviewers
    const trivial = issueGateReceipt({ issueId: 'L-1', branch: 'feature/issue-#77', lane: 'trivial', driftCheckPassed: true, repoRoot: tmpDir });
    assert.equal(trivial.success, true);
    assert.equal(trivial.receipt.lane, 'trivial');
    assert.equal(trivial.receipt.headSha, headSha);

    const vTrivial = verifyGateReceipt({ headSha, branch: 'feature/issue-#77', repoRoot: tmpDir });
    assert.equal(vTrivial.valid, true);
    assert.equal(vTrivial.receipt.issueId, 'L-1');

    // Full lane with exact boundary coverage=80 & mutation=52 succeeds
    const full = issueGateReceipt({
      issueId: 77,
      branch: 'feature/issue-#77',
      lane: 'full',
      coveragePct: 80,
      mutationPct: 52,
      mutationConfigured: true,
      driftCheckPassed: true,
      peerReviewApproved: true,
      reviewer: '@peer',
      repoRoot: tmpDir
    });
    assert.equal(full.success, true);
    assert.equal(verifyGateReceipt({ headSha, branch: 'feature/issue-#77', repoRoot: tmpDir }).valid, true);
    assert.equal(verifyGateReceipt({ headSha: headSha.slice(0, 7), branch: 'feature/issue-#77', repoRoot: tmpDir }).valid, false);

    // Wrong branch or wrong SHA fails closed
    assert.equal(verifyGateReceipt({ headSha, branch: 'other-branch', repoRoot: tmpDir }).valid, false);
    assert.equal(verifyGateReceipt({ headSha: 'deadbeef1234567890', branch: 'feature/issue-#77', repoRoot: tmpDir }).valid, false);

    // Wrong HMAC key fails closed
    process.env.SDLC_RECEIPT_KEY = 'wrong-key';
    const wrongSig = verifyGateReceipt({ headSha, branch: 'feature/issue-#77', repoRoot: tmpDir });
    assert.equal(wrongSig.valid, false);
    delete process.env.SDLC_RECEIPT_KEY;
  });

  it('reclaims stale audit locks, hashes PRODUCT.md, checks standard/docs-only receipts, and resolves minimal git HEAD', () => {
    fs.writeFileSync(path.join(tmpDir, 'PRODUCT.md'), '# Product Constitution\n', 'utf8');
    initMinimalGitHead(tmpDir, 'feature/issue-#78', '1234567890abcdef1234567890abcdef12345678');

    // Create stale lock file with old mtime -> appendAuditRecord reclaims and cleans up
    const lockPath = path.join(tmpDir, '.agent/.audit-chain.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, '99999\n', 'utf8');
    const oldTime = new Date(Date.now() - 20000);
    fs.utimesSync(lockPath, oldTime, oldTime);

    const rec = appendAuditRecord({ event: 'LOCK_RECLAIM_TEST', metadata: { ok: true }, repoRoot: tmpDir });
    assert.equal(rec.success, true);
    assert.equal(fs.existsSync(lockPath), false);

    // Null/malformed signature fails closed
    assert.equal(verifyReceiptSignature(null, 'key'), false);
    assert.equal(verifyReceiptSignature({}, 'key'), false);
    assert.equal(verifyReceiptSignature({ signature: { alg: 'RSA', value: 'aa' } }, 'key'), false);

    // Standard lane skips mutation score cleanly
    const head78 = '1234567890abcdef1234567890abcdef12345678';
    const std = issueGateReceipt({
      issueId: 78,
      branch: 'feature/issue-#78',
      lane: 'standard',
      headSha: head78,
      coveragePct: 86,
      peerReviewApproved: true,
      reviewer: '@std',
      driftCheckPassed: true,
      repoRoot: tmpDir
    });
    assert.equal(std.success, true);
    assert.equal(std.receipt.mutationStatus, 'standard-lane-skipped');
    assert.equal(std.receipt.mutationPct, null);
    assert.match(std.receipt.productMdHash, /^[0-9a-f]{64}$/);
    assert.equal(std.receipt.signature.alg, 'HMAC-SHA256');
    assert.equal(std.receipt.signature.keyId.length, 16);

    const autoVerify = verifyGateReceipt({ headSha: head78, branch: 'feature/issue-#78', repoRoot: tmpDir });
    assert.equal(autoVerify.valid, true);
    assert.equal(autoVerify.receipt.issueId, 78);

    // Full lane with docsOnly=true skips mutation cleanly
    const docsFull = issueGateReceipt({
      issueId: 78,
      branch: 'feature/issue-#78',
      lane: 'full',
      headSha: head78,
      docsOnly: true,
      coveragePct: 92,
      peerReviewApproved: true,
      driftCheckPassed: true,
      repoRoot: tmpDir
    });
    assert.equal(docsFull.success, true);
    assert.equal(docsFull.receipt.docsOnly, true);
    assert.equal(docsFull.receipt.mutationStatus, 'docs-only');
    assert.equal(verifyGateReceipt({ headSha: head78, branch: 'feature/issue-#78', repoRoot: tmpDir }).valid, true);

    // Non-receipt lines & empty trailing newlines don't break verifyAuditChain
    const verified = verifyAuditChain(tmpDir);
    assert.equal(verified.valid, true);
    assert.equal(verified.recordsCount, 3);
  });
});
