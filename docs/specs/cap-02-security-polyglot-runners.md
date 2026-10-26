# SPEC-02: Shell Injection Remediation & Polyglot Test Runners (`CAP-02`)

- **Linked Capability**: `CAP-02`
- **Status**: `ACTIVE`
- **Depends On**: `None`

## 1. Problem Statement & Motivation
1. `.agent/scripts/lib/pm-provider.mjs` interpolated untrusted Markdown strings (`title`, `body`, `commentBody`) directly into `execSync(\`gh issue create ...\`)` and `execSync(\`curl ...\`)` shell commands. Any backtick (`` ` ``) or `$()` command substitution inside a code block triggered arbitrary shell execution or command failure.
2. `runFlakeCheck` (`quality-gate.mjs`) and `test --affected-only` (`sdlc-engine.mjs`) hardcoded `node --test "${testFile}"`, breaking Java, Python, Go, and Rust projects.
3. `findAffectededTests` had a misspelled export identifier.

## 2. Domain Contract & Acceptance Criteria
1. **Zero Shell Interpolation in `pm-provider.mjs`**:
   - Replace `execSync` calls for `gh issue create`, `gh pr comment`, `gh issue comment`, and `curl` (Jira/Linear REST/GraphQL calls) with `execFileSync` using argument arrays so Markdown backticks and `$()` are never interpreted by `/bin/sh`.
   - Sanitize `pollIntervalSeconds` in `pollCIPRChecks` to a bounded integer.
2. **Polyglot Single-Test Runner (`buildSingleTestCommand`)**:
   - Construct stack-aware single-test execution commands for `java-maven`, `java-gradle`, `python`, `golang`, `rust-cargo`, and `nodejs-npm`.
   - Wire `buildSingleTestCommand` into `runFlakeCheck` and `sdlc-engine test --affected-only`.
3. **API Export Hygiene**:
   - Export `findAffectedTests` alongside the backward-compatible alias `findAffectededTests`.
