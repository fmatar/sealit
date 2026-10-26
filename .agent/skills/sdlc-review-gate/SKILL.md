---
name: sdlc-review-gate
description: Parallel peer reviewer, 9-pillar quality gatekeeper, and repository compliance auditor. Audits git diffs for Robert Martin test smells, verifies Dual-Gate metrics, enforces Archlens Clean Architecture rings, scans for secrets/CVEs, and posts review verdicts.
tools: read_file, write_file, edit_file, run_command, invoke_subagent
---

# 🔍 Peer Review, Quality Gate & Compliance Auditor (`sdlc-review-gate`)

## 1. Unified Responsibilities

`sdlc-review-gate` consolidates peer code review, strict pre-merge quality gates, and repository health auditing into a single verification skill:
1. **PR Diff & Craftsmanship Review**: Inspects `git diff` for Robert Martin SOLID compliance, test assertion density, and zero mock abuse.
2. **Strict Quality Gate (`gate --strict`)**: Enforces formatting, builds, Dual-Gate coverage/mutation thresholds, Archlens concentric layer rules (`.archlens/policy.json`), secret/CVE scanning, API contract drift checks, and SHA-256 Merkle audit chain integrity.
3. **Repository Compliance Audit**: Generates a scored health scorecard (`SDLC_COMPLIANCE_REPORT.md`) when auditing an existing codebase.

---

## 2. Parallel Fork-Join Review Protocol

When invoked during Stage 7 of `sdlc-flow`, dispatch two read-only `research` subagents in parallel via separate `invoke_subagent` tool calls:
- **Subagent 1 (`PR Peer Reviewer`)**:
  - `TypeName`: `"research"`
  - `Role`: `"PR Peer Reviewer"`
  - `Prompt`: `"Inspect git diff against main. Verify every modified source file has meaningful behavioral assertions (no smoke-screen tests or trivial getter tests), check README/CHANGELOG updates, and summarize findings."`
- **Subagent 2 (`Architecture & Security Gatekeeper`)**:
  - `TypeName`: `"research"`
  - `Role`: `"Architecture & Security Gatekeeper"`
  - `Prompt`: `"Inspect modified imports against .archlens/policy.json layers, check for hardcoded secrets or SQL/shell injection risks, and verify PRODUCT.md / ADR alignment."`

---

## 3. Automated Verification Commands

### 1. Execute the Strict Quality Gate
```bash
node .agent/scripts/sdlc-engine.mjs gate --strict
```
This runs:
- Module lint, build, and coverage commands (with SHA-256 git-tree caching in standard mode)
- `risk-audit`: Pre-flight blast radius scoring (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`)
- `security-audit`: Secret pattern scanning + package CVE check
- `archlens diff`: Policy-driven concentric ring import validation against `.archlens/policy.json`
- `flake-check`: Multi-iteration test stability check
- `contract check`: OpenAPI / GraphQL / Protobuf breaking-change detector
- `audit verify`: Tamper-evident SHA-256 Merkle chain verification (`docs/AUDIT_CHAIN.jsonl`)

### 2. Issue Stage 7 Cryptographic Gate Receipt
```bash
node .agent/scripts/sdlc-engine.mjs guard receipt
```

### 3. Post Review Verdict to PM Provider
```bash
node .agent/scripts/sdlc-engine.mjs pm comment <issue_id> --pr <pr_number> --body "### 🛡️ SDLC Review Gate Verdict: APPROVED\n- Dual-Gate Coverage & Architecture verified.\n- Zero concentric ring inversions or secret leaks."
```
