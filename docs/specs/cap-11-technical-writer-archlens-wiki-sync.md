# 📋 Capability Specification: `CAP-11` — Technical Writer Skill (`sdlc-wiki`) & Archlens AST-to-Wiki Synchronization

> **Governed by**: `PRODUCT.md` & `ADR-007`  
> **Status**: `AMENDED (ADR-007)`  
> **Depends On**: `CAP-03`, `CAP-05`, `CAP-08`

---

## 1. PRD Slice: Problem Alignment & Scope
Manual wiki checklists inside `sdlc-release` caused `wiki/*.md` documentation to drift from actual AST module exports, CLI subcommands, and Clean Architecture rings. `CAP-11` introduces the dedicated `/sdlc-wiki` Technical Writer skill and the deterministic `.agent/scripts/lib/wiki-sync.mjs` engine (`sdlc-engine.mjs wiki <sync|audit|map>`) integrated with `.archlens/policy.json` and pre-PR/strict quality gates.

---

## 2. Functional Requirements (IEEE 29148 SRS)
- **REQ-11.1 (AST & Ring Inventory)**: The engine SHALL inspect all source modules (`.agent/scripts/lib/*.mjs`, `sdlc-engine.mjs`, and polyglot `src/` directories), extract exported symbols with line numbers, compute Afferent ($Ca$), Efferent ($Ce$), and Instability ($I$) metrics, and classify modules into `.archlens/policy.json` Concentric Clean Architecture rings.
- **REQ-11.2 (Deterministic Codebase Map)**: Running `node .agent/scripts/sdlc-engine.mjs wiki sync` SHALL generate `wiki/Codebase-Map.md` containing a Mermaid concentric ring graph, per-ring AST export tables, canonical skill references, `CAP-XX` capabilities, and `ADR-00X` records.
- **REQ-11.3 (Zero-Rot Wiki Linter)**: Running `node .agent/scripts/sdlc-engine.mjs wiki audit` SHALL scan all `wiki/*.md` files for broken repository file paths (`BROKEN_CODE_PATH`), active references to retired skills (`DEPRECATED_SKILL_REF`), undocumented canonical skills (`UNDOCUMENTED_SKILL`), unmapped engine modules (`UNMAPPED_SOURCE_MODULE`), and malformed Mermaid diagrams (`INVALID_MERMAID_DIAGRAM`).
- **REQ-11.4 (Gate Enforcement)**: `executeCompositeStage({ action: 'pre-pr' })` and `runCLI(['gate', '--strict'])` SHALL execute `auditWiki()` and block PR gate receipts when `wiki/` contains broken paths or unmapped modules.
