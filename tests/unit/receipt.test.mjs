import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTempGitRepo, git, withoutReceiptEnv } from '../helpers/test-harness.mjs';
import { computeContentTreeSha } from '../../.agent/scripts/lib/git.mjs';
import { computeAlignmentHashes } from '../../.agent/scripts/lib/drift.mjs';
import {
  RECEIPT_KEY_FILE,
  loadReceiptKey,
  inspectReceiptKeyStatus,
  appendAuditRecord,
  verifyAuditChain,
  readActiveSession,
  writeActiveSession,
  computeTreeHash,
  readGateCache,
  writeGateCache,
  issueGateReceipt,
  verifyGateReceipt
} from '../../.agent/scripts/lib/receipt.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

function seedPassingSession(dir, branch, headSha, mode = 'code') {
  const treeSha = computeContentTreeSha(headSha, dir);
  const { specHash, adrHashes } = computeAlignmentHashes(dir);
  writeActiveSession(dir, (store) => {
    store.activeSessionId = '42';
    store.sessions['42'] = {
      issueId: '42',
      branch,
      baseBranch: 'develop',
      startedAt: '2026-11-16T00:00:00.000Z',
      peerReview:
        mode === 'code'
          ? { verdict: 'approve', reviewer: '@reviewer', headSha, recordedAt: '2026-11-16T00:01:00.000Z' }
          : null,
      lastGate: {
        passed: true,
        headSha,
        treeSha,
        mode,
        specHash,
        adrHashes,
        lintPassed: true,
        buildPassed: true,
        testsPassed: true,
        diffCoveragePct: mode === 'code' ? 94.5 : null,
        mutationPct: mode === 'code' ? 66.0 : null,
        mutationStatus: mode === 'code' ? 'measured' : 'docs-only',
        secretScanPassed: true,
        archPassed: true,
        driftPassed: true,
        measuredAt: '2026-11-16T00:01:00.000Z'
      }
    };
    return store;
  });
}

