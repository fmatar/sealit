# Product Constitution: Sealit (`sealit`)

> **Single Source of Truth (`PRODUCT.md`)**
> Governed by **`sealit` v0.0.1 (`sealit-spec` & `sealit-adr` · [sealit.dev](https://sealit.dev))**.
> Any architectural, dependency, schema, or contract change requires an accepted **ADR (`docs/adr/ADR-00X.md`)**.

---

## 1. Product Vision
Open-source Alignment and Proof Kernel for AI coding agents (`Antigravity`, `Claude Code`, `Cursor`, `Codex`, `GitHub Copilot`). Enforces mechanical specification and ADR alignment, Concentric Clean Architecture ring boundaries (`.archlens/policy.json`), measured diff test coverage and mutation kill thresholds (`.agent/sealit-config.json`), and HMAC-SHA256 cryptographic merge receipts (`docs/AUDIT_CHAIN.jsonl`) with zero runtime dependencies.

---

## 2. Hard Domain & System Invariants (`INV-XX`)
- **INV-01**: Zero direct commits, merges, or pushes to `main` or `develop`; feature, fix, and chore PRs target `develop`, PRs targeting `main` originate exclusively from `develop`, and production releases trigger when `develop` merges into `main`.
- **INV-02**: Code changes require an active Sealit session (`.agent/.sealit-session.json`) and single-path measured verification (`sealit gate`) meeting the diff coverage, diff mutation, architecture ring, and review requirements configured in `.agent/sealit-config.json`.
- **INV-03**: Mutations to `PRODUCT.md`, `docs/PRD.md`, `docs/SRS.md`, `docs/specs/*.md`, `.archlens/policy.json`, structural dependency manifests, schemas, or API contracts require an `accepted` ADR in `docs/adr/ADR-*.md`.
- **INV-04**: Configured lint, build, test, coverage, and mutation commands execute via `execFileSync` argument arrays (`parseCommandArgv` / `runConfiguredCommand`) with zero shell string interpolation.

---

## 3. Product Capabilities & Spec Traceability Matrix (`CAP-XX`)

| Capability ID | Capability Title | Functional Spec | Depends On | Status |
| :--- | :--- | :--- | :--- | :--- |
| CAP-01 | Git Flow, Linked-Worktree Hygiene & 4-Layer Guard | `docs/specs/cap-01-git-and-worktree-guard.md` | None | `ACTIVE (ADR-026)` |
| CAP-02 | Schema-Validated Configuration & Shell-Free Execution | `docs/specs/cap-02-config-and-shell-free-execution.md` | None | `ACTIVE (ADR-026)` |
| CAP-03 | Spec, ADR & Concentric Ring Alignment | `docs/specs/cap-03-spec-adr-and-ring-alignment.md` | CAP-01, CAP-02 | `ACTIVE (ADR-026)` |
| CAP-04 | Single-Path Measured Quality Gate (Coverage, Mutation & Secret Scan) | `docs/specs/cap-04-single-path-measured-gate.md` | CAP-01, CAP-02, CAP-03 | `ACTIVE (ADR-026)` |
| CAP-05 | Cryptographic HMAC-SHA256 Merge Receipts & Audit Chain | `docs/specs/cap-05-cryptographic-merge-receipts.md` | CAP-01, CAP-03, CAP-04 | `ACTIVE (ADR-026)` |
| CAP-06 | Canonical 6-Skill Suite, Symlink-Safe Multi-Agent Installer & Doctor | `docs/specs/cap-06-canonical-skills-and-installer.md` | CAP-01, CAP-02, CAP-05 | `ACTIVE (ADR-026)` |

---

## 4. Merge & Release Governance Rules
- **Zero-Bypass Merge Rule**: Merges into `develop` or `main` require a signed Stage 7 HMAC-SHA256 Gate Receipt in `docs/AUDIT_CHAIN.jsonl` verified by local Git hooks and CI (`sealit verify`).
- **Cryptographic Alignment Binding**: Every Stage 7 receipt binds `headSha`, `treeSha`, `specHash`, `adrHashes`, measured `diffCoverage`, measured `mutationScore`, and reviewer sign-off.

---

## 5. Architectural Decision Log Index (`ADR-XXX`)
<!-- ADR_INDEX_START -->
| ADR ID | Title | Scope | Status | Ticket | Supersedes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| ADR-019 | v0.1.0 Alignment and Proof Kernel Simplification | `technical` | `accepted` | 190 | CAP-01, CAP-02, CAP-03, CAP-04, CAP-05, CAP-06, CAP-07, CAP-08, CAP-09, CAP-10, CAP-11 |
| ADR-020 | Commit-Object Gate Engine via Git Plumbing | `architectural` | `accepted` | L-4 | CAP-01, CAP-03, CAP-04 |
| ADR-021 | Monotonic Effective Gate Policy & Stable Mutant-Identity Exemptions | `architectural` | `accepted` | L-5 | CAP-02, CAP-03, CAP-04 |
| ADR-022 | Enriched 6-Skill Kernel, Dual-Format ADRs & Pointer Review Plan | `architectural` | `accepted` | L-8 | CAP-01, CAP-03, CAP-04, CAP-06 |
| ADR-023 | First adoption passes the gate | `technical` | `accepted` | L-10 | CAP-04, CAP-06 |
| ADR-024 | Two-track skill installation | `architectural` | `accepted` | L-11 | CAP-06 |
| ADR-026 | Rebrand to sealit (sealit.dev) and reset version baseline to 0.0.1 | `architectural` | `accepted` | L-13 | CAP-01, CAP-02, CAP-03, CAP-04, CAP-05, CAP-06, ADR-024 |
<!-- ADR_INDEX_END -->
