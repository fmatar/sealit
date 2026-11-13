# 🛠️ Skills & CLI Command Reference

This reference documents the **10 Canonical Skills — 1 Universal Router (`/sdlc`) and 9 Verb-Driven Lifecycle Skills** (`ADR-010`, `ADR-011`) located in `.agent/skills/` and the complete CLI subcommand table for `.agent/scripts/sdlc-engine.mjs`.

> **Namespace Isolation & Coding-Persona Decoupling (`ADR-011`)**: All canonical and deprecated framework skills are strictly scoped to the `sdlc*` namespace (`CANONICAL_SDLC_SKILLS` and `DEPRECATED_SDLC_SKILLS` in `.agent/scripts/lib/installer.mjs`). Workflow governance (`/sdlc*`) is intentionally decoupled from standalone coding-persona or design skills (such as `ponytail`, `impeccable`, or personal coding style skills): `install`, `install --global`, `interop export`, and `skill-audit` never overwrite, audit, or delete non-`sdlc*` skills in local or global agent directories.

---

## 1. Universal Command Router (`/sdlc`)

- **Path**: `.agent/skills/sdlc/SKILL.md`
- **Purpose**: Accepts any SDLC subcommand directly in chat (`/sdlc doctor`, `/sdlc begin 90`, `/sdlc status`, `/sdlc drift`, `/sdlc pre-pr`, `/sdlc gate`, `/sdlc wiki sync`, `/sdlc ui`) and maps it `1:1` to `.agent/scripts/sdlc-engine.mjs`.

| Chat Invocation | Mapped Engine Command |
| :--- | :--- |
| `/sdlc install [flags]` | `node .agent/scripts/sdlc-engine.mjs install [flags]` |
| `/sdlc doctor` | `node .agent/scripts/sdlc-engine.mjs doctor` |
| `/sdlc doctor --fix` / `/sdlc doctor fix` | `node .agent/scripts/sdlc-engine.mjs doctor --fix` |
| `/sdlc skill-audit` | `node .agent/scripts/sdlc-engine.mjs skill-audit` |
| `/sdlc detect` | `node .agent/scripts/sdlc-engine.mjs detect` |
| `/sdlc status` | `node .agent/scripts/sdlc-engine.mjs session dashboard` + `drift check` + `audit verify` |
| `/sdlc ui` | `node .agent/scripts/sdlc-engine.mjs ui-snapshot` |
| `/sdlc serve` | `node .agent/scripts/sdlc-engine.mjs serve` |
| `/sdlc triage` | `node .agent/scripts/sdlc-engine.mjs triage` |
| `/sdlc quick "<title>"` | `node .agent/scripts/sdlc-engine.mjs stage begin --lane trivial --title "<title>" --checkout` |
| `/sdlc begin <#id>` | `node .agent/scripts/sdlc-engine.mjs stage begin --issue <id> --checkout` |
| `/sdlc begin "<title>"` | `node .agent/scripts/sdlc-engine.mjs stage begin --local --title "<title>" --checkout` (pass `--create-issue` instead of `--local` after user confirmation) |
| `/sdlc pre-pr [#id]` | `node .agent/scripts/sdlc-engine.mjs stage pre-pr --issue <id>` |
| `/sdlc complete [#id]` | `node .agent/scripts/sdlc-engine.mjs stage complete --issue <id>` |
| `/sdlc test` / `/sdlc coverage` / `/sdlc mutation` | `node .agent/scripts/sdlc-engine.mjs <test\|coverage\|mutation>` |
| `/sdlc adr <create\|list\|decide\|compact>` | `node .agent/scripts/sdlc-engine.mjs adr <subcommand>` |
| `/sdlc drift` | `node .agent/scripts/sdlc-engine.mjs drift check` |
| `/sdlc review` | Delegates to `sdlc-gate` (`review plan` + `gate --strict` + `review record`) |
| `/sdlc gate` | `node .agent/scripts/sdlc-engine.mjs gate --strict` |
| `/sdlc ticket <create\|transition\|comment\|sync\|templates>` | `node .agent/scripts/sdlc-engine.mjs ticket <subcommand>` |
| `/sdlc readme <init\|audit>` | `node .agent/scripts/sdlc-engine.mjs readme <subcommand> [--archetype <auto\|cli\|sdk\|platform>] [--strict]` |
| `/sdlc wiki <sync\|audit\|map>` | `node .agent/scripts/sdlc-engine.mjs wiki <subcommand>` |
| `/sdlc release [patch\|minor\|major]` | `node .agent/scripts/sdlc-engine.mjs release <bump> --dry-run` (confirm before live release) |

