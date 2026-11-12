---
id: ADR-002
title: Config-Driven Dual-Gate Thresholds, Verifiable CLI Telemetry, and SHA-256 Hook Drift Detection
status: accepted
scope: technical
ticket: #103
supersedes: CAP-03, CAP-06
createdAt: 2026-11-12T15:02:31.129Z
---

# ADR-002: Config-Driven Dual-Gate Thresholds, Verifiable CLI Telemetry, and SHA-256 Hook Drift Detection

- **Status**: `accepted`
- **Blast Radius / Scope**: `technical`
- **Triggered By Ticket**: #103
- **Supersedes / Amends**: CAP-03, CAP-06

## 1. Context & Spec Drift Trigger
Audit at commit bcdeffe found CLI formatter field mismatches (0 records / 0 skills checked), partial help output, zero-session heuristic dollar claims, outdated git hooks undetected by doctor, and prose coverage/mutation numbers drifting from .agent/sdlc-config.json.

## 2. Decision
Make .agent/sdlc-config.json the single source of truth for Dual-Gate coverage and mutation thresholds, widen Stryker mutation scope to core enforcement modules (audit-chain.mjs, git-guard.mjs), verify installed Git hook SHA-256 digests in doctor, fix CLI output formatters and full help registry, and align .archlens/policy.json concentric rings with .agent/scripts/lib.

## 3. Consequences & Downstream Impact
CLI output reflects real measured counts, doctor detects and heals stale git hooks, ROI stats report 0 when zero sessions exist and explicitly label estimates, and docs/skills never drift from configured enforcement bars.
