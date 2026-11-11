---
name: sdlc
description: Universal /sdlc $ARGUMENTS command router. Accepts any subcommand directly in chat (/sdlc doctor, /sdlc begin 4912, /sdlc status, /sdlc drift, /sdlc pre-pr, /sdlc gate, /sdlc kanban, /sdlc ui) and maps it 1:1 to sdlc-engine.mjs.
allowed-tools: Read, Write, Edit, Bash, Agent
---

# ⚡ Universal Command Router (`/sdlc $ARGUMENTS`)

## 1. Direct Subcommand Routing (`1:1` to `sdlc-engine.mjs`)

When the user invokes `/sdlc <subcommand> [arguments]`, map the request directly to the corresponding deterministic command in `.agent/scripts/sdlc-engine.mjs`:

| Chat Command | Executed CLI Command |
| :--- | :--- |
| `/sdlc install [flags]` | `node .agent/scripts/sdlc-engine.mjs install [flags]` |
| `/sdlc doctor` | `node .agent/scripts/sdlc-engine.mjs doctor --fix` |
| `/sdlc skill-audit` | `node .agent/scripts/sdlc-engine.mjs skill-audit` |
| `/sdlc detect` | `node .agent/scripts/sdlc-engine.mjs detect` |
| `/sdlc status` / `/sdlc dashboard` | `node .agent/scripts/sdlc-engine.mjs session dashboard` |
| `/sdlc begin <title-or-#id>` | `node .agent/scripts/sdlc-engine.mjs stage begin --title "<title>" --checkout` |
| `/sdlc pre-pr [#id]` | `node .agent/scripts/sdlc-engine.mjs stage pre-pr --issue <id> --summary "<summary>"` |
| `/sdlc complete [#id]` | `node .agent/scripts/sdlc-engine.mjs stage complete --issue <id>` |
| `/sdlc test` | `node .agent/scripts/sdlc-engine.mjs test --affected-only` |
| `/sdlc coverage` / `/sdlc mutation` | `node .agent/scripts/sdlc-engine.mjs coverage` / `mutation` |
| `/sdlc reproduce "<trace>"` | `node .agent/scripts/sdlc-engine.mjs reproduce --error "<trace>"` |
| `/sdlc spec --cap CAP-XX --title "<title>"` | `node .agent/scripts/sdlc-engine.mjs product spec --cap CAP-XX --title "<title>"` |
| `/sdlc drift` | `node .agent/scripts/sdlc-engine.mjs drift check` |
| `/sdlc adr <create\|list\|decide\|compact>` | `node .agent/scripts/sdlc-engine.mjs adr <subcommand> [--release <ver>]` |
| `/sdlc gate` | `node .agent/scripts/sdlc-engine.mjs gate --strict` |
| `/sdlc review` | `node .agent/scripts/sdlc-engine.mjs review record --verdict approve --reviewer "@sdlc-gate" --peer-review "<tdd>" --arch-review "<arch>"` |
| `/sdlc ticket <create\|transition\|comment\|sync\|templates>` | `node .agent/scripts/sdlc-engine.mjs ticket <subcommand> [args]` |
| `/sdlc kanban` | `.agent/scripts/kanban-sync.sh` |
| `/sdlc ub` | Activate `ub-mode` (Robert C. Martin reduced principles) for the active session |
| `/sdlc ui` / `/sdlc serve` | `node .agent/scripts/sdlc-engine.mjs ui-snapshot` (then hand the user the path of `.agent/workbench/index.html`) |
| `/sdlc readme [init\|audit]` | `node .agent/scripts/sdlc-engine.mjs readme <subcommand> [--archetype <auto\|cli\|sdk\|platform>] [--strict]` |
| `/sdlc wiki [sync\|audit\|map]` | `node .agent/scripts/sdlc-engine.mjs wiki <subcommand>` |
| `/sdlc release [patch\|minor\|major]` | `node .agent/scripts/sdlc-engine.mjs release <bump>` |

## 2. Execution Protocol
1. Parse the user's subcommand and flags after `/sdlc`.
2. Execute the mapped `node .agent/scripts/sdlc-engine.mjs ...` command via `Bash`.
3. If the subcommand is `begin`, `pre-pr`, `ui`, or `status`, also regenerate `.agent/workbench/index.html` with `node .agent/scripts/sdlc-engine.mjs ui-snapshot`. Claude Code cannot embed HTML inline: tell the user the path of `.agent/workbench/index.html` so they can open it in a browser.
