# 🏛️ Agentic SDLC Architecture

The **Agentic SDLC Framework** orchestrates an autonomous, multi-agent engineering lifecycle. Coding agents are structured into specialized roles governed by strict engineering contracts, Robert C. Martin (Uncle Bob) TDD craftsmanship, continuous Dual-Gate test and mutation defense ($\ge 85\%$ diff coverage, $\ge 80\%$ mutation score), parallel subagent peer reviews, and automated release deployment.

---

## ⚡ The 8-Stage Autonomous Lifecycle

```mermaid
flowchart TD
    classDef startNode fill:#1E293B,stroke:#3B82F6,stroke-width:2px,color:#F8FAFC
    classDef intakeNode fill:#1E1B4B,stroke:#6366F1,stroke-width:2px,color:#EEF2FF
    classDef devNode fill:#064E3B,stroke:#10B981,stroke-width:2px,color:#ECFDF5
    classDef reviewNode fill:#701A75,stroke:#D946EF,stroke-width:2px,color:#FDF4FF
    classDef releaseNode fill:#78350F,stroke:#F59E0B,stroke-width:2px,color:#FEF3C7

    Issue["GitHub Issue / User Intent"]:::startNode --> S1

    subgraph IntakePhase ["📋 Phase 1: Intake & Contract Specification"]
        S1["1. Intake & Contract Specification<br/>sdlc-feature-spec • status:ready"]:::intakeNode
        S2["2. Branch & Kanban Automation<br/>sdlc-kanban • status:in-progress"]:::intakeNode
        S1 --> S2
    end

    subgraph EngineeringPhase ["🛠️ Phase 2: TDD & Mutation Defense"]
        S3["3. Clean-Room TDD Implementation<br/>sdlc-tdd-implement<br/>Uncle Bob's 3 Laws & TPP"]:::devNode
        S4{"4. Dual-Gate Quality<br/>sdlc-test-coverage<br/>Cov >= 85% & Mut >= 80%?"}:::devNode
        S3 --> S4
        S4 -- "Missing Tests or Surviving Mutants" --> S3
    end

    S2 --> S3

    subgraph ShowcasePhase ["📚 Phase 3: Showcase & PR Publication"]
        S5["5. Documentation, Showcase & Changelog<br/>sdlc-docs-wiki<br/>5-Min Quickstart, BYOA & Specs"]:::devNode
        S6["6. Pull Request Creation<br/>create_pull_request • status:in-review"]:::reviewNode
        S5 --> S6
    end

    S4 -- "Cov >= 85% & Mut >= 80%" --> S5

    subgraph ReviewPhase ["⚡ Phase 4: Stage 7 Fork-Join Parallel Review & Gate"]
        direction TB
        S7A["Subagent 1: Peer Reviewer<br/>sdlc-peer-review • Diff & Smells Audit"]:::reviewNode
        S7B["Subagent 2: Quality Gatekeeper<br/>sdlc-quality-gate • Spotless, Build, a11y"]:::reviewNode
    end

    S6 --> ReviewPhase
    ReviewPhase --> GateCheck{Review & Gate Passed?}
    GateCheck -- "Changes Requested / Failing Gate" --> S3
    GateCheck -- "Approved" --> Done["8. Release & Done<br/>sdlc-release-changelog • status:done<br/>Session Release, SemVer Tag, Docker & Helm"]:::releaseNode
```

---

## 🔄 5-Stage Kanban State Machine

The lifecycle coordinates with GitHub Projects v2 and repository issue boards through deterministic label transitions:

```mermaid
stateDiagram-v2
    [*] --> Backlog: New Issue Filed
    Backlog --> Ready: Stage 1 (Contract & Acceptance Criteria Approved)
    Ready --> InProgress: Stage 2 (Feature Branch Checked Out)
    InProgress --> InProgress: Stage 3 & 4 (TDD & Coverage Loop < 85%)
    InProgress --> InReview: Stage 6 (PR Opened & Linked)
    InReview --> InProgress: Stage 7 (Changes Requested / Failing Gate)
    InReview --> Done: Stage 8 (Quality Gate Clean & PR Merged)
    Done --> [*]
```

---

