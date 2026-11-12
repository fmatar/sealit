---
id: ADR-005
title: Right-Size Canonical Skills Suite and Native Claude and Cursor Skill Packaging
status: accepted
scope: technical
ticket: #109
supersedes: CAP-05, CAP-07, CAP-08
createdAt: 2026-11-12T19:34:11.619Z
---

# ADR-005: Right-Size Canonical Skills Suite and Native Claude and Cursor Skill Packaging

- **Status**: `accepted`
- **Blast Radius / Scope**: `technical`
- **Triggered By Ticket**: #109
- **Supersedes / Amends**: CAP-05, CAP-07, CAP-08

## 1. Context & Spec Drift Trigger
The 10 canonical skills had capability-list descriptions without Use-when triggers, duplicated TDD/gate/README prose, hardcoded approve verdicts, router mismaps (/sdlc begin #id, /sdlc doctor), repo-specific wiki instructions, missing ub-mode in CANONICAL_SDLC_SKILLS, duplicate .claude/commands/*.md files, hardcoded plugin.json version 0.1.0, and .cursor/rules-only Cursor exports.

## 2. Decision
Standardize all 11 canonical skills (including ub-mode) on <=200-char Use-when/Not-for descriptions, risk-proportional lane tables, confirmation gates, blocker-derived review verdicts, and repo-agnostic wiki rules; remove duplicate .claude/commands/*.md in favor of .claude/skills/<id>/SKILL.md, derive .claude-plugin/plugin.json version from package.json, and provision native .cursor/skills/<id>/SKILL.md alongside .cursor/rules/.

## 3. Consequences & Downstream Impact
Claude Code and Cursor discover all 11 skills cleanly without duplicate slash commands, every skill scales proportionally to trivial/standard/full lanes, and automated tests verify every referenced sdlc-engine subcommand.
