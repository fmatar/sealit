---
name: sdlc-tdd
description: "Use when writing tests, reproducing bugs, or checking coverage and mutation gates. Not for pure prose edits. Enforces Red-Green-Refactor TDD using sdlc-config.json bars."
---

# Test-Driven Development & Dual-Gate Runner (`sdlc-tdd`)

## When to use / When NOT to use
- **Use when** adding behavioral tests, reproducing defects from stack traces, or measuring test coverage and mutation kill scores.
- **Not for** pure documentation, copy, or CSS-only changes with no executable behavior (`trivial` lane).

## TDD Laws & Anti-Patterns (paired with `ub-mode`)
1. **Red -> Green -> Refactor**: Write a minimal failing behavioral test first, write the smallest production change to pass, then remove duplication and respect Clean Architecture boundaries (`.archlens/policy.json`).
2. **Zero Test Smells**: No assertion-free "smoke" tests, no trivial getter/setter tests, no deep mock wiring when domain fakes/values work, and strict **F.I.R.S.T.** isolation (temp dirs, ephemeral ports, zero network reliance).
3. **Config-Driven Thresholds**: Coverage (`thresholds.diffCoverage`) and mutation (`thresholds.mutationScore`) bars come strictly from `.agent/sdlc-config.json` — never assume hardcoded numbers.

## Lane behavior
| Lane | Required test & gate commands |
| :--- | :--- |
| `trivial` | No new test required for pure docs/CSS; run `node .agent/scripts/sdlc-engine.mjs test --affected-only` to confirm zero regressions. |
| `standard` | Red-Green-Refactor unit/integration tests + `node .agent/scripts/sdlc-engine.mjs coverage` (SHA-256 cached when tree unchanged). |
| `full` | Red-Green-Refactor + `coverage --no-cache` + `mutation` (when `thresholds.mutationScore !== null`) + `flake-check --runs 3`. |

## Steps

```bash
# 1. (Bug/Hotfix) Scaffold a failing reproduction harness from an error/stack trace
node .agent/scripts/sdlc-engine.mjs reproduce --error "<stack_trace>" --target "<file>"

# 2. Fast inner loop on affected tests during Red-Green-Refactor
node .agent/scripts/sdlc-engine.mjs test --affected-only

# 3. Gate 1: Measure real coverage and record in .agent/.sdlc-session.json
node .agent/scripts/sdlc-engine.mjs coverage

# 4. Gate 2 (full lane): Run mutation testing & inspect surviving mutants
node .agent/scripts/sdlc-engine.mjs mutation
node .agent/scripts/sdlc-engine.mjs strengthen --type <ConditionalsBoundary|NegateCondition|Math|VoidMethodCall|EmptyReturn> --file <path>
```

## ⚠️ Confirm with user before
- Recording a mutant exemption (`node .agent/scripts/sdlc-engine.mjs exemption add --mutant "<id>" --file "<path>" --reason "<why>"`) for anything other than a verified logging/compiler artifact.

## If it fails
- **Coverage below `thresholds.diffCoverage`** -> add behavioral edge-case tests on uncovered branches; never add assertionless calls.
- **Mutation score below `thresholds.mutationScore`** -> run `strengthen` on surviving mutants and tighten boundary/return assertions.
- **No test runner configured in repo** -> run `sdlc-doctor` (`detect`) to configure `.agent/sdlc-config.json`.

## Done when
All tests pass deterministically and the lane's configured coverage (and mutation, in `full` lane) thresholds are recorded in `.agent/.sdlc-session.json`.
