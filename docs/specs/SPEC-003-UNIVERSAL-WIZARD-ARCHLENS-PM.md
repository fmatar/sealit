# SPEC-003: Universal Detect-First Wizard, Archlens Clean Architecture Governance & Pluggable Project Management

- **Status**: Approved / In Implementation
- **Author**: Agentic SDLC Core Team
- **Date**: 2026-10-02
- **Standard**: RFC 2119, IEEE 29148, Uncle Bob Clean Architecture

---

## 1. Problem Statement & Motivation

1. **Stack Opinionation Friction**: `sdlc-initialize` previously assumed every greenfield or brownfield project should scaffold Svelte 5 + Quarkus Java 25. This caused friction when initializing existing codebases (Python, Go, Node, Spring Boot).
2. **Missing Architectural Layer Verification**: While Dual-Gate testing enforces $\ge 85\%$ coverage and $\ge 80\%$ mutation scores, it lacked enforcement of Uncle Bob's **Dependency Rule** (inner layers must never depend on outer layers). Archlens (`/archlens`) provides this governance, but was not integrated into `sdlc-quality-gate` or `sdlc-peer-review`.
3. **Project Management Provider Coupling**: `sdlc-kanban` and `sdlc-flow` were hardcoded to GitHub issues and `gh` CLI. Modern agent environments often have tokens for **Jira** (Atlassian) or **Linear** via MCP servers.
4. **Environment Transparency & Updates**: Missing documented environment variables led to silent runtime failures. There was no unified command (`install.sh --update` / `sdlc-engine.mjs update`) to sync framework assets and Archlens policies.

---

## 2. Technical Architecture & Component Changes

```
┌────────────────────────────────────────────────────────┐
│            Universal SDLC Engine (sdlc-engine.mjs)     │
├────────────────────┬─────────────────┬─────────────────┤
│ Universal Detect   │ Pluggable PM    │ Archlens Bridge │
│ & CI Reverse Eng   │ (GH/Jira/Linear)│ & Env Diagnostic│
└─────────┬──────────┴────────┬────────┴────────┬────────┘
          │                   │                 │
          ▼                   ▼                 ▼
   sdlc-initialize       sdlc-kanban       sdlc-quality-gate
 (Detect-First Wizard)  (Multi-Provider)   & sdlc-peer-review
```

### 2.1 Universal Detect-First Wizard (`sdlc-initialize`)
- Always probes repo root first via `sdlc-engine detect`.
- Prompts via structured interactive choice (`ask_question`):
  1. Confirm or fine-tune detected stack and test commands.
  2. Opt-in to Archlens Clean Architecture governance & MCP workbench.
  3. Select active Project Management provider (GitHub, Jira, Linear, or Local Markdown).

### 2.2 Archlens Clean Architecture Governance
- `sdlc-quality-gate` inspects `.archlens/policy.json`. If present or enabled, checks for circular dependencies and inward dependency violations (Level 0 importing Level 2/3).
- `sdlc-peer-review` audits PR diffs against Dependency Inversion Principle (DIP).
- `sdlc-flow` announces stage transitions to `.archlens/to-viewer.json`.

### 2.3 Pluggable Project Management Provider
- Normalized interface in `sdlc-engine.mjs`:
  - `status`: Validate authentication and provider connectivity.
  - `transition <issueId> <state>`: Map SDLC 5-stage states (Backlog, Ready, InProgress, InReview, Done) to provider status IDs.
  - `comment <issueId> <message>`: Post markdown updates.
  - `sync`: Synchronize `docs/KANBAN.md` with cloud or local state.

### 2.4 Environment Variables & Pre-Flight Diagnostics
- Documented in `.env.example`.
- Verified via `node .agent/scripts/sdlc-engine.mjs env`.

---

## 3. Definition of Done (Acceptance Criteria)

- [x] `.env.example` created and documented.
- [x] `sdlc-engine.mjs env` diagnostic command implemented.
- [x] `sdlc-engine.mjs pm` and `archlens` abstractions implemented.
- [x] `sdlc-initialize/SKILL.md` updated to detect-first and structured interactive wizard.
- [x] `sdlc-quality-gate/SKILL.md` and `sdlc-peer-review/SKILL.md` enforce Archlens governance.
- [x] `install.sh` supports `--update` and `--with-archlens`.
- [x] Unit test suite updated and passing 100%.
