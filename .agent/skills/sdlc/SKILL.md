---
name: sdlc
description: "Direct 1:1 router for explicit /sdlc CLI subcommands (init, doctor, begin, status, drift, adr, test, coverage, mutation, gate, review, pr-body, receipt, verify, end)."
disable-model-invocation: true
tools: read_file, write_file, edit_file, run_command, invoke_subagent
---

# Universal Command Router (`sdlc`)

## When to use / When NOT to use
- **Use when** the user explicitly invokes `/sdlc <command> [args]` for a single CLI operation.
- **Not for** autonomous multi-step feature or bug delivery across a branch and PR (call the `sdlc-flow` skill instead).

## Command Mapping (`1:1` to `sdlc-engine.mjs`)

| Chat Command | CLI Execution |
| :--- | :--- |
| `/sdlc init [flags]` | `node .agent/scripts/sdlc-engine.mjs init [flags]` |
| `/sdlc doctor` | `node .agent/scripts/sdlc-engine.mjs doctor` |
| `/sdlc doctor fix` | `node .agent/scripts/sdlc-engine.mjs doctor --fix` |
| `/sdlc begin <#id-or-title>` | `node .agent/scripts/sdlc-engine.mjs begin --issue <id> --checkout` (supports `--base <branch>` and `--worktree <dir>`) |
| `/sdlc status` | `node .agent/scripts/sdlc-engine.mjs status` |
| `/sdlc drift` | `node .agent/scripts/sdlc-engine.mjs drift` |
| `/sdlc adr <create\|list\|decide>` | `node .agent/scripts/sdlc-engine.mjs adr <subcommand> [flags]` |
| `/sdlc test` | `node .agent/scripts/sdlc-engine.mjs test --affected-only` |
| `/sdlc coverage` | `node .agent/scripts/sdlc-engine.mjs coverage` |
| `/sdlc mutation` | `node .agent/scripts/sdlc-engine.mjs mutation` |
| `/sdlc gate` | `node .agent/scripts/sdlc-engine.mjs gate` |
| `/sdlc review` | Dispatch `sdlc-gate` (`review plan` -> parallel `invoke_subagent` reviewers -> `review record`) |
| `/sdlc pr-body` | `node .agent/scripts/sdlc-engine.mjs pr-body` |
| `/sdlc receipt` | `node .agent/scripts/sdlc-engine.mjs receipt` |
| `/sdlc verify` | `node .agent/scripts/sdlc-engine.mjs verify` |
| `/sdlc end` | `node .agent/scripts/sdlc-engine.mjs end --issue <id>` |

## CI Signing Key Walkthrough (`init` / `doctor`)
When `doctor` reports `Receipt Key: none` (not provisioned), walk the human through generating a local gitignored `.agent/.receipt-key` (`openssl rand -hex 32 > .agent/.receipt-key && chmod 600 .agent/.receipt-key`) and syncing it to GitHub Actions (`tr -d '\r\n' < .agent/.receipt-key | gh secret set SDLC_RECEIPT_KEY`). Never print or log the key value in chat.

## Confirm with user before
- Running `doctor --fix` when the user only asked for a read-only check, or running `init --global`.
- Approving an ADR (`adr decide --status approve`).

## Done when
The mapped `sdlc-engine.mjs` command exits `0` and its output is reported concisely.
