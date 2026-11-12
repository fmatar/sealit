<!-- AGENTIC-SDLC-RULES:START -->
# Agentic SDLC Framework Invariants & Autonomous Rules
_Generated automatically by @fmatar/agentic-sdlc (Universal Engine v0.3.2)_
_Adheres strictly to Robert C. Martin Clean Code & Clean Architecture_

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

## 4. Universal Router + Lifecycle Skills Suite
- `/sdlc`: Universal 1:1 subcommand router (`/sdlc doctor`, `/sdlc begin #id`, `/sdlc status`, `/sdlc drift`, `/sdlc pre-pr`, `/sdlc gate`, `/sdlc kanban`, `/sdlc ui`).
- `/sdlc-flow`: End-to-end ticket orchestrator (`stage begin` -> TDD -> `stage pre-pr` -> review -> `stage complete`).
- `/sdlc-product`: Constitutional `PRODUCT.md` autopilot, `docs/specs/` architect, and topological DAG waves.
- `/sdlc-doctor`: Stack detection, `doctor --fix`, SHA-256 verified 4-Layer Git hooks, `.archlens/policy.json`, and multi-agent installer.
- `/sdlc-status`: Active session, 8-stage progress, drift check, `KANBAN.md` state, and Architecture Diff snapshot.
- `/sdlc-tdd`: Robert Martin Red-Green-Refactor TDD, polyglot test runners, and real coverage/mutation report parsers.
- `/sdlc-gate`: Risk-tiered PR review subagents, `gate --strict`, and Stage 7 HMAC-SHA256 Merkle Gate Receipt.
- `/sdlc-adr`: Mint, approve, or compact Spec-Drift ADRs (`adr compact`) and synchronize `docs/DECISION_MAP.md`.
- `/sdlc-wiki`: 10-30-90 `README.md` landing page & AST-to-Wiki synchronization (`readme audit`, `wiki sync`).
- `/sdlc-release`: ADR compaction into `docs/SRS.md`, Docs/Wiki sync, SemVer tagging, regression proofs, and canary watchdog.
- `/ub-mode`: Robert C. Martin reduced principles (First Make it Work, Then Make it Right, Follow Practice).
<!-- AGENTIC-SDLC-RULES:END -->
