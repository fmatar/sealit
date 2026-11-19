---
id: ADR-022
title: "Enriched 6-Skill Kernel, Dual-Format ADRs & Pointer Review Plan"
scope: architectural
status: accepted
ticket: L-8
supersedes: [CAP-01, CAP-03, CAP-04, CAP-06]
createdAt: 2026-11-19T16:15:53.387Z
decidedBy: "@fady"
decidedAt: 2026-11-19T16:15:53.478Z
decisionReason: "Approved Option A clean-room 6-skill enrichment and kernel interoperability plan"
---

# ADR-022: Enriched 6-Skill Kernel, Dual-Format ADRs & Pointer Review Plan

- **Scope**: `architectural`
- **Status**: `accepted`
- **Linked Ticket**: `L-8`
- **Supersedes / Modifies**: `CAP-01, CAP-03, CAP-04, CAP-06`

## 1. Context & Spec Drift Trigger
v0.1.0 simplified @fmatar/agentic-sdlc to 6 skills (~228 total lines), leaving upstream Socratic discovery, seam design, anti-tautological vertical TDD, 2-axis spec/standards review, MADR 0001-slug.md ADR compatibility, worktree --base branching, and Codex/Claude plugin parity underspecified.

## 2. Decision
Retain the strict 6-skill, 8-module zero-dependency kernel (Option A) while clean-room enriching all 6 canonical skills, adding MADR NNNN-slug.md + ADR-NNN dual support in drift.mjs/git.mjs, --base worktree session binding and Git 2.38+ portable checkout in guard.mjs, always-on 2-axis context-pointer review plans and pr-body generation, non-destructive .claude/settings.json merging, .scratch/ gitignore hygiene, and agents/openai.yaml + array plugin.json manifests.

## 3. Consequences & Reversal Criteria
Delivers standalone upstream engineering discipline and seamless ecosystem skill coexistence within the <=160-line skill cap, <=850-line module cap, and <120 kB tarball budget without re-introducing PM/tracker bloat.
