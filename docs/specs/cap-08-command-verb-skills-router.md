# Functional Specification: `CAP-08` — `/sdlc` Command Router & 8 Verb-Driven Skills (`#81`)

## 1. Problem Statement & User Value
Abstract skill names like `sdlc-init` and `sdlc-review-gate` do not map intuitively to the CLI commands developers run (`doctor`, `status`, `gate`, `adr`, `begin`). By introducing a universal `/sdlc <cmd>` subcommand router alongside 2 Macro Autopilot skills (`/sdlc-flow`, `/sdlc-product`) and 6 sharp Verb Skills (`/sdlc-doctor`, `/sdlc-status`, `/sdlc-tdd`, `/sdlc-gate`, `/sdlc-adr`, `/sdlc-release`), developers can either type `/sdlc <any-subcommand>` directly in chat or invoke a focused verb skill.

## 2. Canonical Skill Topology (1 Router + 8 Verb Skills)

| Skill | Category | Replaces / Evolves | Primary Mapping |
| :--- | :--- | :--- | :--- |
| **`sdlc`** | **Universal CLI Router** | New (`/sdlc <args>`) | Maps `/sdlc <subcommand>` 1:1 to `node .agent/scripts/sdlc-engine.mjs <subcommand>` |
| **`sdlc-flow`** | **Macro Autopilot** | `sdlc-flow` | End-to-end ticket delivery (`stage begin -> TDD -> stage pre-pr -> gate -> stage complete`) |
| **`sdlc-product`** | **Macro Autopilot** | `sdlc-product` | Spec/PRD-to-DAG autopilot (`PRODUCT.md`, `docs/specs/*.md`, topological waves) |
| **`sdlc-doctor`** | **Ops & Diagnostics** | Replaces `sdlc-init` | `install`, `detect`, `doctor --fix`, `hooks install`, `archlens scaffold`, `interop export` |
| **`sdlc-status`** | **Ops & Diagnostics** | New verb skill | `session status`, `session dashboard`, `drift check`, `KANBAN.md`, and `ui-snapshot` |
| **`sdlc-tdd`** | **Stage Action** | `sdlc-tdd` | Robert Martin Red-Green-Refactor + `test --affected-only`, `coverage`, `mutation`, `reproduce` |
| **`sdlc-gate`** | **Stage Action** | Replaces `sdlc-review-gate` | Parallel Fork-Join PR review (`invoke_subagent`) + `gate --strict` + `guard receipt` |
| **`sdlc-adr`** | **Stage Action** | New verb skill | `adr create`, `adr list`, `adr decide`, `drift check`, and `decision-graph sync` |
| **`sdlc-release`** | **Stage Action** | `sdlc-release` | Docs/`CHANGELOG.md`/`wiki/` sync, `proof generate`, `release <patch\|minor\|major>`, `watchdog` |

## 3. Acceptance Criteria
1. `.agent/skills/` contains exactly the 9 canonical skills (`sdlc`, `sdlc-adr`, `sdlc-doctor`, `sdlc-flow`, `sdlc-gate`, `sdlc-product`, `sdlc-release`, `sdlc-status`, `sdlc-tdd`) with valid tool schemas (`read_file`, `write_file`, `edit_file`, `run_command`, `invoke_subagent`).
2. `sdlc-init`, `sdlc-review-gate`, and any duplicate `.agents/skills/sdlc-*` folders are removed and added to `DEPRECATED_SDLC_SKILLS` in `.agent/scripts/lib/installer.mjs` for automatic pruning on upgrade.
