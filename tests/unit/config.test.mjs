import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_QUALITY_THRESHOLDS,
  DEFAULT_QUALITY_GATE_CHECK,
  loadConfig,
  validateConfigFile,
  detectStack,
  generateConfig,
  upgradeConfigToV010,
  listExemptions,
  addExemption
} from '../../.agent/scripts/lib/config.mjs';

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
  });

  it('manages audited mutant exemptions atomically, preserves existing entries, and upserts duplicates', () => {
    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.agent/sdlc-config.json'), JSON.stringify(generateConfig(dir), null, 2), 'utf8');

    assert.deepEqual(listExemptions(dir), []);
    assert.throws(() => addExemption({ id: '   ', file: 'src/a.mjs', reason: 'valid reason', repoRoot: dir }), /non-empty mutant id/);
    assert.throws(() => addExemption({ id: 'M-1', file: '../../outside.mjs', reason: 'valid reason', repoRoot: dir }));
    assert.throws(() => addExemption({ id: 'M-1', file: 'src/a.mjs', reason: '1234', repoRoot: dir }), /at least 5 characters/);

    addExemption({ id: '42', file: './src\\a.mjs', reason: '  First reason  ', repoRoot: dir });
    addExemption({ id: '43', file: 'src/b.mjs', reason: 'Second reason', repoRoot: dir });
    // Upsert id 42 on src/a.mjs without losing id 43
    addExemption({ id: '42', file: 'src/a.mjs', reason: 'Updated reason', repoRoot: dir });

    const list = listExemptions(dir);
    assert.equal(list.length, 2);
    assert.equal(list[0].id, '42');
    assert.equal(list[0].file, 'src/a.mjs');
    assert.equal(list[0].reason, 'Updated reason');
    assert.equal(list[1].id, '43');
  });
});
