# CAP-04: Single-Path Measured Quality Gate (Coverage, Mutation & Secret Scan)

- **Capability ID**: `CAP-04`
- **Governing Modules**: `.agent/scripts/lib/measure.mjs` (Ring 2), `.agent/scripts/lib/guard.mjs` (Ring 2)
- **Enforced Invariants**: `INV-02`, `INV-04`

## 1. Inputs
- `.agent/sdlc-config.json` module commands and thresholds (`diffCoverage`, `mutationScore`).
- Unified git diff (`git diff -U0`) against effective base branch and real coverage/mutation reports on disk (`lcov.info`, `coverage-summary.json`, `jacoco.csv`, `coverage.xml`, `coverage.out`, Stryker `mutation.json`, PITest `mutations.xml`, `mutants.out/outcomes.json`, `.mutmut-cache`, `go-mutesting`).

## 2. Domain Rules
1. **Single Gate Path**: `runQualityGate` evaluates two deterministic modes (`docs-only` and `code`) and persists one `HEAD`-bound `session.lastGate` measurement object (`headSha`, `treeSha`, `specHash`, `adrHashes`, `diffCoverage`, `mutationScore`, `passed`).
2. **Fail-Closed Report Freshness & Unimported File Detection**: Coverage and mutation reports whose `mtimeMs` predates execution start fail closed (`staleReport`). Changed production source files missing from the coverage report count executable lines as `0%` covered (`uncoveredSourceFiles`) rather than silently skipping them.
3. **Diff-Scoped Mutation Execution**: Stryker runs scope `--mutate` to changed source files (`--full` forces full module mutation); zero-mutant results on non-empty code diffs fail closed unless the diff contains no executable source mutations.
4. **Diff Secret Scanning**: Added diff lines are scanned against high-confidence credential patterns (`ghp_`, `github_pat_`, `AKIA`, `sk_live_`, PEM private keys, Slack tokens) before passing the gate.

## 3. Outputs & Acceptance Criteria
- `sdlc gate` exits `0` only when drift, ring boundaries, secret scan, lint, build, tests, diff coverage, and diff mutation all pass.
