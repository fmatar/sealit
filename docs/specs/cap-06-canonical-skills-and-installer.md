# CAP-06: Canonical 6-Skill Suite, Symlink-Safe Multi-Agent Installer & Doctor

- **Capability ID**: `CAP-06`
- **Governing Module**: `.agent/scripts/lib/install.mjs` (Ring 2), `.agent/skills/{sdlc,sdlc-spec,sdlc-adr,sdlc-tdd,sdlc-gate,sdlc-flow}/SKILL.md`
- **Enforced Invariants**: `INV-01`, `INV-02`, `INV-04`

## 1. Inputs
- Canonical skill sources in `.agent/skills/<id>/SKILL.md`, target project directory (or `--global` `$HOME`), and selected AI coding agents (`antigravity`, `claude`, `cursor`, `codex`, `copilot`).

## 2. Domain Rules
1. **Single Tracked Skill Source**: Only `.agent/skills/{sdlc,sdlc-spec,sdlc-adr,sdlc-tdd,sdlc-gate,sdlc-flow}/SKILL.md` are tracked in git; `.claude-plugin/plugin.json` points `"skills"` directly to `"./.agent/skills"`. Agent-specific copies (`.claude/skills`, `.cursor/skills`, `.codex/skills`) are generated at install time and gitignored.
2. **Strict `sdlc*` Namespace Isolation & Retirement Pruning**: `installFramework` prunes retired `sdlc-*` skills (`sdlc-doctor`, `sdlc-product`, `sdlc-release`, `sdlc-status`, `sdlc-wiki`) and legacy duplicate `.cursor/rules/sdlc*.mdc` files while leaving all non-`sdlc*` user skills untouched.
3. **Symlink-Safe Provisioning & Config Preservation**: All file/directory writes unlink pre-existing symlinks (`lstatSync().isSymbolicLink()`) before writing so symlinks cannot redirect writes outside the target workspace. Valid `.agent/sdlc-config.json` files and malformed `.claude/settings.json` files are preserved without data loss.
4. **Read-Only Doctor & Skill Audit**: `runDoctor({ fix: false })` and `auditSkills` inspect runtime, git, config schema, `.archlens/policy.json`, hook SHA-256 digests, CI workflow freshness, `.agent/.receipt-key` status + `gh secret set SDLC_RECEIPT_KEY` hint, skill frontmatter/line caps (`<= 160` lines), and `AUDIT_CHAIN.jsonl` integrity without mutating disk or `process.env`.

## 3. Outputs & Acceptance Criteria
- `sdlc skill-audit` passes all 6 canonical skills with `0` findings.
- `sdlc init --yes` and `sdlc doctor --fix` provision or upgrade local/global installations deterministically; `npm pack --dry-run` produces a `< 120 kB` tarball with zero runtime dependencies.
