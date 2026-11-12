# Assistant Guidelines

## Archlens Clean Architecture Workbench Companion Protocol

This project is governed by the **Archlens Dynamic Clean Architecture Workbench**.
- **Workbench UI & API**: `http://localhost:8088`
- **Architectural Policy**: `.archlens/policy.json`
- **Mailbox IPC**:
  - Inbound queue: `.archlens/to-agent.json`
  - Outbound response: `.archlens/to-viewer.json`

### Handling Mailbox Commands:
1. **REGEN**: Re-index AST, evaluate package dependency rules, and acknowledge.
2. **APPLY_PROPOSAL**: Reorganize packages to conform to concentric rings (Adapters -> Application -> Domain Core). Where an inner layer relies on an outer layer, apply the **Dependency Inversion Principle** by creating an interface port in the inner layer and implementing it in the outer layer.
3. **REFRESH_CRAP**: Execute test suite and report code coverage metrics.

<!-- AGENTIC-SDLC-RULES:START -->
# Agentic SDLC Framework Invariants & Autonomous Rules
_Generated automatically by @fmatar/agentic-sdlc (Universal Engine v0.4.0)_
_Governed by Concentric Clean Architecture, Risk-Proportional Lanes & Config-Driven Dual-Gate TDD_

## 1. Zero Direct Pushes (4-Layer Git Guard — INV-01)
- Direct git commits, merges, or pushes to `develop` or `main` are STRICTLY FORBIDDEN.
- Every commit requires an active session in `.agent/.sdlc-session.json` matching the current branch (`node .agent/scripts/sdlc-engine.mjs stage begin`).
- Every merge into `main` requires a signed Stage 7 HMAC-SHA256 Merkle Gate Receipt in `docs/AUDIT_CHAIN.jsonl`.

## 2. Active Session & Config-Driven Dual-Gate Quality Verification (INV-02)
- Diff coverage and mutation kill thresholds are governed by `.agent/sdlc-config.json` (measured from real coverage and mutation reports on disk).
- Concentric ring Clean Architecture compliance: zero outer-layer imports into domain entities (`.archlens/policy.json`).
- Zero shell interpolation of untrusted inputs (`INV-04`).

## 3. PRODUCT.md Constitution & Spec Drift ADR Protocol (INV-03)
- Full-spec project handovers synthesize `PRODUCT.md` (`CAP-XX`, `INV-XX`, `SPEC-XX`) starting at Genesis Ticket `#1`.
- Any mutation to `PRODUCT.md`, `docs/specs/`, dependencies, C4 architecture boundaries, DB schemas, or API contracts MUST be accompanied by an ADR (`node .agent/scripts/sdlc-engine.mjs adr create`).

## 4. Universal Router + Lifecycle Skills Suite (10 Canonical Skills)
- `/sdlc`: Universal 1:1 subcommand router (`/sdlc doctor`, `/sdlc begin #id`, `/sdlc status`, `/sdlc drift`, `/sdlc pre-pr`, `/sdlc gate`, `/sdlc kanban`, `/sdlc ui`).
- `/sdlc-flow`: End-to-end ticket orchestrator (`stage begin` -> TDD -> `stage pre-pr` -> review -> `stage complete`).
- `/sdlc-product`: Constitutional `PRODUCT.md` autopilot, `docs/specs/` architect, and topological DAG waves.
- `/sdlc-doctor`: Stack detection, `doctor --fix`, SHA-256 verified 4-Layer Git hooks, `.archlens/policy.json`, and multi-agent installer.
- `/sdlc-status`: Active session, 8-stage progress, drift check, `KANBAN.md` state, and Architecture Diff snapshot.
- `/sdlc-tdd`: Red-Green-Refactor TDD, polyglot test runners, and real coverage/mutation report parsers.
- `/sdlc-gate`: Risk-tiered PR review subagents, `gate --strict`, and Stage 7 HMAC-SHA256 Merkle Gate Receipt.
- `/sdlc-adr`: Mint, approve, or compact Spec-Drift ADRs (`adr compact`) and synchronize `docs/DECISION_MAP.md`.
- `/sdlc-wiki`: 10-30-90 `README.md` landing page & AST-to-Wiki synchronization (`readme audit`, `wiki sync`).
- `/sdlc-release`: ADR compaction into `docs/SRS.md`, Docs/Wiki sync, SemVer tagging, regression proofs, and canary watchdog.
<!-- AGENTIC-SDLC-RULES:END -->
