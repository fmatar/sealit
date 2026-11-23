# Product Constitution: [Product Name]

> **Single Source of Truth (`PRODUCT.md`)**
> Governed by **sealit (`sealit-spec` & `sealit-adr` · https://sealit.dev)**.
> Any architectural, dependency, or contract deviation from this constitution requires an accepted **ADR (`docs/adr/ADR-00X.md`)**.

---

## 1. Product Vision
[Concise summary of the product's purpose, target users, and core engineering guarantees.]

---

## 2. Hard Domain & System Invariants (`INV-XX`)
- **INV-01**: Zero direct commits, merges, or pushes to `main` or `develop` (enforced by 4-Layer Git Guard and Stage 7 HMAC-SHA256 Gate Receipts).
- **INV-02**: Code changes require an active Sealit session and single-path measured verification (`sealit gate`) meeting `.agent/sealit-config.json` diff coverage and mutation thresholds.
- **INV-03**: Spec, architecture policy, dependency, schema, and contract changes require an accepted ADR synchronized with `PRODUCT.md`.
- **INV-04**: Configured verification commands execute via `execFileSync` argument arrays without shell string interpolation.

---

## 3. Product Capabilities & Spec Traceability Matrix (`CAP-XX`)

| Capability ID | Capability Title | Functional Spec | Depends On | Status |
| :--- | :--- | :--- | :--- | :--- |
| CAP-01 | Core Domain Model & Invariants | `docs/specs/cap-01.md` | None | `PLANNED` |
| CAP-02 | Persistence & Repository Ports | `docs/specs/cap-02.md` | CAP-01 | `PLANNED` |
| CAP-03 | Delivery Entrypoints & CLI/API | `docs/specs/cap-03.md` | CAP-01, CAP-02 | `PLANNED` |

---

## 4. Merge & Verification Rules
- **Zero-Bypass Merge Rule**: Pull requests into `develop` or `main` require a signed Stage 7 HMAC-SHA256 Hash-Chain Gate Receipt in `docs/AUDIT_CHAIN.jsonl`.
- **Alignment Binding**: Every Stage 7 receipt cryptographically binds `headSha`, `treeSha`, `specHash`, and `adrHashes`.

---

## 5. Architectural Decision Log Index (`ADR-XXX`)
<!-- ADR_INDEX_START -->
| ADR ID | Title | Scope | Status | Ticket | Supersedes |
| :--- | :--- | :--- | :--- | :--- | :--- |
<!-- ADR_INDEX_END -->
