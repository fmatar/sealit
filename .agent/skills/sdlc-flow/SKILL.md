---
name: sdlc-flow
description: Master SDLC orchestrator that drives end-to-end bug fixing, feature implementation, refactoring, and release workflows using parallel Fork-Join subagent pipelines.
version: 2.0.0
license: Apache 2.0
---

# SDLC Master Lifecycle Orchestrator (`sdlc-flow`)

Use this skill to execute end-to-end software development lifecycle workflows. `sdlc-flow` leverages **Parallel Fork-Join Execution** and concurrent subagent pipelines to maximize development velocity while maintaining strict quality gates.

---

## ⚡ Parallel Fork-Join Lifecycle Architecture

Rather than executing every stage sequentially, `sdlc-flow` establishes the **Interface & Specification Contract** first, and then **forks concurrent workstreams** before joining at the **Quality Gate**:

```mermaid
flowchart TD
    Trigger["Intake: Bug Report / Feature / Multi-Epic"] --> S1["1. Specification & Contract (sdlc-feature-spec)"]
    
    subgraph ParallelFork ["⚡ Concurrent Fork Phase (invoke_subagent)"]
        direction LR
        T1["Track A: Implementation\n(sdlc-tdd-implement)\n• Svelte 5 Runes\n• SVG Math Geometry\n• Web Audio Synthesizer"]
        T2["Track B: Test Engineering\n(sdlc-test-coverage)\n• Vitest Unit Tests\n• Store State Mocks\n• Coverage Assertions"]
        T3["Track C: Documentation & Wiki\n(sdlc-docs-wiki)\n• /wiki deep-dives\n• Somatic Science\n• Mermaid Diagrams"]
    end
    
    S1 -->|Fork Contract| ParallelFork
    ParallelFork -->|Join & Converge| S4["3. Quality Gate (sdlc-quality-gate)\n• svelte-check\n• Vitest Suite Execution\n• WCAG a11y & Memory Safety"]
    
    S4 --> Checkpoint{"Adaptive Review Checkpoint"}
    Checkpoint -->|User Approval| S5["4. Release & Changelog (sdlc-release-changelog)\n• SemVer Bump\n• Keep a Changelog\n• GitHub Release"]
```

---

## 🎛️ Parallel Workstream Strategies

### 1. The Single Feature / Bug Fork-Join Pattern
When a single feature or bug is initiated:
1. **Contract Phase (`sdlc-feature-spec`)**: Define types (`src/lib/types/`), data schema, and acceptance criteria by scaffolding PRD, SRS, C4 Architecture, and ADR documents using the templates in `docs/templates/`.
2. **Concurrent Fork**: Call `invoke_subagent` with 3 parallel workers:
   - **Worker 1 (Dev)**: Implements UI components and math/audio logic.
   - **Worker 2 (QA)**: Implements Vitest test suites verifying the schema contract and edge cases.
   - **Worker 3 (Tech Writer)**: Writes documentation in `wiki/` and generates Mermaid diagrams.
3. **Join & Audit (`sdlc-quality-gate`)**: Run `npx svelte-check --tsconfig ./tsconfig.json` and execute all test suites together.

---

### 2. Multi-Feature / Multi-Technique Batch Parallelism
When multiple independent features or techniques are added at once (e.g. *Physiological Sigh* + *Nadi Shodhana* + *4-0-6-0*):
1. **Intake & Multi-Spec**: Generate separate sub-issues via `sdlc-feature-spec`.
2. **Concurrent Feature Workers**: Launch independent subagents in parallel using `invoke_subagent` with `Workspace: "branch"` or isolated files:
   ```json
   {
     "Subagents": [
       { "Role": "Physiological Sigh Engineer", "Prompt": "Implement Physiological Sigh geometry & audio" },
       { "Role": "Nadi Shodhana Engineer", "Prompt": "Implement Nadi Shodhana Lemniscate & stereo panner" },
       { "Role": "Extended Exhale Engineer", "Prompt": "Implement 4-0-6-0 Ellipse pacing" }
     ]
   }
   ```
3. **Collective Convergence**: Consolidate branches $\rightarrow$ run full test suite $\rightarrow$ execute collective quality audit.

---

## 🛠️ Step-by-Step Flow Execution Checklist

- [ ] **Step 1: Triage & Contract**: Formulate RFC / Issue on GitHub (`sdlc-feature-spec`).
- [ ] **Step 2: Fork Concurrent Tracks**: Launch parallel tasks for Implementation, Tests, and Documentation.
- [ ] **Step 3: Join & Quality Gate**: Run `svelte-check`, full Vitest test suite, and a11y audit (`sdlc-quality-gate`).
- [ ] **Step 4: Review Checkpoint**: Present completed walkthrough artifact to the user.
- [ ] **Step 5: Release (Optional)**: Trigger `sdlc-release-changelog` to publish version.

---

## ⏭️ Next Recommended Step

- To monitor running background tasks or parallel workers, use the `manage_task` or `manage_subagents` tools.
- When all parallel tracks report complete, invoke **`sdlc-quality-gate`** to validate collective health.
