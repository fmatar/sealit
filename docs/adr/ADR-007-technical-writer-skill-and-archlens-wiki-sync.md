---
id: ADR-007
title: Introduce sdlc-wiki Technical Writer Skill and Deterministic Archlens AST-to-Wiki Synchronization Engine
status: accepted
scope: architectural
ticket: #90
supersedes: CAP-05, CAP-06, CAP-08, CAP-11
createdAt: 2026-10-27T22:50:00.000Z
---

# ADR-007: Introduce `sdlc-wiki` Technical Writer Skill and Deterministic Archlens AST-to-Wiki Synchronization Engine

## 1. Context & Trigger
Under `ADR-002` and `ADR-004`, the legacy `sdlc-docs-wiki` skill was folded into a single manual checklist item inside `sdlc-release`. Without deterministic AST-to-Wiki mapping or automated link/symbol auditing, `wiki/Home.md`, `wiki/Architecture.md`, and `wiki/Traceability.md` drifted from the modular `.agent/scripts/lib/*.mjs` engine, retaining broken script paths and retired skill names.

## 2. Decision
1. **Dedicated `/sdlc-wiki` Skill (1 Router + 9 Verb Skills = 10 Canonical Skills)**:
   - Add `sdlc-wiki` to `CANONICAL_SDLC_SKILLS` in `.agent/scripts/lib/installer.mjs` and route `/sdlc wiki <sync|audit|map>` in `.agent/skills/sdlc/SKILL.md`.
   - Structure `wiki/` around the **Diátaxis** framework (`Home.md`, `Architecture.md`, `Skills-Reference.md`, `Traceability.md`, and `Codebase-Map.md`).
2. **Deterministic Wiki Sync & Audit Engine (`.agent/scripts/lib/wiki-sync.mjs`)**:
   - Implement `inspectSourceModule`, `resolveArchlensRing`, `buildWikiCodeMap`, `auditWiki`, `renderCodebaseMapMarkdown`, and `syncWiki`.
   - Integrate with `.archlens/policy.json` and `recordArchTrace` (`arch-trace.mjs`) to classify modules into Concentric Clean Architecture rings (`Ring 0` through `Ring 3`), calculate coupling/instability ($Ca$, $Ce$, $I$), and track Mermaid diagram diffs in `wiki/Architecture.md` and `wiki/Codebase-Map.md`.
3. **Mandatory Pre-PR & Strict Gate Enforcement**:
   - Enforce `auditWiki` inside `stage pre-pr` (`session.mjs`) and `gate --strict` (`sdlc-engine.mjs`) whenever a `wiki/` directory exists in the workspace.

## 3. Consequences
- **Positive**: 100% of engine libraries (`.agent/scripts/lib/*.mjs`), canonical skills, `CAP-XX` capabilities, and `ADR-00X` decisions are deterministically mapped to `wiki/` and verified on every PR gate.
