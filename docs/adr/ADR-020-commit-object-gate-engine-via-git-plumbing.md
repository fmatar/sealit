---
id: ADR-020
title: "Commit-Object Gate Engine via Git Plumbing"
scope: architectural
status: accepted
ticket: L-4
supersedes: [CAP-01, CAP-03, CAP-04]
createdAt: 2026-11-18T08:34:53.765Z
decidedBy: "@fmatar"
decidedAt: 2026-11-18T13:26:30.175Z
decisionReason: "Approve commit-object gate engine via git plumbing"
---

# ADR-020: Commit-Object Gate Engine via Git Plumbing

- **Scope**: `architectural`
- **Status**: `accepted`
- **Linked Ticket**: `L-4`
- **Supersedes / Modifies**: `CAP-01, CAP-03, CAP-04`

## 1. Context & Spec Drift Trigger
Porcelain git diff and working-tree filesystem reads were vulnerable to user git config/env overrides (diff.noprefix, diff.mnemonicPrefix, diff.renames, diff.external, pathspec magic), case-insensitive filesystem rename tricks, uncommitted working-tree masking of committed secrets or unapproved ADRs, and pre-push ref mismatches when pushing non-HEAD branches or tags.

## 2. Decision
Authoritative verification paths (sdlc gate, sdlc receipt, sdlc verify, pre-push, and CI) evaluate immutable commit ranges exclusively via git >= 2.38 plumbing (diff-tree -r -z --raw --no-renames, diff-tree -r -p -U0 -M --no-ext-diff --no-textconv, ls-tree -r -z, and cat-file --batch) with zero git pathspecs and fail-closed ChangeSetParseError checking. sdlc gate refuses dirty working trees upfront (DIRTY_WORKING_TREE). Advisory TDD commands (drift, coverage, mutation, test --affected-only, status, review plan) evaluate diff-index + untracked files and label output as advisory. pre-push evaluates each pushed refs/heads/* commit range independently and fails closed on unreadable stdin. checkSpecDrift detects ADR_ID_COLLISION against base ADRs and resolveNextAdrId scans origin/<base>.

## 3. Consequences & Reversal Criteria
Eliminates whole classes of porcelain diff, pathspec, rename, case-folding, and working-tree masking bypasses structurally while preserving fast uncommitted TDD feedback loops. Requires a clean working tree before running sdlc gate and git >= 2.38 (enforced by sdlc doctor). Stage 7 receipt payload fields remain unchanged for v0.0.2/v0.1.0 verifier compatibility.
