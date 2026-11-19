import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTempGitRepo, git, withoutReceiptEnv, cleanTestGitEnv } from '../helpers/test-harness.mjs';
import { readSessionStore, verifyAuditChain } from '../../.agent/scripts/lib/receipt.mjs';
import { runGate } from '../../.agent/scripts/lib/measure.mjs';
import {
  beginSession,
  buildReviewPlan,
  getSessionStatus,
  recordReviewVerdict,
  endSession,
  verifyCommitGuard,
  verifyMergeGuard,
  verifyPushGuard,
  postMergeCleanup,
  installHooks,
  inspectHooks,
  applyBranchProtection
} from '../../.agent/scripts/lib/guard.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

describe('Ring 2: lib/guard.mjs', () => {
  it('enforces commit guard on protected branches and manages multi-session release without hijacking activeSessionId or wiping dirty worktrees', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    // Commit on develop blocked
    assert.equal(verifyCommitGuard({ repoRoot: dir }).allowed, false);

    // Start session 1 with checkout
    const s1 = beginSession({ issueId: '10', title: 'First Feature', checkout: true, repoRoot: dir });
    assert.equal(s1.success, true);
    assert.equal(verifyCommitGuard({ repoRoot: dir }).allowed, true);

    // Start session 2 in a linked worktree with uncommitted file
    const wtPath = path.join(path.dirname(dir), `${path.basename(dir)}-wt-20`);
    cleanups.push(() => {
      git(dir, 'worktree', 'remove', '--force', wtPath);
      fs.rmSync(wtPath, { recursive: true, force: true });
    });
    const s2 = beginSession({ issueId: '20', title: 'Worktree Feature', worktree: wtPath, repoRoot: dir });
    assert.equal(s2.success, true);
    fs.writeFileSync(path.join(wtPath, 'unsaved.txt'), 'important user work\n', 'utf8');

    // Switch activeSessionId back to 10 by starting/resuming on main checkout
    beginSession({ issueId: '10', branch: s1.session.branch, repoRoot: dir });
    assert.equal(readSessionStore(dir).activeSessionId, '10');

    // Releasing background session 20 preserves activeSessionId === '10' AND refuses to --force delete unsaved.txt!
    const ended20 = endSession({ issueId: '20', repoRoot: dir });
    assert.equal(ended20.success, true);
    assert.equal(readSessionStore(dir).activeSessionId, '10');
    assert.equal(fs.existsSync(path.join(wtPath, 'unsaved.txt')), true);
  });

  it('verifyPushGuard evaluates each pushed ref commit range, ignores working-tree masking, allows tags, and fails closed on unreadable stdin', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    assert.equal(verifyPushGuard({ repoRoot: dir }).allowed, false);
    assert.equal(verifyPushGuard({ stdinError: new Error('EIO'), repoRoot: dir }).layer, 'LAYER_4_STDIN_UNREADABLE');

    // Pushing a tag while HEAD is on main is allowed
    git(dir, 'checkout', '-q', 'main');
    const mainSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    const tagPush = verifyPushGuard({
      stdinText: `refs/tags/v0.1.1 ${mainSha} refs/tags/v0.1.1 ${'0'.repeat(40)}\n`,
      repoRoot: dir
    });
    assert.equal(tagPush.allowed, true);
    git(dir, 'checkout', '-q', 'develop');

    beginSession({ issueId: '31', title: 'Push Check', checkout: true, repoRoot: dir });
    assert.equal(verifyPushGuard({ repoRoot: dir }).allowed, true);

    // 1 & 2. Secret committed then edited OR deleted only in working tree is STILL blocked!
    const fakeSecret = ['AKIA', '1234567890ABCDEF'].join('');
    fs.writeFileSync(path.join(dir, 'leak.mjs'), `export const k = "${fakeSecret}";\n`, 'utf8');
    git(dir, 'add', 'leak.mjs');
    git(dir, 'commit', '-q', '-m', 'bad: commit secret');
    fs.writeFileSync(path.join(dir, 'leak.mjs'), 'export const k = "redacted-in-worktree-only";\n', 'utf8');
    assert.equal(verifyPushGuard({ repoRoot: dir }).allowed, false, 'worktree edit must not mask committed secret');
    fs.unlinkSync(path.join(dir, 'leak.mjs'));
    assert.equal(verifyPushGuard({ repoRoot: dir }).allowed, false, 'uncommitted deletion must not mask committed secret');

    git(dir, 'reset', '--hard', 'HEAD~1');
    assert.equal(verifyPushGuard({ repoRoot: dir }).allowed, true);

    // 4 & 5. While HEAD is on develop, pushing feat/x with remoteSha 000... judges feat/x against its session baseBranch (including drift)
    git(dir, 'checkout', '-q', 'develop');
    git(dir, 'branch', 'custom-base', 'HEAD');
    git(dir, 'checkout', '-q', '-b', 'feat/custom-push', 'custom-base');
    beginSession({ issueId: '32', title: 'Custom Push', branch: 'feat/custom-push', repoRoot: dir });
    const store = readSessionStore(dir);
    store.sessions['32'].baseBranch = 'custom-base';
    fs.writeFileSync(path.join(dir, '.agent/.sdlc-session.json'), JSON.stringify(store, null, 2), 'utf8');
    fs.writeFileSync(path.join(dir, 'PRODUCT.md'), '# Undeclared drift on feat/custom-push\n', 'utf8');
    git(dir, 'add', 'PRODUCT.md');
    git(dir, 'commit', '-q', '-m', 'docs: drift on feat/custom-push');
    const featSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    git(dir, 'checkout', '-q', 'develop');

    const refBlocked = verifyPushGuard({
      stdinText: `refs/heads/feat/custom-push ${featSha} refs/heads/feat/custom-push ${'0'.repeat(40)}\n`,
      repoRoot: dir
    });
    assert.equal(refBlocked.allowed, false);
    assert.equal(refBlocked.layer, 'LAYER_4_UNDECLARED_SPEC_DRIFT');
    assert.equal(refBlocked.branch, 'feat/custom-push');

    // Pushing a sessionless feature branch while HEAD is on develop (when develop has an accepted ADR ahead of main)
    // MUST diff against develop (NOT main) and block undeclared drift!
    git(dir, 'checkout', '-q', 'develop');
    fs.mkdirSync(path.join(dir, 'docs/adr'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'docs/adr/ADR-001-dev.md'),
      '---\nid: ADR-001\ntitle: Dev ADR\nstatus: accepted\nscope: product\nticket: "1"\n---\n',
      'utf8'
    );
    git(dir, 'add', 'docs/adr/ADR-001-dev.md');
    git(dir, 'commit', '--no-verify', '-q', '-m', 'chore: accepted ADR on develop ahead of main');
    git(dir, 'checkout', '-q', '-b', 'feat/rogue-no-session', 'develop');
    fs.writeFileSync(path.join(dir, 'PRODUCT.md'), '# Rogue unapproved drift\n', 'utf8');
    git(dir, 'add', 'PRODUCT.md');
    git(dir, 'commit', '--no-verify', '-q', '-m', 'evil: unapproved drift');
    const rogueSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    git(dir, 'checkout', '-q', 'develop');
    const roguePush = verifyPushGuard({
      stdinText: `refs/heads/feat/rogue-no-session ${rogueSha} refs/heads/feat/rogue-no-session ${'0'.repeat(40)}\n`,
      repoRoot: dir
    });
    assert.equal(roguePush.allowed, false, 'sessionless feature push while HEAD is on develop must not piggyback on develop ADRs');
    assert.equal(roguePush.layer, 'LAYER_4_UNDECLARED_SPEC_DRIFT');

    // Edge cases: malformed stdin, unresolved SHA, protected delete blocked, non-protected delete allowed, custom ref scanned
    assert.equal(verifyPushGuard({ stdinText: 'malformed-two-cols only\n', repoRoot: dir }).layer, 'LAYER_4_STDIN_UNREADABLE');
    assert.equal(
      verifyPushGuard({ stdinText: `refs/heads/feat/x ${'deadbeef'.repeat(5)} refs/heads/feat/x ${'0'.repeat(40)}\n`, repoRoot: dir }).layer,
      'LAYER_4_UNRESOLVED_SHA'
    );
    assert.equal(
      verifyPushGuard({ stdinText: `(delete) ${'0'.repeat(40)} refs/heads/develop ${rogueSha}\n`, repoRoot: dir }).layer,
      'LAYER_4_PROTECTED_PUSH'
    );
    assert.equal(
      verifyPushGuard({ stdinText: `(delete) ${'0'.repeat(40)} refs/heads/feat/old ${rogueSha}\n`, repoRoot: dir }).allowed,
      true
    );
    assert.equal(
      verifyPushGuard({ stdinText: `refs/heads/feat/rogue-no-session ${rogueSha} refs/for/review ${'0'.repeat(40)}\n`, repoRoot: dir }).allowed,
      false
    );
  });

  it('verifyMergeGuard extracts branch from GITHEAD_<sha> even when MERGE_HEAD exists, and recordReviewVerdict signs receipt', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    withoutReceiptEnv(() => {
      fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'tests/basic.test.mjs'),
        "import fs from 'node:fs';\nfs.mkdirSync('coverage', { recursive: true });\nfs.writeFileSync('coverage/lcov.info', 'SF:tests/basic.test.mjs\\nDA:1,1\\nLF:1\\nLH:1\\nend_of_record\\n', 'utf8');\n",
        'utf8'
      );
      fs.writeFileSync(
        path.join(dir, '.agent/sdlc-config.json'),
        JSON.stringify({
          version: '0.1.0',
          archlens: { enabled: false },
          modules: [
            {
              name: 'root',
              path: '.',
              commands: {
                coverage: `${process.execPath} tests/basic.test.mjs`,
                coverageFile: 'coverage/lcov.info'
              },
              thresholds: { diffCoverage: 80, mutationScore: null }
            }
          ]
        }),
        'utf8'
      );
      git(dir, 'add', '.agent/sdlc-config.json', 'tests/basic.test.mjs');
      git(dir, 'commit', '-q', '-m', 'chore: setup config');
      git(dir, 'branch', '-f', 'main', 'HEAD');

      const begun = beginSession({ issueId: '44', title: 'Merge Flow', checkout: true, repoRoot: dir });
      fs.writeFileSync(path.join(dir, 'feature.mjs'), 'export const x = 44;\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, 'tests/basic.test.mjs'),
        "import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport { x } from '../feature.mjs';\nassert.equal(x, 44);\nfs.mkdirSync('coverage', { recursive: true });\nfs.writeFileSync('coverage/lcov.info', 'SF:feature.mjs\\nDA:1,1\\nLF:1\\nLH:1\\nend_of_record\\n', 'utf8');\n",
        'utf8'
      );
      git(dir, 'add', 'feature.mjs', 'tests/basic.test.mjs');
      git(dir, 'commit', '-q', '-m', 'feat: add x with covering test');

      // Run gate and record review -> issues signed receipt
      const gateRes = runGate(dir, { noCache: true });
      assert.equal(gateRes.passed, true);
      // Invalid --pr is rejected BEFORE appending a Stage 7 receipt to docs/AUDIT_CHAIN.jsonl
      const countBeforeBadPr = verifyAuditChain(dir).recordsCount;
      assert.equal(recordReviewVerdict({ verdict: 'approve', prNumber: '--repo=evil/repo', repoRoot: dir }).success, false);
      assert.equal(verifyAuditChain(dir).recordsCount, countBeforeBadPr);

      let ghArgs = null;
      const okPrRev = recordReviewVerdict({
        verdict: 'request-changes',
        prNumber: '145',
        notes: 'Needs fix',
        repoRoot: dir,
        execFn: (_cmd, args) => { ghArgs = args; return ''; }
      });
      assert.equal(okPrRev.success, true);
      assert.equal(okPrRev.prCommented, true);
      assert.equal(ghArgs[0], 'pr');
      const errPrRev = recordReviewVerdict({
        verdict: 'request-changes',
        prNumber: '145',
        repoRoot: dir,
        execFn: () => { throw new Error('gh offline'); }
      });
      assert.equal(errPrRev.success, false);
      assert.match(errPrRev.reason, /gh offline/);

      const revRes = recordReviewVerdict({
        verdict: 'approve',
        reviewer: '@gate-reviewer',
        notes: 'Clean and tested',
        repoRoot: dir
      });
      assert.equal(revRes.success, true);
      assert.ok(revRes.receipt?.receiptId);
      assert.equal(getSessionStatus(dir).readyForReceipt, true);

      git(dir, 'add', 'docs/AUDIT_CHAIN.jsonl');
      git(dir, 'commit', '-q', '-m', 'chore: commit receipt');
      const receiptHead = git(dir, 'rev-parse', 'HEAD').stdout.trim();

      // Simulate git merge into main with spoofed GIT_REFLOG_ACTION='merge develop' while MERGE_HEAD points to featSha -> MUST block!
      git(dir, 'checkout', '-q', 'main');
      fs.writeFileSync(path.join(dir, '.git/MERGE_HEAD'), `${receiptHead}\n`, 'utf8');
      process.env.GIT_REFLOG_ACTION = 'merge develop';
      try {
        const spoofedMainMerge = verifyMergeGuard({ repoRoot: dir });
        assert.equal(spoofedMainMerge.allowed, false);
        assert.equal(spoofedMainMerge.reasonCode, 'DIRECT_MERGE_TO_MAIN_FORBIDDEN');
      } finally {
        delete process.env.GIT_REFLOG_ACTION;
        fs.unlinkSync(path.join(dir, '.git/MERGE_HEAD'));
      }

      // Simulate git merge into main with BOTH MERGE_HEAD and GITHEAD_<sha>='feat/...' -> MUST block non-develop merge to main!
      git(dir, 'checkout', '-q', 'main');
      fs.writeFileSync(path.join(dir, '.git/MERGE_HEAD'), `${receiptHead}\n`, 'utf8');
      const envKey = `GITHEAD_${receiptHead}`;
      process.env[envKey] = begun.session.branch;
      try {
        const blockedMainMerge = verifyMergeGuard({ repoRoot: dir });
        assert.equal(blockedMainMerge.allowed, false);
        assert.equal(blockedMainMerge.reasonCode, 'DIRECT_MERGE_TO_MAIN_FORBIDDEN');
      } finally {
        delete process.env[envKey];
        fs.unlinkSync(path.join(dir, '.git/MERGE_HEAD'));
      }

      // Merge into develop with receipt succeeds!
      git(dir, 'checkout', '-q', 'develop');
      const allowedDevMerge = verifyMergeGuard({ sourceSha: receiptHead, sourceBranch: begun.session.branch, repoRoot: dir });
      assert.equal(allowedDevMerge.allowed, true);

      // Fast-forward/merge onto develop and verify postMergeCleanup marks merged session inactive
      git(dir, 'merge', '--ff-only', begun.session.branch);
      const cleaned = postMergeCleanup({ repoRoot: dir });
      assert.equal(cleaned.cleaned, 1);
      assert.equal(readSessionStore(dir).sessions['44'].active, false);

      // Allocating local L-N session without issueId and blocking protected/flag/HEAD branch session start
      const blockedProtected = beginSession({ branch: 'develop', repoRoot: dir });
      assert.equal(blockedProtected.success, false);
      assert.equal(beginSession({ branch: 'HEAD', repoRoot: dir }).success, false);
      assert.equal(beginSession({ branch: '--evil-flag', repoRoot: dir }).success, false);
      assert.equal(beginSession({ branch: 'feat/bad..ref', repoRoot: dir }).success, false);

      // Refspec push smuggling (git push origin HEAD:main) blocked via stdinText
      const smuggledPush = verifyPushGuard({
        stdinText: 'refs/heads/feat/x 1111111111111111111111111111111111111111 refs/heads/main 0000000000000000000000000000000000000000\n',
        repoRoot: dir
      });
      assert.equal(smuggledPush.allowed, false);

      // verifyPushGuard honors session.baseBranch instead of always comparing against develop
      const customBaseRepo = createTempGitRepo();
      cleanups.push(customBaseRepo.cleanup);
      git(customBaseRepo.dir, 'checkout', '-q', '-b', 'release/v1', 'develop');
      fs.writeFileSync(path.join(customBaseRepo.dir, 'PRODUCT.md'), '# Release Spec\n', 'utf8');
      git(customBaseRepo.dir, 'add', 'PRODUCT.md');
      git(customBaseRepo.dir, 'commit', '-q', '-m', 'docs: release spec');
      git(customBaseRepo.dir, 'checkout', '-q', '-b', 'fix/on-release', 'release/v1');
      beginSession({ issueId: '77', title: 'Release Fix', branch: 'fix/on-release', repoRoot: customBaseRepo.dir });
      const storeCustom = readSessionStore(customBaseRepo.dir);
      storeCustom.sessions['77'].baseBranch = 'release/v1';
      fs.writeFileSync(path.join(customBaseRepo.dir, '.agent/.sdlc-session.json'), JSON.stringify(storeCustom, null, 2), 'utf8');
      assert.equal(verifyPushGuard({ repoRoot: customBaseRepo.dir }).allowed, true);

      const localSess = beginSession({ title: 'Auto Local ID', checkout: true, repoRoot: dir });
      assert.equal(localSess.success, true);
      assert.match(localSess.session.issueId, /^L-\d+$/);
    });
  });

  it('installHooks installs all 4 hooks, fails loud when chmodSync throws, and inspectHooks validates SHA-256', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    const installed = installHooks({ repoRoot: dir });
    assert.equal(installed.success, true);
    assert.deepEqual(installed.installed.sort(), ['post-merge', 'pre-commit', 'pre-merge-commit', 'pre-push']);

    const health = inspectHooks(dir);
    assert.equal(health.upToDate, true);
    assert.deepEqual(health.missingHooks, []);

    // chmodSync failure throws instead of silently leaving non-executable hook
    assert.throws(() =>
      installHooks({
        repoRoot: dir,
        fsImpl: {
          ...fs,
          chmodSync: () => {
            throw new Error('EPERM chmod denied');
          }
        }
      })
    );

    // applyBranchProtection invokes gh api with DEFAULT_QUALITY_GATE_CHECK
    const calls = [];
    const prot = applyBranchProtection({
      branches: ['main'],
      repoRoot: dir,
      execFn: (cmd, args) => {
        calls.push({ cmd, args });
        return '';
      }
    });
    assert.equal(prot.localHookInstalled, true);
    assert.equal(calls.length, 1);

    // Installed hook fails closed (exit non-zero) when no engine exists in repo, HOME, or PATH
    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-empty-home-'));
    cleanups.push(() => fs.rmSync(emptyHome, { recursive: true, force: true }));
    const hookRun = spawnSync(path.join(dir, '.git/hooks/pre-push'), [], {
      cwd: dir,
      env: { HOME: emptyHome, PATH: '/usr/bin:/bin' },
      encoding: 'utf8'
    });
    assert.notEqual(hookRun.status, 0);
    assert.match(hookRun.stderr, /missing|failing closed/i);
  });

  it('covers missing-session commit guard, dirty merge-index detection, unverified merge rejection, review error paths, and remote protection failure', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    withoutReceiptEnv(() => {
      // End with no active session fails cleanly
      assert.equal(endSession({ repoRoot: dir }).success, false);

      // Feature branch with no session triggers LAYER_2_MISSING_SESSION & recordReviewVerdict errors
      git(dir, 'checkout', '-q', '-b', 'feat/untracked-branch', 'develop');
      const noSessCommit = verifyCommitGuard({ repoRoot: dir });
      assert.equal(noSessCommit.allowed, false);
      assert.equal(noSessCommit.layer, 'LAYER_2_MISSING_SESSION');
      assert.equal(recordReviewVerdict({ verdict: 'banana', repoRoot: dir }).success, false);
      assert.equal(recordReviewVerdict({ verdict: 'approve', repoRoot: dir }).success, false);

      // Dirty working tree blocks approve review and marks getSessionStatus.readyForReceipt false
      beginSession({ issueId: '50', title: 'Dirty Review', branch: 'feat/untracked-branch', repoRoot: dir });
      fs.writeFileSync(path.join(dir, 'uncommitted.mjs'), 'export const u = 1;\n', 'utf8');
      const dirtyStatus = getSessionStatus(dir);
      assert.equal(dirtyStatus.dirty, true);
      assert.equal(dirtyStatus.readyForReceipt, false);
      assert.match(recordReviewVerdict({ verdict: 'approve', repoRoot: dir }).reason, /dirty working tree/i);
      git(dir, 'add', 'uncommitted.mjs');
      git(dir, 'commit', '-q', '-m', 'feat: commit unverified work');
      const unverifiedSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();

      // Merge into non-protected branch is allowed; merge into develop without receipt is blocked
      assert.equal(verifyMergeGuard({ targetBranch: 'feat/untracked-branch', repoRoot: dir }).allowed, true);
      git(dir, 'checkout', '-q', 'develop');
      const missingRecMerge = verifyMergeGuard({ sourceSha: unverifiedSha, sourceBranch: 'feat/untracked-branch', repoRoot: dir });
      assert.equal(missingRecMerge.allowed, false);
      assert.equal(missingRecMerge.reasonCode, 'MISSING_STAGE_7_GATE_RECEIPT');

      // Evil staged index during active MERGE_HEAD triggers EVIL_MERGE_INDEX_DETECTED
      git(dir, 'merge', '--no-ff', '--no-commit', 'feat/untracked-branch');
      fs.writeFileSync(path.join(dir, 'evil-index.mjs'), 'export const evil = 1;\n', 'utf8');
      git(dir, 'add', 'evil-index.mjs');
      const dirtyIndexMerge = verifyMergeGuard({ repoRoot: dir });
      assert.equal(dirtyIndexMerge.allowed, false);
      assert.equal(dirtyIndexMerge.reasonCode, 'EVIL_MERGE_INDEX_DETECTED');
      git(dir, 'merge', '--abort');

      // Outdated hook mode/content detected by inspectHooks; applyBranchProtection surfaces gh errors cleanly
      installHooks({ repoRoot: dir });
      fs.writeFileSync(path.join(dir, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 0\n', 'utf8');
      assert.equal(inspectHooks(dir).upToDate, false);
      assert.ok(inspectHooks(dir).outdatedHooks.includes('pre-commit'));

      const failedProt = applyBranchProtection({
        branches: ['main', 'develop'],
        repoRoot: dir,
        execFn: () => { throw new Error('HTTP 403 Forbidden'); }
      });
      assert.equal(failedProt.success, false);
      assert.equal(failedProt.errors.length, 2);

      // Additional branch paths: postMergeCleanup on non-protected branch, GIT_REFLOG_ACTION merge source, unknown session type fallback, resume checkout
      git(dir, 'checkout', '-q', 'feat/untracked-branch');
      assert.equal(postMergeCleanup({ repoRoot: dir }).cleaned, 0);
      const fallbackType = beginSession({ issueId: '51', title: '', type: 'unknown-type', branch: 'feat/untracked-branch', checkout: true, repoRoot: dir });
      assert.equal(fallbackType.session.type, 'feat');
      git(dir, 'checkout', '-q', 'develop');
      const resumedCo = beginSession({ issueId: '51', branch: 'feat/untracked-branch', checkout: true, repoRoot: dir });
      assert.equal(resumedCo.success, true);
      git(dir, 'checkout', '-q', 'main');
      assert.equal(verifyMergeGuard({ sourceSha: unverifiedSha, repoRoot: dir }).reasonCode, 'DIRECT_MERGE_TO_MAIN_FORBIDDEN');
      process.env.GIT_REFLOG_ACTION = 'merge feat/untracked-branch';
      try {
        assert.equal(verifyMergeGuard({ repoRoot: dir }).reasonCode, 'DIRECT_MERGE_TO_MAIN_FORBIDDEN');
      } finally {
        delete process.env.GIT_REFLOG_ACTION;
      }
      assert.equal(verifyPushGuard({ remoteBranch: 'main', repoRoot: dir }).allowed, false);
      const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-not-git-'));
      cleanups.push(() => fs.rmSync(nonGitDir, { recursive: true, force: true }));
      assert.throws(() => installHooks({ repoRoot: nonGitDir }), /Not a git repository/);
    });
  });

  it('two concurrent begin --worktree without --issue get distinct L ids and both sessions persist', async () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);
    const engine = fileURLToPath(new URL('../../.agent/scripts/sdlc-engine.mjs', import.meta.url));
    const wtRoot = path.dirname(dir);
    const wtName = (name) => `${path.basename(dir)}-${name}`;
    cleanups.push(() => {
      for (const n of ['race-a', 'race-b']) fs.rmSync(path.join(wtRoot, wtName(n)), { recursive: true, force: true });
    });
    const runBegin = (name) =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [engine, 'begin', '--worktree', path.join(wtRoot, wtName(name)), '--title', name, '--json'], {
          cwd: dir,
          env: cleanTestGitEnv()
        });
        let out = '';
        child.stdout.on('data', (d) => { out += d; });
        child.on('close', (code) => resolve({ code, out }));
      });
    const results = await Promise.all([runBegin('race-a'), runBegin('race-b')]);
    for (const r of results) assert.equal(r.code, 0, r.out);
    const ids = results.map((r) => JSON.parse(r.out).begin.session.issueId);
    assert.notEqual(ids[0], ids[1], `ids collided: ${ids}`);
    const store = readSessionStore(dir);
    for (const id of ids) {
      assert.equal(store.sessions[id].active, true);
      assert.match(store.sessions[id].branch, new RegExp(`^feat/${id}-race-[ab]$`));
    }
    assert.equal(Object.values(store.sessions).some((s) => s.reserved), false, 'no leftover reservations');

    // A failed begin releases its reservation
    assert.equal(beginSession({ branch: 'feat/bad..ref', repoRoot: dir }).success, false);
    assert.equal(Object.values(readSessionStore(dir).sessions).some((s) => s.reserved), false);
  });

  it('end without --issue never falls back to another session; post-merge only deactivates branches brought in by this merge', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    // Session A on the main checkout, session B in a linked worktree (B becomes activeSessionId)
    const a = beginSession({ issueId: '60', title: 'A', checkout: true, repoRoot: dir });
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n', 'utf8');
    git(dir, 'add', 'a.txt');
    git(dir, 'commit', '-q', '-m', 'feat: a');
    const wtB = path.join(path.dirname(dir), `${path.basename(dir)}-wt-b`);
    cleanups.push(() => {
      git(dir, 'worktree', 'remove', '--force', wtB);
      fs.rmSync(wtB, { recursive: true, force: true });
    });
    const b = beginSession({ issueId: '61', title: 'B', worktree: wtB, repoRoot: dir });
    assert.equal(readSessionStore(dir).activeSessionId, '61');

    // Merging A into develop (ff) deactivates A but not the fresh, commit-less B
    git(dir, 'checkout', '-q', 'develop');
    git(dir, 'merge', '-q', '--ff-only', a.session.branch);
    const cleaned = postMergeCleanup({ repoRoot: dir });
    assert.equal(cleaned.cleaned, 1);
    assert.equal(readSessionStore(dir).sessions['60'].active, false);
    assert.equal(readSessionStore(dir).sessions['61'].active, true, 'fresh worktree session at the old develop tip must stay active');

    // A plain fast-forward pull of unrelated work also leaves B active
    git(dir, 'checkout', '-q', '-b', 'tmp/other');
    fs.writeFileSync(path.join(dir, 'o.txt'), 'o\n', 'utf8');
    git(dir, 'add', 'o.txt');
    git(dir, 'commit', '-q', '--no-verify', '-m', 'chore: other');
    git(dir, 'checkout', '-q', 'develop');
    git(dir, 'merge', '-q', '--ff-only', 'tmp/other');
    assert.equal(postMergeCleanup({ repoRoot: dir }).cleaned, 0);
    assert.equal(readSessionStore(dir).sessions['61'].active, true);

    // `end` on develop with no matching session fails; B and its worktree survive
    const ended = endSession({ repoRoot: dir });
    assert.equal(ended.success, false);
    assert.match(ended.error, /No active session for branch 'develop'\. Pass --issue <id>\./);
    assert.equal(readSessionStore(dir).sessions['61'].active, true);
    assert.equal(fs.existsSync(wtB), true);
    assert.equal(b.success, true);
  });

  it('begin --worktree only allows new direct children of the repo parent or <repo>/.worktrees; explicit ids never take over a reservation', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);
    const parent = path.dirname(dir);
    const scratch = fs.mkdtempSync(path.join(parent, `${path.basename(dir)}-scratch-`));
    cleanups.push(() => fs.rmSync(scratch, { recursive: true, force: true }));

    const homeDot = path.join(os.homedir(), '.claude', 'commands', `sdlc-pwn-${process.pid}`);
    const outsideHome = path.join(os.homedir(), `sdlc-wt-outside-${process.pid}`);
    fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
    const sibling = path.join(parent, `${path.basename(dir)}-sib`);
    fs.symlinkSync(path.join(scratch, 'tests'), sibling);
    cleanups.push(() => fs.rmSync(sibling, { force: true }));
    for (const [label, wt] of [
      ['home dot-dir', homeDot],
      ['outside the repo parent', outsideHome],
      ['nested inside a sibling project', path.join(scratch, 'tests', 'pwn')],
      ['dot-name sibling', path.join(parent, `.${path.basename(dir)}-hidden`)],
      ['existing directory', scratch],
      ['symlinked sibling parent', path.join(sibling, 'wt')]
    ]) {
      const res = beginSession({ branch: `feat/wt-${label.replace(/\W+/g, '-')}`, worktree: wt, repoRoot: dir });
      assert.equal(res.success, false, label);
      assert.match(res.error, /Worktree path/, label);
      if (label !== 'existing directory') assert.equal(fs.existsSync(wt), false, `${label}: nothing created`);
    }

    // Allowed: a new sibling of the repo ('../<name>') and <repo>/.worktrees/<name>
    const okSibling = path.join(parent, `${path.basename(dir)}-wt-ok`);
    const okSib = beginSession({ branch: 'feat/wt-ok-sibling', worktree: okSibling, repoRoot: dir });
    assert.equal(okSib.success, true, okSib.error);
    cleanups.push(() => { git(dir, 'worktree', 'remove', '--force', okSibling); fs.rmSync(okSibling, { recursive: true, force: true }); });
    const okInRepo = beginSession({ branch: 'feat/wt-ok-repo', worktree: '.worktrees/ok', repoRoot: dir });
    assert.equal(okInRepo.success, true, okInRepo.error);
    cleanups.push(() => git(dir, 'worktree', 'remove', '--force', path.join(dir, '.worktrees/ok')));

    // An explicit --issue that names an in-flight reservation is refused instead of hijacking it
    const store = readSessionStore(dir);
    store.sessions['L-9'] = { active: false, reserved: true, issueId: 'L-9', startedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(dir, '.agent/.sdlc-session.json'), JSON.stringify(store, null, 2), 'utf8');
    const hijack = beginSession({ issueId: 'L-9', branch: 'feat/hijack', repoRoot: dir });
    assert.equal(hijack.success, false);
    assert.match(hijack.error, /being created by another/);
    assert.equal(readSessionStore(dir).sessions['L-9'].reserved, true);
  });

  it('buildReviewPlan dispatches Architecture & Security Reviewer when .agent/sdlc-config.json or stryker.config.json changes', () => {
    for (const govFile of ['.agent/sdlc-config.json', 'stryker.config.json']) {
      const { dir, cleanup } = createTempGitRepo();
      cleanups.push(cleanup);
      git(dir, 'checkout', '-q', '-b', 'feat/cfg-rev', 'develop');
      const full = path.join(dir, govFile);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, '{"ok":true}\n', 'utf8');
      const plan = buildReviewPlan(dir);
      assert.equal(plan.mode, 'code', govFile);
      assert.equal(plan.advisory, true);
      assert.equal(plan.source, 'worktree');
      assert.equal(plan.changedLines, 1);
      assert.ok(plan.reviewers.some((r) => r.role === 'Architecture & Security Reviewer'), `${govFile} must trigger security reviewer`);
      assert.match(plan.reviewers[0].prompt, /advisory: includes uncommitted changes/);
      assert.match(plan.reviewers[1].prompt, /Audit security and architecture invariants/);
    }

    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);
    git(dir, 'checkout', '-q', '-b', 'feat/rev-modes', 'develop');
    fs.writeFileSync(path.join(dir, 'README.md'), '# Updated Readme\n', 'utf8');
    const docsPlan = buildReviewPlan(dir);
    assert.equal(docsPlan.mode, 'docs-only');
    assert.equal(docsPlan.reviewers.length, 1);
    assert.equal(docsPlan.reviewers[0].role, 'Docs Alignment Reviewer');
    assert.equal(docsPlan.changedLines, 2);

    fs.writeFileSync(path.join(dir, 'calc.mjs'), 'export const add = (a, b) => a + b;\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'GLOSSARY.md'), '# Glossary\n- **Sum**: result of addition.\n', 'utf8');
    const codeRev = buildReviewPlan(dir);
    assert.equal(codeRev.mode, 'code');
    assert.equal(codeRev.reviewers.length, 2);
    assert.equal(codeRev.reviewers[0].role, 'Spec Fidelity & Peer Reviewer');
    assert.equal(codeRev.reviewers[1].role, 'Architecture & Security Reviewer');
    assert.ok(codeRev.contextPointers.includes('GLOSSARY.md'));
    assert.match(codeRev.reviewers[0].prompt, /GLOSSARY\.md/);
    assert.match(codeRev.reviewers[1].prompt, /Feature Envy/);

    fs.writeFileSync(path.join(dir, 'huge.mjs'), `${'// l\n'.repeat(205)}export const big = "${'z'.repeat(33000)}";\n`, 'utf8');
    const twoRev = buildReviewPlan(dir);
    assert.equal(twoRev.reviewers.length, 2);
    assert.ok(twoRev.changedLines > 200);
    assert.match(twoRev.reviewers[0].prompt, /diff truncated at 32kB/);
    assert.match(twoRev.reviewers[1].prompt, /diff truncated at 32kB/);

    // Small <=200-line edits to .agent/scripts/** or packages/api/stryker.config.json also dispatch both reviewers
    fs.unlinkSync(path.join(dir, 'huge.mjs'));
    fs.mkdirSync(path.join(dir, '.agent/scripts/lib'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.agent/scripts/lib/config.mjs'), '// engine edit\n', 'utf8');
    assert.equal(buildReviewPlan(dir).reviewers.length, 2);
    fs.rmSync(path.join(dir, '.agent/scripts'), { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'packages/api'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'packages/api/stryker.config.json'), '{"mutate":["src/**/*.mjs"]}\n', 'utf8');
    assert.equal(buildReviewPlan(dir).reviewers.length, 2);
  });

  it('supports beginSession --base for integration-branch worktrees and generates One-Way vs Two-Way door PR summaries', async () => {
    const { buildPrSummary } = await import('../../.agent/scripts/lib/guard.mjs');
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    // Create an integration branch ahead of develop
    const integ = beginSession({ issueId: '70', title: 'Integration Epic', branch: 'feat/epic-70', checkout: true, repoRoot: dir });
    assert.equal(integ.success, true);
    fs.writeFileSync(path.join(dir, 'epic-base.mjs'), 'export const epic = true;\n', 'utf8');
    git(dir, 'add', 'epic-base.mjs');
    git(dir, 'commit', '-q', '-m', 'feat: seed integration branch');
    git(dir, 'checkout', '-q', 'develop');

    // Invalid --base fails closed
    assert.equal(beginSession({ issueId: '71', title: 'Bad Base', baseBranch: 'nonexistent-branch', checkout: true, repoRoot: dir }).success, false);
    assert.equal(beginSession({ issueId: '71', title: 'Flag Base', baseBranch: '-bad', checkout: true, repoRoot: dir }).success, false);

    // Valid --base in a linked worktree branches from feat/epic-70 and binds baseBranch
    const wtSlice = path.join(dir, '.worktrees/slice-71');
    cleanups.push(() => git(dir, 'worktree', 'remove', '--force', wtSlice));
    const slice = beginSession({
      issueId: '71',
      title: 'Vertical Slice 1',
      baseBranch: 'feat/epic-70',
      worktree: '.worktrees/slice-71',
      repoRoot: dir
    });
    assert.equal(slice.success, true, slice.error);
    assert.equal(slice.session.baseBranch, 'feat/epic-70');
    assert.equal(fs.existsSync(path.join(wtSlice, 'epic-base.mjs')), true, 'worktree must branch from feat/epic-70');

    // Two-Way door when editing internal code inside slice worktree
    fs.writeFileSync(path.join(wtSlice, 'slice.mjs'), 'export const s = 1;\n', 'utf8');
    git(wtSlice, 'add', 'slice.mjs');
    git(wtSlice, 'commit', '-q', '-m', 'feat: add slice 1');
    const twoWay = buildPrSummary(wtSlice);
    assert.equal(twoWay.door, 'Two-Way');
    assert.equal(twoWay.baseBranch, 'feat/epic-70');
    assert.match(twoWay.markdown, /\*\*Door:\*\* Two-Way/);
    assert.match(twoWay.markdown, /slice\.mjs/);

    // One-Way door when mutating a schema/contract file
    fs.writeFileSync(path.join(wtSlice, 'migration.sql'), 'CREATE TABLE items (id INT PRIMARY KEY);\n', 'utf8');
    git(wtSlice, 'add', 'migration.sql');
    git(wtSlice, 'commit', '-q', '-m', 'feat: add items table');
    const oneWay = buildPrSummary(wtSlice);
    assert.equal(oneWay.door, 'One-Way');
    assert.equal(oneWay.blastRadius, 'High');
    assert.match(oneWay.markdown, /\*\*Door:\*\* One-Way/);

    // Remote-only origin/<branch> checkout succeeds via --track without pathspec error
    const bareRemote = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-bare-rem-'));
    cleanups.push(() => fs.rmSync(bareRemote, { recursive: true, force: true }));
    git(bareRemote, 'init', '--bare', '-q');
    git(dir, 'remote', 'add', 'origin', bareRemote);
    git(dir, 'push', '-q', 'origin', 'feat/epic-70:refs/heads/feat/remote-only-72');
    git(dir, 'fetch', '-q', 'origin');
    const remCo = beginSession({ issueId: '72', branch: 'feat/remote-only-72', checkout: true, repoRoot: dir });
    assert.equal(remCo.success, true, remCo.error);

    // Post-receipt commit (docs/AUDIT_CHAIN.jsonl at HEAD) preserves docs-only mode and receipt ID in buildPrSummary
    withoutReceiptEnv(() => {
      const docRepo = createTempGitRepo();
      cleanups.push(docRepo.cleanup);
      fs.mkdirSync(path.join(docRepo.dir, '.agent'), { recursive: true });
      fs.writeFileSync(
        path.join(docRepo.dir, '.agent/sdlc-config.json'),
        JSON.stringify({ version: '0.1.0', archlens: { enabled: false }, modules: [{ name: 'root', path: '.', commands: { test: 'node --version' }, thresholds: { diffCoverage: null, mutationScore: null } }] }),
        'utf8'
      );
      git(docRepo.dir, 'add', '.agent/sdlc-config.json');
      git(docRepo.dir, 'commit', '-q', '-m', 'chore: seed config');
      git(docRepo.dir, 'branch', '-f', 'main', 'HEAD');
      beginSession({ issueId: '73', title: 'Docs Receipt PR', checkout: true, repoRoot: docRepo.dir });
      fs.writeFileSync(path.join(docRepo.dir, 'README.md'), '# Updated Docs\n', 'utf8');
      git(docRepo.dir, 'add', 'README.md');
      git(docRepo.dir, 'commit', '-q', '-m', 'docs: update readme');
      assert.equal(runGate(docRepo.dir, { noCache: true }).passed, true);
      const rec = recordReviewVerdict({ verdict: 'approve', reviewer: '@sdlc-gate', repoRoot: docRepo.dir });
      assert.equal(rec.success, true);
      git(docRepo.dir, 'add', 'docs/AUDIT_CHAIN.jsonl');
      git(docRepo.dir, 'commit', '-q', '-m', 'chore(audit): record receipt');
      const postRecPr = buildPrSummary(docRepo.dir);
      assert.equal(postRecPr.mode, 'docs-only');
      assert.ok(postRecPr.receiptId);
      assert.doesNotMatch(postRecPr.markdown, /pending gate/);

      // Code-mode post-receipt commit reads diffCoveragePct & mutationPct from verified receipt
      const codeRepo = createTempGitRepo();
      cleanups.push(codeRepo.cleanup);
      fs.mkdirSync(path.join(codeRepo.dir, '.agent'), { recursive: true });
      fs.mkdirSync(path.join(codeRepo.dir, 'tests'), { recursive: true });
      fs.writeFileSync(
        path.join(codeRepo.dir, 'tests/c.test.mjs'),
        "import fs from 'node:fs';\nfs.mkdirSync('coverage', { recursive: true });\nfs.writeFileSync('coverage/lcov.info', 'SF:mod.mjs\\nDA:1,1\\nLF:1\\nLH:1\\nend_of_record\\n', 'utf8');\n",
        'utf8'
      );
      fs.writeFileSync(
        path.join(codeRepo.dir, '.agent/sdlc-config.json'),
        JSON.stringify({ version: '0.1.0', archlens: { enabled: false }, modules: [{ name: 'root', path: '.', commands: { coverage: `${process.execPath} tests/c.test.mjs`, coverageFile: 'coverage/lcov.info' }, thresholds: { diffCoverage: 85, mutationScore: null } }] }),
        'utf8'
      );
      git(codeRepo.dir, 'add', '.agent/sdlc-config.json', 'tests/c.test.mjs');
      git(codeRepo.dir, 'commit', '-q', '-m', 'chore: base');
      git(codeRepo.dir, 'branch', '-f', 'main', 'HEAD');
      beginSession({ issueId: '74', title: 'Code Receipt PR', checkout: true, repoRoot: codeRepo.dir });
      fs.writeFileSync(path.join(codeRepo.dir, 'mod.mjs'), 'export const v = 1;\n', 'utf8');
      git(codeRepo.dir, 'add', 'mod.mjs');
      git(codeRepo.dir, 'commit', '-q', '-m', 'feat: add mod');
      assert.equal(runGate(codeRepo.dir, { noCache: true }).passed, true);
      assert.equal(recordReviewVerdict({ verdict: 'approve', reviewer: '@sdlc-gate', repoRoot: codeRepo.dir }).success, true);
      git(codeRepo.dir, 'add', 'docs/AUDIT_CHAIN.jsonl');
      git(codeRepo.dir, 'commit', '-q', '-m', 'chore(audit): sign code receipt');
      const codePostRecPr = buildPrSummary(codeRepo.dir);
      assert.equal(codePostRecPr.mode, 'code');
      assert.match(codePostRecPr.markdown, /Diff Coverage `100\.0%`/);
    });
  });
});
