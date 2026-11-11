---
id: ADR-001
title: 10-30-90 Developer Landing Page README Template and Deterministic README Engine
status: accepted
scope: technical
ticket: #100
supersedes: CAP-11
createdAt: 2026-11-11T15:11:26.404Z
---

# ADR-001: 10-30-90 Developer Landing Page README Template and Deterministic README Engine

- **Status**: `accepted`
- **Blast Radius / Scope**: `technical`
- **Triggered By Ticket**: #100
- **Supersedes / Amends**: CAP-11

## 1. Context & Spec Drift Trigger
Repositories generated or maintained by AI coding agents frequently accumulate badge Christmas trees, git-clone-first onboarding friction, dark-mode-hostile diagrams, and inline API reference bloat.

## 2. Decision
Add docs/templates/README_TEMPLATE.md with cli/sdk/platform archetype blocks, implement Ring 1 .agent/scripts/lib/readme-sync.mjs (readme init & tiered readme audit), wire /sdlc readme across sdlc, sdlc-wiki, sdlc-product, and sdlc-release, and enforce hard README anti-patterns in gate --strict.

## 3. Consequences & Downstream Impact
Standardizes all generated and dogfooded READMEs around the 10-30-90 progressive-trust filter with zero broken links, theme-aware SVGs/Mermaid, llms.txt discovery, and strict separation between landing page and wiki/ reference docs.
