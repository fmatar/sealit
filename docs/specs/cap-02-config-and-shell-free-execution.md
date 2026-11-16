# CAP-02: Schema-Validated Configuration & Shell-Free Command Execution

- **Capability ID**: `CAP-02`
- **Governing Modules**: `.agent/scripts/lib/config.mjs` (Ring 0), `.agent/scripts/lib/git.mjs` (Ring 0), `.agent/schemas/sdlc-config.schema.json`
- **Enforced Invariants**: `INV-02`, `INV-04`

## 1. Inputs
- `.agent/sdlc-config.json` (version `0.1.0` schema) or polyglot repository manifests (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `pom.xml`, `build.gradle`).

## 2. Domain Rules
1. **Strict Config Schema Validation**: Unknown keys, out-of-range thresholds (`0..100`), path-traversing `module.path` entries, or non-string/non-argv commands fail `config check`. Legacy `v0.0.2` keys (`pm`, `lanes`, `ui`) emit upgrade warnings and upgrade cleanly via `doctor --fix`.
2. **Zero Shell Interpolation (`INV-04`)**: `parseCommandArgv` parses strings or argv arrays and rejects shell compound/redirection operators (`;`, `|`, `&`, `<`, `>`, `` ` ``, `$(`, `\n`, `\r`). `runConfiguredCommand` invokes `execFileSync(file, args)` directly without a shell and strips inherited `NODE_TEST_CONTEXT` and `NODE_V8_COVERAGE` variables when spawning nested test runners.
3. **Node >= 22 Compatibility**: Default JavaScript/TypeScript test commands emit `node --test --test-reporter=dot "tests/**/*.test.mjs"` so discovery succeeds identically on Node 22, Node 24 LTS, and Node 26+.

## 3. Outputs & Acceptance Criteria
- Deterministic `detectStack(repoRoot)` and `generateConfig(repoRoot)` supporting monorepo workspaces (`workspaces`, `Cargo.toml`, `pnpm-workspace.yaml`).
- `sdlc config check` exits `0` on valid schemas and `1` with actionable field diagnostics on invalid schemas.