---

## 2. The 9 Verb-Driven Lifecycle Skills

### 2.1 `sdlc-product` — Product Autopilot & IEEE 29148 SRS Architect
- **Path**: `.agent/skills/sdlc-product/SKILL.md`
- **Engine Modules**: `.agent/scripts/lib/product-dag.mjs`, `.agent/scripts/lib/pm-provider.mjs`
- **Capabilities**:
  - Initializes `PRODUCT.md`, `docs/PRD.md`, `docs/SRS.md`, and Genesis Ticket `#1` (`product init`).
  - Scaffolds individual capability specifications in `docs/specs/cap-XX-*.md` (`product spec --cap CAP-XX`).
  - Computes Kahn's algorithm topological DAG execution waves (`product plan`) and controls wave execution (`product control <pause|resume|status>`).
  - Deconstructs raw epic descriptions into dependency-ordered tickets (`deconstruct`).

### 2.2 `sdlc-adr` — ADR Lifecycle & Spec-Drift Sentinel
- **Path**: `.agent/skills/sdlc-adr/SKILL.md`
- **Engine Modules**: `.agent/scripts/lib/adr-drift.mjs`, `.agent/scripts/lib/decision-graph.mjs`
- **Capabilities**:
  - Mints sequential Architecture Decision Records in `docs/adr/ADR-00X-*.md` (`adr create`, initialized in `pending_approval` across all scopes).
  - Approves or rejects pending ADRs across all scopes (`adr decide --id <ADR-ID> --status <approve|reject>`).
  - Runs the Spec-Drift Sentinel (`drift check`) and OpenAPI/GraphQL contract drift auditor (`contract check`).
  - Synchronizes `docs/DECISION_MAP.md` (`decision-graph sync`).

### 2.3 `sdlc-flow` — Master 8-Stage Lifecycle Orchestrator
- **Path**: `.agent/skills/sdlc-flow/SKILL.md`
- **Engine Modules**: `.agent/scripts/lib/session.mjs`, `.agent/scripts/lib/dossier.mjs`
- **Capabilities**:
  - Drives end-to-end feature and bug delivery across Stages 1–8 using atomic composite stage transitions (`stage begin`, `stage pre-pr`, `stage complete`).
  - Enforces canonical Git Flow: feature PRs merge into `develop` (`--base develop`), while PRs targeting `main` originate strictly from `develop`.
  - Compiles context-compressed subagent dossiers in `.agent/dossiers/ticket-XX.md` (`dossier generate --issue <id>`).
  - Manages multi-session concurrency (`session list`, `session switch`, `session resume`).

### 2.4 `sdlc-tdd` — Red-Green-Refactor TDD & Polyglot Dual-Gate Runner
- **Path**: `.agent/skills/sdlc-tdd/SKILL.md`
- **Engine Modules**: `.agent/scripts/lib/quality-gate.mjs`, `.agent/scripts/lib/cache.mjs`
- **Capabilities**:
  - Enforces Red-Green-Refactor TDD, Transformation Priority Premise (TPP), and F.I.R.S.T. test isolation.
  - Scaffolds automated bug reproduction tests from stack traces across JavaScript/TypeScript, Python, Java, Go, and Rust (`reproduce --error "<trace>"`).
  - Executes affected-only unit tests (`test --affected-only`), diff coverage verification (`coverage`), mutation testing (`mutation`) against the thresholds configured in `.agent/sdlc-config.json`, and mutant strengthening (`strengthen`).

