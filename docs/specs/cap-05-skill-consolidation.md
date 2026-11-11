# SPEC-05: Consolidate 14 Skills into 6 Schema-Valid Core Skills (`CAP-05`)

- **Linked Capability**: `CAP-05`
- **Status**: `ACTIVE`
- **Depends On**: `CAP-03`, `CAP-04`

## 1. Problem Statement & Motivation
The `.agent/skills/` directory contained 14 separate skills totaling ~2,300 lines of prompt instructions with:
- Non-existent tool names in YAML frontmatter (`view_file`, `write_to_file`, `replace_file_content` instead of `read_file`, `write_file`, `edit_file`).
- Invalid `invoke_subagent` tool schemas (`{ "Subagents": [...] }` wrapper and `TypeName: "self"` instead of parallel `invoke_subagent` calls with `TypeName: "research"`).
- Hardcoded domain requirements from another project ("BYOA Contract", "Polyglot Archetypes Matrix", "Quarkus Java 25").
- Heavy duplication across `sdlc-tdd-implement` / `sdlc-test-coverage`, `sdlc-peer-review` / `sdlc-quality-gate` / `sdlc-analyze`, and `sdlc-docs-wiki` / `sdlc-release-changelog`.

## 2. Domain Contract & Acceptance Criteria
1. **Consolidate to 6 Canonical Skills**:
   - `sdlc-flow` (absorbs `sdlc-kanban` and `sdlc-arch-trace`, uses `sdlc-engine stage <begin|pre-pr|complete>`).
   - `sdlc-product` (absorbs `sdlc-feature-spec` and governs `PRODUCT.md` + topological execution waves).
   - `sdlc-tdd` (merges `sdlc-tdd-implement` + `sdlc-test-coverage`).
   - `sdlc-review-gate` (merges `sdlc-peer-review` + `sdlc-quality-gate` + `sdlc-analyze`).
   - `sdlc-release` (merges `sdlc-docs-wiki` + `sdlc-release-changelog` with zero project-specific baggage).
   - `sdlc-init` (streamlined replacement for `sdlc-initialize`).
2. **Script Relocation & Cleanup**:
   - Relocate `kanban-sync.sh` and `project-setup.sh` to `.agent/scripts/`.
   - Remove the 8 superseded skill directories (`sdlc-analyze`, `sdlc-arch-trace`, `sdlc-docs-wiki`, `sdlc-feature-spec`, `sdlc-help`, `sdlc-initialize`, `sdlc-kanban`, `sdlc-peer-review`, `sdlc-quality-gate`, `sdlc-release-changelog`, `sdlc-tdd-implement`, `sdlc-test-coverage`).
3. **Schema & Tool Validity**:
   - All 6 `SKILL.md` files use `read_file, write_file, edit_file, run_command` and valid `invoke_subagent` parameters.
