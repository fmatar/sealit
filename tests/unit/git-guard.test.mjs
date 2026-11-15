import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  DEFAULT_QUALITY_GATE_CHECK,
  verifyCommitGuard,
  verifyMergeGuard,
  verifyPushGuard,
  buildHookTemplates,
  inspectHooksHealth,
  installHooks,
  applyBranchProtection
} from '../../.agent/scripts/lib/git-guard.mjs';
import { issueGateReceipt } from '../../.agent/scripts/lib/audit-chain.mjs';

describe('Unit: git-guard.mjs', () => {
  let repoDir;
  let headSha;

  before(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-unit-guard-'));
    execFileSync('git', ['init', '-b', 'develop'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(repoDir, 'README.md'), 'init\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir, stdio: 'pipe' });
    headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
  });

  after(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    fs.rmSync(path.join(repoDir, '.agent'), { recursive: true, force: true });
    fs.rmSync(path.join(repoDir, 'docs/AUDIT_CHAIN.jsonl'), { force: true });
    fs.rmSync(path.join(repoDir, '.git/hooks/pre-commit'), { force: true });
    fs.rmSync(path.join(repoDir, '.git/hooks/pre-merge-commit'), { force: true });
    fs.rmSync(path.join(repoDir, '.git/hooks/pre-push'), { force: true });
  });

  it('builds 4-layer shell hook templates with strict safety clauses', () => {
    const t = buildHookTemplates();
    assert.deepEqual(Object.keys(t).sort(), ['pre-commit', 'pre-merge-commit', 'pre-push']);
    assert.match(t['pre-commit'], /^#!\/usr\/bin\/env bash/);
    assert.match(t['pre-commit'], /set -e/);
    assert.match(t['pre-commit'], /git diff --cached --quiet/);
    assert.match(t['pre-commit'], /guard pre-commit/);

    assert.match(t['pre-merge-commit'], /guard pre-merge/);
    assert.match(t['pre-push'], /\$remote_branch" = "develop" \] \|\| \[ "\$remote_branch" = "main"/);
    assert.match(t['pre-push'], /guard pre-push/);
    assert.match(t['pre-push'], /gate --strict --no-cache/);
  });

  it('verifies commit, merge, and push guards across protected and feature branches', () => {
    // Commit guard
    const cMain = verifyCommitGuard({ branch: 'main', repoRoot: repoDir });
    assert.equal(cMain.allowed, false);
    assert.equal(cMain.layer, 'LAYER_1_PROTECTED_BRANCH');
    assert.match(cMain.message, /DIRECT COMMITS TO 'main' ARE FORBIDDEN/i);

    const cDev = verifyCommitGuard({ branch: 'develop', repoRoot: repoDir });
    assert.equal(cDev.allowed, false);
    assert.match(cDev.message, /develop/);

    const cNoSess = verifyCommitGuard({ branch: 'feature/issue-#10', repoRoot: repoDir });
    assert.equal(cNoSess.allowed, false);
    assert.equal(cNoSess.layer, 'LAYER_2_SESSION_REQUIRED');

    fs.mkdirSync(path.join(repoDir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(repoDir, '.agent/.sdlc-session.json'),
      JSON.stringify({ active: true, issueId: 10, branch: 'feature/issue-#99' }),
      'utf8'
    );
    const cWrongBranch = verifyCommitGuard({ branch: 'feature/issue-#10', repoRoot: repoDir });
    assert.equal(cWrongBranch.allowed, false);
    assert.equal(cWrongBranch.layer, 'LAYER_2_BRANCH_MISMATCH');

    fs.writeFileSync(
      path.join(repoDir, '.agent/.sdlc-session.json'),
      JSON.stringify({ active: true, issueId: 10, stage: 1, branch: 'feature/issue-#10' }),
      'utf8'
    );
    const cStage1 = verifyCommitGuard({ branch: 'feature/issue-#10', repoRoot: repoDir });
    assert.equal(cStage1.allowed, false);
    assert.equal(cStage1.layer, 'LAYER_2_STAGE_NOT_READY');

    fs.writeFileSync(
      path.join(repoDir, '.agent/.sdlc-session.json'),
      JSON.stringify({ active: true, issueId: 10, stage: 2, branch: 'feature/issue-#10' }),
      'utf8'
    );
    const cOk = verifyCommitGuard({ branch: 'feature/issue-#10', repoRoot: repoDir });
    assert.equal(cOk.allowed, true);
    assert.equal(cOk.branch, 'feature/issue-#10');

    // Push guard blocks main and develop cleanly while allowing feature branches
    assert.equal(verifyPushGuard({ remoteBranch: 'main', repoRoot: repoDir }).allowed, false);
    assert.equal(verifyPushGuard({ remoteBranch: 'develop', repoRoot: repoDir }).allowed, false);
    assert.equal(verifyPushGuard({ remoteBranch: 'feature/issue-#10', repoRoot: repoDir }).allowed, true);

    // Merge guard requires signed receipt when targeting develop/main
    execFileSync('git', ['checkout', '-B', 'develop'], { cwd: repoDir, stdio: 'pipe' });
    const mNoReceipt = verifyMergeGuard({ repoRoot: repoDir });
    assert.equal(mNoReceipt.allowed, false);

    issueGateReceipt({ issueId: 10, branch: 'develop', lane: 'trivial', driftCheckPassed: true, repoRoot: repoDir });
    const mWithReceipt = verifyMergeGuard({ repoRoot: repoDir });
    assert.equal(mWithReceipt.allowed, true);
    assert.ok(mWithReceipt.receipt);

    // Feature branch merge guard passes without requiring protected receipt
    execFileSync('git', ['checkout', '-B', 'feature/issue-#10'], { cwd: repoDir, stdio: 'pipe' });
    assert.equal(verifyMergeGuard({ repoRoot: repoDir }).allowed, true);
    execFileSync('git', ['checkout', 'develop'], { cwd: repoDir, stdio: 'pipe' });
    assert.ok(headSha);
  });

  it('installs hooks, verifies SHA-256 + executable bits, and detects tampering or non-git dirs', () => {
    const noGit = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-nogit-'));
    try {
      const noGitHealth = inspectHooksHealth(noGit);
      assert.equal(noGitHealth.installed, false);
      assert.equal(noGitHealth.isGitRepo, false);
      assert.throws(() => installHooks({ repoRoot: noGit }), /Not a git repository/i);
    } finally {
      fs.rmSync(noGit, { recursive: true, force: true });
    }

    const beforeHealth = inspectHooksHealth(repoDir);
    assert.equal(beforeHealth.installed, false);
    assert.equal(beforeHealth.missingHooks.length, 3);

    const installed = installHooks({ repoRoot: repoDir });
    assert.equal(installed.success, true);
    assert.equal(installed.installed.length, 3);

    const healthy = inspectHooksHealth(repoDir);
    assert.equal(healthy.isGitRepo, true);
    assert.equal(healthy.installed, true);
    assert.equal(healthy.upToDate, true);
    assert.equal(healthy.missingHooks.length, 0);
    assert.equal(healthy.details.every((d) => d.present === true && d.upToDate === true && d.expectedHash === d.actualHash), true);
    assert.ok((fs.statSync(path.join(repoDir, '.git/hooks/pre-commit')).mode & 0o111) !== 0);

    // Tamper hook content
    fs.appendFileSync(path.join(repoDir, '.git/hooks/pre-commit'), '# tampered\n', 'utf8');
    const tampered = inspectHooksHealth(repoDir);
    assert.equal(tampered.upToDate, false);
    assert.ok(tampered.outdatedHooks.includes('pre-commit'));

    // Removing a hook reports missingHooks & installed=false
    fs.rmSync(path.join(repoDir, '.git/hooks/pre-push'));
    const missingPush = inspectHooksHealth(repoDir);
    assert.equal(missingPush.installed, false);
    assert.ok(missingPush.missingHooks.includes('pre-push'));
  });

  it('applies branch protection payload via gh mock and falls back locally on failure', () => {
    const calls = [];
    const okRes = applyBranchProtection({
      branches: ['main', 'develop'],
      requiredChecks: [DEFAULT_QUALITY_GATE_CHECK],
      enforceAdmins: false,
      repoRoot: repoDir,
      execFn: (bin, args, opts) => {
        calls.push({ bin, args, opts });
        return '';
      }
    });
    assert.equal(okRes.localHookInstalled, true);
    assert.equal(okRes.errors.length, 0);
    assert.equal(okRes.protectedBranches.every((b) => b.remoteProtected === true), true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].bin, 'gh');
    assert.match(calls[0].args[3], /branches\/main\/protection$/);
    const payload = JSON.parse(calls[0].opts.input);
    assert.equal(payload.required_status_checks.strict, true);
    assert.deepEqual(payload.required_status_checks.contexts, [DEFAULT_QUALITY_GATE_CHECK]);
    assert.equal(payload.enforce_admins, false);
    assert.equal(payload.required_pull_request_reviews.dismiss_stale_reviews, true);
    assert.equal(okRes.protectedBranches[0].remoteProtected, true);
    assert.equal(okRes.protectedBranches[0].enforceAdmins, false);

    const failRes = applyBranchProtection({
      branches: ['main'],
      requiredChecks: ['custom-check'],
      repoRoot: repoDir,
      execFn: () => {
        throw new Error('offline');
      }
    });
    assert.equal(failRes.protectedBranches[0].remoteProtected, false);
    assert.equal(failRes.protectedBranches[0].localProtected, true);
    assert.equal(failRes.localHookInstalled, true);
  });

  it('handles legacy session state, receipt-only commit parent verification, and enforceAdmins default', () => {
    // Inactive / corrupted session blocks commit guard
    fs.mkdirSync(path.join(repoDir, '.agent'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, '.agent/.sdlc-session.json'), JSON.stringify({ active: false, issueId: 1 }), 'utf8');
    assert.equal(verifyCommitGuard({ branch: 'feature/issue-#1', repoRoot: repoDir }).allowed, false);

    // Legacy single-session stage >= 2 allows commit on matching branch
    fs.writeFileSync(
      path.join(repoDir, '.agent/.sdlc-session.json'),
      JSON.stringify({ active: true, issueId: 14, branch: 'chore/issue-#14', stage: 3 }),
      'utf8'
    );
    const legacyOk = verifyCommitGuard({ branch: 'chore/issue-#14', repoRoot: repoDir });
    assert.equal(legacyOk.allowed, true);

    // Multi-commit receipt-only parent verification for verifyMergeGuard
    execFileSync('git', ['checkout', '-B', 'feature/issue-#55'], { cwd: repoDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(repoDir, 'app.mjs'), 'export const x = 1;\n', 'utf8');
    execFileSync('git', ['add', 'app.mjs'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'feat: add app'], { cwd: repoDir, stdio: 'pipe' });
    const codeSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();

    execFileSync('git', ['checkout', 'develop'], { cwd: repoDir, stdio: 'pipe' });
    issueGateReceipt({ issueId: 55, branch: 'feature/issue-#55', lane: 'trivial', headSha: codeSha, peerReviewApproved: true, driftCheckPassed: true, repoRoot: repoDir });

    execFileSync('git', ['checkout', 'feature/issue-#55'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['add', 'docs/AUDIT_CHAIN.jsonl'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'chore: record receipt'], { cwd: repoDir, stdio: 'pipe' });

    execFileSync('git', ['checkout', 'develop'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['merge', '--no-ff', '--no-commit', 'feature/issue-#55'], { cwd: repoDir, stdio: 'pipe' });
    const mergeGuardReceiptOnly = verifyMergeGuard({ sourceBranch: 'feature/issue-#55', repoRoot: repoDir });
    assert.equal(mergeGuardReceiptOnly.allowed, true);
    execFileSync('git', ['merge', '--abort'], { cwd: repoDir, stdio: 'pipe' });

    // Default enforceAdmins=true and default branches ['main', 'develop']
    const defCalls = [];
    const defRes = applyBranchProtection({
      repoRoot: repoDir,
      execFn: (bin, args, opts) => {
        defCalls.push(JSON.parse(opts.input));
        return '';
      }
    });
    assert.equal(defRes.protectedBranches.length, 2);
    assert.equal(defCalls[0].enforce_admins, true);
    assert.equal(defCalls[0].required_status_checks, null);
  });
});
