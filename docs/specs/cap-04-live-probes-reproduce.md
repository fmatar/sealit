# SPEC-04: Live Canary Watchdog, Real Regression Proofs & Polyglot Reproduce (`CAP-04`)

- **Linked Capability**: `CAP-04`
- **Status**: `ACTIVE`
- **Depends On**: `CAP-02`

## 1. Problem Statement & Motivation
1. `monitorCanaryHealthAndWatchdog` accepted `healthUrl` but never probed it, relying exclusively on `simulatedErrors`.
2. `generateRegressionProof` hashed static literal strings instead of probing real endpoints or hashing actual UI component files on disk.
3. `scaffoldReproductionTest` always emitted a JavaScript `node:test` file containing `assert.rejects(async () => { throw new Error(...) })`, which passed immediately (Green) instead of failing Red and ignored non-JS target languages.

## 2. Domain Contract & Acceptance Criteria
1. **Live HTTP Probing in `monitorCanaryHealthAndWatchdog`**:
   - Support live HTTP health probing via `execFileSync('curl', ...)` when `probeLive` (`--live`) is enabled and `simulatedErrors === 0`, while preserving deterministic offline execution for unit tests passing `simulatedErrors`.
2. **Real Digests in `generateRegressionProof`**:
   - Compute SHA-256 digests from actual UI route/component files on disk when present and probe reachable local API endpoints when available, while maintaining deterministic structure for unit test fixtures.
3. **Polyglot Red-First `scaffoldReproductionTest`**:
   - Detect target file language (`.java`, `.py`, `.go`, `.rs`, `.js`/`.mjs`/`.ts`) and scaffold an idiomatic test harness that imports the target module and includes a failing Red assertion alongside the defect reproduction contract.
