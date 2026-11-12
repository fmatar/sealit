# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **10–30–90 Developer Landing Page `README.md` Template & Engine (`CAP-11`, `ADR-001`)**: Added `docs/templates/README_TEMPLATE.md` and Ring 1 module `.agent/scripts/lib/readme-sync.mjs` (`node .agent/scripts/sdlc-engine.mjs readme <init|audit> [--archetype <auto|cli|sdk|platform>] [--strict]`). Scaffolds progressive-trust developer landing pages (`10s Orient` -> `30s Believe` -> `90s Run`) alongside theme-aware wordmark SVGs (`docs/logo-light.svg`, `docs/logo-dark.svg`), `llms.txt`, and Charmbracelet VHS `docs/demo.tape`.
- **Tiered README Anti-Pattern Gate Enforcement (`ADR-001`)**: Wired `auditReadme` into `gate --strict` to block hard anti-patterns (`MISSING_README`, `LEFTOVER_TEMPLATE_TOKEN`, `BADGE_CHRISTMAS_TREE` > 4 badges, `GIT_CLONE_FIRST_QUICKSTART`, `BROKEN_README_LINK`, and `MISSING_CORE_SECTIONS`) while surfacing non-blocking `WARN`s for optional polish (`MISSING_THEME_AWARE_LOGO`, `NON_NEUTRAL_MERMAID`, `MISSING_LLMS_TXT_LINK`, `INLINE_BLOAT_BUDGET` > 180 visible lines).

### Changed
- **Dogfooded Root `README.md`, `CONTRIBUTING.md`, `llms.txt` & Multi-Agent Skills (`ADR-001`)**: Refactored root `README.md` into a 67-visible-line 10–30–90 landing page with `<picture>` dark/light wordmarks, neutral-themed Mermaid diagram, and `<details>` progressive disclosure; moved contributor setup into `CONTRIBUTING.md`; and synchronized `sdlc`, `sdlc-wiki`, `sdlc-product`, and `sdlc-release` across `.agent/skills/` and `.claude/` dialects.
- **Config-Driven Dual-Gate Baseline & Real Concentric Ring Policy (`#103`, `ADR-002`)**: Updated `PRODUCT.md` (`INV-02`) and `CONSTITUTIONAL_RULES_SUMMARY` to make `.agent/sdlc-config.json` the single source of truth for coverage and mutation thresholds, mapped `.archlens/policy.json` to the 4 real concentric layers of `.agent/scripts/`, and widened `stryker.config.json` mutation coverage to include `.agent/scripts/lib/git-guard.mjs`.

### Fixed
- **Truthful CLI Output Formatters, Complete `help` & Honest Session Telemetry (`#103`)**: Fixed `formatCLIResult` field mismatches for `audit verify`, `audit record`, `skill-audit`, `adr create`, `drift check`, and `review plan`; expanded `sdlc-engine.mjs help` across all CLI command groups; updated `auditSkills` to include `ub-mode`; fixed `calculateSessionStats` so zero-session workspaces report `$0` instead of historical trace-inflated savings and label ROI figures as estimates; fixed `gate --strict` passing modified files into `assessRisk`; and added SHA-256 Git hook drift detection (`inspectHooksHealth`) to `doctor` (`--fix`).

## [0.3.2] - 2026-11-08

### Added
- **Automatic GitHub Pull Request Discovery & Creation in `stage pre-pr` (`#99`)**: Added `resolveOpenPRNumber` and `ensurePullRequest` in `.agent/scripts/lib/pm-provider.mjs` and wired them into `executeCompositeStage({ action: 'pre-pr' })` in `.agent/scripts/lib/session.mjs`. Running `stage pre-pr` now pushes the active feature branch to `origin`, discovers or creates the GitHub Pull Request (`gh pr view` / `gh pr create`), and persists `prNumber` and `prUrl` in `.agent/.sdlc-session.json`.
- **Consolidated 4-Section PR Review Comment Formatter (`#99`)**: Added `formatConsolidatedReviewComment` in `.agent/scripts/lib/pm-provider.mjs` and upgraded `review record` in `.agent/scripts/sdlc-engine.mjs` to accept `--peer-review`, `--arch-review`, `--body`, and `--pr`, sign the Stage 7 cryptographic receipt (`GATE-RECEIPT-#...`), and publish a 4-section Markdown review comment (Verdict Header, Subagent 1 TDD & Clean Code Review, Subagent 2 Architecture & Security Gatekeeper, and Strict 9-Pillar Quality Gate Table) directly to the open GitHub Pull Request.

