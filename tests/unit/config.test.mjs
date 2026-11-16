import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createTempGitRepo } from '../helpers/test-harness.mjs';
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
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

describe('Ring 0: lib/config.mjs', () => {
  it('exposes canonical defaults and validates valid v0.1.0 12-key configuration', () => {
    assert.equal(DEFAULT_QUALITY_THRESHOLDS.diffCoverage, 85);
    assert.equal(DEFAULT_QUALITY_THRESHOLDS.mutationScore, null);
    assert.equal(DEFAULT_QUALITY_GATE_CHECK, 'Universal Quality Gate, Spec-Drift & Merkle Receipt Defense');

    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);
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

  it('rejects empty modules:[], shell metacharacters in commands, outside-repo mod.path, and out-of-range thresholds', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });

    // 1. Empty modules array
    fs.writeFileSync(path.join(dir, '.agent/sdlc-config.json'), JSON.stringify({ version: '0.1.0', modules: [] }), 'utf8');
    const emptyRes = validateConfigFile(dir);
    assert.equal(emptyRes.valid, false);
    assert.ok(emptyRes.errors.some((e) => /at least one module/i.test(e)));

    // 2. Shell metacharacter + path traversal + invalid threshold
    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({
        version: '0.1.0',
        modules: [
          {
            name: 'bad',
            path: '../../outside',
            commands: {
              test: 'npm test && echo pwned'
            },
            thresholds: { diffCoverage: 120, mutationScore: -5 }
          }
        ]
      }),
      'utf8'
    );
    const badRes = validateConfigFile(dir);
    assert.equal(badRes.valid, false);
    assert.ok(badRes.errors.some((e) => /outside repository root/i.test(e)));
    assert.ok(badRes.errors.some((e) => /shell/i.test(e)));
    assert.ok(badRes.errors.some((e) => /diffCoverage/i.test(e)));
    assert.ok(badRes.errors.some((e) => /mutationScore/i.test(e)));
  });

  it('migrates legacy v2.x gates/testing/lanes/projectManagement keys in-memory with deprecation warnings', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({
        version: '2.1.0',
        profile: 'standard',
        lanes: { trivialMaxLines: 25 },
        projectManagement: { provider: 'github' },
        gates: { minDiffCoverage: 90, minMutationScore: 65 },
        testing: { testCommand: 'node --test "tests/**/*.test.mjs"' },
        modules: [{ name: 'root', path: '.', commands: {} }]
      }),
      'utf8'
    );

    const loaded = loadConfig(dir);
    assert.equal(loaded.migrated, true);
    assert.ok(loaded.warnings.length >= 1);
    assert.equal(loaded.config.modules[0].commands.test, 'node --test "tests/**/*.test.mjs"');
    assert.equal(loaded.config.modules[0].thresholds.diffCoverage, 90);
    assert.equal(loaded.config.modules[0].thresholds.mutationScore, 65);
  });

  it('detectStack and generateConfig synthesize null for absent lint/build scripts and detect polyglot stacks', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'demo', version: '1.0.0', scripts: {} }),
      'utf8'
    );
    const cfg = generateConfig(dir);
    assert.equal(cfg.version, '0.1.0');
    assert.equal(cfg.modules.length, 1);
    assert.equal(cfg.modules[0].commands.lint, null);
    assert.equal(cfg.modules[0].commands.build, null);
    assert.match(cfg.modules[0].commands.test, /tests\/\*\*\/\*\.test\.mjs/);

    // Rust detection
    const rustRepo = createTempGitRepo();
    cleanups.push(rustRepo.cleanup);
    fs.writeFileSync(path.join(rustRepo.dir, 'Cargo.toml'), '[package]\nname = "demo"\n', 'utf8');
    const rustStack = detectStack(rustRepo.dir);
    assert.equal(rustStack.language, 'rust');
    assert.equal(rustStack.commands.test, 'cargo test');

    // Go, Python, Maven, Gradle, and Generic stack detection + upgradeConfigToV010
    for (const [manifest, content, expectedLang, expectedCmd] of [
      ['go.mod', 'module example.com/demo\n', 'go', 'go test ./...'],
      ['pyproject.toml', '[project]\nname = "demo"\n', 'python', 'pytest'],
      ['pom.xml', '<project></project>\n', 'java', 'mvn test'],
      ['build.gradle.kts', 'plugins { java }\n', 'java', './gradlew test']
    ]) {
      const subRepo = createTempGitRepo();
      cleanups.push(subRepo.cleanup);
      fs.writeFileSync(path.join(subRepo.dir, manifest), content, 'utf8');
      const st = detectStack(subRepo.dir);
      assert.equal(st.language, expectedLang);
      assert.equal(st.commands.test, expectedCmd);
    }

    const genericRepo = createTempGitRepo();
    cleanups.push(genericRepo.cleanup);
    assert.equal(detectStack(genericRepo.dir).language, 'generic');

    const upgraded = upgradeConfigToV010({
      version: '2.0.0',
      lanes: { trivialMaxLines: 20 },
      gates: { minDiffCoverage: 88, minMutationScore: 60 },
      testing: { testCommand: 'pytest' },
      modules: [{ name: 'py', path: '.', language: 'python', commands: {} }]
    });
    assert.equal(upgraded.version, '0.1.0');
    assert.equal(upgraded.modules[0].commands.test, 'pytest');
    assert.equal(upgraded.modules[0].thresholds.diffCoverage, 88);
    assert.equal(upgraded.modules[0].thresholds.mutationScore, 60);
  });

  it('manages audited mutant exemptions atomically and validates inputs', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify(generateConfig(dir), null, 2),
      'utf8'
    );

    assert.deepEqual(listExemptions(dir), []);
    assert.throws(() => addExemption({ id: '', file: 'src/a.mjs', reason: 'valid reason', repoRoot: dir }));
    assert.throws(() => addExemption({ id: 'M-1', file: '../../outside.mjs', reason: 'valid reason', repoRoot: dir }));
    assert.throws(() => addExemption({ id: 'M-1', file: 'src/a.mjs', reason: 'tiny', repoRoot: dir }));

    const added = addExemption({
      id: '42',
      file: 'src/a.mjs',
      reason: 'Equivalent defensive logging guard',
      repoRoot: dir
    });
    assert.equal(added.success, true);
    const list = listExemptions(dir);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, '42');
    assert.equal(list[0].file, 'src/a.mjs');
  });
});
