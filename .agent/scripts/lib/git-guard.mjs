import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileExists, readFileSafe, hasDevelopBranch } from './core.mjs';
import { verifyGateReceipt } from './audit-chain.mjs';
import { checkSpecDrift } from './adr-drift.mjs';

const PROTECTED_BRANCHES = ['main', 'develop'];

function getCurrentGitBranch(repoRoot = '.') {
  try {
    return execFileSync('git', ['branch', '--show-current'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe'
    }).trim();
  } catch {
    return '';
  }
}

function readActiveSession(repoRoot = '.') {
  const sessionPath = path.resolve(repoRoot, '.agent/.sdlc-session.json');
  if (!fileExists(sessionPath)) return null;
  try {
    const data = JSON.parse(readFileSafe(sessionPath));
    if (data.sessions && typeof data.sessions === 'object') {
      return data.activeSessionId ? data.sessions[data.activeSessionId] : null;
    }
    return data.active ? data : null;
  } catch {
    return null;
  }
}

/**
 * Layer 1 & Layer 2 Commit Guard:
 * 1. Blocks direct commits on protected branches (`main`, `develop`).
 * 2. Requires an active `.agent/.sdlc-session.json` matching the current branch (`stage >= 2`).
 */
export function verifyCommitGuard({ branch = null, repoRoot = '.' } = {}) {
  const activeBranch = branch || getCurrentGitBranch(repoRoot) || 'main';

  // Layer 1: Protected Branch Block
  if (PROTECTED_BRANCHES.includes(activeBranch)) {
    return {
      allowed: false,
      layer: 'LAYER_1_PROTECTED_BRANCH',
      branch: activeBranch,
      message: `🛑 [SDLC Layer 1 Guard] DIRECT COMMITS TO '${activeBranch}' ARE FORBIDDEN! Create a feature branch via sdlc-flow.`
    };
  }

  // Layer 2: Active SDLC Session Lock Required
  const session = readActiveSession(repoRoot);
  if (!session || !session.active) {
    return {
      allowed: false,
      layer: 'LAYER_2_SESSION_REQUIRED',
      branch: activeBranch,
      message: `🛑 [SDLC Layer 2 Guard] No active SDLC session found in .agent/.sdlc-session.json. Run: node .agent/scripts/sdlc-engine.mjs stage begin --issue <id> --branch ${activeBranch}`
    };
  }

  if (session.branch && session.branch !== activeBranch) {
    return {
      allowed: false,
      layer: 'LAYER_2_BRANCH_MISMATCH',
      branch: activeBranch,
      sessionBranch: session.branch,
      message: `🛑 [SDLC Layer 2 Guard] Active SDLC session (#${session.issueId}) is locked to '${session.branch}', but current branch is '${activeBranch}'.`
    };
  }

  if (Number(session.stage || 1) < 2) {
    return {
      allowed: false,
      layer: 'LAYER_2_STAGE_NOT_READY',
      branch: activeBranch,
      stage: session.stage,
      message: `🛑 [SDLC Layer 2 Guard] Session #${session.issueId} is on Stage 1 (Intake). Advance to Stage 2+ before committing.`
    };
  }

  return {
    allowed: true,
    layer: 'PASSED',
    branch: activeBranch,
    issueId: session.issueId,
    stage: session.stage
  };
}

/**
 * Layer 3 Merge Guard:
 * Blocks local merges into `main` or `develop` unless backed by a signed
 * Stage 7 Cryptographic Gate Receipt in `docs/AUDIT_CHAIN.jsonl`.
 */
export function verifyMergeGuard({
  targetBranch = null,
  sourceBranch = null,
  sourceSha = null,
  repoRoot = '.'
} = {}) {
  const currentTarget = targetBranch || getCurrentGitBranch(repoRoot) || 'main';

  if (!PROTECTED_BRANCHES.includes(currentTarget)) {
    return {
      allowed: true,
      targetBranch: currentTarget,
      message: `Merge into non-protected branch '${currentTarget}' permitted.`
    };
  }

  if (currentTarget === 'main' && hasDevelopBranch(repoRoot) && sourceBranch && sourceBranch !== 'develop') {
    return {
      allowed: false,
      layer: 'LAYER_3_GIT_FLOW_BRANCH_POLICY',
      reasonCode: 'DIRECT_MERGE_TO_MAIN_FORBIDDEN',
      targetBranch: currentTarget,
      sourceBranch,
      message: `🛑 [SDLC Branch Policy] Merges into 'main' must originate exclusively from 'develop'. Direct merges from '${sourceBranch}' are forbidden.`
    };
  }

  const receiptCheck = verifyGateReceipt({
    headSha: sourceSha,
    branch: currentTarget === 'main' && sourceBranch === 'develop' && sourceSha ? null : sourceBranch,
    repoRoot
  });

  if (!receiptCheck.valid) {
    return {
      allowed: false,
      layer: 'LAYER_3_GATE_RECEIPT_REQUIRED',
      reasonCode: 'MISSING_STAGE_7_GATE_RECEIPT',
      targetBranch: currentTarget,
      sourceBranch,
      message: `🛑 [SDLC Layer 3 Merge Guard] Cannot merge into '${currentTarget}': ${receiptCheck.reason}`
    };
  }

  return {
    allowed: true,
    layer: 'PASSED',
    targetBranch: currentTarget,
    receipt: receiptCheck.receipt
  };
}

