# CAP-01: Git Flow, Linked-Worktree Hygiene & 4-Layer Guard

- **Capability ID**: `CAP-01`
- **Governing Modules**: `.agent/scripts/lib/git.mjs` (Ring 0), `.agent/scripts/lib/guard.mjs` (Ring 2)
- **Enforced Invariants**: `INV-01`, `INV-02`, `INV-04`

## 1. Inputs
- Git repository root or linked `git worktree` working directory (`git rev-parse --git-common-dir` for hooks, `--show-toplevel` for working tree).
- Local session manifest `.agent/.sealit-session.json` and branch target (`main`, `develop`, or feature/fix/chore branch).

## 2. Domain Rules
1. **Protected Branch Lock (`INV-01`)**: Direct commits, merges without a Stage 7 receipt, and pushes to `main` or `develop` fail closed across `pre-commit`, `pre-merge-commit`, and `pre-push` hooks.
2. **Active Session & Worktree Base Binding (`INV-02`)**: Commits on non-protected branches require `.agent/.sealit-session.json` with `branch` matching `HEAD`. `beginSession` supports `--worktree <dir>` and optional `--base <branch>` (validated with `check-ref-format --branch` and commit resolution) so parallel vertical-slice worktrees branch from and diff against an integration or feature branch cleanly across `git >= 2.38`.
3. **Git Plumbing & Case-Exact Tree Paths (`ADR-020`)**: Authoritative verification reads immutable commit objects via `git >= 2.38` plumbing (`diff-tree`, `ls-tree -z`, `cat-file --batch`) with zero pathspecs, comparing tree paths case-exactly and rejecting non-`100644` modes (symlinks, gitlinks, executables) from `docs-only` classification. All `git` subprocess calls sanitize `GIT_*` environment variables (`cleanGitEnv`) and pass `-C <repoRoot> -c core.quotepath=false`.
4. **Docs-Only vs Code Classification & Per-Ref Pre-Push**: Diffs are deterministically classified into `docs-only` or `code`; governance files (`PRODUCT.md`, `docs/PRD.md`, `docs/SRS.md`, `docs/specs/*`, `docs/adr/*`, `docs/AUDIT_CHAIN.jsonl`) and dependency/contract manifests never classify as `docs-only`. `pre-push` evaluates each pushed `refs/heads/*` commit range independently (allowing tag pushes and failing closed on unreadable stdin).

## 3. Outputs & Acceptance Criteria
- SHA-256 verified hooks installed under `resolveGitHooksDir(repoRoot)/{pre-commit,pre-merge-commit,pre-push,post-merge}` with `0755` permissions.
- `verifyMergeGuard` verifies exact `HEAD`, post-receipt `AUDIT_CHAIN.jsonl` commit, Squash `treeSha`, and 2-parent clean `--no-ff` merges while blocking evil merges.
