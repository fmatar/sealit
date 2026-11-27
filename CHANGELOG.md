# Changelog

All notable changes to `sealit` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.2] - 2026-11-26

### Added
- **Dual-Mode Native OpenSSH `SSHSIG` Signing (`ADR-028`)**: Committing `.agent/allowed_signers` on the base branch switches Stage 7 receipts to asymmetric `ssh-keygen -Y` (`SSHSIG`) signatures verified strictly against `baseCommit:.agent/allowed_signers` (blocking HMAC downgrade and PR-injected keys, and binding `reviewer` to the verified principal), while repositories without `.agent/allowed_signers` remain 100% backward-compatible with `HMAC-SHA256`.
- **Polyglot Per-Line Diff Coverage (`parsers.mjs`)**: Added changed-hunk per-line hit parsing for Cobertura XML (`coverage.xml`), JaCoCo XML (`jacoco.xml`), and Go `cover.out`, failing closed when numeric `diffCoverage` encounters summary-only reports (`coverage-summary.json`, `jacoco.csv`) on modified source files.
- **Explicit ADR `files:` Trigger Binding**: `adr create` and `adr decide` auto-populate `files: [...]` frontmatter (with `--files` override and blanket `*`/`**` glob rejection); `checkSpecDrift` requires every drift trigger to be covered by an accepted ADR (and `scope: architectural` for `GATE_POLICY_DRIFT`, `SPEC_DELETED`, and `ADR_MUTATION`).
- **Atomic Stage 7 Sealing (`--commit`)**: Added `--commit` to `review record --verdict approve` and `receipt` to sign, commit `docs/AUDIT_CHAIN.jsonl` through the normal `pre-commit` hook, run `verify`, and emit `prBody` in one command.
- **10-Module Concentric Kernel (`session.mjs`, `parsers.mjs`)**: Extracted Ring 1 `session.mjs` and `parsers.mjs` (`<= 850` LOC per file, zero runtime dependencies) and added `CLAUDE_SEALIT_DENY_RULES` accidental-edit protection for `.agent/.receipt-key` and `.agent/.sealit-session.json`.

### Changed
- **3–5× Faster Local & CI Cycles**: Parallelized the hostile bypass matrix across OS-isolated worker suites (`bypass-corpus.test.mjs`, `bypass-matrix-git.test.mjs`, `bypass-matrix-policy.test.mjs`, `bypass-matrix-config.test.mjs`), sharded `stryker-runner.test.mjs` parity workers, folded env-isolated CI tests into a single `gate --no-cache` pass, decoupled `gate --no-cache` from Stryker `--force` (now `--force-mutation` / `mutation --force`), deduplicated `git` spawns in `runGate`, and replaced `withFileLock` busy-spin with `Atomics.wait`.
- **Hardened Consumer CI & Release Security**: Consumer CI workflows freshly extract `origin/$BASE_REF`'s trusted engine after `npm ci` to execute `config check`, `verify --chain-only`, `skill-audit`, and `gate --no-cache` on PRs, omit the `fmatar/sealit` self-hosted runner guard, and default `DEFAULT_QUALITY_GATE_CHECK` to `"Sealit Quality Gate & Merge Receipt Verification"`; `release.yml` verifies Stage 7 receipts before `npm ci`, drops persisted checkout credentials, and publishes with `--provenance`.
- **Smarter JS/TS Stack Discovery & Cache Integrity**: `detectStack` detects `vitest` (+ coverage), `jest`, `c8`, lockfile package managers, and `tests/`/`test/`/`__tests__`/`src/` test roots; `computeTreeHash` hashes `KERNEL_DIGEST` and effective `modulePolicy` under `withFileLock`; `isEngineOwnerRepo` checks manifest + engine marker files.

## [0.0.1] - 2026-11-23

### Added
- **Initial `sealit` Release (`https://sealit.dev`, `ADR-026`, `ADR-027`)**: Unified scoped package (`@sealit/cli`), repository (`fmatar/sealit`), CLI (`sealit` / `.agent/scripts/sealit-engine.mjs`), Claude Code plugin (`.claude-plugin/plugin.json`), and 6 canonical skills (`sealit`, `sealit-spec`, `sealit-adr`, `sealit-tdd`, `sealit-gate`, `sealit-flow`) on a clean `0.0.1` Semantic Versioning baseline.
- **8-Module Alignment + Proof Kernel**: Zero-dependency Node.js (`>= 22.0.0`) Concentric Clean Architecture runtime (`git.mjs`, `config.mjs`, `receipt.mjs`, `drift.mjs`, `measure.mjs`, `guard.mjs`, `install.mjs`, `sealit-engine.mjs`) enforcing 4-Layer Git Flow guards (`INV-01`), commit-object git plumbing (`Git >= 2.38`), monotonic gate floors, and shell-free `execFileSync` command execution (`INV-04`).
- **Two-Track Multi-Agent Installation**: Supports standalone skill provisioning via `npx skills add fmatar/sealit` alongside full Proof Kernel repository scaffolding via `npx --yes github:fmatar/sealit init` across Antigravity, Claude Code, Cursor, Codex, and GitHub Copilot.
- **Polyglot Measured Gate & Stage 7 Cryptographic Merge Receipts**: Parses LCOV, Jest/Vitest, JaCoCo, Cobertura, Go cover, Stryker, PITest, `mutmut`, `cargo-mutants`, and `go-mutesting` reports, runs orthogonal 2-axis cold review (`sealit review plan`), and signs `HEAD`-bound HMAC-SHA256 receipts into `docs/AUDIT_CHAIN.jsonl`.
