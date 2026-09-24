---
name: sdlc-docs-wiki
description: Synchronizes documentation across the project, including docs/specs/, CHANGELOG.md conventional commits, /wiki, OpenSpec delta specs, and inline code docs.
version: 2.0.0
license: Apache 2.0
allowed-tools: run_command, view_file, write_to_file, replace_file_content
---

# SDLC Documentation & Wiki Synchronization Skill (`sdlc-docs-wiki`)

Use this skill whenever features, data models, or architectural patterns are added, modified, or deprecated. This skill enforces continuous documentation hygiene across code and specs.

---

## 📚 Synchronized Documentation Targets

1. **Functional Architectural Specs (`docs/specs/`)**: Detailed specifications, data contracts, and domain rules per feature area.
2. **Conventional Changelog (`CHANGELOG.md`)**: Adheres to [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Records changes under `[Unreleased]` with ticket links.
3. **Living Kanban Board (`docs/KANBAN.md`)**: Version-controlled visual board synchronized via `sdlc-kanban` (`.agent/skills/sdlc-kanban/scripts/kanban-sync.sh`).
4. **Repository Wiki & Architecture (`wiki/`)**: Deep-dive system architecture, ADRs, C4 diagrams, and deployment guides.
5. **Inline Code Documentation**: Javadoc on Java/Quarkus services and TSDoc on TypeScript/Svelte 5 runes and components.
6. **OpenSpec Change Synchronization**: If OpenSpec delta specs are present, sync changes across `openspec/specs/`.

---

## 🗂️ Wiki Structure Standard

```text
wiki/
├── Home.md                          # Vision, architecture overview, and quick navigation
├── Architecture.md                  # C4 diagrams, runtime interactions, and Fork-Join model
├── Skills-Reference.md              # Documentation of available agentic skills
├── ADR-00X-[title].md               # Architectural Decision Records
├── _Sidebar.md                      # GitHub Wiki sidebar navigation
└── _Footer.md                       # Footer navigation and branding
```

---

## 🛠️ Step-by-Step Documentation Workflow

### Step 1: Detect Code Changes & Impact
Inspect `git diff --name-only main` to identify modified surfaces:
- New backend endpoint or service $\rightarrow$ Update `docs/specs/<service>.md` and Javadoc.
- New frontend component or rune store $\rightarrow$ Update `docs/specs/<ui-feature>.md` and TSDoc.
- Architectural shift $\rightarrow$ Add `wiki/ADR-00X-[title].md` and update `wiki/Architecture.md`.

### Step 2: Update `CHANGELOG.md`
Append entries under `[Unreleased]` following Keep a Changelog categories (`Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`):
```markdown
### Added
- feat(assistant): implement email cc idempotency and timezone handling ([#1031](https://github.com/org/repo/issues/1031))

### Fixed
- fix(sync): prevent concurrent event race condition during calendar sync ([#1058](https://github.com/org/repo/issues/1058))
```

### Step 3: Update Wiki & Navigation
- Ensure new topics are indexed in `wiki/_Sidebar.md`.
- Verify all relative markdown links resolve without broken anchors.

---

## ⏭️ Next Recommended Step

Once documentation and specs are synchronized:
👉 **Transition to [`sdlc-quality-gate`](../sdlc-quality-gate/SKILL.md)** to execute pre-merge audits and static verification.