### 2.5 `sdlc-gate` — Parallel Fork-Join Peer Reviewer & Quality Gatekeeper
- **Path**: `.agent/skills/sdlc-gate/SKILL.md`
- **Engine Modules**: `.agent/scripts/lib/quality-gate.mjs`, `.agent/scripts/lib/arch-trace.mjs`, `.agent/scripts/lib/audit-chain.mjs`
- **Capabilities**:
  - Generates risk-tiered parallel subagent review plans (`review plan --base main`) for read-only **PR Peer Reviewer** and **Architecture & Security Gatekeeper** subagents.
  - Runs the strict 9-pillar gate (`gate --strict`): lint, build, coverage, risk audit (`risk-audit`), secret/CVE scan (`security-audit`), [Archlens](https://github.com/fmatar/archlens) concentric ring diff (`archlens diff`), flaky test detection (`flake-check`), API contract check (`contract check`), Merkle audit verification (`audit verify`), README 10–30–90 audit (`readme audit --strict`), and Wiki drift audit (`wiki audit --strict`).
  - Derives `--verdict <approve|request-changes>` strictly from reviewer blocker counts and issues HMAC-SHA256 Stage 7 Merkle Gate Receipts (`review record` / `guard receipt`).

### 2.6 `sdlc-status` — Read-Only Mission Control, Kanban & Telemetry Inspector
- **Path**: `.agent/skills/sdlc-status/SKILL.md`
- **Engine Modules**: `.agent/scripts/lib/session.mjs`, `.agent/scripts/lib/adr-drift.mjs`, `.agent/scripts/lib/audit-chain.mjs`
- **Capabilities**:
  - Strictly read-only (`tools: read_file, run_command`): displays the 8-stage ASCII progress dashboard (`session dashboard`), session velocity/estimated ROI metrics (`stats`), Spec-Drift status (`drift check`), Merkle audit health (`audit verify`), and Archlens ring diff (`arch diff`).
  - Never writes `.agent/workbench/index.html` or starts `serve` automatically (use `/sdlc ui` or `/sdlc serve` when the HTML workbench is requested).

### 2.7 `sdlc-doctor` — Stack Discovery, Auto-Healer & Multi-Agent Installer
- **Path**: `.agent/skills/sdlc-doctor/SKILL.md`
- **Engine Modules**: `.agent/scripts/lib/installer.mjs`, `.agent/scripts/lib/quality-gate.mjs`, `.agent/scripts/lib/git-guard.mjs`
- **Capabilities**:
  - Probes polyglot manifests (`package.json`, `pom.xml`, `build.gradle`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Makefile`) and generates `.agent/sdlc-config.json` (`detect`).
  - Runs environment diagnostics and auto-heals missing framework assets (`doctor --fix`), including `.archlens/policy.json`, `docs/KANBAN.md`, `.github/ISSUE_TEMPLATE/`, `.git/hooks/`, and `.github/workflows/sdlc-quality-gate.yml`.
  - Installs runtime-adapted skills (`adaptSkillForAgent`), Cowork account-level `.zip` upload bundles (`createSkillZipBuffer` -> `.claude/cowork/<skill>.zip`), `.claude-plugin/plugin.json`, non-destructive `CLAUDE.md`/`AGENTS.md` (`upsertConstitutionalRulesFile`), and valid `.claude/settings.json` (`upsertClaudeSettingsJson`) across all 6 supported AI coding tools (`install --agents gemini,claude,cursor,grok,windsurf,copilot`), and audits skills with SkillSpector (`skill-audit`).

### 2.8 `sdlc-release` — Documentation Sync, SemVer Release & Canary Watchdog
- **Path**: `.agent/skills/sdlc-release/SKILL.md`
- **Engine Modules**: `.agent/scripts/sdlc-engine.mjs`, `.agent/scripts/lib/quality-gate.mjs`
- **Capabilities**:
  - Prepares SemVer releases on release branches cut from `develop` (`release <patch|minor|major> --no-tag`), compacting accepted ADRs into `docs/SRS.md` and rolling `CHANGELOG.md`.
  - Promotes releases from `develop` to `main` via PR; merging into `main` automatically triggers the GitHub Actions production release workflow (`release.yml`), tagging `main` and creating GitHub Releases.
  - Generates SHA-256 delivery regression proofs in `docs/proofs/proof-*.md` (`proof generate --name <target>`).
  - Monitors post-deployment canary health endpoints with automatic rollback on error-rate threshold breach (`watchdog monitor`).

### 2.9 `sdlc-wiki` — Technical Writer, 10–30–90 README & [Archlens](https://github.com/fmatar/archlens) Wiki Architect
- **Path**: `.agent/skills/sdlc-wiki/SKILL.md`
- **Engine Modules**: `.agent/scripts/lib/readme-sync.mjs`, `.agent/scripts/lib/wiki-sync.mjs`, `.agent/scripts/lib/arch-trace.mjs`
- **Capabilities**:
  - Scaffolds high-converting 10–30–90 Developer Landing Pages (`README.md`) from `docs/templates/README_TEMPLATE.md` along with theme-aware wordmarks (`docs/logo-light.svg`, `docs/logo-dark.svg`), `llms.txt`, and Charmbracelet VHS `docs/demo.tape` scripts (`readme init --archetype <auto|cli|sdk|platform>`).
  - Audits `README.md` against tiered 10–30–90 anti-pattern rules (`<= 4` badges, zero `git clone`-first Quickstarts, valid local links, neutral Mermaid, and `<details>` progressive disclosure) (`readme audit --strict`).
  - Inspects AST exports with line numbers and maps modules into [Archlens](https://github.com/fmatar/archlens) `.archlens/policy.json` Concentric Clean Architecture rings with $Ca / Ce / I$ coupling telemetry (`wiki map`).
  - Generates and updates `wiki/Codebase-Map.md` (`wiki sync`).
  - Audits `wiki/*.md` for broken repo paths, retired skill references, unmapped modules, undocumented skills, and invalid Mermaid syntax (`wiki audit --strict`).

---

## 3. Complete `sdlc-engine.mjs` CLI Reference

```bash
# Stack Discovery, Installation & Diagnostics
node .agent/scripts/sdlc-engine.mjs install [--agents gemini,claude,cursor,grok,windsurf,copilot] [--global] [--with-archlens] [--with-hooks] [--with-ci] [--yes]
node .agent/scripts/sdlc-engine.mjs interop export [--agent <all|gemini,claude,cursor>]
node .agent/scripts/sdlc-engine.mjs detect
node .agent/scripts/sdlc-engine.mjs doctor [--fix]
node .agent/scripts/sdlc-engine.mjs skill-audit [--live]

# Risk Triage, Composite Lifecycle & Session Management
node .agent/scripts/sdlc-engine.mjs triage [files...] [--intent "<desc>"] [--lane <trivial|standard|full>] [--reason "<why>"]
node .agent/scripts/sdlc-engine.mjs stage <begin|pre-pr|complete> [--issue <id>|--local|--create-issue] [--title "<title>"] [--lane <trivial|standard|full>] [--checkout] [--ui]
node .agent/scripts/sdlc-engine.mjs session <status|dashboard|start|update|list|switch|resume|release>
node .agent/scripts/sdlc-engine.mjs stats

# Product Constitution, Specs, ADRs & Causal Graph
node .agent/scripts/sdlc-engine.mjs product <init|status|spec|plan|control>
node .agent/scripts/sdlc-engine.mjs adr <create|list|decide|compact> [--release <version>] [--dry-run]
node .agent/scripts/sdlc-engine.mjs drift check
node .agent/scripts/sdlc-engine.mjs contract check
node .agent/scripts/sdlc-engine.mjs decision-graph <build|sync>
node .agent/scripts/sdlc-engine.mjs dossier generate --issue <id> [--cap CAP-XX]

# Testing, Coverage, Mutation & Quality Gates
node .agent/scripts/sdlc-engine.mjs test [--affected-only]
node .agent/scripts/sdlc-engine.mjs coverage [--no-cache]
node .agent/scripts/sdlc-engine.mjs mutation [--no-cache]
node .agent/scripts/sdlc-engine.mjs gate [--strict] [--no-cache]
node .agent/scripts/sdlc-engine.mjs review <plan|record> [--verdict <approve|request-changes>] [--reviewer <id>] [--pr <num>]
node .agent/scripts/sdlc-engine.mjs risk-audit
node .agent/scripts/sdlc-engine.mjs security-audit
node .agent/scripts/sdlc-engine.mjs flake-check [--runs <n>]
node .agent/scripts/sdlc-engine.mjs check-ci [<pr_number>]
node .agent/scripts/sdlc-engine.mjs reproduce --error "<stack-trace>" [--target <file>]
node .agent/scripts/sdlc-engine.mjs cache <status|clear>

# Architecture, README & Wiki Synchronization, and Git Lockdown
node .agent/scripts/sdlc-engine.mjs archlens <check|diff|trace|scaffold|update>
node .agent/scripts/sdlc-engine.mjs readme <init|audit> [--archetype <auto|cli|sdk|platform>] [--strict] [--force]
node .agent/scripts/sdlc-engine.mjs wiki <sync|audit|map> [--strict] [--init]
node .agent/scripts/sdlc-engine.mjs guard <pre-commit|pre-merge|pre-push|receipt>
node .agent/scripts/sdlc-engine.mjs audit <verify|record>

# Ticket Providers, Releases & Mission Control Workbench
node .agent/scripts/sdlc-engine.mjs ticket <create|transition|comment|sync|templates>
node .agent/scripts/sdlc-engine.mjs release <patch|minor|major> [--dry-run]
node .agent/scripts/sdlc-engine.mjs proof generate --name <target>
node .agent/scripts/sdlc-engine.mjs watchdog monitor [--url <url>] [--live]
node .agent/scripts/sdlc-engine.mjs ui-snapshot
node .agent/scripts/sdlc-engine.mjs serve [--port 4120]
```
