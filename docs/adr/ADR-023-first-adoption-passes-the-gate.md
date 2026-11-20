---
id: ADR-023
title: "First adoption passes the gate"
scope: technical
status: accepted
ticket: L-10
supersedes: [CAP-04, CAP-06]
createdAt: 2026-11-20T16:04:55.548Z
decidedBy: "@fady"
decidedAt: 2026-11-20T16:16:25.857Z
decisionReason: "Approved first-adoption gate and Quickstart fixes"
---

# ADR-023: First adoption passes the gate

- **Scope**: `technical`
- **Status**: `accepted`
- **Linked Ticket**: `L-10`
- **Supersedes / Modifies**: `CAP-04, CAP-06`

## 1. Context & Spec Drift Trigger
Adopting @fmatar/agentic-sdlc on a fresh repository failed at four Quickstart steps: missing .agent/.receipt-key, UNMAPPED_MODULE violations on repos without 4-ring src/{domain,application,adapters,entrypoints} folders, 0% diff coverage caused by counting ~6.3k LOC of vendored .agent/scripts/*.mjs as consumer source code, and dirty working trees from unignored coverage/ output.

## 2. Decision
Add isEngineOwnerRepo({ repoRoot, baseSha }) in config.mjs and exclude .agent/scripts/** from diff coverage and default/unmutated Stryker mutation scope in non-owner repos (keeping GATE_POLICY_DRIFT and secret scanning intact), evaluate LCOV diffLineCoverage to 100% when zero consumer source files changed, add coverage/ and reports/ to SDLC_GITIGNORE_ENTRIES, make scaffoldArchlensPolicy layout-aware, and provision .agent/.receipt-key (0600) during local sdlc init exclusively on first adoption.

## 3. Consequences & Reversal Criteria
Fresh and brownfield repositories complete init -> begin -> ADR-001 -> gate -> review record -> verify cleanly while preserving full coverage and mutation enforcement on engine files inside @fmatar/agentic-sdlc itself and preventing accidental key rotation on teammate clones.
