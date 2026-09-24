# Agentic SDLC Framework Operations Guide

Welcome to the **Agentic Software Development Lifecycle (SDLC) Operations Guide**. This document provides comprehensive instructions on how to install, configure, and utilize the autonomous multi-agent ecosystem designed for full-stack engineering teams.

This ecosystem transforms standard coding agents into an orchestrated "services agentic operation." It enforces industry best practices (SVPG PRDs, IEEE 29148 SRS, Simon Brown C4 Architecture) and automates the entire lifecycle from ideation to release.

---

## 1. Ecosystem Overview

The ecosystem is composed of 12 interlocking Antigravity skills. These skills utilize an **Autonomous 8-Stage Lifecycle**:
1. **Master Orchestrator**: `sdlc-flow` coordinates high-level issue-to-PR pipelines, Kanban state tracking, strict coverage enforcement, and subagent peer reviews.
2. **Autonomous Handoffs**: Every skill explicitly defines its "⏭️ Next Recommended Step," allowing individual agents to chain their workflows naturally if invoked independently.

### The 12 Core Skills
1. **`sdlc-flow`**: The master orchestrator. Runs the end-to-end 8-stage pipeline.
2. **`sdlc-feature-spec`**: Generates structured documentation (PRD, SRS, C4, ADRs) and standard GitHub issues from user intents.
3. **`sdlc-tdd-implement`**: Handles Svelte 5 / TypeScript UI and Quarkus Java 25 backend implementation using strict Test-Driven Development.
4. **`sdlc-test-coverage`**: Manages unit, integration, and coverage verification using JaCoCo and Vitest, enforcing $\ge$ 90% coverage on modified lines.
5. **`sdlc-peer-review`**: Parallel subagent that audits git diffs, verifies conventions and coverage, and posts formal review comments to GitHub PRs.
6. **`sdlc-kanban`**: Manages GitHub Projects v2, ticket lifecycle transitions (`status:*`), WIP limits, and syncs living `docs/KANBAN.md`.
7. **`sdlc-docs-wiki`**: Maintains synchronization across the project's documentation (root README Developer Showcase quickstart, `docs/specs/`, `CHANGELOG.md`, `docs/KANBAN.md`, `/wiki`, OpenSpec).
8. **`sdlc-quality-gate`**: Enforces pre-merge quality (Spotless formatting, static analysis, a11y, production builds, test port isolation, and DevSecOps scanning).
9. **`sdlc-release-changelog`**: Handles SemVer, Git tags, automated Keep-a-Changelog updates, Docker containerization, and Kubernetes/Helm deployments.
10. **`sdlc-analyze`**: Compliance auditor evaluating repository health against framework standards.
11. **`sdlc-initialize`**: Interactive full-stack project bootstrapper and skill installer.
12. **`sdlc-help`**: An interactive guide providing diagnostics and command recipes for humans and agents alike.

---

## 2. Installation & Setup

These skills are natively loaded via the `.agent/skills/` (or `.agents/skills/`) directory in your workspace.

### Prerequisites
- Node.js (v20+)
- Java 21+ / Java 25 (Temurin or GraalVM)
- JBang (for deterministic installation)
- An active Antigravity workspace mapped to your repository.

### Initialization
To verify the ecosystem is loaded, ask the agent:
> *"List available skills"*

You should see the `sdlc-*` skills listed. If they are not active, ensure your Antigravity agent has access to the `.agent/skills/` directory.

---

## 3. How to Use the System (Agentic Operations)

### Scenario A: The Autonomous Issue-to-PR Workflow
When you have a GitHub Issue and want the agent to handle branch creation, TDD implementation, coverage enforcement, docs sync, PR creation, and subagent peer review automatically.

**Command/Prompt:**
> *"Trigger sdlc-flow to execute issue #1031. Create the feature branch, implement the feature, enforce >= 90% test coverage, sync specs and changelog, open a PR, and run a peer review subagent."*

**What Happens Under the Hood:**
1. **Spec & Intake Phase**: `sdlc-feature-spec` reads the issue, comments progress, and scaffolds acceptance criteria.
2. **Branching**: `sdlc-flow` checks out `feature/issue-#1031-<title>`.
3. **Implementation**: `sdlc-tdd-implement` writes failing tests and implements Svelte 5 runes and Quarkus reactive logic.
4. **Coverage Enforcer**: `sdlc-test-coverage` validates line and branch coverage against the diff ($\ge$ 90%).
5. **Docs & Showcase Sync**: `sdlc-docs-wiki` updates the root `README.md` 5-minute quickstart, `docs/specs/`, `CHANGELOG.md`, and inline docstrings.
6. **Pull Request**: `sdlc-flow` pushes the branch and opens a PR linking `Fixes #1031`.
7. **Parallel Review**: `sdlc-flow` invokes a subagent running `sdlc-peer-review` to audit the PR diff and post formal comments.
8. **Quality Gate**: `sdlc-quality-gate` verifies Spotless, builds, and security scans.

### Scenario B: Generating Strict Architecture Documentation
When you need to define a system before writing code, using enterprise templates.

**Command/Prompt:**
> *"Use sdlc-feature-spec to write a PRD and SRS for a new Multi-Provider Sync module."*

### Scenario C: Strict Test Coverage Enforcement
When verifying that modified lines are fully covered by tests.

**Command/Prompt:**
> *"Use sdlc-test-coverage to audit coverage on the current diff and generate missing tests until >= 90% coverage is met."*

### Scenario D: Living Kanban & GitHub Projects v2 Management
When setting up or synchronizing project boards and tracking ticket states.

**Command/Prompt:**
> *"Use sdlc-kanban to configure GitHub Projects v2 board views, update issue #1031 to status:in-progress, and regenerate docs/KANBAN.md."*

---

## 4. Directory Structure
```text
.agent/
  └── skills/
      ├── sdlc-flow/
      ├── sdlc-feature-spec/
      ├── sdlc-tdd-implement/
      ├── sdlc-test-coverage/
      ├── sdlc-peer-review/
      ├── sdlc-kanban/
      │   ├── SKILL.md
      │   └── scripts/
      │       └── kanban-sync.sh
      ├── sdlc-docs-wiki/
      ├── sdlc-quality-gate/
      ├── sdlc-release-changelog/
      ├── sdlc-analyze/
      ├── sdlc-initialize/
      └── sdlc-help/
docs/
  ├── KANBAN.md
  ├── specs/
  └── templates/
      ├── ADR_TEMPLATE.md
      ├── C4_ARCHITECTURE_TEMPLATE.md
      ├── PRD_TEMPLATE.md
      └── SRS_TEMPLATE.md
```
