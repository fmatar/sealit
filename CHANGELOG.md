# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.2] - 2026-11-15

### Added
- **Canonical Git Flow & Automated Production Release**: Standardized on canonical Git Flow: feature, bugfix, and chore PRs merge into `develop` (`--base develop`), while PRs targeting `main` must originate exclusively from `develop` (enforced by `verifyMergeGuard`, `enforce-branch-flow.yml`, and `sdlc-quality-gate.yml`). Merging `develop` into `main` automatically triggers `.github/workflows/release.yml`, validating `gate --strict`, creating git tag `v${VERSION}`, extracting release notes from `CHANGELOG.md`, and creating the GitHub Release.
- **Diff-Scoped Polyglot Mutation Execution & Parallel Suite Split (`ADR-018`, #136)**: Expanded mutation coverage across `.agent/scripts/lib/**/*.mjs`, added diff-hunk scoped execution (`buildMutationExecutionPlan`, `--full` override, Stryker `--incrementalFile`, paired-test mapping, and fail-closed `receiptInputsFromSession` / `diff-zero-mutants` guards), added non-deadlocking worker concurrency for `runFlakeCheck` / `runFlakeCheckParallel`, split `tests/hardening.test.mjs` into 4 parallel files, and tightened git env isolation (`cleanGitEnv`, `-C` anchoring).

### Changed
- **CI Runner Routing & Node 24 GitHub Actions**: Configured `SDLC_RUNS_ON=local-archlens` for repository workflows and upgraded `.github/workflows/sdlc-quality-gate.yml`, `.github/workflows/publish-wiki.yml`, and `installCIWorkflow()` templates from `actions/checkout@v4` / `actions/setup-node@v4` to `@v7` (`node-version: 'lts/*'`), eliminating Node.js 20 deprecation warnings.
- **Opt-In Remote Issue Creation (`stage begin`)**: `stage begin` no longer creates remote GitHub/Linear/Jira issues automatically when `--issue` is omitted; callers pass `--issue <id>`, `--local` (local `L-*` session across `standard`/`full` lanes), `--lane trivial`, or explicit `--create-issue`.
- **Universal ADR Approval Gate (`createADR`)**: All ADR scopes (`technical`, `architectural`, `product`, `contract`) now initialize in `pending_approval` and require explicit `adr decide --status approve` before satisfying `drift check` or `adr compact` (with support for local `L-*` and string PM ticket IDs).
- **Inline Unified Diff Reviewer Context (`review plan`)**: `generateReviewPlan` now embeds `baseSha`/`headSha`, full changed file paths, `--stat`, and a bounded unified `git diff` directly into every read-only subagent prompt across `standard` and `full` lanes.

### Fixed
- **Fail-Closed Release Execution (`executeRelease`)**: `release` now refuses protected branches (`main`, `develop`, `master`, detached `HEAD`), runs `gate --strict` instead of `gate`, checks pre-existing tags before mutating manifests, syncs `package-lock.json` and `.claude-plugin/plugin.json`, supports `--no-tag`, and throws immediately on `git add` / `commit` / `tag` failures instead of swallowing errors.

## [0.0.1] - 2026-11-12

### Added
- **Universal SDLC Engine & 10 Canonical Skills (`sdlc*`)**: Zero-dependency Node.js governance engine (`.agent/scripts/sdlc-engine.mjs` + 16 modular domain libraries across 4 concentric Clean Architecture rings) paired with 10 canonical `sdlc*` skills (`sdlc` router, `sdlc-flow`, `sdlc-product`, `sdlc-doctor`, `sdlc-status`, `sdlc-tdd`, `sdlc-gate`, `sdlc-adr`, `sdlc-wiki`, `sdlc-release`) and strict `sdlc*` namespace isolation so standalone coding-persona or design skills remain untouched.
- **Risk-Proportional Execution Lanes (`trivial` / `standard` / `full`)**: Deterministic change triage (`triageChange`, `sdlc-engine.mjs triage`) scaling verification ceremony to change risk, with automatic diff re-triage escalation, audited downward lane overrides, and lane-scaled PR review plans.
- **4-Layer Git Guard & Cryptographic Audit Chain**: Client-side SHA-256-verified Git hooks (`pre-commit`, `pre-merge-commit`, `pre-push`), GitHub branch protection helper (`protect`), and HMAC-SHA256 signed Stage 7 gate receipts persisted in an append-only hash chain (`docs/AUDIT_CHAIN.jsonl`).
- **Config-Driven Polyglot Dual-Gate TDD & Security**: Real coverage (`lcov`, `coverage-summary.json`, `jacoco.csv`, `coverage.xml`, `coverage.out`) and mutation (Stryker `mutation.json`, PITest `mutations.xml`) parsers governed by `.agent/sdlc-config.json`, shell-free `execFileSync` command execution (`parseCommandArgv` / `runConfiguredCommand`), secret/CVE diff scanning, and SkillSpector skill hygiene checks (`skill-audit`).
- **Product Constitution, Spec-Drift Sentinel & ADR Lifecycle**: `PRODUCT.md` autopilot, Two-Tier `docs/PRD.md` + IEEE 29148 `docs/SRS.md` specification scaffolding, topological DAG wave planning, structural `package.json` & spec drift detection (`drift check`), and ADR compaction (`adr compact`).
- **Archlens Clean Architecture, 10–30–90 README & AST-to-Wiki Sync**: Concentric ring policy enforcement (`.archlens/policy.json`, `arch diff`), deterministic AST-to-Wiki synchronization (`wiki sync`, `wiki audit --strict`), tiered 10–30–90 developer landing page scaffolding & auditing (`readme init`, `readme audit --strict`), and token-authenticated loopback Clearinghouse Ledger UI (`serve`, `ui-snapshot`).
- **Multi-Agent Installer & Multi-Provider PM Parity**: Interactive & non-interactive installer (`npx github:fmatar/agentic-sdlc-framework install`) for Gemini/Antigravity, Claude Code & Cowork (`.zip` bundles + `.claude-plugin/plugin.json`), Cursor, Grok, Windsurf, and GitHub Copilot, plus 4-operation ticket parity across GitHub Issues, Linear, Jira, and local `docs/KANBAN.md`.
