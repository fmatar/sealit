---
id: ADR-002
title: Consolidate 14 Skills into 6 Schema-Valid Skills, Add Composite Stage CLI, and Enforce Real Dual-Gate Verification
status: accepted
scope: architectural
ticket: #68
supersedes: CAP-01, CAP-02, CAP-03, CAP-04, CAP-05, CAP-06
createdAt: 2026-10-25T22:05:00.000Z
---

# ADR-002: Consolidate 14 Skills into 6 Schema-Valid Skills, Add Composite Stage CLI, and Enforce Real Dual-Gate Verification

- **Status**: `accepted`
- **Blast Radius / Scope**: `architectural`
- **Triggered By Ticket**: #68
- **Supersedes / Amends**: CAP-01, CAP-02, CAP-03, CAP-04, CAP-05, CAP-06

## 1. Context & Spec Drift Trigger
A comprehensive architectural audit of `fmatar/agentic-sdlc-framework` revealed six structural deficiencies:
1. **Session & Bookkeeping Drift (`CAP-01`)**: `sdlc-flow` required ~15 separate CLI calls per ticket, resulting in skipped stage transitions and 14 zombie `"active": true` sessions committed in `.agent/.sdlc-session.json`.
2. **Shell Injection & Hardcoded Node Runners (`CAP-02`)**: `pm-provider.mjs` interpolated untrusted Markdown strings into `execSync(\`gh ...\`)` and `execSync(\`curl ...\`)` shell commands; `runFlakeCheck` and `test --affected-only` hardcoded `node --test`.
3. **Simulated Dual-Gate & Policy-Blind ArchDiff (`CAP-03`)**: `coverage` and `mutation` never parsed coverage/mutation reports; `generatePRSummary` fabricated `'90%'` and `'85%'` when unmeasured; `checkArchDiff` ignored `.archlens/policy.json` ring definitions.
4. **Simulated Watchdog, Proofs & Reproduction (`CAP-04`)**: `watchdog`, `proof`, and `reproduce` relied on static mock values or immediate-pass JS assertions.
5. **Skill Bloat & Invalid Tool Schemas (`CAP-05`)**: 14 skills in `.agent/skills/` referenced non-existent tools (`view_file`, `write_to_file`, `replace_file_content`), invalid `invoke_subagent` wrappers, and project-specific "BYOA/Quarkus" requirements.
6. **Incomplete Self-Dogfooding (`CAP-06`)**: `.agent/sdlc-config.json` only ran 1 of the 3 test files without coverage flags.

## 2. Decision
1. Introduce `sdlc-engine stage <begin|pre-pr|complete>` (`executeCompositeStage` in `session.mjs`) and ignore `.agent/.sdlc-session.json` and `.agent/.cache/` in `.gitignore`.
2. Replace shell-interpolated `execSync` calls in `pm-provider.mjs` with `execFileSync` argument arrays and introduce `buildSingleTestCommand` for polyglot single-test execution.
3. Implement `parseCoverageReport` and `parseMutationReport` in `quality-gate.mjs`, remove fake `'90%'`/`'85%'` PR summary fallbacks, and upgrade `checkArchDiff` to enforce `.archlens/policy.json` layers.
4. Upgrade `monitorCanaryHealthAndWatchdog`, `generateRegressionProof`, and `scaffoldReproductionTest` to support live HTTP probes, real file SHA-256 digests, and polyglot Red-first test generation while preserving deterministic offline unit-test hooks.
5. Consolidate the 14 skills into **6 canonical skills** (`sdlc-flow`, `sdlc-product`, `sdlc-tdd`, `sdlc-review-gate`, `sdlc-release`, `sdlc-init`) with valid tool schemas (`read_file`, `write_file`, `edit_file`, `invoke_subagent`), relocating `kanban-sync.sh` and `project-setup.sh` to `.agent/scripts/`.
6. Update `.agent/sdlc-config.json`, `package.json`, documentation, and test suites to dogfood all 3 test files with coverage.

## 3. Consequences & Downstream Impact
- 73% reduction in CLI invocations per ticket lifecycle (from ~15 commands to 4).
- Zero shell injection surface in PM issue/comment creation.
- Real threshold verification across Node.js, Java, Python, Go, and Rust coverage/mutation reports.
- Clean 6-skill architecture with 100% valid tool schemas and zero project-specific leakage.
