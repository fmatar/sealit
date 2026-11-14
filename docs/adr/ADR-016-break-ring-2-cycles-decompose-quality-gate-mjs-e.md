---
id: ADR-016
title: Break Ring 2 Cycles, Decompose quality-gate.mjs, Enforce Whole-Graph Cycle Detection in checkArchDiff, and Align Archlens Policy Schema
status: accepted
scope: technical
ticket: #134
supersedes: CAP-02, CAP-03
createdAt: 2026-11-14T17:05:45.072Z
---

# ADR-016: Break Ring 2 Cycles, Decompose quality-gate.mjs, Enforce Whole-Graph Cycle Detection in checkArchDiff, and Align Archlens Policy Schema

- **Status**: `accepted`
- **Blast Radius / Scope**: `technical`
- **Triggered By Ticket**: #134
- **Supersedes / Amends**: CAP-02, CAP-03

## 1. Context & Spec Drift Trigger
Architectural audit and Issue #134 identified five structural Clean Architecture gaps: (1) mutual Ring 2 circular dependencies (arch-trace <-> session <-> quality-gate, plus installer/wiki-sync coupling); (2) checkArchDiff only checking sourceLayer !== targetLayer and missing intra-ring cycles and dynamic import()/require(); (3) the quality-gate.mjs monolith mixing doctor/config/CI scaffolding, coverage/mutation/flake runners, triage/review/skill-audit, and security/regression proofs; (4) .archlens/policy.json schema mismatch causing live Archlens MCP getPolicy/inspectArchitecture tools to report empty levels and components; and (5) legacy shell execCommand/execAsync remaining exported from Ring 0 core.mjs.

## 2. Decision
Decompose quality-gate.mjs into focused modules (coverage-mutation.mjs, security-audit.mjs, doctor-ci.mjs, triage-review.mjs) while preserving all public named exports on quality-gate.mjs and sdlc-engine.mjs; extract shared Ring 0/1 constants and invert arch-trace <-> session coupling to break all Ring 2 cycles; extend checkArchDiff to detect whole-graph and intra-ring cycles plus dynamic imports; align .archlens/policy.json and scaffoldArchlensPolicy with Archlens MCP levels/order/src/lang schema alongside layer rules; and remove execCommand/execAsync from Ring 0 core.mjs after migrating callers to execFile-based helpers.

## 3. Consequences & Downstream Impact
Enforces acyclic concentric Clean Architecture across Ring 0-3, enables live Archlens MCP structural inspection, shrinks quality-gate module blast radius with full API compatibility, and removes legacy shell execution wrappers from Ring 0 core.mjs. Implementation of .archlens/policy.json and boundary refactors is gated on explicit human approval of ADR-016.

## 4. Governance Review Decision
- **Decision**: `ACCEPTED`
- **Reviewer**: @fmatar
- **Rationale**: Approved Wave 2 Ring 2 cycle breakup and Archlens policy alignment (#134)
- **Decided At**: 2026-11-14T18:03:45.863Z
