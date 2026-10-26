---
id: ADR-005
title: Adopt Two-Tier PRD and IEEE 29148 SRS Specification Governance in sdlc-product
scope: architectural
status: accepted
ticket: 84
supersedes: CAP-05, CAP-08, CAP-09
createdAt: 2026-10-26T17:34:00.000Z
---

# ADR-005: Adopt Two-Tier PRD and IEEE 29148 SRS Specification Governance in sdlc-product

- **Status**: `accepted`
- **Scope**: `architectural`
- **Ticket**: `#84`
- **Supersedes / Amends**: `CAP-05`, `CAP-08`, `CAP-09`

## 1. Context
While `docs/templates/PRD_TEMPLATE.md`, `docs/templates/SRS_TEMPLATE.md`, and `docs/templates/C4_ARCHITECTURE_TEMPLATE.md` existed in the repository, `initProductConstitution` previously only wrote a 6-line stub in `docs/specs/cap-XX.md` and never generated macro `docs/PRD.md` or `docs/SRS.md` documents.

## 2. Decision
Adopt a **Two-Tier Specification Hierarchy** inside `/sdlc-product` and `sdlc-engine.mjs`:
1. **Macro Product Tier**: `sdlc-engine product init` generates `PRODUCT.md` (constitutional index), `docs/PRD.md` (macro Product Requirements Document), and `docs/SRS.md` (IEEE 29148 Software Requirements Specification with C4 system architecture and capability traceability matrix).
2. **Per-Capability Tier**: `sdlc-engine product spec` (and `/sdlc spec`) scaffolds rich `docs/specs/cap-XX-<slug>.md` files combining a PRD slice, an IEEE 29148 SRS functional I/O slice, domain acceptance criteria, and a C4 Mermaid diagram, automatically syncing `PRODUCT.md`, `docs/PRD.md`, and `docs/SRS.md`.
3. **Drift & Dossier Integration**: `checkSpecDrift` enforces ADR governance on `docs/PRD.md` and `docs/SRS.md` mutations (`PRD_SRS_CONTRACT_MUTATION`), and `generateTicketDossier` embeds the capability's SRS excerpt into `.agent/dossiers/issue-<id>.md`.

## 3. Consequences
- Every product initialized or governed by `/sdlc-product` receives complete, traceable `PRODUCT.md`, `docs/PRD.md`, `docs/SRS.md`, and `docs/specs/cap-XX-<slug>.md` artifacts without adding a 10th skill folder.
