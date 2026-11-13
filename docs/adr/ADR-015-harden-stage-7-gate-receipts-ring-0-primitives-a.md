---
id: ADR-015
title: Harden Stage 7 Gate Receipts, Ring 0 Primitives, and Git Flow Verification
status: accepted
scope: technical
ticket: L-128000
supersedes: CAP-01, CAP-04
createdAt: 2026-11-13T23:01:39.017Z
---

# ADR-015: Harden Stage 7 Gate Receipts, Ring 0 Primitives, and Git Flow Verification

- **Status**: `accepted`
- **Blast Radius / Scope**: `technical`
- **Triggered By Ticket**: L-128000
- **Supersedes / Amends**: CAP-01, CAP-04

## 1. Context & Spec Drift Trigger
Comprehensive dual audit of `@fmatar/agentic-sdlc` identified gate-receipt verification bypasses, ADR compaction data loss, Git Flow `'develop'` base-branch drift, CI runner fallback gaps, monorepo root-module test skips, Workbench HTML escaping gaps, and redundant `git`/AST subprocess spawns across concentric architecture rings.

## 2. Decision
Consolidate shared Ring 0 safety, atomic I/O, session/product/ADR parsers, memoized base-branch resolution, and single-pass unified diff primitives into `core.mjs` and `decision-graph.mjs`; enforce `.agent/sdlc-config.json` thresholds inside `issueGateReceipt`; restrict post-receipt commit allowlists; verify `MERGE_HEAD` against `develop` on merges to `main`; verify Stage 7 receipts in CI; prevent ADR compaction data loss and accept both `approve`/`accept` verbs; escape server-rendered Workbench HTML and consolidate the widget UI; and update `.github/workflows/*.yml`, `docs/templates/C4_ARCHITECTURE_TEMPLATE.md`, and regression tests.

## 3. Consequences & Downstream Impact
- Strengthens `INV-01`, `INV-02`, `INV-03`, and `INV-04` across local hooks, CLI gates, and GitHub Actions workflows.
- Preserves existing tested public exports and shell script entrypoints while removing redundant per-file `git` spawns and duplicate parsers/HTML builders.

## 4. Governance Review Decision
- **Decision**: `ACCEPTED`
- **Reviewer**: @fmatar
- **Rationale**: Approved combined audit remediation plan
- **Decided At**: 2026-11-13T23:01:46.539Z
