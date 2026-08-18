---
name: sdlc-test-coverage
description: Configures, writes, and runs unit tests, store tests, component tests, and E2E tests using Vitest and Playwright, while enforcing test coverage metrics (@vitest/coverage-v8) and edge-case regression validation.
version: 1.1.0
license: Apache 2.0
---

# SDLC Testing & Test Coverage Skill (`sdlc-test-coverage`)

Use this skill when writing unit tests, adding integration tests, auditing test coverage, or validating zero-regression stability across the The Project application.

---

## 🎯 Testing Architecture & Coverage Goals

| Tier | Tooling | Target Area | Minimum Coverage Threshold |
| :--- | :--- | :--- | :--- |
| **Unit & Math** | Vitest | `src/lib/geometry/`, math helpers, polygon insets | **90%+ Statements / Branches** |
| **State & Stores** | Vitest | `src/lib/stores/`, session timing, streak counters | **85%+ Statements / Branches** |
| **Audio Synthesis** | Vitest (Mocked AudioContext) | `src/lib/audio/`, tone frequencies, envelopes | **80%+ Statements** |
| **E2E & UI** | Playwright / Chrome DevTools | User flows, Zen mode, keyboard shortcuts, canvas rendering | Core happy paths & responsive |

---

## 🛠️ Vitest Configuration & Execution

### Running Tests
```bash
# Run unit tests in watch mode
pnpm test

# Run unit tests once (CI mode)
pnpm test:run

# Run tests with test coverage report
pnpm test:coverage
```

### Writing Math / Geometry Unit Tests
Example test for parametric polygon generation:
```typescript
import { describe, it, expect } from 'vitest';
import { generatePolygonPoints, insetPolygon } from '$lib/geometry/polygons';

describe('Geometry Engine: Polygon Insets', () => {
  it('generates correct vertex count for regular hexagon', () => {
    const points = generatePolygonPoints(6, 100, 100, 50);
    expect(points).toHaveLength(6);
  });

  it('correctly calculates parallel inner inset path without self-intersection', () => {
    const original = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 86.6 }];
    const insets = insetPolygon(original, 5);
    expect(insets).toHaveLength(original.length);
  });
});
```

### Writing Svelte 5 Store Unit Tests
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionStore } from '$lib/stores/session.svelte';

describe('SessionStore Reactive Runes', () => {
  let session: SessionStore;

  beforeEach(() => {
    session = new SessionStore();
  });

  it('advances breath phases smoothly upon timer trigger', () => {
    expect(session.currentPhaseIndex).toBe(0);
    session.advancePhase();
    expect(session.currentPhaseIndex).toBe(1);
  });
});
```

---

## 📋 Coverage Verification Checklist

1. **Math Precision**: Boundary conditions (0, negative values, extreme aspect ratios, float precision).
2. **Phase Transitions**: Handling last-phase $\rightarrow$ first-phase loop cycles without index out-of-bounds.
3. **Audio Node Lifecycle**: Ensuring audio context disconnects cleanly during component unmount to prevent memory leaks.
4. **LocalStorage Persistence**: Mocking `localStorage` for streaks and mindful practice minutes.
5. **Coverage Report Generation**: Verify that running `pnpm test:coverage` outputs an HTML or text table meeting project thresholds.

---

## ⏭️ Next Recommended Step

Once unit/integration tests pass and meet coverage thresholds:
👉 **Transition to [`sdlc-docs-wiki`](../sdlc-docs-wiki/SKILL.md)** to update product documentation, `/wiki` deep-dives, and README with the verified changes.
