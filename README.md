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

## 🏛️ Comprehensive Architecture & Lifecycle Workflow

The following diagram illustrates the complete supervisor fork-join lifecycle of the `sdlc-flow` orchestrator, from Gate 0 ticket ingestion to Stage 8 release and session teardown:

```mermaid
flowchart TD
    %% Styling and Theme Definitions
    classDef trigger fill:#1e1e2f,stroke:#6366f1,stroke-width:2px,color:#f8fafc,rx:8,ry:8;
    classDef decision fill:#312e81,stroke:#a855f7,stroke-width:2px,color:#f3e8ff,rx:6,ry:6;
    classDef gate0 fill:#3b0764,stroke:#d946ef,stroke-width:2px,color:#fae8ff,rx:8,ry:8;
    classDef stage fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#e0f2fe,rx:8,ry:8;
    classDef stageHighlight fill:#1e293b,stroke:#06b6d4,stroke-width:2.5px,color:#ecfeff,rx:8,ry:8;
    classDef subagent fill:#111827,stroke:#10b981,stroke-width:2px,color:#ecfdf5,rx:8,ry:8;
    classDef failure fill:#450a0a,stroke:#ef4444,stroke-width:2px,color:#fee2e2,rx:8,ry:8;
    classDef circuit fill:#701a75,stroke:#f43f5e,stroke-width:2.5px,color:#ffe4e6,rx:8,ry:8;
    classDef success fill:#064e3b,stroke:#22c55e,stroke-width:2.5px,color:#dcfce7,rx:8,ry:8;
    classDef fallback fill:#1c1917,stroke:#f59e0b,stroke-width:2px,color:#fef3c7,rx:8,ry:8;

    %% Entry Points
    UserReq(["🎯 Incoming User Request\n(Feature • Bug Fix • Hotfix • Spike)"]):::trigger

    %% Gate 0: Mandatory Ticket Invariant
    subgraph Gate0 ["🛑 Gate 0: Mandatory Ticket Invariant & Classification"]
        direction TB
        HasTicket{"Ticket ID #ID\nProvided?"}:::decision
        AutoClassify["🤖 Auto-Classifier\n• feat / fix / hotfix / spike\n• Problem scope analysis"]:::gate0
        ProvTicket["🎫 Auto-Provision Tracking Ticket\n(node .agent/scripts/sdlc-engine.mjs ticket create)\n• GitHub Issues / Jira / Linear / KANBAN.md\n• Set status:ready"]:::gate0
    end

    UserReq --> HasTicket
    HasTicket -->|No Ticket #| AutoClassify
    AutoClassify --> ProvTicket
    HasTicket -->|Ticket # Exists| PreFlightGuard
    ProvTicket --> PreFlightGuard

    %% Stage 0: Pre-Flight Concurrency & Intent Guard
    subgraph Stage0 ["🚦 Stage 0: Concurrency & Intent Routing (sdlc-engine session status)"]
        direction TB
        PreFlightGuard{"Active Session\nStatus?"}:::decision
        FastPath["⚡ Ad-Hoc Fast Path\n• Append Task to Ticket #<id>\n• Affected-only Test Runner\n• Direct TDD remediation"]:::stageHighlight
        WorktreeFork["🌿 Worktree Isolation / Branch Subagent\n(git worktree add ../worktree-issue-<id>)\n• Concurrent flow without clobbering"]:::fallback
        InitLock["🔒 Acquire Session Concurrency Lock\n(sdlc-engine session start --issue <id>)\n• Write .agent/.sdlc-session.json"]:::stageHighlight
    end

    PreFlightGuard -->|Sub-task on Active Ticket| FastPath
    PreFlightGuard -->|New Urgent Request while Active| WorktreeFork
    PreFlightGuard -->|Clean / No Active Session| InitLock

    %% Stage 1 to 6: Core Sequential Pipeline
    subgraph Pipeline ["⚙️ Stages 1 - 6: Specification, TDD & Showcase Engine"]
        direction TB

        %% Stage 1
        subgraph S1_Intake ["1️⃣ Stage 1: Intake & Architecture Contract"]
            direction TB
            DetectStack["Stack Auto-Detection\n(sdlc-engine detect)"]:::stage
            ArchPrompt{"Archlens Policy\nPresent?"}:::decision
            ScaffoldArch["Scaffold Concentric Policy\n(sdlc-engine archlens scaffold)"]:::fallback
            FetchReqs["Formulate Contract & Spec\n• Gherkin Acceptance Criteria\n• RFC / ADR / C4 Architecture\n• Tag: status:ready"]:::stage
        end

        %% Stage 2
        subgraph S2_Branch ["2️⃣ Stage 2: Branch & Kanban Sync"]
            direction TB
            CreateBranch["Git Checkout Branch\n(feature/issue-#<id>-<slug>)\n• Transition: status:in-progress\n• Update Session Stage 2"]:::stage
        end

        %% Stage 3
        subgraph S3_TDD ["3️⃣ Stage 3: Clean-Room TDD Implementation"]
            direction TB
            BugReproCheck{"Is Bug / Fix?"}:::decision
            ReproHarness[" author Failing Reproduction Test\n• Verify harness fails first"]:::failure
            UncleBobTDD["Uncle Bob's 3 Laws of TDD & TPP\n• Degenerate failing tests first\n• Clean domain logic & port isolation\n• Fast loop: sdlc-engine test --affected-only"]:::stageHighlight
        end

        %% Stage 4
        subgraph S4_Gate ["4️⃣ Stage 4: Dual-Gate & Mutation Testing"]
            direction TB
            RunDualGate["Universal Dual-Gate Audits\n• sdlc-engine coverage (>= 85% Line/Branch)\n• sdlc-engine mutation (>= 80% Kill Score)\n• sdlc-engine archlens diff (0 Inversions)"]:::stageHighlight
            MutantCheck{"Surviving\nMutants?"}:::decision
            StrengthenMutant["Auto-Strengthen Boundary Tests\n(sdlc-engine strengthen)"]:::stage
            ExemptionLedger["Register Benign Exemption\n(.agent/sdlc-exemptions.json)"]:::fallback
        end

        %% Stage 5
        subgraph S5_Showcase ["5️⃣ Stage 5: Documentation & Showcase Hygiene"]
            direction TB
            SyncDocs["Developer Showcase Sync\n• Root README.md 5-Min Quickstart\n• Architecture specs in docs/specs/\n• CHANGELOG.md under [Unreleased]"]:::stage
        end

        %% Stage 6
        subgraph S6_PR ["6️⃣ Stage 6: Pull Request Opening"]
            direction TB
            OpenPR["Generate PR Summary & Push\n(sdlc-engine pr-summary --issue <id>)\n• Tag: status:in-review\n• UI Ephemeral screenshot previews"]:::stage
        end
    end

    InitLock --> DetectStack
    DetectStack --> ArchPrompt
    ArchPrompt -->|No Policy Found| ScaffoldArch
    ArchPrompt -->|Policy Configured| FetchReqs
    ScaffoldArch --> FetchReqs
    FetchReqs --> CreateBranch
    CreateBranch --> BugReproCheck
    BugReproCheck -->|Yes| ReproHarness
    BugReproCheck -->|No| UncleBobTDD
    ReproHarness --> UncleBobTDD
    UncleBobTDD --> RunDualGate
    RunDualGate --> MutantCheck
    MutantCheck -->|Surviving Mutants| StrengthenMutant
    StrengthenMutant --> RunDualGate
    MutantCheck -->|Benign Compiler Quirk| ExemptionLedger
    MutantCheck -->|Dual-Gate Met| SyncDocs
    ExemptionLedger --> SyncDocs
    SyncDocs --> OpenPR

    %% Stage 7: Parallel Fork-Join Review
    subgraph ForkJoinReview ["⚡ Stage 7: Supervisor Fork-Join Parallel Review (invoke_subagent)"]
        direction TB
        PlanReview["Review Dispatch Plan\n(sdlc-engine review plan)"]:::stageHighlight
        
        subgraph SubagentsPool ["Concurrently Dispatched Subagents"]
            direction LR
            SubReviewer["🕵️ PR Peer Reviewer\n• Uncle Bob Test Smell Detection\n• Diff Audit & DIP Check\n• Formal PR Review Comments"]:::subagent
            SubGatekeeper["🛡️ Quality Gatekeeper\n• Full sdlc-engine gate --strict\n• Flake stability check (3 runs)\n• Secret & package CVE audits"]:::subagent
            SubArchAuditor["🏛️ Architectural Auditor\n(Triggered on HIGH/CRITICAL Risk)\n• Concentric boundary proof\n• ADR alignment"]:::subagent
        end
        
        EvalResults{"Audit & Gate\nPassed?"}:::decision
    end

    OpenPR --> PlanReview
    PlanReview --> SubReviewer
    PlanReview --> SubGatekeeper
    PlanReview --> SubArchAuditor
    SubReviewer --> EvalResults
    SubGatekeeper --> EvalResults
    SubArchAuditor --> EvalResults

    %% Circuit Breaker & Remediation
    subgraph CircuitBreaker ["🔄 Circuit Breaker & Auto-Remediation Loop"]
        direction TB
        RemediationCount{"Remediation\nCount < 3?"}:::circuit
        LoopBack["Rollback Session to Stage 3\n• Tag: status:in-progress\n• session update --stage 3 --remediate"]:::failure
        InteractiveIntervention["⚠️ Circuit Breaker Tripped!\n(Interactive ask_question Modal)\n1. Grant Exemption & Record Ledger\n2. Extend Budget (+2 retries)\n3. Abort & Rollback to Main"]:::fallback
    end

    EvalResults -->|Changes Requested or Gate Failed| RemediationCount
    RemediationCount -->|Budget Available| LoopBack
    LoopBack --> UncleBobTDD
    RemediationCount -->|3 Consecutive Failures| InteractiveIntervention
    InteractiveIntervention -->|Extend Budget| UncleBobTDD

    %% Stage 8: Done & Release
    subgraph Stage8 ["🏁 Stage 8: Final Gate & Teardown (sdlc-release-changelog)"]
        direction TB
        PollRemoteCI["Remote CI/CD Polling\n(sdlc-engine check-ci <pr-id>)"]:::stage
        MergePR["Squash & Merge PR\n• Tag SemVer Release\n• Deploy Containers / Artifacts"]:::stage
        CloseTicket["Final Kanban State Sync\n• Tag status:done & close issue\n• kanban-sync.sh"]:::stage
        ReleaseLock["🔓 Release Session Concurrency Lock\n(sdlc-engine session release)"]:::success
    end

    EvalResults -->|All Approved & Strict Green| PollRemoteCI
    PollRemoteCI --> MergePR
    MergePR --> CloseTicket
    CloseTicket --> ReleaseLock

    %% Worktree / FastPath convergence
    FastPath -.-> RunDualGate
    WorktreeFork -.-> DetectStack
```

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

