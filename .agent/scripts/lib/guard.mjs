import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  fileExists,
  getCurrentGitBranch,
  getModifiedFiles,
  gitExec,
  gitOutput,
  hasBranch,
  hasDevelopBranch,
  hasDirtyNonGovernanceFiles,
  isDocsOnlyDiff,
  normalizeTicketId,
  resolveDefaultBaseBranch,
  resolveGitCommonRepoRoot,
  resolveGitHooksDir,
  verifyCleanThreeWayMergeTrees
} from './git.mjs';
import { DEFAULT_QUALITY_GATE_CHECK, loadConfig } from './config.mjs';
import {
  issueGateReceipt,
  readActiveSession,
  readSessionStore,
  verifyGateReceipt,
  writeActiveSession
} from './receipt.mjs';
import { checkSpecDrift } from './drift.mjs';
import { scanDiffSecrets } from './measure.mjs';

export const PROTECTED_BRANCHES = Object.freeze(['main', 'master', 'develop']);

function slugifyBranchTitle(title) {
  return (
    String(title || 'work')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'work'
  );
}

function allocateNextLocalId(sessions = {}) {
  let maxN = 0;
  for (const key of Object.keys(sessions)) {
    const m = String(key).match(/^L-(\d+)$/i);
    if (m && Number(m[1]) > maxN) maxN = Number(m[1]);
  }
  return `L-${maxN + 1}`;
}

export function beginSession({
  issueId = null,
  title = 'change',
  type = 'feat',
  branch = null,
  checkout = false,
  worktree = null,
  repoRoot = '.'
} = {}) {
  const absRoot = path.resolve(repoRoot);
  const baseBranch = resolveDefaultBaseBranch(absRoot);
  const storePreview = readSessionStore(absRoot);
  const resolvedId = normalizeTicketId(issueId) || allocateNextLocalId(storePreview.sessions);

  const prefix = ['feat', 'fix', 'hotfix', 'chore', 'docs', 'refactor'].includes(String(type).toLowerCase())
    ? String(type).toLowerCase()
    : 'feat';
  const curBranch = getCurrentGitBranch(absRoot);
  const defaultBranchName = `${prefix}/${/^\d+$/.test(resolvedId) ? `issue-${resolvedId}` : resolvedId}-${slugifyBranchTitle(title)}`;
  const targetBranch =
    branch ||
    (!checkout && !worktree && curBranch && !PROTECTED_BRANCHES.includes(curBranch) ? curBranch : defaultBranchName);

  if (PROTECTED_BRANCHES.includes(targetBranch)) {
    return {
      success: false,
      error: `Cannot start session on protected branch '${targetBranch}'. Pass --checkout or switch to a feature branch.`
    };
  }
  if (targetBranch === 'HEAD' || targetBranch.startsWith('-')) {
    return { success: false, error: `Invalid branch name '${targetBranch}'.` };
  }
  const refCheck = gitExec(['check-ref-format', '--branch', targetBranch], absRoot);
  if (refCheck.error || refCheck.status !== 0) {
    return { success: false, error: `Invalid branch name '${targetBranch}'.` };
  }

  let resolvedWorktree = null;
  if (worktree) {
    resolvedWorktree = path.resolve(absRoot, worktree);
    fs.mkdirSync(path.dirname(resolvedWorktree), { recursive: true });
    const wtArgs = hasBranch(targetBranch, absRoot)
      ? ['worktree', 'add', resolvedWorktree, targetBranch]
      : ['worktree', 'add', '-b', targetBranch, resolvedWorktree, baseBranch];
    const wtRes = gitExec(wtArgs, absRoot);
    if (wtRes.error || wtRes.status !== 0) {
      return { success: false, error: `Failed to create git worktree: ${wtRes.stderr || wtRes.error?.message}` };
    }
  } else if (checkout && curBranch !== targetBranch) {
    const coArgs = hasBranch(targetBranch, absRoot) ? ['checkout', '--end-of-options', targetBranch] : ['checkout', '-b', targetBranch];
    const coRes = gitExec(coArgs, absRoot);
    if (coRes.error || coRes.status !== 0) {
      return { success: false, error: `Failed to checkout branch '${targetBranch}': ${coRes.stderr || coRes.error?.message}` };
    }
  }

  const now = new Date().toISOString();
  let savedSession = null;
  writeActiveSession(absRoot, (store) => {
    const prev = store.sessions[resolvedId] || {};
    savedSession = {
      active: true,
      issueId: resolvedId,
      title: String(title || prev.title || '').trim() || null,
      type: prefix,
      branch: targetBranch,
      baseBranch,
      worktree: resolvedWorktree || prev.worktree || null,
      peerReview: prev.peerReview || null,
      lastGate: prev.lastGate || null,
      startedAt: prev.startedAt || now,
      updatedAt: now
    };
    store.sessions[resolvedId] = savedSession;
    store.activeSessionId = resolvedId;
    return store;
  });

  return { success: true, session: savedSession, branch: targetBranch, worktree: resolvedWorktree };
}

