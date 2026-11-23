---
name: sealit-gate
description: "Use when running 2-axis cold code review on a branch or PR, executing sealit gate, signing an HMAC-SHA256 merge receipt, or generating PR evidence."
---

# Two-Axis Cold Review, Single Gate & Signed Receipt (`sealit-gate`)

## When to use / When NOT to use
- **Use when** auditing a branch diff along Spec Fidelity and Architecture/Security axes, executing `sealit gate`, signing the `HEAD`-bound merge receipt in `docs/AUDIT_CHAIN.jsonl`, and generating structured PR proof.
- **Not for** writing initial feature slices (use `sealit-tdd` or `sealit-flow`).

## Kernel check
Check for `.agent/sealit-config.json` first. Without it, **stop**: `sealit gate`, merge receipts, and `sealit verify` require the Proof Kernel—never simulate or claim a passed gate or receipt without it, and offer to run `/sealit init`.

## Why Two Orthogonal Cold Axes
`sealit review plan` emits two independent subagent briefs backed by repo context pointers (`PRODUCT.md`, `docs/specs/*`, `docs/adr/*`, `GLOSSARY.md`, `CONTRIBUTING.md`, session ticket):
1. **Spec Fidelity & Peer Reviewer**: Checks missing/partial spec requirements, unrequested scope creep, and public-seam TDD quality.
2. **Architecture & Security Reviewer**: Checks layer boundary rules (including `.archlens/policy.json` when present), fail-closed security, shell-free argv execution, documented repo standards, and deep-module vs. Fowler code-smell heuristics (`Feature Envy`, `Shotgun Surgery`, `Divergent Change`, `Primitive Obsession`, `Speculative Generality`).

Run both reviewers in parallel with fresh contexts and **keep their findings separate** so clean code style never masks a spec miss (and vice versa). Hard standard/layer/security/spec breaches are blockers; code smells are judgement calls for targeted refactoring.

## Steps

1. **Build & Dispatch the Two-Axis Review Plan**:
   ```bash
   node .agent/scripts/sealit-engine.mjs review plan --json
   ```
   - In `docs-only` mode: run `sealit gate --no-cache` and `sealit receipt --docs-only`.
   - In `code` mode: spawn two isolated read-only subagents (your harness's subagent tool, e.g. Claude Code's `Task`) in parallel for `reviewPlan.reviewers`, instructing each to return `verdict: approve | request-changes`, `blockers: []`, and `notes`.

2. **Remediate Blockers & Commit Refactors Before Gating**:
   Fix every blocker (and any worthwhile smell refactors) with failing-first tests and **commit to clean `HEAD`** before running the gate, because merge receipts bind exact `headSha` and `treeSha`.

3. **Run Single-Path Gate, Sign Receipt & Emit PR Proof**:
   ```bash
   node .agent/scripts/sealit-engine.mjs gate --no-cache

   node .agent/scripts/sealit-engine.mjs review record \
     --verdict <approve|request-changes> \
     --reviewer "@sealit-gate" \
     --peer-review "<spec_axis_notes>" \
     --arch-review "<arch_security_axis_notes>"

   git add docs/AUDIT_CHAIN.jsonl && git commit -m "chore(audit): record gate receipt"
   node .agent/scripts/sealit-engine.mjs verify
   node .agent/scripts/sealit-engine.mjs pr-body
   ```

## Confirm with user before
- Dismissing any security, architectural, or spec-fidelity blocker, or recording an approving merge receipt when required by repo policy.

## Done when
Both review axes report `0` blockers, `sealit gate --no-cache` exits `0`, `docs/AUDIT_CHAIN.jsonl` is committed with a valid `GATE-RECEIPT-*`, `sealit verify` exits `0`, and `sealit pr-body` summarizes proof and merge danger.
