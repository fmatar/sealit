---
name: sdlc-test-coverage
description: Stack-aware unit and integration test runner enforcing >= 90% line and branch coverage on modified lines across Quarkus backend (JaCoCo) and Svelte 5 frontend (Vitest).
version: 2.0.0
license: Apache 2.0
allowed-tools: run_command, view_file, write_to_file, replace_file_content
---

# SDLC Testing & Test Coverage Skill (`sdlc-test-coverage`)

Use this skill when writing unit and integration tests, auditing test coverage, and validating zero-regression stability across the application.

---

## 🎯 Testing Architecture & Minimum Coverage Threshold

| Stack Tier | Tooling | Target Directory | Minimum Coverage Threshold |
| :--- | :--- | :--- | :--- |
| **Backend API & Core** | JUnit 5, RestAssured, JaCoCo | `src/main/java/` (Quarkus) | **$\ge$ 90% Line & Branch Coverage** |
| **Frontend State & Runes** | Vitest | `src/lib/stores/`, `src/lib/state/` | **$\ge$ 90% Line & Branch Coverage** |
| **Frontend Components & UI** | Vitest, Testing Library | `src/lib/components/` | **$\ge$ 85% Line Coverage** |
| **End-to-End User Flows** | Playwright | `tests/e2e/` | Happy paths, auth, core interactions |

> [!IMPORTANT]
> **Strict Diff Coverage Requirement**: All net-new and modified lines in the git diff (`git diff --name-only main`) must achieve **$\ge$ 90% test coverage**.

---

## 🛠️ Execution & Automated Coverage Loop

### 1. Identify Modified Files
```bash
git diff --name-only main
```

### 2. Backend Execution (Quarkus / Java)
```bash
./mvnw clean test jacoco:report
```
- Parse the generated JaCoCo coverage summary: `target/site/jacoco/index.html` or `target/site/jacoco/jacoco.csv`.
- Inspect missed branches and lines specifically for modified classes.

### 3. Frontend Execution (Svelte 5 / TypeScript)
```bash
npm run test:coverage
```
- Parse the generated Vitest coverage summary: `coverage/index.html` or terminal coverage summary table.

### 4. Automated Feedback Loop
If coverage on changed lines is below **90%**:
1. Identify exact uncovered methods, branches, or boundary conditions.
2. Automatically write corresponding unit/integration test cases.
3. Re-run test suites until coverage passes the $\ge$ 90% threshold.

---

## 📋 Example Svelte 5 Store Test (Vitest)

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { UserSessionState } from '$lib/state/session.svelte';

describe('UserSessionState Runes', () => {
  let session: UserSessionState;

  beforeEach(() => {
    session = new UserSessionState();
  });

  it('correctly updates state and computes derived properties', () => {
    expect(session.isAuthenticated).toBe(false);
    session.setToken('jwt-token-xyz');
    expect(session.isAuthenticated).toBe(true);
    expect(session.token).toBe('jwt-token-xyz');
  });

  it('handles logout and cleans sensitive state', () => {
    session.setToken('jwt-token-xyz');
    session.logout();
    expect(session.isAuthenticated).toBe(false);
    expect(session.token).toBeNull();
  });
});
```

---

## ⏭️ Next Recommended Step

Once unit/integration tests pass and meet the 90% coverage threshold:
👉 **Transition to [`sdlc-docs-wiki`](../sdlc-docs-wiki/SKILL.md)** to synchronize documentation, `CHANGELOG.md`, and architectural specs.
