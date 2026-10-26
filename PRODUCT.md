# 🏛️ Product Constitution: Agentic SDLC Framework

> **Single Source of Truth (`PRODUCT.md`)**
> Generated & governed by **Agentic SDLC Framework (`sdlc-product`)**.
> Any architectural or contract deviation from this constitution requires a linked **ADR (`docs/adr/ADR-00X.md`)**.

---

## 1. Product Vision
End-to-end spec-driven autonomous software development lifecycle, Spec-Drift ADR engine, 4-Layer Git Lockdown, real polyglot Dual-Gate verification, and SvelteKit 5 Causal Decision Workbench governed by 6 focused agentic skills.

---

## 2. Hard Domain & System Invariants (`INV-XX`)
- **INV-01**: Zero direct commits, merges, or pushes to main or develop
- **INV-02**: 100% of code changes require an active SDLC ticket session and Dual-Gate verification (>=85% coverage, >=80% mutation)
- **INV-03**: All spec drift must be recorded via an ADR (docs/adr/ADR-00X.md) and synchronized with PRODUCT.md
- **INV-04**: Zero shell command interpolation of untrusted user/markdown inputs in PM, Git, or test runner execution paths

---

## 3. Product Capabilities & Spec Traceability Matrix (`CAP-XX`)

| Capability ID | Capability Title | Functional Spec | Depends On | Status |
| :--- | :--- | :--- | :--- | :--- |
| CAP-01 | Composite Stage CLI & Session Hygiene (#68) | `docs/specs/cap-01-composite-stage-session.md` | None | `AMENDED (ADR-002)` |
| CAP-02 | Shell Injection Remediation & Polyglot Test Runners (#69) | `docs/specs/cap-02-security-polyglot-runners.md` | None | `AMENDED (ADR-002)` |
| CAP-03 | Real Coverage/Mutation Parsers & Policy ArchDiff (#70) | `docs/specs/cap-03-real-dual-gate-archdiff.md` | CAP-01, CAP-02 | `AMENDED (ADR-002)` |
| CAP-04 | Live Canary Watchdog, Real Proofs & Polyglot Reproduce (#71) | `docs/specs/cap-04-live-probes-reproduce.md` | CAP-02 | `AMENDED (ADR-002)` |
| CAP-05 | Consolidate 14 Skills into 6 Schema-Valid Core Skills (#72) | `docs/specs/cap-05-skill-consolidation.md` | CAP-03, CAP-04 | `AMENDED (ADR-004)` |
| CAP-06 | Dogfooding Configuration, Docs Sync & Full Test Suite (#73) | `docs/specs/cap-06-dogfood-docs-tests.md` | CAP-05 | `AMENDED (ADR-002)` |
| CAP-07 | Native `npx` Multi-Agent Interactive Installer & Legacy Installer Removal (#75) | `docs/specs/cap-07-npx-multi-agent-installer.md` | CAP-06 | `AMENDED (ADR-004)` |
| CAP-08 | `/sdlc` Universal Command Router & 8 Verb-Driven Skills (#81) | `docs/specs/cap-08-command-verb-skills-router.md` | CAP-05, CAP-07 | `AMENDED (ADR-004)` |
| CAP-09 | Two-Tier PRD & IEEE 29148 SRS Specification Engine (#84) | `docs/specs/cap-09-prd-srs-specification-engine.md` | CAP-05, CAP-08 | `AMENDED (ADR-005)` |

---

## 4. Genesis & Milestone Execution Rules
- **Genesis Ticket `#1`**: `feature/issue-#1-product-genesis` initializes `PRODUCT.md`, baseline specs, and project scaffolding.
- **Zero-Bypass Merge Rule**: No PR merges to `main` without a signed Stage 7 SHA-256 Merkle Gate Receipt.
- **Composite Stage Execution**: Use `sdlc-engine stage <begin|pre-pr|complete>` to enforce atomic session, branch, PM board, and receipt transitions.

---

## 5. Architectural Decision Log Index (`ADR-XXX`)
<!-- ADR_INDEX_START -->
| ADR ID | Title | Scope | Status | Ticket | Supersedes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| ADR-001 | Decompose sdlc-engine.mjs into Modular Domain Libraries with SHA-256 Gate Cache and SvelteKit 5 Decision Workbench | `technical` | `accepted` | #63 | CAP-01 |
| ADR-002 | Consolidate 14 Skills into 6 Schema-Valid Skills, Add Composite Stage CLI, and Enforce Real Dual-Gate Verification | `architectural` | `accepted` | #68 | CAP-01, CAP-02, CAP-03, CAP-04, CAP-05, CAP-06 |
| ADR-003 | Replace Legacy Shell/Java Installers with Native npx Interactive Multi-Agent Installer Wizard | `architectural` | `accepted` | #75 | CAP-06, CAP-07 |
| ADR-004 | Introduce /sdlc Universal Router and 8 Verb-Driven Command Skills | `architectural` | `accepted` | #81 | CAP-05, CAP-07, CAP-08 |
| ADR-005 | Adopt Two-Tier PRD and IEEE 29148 SRS Specification Governance in sdlc-product | `architectural` | `accepted` | #84 | CAP-05, CAP-08, CAP-09 |
<!-- ADR_INDEX_END -->
