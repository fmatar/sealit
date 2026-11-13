# SPEC-01: Composite Stage CLI & Session Hygiene (`CAP-01`)

- **Linked Capability**: `CAP-01`
- **Status**: `ACTIVE`
- **Depends On**: `None`

## 1. Problem Statement & Motivation
The 8-stage `/sdlc-flow` orchestrator previously required the agent to invoke ~15 granular CLI commands per ticket (`session start`, `session advance`, `pm transition`, `drift check`, `decision-graph sync`, `trace record`, `guard receipt`, `pr-summary`, `session release`). In practice, LLMs frequently skipped intermediate commands or abandoned sessions, leaving 14 zombie `"active": true` sessions committed in `.agent/.sdlc-session.json`.

## 2. Domain Contract & Acceptance Criteria
1. **Composite Stage Orchestrator (`executeCompositeStage`)**:
   - `sdlc-engine stage begin [--issue=<id>|--local|--lane=trivial|--create-issue] [--title="..."] [--type=feat|fix|chore] [--checkout]`:
     - Requires an existing `--issue=<id>`, `--local` (local `L-*` session), `--lane=trivial` (local `L-*` fast-path), or explicit `--create-issue` opt-in before creating any remote PM ticket (never creates a GitHub/Linear/Jira issue implicitly).
     - Starts an active session at Stage 2 (`Architecture & Branch Creation`).
     - Checks out or creates `feature/issue-#<id>-<slug>` (or `feature/L-<id>-<slug>` / `chore/L-<id>-<slug>` for local sessions) when in an initialized git repository.
     - Transitions remote tickets to `in-progress` on the configured PM board (skipped for local `L-*` sessions).
   - `sdlc-engine stage pre-pr --issue=#<id>`:
     - Advances the active session through Stage 5 and Stage 6.
     - Evaluates `checkSpecDrift`, synchronizes `docs/DECISION_MAP.md` (`syncDecisionMapMarkdown`), and records architectural traceability (`recordArchTrace`).
     - Issues the cryptographic Stage 7 SHA-256 Merkle Gate Receipt (`issueGateReceipt`).
     - Generates the standardized PR summary (`generatePRSummary`).
   - `sdlc-engine stage complete --issue=#<id> [--pr=#<num>]`:
     - Advances the active session to Stage 8 (`Release & Retrospective`).
     - Transitions the ticket to `done` on the PM board and synchronizes `docs/KANBAN.md`.
     - Releases the active session lock (`releaseSession`).
2. **Session & Cache Hygiene (`.gitignore`)**:
   - Ignore `.agent/.sdlc-session.json`, `.agent/.cache/`, `node_modules/`, and `coverage/` in `.gitignore`.
   - Purge stale/zombie active sessions from `.agent/.sdlc-session.json`.
