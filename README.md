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
* **Strict $\ge$ 90% Test Coverage Enforcement**: Stack-aware test execution (JaCoCo for Quarkus, Vitest for Svelte 5) enforcing line and branch coverage on modified lines in a feedback loop.
* **Parallel Subagent Peer Review**: Spawns independent subagents via `invoke_subagent` to audit PR diffs and post review comments via GitHub MCP.
* **Built-in DevSecOps & Quality Gate**: `sdlc-quality-gate` verifies Spotless formatting, static typing (`svelte-check`), test port isolation, WCAG a11y, SAST audits, and production builds.
* **Automated Releases & Deployments**: `sdlc-release-changelog` automatically manages Semantic Versioning (SemVer), keeps an automated changelog, generates Docker containers, and deploys via Helm.

## 🧠 Core Agentic Skills

The framework operates via interlocking skills located in `.agent/skills/`. Each skill defines a "Next Recommended Step," allowing agents to chain workflows autonomously:

1. **`sdlc-flow`**: Master orchestrator running the 8-stage issue-to-PR automated pipeline.
2. **`sdlc-feature-spec`**: Generates structured PRD/SRS documentation, C4 diagrams, and GitHub issues.
3. **`sdlc-tdd-implement`**: Svelte 5 UI and Quarkus Java 25 coding using strict Test-Driven Development.
4. **`sdlc-test-coverage`**: Vitest and JaCoCo coverage enforcer requiring $\ge$ 90% diff coverage.
5. **`sdlc-peer-review`**: Subagent that audits pull request diffs and posts review comments.
6. **`sdlc-kanban`**: Manages GitHub Projects v2, ticket state transitions (`status:*`), WIP limits, and `docs/KANBAN.md`.
7. **`sdlc-docs-wiki`**: Synchronizes documentation across `docs/specs/`, `CHANGELOG.md`, and `/wiki`.
8. **`sdlc-quality-gate`**: Pre-merge quality, formatting (Spotless), security, and build validation.
9. **`sdlc-release-changelog`**: Version bumping, Docker containerization, and K8s/Helm deployment.
10. **`sdlc-analyze`**: SDLC compliance auditor evaluating project health against framework standards.
11. **`sdlc-initialize`**: Interactive full-stack project bootstrapper and skill installer.
12. **`sdlc-help`**: Interactive diagnostic guide and prompt recipes.

## 🛠️ Getting Started

### Installation

Install the framework locally to your project's `.agent/` (or `.agents/`) directory:

```bash
# Export GitHub Token (if installing from private repository)
export GITHUB_TOKEN="ghp_your_token_here"

# Install locally
curl -H "Authorization: token $GITHUB_TOKEN" -sL "https://raw.githubusercontent.com/fmatar/agentic-sdlc-framework/main/install.sh" | bash
```

Alternatively, run `./install.java --local .` directly with JBang.

### Triggering the Framework

Command your agent to handle everything autonomously:
> *"Trigger the sdlc-flow skill to execute issue #1031. Create the branch, implement with TDD, enforce >= 90% test coverage, open a PR, and run a peer review subagent."*

Or invoke individual skills:
> *"Use sdlc-test-coverage to audit coverage on modified lines and auto-generate missing tests."*

## 📖 Documentation
Detailed documentation is available in [`docs/SDLC_AGENTIC_OPERATIONS_GUIDE.md`](./docs/SDLC_AGENTIC_OPERATIONS_GUIDE.md) and the [`wiki/`](./wiki/) directory.

## 📄 License
This project is licensed under the Apache 2.0 License - see the [LICENSE](./LICENSE) file for details.
