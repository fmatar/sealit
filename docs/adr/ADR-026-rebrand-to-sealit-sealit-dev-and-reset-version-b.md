---
id: ADR-026
title: "Rebrand to sealit (sealit.dev) and reset version baseline to 0.0.1"
scope: architectural
status: accepted
ticket: L-13
supersedes: [CAP-01, CAP-02, CAP-03, CAP-04, CAP-05, CAP-06, ADR-024]
createdAt: 2026-11-23T14:02:11.616Z
decidedBy: "@fmatar"
decidedAt: 2026-11-23T14:02:42.207Z
decisionReason: "Approved sealit (sealit.dev) rebrand and 0.0.1 version baseline reset"
---

# ADR-026: Rebrand to sealit (sealit.dev) and reset version baseline to 0.0.1

- **Scope**: `architectural`
- **Status**: `accepted`
- **Linked Ticket**: `L-13`
- **Supersedes / Modifies**: `CAP-01, CAP-02, CAP-03, CAP-04, CAP-05, CAP-06, ADR-024`

## 1. Context & Spec Drift Trigger
The project previously split naming across repository (fmatar/agentic-sdlc-framework), npm package (@fmatar/agentic-sdlc), and CLI/skills (sdlc*), and carried pre-rebrand version tags (v0.0.1-v0.3.0). Standardizing on a single 6-character slug with primary domain https://sealit.dev eliminates surface fragmentation and aligns CLI, npm, GitHub, Claude plugin, and canonical skills.

## 2. Decision
Standardize all surfaces on sealit v0.0.1 (https://sealit.dev, github.com/fmatar/sealit): rename .agent/scripts/sealit-engine.mjs, .agent/sealit-config.json (with transparent baseSha/local migration fallback from .agent/sdlc-config.json), .agent/.sealit-session.json, ~/.sealit, .github/workflows/sealit-quality-gate.yml, SEALIT_RECEIPT_KEY / SEALIT_RUNS_ON (with SDLC_* transition fallbacks), and the 6 canonical skills (sealit, sealit-spec, sealit-adr, sealit-tdd, sealit-gate, sealit-flow) while pruning retired sdlc* skills and resetting Semantic Versioning to 0.0.1.

## 3. Consequences & Reversal Criteria
One-way brand migration: existing adopters run sealit init or sealit doctor --fix to upgrade .agent/sdlc-config.json, <!-- AGENTIC-SDLC-RULES --> blocks, hooks, workflows, and retired sdlc* skill directories in place without losing custom module thresholds or audit chain continuity.
