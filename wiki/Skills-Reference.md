# Agentic Skills Reference

The following core skills exist in `.agent/skills/`:

| Skill | Role | Description |
|---|---|---|
| `sdlc-flow` | Master Orchestrator | Runs the end-to-end 8-stage issue-to-PR automated pipeline. |
| `sdlc-feature-spec` | Product Owner / Architect | Generates PRD, SRS, C4 architecture, and standard GitHub issues. |
| `sdlc-tdd-implement` | Engineer | Full-stack Svelte 5 / Quarkus Java 25 coding with strict TDD. |
| `sdlc-test-coverage` | QA Engineer | Runs tests and enforces $\ge$ 90% diff line and branch coverage. |
| `sdlc-peer-review` | Peer Reviewer | Parallel subagent auditing PR diffs and posting formal reviews. |
| `sdlc-docs-wiki` | Technical Writer | Synchronizes `docs/specs/`, `CHANGELOG.md`, and `/wiki`. |
| `sdlc-quality-gate` | Security & Quality Auditor | Pre-merge Spotless, static typing, port isolation, and SAST audits. |
| `sdlc-release-changelog` | DevOps / Release Engineer | Handles SemVer, containerization, and Helm deployments. |
| `sdlc-kanban` | Project Manager / Scrum Master | Manages GitHub Projects, Kanban state transitions (`status:*`), and WIP limits. |
| `sdlc-help` | Support & Guide | Interactive diagnostics and copy-paste prompt recipes. |
| `sdlc-analyze` | Compliance Auditor | Audits repository adherence to SDLC quality standards. |
| `sdlc-initialize` | Bootstrap Installer | Scaffolds new full-stack projects and installs skills. |
