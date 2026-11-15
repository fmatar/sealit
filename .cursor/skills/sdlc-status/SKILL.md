---
name: sdlc-status
description: "Use when inspecting the active SDLC session, 8-stage progress, spec drift, or audit chain health. Not for modifying code, sessions, or artifacts (strictly read-only)."
---

# Read-Only Session, Drift & Audit Status (`sdlc-status`)

## When to use / When NOT to use
- **Use when** checking current session stage, active branch/lane, spec-drift status, or SHA-256 hash-chain audit ledger health without mutating any files.
- **Not for** advancing lifecycle stages (`sdlc-flow`), healing repo assets (`sdlc-doctor`), or writing workbench HTML artifacts unless explicitly asked via `/sdlc ui`.

## Lane behavior
| Inspection depth | Commands executed |
| :--- | :--- |
| **Quick (default)** | `session dashboard` + `drift check` (2 fast read-only checks). |
| **Full (`--full`)** | Adds `arch diff`, `audit verify`, and `stats` (labeled as formula estimates). |

## Steps

```bash
# Quick status (default):
node .agent/scripts/sdlc-engine.mjs session dashboard
node .agent/scripts/sdlc-engine.mjs drift check

# Full governance & architecture telemetry (when user asks for full status):
node .agent/scripts/sdlc-engine.mjs arch diff
node .agent/scripts/sdlc-engine.mjs audit verify
node .agent/scripts/sdlc-engine.mjs stats
```

- **Workbenches (opt-in only)**: SDLC's loopback ledger server runs via `sdlc-engine.mjs serve` (`127.0.0.1:4120`); the separate Archlens Clean Architecture workbench runs on `localhost:8088` when `.archlens/policy.json` is active. Do not generate or embed `.agent/workbench/index.html` during a status check unless requested.

## ⚠️ Confirm with user before
- None (`sdlc-status` is strictly read-only and never modifies files or remote state).

## If it fails
- **Corrupted `.agent/.sdlc-session.json` or outdated git hooks** -> recommend running `sdlc-doctor`.
- **`drift check` or `audit verify` reports errors** -> report the exact finding and suggest `sdlc-adr` or `sdlc-gate`.

## Done when
A concise read-only summary of active session stage, lane, drift status, and any blockers is presented to the user.
