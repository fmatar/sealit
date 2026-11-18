---
name: sdlc
description: "Use when running an explicit /sdlc command in chat (`doctor`, `begin`, `status`, `drift`, `gate`, `verify`). Not for full feature implementation (use sdlc-flow)."
tools: read_file, write_file, edit_file, run_command, invoke_subagent
---

# Universal Command Router (`sdlc`)

## When to use / When NOT to use
- **Use when** the user invokes `/sdlc <command> [args]` for a direct CLI operation.
- **Not for** multi-step feature or bug delivery across a branch and PR (use `sdlc-flow`).

## Command Mapping (`1:1` to `sdlc-engine.mjs`)

| Chat Command | CLI Execution |
| :--- | :--- |
| `/sdlc init [flags]` | `node .agent/scripts/sdlc-engine.mjs init [flags]` |
| `/sdlc doctor` | `node .agent/scripts/sdlc-engine.mjs doctor` |
| `/sdlc doctor fix` | `node .agent/scripts/sdlc-engine.mjs doctor --fix` |
| `/sdlc begin <#id-or-title>` | `node .agent/scripts/sdlc-engine.mjs begin --issue <id> --checkout` (or `--title "<desc>" --checkout`) |
| `/sdlc status` | `node .agent/scripts/sdlc-engine.mjs status` |
| `/sdlc drift` | `node .agent/scripts/sdlc-engine.mjs drift` |
| `/sdlc adr <create\|list\|decide>` | `node .agent/scripts/sdlc-engine.mjs adr <subcommand> [flags]` |
| `/sdlc test` | `node .agent/scripts/sdlc-engine.mjs test --affected-only` |
| `/sdlc coverage` | `node .agent/scripts/sdlc-engine.mjs coverage` |
| `/sdlc mutation` | `node .agent/scripts/sdlc-engine.mjs mutation` |
| `/sdlc gate` | `node .agent/scripts/sdlc-engine.mjs gate` |
| `/sdlc review` | Run `sdlc-gate` (`review plan` -> read-only reviewer -> `review record`) |
| `/sdlc receipt` | `node .agent/scripts/sdlc-engine.mjs receipt` |
| `/sdlc verify` | `node .agent/scripts/sdlc-engine.mjs verify` |
| `/sdlc end` | `node .agent/scripts/sdlc-engine.mjs end --issue <id>` (bare `end` only works on the session's own branch) |

## Confirm with user before
- Running `doctor --fix` when the user only asked for a read-only check, or `init --global`.
- Approving an ADR (`adr decide --status approve`).

## Done when
The mapped `sdlc-engine.mjs` command exits `0` and its result is reported concisely.