export function getSessionStatus(repoRoot = '.') {
  const branch = getCurrentGitBranch(repoRoot);
  const session = readActiveSession(repoRoot, branch);
  const baseBranch = session?.baseBranch || null;
  const modifiedFiles = getModifiedFiles(baseBranch, repoRoot);
  const mode = modifiedFiles.length > 0 && isDocsOnlyDiff(modifiedFiles) ? 'docs-only' : 'code';
  const drift = checkSpecDrift({ ticketId: session?.issueId || null, baseBranch, repoRoot });
  const headSha = (gitOutput(['rev-parse', '--verify', 'HEAD'], repoRoot) || '').trim() || null;
  const dirty = hasDirtyNonGovernanceFiles(repoRoot, { allowAuditChain: true });

  const gateFresh = Boolean(session?.lastGate?.passed && !dirty && headSha && session.lastGate.headSha === headSha);
  const reviewOk = mode === 'docs-only' || Boolean(session?.peerReview?.verdict === 'approve' && session.peerReview.headSha === headSha);

  return {
    active: Boolean(session),
    branch,
    headSha,
    dirty,
    mode,
    modifiedFiles,
    drift,
    session,
    readyForReceipt: Boolean(session && gateFresh && reviewOk && drift.passed)
  };
}

export function recordReviewVerdict({
  verdict,
  reviewer = '@sdlc-gate',
  prNumber = null,
  notes = '',
  peerReview = '',
  archReview = '',
  repoRoot = '.',
  execFn = execFileSync
} = {}) {
  const normVerdict = String(verdict || '').toLowerCase().trim();
  if (normVerdict !== 'approve' && normVerdict !== 'request-changes') {
    return { success: false, reason: `Invalid --verdict '${verdict}'. Expected 'approve' or 'request-changes'.` };
  }

  if (normVerdict === 'approve' && hasDirtyNonGovernanceFiles(repoRoot, { allowAuditChain: true })) {
    return {
      success: false,
      reason: 'Cannot record an approved review on a dirty working tree. Commit or stash changes first.'
    };
  }

  const branch = getCurrentGitBranch(repoRoot);
  const active = readActiveSession(repoRoot, branch);
  if (!active) {
    return { success: false, reason: `No active session found for branch '${branch}'.` };
  }

  const headSha = (gitOutput(['rev-parse', '--verify', 'HEAD'], repoRoot) || '').trim() || null;
  const combinedNotes = [notes, peerReview, archReview].map((s) => String(s || '').trim()).filter(Boolean).join('\n\n');
  const reviewObj = {
    verdict: normVerdict,
    reviewer: String(reviewer || '@sdlc-gate').trim(),
    headSha,
    notes: combinedNotes || null,
    recordedAt: new Date().toISOString()
  };

  writeActiveSession(repoRoot, (store) => {
    const key = String(active.issueId);
    if (store.sessions[key]) {
      store.sessions[key].peerReview = reviewObj;
      store.sessions[key].updatedAt = reviewObj.recordedAt;
    }
    return store;
  });

  let receiptRes = null;
  if (normVerdict === 'approve') {
    receiptRes = issueGateReceipt({ repoRoot, reviewerOverride: reviewObj.reviewer });
    if (!receiptRes.success) {
      return { success: false, review: reviewObj, reason: receiptRes.reason };
    }
  }

  let prCommented = false;
  if (prNumber) {
    if (!/^[1-9]\d*$/.test(String(prNumber).trim())) {
      return { success: false, review: reviewObj, reason: `Invalid pull request number '${prNumber}'.` };
    }
    const summaryBody = [
      `### SDLC Gate Review (${normVerdict.toUpperCase()})`,
      `- **Ticket**: \`${active.issueId}\` | **Branch**: \`${branch}\` | **Commit**: \`${headSha?.slice(0, 8) || 'unknown'}\``,
      `- **Reviewer**: \`${reviewObj.reviewer}\``,
      ...(receiptRes?.receipt ? [`- **Signed Receipt**: \`${receiptRes.receipt.receiptId}\``] : []),
      ...(combinedNotes ? ['', combinedNotes] : [])
    ].join('\n');
    execFn('gh', ['pr', 'comment', String(prNumber), '--body', summaryBody], {
      cwd: path.resolve(repoRoot),
      stdio: 'pipe',
      encoding: 'utf8'
    });
    prCommented = true;
  }

  return {
    success: true,
    review: reviewObj,
    receipt: receiptRes?.receipt || null,
    prCommented
  };
}

