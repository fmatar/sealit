---
id: ADR-027
title: "Adopt @sealit/cli scoped npm package name"
scope: product
status: accepted
ticket: L-17
supersedes: [CAP-04, CAP-06, ADR-026]
createdAt: 2026-11-24T02:17:24.405Z
decidedBy: "@fady"
decidedAt: 2026-11-24T02:21:42.483Z
decisionReason: "Selected @sealit/cli scoped npm org package name"
---

# ADR-027: Adopt @sealit/cli scoped npm package name

- **Scope**: `product`
- **Status**: `accepted`
- **Linked Ticket**: `L-17`
- **Supersedes / Modifies**: `CAP-04, CAP-06, ADR-026`

## 1. Context & Spec Drift Trigger
Unscoped 'sealit' on npmjs.org is blocked by npm's Levenshtein similarity filter against 'split' and would leave unpinned 'npx sealit' vulnerable to third-party squatting.

## 2. Decision
Publish the CLI package as '@sealit/cli' under the '@sealit' npm organization (with 'bin.sealit = bin/sealit.mjs' and 'publishConfig.access = public') and restrict ALLOWED_NPX_SPECS to owned namespaces ('@sealit/cli', '@fmatar/sealit', 'github:fmatar/sealit').

## 3. Consequences & Reversal Criteria
Owns the '@sealit/*' namespace for future packages, eliminates unowned unscoped npx Squatting vectors, and preserves 'sealit' on PATH once installed.
