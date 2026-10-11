# Agentic SDLC Framework Operations Guide

Welcome to the **Agentic Software Development Lifecycle (SDLC) Operations Guide**. This document provides comprehensive instructions on how to install, configure, and utilize the autonomous multi-agent ecosystem designed for full-stack engineering teams.

This ecosystem transforms standard coding agents into an orchestrated "services agentic operation." It enforces industry best practices (SVPG PRDs, IEEE 29148 SRS, Simon Brown C4 Architecture), **Robert C. Martin's (Robert Martin)** software craftsmanship, and automates the entire lifecycle from ideation to release.

---

## 1. Ecosystem Overview

The ecosystem is composed of 12 interlocking Antigravity skills. These skills utilize an **Autonomous 8-Stage Lifecycle**:
1. **Master Orchestrator**: `sdlc-flow` coordinates high-level issue-to-PR pipelines, Kanban state tracking, Dual-Gate test and mutation coverage enforcement, and subagent peer reviews.
2. **Autonomous Handoffs**: Every skill explicitly defines its "⏭️ Next Recommended Step," allowing individual agents to chain their workflows naturally if invoked independently.

### The 12 Core Skills
1. **`sdlc-flow`**: The master orchestrator. Runs the end-to-end 8-stage pipeline with Dual-Gate test and mutation enforcement.
2. **`sdlc-feature-spec`**: Generates structured documentation (PRD, SRS, C4, ADRs) and standard GitHub issues from user intents.
3. **`sdlc-tdd-implement`**: Handles Svelte 5 / TypeScript UI and Quarkus Java 25 backend implementation using Robert Martin's Three Laws of TDD and the Transformation Priority Premise (TPP).
4. **`sdlc-test-coverage`**: Enforces the Dual-Gate quality standard ($\ge 85\%$ line/branch diff coverage AND $\ge 80\%$ mutation kill score via PITest & Stryker).
5. **`sdlc-peer-review`**: Parallel subagent that audits git diffs, verifies conventions, detects Robert Martin test smells and mock abuse, and posts formal review comments to GitHub PRs.
6. **`sdlc-kanban`**: Manages GitHub Projects v2, ticket lifecycle transitions (`status:*`), WIP limits, and syncs living `docs/KANBAN.md`.
7. **`sdlc-docs-wiki`**: Maintains synchronization across the project's documentation (root README Developer Showcase quickstart, `docs/specs/`, `CHANGELOG.md`, `docs/KANBAN.md`, `/wiki`, OpenSpec).
8. **`sdlc-quality-gate`**: Enforces pre-merge quality (Spotless formatting, static analysis, a11y, production builds, test port isolation, and PITest/Stryker mutation defense).
9. **`sdlc-release-changelog`**: Handles SemVer, Git tags, automated Keep-a-Changelog updates, Docker containerization, and Kubernetes/Helm deployments.
10. **`sdlc-analyze`**: Compliance auditor evaluating repository health against framework standards and mutation scores.
11. **`sdlc-initialize`**: Interactive full-stack project bootstrapper configuring Quarkus, Svelte 5, PITest, and Stryker.
12. **`sdlc-help`**: An interactive guide providing diagnostics and command recipes for humans and agents alike.

---

## 2. Installation & Setup

The framework provides a zero-dependency, ultra-fast installer (`install.sh`) that installs skills, the universal execution engine, and templates in under 2 seconds.

### Quick Installation

```bash
# 1. Local installation into active workspace (with automatic stack discovery):
curl -sL "https://raw.githubusercontent.com/fmatar/agentic-sdlc-framework/main/install.sh" | bash

# 2. Global installation for all Antigravity agent sessions:
curl -sL "https://raw.githubusercontent.com/fmatar/agentic-sdlc-framework/main/install.sh" | bash -s -- --global

# 3. Enterprise JBang CLI execution (optional):
jbang install.java --local .
```

### What Gets Installed
- **Skills (`.agent/skills/`)**: All 12 specialized SDLC skills.
- **Universal Engine (`.agent/scripts/sdlc-engine.mjs`)**: Polyglot stack detector, session concurrency manager, and quality gate runner.
- **Templates (`docs/templates/`)**: PRD, SRS, C4 Architecture, and ADR templates.
- **Config (`.agent/sdlc-config.json`)**: Auto-generated configuration tailored to your repository's stack.

### Prerequisites
- **Node.js (v20+)**: Required for running the universal engine (`sdlc-engine.mjs`).
- **Java 21+ / 25**: Only required for Quarkus backend projects, PITest mutation testing, or running `install.java`.
- **An active Antigravity workspace** mapped to your repository.

