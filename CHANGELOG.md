# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
