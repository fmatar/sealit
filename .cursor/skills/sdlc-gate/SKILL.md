---
name: sdlc-gate
description: "Use when reviewing a branch or PR, running strict quality gates, or signing a Stage 7 receipt. Not for writing feature code. Runs review plan, gate, and review record."
---

# Risk-Scaled PR Review & Quality Gate (`sdlc-gate`)

## When to use / When NOT to use
- **Use when** auditing a feature branch/PR, dispatching read-only review subagents, running quality gates, and issuing the HMAC-signed Stage 7 receipt.
- **Not for** authoring initial feature logic (use `sdlc-tdd` / `sdlc-flow`).

## Lane behavior
| Lane | Subagent reviewers (`review plan`) | Engine gate command | Receipt contract |
| :--- | :--- | :--- | :--- |
| `trivial` | `0` subagents | `node .agent/scripts/sdlc-engine.mjs gate --lane trivial` | Auto-signed by `stage pre-pr` (`@auto-trivial-gate`) when diff stays docs/style `<= 25` lines. |
| `standard` | `1` read-only `PR Peer Reviewer` | `node .agent/scripts/sdlc-engine.mjs gate` | Requires measured `coverage` (per `.agent/sdlc-config.json`), `driftCheckPassed`, and `verdict: approve`. |
| `full` | `2-3` read-only subagents (`PR Peer Reviewer` + `Architecture & Security Gatekeeper` + `Security Specialist` on `CRITICAL`) | `node .agent/scripts/sdlc-engine.mjs gate --strict` | Requires measured `coverage` + `mutation` (per `.agent/sdlc-config.json`), `driftCheckPassed`, and `verdict: approve`. |

## Steps

1. **Generate the Risk-Proportional Review Plan**:
   ```bash
   node .agent/scripts/sdlc-engine.mjs review plan --json
   ```
   Inspect the returned `lane`, `subagentsCount`, `modifiedFiles`, `diffStat`, `diff`, and `payload.Subagents` list (each prompt embeds the changed file paths, `--stat`, and bounded unified diff against the target base branch (`develop` or `main`)).

2. **Dispatch Read-Only Reviewers with Concrete Context** (`standard` & `full` lanes):
   For each subagent in `review plan`, call `subagent-task` (`TypeName: "research"`) in parallel using its generated `Prompt` (which already contains the branch, `baseSha`/`headSha`, modified files, and unified `git diff`), supplemented with:
   - Current branch name, target base branch (`develop` or `main`) SHA, and active ticket `#id`.
   - Measured coverage/mutation numbers from `.agent/.sdlc-session.json` and thresholds from `.agent/sdlc-config.json`.
   - Instruction to return a structured verdict: `verdict: approve | request-changes`, `blockers: [...]`, and concise `notes` for the PR comment (subagents are read-only and never run `review record` or `gh` themselves).

3. **Evaluate Blockers & Remediate if Needed**:
   - Derive `<verdict>` strictly from reviewer output: `approve` **only** when every reviewer returned `approve` with `0` blockers; otherwise `request-changes`.
   - If `request-changes`, fix all blockers, commit, and message the same subagent `conversationId`s to re-verify before approving.

4. **Run Deterministic Quality Gate & Record Verdict**:
   ```bash
   # Standard lane: `gate` | Full lane: `gate --strict`
   node .agent/scripts/sdlc-engine.mjs gate --strict

   # Record derived verdict, sign Stage 7 receipt (when approve), and post 4-section PR comment:
   node .agent/scripts/sdlc-engine.mjs review record \
     --verdict <approve|request-changes> \
     --reviewer "@sdlc-gate" \
     --pr <prNumber> \
     --peer-review "<subagent_1_notes>" \
     --arch-review "<subagent_2_notes>"
   ```
   When `verdict` is `approve`, commit the updated `docs/AUDIT_CHAIN.jsonl` and push so the signed receipt is bound to the branch history.

## ⚠️ Confirm with user before
- Overriding a computed review lane downward (`--lane <lower> --reason`).
- Waiving or exempting any security or architectural blocker reported by a reviewer.

## If it fails
- **`review record` exits non-zero on `gh pr comment`** -> re-run with network/keychain access (`BypassSandbox: true`) so the 4-section review is published live on the PR.
- **`issueGateReceipt` refuses unmeasured values** -> run `coverage` (and `mutation` in `full` lane) first so `.agent/.sdlc-session.json` holds real measurements.
- **3 failed remediation loops** -> circuit breaker trips; stop and escalate to the user.

## Done when
All scheduled reviewers report `0` blockers, `gate` / `gate --strict` exits `0`, `review record` publishes the PR review with a valid `GATE-RECEIPT-*` ID, and the PR is merged into `develop` with green CI.
