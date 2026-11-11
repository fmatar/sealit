# SPEC-06: Dogfooding Configuration, Documentation Sync & Full Test Suite (`CAP-06`)

- **Linked Capability**: `CAP-06`
- **Status**: `ACTIVE`
- **Depends On**: `CAP-05`

## 1. Problem Statement & Motivation
1. `.agent/sdlc-config.json` only executed `node --test tests/sdlc-engine.test.mjs`, omitting `tests/sdlc-nextgen.test.mjs` and `tests/scripts.test.mjs`, and used `node --test` without `--experimental-test-coverage` for the coverage command.
2. Documentation across `README.md`, `docs/SDLC_AGENTIC_OPERATIONS_GUIDE.md`, `wiki/Skills-Reference.md`, and `CLAUDE.md` referenced the legacy 13/14-skill catalog.

## 2. Domain Contract & Acceptance Criteria
1. **Self-Dogfooding `.agent/sdlc-config.json` & `package.json`**:
   - Configure `test` and `coverage` commands to run all 3 test suites (`tests/sdlc-engine.test.mjs`, `tests/sdlc-nextgen.test.mjs`, `tests/scripts.test.mjs`) with `--experimental-test-coverage`.
2. **Documentation & Wiki Synchronization**:
   - Synchronize `README.md`, `docs/SDLC_AGENTIC_OPERATIONS_GUIDE.md`, `wiki/Skills-Reference.md`, `CLAUDE.md`, `install.sh`, and `CHANGELOG.md` to reflect the 6 consolidated skills and new `sdlc-engine stage` CLI workflow.
3. **Comprehensive Automated Test Verification**:
   - Expand `tests/scripts.test.mjs` and `tests/sdlc-nextgen.test.mjs` to validate all 6 consolidated skills, `.agent/scripts/kanban-sync.sh`, `executeCompositeStage`, `parseCoverageReport`, `parseMutationReport`, policy-driven `checkArchDiff`, and polyglot `scaffoldReproductionTest`.