---

## 💬 Prompting the Agent: Practical Real-World Scenarios

You can drive the entire framework through standard conversational prompts. Here are the exact prompts to use:

### 1. New Feature Implementation (Autonomous End-to-End)
> **Prompt**: `"Implement feature #104: Add multi-tenant JWT token rotation with rate limiting. Follow the sdlc-flow lifecycle."`
> *(If you don't have an issue number, say: `"Build a multi-tenant JWT token rotation with rate limiting."` Gate 0 will auto-classify it as `feat`, provision the issue, and begin).*
* **What happens**: Auto-proves Archlens Clean Architecture governance, creates branch, executes Uncle Bob TDD, enforces $\ge 85\%$ diff coverage & $\ge 80\%$ mutation kill score, syncs README & CHANGELOG, opens PR, and launches parallel peer review & quality gate subagents.

### 2. Bug Fix with Mandatory Reproduction Harness
> **Prompt**: `"Fix bug #205: Session timeout triggers NullPointerException when user profile has null email."`
* **What happens**: The agent adheres to the **Reproduction Invariant**: it authors a failing test reproducing the exact failure *before* modifying any application logic, proves it fails red, applies the fix, and runs through the Dual-Gate.

### 3. Ad-Hoc Fast-Path (Tweaking an In-Flight Ticket)
> **Prompt**: `"Also make sure the token TTL is configurable via environment variable JWT_ROTATION_TTL_SECONDS."`
* **What happens**: Detects active session on `#104`, appends the checklist item to the active ticket, skips intake overhead, and executes TDD + affected-only tests (`sdlc-engine test --affected-only`) directly on the branch.

### 4. Concurrent Urgent Hotfix (Git Worktree Isolation)
> **Prompt**: `"Urgent hotfix: Stripe webhook payload version 2026-09-01 breaks checkout. Don't lose my current work on the JWT feature!"`
* **What happens**: Detects session collision, creates an isolated git worktree (`../worktree-hotfix-stripe`), provisions `#206`, resolves the fix in isolation, and tears down the worktree without stashing or dirtying your active feature workspace.

---

## ⏱️ 5-Minute Developer Quickstart

### Step 1: Install Framework
```bash
# Zero-install with npx (Local to repo or Global to ~/.gemini/config/skills):
npx @fmatar/agentic-sdlc init          # Local
npx @fmatar/agentic-sdlc init --global # Global

# Or via turnkey POSIX curl:
curl -sL "https://raw.githubusercontent.com/fmatar/agentic-sdlc-framework/main/install.sh" | bash
```

### Step 2: Bootstrap & Auto-Heal Project
```bash
# Verify toolchain, git hooks, Archlens governance, and local Kanban board:
node .agent/scripts/sdlc-engine.mjs doctor --fix

# Auto-detect stack, CI workflows, and scaffold .agent/sdlc-config.json:
node .agent/scripts/sdlc-engine.mjs detect
```

### Step 3: Run the Universal Engine CLI
All stages can be monitored or executed directly via the unified `sdlc-engine`:

| Command | Purpose |
|---|---|
| `sdlc-engine session status` | View active ticket, stage, branch, and subagents |
| `sdlc-engine session dashboard` | View live interactive ASCII lifecycle progress |
| `sdlc-engine test --affected-only` | Run tests strictly for files modified in the active diff |
| `sdlc-engine coverage` | Run diff coverage gate ($\ge 85\%$ line & branch) |
| `sdlc-engine mutation` | Run mutation testing defense ($\ge 80\%$ kill score) |
| `sdlc-engine archlens diff` | Audit diff for Clean Architecture concentric layer inversions |
| `sdlc-engine gate --strict` | Unified strict gate (Lint, Build, Test, Risk, Security, Flake) |
| `sdlc-engine review plan` | Generate parallel subagent review plan JSON payload |
| `sdlc-engine pr-summary --issue <id>` | Generate formatted markdown summary for GitHub PR |
| `sdlc-engine flake-check --runs 5` | Detect non-deterministic test race conditions |
| `sdlc-engine security-audit` | Scan diff for leaked secrets, API keys, and package CVEs |
| `sdlc-engine release [patch\|minor\|major]` | Bump SemVer, update package/changelog, and tag release |

---

## 🛠️ Advanced Framework Architecture

<details>
<summary><b>Click to expand Advanced SDLC Engine Features & Safeguards</b></summary>

### 1. Zero-Code Ticket Auto-Classification
Incoming requests without an explicit `#id` are deterministically classified:
- `feat`: Architectural capabilities or user features (`status:ready`).
- `fix`: Defect remediation requiring an upfront failing reproduction test.
- `hotfix`: Critical production blockers with P0 priority.
- `spike`: Timeboxed research ending in an ADR.

### 2. Remediation Circuit Breaker & Exemption Ledger
If parallel subagent peer review or mutation testing rejects a PR, the agent remediates up to 3 times automatically. On the 3rd failure, the circuit breaker halts token consumption and presents an interactive `ask_question` modal (request exemption, extend budget, or rollback).
- **Exemption Ledger**: Document unkillable compiler bytecode quirks or shutdown hooks in `.agent/sdlc-exemptions.json`:
  ```bash
  node .agent/scripts/sdlc-engine.mjs exemption add --mutant "OrderService:42:NegateCondition" --reason "JVM shutdown hook side-effect" --by "@lead"
  ```

### 3. Remote CI Polling & Git Hooks
- Install zero-dependency local pre-commit/pre-push hooks: `node .agent/scripts/sdlc-engine.mjs hooks install`.
- Scaffold GitHub Actions Quality Gate CI: `node .agent/scripts/sdlc-engine.mjs ci-workflow install`.
- Verify GitHub Actions matrix status before merging: `node .agent/scripts/sdlc-engine.mjs check-ci <pr-id>`.

</details>

## 📖 Documentation & Specifications
Detailed deep dives and architecture guides are available in:
- [`docs/SDLC_AGENTIC_OPERATIONS_GUIDE.md`](./docs/SDLC_AGENTIC_OPERATIONS_GUIDE.md)
- [`wiki/`](./wiki/)

## 📄 License
This project is licensed under the Apache 2.0 License - see the [LICENSE](./LICENSE) file for details.

