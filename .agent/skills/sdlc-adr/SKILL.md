---
name: sdlc-adr
description: "Use when changing PRODUCT.md, docs/specs/, .archlens/policy.json, dependencies, schemas, or API contracts, or when sdlc drift fails. Not for routine code edits."
tools: read_file, write_file, edit_file, run_command
---

# Architecture Decision Records & Drift Alignment (`sdlc-adr`)

## When to use / When NOT to use
- **Use when** `sdlc drift` reports undeclared drift or before modifying `PRODUCT.md`, `docs/PRD.md`, `docs/SRS.md`, `docs/specs/*.md`, `.archlens/policy.json`, structural manifest dependencies (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `pom.xml`), DB schemas, or OpenAPI/GraphQL/Protobuf contracts.
- **Not for** internal bug fixes, refactors within existing ring boundaries, or non-structural `package.json` metadata edits (`version`, `scripts`, `files`).

## Steps

```bash
# 1. Inspect spec, dependency, contract, and ring drift
node .agent/scripts/sdlc-engine.mjs drift

# 2. Create a pending ADR in docs/adr/
node .agent/scripts/sdlc-engine.mjs adr create \
  --title "<Short Decision Title>" \
  --scope <technical|architectural|product|contract> \
  --ticket <id> \
  --supersedes "<CAP-XX or ADR-00X>" \
  --context "<Trigger & options considered>" \
  --decision "<Chosen design>" \
  --consequences "<Trade-offs & reversal criteria>"

# 3. After explicit user approval, record decision
node .agent/scripts/sdlc-engine.mjs adr decide \
  --id ADR-00X \
  --status approve \
  --by "@reviewer" \
  --reason "<rationale>"
```

## Confirm with user before
- Running `adr decide --status approve` on any ADR (`pending_approval` requires explicit human sign-off).

## Done when
`node .agent/scripts/sdlc-engine.mjs drift` exits `0` with `0` unapproved ADRs or ring violations.