export function endSession({ issueId = null, repoRoot = '.' } = {}) {
  const absRoot = path.resolve(repoRoot);
  const curBranch = getCurrentGitBranch(absRoot);
  let worktreeToClean = null;
  let closedId = null;

  writeActiveSession(absRoot, (store) => {
    const targetId =
      normalizeTicketId(issueId) ||
      Object.keys(store.sessions || {}).find((k) => store.sessions[k]?.branch === curBranch && store.sessions[k]?.active !== false) ||
      store.activeSessionId;
    if (!targetId || !store.sessions[targetId]) return store;

    closedId = String(targetId);
    worktreeToClean = store.sessions[closedId].worktree || null;
    store.sessions[closedId].active = false;
    store.sessions[closedId].endedAt = new Date().toISOString();

    // Only update activeSessionId if we just closed the currently active session!
    if (String(store.activeSessionId) === closedId) {
      const nextOpen = Object.keys(store.sessions).find((k) => store.sessions[k]?.active !== false);
      store.activeSessionId = nextOpen || null;
    }
    return store;
  });

  if (!closedId) {
    return { success: false, error: 'No matching active session found to close.' };
  }

  let worktreeRemoved = false;
  let worktreePreservedReason = null;
  if (worktreeToClean && fileExists(worktreeToClean)) {
    const commonRoot = resolveGitCommonRepoRoot(absRoot);
    // Never pass --force: preserve uncommitted user files!
    const rmRes = gitExec(['worktree', 'remove', '--', worktreeToClean], commonRoot);
    if (!rmRes.error && rmRes.status === 0) {
      worktreeRemoved = true;
      gitExec(['worktree', 'prune'], commonRoot);
    } else {
      worktreePreservedReason = (rmRes.stderr || rmRes.error?.message || 'Worktree contains uncommitted files').trim();
    }
  }

  return {
    success: true,
    issueId: closedId,
    worktreeRemoved,
    worktreePreservedReason
  };
}

export function verifyCommitGuard({ repoRoot = '.' } = {}) {
  const branch = getCurrentGitBranch(repoRoot);
  if (PROTECTED_BRANCHES.includes(branch)) {
    return {
      allowed: false,
      layer: 'LAYER_1_PROTECTED_BRANCH',
      branch,
      message: `Direct commits to '${branch}' are forbidden (INV-01). Run 'sdlc begin --checkout' to work on a feature branch.`
    };
  }
  const session = readActiveSession(repoRoot, branch);
  if (!session || session.branch !== branch) {
    return {
      allowed: false,
      layer: 'LAYER_2_MISSING_SESSION',
      branch,
      message: `No active SDLC session bound to branch '${branch}' (INV-02). Run 'sdlc begin --title "<desc>"' first.`
    };
  }
  return { allowed: true, layer: 'PASSED', branch, issueId: session.issueId };
}

