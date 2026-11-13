---
id: ADR-014
title: Canonical Git Flow: Enforce Merges to Develop, Block Direct PRs to Main, and Automate Production Releases on Develop Merge
status: accepted
scope: technical
ticket: L-124000
supersedes: CAP-01, CAP-04, CAP-06
createdAt: 2026-11-13T16:37:17.263Z
---

# ADR-014: Canonical Git Flow: Enforce Merges to Develop, Block Direct PRs to Main, and Automate Production Releases on Develop Merge

- **Status**: `accepted`
- **Blast Radius / Scope**: `technical`
- **Triggered By Ticket**: L-124000
- **Supersedes / Amends**: CAP-01, CAP-04, CAP-06

## 1. Context & Spec Drift Trigger
Previously, PRs targeted `main` directly by default (`baseBranch = 'main'`), and `develop` drifted behind `main`. In addition, no automated release pipeline was triggered when `develop` was merged to `main`, requiring ad-hoc manual tagging.

## 2. Decision
1. Standardize on canonical Git Flow across the framework:
   - Feature, bugfix, and chore PRs merge into `develop` (`baseBranch = 'develop'`).
   - PRs targeting `main` must originate exclusively from `develop`; direct merges or PRs from feature branches to `main` are strictly forbidden.
   - Enforce branch flow policy at both client side (`verifyMergeGuard` Layer 3) and CI level (`enforce-branch-flow.yml` and `sdlc-quality-gate.yml`).
2. Automate production releases:
   - When `develop` is merged to `main`, GitHub Actions `release.yml` triggers on push to `main`.
   - The workflow validates `gate --strict`, creates annotated git tag `v${VERSION}`, extracts matching release notes from `CHANGELOG.md`, creates the GitHub Release, and publishes to npm when credentials (`NPM_TOKEN`) are configured (verifying `npm pack --dry-run` otherwise).

## 3. Consequences & Downstream Impact
- Protects `main` as an immutable production release branch fed strictly by `develop`.
- Eliminates manual release steps and guarantees every merge from `develop` to `main` produces a verified, tagged release.
- Ensures all developers and AI agents open PRs targeting `develop`.


## 4. Governance Review Decision
- **Decision**: `ACCEPTED`
- **Reviewer**: @fady
- **Rationale**: User confirmed canonical Git Flow: merges to develop, releases on develop merge to main
- **Decided At**: 2026-11-13T16:37:33.474Z
