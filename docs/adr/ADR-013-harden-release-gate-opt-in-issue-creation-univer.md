---
id: ADR-013
title: Harden Release Gate, Opt-In Issue Creation, Universal ADR Approval, Diff Review Plans, and Node 24 CI Actions
status: accepted
scope: technical
ticket: L-122000
supersedes: CAP-01, CAP-03, CAP-06
createdAt: 2026-11-13T12:27:18.589Z
---

# ADR-013: Harden Release Gate, Opt-In Issue Creation, Universal ADR Approval, Diff Review Plans, and Node 24 CI Actions

- **Status**: `accepted`
- **Blast Radius / Scope**: `technical`
- **Triggered By Ticket**: L-122000
- **Supersedes / Amends**: CAP-01, CAP-03, CAP-06

## 1. Context & Spec Drift Trigger
Audit identified silent git errors and non-strict gate in executeRelease, unrequested GitHub issue creation in stage begin, auto-accepted technical ADRs, file-count-only reviewer prompts, and Node 20 deprecation warnings on v4 GitHub Actions.

## 2. Decision
Require non-protected branch, gate --strict, and fail-closed git commit/tag in executeRelease; require explicit --issue, --local, --lane trivial, or --create-issue in stage begin; initialize all ADR scopes in pending_approval; embed unified git diff in generateReviewPlan; and upgrade GitHub Actions to Node 24 v7 on local-archlens.

## 3. Consequences & Downstream Impact
Eliminates silent release failures, accidental GitHub issue spam, unreviewed technical ADRs, blind reviewer subagents, and Node 20 runner warnings.

## 4. Governance Review Decision
- **Decision**: `ACCEPTED`
- **Reviewer**: @fady
- **Rationale**: User confirmed governance hardening across CI, release, stage begin, ADR approval, and reviewer diff context
- **Decided At**: 2026-11-13T12:27:28.727Z