/**
 * Layer 3 & 4 Push Guard:
 * Blocks direct pushes to `main`/`develop` and verifies Spec-Drift Sentinel.
 */
export function verifyPushGuard({ remoteBranch = null, repoRoot = '.' } = {}) {
  const target = remoteBranch || getCurrentGitBranch(repoRoot) || '';
  if (PROTECTED_BRANCHES.includes(target)) {
    return {
      allowed: false,
      layer: 'LAYER_3_PROTECTED_PUSH',
      branch: target,
      message: `🛑 [SDLC Push Guard] DIRECT PUSHES TO '${target}' ARE FORBIDDEN!`
    };
  }

  const session = readActiveSession(repoRoot);
  const driftRes = checkSpecDrift({
    ticketId: session?.issueId || null,
    repoRoot
  });

  if (!driftRes.passed) {
    return {
      allowed: false,
      layer: 'LAYER_3_UNDECLARED_SPEC_DRIFT',
      branch: target,
      drift: driftRes,
      message: `🛑 [SDLC Push Guard] ${driftRes.message}\n👉 Run: ${driftRes.remediationCommand}`
    };
  }

  return {
    allowed: true,
    layer: 'PASSED',
    branch: target
  };
}

export function buildHookTemplates() {
  const preCommitHook = `#!/usr/bin/env bash
# Agentic SDLC Framework: 4-Layer Pre-Commit Guard (Branch & Active Session Lock)
set -e

if git diff --cached --quiet; then
  exit 0
fi

  if [ -f ".agent/scripts/sdlc-engine.mjs" ]; then
    node .agent/scripts/sdlc-engine.mjs guard pre-commit
  fi
`;

  const preMergeCommitHook = `#!/usr/bin/env bash
# Agentic SDLC Framework: Layer 3 Pre-Merge-Commit Signed Gate Receipt Guard
set -e

if [ -f ".agent/scripts/sdlc-engine.mjs" ]; then
  node .agent/scripts/sdlc-engine.mjs guard pre-merge
fi
`;

  const prePushHook = `#!/usr/bin/env bash
# Agentic SDLC Framework: Strict Pre-Push Quality Gate, Spec-Drift & Branch Protection
set -e

while read local_ref local_sha remote_ref remote_sha
do
  remote_branch=$(echo "$remote_ref" | sed 's@refs/heads/@@')
  if [ "$remote_branch" = "develop" ] || [ "$remote_branch" = "main" ]; then
    echo "🛑 [SDLC Branch Protection] DIRECT PUSHES TO '$remote_branch' ARE FORBIDDEN!"
    echo "👉 Hard Framework Invariant: All changes must be pushed to a feature or arch branch (e.g. 'feature/issue-#<id>-<name>') and merged via Pull Request."
    exit 1
  fi
done

echo "🛡️ [SDLC Hook] Verifying Universal Quality Gate & Spec-Drift Sentinel before push..."
if [ -f ".agent/scripts/sdlc-engine.mjs" ]; then
  node .agent/scripts/sdlc-engine.mjs guard pre-push
  node .agent/scripts/sdlc-engine.mjs gate
fi
`;

  return {
    'pre-commit': preCommitHook,
    'pre-merge-commit': preMergeCommitHook,
    'pre-push': prePushHook
  };
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function resolveGitHooksDir(repoRoot = '.') {
  const gitDir = path.resolve(repoRoot, '.git');
  try {
    const customHooksPath = execFileSync('git', ['config', '--get', 'core.hooksPath'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe'
    }).trim();
    if (customHooksPath) {
      return path.resolve(repoRoot, customHooksPath);
    }
  } catch {}
  return path.resolve(gitDir, 'hooks');
}

export function inspectHooksHealth(repoRoot = '.') {
  const gitDir = path.resolve(repoRoot, '.git');
  if (!fs.existsSync(gitDir)) {
    return {
      isGitRepo: false,
      hooksDir: null,
      installed: false,
      upToDate: false,
      missingHooks: ['pre-commit', 'pre-merge-commit', 'pre-push'],
      outdatedHooks: [],
      details: []
    };
  }

  const hooksDir = resolveGitHooksDir(repoRoot);
  const templates = buildHookTemplates();
  const missingHooks = [];
  const outdatedHooks = [];
  const details = [];

  for (const [name, expectedContent] of Object.entries(templates)) {
    const hookPath = path.resolve(hooksDir, name);
    const expectedHash = sha256Text(expectedContent);
    if (!fs.existsSync(hookPath)) {
      missingHooks.push(name);
      details.push({ name, present: false, upToDate: false, expectedHash, actualHash: null });
      continue;
    }
    const actualContent = fs.readFileSync(hookPath, 'utf8');
    const actualHash = sha256Text(actualContent);
    const matches = actualHash === expectedHash;
    if (!matches) outdatedHooks.push(name);
    details.push({ name, present: true, upToDate: matches, expectedHash, actualHash });
  }

  return {
    isGitRepo: true,
    hooksDir,
    installed: missingHooks.length === 0,
    upToDate: missingHooks.length === 0 && outdatedHooks.length === 0,
    missingHooks,
    outdatedHooks,
    details
  };
}

export function installHooks({ repoRoot = '.' } = {}) {
  console.log('🪝 Configuring 4-Layer Git Hooks (client-side; bypassable with --no-verify, pair with server-side branch protection) for Agentic SDLC...');
  const gitDir = path.resolve(repoRoot, '.git');
  if (!fs.existsSync(gitDir)) {
    throw new Error('Not a git repository. Cannot install git hooks.');
  }

  const hooksDir = resolveGitHooksDir(repoRoot);
  fs.mkdirSync(hooksDir, { recursive: true });

  const templates = buildHookTemplates();
  const installedPaths = [];
  for (const [name, content] of Object.entries(templates)) {
    const hookPath = path.resolve(hooksDir, name);
    fs.writeFileSync(hookPath, content, 'utf8');
    try {
      fs.chmodSync(hookPath, 0o755);
    } catch {}
    installedPaths.push(hookPath);
  }

  console.log('✅ Installed 4-Layer Git hooks:');
  for (const p of installedPaths) {
    console.log(`   • ${p}`);
  }

  const names = Object.keys(templates);
  return {
    success: true,
    installed: names,
    allHooksInstalled: names,
    hooksDir
  };
}

export const DEFAULT_QUALITY_GATE_CHECK = 'Universal Quality Gate, Spec-Drift & Merkle Receipt Defense';

/**
 * Installs local 4-Layer Git hooks and applies GitHub remote branch protection
 * with required quality-gate status checks and admin enforcement.
 */
export function applyBranchProtection({
  branches = ['main', 'develop'],
  requiredChecks = undefined,
  enforceAdmins = true,
  requiredApprovals = 0,
  repoRoot = '.',
  execFn = execFileSync
} = {}) {
  const results = {
    localHookInstalled: false,
    protectedBranches: [],
    errors: []
  };

  try {
    const hookRes = installHooks({ repoRoot });
    results.localHookInstalled = hookRes.success;
  } catch (err) {
    results.errors.push(`Local hook error: ${err.message}`);
  }

  const hasGateWorkflow = fs.existsSync(path.resolve(repoRoot, '.github/workflows/sdlc-quality-gate.yml'));
  const resolvedChecks = Array.isArray(requiredChecks)
    ? requiredChecks.filter(Boolean)
    : hasGateWorkflow
      ? [DEFAULT_QUALITY_GATE_CHECK]
      : [];

  const approvalsCount = Math.max(0, Number(requiredApprovals) || 0);
  const protectionPayload = {
    required_status_checks: resolvedChecks.length > 0 ? { strict: true, contexts: resolvedChecks } : null,
    enforce_admins: Boolean(enforceAdmins),
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      require_code_owner_reviews: false,
      required_approving_review_count: approvalsCount
    },
    restrictions: null
  };

  for (const b of branches) {
    try {
      execFn(
        'gh',
        [
          'api',
          '--method',
          'PUT',
          `repos/:owner/:repo/branches/${encodeURIComponent(b)}/protection`,
          '-H',
          'Accept: application/vnd.github+json',
          '--input',
          '-'
        ],
        {
          cwd: repoRoot,
          stdio: 'pipe',
          input: JSON.stringify(protectionPayload)
        }
      );
      results.protectedBranches.push({
        branch: b,
        remoteProtected: true,
        enforceAdmins: Boolean(enforceAdmins),
        requiredChecks: resolvedChecks
      });
    } catch {
      results.protectedBranches.push({ branch: b, remoteProtected: false, localProtected: true });
    }
  }

  return results;
}
