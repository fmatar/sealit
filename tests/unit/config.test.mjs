import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTempGitRepo, git } from '../helpers/test-harness.mjs';
import {
  DEFAULT_QUALITY_THRESHOLDS,
  DEFAULT_QUALITY_GATE_CHECK,
  CONFIG_SCHEMA_KEYS,
  migrateConfigObject,
  loadConfig,
  validateConfigFile,
  detectStack,
  generateConfig,
  upgradeConfigToV010,
  formatMutantIdentity,
  resolveActiveExemptions,
  matchesMutatePatterns,
  loadEffectivePolicy,
  listExemptions,
  addExemption
} from '../../.agent/scripts/lib/config.mjs';
import { runGate } from '../../.agent/scripts/lib/measure.mjs';

const cleanups = [];
function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-cfg-'));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

describe('Ring 0: lib/config.mjs', () => {
  it('exposes canonical defaults and validates valid v0.1.0 configuration', () => {
    assert.equal(DEFAULT_QUALITY_THRESHOLDS.diffCoverage, 85);
    assert.equal(DEFAULT_QUALITY_THRESHOLDS.mutationScore, null);
    assert.equal(DEFAULT_QUALITY_GATE_CHECK, 'Universal Quality Gate, Spec-Drift & Merkle Receipt Defense');

    const dir = makeTempDir();
    assert.equal(validateConfigFile(dir).valid, false);
    assert.equal(loadConfig(dir).exists, false);

    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify(
        {
          version: '0.1.0',
          ci: { runsOn: "${{ vars.SDLC_RUNS_ON || 'ubuntu-latest' }}", checkName: DEFAULT_QUALITY_GATE_CHECK },
          archlens: { enabled: true, policyPath: '.archlens/policy.json' },
          modules: [
            {
              name: 'root',
              path: '.',
              language: 'javascript',
              commands: {
                lint: 'npm run --silent lint',
                build: null,
                test: 'node --test "tests/**/*.test.mjs"',
                coverage: 'npm run test:coverage',
                coverageFile: 'coverage/lcov.info',
                mutation: './node_modules/.bin/stryker run'
              },
              thresholds: { diffCoverage: 85, mutationScore: 52 }
            }
          ],
          exemptions: []
        },
        null,
        2
      ),
      'utf8'
    );

    const res = validateConfigFile(dir);
    assert.equal(res.valid, true);
    assert.deepEqual(res.errors, []);
    assert.equal(res.config.modules.length, 1);
  });

  it('rejects malformed JSON, invalid module/command/exemption schemas, shell metacharacters, path traversal, and multiline CI fields', () => {
    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });

    fs.writeFileSync(path.join(dir, '.agent/sdlc-config.json'), '{bad-json', 'utf8');
    assert.equal(validateConfigFile(dir).valid, false);

    fs.writeFileSync(path.join(dir, '.agent/sdlc-config.json'), '[]', 'utf8');
    assert.equal(validateConfigFile(dir).valid, false);

    fs.writeFileSync(path.join(dir, '.agent/sdlc-config.json'), JSON.stringify({ version: '', modules: [] }), 'utf8');
    const emptyRes = validateConfigFile(dir);
    assert.equal(emptyRes.valid, false);
    assert.ok(emptyRes.errors.some((e) => /version/i.test(e)));
    assert.ok(emptyRes.errors.some((e) => /at least one module/i.test(e)));

    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({
        version: '0.1.0',
        modules: [
          null,
          {
            name: '',
            path: '../../outside',
            commands: { test: 'npm test && echo pwned', coverageFile: '' },
            thresholds: { diffCoverage: 120, mutationScore: -5 }
          },
          { name: 'no-cmds', path: '.', commands: null, thresholds: 'bad' }
        ],
        exemptions: [null, { id: '', file: '../../escape.mjs', reason: 'no' }]
      }),
      'utf8'
    );
    const badRes = validateConfigFile(dir);
    assert.equal(badRes.valid, false);
    assert.ok(badRes.errors.some((e) => /outside repository root/i.test(e)));
    assert.ok(badRes.errors.some((e) => /shell/i.test(e)));
    assert.ok(badRes.errors.some((e) => /diffCoverage/i.test(e)));
    assert.ok(badRes.errors.some((e) => /mutationScore/i.test(e)));
    assert.ok(badRes.errors.some((e) => /exemptions\[1\]/i.test(e)));

    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({
        version: '0.1.0',
        ci: { checkName: 'Gate\nInjected: bad', runsOn: 'ubuntu\nbad' },
        archlens: { enabled: true, policyPath: '../../outside-policy.json' },
        modules: [{ name: 'root', path: '.', commands: { coverageFile: '../../../tmp/escape.info' } }]
      }),
      'utf8'
    );
    const traversalRes = validateConfigFile(dir);
    assert.equal(traversalRes.valid, false);
    assert.ok(traversalRes.errors.some((e) => /coverageFile/i.test(e)));
    assert.ok(traversalRes.errors.some((e) => /policyPath/i.test(e)));
    assert.ok(traversalRes.errors.some((e) => /checkName/i.test(e)));
    assert.ok(traversalRes.errors.some((e) => /runsOn/i.test(e)));
  });

  it('migrates legacy v2.x gates/testing/lanes/projectManagement keys in-memory with deprecation warnings', () => {
    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({
        version: '2.1.0',
        profile: 'standard',
        lanes: { trivialMaxLines: 25 },
        projectManagement: { provider: 'github' },
        gates: { minDiffCoverage: 90, minMutationScore: 65 },
        testing: { testCommand: 'node --test "tests/**/*.test.mjs"', coverageCommand: 'npm run cov', mutationCommand: 'npm run mut' },
        modules: [{ name: 'root', path: '.', commands: {} }]
      }),
      'utf8'
    );

    const loaded = loadConfig(dir);
    assert.equal(loaded.exists, true);
    assert.equal(loaded.migrated, true);
    assert.ok(loaded.warnings.length >= 1);
    assert.equal(loaded.config.modules[0].commands.test, 'node --test "tests/**/*.test.mjs"');
    assert.equal(loaded.config.modules[0].commands.coverage, 'npm run cov');
    assert.equal(loaded.config.modules[0].commands.mutation, 'npm run mut');
    assert.equal(loaded.config.modules[0].thresholds.diffCoverage, 90);
    assert.equal(loaded.config.modules[0].thresholds.mutationScore, 65);

    const upgraded = upgradeConfigToV010(JSON.parse(fs.readFileSync(path.join(dir, '.agent/sdlc-config.json'), 'utf8')));
    assert.equal(upgraded.version, '0.1.0');
    assert.equal(upgraded.lanes, undefined);
    assert.equal(upgraded.modules[0].thresholds.diffCoverage, 90);
    assert.equal(upgradeConfigToV010(null), null);
  });

  it('detectStack and generateConfig synthesize exact commands and thresholds across JS/TS, Rust, Go, Python, Maven, Gradle, and Generic', () => {
    const jsMinimal = makeTempDir();
    fs.writeFileSync(path.join(jsMinimal, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0', scripts: {} }), 'utf8');
    const cfg = generateConfig(jsMinimal);
    assert.equal(cfg.version, '0.1.0');
    assert.equal(cfg.archlens.enabled, true);
    assert.equal(cfg.archlens.policyPath, '.archlens/policy.json');
    assert.equal(cfg.modules[0].language, 'javascript');
    assert.equal(cfg.modules[0].commands.lint, null);
    assert.equal(cfg.modules[0].commands.build, null);
    assert.equal(cfg.modules[0].commands.mutation, null);
    assert.equal(cfg.modules[0].thresholds.mutationScore, null);
    assert.match(cfg.modules[0].commands.test, /tests\/\*\*\/\*\.test\.mjs/);

    const tsFull = makeTempDir();
    fs.writeFileSync(path.join(tsFull, 'tsconfig.json'), '{}', 'utf8');
    fs.writeFileSync(
      path.join(tsFull, 'package.json'),
      JSON.stringify({
        name: 'ts-app',
        scripts: { lint: 'eslint .', build: 'tsc', test: 'vitest run', 'test:coverage': 'vitest run --coverage' },
        devDependencies: { '@stryker-mutator/core': '^9.6.1' }
      }),
      'utf8'
    );
    const tsStack = detectStack(tsFull);
    assert.equal(tsStack.language, 'typescript');
    assert.equal(tsStack.commands.lint, 'npm run --silent lint');
    assert.equal(tsStack.commands.build, 'npm run build');
    assert.equal(tsStack.commands.test, 'npm test');
    assert.equal(tsStack.commands.coverage, 'npm run test:coverage');
    assert.equal(tsStack.commands.mutation, './node_modules/.bin/stryker run');
    assert.equal(tsStack.thresholds.mutationScore, 80);

    for (const [manifest, content, expectedLang, expectedCmds] of [
      ['Cargo.toml', '[package]\nname = "demo"\n', 'rust', { lint: 'cargo clippy -- -D warnings', build: 'cargo build', test: 'cargo test', coverageFile: 'coverage/lcov.info' }],
      ['go.mod', 'module example.com/demo\n', 'go', { lint: 'go vet ./...', build: 'go build ./...', test: 'go test ./...', coverageFile: 'coverage/cover.out' }],
      ['pyproject.toml', '[project]\nname = "demo"\n', 'python', { lint: null, build: null, test: 'pytest', coverageFile: 'coverage/coverage.xml' }],
      ['pom.xml', '<project></project>\n', 'java', { lint: null, build: 'mvn test-compile', test: 'mvn test', coverageFile: 'target/site/jacoco/jacoco.xml' }],
      ['build.gradle.kts', 'plugins { java }\n', 'java', { lint: null, build: './gradlew classes', test: './gradlew test', coverageFile: 'build/reports/jacoco/test/jacocoTestReport.xml' }]
    ]) {
      const subDir = makeTempDir();
      fs.writeFileSync(path.join(subDir, manifest), content, 'utf8');
      const st = detectStack(subDir);
      assert.equal(st.language, expectedLang);
      assert.equal(st.commands.lint, expectedCmds.lint);
      assert.equal(st.commands.build, expectedCmds.build);
      assert.equal(st.commands.test, expectedCmds.test);
      assert.equal(st.commands.coverageFile, expectedCmds.coverageFile);
      assert.equal(st.thresholds.diffCoverage, 85);
      assert.equal(st.thresholds.mutationScore, null);
    }

    const genSt = detectStack(makeTempDir());
    assert.equal(genSt.language, 'generic');
    assert.equal(genSt.commands.test, null);
    assert.equal(genSt.thresholds.diffCoverage, null);
    assert.equal(genSt.thresholds.mutationScore, null);
  });

  it('manages audited mutant exemptions atomically with stable identities, resolves report mutant ids, and upserts duplicates', () => {
    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.agent/sdlc-config.json'), JSON.stringify(generateConfig(dir), null, 2), 'utf8');

    const idA = 'ConditionalExpression@10:4#a1b2c3d4';
    const idB = 'BooleanLiteral@22:8#deadbeef';
    assert.deepEqual(listExemptions(dir), []);
    assert.throws(() => addExemption({ id: '   ', file: 'src/a.mjs', reason: 'valid reason', repoRoot: dir }), /non-empty mutant id/);
    assert.throws(() => addExemption({ id: idA, file: '../../outside.mjs', reason: 'valid reason', repoRoot: dir }));
    assert.throws(() => addExemption({ id: idA, file: 'src/a.mjs', reason: '1234', repoRoot: dir }), /at least 5 characters/);
    assert.throws(() => addExemption({ id: '42', file: 'src/a.mjs', reason: 'valid reason', repoRoot: dir }), /must match/);

    // Numeric run-local mutant ID resolves automatically when reports/mutation/mutation.json contains that mutant
    fs.mkdirSync(path.join(dir, 'reports/mutation'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'reports/mutation/mutation.json'),
      JSON.stringify({
        files: {
          'src/a.mjs': {
            mutants: [{ id: '42', mutatorName: 'ConditionalExpression', replacement: 'false', location: { start: { line: 10, column: 4 } } }]
          }
        }
      }),
      'utf8'
    );
    const resolvedFromReport = addExemption({ id: '42', file: './src\\a.mjs', reason: '  First reason  ', repoRoot: dir });
    assert.match(resolvedFromReport.exemption.id, /^ConditionalExpression@10:4#[0-9a-f]{8}$/);
    addExemption({ id: idB, file: 'src/b.mjs', reason: 'Second reason', repoRoot: dir });
    // Upsert same stable id on src/a.mjs without losing idB
    addExemption({ id: resolvedFromReport.exemption.id, file: 'src/a.mjs', reason: 'Updated reason', repoRoot: dir });

    const list = listExemptions(dir);
    assert.equal(list.length, 2);
    assert.equal(list[0].id, resolvedFromReport.exemption.id);
    assert.equal(list[0].file, 'src/a.mjs');
    assert.equal(list[0].reason, 'Updated reason');
    assert.equal(list[1].id, idB);

    // formatMutantIdentity & resolveActiveExemptions edge cases
    assert.equal(formatMutantIdentity(null), null);
    assert.equal(formatMutantIdentity({ mutatorName: '', location: { start: { line: 1, column: 0 } } }), null);
    assert.equal(formatMutantIdentity({ mutatorName: 'Regex', location: { start: { line: 0, column: 0 } } }), null);
    assert.equal(formatMutantIdentity({ mutatorName: 'Regex', location: { start: { line: 1, column: -1 } } }), null);
    const act = resolveActiveExemptions([null, { id: idB, file: './src\\b.mjs' }, { id: 'legacy-7', file: 'src/b.mjs' }]);
    assert.equal(act.activeSet.has(`src/b.mjs::${idB}`), true);
    assert.equal(act.activeSet.size, 1);
    assert.equal(act.warnings.length, 1);
    assert.equal(matchesMutatePatterns('src/b.mjs', ['src/**/*.mjs', '!src/ignore.mjs']), true);
    assert.equal(matchesMutatePatterns('src/ignore.mjs', ['src/**/*.mjs', '!src/ignore.mjs']), false);

    // migrateConfigObject edge cases: testing thresholds fallback, false/null/NaN normalization, archlens.enabled=false, __legacyExemptions
    assert.equal(migrateConfigObject(null).config, null);
    assert.equal(migrateConfigObject([]).config, null);
    const mig = migrateConfigObject({
      testing: { coverageThreshold: 77, mutationThreshold: 55 },
      archlens: { enabled: false, policyPath: 'custom/policy.json' },
      ci: { runsOn: 'self-hosted', checkName: 'Custom Check' },
      __legacyExemptions: [{ id: '1', file: 'a.js', reason: 'legacy' }],
      modules: [
        { name: 'm1', path: '.' },
        { name: 'm2', path: 'sub', commands: { mutation: 'stryker run' }, thresholds: { diffCoverage: false, mutationScore: 'not-a-num' } }
      ]
    });
    assert.equal(mig.config.modules[0].thresholds.diffCoverage, 77);
    assert.equal(mig.config.modules[0].thresholds.mutationScore, 55);
    assert.equal(mig.config.modules[1].thresholds.diffCoverage, null);
    assert.equal(mig.config.modules[1].thresholds.mutationScore, 80);
    assert.equal(mig.config.archlens.enabled, false);
    assert.equal(mig.config.archlens.policyPath, 'custom/policy.json');
    assert.equal(mig.config.ci.runsOn, 'self-hosted');
    assert.equal(mig.config.ci.checkName, 'Custom Check');
    assert.equal(mig.config.exemptions.length, 1);

    const up2 = upgradeConfigToV010(mig.config);
    assert.equal(up2.archlens.enabled, false);
    assert.equal(up2.archlens.policyPath, 'custom/policy.json');
    assert.equal(up2.ci.runsOn, 'self-hosted');
    assert.equal(up2.ci.checkName, 'Custom Check');
  });

  it('validator allow-lists match sdlc-config.schema.json properties and reject unknown keys at every level', () => {
    const schemaPath = path.resolve('.agent/schemas/sdlc-config.schema.json');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const sort = (arr) => [...arr].sort();

    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(sort(CONFIG_SCHEMA_KEYS.root), sort(Object.keys(schema.properties)));
    assert.deepEqual(sort(CONFIG_SCHEMA_KEYS.ci), sort(Object.keys(schema.properties.ci.properties)));
    assert.deepEqual(sort(CONFIG_SCHEMA_KEYS.archlens), sort(Object.keys(schema.properties.archlens.properties)));
    assert.deepEqual(sort(CONFIG_SCHEMA_KEYS.module), sort(Object.keys(schema.properties.modules.items.properties)));
    assert.deepEqual(sort(CONFIG_SCHEMA_KEYS.commands), sort(Object.keys(schema.properties.modules.items.properties.commands.properties)));
    assert.deepEqual(sort(CONFIG_SCHEMA_KEYS.thresholds), sort(Object.keys(schema.properties.modules.items.properties.thresholds.properties)));
    assert.deepEqual(sort(CONFIG_SCHEMA_KEYS.exemption), sort(Object.keys(schema.properties.exemptions.items.properties)));

    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    const validBase = {
      version: '0.1.0',
      ci: { runsOn: ['self-hosted', 'linux'], checkName: 'Gate' },
      archlens: { enabled: false, policyPath: '.archlens/policy.json' },
      modules: [{ name: 'root', path: '.', commands: { test: 'npm test', coverage: 'npm run cov', mutation: 'stryker run' }, thresholds: { diffCoverage: 80, mutationScore: 60 } }],
      exemptions: [{ id: 'ConditionalExpression@1:0#a1b2c3d4', file: 'src/a.mjs', reason: 'Equivalent branch', addedAt: '2026-11-18T00:00:00Z' }]
    };
    fs.writeFileSync(path.join(dir, '.agent/sdlc-config.json'), JSON.stringify(validBase), 'utf8');
    assert.equal(validateConfigFile(dir).valid, true);

    for (const [mutFn, expectedKey] of [
      [(c) => { c.sneakyRoot = 1; }, 'sneakyRoot'],
      [(c) => { c.ci.extraCi = 1; }, 'ci.extraCi'],
      [(c) => { c.archlens.extraArch = 1; }, 'archlens.extraArch'],
      [(c) => { c.modules[0].extraMod = 1; }, 'modules[0].extraMod'],
      [(c) => { c.modules[0].commands.extraCmd = 'echo hi'; }, 'modules[0].commands.extraCmd'],
      [(c) => { c.modules[0].thresholds.extraThr = 50; }, 'modules[0].thresholds.extraThr'],
      [(c) => { c.exemptions[0].extraEx = true; }, 'exemptions[0].extraEx']
    ]) {
      const candidate = structuredClone(validBase);
      mutFn(candidate);
      fs.writeFileSync(path.join(dir, '.agent/sdlc-config.json'), JSON.stringify(candidate), 'utf8');
      const r = validateConfigFile(dir);
      assert.equal(r.valid, false, `Expected ${expectedKey} to be rejected`);
      assert.ok(r.errors.some((e) => e.includes(expectedKey)), `Expected error mentioning ${expectedKey}, got: ${r.errors.join('; ')}`);
    }

    // Non-object ci/archlens, non-boolean archlens.enabled, legacy exemption warning without error
    fs.writeFileSync(path.join(dir, '.agent/sdlc-config.json'), JSON.stringify({ ...validBase, ci: 'bad', archlens: [] }), 'utf8');
    assert.equal(validateConfigFile(dir).valid, false);
    fs.writeFileSync(path.join(dir, '.agent/sdlc-config.json'), JSON.stringify({ ...validBase, archlens: { enabled: 'yes' } }), 'utf8');
    assert.equal(validateConfigFile(dir).valid, false);
    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({ ...validBase, exemptions: [{ id: 'legacy-12', file: 'src/a.mjs', reason: 'Legacy id warning only' }] }),
      'utf8'
    );
    const legCheck = validateConfigFile(dir);
    assert.equal(legCheck.valid, true);
    assert.ok(legCheck.warnings.some((w) => /Legacy exemption id 'legacy-12'/.test(w)));
  });

  it('threshold without command is invalid', () => {
    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });

    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({
        version: '0.1.0',
        modules: [{ name: 'root', path: '.', commands: { coverage: null, mutation: null }, thresholds: { diffCoverage: 85, mutationScore: 0 } }]
      }),
      'utf8'
    );
    const res = validateConfigFile(dir);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => /diffCoverage requires .*commands\.coverage/i.test(e)));
    assert.ok(res.errors.some((e) => /mutationScore requires .*commands\.mutation/i.test(e)));

    // Generic generated config (null thresholds + null commands) passes validation cleanly
    fs.writeFileSync(path.join(dir, '.agent/sdlc-config.json'), JSON.stringify(generateConfig(dir), null, 2), 'utf8');
    assert.equal(validateConfigFile(dir).valid, true);
  });

  it('bootstrap repo gates on head policy with policySource bootstrap, and raising a threshold in the PR applies immediately', () => {
    // 1. Bootstrap repo (base commit has no .agent/sdlc-config.json)
    const boot = createTempGitRepo();
    cleanups.push(boot.cleanup);
    const baseSha = git(boot.dir, 'rev-parse', 'develop').stdout.trim();
    git(boot.dir, 'checkout', '-q', '-b', 'feat/bootstrap', 'develop');
    fs.mkdirSync(path.join(boot.dir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(boot.dir, '.agent/sdlc-config.json'),
      JSON.stringify({
        version: '0.1.0',
        archlens: { enabled: false, policyPath: '.archlens/policy.json' },
        modules: [{ name: 'root', path: '.', commands: { test: `${process.execPath} -e "process.exit(0)"` }, thresholds: { diffCoverage: null, mutationScore: null } }]
      }),
      'utf8'
    );
    git(boot.dir, 'add', '.agent/sdlc-config.json');
    git(boot.dir, 'commit', '-q', '-m', 'chore: adopt sdlc config');
    const bootHead = git(boot.dir, 'rev-parse', 'HEAD').stdout.trim();
    const bootPol = loadEffectivePolicy({ repoRoot: boot.dir, baseSha, headSha: bootHead });
    assert.equal(bootPol.policySource, 'bootstrap');
    assert.deepEqual(bootPol.policyTriggers, []);
    const bootGate = runGate(boot.dir, { noCache: true });
    assert.equal(bootGate.passed, true);
    assert.equal(bootGate.policySource, 'bootstrap');
    assert.equal(bootGate.lastGate.policySource, 'bootstrap');

    // 2. Raising a threshold in the PR applies immediately without raising GATE_POLICY_DRIFT
    const raise = createTempGitRepo();
    cleanups.push(raise.cleanup);
    fs.mkdirSync(path.join(raise.dir, '.agent'), { recursive: true });
    fs.mkdirSync(path.join(raise.dir, 'tests'), { recursive: true });
    fs.writeFileSync(
      path.join(raise.dir, 'tests/cov50.mjs'),
      "import fs from 'node:fs'; fs.mkdirSync('coverage', { recursive: true }); fs.writeFileSync('coverage/lcov.info', 'SF:src/a.mjs\\nDA:1,1\\nDA:2,0\\nLF:2\\nLH:1\\nend_of_record\\n');\n",
      'utf8'
    );
    fs.writeFileSync(
      path.join(raise.dir, '.agent/sdlc-config.json'),
      JSON.stringify({
        version: '0.1.0',
        archlens: { enabled: false, policyPath: '.archlens/policy.json' },
        modules: [{ name: 'root', path: '.', commands: { coverage: `${process.execPath} tests/cov50.mjs` }, thresholds: { diffCoverage: 40, mutationScore: null } }]
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(raise.dir, 'stryker.config.json'), JSON.stringify({ mutate: ['src/**/*.mjs', '!src/gen.mjs'] }), 'utf8');
    fs.writeFileSync(path.join(raise.dir, 'package.json'), JSON.stringify({ name: 'consumer-app', version: '1.0.0' }), 'utf8');
    git(raise.dir, 'add', '-A');
    git(raise.dir, 'commit', '-q', '-m', 'chore: base cov 40');
    const rBase = git(raise.dir, 'rev-parse', 'develop').stdout.trim();

    git(raise.dir, 'checkout', '-q', '-b', 'feat/raise-bar', 'develop');
    fs.mkdirSync(path.join(raise.dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(raise.dir, 'src/a.mjs'), 'export const a = 1;\nexport const b = 2;\n', 'utf8');
    // Raise diffCoverage 40 -> 90 AND widen stryker mutate (add lib/**/*.mjs and drop !src/gen.mjs negation) -> 0 policyTriggers, 90% enforced immediately!
    fs.writeFileSync(
      path.join(raise.dir, '.agent/sdlc-config.json'),
      JSON.stringify({
        version: '0.1.0',
        archlens: { enabled: false, policyPath: '.archlens/policy.json' },
        modules: [{ name: 'root', path: '.', commands: { coverage: `${process.execPath} tests/cov50.mjs` }, thresholds: { diffCoverage: 90, mutationScore: null } }]
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(raise.dir, 'stryker.config.json'), JSON.stringify({ mutate: ['src/**/*.mjs', 'lib/**/*.mjs'] }), 'utf8');
    git(raise.dir, 'add', '-A');
    git(raise.dir, 'commit', '-q', '-m', 'feat: raise threshold to 90');
    const rHead = git(raise.dir, 'rev-parse', 'HEAD').stdout.trim();

    const raisedPol = loadEffectivePolicy({ repoRoot: raise.dir, baseSha: rBase, headSha: rHead });
    assert.equal(raisedPol.policySource, 'base+head');
    assert.deepEqual(raisedPol.policyTriggers, []);
    assert.equal(raisedPol.config.modules[0].thresholds.diffCoverage, 90);
    assert.deepEqual(raisedPol.stryker.mutate, ['src/**/*.mjs', 'lib/**/*.mjs']);

    const raisedGate = runGate(raise.dir, { noCache: true });
    assert.equal(raisedGate.drift.passed, true);
    assert.equal(raisedGate.passed, false);
    assert.match(raisedGate.modules[0].error, /50\.0% is below threshold 90%/);

    // Removing a base module or deleting stryker.config.json keeps base module/stryker and emits GATE_POLICY_DRIFT
    fs.writeFileSync(
      path.join(raise.dir, '.agent/sdlc-config.json'),
      JSON.stringify({
        version: '0.1.0',
        archlens: { enabled: false, policyPath: '.archlens/policy.json' },
        modules: [{ name: 'new-mod', path: '.', commands: {}, thresholds: { diffCoverage: null, mutationScore: null } }]
      }),
      'utf8'
    );
    git(raise.dir, 'rm', '-q', 'stryker.config.json');
    git(raise.dir, 'add', '-A');
    git(raise.dir, 'commit', '-q', '-m', 'evil: drop root module and stryker.config.json');
    const dropHead = git(raise.dir, 'rev-parse', 'HEAD').stdout.trim();
    const dropPol = loadEffectivePolicy({ repoRoot: raise.dir, baseSha: rBase, headSha: dropHead });
    assert.equal(dropPol.config.modules.length, 2);
    assert.ok(dropPol.policyTriggers.some((t) => t.file === '.agent/sdlc-config.json' && t.type === 'GATE_POLICY_DRIFT'));
    assert.ok(dropPol.policyTriggers.some((t) => t.file === 'stryker.config.json' && t.type === 'GATE_POLICY_DRIFT'));
    assert.deepEqual(dropPol.stryker.mutate, ['src/**/*.mjs', '!src/gen.mjs']);
  });
});
