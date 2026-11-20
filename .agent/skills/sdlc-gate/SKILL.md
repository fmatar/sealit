---
name: sdlc-gate
description: "Use when running 2-axis cold code review on a branch or PR, executing sdlc gate, signing a Stage 7 merge receipt, or generating PR evidence."
---

# Two-Axis Cold Review, Single Gate & Signed Receipt (`sdlc-gate`)

## When to use / When NOT to use
- **Use when** auditing a branch diff along Spec Fidelity and Architecture/Security axes, executing `sdlc gate`, signing the `HEAD`-bound Stage 7 receipt in `docs/AUDIT_CHAIN.jsonl`, and generating structured PR proof.
- **Not for** writing initial feature slices (use `sdlc-tdd` or `sdlc-flow`).

## Kernel check
Check for `.agent/sdlc-config.json` first. Without it, **stop**: `sdlc gate`, Stage 7 review receipts, and `sdlc verify` require the Proof Kernel—never simulate or claim a passed gate or receipt without it, and offer to run `/sdlc init`.

## Why Two Orthogonal Cold Axes
`sdlc review plan` emits two independent subagent briefs backed by repo context pointers (`PRODUCT.md`, `docs/specs/*`, `docs/adr/*`, `GLOSSARY.md`, `CONTRIBUTING.md`, session ticket):
1. **Spec Fidelity & Peer Reviewer**: Checks missing/partial spec requirements, unrequested scope creep, and public-seam TDD quality.
2. **Architecture & Security Reviewer**: Checks `.archlens/policy.json` Concentric Rings, fail-closed security, shell-free `INV-04` execution, documented repo standards, and deep-module vs. Fowler code-smell heuristics (`Feature Envy`, `Shotgun Surgery`, `Divergent Change`, `Primitive Obsession`, `Speculative Generality`).

Run both reviewers in parallel with fresh contexts and **keep their findings separate** so clean code style never masks a spec miss (and vice versa). Hard standard/ring/security/spec breaches are blockers; code smells are judgement calls for targeted refactoring.

## Steps

1. **Build & Dispatch the Two-Axis Review Plan**:
   ```bash
   node .agent/scripts/sdlc-engine.mjs review plan --json
   ```
   - In `docs-only` mode: run `sdlc gate --no-cache` and `sdlc receipt --docs-only`.
   - In `code` mode: spawn two isolated read-only subagents (your harness's subagent tool, e.g. Claude Code's `Task`) in parallel for `reviewPlan.reviewers`, instructing each to return `verdict: approve | request-changes`, `blockers: []`, and `notes`.

2. **Remediate Blockers & Commit Refactors Before Gating**:
   Fix every blocker (and any worthwhile smell refactors) with failing-first tests and **commit to clean `HEAD`** before running the gate, because Stage 7 receipts bind exact `headSha` and `treeSha`.

3. **Run Single-Path Gate, Sign Receipt & Emit PR Proof**:
   ```bash
   node .agent/scripts/sdlc-engine.mjs gate --no-cache

   node .agent/scripts/sdlc-engine.mjs review record \
     --verdict <approve|request-changes> \
     --reviewer "@sdlc-gate" \
     --peer-review "<spec_axis_notes>" \
     --arch-review "<arch_security_axis_notes>"

   git add docs/AUDIT_CHAIN.jsonl && git commit -m "chore(audit): record Stage 7 gate receipt"
   node .agent/scripts/sdlc-engine.mjs verify
   node .agent/scripts/sdlc-engine.mjs pr-body
   ```

## Confirm with user before
- Dismissing any security, architectural, or spec-fidelity blocker, or recording an approving Stage 7 receipt when required by repo policy.

## Done when
Both review axes report `0` blockers, `sdlc gate --no-cache` exits `0`, `docs/AUDIT_CHAIN.jsonl` is committed with a valid `GATE-RECEIPT-*`, `sdlc verify` exits `0`, and `sdlc pr-body` summarizes proof and merge danger.
