---
name: sdlc-help
description: Interactive user and agent guide for the Agentic SDLC ecosystem. Provides command recipes, workflow diagrams, decision matrices, and tool diagnostics.
version: 2.0.0
license: Apache 2.0
allowed-tools: run_command, view_file
---

# SDLC Guide, Recipes & Tool Diagnostics (`sdlc-help`)

Use this skill when you need guidance on navigating the Agentic SDLC ecosystem, selecting the right skill for a task, or finding copy-paste prompt recipes.

---

## 🧭 SDLC Skill Decision Matrix

| What You Want to Accomplish | Recommended Skill | Trigger Phrase / Command |
| :--- | :--- | :--- |
| **Execute full issue-to-PR automated lifecycle** | **`sdlc-flow`** | *"Run sdlc-flow for issue #<id>"* |
| **Draft RFC, acceptance criteria, or GitHub issue** | **`sdlc-feature-spec`** | *"Draft a spec / issue for [feature]"* |
| **Implement Svelte 5 / Quarkus Java 25 code (TDD)** | **`sdlc-tdd-implement`** | *"Implement [component/service]"* |
| **Enforce $\ge$ 90% line and branch test coverage** | **`sdlc-test-coverage`** | *"Run tests and enforce 90% coverage"* |
| **Audit PR diff as an independent subagent** | **`sdlc-peer-review`** | *"Run subagent peer review on PR"* |
| **Manage GitHub Projects v2 & living KANBAN board** | **`sdlc-kanban`** | *"Sync Kanban board and update issue status"* |
| **Update specs, CHANGELOG.md, OpenSpec delta** | **`sdlc-docs-wiki`** | *"Sync docs and changelog"* |
| **Pre-commit audit, formatting, type-check, a11y** | **`sdlc-quality-gate`** | *"Run quality gate checks"* |
| **Bump SemVer, tag release, Docker build** | **`sdlc-release-changelog`** | *"Cut a release vX.Y.Z"* |
| **Audit repository compliance and quality health** | **`sdlc-analyze`** | *"Audit repository compliance"* |
| **Scaffold new full-stack project or install skills** | **`sdlc-initialize`** | *"Initialize project with Agentic SDLC"* |
| **Get interactive guidance and prompt recipes** | **`sdlc-help`** | *"Help me navigate SDLC skills"* |

---

## ⚡ 8-Stage Lifecycle Architecture

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

---

## 📋 Copy-Paste Prompt Recipes

### 1. The Autonomous Issue-to-PR Executor Recipe
> *"Execute `sdlc-flow` on issue #<id>. Fetch the issue, create the feature branch, implement the feature using Svelte 5 / Quarkus TDD, enforce $\ge$ 90% test coverage, sync CHANGELOG.md and specs, push and open a PR, and trigger a peer review subagent."*

### 2. The Project Kanban & Board Manager Recipe
> *"Run `sdlc-kanban` to configure GitHub Projects v2 views, transition issue #<id> to `status:in-progress`, and refresh `docs/KANBAN.md`."*

### 3. The Strict Coverage Enforcer Recipe
> *"Run `sdlc-test-coverage` against the current diff. Ensure modified line and branch coverage reaches at least 90%, and auto-generate missing test cases if needed."*

### 4. The Subagent PR Peer Reviewer Recipe
> *"Spawn a peer review subagent using `sdlc-peer-review` to inspect the PR diff, check reactive patterns and coverage, and post review comments."*

### 5. The Quality Gatekeeper Recipe
> *"Run `sdlc-quality-gate` to verify Spotless formatting, Svelte 5 static analysis, JaCoCo coverage, and WCAG accessibility before creating the release."*

### 6. The Repository Compliance Auditor Recipe
> *"Run `sdlc-analyze --strict` to audit repo health, test coverage thresholds, and documentation completeness."*

### 7. The Project Bootstrapper Recipe
> *"Run `sdlc-initialize` to scaffold a full-stack Svelte 5 + Quarkus project with agentic skills configured."*

---

## 🛠️ Tooling & Diagnostics Checklist

1. **Frontend Type Checking**:
   ```bash
   npx svelte-check --tsconfig ./tsconfig.json
   ```

2. **Backend Quality & Formatting**:
   ```bash
   ./mvnw spotless:check compile test
   ```

3. **Subagent Execution Capacity**:
   * Verify `invoke_subagent` and `manage_subagents` are ready for concurrent worker dispatch.

---

## ⏭️ Next Recommended Step

- To start an end-to-end automated run, invoke **`sdlc-flow`**.
- To scope a specific feature or ticket, invoke **`sdlc-feature-spec`**.
