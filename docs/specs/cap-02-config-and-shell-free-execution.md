# CAP-02: Schema-Validated Configuration & Shell-Free Command Execution

- **Capability ID**: `CAP-02`
- **Governing Modules**: `.agent/scripts/lib/config.mjs` (Ring 0), `.agent/scripts/lib/git.mjs` (Ring 0), `.agent/schemas/sealit-config.schema.json`
- **Enforced Invariants**: `INV-02`, `INV-04`

## 1. Inputs
- `.agent/sealit-config.json` (version `0.1.0` schema, with transparent read/upgrade fallback from legacy `.agent/sdlc-config.json`) or polyglot repository manifests (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `pom.xml`, `build.gradle`).

## 2. Domain Rules
1. **Strict Config Schema & Threshold-Command Validation (`ADR-021`)**: Unknown keys at any level (exact parity with `.agent/schemas/sealit-config.schema.json`), out-of-range thresholds (`0..100`), numeric thresholds paired with `null`/missing commands (`commands.coverage` / `commands.mutation`), path-traversing `module.path` entries, or non-string/non-argv commands fail `config check`. Generic stack configs default `thresholds.diffCoverage` to `null`; legacy keys emit upgrade warnings and upgrade cleanly via `doctor --fix`.
2. **Zero Shell Interpolation (`INV-04`)**: `parseCommandArgv` parses strings or argv arrays and rejects shell compound/redirection operators (`;`, `|`, `&`, `<`, `>`, `` ` ``, `$(`, `\n`, `\r`). `runConfiguredCommand` invokes `execFileSync(file, args)` directly without a shell and strips inherited `NODE_TEST_CONTEXT` and `NODE_V8_COVERAGE` variables when spawning nested test runners.
3. **Smart JS/TS Runner Discovery & Node >= 22 Compatibility (`ADR-028`)**: `detectStack` detects the lockfile package manager (`pnpm`, `yarn`, `bun`, `npm`), existing test directories (`tests/`, `test/`, `__tests__/`, `src/`), and installed coverage runners (`./node_modules/.bin/vitest`, `./node_modules/.bin/jest`, `./node_modules/.bin/c8`) before falling back to native `node --test --experimental-test-coverage` with `"tests/**/*.test.mjs"`. `DEFAULT_QUALITY_GATE_CHECK` defaults to `"Sealit Quality Gate & Merge Receipt Verification"` for new adopters, and `isEngineOwnerRepo` checks both package name and engine repository markers (`bin/sealit.mjs`, `.claude-plugin/plugin.json`, or `package.json` engine `bin`/`main`).

## 3. Outputs & Acceptance Criteria
- Deterministic `detectStack(repoRoot)` and `generateConfig(repoRoot)` across JavaScript/TypeScript, Rust, Go, Python, and Java/Kotlin manifests.
- `sealit config check` exits `0` on valid schemas and `1` with actionable field diagnostics on invalid schemas.
