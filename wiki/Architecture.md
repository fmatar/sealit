# Agentic SDLC Architecture

The Agentic SDLC Framework utilizes an autonomous 8-stage lifecycle orchestrated by `sdlc-flow`.

## The 8-Stage Lifecycle

```
1. Intake & Contract Specification (sdlc-feature-spec & status:ready)
   │
   ▼
2. Branch & Kanban Automation (feature/issue-#<id>-<title> & status:in-progress)
   │
   ▼
3. TDD Implementation (sdlc-tdd-implement: Svelte 5 + Quarkus Java 25)
   │
   ▼
4. Test & Coverage Enforcer (sdlc-test-coverage: >= 90% Diff Coverage Loop)
   │
   ▼
5. Documentation & Changelog Sync (sdlc-docs-wiki)
   │
   ▼
6. Pull Request Creation (create_pull_request & status:in-review)
   │
   ▼
7. Parallel Subagent Peer Review (sdlc-peer-review) & Quality Gate (sdlc-quality-gate)
   │
   ▼
8. Quality Gate, Release & Done (sdlc-quality-gate, sdlc-release-changelog & status:done)
```

## Detailed Flow Breakdown
1. **Intake & Contract**: A GitHub Issue triggers the flow. `sdlc-feature-spec` loads specifications and acceptance criteria, tagging the ticket `status:ready`.
2. **Branching & Kanban**: `sdlc-flow` cuts a clean feature branch, updates the ticket to `status:in-progress`, and syncs `docs/KANBAN.md` via `sdlc-kanban`.
3. **TDD Implementation**: Unit tests are created first, followed by clean-room implementation in Svelte 5 and Quarkus.
4. **Coverage Enforcement**: JaCoCo and Vitest reports are parsed against the git diff to enforce **$\ge$ 90%** coverage. Missing tests are automatically generated.
5. **Documentation Sync**: `docs/specs/`, `CHANGELOG.md`, `docs/KANBAN.md`, and inline docstrings are synchronized.
6. **PR Creation**: A GitHub Pull Request is pushed and opened, tagging the ticket `status:in-review`.
7. **Parallel Peer Review & Quality Gate**: An independent subagent audits the PR diff and posts comments (`sdlc-peer-review`), while the quality gate validates formatting and builds (`sdlc-quality-gate`).
8. **Release & Deploy**: Changes are merged, SemVer tagged, Dockerized, and deployed via Helm. Ticket is marked `status:done` and `docs/KANBAN.md` refreshed.
