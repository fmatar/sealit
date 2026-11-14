---
id: ADR-017
title: Externalize Workbench Assets, Harden CSP Headers, Clean Dialect Hygiene, and Ensure Global CLI Portability
status: accepted
scope: technical
ticket: #135
supersedes: CAP-03, CAP-07, CAP-08, CAP-10, CAP-11
createdAt: 2026-11-14T19:42:32.602Z
---

# ADR-017: Externalize Workbench Assets, Harden CSP Headers, Clean Dialect Hygiene, and Ensure Global CLI Portability

- **Status**: `accepted`
- **Blast Radius / Scope**: `technical`
- **Triggered By Ticket**: #135
- **Supersedes / Amends**: CAP-03, CAP-07, CAP-08, CAP-10, CAP-11

## 1. Context & Spec Drift Trigger
Inline HTML/CSS/JS bloated workbench-server.mjs, allowed inline script/handler surface, leaked framework internal tool parameters into exported skills, and left global installs pointing at relative .agent/scripts paths.

## 2. Decision
Extract workbench assets into .agent/scripts/workbench-assets/ and omit them from .archlens/policy.json backend module checks, add per-request CSP nonces and strict security headers, unify skill dialect translation and marked rules blocks across runtimes, copy scripts to ~/.agentic-sdlc/scripts on --global installs, and remove stale SvelteKit/template copy.

## 3. Consequences & Downstream Impact
Workbench server drops under 650 lines with CSP nonces, all exported skill/rule files stay free of Antigravity-only parameter leakage, global installs execute cleanly in repositories without local .agent/scripts, and Archlens omits static browser assets cleanly.

## 4. Governance Review Decision
- **Decision**: `ACCEPTED`
- **Reviewer**: @fmatar
- **Rationale**: Approved for Issue #135 implementation and Archlens omit update
- **Decided At**: 2026-11-14T19:42:37.640Z
