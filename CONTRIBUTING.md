# Contributing to `sealit`

This repository dogfoods its own zero-dependency verification kernel (`.agent/scripts/sealit-engine.mjs`) and 6 canonical `sealit*` skills.

## Local Setup & Verification

Requires **Node.js >= 22.0.0** and **Git >= 2.38**:

```bash
git clone https://github.com/fmatar/sealit.git
cd sealit
npm ci

# Install local Git hooks
npm run hooks:install

# Run syntax check, unit tests, doctor, and skill audit
npm run lint
npm test
npm run doctor
node .agent/scripts/sealit-engine.mjs skill-audit
```

## Delivery Workflow (`sealit-flow`)

1. **Start a Branch & Session**: Direct commits to `main` and `develop` are blocked. Feature, fix, and chore branches fork from `develop`:
   ```bash
   node .agent/scripts/sealit-engine.mjs begin --title "<short-slug>" --type <feat|fix|chore> --checkout
   ```
2. **Spec & ADR Alignment**: When modifying `PRODUCT.md`, `docs/specs/*.md`, `.archlens/policy.json`, structural dependency manifests, schemas, or contracts, create and obtain human approval on an ADR (`sealit-adr`):
   ```bash
   node .agent/scripts/sealit-engine.mjs adr create --title "<decision>" --scope <technical|architectural|product|contract>
   node .agent/scripts/sealit-engine.mjs adr decide --id ADR-XXX --status approve --reviewer "@handle" --reason "<rationale>"
   ```
3. **Red-Green-Refactor TDD (`sealit-tdd`)**: Write a failing test first, implement minimal domain code adhering to `.archlens/policy.json` concentric rings (`<= 850` LOC per file), and verify `npm run coverage` and `npm run mutation`.
4. **Measured Gate & Merge Receipt (`sealit-gate`)**: Run `node .agent/scripts/sealit-engine.mjs gate --no-cache`, run a 2-axis cold review, sign the merge receipt (`review record --verdict approve`), commit `docs/AUDIT_CHAIN.jsonl`, and confirm `node .agent/scripts/sealit-engine.mjs verify` exits `0` before opening a PR to `develop`.
