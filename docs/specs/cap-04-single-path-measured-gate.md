# CAP-04: Single-Path Measured Quality Gate (Coverage, Mutation & Secret Scan)

- **Capability ID**: `CAP-04`
- **Governing Modules**: `.agent/scripts/lib/measure.mjs` (Ring 2), `.agent/scripts/lib/guard.mjs` (Ring 2)
- **Enforced Invariants**: `INV-02`, `INV-04`

## 1. Inputs
- Monotonic effective policy (`loadEffectivePolicy` per `ADR-021`): module commands (`head`, with changes raising `GATE_POLICY_DRIFT`), monotonic floors (`max(base, head)` for `diffCoverage` and `mutationScore`, `base || head` for `archlens.enabled`, base-only mutant `exemptions` with head additions surfaced as `pendingExemptions`, and monotonic `stryker.config.json` `mutate` globs; `policySource: 'bootstrap'` when base has no `sdlc-config.json`).
- Commit-object `ChangeSet` (`diff-tree -r -z --raw --no-renames` and `diff-tree -r -p -U0 -M` via `ADR-020`; `diff-index` for advisory `coverage`/`mutation` commands) against effective base branch and real coverage/mutation reports on disk (`lcov.info`, `coverage-summary.json`, `jacoco.xml`, `jacoco.csv`, `coverage.xml`, `cover.out`, Stryker `mutation.json`, PITest `mutations.xml`, `mutants.out/outcomes.json`, `.mutmut-results.{json,txt}`, `go-mutesting.txt`).

## 2. Domain Rules
1. **Clean Commit-Object Gate (`ADR-020`)**: `runGate` refuses dirty working trees upfront (`DIRTY_WORKING_TREE: commit or stash before gating`), evaluates two deterministic modes (`docs-only` and `code`) strictly from committed trees, and persists one `HEAD`-bound `session.lastGate` measurement object (`headSha`, `treeSha`, `specHash`, `adrHashes`, `diffCoveragePct`, `mutationPct`, `policySource`, `pendingExemptions`, `modules`, `passed`).
2. **Fail-Closed Report Freshness & Unimported File Detection**: Coverage and mutation reports whose `mtimeMs` predates execution start fail closed (`staleReport`). Changed production source files missing from the coverage report count executable lines as `0%` covered (`uncoveredSourceFiles`) rather than silently skipping them.
3. **Diff-Scoped Mutation & Stable Exemptions (`ADR-021`)**: Stryker runs scope `--mutate` to changed source files (`--full` forces full module mutation); changed trackable source files outside effective `mutate` globs fail closed (`diff-unmutated-sources`), zero-mutant results on non-empty code diffs fail closed unless the diff contains no executable source mutations, and exemptions match stable `<mutatorName>@<line>:<col>#<sha256(replacement)[0:8]>` identities from base config only.
4. **Diff Secret Scanning**: Added diff lines are scanned against high-confidence credential patterns (`ghp_`, `github_pat_`, `AKIA`, `sk_live_`, PEM private keys, Slack tokens) before passing the gate.
5. **Two-Axis Pointer Review & PR Evidence (`buildReviewPlan` & `buildPrSummary`)**: In `code` mode, `buildReviewPlan` always emits two orthogonal cold reviewer briefs backed by repo context pointers (`PRODUCT.md`, `docs/specs/*`, `docs/adr/*`, `GLOSSARY.md`, `CONTRIBUTING.md`, session `issueId`): **Spec Fidelity & Peer Reviewer** and **Architecture & Security Reviewer**. `buildPrSummary` (`sdlc pr-body`) emits compact changed-module structure, measured gate proof, and mechanical `One-Way` vs. `Two-Way` merge-danger classification.

## 3. Outputs & Acceptance Criteria
- `sdlc gate` exits `0` only when drift, ring boundaries, secret scan, lint, build, tests, diff coverage, and diff mutation all pass.
