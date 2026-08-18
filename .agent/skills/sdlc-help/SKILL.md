---
name: sdlc-help
description: Interactive user and agent guide for the The Project SDLC ecosystem. Provides command recipes, workflow diagrams, decision matrices, and tool diagnostics.
version: 1.1.0
license: Apache 2.0
---

# SDLC Guide, Recipes & Tool Diagnostics (`sdlc-help`)

Use this skill when you need guidance on how to navigate the The Project SDLC ecosystem, select the right skill for a task, run parallel workstreams, or use copy-paste prompt recipes.

---

## 🧭 SDLC Skill Decision Matrix

| What You Want to Accomplish | Recommended Skill | Trigger Phrase / Command |
| :--- | :--- | :--- |
| **Fix a bug or build a feature using parallel pipelines** | **`sdlc-flow`** | *"Run parallel sdlc-flow for [description]"* |
| **Scope requirements, write RFC, record ADR, file GitHub issue** | **`sdlc-feature-spec`** | *"Draft a spec / issue for [feature]"* |
| **Write Svelte 5 code, runes, SVG geometry, modern web APIs** | **`sdlc-tdd-implement`** | *"Implement [component/store/math module]"* |
| **Write Vitest unit tests, check test coverage** | **`sdlc-test-coverage`** | *"Run tests and check coverage threshold"* |
| **Update `/wiki` docs, README, Mermaid state diagrams** | **`sdlc-docs-wiki`** | *"Sync wiki and docs for recent changes"* |
| **Pre-commit audit, type-check (`svelte-check`), a11y audit** | **`sdlc-quality-gate`** | *"Run quality gate checks"* |
| **Bump SemVer, generate `CHANGELOG.md`, cut GitHub Release** | **`sdlc-release-changelog`** | *"Cut a release vX.Y.Z"* |
| **Explore help, cheat sheets, or run tool diagnostics** | **`sdlc-help`** | *"Show SDLC guide / run diagnostics"* |

---

## ⚡ Parallel Execution Strategies

```
      ┌─────────── Specification Contract (sdlc-feature-spec) ───────────┐
      │                                                                  │
      ▼                                                                  ▼
┌─────────────────────────┐   ┌───────────────────────────┐   ┌───────────────────────────┐
│ Track A: Implementation │   │ Track B: Test Engineering │   │ Track C: Technical Docs   │
│ (sdlc-tdd-implement)    │   │ (sdlc-test-coverage)      │   │ (sdlc-docs-wiki)          │
└─────────────────────────┘   └───────────────────────────┘   └───────────────────────────┘
      │                                     │                                     │
      └─────────────────────────────────────┼─────────────────────────────────────┘
                                            ▼
                               Quality Gate & Audit
                               (sdlc-quality-gate)
```

---

## 📋 Copy-Paste Prompt Recipes

### 1. The High-Velocity Parallel Feature Builder Recipe
> *"Use `sdlc-flow` to implement the [Feature/Technique Name] feature in parallel. Establish the specification first, then launch concurrent workers for implementation (`sdlc-tdd-implement`), unit tests (`sdlc-test-coverage`), and documentation (`sdlc-docs-wiki`), merging them at the quality gate."*

### 2. The Multi-Feature Batch Parallel Recipe
> *"We need to add both [Technique A] and [Technique B]. Use `sdlc-flow` to execute both workstreams concurrently in parallel branches, verify both with unit tests, and run a consolidated quality audit."*

### 3. The Autonomous Bug Smasher Recipe
> *"I noticed a bug where [describe bug]. Use `sdlc-flow` to create the GitHub issue, write a reproducing unit test, fix the issue, update tests and wiki, and run quality checks."*

### 4. The Pre-Release Gatekeeper Recipe
> *"Run `sdlc-quality-gate` to verify static typing, accessibility, and audio cleanup. If clean, use `sdlc-release-changelog` to bump the minor version and publish the release."*

---

## 🛠️ Tooling & Health Diagnostics Checklist

1. **Static Analysis & Svelte Compiler**:
   ```bash
   npx svelte-check --tsconfig ./tsconfig.json
   ```
   *Expected: `svelte-check found 0 errors and 0 warnings`.*

2. **GitHub MCP Connectivity**:
   * Verify repository target: `fmatar/breathing-techniques`.
   * Tools available: `issue_write`, `list_issues`, `create_pull_request`.

3. **Subagent & Parallel Worker Capacity**:
   * Verify `invoke_subagent` and `manage_subagents` are ready for concurrent dispatching.

---

## ⏭️ Next Recommended Step

- To start an end-to-end parallel run, invoke **`sdlc-flow`**.
- To scope a specific feature, invoke **`sdlc-feature-spec`**.
- To audit current code quality, invoke **`sdlc-quality-gate`**.
