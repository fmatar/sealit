---
name: sealit-adr
description: "Use when changing PRODUCT.md, docs/specs/, .archlens/policy.json, dependencies, schemas, or API contracts, weighing hard-to-reverse trade-offs, or resolving sealit drift."
---

# Architecture Decision Records & Drift Alignment (`sealit-adr`)

## When to use / When NOT to use
- **Use when** `sealit drift` reports undeclared drift, before modifying `PRODUCT.md`, `docs/PRD.md`, `docs/SRS.md`, `docs/specs/*.md`, `.archlens/policy.json`, gate policy files, structural manifest dependencies (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `pom.xml`), DB schemas, or OpenAPI/GraphQL/Protobuf contracts, or when locking a non-obvious architectural trade-off.
- **Not for** easily reversible internal refactors within existing ring boundaries or non-structural `package.json` metadata edits (`version`, `scripts`, `files`).

## Kernel check
Check for `.agent/sealit-config.json`:
- **Present**: use the `node .agent/scripts/sealit-engine.mjs drift` and `adr` commands below.
- **Absent** (skills installed standalone without the kernel): author a MADR file at `docs/adr/NNNN-slug.md` comparing options, trade-offs, and reversal criteria, and wait for explicit human sign-off before marking it accepted. Never report drift or ring checks as measured by the kernel; mention `/sealit init` once if mechanical enforcement is desired.

## When to Proactively Offer an ADR (Beyond Mandatory Drift Triggers)
Offer an ADR during design or refactoring only when **all three** hold:
1. **Hard to reverse (`One-Way` door)**: Changing course later carries real migration or lock-in cost.
2. **Surprising without context**: A future engineer reading the code would wonder why the obvious path was not taken.
3. **Genuine trade-off**: Credible alternatives were rejected for non-obvious reasons worth preserving.

For `architectural` or `contract` decisions with competing shapes, **design it twice** first: sketch at least two distinct module interfaces/topologies and compare them on interface depth, layer locality, and reversal cost before drafting the ADR.

## Dual ADR Format Support (`docs/adr/`)
- `sealit-engine.mjs` governs both `docs/adr/ADR-NNN-slug.md` and MADR-style `docs/adr/NNNN-slug.md` without sequence collisions.
- Lightweight `NNNN-slug.md` domain notes without frontmatter default to `informational`; running `adr decide --id NNNN --status approve` stamps governed frontmatter (`status: accepted`) so they satisfy `sealit drift` and enter receipt `adrHashes`.

## Steps

```bash
# 1. Inspect spec, policy, dependency, contract, and ring drift
node .agent/scripts/sealit-engine.mjs drift

# 2. Create a pending ADR in docs/adr/ (or inspect existing NNNN-slug.md via `adr list`)
node .agent/scripts/sealit-engine.mjs adr create \
  --title "<Short Decision Title>" \
  --scope <technical|architectural|product|contract> \
  --ticket <id> \
  --supersedes "<CAP-XX or ADR-00X>" \
  --context "<Trigger & options compared>" \
  --decision "<Chosen interface/design & constraints>" \
  --consequences "<Trade-offs, rejected option rationale & reversal criteria>"

# 3. Present the ADR to the human; after explicit approval, record decision
node .agent/scripts/sealit-engine.mjs adr decide \
  --id ADR-00X \
  --status approve \
  --by "@reviewer" \
  --reason "<rationale>"
```

## Confirm with user before
- Running `adr decide --status approve` on any ADR (`pending_approval` and `proposed` ADRs require explicit human sign-off).

## Done when
`node .agent/scripts/sealit-engine.mjs drift` exits `0` with `0` unapproved ADRs and `0` Concentric Ring violations.
