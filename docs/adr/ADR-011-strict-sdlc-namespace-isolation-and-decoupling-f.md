---
id: ADR-011
title: Strict sdlc Namespace Isolation and Decoupling from Standalone Coding-Persona Skills
status: accepted
scope: technical
ticket: #118
supersedes: CAP-05, CAP-07, CAP-08, ADR-010
createdAt: 2026-11-13T01:24:09.678Z
---

# ADR-011: Strict sdlc Namespace Isolation and Decoupling from Standalone Coding-Persona Skills

- **Status**: `accepted`
- **Blast Radius / Scope**: `technical`
- **Triggered By Ticket**: #118
- **Supersedes / Amends**: CAP-05, CAP-07, CAP-08, ADR-010

## 1. Context & Spec Drift Trigger
Workflow governance skills (branches, risk lanes, spec-drift ADRs, config-driven Dual-Gate verification, Concentric Clean Architecture rings, and Stage 7 receipts) and coding-persona or style skills (such as ponytail, impeccable, or standalone user coding skills) address orthogonal concerns. Including any non-sdlc skill identifier in CANONICAL_SDLC_SKILLS or DEPRECATED_SDLC_SKILLS couples delivery mechanics to a specific coding persona and causes sdlc install or install --global to delete standalone personal skills.

## 2. Decision
Restrict both CANONICAL_SDLC_SKILLS (10 skills) and DEPRECATED_SDLC_SKILLS (14 legacy sdlc-* skills) exclusively to the sdlc* namespace. Ensure provisionAgentIntegrations, pruneDeprecatedSkills, auditSkills, and auditWiki ignore all non-sdlc* skills in local and global agent directories so standalone coding-persona and design skills coexist untouched alongside the SDLC suite.

## 3. Consequences & Downstream Impact
Developers and teams can pair /sdlc-flow and /sdlc-tdd freely with any standalone coding-persona skill or style guide, and running sdlc install --global never deletes or modifies non-sdlc skills in ~/.gemini, ~/.claude, ~/.cursor, or ~/.grok.
