# NoteZen Agentic SDLC Operations Guide

Welcome to the **NoteZen Agentic Software Development Lifecycle (SDLC) Operations Guide**. This document provides comprehensive instructions on how to install, configure, and utilize the autonomous multi-agent ecosystem designed for this repository.

This ecosystem transforms standard coding agents into an orchestrated "services agentic operation." It enforces industry best practices (SVPG PRDs, IEEE 29148 SRS, Simon Brown C4 Architecture) and automates the entire lifecycle from ideation to release.

---

## 1. Ecosystem Overview

The ecosystem is composed of 8 interlocking Antigravity skills. These skills utilize a **Hybrid Orchestration** model:
1. **Master Orchestrator**: `sdlc-flow` coordinates high-level, parallelized (Fork-Join) execution pipelines.
2. **Autonomous Handoffs**: Every skill explicitly defines its "⏭️ Next Recommended Step," allowing individual agents to chain their workflows naturally if invoked independently.

### The 8 Core Skills
1. **`sdlc-flow`**: The master orchestrator. Runs the end-to-end pipeline.
2. **`sdlc-feature-spec`**: Generates structured documentation (PRD, SRS, C4, ADRs) from user intents.
3. **`sdlc-docs-wiki`**: Maintains synchronization across the project's documentation (`/wiki`, `README.md`, architectures).
4. **`sdlc-tdd-implement`**: Handles Svelte 5 / TS implementation using strict Test-Driven Development and clean-room principles.
5. **`sdlc-test-coverage`**: Manages unit, component, and E2E testing using Vitest and Playwright.
6. **`sdlc-quality-gate`**: Enforces pre-merge quality (static analysis, a11y, production builds).
7. **`sdlc-release-changelog`**: Handles SemVer, Git tags, and automated CHANGELOG generation.
8. **`sdlc-help`**: An interactive guide providing diagnostics and command recipes for humans and agents alike.

---

## 2. Installation & Setup

These skills are natively loaded via the `.agent/skills/` directory in this workspace.

### Prerequisites
- Node.js (v20+)
- `npm` or `npx` (We use `npx` or local `node_modules` execution rather than global binaries to avoid permission issues).
- An active Antigravity workspace mapped to this repository.

### Initialization
To verify the ecosystem is loaded, you can ask the agent:
> *"List available skills"*

You should see the 8 `sdlc-*` skills listed. If they are not active, ensure your Antigravity agent has read access to the `.agent/skills/` directory.

---

## 3. How to Use the System (Agentic Operations)

### Scenario A: The "Do It All" Autonomous Workflow
When you have a feature idea and want the agents to handle documentation, implementation, testing, and quality checks automatically.

**Command/Prompt:**
> *"Trigger the sdlc-flow skill to build a new feature: [Describe your feature]. Use the adaptive checkpoints mode."*

**What Happens Under the Hood:**
1. **Spec Phase**: `sdlc-feature-spec` is invoked to scaffold the PRD, SRS, and C4 architecture in `docs/templates/`.
2. **Parallel Phase (Fork)**: `sdlc-flow` spawns multiple subagents using `invoke_subagent`.
   - Subagent 1 uses `sdlc-tdd-implement` to write the code.
   - Subagent 2 uses `sdlc-test-coverage` to write the tests.
   - Subagent 3 uses `sdlc-docs-wiki` to update the wiki.
3. **Join Phase**: The master agent waits for subagents to complete.
4. **Quality Gate**: `sdlc-quality-gate` is triggered to run `npx svelte-check` and accessibility audits.
5. **Release**: `sdlc-release-changelog` bumps the version.

### Scenario B: Generating Strict Architecture Documentation
When you need to define a system before writing code, using our enterprise templates.

**Command/Prompt:**
> *"Use sdlc-feature-spec to write a PRD and SRS for a new User Authentication module."*

**What Happens:**
The agent will utilize the templates located in `docs/templates/`:
- `PRD_TEMPLATE.md`
- `SRS_TEMPLATE.md`
- `C4_ARCHITECTURE_TEMPLATE.md`
- `ADR_TEMPLATE.md`

### Scenario C: Fixing a Bug with Strict TDD
When a bug is reported and you want it fixed cleanly.

**Command/Prompt:**
> *"Use sdlc-tdd-implement to fix the issue where the 4-7-8 timer skips a second. Make sure to write a failing test first."*

**What Happens:**
The agent writes a test in Vitest, watches it fail, implements the fix in Svelte 5, and then hands off to `sdlc-quality-gate` as per its ⏭️ Next Recommended Step.

---

## 4. Best Practices for Human Operators

1. **Be Specific with the Flow**: If you want the agent to pause for your approval before writing code, ask it to "Run sdlc-flow up to the Specification checkpoint."
2. **Leverage `sdlc-help`**: If you are ever confused about which skill to use, simply tell the agent: *"Consult sdlc-help for guidance on how to release my current changes."*
3. **Respect the Templates**: When modifying `docs/templates/`, keep the markdown structure intact so the `sdlc-feature-spec` skill can parse and replicate them accurately.
4. **Use Subagents for Heavy Lifting**: If you are in a long conversation, explicitly ask the agent to *"Delegate the testing to a subagent using the sdlc-test-coverage skill."*

---

## 5. Directory Structure
```text
.agent/
  └── skills/
      ├── sdlc-flow/
      ├── sdlc-feature-spec/
      ├── sdlc-docs-wiki/
      └── ...
docs/
  └── templates/
      ├── ADR_TEMPLATE.md
      ├── C4_ARCHITECTURE_TEMPLATE.md
      ├── PRD_TEMPLATE.md
      └── SRS_TEMPLATE.md
```

## 6. Troubleshooting

- **Operation Not Permitted on pnpm**: Do not use global `pnpm`. The skills are configured to use `npx` (e.g., `npx svelte-check`, `npx vitest`).
- **Subagents Getting Stuck**: If a parallel Fork-Join pipeline hangs, ask the master agent to *"check the status of the subagents"* or use the `manage_subagents` tool to list active processes.
