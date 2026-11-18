import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createTempGitRepo, git } from '../helpers/test-harness.mjs';
import { readChangeSet, resolveRange } from '../../.agent/scripts/lib/git.mjs';
import { formatMutantIdentity } from '../../.agent/scripts/lib/config.mjs';
import { readActiveSession, writeActiveSession } from '../../.agent/scripts/lib/receipt.mjs';
import {
  scanDiffSecrets,
  requireFreshReport,
  extractChangedHunkRanges,
  parseCoverageReport,
  parseMutationReport,
  buildMutationPlan,
  measureModuleCoverage,
  measureModuleMutation,
  resolveAffectedTests,
  runGate
} from '../../.agent/scripts/lib/measure.mjs';
import { buildReviewPlan } from '../../.agent/scripts/lib/guard.mjs';

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

    // Staged NUL-padded secret whose working copy was unlinked is still caught via :file index fallback
    fs.unlinkSync(path.join(dir, 'nul-secret.mjs'));
    assert.equal(scanDiffSecrets(dir).passed, false);

    // Replacing a 160000 gitlink at base with a regular file containing a secret (oldMode 160000 -> newMode 100644) is caught, while mode-only chmod passes
    const tcSecRepo = createTempGitRepo();
    cleanups.push(tcSecRepo.cleanup);
    fs.writeFileSync(path.join(tcSecRepo.dir, 'clean.mjs'), 'export const c = 1;\n', 'utf8');
    git(tcSecRepo.dir, 'add', 'clean.mjs');
    git(tcSecRepo.dir, 'update-index', '--add', '--cacheinfo', `160000,${'deadbeef'.repeat(5)},sub-to-file.mjs`);
    git(tcSecRepo.dir, 'commit', '-q', '-m', 'chore: base gitlink and clean file');
    git(tcSecRepo.dir, 'checkout', '-q', '-b', 'feat/tc-sec', 'develop');
    git(tcSecRepo.dir, 'update-index', '--chmod=+x', 'clean.mjs');
    git(tcSecRepo.dir, 'rm', '--cached', '-q', 'sub-to-file.mjs');
    fs.writeFileSync(path.join(tcSecRepo.dir, 'sub-to-file.mjs'), `export const k = "${fakeKey}";\n`, 'utf8');
    git(tcSecRepo.dir, 'add', 'sub-to-file.mjs');
    git(tcSecRepo.dir, 'commit', '-q', '-m', 'evil: replace gitlink with secret file');
    const tcCs = { ...scanDiffSecrets(tcSecRepo.dir, { baseBranch: 'develop' }) };
    assert.equal(tcCs.passed, false);
    assert.ok(tcCs.secretViolations.some((v) => v.file === 'sub-to-file.mjs' && v.type === 'SECRET_LEAK'));

    // Forced scan error fails closed with SCAN_ERROR
    const errRes = scanDiffSecrets(dir, {
      changeSet: { source: 'commit', baseSha: '0'.repeat(40), headSha: 'f'.repeat(40), paths: ['src/a.js'], entries: [{ path: 'src/a.js', status: 'A', oldMode: '000000', newMode: '100644', oldOid: '0'.repeat(40), newOid: '1'.repeat(40) }], patches: new Map() }
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

  it('scanDiffSecrets fails closed when a modified on-disk text file has no diff entry (while allowing binary extensions and deleted files)', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/deleted.js'), 'export const d = 1;\n', 'utf8');
    git(dir, 'add', 'src/deleted.js');
    git(dir, 'commit', '-q', '-m', 'chore: base file');

    git(dir, 'checkout', '-q', '-b', 'feat/missing-diff', 'develop');
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/a.js'), 'export const a = 1;\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'assets/logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    git(dir, 'rm', '-q', 'src/deleted.js');
    git(dir, 'add', 'src/a.js', 'assets/logo.png');
    git(dir, 'commit', '-q', '-m', 'feat: commit a, png, and remove deleted');

    const res = scanDiffSecrets(dir, {
      baseBranch: 'develop',
      changeSet: {
        source: 'commit',
        baseSha: '0'.repeat(40),
        headSha: 'f'.repeat(40),
        paths: ['assets/logo.png', 'src/a.js', 'src/deleted.js'],
        entries: [
          { path: 'assets/logo.png', status: 'A', oldMode: '000000', newMode: '100644', oldOid: '0'.repeat(40), newOid: '1'.repeat(40) },
          { path: 'src/a.js', status: 'A', oldMode: '000000', newMode: '100644', oldOid: '0'.repeat(40), newOid: '2'.repeat(40) },
          { path: 'src/deleted.js', status: 'D', oldMode: '100644', newMode: '000000', oldOid: '3'.repeat(40), newOid: '0'.repeat(40) }
        ],
        patches: new Map()
      }
    });
    assert.equal(res.passed, false);
    assert.ok(res.secretViolations.some((v) => v.file === 'src/a.js' && v.type === 'SCAN_ERROR'));
    assert.equal(res.secretViolations.some((v) => v.file === 'assets/logo.png'), false);
    assert.equal(res.secretViolations.some((v) => v.file === 'src/deleted.js'), false);
  });

  it('literal pathspecs stop ":!" filenames from excluding secret files', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    git(dir, 'checkout', '-q', '-b', 'feat/magic-path', 'develop');
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const fakeKey = ['AKIA', 'QQQQ', 'ABCDEFGHIJKL'].join('');
    fs.mkdirSync(path.join(dir, ':!src'), { recursive: true });
    fs.writeFileSync(path.join(dir, ':!src/leak.mjs'), '', 'utf8');
    fs.writeFileSync(path.join(dir, 'src/leak.mjs'), `export const k = "${fakeKey}";\n`, 'utf8');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'feat: commit excluded pathspec trick');

    const res = scanDiffSecrets(dir, { baseBranch: 'develop' });
    assert.equal(res.passed, false);
    assert.ok(res.secretViolations.some((v) => v.file === 'src/leak.mjs' && v.type === 'SECRET_LEAK'));
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

  it('exemption from run A does not waive a different survivor reusing the id in run B, and legacy ids are ignored with a warning', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    const survivorRunA = {
      id: '42',
      mutatorName: 'ConditionalExpression',
      replacement: 'false',
      status: 'Survived',
      location: { start: { line: 2, column: 6 }, end: { line: 2, column: 18 } }
    };
    const stableIdA = formatMutantIdentity(survivorRunA);
    assert.match(stableIdA, /^ConditionalExpression@2:6#[0-9a-f]{8}$/);

    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({
        version: '0.1.0',
        modules: [{ name: 'root', path: '.', commands: { mutation: 'stryker run' }, thresholds: { diffCoverage: null, mutationScore: 80 } }],
        exemptions: [
          { id: stableIdA, file: 'src/a.mjs', reason: 'Equivalent logging guard', addedAt: '2026-11-16T00:00:00Z' },
          { id: '42', file: 'src/a.mjs', reason: 'Legacy numeric id must be ignored', addedAt: '2026-11-16T00:00:00Z' }
        ]
      }),
      'utf8'
    );

    // Run A: survivor matches stableIdA (1 killed, 1 survived exempted => 100% effective) even when runner exits 1
    fs.mkdirSync(path.join(dir, 'tests/helpers'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'tests/helpers/fake-stryker.mjs'),
      `import fs from 'node:fs';
       fs.mkdirSync('reports/mutation', { recursive: true });
       fs.writeFileSync('reports/mutation/mutation.json', JSON.stringify({
         files: {
           'src/a.mjs': {
             mutants: [
               { id: '1', mutatorName: 'BooleanLiteral', replacement: 'true', status: 'Killed', location: { start: { line: 1, column: 2 }, end: { line: 1, column: 7 } } },
               ${JSON.stringify(survivorRunA)}
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
      commands: { mutation: `${process.execPath} tests/helpers/fake-stryker.mjs` },
      thresholds: { diffCoverage: null, mutationScore: 80 }
    };
    const mutResA = measureModuleMutation(dir, mod, { full: true });
    assert.equal(mutResA.passed, true);
    assert.equal(mutResA.score, 100);
    assert.equal(mutResA.exempted, 1);
    assert.ok(mutResA.warnings.some((w) => /Legacy mutant exemption id '42'/.test(w)));

    // Run B: a DIFFERENT survivor reuses numeric id '42' (different line/mutator/replacement) -> NOT waived by Run A's exemption or legacy '42'!
    fs.writeFileSync(
      path.join(dir, 'tests/helpers/fake-stryker.mjs'),
      `import fs from 'node:fs';
       fs.mkdirSync('reports/mutation', { recursive: true });
       fs.writeFileSync('reports/mutation/mutation.json', JSON.stringify({
         files: {
           'src/a.mjs': {
             mutants: [
               { id: '1', mutatorName: 'BooleanLiteral', replacement: 'true', status: 'Killed', location: { start: { line: 1, column: 2 }, end: { line: 1, column: 7 } } },
               { id: '42', mutatorName: 'EqualityOperator', replacement: '!==', status: 'Survived', location: { start: { line: 9, column: 4 }, end: { line: 9, column: 7 } } }
             ]
           }
         }
       }));`,
      'utf8'
    );
    const mutResB = measureModuleMutation(dir, mod, { full: true });
    assert.equal(mutResB.passed, false);
    assert.equal(mutResB.exempted, 0);
    assert.equal(mutResB.survived, 1);
    assert.equal(mutResB.score, 50);
  });

  it('parses PIT, mutmut, cargo-mutants, go-mutesting, and buildReviewPlan without child spawns', () => {
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

    const reviewPlan = buildReviewPlan(gradleRepo.dir, { sessionId: '99' });
    assert.equal(typeof reviewPlan.mode, 'string');
    assert.ok(Array.isArray(reviewPlan.reviewers));
  });

  it('buildMutationPlan and measureModuleMutation shard multi-source runs, keep cache in repo root, and fail closed on broken shards', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });

    // Stryker diff-scoped plan does not misclassify source containing string "Binary files x differ" and shards multi-source runs 1:1 per unit test
    fs.mkdirSync(path.join(dir, '.agent/scripts/lib'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'tests/unit'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'stryker.config.json'),
      JSON.stringify({
        incrementalFile: 'reports/stryker-incremental.json',
        mutate: ['.agent/scripts/lib/config.mjs', '.agent/scripts/lib/git.mjs', '.agent/scripts/lib/drift.mjs'],
        tap: { testFiles: ['tests/unit/config.test.mjs', 'tests/unit/git.test.mjs', 'tests/unit/drift.test.mjs'] }
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(dir, 'tests/unit/config.test.mjs'), '// unit test\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'tests/unit/git.test.mjs'), '// unit test\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'tests/unit/drift.test.mjs'), '// unit test\n', 'utf8');
    git(dir, 'add', 'stryker.config.json', 'tests/unit');
    git(dir, 'commit', '-q', '-m', 'chore: add stryker baseline');
    git(dir, 'checkout', '-q', '-b', 'feat/stryker-plan', 'develop');
    fs.writeFileSync(path.join(dir, '.agent/scripts/lib/git.mjs'), 'export const msg = "Binary files a and b differ";\n', 'utf8');
    const singlePlan = buildMutationPlan(dir, { name: 'root', path: '.', commands: { mutation: './node_modules/.bin/stryker run' } });
    assert.equal(singlePlan.diffScoped, true);
    assert.equal(singlePlan.shards, null);
    assert.ok(singlePlan.targets.some((t) => t.startsWith('.agent/scripts/lib/git.mjs:1-')));
    assert.equal(singlePlan.commandArgv.includes('reports/stryker-diff-incremental.json'), false);

    // Multi-file diff builds 1:1 per-module shards excluding unmodified drift.test.mjs and merges shard reports
    fs.writeFileSync(path.join(dir, '.agent/scripts/lib/config.mjs'), 'export const cfg = 1;\n', 'utf8');
    const multiPlan = buildMutationPlan(dir, { name: 'root', path: '.', commands: { mutation: './node_modules/.bin/stryker run' } });
    assert.equal(Array.isArray(multiPlan.shards), true);
    assert.equal(multiPlan.shards.length, 2);
    const fullPlan = buildMutationPlan(dir, { name: 'root', path: '.', commands: { mutation: './node_modules/.bin/stryker run' } }, { full: true });
    assert.equal(Array.isArray(fullPlan.shards) && fullPlan.shards.length === 3, true);

    fs.mkdirSync(path.join(dir, 'tests/helpers'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'tests/helpers/fake-stryker-shard.mjs'),
      `import fs from 'node:fs'; import path from 'node:path';
       const cfg = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
       if (!Array.isArray(cfg.reporters) || !cfg.reporters.includes('json')) process.exit(3);
       const out = cfg.jsonReporter.fileName;
       fs.mkdirSync(path.dirname(out), { recursive: true });
       const src = process.argv[5].split(':')[0];
       fs.writeFileSync(out, JSON.stringify({ files: { [src]: { mutants: [{ id: '1', status: 'Killed', location: { start: { line: 1 }, end: { line: 1 } } }] } } }));`,
      'utf8'
    );
    const shardedRes = measureModuleMutation(dir, { name: 'root', path: '.', commands: { mutation: `${process.execPath} tests/helpers/fake-stryker-shard.mjs run` }, thresholds: { mutationScore: 80 } });
    assert.equal(shardedRes.passed, true);
    assert.equal(shardedRes.killed, 2);

    // Crashing shard (missing/stale shard report) MUST fail closed instead of bypassing via diff-zero-mutants
    fs.writeFileSync(path.join(dir, 'tests/helpers/crash-stryker-shard.mjs'), 'process.exit(2);\n', 'utf8');
    assert.throws(() =>
      measureModuleMutation(dir, { name: 'root', path: '.', commands: { mutation: `${process.execPath} tests/helpers/crash-stryker-shard.mjs run` }, thresholds: { mutationScore: 80 } })
    );

    // Malformed shard JSON missing 'files' object fails closed even if runner exits 0
    fs.writeFileSync(
      path.join(dir, 'tests/helpers/malformed-stryker-shard.mjs'),
      `import fs from 'node:fs'; import path from 'node:path';
       const cfg = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
       fs.mkdirSync(path.dirname(cfg.jsonReporter.fileName), { recursive: true });
       fs.writeFileSync(cfg.jsonReporter.fileName, '{}');`,
      'utf8'
    );
    const malformedRes = measureModuleMutation(dir, { name: 'root', path: '.', commands: { mutation: `${process.execPath} tests/helpers/malformed-stryker-shard.mjs run` }, thresholds: { mutationScore: 80 } });
    assert.equal(malformedRes.passed, false);

    // Partial/crashing shard exiting non-zero MUST fail closed even if it wrote a partial report file
    fs.writeFileSync(
      path.join(dir, 'tests/helpers/partial-crash-shard.mjs'),
      `import fs from 'node:fs'; import path from 'node:path';
       const cfg = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
       fs.mkdirSync(path.dirname(cfg.jsonReporter.fileName), { recursive: true });
       const src = process.argv[5].split(':')[0];
       fs.writeFileSync(cfg.jsonReporter.fileName, JSON.stringify({ files: { [src]: { mutants: [{ id: '1', status: 'Killed', location: { start: { line: 1 }, end: { line: 1 } } }] } } }));
       process.exit(2);`,
      'utf8'
    );
    assert.throws(() =>
      measureModuleMutation(dir, { name: 'root', path: '.', commands: { mutation: `${process.execPath} tests/helpers/partial-crash-shard.mjs run` }, thresholds: { mutationScore: 80 } })
    );

    // C2c: new lib/foo.mjs outside mutate fails with diff-unmutated-sources
    fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'lib/foo.mjs'), 'export const unmutated = 42;\n', 'utf8');
    const unmutPlan = buildMutationPlan(dir, { name: 'root', path: '.', commands: { mutation: './node_modules/.bin/stryker run' } });
    assert.equal(unmutPlan.status, 'diff-unmutated-sources');
    assert.deepEqual(unmutPlan.unmutatedSources, ['lib/foo.mjs']);
    const unmutRes = measureModuleMutation(dir, { name: 'root', path: '.', commands: { mutation: `${process.execPath} tests/helpers/fake-stryker-shard.mjs run` }, thresholds: { mutationScore: 80 } });
    assert.equal(unmutRes.passed, false);
    assert.equal(unmutRes.status, 'diff-unmutated-sources');
    assert.match(unmutRes.reason, /lib\/foo\.mjs/);
    fs.rmSync(path.join(dir, 'lib'), { recursive: true, force: true });

    // Glob mutate patterns (positive + !-negated) in stryker.config.json match diff files and guarantee 'json' reporter on non-tap runners
    const globRepo = createTempGitRepo();
    cleanups.push(globRepo.cleanup);
    fs.mkdirSync(path.join(globRepo.dir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(globRepo.dir, 'stryker.config.json'),
      JSON.stringify({
        testRunner: 'vitest',
        reporters: ['clear-text'],
        mutate: ['src/**/*.ts', '!src/**/*.gen.ts']
      }),
      'utf8'
    );
    git(globRepo.dir, 'add', 'stryker.config.json');
    git(globRepo.dir, 'commit', '-q', '-m', 'chore: glob stryker config');
    git(globRepo.dir, 'checkout', '-q', '-b', 'feat/glob-mut', 'develop');
    fs.writeFileSync(path.join(globRepo.dir, 'src/service.ts'), 'export const s = 1;\n', 'utf8');
    fs.writeFileSync(path.join(globRepo.dir, 'src/schema.gen.ts'), 'export const g = 1;\n', 'utf8');
    const globPlan = buildMutationPlan(globRepo.dir, { name: 'root', path: '.', commands: { mutation: './node_modules/.bin/stryker run' } });
    assert.equal(globPlan.skip, false);
    assert.ok(globPlan.targets.some((t) => t.startsWith('src/service.ts')));
    assert.equal(globPlan.targets.some((t) => t.includes('schema.gen.ts')), false);
    assert.ok(globPlan.commandArgv.some((a) => a.includes('json')));
    const globFullPlan = buildMutationPlan(globRepo.dir, { name: 'root', path: '.', commands: { mutation: './node_modules/.bin/stryker run' } }, { full: true });
    assert.ok(globFullPlan.commandArgv.some((a) => a.includes('json')));

    // Editing a test whose stem matches a !-negated file ('!src/ignored.ts') MUST NOT pair '!src/ignored.ts' into targets
    fs.mkdirSync(path.join(globRepo.dir, 'tests/unit'), { recursive: true });
    fs.writeFileSync(
      path.join(globRepo.dir, 'stryker.config.json'),
      JSON.stringify({ testRunner: 'vitest', mutate: ['src/**/*.ts', '!src/ignored.ts'] }),
      'utf8'
    );
    git(globRepo.dir, 'add', 'stryker.config.json');
    git(globRepo.dir, 'commit', '-q', '-m', 'chore: update glob negate');
    fs.rmSync(path.join(globRepo.dir, 'src/service.ts'));
    fs.rmSync(path.join(globRepo.dir, 'src/schema.gen.ts'));
    git(globRepo.dir, 'checkout', '-q', '-b', 'feat/neg-pair', 'HEAD');
    fs.writeFileSync(path.join(globRepo.dir, 'tests/unit/ignored.test.ts'), '// test\n', 'utf8');
    const negPairPlan = buildMutationPlan(globRepo.dir, { name: 'root', path: '.', commands: { mutation: './node_modules/.bin/stryker run' } }, { baseBranch: 'feat/glob-mut' });
    assert.equal(negPairPlan.skip, true);

    // Non-tap testRunner falls back to unsharded execution
    fs.writeFileSync(
      path.join(dir, 'stryker.config.json'),
      JSON.stringify({ testRunner: 'vitest', mutate: ['.agent/scripts/lib/config.mjs', '.agent/scripts/lib/git.mjs'], tap: { testFiles: ['tests/unit/config.test.mjs', 'tests/unit/git.test.mjs'] } }),
      'utf8'
    );
    assert.equal(buildMutationPlan(dir, { name: 'root', path: '.', commands: { mutation: './node_modules/.bin/stryker run' } }).shards, null);

    // Subdirectory mod.path writes generated Stryker cache configs inside repo-root .agent/.cache/ (never dirtying packages/api/.agent)
    const subCacheRepo = createTempGitRepo();
    cleanups.push(subCacheRepo.cleanup);
    fs.mkdirSync(path.join(subCacheRepo.dir, 'packages/api/src'), { recursive: true });
    fs.mkdirSync(path.join(subCacheRepo.dir, 'packages/api/tests/unit'), { recursive: true });
    fs.writeFileSync(path.join(subCacheRepo.dir, 'packages/api/stryker.config.json'), JSON.stringify({ mutate: ['src/a.mjs'], tap: { testFiles: ['tests/unit/a.test.mjs', 'tests/unit/b.test.mjs'] } }), 'utf8');
    fs.writeFileSync(path.join(subCacheRepo.dir, 'packages/api/tests/unit/a.test.mjs'), '// t\n', 'utf8');
    fs.writeFileSync(path.join(subCacheRepo.dir, 'packages/api/src/a.mjs'), 'export const a = 1;\n', 'utf8');
    git(subCacheRepo.dir, 'add', 'packages/api');
    git(subCacheRepo.dir, 'commit', '-q', '-m', 'chore: sub baseline');
    git(subCacheRepo.dir, 'checkout', '-q', '-b', 'feat/sub-cache', 'develop');
    fs.writeFileSync(path.join(subCacheRepo.dir, 'packages/api/src/a.mjs'), 'export const a = 2;\n', 'utf8');
    git(subCacheRepo.dir, 'add', 'packages/api/src/a.mjs');
    git(subCacheRepo.dir, 'commit', '-q', '-m', 'feat: update a');
    buildMutationPlan(subCacheRepo.dir, { name: 'api', path: 'packages/api', commands: { mutation: './node_modules/.bin/stryker run' } });
    assert.equal(fs.existsSync(path.join(subCacheRepo.dir, 'packages/api/.agent')), false);
    assert.equal(git(subCacheRepo.dir, 'status', '--porcelain').stdout.trim(), '');

    // Coverage-summary JSON and JaCoCo CSV parsers
    const jsonCovRepo = createTempGitRepo();
    cleanups.push(jsonCovRepo.cleanup);
    fs.mkdirSync(path.join(jsonCovRepo.dir, 'coverage'), { recursive: true });
    fs.writeFileSync(path.join(jsonCovRepo.dir, 'coverage/coverage-summary.json'), JSON.stringify({ total: { lines: { pct: 92.5 } } }), 'utf8');
    assert.equal(parseCoverageReport(jsonCovRepo.dir, { name: 'js', path: '.', commands: { coverageFile: 'coverage/coverage-summary.json' }, thresholds: { diffCoverage: 85 } }).repoLineCoverage, 92.5);

    const csvCovRepo = createTempGitRepo();
    cleanups.push(csvCovRepo.cleanup);
    fs.mkdirSync(path.join(csvCovRepo.dir, 'target/site/jacoco'), { recursive: true });
    fs.writeFileSync(path.join(csvCovRepo.dir, 'target/site/jacoco/jacoco.csv'), 'GROUP,PACKAGE,CLASS,LINE_MISSED,LINE_COVERED\ng,p,C,5,95\n', 'utf8');
    assert.equal(parseCoverageReport(csvCovRepo.dir, { name: 'jvm', path: '.', commands: { coverageFile: 'target/site/jacoco/jacoco.csv' }, thresholds: { diffCoverage: 85 } }).repoLineCoverage, 95);

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
      path.join(dir, 'tests/emit-cov.mjs'),
      "import fs from 'node:fs';\nfs.mkdirSync('coverage', { recursive: true });\nfs.writeFileSync('coverage/lcov.info', 'SF:tests/emit-cov.mjs\\nDA:1,1\\nLF:1\\nLH:1\\nend_of_record\\n', 'utf8');\n",
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
              test: `${process.execPath} tests/emit-cov.mjs`,
              coverage: `${process.execPath} tests/emit-cov.mjs`,
              coverageFile: 'coverage/lcov.info',
              mutation: null
            },
            thresholds: { diffCoverage: 80, mutationScore: null }
          }
        ]
      }),
      'utf8'
    );
    git(dir, 'add', '.agent/sdlc-config.json', 'tests/emit-cov.mjs');
    git(dir, 'commit', '-q', '-m', 'feat: add sample test and config');

    writeActiveSession(dir, (s) => {
      s.activeSessionId = '55';
      s.sessions['55'] = { issueId: '55', branch: 'feat/gate-run', baseBranch: 'develop' };
      return s;
    });

    const progressSteps = [];
    const cleanGate = runGate(dir, { noCache: true, onProgress: (msg) => progressSteps.push(msg) });
    assert.equal(cleanGate.passed, true);
    assert.equal(cleanGate.mode, 'code');
    assert.ok(progressSteps.some((m) => /coverage/i.test(m)));
    const sessAfterClean = readActiveSession(dir);
    assert.equal(sessAfterClean.lastGate.passed, true);
    assert.notEqual(sessAfterClean.lastGate.headSha, 'DIRTY_WORKING_TREE');

    // Dirty edit is refused upfront by runGate before running any configured command (ADR-020)
    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({
        version: '0.1.0',
        archlens: { enabled: false },
        modules: [{ name: 'root', path: '.', commands: { lint: `${process.execPath} -e "import('node:fs').then(f=>f.writeFileSync('ran-on-dirty.txt','1'))"` }, thresholds: { diffCoverage: null, mutationScore: null } }]
      }),
      'utf8'
    );
    const dirtyGate = runGate(dir, { noCache: true });
    assert.equal(dirtyGate.passed, false);
    assert.equal(dirtyGate.stage, 'dirty');
    assert.match(dirtyGate.reason, /DIRTY_WORKING_TREE/);
    assert.equal(fs.existsSync(path.join(dir, 'ran-on-dirty.txt')), false, 'dirty gate must refuse before running any command');
    git(dir, 'checkout', '--', '.agent/sdlc-config.json');

    // Advisory sdlc coverage on uncommitted work still measures the uncommitted lines
    fs.writeFileSync(path.join(dir, 'uncommitted-mod.mjs'), 'export const u = 1;\nexport const u2 = 2;\n', 'utf8');
    fs.writeFileSync(
      path.join(dir, 'tests/emit-cov.mjs'),
      "import fs from 'node:fs';\nfs.mkdirSync('coverage', { recursive: true });\nfs.writeFileSync('coverage/lcov.info', 'SF:uncommitted-mod.mjs\\nDA:1,1\\nDA:2,1\\nLF:2\\nLH:2\\nend_of_record\\n', 'utf8');\n",
      'utf8'
    );
    const advCov = measureModuleCoverage(dir, {
      name: 'root',
      path: '.',
      commands: { coverage: `${process.execPath} tests/emit-cov.mjs`, coverageFile: 'coverage/lcov.info' },
      thresholds: { diffCoverage: 90 }
    });
    assert.equal(advCov.passed, true);
    assert.equal(advCov.diffLineCoverage, 100);
    fs.unlinkSync(path.join(dir, 'uncommitted-mod.mjs'));
    git(dir, 'checkout', '--', 'tests/emit-cov.mjs');

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

  it('covers warm gate cache hits, module step failures (lint/build/test/coverage/mutation), hunk collapsing, diff-zero-mutants, and affected-test mapping', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    // Invalid config returns stage: 'config'
    assert.equal(runGate(dir).stage, 'config');

    // Hunk range merging & >maxRanges collapsing
    const manyHunks = Array.from({ length: 6 }, (_, i) => `@@ -1,1 +${i * 20 + 1},2 @@\n+a\n+b`).join('\n');
    assert.equal(extractChangedHunkRanges(manyHunks, { maxGapLines: 2, maxRanges: 3 }).length, 1);
    assert.deepEqual(extractChangedHunkRanges('Binary files a and b differ'), []);

    // Unconfigured coverage/mutation commands return clean statuses
    assert.equal(measureModuleCoverage(dir, { name: 'root', path: '.', commands: {} }).passed, false);
    assert.equal(measureModuleMutation(dir, { name: 'root', path: '.', commands: {} }).skipped, true);

    // Setup code branch for warm gate cache hit & step failure checks
    git(dir, 'checkout', '-q', '-b', 'feat/steps', 'develop');
    fs.mkdirSync(path.join(dir, '.agent/scripts/lib'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'tests/unit'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.agent/scripts/sdlc-engine.mjs'), 'export const cli = 1;\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'tests/unit/cli.test.mjs'), '// cli test\n', 'utf8');
    assert.deepEqual(resolveAffectedTests(dir), ['tests/unit/cli.test.mjs']);

    const writeAndCommitCfg = (commands, thresholds = { diffCoverage: null, mutationScore: null }) => {
      fs.writeFileSync(
        path.join(dir, '.agent/sdlc-config.json'),
        JSON.stringify({ version: '0.1.0', archlens: { enabled: false }, modules: [{ name: 'root', path: '.', commands, thresholds }] }),
        'utf8'
      );
      git(dir, 'add', '.agent/sdlc-config.json', '.agent/scripts/sdlc-engine.mjs', 'tests/unit/cli.test.mjs');
      git(dir, 'commit', '-q', '-m', 'chore: update cfg');
    };

    // Failing lint, build, test, and mutation steps record exact failedStep
    writeAndCommitCfg({ lint: `${process.execPath} -e "process.exit(1)"` });
    assert.equal(runGate(dir, { noCache: true }).modules[0].failedStep, 'lint');

    writeAndCommitCfg({ build: `${process.execPath} -e "process.exit(1)"` });
    assert.equal(runGate(dir, { noCache: true }).modules[0].failedStep, 'build');

    writeAndCommitCfg({ test: `${process.execPath} -e "process.exit(1)"` });
    assert.equal(runGate(dir, { noCache: true }).modules[0].failedStep, 'test');

    // Warm gate cache hit on clean committed tree
    writeAndCommitCfg({ test: `${process.execPath} -e "process.exit(0)"` });
    const cold = runGate(dir, { noCache: false });
    assert.equal(cold.passed, true);
    assert.equal(cold.modules[0].cached, false);
    const warm = runGate(dir, { noCache: false });
    assert.equal(warm.passed, true);
    assert.equal(warm.modules[0].cached, true);

    // Diff-scoped Stryker run with 0 mutants in target range returns diff-zero-mutants (passed: true, skipped: true)
    fs.writeFileSync(path.join(dir, 'stryker.config.json'), JSON.stringify({ mutate: ['.agent/scripts/sdlc-engine.mjs'] }), 'utf8');
    fs.writeFileSync(
      path.join(dir, 'emit-empty-mut.mjs'),
      `import fs from 'node:fs'; fs.mkdirSync('reports/mutation', { recursive: true }); fs.writeFileSync('reports/mutation/mutation.json', JSON.stringify({ files: {} }));`,
      'utf8'
    );
    git(dir, 'add', 'stryker.config.json', 'emit-empty-mut.mjs');
    git(dir, 'commit', '-q', '-m', 'chore: empty mut fixture');
    git(dir, 'checkout', '-q', '-b', 'feat/zero-mut', 'feat/steps');
    fs.writeFileSync(path.join(dir, '.agent/scripts/sdlc-engine.mjs'), '// comment-only edit\nexport const cli = 1;\n', 'utf8');
    const zeroMut = measureModuleMutation(
      dir,
      { name: 'root', path: '.', commands: { mutation: `${process.execPath} emit-empty-mut.mjs stryker` }, thresholds: { mutationScore: 80 } },
      { baseBranch: 'feat/steps' }
    );
    assert.equal(zeroMut.passed, true);
    assert.equal(zeroMut.status, 'diff-zero-mutants');

    // Missing reports, EMPTY_REPORT on full mutation, skipInTests secret rule, and 2-reviewer code reviewPlan
    const emptyRepo = createTempGitRepo();
    cleanups.push(emptyRepo.cleanup);
    assert.equal(parseCoverageReport(emptyRepo.dir, { name: 'root', path: '.' }).found, false);
    assert.equal(parseMutationReport(emptyRepo.dir, { name: 'root', path: '.' }).found, false);
    fs.mkdirSync(path.join(emptyRepo.dir, 'reports/mutation'), { recursive: true });
    fs.writeFileSync(path.join(emptyRepo.dir, 'reports/mutation/mutation.json'), JSON.stringify({ files: {} }), 'utf8');
    const emptyFullMut = parseMutationReport(emptyRepo.dir, { name: 'root', path: '.' });
    assert.equal(emptyFullMut.passed, false);
    assert.equal(emptyFullMut.zeroMutants, true);

    // Target line-range filter + Ignored/CompileError/Timeout/RuntimeError statuses in parseMutationReport
    fs.writeFileSync(
      path.join(emptyRepo.dir, 'reports/mutation/mutation.json'),
      JSON.stringify({
        files: {
          'src/a.js': {
            mutants: [
              { id: '1', status: 'Timeout', location: { start: { line: 2 } } },
              { id: '2', status: 'Ignored', location: { start: { line: 2 } } },
              { id: '3', status: 'CompileError', location: { start: { line: 2 } } },
              { id: '4', status: 'RuntimeError', location: { start: { line: 2 } } },
              { id: '5', status: 'Survived', location: { start: { line: 50 } } }
            ]
          },
          'src/untargeted.js': { mutants: [{ id: '9', status: 'Survived', location: { start: { line: 1 } } }] }
        }
      }),
      'utf8'
    );
    const rangedMut = parseMutationReport(emptyRepo.dir, { name: 'root', path: '.', thresholds: { mutationScore: 50 } }, { targets: ['src/a.js:1-10'] });
    assert.equal(rangedMut.killed, 1);
    assert.equal(rangedMut.survived, 1);
    assert.equal(rangedMut.passed, true);

    git(emptyRepo.dir, 'checkout', '-q', '-b', 'feat/sec-skip', 'develop');
    fs.mkdirSync(path.join(emptyRepo.dir, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(emptyRepo.dir, 'tests/s.test.mjs'), 'const api_key = "1234567890123456789012345";\n', 'utf8');
    assert.equal(scanDiffSecrets(emptyRepo.dir).passed, true);
    fs.writeFileSync(path.join(emptyRepo.dir, 'guard-sec.mjs'), 'const api_key = "1234567890123456789012345";\n', 'utf8');
    assert.equal(scanDiffSecrets(emptyRepo.dir).passed, false);
    const codePlan = buildReviewPlan(emptyRepo.dir);
    assert.equal(codePlan.mode, 'code');
    assert.equal(codePlan.reviewers.length, 2);

    // Small non-governance code diff gets 1 reviewer; >32kB diff gets truncated prompt marker
    fs.unlinkSync(path.join(emptyRepo.dir, 'guard-sec.mjs'));
    fs.writeFileSync(path.join(emptyRepo.dir, 'math.mjs'), 'export const add = (a, b) => a + b;\n', 'utf8');
    const smallPlan = buildReviewPlan(emptyRepo.dir);
    assert.equal(smallPlan.mode, 'code');
    assert.equal(smallPlan.reviewers.length, 1);
    assert.equal(smallPlan.reviewers[0].role, 'PR Peer Reviewer');
    assert.match(smallPlan.reviewers[0].prompt, /math\.mjs/);

    fs.writeFileSync(path.join(emptyRepo.dir, 'big.mjs'), `${'// line\n'.repeat(210)}export const s = "${'x'.repeat(35000)}";\n`, 'utf8');
    const bigPlan = buildReviewPlan(emptyRepo.dir);
    assert.equal(bigPlan.reviewers.length, 2);
    assert.match(bigPlan.reviewers[0].prompt, /diff truncated at 32kB/);

    // Binary-attributed text secret scan across commit ChangeSet, worktree disk, and staged-deleted index fallback + mode-only/gitlink skips
    const binSecRepo = createTempGitRepo();
    cleanups.push(binSecRepo.cleanup);
    const fakeAws = ['AKIA', '1234567890ABCDEF'].join('');
    git(binSecRepo.dir, 'checkout', '-q', '-b', 'feat/bin-sec', 'develop');
    fs.writeFileSync(path.join(binSecRepo.dir, '.gitattributes'), '*.mjs binary\n', 'utf8');
    fs.writeFileSync(path.join(binSecRepo.dir, 'bin-secret.mjs'), Buffer.from(`\x00export const k = "${fakeAws}";\n`, 'latin1'));
    git(binSecRepo.dir, 'add', '.gitattributes', 'bin-secret.mjs');
    // Worktree scan on disk before commit
    const wtBinDisk = scanDiffSecrets(binSecRepo.dir);
    assert.equal(wtBinDisk.passed, false);
    assert.equal(wtBinDisk.secretViolations[0].file, 'bin-secret.mjs');
    // Staged-then-deleted worktree scan falls back to `git show :file`
    fs.unlinkSync(path.join(binSecRepo.dir, 'bin-secret.mjs'));
    const wtBinStaged = scanDiffSecrets(binSecRepo.dir);
    assert.equal(wtBinStaged.passed, false);
    // Commit ChangeSet scan reads blob via readBlobs + ignores mode-only and 160000 gitlink entries
    fs.writeFileSync(path.join(binSecRepo.dir, 'bin-secret.mjs'), Buffer.from(`\x00export const k = "${fakeAws}";\n`, 'latin1'));
    git(binSecRepo.dir, 'add', 'bin-secret.mjs');
    git(binSecRepo.dir, 'update-index', '--chmod=+x', 'README.md');
    const devTip = git(binSecRepo.dir, 'rev-parse', 'develop').stdout.trim();
    git(binSecRepo.dir, 'update-index', '--add', '--cacheinfo', `160000,${devTip},submod`);
    git(binSecRepo.dir, 'commit', '-q', '-m', 'feat: binary secret commit');
    const commitBinCs = readChangeSet({ ...resolveRange({ baseBranch: 'develop', repoRoot: binSecRepo.dir }), source: 'commit', repoRoot: binSecRepo.dir });
    const commitBinScan = scanDiffSecrets(binSecRepo.dir, { changeSet: commitBinCs });
    assert.equal(commitBinScan.passed, false);
    assert.equal(commitBinScan.secretViolations.length, 1);
    assert.equal(commitBinScan.secretViolations[0].file, 'bin-secret.mjs');

    // runGate: docs-only commit passes with mutationStatus 'docs-only' even when AUDIT_CHAIN.jsonl is dirty; archlens ring violation fails
    const gateModeRepo = createTempGitRepo();
    cleanups.push(gateModeRepo.cleanup);
    fs.mkdirSync(path.join(gateModeRepo.dir, '.agent'), { recursive: true });
    fs.mkdirSync(path.join(gateModeRepo.dir, '.archlens'), { recursive: true });
    fs.mkdirSync(path.join(gateModeRepo.dir, 'docs'), { recursive: true });
    fs.writeFileSync(
      path.join(gateModeRepo.dir, '.agent/sdlc-config.json'),
      JSON.stringify({
        version: '0.1.0',
        archlens: { enabled: true, policyPath: '.archlens/policy.json' },
        modules: [{ name: 'root', path: '.', commands: {}, thresholds: { diffCoverage: null, mutationScore: null } }]
      }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(gateModeRepo.dir, '.archlens/policy.json'),
      JSON.stringify({ src: 'src', order: ['core', 'adapters'], levels: [['src/core/**'], ['src/adapters/**']] }),
      'utf8'
    );
    fs.writeFileSync(path.join(gateModeRepo.dir, 'docs/AUDIT_CHAIN.jsonl'), '', 'utf8');
    git(gateModeRepo.dir, 'add', '-A');
    git(gateModeRepo.dir, 'commit', '-q', '-m', 'chore: gate mode base');
    git(gateModeRepo.dir, 'checkout', '-q', '-b', 'docs/note', 'develop');
    fs.writeFileSync(path.join(gateModeRepo.dir, 'docs/guide.md'), '# Guide\n', 'utf8');
    git(gateModeRepo.dir, 'add', 'docs/guide.md');
    git(gateModeRepo.dir, 'commit', '-q', '-m', 'docs: guide');
    fs.writeFileSync(path.join(gateModeRepo.dir, 'docs/AUDIT_CHAIN.jsonl'), '{"dirty":true}\n', 'utf8');
    const docsGate = runGate(gateModeRepo.dir, { noCache: true });
    assert.equal(docsGate.passed, true);
    assert.equal(docsGate.dirty, false);
    assert.equal(docsGate.mode, 'docs-only');
    assert.equal(docsGate.lastGate.mutationStatus, 'docs-only');
    git(gateModeRepo.dir, 'checkout', '--', 'docs/AUDIT_CHAIN.jsonl');

    fs.mkdirSync(path.join(gateModeRepo.dir, 'src/core'), { recursive: true });
    fs.mkdirSync(path.join(gateModeRepo.dir, 'src/adapters'), { recursive: true });
    fs.writeFileSync(path.join(gateModeRepo.dir, 'src/adapters/out.mjs'), 'export const out = 1;\n', 'utf8');
    fs.writeFileSync(path.join(gateModeRepo.dir, 'src/core/bad.mjs'), "import { out } from '../adapters/out.mjs';\nexport const v = out;\n", 'utf8');
    git(gateModeRepo.dir, 'add', 'src');
    git(gateModeRepo.dir, 'commit', '-q', '-m', 'feat: inward violation');
    const archFailGate = runGate(gateModeRepo.dir, { noCache: true });
    assert.equal(archFailGate.passed, false);
    assert.equal(archFailGate.arch.passed, false);
  });
});
