---
name: sdlc-init
description: Universal project bootstrap installer, interactive command guide, and environment doctor. Auto-detects polyglot stacks, scaffolds .archlens/policy.json and GitHub Actions CI workflows, installs 4-Layer Git hooks, and exports rules for Gemini/Antigravity, Claude Code, Cursor, Grok, Windsurf, and GitHub Copilot.
tools: read_file, write_file, edit_file, run_command
---

# ⚡ Universal Project Bootstrap & Environment Doctor (`sdlc-init`)

## 1. Quick-Start Bootstrap Sequence

Run the following deterministic commands to install, initialize, or heal any repository:

```bash
# 0. Native Multi-Agent Installer Wizard (Gemini, Claude, Cursor, Grok, Windsurf, Copilot)
npx github:fmatar/agentic-sdlc-framework install
# Or non-interactively:
npx github:fmatar/agentic-sdlc-framework install --agents gemini,claude,cursor,grok --with-archlens --with-hooks --yes

# 1. Auto-detect polyglot stack & generate .agent/sdlc-config.json
node .agent/scripts/sdlc-engine.mjs detect

# 2. Run environment healthcheck & auto-heal missing assets (KANBAN.md, Archlens policy, Git hooks, CI workflow)
node .agent/scripts/sdlc-engine.mjs doctor --fix

# 3. Install 4-Layer Git Guard hooks (.git/hooks/pre-commit, pre-merge-commit, pre-push)
node .agent/scripts/sdlc-engine.mjs hooks install

# 4. Export multi-agent interop rules (Gemini, Claude Code, Cursor, Grok, Windsurf, Copilot)
node .agent/scripts/sdlc-engine.mjs interop export --agent all
```

---

## 2. Project Management & Architecture Provisioning

- **GitHub Projects v2 Board Setup**:
  ```bash
  .agent/scripts/project-setup.sh
  .agent/scripts/kanban-sync.sh
  ```
- **Archlens Clean Architecture Policy (`.archlens/policy.json`)**:
  ```bash
  node .agent/scripts/sdlc-engine.mjs archlens scaffold
  ```
- **Multi-Branch Protection (`main`, `develop`)**:
  ```bash
  node .agent/scripts/sdlc-engine.mjs protect main develop
  ```

---

## 3. Complete 6-Skill Ecosystem Reference

| Skill | Purpose | Primary CLI Entrypoint |
| :--- | :--- | :--- |
| **`sdlc-flow`** | Master lifecycle orchestrator (`begin -> pre-pr -> complete`), Kanban & ArchTrace | `node .agent/scripts/sdlc-engine.mjs stage <begin\|pre-pr\|complete>` |
| **`sdlc-product`** | `PRODUCT.md` constitution, `docs/specs/`, ADRs, & topological DAG waves | `node .agent/scripts/sdlc-engine.mjs product <init\|plan\|control>` |
| **`sdlc-tdd`** | Robert Martin 3 Laws of TDD, $\ge 85\%$ coverage & $\ge 80\%$ mutation runner | `node .agent/scripts/sdlc-engine.mjs coverage` / `mutation` |
| **`sdlc-review-gate`** | Parallel Fork-Join PR peer review, strict quality gate & compliance audit | `node .agent/scripts/sdlc-engine.mjs gate --strict` |
| **`sdlc-release`** | Documentation/wiki sync, `CHANGELOG.md`, SemVer release & canary watchdog | `node .agent/scripts/sdlc-engine.mjs release <patch\|minor\|major>` |
| **`sdlc-init`** | Stack discovery, `doctor --fix`, Git hooks, Archlens policy & agent interop | `node .agent/scripts/sdlc-engine.mjs doctor --fix` |
