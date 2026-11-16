# CAP-01: Git Flow, Linked-Worktree Hygiene & 4-Layer Guard

- **Capability ID**: `CAP-01`
- **Governing Modules**: `.agent/scripts/lib/git.mjs` (Ring 0), `.agent/scripts/lib/guard.mjs` (Ring 2)
- **Enforced Invariants**: `INV-01`, `INV-02`, `INV-04`

## 1. Inputs
- Git repository root or linked `git worktree` working directory (`git rev-parse --git-common-dir` for hooks, `--show-toplevel` for working tree).
- Local session manifest `.agent/.sdlc-session.json` and branch target (`main`, `develop`, or feature/fix/chore branch).

## 2. Domain Rules
1. **Protected Branch Lock (`INV-01`)**: Direct commits, merges without a Stage 7 receipt, and pushes to `main` or `develop` fail closed across `pre-commit`, `pre-merge-commit`, and `pre-push` hooks.
2. **Active Session Binding (`INV-02`)**: Commits on non-protected branches require `.agent/.sdlc-session.json` with `branch` matching `HEAD`.
3. **Git Environment Sanitization**: All `git` subprocess calls strip `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY`, and `GIT_ALTERNATE_OBJECT_DIRECTORIES` (`cleanGitEnv`) and pass `-C <repoRoot> -c core.quotepath=false`.
4. **Docs-Only vs Code Classification**: Diffs are deterministically classified into `docs-only` or `code`; governance files (`PRODUCT.md`, `docs/PRD.md`, `docs/SRS.md`, `docs/specs/*`, `docs/adr/*`, `docs/AUDIT_CHAIN.jsonl`) and dependency/contract manifests never classify as `docs-only`.

## 3. Outputs & Acceptance Criteria
- SHA-256 verified hooks installed under `resolveGitCommonDir(repoRoot)/hooks/{pre-commit,pre-merge-commit,pre-push}` with `0755` permissions.
- `verifyMergeGuard` verifies exact `HEAD`, post-receipt `AUDIT_CHAIN.jsonl` commit, Squash `treeSha`, and 2-parent clean `--no-ff` merges while blocking evil merges.
