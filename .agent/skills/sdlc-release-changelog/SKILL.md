---
name: sdlc-release-changelog
description: Manages Semantic Versioning (SemVer), conventional changelogs (CHANGELOG.md adhering to Keep a Changelog standard), Git tagging, GitHub release creation, Docker containerization, and Kubernetes/Helm deployments.
version: 1.2.0
license: Apache 2.0
---

# SDLC Release & Changelog Management Skill (`sdlc-release-changelog`)

Use this skill when preparing releases, tagging production builds, calculating version bumps, updating `CHANGELOG.md`, and generating GitHub Releases.

---

## 🏷️ Versioning Philosophy (SemVer 2.0.0)

Given a version number `MAJOR.MINOR.PATCH`:
- **MAJOR** (`X.0.0`): Breaking architectural shifts, database/store breaking migrations, or removed public APIs.
- **MINOR** (`0.X.0`): New breathwork techniques, new geometry visualizers, new audio synthesis capabilities, or non-breaking feature additions.
- **PATCH** (`0.0.X`): Bug fixes, CSS layout corrections, audio pop glitches, and documentation enhancements.

---

## 📝 Conventional Commits & Changelog Format

We strictly adhere to the [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) standard.

### Standard Categories
- `Added` for new features or techniques.
- `Changed` for changes in existing functionality.
- `Deprecated` for soon-to-be removed features.
- `Removed` for now removed features.
- `Fixed` for any bug fixes.
- `Security` in case of vulnerabilities or data privacy improvements.

### Example `CHANGELOG.md` Entry
```markdown
## [0.2.0] - 2026-08-15

### Added
- **Physiological Sigh**: Dual-crested stepped wave geometry for acute panic and anxiety relief.
- **Nadi Shodhana**: Lemniscate ($\infty$) loop geometry with stereo Web Audio panning.
- **Stereo Spatialization**: Web Audio `StereoPannerNode` for bilateral breath guidance.

### Changed
- Refactored `insetPolygon` to support parametric continuous Bezier and ellipse curves.
- Updated `CustomizerModal` with haptic intensity slider.

### Fixed
- Fixed audio oscillator click on rapid phase reset in Safari iOS.
```

---

## 🚀 Release Workflow Steps

1. **Calculate Next Version**: Inspect git log since last tag to determine whether change is `patch`, `minor`, or `major`.
2. **Update `package.json`**: Update the `"version"` field.
3. **Update `CHANGELOG.md`**: Convert `[Unreleased]` changes into a versioned release header with date.
4. **Git Commit & Tag**:
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore(release): vX.Y.Z"
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   ```
5. **Create GitHub Release**: Use GitHub MCP tools to publish the release with formatted release notes derived from `CHANGELOG.md`.
6. **Containerization (Docker)**: Build and publish the application as a provider-agnostic Docker image tagged with `vX.Y.Z` and `latest`.
7. **Deployment (Kubernetes / Helm)**: Generate or update Helm charts for the release and apply the deployment to the Kubernetes cluster to ensure zero-downtime rolling updates.

---

## ⏭️ Next Recommended Step

Once the release is cut and tagged:
👉 **Transition to [`sdlc-help`](../sdlc-help/SKILL.md)** or monitor production stability and user feedback.
