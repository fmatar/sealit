---
id: ADR-012
title: Reset Package, Plugin, and Documentation Version Baseline to 0.0.1
status: accepted
scope: technical
ticket: #120
supersedes: CAP-06, ADR-009
createdAt: 2026-11-13T05:21:12.046Z
---

# ADR-012: Reset Package, Plugin, and Documentation Version Baseline to 0.0.1

- **Status**: `accepted`
- **Blast Radius / Scope**: `technical`
- **Triggered By Ticket**: #120
- **Supersedes / Amends**: CAP-06, ADR-009

## 1. Context & Spec Drift Trigger
Prior experimental pre-release tags and GitHub releases (0.0.1 through v0.4.0) have been retired so the repository starts from a clean 0.0.1 pre-release baseline before its first public cut.

## 2. Decision
Set package.json, package-lock.json, .claude-plugin/plugin.json, installer.mjs fallback version, README.md version badge, PRODUCT.md/SRS.md compacted release metadata, and CHANGELOG.md to a clean 0.0.1 baseline, and remove legacy docs/proofs/proof-v0-*.md files.

## 3. Consequences & Downstream Impact
All manifests, agent rule headers, badges, and changelog entries reflect 0.0.1 consistently with zero stale pre-release tags or GitHub releases.
