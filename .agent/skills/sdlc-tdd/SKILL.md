---
name: sdlc-tdd
description: "Use when writing tests, fixing bugs, or verifying diff coverage and mutation thresholds against sdlc-config.json. Not for pure documentation edits."
tools: read_file, write_file, edit_file, run_command
---

# Test-Driven Development & Measured Verification (`sdlc-tdd`)

## When to use / When NOT to use
- **Use when** implementing features or bug fixes via Red-Green-Refactor TDD, or measuring diff line coverage and diff mutation scores.
- **Not for** pure Markdown documentation edits (`docs-only` mode).

## TDD Rules
1. **Red -> Green -> Refactor**: Write a minimal failing behavioral test first, watch it fail for the expected reason, write the smallest implementation that passes, then clean up while respecting `.archlens/policy.json` concentric rings.
2. **Real Behavior Over Mocks**: Test real inputs, outputs, and isolated temp repos/files; avoid tautological assertions or unasserted smoke calls.
3. **Config-Driven Bars**: Read `thresholds.diffCoverage` and `thresholds.mutationScore` from `.agent/sdlc-config.json`.

## Steps

```bash
# 1. Fast inner loop on diff-affected unit suites
node .agent/scripts/sdlc-engine.mjs test --affected-only

# 2. Measure fresh diff line coverage
node .agent/scripts/sdlc-engine.mjs coverage

# 3. Measure diff-scoped (or --full) mutation score when configured
node .agent/scripts/sdlc-engine.mjs mutation
```

## Confirm with user before
- Adding a mutant exemption (`node .agent/scripts/sdlc-engine.mjs exemption add --mutant "<id>" --file "<path>" --reason "<why>"`).

## Done when
All tests pass deterministically and configured `coverage` and `mutation` thresholds in `.agent/sdlc-config.json` pass cleanly.