describe('Ring 1: lib/receipt.mjs', () => {
  it('trims SDLC_RECEIPT_KEY identically across process.env, .env, and .agent/.receipt-key', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    withoutReceiptEnv(() => {
      fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
      fs.writeFileSync(path.join(dir, RECEIPT_KEY_FILE), 'my-secret-key\n', { mode: 0o600 });
      const fromFile = loadReceiptKey(dir);

      fs.writeFileSync(path.join(dir, '.env'), 'SDLC_RECEIPT_KEY=my-secret-key\r\n', 'utf8');
      const fromDotEnv = loadReceiptKey(dir);

      process.env.SDLC_RECEIPT_KEY = '  my-secret-key\r\n';
      const fromEnv = loadReceiptKey(dir);
      delete process.env.SDLC_RECEIPT_KEY;

      assert.deepEqual(fromFile, Buffer.from('my-secret-key', 'utf8'));
      assert.deepEqual(fromDotEnv, fromFile);
      assert.deepEqual(fromEnv, fromFile);

      fs.unlinkSync(path.join(dir, '.env'));
      const status = inspectReceiptKeyStatus(dir);
      assert.equal(status.source, 'file');
      assert.equal(status.usable, true);
      assert.equal(status.committed, false);
    });
  });

  it('fails closed with RECEIPT_KEY_UNUSABLE when key is committed or when git is missing (never TypeError)', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    withoutReceiptEnv(() => {
      git(dir, 'checkout', '-q', '-b', 'feat/key-test', 'develop');
      fs.writeFileSync(path.join(dir, 'src.mjs'), 'export const a = 1;\n', 'utf8');
      git(dir, 'add', 'src.mjs');
      git(dir, 'commit', '-q', '-m', 'feat: add src');
      const sha = git(dir, 'rev-parse', 'HEAD').stdout.trim();
      seedPassingSession(dir, 'feat/key-test', sha, 'code');

      const okReceipt = issueGateReceipt({ repoRoot: dir });
      assert.equal(okReceipt.success, true);

      // Force-add the generated receipt key into git index
      assert.equal(git(dir, 'add', '-f', RECEIPT_KEY_FILE).status, 0);
      assert.throws(() => loadReceiptKey(dir, { create: true }), (err) => err?.code === 'RECEIPT_KEY_UNUSABLE');

      // issueGateReceipt and verifyGateReceipt return clean failure objects, never TypeError
      git(dir, 'commit', '-q', '-m', 'bad: commit key and audit chain');
      const shaAfterCommit = git(dir, 'rev-parse', 'HEAD').stdout.trim();
      seedPassingSession(dir, 'feat/key-test', shaAfterCommit, 'code');

      const refusedSign = issueGateReceipt({ repoRoot: dir });
      assert.equal(refusedSign.success, false);
      assert.match(refusedSign.reason, /committed|unusable/i);

      const refusedVerify = verifyGateReceipt({ headSha: sha, branch: 'feat/key-test', repoRoot: dir });
      assert.equal(refusedVerify.valid, false);
      assert.match(refusedVerify.reason, /committed|unusable/i);
    });

    // Git unavailable in PATH fails closed when .agent/.receipt-key exists
    const repo2 = createTempGitRepo();
    cleanups.push(repo2.cleanup);
    withoutReceiptEnv(() => {
      fs.mkdirSync(path.join(repo2.dir, '.agent'), { recursive: true });
      fs.writeFileSync(path.join(repo2.dir, RECEIPT_KEY_FILE), 'secret-123\n', { mode: 0o600 });
      const prevPath = process.env.PATH;
      process.env.PATH = '/nonexistent-bin-dir';
      try {
        assert.throws(() => loadReceiptKey(repo2.dir), (err) => err?.code === 'RECEIPT_KEY_UNUSABLE');
      } finally {
        process.env.PATH = prevPath;
      }
    });
  });

  it('counts STAGE_7_GATE_RECEIPT_SIGNED in verifyAuditChain and detects corrupt JSONL and session files', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    appendAuditRecord({ event: 'SESSION_STARTED', metadata: { issueId: '42' }, repoRoot: dir });
    appendAuditRecord({ event: 'STAGE_7_GATE_RECEIPT_SIGNED', metadata: { receiptId: 'R-1' }, repoRoot: dir });

    const verified = verifyAuditChain(dir);
    assert.equal(verified.valid, true);
    assert.equal(verified.recordsCount, 2);
    assert.equal(verified.gateReceiptsCount, 1);

    // Corrupt line 3 fails closed with line index
    fs.appendFileSync(path.join(dir, 'docs/AUDIT_CHAIN.jsonl'), '{corrupt-json\n', 'utf8');
    const broken = verifyAuditChain(dir);
    assert.equal(broken.valid, false);
    assert.equal(broken.errorIndex, 2);

    // Corrupt gate cache degrades to null; corrupt session throws SESSION_CORRUPT
    fs.mkdirSync(path.join(dir, '.agent/.cache'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.agent/.cache/gate-cache.json'), '{bad', 'utf8');
    assert.equal(readGateCache(dir, 'root', 'hash1'), null);
    writeGateCache(dir, 'root', 'hash1', { passed: true });
    assert.equal(readGateCache(dir, 'root', 'hash1')?.passed, true);

    fs.writeFileSync(path.join(dir, '.agent/.sdlc-session.json'), '{not-valid-json', 'utf8');
    assert.throws(() => writeActiveSession(dir, (s) => s), (err) => err?.code === 'SESSION_CORRUPT');
    assert.throws(() => readActiveSession(dir), (err) => err?.code === 'SESSION_CORRUPT');

    // Committed .env containing SDLC_RECEIPT_KEY fails closed with RECEIPT_KEY_UNUSABLE
    const envCommitRepo = createTempGitRepo();
    cleanups.push(envCommitRepo.cleanup);
    withoutReceiptEnv(() => {
      fs.writeFileSync(path.join(envCommitRepo.dir, '.env'), 'SDLC_RECEIPT_KEY=committed-secret\n', 'utf8');
      git(envCommitRepo.dir, 'add', '-f', '.env');
      git(envCommitRepo.dir, 'commit', '-q', '-m', 'bad: commit .env');
      assert.throws(() => loadReceiptKey(envCommitRepo.dir), (err) => err?.code === 'RECEIPT_KEY_UNUSABLE');
      assert.equal(inspectReceiptKeyStatus(envCommitRepo.dir).usable, false);
    });

    // Non-git folder marks computeTreeHash as cacheable: false
    const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-nongit-'));
    cleanups.push(() => fs.rmSync(nonGit, { recursive: true, force: true }));
    const th = computeTreeHash({ repoRoot: nonGit, modulePath: '.' });
    assert.equal(th.cacheable, false);
  });

  it('verifies exact HEAD, post-receipt AUDIT_CHAIN commit, squash treeSha match, and 2-parent PR merge while rejecting evil merges and dirty trees', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    withoutReceiptEnv(() => {
      git(dir, 'checkout', '-q', '-b', 'feat/merge-modes', 'develop');
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src/feature.mjs'), 'export const f = 1;\n', 'utf8');
      git(dir, 'add', 'src/feature.mjs');
      git(dir, 'commit', '-q', '-m', 'feat: add feature');
      const codeSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();
      seedPassingSession(dir, 'feat/merge-modes', codeSha, 'code');

      // Dirty working tree refuses receipt issuance
      fs.writeFileSync(path.join(dir, 'src/uncommitted.mjs'), 'export const bad = 1;\n', 'utf8');
      const dirtyAttempt = issueGateReceipt({ repoRoot: dir });
      assert.equal(dirtyAttempt.success, false);
      assert.match(dirtyAttempt.reason, /dirty|uncommitted/i);
      fs.unlinkSync(path.join(dir, 'src/uncommitted.mjs'));

      // Clean tree signs receipt and commits docs/AUDIT_CHAIN.jsonl
      const signed = issueGateReceipt({ repoRoot: dir });
      assert.equal(signed.success, true);
      assert.equal(readActiveSession(dir)?.issueId, '42');
      git(dir, 'add', 'docs/AUDIT_CHAIN.jsonl');
      git(dir, 'commit', '-q', '-m', 'chore: record receipt');
      const receiptCommitSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();

      // 1. Exact codeSha and post-receipt AUDIT_CHAIN commit both verify
      assert.equal(verifyGateReceipt({ headSha: codeSha, branch: 'feat/merge-modes', repoRoot: dir }).valid, true);
      assert.equal(verifyGateReceipt({ headSha: receiptCommitSha, branch: 'feat/merge-modes', repoRoot: dir }).valid, true);
      assert.equal(verifyGateReceipt({ headSha: 'abc12', repoRoot: dir }).valid, false);

      // 2. Advance develop independently with another file, then do a 2-parent --no-ff PR merge
      git(dir, 'checkout', '-q', 'develop');
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src/other.mjs'), 'export const other = true;\n', 'utf8');
      git(dir, 'add', 'src/other.mjs');
      git(dir, 'commit', '-q', '-m', 'feat: earlier PR on develop');

      assert.equal(git(dir, 'merge', '--no-ff', '-q', '-m', 'Merge PR #42', 'feat/merge-modes').status, 0);
      const mergeSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();
      assert.equal(verifyGateReceipt({ headSha: mergeSha, branch: 'develop', repoRoot: dir }).valid, true);

      // 3. Evil merge injecting unreviewed code OR reverting p1 (develop) changes OR unverified p1 on feature branch is rejected
      git(dir, 'reset', '--hard', 'HEAD~1');
      git(dir, 'merge', '--no-ff', '--no-commit', 'feat/merge-modes');
      fs.writeFileSync(path.join(dir, 'src/evil.mjs'), 'export const backdoor = true;\n', 'utf8');
      git(dir, 'add', 'src/evil.mjs');
      git(dir, 'commit', '-q', '-m', 'Evil merge PR #42');
      const evilMergeSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();
      assert.equal(verifyGateReceipt({ headSha: evilMergeSha, branch: 'develop', repoRoot: dir }).valid, false);

      // Evil merge deleting develop-added src/other.mjs is ALSO rejected
      git(dir, 'reset', '--hard', 'HEAD~1');
      git(dir, 'merge', '--no-ff', '--no-commit', 'feat/merge-modes');
      git(dir, 'rm', '-f', '-q', 'src/other.mjs');
      git(dir, 'commit', '-q', '-m', 'Evil revert of develop file');
      const evilDeleteSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();
      assert.equal(verifyGateReceipt({ headSha: evilDeleteSha, branch: 'develop', repoRoot: dir }).valid, false);

      // Unresolved flag-like --sha is rejected without git option injection
      assert.equal(verifyGateReceipt({ headSha: '--output=/tmp/pwn', repoRoot: dir }).valid, false);

      // Clean 2-hop --no-ff merge (feat -> develop -> main) verifies on main!
      git(dir, 'reset', '--hard', 'HEAD~1');
      assert.equal(git(dir, 'merge', '--no-ff', '-q', '-m', 'Clean merge PR #42', 'feat/merge-modes').status, 0);
      git(dir, 'checkout', '-q', 'main');
      fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'docs/hotfix-note.md'), '# Note\n', 'utf8');
      git(dir, 'add', 'docs/hotfix-note.md');
      git(dir, 'commit', '-q', '-m', 'docs: main note');
      assert.equal(git(dir, 'merge', '--no-ff', '-q', '-m', 'Release develop to main', 'develop').status, 0);
      const releaseMainSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();
      assert.equal(verifyGateReceipt({ headSha: releaseMainSha, branch: 'main', repoRoot: dir }).valid, true);

      // Stale specHash on session is rejected by issueGateReceipt
      git(dir, 'checkout', '-q', 'feat/merge-modes');
      writeActiveSession(dir, (s) => {
        s.sessions['42'].lastGate.headSha = receiptCommitSha;
        s.sessions['42'].peerReview.headSha = receiptCommitSha;
        s.sessions['42'].lastGate.specHash = 'stale-spec-hash-mismatch';
        return s;
      });
      assert.equal(issueGateReceipt({ repoRoot: dir }).success, false);

      // 4. Squash merge onto unchanged base (treeSha match) verifies cleanly
      const sqRepo = createTempGitRepo();
      cleanups.push(sqRepo.cleanup);
      git(sqRepo.dir, 'checkout', '-q', '-b', 'feat/sq', 'develop');
      fs.writeFileSync(path.join(sqRepo.dir, 'a.mjs'), 'export const a = 1;\n', 'utf8');
      git(sqRepo.dir, 'add', 'a.mjs');
      git(sqRepo.dir, 'commit', '-q', '-m', 'wip 1');
      fs.writeFileSync(path.join(sqRepo.dir, 'a.mjs'), 'export const a = 2;\n', 'utf8');
      git(sqRepo.dir, 'add', 'a.mjs');
      git(sqRepo.dir, 'commit', '-q', '-m', 'wip 2');
      const sqHead = git(sqRepo.dir, 'rev-parse', 'HEAD').stdout.trim();
      seedPassingSession(sqRepo.dir, 'feat/sq', sqHead, 'code');
      assert.equal(issueGateReceipt({ repoRoot: sqRepo.dir }).success, true);
      git(sqRepo.dir, 'add', 'docs/AUDIT_CHAIN.jsonl');
      git(sqRepo.dir, 'commit', '-q', '-m', 'chore: receipt');

      git(sqRepo.dir, 'checkout', '-q', 'develop');
      git(sqRepo.dir, 'merge', '--squash', 'feat/sq');
      git(sqRepo.dir, 'commit', '-q', '-m', 'feat: squashed PR');
      const squashedSha = git(sqRepo.dir, 'rev-parse', 'HEAD').stdout.trim();
      assert.equal(verifyGateReceipt({ headSha: squashedSha, branch: 'develop', repoRoot: sqRepo.dir }).valid, true);
    });
  });
});