function resolveMergeSourceState(repoRoot = '.', explicitSha = null, explicitBranch = null) {
  let sha = explicitSha ? String(explicitSha).trim() : null;
  let branch = explicitBranch ? String(explicitBranch).trim() : null;

  if (!sha) {
    sha = (gitOutput(['rev-parse', '--verify', '-q', 'MERGE_HEAD'], repoRoot) || '').trim() || null;
  }

  // Always inspect GITHEAD_<sha> and GIT_REFLOG_ACTION for branch name even when MERGE_HEAD resolved sha!
  const gitHeadEntry = Object.entries(process.env).find(([k]) => /^GITHEAD_[0-9a-f]{40}$/i.test(k));
  if (gitHeadEntry) {
    if (!sha) sha = gitHeadEntry[0].slice('GITHEAD_'.length).toLowerCase();
    if (!branch && gitHeadEntry[1]) branch = String(gitHeadEntry[1]).trim();
  }

  if ((!sha || !branch) && process.env.GIT_REFLOG_ACTION) {
    const m = /^merge\s+(.+)$/i.exec(String(process.env.GIT_REFLOG_ACTION).trim());
    if (m && m[1]) {
      const refName = m[1].trim();
      if (!branch) branch = refName;
      if (!sha) {
        sha = (gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', `${refName}^{commit}`], repoRoot) || '').trim() || null;
      }
    }
  }

  if (!sha && !branch) {
    sha =
      (gitOutput(['rev-parse', '--verify', '-q', 'HEAD^2'], repoRoot) || '').trim() ||
      (gitOutput(['rev-parse', '--verify', '-q', 'HEAD'], repoRoot) || '').trim() ||
      null;
  }
  return { sourceSha: sha, sourceBranch: branch };
}

export function verifyMergeGuard({ targetBranch = null, sourceBranch = null, sourceSha = null, repoRoot = '.' } = {}) {
  const currentTarget = targetBranch || getCurrentGitBranch(repoRoot) || 'main';
  if (!PROTECTED_BRANCHES.includes(currentTarget)) {
    return { allowed: true, targetBranch: currentTarget, message: `Merge into '${currentTarget}' permitted.` };
  }

  const { sourceSha: resolvedSha, sourceBranch: resolvedBranch } = resolveMergeSourceState(repoRoot, sourceSha, sourceBranch);

  if ((currentTarget === 'main' || currentTarget === 'master') && hasDevelopBranch(repoRoot)) {
    if (resolvedBranch && resolvedBranch !== 'develop' && resolvedBranch !== 'origin/develop') {
      return {
        allowed: false,
        layer: 'LAYER_3_GIT_FLOW_BRANCH_POLICY',
        reasonCode: 'DIRECT_MERGE_TO_MAIN_FORBIDDEN',
        targetBranch: currentTarget,
        sourceBranch: resolvedBranch,
        message: `Merges into '${currentTarget}' must originate exclusively from 'develop' (got '${resolvedBranch}').`
      };
    }
    if (resolvedSha) {
      const devSha = (
        gitOutput(['rev-parse', '--verify', '-q', 'refs/heads/develop'], repoRoot) ||
        gitOutput(['rev-parse', '--verify', '-q', 'refs/remotes/origin/develop'], repoRoot) ||
        ''
      ).trim();
      if (devSha && resolvedSha !== devSha) {
        return {
          allowed: false,
          layer: 'LAYER_3_GIT_FLOW_BRANCH_POLICY',
          reasonCode: 'DIRECT_MERGE_TO_MAIN_FORBIDDEN',
          targetBranch: currentTarget,
          sourceBranch: resolvedBranch || resolvedSha,
          message: `Merges into '${currentTarget}' must originate exclusively from 'develop' (${devSha.slice(0, 7)}).`
        };
      }
    }
  }

  // When MERGE_HEAD is active during pre-merge-commit, verify staged index tree matches clean 3-way merge
  const mergeHeadPresent = Boolean((gitOutput(['rev-parse', '--verify', '-q', 'MERGE_HEAD'], repoRoot) || '').trim());
  if (mergeHeadPresent && resolvedSha) {
    const indexTree = (gitOutput(['write-tree'], repoRoot) || '').trim();
    const mbSha = (gitOutput(['merge-base', '--end-of-options', 'HEAD', resolvedSha], repoRoot) || '').trim();
    if (!indexTree || !mbSha || !verifyCleanThreeWayMergeTrees({ mbSha, p1Ref: 'HEAD', p2Ref: resolvedSha, targetRef: indexTree, repoRoot })) {
      return {
        allowed: false,
        layer: 'LAYER_3_DIRTY_MERGE_INDEX',
        reasonCode: 'EVIL_MERGE_INDEX_DETECTED',
        targetBranch: currentTarget,
        sourceBranch: resolvedBranch,
        message: `Cannot merge into '${currentTarget}': staged merge index introduces modifications outside clean 3-way merge.`
      };
    }
  }

  const receiptCheck = verifyGateReceipt({
    headSha: resolvedSha,
    branch: currentTarget === 'main' && resolvedBranch === 'develop' ? null : resolvedBranch,
    repoRoot
  });

  if (!receiptCheck.valid) {
    return {
      allowed: false,
      layer: 'LAYER_3_GATE_RECEIPT_REQUIRED',
      reasonCode: 'MISSING_STAGE_7_GATE_RECEIPT',
      targetBranch: currentTarget,
      sourceBranch: resolvedBranch,
      message: `Cannot merge into '${currentTarget}': ${receiptCheck.reason}`
    };
  }

  return { allowed: true, layer: 'PASSED', targetBranch: currentTarget, receipt: receiptCheck.receipt };
}

export function verifyPushGuard({ remoteBranch = null, stdinText = '', repoRoot = '.' } = {}) {
  for (const line of String(stdinText || '').replace(/\r\n/g, '\n').split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 3 && parts[2].startsWith('refs/heads/')) {
      const destBranch = parts[2].slice('refs/heads/'.length);
      if (PROTECTED_BRANCHES.includes(destBranch)) {
        return {
          allowed: false,
          layer: 'LAYER_4_PROTECTED_PUSH',
          branch: destBranch,
          message: `Direct pushes to '${destBranch}' via refspec are forbidden (INV-01).`
        };
      }
    }
  }
  const target = remoteBranch || getCurrentGitBranch(repoRoot) || '';
  if (PROTECTED_BRANCHES.includes(target)) {
    return {
      allowed: false,
      layer: 'LAYER_4_PROTECTED_PUSH',
      branch: target,
      message: `Direct pushes to '${target}' are forbidden (INV-01).`
    };
  }

  const secrets = scanDiffSecrets(repoRoot, { runNpmAudit: false });
  if (!secrets.passed) {
    const details = secrets.secretViolations.map((v) => `${v.file} (${v.pattern || v.type})`).join(', ');
    return {
      allowed: false,
      layer: 'LAYER_4_SECRET_LEAK',
      branch: target,
      secrets,
      message: `Push blocked: secret leak or scan error detected in diff: ${details}`
    };
  }

  const session = readActiveSession(repoRoot, target);
  const drift = checkSpecDrift({ ticketId: session?.issueId || null, repoRoot });
  if (!drift.passed) {
    return {
      allowed: false,
      layer: 'LAYER_4_UNDECLARED_SPEC_DRIFT',
      branch: target,
      drift,
      message: `Push blocked: ${drift.message}${drift.remediationCommand ? `\nRun: ${drift.remediationCommand}` : ''}`
    };
  }

  return { allowed: true, layer: 'PASSED', branch: target };
}

