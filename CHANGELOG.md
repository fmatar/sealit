# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- feat(engine): introduce zero-dependency Universal Stack Discovery & Execution Engine (`.agent/scripts/sdlc-engine.mjs`) in native Node.js with CI reverse-engineering, interactive preview layer, and polyglot directory-scoped multi-module orchestration
- feat(kanban): introduce `project-setup.sh` automated provisioner for GitHub Projects v2 with 6 traceable views and custom fields (`Spec Link`, `Quality Gate`, `Priority`, `Component`, `Estimate`) in `sdlc-kanban` (v3.0.0)
- feat(traceability): integrate 7-layer Traceability Matrix into `docs/KANBAN.md` via `kanban-sync.sh`, new `wiki/Traceability.md`, and PRD/SRS templates
- feat(wiki): add automated and direct git CLI publishing workflow guide in `sdlc-docs-wiki` (v2.2.0)
- feat(testing): integrate Robert C. Martin (Uncle Bob) TDD craftsmanship, Three Laws of TDD, and Transformation Priority Premise (TPP) in `sdlc-tdd-implement` (v3.0.0)
- feat(mutation): introduce Dual-Gate quality standards ($\ge 85\%$ diff coverage AND $\ge 80\%$ mutation kill score via PITest & Stryker) in `sdlc-test-coverage` (v3.0.0), `sdlc-quality-gate` (v3.0.0), and `sdlc-flow` (v4.0.0)
- feat(peer-review): enforce Uncle Bob test smell audits (reject trivial getter tests, framework plumbing tests, mock abuse, and assertion-free tests) in `sdlc-peer-review` (v2.0.0)
- feat(initialize): scaffold PITest for Quarkus and Stryker for Svelte 5 in `sdlc-initialize` (v3.0.0)
- feat(analyze): add mutation test metrics and Dual-Gate coverage auditing in `sdlc-analyze` (v3.0.0)
- docs(operations): add comprehensive Uncle Bob testing philosophy, test smell heuristics, and mutation testing guide in `docs/SDLC_AGENTIC_OPERATIONS_GUIDE.md`, root `README.md`, and `/wiki`
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
- fix(install): resolve directory name spacing issue in `install.sh`
- fix(install): add support for `.agents` and `.agent` paths in `install.java`
- fix(install): preserve file attributes and script execution permissions during installation in `install.java`
