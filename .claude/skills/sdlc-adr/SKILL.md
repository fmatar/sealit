---
name: sdlc-adr
description: Use when changing PRODUCT.md, docs/specs/, dependencies, schemas, or API contracts, or when drift check fails. Not for routine code edits without spec or dependency drift.
allowed-tools: Read, Write, Edit, Bash
---

# Architecture Decision Records & Spec-Drift Sentinel (`sdlc-adr`)

## When to use / When NOT to use
- **Use when** `drift check` reports undeclared drift or before modifying `PRODUCT.md`, `docs/PRD.md`, `docs/SRS.md`, `docs/specs/*.md`, dependency sections in manifests (`package.json`, `pom.xml`, `pyproject.toml`, `go.mod`, `Cargo.toml`), DB migrations/`.sql`, C4 `.mmd` diagrams, or OpenAPI/GraphQL contracts.
- **Not for** internal code refactors, bug fixes within existing specs, or non-structural `package.json` metadata edits (`version`, `scripts`, `files`, `description`), which `drift check` automatically exempts.

## Lane behavior
| Lane | ADR requirement |
| :--- | :--- |
| `trivial` / `standard` | `0` drift triggers expected (`drift check` passes without a new ADR). Any drift trigger automatically escalates the change to `full`. |
| `full` | Every spec, dependency, schema, or contract trigger must be paired with an `accepted` ADR in `docs/adr/ADR-00X-*.md` linked to the active ticket. |

## Steps

```bash
# 1. Detect spec, structural dependency, schema, or contract drift
node .agent/scripts/sdlc-engine.mjs drift check

# 2. Mint an ADR (all scopes start in `pending_approval` until reviewed)
node .agent/scripts/sdlc-engine.mjs adr create \
  --title "<Decision Title>" \
  --scope <technical|architectural|product|contract> \
  --ticket <id> \
  --supersedes "<CAP-XX or ADR-00X>" \
  --context "<Problem & options considered>" \
  --decision "<Chosen design & reversal criteria>" \
  --consequences "<Trade-offs & downstream impact>"

# 3. List ADRs or record explicit human decision (`approve` | `reject`)
node .agent/scripts/sdlc-engine.mjs adr list
node .agent/scripts/sdlc-engine.mjs adr decide --id ADR-00X --status <approve|reject> --by "@reviewer" --reason "<rationale>"

# 4. Sync the Causal Decision Graph (docs/DECISION_MAP.md)
node .agent/scripts/sdlc-engine.mjs decision-graph sync

# 5. Preview or compact accepted ADRs into docs/SRS.md during release cuts
node .agent/scripts/sdlc-engine.mjs adr compact --release <vX.Y.Z> --dry-run
```

## ⚠️ Confirm with user before
- Running `adr decide --status approve` on any ADR (`technical`, `architectural`, `product`, and `contract` ADRs all start in `pending_approval` and require explicit human sign-off).
- Running `adr compact` without `--dry-run` outside a release branch.

## If it fails
- **`drift check` still fails after `adr create`** -> ensure `--ticket <id>` matches the active session's `issueId` and the ADR status is `accepted` (not `pending_approval`).
- **`adr compact` aborts on pending ADR** -> resolve or decide all `pending_approval` ADRs first.

## Done when
`node .agent/scripts/sdlc-engine.mjs drift check` exits `0` and `docs/DECISION_MAP.md` is synchronized.
