# 🧠 Agentic Skills Reference (`ADR-002`)

The **Agentic SDLC Framework** is powered by **6 consolidated, schema-valid skills** located in `.agent/skills/`. Each skill uses native agent tools (`read_file`, `write_file`, `edit_file`, `run_command`, `invoke_subagent`) and delegates mechanical bookkeeping to `.agent/scripts/sdlc-engine.mjs`.

---

## 🗺️ Skills Domain Topology

```mermaid
flowchart LR
    classDef orch fill:#1E1B4B,stroke:#6366F1,stroke-width:2px,color:#EEF2FF
    classDef spec fill:#064E3B,stroke:#10B981,stroke-width:2px,color:#ECFDF5
    classDef code fill:#0F172A,stroke:#38BDF8,stroke-width:2px,color:#F8FAFC
    classDef gate fill:#701A75,stroke:#D946EF,stroke-width:2px,color:#FDF4FF
    classDef ops fill:#78350F,stroke:#F59E0B,stroke-width:2px,color:#FEF3C7

    Init["⚡ sdlc-init\n(Bootstrap, Doctor & Interop)"]:::ops --> Product["🏛️ sdlc-product\n(PRODUCT.md, Specs, ADRs & DAG)"]:::spec
    Product --> Flow["🚀 sdlc-flow\n(Composite Stage Orchestrator)"]:::orch
    Flow --> TDD["🧪 sdlc-tdd\n(Robert Martin TDD & Dual-Gate)"]:::code
    TDD --> ReviewGate["🔍 sdlc-review-gate\n(Fork-Join PR Review & Strict Gate)"]:::gate
    ReviewGate --> Release["📦 sdlc-release\n(Docs Sync, SemVer & Watchdog)"]:::ops
```

---

## 📋 Canonical 6-Skill Catalog

| Skill | Consolidated From (`ADR-002`) | Primary Responsibilities | Allowed Tools |
| :--- | :--- | :--- | :--- |
| **`sdlc-flow`** | `sdlc-flow` + `sdlc-kanban` + `sdlc-arch-trace` | Drives the composite issue-to-PR pipeline (`stage begin`, `stage pre-pr`, `stage complete`), Kanban state transitions, and `docs/ARCH_TRACE.md`. | `read_file`, `write_file`, `edit_file`, `run_command`, `invoke_subagent` |
| **`sdlc-product`** | `sdlc-product` + `sdlc-feature-spec` | Synthesizes `PRODUCT.md` (`CAP-XX`, `INV-XX`), authors `docs/specs/*.md`, C4 diagrams, ADRs, and schedules topological DAG waves. | `read_file`, `write_file`, `edit_file`, `run_command`, `invoke_subagent` |
| **`sdlc-tdd`** | `sdlc-tdd-implement` + `sdlc-test-coverage` | Enforces Robert Martin's 3 Laws of TDD, TPP, F.I.R.S.T. isolation, real coverage ($\ge 85\%$), and mutation kill score ($\ge 80\%$). | `read_file`, `write_file`, `edit_file`, `run_command` |
| **`sdlc-review-gate`** | `sdlc-peer-review` + `sdlc-quality-gate` + `sdlc-analyze` | Parallel Fork-Join PR diff review (`TypeName: "research"`), strict 9-pillar quality gate, Archlens ring validation, and compliance scorecard. | `read_file`, `write_file`, `edit_file`, `run_command`, `invoke_subagent` |
| **`sdlc-release`** | `sdlc-docs-wiki` + `sdlc-release-changelog` | Synchronizes `README.md`, `docs/specs/`, `CHANGELOG.md`, and `/wiki`, and executes SemVer releases, regression proofs, and canary watchdogs. | `read_file`, `write_file`, `edit_file`, `run_command` |
| **`sdlc-init`** | `sdlc-initialize` + `sdlc-help` | Polyglot stack discovery (`detect`), `doctor --fix`, 4-Layer Git hooks, `.archlens/policy.json`, and multi-agent interop export. | `read_file`, `write_file`, `edit_file`, `run_command` |
