---
name: sealit-flow
description: "Use when delivering a feature, bug fix, or wide refactor end-to-end across vertical slices, branch/worktree sessions, TDD, gate verification, and signed PR receipt."
---

# End-to-End Branch & Vertical-Slice Orchestrator (`sealit-flow`)

## When to use / When NOT to use
- **Use when** delivering a code or documentation change from branch setup (`begin`) through alignment, vertical-slice TDD, 2-axis review, `gate`, signed Stage 7 receipt, PR, and `end`.
- **Not for** read-only status checks or standalone greenfield discovery (`sealit-spec`).

## Kernel check
Check for `.agent/sealit-config.json` first. Without it, **stop**: governed branch sessions, `sealit gate`, Stage 7 review receipts, and `sealit verify` require the Proof Kernel—offer to run `/sealit init` (or use `sealit-spec` / `sealit-tdd` directly for standalone un-gated work).

## Core Invariants & Slicing Strategy
1. **Git Flow (`INV-01`)**: Never commit, merge, or push directly to `main` or `develop`. Feature/fix/chore PRs target `develop` (or `main` on trunk-only repos without `develop`); PRs targeting `main` originate exclusively from `develop` when `develop` exists.
2. **Tracer-Bullet Vertical Slicing**: Break multi-part work into narrow, end-to-end vertical slices that cut cleanly across necessary rings and stay verifiable on their own. Do any enabling prefactoring first.
3. **Wide Refactors Use Expand–Contract**: When a mechanical change spans too many callers for one vertical slice, sequence as **Expand** (add new interface beside old, tests green) $\rightarrow$ **Migrate** (move callers in bounded batches) $\rightarrow$ **Contract** (delete old form once unused).
4. **Optional Parallel Subagent Worktrees**: For independent slices in a task graph, spawn isolated read-only or implementer subagents (your harness's subagent tool, e.g. Claude Code's `Task`) using sparse **context pointers** (`PRODUCT.md`, `docs/specs/*`, `GLOSSARY.md`, commits), each bound to its own worktree against the feature/integration branch:
   ```bash
   node .agent/scripts/sealit-engine.mjs begin --issue <slice-id> --title "<slice>" --base <feature-branch> --worktree .worktrees/<slice-id>
   ```
   Merge completed slice branches cleanly into `<feature-branch>`, remove clean worktrees via `sealit end --issue <slice-id>`, and run the full `sealit gate --no-cache` + Stage 7 receipt once on `<feature-branch>`.

## End-to-End Delivery Steps (`begin -> slice TDD -> gate -> receipt -> PR -> end`)

```bash
# 1. Start feature branch & governed session
node .agent/scripts/sealit-engine.mjs begin --issue <id> --title "<short-desc>" --type <feat|fix|chore|refactor> --checkout

# 2. Align specs/GLOSSARY.md/ADRs if needed (sealit-spec / sealit-adr) & build vertical slices via TDD (sealit-tdd)
node .agent/scripts/sealit-engine.mjs drift
node .agent/scripts/sealit-engine.mjs test --affected-only

# 3. Run 2-axis cold review, commit any refactors, run single gate & sign receipt on clean HEAD (sealit-gate)
node .agent/scripts/sealit-engine.mjs gate --no-cache
# (docs-only: node .agent/scripts/sealit-engine.mjs receipt --docs-only)
# (code mode: run sealit-gate review plan -> review record --verdict approve)

# 4. Commit docs/AUDIT_CHAIN.jsonl, verify receipt, generate PR body -> open PR -> after merge, close session
node .agent/scripts/sealit-engine.mjs verify
node .agent/scripts/sealit-engine.mjs pr-body
node .agent/scripts/sealit-engine.mjs end --issue <id>
```

## Confirm with user before
- Approving an ADR (`adr decide --status approve`), recording an approving Stage 7 receipt, pushing to a remote repository, or merging a PR.

## Done when
`sealit gate --no-cache` and `sealit verify` pass on clean `HEAD`, the PR body includes measured proof and merge-danger classification (`sealit pr-body`), PR checks pass, and `sealit end --issue <id>` closes the session.
