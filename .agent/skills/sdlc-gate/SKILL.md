---
name: sdlc-gate
description: "Use when reviewing a branch or PR, running sdlc gate, or signing a Stage 7 merge receipt. Not for writing initial feature code (use sdlc-tdd or sdlc-flow)."
tools: read_file, write_file, edit_file, run_command, invoke_subagent
---

# Peer Review, Single Gate & Signed Merge Receipt (`sdlc-gate`)

## When to use / When NOT to use
- **Use when** auditing a branch diff, dispatching read-only reviewer subagents, executing `sdlc gate`, and signing the `HEAD`-bound Stage 7 receipt in `docs/AUDIT_CHAIN.jsonl`.
- **Not for** writing initial feature logic (`sdlc-tdd` / `sdlc-flow`).

## Steps

1. **Build the Review Plan**:
   ```bash
   node .agent/scripts/sdlc-engine.mjs review plan --json
   ```
   - In `docs-only` mode: run `sdlc gate` and `sdlc receipt --docs-only`.
   - In `code` mode: dispatch each reviewer in `reviewPlan.reviewers` in parallel via `invoke_subagent` (`TypeName: "research"`) using its `prompt`, instructing each reviewer to return `verdict: approve | request-changes`, `blockers: []`, and `notes`.

2. **Remediate Any Blockers**:
   Derive `<verdict>` strictly from reviewer output (`approve` only when every reviewer reports `0` blockers). Fix any blockers with failing-first tests, commit, and re-verify.

3. **Run the Single Gate & Sign Receipt on Clean `HEAD`**:
   ```bash
   node .agent/scripts/sdlc-engine.mjs gate --no-cache

   node .agent/scripts/sdlc-engine.mjs review record \
     --verdict <approve|request-changes> \
     --reviewer "@sdlc-gate" \
     --peer-review "<reviewer_1_notes>" \
     --arch-review "<reviewer_2_notes>"
   ```
   When `verdict` is `approve`, commit `docs/AUDIT_CHAIN.jsonl` and run `node .agent/scripts/sdlc-engine.mjs verify` to confirm the signed receipt matches `HEAD`.

## Confirm with user before
- Dismissing any security or architectural blocker raised by a reviewer.

## Done when
All reviewers report `0` blockers, `sdlc gate --no-cache` exits `0`, `docs/AUDIT_CHAIN.jsonl` is committed with a valid `GATE-RECEIPT-*`, and `sdlc verify` exits `0`.
