---
id: ADR-008
title: Fail-closed enforcement: exit codes, signed measured receipts, authenticated workbench
status: accepted
scope: technical
ticket: #91
supersedes: 
createdAt: 2026-11-03T18:52:42.656Z
---

# ADR-008: Fail-closed enforcement: exit codes, signed measured receipts, authenticated workbench

- **Status**: `accepted`
- **Blast Radius / Scope**: `technical`
- **Triggered By Ticket**: #91
- **Supersedes / Amends**: None

## 1. Context & Spec Drift Trigger
Evaluation of v0.2.0 found that guards printed errors but exited 0, git hooks ended with an unconditional exit 0, receipts recorded hard-coded 85/80/approved values in an unkeyed hash chain described as Merkle, coverage/mutation gates passed when no report existed, filenames were interpolated into shell strings (confirmed command injection), and the workbench listened on all interfaces with CORS * and unauthenticated ADR approval.

## 2. Decision
1) The CLI exit status mirrors result.success; unknown commands exit 2; hooks rely on set -e. 2) Engine code never builds shell strings from filenames or refs; git/test invocations use execFileSync argv arrays, and a test bans execSync template literals with interpolation. 3) Gate receipts are issued only from values measured into the session manifest (coverage, mutation or explicit not-configured, recorded reviewer verdict, drift result) and are HMAC-SHA256 signed with a local key (.agent/.receipt-key, gitignored) or SDLC_RECEIPT_KEY; the ledger is described as a hash chain, not a Merkle tree. 4) Missing or stale coverage/mutation reports fail the gate and are never cached; gate parses coverage against thresholds. 5) The workbench binds 127.0.0.1, requires a per-run random token for every request, accepts only same-origin Origin/Host, and is no longer auto-spawned.

## 3. Consequences & Downstream Impact
Repos that relied on silent passes will now see failing hooks/gates until they produce real coverage reports and record a review verdict. Receipts are only as trustworthy as the key holder: a local key proves issuance by someone with repo access, not that CI ran; CI should supply SDLC_RECEIPT_KEY as a secret. Workbench URLs must carry the printed token. Client-side hooks remain bypassable with --no-verify; server-side branch protection is still required.