### Verification
To verify the ecosystem is loaded, ask your agent:
> *"List available skills"*

You should see the 12 `sdlc-*` skills listed. You can also inspect detected stack settings:
```bash
node .agent/scripts/sdlc-engine.mjs detect
```

---

## 3. How to Use the System (Agentic Operations)

### Scenario A: The Autonomous Issue-to-PR Workflow
When you have a GitHub Issue and want the agent to handle branch creation, TDD implementation, coverage and mutation enforcement, docs sync, PR creation, and subagent peer review automatically.

**Command/Prompt:**
> *"Trigger sdlc-flow to execute issue #1031. Check session concurrency, create the feature branch, implement the feature with Robert Martin's TDD, enforce Dual-Gate test coverage (>= 85%) and mutation defense (>= 80%), sync specs and changelog, open a PR, and dispatch parallel peer review and quality gate subagents."*

**What Happens Under the Hood:**
1. **Spec & Intake Phase**: `sdlc-engine` locks the session with auto-classification (`feat`, `bug`, `hotfix`, `spike`) and git worktree isolation if running concurrently. `sdlc-feature-spec` reads the issue, comments progress, and scaffolds acceptance criteria.
2. **Branching**: `sdlc-flow` checks out `feature/issue-#1031-<title>` (or `hotfix/*`) and tags `status:in-progress`.
3. **Implementation**: `sdlc-tdd-implement` strictly applies Robert Martin's Three Laws of TDD and the Transformation Priority Premise (TPP) across Svelte 5 and Quarkus reactive logic.
4. **Dual-Gate Enforcer**: `sdlc-test-coverage` validates line/branch diff coverage ($\ge 85\%$) via JaCoCo/Vitest and mutation kill score ($\ge 80\%$) via PITest/Stryker.
5. **Docs & Showcase Sync**: `sdlc-docs-wiki` updates the root `README.md` 5-minute quickstart, `docs/specs/`, `CHANGELOG.md`, and commits them before PR creation so the PR diff contains the full contract.
6. **Pull Request**: `sdlc-flow` pushes the branch and opens a PR linking `Fixes #1031` (`status:in-review`).
7. **Fork-Join Parallel Review & Gate**: `sdlc-flow` concurrently invokes read-only subagents (`sdlc-peer-review` and `sdlc-quality-gate`) to audit the PR diff and run full quality gate checks. If changes are requested, the ticket reverts to `status:in-progress` and rolls back to Stage 3 (guarded by a max-3 remediation circuit breaker).
8. **Release & Lock Release**: `sdlc-engine` polls remote CI checks green (`check-ci`), `sdlc-release-changelog` tags the release, merges the PR, updates Kanban, and releases the session lock (`session release`).

### Scenario B: Generating Strict Architecture Documentation
When you need to define a system before writing code, using enterprise templates.

**Command/Prompt:**
> *"Use sdlc-feature-spec to write a PRD and SRS for a new Multi-Provider Sync module."*

### Scenario C: Strict Dual-Gate Test & Mutation Enforcement
When verifying that modified code is genuinely defended against bugs.

**Command/Prompt:**
> *"Use sdlc-test-coverage to audit coverage and run mutation testing on the current diff. Ensure >= 85% diff coverage and >= 80% mutation kill score, killing any surviving mutants."*

### Scenario D: Living Kanban & GitHub Projects v2 Management
When provisioning the GitHub Project, configuring the 6 traceable views, or synchronizing the living board.

**Command/Prompt:**
> *"Use sdlc-kanban to provision the GitHub Projects v2 board, configure custom traceability fields (Spec Link, Quality Gate), set up the 6 default views, and refresh docs/KANBAN.md with the Traceability Matrix."*

### Scenario E: Multi-Session Worktree Concurrency & Hotfixes
When an urgent production bug or hotfix arises while another feature branch is actively in flight.

**Command/Prompt:**
> *"Start an isolated hotfix session in a git worktree for issue #2049 to patch the payment gateway, without touching the current feature/issue-#1031 working tree."*

**CLI Operations:**
```bash
# Start concurrent hotfix in isolated worktree
git worktree add ../worktree-hotfix-2049 -b hotfix/issue-#2049-payment
node .agent/scripts/sdlc-engine.mjs session start --issue 2049 --branch hotfix/issue-#2049-payment --type hotfix --worktree ../worktree-hotfix-2049

# List all active sessions
node .agent/scripts/sdlc-engine.mjs session list

# Switch active agent focus between sessions
node .agent/scripts/sdlc-engine.mjs session switch 1031
```

### Scenario F: Benign Mutant & Test Exemption Ledger
When an unkillable mutant cannot be killed due to bytecode compiler optimization or platform shutdown hooks.

