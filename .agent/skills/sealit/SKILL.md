---
name: sealit
description: "Direct 1:1 router for explicit /sealit CLI subcommands (init, doctor, begin, status, drift, adr, test, coverage, mutation, gate, review, pr-body, receipt, verify, end)."
disable-model-invocation: true
---

# Universal Command Router (`sealit`)

## When to use / When NOT to use
- **Use when** the user explicitly invokes `/sealit <command> [args]` for a single CLI operation.
- **Not for** autonomous multi-step feature or bug delivery across a branch and PR (call the `sealit-flow` skill instead).

## Kernel check
Check whether `.agent/sealit-config.json` exists in the repository:
- **Present**: run the mapped `node .agent/scripts/sealit-engine.mjs <command>` line below.
- **Absent**: `/sealit init [flags]` and `/sealit doctor` execute via `npx --yes github:fmatar/sealit <init|doctor> [flags]`; any other subcommand stops and offers `/sealit init` to initialize the Proof Kernel in this repository.

## Command Mapping (`1:1` to `sealit-engine.mjs`)

| Chat Command | CLI Execution |
| :--- | :--- |
| `/sealit init [flags]` | `node .agent/scripts/sealit-engine.mjs init [flags]` |
| `/sealit doctor` | `node .agent/scripts/sealit-engine.mjs doctor` |
| `/sealit doctor fix` | `node .agent/scripts/sealit-engine.mjs doctor --fix` |
| `/sealit begin <#id-or-title>` | `node .agent/scripts/sealit-engine.mjs begin --issue <id> --checkout` (supports `--base <branch>` and `--worktree <dir>`) |
| `/sealit status` | `node .agent/scripts/sealit-engine.mjs status` |
| `/sealit drift` | `node .agent/scripts/sealit-engine.mjs drift` |
| `/sealit adr <create\|list\|decide>` | `node .agent/scripts/sealit-engine.mjs adr <subcommand> [flags]` |
| `/sealit test` | `node .agent/scripts/sealit-engine.mjs test --affected-only` |
| `/sealit coverage` | `node .agent/scripts/sealit-engine.mjs coverage` |
| `/sealit mutation` | `node .agent/scripts/sealit-engine.mjs mutation` |
| `/sealit gate` | `node .agent/scripts/sealit-engine.mjs gate` |
| `/sealit review` | Dispatch `sealit-gate` (`review plan` -> spawn two isolated read-only subagents -> `review record`) |
| `/sealit pr-body` | `node .agent/scripts/sealit-engine.mjs pr-body` |
| `/sealit receipt` | `node .agent/scripts/sealit-engine.mjs receipt` |
| `/sealit verify` | `node .agent/scripts/sealit-engine.mjs verify` |
| `/sealit end` | `node .agent/scripts/sealit-engine.mjs end --issue <id>` |

## CI Signing Key Walkthrough (`init` / `doctor`)
First-time local `sealit init` automatically generates an untracked `0600` `.agent/.receipt-key`; upload it as secret `SEALIT_RECEIPT_KEY` in your CI provider (e.g., `tr -d '\r\n' < .agent/.receipt-key | gh secret set SEALIT_RECEIPT_KEY` on GitHub Actions, or masked CI/CD variable `SEALIT_RECEIPT_KEY` on GitLab/Bitbucket). On an already-adopted repository where `doctor` reports `Receipt Key: none`, ask the teammate to load the team's shared `SEALIT_RECEIPT_KEY` (into `.agent/.receipt-key` or `.env`) rather than overwriting the repository secret. Never print or log the key value in chat.

## Confirm with user before
- Running `doctor --fix` when the user only asked for a read-only check, or running `init --global`.
- Approving an ADR (`adr decide --status approve`).

## Done when
The mapped `sealit-engine.mjs` command exits `0` and its output is reported concisely.
