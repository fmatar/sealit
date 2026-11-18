# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- **Human-in-the-loop approvals for Claude Code**: `init` no longer pre-approves `Bash(node .agent/scripts/sdlc-engine.mjs *)`. The generated allowlist covers read/measure commands only; `adr decide`, `review record`, `receipt`, `guard receipt`, `exemption add`, `protect`, `init`, `hooks`, `ci-workflow` and `doctor --fix` prompt. Existing settings containing the legacy wildcard are migrated in place (other rules preserved); symlinked settings that point outside the project/home are never rewritten. *Limit:* this only holds while file edits are also gated — an agent that can write code and tests freely can still reach signing code through `test`/`gate`, and can read the local receipt key. CI-held signing keys are planned for v0.2.
- **ADR frontmatter injection**: `adr create` rejects `--ticket` / `--supersedes` values that could inject YAML lines (e.g. a second `status: accepted`), and duplicate frontmatter keys now resolve to the first occurrence, so an ADR can no longer be created pre-approved.
- **Worktree containment**: `begin --worktree` only accepts a new non-dot directory directly under the repository's parent (`../<name>`) or `<repo>/.worktrees/<name>`, resolved via `realpath` so symlinked parents cannot escape (prevents checking agent-controlled files into `~/.claude/commands`, `~/Library/LaunchAgents`, or sibling repositories).
- **Receipt verification before PR code runs**: the generated `sdlc-quality-gate.yml` verifies the Stage 7 receipt (with the base branch's engine) before `npm ci`, tests or the gate execute PR code, and checks out with `persist-credentials: false` (workflows that need a persisted token for a later push step must re-add it; `doctor --fix` treats its absence as an upgrade). `doctor --fix` upgrades workflows using the old step order.

### Fixed
- **Parallel worktree sessions**: local `L-N` session ids are reserved inside the session lock, so concurrent `begin` runs never collide; failed `begin` runs release their reservation, and an explicit `--issue` can never take over an in-flight reservation.
- **`sdlc end` no longer closes another agent's session**: without `--issue` it only closes the session bound to the current branch (skills now use `end --issue <id>` after merge).
- **`post-merge` cleanup**: only deactivates sessions whose branch was brought in by that merge (ancestor of `HEAD`, not of `ORIG_HEAD`), so pulling `develop` no longer deactivates fresh worktree sessions.
- **setup-node cache**: the generated workflow sets `cache: 'npm'` only when `package-lock.json` / `npm-shrinkwrap.json` exists (the workflow installs with npm; pnpm/yarn caches would need extra tooling and yarn-berry would run repository code before receipt verification). `doctor` only flags a cache line that cannot work, so user customizations are not regenerated away.
- **`init` never silently replaces an invalid config**: an invalid or malformed `.agent/sdlc-config.json` is left untouched with a warning; `--force` writes `.agent/sdlc-config.json.bak` (atomically, never through a planted symlink, and never copying a symlinked config's target) before regenerating.
- **Audit ledger append**: appending to `docs/AUDIT_CHAIN.jsonl` without a trailing newline no longer corrupts the chain.

## [0.1.0] - 2026-11-17

### Added
- **8-Module Alignment + Proof Kernel (`ADR-019`)**: Consolidated runtime architecture into 8 concentric Clean Architecture modules (`git.mjs`, `config.mjs`, `receipt.mjs`, `drift.mjs`, `measure.mjs`, `guard.mjs`, `install.mjs`, `sdlc-engine.mjs`), each `<= 850` LOC with zero runtime dependencies and Node.js `>= 22.0.0` support.
- **Cryptographic Alignment Binding in Stage 7 Receipts**: `issueGateReceipt` and `verifyGateReceipt` now bind `headSha`, `treeSha`, `specHash`, and `adrHashes` alongside measured `diffCoverage` and `mutationScore`, supporting exact `HEAD`, post-receipt `AUDIT_CHAIN.jsonl` commits, Squash `treeSha` equivalence, and 2-parent clean `--no-ff` merges while blocking evil merges.
- **Canonical `sdlc-spec` Skill & 6-Skill Single-Source Suite**: Added pure-Markdown `sdlc-spec` alignment skill and consolidated `.agent/skills/` onto 6 canonical skills (`sdlc`, `sdlc-spec`, `sdlc-adr`, `sdlc-tdd`, `sdlc-gate`, `sdlc-flow`), pointing `.claude-plugin/plugin.json` directly at `./.agent/skills` and generating agent-specific copies at install time.

### Changed
- **Single-Path Measured Gate (`docs-only` vs `code`)**: Replaced multi-lane session state machines with one `HEAD`-bound `session.lastGate` measurement object, enforcing report `mtimeMs` freshness, `0%` unimported changed source file detection, diff-scoped mutation execution, and diff secret scanning.
- **Linked-Worktree & Symlink-Safe Operations**: `guard.mjs` resolves hooks via `git rev-parse --git-common-dir` for linked `git worktree` support, `git.mjs` strips `NODE_TEST_CONTEXT` and `NODE_V8_COVERAGE` during nested runner execution, and `install.mjs` replaces external symlinks safely while preserving valid `.agent/sdlc-config.json` files.

### Security
- **Rename-Blind Drift & `docs-only` Classification**: Added `--no-renames` to `getModifiedFiles` and `isAuditOnlyCommitRange` diff queries so `git mv` of governance files (`PRODUCT.md`, `docs/specs/*`, `.archlens/policy.json`, `docs/AUDIT_CHAIN.jsonl`) or source files cannot bypass `SPEC_DELETED` drift checks or misclassify code deletions as `docs-only`.
- **Accepted-at-Base ADR Governance Rule (`INV-03`)**: `checkSpecDrift` now excludes ADRs that already carried `status: accepted` at `mergeBase` from governing new drift and emits `ADR_MUTATION`, ensuring new/changed specs, dependencies, schemas, or contracts require a new accepted ADR.
- **Diff-Config Immunity & Secret-Scan Backstop**: `getUnifiedDiffByFile` applies `SAFE_DIFF_FLAGS` (`--no-ext-diff`, `--no-textconv`, `--no-renames`, `--src-prefix=a/`, `--dst-prefix=b/`) and literal `:(literal)` pathspecs while `cleanGitEnv` strips `GIT_EXTERNAL_DIFF`/`GIT_DIFF_OPTS`, preventing user diff settings (`diff.noprefix`, `diff.mnemonicPrefix`, `diff.external`) or `:!` filenames from blinding secret scanning or diff coverage; `scanDiffSecrets` also fails closed (`SCAN_ERROR`) when a modified on-disk text file lacks a unified diff entry.
- **Restored Managed `.gitignore` & `doctor` Audit**: Restored `upsertGitignore` (`SDLC_GITIGNORE_ENTRIES` including `.agent/.sdlc-session.json`, `.agent/.receipt-key`, lockfiles, `.agent/.cache/`, and `.stryker-tmp/`) in `installFramework` and `runDoctor --fix`, with `inspectGitignore` flagging missing critical ignore entries in `sdlc doctor`.
- **Symlink-Preserving User-File Updates**: `upsertMarkedRulesFile` and `upsertGitignore` resolve and write through in-repo / in-home instruction and `.gitignore` symlinks (e.g., `CLAUDE.md -> AGENTS.md`) rather than unlinking them, while continuing to unlink and warn on symlinks pointing outside the allowed root.

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
