---
id: ADR-024
title: "Two-track skill installation"
scope: architectural
status: accepted
ticket: L-11
supersedes: [CAP-06]
createdAt: 2026-11-20T17:00:04.436Z
decidedBy: "@fady"
decidedAt: 2026-11-20T17:05:34.238Z
decisionReason: "Approved two-track skill installation and README overhaul"
---

# ADR-024: Two-track skill installation

- **Scope**: `architectural`
- **Status**: `accepted`
- **Linked Ticket**: `L-11`
- **Supersedes / Modifies**: `CAP-06`

## 1. Context & Spec Drift Trigger
Developers expect to install agent skills via vercel-labs/skills (npx skills add fmatar/agentic-sdlc-framework) locally or globally without mutating repository Git hooks or CI, while sdlc init previously crashed on npx skills .claude/skills symlinks, targeted ~/.gemini/antigravity/skills instead of ~/.gemini/config/skills globally, omitted Copilot skills locally, and emitted Antigravity-specific tools:/invoke_subagent tokens in canonical SKILL.md files.

## 2. Decision
Keep .agent/skills/ as the single tracked skill source while making all 6 SKILL.md files harness-neutral with a .agent/sdlc-config.json kernel check (sdlc-spec, sdlc-adr, sdlc-tdd run standalone with native repo tools; sdlc-gate and sdlc-flow fail closed and offer /sdlc init; sdlc bootstraps init/doctor via npx --yes github:fmatar/agentic-sdlc-framework), skip npx-managed skills (.agents/skills/<id>/SKILL.md) with warnings during sdlc init, map local Copilot skills to .claude/skills, target ~/.gemini/config/skills for global Antigravity (pruning legacy ~/.gemini/antigravity/skills/sdlc*), and document both tracks and the verified Quickstart in README.md.

## 3. Consequences & Reversal Criteria
Enables zero-friction npx skills add adoption across 35+ coding harnesses alongside full Proof-Kernel governance via sdlc init without symlink collisions, duplicate skill source directories, or unverified gate claims.
