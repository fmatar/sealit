---
name: sdlc-spec
description: "Use when clarifying ambiguous requirements, sharpening domain vocabulary in GLOSSARY.md, or authoring PRODUCT.md and docs/specs/ contracts before coding."
---

# Specification, Discovery & Domain Architect (`sdlc-spec`)

## When to use / When NOT to use
- **Use when** initializing `PRODUCT.md` (`INV-XX`, `CAP-XX`), refining `GLOSSARY.md`, or authoring/updating `docs/specs/cap-XX-*.md`, `docs/PRD.md`, or `docs/SRS.md` so human and agent align before implementation.
- **Not for** coding an already-agreed spec (use `sdlc-flow`) or approving drift ADRs (use `sdlc-adr`).

## Kernel check
Check for `.agent/sdlc-config.json`:
- **Present**: run `node .agent/scripts/sdlc-engine.mjs drift` in Step 3 and resolve `CONSTITUTION_OR_SPEC_DRIFT` via `sdlc-adr`.
- **Absent** (skills installed standalone without the kernel): author `GLOSSARY.md`, `PRODUCT.md`, and `docs/specs/cap-XX-*.md` directly using the repository's own Markdown conventions without running `sdlc-engine.mjs`. Never report drift as mechanically verified by the kernel; mention `/sdlc init` once if the user wants mechanical drift enforcement.

## Discovery & Design Discipline
1. **Explore the Repo Before Asking**: Read `PRODUCT.md`, `GLOSSARY.md` (if present), `docs/specs/`, `docs/adr/`, and `.archlens/policy.json` first. Never ask the human a question the codebase already answers.
2. **Walk the Decision Tree**: When requirements, edge cases, failure modes, or scope boundaries remain open, interview the user in focused open-ended questions—resolving one branch of the design tree at a time before drafting files. If an upstream issue or `.scratch/` spec already settled those decisions, distill directly without re-asking.
3. **Sharpen Ubiquitous Language (`GLOSSARY.md`)**: When a new domain concept appears or two terms compete for the same meaning, create or update root `GLOSSARY.md` lazily (`**Term**: definition` + `_Avoid_: synonyms`). Use `GLOSSARY.md` terms verbatim across specs, code, and tests.
4. **Design Deep Modules & High Test Seams**:
   - Prefer **deep modules** (rich behavior behind a small, caller-oriented public interface) placed inside the appropriate `.archlens/policy.json` Concentric Ring; avoid shallow pass-through wrappers or hypothetical one-implementation interfaces.
   - Identify the **highest public seam(s)** where behavioral tests will verify the capability without coupling to private internals.
   - Keep ephemeral implementation line numbers and volatile code snippets out of specs so contracts stay durable.

## Steps

1. **Resolve Open Branches & Vocabulary**:
   Complete the discovery loop above and update `GLOSSARY.md` if domain terms were added or clarified.
2. **Author or Update Alignment Artifacts**:
   - Read `docs/templates/PRODUCT_TEMPLATE.md`, `docs/templates/PRD_TEMPLATE.md`, and `docs/templates/SRS_TEMPLATE.md` when bootstrapping.
   - Write concrete, testable invariants (`INV-XX`) in `PRODUCT.md` and capability contracts (`Inputs`, `Domain Rules`, `Public Seam & Test Strategy`, `Out of Scope`, `Outputs & Acceptance Criteria`) in `docs/specs/cap-XX-<slug>.md`.
3. **Verify Spec Drift (`INV-03`)**:
   ```bash
   node .agent/scripts/sdlc-engine.mjs drift
   ```
   When modifying tracked specs triggers `CONSTITUTION_OR_SPEC_DRIFT`, invoke `sdlc-adr` to record an ADR and obtain human approval.

## Confirm with user before
- Overwriting an existing `PRODUCT.md` or `docs/specs/cap-XX-*.md` contract.

## Done when
Open design branches are resolved, `GLOSSARY.md` (when applicable), `PRODUCT.md`, and `docs/specs/cap-XX-*.md` capture the agreed contract and out-of-scope boundaries, and `node .agent/scripts/sdlc-engine.mjs drift` exits `0`.
