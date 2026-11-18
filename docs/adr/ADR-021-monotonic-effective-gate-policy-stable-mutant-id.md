---
id: ADR-021
title: "Monotonic Effective Gate Policy & Stable Mutant-Identity Exemptions"
scope: architectural
status: pending_approval
ticket: L-5
supersedes: [CAP-02, CAP-03, CAP-04]
createdAt: 2026-11-18T15:05:02.967Z
---

# ADR-021: Monotonic Effective Gate Policy & Stable Mutant-Identity Exemptions

- **Scope**: `architectural`
- **Status**: `pending_approval`
- **Linked Ticket**: `L-5`
- **Supersedes / Modifies**: `CAP-02, CAP-03, CAP-04`

## 1. Context & Spec Drift Trigger
A pull request could previously weaken .agent/sdlc-config.json thresholds, disable Archlens ring checks, narrow stryker.config.json mutate globs, add same-PR mutant exemptions, introduce unknown config keys or commandless numeric thresholds, add trackable source files outside mutate scope, or waive mismatched surviving mutants via unstable numeric Stryker IDs.

## 2. Decision
1. Introduce loadEffectivePolicy({ repoRoot, baseSha, headSha }) in config.mjs: thresholds take max(base, head), archlens.enabled takes base || head (preserving base policyPath when base is enabled), base-only exemptions apply during the PR while head-added exemptions enter pendingExemptions and trigger Architecture & Security Reviewer, Stryker mutate takes union of positive globs and intersection of negations, and loosening/recipe changes (lowering thresholds, disabling/repointing archlens, removing base modules, changing commands.*, altering non-mutate Stryker keys, or modifying .agent/scripts/** in consumer repos) emit GATE_POLICY_DRIFT requiring an accepted ADR (bootstrap repos without base sdlc-config.json use head policy with lastGate.policySource='bootstrap'). 2. Enforce exact schema-matched unknown-key validation across all sdlc-config.json levels and reject numeric thresholds paired with null commands (generic stack defaults diffCoverage to null). 3. Fail closed with diff-unmutated-sources when changed trackable source files fall outside effective Stryker mutate globs, and require stable mutant identities (<mutatorName>@<line>:<col>#<sha256(replacement)[0:8]>) in exemption.id (ignoring legacy IDs with a warning).

## 3. Consequences & Reversal Criteria
A PR can only tighten the policy it is judged by; loosening takes effect only after merge with an accepted ADR. Stage 7 receipt payload format remains unchanged for v0.0.2 compatibility.
