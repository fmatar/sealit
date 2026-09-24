---
name: sdlc-analyze
description: SDLC compliance auditor that evaluates repository health, documentation presence, test coverage, static analysis, and a11y.
version: 2.1.0
license: Apache 2.0
allowed-tools: run_command, view_file
---

# SDLC Compliance Auditor (`sdlc-analyze`)

Use this skill to audit a repository for adherence to enterprise software quality and architecture standards. It evaluates both frontend (Svelte 5) and backend (Quarkus) projects, producing an informational dashboard or blocking execution in strict mode.

---

## 📋 Core Responsibilities

1. **Documentation & Showcase Audit**: Verifies the presence of the root `README.md` Developer Showcase (5-minute quickstart, BYOA contract), PRDs, SRSs, C4 Architecture, and ADRs in `docs/specs/` and `wiki/`.
2. **Frontend Analysis**: Runs `svelte-check`, Vitest coverage asserts, and Accessibility (a11y) audits.
3. **Backend Analysis**: Evaluates Quarkus project compliance using Maven plugins (Spotless, PMD, Checkstyle, JaCoCo coverage $\ge$ 90%).
4. **Report Generation**: Outputs `docs/SDLC_COMPLIANCE_REPORT.md` as a health score artifact.
5. **Strict Enforcement**: When invoked with `--strict`, the agent terminates with an error if compliance thresholds are not met, preventing faulty merges.

---

## 🛠️ Execution Workflow

### 1. Identify Project Structure
- Check if the repository contains `package.json` (Frontend) and/or `pom.xml` (Backend).

### 2. Documentation & Showcase Audit
- Check root `README.md` for a complete **5-Minute Developer Quickstart** (< 5 min time-to-first-run, BYOA workflow, runnable examples).
- Check `docs/specs/` and `docs/templates/` for required architecture documents.
- Verify `CHANGELOG.md` exists and tracks `[Unreleased]`.
- Verify `docs/KANBAN.md` living board exists and reflects active issues.

### 3. Svelte Frontend Audit
If frontend exists:
- Run `npx svelte-check --tsconfig ./tsconfig.json`
- Run `npm run test:coverage` (Check coverage against $\ge$ 90% threshold)
- Run `npm run format:check`

### 4. Quarkus Backend Audit
If backend exists:
- Run `./mvnw spotless:check`
- Run `./mvnw pmd:check` and `./mvnw checkstyle:check`
- Run `./mvnw jacoco:report` and verify $\ge$ 90% line and branch coverage (scoped to modified lines for PR audits via `sdlc-test-coverage`, or overall `target/site/jacoco/jacoco.csv` for baseline audits).

### 5. Generate Report & Enforce
- Compile findings into a Markdown artifact `SDLC_COMPLIANCE_REPORT.md`.
- If running under strict mode (e.g. `sdlc-quality-gate`), halt the pipeline if any critical checks fail.

---

## ⏭️ Next Recommended Step

If the compliance score is below thresholds, invoke **`sdlc-flow`** or **`sdlc-test-coverage`** to remediate missing tests or static analysis issues.
