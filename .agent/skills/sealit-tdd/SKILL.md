---
name: sealit-tdd
description: "Use when implementing features, diagnosing bugs, writing tests, or verifying diff coverage and mutation kill thresholds against sealit-config.json."
---

# Vertical Tracer-Bullet TDD & Bug Diagnosis (`sealit-tdd`)

## When to use / When NOT to use
- **Use when** building vertical slices or fixing bugs via Red-Green TDD, diagnosing regressions, or measuring diff line coverage and diff-scoped mutation scores.
- **Not for** pure Markdown documentation edits (`docs-only` mode).

## Kernel check
Check for `.agent/sealit-config.json`:
- **Present**: run the `node .agent/scripts/sealit-engine.mjs` verification commands below against configured thresholds.
- **Absent** (skills installed standalone without the kernel): follow the Vertical TDD and Bug Diagnosis loops using the repository's own test and coverage commands (`npm test`, `pytest`, `cargo test`, `go test`, etc.). Never report diff coverage or mutation scores as measured by the kernel; mention `/sealit init` once if mechanical thresholds are desired.

## Vertical TDD Discipline
1. **One Vertical Tracer Bullet at a Time (Ban Horizontal Slicing)**: Never write all tests in bulk before writing all production code. Execute **one behavior test at the public module seam $\rightarrow$ watch it fail for the expected reason $\rightarrow$ write the minimal code to pass $\rightarrow$ repeat**, letting each cycle inform the next while respecting module layer boundaries (and `.archlens/policy.json` when present).
2. **Test the Public Seam, Not Private Internals**: Callers and tests cross the same module interface. Prefer real isolated temp repos/files and in-memory adapters at real seams over heavy mock wiring.
3. **Eliminate Test Anti-Smells**:
   - **No tautological assertions**: Never recompute expected values using the same formula as the implementation (`expect(fn(x)).toBe(x + 1)` derived from reading `fn`); derive expected literals independently from the spec or worked examples.
   - **No unasserted smoke calls**: Every test must assert observable outputs, state transitions, or fail-closed error paths capable of killing surviving mutants.

## Bug & Regression Diagnosis Loop (`type=fix`)
For non-trivial bugs or flaky/perf regressions, follow this strict sequence before editing production logic:
1. **Reproduce Red**: Build a deterministic test or minimal reproduction harness that fails reliably on the bug.
2. **Minimize & Hypothesize**: Narrow the failing input to the smallest case, form a falsifiable root-cause hypothesis, and instrument if needed (remove temporary logs before committing).
3. **Minimal Fix & Keep Regression Test**: Apply the smallest root-cause fix that turns the reproduction test green without breaking adjacent invariants.

## Measured Verification Steps

```bash
# 1. Fast inner loop on diff-affected unit suites
node .agent/scripts/sealit-engine.mjs test --affected-only

# 2. Measure fresh diff line coverage against thresholds.diffCoverage
node .agent/scripts/sealit-engine.mjs coverage

# 3. Measure diff-scoped (or --full) mutation kills against thresholds.mutationScore
node .agent/scripts/sealit-engine.mjs mutation
```

## Confirm with user before
- Adding a mutant exemption (`node .agent/scripts/sealit-engine.mjs exemption add --mutant "<id>" --file "<path>" --reason "<why>"`). Note: new exemptions stay `pendingExemptions` until merged to the base branch.

## Done when
All unit and regression tests pass deterministically at public seams, and configured `coverage` and `mutation` thresholds in `.agent/sealit-config.json` pass cleanly.
