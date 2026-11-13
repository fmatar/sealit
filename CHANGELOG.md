# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.1] - 2026-11-12

### Added
- **Universal SDLC Engine & 10 Canonical Skills (`sdlc*`)**: Zero-dependency Node.js governance engine (`.agent/scripts/sdlc-engine.mjs` + 16 modular domain libraries across 4 concentric Clean Architecture rings) paired with 10 canonical `sdlc*` skills (`sdlc` router, `sdlc-flow`, `sdlc-product`, `sdlc-doctor`, `sdlc-status`, `sdlc-tdd`, `sdlc-gate`, `sdlc-adr`, `sdlc-wiki`, `sdlc-release`) and strict `sdlc*` namespace isolation so standalone coding-persona or design skills remain untouched.
- **Risk-Proportional Execution Lanes (`trivial` / `standard` / `full`)**: Deterministic change triage (`triageChange`, `sdlc-engine.mjs triage`) scaling verification ceremony to change risk, with automatic diff re-triage escalation, audited downward lane overrides, and lane-scaled PR review plans.
- **4-Layer Git Guard & Cryptographic Audit Chain**: Client-side SHA-256-verified Git hooks (`pre-commit`, `pre-merge-commit`, `pre-push`), GitHub branch protection helper (`protect`), and HMAC-SHA256 signed Stage 7 gate receipts persisted in an append-only hash chain (`docs/AUDIT_CHAIN.jsonl`).
- **Config-Driven Polyglot Dual-Gate TDD & Security**: Real coverage (`lcov`, `coverage-summary.json`, `jacoco.csv`, `coverage.xml`, `coverage.out`) and mutation (Stryker `mutation.json`, PITest `mutations.xml`) parsers governed by `.agent/sdlc-config.json`, shell-free `execFileSync` command execution (`parseCommandArgv` / `runConfiguredCommand`), secret/CVE diff scanning, and SkillSpector skill hygiene checks (`skill-audit`).
- **Product Constitution, Spec-Drift Sentinel & ADR Lifecycle**: `PRODUCT.md` autopilot, Two-Tier `docs/PRD.md` + IEEE 29148 `docs/SRS.md` specification scaffolding, topological DAG wave planning, structural `package.json` & spec drift detection (`drift check`), and ADR compaction (`adr compact`).
- **Archlens Clean Architecture, 10–30–90 README & AST-to-Wiki Sync**: Concentric ring policy enforcement (`.archlens/policy.json`, `arch diff`), deterministic AST-to-Wiki synchronization (`wiki sync`, `wiki audit --strict`), tiered 10–30–90 developer landing page scaffolding & auditing (`readme init`, `readme audit --strict`), and token-authenticated loopback Clearinghouse Ledger UI (`serve`, `ui-snapshot`).
- **Multi-Agent Installer & Multi-Provider PM Parity**: Interactive & non-interactive installer (`npx github:fmatar/agentic-sdlc-framework install`) for Gemini/Antigravity, Claude Code & Cowork (`.zip` bundles + `.claude-plugin/plugin.json`), Cursor, Grok, Windsurf, and GitHub Copilot, plus 4-operation ticket parity across GitHub Issues, Linear, Jira, and local `docs/KANBAN.md`.
