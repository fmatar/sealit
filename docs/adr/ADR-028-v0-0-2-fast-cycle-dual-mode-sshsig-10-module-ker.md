---
id: ADR-028
title: "v0.0.2 Fast Cycle, Dual-Mode SSHSIG, 10-Module Kernel & Polyglot Diff Coverage"
scope: architectural
status: accepted
ticket: L-18
supersedes: [CAP-02, CAP-03, CAP-04, CAP-05, CAP-06, ADR-019]
files: [PRODUCT.md, docs/PRD.md, docs/SRS.md, docs/specs/*, .archlens/policy.json, stryker.config.json]
createdAt: 2026-11-26T19:10:14.743Z
decidedBy: "@fmatar"
decidedAt: 2026-11-26T20:57:43.265Z
decisionReason: "Approved v0.0.2 fast cycle, dual-mode SSHSIG, 10-module kernel, polyglot diff coverage, and security hardening"
---

# ADR-028: v0.0.2 Fast Cycle, Dual-Mode SSHSIG, 10-Module Kernel & Polyglot Diff Coverage

- **Scope**: `architectural`
- **Status**: `accepted`
- **Linked Ticket**: `L-18`
- **Supersedes / Modifies**: `CAP-02, CAP-03, CAP-04, CAP-05, CAP-06, ADR-019`

## 1. Context & Spec Drift Trigger
External audit and independent review identified local HMAC self-attestation (S1), untrusted consumer PR engines and blanket ADR drift matching (S2), engine-blind gate cache keys (S3), silent repo-wide fallback on non-LCOV coverage reports, hardcoded JS coverage globs (L1), and a 41s serial test/CI cycle bottleneck.

## 2. Decision
Expand the zero-dependency concentric kernel from 8 to 10 modules (<=850 LOC each) by extracting Ring 1 session.mjs and parsers.mjs; add dual-mode native OpenSSH SSHSIG receipt signing against baseCommit:.agent/allowed_signers alongside backward-compatible HMAC-SHA256; run consumer CI gate --no-cache from origin/BASE_REF; require explicit ADR files: trigger coverage; parse per-line diff coverage for Cobertura XML, JaCoCo XML, and Go cover.out; parallelize hostile bypass matrix suites; fold env-isolated CI tests into a single gate pass; decouple --no-cache from Stryker --force; and add atomic --commit Stage 7 sealing.

## 3. Consequences & Reversal Criteria
Delivers 3-5x faster local and CI cycles with zero dropped checks, closes S1-S7 and L1-L4, and preserves full backward compatibility for existing HMAC-SHA256 repositories and historical audit ledger records.
