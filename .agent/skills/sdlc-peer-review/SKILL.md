---
name: sdlc-peer-review
description: Parallel peer reviewer subagent that audits git diffs, verifies >= 90% test coverage, validates developer showcase onboarding quickstarts, checks Svelte 5 / Quarkus project rules, and posts formal review comments to GitHub PRs.
version: 1.1.0
license: Apache 2.0
allowed-tools: run_command, view_file, mcp_github-mcp-server_pull_request_read, mcp_github-mcp-server_get_file_contents, mcp_github-mcp-server_add_comment_to_pending_review, mcp_github-mcp-server_pull_request_review_write
---

# SDLC Parallel Peer Reviewer Skill (`sdlc-peer-review`)

Use this skill when invoked as a parallel reviewer subagent via `invoke_subagent` to independently audit Pull Requests.

---

## 🔍 Audit Checklist

1. **Code Standards & Architecture**:
   - **Frontend**: Svelte 5 runes (`$state`, `$derived`, `$props`) used correctly; no legacy Svelte 4 reactivity or raw DOM mutators.
   - **Backend**: Quarkus reactive standards (Mutiny `Uni`/`Multi`, Panache Reactive); no thread-blocking database queries or split packages.
2. **Security & Input Hygiene**:
   - Validate null checks, input sanitization, boundaries, and secure token/secret handling (zero plaintext credentials).
3. **Coverage Compliance**:
   - Inspect coverage reports (JaCoCo `target/site/jacoco/index.html` or Vitest `coverage/index.html`).
   - Confirm modified line coverage meets or exceeds **$\ge$ 90%**.
4. **Documentation & Changelog**:
   - Confirm `CHANGELOG.md` reflects changes under `[Unreleased]` with ticket links.
   - Confirm specs in `docs/specs/` or inline docstrings are updated.
5. **Kanban & Issue Association**:
   - Confirm PR description explicitly includes `Fixes #<id>` linking to a tracked GitHub issue tagged `status:in-review`.
6. **Developer Showcase & Quickstart Validity**:
   - Confirm root `README.md` maintains a functional, copy-pasteable **5-Minute Developer Quickstart**.
   - If new features, CLI commands, or archetypes were introduced, confirm runnable examples and the BYOA contract are updated.

---

## 🛠️ Execution & Posting

1. Inspect the diff against `main` or base branch (`git diff origin/main...HEAD`).
2. Synthesize line-specific review comments.
3. Call `pull_request_review_write` via `github-mcp-server`:
   - Set event to `APPROVE` if all checks pass.
   - Set event to `REQUEST_CHANGES` if coverage is $<90\%$ or if critical bugs/violations exist.
   - Include the structured markdown review body with metrics.

---

## ⏭️ Next Recommended Step

- Report review status back to parent orchestrator (`sdlc-flow`).
