# Changelog

All notable changes to `sealit` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.1] - 2026-11-23

### Added
- **Initial `sealit` Release (`https://sealit.dev`, `ADR-026`)**: Unified package (`sealit`), repository (`fmatar/sealit`), CLI (`sealit` / `.agent/scripts/sealit-engine.mjs`), Claude Code plugin (`.claude-plugin/plugin.json`), and 6 canonical skills (`sealit`, `sealit-spec`, `sealit-adr`, `sealit-tdd`, `sealit-gate`, `sealit-flow`) on a clean `0.0.1` Semantic Versioning baseline.
- **8-Module Alignment + Proof Kernel**: Zero-dependency Node.js (`>= 22.0.0`) Concentric Clean Architecture runtime (`git.mjs`, `config.mjs`, `receipt.mjs`, `drift.mjs`, `measure.mjs`, `guard.mjs`, `install.mjs`, `sealit-engine.mjs`) enforcing 4-Layer Git Flow guards (`INV-01`), commit-object git plumbing (`Git >= 2.38`), monotonic gate floors, and shell-free `execFileSync` command execution (`INV-04`).
- **Two-Track Multi-Agent Installation**: Supports standalone skill provisioning via `npx skills add fmatar/sealit` alongside full Proof Kernel repository scaffolding via `npx --yes github:fmatar/sealit init` across Antigravity, Claude Code, Cursor, Codex, and GitHub Copilot.
- **Polyglot Measured Gate & Stage 7 Cryptographic Merge Receipts**: Parses LCOV, Jest/Vitest, JaCoCo, Cobertura, Go cover, Stryker, PITest, `mutmut`, `cargo-mutants`, and `go-mutesting` reports, runs orthogonal 2-axis cold review (`sealit review plan`), and signs `HEAD`-bound HMAC-SHA256 receipts into `docs/AUDIT_CHAIN.jsonl`.
