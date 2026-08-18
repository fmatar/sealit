---
name: sdlc-feature-spec
description: Generates formal Product Requirements (PRDs), Software Requirements (SRS), C4 Architecture diagrams, ADRs, and GitHub issues for new features.
version: 1.1.0
license: Apache 2.0
---

# SDLC Feature Specification & Architecture Planning Skill (`sdlc-feature-spec`)

Use this skill when initiating new features, major enhancements, epics, or architectural refactors. It enforces rigorous engineering specifications before code is written.

---

## 📋 Core Responsibilities

- Produce **Product Requirements Documents (PRDs)** based on the SVPG standard using `docs/templates/PRD_TEMPLATE.md`.
- Produce **Software Requirements Specifications (SRS)** based on IEEE 29148 using `docs/templates/SRS_TEMPLATE.md`.
- Create **C4 Architecture Diagrams** (Context, Container, Component) using Mermaid.js based on `docs/templates/C4_ARCHITECTURE_TEMPLATE.md`.
- Draft **Architecture Decision Records (ADRs)** for major technical choices using `docs/templates/ADR_TEMPLATE.md`.
- Generate clear user stories and Gherkin-syntax acceptance criteria.
- Create structured GitHub Issues.

---

## 🛠️ Step-by-Step Workflow

### Step 1: Requirements Discovery & Somatic Grounding
- Identify the physiological mechanism and user persona (Beginner, Athletic, Clinical, Insomnia, Meditative).
- For business logic techniques, verify mathematical ratio compatibility (e.g. $T_{in} : T_{hold} : T_{out} : T_{empty}$) and geometric representation (Polygon, Bezier curve, complex feature, Ellipse).
- Verify clean-room IP adherence (17 U.S.C. § 102(b)): ensure generic descriptive naming and avoid registered commercial trademarks (e.g. use "Cyclic Sighing" instead of trademarked programs).

### Step 2: Draft the Technical Specification (RFC)
Structure the specification using this standard schema:

```markdown
# RFC: [Feature Title]

## 1. Problem Statement & User Value
- What user need or clinical gap does this feature address?
- Target personas and use cases.

## 2. Technical Architecture & Data Schema
- Data models to add or modify in `src/lib/data/` or `src/lib/types/`.
- Svelte 5 stores impacted in `src/lib/stores/` (Runes state `$state`, derived properties `$derived`).
- Geometric math algorithms required (e.g., SVG path equations, `insetPolygon` modifications).
- modern web APIs synthesis requirements (frequencies, oscillator types, biquad filter sweeps, panner nodes).

## 3. UI/UX & Responsive Layouts
- Impacted components in `src/lib/components/` and routes in `src/routes/`.
- Theme considerations (Obsidian Dark Mode vs. Paper Light Mode).
- Zen Mode (<kbd>Z</kbd>) integration and keyboard navigation shortcuts.

## 4. Acceptance Criteria (Gherkin Scenarios)
Scenario: Successful execution of new breath cycle
  Given the user selects the technique from the switcher
  When the session timer starts
  Then the focal dot smoothly traverses the geometric perimeter
  And modern web APIs chimes trigger on phase transitions

## 5. Security, Performance & A11y Considerations
- 60fps render budget on mobile Safari & Chromium.
- WCAG 2.1 AA screen reader live region announcements.
- Memory leak prevention (proper disconnect of modern web APIs nodes).
```

### Step 3: ADR Generation (When Applicable)
If the feature alters system architecture (e.g., introducing a new audio engine, routing strategy, or backend sync):
- Create `wiki/ADR-00X-[title].md` following the Michael Nygard format (Title, Status, Context, Decision, Consequences).

### Step 4: GitHub Issue Creation
Use the `github-mcp-server` tool `issue_write` to submit the issue with:
- Clear title: `feat(<scope>): <short description>`
- Well-organized markdown body containing the RFC summary and checklist.
- Appropriate labels: `feature`, `enhancement`, `geometry-engine`, `audio-engine`, `documentation`.

---

## ⏭️ Next Recommended Step

Once the RFC, acceptance criteria, and GitHub Issue are created:
👉 **Transition to [`sdlc-tdd-implement`](../sdlc-tdd-implement/SKILL.md)** to write failing tests and implement the feature in accordance with Svelte 5 and TypeScript conventions.
