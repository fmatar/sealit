---
name: sdlc-wiki
description: Use when scaffolding or auditing README.md, llms.txt, or wiki/*.md architecture docs. Not for routine code changes with no public API, CLI, or architecture impact.
allowed-tools: Read, Write, Edit, Bash
---

# 10-30-90 README & Repo-Agnostic Wiki Sync (`sdlc-wiki`)

## When to use / When NOT to use
- **Use when** creating or updating `README.md`, `llms.txt`, or `wiki/*.md` pages, or syncing AST exports and Clean Architecture ring maps after public API/module changes.
- **Not for** internal bug fixes or private implementation edits that do not alter exported signatures, CLI flags, or architecture rings.

## Lane behavior
| Lane | Documentation commands |
| :--- | :--- |
| `trivial` | Typo/link fix in an existing doc -> run only `readme audit --strict` (if `README.md` changed) or `wiki audit --strict` (if `wiki/` changed). |
| `standard` / `full` | New/changed exports, CLI flags, or rings -> run `wiki sync`, update affected prose, then run `readme audit --strict` and `wiki audit --strict`. |

## Steps

```bash
# 1. Scaffold 10-30-90 README.md (governed by docs/templates/README_TEMPLATE.md), logo SVGs & llms.txt
node .agent/scripts/sdlc-engine.mjs readme init --archetype <auto|cli|sdk|platform> --hook "<One-sentence hook>"

# 2. Inspect live AST exports, Ca/Ce/I coupling, and .archlens/policy.json rings for THIS repository
node .agent/scripts/sdlc-engine.mjs wiki map

# 3. Sync wiki/Codebase-Map.md (pass --init only when bootstrapping missing wiki/*.md pages)
node .agent/scripts/sdlc-engine.mjs wiki sync

# 4. Enforce 10-30-90 README rules and zero-rot wiki path/Mermaid checks
node .agent/scripts/sdlc-engine.mjs readme audit --strict
node .agent/scripts/sdlc-engine.mjs wiki audit --strict
```

## Repo-Agnostic Grounding Rules
1. **Derive Structure from Disk**: Read layer names and paths from `.archlens/policy.json`, exported symbols from `wiki map`, and capabilities/ADRs from `PRODUCT.md` and `docs/adr/` — never hardcode another repository's ring names, scripts, or skill lists.
2. **Follow `README_TEMPLATE.md` Without Copying**: `readme audit --strict` enforces badge caps (`<= 4`), package-first Quickstarts (no `git clone` lead), neutral Mermaid (`%%{init: {'theme': 'neutral'}}%%`), `<details>` disclosure, and valid local links.
3. **Valid Mermaid & Paths**: Quote node labels containing parentheses (`Node["Label (Info)"]`) and reference only paths that exist in the target repository.

## ⚠️ Confirm with user before
- Running `readme init --force` (overwrites an existing `README.md`) or `wiki sync --init` in a repository that does not yet track a `wiki/` directory.

## If it fails
- **`BROKEN_CODE_PATH` or `UNMAPPED_MODULE` in `wiki audit --strict`** -> run `wiki sync` and fix or remove stale backticked paths.
- **`readme audit --strict` error** -> align the flagged section with `docs/templates/README_TEMPLATE.md` and re-run `readme audit --strict`.

## Done when
`readme audit --strict` and `wiki audit --strict` (when `wiki/` exists) exit `0` with `0` errors.
