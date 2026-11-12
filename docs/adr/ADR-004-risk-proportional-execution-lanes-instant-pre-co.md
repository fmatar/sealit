---
id: ADR-004
title: Risk-Proportional Execution Lanes, Instant Pre-Commit Guard, and Spec-Drift Precision
status: accepted
scope: technical
ticket: #107
supersedes: CAP-01, CAP-03
createdAt: 2026-11-12T18:38:13.172Z
---

# ADR-004: Risk-Proportional Execution Lanes, Instant Pre-Commit Guard, and Spec-Drift Precision

- **Status**: `accepted`
- **Blast Radius / Scope**: `technical`
- **Triggered By Ticket**: #107
- **Supersedes / Amends**: CAP-01, CAP-03

## 1. Context & Spec Drift Trigger
Full 8-stage SDLC ceremony (remote issue creation, full coverage/mutation runs, 2-3 review subagents, and workbench HTML regeneration) creates disproportionate overhead for trivial documentation/CSS fixes while checkSpecDrift lacked PRODUCT.md/docs/specs/*.md coverage and flagged non-structural package.json version/scripts edits.

## 2. Decision
Introduce deterministic 3-tier execution lanes (trivial, standard, full) via triageChange and sdlc-engine triage with automatic diff re-triage escalation, lane-aware Stage 7 HMAC receipts, opt-in --ui workbench snapshots, an instant (<100ms) pre-commit guard, and structural JSON AST diffing for package.json alongside PRODUCT.md and docs/specs/*.md drift protection.

## 3. Consequences & Downstream Impact
Trivial docs/style fixes complete rapidly without weakening cryptographic receipt verification or main branch protection; structural spec and dependency mutations remain strictly governed by accepted ADRs.
