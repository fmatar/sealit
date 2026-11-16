import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createTempGitRepo, git } from '../helpers/test-harness.mjs';
import { readActiveSession, writeActiveSession } from '../../.agent/scripts/lib/receipt.mjs';
import {
  scanDiffSecrets,
  requireFreshReport,
  parseCoverageReport,
  parseMutationReport,
  buildMutationPlan,
  measureModuleMutation,
  resolveAffectedTests,
  runGate,
  buildReviewPlan
} from '../../.agent/scripts/lib/measure.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

describe('Ring 2: lib/measure.mjs', () => {
  it('scanDiffSecrets catches staged NUL-padded secrets and fails closed on diff scan errors', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    git(dir, 'checkout', '-q', '-b', 'feat/sec', 'develop');
    const fakeKey = ['AKIA', '1234567890ABCDEF'].join('');
    fs.writeFileSync(path.join(dir, 'nul-secret.mjs'), Buffer.from(`\x00export const k = "${fakeKey}";\x00\n`, 'latin1'));
    git(dir, 'add', 'nul-secret.mjs');

    const sec = scanDiffSecrets(dir);
    assert.equal(sec.passed, false);
    assert.ok(sec.secretViolations.some((v) => v.file === 'nul-secret.mjs'));

    // Forced scan error fails closed with SCAN_ERROR
    const errRes = scanDiffSecrets(dir, {
      diffGetter: () => {
        throw new Error('simulated diff read failure');
      }
    });
    assert.equal(errRes.passed, false);
    assert.ok(errRes.secretViolations.some((v) => v.type === 'SCAN_ERROR'));

    // Unreadable untracked file triggers SCAN_ERROR (never swallowed as clean)
    if (process.platform !== 'win32' && process.getuid && process.getuid() !== 0) {
      git(dir, 'rm', '-f', '-q', 'nul-secret.mjs');
      const unreadable = path.join(dir, 'unreadable-secret.mjs');
      fs.writeFileSync(unreadable, 'export const s = 1;\n', 'utf8');
      fs.chmodSync(unreadable, 0o000);
      cleanups.push(() => {
        try { fs.chmodSync(unreadable, 0o600); } catch {}
      });
      const unreadRes = scanDiffSecrets(dir);
      assert.equal(unreadRes.passed, false);
      assert.ok(unreadRes.secretViolations.some((v) => v.type === 'SCAN_ERROR'));
    }
  });

  it('requireFreshReport fails closed when statSync throws or when report mtime is stale', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    const mod = { name: 'root', path: '.' };
    const report = { found: true, passed: true, file: 'coverage/lcov.info', formatted: '95.0%', threshold: 85 };

    // Missing file causes statSync to throw -> must fail closed!
    const missingStat = requireFreshReport(report, mod, dir, Date.now());
    assert.equal(missingStat.passed, false);
    assert.equal(missingStat.stale, true);

    // Stale file older than startedAt fails closed
    fs.mkdirSync(path.join(dir, 'coverage'), { recursive: true });
    const lcovPath = path.join(dir, 'coverage/lcov.info');
    fs.writeFileSync(lcovPath, 'SF:a.js\nLF:1\nLH:1\nend_of_record\n', 'utf8');
    const oldTime = new Date(Date.now() - 20000);
    fs.utimesSync(lcovPath, oldTime, oldTime);
    const staleRes = requireFreshReport(report, mod, dir, Date.now());
    assert.equal(staleRes.passed, false);
    assert.equal(staleRes.stale, true);
  });

  it('parseCoverageReport enforces 0% on unimported files, handles CRLF LCOV, and normalizes subdirectory mod.path', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    git(dir, 'checkout', '-q', '-b', 'feat/cov', 'develop');
    fs.mkdirSync(path.join(dir, 'packages/api/src'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'packages/api/src/covered.ts'),
      'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(dir, 'packages/api/src/unimported.ts'),
      'export function dead(x: number) {\n  const y = x + 1;\n  const z = y * 2;\n  return z;\n}\n',
      'utf8'
    );
    fs.mkdirSync(path.join(dir, 'packages/api/coverage'), { recursive: true });
    // Module-relative SF: path with CRLF endings
    fs.writeFileSync(
      path.join(dir, 'packages/api/coverage/lcov.info'),
      'SF:src/covered.ts\r\nDA:1,1\r\nDA:2,1\r\nDA:3,1\r\nLF:3\r\nLH:3\r\nend_of_record\r\n',
      'utf8'
    );

    const mod = {
      name: 'api',
      path: 'packages/api',
      commands: { coverageFile: 'coverage/lcov.info' },
      thresholds: { diffCoverage: 85 }
    };
    const res = parseCoverageReport(dir, mod);
    assert.equal(res.found, true);
    assert.equal(res.repoLineCoverage, 100);
    assert.equal(res.passed, false);
    assert.ok(res.diffLineCoverage < 85, `Expected unimported file to pull diff coverage < 85%, got ${res.diffLineCoverage}%`);

    // Remove unimported file -> diff coverage is 100% >= 85%
    fs.unlinkSync(path.join(dir, 'packages/api/src/unimported.ts'));
    const passRes = parseCoverageReport(dir, mod);
    assert.equal(passRes.passed, true);
    assert.equal(passRes.diffLineCoverage, 100);

    // Cobertura XML, JaCoCo XML, and Go cover.out report formats
    const cobRepo = createTempGitRepo();
    cleanups.push(cobRepo.cleanup);
    fs.mkdirSync(path.join(cobRepo.dir, 'coverage'), { recursive: true });
    fs.writeFileSync(path.join(cobRepo.dir, 'coverage/coverage.xml'), '<coverage line-rate="0.91"></coverage>', 'utf8');
    const cobRes = parseCoverageReport(cobRepo.dir, { name: 'py', path: '.', commands: { coverageFile: 'coverage/coverage.xml' }, thresholds: { diffCoverage: 85 } });
    assert.equal(cobRes.passed, true);
    assert.equal(cobRes.repoLineCoverage, 91);

    const jacRepo = createTempGitRepo();
    cleanups.push(jacRepo.cleanup);
    fs.mkdirSync(path.join(jacRepo.dir, 'target/site/jacoco'), { recursive: true });
    fs.writeFileSync(path.join(jacRepo.dir, 'target/site/jacoco/jacoco.xml'), '<report name="demo"><counter type="LINE" missed="10" covered="90"/></report>', 'utf8');
    const jacRes = parseCoverageReport(jacRepo.dir, { name: 'jvm', path: '.', commands: { coverageFile: 'target/site/jacoco/jacoco.xml' }, thresholds: { diffCoverage: 85 } });
    assert.equal(jacRes.passed, true);
    assert.equal(jacRes.repoLineCoverage, 90);

    const goRepo = createTempGitRepo();
    cleanups.push(goRepo.cleanup);
    fs.mkdirSync(path.join(goRepo.dir, 'coverage'), { recursive: true });
    fs.writeFileSync(path.join(goRepo.dir, 'coverage/cover.out'), 'mode: set\nexample.com/pkg/a.go:1.1,5.2 4 1\nexample.com/pkg/a.go:6.1,8.2 1 0\n', 'utf8');
    const goRes = parseCoverageReport(goRepo.dir, { name: 'go', path: '.', commands: { coverageFile: 'coverage/cover.out' }, thresholds: { diffCoverage: 75 } });
    assert.equal(goRes.passed, true);
    assert.equal(goRes.repoLineCoverage, 80);
  });

  it('evaluates fresh mutation reports and exemptions even when runner exits non-zero, and parses Gradle PIT + mutmut 2.x', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({
        version: '0.1.0',
        modules: [{ name: 'root', path: '.', commands: {}, thresholds: { diffCoverage: 85, mutationScore: 80 } }],
        exemptions: [{ id: 'm-survived', file: 'src/a.mjs', reason: 'Equivalent logging guard', addedAt: '2026-11-16T00:00:00Z' }]
      }),
      'utf8'
    );

    // Runner script writes fresh Stryker JSON (1 killed, 1 survived exempted => 100% effective) AND exits 1!
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'scripts/fake-stryker.mjs'),
      `import fs from 'node:fs';
       fs.mkdirSync('reports/mutation', { recursive: true });
       fs.writeFileSync('reports/mutation/mutation.json', JSON.stringify({
         files: {
           'src/a.mjs': {
             mutants: [
               { id: 'm-killed', status: 'Killed', location: { start: { line: 1 }, end: { line: 1 } } },
               { id: 'm-survived', status: 'Survived', location: { start: { line: 2 }, end: { line: 2 } } }
             ]
           }
         }
       }));
       process.exit(1);`,
      'utf8'
    );

    const mod = {
      name: 'root',
      path: '.',
      commands: { mutation: `${process.execPath} scripts/fake-stryker.mjs` },
      thresholds: { diffCoverage: 85, mutationScore: 80 }
    };
    const mutRes = measureModuleMutation(dir, mod, { full: true });
    assert.equal(mutRes.passed, true);
    assert.equal(mutRes.score, 100);

    // Gradle PIT report discovery (build/reports/pitest/mutations.xml)
    const gradleRepo = createTempGitRepo();
    cleanups.push(gradleRepo.cleanup);
    fs.mkdirSync(path.join(gradleRepo.dir, 'build/reports/pitest'), { recursive: true });
    fs.writeFileSync(
      path.join(gradleRepo.dir, 'build/reports/pitest/mutations.xml'),
      '<mutations><mutation detected="true" status="KILLED"><sourceFile>App.java</sourceFile></mutation><mutation detected="true" status="KILLED"><sourceFile>App.java</sourceFile></mutation></mutations>',
      'utf8'
    );
    const pitParsed = parseMutationReport(gradleRepo.dir, {
      name: 'jvm',
      path: '.',
      commands: {},
      thresholds: { mutationScore: 80 }
    });
    assert.equal(pitParsed.found, true);
    assert.equal(pitParsed.passed, true);
    assert.equal(pitParsed.score, 100);

    // mutmut 2.x text report parsing + buildMutationPlan 1:1 pairing
    const pyRepo = createTempGitRepo();
    cleanups.push(pyRepo.cleanup);
    fs.writeFileSync(
      path.join(pyRepo.dir, '.mutmut-results.txt'),
      'Killed: 9\nSurvived: 1\nTimeout: 0\n',
      'utf8'
    );
    const mutmutParsed = parseMutationReport(pyRepo.dir, {
      name: 'py',
      path: '.',
      commands: {},
      thresholds: { mutationScore: 85 }
    });
    assert.equal(mutmutParsed.found, true);
    assert.equal(mutmutParsed.score, 90);
    assert.equal(mutmutParsed.passed, true);

    // cargo-mutants, mutmut JSON, and go-mutesting report formats
    const cargoMutRepo = createTempGitRepo();
    cleanups.push(cargoMutRepo.cleanup);
    fs.mkdirSync(path.join(cargoMutRepo.dir, 'mutants.out'), { recursive: true });
    fs.writeFileSync(
      path.join(cargoMutRepo.dir, 'mutants.out/outcomes.json'),
      JSON.stringify({ outcomes: [{ summary: 'caught' }, { summary: 'caught' }, { summary: 'missed' }] }),
      'utf8'
    );
    const cargoMut = parseMutationReport(cargoMutRepo.dir, { name: 'rs', path: '.', thresholds: { mutationScore: 60 } });
    assert.equal(cargoMut.passed, true);
    assert.equal(cargoMut.killed, 2);
    assert.equal(cargoMut.survived, 1);

    const mutJsonRepo = createTempGitRepo();
    cleanups.push(mutJsonRepo.cleanup);
    fs.writeFileSync(path.join(mutJsonRepo.dir, '.mutmut-results.json'), JSON.stringify({ killed: 7, timeout: 1, survived: 2 }), 'utf8');
    const mutJson = parseMutationReport(mutJsonRepo.dir, { name: 'py', path: '.', thresholds: { mutationScore: 75 } });
    assert.equal(mutJson.passed, true);
    assert.equal(mutJson.score, 80);

    const goMutRepo = createTempGitRepo();
    cleanups.push(goMutRepo.cleanup);
    fs.mkdirSync(path.join(goMutRepo.dir, 'reports/mutation'), { recursive: true });
    fs.writeFileSync(path.join(goMutRepo.dir, 'reports/mutation/go-mutesting.txt'), 'PASS: mut 1\nPASS: mut 2\nPASS: mut 3\nFAIL: mut 4\n', 'utf8');
    const goMut = parseMutationReport(goMutRepo.dir, { name: 'go', path: '.', thresholds: { mutationScore: 70 } });
    assert.equal(goMut.passed, true);
    assert.equal(goMut.score, 75);

    const reviewPlan = buildReviewPlan(dir, { sessionId: '99' });
    assert.equal(typeof reviewPlan.mode, 'string');
    assert.ok(Array.isArray(reviewPlan.reviewers));

    // Stryker diff-scoped plan does not misclassify source containing string "Binary files x differ"
    git(dir, 'checkout', '-q', '-b', 'feat/stryker-plan', 'develop');
    fs.mkdirSync(path.join(dir, '.agent/scripts/lib'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'tests/unit'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'stryker.config.json'), JSON.stringify({ mutate: ['.agent/scripts/lib/git.mjs'], tap: { testFiles: ['tests/unit/git.test.mjs', 'tests/unit/other.test.mjs'] } }), 'utf8');
    fs.writeFileSync(path.join(dir, '.agent/scripts/lib/git.mjs'), 'export const msg = "Binary files a and b differ";\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'tests/unit/git.test.mjs'), '// unit test\n', 'utf8');
    const plan = buildMutationPlan(dir, { name: 'root', path: '.', commands: { mutation: './node_modules/.bin/stryker run' } });
    assert.equal(plan.diffScoped, true);
    assert.ok(plan.targets.some((t) => t.startsWith('.agent/scripts/lib/git.mjs:1-')));

    // Subdirectory module (mod.path = 'packages/api') diff-scoped Stryker filter MUST catch Survived mutants (never bypass via diff-zero-mutants)
    const subMutRepo = createTempGitRepo();
    cleanups.push(subMutRepo.cleanup);
    git(subMutRepo.dir, 'checkout', '-q', '-b', 'feat/sub-mut', 'develop');
    fs.mkdirSync(path.join(subMutRepo.dir, 'packages/api/src'), { recursive: true });
    fs.writeFileSync(path.join(subMutRepo.dir, 'packages/api/src/a.js'), 'export const v = 1;\n', 'utf8');
    fs.writeFileSync(
      path.join(subMutRepo.dir, 'packages/api/fake-stryker.mjs'),
      `import fs from 'node:fs';
       fs.mkdirSync('reports/mutation', { recursive: true });
       fs.writeFileSync('reports/mutation/mutation.json', JSON.stringify({
         files: { 'src/a.js': { mutants: [{ id: '1', status: 'Survived', location: { start: { line: 1 }, end: { line: 1 } } }] } }
       }));`,
      'utf8'
    );
    const subMod = {
      name: 'api',
      path: 'packages/api',
      commands: { mutation: `${process.execPath} fake-stryker.mjs` },
      thresholds: { mutationScore: 80 }
    };
    const subMutRes = measureModuleMutation(subMutRepo.dir, subMod, { full: false });
    assert.equal(subMutRes.passed, false, 'Subdirectory diff-scoped Survived mutant must fail');
    assert.equal(subMutRes.score, 0);

    // resolveAffectedTests excludes non-runnable helpers under tests/helpers/
    fs.mkdirSync(path.join(subMutRepo.dir, 'tests/helpers'), { recursive: true });
    fs.writeFileSync(path.join(subMutRepo.dir, 'tests/helpers/helper.mjs'), 'export const h = 1;\n', 'utf8');
    assert.equal(resolveAffectedTests(subMutRepo.dir).includes('tests/helpers/helper.mjs'), false);
  });

  it('runGate executes docs-only vs code paths, stamps DIRTY_WORKING_TREE on uncommitted edits, and fails loud on session write error', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    git(dir, 'checkout', '-q', '-b', 'feat/gate-run', 'develop');
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'tests/sample.test.mjs'),
      "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('ok', () => assert.equal(1 + 1, 2));\n",
      'utf8'
    );
    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({
        version: '0.1.0',
        archlens: { enabled: false, policyPath: '.archlens/policy.json' },
        modules: [
          {
            name: 'root',
            path: '.',
            language: 'javascript',
            commands: {
              lint: null,
              build: null,
              test: `${process.execPath} --test "tests/**/*.test.mjs"`,
              coverage: `${process.execPath} --test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination=coverage/lcov.info "tests/**/*.test.mjs"`,
              coverageFile: 'coverage/lcov.info',
              mutation: null
            },
            thresholds: { diffCoverage: 80, mutationScore: null }
          }
        ]
      }),
      'utf8'
    );
    git(dir, 'add', '.agent/sdlc-config.json', 'tests/sample.test.mjs');
    git(dir, 'commit', '-q', '-m', 'feat: add sample test and config');

    writeActiveSession(dir, (s) => {
      s.activeSessionId = '55';
      s.sessions['55'] = { issueId: '55', branch: 'feat/gate-run', baseBranch: 'develop' };
      return s;
    });

    const cleanGate = runGate(dir, { noCache: true });
    assert.equal(cleanGate.passed, true);
    assert.equal(cleanGate.mode, 'code');
    const sessAfterClean = readActiveSession(dir);
    assert.equal(sessAfterClean.lastGate.passed, true);
    assert.notEqual(sessAfterClean.lastGate.headSha, 'DIRTY_WORKING_TREE');

    // Dirty edit stamps DIRTY_WORKING_TREE
    fs.writeFileSync(path.join(dir, 'README.md'), '# Dirty edit\n', 'utf8');
    const dirtyGate = runGate(dir, { noCache: true });
    assert.equal(dirtyGate.passed, true);
    assert.equal(readActiveSession(dir).lastGate.headSha, 'DIRTY_WORKING_TREE');

    // Throwing session writer fails closed instead of swallowing
    assert.throws(() =>
      runGate(dir, {
        noCache: true,
        writeSessionFn: () => {
          throw new Error('disk full');
        }
      })
    );

    // Corrupt .agent/.sdlc-session.json throws SESSION_CORRUPT during runGate without writeSessionFn
    fs.writeFileSync(path.join(dir, '.agent/.sdlc-session.json'), '{corrupt-session-json', 'utf8');
    assert.throws(() => runGate(dir, { noCache: true }), (err) => err?.code === 'SESSION_CORRUPT');

    // Docs-only branch runs docs-only mode
    const docRepo = createTempGitRepo();
    cleanups.push(docRepo.cleanup);
    git(docRepo.dir, 'checkout', '-q', '-b', 'docs/readme', 'develop');
    fs.mkdirSync(path.join(docRepo.dir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(docRepo.dir, '.agent/sdlc-config.json'),
      JSON.stringify({ version: '0.1.0', archlens: { enabled: false }, modules: [{ name: 'root', path: '.', commands: {} }] }),
      'utf8'
    );
    git(docRepo.dir, 'add', '.agent/sdlc-config.json');
    git(docRepo.dir, 'commit', '-q', '-m', 'chore: config');
    git(docRepo.dir, 'branch', '-f', 'develop', 'HEAD');
    fs.writeFileSync(path.join(docRepo.dir, 'README.md'), '# Pure docs update\n', 'utf8');
    git(docRepo.dir, 'add', 'README.md');
    git(docRepo.dir, 'commit', '-q', '-m', 'docs: update readme');

    const docsGate = runGate(docRepo.dir, { noCache: true });
    assert.equal(docsGate.passed, true);
    assert.equal(docsGate.mode, 'docs-only');

    const plan = buildReviewPlan(docRepo.dir);
    assert.equal(plan.modifiedFiles.includes('README.md'), true);
    assert.ok(Array.isArray(plan.reviewers) && plan.reviewers.length >= 1);
  });
});
