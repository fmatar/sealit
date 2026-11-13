---
name: sdlc-flow
description: Use when implementing a feature, bug fix, or hotfix end-to-end across branches and PRs. Not for read-only questions or status checks. Drives proportional SDLC lanes.
allowed-tools: Read, Write, Edit, Bash, Agent
---

# Agentic SDLC Lifecycle Orchestrator (`sdlc-flow`)

## When to use / When NOT to use
- **Use when** shipping a code or documentation change from intake through branch, implementation, PR review, and merge.
- **Not for** read-only codebase questions, status checks (`sdlc-status`), or macro product bootstrapping (`sdlc-product`).

## Core Invariants
1. **Zero Direct Pushes (`INV-01`)**: Never commit, merge, or push directly to `main` or `develop`.
2. **Proportional Session & Gate (`INV-02`)**: Every branch has an active session in `.agent/.sdlc-session.json` and passes the gates for its risk lane (thresholds read from `.agent/sdlc-config.json`).
3. **Spec-Drift ADR Discipline (`INV-03`)**: Structural changes to `PRODUCT.md`, `docs/specs/*.md`, dependencies, schemas, or API contracts require an accepted ADR via `sdlc-adr`.

## Lane behavior (`node .agent/scripts/sdlc-engine.mjs triage`)
| Lane | Auto-selected when | Required stages |
| :--- | :--- | :--- |
| `trivial` | Docs/CSS/copy only, `<= trivialMaxLines` (25), `LOW` risk, `0` drift triggers | `stage begin --lane trivial` (local `L-*` ID) -> edit -> `test --affected-only` -> `stage pre-pr` (auto-signs `trivial` receipt) -> merge -> `stage complete`. |
| `standard` | Code/bugfix `<= standardMaxLines` (200), `LOW`/`MEDIUM` risk, `0` drift triggers | `stage begin` -> `sdlc-tdd` (`coverage`) -> `stage pre-pr` -> `sdlc-gate` (1 reviewer + `gate` + `review record`) -> merge -> `stage complete`. |
| `full` | `HIGH`/`CRITICAL` risk, any spec-drift trigger, or `> standardMaxLines` | `stage begin` -> `sdlc-adr` (if drift) -> `sdlc-tdd` (`coverage` + `mutation`) -> `stage pre-pr` -> `sdlc-gate` (2-3 reviewers + `gate --strict` + `review record`) -> merge -> `stage complete`. |

> Note: `stage pre-pr`, `gate`, and `guard receipt` automatically re-triage the real git diff and escalate `< full` sessions if `CRITICAL` or larger code changes were introduced. Downward overrides require `--lane <lane> --reason "<why>"` (audited in `docs/AUDIT_CHAIN.jsonl`).

## Steps

1. **Triage & Begin (`stage begin`)**:
   ```bash
   # Existing ticket:
   node .agent/scripts/sdlc-engine.mjs stage begin --issue <id> --type <feat|fix|hotfix> --checkout

   # Local session without creating a remote issue (standard/full lane):
   node .agent/scripts/sdlc-engine.mjs stage begin --local --title "<short-desc>" --type <feat|fix|chore> --checkout

   # Create a new remote PM issue ONLY after explicit user confirmation:
   node .agent/scripts/sdlc-engine.mjs stage begin --create-issue --title "<short-desc>" --type <feat|fix> --checkout

   # Trivial docs/style fast-path (no remote issue spam):
   node .agent/scripts/sdlc-engine.mjs stage begin --lane trivial --title "<short-desc>" --type chore --checkout
   ```
   Pass `--ui` only if the user asks for the `.agent/workbench/index.html` architecture widget. For `--type fix|hotfix`, scaffold a failing reproduction test first with `node .agent/scripts/sdlc-engine.mjs reproduce --error "<trace>"`.

2. **Implement (`sdlc-tdd`)**:
   Model the domain types and concentric ring boundaries (`.archlens/policy.json`) first, make the smallest clean change via Red-Green-Refactor TDD, and run the lane-appropriate test/coverage/mutation gates in `sdlc-tdd` (workflow governance is decoupled from coding-persona skills, so compose freely with any active project style guide or standalone skill). If `drift check` triggers, mint an ADR via `sdlc-adr`.

3. **Pre-PR Verification (`stage pre-pr`)**:
   ```bash
   node .agent/scripts/sdlc-engine.mjs stage pre-pr --issue <id> --summary "<concise-summary>"
   ```

4. **Review, Receipt & Merge (`sdlc-gate`)**:
   - In `trivial` lane (if not escalated): `stage pre-pr` already signed the `trivial` receipt; verify CI (`check-ci <pr>`) and merge.
   - In `standard` or `full` lane: execute `sdlc-gate` (`review plan` -> read-only subagent review -> remediate any blockers -> `gate` / `gate --strict` -> `review record` -> commit & push `docs/AUDIT_CHAIN.jsonl` -> `check-ci <pr>` -> merge).

5. **Complete (`stage complete`)**:
   ```bash
   node .agent/scripts/sdlc-engine.mjs stage complete --issue <id> --pr <pr_number>
   ```

## ⚠️ Confirm with user before
- Provisioning a new remote PM ticket (`stage begin --create-issue --title "<short-desc>"`) when no ticket exists yet (use `--local` by default for local-only sessions).
- Passing `--lane <lower> --reason` to downgrade a computed risk lane.

## If it fails
- **`drift check` fails** -> invoke `sdlc-adr` (`adr create`), and obtain explicit human sign-off (`adr decide --status approve`) across all ADR scopes (`technical`, `architectural`, `product`, `contract`).
- **Reviewer returns `request-changes` or `gate` fails** -> fix root cause via `sdlc-tdd` and re-verify (stop and ask user if 3 remediation retries trip the circuit breaker).
- **CI check fails on PR** -> inspect failing job logs, fix on branch, re-sign Stage 7 receipt on final `HEAD`, and re-run `check-ci <pr>`.

## Done when
PR is merged with green CI and a valid Stage 7 receipt on final `HEAD`, and `stage complete` has released the session lock.
