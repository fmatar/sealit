# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-17

### Added
- **8-Module Alignment + Proof Kernel (`ADR-019`)**: Consolidated runtime architecture into 8 concentric Clean Architecture modules (`git.mjs`, `config.mjs`, `receipt.mjs`, `drift.mjs`, `measure.mjs`, `guard.mjs`, `install.mjs`, `sdlc-engine.mjs`), each `<= 850` LOC with zero runtime dependencies and Node.js `>= 22.0.0` support.
- **Cryptographic Alignment Binding in Stage 7 Receipts**: `issueGateReceipt` and `verifyGateReceipt` now bind `headSha`, `treeSha`, `specHash`, and `adrHashes` alongside measured `diffCoverage` and `mutationScore`, supporting exact `HEAD`, post-receipt `AUDIT_CHAIN.jsonl` commits, Squash `treeSha` equivalence, and 2-parent clean `--no-ff` merges while blocking evil merges.
- **Canonical `sdlc-spec` Skill & 6-Skill Single-Source Suite**: Added pure-Markdown `sdlc-spec` alignment skill and consolidated `.agent/skills/` onto 6 canonical skills (`sdlc`, `sdlc-spec`, `sdlc-adr`, `sdlc-tdd`, `sdlc-gate`, `sdlc-flow`), pointing `.claude-plugin/plugin.json` directly at `./.agent/skills` and generating agent-specific copies at install time.

### Changed
- **Single-Path Measured Gate (`docs-only` vs `code`)**: Replaced multi-lane session state machines with one `HEAD`-bound `session.lastGate` measurement object, enforcing report `mtimeMs` freshness, `0%` unimported changed source file detection, diff-scoped mutation execution, and diff secret scanning.
- **Linked-Worktree & Symlink-Safe Operations**: `guard.mjs` resolves hooks via `git rev-parse --git-common-dir` for linked `git worktree` support, `git.mjs` strips `NODE_TEST_CONTEXT` and `NODE_V8_COVERAGE` during nested runner execution, and `install.mjs` unlinks pre-existing symlinks before writing files while preserving valid `.agent/sdlc-config.json` files.

### Removed
- **Peripheral & Vendored Bloat (`~80,000+` lines removed)**: Removed embedded loopback HTTP `workbench-server.mjs` and `workbench-assets/`, `pm-provider.mjs` and `docs/KANBAN.md`, `readme-sync.mjs`, `wiki-sync.mjs` and `wiki/*`, `product-dag.mjs`, `arch-trace.mjs` and `docs/ARCH_TRACE.md`, `decision-graph.mjs` and `docs/DECISION_MAP.md`, `dossier.mjs`, synthetic `watchdog`/`proof`/`release` CLI subcommands, duplicate `enforce-branch-flow.yml` and `publish-wiki.yml` workflows, tracked `.claude`/`.cursor` skill mirrors and `.zip` archives, and vendored `impeccable` copies.

### Migration (`v0.0.2` -> `v0.1.0`)
- **CLI Commands**: Use `sdlc begin` / `sdlc end` (or compatibility aliases `stage begin` / `stage complete`), `sdlc status` (`session status`), `sdlc drift`, `sdlc gate`, `sdlc review <plan|record>`, `sdlc receipt`, and `sdlc verify` (`guard verify` / `audit verify`). Removed peripheral commands (`pm`, `ticket`, `serve`, `ui-snapshot`, `wiki`, `readme`, `triage`, `decision-graph`, `dossier`, `watchdog`, `proof`, `release`) exit `2`.
- **Configuration Schema (`.agent/sdlc-config.json`)**: Legacy top-level keys (`lanes`, `gates`, `testing`, `projectManagement`, `profile`, `generatedAt`) are migrated in memory with deprecation warnings; run `node .agent/scripts/sdlc-engine.mjs doctor --fix` to rewrite `.agent/sdlc-config.json` to the `0.1.0` schema while preserving custom module commands and thresholds.
- **Git Hooks & CI Workflows**: Run `node .agent/scripts/sdlc-engine.mjs doctor --fix` (or `sdlc init --yes`) to upgrade all 4 fail-closed Git hooks (`pre-commit`, `pre-merge-commit`, `pre-push`, `post-merge`) and `.github/workflows/sdlc-quality-gate.yml` (which consolidates branch-flow checks from the retired `enforce-branch-flow.yml`).

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
