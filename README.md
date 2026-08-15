<div align="center">
  <img src="https://via.placeholder.com/150" alt="NoteZen Logo" width="120" height="120" />
  <h1>NoteZen Agentic SDLC Framework</h1>
  <p><b>State-of-the-Art Autonomous Software Development Lifecycle Orchestration</b></p>

  [![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
  [![Quality Gate](https://img.shields.io/badge/Quality_Gate-Enforced-success.svg)](#)
  [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

</div>

---

## ⚡ What is NoteZen Agentic SDLC?

NoteZen Agentic SDLC Framework is a **Hybrid Orchestration** system that transforms standard coding agents (like Google Antigravity) into a highly disciplined, multi-agent engineering team. Instead of letting agents write code aimlessly, this framework enforces industry best practices (SVPG PRDs, IEEE 29148 SRS, Simon Brown C4 Architecture) and automates the entire software lifecycle from ideation to Kubernetes deployment.

## 🚀 Key Features

*   **Parallel Fork-Join Execution**: The `sdlc-flow` orchestrator establishes a specification contract, then forks concurrent subagents for Implementation, Testing, and Documentation.
*   **Built-in DevSecOps**: The `sdlc-quality-gate` runs static typing (`svelte-check`), Vitest suites, WCAG a11y audits, basic SAST/npm audits, and Lighthouse performance profiling before any code is merged.
*   **Automated Releases & Deployments**: `sdlc-release-changelog` automatically manages Semantic Versioning (SemVer), keeps an automated changelog, generates provider-agnostic Docker containers, and deploys via Helm to your Kubernetes cluster.
*   **Template-Driven**: Automatically scaffolds enterprise-grade PRDs, SRS, ADRs, and Architecture diagrams.

## 🧠 The 8 Core Skills

The framework operates via 8 interlocking "skills" located in `.agent/skills/`. Each skill defines a "Next Recommended Step," allowing agents to chain workflows autonomously.

1.  **`sdlc-flow`**: Master orchestrator. Runs end-to-end parallel pipelines.
2.  **`sdlc-feature-spec`**: Generates structured documentation (PRD, SRS, C4, ADRs).
3.  **`sdlc-docs-wiki`**: Synchronizes documentation across `/wiki` and the project.
4.  **`sdlc-tdd-implement`**: Svelte 5 / TypeScript coding using strict Test-Driven Development.
5.  **`sdlc-test-coverage`**: Vitest and Playwright test engineering.
6.  **`sdlc-quality-gate`**: Pre-merge quality, security, and performance audits.
7.  **`sdlc-release-changelog`**: Version bumping, Docker containerization, and K8s/Helm deployment.
8.  **`sdlc-help`**: Interactive diagnostic guide.

## 🛠️ Getting Started (For Agents & Humans)

### Prerequisites
*   Node.js (v20+)
*   An active Antigravity workspace.
*   [JBang](https://www.jbang.dev/) (For installation)

### Installation
Since this is a private repository, you will need a GitHub Personal Access Token (PAT) with repository read access.

The easiest way to install the framework (either into a new project or globally) is using our one-liner `curl` script. It will automatically download the deterministic workflow engine installer and install JBang if you don't already have it:

```bash
# 1. Export your Personal Access Token
export GITHUB_TOKEN="ghp_your_token_here"

# 2. Install to your current project's .agent/ directory (Local)
curl -H "Authorization: token $GITHUB_TOKEN" -sL "https://raw.githubusercontent.com/fmatar/agentic-sdlc-framework/main/install.sh" | bash

# Or install globally for all your projects
curl -H "Authorization: token $GITHUB_TOKEN" -sL "https://raw.githubusercontent.com/fmatar/agentic-sdlc-framework/main/install.sh" | bash -s -- --global
```

*(Alternatively, if you already have the repository cloned and JBang installed, you can simply run `./install.java --local .` or `./install.java --global` directly).*

### Triggering the Framework
You can command your agent to handle everything autonomously:
> *"Trigger the sdlc-flow skill to build a new feature: User Authentication. Use the adaptive checkpoints mode."*

Or invoke individual skills for specific tasks:
> *"Use sdlc-tdd-implement to fix the issue where the timer skips a second. Make sure to write a failing test first."*

## 📖 Documentation
Detailed documentation is available in the [Wiki](https://github.com/your-org/agentic-sdlc-framework/wiki), which is automatically synchronized with the `wiki/` directory in this repository.
You can also consult the [`docs/SDLC_AGENTIC_OPERATIONS_GUIDE.md`](./docs/SDLC_AGENTIC_OPERATIONS_GUIDE.md).

## 🤝 Contributing
Please see our [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on how to interact with the agentic framework and submit Pull Requests. We rely on the `sdlc-quality-gate` for all PR approvals.

## 📄 License
This project is licensed under the Apache 2.0 License - see the [LICENSE](./LICENSE) file for details.