## ⚡ Multi-Agent Fork-Join Execution

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer / Issue
    participant Flow as Master Orchestrator (sdlc-flow)
    participant Board as Kanban Board (sdlc-kanban)
    participant Spec as Architect (sdlc-feature-spec)
    participant TDD as Full-Stack Engineer (sdlc-tdd-implement)
    participant QA as QA Automation (sdlc-test-coverage)
    participant Docs as Tech Writer (sdlc-docs-wiki)
    participant Peer as Peer Review Subagent (sdlc-peer-review)
    participant Gate as Quality Gate (sdlc-quality-gate)

    Dev->>Flow: Trigger workflow for Issue #<id>
    Flow->>Spec: Ingest requirements & draft contract
    Spec-->>Board: Tag ticket status:ready
    Flow->>Board: Checkout branch & set status:in-progress
    
    loop Test-Driven Development & Mutation Defense Loop
        Flow->>TDD: Write failing unit tests & implementation (3 Laws of TDD)
        Flow->>QA: Audit diff test coverage & run PITest/Stryker mutation defense
        alt Coverage < 85% or Mutation Score < 80%
            QA-->>TDD: Feedback uncovered branches & surviving mutants
        else Coverage >= 85% & Mutation Score >= 80%
            QA-->>Flow: Dual-Gate verified (Cov >= 85%, Mut >= 80%)
        end
    end

    Flow->>Docs: Sync root README showcase, specs & CHANGELOG
    Flow->>Board: Push branch, open PR & set status:in-review

    par Parallel Peer Review & Quality Gate
        Flow->>Peer: Dispatch subagent to audit PR diff
        Peer-->>Flow: Submit review event (APPROVE)
    and
        Flow->>Gate: Run Spotless, type-check, build & SAST
        Gate-->>Flow: Quality gate validation passed
    end

    Flow->>Board: Merge PR, close issue (status:done) & sync docs/KANBAN.md
```

---

## 📋 Detailed Stage Breakdown

### Stage 1: Intake & Contract Specification (`sdlc-feature-spec`)
* Reads user story and technical scope via `issue_read`.
* Produces SVPG PRD, IEEE 29148 SRS, C4 architecture schemas, and Gherkin acceptance scenarios.
* Labels ticket with `status:ready`.

### Stage 2: Branch & Kanban Automation (`sdlc-kanban`)
* Creates feature branch: `feature/issue-#<id>-<kebab-title>`.
* Updates ticket to `status:in-progress` and refreshes living [`docs/KANBAN.md`](../docs/KANBAN.md).
* Enforces WIP limit (max 3–5 tickets in progress).

### Stage 3: Clean-Room TDD Implementation (`sdlc-tdd-implement`)
* Strictly enforces **Uncle Bob's Three Laws of TDD** and the **Transformation Priority Premise (TPP)**.
* Writes failing unit tests for degenerate cases before writing production code.
* Frontend: Modern Svelte 5 Runes (`$state`, `$derived`, `$props`).
* Backend: Quarkus Java 25 reactive streams (Mutiny `Uni`/`Multi`, Hibernate Reactive Panache).
* Eliminates test smells: no trivial getter tests, no testing third-party framework plumbing, no mock abuse.

### Stage 4: Dual-Gate Test & Mutation Enforcement (`sdlc-test-coverage`)
* Executes unit and integration test suites:
  * Backend: `./mvnw clean test jacoco:report` and `./mvnw test-compile org.pitest:pitest-maven:mutationCoverage`
  * Frontend: `npm run test:coverage` and `npx stryker run`
* Computes coverage strictly against the git diff (`git diff --name-only main`).
* **Dual-Gate Threshold**: $\ge 85\%$ line and branch coverage on diff AND $\ge 80\%$ mutation kill score on modified classes. Automatically authors missing tests and kills surviving mutants until the gate passes.

### Stage 5: Documentation, Showcase & Changelog Sync (`sdlc-docs-wiki`)
* **Developer Showcase Invariant**: Updates the root `README.md` with a frictionless **5-Minute Developer Quickstart** (< 5 min time-to-first-run) and Bring Your Own App (BYOA) contract.
* Synchronizes `docs/specs/`, `CHANGELOG.md` under `[Unreleased]`, and wiki deep-dives.

### Stage 6: Pull Request Publication (`sdlc-kanban`)
* Pushes branch to remote and calls `create_pull_request` linking `Fixes #<id>`.
* Transitions issue to `status:in-review`.

### Stage 7: Fork-Join Parallel Review & Quality Gate (`invoke_subagent`)
* Concurrently dispatches read-only auditor subagents via `invoke_subagent`:
  * **Peer Reviewer (`sdlc-peer-review`)**: Audits PR diff for reactive patterns, security hygiene, Dual-Gate metrics, and Uncle Bob test smells. Posts structured review comments (`APPROVE` / `REQUEST_CHANGES`).
  * **Quality Gatekeeper (`sdlc-quality-gate`)**: Executes universal quality gate (`sdlc-engine.mjs gate`), Spotless formatting, svelte-check, test port isolation, WCAG a11y, and SAST scanning.
* If review requests changes or gate fails: reverts Kanban label to `status:in-progress` and rolls session back to Stage 3 (`sdlc-tdd-implement`).

### Stage 8: Quality Gate Passed, Release & Lock Release (`sdlc-release-changelog` & `sdlc-kanban`)
* Merges PR into base branch.
* Increments Semantic Versioning (SemVer 2.0.0), builds Docker container images, and updates Kubernetes/Helm releases.
* Marks ticket `status:done`, regenerates living [`docs/KANBAN.md`](../docs/KANBAN.md), and releases the session lock (`node .agent/scripts/sdlc-engine.mjs session release`).
