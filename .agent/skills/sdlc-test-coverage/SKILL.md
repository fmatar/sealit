---
name: sdlc-test-coverage
description: Stack-aware unit, integration, and mutation test runner enforcing Dual-Gate quality (>= 85% diff coverage AND >= 80% mutation kill score via PITest & Stryker) adhering to Robert C. Martin testing principles.
version: 3.0.0
license: Apache 2.0
allowed-tools: run_command, view_file, write_to_file, replace_file_content
---

# SDLC Testing, Coverage & Mutation Defense Skill (`sdlc-test-coverage`)

Use this skill when writing unit and integration tests, auditing test coverage, running mutation testing, and validating zero-regression stability across the application. This skill enforces **Robert C. Martin's (Uncle Bob)** testing craftsmanship: tests are first-class citizens designed to assert behavior, not merely execute lines.

---

## 🎯 Dual-Gate Quality Architecture

A high line coverage number without assertion density is a vanity metric ("tests that run code without verifying outcomes"). To ensure tests genuinely defend against defects, this skill enforces a **Dual-Gate Quality Threshold**:

| Stack Tier | Tooling | Target Scope | Dual-Gate Threshold |
| :--- | :--- | :--- | :--- |
| **Backend API & Core** | JUnit 5, JaCoCo, **PITest** | `src/main/java/` (Quarkus) | **$\ge$ 85% Line/Branch Diff Coverage**<br/>**$\ge$ 80% Mutation Kill Score** |
| **Frontend State & Runes** | Vitest, **Stryker Mutator** | `src/lib/stores/`, `src/lib/state/` | **$\ge$ 85% Line/Branch Diff Coverage**<br/>**$\ge$ 80% Mutation Kill Score** |
| **Frontend UI Components** | Vitest, Testing Library | `src/lib/components/` | **$\ge$ 80% Line Coverage** |
| **End-to-End User Flows** | Playwright | `tests/e2e/` | Happy paths, auth, core user journeys |

> [!IMPORTANT]
> **The Dual-Gate Invariant**:
> 1. **Diff Coverage ($\ge 85\%$)**: All net-new and modified lines in the git diff (`git diff --name-only main`) must achieve $\ge 85\%$ line and branch coverage. The 85% target eliminates the pressure to test trivial getters, setters, and record fields.
> 2. **Mutation Kill Score ($\ge 80\%$)**: Mutants injected into modified classes (inverting conditionals, mutating arithmetic, stripping void calls) must be killed by the test suite. A surviving mutant means your test executed the code without asserting its behavior.

---

## 🛠️ Execution & Automated Feedback Loop

### 1. Universal Execution (Polyglot / Multi-Module)
The universal engine automatically detects modified files and routes execution to the appropriate language toolchain:
```bash
# Run diff coverage gate across touched modules
node .agent/scripts/sdlc-engine.mjs coverage

# Run mutation defense across touched modules
node .agent/scripts/sdlc-engine.mjs mutation
```

### 2. Manual / Stack-Specific Execution

#### Run Unit & Integration Coverage (JaCoCo):
```bash
./mvnw clean test jacoco:report
```
- Parse the generated JaCoCo coverage summary: `target/site/jacoco/index.html` or `target/site/jacoco/jacoco.csv`.
- Inspect missed branches and lines specifically for modified classes.

#### Run Mutation Testing (PITest):
```bash
./mvnw test-compile org.pitest:pitest-maven:mutationCoverage -DmutationThreshold=80
```
- Parse the generated PITest report in `target/pit-reports/index.html`.
- For fast iterative runs scoped to modified files:
  ```bash
  ./mvnw test-compile org.pitest:pitest-maven:mutationCoverage -DtargetClasses="com.example.service.*"
  ```

### 3. Frontend Coverage & Mutation Execution (Svelte 5 / TypeScript)

#### Run Coverage (Vitest):
```bash
npm run test:coverage
```
- Parse the generated Vitest coverage summary: `coverage/index.html` or terminal table.

#### Run Mutation Testing (Stryker):
```bash
npx stryker run
```
- For fast iterative runs scoped to changed files:
  ```bash
  npx stryker run --mutate "src/lib/state/session.svelte.ts"
  ```
- Parse the Stryker HTML report in `reports/mutation/mutation.html`.

---

## 🧬 How to Diagnose and Kill Surviving Mutants

When PITest or Stryker reports a **surviving mutant**, it means a deliberate defect was introduced and your test suite still passed. Common mutant survival causes and fixes:

1. **Condition Boundary Mutation (`<` changed to `<=`)**:
   - *Cause*: Missing boundary test case.
   - *Fix*: Add a test specifically for the boundary value (e.g. testing `limit == 100`, not just `limit == 50` and `limit == 150`).
2. **Void Method Call Removed (e.g. `auditLogger.log()` or `eventPublisher.publish()` deleted)**:
   - *Cause*: Test didn't assert side effects or emitted domain events.
   - *Fix*: Assert state change or verify the event dispatch boundary.
3. **Return Value Mutated (e.g. `return total` mutated to `return 0` or `return null`)**:
   - *Cause*: Test executed the method without asserting the returned value (`assertDoesNotThrow` anti-pattern).
   - *Fix*: Assert the exact expected return value and shape.
4. **Negated Conditional (`if (isValid)` changed to `if (!isValid)`)**:
   - *Cause*: Only tested the happy path, omitted the negative/failure path.
   - *Fix*: Add test for invalid input triggering expected exception or error state.

---

## 📋 Clean Test Example: Svelte 5 Runes with Mutation Defense

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { UserSessionState } from '$lib/state/session.svelte';

describe('UserSessionState Runes (Uncle Bob Clean Test)', () => {
  let session: UserSessionState;

  beforeEach(() => {
    session = new UserSessionState();
  });

  // Single concept: Default unauthenticated state
  it('initializes with unauthenticated default state and null token', () => {
    expect(session.isAuthenticated).toBe(false);
    expect(session.token).toBeNull();
  });

  // Single concept: Authentication transition
  it('transitions to authenticated state when a valid token is set', () => {
    session.setToken('jwt-token-xyz');
    expect(session.isAuthenticated).toBe(true);
    expect(session.token).toBe('jwt-token-xyz');
  });

  // Boundary condition: Rejects whitespace or empty token (Kills empty-string mutant)
  it('throws an error and remains unauthenticated when token is empty or whitespace', () => {
    expect(() => session.setToken('   ')).toThrow('Token cannot be blank');
    expect(session.isAuthenticated).toBe(false);
  });

  // Single concept: Clean logout teardown
  it('cleans token and resets authenticated state upon logout', () => {
    session.setToken('jwt-token-xyz');
    session.logout();
    expect(session.isAuthenticated).toBe(false);
    expect(session.token).toBeNull();
  });
});
```

---

## ⏭️ Next Recommended Step

Once unit/integration tests pass and meet the **Dual-Gate Threshold** ($\ge 85\%$ diff coverage AND $\ge 80\%$ mutation kill score):
👉 **Transition to [`sdlc-docs-wiki`](../sdlc-docs-wiki/SKILL.md)** to synchronize documentation, `CHANGELOG.md`, and architectural specs.
