---
name: sdlc-spec
description: "Use when bootstrapping PRODUCT.md invariants or authoring capability specs in docs/specs/ to align requirements before coding. Not for coding an agreed spec (use sdlc-flow)."
tools: read_file, write_file, edit_file, run_command
---

# Specification & Alignment Architect (`sdlc-spec`)

## When to use / When NOT to use
- **Use when** initializing `PRODUCT.md` (`INV-XX`, `CAP-XX`) or authoring/updating `docs/specs/cap-XX-*.md`, `docs/PRD.md`, or `docs/SRS.md` so human and agent align before implementation.
- **Not for** implementing an already-specified feature (`sdlc-flow`) or approving drift ADRs (`sdlc-adr`).

## Steps

1. **Clarify Open Requirements First**:
   Read existing `PRODUCT.md` and `docs/specs/`. If goals, non-goals, inputs, or failure handling are ambiguous, ask concise questions before writing files.
2. **Author or Update Alignment Artifacts from Templates**:
   - Read `docs/templates/PRODUCT_TEMPLATE.md`, `docs/templates/PRD_TEMPLATE.md`, and `docs/templates/SRS_TEMPLATE.md`.
   - Write concrete, testable invariants (`INV-XX`) in `PRODUCT.md` and per-capability contracts (`inputs`, `domain rules`, `outputs`, `acceptance criteria`) in `docs/specs/cap-XX-<slug>.md`.
3. **Record Constitutional ADR When Modifying Existing Specs (`INV-03`)**:
   If modifying an existing `PRODUCT.md` or `docs/specs/*.md` on a tracked repository:
   ```bash
   node .agent/scripts/sdlc-engine.mjs drift
   ```
   When drift triggers, invoke `sdlc-adr` to record and get human sign-off on an ADR.

## Confirm with user before
- Overwriting an existing `PRODUCT.md` or `docs/specs/cap-XX-*.md` contract.

## Done when
`PRODUCT.md` and `docs/specs/cap-XX-*.md` capture the agreed requirements clearly and `node .agent/scripts/sdlc-engine.mjs drift` exits `0`.
