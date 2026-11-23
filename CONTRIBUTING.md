# Contributing to `sealit`

This repository dogfoods its own 8-module Alignment and Proof Kernel (`.agent/scripts/sealit-engine.mjs`) and 6 canonical `sealit*` skills.

## Local Setup & Verification

Requires **Node.js >= 22.0.0** and **Git >= 2.38**:

```bash
git clone https://github.com/fmatar/sealit.git
cd sealit
npm ci

# Install local 4-Layer Git hooks
npm run hooks:install

# Run syntax check, unit tests, doctor, and skill audit
npm run lint
npm test
npm run doctor
node .agent/scripts/sealit-engine.mjs skill-audit
```

## Delivery Workflow (`sealit-flow`)

1. **Start a Branch & Session (`INV-01` & `INV-02`)**: Direct commits to `main` and `develop` are blocked. Feature and fix branches fork from `develop`:
   ```bash
   node .agent/scripts/sealit-engine.mjs begin --title "<short-slug>" --type <feat|fix|chore> --checkout
   ```
2. **Spec & ADR Alignment (`INV-03`)**: When modifying `PRODUCT.md`, `docs/specs/*.md`, `.archlens/policy.json`, structural dependency manifests, schemas, or contracts, create and obtain human approval on an ADR (`sealit-adr`):
   ```bash
   node .agent/scripts/sealit-engine.mjs adr create --title "<decision>" --scope <technical|architectural|product|contract>
   node .agent/scripts/sealit-engine.mjs adr decide --id ADR-XXX --status approve --reviewer "@handle" --reason "<rationale>"
   ```
3. **Red-Green-Refactor TDD (`sealit-tdd`)**: Write a failing test first, implement minimal domain code adhering to `.archlens/policy.json` concentric rings (`<= 850` LOC per file), and verify `npm run coverage` and `npm run mutation`.
4. **Measured Gate & Stage 7 Receipt (`sealit-gate`)**: Run `node .agent/scripts/sealit-engine.mjs gate --no-cache`, run a fresh-context read-only review, sign the Stage 7 receipt (`review record --verdict approve`), commit `docs/AUDIT_CHAIN.jsonl`, and confirm `node .agent/scripts/sealit-engine.mjs verify` exits `0` before opening a PR to `develop`.