### Fixed
- **PR-Only Comment Routing & Fail-Loud GitHub Publishing (`#99`)**: Updated `postPMComment` in `.agent/scripts/lib/pm-provider.mjs` and `hasGitHubRemote` in `.agent/scripts/lib/core.mjs` so review comments post exclusively to `gh pr comment <prNumber>` when an open PR exists (eliminating duplicate issue comments) and fail loudly (`success: false` / exit non-zero) when a GitHub remote is configured and `gh` fails, instead of silently swallowing errors into `docs/KANBAN.md`.

## [0.3.1] - 2026-11-06

### Fixed
- **Claude Desktop & Claude Code Skill Discovery (`#97`)**: Resolved skill discovery rejection in Claude Desktop and Claude Code by mapping Antigravity tool primitives to Claude-native tools via `CLAUDE_TOOL_MAP` (`Read`, `Write`, `Edit`, `Bash`, `Agent`, `Glob`, `Grep`), stripping non-standard attributes (`user-invocable`), translating inline markup, and generating clean `allowed-tools` frontmatter in `.claude/skills/*/SKILL.md` and `.claude/commands/*.md`.
- **Non-Destructive Rules File Merging (`#97`)**: Added `mergeRulesFile` in `.agent/scripts/lib/installer.mjs` to preserve existing `CLAUDE.md` and `.cursorrules` content while maintaining constitutional SDLC governance invariants within a bounded block.
- **Claude Code Engine Permissions (`#97`)**: Added both wildcard and colon permission patterns (`Bash(node .agent/scripts/sdlc-engine.mjs *)` and `Bash(node .agent/scripts/sdlc-engine.mjs:*)`) to `.claude/settings.json`.

## [0.3.0] - 2026-11-04
### Added
- **First-Class ADR Lifecycle Compaction (`adr compact` & Release Auto-Compaction, `#95`)**: Added `compactADRs({ releaseVersion, dryRun, repoRoot })` in `.agent/scripts/lib/adr-drift.mjs` and `node .agent/scripts/sdlc-engine.mjs adr compact [--release <version>] [--dry-run]`. Consolidates accepted in-flight `docs/adr/ADR-*.md` patch files into `docs/SRS.md` (`## Compacted Architectural Decisions`), resets the `PRODUCT.md` ADR index block, deletes compacted ADR files, prunes `.agent/decision-graph.jsonl`, appends an immutable `ADR_BATCH_COMPACTED` record to `docs/AUDIT_CHAIN.jsonl`, and refreshes `docs/DECISION_MAP.md`. `executeRelease` now runs `compactADRs` automatically before cutting a release unless `--no-compact` is passed, and `checkSpecDrift` recognizes valid ADR compaction diffs.
- **Claude Code & Cowork Account Skill Bundles (`#94`)**: Added `adaptSkillForAgent`, `createSkillZipBuffer`, `upsertConstitutionalRulesFile`, and `upsertClaudeSettingsJson` in `.agent/scripts/lib/installer.mjs`. Provisions `.claude/skills/*/SKILL.md`, `.claude/commands/*.md`, `.claude-plugin/plugin.json`, and uploadable `.claude/cowork/<skill>.zip` bundles with runtime-neutral frontmatter and no foreign `<agent-embed>` tags, while non-destructively updating `CLAUDE.md` and `.claude/settings.json`.
- **Deterministic CLI Stdout Formatting (`formatCLIResult`, `#94`)**: Added `formatCLIResult` in `.agent/scripts/sdlc-engine.mjs` so all CLI subcommands (`session`, `stage`, `drift`, `adr`, `decision-graph`, `ui-snapshot`, `serve --snapshot-only`, `skill-audit`, `audit`, `stats`, `cache`, `ticket`/`pm`, `product`, `release`, `exemption`) print human-readable status lines or `--json` output.

