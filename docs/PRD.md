# Product Requirements Document (PRD): Agentic SDLC Framework

## 1. Meta & Traceability
- **Product Title**: Agentic SDLC Framework
- **Constitutional Source of Truth**: [`PRODUCT.md`](../PRODUCT.md)
- **Companion System Specification**: [`docs/SRS.md`](./SRS.md)
- **Decision Lineage Map**: [`docs/DECISION_MAP.md`](./DECISION_MAP.md)
- **Status**: `ACTIVE`

## 2. Problem Alignment (The "Why")
- **Problem Statement**: End-to-end spec-driven autonomous software development lifecycle, Spec-Drift ADR engine, 4-Layer Git Lockdown, real polyglot Dual-Gate verification, and SvelteKit 5 Causal Decision Workbench governed by 6 focused agentic skills.
- **Target Audience**: AI-native engineering teams, software architects, and autonomous coding agents (**Gemini / Antigravity**, **Claude Code**, **Cursor**, **Grok**, **Windsurf**, **GitHub Copilot**).
- **Value Proposition**: Replaces ad-hoc prompt engineering and fragile scripts with a deterministic, cryptographically verifiable 8-stage software engineering lifecycle.
- **Business & Engineering Goal**: Maximize feature velocity while guaranteeing zero architectural drift, zero shell injection vulnerabilities, and verified Dual-Gate test quality.

## 3. Scope & Product Capabilities (The "What")
### In Scope (`CAP-XX` Capability Portfolio)
- **CAP-01 (Composite Stage CLI & Session Hygiene (#68))**: Governed by [`docs/specs/cap-01-composite-stage-session.md`](../docs/specs/cap-01-composite-stage-session.md) (Depends on: None)
- **CAP-02 (Shell Injection Remediation & Polyglot Test Runners (#69))**: Governed by [`docs/specs/cap-02-security-polyglot-runners.md`](../docs/specs/cap-02-security-polyglot-runners.md) (Depends on: None)
- **CAP-03 (Real Coverage/Mutation Parsers & Policy ArchDiff (#70))**: Governed by [`docs/specs/cap-03-real-dual-gate-archdiff.md`](../docs/specs/cap-03-real-dual-gate-archdiff.md) (Depends on: CAP-01, CAP-02)
- **CAP-04 (Live Canary Watchdog, Real Proofs & Polyglot Reproduce (#71))**: Governed by [`docs/specs/cap-04-live-probes-reproduce.md`](../docs/specs/cap-04-live-probes-reproduce.md) (Depends on: CAP-02)
- **CAP-05 (Consolidate 14 Skills into 6 Schema-Valid Core Skills (#72))**: Governed by [`docs/specs/cap-05-skill-consolidation.md`](../docs/specs/cap-05-skill-consolidation.md) (Depends on: CAP-03, CAP-04)
- **CAP-06 (Dogfooding Configuration, Docs Sync & Full Test Suite (#73))**: Governed by [`docs/specs/cap-06-dogfood-docs-tests.md`](../docs/specs/cap-06-dogfood-docs-tests.md) (Depends on: CAP-05)
- **CAP-07 (Native `npx` Multi-Agent Interactive Installer & Legacy Installer Removal (#75))**: Governed by [`docs/specs/cap-07-npx-multi-agent-installer.md`](../docs/specs/cap-07-npx-multi-agent-installer.md) (Depends on: CAP-06)
- **CAP-08 (`/sdlc` Universal Command Router & 8 Verb-Driven Skills (#81))**: Governed by [`docs/specs/cap-08-command-verb-skills-router.md`](../docs/specs/cap-08-command-verb-skills-router.md) (Depends on: CAP-05, CAP-07)
- **CAP-09 (Two-Tier PRD & IEEE 29148 SRS Specification Engine (#84))**: Governed by [`docs/specs/cap-09-prd-srs-specification-engine.md`](../docs/specs/cap-09-prd-srs-specification-engine.md) (Depends on: CAP-05, CAP-08)

### Out of Scope (Non-Goals)
- Bypassing the 4-Layer Git Guard or merging unverified code without a Stage 7 SHA-256 Merkle Gate Receipt.

## 4. User Experience & Core Flows
- **Onboarding Flow**: `npx github:fmatar/agentic-sdlc-framework install` -> select coding agents -> run `/sdlc-doctor`.
- **Product Architecture Flow**: `/sdlc-product` synthesizes `PRODUCT.md`, `docs/PRD.md`, `docs/SRS.md`, and `docs/specs/cap-XX-*.md`, then schedules topological DAG waves.
- **Ticket Delivery Flow**: `/sdlc-flow` executes `stage begin` -> `/sdlc-tdd` -> `stage pre-pr` -> `/sdlc-gate` -> `stage complete`.

## 5. Metrics, Success & Guardrails (The "How We Measure")
- **Primary Quality Metrics**: Diff Test Coverage `>= 85%`, Mutation Score `>= 80%`.
- **Guardrail Invariants (`INV-XX`)**:
- **INV-01**: Zero direct commits, merges, or pushes to main or develop
- **INV-02**: 100% of code changes require an active SDLC ticket session and Dual-Gate verification (>=85% coverage, >=80% mutation)
- **INV-03**: All spec drift must be recorded via an ADR (docs/adr/ADR-00X.md) and synchronized with PRODUCT.md
- **INV-04**: Zero shell command interpolation of untrusted user/markdown inputs in PM, Git, or test runner execution paths

## 6. Go-To-Market & Rollout
- **Rollout Plan**: Continuous semantic versioning via `/sdlc-release` with automated regression proofs (`docs/proofs/`) and live canary health watchdog probes.
