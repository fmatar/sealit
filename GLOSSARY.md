# Domain Glossary: `sealit`

Canonical terminology for the Sealit Alignment + Proof Kernel ([sealit.dev](https://sealit.dev)). Use these exact terms across specs, ADRs, skills, tests, and PR descriptions.

## Core Concepts

- **Proof Kernel**: The 8-module zero-dependency runtime in `.agent/scripts/` enforcing branch guards, spec/ADR alignment, concentric ring topology, measured diff gates, and cryptographic receipts.
  _Avoid_: workbench server, workflow engine, backlog manager.
- **Session**: A branch-bound work unit persisted in `.agent/.sealit-session.json` (`sealit begin` $\rightarrow$ `sealit end`), optionally isolated in a linked git worktree against a configured `baseBranch`.
  _Avoid_: sprint, kanban card.
- **Concentric Ring**: A layer in `.archlens/policy.json` (`domain-core`, `governance-models`, `adapters-orchestrators`, `cli-entrypoints`). Dependencies point strictly inward with zero cycles.
  _Avoid_: horizontal tier.
- **Seam**: The public module interface across which callers and behavioral tests exercise logic without coupling to internal helpers.
  _Avoid_: private hook, mock boundary.
- **Spec Drift (`INV-03`)**: Any structural mutation to `PRODUCT.md`, `docs/PRD.md`, `docs/SRS.md`, `docs/specs/*.md`, `.archlens/policy.json`, gate policy files, dependency manifests, DB schemas, or OpenAPI contracts requiring an `accepted` ADR in `docs/adr/`.
  _Avoid_: doc mismatch.
- **Single-Path Gate (`sealit gate`)**: The sole authoritative verification entrypoint evaluating `docs-only` vs. `code` commit trees, scanning diff secrets, and measuring fresh diff coverage and diff-scoped mutation kills into `session.lastGate`.
  _Avoid_: advisory test run.
- **Stage 7 Gate Receipt (`GATE-RECEIPT-*`)**: An HMAC-SHA256 signed record in the append-only SHA-256 hash chain (`docs/AUDIT_CHAIN.jsonl`) binding `headSha`, `treeSha`, `specHash`, `adrHashes`, measured scores, and cold reviewer sign-off.
  _Avoid_: unsigned badge, CI artifact log.
- **Merge Danger (`One-Way` vs. `Two-Way` Door)**: Risk classification of a pull request: `One-Way` when `INV-03` contract, schema, dependency, or policy triggers fire; `Two-Way` when changes remain reversible behind existing module seams.
