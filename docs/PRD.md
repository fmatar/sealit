# Product Requirements Document (PRD): Agentic SDLC Framework

## 1. Meta & Traceability
- **Product Title**: Agentic SDLC Framework
- **Constitutional Source of Truth**: [`PRODUCT.md`](../PRODUCT.md)
- **Companion System Specification**: [`docs/SRS.md`](./SRS.md)
- **Decision Lineage Map**: [`docs/DECISION_MAP.md`](./DECISION_MAP.md)
- **Status**: `ACTIVE`

## 2. Problem Alignment (The "Why")
- **Problem Statement**: End-to-end spec-driven autonomous software development lifecycle with risk-proportional execution lanes (`trivial`, `standard`, `full`), [Archlens](https://github.com/fmatar/archlens) concentric Clean Architecture governance (`.archlens/policy.json`), Spec-Drift ADR engine, 4-Layer Git Lockdown, config-driven polyglot Dual-Gate verification, and a zero-dependency loopback Architecture & Causal Decision Workbench (`.agent/scripts/lib/workbench-server.mjs`) governed by 10 canonical agentic skills.
- **Target Audience**: AI-native engineering teams, software architects, and autonomous coding agents (**Gemini / Antigravity**, **Claude Code**, **Cursor**, **Grok**, **Windsurf**, **GitHub Copilot**).
- **Value Proposition**: Replaces ad-hoc prompt engineering and fragile scripts with a deterministic, cryptographically verifiable 8-stage software engineering lifecycle that scales ceremony to change risk.
- **Business & Engineering Goal**: Maximize feature velocity while guaranteeing zero architectural drift, zero shell injection vulnerabilities, and verified Dual-Gate test quality.

## 3. Scope & Product Capabilities (The "What")
### In Scope (`CAP-XX` Capability Portfolio)
- **CAP-01 (Composite Stage CLI & Session Hygiene (#68))**: Governed by [`docs/specs/cap-01-composite-stage-session.md`](../docs/specs/cap-01-composite-stage-session.md) (Depends on: None)
- **CAP-02 (Shell Injection Remediation & Polyglot Test Runners (#69))**: Governed by [`docs/specs/cap-02-security-polyglot-runners.md`](../docs/specs/cap-02-security-polyglot-runners.md) (Depends on: None)
- **CAP-03 (Real Coverage/Mutation Parsers & Policy ArchDiff (#70))**: Governed by [`docs/specs/cap-03-real-dual-gate-archdiff.md`](../docs/specs/cap-03-real-dual-gate-archdiff.md) (Depends on: CAP-01, CAP-02)
- **CAP-04 (Live Canary Watchdog, Real Proofs & Polyglot Reproduce (#71))**: Governed by [`docs/specs/cap-04-live-probes-reproduce.md`](../docs/specs/cap-04-live-probes-reproduce.md) (Depends on: CAP-02)
- **CAP-05 (Consolidate Legacy Skills into Schema-Valid Core Skills (#72, standardized on 10 canonical skills))**: Governed by [`docs/specs/cap-05-skill-consolidation.md`](../docs/specs/cap-05-skill-consolidation.md) (Depends on: CAP-03, CAP-04)
- **CAP-06 (Dogfooding Configuration, Docs Sync & Full Test Suite (#73))**: Governed by [`docs/specs/cap-06-dogfood-docs-tests.md`](../docs/specs/cap-06-dogfood-docs-tests.md) (Depends on: CAP-05)
- **CAP-07 (Native `npx` Multi-Agent Interactive Installer & Legacy Installer Removal (#75))**: Governed by [`docs/specs/cap-07-npx-multi-agent-installer.md`](../docs/specs/cap-07-npx-multi-agent-installer.md) (Depends on: CAP-06)
- **CAP-08 (`/sdlc` Universal Command Router & 9 Verb-Driven Skills (#81/#109/#116))**: Governed by [`docs/specs/cap-08-command-verb-skills-router.md`](../docs/specs/cap-08-command-verb-skills-router.md) (Depends on: CAP-05, CAP-07)
- **CAP-09 (Two-Tier PRD & IEEE 29148 SRS Specification Engine (#84))**: Governed by [`docs/specs/cap-09-prd-srs-specification-engine.md`](../docs/specs/cap-09-prd-srs-specification-engine.md) (Depends on: CAP-05, CAP-08)
- **CAP-10 (Unified Multi-Provider Ticket Engine & Issue Templates (#86))**: Governed by [`docs/specs/cap-10-unified-multi-provider-ticket-engine-issue-templ.md`](../docs/specs/cap-10-unified-multi-provider-ticket-engine-issue-templ.md) (Depends on: CAP-02, CAP-09)
- **CAP-11 (Technical Writer Skill (`sdlc-wiki`), 10-30-90 `README.md` & [Archlens](https://github.com/fmatar/archlens) AST-to-Wiki Sync (#90/#100))**: Governed by [`docs/specs/cap-11-technical-writer-archlens-wiki-sync.md`](../docs/specs/cap-11-technical-writer-archlens-wiki-sync.md) (Depends on: CAP-03, CAP-05, CAP-08)

### Out of Scope (Non-Goals)
- Bypassing the 4-Layer Git Guard or merging unverified code without a signed Stage 7 HMAC-SHA256 Gate Receipt.
- Bundling, prescribing, or deleting standalone coding-persona or design skills outside the `sdlc*` namespace (`ADR-011`).

## 4. User Experience & Core Flows
- **Onboarding Flow**: `npx --yes github:fmatar/agentic-sdlc-framework install` -> select coding agents -> run `/sdlc-doctor` (and optionally `npx skills add fmatar/archlens` for [Archlens](https://github.com/fmatar/archlens) MCP/visual workbench integration).
- **Product Architecture Flow**: `/sdlc-product` synthesizes `PRODUCT.md`, `docs/PRD.md`, `docs/SRS.md`, and `docs/specs/cap-XX-*.md`, then schedules topological DAG waves.
- **Risk-Proportional Ticket Delivery Flow**: `/sdlc-flow` auto-triages into `trivial`, `standard`, or `full` lanes across `stage begin` -> `/sdlc-tdd` -> `stage pre-pr` -> `/sdlc-gate` -> `stage complete`.

## 5. Metrics, Success & Guardrails (The "How We Measure")
- **Primary Quality Metrics**: Config-driven Dual-Gate thresholds in `.agent/sdlc-config.json` (default `>= 85%` coverage; configurable mutation kill threshold per repo).
- **Guardrail Invariants (`INV-XX`)**:
- **INV-01**: Zero direct commits, merges, or pushes to main or develop; feature PRs merge to develop, and releases trigger when develop merges to main
- **INV-02**: Changes require an active SDLC session and risk-proportional Dual-Gate verification (`trivial`, `standard`, or `full` lane) meeting the coverage, mutation, and peer-review thresholds configured in `.agent/sdlc-config.json`
- **INV-03**: All spec drift must be recorded via an ADR (docs/adr/ADR-00X.md) and synchronized with PRODUCT.md
- **INV-04**: Zero shell command interpolation of untrusted user/markdown inputs in PM, Git, or test runner execution paths

## 6. Go-To-Market & Rollout
- **Rollout Plan**: Continuous semantic versioning via `/sdlc-release` with automated regression proofs (`docs/proofs/`) and live canary health watchdog probes.
