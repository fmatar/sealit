# SPEC-03: Real Coverage/Mutation Report Parsers & Policy-Driven ArchDiff (`CAP-03`)

- **Linked Capability**: `CAP-03`
- **Status**: `ACTIVE`
- **Depends On**: `CAP-01`, `CAP-02`

## 1. Problem Statement & Motivation
1. `sdlc-engine coverage` and `sdlc-engine mutation` previously executed the module's shell command and returned `status: "PASSED"` without parsing any coverage or mutation artifacts against `thresholds.diffCoverage` (85%) or `thresholds.mutationScore` (80%).
2. `generatePRSummary` fabricated `'90%'` coverage and `'85%'` mutation (`✅ PASSED`) whenever `manifest.coverageReport` or `manifest.mutationScore` was null.
3. `checkArchDiff` checked whether `.archlens/policy.json` existed on disk, but ignored its `layers` and `allowedDependencies` definitions, relying solely on a hardcoded substring check.

## 2. Domain Contract & Acceptance Criteria
1. **Polyglot Coverage Report Parser (`parseCoverageReport`)**:
   - Parse coverage percentages from `coverage/coverage-summary.json`, `coverage/lcov.info`, `target/site/jacoco/jacoco.csv`, `coverage.xml` / `cobertura.xml`, or `coverage.out`.
   - Enforce `thresholds.diffCoverage` when a coverage artifact is present on disk and persist the measured metric into the active session manifest.
2. **Polyglot Mutation Report Parser (`parseMutationReport`)**:
   - Parse mutation kill scores from Stryker (`reports/mutation/mutation.json`) and PITest (`target/pit-reports/mutations.xml`).
   - Enforce `thresholds.mutationScore` when a mutation artifact is present on disk and persist the measured metric into the active session manifest.
3. **Honest PR Summary Reporting (`generatePRSummary`)**:
   - Report `'Not Measured'` (`⚪ PENDING`) when coverage or mutation has not been recorded in the session manifest, never fabricating `'90%'` or `'85%'`.
4. **Policy-Driven `checkArchDiff`**:
   - Parse `.archlens/policy.json` (`layers` with `paths`/`allowedDependencies` or `order`/`levels`) and flag any added import where an inner architectural layer imports an outer layer not permitted by policy.
