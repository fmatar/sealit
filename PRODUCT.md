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
| CAP-01 | Composite Stage CLI & Session Hygiene (#68) | `docs/specs/cap-01-composite-stage-session.md` | None | `AMENDED (ADR-015)` |
| CAP-02 | Shell Injection Remediation & Polyglot Test Runners (#69) | `docs/specs/cap-02-security-polyglot-runners.md` | None | `AMENDED (ADR-016)` |
| CAP-03 | Real Coverage/Mutation Parsers & Policy ArchDiff (#70) | `docs/specs/cap-03-real-dual-gate-archdiff.md` | CAP-01, CAP-02 | `AMENDED (ADR-016)` |
| CAP-04 | Live Canary Watchdog, Real Proofs & Polyglot Reproduce (#71) | `docs/specs/cap-04-live-probes-reproduce.md` | CAP-02 | `AMENDED (ADR-015)` |
| CAP-05 | Consolidate 14 Skills into 6 Schema-Valid Core Skills (#72) | `docs/specs/cap-05-skill-consolidation.md` | CAP-03, CAP-04 | `AMENDED (ADR-011)` |
| CAP-06 | Dogfooding Configuration, Docs Sync & Full Test Suite (#73) | `docs/specs/cap-06-dogfood-docs-tests.md` | CAP-05 | `AMENDED (ADR-014)` |
| CAP-07 | Native `npx` Multi-Agent Interactive Installer & Legacy Installer Removal (#75) | `docs/specs/cap-07-npx-multi-agent-installer.md` | CAP-06 | `AMENDED (ADR-011)` |
| CAP-08 | `/sdlc` Universal Command Router & 9 Verb-Driven Skills (#81) | `docs/specs/cap-08-command-verb-skills-router.md` | CAP-05, CAP-07 | `AMENDED (ADR-011)` |
| CAP-09 | Two-Tier PRD & IEEE 29148 SRS Specification Engine (#84) | `docs/specs/cap-09-prd-srs-specification-engine.md` | CAP-05, CAP-08 | `AMENDED (ADR-006)` |
| CAP-10 | Unified Multi-Provider Ticket Engine & Issue Templates (#86) | `docs/specs/cap-10-unified-multi-provider-ticket-engine-issue-templ.md` | CAP-02, CAP-09 | `AMENDED (ADR-006)` |
| CAP-11 | Technical Writer Skill (`sdlc-wiki`) & Archlens AST-to-Wiki Sync (#90) | `docs/specs/cap-11-technical-writer-archlens-wiki-sync.md` | CAP-03, CAP-05, CAP-08 | `AMENDED (ADR-010)` |

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
| *None* | *Compacted into SRS.md (0.0.1)* | - | - | - | - |
| ADR-009 | Align README, Wiki, PRD and SRS Documentation with v0.4.0 Architecture and Archlens Links | `technical` | `accepted` | #114 | CAP-06, CAP-11 |
| ADR-010 | Standardize on 10 Canonical SDLC Skills, Neutralize Engineering Terminology, and Compact README Workflow Diagram | `technical` | `accepted` | #116 | CAP-05, CAP-07, CAP-08, CAP-11 |
| ADR-011 | Strict sdlc Namespace Isolation and Decoupling from Standalone Coding-Persona Skills | `technical` | `accepted` | #118 | CAP-05, CAP-07, CAP-08, ADR-010 |
| ADR-012 | Reset Package, Plugin, and Documentation Version Baseline to 0.0.1 | `technical` | `accepted` | #120 | CAP-06, ADR-009 |
| ADR-013 | Harden Release Gate, Opt-In Issue Creation, Universal ADR Approval, Diff Review Plans, and Node 24 CI Actions | `technical` | `accepted` | L-122000 | CAP-01, CAP-03, CAP-06 |
| ADR-014 | Canonical Git Flow: Enforce Merges to Develop, Block Direct PRs to Main, and Automate Production Releases on Develop Merge | `technical` | `accepted` | L-124000 | CAP-01, CAP-04, CAP-06 |
| ADR-015 | Harden Stage 7 Gate Receipts, Ring 0 Primitives, and Git Flow Verification | `technical` | `accepted` | L-128000 | CAP-01, CAP-04 |
| ADR-016 | Break Ring 2 Cycles, Decompose quality-gate.mjs, Enforce Whole-Graph Cycle Detection in checkArchDiff, and Align Archlens Policy Schema | `technical` | `accepted` | #134 | CAP-02, CAP-03 |
<!-- ADR_INDEX_END -->
