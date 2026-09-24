---
name: sdlc-feature-spec
description: Generates formal Product Requirements (PRDs), Software Requirements (SRS), C4 Architecture diagrams, ADRs, and standardized GitHub Issues for new features.
version: 2.0.0
license: Apache 2.0
allowed-tools: run_command, view_file, write_to_file, replace_file_content, mcp_github-mcp-server_issue_read, mcp_github-mcp-server_issue_write, mcp_github-mcp-server_search_issues
---

# SDLC Feature Specification & Architecture Planning Skill (`sdlc-feature-spec`)

Use this skill when initiating new features, architectural refactors, or submitting GitHub Issues. It establishes rigorous engineering contracts before code is written.

---

## 📋 Core Responsibilities

- Produce **Product Requirements Documents (PRDs)** based on the SVPG standard using `docs/templates/PRD_TEMPLATE.md`.
- Produce **Software Requirements Specifications (SRS)** based on IEEE 29148 using `docs/templates/SRS_TEMPLATE.md`.
- Create **C4 Architecture Diagrams** (Context, Container, Component) using Mermaid.js based on `docs/templates/C4_ARCHITECTURE_TEMPLATE.md`.
- Draft **Architecture Decision Records (ADRs)** for technical tradeoffs using `docs/templates/ADR_TEMPLATE.md`.
- Draft standardized GitHub Issues with User Stories, Technical Context, Acceptance Criteria (Definition of Done), and Target Files.

---

## 🛠️ Step-by-Step Specification Workflow

### Step 1: Requirements Discovery & Technical Scope
- Determine feature intent, target personas, and user problem statement.
- Identify architectural boundaries: frontend components (Svelte 5 UI), backend APIs/services (Quarkus), and database entities.
- Identify external service integrations (e.g. OAuth providers, REST APIs, webhooks).

### Step 2: Draft the Technical Specification (RFC)
Structure the specification using this standard schema:

```markdown
# RFC: [Feature Title]

## 1. Problem Statement & User Value
- Core user need addressed.
- Target personas and key use cases.

## 2. Technical Architecture & Data Schema
- Data models to add/modify (`src/main/java/**` or `src/lib/types/`).
- Frontend state stores impacted (Svelte 5 Runes: `$state`, `$derived`).
- Backend endpoints and reactive service contracts (Mutiny `Uni`/`Multi`).

## 3. UI/UX & Responsive Layouts
- Impacted routes and components.
- State transitions (loading, error, empty, active).
- Accessibility (keyboard navigation, ARIA live regions, color contrast).

## 4. Acceptance Criteria (Gherkin Scenarios / DoD)
Scenario: Successful entity lifecycle transition
  Given an authenticated user with valid permissions
  When the user submits valid payload data
  Then the entity is persisted idempotently
  And a success status is returned within 200ms

## 5. Security & Performance Considerations
- Rate limiting, token validation, and authorization scopes.
- Zero plaintext credentials or leaked logs.
- Memory leak prevention and non-blocking I/O.
```

### Step 3: ADR Generation (When Applicable)
If introducing new architectural patterns, libraries, or storage models:
- Create `wiki/ADR-00X-[title].md` or `docs/specs/adr/` following the Michael Nygard format (Title, Status, Context, Decision, Consequences).

### Step 4: GitHub Issue Creation
Call `issue_write` via `github-mcp-server` to create the structured ticket:
- **Title**: `feat(<component>): <short action-oriented title>`
- **Body**:
  - `## User Story`
  - `## Technical Context & Scope`
  - `## Acceptance Criteria (Definition of Done)`
  - `## Target Files`
- **Labels**: `feature`, `backend`, `frontend`, `documentation`, `status:ready` (or `status:backlog` if pending review).

---

## ⏭️ Next Recommended Step

Once the RFC, acceptance criteria, and GitHub Issue are created and tagged `status:ready`:
👉 **Transition to [`sdlc-kanban`](../sdlc-kanban/SKILL.md)** to place the card on the board, and **[`sdlc-flow`](../sdlc-flow/SKILL.md)** to branch, implement with TDD, and run the automated lifecycle.
