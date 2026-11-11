# Contributing to Agentic SDLC Framework

Thank you for contributing to **Agentic SDLC Framework**! This repository dogfoods its own deterministic governance engine (`sdlc-engine.mjs`) and 10 canonical skills.

## 🛠️ Local Source Setup & Test Suite

Requires **Node.js >= 18** and **Git**:

```bash
git clone https://github.com/fmatar/agentic-sdlc-framework.git
cd agentic-sdlc-framework
npm ci

# Run the full F.I.R.S.T. unit & hardening test suite
npm test

# Verify >= 85% coverage, concentric ring boundaries, and zero README / Wiki drift
node .agent/scripts/sdlc-engine.mjs coverage --no-cache
node .agent/scripts/sdlc-engine.mjs readme audit --strict
node .agent/scripts/sdlc-engine.mjs wiki audit --strict
node .agent/scripts/sdlc-engine.mjs skill-audit
```

## 🤖 Developing with Coding Agents (`/sdlc-flow`)

1. **Start a Ticket Session (`INV-01` & `INV-02`)**: Direct commits to `main` are blocked by the 4-Layer Git Guard. Start an atomic feature branch and session lock via `/sdlc begin`:
   ```bash
   node .agent/scripts/sdlc-engine.mjs stage begin --title "<short-slug>" --type <feat|fix> --checkout
   ```
2. **Spec & ADR Alignment (`INV-03`)**: If modifying `PRODUCT.md`, `docs/specs/*.md`, dependency manifests, or CLI contracts, mint an ADR with `/sdlc-adr` (`node .agent/scripts/sdlc-engine.mjs adr create`).
3. **Robert Martin TDD (`/sdlc-tdd`)**: Write a failing Red test first, implement minimal Green domain logic adhering to `.archlens/policy.json` Concentric Clean Architecture rings, and refactor.
4. **Documentation & Multi-Agent Sync (`/sdlc-wiki`)**: When changing `.agent/skills/` or engine exports, sync multi-agent artifacts (`node .agent/scripts/sdlc-engine.mjs install --agents gemini,claude --yes --skip-detect`) and refresh `wiki/Codebase-Map.md` (`npm run wiki:sync`).
5. **Strict Quality Gate & Parallel Review (`/sdlc-gate`)**: Run `node .agent/scripts/sdlc-engine.mjs gate --strict` and record the parallel subagent peer-review verdict before merging.

## 🐛 Bug Reports & Feature Requests

Please open an issue using our [GitHub Issue Templates](./.github/ISSUE_TEMPLATE/) with clear reproduction steps or acceptance criteria.
