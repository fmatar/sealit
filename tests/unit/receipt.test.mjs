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
  calculateRecordHash,
  signReceiptPayload,
  signReceiptSsh,
  verifyReceiptSignature,
  verifyAuditChainContent,
  readSessionStore,
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
  it('trims SEALIT_RECEIPT_KEY (and legacy SDLC_RECEIPT_KEY fallback) identically across process.env, .env, and .agent/.receipt-key', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    withoutReceiptEnv(() => {
      fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
      fs.writeFileSync(path.join(dir, RECEIPT_KEY_FILE), 'my-secret-key\n', { mode: 0o600 });
      const fromFile = loadReceiptKey(dir);

      fs.writeFileSync(path.join(dir, '.env'), 'SEALIT_RECEIPT_KEY=my-secret-key\r\n', 'utf8');
      const fromDotEnv = loadReceiptKey(dir);

      fs.writeFileSync(path.join(dir, '.env'), 'SDLC_RECEIPT_KEY=my-secret-key\r\n', 'utf8');
      const fromLegacyDotEnv = loadReceiptKey(dir);

      process.env.SEALIT_RECEIPT_KEY = '  my-secret-key\r\n';
      const fromEnv = loadReceiptKey(dir);
      delete process.env.SEALIT_RECEIPT_KEY;

      process.env.SDLC_RECEIPT_KEY = '  my-secret-key\r\n';
      const fromLegacyEnv = loadReceiptKey(dir);
      delete process.env.SDLC_RECEIPT_KEY;

      assert.deepEqual(fromFile, Buffer.from('my-secret-key', 'utf8'));
      assert.deepEqual(fromDotEnv, fromFile);
      assert.deepEqual(fromLegacyDotEnv, fromFile);
      assert.deepEqual(fromEnv, fromFile);
      assert.deepEqual(fromLegacyEnv, fromFile);

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

    fs.writeFileSync(path.join(dir, '.agent/.sealit-session.json'), '{not-valid-json', 'utf8');
    assert.throws(() => writeActiveSession(dir, (s) => s), (err) => err?.code === 'SESSION_CORRUPT');
    assert.throws(() => readActiveSession(dir), (err) => err?.code === 'SESSION_CORRUPT');

    // Committed .env containing SEALIT_RECEIPT_KEY fails closed with RECEIPT_KEY_UNUSABLE
    const envCommitRepo = createTempGitRepo();
    cleanups.push(envCommitRepo.cleanup);
    withoutReceiptEnv(() => {
      fs.writeFileSync(path.join(envCommitRepo.dir, '.env'), 'SEALIT_RECEIPT_KEY=committed-secret\n', 'utf8');
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

      // 5. Squash merge into develop followed by clean 2-parent --no-ff promotion into main verifies cleanly (and rejects tampered merges)
      git(sqRepo.dir, 'checkout', '-q', 'main');
      fs.writeFileSync(path.join(sqRepo.dir, 'README.md'), '# Main note\n', 'utf8');
      git(sqRepo.dir, 'add', 'README.md');
      git(sqRepo.dir, 'commit', '-q', '-m', 'docs: main readme');
      assert.equal(git(sqRepo.dir, 'merge', '--no-ff', '-q', '-m', 'chore(release): promote squashed develop to main', 'develop').status, 0);
      const sqMainMergeSha = git(sqRepo.dir, 'rev-parse', 'HEAD').stdout.trim();
      assert.equal(verifyGateReceipt({ headSha: sqMainMergeSha, branch: 'main', repoRoot: sqRepo.dir }).valid, true);

      git(sqRepo.dir, 'reset', '--hard', 'HEAD~1');
      git(sqRepo.dir, 'merge', '--no-ff', '--no-commit', 'develop');
      fs.writeFileSync(path.join(sqRepo.dir, 'a.mjs'), 'export const a = 999;\n', 'utf8');
      git(sqRepo.dir, 'add', 'a.mjs');
      git(sqRepo.dir, 'commit', '-q', '-m', 'evil: tamper during merge to main');
      const tamperedSqMainSha = git(sqRepo.dir, 'rev-parse', 'HEAD').stdout.trim();
      assert.equal(verifyGateReceipt({ headSha: tamperedSqMainSha, branch: 'main', repoRoot: sqRepo.dir }).valid, false);

      // Evil 2-parent p2 on develop that deletes a post-branch develop file to match feat/sq treeSha is rejected via !p2MultiParent
      git(sqRepo.dir, 'reset', '--hard', 'HEAD~1');
      git(sqRepo.dir, 'checkout', '-q', 'develop');
      git(sqRepo.dir, 'reset', '--hard', 'HEAD~1');
      fs.writeFileSync(path.join(sqRepo.dir, 'dev-only.mjs'), 'export const d = 1;\n', 'utf8');
      git(sqRepo.dir, 'add', 'dev-only.mjs');
      git(sqRepo.dir, 'commit', '-q', '-m', 'feat: concurrent develop file');
      git(sqRepo.dir, 'merge', '--no-ff', '--no-commit', 'feat/sq');
      git(sqRepo.dir, 'rm', '-f', '-q', 'dev-only.mjs');
      git(sqRepo.dir, 'commit', '-q', '-m', 'evil: 2-parent develop merge matching feat/sq treeSha');
      git(sqRepo.dir, 'checkout', '-q', 'main');
      git(sqRepo.dir, 'merge', '--no-ff', '-q', '-m', 'promote evil 2-parent develop to main', 'develop');
      const evilP2MainSha = git(sqRepo.dir, 'rev-parse', 'HEAD').stdout.trim();
      assert.equal(verifyGateReceipt({ headSha: evilP2MainSha, branch: 'main', repoRoot: sqRepo.dir }).valid, false);

      // R1: Evil 1-parent squash on develop dropping concurrent dev-only.mjs is ALSO rejected
      git(sqRepo.dir, 'reset', '--hard', 'HEAD~1');
      git(sqRepo.dir, 'checkout', '-q', 'develop');
      git(sqRepo.dir, 'reset', '--hard', 'HEAD~1');
      git(sqRepo.dir, 'merge', '--squash', 'feat/sq');
      git(sqRepo.dir, 'rm', '-f', '-q', 'dev-only.mjs');
      git(sqRepo.dir, 'commit', '-q', '-m', 'evil: 1-parent squash dropping dev-only.mjs');
      git(sqRepo.dir, 'checkout', '-q', 'main');
      git(sqRepo.dir, 'merge', '--no-ff', '-q', '-m', 'promote evil 1-parent squash to main', 'develop');
      const evil1ParentSqMainSha = git(sqRepo.dir, 'rev-parse', 'HEAD').stdout.trim();
      assert.equal(verifyGateReceipt({ headSha: evil1ParentSqMainSha, branch: 'main', repoRoot: sqRepo.dir }).valid, false);

      // R2 & R3 & R4: Replay of already-merged squash receipt, unprotected feature-branch p2, and p2 audit-record stripping are all rejected
      const secSqRepo = createTempGitRepo();
      cleanups.push(secSqRepo.cleanup);
      git(secSqRepo.dir, 'checkout', '-q', '-b', 'feat/sq1', 'develop');
      fs.writeFileSync(path.join(secSqRepo.dir, 'x.mjs'), 'export const x = 1;\n', 'utf8');
      git(secSqRepo.dir, 'add', 'x.mjs');
      git(secSqRepo.dir, 'commit', '-q', '-m', 'feat: x');
      const sq1Head = git(secSqRepo.dir, 'rev-parse', 'HEAD').stdout.trim();
      seedPassingSession(secSqRepo.dir, 'feat/sq1', sq1Head, 'code');
      appendAuditRecord({ event: 'INTERMEDIATE_DEV_NOTE', metadata: { step: 'mid' }, repoRoot: secSqRepo.dir });
      assert.equal(issueGateReceipt({ repoRoot: secSqRepo.dir }).success, true);
      git(secSqRepo.dir, 'add', 'docs/AUDIT_CHAIN.jsonl');
      git(secSqRepo.dir, 'commit', '-q', '-m', 'chore: sq1 receipt');

      // R3: 2-parent merge on an unmerged branch (p1 = develop, p2 = 1-parent squash outside protected history) rejected even without --branch
      git(secSqRepo.dir, 'checkout', '-q', '-b', 'feat/unprotected-p2', 'develop');
      git(secSqRepo.dir, 'merge', '--squash', 'feat/sq1');
      git(secSqRepo.dir, 'commit', '-q', '-m', 'unprotected squash');
      git(secSqRepo.dir, 'checkout', '-q', '-b', 'feat/fake-2p', 'develop');
      git(secSqRepo.dir, 'merge', '--no-ff', '-q', '-m', 'fake 2-parent on feature branch', 'feat/unprotected-p2');
      const fake2pSha = git(secSqRepo.dir, 'rev-parse', 'HEAD').stdout.trim();
      assert.equal(verifyGateReceipt({ headSha: fake2pSha, repoRoot: secSqRepo.dir }).valid, false);

      // Valid squash onto develop -> R4: stripping INTERMEDIATE_DEV_NOTE during --no-ff merge to main is rejected
      git(secSqRepo.dir, 'checkout', '-q', 'develop');
      git(secSqRepo.dir, 'merge', '--squash', 'feat/sq1');
      git(secSqRepo.dir, 'commit', '-q', '-m', 'feat: valid sq1 on develop');
      git(secSqRepo.dir, 'checkout', '-q', 'main');
      fs.writeFileSync(path.join(secSqRepo.dir, 'README.md'), '# Main\n', 'utf8');
      git(secSqRepo.dir, 'add', 'README.md');
      git(secSqRepo.dir, 'commit', '-q', '-m', 'docs: main');
      git(secSqRepo.dir, 'merge', '--no-ff', '--no-commit', 'develop');
      const fullChainLines = fs.readFileSync(path.join(secSqRepo.dir, 'docs/AUDIT_CHAIN.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      const onlyLastReceipt = { ...fullChainLines[fullChainLines.length - 1], index: 0, previousHash: '0'.repeat(64) };
      onlyLastReceipt.currentHash = calculateRecordHash(onlyLastReceipt);
      fs.writeFileSync(path.join(secSqRepo.dir, 'docs/AUDIT_CHAIN.jsonl'), `${JSON.stringify(onlyLastReceipt)}\n`, 'utf8');
      git(secSqRepo.dir, 'add', 'docs/AUDIT_CHAIN.jsonl');
      git(secSqRepo.dir, 'commit', '-q', '-m', 'evil: strip intermediate p2 audit record');
      const strippedMainSha = git(secSqRepo.dir, 'rev-parse', 'HEAD').stdout.trim();
      assert.equal(verifyGateReceipt({ headSha: strippedMainSha, branch: 'main', repoRoot: secSqRepo.dir }).valid, false);

      // Clean promote to main succeeds -> R2: replaying already-merged sq1 treeSha to delete a new file on develop/main is rejected!
      git(secSqRepo.dir, 'reset', '--hard', 'HEAD~1');
      git(secSqRepo.dir, 'merge', '--no-ff', '-q', '-m', 'chore(release): clean promote sq1', 'develop');
      const cleanMain1 = git(secSqRepo.dir, 'rev-parse', 'HEAD').stdout.trim();
      assert.equal(verifyGateReceipt({ headSha: cleanMain1, branch: 'main', repoRoot: secSqRepo.dir }).valid, true);

      git(secSqRepo.dir, 'checkout', '-q', '-b', 'feat/sq2', 'develop');
      fs.writeFileSync(path.join(secSqRepo.dir, 'y.mjs'), 'export const y = 2;\n', 'utf8');
      git(secSqRepo.dir, 'add', 'y.mjs');
      git(secSqRepo.dir, 'commit', '-q', '-m', 'feat: y');
      const sq2Head = git(secSqRepo.dir, 'rev-parse', 'HEAD').stdout.trim();
      seedPassingSession(secSqRepo.dir, 'feat/sq2', sq2Head, 'code');
      assert.equal(issueGateReceipt({ repoRoot: secSqRepo.dir }).success, true);
      git(secSqRepo.dir, 'add', 'docs/AUDIT_CHAIN.jsonl');
      git(secSqRepo.dir, 'commit', '-q', '-m', 'chore: sq2 receipt');
      git(secSqRepo.dir, 'checkout', '-q', 'develop');
      git(secSqRepo.dir, 'merge', '--squash', 'feat/sq2');
      git(secSqRepo.dir, 'commit', '-q', '-m', 'feat: sq2 on develop');
      git(secSqRepo.dir, 'checkout', '-q', 'main');
      git(secSqRepo.dir, 'merge', '--no-ff', '-q', '-m', 'chore(release): promote sq2', 'develop');

      // Keyless attacker on develop deletes y.mjs (restoring sq1's exact treeSha!) and --no-ff merges into main
      git(secSqRepo.dir, 'checkout', '-q', 'develop');
      git(secSqRepo.dir, 'rm', '-f', '-q', 'y.mjs');
      git(secSqRepo.dir, 'commit', '-q', '-m', 'evil: keyless replay of sq1 treeSha deleting y.mjs');
      git(secSqRepo.dir, 'checkout', '-q', 'main');
      git(secSqRepo.dir, 'merge', '--no-ff', '-q', '-m', 'evil: merge replayed sq1 tree to main', 'develop');
      const replayedMainSha = git(secSqRepo.dir, 'rev-parse', 'HEAD').stdout.trim();
      assert.equal(verifyGateReceipt({ headSha: replayedMainSha, branch: 'main', repoRoot: secSqRepo.dir }).valid, false);
    });
  });

  it('enforces HMAC tamper detection, branch binding, stale lastGate/peerReview HEAD checks, threshold floors, coverage:null support, and base-ledger continuity', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    withoutReceiptEnv(() => {
      // Seed baseline develop with 2 audit records so truncation/rewrite attacks are caught
      appendAuditRecord({ event: 'BASELINE_1', metadata: { n: 1 }, repoRoot: dir });
      appendAuditRecord({ event: 'BASELINE_2', metadata: { n: 2 }, repoRoot: dir });
      fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.agent/sealit-config.json'),
        JSON.stringify({
          version: '0.1.0',
          modules: [{ name: 'root', path: '.', commands: { coverage: 'npm run cov', mutation: './node_modules/.bin/stryker run' }, thresholds: { diffCoverage: 85, mutationScore: 60 } }]
        }),
        'utf8'
      );
      git(dir, 'add', 'docs/AUDIT_CHAIN.jsonl', '.agent/sealit-config.json');
      git(dir, 'commit', '-q', '-m', 'chore: baseline ledger and config on develop');
      git(dir, 'branch', '-f', 'main', 'HEAD');

      git(dir, 'checkout', '-q', '-b', 'feat/sec-props', 'develop');
      fs.writeFileSync(path.join(dir, 'app.mjs'), 'export const k = 1;\n', 'utf8');
      git(dir, 'add', 'app.mjs');
      git(dir, 'commit', '-q', '-m', 'feat: app');
      const sha1 = git(dir, 'rev-parse', 'HEAD').stdout.trim();
      seedPassingSession(dir, 'feat/sec-props', sha1, 'code');

      // 1. Below-threshold coverage and mutation in lastGate are refused
      writeActiveSession(dir, (s) => { s.sessions['42'].lastGate.diffCoveragePct = 50; return s; });
      assert.match(issueGateReceipt({ repoRoot: dir }).reason, /diff coverage/i);
      writeActiveSession(dir, (s) => { s.sessions['42'].lastGate.diffCoveragePct = 95; s.sessions['42'].lastGate.mutationPct = 40; return s; });
      assert.match(issueGateReceipt({ repoRoot: dir }).reason, /mutation score/i);
      writeActiveSession(dir, (s) => { s.sessions['42'].lastGate.mutationPct = 66; return s; });

      // 2. Stale lastGate.headSha, stale lastGate.treeSha (S1), and mismatched peerReview.headSha are refused
      fs.writeFileSync(path.join(dir, 'app.mjs'), 'export const k = 2;\n', 'utf8');
      git(dir, 'add', 'app.mjs');
      git(dir, 'commit', '-q', '-m', 'feat: post-gate edit');
      const sha2 = git(dir, 'rev-parse', 'HEAD').stdout.trim();
      assert.match(issueGateReceipt({ repoRoot: dir }).reason, /lastGate measurement/i);

      writeActiveSession(dir, (s) => { s.sessions['42'].lastGate.headSha = sha2; return s; });
      assert.match(issueGateReceipt({ repoRoot: dir }).reason, /treeSha/i);

      writeActiveSession(dir, (s) => { s.sessions['42'].lastGate.treeSha = computeContentTreeSha(sha2, dir); return s; });
      assert.match(issueGateReceipt({ repoRoot: dir }).reason, /peer review was recorded for/i);

      // 3. Valid receipt signs -> wrong branch rejected -> forged HMAC (even with recalculated SHA-256 chain hash) rejected
      writeActiveSession(dir, (s) => { s.sessions['42'].peerReview.headSha = sha2; return s; });
      const issued = issueGateReceipt({ repoRoot: dir });
      assert.equal(issued.success, true);
      assert.equal(verifyGateReceipt({ headSha: sha2, branch: 'feat/other-branch', repoRoot: dir }).valid, false);

      // Tamper with receipt metadata: without recalculating currentHash -> chain invalid; WITH recalculated currentHash -> chain valid, HMAC INVALID!
      const ledgerPath = path.join(dir, 'docs/AUDIT_CHAIN.jsonl');
      const origLedger = fs.readFileSync(ledgerPath, 'utf8');
      const lines = origLedger.trim().split('\n').map((l) => JSON.parse(l));
      lines[lines.length - 1].metadata.reviewer = '@attacker';
      fs.writeFileSync(ledgerPath, lines.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
      assert.equal(verifyAuditChain(dir).valid, false);
      const last = lines[lines.length - 1];
      last.currentHash = calculateRecordHash(last);
      fs.writeFileSync(ledgerPath, lines.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
      assert.equal(verifyAuditChain(dir).valid, true);
      assert.equal(verifyGateReceipt({ headSha: sha2, branch: 'feat/sec-props', repoRoot: dir }).valid, false);
      fs.writeFileSync(ledgerPath, origLedger, 'utf8');

      // 4. Truncating historical develop audit records and issuing a fresh index:0 receipt is rejected by verifyGateReceipt!
      fs.unlinkSync(ledgerPath);
      const truncIssued = issueGateReceipt({ repoRoot: dir });
      assert.equal(truncIssued.success, true);
      git(dir, 'add', 'docs/AUDIT_CHAIN.jsonl');
      git(dir, 'commit', '-q', '-m', 'evil: truncate audit chain');
      const truncSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();
      const truncVer = verifyGateReceipt({ headSha: truncSha, branch: 'feat/sec-props', repoRoot: dir });
      assert.equal(truncVer.valid, false);
      assert.match(truncVer.reason, /truncat|continuity|historical/i);

      // 5. Generic module with commands.coverage: null and diffCoverage: null issues receipt; lowering floor in PR is rejected by loadEffectivePolicy
      const genRepo = createTempGitRepo();
      cleanups.push(genRepo.cleanup);
      git(genRepo.dir, 'checkout', '-q', '-b', 'feat/gen', 'develop');
      fs.mkdirSync(path.join(genRepo.dir, '.agent'), { recursive: true });
      fs.writeFileSync(
        path.join(genRepo.dir, '.agent/sealit-config.json'),
        JSON.stringify({
          version: '0.1.0',
          modules: [{ name: 'root', path: '.', commands: { coverage: null, mutation: null }, thresholds: { diffCoverage: null, mutationScore: null } }]
        }),
        'utf8'
      );
      git(genRepo.dir, 'add', '.agent/sealit-config.json');
      git(genRepo.dir, 'commit', '-q', '-m', 'feat: generic config');
      const genSha = git(genRepo.dir, 'rev-parse', 'HEAD').stdout.trim();
      seedPassingSession(genRepo.dir, 'feat/gen', genSha, 'code');
      writeActiveSession(genRepo.dir, (s) => {
        s.sessions['42'].lastGate.diffCoveragePct = null;
        s.sessions['42'].lastGate.mutationPct = null;
        return s;
      });
      assert.equal(issueGateReceipt({ repoRoot: genRepo.dir }).success, true);

      // PR lowering diffCoverage from 85 on base to null/10 at head still enforces base floor 85 in issueGateReceipt
      const monoRecRepo = createTempGitRepo();
      cleanups.push(monoRecRepo.cleanup);
      fs.mkdirSync(path.join(monoRecRepo.dir, '.agent'), { recursive: true });
      fs.writeFileSync(
        path.join(monoRecRepo.dir, '.agent/sealit-config.json'),
        JSON.stringify({
          version: '0.1.0',
          modules: [{ name: 'root', path: '.', commands: { coverage: 'npm run cov', mutation: null }, thresholds: { diffCoverage: 85, mutationScore: null } }]
        }),
        'utf8'
      );
      git(monoRecRepo.dir, 'add', '.agent/sealit-config.json');
      git(monoRecRepo.dir, 'commit', '-q', '-m', 'chore: base cov 85');
      git(monoRecRepo.dir, 'checkout', '-q', '-b', 'feat/lower-floor', 'develop');
      fs.writeFileSync(
        path.join(monoRecRepo.dir, '.agent/sealit-config.json'),
        JSON.stringify({
          version: '0.1.0',
          modules: [{ name: 'root', path: '.', commands: { coverage: null, mutation: null }, thresholds: { diffCoverage: null, mutationScore: null } }]
        }),
        'utf8'
      );
      git(monoRecRepo.dir, 'add', '.agent/sealit-config.json');
      git(monoRecRepo.dir, 'commit', '-q', '-m', 'evil: drop coverage floor');
      const lowerSha = git(monoRecRepo.dir, 'rev-parse', 'HEAD').stdout.trim();
      seedPassingSession(monoRecRepo.dir, 'feat/lower-floor', lowerSha, 'code');
      writeActiveSession(monoRecRepo.dir, (s) => {
        s.sessions['42'].lastGate.diffCoveragePct = 50;
        return s;
      });
      const floorRefused = issueGateReceipt({ repoRoot: monoRecRepo.dir });
      assert.equal(floorRefused.success, false);
      assert.match(floorRefused.reason, /below threshold 85%/);

      // 6. computeTreeHash honors explicit baseBranch and marks dirty working trees cacheable: false
      const hDev = computeTreeHash({ repoRoot: genRepo.dir, modulePath: '.', baseBranch: 'develop' });
      git(genRepo.dir, 'branch', 'other-base', genSha);
      const hOther = computeTreeHash({ repoRoot: genRepo.dir, modulePath: '.', baseBranch: 'other-base' });
      assert.notEqual(hDev.hash, hOther.hash);
      fs.writeFileSync(path.join(genRepo.dir, 'dirty-cache.txt'), 'dirty\n', 'utf8');
      assert.equal(computeTreeHash({ repoRoot: genRepo.dir, modulePath: '.' }).cacheable, false);
      fs.unlinkSync(path.join(genRepo.dir, 'dirty-cache.txt'));
      fs.mkdirSync(path.join(genRepo.dir, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(genRepo.dir, 'docs/AUDIT_CHAIN.jsonl'), '{"pending":1}\n', 'utf8');
      assert.equal(computeTreeHash({ repoRoot: genRepo.dir, modulePath: '.', checkType: 'gate' }).cacheable, true);
      assert.notEqual(
        computeTreeHash({ repoRoot: genRepo.dir, modulePath: '.', checkType: 'gate' }).hash,
        computeTreeHash({ repoRoot: genRepo.dir, modulePath: 'packages/a', checkType: 'cov' }).hash
      );
      const unbornDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-unborn-hash-'));
      cleanups.push(() => fs.rmSync(unbornDir, { recursive: true, force: true }));
      git(unbornDir, 'init', '-q');
      assert.equal(computeTreeHash({ repoRoot: unbornDir, modulePath: '.' }).cacheable, false);
    });
  });

  it('covers inspectReceiptKeyStatus states, canonicalJSON arrays, chain index/prevHash errors, legacy session store, docs-only receipts, and short-SHA/branch lookup', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    withoutReceiptEnv(() => {
      // No key present -> source: 'none', verifyGateReceipt fails closed
      assert.equal(inspectReceiptKeyStatus(dir).source, 'none');
      assert.equal(verifyGateReceipt({ repoRoot: dir }).valid, false);

      // Env key -> source: 'env'
      process.env.SEALIT_RECEIPT_KEY = 'env-key-val';
      assert.equal(inspectReceiptKeyStatus(dir).source, 'env');
      delete process.env.SEALIT_RECEIPT_KEY;

      // canonicalJSON array signing & verifyReceiptSignature edge cases
      const key = Buffer.from('test-hmac-key', 'utf8');
      const arrPayload = { items: [1, undefined, { b: 2, a: 1 }] };
      const sigVal = signReceiptPayload(arrPayload, key);
      assert.equal(verifyReceiptSignature({ ...arrPayload, signature: { alg: 'HMAC-SHA256', value: sigVal } }, key), true);
      assert.equal(verifyReceiptSignature({ ...arrPayload, signature: { alg: 'NONE', value: sigVal } }, key), false);
      assert.equal(verifyReceiptSignature({ ...arrPayload, signature: { alg: 'HMAC-SHA256', value: 'not-hex' } }, key), false);
      assert.equal(verifyReceiptSignature(null, key), false);

      // verifyAuditChainContent index mismatch and previousHash mismatch
      assert.equal(verifyAuditChainContent('').valid, true);
      assert.match(verifyAuditChainContent(JSON.stringify({ index: 3, previousHash: '0'.repeat(64) })).error, /Index mismatch/);
      assert.match(verifyAuditChainContent(JSON.stringify({ index: 0, previousHash: 'f'.repeat(64) })).error, /previousHash mismatch/);

      // Legacy flat session store format ({ issueId, branch })
      fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.agent/.sealit-session.json'), JSON.stringify({ issueId: '#15', branch: 'develop', active: true }), 'utf8');
      const legacyStore = readSessionStore(dir);
      assert.equal(legacyStore.activeSessionId, '15');
      assert.equal(readActiveSession(dir, 'develop')?.issueId, '#15');

      // Guard branches inside issueGateReceipt (no session, missing lastGate, --docs-only on code diff, missing peerReview, valid docs-only receipt)
      git(dir, 'checkout', '-q', '-b', 'feat/no-sess', 'develop');
      assert.match(issueGateReceipt({ repoRoot: dir }).reason, /no active session/i);

      writeActiveSession(dir, (s) => {
        s.activeSessionId = '88';
        s.sessions['88'] = { issueId: '88', branch: 'feat/no-sess', baseBranch: 'develop', lastGate: null, peerReview: null };
        return s;
      });
      fs.writeFileSync(path.join(dir, 'code.mjs'), 'export const c = 1;\n', 'utf8');
      git(dir, 'add', 'code.mjs');
      git(dir, 'commit', '-q', '-m', 'feat: code');
      assert.match(issueGateReceipt({ repoRoot: dir, docsOnly: true }).reason, /Refusing --docs-only/);
      assert.match(issueGateReceipt({ repoRoot: dir }).reason, /no passing sealit gate/i);

      const codeHead = git(dir, 'rev-parse', 'HEAD').stdout.trim();
      seedPassingSession(dir, 'feat/no-sess', codeHead, 'code');
      writeActiveSession(dir, (s) => { s.sessions['42'].branch = 'feat/no-sess'; s.sessions['42'].peerReview = { verdict: 'request-changes', headSha: codeHead }; return s; });
      delete legacyStore.sessions['88'];
      writeActiveSession(dir, (s) => { delete s.sessions['88']; return s; });
      assert.match(issueGateReceipt({ repoRoot: dir }).reason, /approved peer review/i);

      // Docs-only branch signs receipt without peerReview, and verifies via 8-char short SHA and branch-only lookup
      const docRepo = createTempGitRepo();
      cleanups.push(docRepo.cleanup);
      git(docRepo.dir, 'checkout', '-q', '-b', 'docs/only', 'develop');
      fs.writeFileSync(path.join(docRepo.dir, 'README.md'), '# Docs edit\n', 'utf8');
      git(docRepo.dir, 'add', 'README.md');
      git(docRepo.dir, 'commit', '-q', '-m', 'docs: edit readme');
      const docSha = git(docRepo.dir, 'rev-parse', 'HEAD').stdout.trim();
      seedPassingSession(docRepo.dir, 'docs/only', docSha, 'docs-only');
      const docRec = issueGateReceipt({ repoRoot: docRepo.dir, docsOnly: true });
      assert.equal(docRec.success, true);
      assert.equal(verifyGateReceipt({ headSha: docSha.slice(0, 8), branch: 'docs/only', repoRoot: docRepo.dir }).valid, true);
      assert.equal(verifyGateReceipt({ headSha: 'deadbeef', repoRoot: docRepo.dir }).valid, false);
      assert.equal(verifyGateReceipt({ branch: 'docs/only', repoRoot: docRepo.dir }).valid, true);
      assert.equal(verifyGateReceipt({ repoRoot: docRepo.dir }).valid, true);
    });
  });

  it('appending to a ledger without a final newline keeps the chain valid', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);
    appendAuditRecord({ event: 'TEST_ONE', metadata: { n: 1 }, repoRoot: dir });
    appendAuditRecord({ event: 'TEST_TWO', metadata: { n: 2 }, repoRoot: dir });
    const ledger = path.join(dir, 'docs/AUDIT_CHAIN.jsonl');
    // Simulate an editor (or conflict resolution) stripping the trailing newline
    fs.writeFileSync(ledger, fs.readFileSync(ledger, 'utf8').replace(/\n+$/, ''), 'utf8');
    assert.equal(verifyAuditChain(dir).valid, true);

    appendAuditRecord({ event: 'TEST_THREE', metadata: { n: 3 }, repoRoot: dir });
    const after = verifyAuditChain(dir);
    assert.equal(after.valid, true, after.error);
    assert.equal(after.recordsCount, 3);
    assert.equal(fs.readFileSync(ledger, 'utf8').split(/\n/).filter(Boolean).length, 3);
  });

  it('loadReceiptKey({ create: true }) refuses symlinked .agent directory in commonRoot for linked worktrees', () => {
    const mainRepo = createTempGitRepo();
    cleanups.push(mainRepo.cleanup);
    const wtParent = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-wt-key-'));
    cleanups.push(() => fs.rmSync(wtParent, { recursive: true, force: true }));
    const wtDir = path.join(wtParent, 'wt');
    git(mainRepo.dir, 'worktree', 'add', '-q', '-b', 'feat/wt-key', wtDir, 'develop');

    const outsideAgent = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-outside-agent-'));
    cleanups.push(() => fs.rmSync(outsideAgent, { recursive: true, force: true }));
    fs.symlinkSync(outsideAgent, path.join(mainRepo.dir, '.agent'));

    withoutReceiptEnv(() => {
      assert.throws(() => loadReceiptKey(wtDir, { create: true }), /symlink/i);
      assert.equal(fs.existsSync(path.join(outsideAgent, '.receipt-key')), false);
    });
  });

  it('supports dual-mode native OpenSSH SSHSIG receipts against baseCommit:.agent/allowed_signers and blocks HMAC downgrade or PR-injected keys (S1)', async () => {
    const { execFileSync } = await import('node:child_process');
    const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sealit-ssh-keys-'));
    cleanups.push(() => fs.rmSync(keyDir, { recursive: true, force: true }));
    const aliceKey = path.join(keyDir, 'alice_ed25519');
    const evilKey = path.join(keyDir, 'evil_ed25519');
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', aliceKey]);
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', evilKey]);
    const alicePub = fs.readFileSync(`${aliceKey}.pub`, 'utf8').trim();
    const evilPub = fs.readFileSync(`${evilKey}.pub`, 'utf8').trim();

    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.agent/allowed_signers'), `@alice ${alicePub}\n`, 'utf8');
    fs.writeFileSync(
      path.join(dir, '.agent/sealit-config.json'),
      JSON.stringify({ version: '0.1.0', modules: [{ name: 'root', path: '.', commands: {}, thresholds: { diffCoverage: null, mutationScore: null } }] }),
      'utf8'
    );
    git(dir, 'add', '.agent/allowed_signers', '.agent/sealit-config.json');
    git(dir, 'commit', '-q', '-m', 'chore: trust @alice in allowed_signers');
    git(dir, 'branch', '-f', 'main', 'HEAD');

    git(dir, 'checkout', '-q', '-b', 'feat/sshsig', 'develop');
    fs.writeFileSync(path.join(dir, 'app.mjs'), 'export const signed = true;\n', 'utf8');
    git(dir, 'add', 'app.mjs');
    git(dir, 'commit', '-q', '-m', 'feat: sshsig change');
    const sha = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    seedPassingSession(dir, 'feat/sshsig', sha, 'code');

    const prevKeyEnv = process.env.SEALIT_SIGNING_KEY;
    withoutReceiptEnv(() => {
      try {
        // 1. Valid SSHSIG signing binds reviewer to verified principal @alice and verifies with ZERO HMAC key
        process.env.SEALIT_SIGNING_KEY = aliceKey;
        const issued = issueGateReceipt({ repoRoot: dir });
        assert.equal(issued.success, true, issued.reason);
        assert.equal(issued.receipt.signature.alg, 'SSHSIG');
        assert.equal(issued.receipt.signature.principal, '@alice');
        assert.equal(issued.receipt.reviewer, '@alice');

        git(dir, 'add', 'docs/AUDIT_CHAIN.jsonl');
        git(dir, 'commit', '-q', '-m', 'chore(audit): seal sshsig receipt');
        const sealedSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();
        const ver = verifyGateReceipt({ headSha: sealedSha, branch: 'feat/sshsig', repoRoot: dir });
        assert.equal(ver.valid, true, ver.reason);
        assert.equal(ver.receipt.signature.alg, 'SSHSIG');

        // 2. Tampering metadata (even with recalculated hash-chain and committed HEAD) invalidates SSHSIG verification
        const ledgerPath = path.join(dir, 'docs/AUDIT_CHAIN.jsonl');
        const origLedger = fs.readFileSync(ledgerPath, 'utf8');
        const recs = origLedger.trim().split('\n').map((l) => JSON.parse(l));
        recs[recs.length - 1].metadata.reviewer = '@spoofed';
        recs[recs.length - 1].currentHash = calculateRecordHash(recs[recs.length - 1]);
        fs.writeFileSync(ledgerPath, recs.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
        git(dir, 'add', 'docs/AUDIT_CHAIN.jsonl');
        git(dir, 'commit', '--amend', '-q', '--no-edit');
        const tamperedSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();
        assert.equal(verifyGateReceipt({ headSha: tamperedSha, branch: 'feat/sshsig', repoRoot: dir }).valid, false);

        // 3. HMAC downgrade attack is rejected when baseCommit defines .agent/allowed_signers
        process.env.SEALIT_RECEIPT_KEY = '0123456789abcdef0123456789abcdef';
        const hmacRecs = origLedger.trim().split('\n').map((l) => JSON.parse(l));
        const payload = { ...hmacRecs[hmacRecs.length - 1].metadata };
        delete payload.signature;
        hmacRecs[hmacRecs.length - 1].metadata = {
          ...payload,
          signature: { alg: 'HMAC-SHA256', keyId: 'deadbeef', value: signReceiptPayload(payload, Buffer.from(process.env.SEALIT_RECEIPT_KEY, 'utf8')) }
        };
        hmacRecs[hmacRecs.length - 1].currentHash = calculateRecordHash(hmacRecs[hmacRecs.length - 1]);
        fs.writeFileSync(ledgerPath, hmacRecs.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
        git(dir, 'add', 'docs/AUDIT_CHAIN.jsonl');
        git(dir, 'commit', '--amend', '-q', '--no-edit');
        const downgradedSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();
        const downgraded = verifyGateReceipt({ headSha: downgradedSha, branch: 'feat/sshsig', repoRoot: dir });
        assert.equal(downgraded.valid, false);
        delete process.env.SEALIT_RECEIPT_KEY;
        fs.writeFileSync(ledgerPath, origLedger, 'utf8');
        git(dir, 'add', 'docs/AUDIT_CHAIN.jsonl');
        git(dir, 'commit', '--amend', '-q', '--no-edit');

        // 4. PR-injected allowed_signers key attack is rejected by BOTH issueGateReceipt and verifyGateReceipt against baseTip:.agent/allowed_signers
        git(dir, 'checkout', '-q', '-b', 'feat/evil-signer', 'develop');
        fs.appendFileSync(path.join(dir, '.agent/allowed_signers'), `@evil ${evilPub}\n`, 'utf8');
        git(dir, 'add', '.agent/allowed_signers');
        git(dir, 'commit', '-q', '-m', 'evil: inject attacker key into PR allowed_signers');
        const evilSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();
        seedPassingSession(dir, 'feat/evil-signer', evilSha, 'code');
        process.env.SEALIT_SIGNING_KEY = evilKey;
        const evilIssued = issueGateReceipt({ repoRoot: dir });
        assert.equal(evilIssued.success, false, 'issueGateReceipt must refuse PR-injected key not present on baseTip');
        const evilPayload = {
          receiptId: `GATE-RECEIPT-#42-${evilSha.slice(0, 8)}`, version: '0.1.0', issueId: 42,
          branch: 'feat/evil-signer', headSha: evilSha, treeSha: computeContentTreeSha(evilSha, dir),
          mode: 'code', peerReviewApproved: true, reviewer: '@evil', driftPassed: true, driftCheckPassed: true, archPassed: true,
          issuedAt: new Date().toISOString()
        };
        const evilDirectSig = signReceiptSsh(evilPayload, evilKey, `@evil ${evilPub}\n`);
        appendAuditRecord({ event: 'STAGE_7_GATE_RECEIPT_SIGNED', metadata: { ...evilPayload, signature: evilDirectSig }, repoRoot: dir });
        git(dir, 'add', 'docs/AUDIT_CHAIN.jsonl');
        git(dir, 'commit', '-q', '-m', 'evil: commit attacker receipt');
        const evilSealed = git(dir, 'rev-parse', 'HEAD').stdout.trim();
        const evilVer = verifyGateReceipt({ headSha: evilSealed, branch: 'feat/evil-signer', repoRoot: dir });
        assert.equal(evilVer.valid, false, 'PR-injected key must be rejected against baseTip:.agent/allowed_signers');

        // 5. Historical ancestor & orphan-branch bootstrap bypass attempts on an existing SSHSIG repo are rejected against baseTip
        const preSshBaseSha = git(dir, 'rev-parse', 'develop~1').stdout.trim();
        git(dir, 'checkout', '-q', '-b', 'feat/old-ancestor-bypass', preSshBaseSha);
        fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.agent/allowed_signers'), `@evil ${evilPub}\n`, 'utf8');
        git(dir, 'add', '.agent/allowed_signers');
        git(dir, 'commit', '-q', '-m', 'evil: branch from pre-sshsig ancestor and inject allowed_signers');
        const oldBypassHead = git(dir, 'rev-parse', 'HEAD').stdout.trim();
        seedPassingSession(dir, 'feat/old-ancestor-bypass', oldBypassHead, 'code');
        process.env.SEALIT_SIGNING_KEY = evilKey;
        const oldIssued = issueGateReceipt({ repoRoot: dir });
        assert.equal(oldIssued.success, false, 'issueGateReceipt must anchor allowed_signers on baseTip, rejecting unauthorized key');

        // Also test direct verification of an attacker-forged SSHSIG receipt committed on that pre-sshsig ancestor branch
        const forgedPayload = {
          receiptId: `GATE-RECEIPT-#42-${oldBypassHead.slice(0, 8)}`, version: '0.1.0', issueId: 42,
          branch: 'feat/old-ancestor-bypass', headSha: oldBypassHead, treeSha: computeContentTreeSha(oldBypassHead, dir),
          mode: 'code', peerReviewApproved: true, reviewer: '@evil', driftPassed: true, driftCheckPassed: true, archPassed: true,
          issuedAt: new Date().toISOString()
        };
        const evilSig = signReceiptSsh(forgedPayload, evilKey, `@evil ${evilPub}\n`);
        appendAuditRecord({ event: 'STAGE_7_GATE_RECEIPT_SIGNED', metadata: { ...forgedPayload, signature: evilSig }, repoRoot: dir });
        git(dir, 'add', 'docs/AUDIT_CHAIN.jsonl');
        git(dir, 'commit', '-q', '-m', 'evil: commit historical-ancestor forged sshsig receipt');
        const forgedSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();
        assert.equal(verifyGateReceipt({ headSha: forgedSha, branch: 'feat/old-ancestor-bypass', repoRoot: dir }).valid, false);

        // 6. Existing HMAC-SHA256 repo opening a PR to adopt .agent/allowed_signers seals & verifies cleanly via HMAC-SHA256 (zero migration deadlock!)
        const migRepo = createTempGitRepo();
        cleanups.push(migRepo.cleanup);
        fs.mkdirSync(path.join(migRepo.dir, '.agent'), { recursive: true });
        fs.writeFileSync(
          path.join(migRepo.dir, '.agent/sealit-config.json'),
          JSON.stringify({ version: '0.1.0', modules: [{ name: 'root', path: '.', commands: {}, thresholds: { diffCoverage: null, mutationScore: null } }] }),
          'utf8'
        );
        git(migRepo.dir, 'add', '.agent/sealit-config.json');
        git(migRepo.dir, 'commit', '-q', '-m', 'chore: base hmac repo');
        git(migRepo.dir, 'branch', '-f', 'main', 'HEAD');
        git(migRepo.dir, 'checkout', '-q', '-b', 'feat/adopt-sshsig', 'develop');
        fs.writeFileSync(path.join(migRepo.dir, '.agent/allowed_signers'), `@alice ${alicePub}\n`, 'utf8');
        git(migRepo.dir, 'add', '.agent/allowed_signers');
        git(migRepo.dir, 'commit', '-q', '-m', 'chore: add allowed_signers');
        const migSha = git(migRepo.dir, 'rev-parse', 'HEAD').stdout.trim();
        seedPassingSession(migRepo.dir, 'feat/adopt-sshsig', migSha, 'code');
        process.env.SEALIT_RECEIPT_KEY = '0123456789abcdef0123456789abcdef';
        const migIssued = issueGateReceipt({ repoRoot: migRepo.dir });
        assert.equal(migIssued.success, true, migIssued.reason);
        assert.equal(migIssued.receipt.signature.alg, 'HMAC-SHA256', 'adoption PR must sign HMAC-SHA256 until allowed_signers lands on base');
        git(migRepo.dir, 'add', 'docs/AUDIT_CHAIN.jsonl');
        git(migRepo.dir, 'commit', '-q', '-m', 'chore(audit): seal adoption PR');
        const migSealed = git(migRepo.dir, 'rev-parse', 'HEAD').stdout.trim();
        assert.equal(verifyGateReceipt({ headSha: migSealed, branch: 'feat/adopt-sshsig', repoRoot: migRepo.dir }).valid, true);
        delete process.env.SEALIT_RECEIPT_KEY;
      } finally {
        if (prevKeyEnv === undefined) delete process.env.SEALIT_SIGNING_KEY;
        else process.env.SEALIT_SIGNING_KEY = prevKeyEnv;
      }
    });
  });
});
