---
id: ADR-003
title: Replace Legacy Shell/Java Installers with Native npx Interactive Multi-Agent Installer Wizard
status: accepted
scope: architectural
ticket: #75
supersedes: CAP-06, CAP-07
createdAt: 2026-10-26T14:38:00.000Z
---

# ADR-003: Replace Legacy Shell/Java Installers with Native npx Interactive Multi-Agent Installer Wizard

## 1. Context & Problem Statement

Maintaining `install.sh` (POSIX shell script) and `install.java` (JBang Java script) alongside the Node.js SDLC engine created duplicate installation pathways, required external runtimes (`curl | bash` or `jbang`), and lacked an interactive multi-agent selection wizard.

## 2. Decision

1. Delete `install.sh` and `install.java`.
2. Introduce `.agent/scripts/lib/installer.mjs` and wire `install` / `init` into `sdlc-engine.mjs` (`npx github:fmatar/agentic-sdlc-framework install`).
3. Configure `package.json` `bin` entries (`agentic-sdlc-framework`, `agentic-sdlc`, `sdlc`) so `npx github:fmatar/agentic-sdlc-framework install` launches a zero-dependency interactive TUI wizard supporting **Gemini / Antigravity**, **Claude Code**, **Cursor**, **Grok**, **Windsurf**, and **GitHub Copilot / Codex**.
4. Automatically prune deprecated pre-`v0.1.0` `sdlc-*` skill folders across local and global agent directories.

## 3. Consequences

- Single cross-platform installer (`npx github:fmatar/agentic-sdlc-framework install`) with zero external dependencies.
- Native slash commands and skill directories generated for all 6 major AI coding tools.