### Fixed
- **Non-Destructive `product spec` (`#95`, Bug A)**: `scaffoldCapabilitySpec` in `.agent/scripts/lib/product-dag.mjs` no longer overwrites existing `docs/PRD.md`, `docs/SRS.md`, or `docs/specs/<cap>.md` unless `--force` is passed; instead, it surgically inserts new `CAP-XX` capability bullets, matrix rows, and functional requirement subsections into existing PRD/SRS documents.
- **Gate Receipt Parameter Aliases & `docsOnly` Mode (`#95`, Bug B)**: `issueGateReceipt` in `.agent/scripts/lib/audit-chain.mjs` and `receiptInputsFromSession` in `.agent/scripts/lib/session.mjs` accept both `coveragePct`/`coverage` and `mutationPct`/`mutationScore` plus `docsOnly: true` (`--docs-only`), recording `null` metrics for docs-only changes without fabricating `85`/`80` defaults. `guard receipt` now parses `--coverage`, `--mutation`, `--docs-only`, and `--reviewer`.
- **Forward `depends_on` Edges & Deduplicated `linksTo` in Decision Graph (`#95`, Bug C)**: Fixed `buildDecisionGraph` in `.agent/scripts/lib/decision-graph.mjs` to emit `CAP-02 -->|depends_on| CAP-01` in the right direction, map `CAPABILITY_SPEC_SCAFFOLDED`/`CAPABILITY_REGISTERED` `linksTo` to `depends_on`, and skip `#ticket` links on `ADR_CREATED`/`ADR_DECIDED`.
- **6-Column Kanban Traceability Matrix Preservation (`#95`, Bug D)**: Fixed `updateLocalKanbanState` in `.agent/scripts/lib/pm-provider.mjs` to distinguish 5-column `Board Overview` rows (`cells.length === 7`) from 6-column `End-to-End Traceability Matrix` rows (`cells.length === 8`), updating `status:<state>` in place without truncating columns 5 and 6.
- **First-Time `wiki sync` Scaffolds `Skills-Reference.md` (`#95`, Bug E)**: Updated `syncWiki` in `.agent/scripts/lib/wiki-sync.mjs` to automatically scaffold `wiki/Home.md`, `wiki/Architecture.md`, `wiki/Skills-Reference.md`, and `wiki/Traceability.md` when missing so `wiki sync && wiki audit --strict` passes out-of-the-box on fresh repositories.
- **Detached Workbench Spawn, `@fmatar/archlens-skill@1.2.0` Pinning & `.gitignore` Hygiene (`#95`, Bug F)**: Updated `ensureWorkbenchRunning` in `.agent/scripts/lib/workbench-server.mjs` to enforce `stdio: 'ignore'`, `detached: true`, and `child.unref()`, pinned `@fmatar/archlens-skill@1.2.0` across `.mcp.json`, `installer.mjs`, and `sdlc-engine.mjs`, and added `upsertGitignore` in `installer.mjs`.

