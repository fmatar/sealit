---
id: ADR-010
title: Standardize on 10 Canonical SDLC Skills, Neutralize Engineering Terminology, and Compact README Workflow Diagram
status: accepted
scope: technical
ticket: #116
supersedes: CAP-05, CAP-07, CAP-08, CAP-11
createdAt: 2026-11-12T22:20:01.375Z
---

# ADR-010: Standardize on 10 Canonical SDLC Skills, Neutralize Engineering Terminology, and Compact README Workflow Diagram

- **Status**: `accepted`
- **Blast Radius / Scope**: `technical`
- **Triggered By Ticket**: #116
- **Supersedes / Amends**: CAP-05, CAP-07, CAP-08, CAP-11

## 1. Context & Spec Drift Trigger
Standardize the skill suite on 10 canonical SDLC skills (1 universal router plus 9 verb-driven lifecycle skills), replace author-branded terminology across engine modules, rules, templates, specs, and docs with standard software engineering terms (Red-Green-Refactor TDD, concentric Clean Architecture, F.I.R.S.T. isolation), remove Archlens links from page footers, and redesign the README How It Works diagram into a compact vertical flowchart TD that fits GitHub README column width.

## 2. Decision
1) Consolidate CANONICAL_SDLC_SKILLS to 10 SDLC skills and prune retired skill exports across local and global agent directories; 2) Replace author-specific phrasing across code, skills, specs, wiki, and README with neutral TDD and concentric Clean Architecture terminology; 3) Remove Archlens links from wiki/_Footer.md and README.md footer sections while keeping inline architecture references; 4) Replace the wide horizontal flowchart LR in README.md and wiki/Traceability.md with compact vertical flowchart TD diagrams.

## 3. Consequences & Downstream Impact

