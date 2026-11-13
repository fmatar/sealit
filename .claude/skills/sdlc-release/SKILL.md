---
name: sdlc-release
description: Use when cutting a SemVer release, compacting ADRs, generating regression proofs, or running canary health checks. Not for routine per-ticket feature commits.
allowed-tools: Read, Write, Edit, Bash
---

# Release Cut, ADR Compaction & Canary Watchdog (`sdlc-release`)

## When to use / When NOT to use
- **Use when** cutting a `patch`, `minor`, or `major` SemVer release, compacting accepted ADRs into `docs/SRS.md`, generating delivery proofs, or probing post-release health.
- **Not for** ordinary feature/bug PRs (do not run release-level doc/changelog compaction on every ticket).

## Branch & `INV-01` Protocol (Where Releases Happen)
Direct commits to `main` and `develop` are blocked by `INV-01` and branch protection:
1. Start a release branch from `develop` via `stage begin --local --title "Release vX.Y.Z" --type chore --checkout` (or `--issue <id>`). `release` refuses to execute directly on `main` or `develop`.
2. Sync docs (`sdlc-wiki`), run `gate --strict`, and run `release <patch|minor|major> --no-tag` **on the release branch** (`executeRelease` runs `gate --strict`, updates `package.json`, `package-lock.json`, and `.claude-plugin/plugin.json`, compacts accepted ADRs into `docs/SRS.md`, rolls `CHANGELOG.md`, and fails closed if committing fails). Pure `version` bumps in `package.json` are exempted from `drift check`.
3. Complete `stage pre-pr` + `sdlc-gate` (`review record` Stage 7 receipt), wait for green CI, and merge the release PR into `develop`.
4. Promote `develop` to `main` via PR (`gh pr create --base main --head develop --title "chore(release): release vX.Y.Z"`). PRs targeting `main` must originate exclusively from `develop`.
5. Merging `develop` into `main` automatically triggers the GitHub Actions `Production Release` pipeline (`release.yml`), which verifies `gate --strict`, tags `main` (`vX.Y.Z`), extracts release notes from `CHANGELOG.md`, creates the GitHub Release, and publishes to npm when credentials (`NPM_TOKEN`) are configured.

## Lane behavior
| Release type | Required verification |
| :--- | :--- |
| `patch` / `minor` / `major` | Releases always run in `full` lane (`gate --strict`, `readme audit --strict`, `wiki sync`, `wiki audit --strict`, Stage 7 signed receipt, green CI). |

## Steps

```bash
# 1. Sync docs & verify strict 9-pillar quality gate on the release branch
node .agent/scripts/sdlc-engine.mjs wiki sync
node .agent/scripts/sdlc-engine.mjs wiki audit --strict
node .agent/scripts/sdlc-engine.mjs readme audit --strict
node .agent/scripts/sdlc-engine.mjs gate --strict

# 2. (Optional) Generate SHA-256 delivery regression proof
node .agent/scripts/sdlc-engine.mjs proof generate --name <release-version>

# 3. Preview SemVer bump & ADR compaction first (--dry-run), then execute on release branch
node .agent/scripts/sdlc-engine.mjs release <patch|minor|major> --dry-run
node .agent/scripts/sdlc-engine.mjs release <patch|minor|major>

# 4. After PR merge to main: monitor canary health endpoint (read-only probe unless rollback confirmed)
node .agent/scripts/sdlc-engine.mjs watchdog monitor --url https://service.example.com/health --threshold 0.05 --samples 5 --live
```

## ⚠️ Confirm with user before
- Running `release <patch|minor|major>` without `--dry-run` (always present `--dry-run` output first).
- Pushing git tags (`git push origin vX.Y.Z`), running `gh release create`, `npm publish`, or passing `--rollback` to `watchdog monitor`.

## If it fails
- **`adr compact` fails on `pending_approval` ADR** -> resolve pending ADRs via `sdlc-adr` before cutting the release, or pass `--no-compact` if explicitly requested.
- **`gate --strict` or `readme/wiki audit` fails** -> fix findings on the release branch before running `release`.

## Done when
Release PR is merged into `develop`, promoted from `develop` to `main`, and the GitHub Actions release workflow tags `main`, creates the GitHub Release, and closes the session via `stage complete`.
