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

* **Autonomous 8-Stage Lifecycle & Circuit Breaker**: The `sdlc-flow` orchestrator drives intake auto-classification (`feat`, `bug`, `hotfix`, `spike`), branching, TDD implementation, coverage enforcement, docs sync, PR creation, parallel subagent peer review, CI status polling, and release with session concurrency locking (`.agent/.sdlc-session.json`), Git worktree isolation, automated remediation circuit breakers (max 3 loops), and real-time visual progress dashboards.
* **Living Kanban & Pluggable PM Providers**: The `sdlc-kanban` skill automates ticket state transitions (`status:*`), manages GitHub Projects v2 multi-views, Jira, Linear, and syncs an in-repo `docs/KANBAN.md` dashboard with full bidirectional traceability.
* **Dual-Gate Testing & Mutation Defense**: Enforces Robert C. Martin (Uncle Bob) craftsmanship with $\ge 85\%$ diff coverage and $\ge 80\%$ mutation kill score (PITest for Quarkus, Stryker for Svelte 5) to eliminate vanity coverage metrics and kill surviving mutants.
* **Fork-Join Parallel Peer Review & Quality Gate**: Spawns independent read-only subagents via `invoke_subagent` to audit PR diffs, detect test smells (no trivial getter tests, no mock abuse), run static gates, and post review comments via GitHub MCP.
* **Built-in DevSecOps & Quality Gate**: `sdlc-quality-gate` verifies Spotless formatting, static typing (`svelte-check`), test port isolation (`quarkus.http.test-port=0`), WCAG a11y, SAST audits, and production builds.
* **Automated Releases & Deployments**: `sdlc-release-changelog` automatically manages Semantic Versioning (SemVer), keeps an automated changelog, generates Docker containers, and deploys via Helm.

## 🧠 Core Agentic Skills

The framework operates via interlocking skills located in `.agent/skills/`. Each skill defines a "Next Recommended Step," allowing agents to chain workflows autonomously:

1. **`sdlc-flow`**: Master orchestrator running the 8-stage issue-to-PR automated pipeline with session concurrency locking, ad-hoc fast-path routing, and parallel fork-join subagent reviews.
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
# Modern zero-install with npx (Recommended):
npx @fmatar/agentic-sdlc init          # Local project installation
npx @fmatar/agentic-sdlc init --global # Global installation (~/.gemini/config/skills)

