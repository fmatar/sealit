---
id: ADR-001
title: Decompose sdlc-engine.mjs into Modular Domain Libraries with SHA-256 Gate Cache and SvelteKit 5 Decision Workbench
status: accepted
scope: technical
ticket: #63
supersedes: CAP-01
createdAt: 2026-10-21T15:56:59.836Z
---

# ADR-001: Decompose sdlc-engine.mjs into Modular Domain Libraries with SHA-256 Gate Cache and SvelteKit 5 Decision Workbench

- **Status**: `accepted`
- **Blast Radius / Scope**: `technical`
- **Triggered By Ticket**: #63
- **Supersedes / Amends**: CAP-01

## 1. Context & Spec Drift Trigger
Single-file sdlc-engine.mjs reached 4,658 lines and lacked end-to-end PRODUCT.md DAG orchestration, dual-enforced Spec-Drift ADR gates, and interactive causal decision lineage.

## 2. Decision
Split engine into 11 domain modules under .agent/scripts/lib/*.mjs, add SHA-256 git-tree gate cache, 4-layer git guard with Stage 7 Merkle Gate Receipts, sdlc-product skill, and SvelteKit 5 Runes workbench.

## 3. Consequences & Downstream Impact
100% backward-compatible exports with <50ms cached gate verification and full causal decision lineage in docs/DECISION_MAP.md.
