# Functional Specification: `CAP-07` — Native `npx` Interactive Multi-Agent Installer

- **Capability ID**: `CAP-07`
- **Specification ID**: `SPEC-07`
- **Superseding ADR**: `ADR-003`, `ADR-010`, `ADR-011`

## 1. Problem Statement & User Value

Maintaining separate `install.sh` (POSIX shell) and `install.java` (JBang) installers introduced platform divergence and lacked an interactive multi-agent selection wizard. Developers want a single modern command:

```bash
npx github:fmatar/agentic-sdlc-framework install
```

that launches a professional terminal wizard to select their AI coding tools (**Gemini / Antigravity**, **Claude Code**, **Cursor**, **Grok**, **Windsurf**, **GitHub Copilot / Codex**), installation scope (**Local Workspace** vs **Global User Config**), and governance add-ons.

## 2. Domain Contract & Acceptance Criteria

1. **Direct `npx` Execution (`package.json` `bin`)**:
   - Exposes `agentic-sdlc-framework`, `agentic-sdlc`, and `sdlc` pointing to `./.agent/scripts/sdlc-engine.mjs`.
   - Resolves bundled framework assets (`.agent/skills/`, `.agent/scripts/`, `docs/templates/`) via `import.meta.dirname` so `npx github:fmatar/agentic-sdlc-framework install` works from any target directory without cloning or `curl | bash`.
2. **Interactive Multi-Agent TUI Wizard & CLI Flags**:
   - Supports interactive arrow-key / spacebar multi-select when `process.stdin.isTTY` is true (unless `--yes` / `-y` is passed).
   - Supports non-interactive flags: `--agents <csv|all>`, `--global` / `-g`, `--local [dir]` / `--target <dir>`, `--with-archlens`, `--with-hooks`, `--with-ci`, `--skip-detect`, `--yes` / `-y`.
3. **Native Multi-Agent Adapter Generation (`SUPPORTED_AGENTS`)**:
   - `gemini`: `.agent/skills/<skill>/SKILL.md`, `.agent/scripts/*`, `AGENTS.md` (or `~/.gemini/config/skills/` in `--global` mode).
   - `claude`: `.claude/skills/<skill>/SKILL.md`, `.claude/cowork/<skill>.zip`, `.claude-plugin/plugin.json`, `.claude/settings.json`, `CLAUDE.md` (or `~/.claude/` in `--global` mode).
   - `cursor`: `.cursor/skills/<skill>/SKILL.md`, `.cursor/rules/agentic-sdlc.mdc`, `.cursor/rules/<skill>.mdc`, `.cursorrules` (or `~/.cursor/` in `--global` mode).
   - `grok`: `.grok/skills/<skill>/SKILL.md`, `.grok/settings.json`, `GROK.md` (or `~/.grok/` in `--global` mode).
   - `windsurf`: `.windsurf/rules/agentic-sdlc.md`, `.windsurf/workflows/<skill>.md`, `.windsurfrules`.
   - `copilot`: `.github/copilot-instructions.md`, `.github/prompts/<skill>.prompt.md`, `AGENTS.md`.
4. **Legacy Installer Removal, Deprecated `sdlc-*` Pruning & Namespace Isolation (`ADR-011`)**:
   - `install.sh` and `install.java` are removed from the repository.
   - `pruneDeprecatedSkills` automatically removes the 14 deprecated `sdlc-*` framework skills (`DEPRECATED_SDLC_SKILLS`) from target local and global skill directories while strictly leaving all non-`sdlc*` standalone user/third-party skills untouched.
