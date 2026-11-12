---
id: ADR-009
title: Align README, Wiki, PRD and SRS Documentation with v0.4.0 Architecture and Archlens Links
status: accepted
scope: technical
ticket: #114
supersedes: CAP-06, CAP-11
createdAt: 2026-11-12T21:21:08.123Z
---

# ADR-009: Align README, Wiki, PRD and SRS Documentation with v0.4.0 Architecture and Archlens Links

- **Status**: `accepted`
- **Blast Radius / Scope**: `technical`
- **Triggered By Ticket**: #114
- **Supersedes / Amends**: CAP-06, CAP-11

## 1. Context & Spec Drift Trigger
Root README.md, llms.txt, CONTRIBUTING.md, wiki/*.md, docs/PRD.md, and docs/SRS.md lacked direct links to https://github.com/fmatar/archlens, while docs/PRD.md, docs/SRS.md, CONTRIBUTING.md, wiki/Architecture.md, and two legacy October docs still contained pre-v0.4.0 references (SvelteKit 5 workbench, 6/8/10 skills, and outdated ring tables).

## 2. Decision
Link https://github.com/fmatar/archlens across README.md, llms.txt, CONTRIBUTING.md, wiki/*.md, docs/PRD.md, and docs/SRS.md; align wiki/Architecture.md 1:1 with .archlens/policy.json rings; upgrade README.md with live CI badge, proportional workflow examples, and 11-skill disclosure; update docs/PRD.md and docs/SRS.md to v0.4.0; and remove obsolete docs/SDLC_AGENTIC_OPERATIONS_GUIDE.md and docs/SDLC_COMPLIANCE_REPORT.md.

## 3. Consequences & Downstream Impact
100% of user-facing and LLM-ingested documentation reflects the v0.4.0 architecture, links directly to fmatar/archlens, and passes strict README and Wiki audits with zero errors or warnings.
