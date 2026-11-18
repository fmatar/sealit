---
name: sdlc-flow
description: "Use when implementing a feature, bug fix, or refactor end-to-end from branch creation through TDD, gate verification, and signed receipt. Not for read-only questions."
tools: read_file, write_file, edit_file, run_command, invoke_subagent
---

# End-to-End Branch Delivery Orchestrator (`sdlc-flow`)

## When to use / When NOT to use
- **Use when** delivering a code or documentation change from branch setup (`begin`) through alignment, TDD, `gate`, signed Stage 7 receipt, PR, and `end`.
- **Not for** read-only questions, `sdlc status` checks, or standalone greenfield spec authoring (`sdlc-spec`).

## Core Invariants
1. **Git Flow (`INV-01`)**: Never commit, merge, or push directly to `main` or `develop`. Feature/fix/chore PRs target `develop`; PRs targeting `main` originate exclusively from `develop`.
2. **Single Gate & Concentric Rings (`INV-02` & `INV-04`)**: `sdlc gate` classifies diffs into `docs-only` vs `code`, verifies `.archlens/policy.json` rings, scans diffs for secrets, and runs configured lint/build/test/coverage/mutation without shell interpolation.
3. **Spec & ADR Alignment (`INV-03`)**: Structural changes to `PRODUCT.md`, `docs/specs/*`, `.archlens/policy.json`, dependencies, schemas, or contracts require an accepted ADR via `sdlc-adr`.

## Steps (`begin -> gate -> receipt`)

```bash
# 1. Start feature branch & session
node .agent/scripts/sdlc-engine.mjs begin --issue <id> --title "<short-desc>" --type <feat|fix|chore> --checkout

# 2. Align specs/ADRs if needed (sdlc-spec / sdlc-adr) & implement via TDD (sdlc-tdd)
node .agent/scripts/sdlc-engine.mjs drift
node .agent/scripts/sdlc-engine.mjs test --affected-only

# 3. Run peer review, single gate & sign receipt on clean HEAD (sdlc-gate)
node .agent/scripts/sdlc-engine.mjs gate --no-cache
# (for docs-only changes: node .agent/scripts/sdlc-engine.mjs receipt --docs-only)
# (for code changes: execute sdlc-gate review plan -> review record --verdict approve)

# 4. Commit docs/AUDIT_CHAIN.jsonl, verify receipt, open PR -> merge -> close session
node .agent/scripts/sdlc-engine.mjs verify
node .agent/scripts/sdlc-engine.mjs end
```

## Confirm with user before
- Approving an ADR (`adr decide --status approve`), pushing to a remote repository, or merging a PR.

## Done when
`sdlc gate --no-cache` and `sdlc verify` pass on clean `HEAD`, PR checks are green, and `sdlc end` has closed the session.
