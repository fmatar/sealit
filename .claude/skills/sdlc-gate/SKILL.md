---
name: sdlc-gate
description: Parallel Fork-Join PR peer reviewer, strict 9-pillar quality gatekeeper, Archlens concentric ring auditor, security/CVE scanner, and Stage 7 signed gate receipt issuer.
allowed-tools: Read, Write, Edit, Bash, Agent
---

# 🛡️ Parallel PR Review & Strict Quality Gate (`sdlc-gate`)

## 1. Parallel Fork-Join Subagent Peer Review

Dispatch two independent read-only subagents in parallel using `Agent` (`TypeName: "research"`):

1. **Subagent 1 (`PR Peer Reviewer`)**:
   - `TypeName`: `"research"`
   - `Role`: `"PR Peer Reviewer"`
   - `Prompt`: `"Audit git diff against main for Robert C. Martin test smells (trivial getter/setter tests, mock abuse, assertionless tests, implementation coupling), F.I.R.S.T. isolation, and Dual-Gate coverage (>=85% coverage, >=80% mutation). Return a structured review verdict."`
2. **Subagent 2 (`Architecture & Security Gatekeeper`)**:
   - `TypeName`: `"research"`
   - `Role`: `"Architecture & Security Gatekeeper"`
   - `Prompt`: `"Audit git diff against main for .archlens/policy.json Concentric Clean Architecture ring inversions (Core -> UseCase -> Adapter), API contract drift, and leaked secrets/CVEs. Return a structured gate verdict."`

---

## 2. Strict 9-Pillar Quality Gate & Cryptographic Receipt

Execute the deterministic engine checks and issue the signed Stage 7 gate receipt required by the `pre-merge-commit` hook:

```bash
# 1. Run strict quality gate (Tests, Coverage, Archlens rings, Spec Drift, Contract Drift, Security, Flake, Audit Chain)
node .agent/scripts/sdlc-engine.mjs gate --strict

# 2. Record the reviewer verdict, then issue the HMAC-signed receipt into docs/AUDIT_CHAIN.jsonl
#    (refuses unless coverage, mutation (or mutationScore: null), review and drift were measured)
node .agent/scripts/sdlc-engine.mjs review record --verdict approve --reviewer "<reviewer>"
node .agent/scripts/sdlc-engine.mjs guard receipt

# 3. Post the consolidated review verdict to GitHub PR/Issue or docs/KANBAN.md
node .agent/scripts/sdlc-engine.mjs pm comment <id> --pr <prNumber> --body "<verdict>"
```
