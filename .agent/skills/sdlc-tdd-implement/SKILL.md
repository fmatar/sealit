---
name: sdlc-tdd-implement
description: Guides test-driven and clean-code feature development using Robert C. Martin's Three Laws of TDD, Transformation Priority Premise (TPP), Svelte 5 Runes ($state, $derived, $effect), and Quarkus Java 25 reactive programming.
version: 3.0.0
license: Apache 2.0
allowed-tools: run_command, view_file, write_to_file, replace_file_content
---

# SDLC TDD & Clean Code Implementation Skill (`sdlc-tdd-implement`)

Use this skill when implementing new features, backend services, UI components, or refactoring existing code across full-stack applications. This skill strictly enforces **Robert C. Martin's (Uncle Bob)** software craftsmanship, the **Three Laws of TDD**, the **Transformation Priority Premise (TPP)**, and the elimination of test waste.

---

## 📜 Robert C. Martin's Three Laws of TDD

TDD is a disciplined rhythm with a feedback cycle measured in seconds, not hours:

1. **First Law**: *You may not write any production code until you have written a failing unit test.*
2. **Second Law**: *You may not write more of a unit test than is sufficient to fail; and not compiling is failing.*
3. **Third Law**: *You may not write more production code than is sufficient to pass the currently failing test.*

The cycle: **Red $\rightarrow$ Green $\rightarrow$ Refactor**. Refactoring is not an optional afterthought; it is the phase where duplicate code is eliminated and design is cleaned while all tests are green.

---

## 🧭 The Transformation Priority Premise (TPP)

Uncle Bob's TPP establishes that *as the tests get more specific, the code gets more generic*. Guide algorithm implementation using the lowest-priority transformations first:

$$\begin{aligned}
\text{1. } & (\{ \} \rightarrow \text{nil}) & \text{None to null} \\
\text{2. } & (\text{nil} \rightarrow \text{constant}) & \text{Return a hardcoded value} \\
\text{3. } & (\text{constant} \rightarrow \text{scalar}) & \text{Substitute constant with variable/parameter} \\
\text{4. } & (\text{statement} \rightarrow \text{statements}) & \text{Add simple linear sequence} \\
\text{5. } & (\text{unconditional} \rightarrow \text{conditional}) & \text{Introduce if-statement for boundary} \\
\text{6. } & (\text{scalar} \rightarrow \text{collection}) & \text{Generalize variable into list/array} \\
\text{7. } & (\text{statement} \rightarrow \text{recursion / loop}) & \text{Iterate over collection}
\end{aligned}$$

Never jump immediately to complex loops or recursion before simpler scalar or conditional transformations pass the test.

---

## ⚖️ Useful Tests vs. Useless Tests Heuristics

Test code is a **first-class citizen** with the same maintenance cost as production code. Writing low-value tests creates a brittle test suite that discourages refactoring.

```mermaid
flowchart TD
    subgraph Useful["✅ ESSENTIAL TESTS (Write These)"]
        U1["Business Invariants & Domain Rules"]
        U2["Boundary Conditions (0, -1, empty, max limits)"]
        U3["State Transitions & Teardown"]
        U4["Public API Contracts (Use Cases / Ports)"]
        U5["Negative Paths & Exception Handling"]
    end

    subgraph Useless["❌ TEST SMELLS (Reject & Delete These)"]
        W1["Trivial Getters, Setters & Java Records"]
        W2["Framework / Library Plumbing ('Don't test code you didn't write')"]
        W3["Mock-Obsessed Interaction Verification (Checking internal step order)"]
        W4["Tautological Tests (Tests repeating production formulas)"]
        W5["Assert-Free Coverage Stunts ('assertDoesNotThrow' without state check)"]
    end
```

### Forbidden Anti-Patterns:
- **Don't Test Code You Didn't Write**: Do not write tests verifying that Quarkus Panache persists to SQL or that Svelte 5 `$state` triggers reactivity. The framework developers already tested that.
- **No Getter/Setter Tests**: Never write unit tests for plain DTOs or Java records without custom logic.
- **Avoid Mock Abuse**: Mocking is only for external architectural boundaries (databases, third-party REST APIs, message brokers, system clock). Never mock internal domain entities or collaborators—test state and behavior, not mechanical method calls.
- **Single Concept per Test**: Never write "Grand Tour" monster tests that test 10 unrelated scenarios in one method. If step 2 fails, the remaining 8 never run.

