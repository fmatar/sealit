---
id: ADR-018
title: Expand Stryker Mutation Scope, Polyglot Mutation Parsers, Hash-Chain Terminology, and Test Isolation
status: accepted
scope: technical
ticket: #136
supersedes: CAP-03, CAP-04, CAP-06, CAP-11
createdAt: 2026-11-14T22:12:51.457Z
---

# ADR-018: Expand Stryker Mutation Scope, Polyglot Mutation Parsers, Hash-Chain Terminology, and Test Isolation

- **Status**: `accepted`
- **Blast Radius / Scope**: `technical`
- **Triggered By Ticket**: #136
- **Supersedes / Amends**: CAP-03, CAP-04, CAP-06, CAP-11

## 1. Context & Spec Drift Trigger
Issue #136 identified narrow Stryker mutation scope limited to 2 modules, unimplemented Rust/Python/Go mutation report parsers, misleading Merkle terminology across UI/docs/specs instead of linear SHA-256 hash chains, and TCP loopback coupling across unit tests.

## 2. Decision
Expand stryker.config.json mutate scope across all 8 core governance modules executed via @stryker-mutator/tap-runner (perTest coverage analysis, forceBail) against fast modular unit suites tests/unit/*.test.mjs (with tests/governance-unit.test.mjs covering full integration & contracts) with break threshold >= 52 and pinned @stryker-mutator/tap-runner devDependency; implement cargo mutants, mutmut, and go-mutesting parsers in parseMutationReport with structured fail-closed diagnostics; standardize linear SHA-256 hash-chain and Stage 7 Gate Receipt terminology across code, UI, wiki, specs, and templates while preserving backward-compatible merkleRoot JSON alias and GitHub branch protection check name; and decouple in-process workbench handler tests from dedicated live TCP loopback round-trip integration tests.

## 3. Consequences & Downstream Impact
Mutation gate tests real governance boundaries across all 8 core modules quickly; Rust/Python/Go projects receive deterministic fail-closed mutation metrics and diagnostics; tests run cleanly both in restricted sandboxes via in-process dispatch and end-to-end over TCP loopback; and docs/templates/PRODUCT.md accurately describe linear hash chains.

## 4. Diff-Scoped Mutation & Test Suite Performance Addendum
To keep CI and developer feedback proportional without weakening mutation thoroughness (`StringLiteral` mutator preserved, unscoped and `--full` checks remain fail-closed):
- **Diff/Hunk-Scoped Mutation Execution**: `buildMutationExecutionPlan` + `extractChangedHunkRanges` scope `mutation` runs by default to changed hunks (`-m file:start-end --allowEmpty` for Stryker, `--in-diff` for `cargo-mutants`, package dirs for `go-mutesting`, `--paths-to-mutate` for `mutmut`, `-DtargetClasses=` for PITest) plus source files paired from modified tests, while preserving `--full` for whole-repo audits. Docs/config-only diffs (`diff-no-mutated-sources`) and empty changed-line hunks (`diff-zero-mutants`) auto-pass cleanly via explicit `mutationSkippedReason` handling in `receiptInputsFromSession`.
- **Incremental Cache & Worker Concurrency**: Default diff-scoped Stryker runs pass `--incrementalFile reports/stryker-diff-incremental.json --allowEmpty` and omit `--force` unless `--no-cache` is supplied; `stryker.config.json` enables `"ignoreStatic": true` (noting `@stryker-mutator/tap-runner@9.6.1` leaves `totalCoverage.static = {}` and reports file-level `perTest` coverage) and `"concurrency": "75%"` (`12` workers on 16-core hosts).
- **Parallel Suite, Shared Git Fixtures & CI Caching**: Split monolithic `tests/hardening.test.mjs` into 4 parallel files (`tests/hardening.test.mjs`, `tests/hardening-platform.test.mjs`, `tests/hardening-governance.test.mjs`, `tests/hardening-issues.test.mjs`) backed by `tests/helpers/hardening-harness.mjs` cached seed repositories (`fs.cpSync`), applied seed-repo caching to slow unit suites, parallelized `runFlakeCheck` / added `runFlakeCheckParallel`, and enabled `cache: 'npm'` in `.github/workflows/sdlc-quality-gate.yml` and `installCIWorkflow`.
- **Measured Benchmarks (Issue `#136`)**:
  - `npm test` (`339` tests, `59` suites): `50.58s` baseline -> `19.64s` unsandboxed (`339/339` pass; `93.75%` repo-wide / `95.7%` diff coverage via `coverage --no-cache` in `19.23s`).
  - Hunk-scoped vs full-file Stryker on `#136`: `session.mjs` diff-scoped hunks (`56` killed / `71.79%` mutation score, zero git-branch isolation leaks); cold-cache `--no-cache` run across `#136`'s `8` modified/test-paired modules (`7,148` mutants retested, `9,120`-mutant incremental summary, `12` workers) passed at `54.82%` total / `60.49%` covered in `27m 9s` (threshold `52%`).

## 5. Governance Review Decision
- **Decision**: `ACCEPTED`
- **Reviewer**: @fmatar
- **Rationale**: Reviewed via SDLC Governance Gate
- **Decided At**: 2026-11-14T22:13:01.244Z