## [0.2.0] - 2026-11-03
### Security
- **Shell injection via filenames fixed (#91, `ADR-008`)**: `security-audit`, `arch diff`, contract drift, gate cache hashing, receipt verification, flake/affected test runs, worktree pruning, release tagging and branch protection now call `git`/test runners with `execFileSync` argv arrays. A file named `$(cmd).js` can no longer execute. A regression test bans interpolated `execSync` template literals in engine sources.
- **Workbench locked down (#91, `ADR-008`)**: `serve` binds `127.0.0.1` only, requires a random per-run token (printed at start) on every request including SSE, rejects foreign `Origin`/`Host` headers (no more `Access-Control-Allow-Origin: *`), so human-only ADR approval via `POST /api/adr/decide` needs the token. `stage begin`/`pre-pr` no longer spawn a detached workbench daemon.

### Fixed
- **Exit codes honoured (#91)**: the CLI exits non-zero when a command reports `success: false`; unknown commands exit 2. Git hooks no longer end with an unconditional `exit 0`, so `pre-commit` really blocks commits on `main`/`develop` or without an active session, and `pre-merge-commit` really requires a receipt bound to `MERGE_HEAD`.
- **Gate receipts attest measured values (#91)**: removed the `85`/`80`/`approved` defaults and fixed the `coverage`/`mutationScore` key mismatch in `stage pre-pr`; receipts are built from the session manifest and refused when anything is unmeasured. Added `review record --verdict --reviewer`. Receipts are HMAC-SHA256 signed with `.agent/.receipt-key` (gitignored) or `SDLC_RECEIPT_KEY`. The ledger is now described as a hash chain, not a Merkle tree (`chainHead`; `merkleRoot` kept as a deprecated alias).
- **Coverage/mutation gates fail closed (#91)**: a missing or stale report fails the gate and is never cached as a pass; `gate` now checks coverage against `thresholds.diffCoverage`. `thresholds.mutationScore: null` explicitly opts out of mutation testing (recorded as `not-configured`).
- **Real mutation gate (#91)**: added pinned `@stryker-mutator/core@9.6.1` (devDependency; Stryker needs Node >= 20), `stryker.config.json` (command runner over the node:test receipt/audit-chain cases, JSON report at `reports/mutation/mutation.json`, incremental, concurrency 6) and `npm run test:mutation`. The repo's mutation gate is re-enabled at the measured baseline of **52%** (first full run: 52.45% on `audit-chain.mjs`, 182 killed / 165 survived, 7m14s on 8 cores), not the aspirational 80%.
- **Linux test failure**: `wiki/Traceability.md` now references `.github/PULL_REQUEST_TEMPLATE.md` with the correct case.
- **Hermetic tests**: the `kanban-sync.sh` test runs in a temp dir with a stub `gh`, so it no longer calls the GitHub API or rewrites `docs/KANBAN.md`.
- **Inline `<agent-embed>` Artifact URI Scheme**: Updated `sdlc/SKILL.md` and `sdlc-status/SKILL.md` to use `file:///<artifactDir>/sdlc-architecture-diff.html` instead of a bare relative filename, resolving `unknown uri scheme` parse errors in Antigravity chat.

### Added
- **Technical Writer & Archlens AST-to-Wiki Sync Engine (`CAP-11`, `ADR-007`)**: Added `.agent/scripts/lib/wiki-sync.mjs` and `.agent/skills/sdlc-wiki/SKILL.md` providing deterministic AST-to-Wiki mapping (`wiki/Codebase-Map.md`), Archlens Concentric Ring classification, and zero-rot documentation auditing (`sdlc-engine wiki <sync|audit|map>`).
- **Unified Multi-Provider Ticket Engine & Canonical Issue Templates (`CAP-10`, #86, `ADR-006`)**: Upgraded `pm-provider.mjs` with full 4-operation parity (`createTicket`, `transitionPMState`, `postPMComment`, `syncKanbanBoard`) across GitHub Issues, Linear GraphQL, and Jira REST v3, plus canonical 4-template scaffolding (`.github/ISSUE_TEMPLATE/*.md`).
- **NVIDIA SkillSpector Security Auditor (`#88`, `#90`)**: Added `auditSkills` in `quality-gate.mjs` (`node .agent/scripts/sdlc-engine.mjs skill-audit`) enforcing frontmatter, pinned `npx` (RP1), and cross-skill isolation (AS3) rules with `0/100` risk scores across all SDLC skills.
- **`ub-mode` Reduced Principles Skill (`/sdlc ub`)**: Added `.agent/skills/ub-mode/SKILL.md` encoding Robert C. Martin reduced engineering principles (*First Make it Work*, *Then Make it Right*, *Follow Practice*) wired into `/sdlc ub`, `sdlc-flow`, and `sdlc-tdd`.
- **Two-Tier PRD & IEEE 29148 SRS Specification Engine (`CAP-09`, #84, `ADR-005`)**: Upgraded `sdlc-engine product init` and added `sdlc-engine product spec` (`/sdlc spec`) to generate macro `docs/PRD.md` and `docs/SRS.md` specifications alongside rich per-capability `docs/specs/cap-XX-<slug>.md` specs (PRD Slice + IEEE 29148 SRS I/O + C4 diagram), enforced `PRD_SRS_CONTRACT_MUTATION` in `checkSpecDrift`, and embedded SRS excerpts into `.agent/dossiers/issue-<id>.md`.
- **Universal `/sdlc` Command Router & Verb Skills (`CAP-08`, #81, `ADR-004`)**: Replaced abstract skill names (`sdlc-init`, `sdlc-review-gate`) with 1 Universal Router (`sdlc`) + Verb Skills (`sdlc-flow`, `sdlc-product`, `sdlc-doctor`, `sdlc-status`, `sdlc-tdd`, `sdlc-gate`, `sdlc-adr`, `sdlc-release`, `sdlc-wiki`) and added `sdlc-init`/`sdlc-review-gate` to automatic upgrade pruning.
- **NPX Multi-Agent Installer Wizard (`CAP-07`, #75, `ADR-003`)**: Added `npx github:fmatar/agentic-sdlc-framework install` (`.agent/scripts/lib/installer.mjs`) featuring a zero-dependency interactive ANSI TUI wizard to select AI coding tools (`gemini`, `claude`, `cursor`, `grok`, `windsurf`, `copilot`), scope (`local` vs `global`), and governance add-ons (`--with-archlens`, `--with-hooks`, `--with-ci`), plus automatic pruning of deprecated pre-`ADR-002` skills.
- **Hybrid Architecture Diff & Decision Lineage UI (`CAP-05`, #72)**: Added `sdlc-engine ui-snapshot` and `/api/arch-diff` in `workbench-server.mjs` rendering live Clean Architecture ring changes and `CAP -> SPEC -> Ticket -> ADR` lineage inline via `<agent-embed>`.

### Changed
- **Double-Entry Clearinghouse Ledger Workbench UI**: Redesigned Mission Control (`workbench/`) and standalone Architecture Diff snapshot (`.agent/workbench/index.html`) into a Double-Entry Clearinghouse Ledger aesthetic.

### Removed
- **Legacy Installers (`ADR-003`, #75)**: Removed `install.sh` and `install.java` in favor of the unified `npx github:fmatar/agentic-sdlc-framework install` CLI.

## [0.1.0] - 2026-10-25
### Added
- **Composite Stage Lifecycle CLI (`CAP-01`, #68)**: Added `sdlc-engine stage <begin|pre-pr|complete>` (`executeCompositeStage` in `session.mjs`) collapsing ~15 manual bookkeeping commands into 3 atomic lifecycle transitions.
- **Polyglot Single-Test Runner (`CAP-02`, #69)**: Added `buildSingleTestCommand` and `findAffectedTests` in `quality-gate.mjs` supporting Maven, Gradle, pytest, Go test, Cargo test, and Node test runners.
- **Real Coverage & Mutation Report Parsers (`CAP-03`, #70)**: Added `parseCoverageReport` (`coverage-summary.json`, `lcov.info`, `jacoco.csv`, `coverage.xml`, `coverage.out`) and `parseMutationReport` (Stryker `mutation.json`, PITest `mutations.xml`) with threshold enforcement and session manifest recording.
- **Policy-Driven `checkArchDiff` (`CAP-03`, #70)**: Upgraded `arch-trace.mjs` to parse `.archlens/policy.json` ring definitions (`layers` and `order`/`levels`) and flag unauthorized inner-to-outer ring imports.
- **Live Canary Probes, Real File Digests & Polyglot Reproduce (`CAP-04`, #71)**: Upgraded `monitorCanaryHealthAndWatchdog` (`--live` HTTP probing), `generateRegressionProof` (SHA-256 digests of real route/component files on disk), and `scaffoldReproductionTest` (idiomatic Java, Python, Go, Rust, and Node Red-first harnesses).

### Changed
- **Consolidated 14 Skills into 6 Canonical Skills (`CAP-05`, #72, `ADR-002`)**: Consolidated `.agent/skills/` into `sdlc-flow`, `sdlc-product`, `sdlc-tdd`, `sdlc-review-gate`, `sdlc-release`, and `sdlc-init` with valid `read_file`/`write_file`/`edit_file` and `invoke_subagent` tool schemas. Relocated `kanban-sync.sh` and `project-setup.sh` to `.agent/scripts/`.
- **Honest PR Summary Metrics (`CAP-03`, #70)**: Replaced fabricated `'90%'` coverage and `'85%'` mutation defaults in `generatePRSummary` with `'Not Measured'` (`⚪ PENDING`) when unmeasured.
- **Self-Dogfooding Test Suite (`CAP-06`, #73)**: Updated `.agent/sdlc-config.json` and `package.json` to run all 3 test suites (`sdlc-engine.test.mjs`, `sdlc-nextgen.test.mjs`, `scripts.test.mjs`) with `--experimental-test-coverage`.

### Security
- **Shell Injection Remediation (`CAP-02`, #69)**: Replaced shell-interpolated `execSync` calls in `pm-provider.mjs` (`gh issue create`, `gh pr/issue comment`, Jira/Linear `curl`) with `execFileSync` argument arrays.

## [0.0.1] - 2026-10-21

### Added
- feat(product-autopilot): introduce `sdlc-product` skill and `PRODUCT.md` Constitution engine (`node .agent/scripts/sdlc-engine.mjs product <init|plan|control>`) with canonical `CAP-XX`, `INV-XX`, `SPEC-XX` IDs, Genesis Ticket `#1` enforcement, and topological DAG wave scheduling (#63)
- feat(adr-drift): dual-enforced Spec-Drift Sentinel (`node .agent/scripts/sdlc-engine.mjs drift check`) and ADR lifecycle engine (`node .agent/scripts/sdlc-engine.mjs adr <create|list|decide>`) with blast-radius routing (technical auto-accept vs. product human approval) (#63)
- feat(git-guard): strict 4-Layer Git Lockdown (`pre-commit`, `pre-merge-commit`, `pre-push`) blocking commits on `main`/`develop`, requiring an active branch-matched `.sdlc-session.json` on every commit, and requiring a signed Stage 7 SHA-256 Merkle Gate Receipt before merge (#63)
- feat(decision-workbench): Causal Decision Lineage Graph (`docs/DECISION_MAP.md` & `.agent/decision-graph.jsonl`) and Hybrid SvelteKit 5 Runes Bidirectional Mission Control (`workbench/` & `sdlc-engine serve`) with Architecture Time-Slider, ADR Approval Queue, and live SSE streaming (#63)
- refactor(engine-perf): decompose `sdlc-engine.mjs` monolith into modular `.agent/scripts/lib/*.mjs` domain libraries with Async Parallel Subprocess Pool (`runParallelTasks`), Content-Addressable SHA-256 Gate Caching (`.agent/.cache/`), and Context-Compressed Subagent Dossiers (`.agent/dossiers/`) (#63)
- feat(protect): strict multi-branch protection enforcer for main and develop (`node .agent/scripts/sdlc-engine.mjs protect [branches...]`) configuring both physical Git pre-push hook blocks and GitHub remote protection rules (#43)
- feat(telemetry): token consumption, ROI velocity & session stats tracker (`node .agent/scripts/sdlc-engine.mjs stats`) calculating developer hours saved, estimated dollar savings, velocity score, and session telemetry (#26)
- feat(reproduce): automated bug reproduction test scaffold generator (`node .agent/scripts/sdlc-engine.mjs reproduce --error "<trace>" [--target <file>]`) creating failing Red-Green-Refactor test harnesses directly from error stack traces (#25)
- feat(contract): API breaking contract drift detection & schema guardian (`node .agent/scripts/sdlc-engine.mjs contract check`) auditing OpenAPI, Swagger, and GraphQL schema diffs for removed endpoints, methods, or types, wired directly into strict quality gate (#24)
- feat(workbench): interactive visual SDLC mission control dashboard & HTTP server (`node .agent/scripts/sdlc-engine.mjs serve [--port <port>]`) rendering live Kanban state, active stage indicators, and architectural trace ledger (#23)
- feat(interop): multi-agent runtime interoperability layer (`node .agent/scripts/sdlc-engine.mjs interop export [--agent <all|claude|cursor|windsurf>]`) exporting rules, slash commands, and TDD invariants to Claude Code (`CLAUDE.md`, `.claude/settings.json`), Cursor (`.cursorrules`, `.cursor/rules/`), and Windsurf (`.windsurfrules`) (#22)
- feat(installer): add Vercel Labs Skills CLI (`npx skills add fmatar/agentic-sdlc-framework`) support across `install.sh`, `install.java`, and root `README.md` with zero-dependency fallback, and add Skills CLI toolchain diagnostic to `sdlc-engine doctor` (#17)
- feat(flake-check): automated flaky test detector (`node .agent/scripts/sdlc-engine.mjs flake-check [--runs <n>]`) executing rapid shuffled iterations to catch non-deterministic race conditions
- feat(security-audit): pre-flight secret leak and dependency CVE auditor (`node .agent/scripts/sdlc-engine.mjs security-audit`) scanning git diffs for private keys, AWS/GitHub tokens, and high-severity package vulnerabilities
- feat(archlens-scaffold): zero-dependency native Archlens Clean Architecture policy generator (`node .agent/scripts/sdlc-engine.mjs archlens scaffold`) auto-configuring concentric ring boundaries across polyglot projects
- feat(mutation-strengthen): mutation test auto-strengthener (`node .agent/scripts/sdlc-engine.mjs strengthen [--type <type>]`) recommending concrete assertion density improvements for surviving mutants
- feat(archlens-inquiry): proactively prompt user for Archlens Clean Architecture availability in `sdlc-flow` Stage 1 via `ask_question`, offering instant one-click policy scaffolding if unconfigured
- feat(risk-audit): diff-aware pre-flight risk scorer (`node .agent/scripts/sdlc-engine.mjs risk-audit`) assigning risk levels (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) based on schema migrations, security logic, lockfiles, and domain entities
- feat(pr-summary): automated pull request summary generator (`node .agent/scripts/sdlc-engine.mjs pr-summary [--issue <id>]`) compiling Dual-Gate metrics, risk analysis, git stat, and verification showcase into markdown
- feat(affected-tests): smart affected unit test runner (`node .agent/scripts/sdlc-engine.mjs test --affected-only`) mapping touched source files directly to test files for fast TDD loop iteration
- feat(archlens-diff): interactive architectural git diff auditor (`node .agent/scripts/sdlc-engine.mjs archlens diff`) detecting newly introduced concentric layer inversions (e.g. core domain importing outer web/infra)
- feat(hooks): zero-dependency Git hooks scaffolding (`node .agent/scripts/sdlc-engine.mjs hooks install`) configuring pre-commit (fast staged diff tests) and pre-push (strict quality gate) without external dependencies
- feat(ci-workflow): GitHub Actions Quality Gate CI workflow generator (`node .agent/scripts/sdlc-engine.mjs ci-workflow install`) creating `.github/workflows/sdlc-quality-gate.yml`
- feat(release): turnkey SemVer release automation (`node .agent/scripts/sdlc-engine.mjs release [patch|minor|major] [--dry-run] [--skip-gate]`) executing quality gate verification, manifest updates (`package.json`, `pom.xml`, `pyproject.toml`, `Cargo.toml`), Keep a Changelog roll, and Git commit/tagging in `sdlc-release-changelog` and `sdlc-engine.mjs`
- feat(doctor): framework doctor and toolchain healthcheck (`node .agent/scripts/sdlc-engine.mjs doctor`) auditing Git, Node.js, GitHub CLI, Docker, critical engine assets, living Kanban, spec templates, and active session locks
- feat(intake): auto-classification of intake (`feat`, `bug`, `hotfix`, `spike`) with automatic label tagging, P0 priority routing, and mandatory failing reproduction harnesses in `sdlc-flow` and `sdlc-engine.mjs ticket create`
- feat(review-comment): enforce mandatory review audit comment delivery across all PM tools (GitHub PR/Issue via MCP/CLI, Jira REST API, Linear GraphQL, and living `docs/KANBAN.md`) via `sdlc-peer-review` and `sdlc-engine.mjs pm comment`
- feat(worktrees): multi-branch and multi-session Git Worktree registry supporting concurrent execution, non-blocking bugfixes, worktree switching (`session switch <id>`), active session listing (`session list`), and automatic worktree pruning upon release
- feat(resumption): session stage manifest checkpointing (`specPath`, `prNumber`, `uiScreenshotPath`, timestamps) and `node .agent/scripts/sdlc-engine.mjs session resume` for seamless context-loss recovery
- feat(circuit-breaker): automated remediation loop limit (max 3 retries) with interactive `ask_question` human handoff in `sdlc-flow` Stage 7, preventing token exhaustion and offering structured options (exemption, budget extension, or rollback)
- feat(exemptions): benign mutant & test exemption ledger in `.agent/sdlc-exemptions.json` via `node .agent/scripts/sdlc-engine.mjs exemption <list|add>`, allowing architecturally justified survivors to pass the gate
- feat(ci-checks): remote CI/CD status check polling (`node .agent/scripts/sdlc-engine.mjs check-ci <prNumber>`) before Stage 8 merge/release
- feat(dashboard): real-time ASCII and visual SDLC lifecycle progress dashboard in `sdlc-engine.mjs session dashboard`
- feat(wizard): universal detect-first interactive wizard in `sdlc-initialize` with structured `ask_question` modals, polyglot starter templates, Archlens Clean Architecture opt-in, and multi-provider PM setup
- feat(archlens): native Archlens Clean Architecture concentric layer governance in `sdlc-quality-gate`, `sdlc-peer-review`, and `sdlc-engine.mjs archlens <check|update>`
- feat(pm): pluggable Project Management provider abstraction supporting GitHub Projects v2, Jira (Atlassian), Linear, and offline `docs/KANBAN.md` in `sdlc-kanban` and `sdlc-engine.mjs pm`
- feat(env): environment diagnostics via `node .agent/scripts/sdlc-engine.mjs env` and documented `.env.example` template covering GitHub, Jira, Linear, and Archlens
- feat(updater): framework update capabilities via `install.sh --update`, `install.sh --with-archlens`, and `node .agent/scripts/sdlc-engine.mjs update`
- feat(installer): upgrade `install.sh` to zero-dependency universal POSIX installer (<2s runtime) with tarball streaming, automatic stack discovery (`sdlc-engine detect`), and complete `.agent/scripts/` payload; upgrade `install.java` with engine payload, POSIX script permission preservation, and `--skip-detect`
- feat(orchestration): align 8-stage lifecycle with pre-PR docs sync (Stage 5), PR creation (Stage 6), parallel fork-join peer review & gatekeeper (Stage 7), rejection rollback loop, session concurrency locking (`.agent/.sdlc-session.json`), and ad-hoc fast-path routing in `sdlc-flow`
- feat(engine): add session lifecycle commands (`status`, `start`, `update` with `--subagents`, `release`) and `resolve-targets` parallel clustering in `sdlc-engine.mjs`
- feat(engine): introduce zero-dependency Universal Stack Discovery & Execution Engine (`.agent/scripts/sdlc-engine.mjs`) in native Node.js with CI reverse-engineering, interactive preview layer, and polyglot directory-scoped multi-module orchestration
- feat(kanban): introduce `project-setup.sh` automated provisioner for GitHub Projects v2 with 6 traceable views and custom fields (`Spec Link`, `Quality Gate`, `Priority`, `Component`, `Estimate`) in `sdlc-kanban`
- feat(traceability): integrate 7-layer Traceability Matrix into `docs/KANBAN.md` via `kanban-sync.sh`, new `wiki/Traceability.md`, and PRD/SRS templates
- feat(wiki): add automated and direct git CLI publishing workflow guide in `sdlc-docs-wiki`
- feat(testing): integrate Robert C. Martin TDD craftsmanship, Three Laws of TDD, and Transformation Priority Premise (TPP) in `sdlc-tdd-implement`
- feat(mutation): introduce Dual-Gate quality standards ($\ge 85\%$ diff coverage AND $\ge 80\%$ mutation kill score via PITest & Stryker) in `sdlc-test-coverage`, `sdlc-quality-gate`, and `sdlc-flow`
- feat(peer-review): enforce Robert Martin test smell audits (reject trivial getter tests, framework plumbing tests, mock abuse, and assertion-free tests) in `sdlc-peer-review`
- feat(initialize): scaffold PITest for Quarkus and Stryker for Svelte 5 in `sdlc-initialize`
- feat(analyze): add mutation test metrics and Dual-Gate coverage auditing in `sdlc-analyze`
- docs(operations): add comprehensive Robert Martin testing philosophy, test smell heuristics, and mutation testing guide in `docs/SDLC_AGENTIC_OPERATIONS_GUIDE.md`, root `README.md`, and `/wiki`
- feat(skills): introduce Developer Showcase & Quickstart onboarding invariant to `sdlc-flow` and `sdlc-docs-wiki`
- feat(peer-review): enforce Developer Showcase and 5-minute quickstart validation in `sdlc-peer-review` and `sdlc-analyze`
- docs(readme): upgrade root `README.md` with 4-stage 5-Minute Developer Quickstart and BYOA workflow
- feat(sdlc): introduce autonomous 8-stage lifecycle with Svelte 5 and Quarkus Java 25 support
- feat(sdlc): add `sdlc-peer-review` subagent skill for independent PR audits
- feat(sdlc): add `sdlc-kanban` skill and `scripts/kanban-sync.sh` for GitHub Projects v2 and living repo boards (`docs/KANBAN.md`)
- feat(sdlc): add diff-scoped test coverage enforcement ($\ge$ 90%) in `sdlc-test-coverage`

### Changed
- refactor(skills): decouple framework from project-specific domains and standardize allowed-tools
- refactor(quality-gate): add Spotless formatting checks and random test port isolation (`quarkus.http.test-port=0`)

### Fixed
- fix(installer): resolve `BASH_SOURCE[0]` unbound variable and empty array expansion when piped via stdin (`curl ... | bash`)
- fix(install): resolve directory name spacing issue in `install.sh`
- fix(install): add support for `.agents` and `.agent` paths in `install.java`
- fix(install): preserve file attributes and script execution permissions during installation in `install.java`