---

## ⚡ F.I.R.S.T. Test Harness Architecture

Every test written must adhere to Uncle Bob's **F.I.R.S.T.** rules:
- **Fast**: Millisecond execution. Use in-memory mocks only at I/O boundaries.
- **Independent**: Tests must never depend on the execution order of previous tests. Use dynamic port isolation (`quarkus.http.test-port=0`) and clean database transactions (`@TestTransaction`).
- **Repeatable**: Deterministic in any environment (local, CI, container) without network dependencies.
- **Self-Validating**: Exactly one boolean result (Pass or Fail) with expressive assertions.
- **Timely**: Authored immediately before the code that makes it pass.

---

## 💎 Full-Stack Engineering Standards

### 1. Svelte 5 Runes & Reactivity (Frontend)
- **State**: Use `$state()` for reactive data structures.
- **Derived**: Use `$derived()` or `$derived.by()` for pure computed values. Never manually sync state.
- **Side Effects**: Use `$effect()` exclusively for external integration (DOM, canvas, timers). Teardown returned functions are mandatory.
- **Props**: Use `$props()` with strict TypeScript interfaces.

```svelte
<script lang="ts">
  interface Props {
    itemId: string;
    isActive?: boolean;
    onSelect?: (id: string) => void;
  }

  let { itemId, isActive = false, onSelect }: Props = $props();
  let interactionCount = $state<number>(0);
  let isHighlighted = $derived<boolean>(isActive && interactionCount > 0);

  function handleClick() {
    interactionCount++;
    onSelect?.(itemId);
  }
</script>

<button class="btn" class:active={isHighlighted} onclick={handleClick}>
  <slot />
</button>
```

### 2. Quarkus & Java 25 Reactive Standards (Backend)
- **Modern Syntax**: Records, sealed interfaces, pattern matching, virtual threads.
- **Reactive Streams**: Mutiny (`Uni<T>`, `Multi<T>`). No blocking calls on reactive event loops.
- **Clean Architecture Boundaries**: Implement business logic in domain services/use cases; decouple database Panache queries into repository ports.

```java
@ApplicationScoped
public class OrderService {

    @WithTransaction
    public Uni<OrderResponse> processOrder(CreateOrderCommand cmd) {
        // Business invariant check (Essential test candidate)
        if (cmd.amount() <= 0) {
            return Uni.createFrom().failure(new IllegalArgumentException("Order amount must be positive"));
        }

        return OrderEntity.<OrderEntity>findByOrderNumber(cmd.orderNumber())
            .onItem().ifNotNull().failWith(() -> new DuplicateOrderException(cmd.orderNumber()))
            .replaceWith(() -> OrderEntity.createNew(cmd))
            .flatMap(OrderEntity::persistAndFlush)
            .map(OrderResponse::from);
    }
}
```

---

## 🛠️ Step-by-Step TDD Workflow

1. **Review Specification Contract**: Load the RFC / Issue generated by `sdlc-feature-spec`.
2. **Write Failing Test First (First Law)**:
   - Formulate test for the simplest degenerate case (TPP step 1 & 2).
   - Ensure the test fails for the expected reason (or fails compilation).
3. **Write Minimum Production Code (Third Law)**:
   - Provide minimal logic to make the test pass.
4. **Refactor**:
   - Clean up naming, extract methods, eliminate duplication.
5. **Next TPP Iteration**:
   - Add next test driving from scalar to boundary condition to generalization.
6. **Static Verification**:
   - Frontend: `npx svelte-check --tsconfig ./tsconfig.json`
   - Backend: `./mvnw compile`

---

## ⏭️ Next Recommended Step

Once implementation passes initial TDD checks:
👉 **Transition to [`sdlc-test-coverage`](../sdlc-test-coverage/SKILL.md)** to enforce the **Dual-Gate Threshold** ($\ge 85\%$ diff coverage AND $\ge 80\%$ mutation kill score).
