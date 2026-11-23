---
name: sdlc
description: "Direct 1:1 router for explicit /sdlc CLI subcommands (init, doctor, begin, status, drift, adr, test, coverage, mutation, gate, review, pr-body, receipt, verify, end)."
disable-model-invocation: true
---

# Universal Command Router (`sdlc`)

## When to use / When NOT to use
- **Use when** the user explicitly invokes `/sdlc <command> [args]` for a single CLI operation.
- **Not for** autonomous multi-step feature or bug delivery across a branch and PR (call the `sdlc-flow` skill instead).

## Kernel check
Check whether `.agent/sdlc-config.json` exists in the repository:
- **Present**: run the mapped `node .agent/scripts/sdlc-engine.mjs <command>` line below.
- **Absent**: `/sdlc init [flags]` and `/sdlc doctor` execute via `npx --yes github:fmatar/agentic-sdlc-framework <init|doctor> [flags]`; any other subcommand stops and offers `/sdlc init` to initialize the Proof Kernel in this repository.

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
| `/sdlc review` | Dispatch `sdlc-gate` (`review plan` -> spawn two isolated read-only subagents -> `review record`) |
| `/sdlc pr-body` | `node .agent/scripts/sdlc-engine.mjs pr-body` |
| `/sdlc receipt` | `node .agent/scripts/sdlc-engine.mjs receipt` |
| `/sdlc verify` | `node .agent/scripts/sdlc-engine.mjs verify` |
| `/sdlc end` | `node .agent/scripts/sdlc-engine.mjs end --issue <id>` |

## CI Signing Key Walkthrough (`init` / `doctor`)
First-time local `sdlc init` automatically generates an untracked `0600` `.agent/.receipt-key`; sync it to GitHub Actions via `tr -d '\r\n' < .agent/.receipt-key | gh secret set SDLC_RECEIPT_KEY`. On an already-adopted repository where `doctor` reports `Receipt Key: none`, ask the teammate to load the team's shared `SDLC_RECEIPT_KEY` (into `.agent/.receipt-key` or `.env`) rather than overwriting the repository secret. Never print or log the key value in chat.

## Confirm with user before
- Running `doctor --fix` when the user only asked for a read-only check, or running `init --global`.
- Approving an ADR (`adr decide --status approve`).

## Done when
The mapped `sdlc-engine.mjs` command exits `0` and its output is reported concisely.
