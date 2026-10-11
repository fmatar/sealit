# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

## [0.0.1] - 2026-10-08

- feat(hooks): zero-dependency Git hooks scaffolding (`node .agent/scripts/sdlc-engine.mjs hooks install`) configuring pre-commit (fast staged diff tests) and pre-push (strict quality gate) without external dependencies
- feat(ci-workflow): GitHub Actions Quality Gate CI workflow generator (`node .agent/scripts/sdlc-engine.mjs ci-workflow install`) creating `.github/workflows/sdlc-quality-gate.yml`
- feat(release): turnkey SemVer release automation (`node .agent/scripts/sdlc-engine.mjs release [patch|minor|major] [--dry-run] [--skip-gate]`) executing quality gate verification, manifest updates (`package.json`, `pom.xml`, `pyproject.toml`, `Cargo.toml`), Keep a Changelog roll, and Git commit/tagging in `sdlc-release-changelog` (v2.1.0) and `sdlc-engine.mjs`
- feat(doctor): framework doctor and toolchain healthcheck (`node .agent/scripts/sdlc-engine.mjs doctor`) auditing Git, Node.js, GitHub CLI, Docker, critical engine assets, living Kanban, spec templates, and active session locks
- feat(intake): auto-classification of intake (`feat`, `bug`, `hotfix`, `spike`) with automatic label tagging, P0 priority routing, and mandatory failing reproduction harnesses in `sdlc-flow` (v5.2.0) and `sdlc-engine.mjs ticket create`
- feat(review-comment): enforce mandatory review audit comment delivery across all PM tools (GitHub PR/Issue via MCP/CLI, Jira REST API, Linear GraphQL, and living `docs/KANBAN.md`) via `sdlc-peer-review` (v2.2.0) and `sdlc-engine.mjs pm comment`
- feat(worktrees): multi-branch and multi-session Git Worktree registry supporting concurrent execution, non-blocking bugfixes, worktree switching (`session switch <id>`), active session listing (`session list`), and automatic worktree pruning upon release
- feat(resumption): session stage manifest checkpointing (`specPath`, `prNumber`, `uiScreenshotPath`, timestamps) and `node .agent/scripts/sdlc-engine.mjs session resume` for seamless context-loss recovery
- feat(circuit-breaker): automated remediation loop limit (max 3 retries) with interactive `ask_question` human handoff in `sdlc-flow` Stage 7, preventing token exhaustion and offering structured options (exemption, budget extension, or rollback)
- feat(exemptions): benign mutant & test exemption ledger in `.agent/sdlc-exemptions.json` via `node .agent/scripts/sdlc-engine.mjs exemption <list|add>`, allowing architecturally justified survivors to pass the gate
- feat(ci-checks): remote CI/CD status check polling (`node .agent/scripts/sdlc-engine.mjs check-ci <prNumber>`) before Stage 8 merge/release
- feat(dashboard): real-time ASCII and visual SDLC lifecycle progress dashboard in `sdlc-engine.mjs session dashboard`
- feat(wizard): universal detect-first interactive wizard in `sdlc-initialize` (v4.0.0) with structured `ask_question` modals, polyglot starter templates, Archlens Clean Architecture opt-in, and multi-provider PM setup
- feat(archlens): native Archlens Clean Architecture concentric layer governance in `sdlc-quality-gate` (v4.0.0), `sdlc-peer-review` (v2.1.0), and `sdlc-engine.mjs archlens <check|update>`
- feat(pm): pluggable Project Management provider abstraction supporting GitHub Projects v2, Jira (Atlassian), Linear, and offline `docs/KANBAN.md` in `sdlc-kanban` (v3.1.0) and `sdlc-engine.mjs pm`
- feat(env): environment diagnostics via `node .agent/scripts/sdlc-engine.mjs env` and documented `.env.example` template covering GitHub, Jira, Linear, and Archlens
- feat(updater): framework update capabilities via `install.sh --update`, `install.sh --with-archlens`, and `node .agent/scripts/sdlc-engine.mjs update`
- feat(installer): upgrade `install.sh` to zero-dependency universal POSIX installer (<2s runtime) with tarball streaming, automatic stack discovery (`sdlc-engine detect`), and complete `.agent/scripts/` payload; upgrade `install.java` (v3.0) with engine payload, POSIX script permission preservation, and `--skip-detect`
- feat(orchestration): align 8-stage lifecycle with pre-PR docs sync (Stage 5), PR creation (Stage 6), parallel fork-join peer review & gatekeeper (Stage 7), rejection rollback loop, session concurrency locking (`.agent/.sdlc-session.json`), and ad-hoc fast-path routing in `sdlc-flow` (v5.0.0)
- feat(engine): add session lifecycle commands (`status`, `start`, `update` with `--subagents`, `release`) and `resolve-targets` parallel clustering in `sdlc-engine.mjs`
- feat(engine): introduce zero-dependency Universal Stack Discovery & Execution Engine (`.agent/scripts/sdlc-engine.mjs`) in native Node.js with CI reverse-engineering, interactive preview layer, and polyglot directory-scoped multi-module orchestration
- feat(kanban): introduce `project-setup.sh` automated provisioner for GitHub Projects v2 with 6 traceable views and custom fields (`Spec Link`, `Quality Gate`, `Priority`, `Component`, `Estimate`) in `sdlc-kanban` (v3.0.0)
- feat(traceability): integrate 7-layer Traceability Matrix into `docs/KANBAN.md` via `kanban-sync.sh`, new `wiki/Traceability.md`, and PRD/SRS templates
- feat(wiki): add automated and direct git CLI publishing workflow guide in `sdlc-docs-wiki` (v2.2.0)
- feat(testing): integrate Robert C. Martin TDD craftsmanship, Three Laws of TDD, and Transformation Priority Premise (TPP) in `sdlc-tdd-implement` (v3.0.0)
- feat(mutation): introduce Dual-Gate quality standards ($\ge 85\%$ diff coverage AND $\ge 80\%$ mutation kill score via PITest & Stryker) in `sdlc-test-coverage` (v3.0.0), `sdlc-quality-gate` (v3.0.0), and `sdlc-flow` (v4.0.0)
- feat(peer-review): enforce Robert Martin test smell audits (reject trivial getter tests, framework plumbing tests, mock abuse, and assertion-free tests) in `sdlc-peer-review` (v2.0.0)
- feat(initialize): scaffold PITest for Quarkus and Stryker for Svelte 5 in `sdlc-initialize` (v3.0.0)
- feat(analyze): add mutation test metrics and Dual-Gate coverage auditing in `sdlc-analyze` (v3.0.0)
- docs(operations): add comprehensive Robert Martin testing philosophy, test smell heuristics, and mutation testing guide in `docs/SDLC_AGENTIC_OPERATIONS_GUIDE.md`, root `README.md`, and `/wiki`
- feat(skills): introduce Developer Showcase & Quickstart onboarding invariant to `sdlc-flow` (v3.2.0) and `sdlc-docs-wiki` (v2.1.0)
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
