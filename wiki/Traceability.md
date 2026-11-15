# 🎯 End-to-End Traceability, Multi-Provider Kanban & Cryptographic Ledgers

The **Agentic SDLC Framework** enforces unbroken traceability from constitutional product capabilities (`PRODUCT.md`) and issue tickets (`GitHub Issues`, `Linear`, `Jira`, and `docs/KANBAN.md`) down to feature branches, [Archlens](https://github.com/fmatar/archlens)-governed Mermaid architecture diffs (`docs/ARCH_TRACE.md`, `.archlens/policy.json`), cryptographic hash-chain audit records and Stage 7 HMAC-SHA256 Gate Receipts (`docs/AUDIT_CHAIN.jsonl`), and AST-verified wiki documentation (`wiki/Codebase-Map.md`).

---

## 1. End-to-End Traceability Chain

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart TD
    P["PRODUCT.md (CAP-XX / INV-XX)"] --> S["docs/specs/cap-XX-*.md (PRD + IEEE 29148 SRS)"]
    S --> T["Ticket (#ID in GitHub / Linear / Jira & docs/KANBAN.md)"]
    T --> B["Isolated Branch (feature/issue-#ID-slug)"]
    B --> C["TDD & Config-Driven Dual-Gate (.agent/sdlc-config.json)"]
    C --> W["Wiki & README Strict Audit (wiki/, README.md)"]
    W --> R["Stage 7 HMAC-SHA256 Receipt (docs/AUDIT_CHAIN.jsonl)"]
    R --> M["Protected Merge to main & Release Tag"]
```

| Traceability Artifact | Repository Path | Governing Engine Module |
| :--- | :--- | :--- |
| **Product Constitution** | `PRODUCT.md` | `.agent/scripts/lib/product-dag.mjs` |
| **Two-Tier PRD & IEEE 29148 SRS** | `docs/PRD.md`, `docs/SRS.md`, `docs/specs/` | `.agent/scripts/lib/product-dag.mjs` |
| **Architecture Decision Records** | `docs/adr/`, `docs/SRS.md` | `.agent/scripts/lib/adr-drift.mjs` |
| **Causal Decision Lineage Map** | `docs/DECISION_MAP.md` | `.agent/scripts/lib/decision-graph.mjs` |
| **Living Markdown Kanban Board** | `docs/KANBAN.md` | `.agent/scripts/lib/pm-provider.mjs` & `.agent/scripts/kanban-sync.sh` |
| **Canonical Issue & PR Templates** | `.github/ISSUE_TEMPLATE/*.md`, `.github/PULL_REQUEST_TEMPLATE.md` | `.agent/scripts/lib/pm-provider.mjs` |
| **Architectural Trace Ledger ([Archlens](https://github.com/fmatar/archlens))** | `docs/ARCH_TRACE.md`, `.archlens/policy.json` | `.agent/scripts/lib/arch-trace.mjs` |
| **Cryptographic Hash-Chain Audit Log** | `docs/AUDIT_CHAIN.jsonl` | `.agent/scripts/lib/audit-chain.mjs` |
| **Stage 7 Merge Gate Receipts** | `docs/AUDIT_CHAIN.jsonl`, `.agent/.receipt-key` | `.agent/scripts/lib/audit-chain.mjs` & `.agent/scripts/lib/git-guard.mjs` |
| **AST-to-Wiki & 10-30-90 README Sync** | `wiki/Codebase-Map.md`, `README.md` | `.agent/scripts/lib/wiki-sync.mjs` & `.agent/scripts/lib/readme-sync.mjs` |

---

## 2. Unified Multi-Provider Ticket Engine (`pm-provider.mjs`)

Per `CAP-10`, `.agent/scripts/lib/pm-provider.mjs` provides a 4-operation interface (`createTicket`, `transitionPMState`, `postPMComment`, `syncKanbanBoard`) across **GitHub Projects v2**, **Linear GraphQL**, **Jira REST API v3**, and local **Markdown fallback** (`docs/KANBAN.md`), with zero shell interpolation (`execFileSync` argument arrays per `INV-04`):

```bash
# 1. Scaffold the 5 canonical issue & PR templates (.github/ISSUE_TEMPLATE/*.md)
node .agent/scripts/sdlc-engine.mjs ticket templates

# 2. Create a templated ticket (feat | bug | hotfix | spike)
node .agent/scripts/sdlc-engine.mjs ticket create --type feat --title "Add Archlens Wiki Sync" --problem "Wiki pages drift from AST" --solution "Build lib/wiki-sync.mjs"

# 3. Transition ticket state (backlog | ready | in-progress | in-review | done)
node .agent/scripts/sdlc-engine.mjs ticket transition 90 in-progress

# 4. Post a structured verification comment
node .agent/scripts/sdlc-engine.mjs ticket comment 90 --body "Dual-Gate and Wiki Audit passed."

# 5. Synchronize docs/KANBAN.md with live provider state
node .agent/scripts/sdlc-engine.mjs ticket sync
```

### GitHub Projects v2 Provisioning & Sync Scripts

For repositories using GitHub Projects v2, two executable helper scripts in `.agent/scripts/` automate custom field provisioning and local board generation:

```bash
# Provision GitHub Project v2 with Priority, Component, Estimate, Spec Link, and Quality Gate fields
.agent/scripts/project-setup.sh --title "Agentic SDLC Roadmap"

# Regenerate docs/KANBAN.md with the 5-column Board Overview and End-to-End Traceability Matrix
.agent/scripts/kanban-sync.sh
```

---

## 3. Cryptographic Audit Trail & Stage 7 Gate Receipts

Every state transition and merge authorization in the framework is recorded inside the tamper-evident hash chain managed by `.agent/scripts/lib/audit-chain.mjs`:

1. **Sequential SHA-256 Hash-Chain Audit Log (`docs/AUDIT_CHAIN.jsonl`)**:
   - Each record hashes `index + timestamp + event + metadata + previousHash` starting from `GENESIS_HASH` (`0000...0000`).
   - Verify integrity at any time:
     ```bash
     node .agent/scripts/sdlc-engine.mjs audit verify
     ```
2. **Stage 7 HMAC-SHA256 Gate Receipts (`STAGE_7_GATE_RECEIPT_SIGNED` in `docs/AUDIT_CHAIN.jsonl`)**:
   - Signed with `.agent/.receipt-key` (or `SDLC_RECEIPT_KEY`) via `node .agent/scripts/sdlc-engine.mjs review record --verdict approve` / `guard receipt` (and auto-signed during `stage pre-pr` for eligible `trivial`-lane changes) only when lane-required measured **Coverage/Mutation**, **Spec-Drift (`checkSpecDrift`)**, and **Wiki Audit (`auditWiki`)** pass.
   - Binds the branch name, ticket ID, execution lane (`trivial` / `standard` / `full`), measured coverage/mutation metrics, reviewer verdict, and chain hash into an HMAC-SHA256 signature verified by `verifyMergeGuard` before any merge into `main`.

---

## 4. Zero-Rot Wiki Auditing (`sdlc-wiki` & `lib/wiki-sync.mjs`)

To prevent documentation drift, `node .agent/scripts/sdlc-engine.mjs wiki audit --strict` runs five deterministic checks across all `wiki/*.md` pages (and is invoked automatically during `stage pre-pr` and `gate --strict`):

1. **`DEPRECATED_SKILL_REF`**: Flags any active reference to retired legacy skills (`DEPRECATED_SDLC_SKILLS`).
2. **`BROKEN_CODE_PATH`**: Verifies that every backticked repository path (`.agent/...`, `docs/...`, `wiki/...`, `tests/...`) exists on disk.
3. **`UNDOCUMENTED_SKILL`**: Ensures every skill in `CANONICAL_SDLC_SKILLS` is documented in `wiki/`.
4. **`UNMAPPED_SOURCE_MODULE`**: Ensures every `.agent/scripts/lib/*.mjs` module and `.agent/scripts/sdlc-engine.mjs` is mapped in `wiki/Codebase-Map.md` and `wiki/Architecture.md`.
5. **`INVALID_MERMAID_DIAGRAM`**: Validates Mermaid diagram headers and parses flowcharts via `parseMermaidDiagram` in `.agent/scripts/lib/arch-trace.mjs`.
