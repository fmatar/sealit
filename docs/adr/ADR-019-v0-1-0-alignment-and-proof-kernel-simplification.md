---
id: ADR-019
title: v0.1.0 Alignment and Proof Kernel Simplification
status: accepted
scope: technical
ticket: #190
supersedes: CAP-01, CAP-02, CAP-03, CAP-04, CAP-05, CAP-06, CAP-07, CAP-08, CAP-09, CAP-10, CAP-11
createdAt: 2026-11-16T15:48:25.855Z
---

# ADR-019: v0.1.0 Alignment and Proof Kernel Simplification

- **Status**: `accepted`
- **Blast Radius / Scope**: `technical`
- **Triggered By Ticket**: #190
- **Supersedes / Amends**: CAP-01, CAP-02, CAP-03, CAP-04, CAP-05, CAP-06, CAP-07, CAP-08, CAP-09, CAP-10, CAP-11

## 1. Context & Spec Drift Trigger
The v0.0.2 codebase grew to 22,824 runtime lines, 57 CLI case branches, 6 persisted state stores, and 20,710 lines of vendored impeccable skills, with over 70% of defects originating in peripheral UI, PM/Kanban sync, prose/wiki generators, and synthetic demo commands.

## 2. Decision
Consolidate @fmatar/agentic-sdlc v0.1.0 into an 8-file (~3,800 LOC) Concentric Clean Architecture Alignment + Proof Kernel (git, config, receipt, drift, measure, guard, install, sdlc-engine) with 6 canonical skills in .agent/skills/, a single 2-mode (docs-only vs code) gate writing one HEAD-bound lastGate measurement record, HMAC-SHA256 receipts binding headSha + treeSha + specHash + adrHashes, Node >=22.0.0 compatibility, and complete removal of workbench-server, pm-provider/KANBAN.md, readme/wiki/DAG/trace/decision-graph generators, watchdog/proof/release commands, vendored impeccable, and tracked skill duplicates.

## 3. Consequences & Downstream Impact
Reduces runtime code by ~83% and repo size by ~41,000 lines, eliminates the localhost HTTP attack surface and tracker escaping bugs, establishes a clean open-core boundary, and enforces fail-closed alignment and test/coverage/mutation verification.

## 4. Governance Review Decision
- **Decision**: `ACCEPTED`
- **Reviewer**: @fady
- **Rationale**: Approved Approach 1 v0.1.0 Alignment + Proof Kernel architecture
- **Decided At**: 2026-11-16T15:48:25.974Z
