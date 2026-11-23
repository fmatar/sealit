# Product Requirements Document (PRD): `sealit` (v0.0.1)

## 1. Meta & Traceability
- **Product Title**: Sealit Alignment + Proof Kernel (`sealit` · [sealit.dev](https://sealit.dev))
- **Version**: `0.0.1`
- **Constitutional Source of Truth**: [`PRODUCT.md`](../PRODUCT.md)
- **Companion System Specification**: [`docs/SRS.md`](./SRS.md)
- **Status**: `ACTIVE`

## 2. Problem Alignment
- **Problem Statement**: AI coding agents write code rapidly while frequently drifting from specifications, skipping edge-case tests, violating module boundaries, or claiming verification passed without fresh execution proof.
- **Target Audience**: Developers and engineering teams using AI coding agents (`Antigravity`, `Claude Code`, `Cursor`, `Codex`, `GitHub Copilot`) across JavaScript/TypeScript, Rust, Python, Go, and Java/Kotlin repositories.
- **Value Proposition**: Provides a lightweight, zero-dependency CLI and 6-skill suite that mechanically verifies spec/ADR alignment, Concentric Clean Architecture boundaries, diff test coverage, and diff mutation scores, sealing the verified state into an HMAC-SHA256 merge receipt.

## 3. Scope & Product Capabilities (`CAP-01` .. `CAP-06`)
### In Scope
- **CAP-01**: Git Flow branch protection, linked `git worktree` support, and 4-Layer Git hooks ([`docs/specs/cap-01-git-and-worktree-guard.md`](./specs/cap-01-git-and-worktree-guard.md)).
- **CAP-02**: Schema-validated `.agent/sealit-config.json` and shell-free `execFileSync` command execution ([`docs/specs/cap-02-config-and-shell-free-execution.md`](./specs/cap-02-config-and-shell-free-execution.md)).
- **CAP-03**: Spec/manifest/contract drift detection, human-approved ADRs, and [Archlens](https://github.com/fmatar/archlens) concentric ring & cycle governance ([`docs/specs/cap-03-spec-adr-and-ring-alignment.md`](./specs/cap-03-spec-adr-and-ring-alignment.md)).
- **CAP-04**: Single-path (`docs-only` vs `code`) quality gate measuring real coverage/mutation reports and scanning diffs for leaked secrets ([`docs/specs/cap-04-single-path-measured-gate.md`](./specs/cap-04-single-path-measured-gate.md)).
- **CAP-05**: Append-only SHA-256 hash chain (`docs/AUDIT_CHAIN.jsonl`) and multi-topology HMAC-SHA256 Stage 7 merge receipts ([`docs/specs/cap-05-cryptographic-merge-receipts.md`](./specs/cap-05-cryptographic-merge-receipts.md)).
- **CAP-06**: 6 canonical `sealit*` skills (`sealit`, `sealit-spec`, `sealit-adr`, `sealit-tdd`, `sealit-gate`, `sealit-flow`), symlink-safe local/global installer, and read-only `doctor` ([`docs/specs/cap-06-canonical-skills-and-installer.md`](./specs/cap-06-canonical-skills-and-installer.md)).

### Out of Scope (Non-Goals in OSS Kernel)
- Embedded HTTP UI servers or visual dashboards (delegated to [Archlens](https://github.com/fmatar/archlens) or commercial cloud telemetry).
- Issue-tracker synchronization, local Kanban Markdown mirrors, or automated prose/wiki generators.
- Bundling or modifying third-party skills outside the `sealit*` (and retired `sdlc*`) namespace.

## 4. Core User Flows
1. **Onboarding (`sealit init`)**: `npx --yes github:fmatar/sealit init` (or `npx sealit init`) detects project stacks, generates `.agent/sealit-config.json` and `.archlens/policy.json`, installs SHA-256 verified Git hooks and `.github/workflows/sealit-quality-gate.yml`, and provisions selected agent skills.
2. **Branch Delivery (`sealit-flow`)**: `sealit begin --checkout` -> `sealit-spec` / `sealit-adr` (`sealit drift`) -> `sealit-tdd` (`test`, `coverage`, `mutation`) -> `sealit-gate` (`gate`, independent review, `review record --verdict approve`, `verify`) -> `sealit end`.

## 5. Quality & Security Guardrails
- **Runtime Floor**: Node.js `>= 22.0.0`, zero runtime npm dependencies, package tarball `< 120 kB`, and `<= 850` LOC per kernel module.
- **Invariants**: Enforces `INV-01` through `INV-04` as defined in [`PRODUCT.md`](../PRODUCT.md).