# Or via turnkey POSIX curl installer:
curl -sL "https://raw.githubusercontent.com/fmatar/agentic-sdlc-framework/main/install.sh" | bash
curl -sL "https://raw.githubusercontent.com/fmatar/agentic-sdlc-framework/main/install.sh" | bash -s -- --global
```

*Alternatively, run `./install.java --local .` or `./install.java --global` directly with JBang.*

To update the framework and sync Archlens policies at any time:
```bash
npx @fmatar/agentic-sdlc update
# or via SDLC engine:
node .agent/scripts/sdlc-engine.mjs update
```

### Step 2: Bootstrap, Configure & Diagnose Environment
- Configure environment credentials (copy `.env.example` to `.env`):
  ```bash
  cp .env.example .env
  node .agent/scripts/sdlc-engine.mjs env
  ```
- **Universal Interactive Wizard (`sdlc-initialize`)**: Auto-detects your polyglot stack, configures Archlens Clean Architecture concentric layer governance, and wires your Project Management provider (GitHub Projects, Jira, Linear, or Local):
  > *"Run sdlc-initialize to onboard this project with Agentic SDLC."*
- **Audit Baseline Health**: Trigger `sdlc-analyze` to compute a compliance baseline score:
  > *"Run sdlc-analyze to audit project health, Clean Architecture, and mutation testing defense."*

### Step 3: Explore Interactive Guidance & Living Board
- Ask your agent for the skill decision matrix, diagnostics, and prompt recipes:
  > *"Run sdlc-help to see the SDLC decision matrix and recipes."*
- Inspect or refresh the in-repo living board and view active lifecycle progress:
  ```bash
  node .agent/scripts/sdlc-engine.mjs pm status
  node .agent/scripts/sdlc-engine.mjs session dashboard
  cat docs/KANBAN.md
  ```

### Step 4: Bring Your Own App (BYOA) Workflow & Examples
Plug the Agentic SDLC skills into any repository and trigger end-to-end autonomous execution:
> *"Trigger sdlc-flow to execute issue #1031. Check session concurrency, create the feature branch, implement with Uncle Bob's TDD, enforce Dual-Gate test coverage (>= 85%) and mutation defense (>= 80%), sync README showcase and CHANGELOG, open a PR, and dispatch parallel peer review and quality gate subagents."*

---

## 💡 Practical Examples of New Advanced Features (How It Works)

### 1. Zero-Code Intake Auto-Classification
You don't need to manually create tickets or decide on issue labels. When you give the agent any prompt:
- *"Add Google OAuth authentication"* $\rightarrow$ creates `feat: Add Google OAuth authentication` with `status:ready`.
- *"Fix NullPointerException on checkout"* $\rightarrow$ creates `fix: NullPointerException on checkout` with mandatory reproduction harness.
- *"Fix critical auth token leakage vulnerability"* $\rightarrow$ creates `hotfix: Fix critical auth token leakage vulnerability` with `P0 - Blocker` priority.
- *"Research WebAssembly performance for crypto"* $\rightarrow$ creates `spike: Research WebAssembly performance for crypto` ending in an ADR.

Or execute directly from the CLI:
```bash
node .agent/scripts/sdlc-engine.mjs ticket create --title "Payment gateway timeout" --type bug --body "Stripe webhooks timeout under load"
```

### 2. Live ASCII Lifecycle Dashboard & Context Resumption
Never wonder where the agent is in the 8-stage lifecycle. View current progress at any time:
```bash
node .agent/scripts/sdlc-engine.mjs session dashboard
```
Output:
```text
================================================================
📊 SDLC LIFECYCLE PROGRESS: #1042 (FEAT)
🌿 Branch: feature/issue-#1042-payment-gateway
================================================================
 ✅ Stage 1: Intake & Spec       (10:00:15 AM)
 ✅ Stage 2: Branch & Kanban     (10:02:40 AM)
 ▶️  Stage 3: TDD Implement       <-- CURRENT (10:04:12 AM)
 ⬜ Stage 4: Dual-Gate Tests    
 ⬜ Stage 5: Docs & Showcase    
 ⬜ Stage 6: Pull Request       
 ⬜ Stage 7: Subagent Review    
 ⬜ Stage 8: Release & Done     
================================================================
```
If your session drops or your agent restarts, resume immediately without repeating completed stages:
```bash
node .agent/scripts/sdlc-engine.mjs session resume
```

### 3. Multi-Session & Git Worktree Isolation
Need to fix an urgent hotfix while an epic feature is in flight? Keep both active in parallel without clobbering uncommitted files:
```bash
# Start an isolated hotfix in its own git worktree:
git worktree add ../worktree-hotfix-1099 -b hotfix/issue-#1099-cve
node .agent/scripts/sdlc-engine.mjs session start --issue 1099 --branch hotfix/issue-#1099-cve --type hotfix --worktree ../worktree-hotfix-1099

# List all active sessions:
node .agent/scripts/sdlc-engine.mjs session list

# Switch between active tickets seamlessly:
node .agent/scripts/sdlc-engine.mjs session switch 1042
```

### 4. Remediation Circuit Breaker & Exemption Ledger
If subagent peer review or mutation testing rejects a PR, the agent remediates up to 3 times automatically. On the 3rd failure, the circuit breaker halts token consumption and requests human review:
- **Exemption Ledger**: If a mutant is a harmless bytecode artifact or shutdown hook that cannot be killed, register an exemption so tests stay strict without blocking release:
```bash
node .agent/scripts/sdlc-engine.mjs exemption add --mutant "OrderService.java:42:NegateCondition" --reason "JVM shutdown hook side-effect verified manually" --by "@lead-arch"
node .agent/scripts/sdlc-engine.mjs exemption list
```

### 5. Automated Remote CI Check Polling
Before merging and releasing in Stage 8, verify that remote GitHub Actions matrix builds are green:
```bash
node .agent/scripts/sdlc-engine.mjs check-ci 42 --timeout 300
```

## 📖 Documentation
Detailed documentation is available in [`docs/SDLC_AGENTIC_OPERATIONS_GUIDE.md`](./docs/SDLC_AGENTIC_OPERATIONS_GUIDE.md) and the [`wiki/`](./wiki/) directory.

## 📄 License
This project is licensed under the Apache 2.0 License - see the [LICENSE](./LICENSE) file for details.
