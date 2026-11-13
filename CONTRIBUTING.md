# Contributing to Agentic SDLC Framework

Thank you for contributing to **Agentic SDLC Framework**! This repository dogfoods its own deterministic governance engine (`sdlc-engine.mjs`) and **10 canonical skills** (`/sdlc` router and 9 verb skills).

## 🛠️ Local Source Setup & Test Suite

Requires **Node.js >= 18** and **Git >= 2.30**:

```bash
git clone https://github.com/fmatar/agentic-sdlc-framework.git
cd agentic-sdlc-framework
npm ci

# Run the full F.I.R.S.T. unit & hardening test suite
npm test

# Verify config-driven coverage, Archlens concentric ring boundaries, and zero README / Wiki drift
node .agent/scripts/sdlc-engine.mjs coverage --no-cache
node .agent/scripts/sdlc-engine.mjs readme audit --strict
node .agent/scripts/sdlc-engine.mjs wiki audit --strict
node .agent/scripts/sdlc-engine.mjs skill-audit
```

## 🤖 Developing with Coding Agents (`/sdlc-flow`)

1. **Start a Proportional Ticket Session (`INV-01` & `INV-02`)**: Direct commits to `main` and `develop` are blocked by the 4-Layer Git Guard. Feature branches are cut from `develop`, and pull requests target `develop`:
   ```bash
   # Existing remote ticket, or local L-* session (no remote issue spam):
   node .agent/scripts/sdlc-engine.mjs stage begin --issue <id> --type <feat|fix> --checkout
   node .agent/scripts/sdlc-engine.mjs stage begin --local --title "<short-slug>" --type <feat|fix> --checkout

   # Create a new remote issue explicitly (opt-in):
   node .agent/scripts/sdlc-engine.mjs stage begin --create-issue --title "<short-slug>" --type <feat|fix> --checkout

   # Trivial docs/copy/style tweak (<= 25 lines, local L-* session):
   node .agent/scripts/sdlc-engine.mjs stage begin --lane trivial --title "<short-slug>" --checkout
   ```
2. **Spec & ADR Alignment (`INV-03`)**: If modifying `PRODUCT.md`, `docs/specs/*.md`, `docs/PRD.md`, `docs/SRS.md`, structural dependency manifests, or CLI contracts, mint an ADR with `/sdlc-adr` (`node .agent/scripts/sdlc-engine.mjs adr create`).
3. **Red-Green-Refactor TDD & Clean Architecture (`/sdlc-tdd`)**: Write a failing Red test first, implement minimal Green domain logic adhering to [Archlens](https://github.com/fmatar/archlens) Concentric Clean Architecture rings (`.archlens/policy.json`), and refactor.
4. **Documentation & Multi-Agent Sync (`/sdlc-wiki`)**: When changing `.agent/skills/` or engine exports, sync multi-agent artifacts (`node .agent/scripts/sdlc-engine.mjs interop export --agent gemini,claude,cursor` — strictly scoped to `sdlc*` so standalone skills are untouched) and refresh `wiki/Codebase-Map.md` (`npm run wiki:sync`).
5. **Strict Quality Gate & Parallel Review (`/sdlc-gate`)**: Run `node .agent/scripts/sdlc-engine.mjs gate --strict`, record the subagent peer-review verdict (`review record`), and ensure GitHub Actions CI (`SDLC Quality Gate`) passes before merging into `develop`. Production releases occur when `develop` is merged into `main` via PR.

## 🐛 Bug Reports & Feature Requests

Please open an issue using our [GitHub Issue Templates](./.github/ISSUE_TEMPLATE/) with clear reproduction steps or acceptance criteria.
