# 🚀 Welcome to the Agentic SDLC Framework Wiki

> **Autonomous Multi-Agent Software Development Lifecycle Orchestration**  
> *Transforming standard AI coding agents into an enterprise-grade, disciplined software engineering team.*

---

## 🧭 Ecosystem Overview

The **Agentic SDLC Framework** orchestrates specialized AI agents across the entire software delivery lifecycle—from initial requirements intake to production deployment.

```mermaid
flowchart LR
    classDef intake fill:#1E1B4B,stroke:#6366F1,stroke-width:2px,color:#EEF2FF
    classDef dev fill:#064E3B,stroke:#10B981,stroke-width:2px,color:#ECFDF5
    classDef review fill:#701A75,stroke:#D946EF,stroke-width:2px,color:#FDF4FF
    classDef release fill:#78350F,stroke:#F59E0B,stroke-width:2px,color:#FEF3C7

    subgraph Phase1 ["1. Scoping & Planning"]
        A["Feature Intake & Contract<br/><code>sdlc-feature-spec</code>"]:::intake
        B["Kanban State Machine<br/><code>sdlc-kanban</code>"]:::intake
        A --> B
    end

    subgraph Phase2 ["2. Test-Driven Delivery"]
        C["Svelte 5 & Quarkus TDD<br/><code>sdlc-tdd-implement</code>"]:::dev
        D["Dual-Gate Test & Mutation<br/><code>sdlc-test-coverage</code> (85% cov / 80% mut)"]:::dev
        C --> D
    end

    subgraph Phase3 ["3. Review & Quality Gates"]
        E["Parallel Peer Reviewer<br/><code>sdlc-peer-review</code>"]:::review
        F["DevSecOps Quality Gate<br/><code>sdlc-quality-gate</code>"]:::review
        E --- F
    end

    subgraph Phase4 ["4. Docs & Deployment"]
        G["Developer Showcase Sync<br/><code>sdlc-docs-wiki</code>"]:::release
        H["SemVer Release & Helm<br/><code>sdlc-release-changelog</code>"]:::release
        G --> H
    end

    Phase1 --> Phase2
    Phase2 --> Phase3
    Phase3 --> Phase4
```

---

## 📚 Central Wiki Navigation

| Section | Focus Area | Description |
| :--- | :--- | :--- |
| 🏛️ **[Architecture Design](Architecture)** | System Design & Flow | Deep-dive into the 8-stage lifecycle, Mermaid sequence flows, and state machines. |
| 🧠 **[Skills Reference](Skills-Reference)** | Agentic Capabilities | Complete catalog of the 12 interlocking skills, role definitions, and allowed tools. |
| 🎯 **[Traceability & Views](Traceability)** | Governance & Audit | 7-layer traceability thread, 6 standard Project v2 views, and custom fields. |
| 📋 **[Living Kanban Board](https://github.com/fmatar/agentic-sdlc-framework/blob/main/docs/KANBAN.md)** | Project Governance | Real-time GitHub Projects v2 issue states and active milestones. |
| 📖 **[Operations Guide](https://github.com/fmatar/agentic-sdlc-framework/blob/main/docs/SDLC_AGENTIC_OPERATIONS_GUIDE.md)** | Operational Playbook | Step-by-step developer and agentic recipes for everyday engineering workflows. |

---

## 💎 Core Engineering Invariants

```mermaid
graph TD
    classDef c1 fill:#0F172A,stroke:#38BDF8,stroke-width:2px,color:#F8FAFC
    classDef c2 fill:#0F172A,stroke:#34D399,stroke-width:2px,color:#F8FAFC
    classDef c3 fill:#0F172A,stroke:#F472B6,stroke-width:2px,color:#F8FAFC
    classDef c4 fill:#0F172A,stroke:#FBBF24,stroke-width:2px,color:#F8FAFC

    I1["📋 Strict Contract Specification<br/>SVPG PRDs, IEEE 29148 SRS & C4 Architecture"]:::c1
    I2["🎯 Dual-Gate Quality Invariant<br/>>= 85% Diff Coverage & >= 80% Mutation Score (PITest/Stryker)"]:::c2
    I3["⚡ Parallel Subagent Auditing<br/>Fork-Join peer reviews independent of coder agent"]:::c3
    I4["⏱️ Developer Showcase Invariant<br/>Frictionless 5-minute time-to-first-run quickstart"]:::c4
```

---

## ⚡ Quick Trigger Example

To run the full end-to-end autonomous pipeline on any GitHub issue:

> *"Trigger `sdlc-flow` to execute issue #1031. Check session concurrency, create the feature branch, implement with Uncle Bob's TDD, enforce Dual-Gate test coverage (>= 85%) and mutation defense (>= 80%), sync README showcase and CHANGELOG, open a PR, and dispatch parallel peer review and quality gate subagents."*
