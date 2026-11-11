# Functional Specification: `CAP-07` — Native `npx` Interactive Multi-Agent Installer

- **Capability ID**: `CAP-07`
- **Specification ID**: `SPEC-07`
- **Superseding ADR**: `ADR-003`

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
   - `claude`: `.claude/skills/<skill>/SKILL.md`, `.claude/commands/<skill>.md`, `.claude/settings.json`, `CLAUDE.md` (or `~/.claude/` in `--global` mode).
   - `cursor`: `.cursor/rules/agentic-sdlc.mdc`, `.cursor/rules/<skill>.mdc`, `.cursorrules`.
   - `grok`: `.grok/skills/<skill>/SKILL.md`, `.grok/settings.json`, `GROK.md` (or `~/.grok/` in `--global` mode).
   - `windsurf`: `.windsurf/rules/agentic-sdlc.md`, `.windsurf/workflows/<skill>.md`, `.windsurfrules`.
   - `copilot`: `.github/copilot-instructions.md`, `.github/prompts/<skill>.prompt.md`, `AGENTS.md`.
4. **Legacy Installer Removal & Deprecated Skill Pruning**:
   - `install.sh` and `install.java` are removed from the repository.
   - `pruneDeprecatedSkills` automatically removes the 12 deprecated pre-`v0.1.0` `sdlc-*` directories from target skill directories.
