# Functional Specification: `CAP-08` — `/sdlc` Command Router & 9 Verb-Driven Skills (`#81`, `ADR-010`, `ADR-011`)

## 1. Problem Statement & User Value
Abstract skill names like `sdlc-init` and `sdlc-review-gate` do not map intuitively to the CLI commands developers run (`doctor`, `status`, `gate`, `adr`, `begin`). By introducing a universal `/sdlc <cmd>` subcommand router alongside 2 Macro Autopilot skills (`/sdlc-flow`, `/sdlc-product`) and 7 sharp Verb Skills (`/sdlc-doctor`, `/sdlc-status`, `/sdlc-tdd`, `/sdlc-gate`, `/sdlc-adr`, `/sdlc-wiki`, `/sdlc-release`), developers can either type `/sdlc <any-subcommand>` directly in chat or invoke a focused verb skill while composing freely with any standalone coding-persona or design skill (`ADR-011`).

## 2. Canonical Skill Topology (1 Router + 9 Verb Skills)

| Skill | Category | Replaces / Evolves | Primary Mapping |
| :--- | :--- | :--- | :--- |
| **`sdlc`** | **Universal CLI Router** | New (`/sdlc <args>`) | Maps `/sdlc <subcommand>` 1:1 to `node .agent/scripts/sdlc-engine.mjs <subcommand>` |
| **`sdlc-flow`** | **Macro Autopilot** | `sdlc-flow` | End-to-end ticket delivery (`stage begin -> TDD -> stage pre-pr -> gate -> stage complete`) |
| **`sdlc-product`** | **Macro Autopilot** | `sdlc-product` | Spec/PRD-to-DAG autopilot (`PRODUCT.md`, `docs/specs/*.md`, topological waves) |
| **`sdlc-doctor`** | **Ops & Diagnostics** | Replaces `sdlc-init` | `install`, `detect`, `doctor --fix`, `hooks install`, `archlens scaffold`, `interop export` |
| **`sdlc-status`** | **Ops & Diagnostics** | New verb skill | Read-only `session dashboard`, `drift check`, `arch diff`, `stats`, and `audit verify` |
| **`sdlc-tdd`** | **Stage Action** | `sdlc-tdd` | Red-Green-Refactor TDD + `test --affected-only`, `coverage`, `mutation`, `reproduce` |
| **`sdlc-gate`** | **Stage Action** | Replaces `sdlc-review-gate` | Parallel Fork-Join PR review (`review plan` + `invoke_subagent`) + `gate --strict` + `review record` |
| **`sdlc-adr`** | **Stage Action** | New verb skill | `adr create`, `adr list`, `adr decide`, `adr compact`, `drift check`, and `decision-graph sync` |
| **`sdlc-wiki`** | **Stage Action** | Added in `CAP-11` | `readme <init\|audit>`, `wiki <sync\|audit\|map>`, and `llms.txt` synchronization |
| **`sdlc-release`** | **Stage Action** | `sdlc-release` | Docs/`CHANGELOG.md`/`wiki/` sync, `proof generate`, `release <patch\|minor\|major>`, `watchdog` |

## 3. Acceptance Criteria
1. `CANONICAL_SDLC_SKILLS` contains exactly the 10 `sdlc*` skills (`sdlc`, `sdlc-adr`, `sdlc-doctor`, `sdlc-flow`, `sdlc-gate`, `sdlc-product`, `sdlc-release`, `sdlc-status`, `sdlc-tdd`, `sdlc-wiki`) with valid tool schemas (`read_file`, `write_file`, `edit_file`, `run_command`, `invoke_subagent`).
2. `DEPRECATED_SDLC_SKILLS` in `.agent/scripts/lib/installer.mjs` is strictly restricted to retired `sdlc-*` framework skills (`14` entries) so `install` and `install --global` never delete or alter standalone non-`sdlc*` coding-persona or third-party skills (`ADR-011`).
