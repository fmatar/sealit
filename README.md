<div align="center">
  <h1>Agentic SDLC Framework</h1>
  <p><b>State-of-the-Art Autonomous Software Development Lifecycle Orchestration</b></p>

  [![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
  [![Quality Gate](https://img.shields.io/badge/Quality_Gate-Enforced-success.svg)](#)
  [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

</div>

---

## ⚡ What is the Agentic SDLC Framework?

The Agentic SDLC Framework is a **Hybrid Orchestration** system that transforms standard coding agents (like Google Antigravity) into a highly disciplined, multi-agent engineering team. Instead of letting agents write code aimlessly, this framework enforces industry best practices (SVPG PRDs, IEEE 29148 SRS, Simon Brown C4 Architecture) and automates the entire software lifecycle from ideation to release.

## 🚀 Key Features

* **Autonomous 8-Stage Lifecycle**: The `sdlc-flow` orchestrator drives intake, branching, TDD implementation, coverage enforcement, docs sync, PR creation, subagent peer review, and release.
* **Living Kanban & GitHub Projects v2**: The `sdlc-kanban` skill automates ticket state transitions (`status:*`), manages GitHub Projects v2 multi-views, enforces WIP limits, and syncs an in-repo `docs/KANBAN.md` dashboard.
* **Dual-Gate Testing & Mutation Defense**: Enforces Robert C. Martin (Uncle Bob) craftsmanship with $\ge 85\%$ diff coverage and $\ge 80\%$ mutation kill score (PITest for Quarkus, Stryker for Svelte 5) to eliminate vanity coverage metrics and kill surviving mutants.
* **Parallel Subagent Peer Review**: Spawns independent subagents via `invoke_subagent` to audit PR diffs, detect test smells (no trivial getter tests, no mock abuse), and post review comments via GitHub MCP.
* **Built-in DevSecOps & Quality Gate**: `sdlc-quality-gate` verifies Spotless formatting, static typing (`svelte-check`), test port isolation (`quarkus.http.test-port=0`), WCAG a11y, SAST audits, and production builds.
* **Automated Releases & Deployments**: `sdlc-release-changelog` automatically manages Semantic Versioning (SemVer), keeps an automated changelog, generates Docker containers, and deploys via Helm.

## 🧠 Core Agentic Skills

The framework operates via interlocking skills located in `.agent/skills/`. Each skill defines a "Next Recommended Step," allowing agents to chain workflows autonomously:

1. **`sdlc-flow`**: Master orchestrator running the 8-stage issue-to-PR automated pipeline with Dual-Gate test and mutation enforcement.
2. **`sdlc-feature-spec`**: Generates structured PRD/SRS documentation, C4 diagrams, and GitHub issues.
3. **`sdlc-tdd-implement`**: Svelte 5 UI and Quarkus Java 25 coding adhering to Uncle Bob's Three Laws of TDD and the Transformation Priority Premise (TPP).
4. **`sdlc-test-coverage`**: Dual-Gate test enforcer requiring $\ge 85\%$ diff coverage and $\ge 80\%$ mutation score via PITest & Stryker.
5. **`sdlc-peer-review`**: Subagent that audits PR diffs, detects Uncle Bob test smells and mock abuse, and posts review comments.
6. **`sdlc-kanban`**: Manages GitHub Projects v2, ticket state transitions (`status:*`), WIP limits, and `docs/KANBAN.md`.
7. **`sdlc-docs-wiki`**: Synchronizes documentation across `docs/specs/`, `CHANGELOG.md`, and `/wiki`.
8. **`sdlc-quality-gate`**: Pre-merge quality, formatting (Spotless), security, and build validation.
9. **`sdlc-release-changelog`**: Version bumping, Docker containerization, and K8s/Helm deployment.
10. **`sdlc-analyze`**: SDLC compliance auditor evaluating project health against framework standards.
11. **`sdlc-initialize`**: Interactive full-stack project bootstrapper and skill installer.
12. **`sdlc-help`**: Interactive diagnostic guide and prompt recipes.

## ⏱️ 5-Minute Developer Quickstart

Get up and running with the Agentic SDLC Framework in four simple stages:

### Step 1: Toolchain & Framework Installation
Install the framework locally to your project's `.agent/` (or `.agents/`) directory, or install globally to `~/.gemini/config/skills`:

```bash
# Export GitHub Token (if installing from private repository)
export GITHUB_TOKEN="ghp_your_token_here"

# Install locally into current workspace
curl -H "Authorization: token $GITHUB_TOKEN" -sL "https://raw.githubusercontent.com/fmatar/agentic-sdlc-framework/main/install.sh" | bash

# Or install globally for all Antigravity agent sessions:
curl -sL "https://raw.githubusercontent.com/fmatar/agentic-sdlc-framework/main/install.sh" | bash -s -- --global
```

*Alternatively, run `./install.java --local .` or `./install.java --global` directly with JBang.*

### Step 2: Bootstrap or Baseline Health Audit
- **Greenfield Projects**: Trigger `sdlc-initialize` to scaffold a full-stack Svelte 5 + Quarkus Java 25 app with configured quality gates:
  > *"Run sdlc-initialize to scaffold a new full-stack project."*
- **Existing Codebases**: Trigger `sdlc-analyze` to compute a compliance baseline score:
  > *"Run sdlc-analyze to audit project health and test coverage compliance."*

### Step 3: Explore Interactive Guidance & Living Board
- Ask your agent for the skill decision matrix and prompt recipes:
  > *"Run sdlc-help to see the SDLC decision matrix and recipes."*
- Inspect or refresh the in-repo living board:
  ```bash
  .agent/skills/sdlc-kanban/scripts/kanban-sync.sh
  cat docs/KANBAN.md
  ```

### Step 4: Bring Your Own App (BYOA) Workflow
Plug the Agentic SDLC skills into any repository and trigger end-to-end autonomous execution:
> *"Trigger sdlc-flow to execute issue #1031. Create the feature branch, implement with Uncle Bob's TDD, enforce Dual-Gate test coverage (>= 85%) and mutation defense (>= 80%), sync README showcase and CHANGELOG, open a PR, and dispatch a peer review subagent."*

## 📖 Documentation
Detailed documentation is available in [`docs/SDLC_AGENTIC_OPERATIONS_GUIDE.md`](./docs/SDLC_AGENTIC_OPERATIONS_GUIDE.md) and the [`wiki/`](./wiki/) directory.

## 📄 License
This project is licensed under the Apache 2.0 License - see the [LICENSE](./LICENSE) file for details.
