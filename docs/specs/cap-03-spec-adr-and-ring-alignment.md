# CAP-03: Spec, ADR & Concentric Ring Alignment

- **Capability ID**: `CAP-03`
- **Governing Module**: `.agent/scripts/lib/drift.mjs` (Ring 1)
- **Enforced Invariants**: `INV-02`, `INV-03`

## 1. Inputs
- Commit-sourced `ChangeSet` (`diff-tree` + `cat-file --batch` for authoritative `gate`/`pre-push`) or working-tree `ChangeSet` (`diff-index` + untracked files for advisory `sdlc drift`) between `mergeBase` (`develop` or `main`) and target across `PRODUCT.md`, `docs/PRD.md`, `docs/SRS.md`, `docs/specs/*.md`, `.archlens/policy.json`, structural dependency manifests, schemas (`.sql`, `.graphql`, `.proto`, `schema.prisma`), and OpenAPI/Swagger contracts.
- Architectural Decision Records in `docs/adr/ADR-*.md` (checked against base ADRs for `ADR_MUTATION` and `ADR_ID_COLLISION`) and source modules governed by `.archlens/policy.json`.

## 2. Domain Rules
1. **Universal ADR Approval Gate (`INV-03`)**: All ADRs created via `adr create` start in `pending_approval` regardless of scope (`technical`, `architectural`, `product`, `contract`). Only ADRs transitioned to `accepted` via `adr decide --status approve` satisfy `checkSpecDrift`.
2. **Structural Manifest & OpenAPI Precision**: `package.json` version/description/script edits do not trigger false dependency drift; structural dependency/workspace mutations and OpenAPI/schema edits require an `accepted` ADR, and malformed OpenAPI JSON/YAML fails closed.
3. **Concentric Ring & Cycle Governance**: `checkArchRings` parses static ESM/CJS imports and string-literal dynamic `import('...')` calls (after stripping comments/strings without regex corruption of URLs), enforcing inward-only dependencies and zero inter-module cycles across `.archlens/policy.json` rings.
4. **Cryptographic Alignment Hashes**: `computeAlignmentHashes` computes deterministic SHA-256 `specHash` and `adrHashes` bound into every Stage 7 merge receipt.

## 3. Outputs & Acceptance Criteria
- `sdlc drift` exits `0` when aligned or accompanied by an `accepted` ADR, and exits `1` when unapproved or missing ADRs exist.
- `checkArchRings` reports `passed: true` with `0` inward violations and `0` cycles.