export function postMergeCleanup({ repoRoot = '.' } = {}) {
  const curBranch = getCurrentGitBranch(repoRoot);
  if (!PROTECTED_BRANCHES.includes(curBranch)) return { cleaned: 0 };
  let cleaned = 0;
  writeActiveSession(repoRoot, (store) => {
    for (const sess of Object.values(store.sessions || {})) {
      if (!sess || sess.active === false || !sess.branch) continue;
      const merged = gitExec(['merge-base', '--is-ancestor', `refs/heads/${sess.branch}`, 'HEAD'], repoRoot);
      if (!merged.error && merged.status === 0) {
        sess.active = false;
        sess.endedAt = new Date().toISOString();
        cleaned++;
      }
    }
    return store;
  });
  return { cleaned };
}

const HOOK_RUNNER_SNIPPET = (sub) => `#!/usr/bin/env bash
# @fmatar/agentic-sdlc v0.1.0 4-Layer Git Guard (${sub})
set -e
if [ -f ".agent/scripts/sdlc-engine.mjs" ]; then
  node .agent/scripts/sdlc-engine.mjs guard ${sub}
elif [ -f "$HOME/.agentic-sdlc/scripts/sdlc-engine.mjs" ]; then
  node "$HOME/.agentic-sdlc/scripts/sdlc-engine.mjs" guard ${sub}
elif command -v sdlc >/dev/null 2>&1; then
  sdlc guard ${sub}
fi
`;