**Command/Prompt:**
> *"Register an exemption for the unkillable mutant in OrderService line 42 with architectural justification."*

**CLI Operations:**
```bash
node .agent/scripts/sdlc-engine.mjs exemption add --mutant "OrderService.java:42:NegateCondition" --reason "JVM shutdown hook side-effect verified manually" --by "@lead-architect"
node .agent/scripts/sdlc-engine.mjs exemption list
```

---

## 4. Robert C. Martin's (Robert Martin) Testing Philosophy & Mutation Defense

### The Fallacy of Naive Code Coverage
Raw line coverage measures only what code was executed; it does not measure whether assertions verified correct behavior. An automated agent can easily hit 100% line coverage with zero assertions (`assertDoesNotThrow`) or by testing trivial DTO getters/setters.

To counter this, the framework enforces the **Dual-Gate**:
1. **Diff Coverage ($\ge 85\%$)**: Broad execution of modified lines and branches. Lowering the raw target from 90% removes the perverse incentive to test trivial data classes.
2. **Mutation Kill Score ($\ge 80\%$)**: Injects deliberate defects (inverting conditionals, mutating returns, deleting void calls) into bytecode/AST. If tests pass, the mutant survived and the gate fails!

### Useful Tests vs. Useless Tests (Robert Martin's Criteria)

| Category | Description | Framework Rule |
| :--- | :--- | :--- |
| **Business Invariants** | Domain rules, calculation policies, state machines. | **Mandatory** |
| **Boundary Conditions** | $0, -1$, null, empty collections, maximum values. | **Mandatory (Kills boundary mutants)** |
| **Degenerate & Negative Paths** | Exceptional cases, invalid inputs, failure recovery. | **Mandatory** |
| **Trivial Getters / Setters** | Plain data holders, Java records without logic. | **Forbidden (Test Smell)** |
| **Framework Mechanics** | Panache SQL persistence, Svelte reactivity runtime. | **Forbidden ("Don't test code you didn't write")** |
| **Mock Abuse** | Verifying internal method sequence calls on mocks. | **Forbidden (Creates fragile tests)** |
| **Assert-Free Tests** | Running code without asserting state changes or outputs. | **Forbidden (Rejected by Mutation Gate)** |

### F.I.R.S.T. Test Harness Architecture
- **Fast**: Millisecond unit test runs.
- **Independent**: Dynamic port isolation (`quarkus.http.test-port=0`) and transaction rollback (`@TestTransaction`).
- **Repeatable**: Deterministic without external network or environment dependencies.
- **Self-Validating**: Binary pass/fail with expressive failure messages.
- **Timely**: Authored before the code that satisfies them (Three Laws of TDD).

---

## 5. Traceability Architecture & GitHub Projects v2 Default Views

The framework enforces 100% bidirectional traceability across the entire lifecycle:
1. **GitHub Issue** $\leftrightarrow$ **PRD/SRS** (`docs/specs/` or `wiki/`)
2. **Issue** $\leftrightarrow$ **Branch** (`feature/issue-#<id>-<slug>`)
3. **Commit** $\leftrightarrow$ **Issue** (`feat(...): ... (fixes #<id>)`)
4. **Pull Request** $\leftrightarrow$ **Quality Gate / Mutation Defense**
5. **Project v2 Card** $\leftrightarrow$ **Spec Link & Quality Gate Status**

### The 6 Default GitHub Projects v2 Views
1. **⚡ Kanban Board** (`Board`, Group: `Status`): Primary WIP-enforced delivery flow.
2. **🎯 Traceability Matrix** (`Table`, Group: `Milestone`): Complete audit trail mapping issues to specs, branches, PRs, and gates.
3. **📥 Backlog & Triage** (`Table`, Filter: `Status: Backlog, Ready`, Sort: `Priority`): Grooming and scoping queue.
4. **🏃 Active Sprint** (`Board`, Filter: `Iteration: @current`): Daily sprint focus for agents and engineers.
5. **🛡️ Quality Gate & Review Audit** (`Table`, Filter: `Status: In Review`): Tracks PRs, mutation scores, and peer review approvals.
6. **🗺️ Epics & Milestone Roadmap** (`Roadmap`, Group: `Milestone`): High-level release timeline.

### Automated Provisioning Script
```bash
# Authenticate gh CLI with project scope
gh auth refresh -s project,read:project

# Provision project and traceability fields
.agent/skills/sdlc-kanban/scripts/project-setup.sh
```

---

## 6. Directory Structure
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
      │       ├── kanban-sync.sh
      │       └── project-setup.sh
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
