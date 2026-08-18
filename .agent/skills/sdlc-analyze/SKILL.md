---
name: sdlc-analyze
description: SDLC compliance auditor that evaluates repository health, documentation presence, test coverage, static analysis, and a11y.
version: 1.0.0
license: Apache 2.0
---

# SDLC Compliance Auditor (`sdlc-analyze`)

Use this skill to audit a repository for adherence to the The Project standards. It evaluates both frontend (Svelte) and backend (Quarkus) projects, producing an informational dashboard or blocking execution when run in strict mode.

## 📋 Core Responsibilities
1. **Documentation Audit**: Verifies the presence and completeness of PRDs, SRSs, C4 Architecture, and ADRs in `docs/specs/`.
2. **Frontend Analysis**: Runs `svelte-check`, Vitest coverage asserts, ESLint/Prettier, and Accessibility (a11y) audits.
3. **Backend Analysis**: Evaluates Quarkus project compliance using Maven plugins (PMD, Checkstyle, Jacoco coverage thresholds).
4. **Report Generation**: Outputs `docs/SDLC_COMPLIANCE_REPORT.md` as a health score artifact.
5. **Strict Enforcement**: When invoked with `--strict`, the agent should exit with an error if compliance thresholds are not met, blocking release pipelines.

---

## 🛠️ Execution Workflow

### 1. Identify Project Structure
- Check if the repository contains a `package.json` (Frontend) and/or a `pom.xml` (Backend).

### 2. Documentation Audit
- Check `docs/specs/` and `docs/templates/` for required architecture documents.
- Warn if missing.

### 3. Svelte Frontend Audit
If a frontend exists:
- Run `npx svelte-check --tsconfig ./tsconfig.json`
- Run `npx vitest run --coverage` (Check coverage % against thresholds)
- Run `npx eslint .` (if configured)

### 4. Quarkus Backend Audit
If a backend exists:
- Run `mvn pmd:check` and `mvn checkstyle:check`
- Run `mvn jacoco:report` and check line/branch coverage parsing `target/site/jacoco/jacoco.csv`.

### 5. Generate Report & Enforce
- Compile findings into a Markdown artifact `SDLC_COMPLIANCE_REPORT.md`.
- If the invoking context requested "strict mode" (e.g. `sdlc-quality-gate`), throw a failure if any critical checks failed.

---

## ⏭️ Next Recommended Step
If the compliance score is below thresholds, invoke `sdlc-flow` to automatically fix the reported issues (e.g. write missing tests or fix static analysis errors).
