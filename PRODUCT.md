# 🏛️ Product Constitution: Agentic SDLC Framework

> **Single Source of Truth (`PRODUCT.md`)**
> Generated & governed by **Agentic SDLC Framework (`sdlc-product`)**.
> Any architectural or contract deviation from this constitution requires a linked **ADR (`docs/adr/ADR-00X.md`)**.

---

## 1. Product Vision
End-to-end spec-driven autonomous software development lifecycle, Spec-Drift ADR engine, 4-Layer Git Lockdown, real polyglot Dual-Gate verification, and zero-dependency Architecture & Causal Decision Workbench governed by the universal `/sdlc` command router and verb-driven lifecycle skills.

---

## 2. Hard Domain & System Invariants (`INV-XX`)
- **INV-01**: Zero direct commits, merges, or pushes to main or develop; feature PRs merge into develop (default base branch), PRs targeting main must originate exclusively from develop, and releases trigger when develop merges to main
- **INV-02**: Changes require an active SDLC session and risk-proportional Dual-Gate verification (`trivial`, `standard`, or `full` lane) meeting the coverage, mutation, and peer-review thresholds configured in `.agent/sdlc-config.json`
- **INV-03**: All spec drift must be recorded via an ADR (docs/adr/ADR-00X.md) and synchronized with PRODUCT.md
- **INV-04**: Zero shell command interpolation of untrusted user/markdown inputs in PM, Git, or test runner execution paths

---

## 3. Product Capabilities & Spec Traceability Matrix (`CAP-XX`)

| Capability ID | Capability Title | Functional Spec | Depends On | Status |
| :--- | :--- | :--- | :--- | :--- |
| CAP-01 | Composite Stage CLI & Session Hygiene (#68) | `docs/specs/cap-01-composite-stage-session.md` | None | `AMENDED (ADR-019)` |
| CAP-02 | Shell Injection Remediation & Polyglot Test Runners (#69) | `docs/specs/cap-02-security-polyglot-runners.md` | None | `AMENDED (ADR-019)` |
| CAP-03 | Real Coverage/Mutation Parsers & Policy ArchDiff (#70) | `docs/specs/cap-03-real-dual-gate-archdiff.md` | CAP-01, CAP-02 | `AMENDED (ADR-019)` |
| CAP-04 | Live Canary Watchdog, Real Proofs & Polyglot Reproduce (#71) | `docs/specs/cap-04-live-probes-reproduce.md` | CAP-02 | `AMENDED (ADR-019)` |
| CAP-05 | Consolidate 14 Skills into 6 Schema-Valid Core Skills (#72) | `docs/specs/cap-05-skill-consolidation.md` | CAP-03, CAP-04 | `AMENDED (ADR-019)` |
| CAP-06 | Dogfooding Configuration, Docs Sync & Full Test Suite (#73) | `docs/specs/cap-06-dogfood-docs-tests.md` | CAP-05 | `AMENDED (ADR-019)` |
| CAP-07 | Native `npx` Multi-Agent Interactive Installer & Legacy Installer Removal (#75) | `docs/specs/cap-07-npx-multi-agent-installer.md` | CAP-06 | `AMENDED (ADR-019)` |
| CAP-08 | `/sdlc` Universal Command Router & 9 Verb-Driven Skills (#81) | `docs/specs/cap-08-command-verb-skills-router.md` | CAP-05, CAP-07 | `AMENDED (ADR-019)` |
| CAP-09 | Two-Tier PRD & IEEE 29148 SRS Specification Engine (#84) | `docs/specs/cap-09-prd-srs-specification-engine.md` | CAP-05, CAP-08 | `AMENDED (ADR-019)` |
| CAP-10 | Unified Multi-Provider Ticket Engine & Issue Templates (#86) | `docs/specs/cap-10-unified-multi-provider-ticket-engine-issue-templ.md` | CAP-02, CAP-09 | `AMENDED (ADR-019)` |
| CAP-11 | Technical Writer Skill (`sdlc-wiki`) & Archlens AST-to-Wiki Sync (#90) | `docs/specs/cap-11-technical-writer-archlens-wiki-sync.md` | CAP-03, CAP-05, CAP-08 | `AMENDED (ADR-019)` |

---

## 4. Genesis & Milestone Execution Rules
- **Genesis Ticket `#1`**: `feature/issue-#1-product-genesis` initializes `PRODUCT.md`, baseline specs, and project scaffolding.
- **Zero-Bypass Merge Rule**: No PR merges to `main` without a signed Stage 7 HMAC-SHA256 Hash-Chain Gate Receipt.
- **Composite Stage Execution**: Use `sdlc-engine stage <begin|pre-pr|complete>` to enforce atomic session, branch, PM board, and receipt transitions.

---

## 5. Architectural Decision Log Index (`ADR-XXX`)
<!-- ADR_INDEX_START -->
| ADR ID | Title | Scope | Status | Ticket | Supersedes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| *None* | *Compacted into SRS.md (v0.0.2)* | - | - | - | - |
| ADR-019 | v0.1.0 Alignment and Proof Kernel Simplification | `technical` | `accepted` | #190 | CAP-01, CAP-02, CAP-03, CAP-04, CAP-05, CAP-06, CAP-07, CAP-08, CAP-09, CAP-10, CAP-11 |
<!-- ADR_INDEX_END -->
