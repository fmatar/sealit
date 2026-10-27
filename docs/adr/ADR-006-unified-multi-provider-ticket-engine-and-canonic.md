---
id: ADR-006
title: Unified Multi-Provider Ticket Engine and Canonical Issue Templates
status: rejected
scope: technical
ticket: ##86
supersedes: CAP-02, CAP-09, CAP-10
createdAt: 2026-10-27T04:42:52.561Z
---

# ADR-006: Unified Multi-Provider Ticket Engine and Canonical Issue Templates

- **Status**: `rejected`
- **Blast Radius / Scope**: `technical`
- **Triggered By Ticket**: ##86
- **Supersedes / Amends**: CAP-02, CAP-09, CAP-10

## 1. Context & Spec Drift Trigger
Previously, only postPMComment supported GitHub, Linear, and Jira, while createTicket and transitionPMState only handled GitHub and fell back to local KANBAN.md. Furthermore, repositories only had feature and bug templates without hotfix or architecture spike templates.

## 2. Decision
Adopt a 4-template canonical issue suite (.github/ISSUE_TEMPLATE/{feature_request,bug_report,hotfix_incident,architecture_spike}.md + pull_request_template.md) and implement full 4-operation parity (createTicket, transitionPMState, postPMComment, syncKanbanBoard) across GitHub (gh CLI + Projects v2), Linear (GraphQL API), and Jira (REST API v3) with local docs/KANBAN.md mirroring.

## 3. Consequences & Downstream Impact
1. Seamless ticket creation, state transitions, and review comments across GitHub, Linear, and Jira using safe execFileSync argument arrays (INV-04). 2. Automatic scaffolding of canonical issue templates during npx install, doctor --fix, and /sdlc ticket templates.

## 4. Governance Review Decision
- **Decision**: `REJECTED`
- **Reviewer**: @human-operator
- **Rationale**: Reviewed via SDLC Governance Gate
- **Decided At**: 2026-10-27T04:43:46.394Z