export function buildHookTemplates() {
  return {
    'pre-commit': HOOK_RUNNER_SNIPPET('pre-commit'),
    'pre-merge-commit': HOOK_RUNNER_SNIPPET('pre-merge'),
    'pre-push': HOOK_RUNNER_SNIPPET('pre-push'),
    'post-merge': HOOK_RUNNER_SNIPPET('post-merge')
  };
}

export function installHooks({ repoRoot = '.', fsImpl = fs } = {}) {
  const absRoot = path.resolve(repoRoot);
  if (!fileExists(path.join(absRoot, '.git'))) {
    throw new Error('Not a git repository. Cannot install git hooks.');
  }
  const hooksDir = resolveGitHooksDir(absRoot);
  fsImpl.mkdirSync(hooksDir, { recursive: true });
  const templates = buildHookTemplates();
  const installed = [];

  for (const [name, content] of Object.entries(templates)) {
    const hookPath = path.join(hooksDir, name);
    try {
      if (fsImpl.lstatSync && fsImpl.lstatSync(hookPath).isSymbolicLink()) fsImpl.unlinkSync(hookPath);
    } catch {}
    fsImpl.writeFileSync(hookPath, content, 'utf8');
    if (process.platform !== 'win32') {
      fsImpl.chmodSync(hookPath, 0o755);
    }
    installed.push(name);
  }
  return { success: true, installed, hooksDir };
}

export function inspectHooks(repoRoot = '.') {
  const hooksDir = resolveGitHooksDir(repoRoot);
  const templates = buildHookTemplates();
  const missingHooks = [];
  const outdatedHooks = [];

  for (const [name, expected] of Object.entries(templates)) {
    const hookPath = path.join(hooksDir, name);
    if (!fileExists(hookPath)) {
      missingHooks.push(name);
      continue;
    }
    const actual = fs.readFileSync(hookPath, 'utf8');
    const expSha = crypto.createHash('sha256').update(expected).digest('hex');
    const actSha = crypto.createHash('sha256').update(actual).digest('hex');
    const execOk = process.platform === 'win32' || (fs.statSync(hookPath).mode & 0o111) !== 0;
    if (expSha !== actSha || !execOk) {
      outdatedHooks.push(name);
    }
  }

  return {
    upToDate: missingHooks.length === 0 && outdatedHooks.length === 0,
    missingHooks,
    outdatedHooks,
    hooksDir
  };
}

export function applyBranchProtection({
  branches = ['main', 'develop'],
  requiredChecks = undefined,
  enforceAdmins = true,
  requiredApprovals = 0,
  repoRoot = '.',
  execFn = execFileSync
} = {}) {
  const hookRes = installHooks({ repoRoot });
  const { config } = loadConfig(repoRoot);
  const checkName = config?.ci?.checkName || DEFAULT_QUALITY_GATE_CHECK;
  const hasWorkflow = fileExists(path.resolve(repoRoot, '.github/workflows/sdlc-quality-gate.yml'));
  const checks = Array.isArray(requiredChecks) ? requiredChecks.filter(Boolean) : hasWorkflow ? [checkName] : [DEFAULT_QUALITY_GATE_CHECK];

  const payload = {
    required_status_checks: checks.length > 0 ? { strict: true, contexts: checks } : null,
    enforce_admins: Boolean(enforceAdmins),
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      require_code_owner_reviews: false,
      required_approving_review_count: Math.max(0, Number(requiredApprovals) || 0)
    },
    restrictions: null
  };

  const protectedBranches = [];
  const errors = [];
  for (const b of branches) {
    try {
      execFn(
        'gh',
        ['api', '--method', 'PUT', `repos/:owner/:repo/branches/${encodeURIComponent(b)}/protection`, '-H', 'Accept: application/vnd.github+json', '--input', '-'],
        { cwd: path.resolve(repoRoot), stdio: 'pipe', input: JSON.stringify(payload) }
      );
      protectedBranches.push({ branch: b, remoteProtected: true, requiredChecks: checks });
    } catch (err) {
      errors.push(`Remote branch protection failed for '${b}': ${err.message}`);
      protectedBranches.push({ branch: b, remoteProtected: false, localProtected: true });
    }
  }

  return {
    success: hookRes.success && errors.length === 0,
    localHookInstalled: hookRes.success,
    protectedBranches,
    errors
  };
}
