---
id: ADR-004
title: Introduce /sdlc Universal Router and 8 Verb-Driven Command Skills
status: accepted
scope: architectural
ticket: #81
supersedes: CAP-05, CAP-07, CAP-08
createdAt: 2026-10-26T16:42:00.000Z
---

# ADR-004: Introduce `/sdlc` Universal Router and 8 Verb-Driven Command Skills

## 1. Context & Trigger
Users wanted direct slash-command ergonomics (`/sdlc doctor`, `/sdlc status`, `/sdlc gate`, `/sdlc adr`) rather than abstract skill names (`sdlc-init`, `sdlc-review-gate`), while preserving the two high-level macro orchestrators (`/sdlc-flow` and `/sdlc-product`).

## 2. Decision
1. **1 Universal Router + 8 Verb Skills (9 Canonical Skills)**:
   - `/sdlc` (`sdlc`): Universal `{{args}}` subcommand router mapping directly to `sdlc-engine.mjs`.
   - `/sdlc-flow` & `/sdlc-product`: Macro autopilot orchestrators.
   - `/sdlc-doctor` & `/sdlc-status`: Operations, environment healing, and live telemetry/UI inspection (replaces `sdlc-init`).
   - `/sdlc-tdd`, `/sdlc-gate`, `/sdlc-adr`, `/sdlc-release`: Stage action skills (replaces `sdlc-review-gate`).
2. **Automatic Pruning of Retired Skills**:
   - Add `sdlc-init` and `sdlc-review-gate` to `DEPRECATED_SDLC_SKILLS` in `.agent/scripts/lib/installer.mjs` and prune any duplicate `.agents/skills/sdlc-*` directories.

## 3. Consequences
- **Positive**: Every CLI verb has a matching slash command (`/sdlc-doctor`, `/sdlc-status`, `/sdlc-gate`, `/sdlc-adr`, `/sdlc-tdd`, `/sdlc-release`) plus `/sdlc <any-cmd>`, while `/sdlc-flow` and `/sdlc-product` remain one-shot autopilots.
