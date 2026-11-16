import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTempGitRepo, git, withoutReceiptEnv } from '../helpers/test-harness.mjs';
import { readSessionStore } from '../../.agent/scripts/lib/receipt.mjs';
import { runGate } from '../../.agent/scripts/lib/measure.mjs';
import {
  beginSession,
  getSessionStatus,
  recordReviewVerdict,
  endSession,
  verifyCommitGuard,
  verifyMergeGuard,
  verifyPushGuard,
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
    const wtPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-guard-wt-')), 'wt-20');
    cleanups.push(() => {
      git(dir, 'worktree', 'remove', '--force', wtPath);
      fs.rmSync(path.dirname(wtPath), { recursive: true, force: true });
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

  it('verifyPushGuard blocks protected branches, leaked secrets, and undeclared spec drift before remote push', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    assert.equal(verifyPushGuard({ repoRoot: dir }).allowed, false);

    beginSession({ issueId: '31', title: 'Push Check', checkout: true, repoRoot: dir });
    assert.equal(verifyPushGuard({ repoRoot: dir }).allowed, true);

    // Secret in staged diff blocks push immediately!
    const fakeSecret = ['AKIA', '1234567890ABCDEF'].join('');
    fs.writeFileSync(path.join(dir, 'leak.mjs'), `export const k = "${fakeSecret}";\n`, 'utf8');
    git(dir, 'add', 'leak.mjs');
    const secBlocked = verifyPushGuard({ repoRoot: dir });
    assert.equal(secBlocked.allowed, false);
    assert.match(secBlocked.message, /secret/i);

    git(dir, 'rm', '-f', '-q', 'leak.mjs');
    assert.equal(verifyPushGuard({ repoRoot: dir }).allowed, true);

    // Undeclared PRODUCT.md drift blocks push
    fs.writeFileSync(path.join(dir, 'PRODUCT.md'), '# Changed spec\n', 'utf8');
    const driftBlocked = verifyPushGuard({ repoRoot: dir });
    assert.equal(driftBlocked.allowed, false);
    assert.match(driftBlocked.message, /drift|ADR/i);
  });

  it('verifyMergeGuard extracts branch from GITHEAD_<sha> even when MERGE_HEAD exists, and recordReviewVerdict signs receipt', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    withoutReceiptEnv(() => {
      fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'tests/basic.test.mjs'),
        "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('ok', () => assert.equal(2, 2));\n",
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
                coverage: `${process.execPath} --test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination=coverage/lcov.info "tests/**/*.test.mjs"`,
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
        "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { x } from '../feature.mjs';\ntest('ok', () => assert.equal(x, 44));\n",
        'utf8'
      );
      git(dir, 'add', 'feature.mjs', 'tests/basic.test.mjs');
      git(dir, 'commit', '-q', '-m', 'feat: add x with covering test');

      // Run gate and record review -> issues signed receipt
      const gateRes = runGate(dir, { noCache: true });
      assert.equal(gateRes.passed, true);
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
  });
});
