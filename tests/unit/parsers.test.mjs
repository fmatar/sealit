import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createTempGitRepo, git } from '../helpers/test-harness.mjs';
import {
  extractChangedHunkRanges,
  isTestFilePath,
  isTrackableSourceFile,
  parseCoverageReport,
  parseMutationReport,
  requireFreshReport
} from '../../.agent/scripts/lib/parsers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

function setupBranchWithFile(relPath, content) {
  const repo = createTempGitRepo();
  cleanups.push(repo.cleanup);
  git(repo.dir, 'checkout', '-q', '-b', 'feat/polyglot', 'develop');
  const full = path.join(repo.dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  git(repo.dir, 'add', relPath);
  git(repo.dir, 'commit', '-q', '-m', `feat: add ${relPath}`);
  return repo.dir;
}

describe('Ring 1: lib/parsers.mjs — Polyglot Per-Line Diff Coverage & Mutation Parsers', () => {
  it('classifies test vs trackable source files, checks report freshness, and merges diff hunk ranges', () => {
    assert.equal(isTestFilePath('tests/a.test.mjs'), true);
    assert.equal(isTestFilePath('pkg/foo_test.go'), true);
    assert.equal(isTestFilePath('src/service.py'), false);
    assert.equal(isTrackableSourceFile('src/service.py'), true);
    assert.equal(isTrackableSourceFile('src/service.go'), true);
    assert.equal(isTrackableSourceFile('src/Service.java'), true);
    assert.equal(isTrackableSourceFile('src/service_test.go'), false);
    assert.equal(isTrackableSourceFile('README.md'), false);

    assert.deepEqual(extractChangedHunkRanges(''), []);
    assert.deepEqual(extractChangedHunkRanges('Binary files a/x and b/x differ'), []);
    assert.deepEqual(
      extractChangedHunkRanges('@@ -1,0 +10,2 @@\n+a\n+b\n@@ -5,0 +14,2 @@\n+c\n+d\n@@ -20,0 +50 @@\n+e\n'),
      [{ start: 10, end: 15 }, { start: 50, end: 50 }]
    );
    const manyHunks = Array.from({ length: 6 }, (_, i) => `@@ -1,0 +${(i + 1) * 20},1 @@\n+x`).join('\n');
    assert.deepEqual(extractChangedHunkRanges(manyHunks, { maxGapLines: 2, maxRanges: 3 }), [{ start: 20, end: 120 }]);

    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);
    assert.equal(requireFreshReport({ found: false }, { path: '.' }, dir, Date.now()).passed, false);
    assert.equal(requireFreshReport({ found: true, file: 'missing.info' }, { path: '.' }, dir, Date.now()).stale, true);

    fs.writeFileSync(path.join(dir, 'rep.info'), 'SF:a.mjs\nend_of_record\n', 'utf8');
    const oldTime = new Date(Date.now() - 10000);
    fs.utimesSync(path.join(dir, 'rep.info'), oldTime, oldTime);
    assert.equal(requireFreshReport({ found: true, file: 'rep.info', passed: true }, { path: '.' }, dir, Date.now()).stale, true);
    const now = new Date();
    fs.utimesSync(path.join(dir, 'rep.info'), now, now);
    assert.equal(requireFreshReport({ found: true, file: 'rep.info', passed: true }, { path: '.' }, dir, Date.now() - 500).passed, true);
  });

  it('Cobertura XML evaluates per-line diff coverage (0%-covered new file fails at 95% repo coverage; covered file passes at 20%)', () => {
    const dir = setupBranchWithFile('src/new_mod.py', 'def f(x):\n    y = x + 1\n    return y\n');
    fs.mkdirSync(path.join(dir, 'coverage'), { recursive: true });

    // High repo line-rate (95%), but changed file src/new_mod.py has 0 hits on lines 1..3 -> MUST FAIL!
    fs.writeFileSync(
      path.join(dir, 'coverage/coverage.xml'),
      `<?xml version="1.0"?>
<coverage line-rate="0.95">
  <sources><source>src</source></sources>
  <packages><package name="pkg"><classes>
    <class name="old_mod.py" filename="old_mod.py">
      <lines><line number="1" hits="10"/><line number="2" hits="10"/></lines>
    </class>
    <class name="new_mod.py" filename="new_mod.py">
      <lines><line number="1" hits="0"/><line number="2" hits="0"/><line number="3" hits="0"/></lines>
    </class>
  </classes></package></packages>
</coverage>`,
      'utf8'
    );
    const failRes = parseCoverageReport(dir, { name: 'py', path: '.', commands: { coverageFile: 'coverage/coverage.xml' }, thresholds: { diffCoverage: 85 } });
    assert.equal(failRes.found, true);
    assert.equal(failRes.repoLineCoverage, 95);
    assert.equal(failRes.diffLineCoverage, 0);
    assert.equal(failRes.passed, false);

    // Low repo line-rate (20%), but changed file src/new_mod.py is 100% covered -> MUST PASS!
    fs.writeFileSync(
      path.join(dir, 'coverage/coverage.xml'),
      `<?xml version="1.0"?>
<coverage line-rate="0.20">
  <sources><source>src</source></sources>
  <packages><package name="pkg"><classes>
    <class name="new_mod.py" filename="new_mod.py">
      <lines><line number="1" hits="1"/><line number="2" hits="1"/><line number="3" hits="1"/></lines>
    </class>
  </classes></package></packages>
</coverage>`,
      'utf8'
    );
    const passRes = parseCoverageReport(dir, { name: 'py', path: '.', commands: { coverageFile: 'coverage/coverage.xml' }, thresholds: { diffCoverage: 85 } });
    assert.equal(passRes.passed, true);
    assert.equal(passRes.diffLineCoverage, 100);
    assert.equal(passRes.repoLineCoverage, 20);

    // Changed file completely omitted from Cobertura XML still counts executable lines as 0% covered
    fs.writeFileSync(
      path.join(dir, 'coverage/coverage.xml'),
      `<?xml version="1.0"?>
<coverage line-rate="0.98">
  <packages><package name="pkg"><classes>
    <class name="other.py" filename="src/other.py"><lines><line number="1" hits="5"/></lines></class>
  </classes></package></packages>
</coverage>`,
      'utf8'
    );
    const unimported = parseCoverageReport(dir, { name: 'py', path: '.', commands: { coverageFile: 'coverage/coverage.xml' }, thresholds: { diffCoverage: 85 } });
    assert.equal(unimported.passed, false);
    assert.equal(unimported.diffLineCoverage, 0);
  });

  it('JaCoCo XML evaluates per-line diff coverage (0%-covered new Java file fails at 95% repo coverage; covered file passes at 20%)', () => {
    const dir = setupBranchWithFile(
      'src/main/java/com/acme/Billing.java',
      'package com.acme;\nclass Billing {\n  int total(int a, int b) {\n    return a + b;\n  }\n}\n'
    );
    fs.mkdirSync(path.join(dir, 'target/site/jacoco'), { recursive: true });

    fs.writeFileSync(
      path.join(dir, 'target/site/jacoco/jacoco.xml'),
      `<?xml version="1.0"?>
<report name="demo">
  <package name="com/acme">
    <sourcefile name="Billing.java">
      <line nr="3" mi="2" ci="0"/>
      <line nr="4" mi="3" ci="0"/>
    </sourcefile>
  </package>
  <counter type="LINE" missed="5" covered="95"/>
</report>`,
      'utf8'
    );
    const failRes = parseCoverageReport(dir, { name: 'jvm', path: '.', commands: { coverageFile: 'target/site/jacoco/jacoco.xml' }, thresholds: { diffCoverage: 85 } });
    assert.equal(failRes.repoLineCoverage, 95);
    assert.equal(failRes.diffLineCoverage, 0);
    assert.equal(failRes.passed, false);

    fs.writeFileSync(
      path.join(dir, 'target/site/jacoco/jacoco.xml'),
      `<?xml version="1.0"?>
<report name="demo">
  <package name="com/acme">
    <sourcefile name="Billing.java">
      <line nr="3" mi="0" ci="2"/>
      <line nr="4" mi="0" ci="3"/>
    </sourcefile>
  </package>
  <counter type="LINE" missed="80" covered="20"/>
</report>`,
      'utf8'
    );
    const passRes = parseCoverageReport(dir, { name: 'jvm', path: '.', commands: { coverageFile: 'target/site/jacoco/jacoco.xml' }, thresholds: { diffCoverage: 85 } });
    assert.equal(passRes.repoLineCoverage, 20);
    assert.equal(passRes.diffLineCoverage, 100);
    assert.equal(passRes.passed, true);
  });

  it('Go cover.out strips go.mod module prefix and evaluates per-line diff coverage accurately', () => {
    const dir = setupBranchWithFile('pkg/calc/calc.go', 'package calc\nfunc Add(a, b int) int {\n\treturn a + b\n}\n');
    fs.writeFileSync(path.join(dir, 'go.mod'), 'module github.com/acme/demo\n\ngo 1.22\n', 'utf8');
    fs.mkdirSync(path.join(dir, 'coverage'), { recursive: true });

    // Legacy file 95% covered, new file pkg/calc/calc.go 0% covered -> MUST FAIL!
    fs.writeFileSync(
      path.join(dir, 'coverage/cover.out'),
      [
        'mode: set',
        'github.com/acme/demo/pkg/old/old.go:1.1,10.2 95 1',
        'github.com/acme/demo/pkg/calc/calc.go:2.24,4.2 5 0'
      ].join('\n') + '\n',
      'utf8'
    );
    const failRes = parseCoverageReport(dir, { name: 'go', path: '.', commands: { coverageFile: 'coverage/cover.out' }, thresholds: { diffCoverage: 85 } });
    assert.equal(failRes.repoLineCoverage, 95);
    assert.equal(failRes.diffLineCoverage, 0);
    assert.equal(failRes.passed, false);

    // Covered new file passes even with low repo coverage (10%)
    fs.writeFileSync(
      path.join(dir, 'coverage/cover.out'),
      [
        'mode: count',
        'github.com/acme/demo/pkg/old/old.go:1.1,10.2 90 0',
        'github.com/acme/demo/pkg/calc/calc.go:2.24,4.2 10 3'
      ].join('\n') + '\n',
      'utf8'
    );
    const passRes = parseCoverageReport(dir, { name: 'go', path: '.', commands: { coverageFile: 'coverage/cover.out' }, thresholds: { diffCoverage: 85 } });
    assert.equal(passRes.repoLineCoverage, 10);
    assert.equal(passRes.diffLineCoverage, 100);
    assert.equal(passRes.passed, true);
  });

  it('fails closed on summary-only formats (coverage-summary.json, jacoco.csv, line-less XML) when source files changed and diffCoverage is numeric', () => {
    const dir = setupBranchWithFile('src/new.mjs', 'export const x = 1;\nexport const y = 2;\n');
    fs.mkdirSync(path.join(dir, 'coverage'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'target/site/jacoco'), { recursive: true });

    fs.writeFileSync(path.join(dir, 'coverage/coverage-summary.json'), JSON.stringify({ total: { lines: { pct: 99 } } }), 'utf8');
    const jsonFail = parseCoverageReport(dir, { name: 'js', path: '.', commands: { coverageFile: 'coverage/coverage-summary.json' }, thresholds: { diffCoverage: 85 } });
    assert.equal(jsonFail.passed, false);
    assert.equal(jsonFail.summaryOnly, true);
    assert.equal(jsonFail.diffLineCoverage, null);
    assert.match(jsonFail.reason, /Summary-only coverage report/);

    // threshold: null allows summary-only report (no diff-coverage gate requested)
    const jsonNull = parseCoverageReport(dir, { name: 'js', path: '.', commands: { coverageFile: 'coverage/coverage-summary.json' }, thresholds: { diffCoverage: null } });
    assert.equal(jsonNull.passed, true);

    fs.writeFileSync(path.join(dir, 'target/site/jacoco/jacoco.csv'), 'GROUP,PACKAGE,CLASS,LINE_MISSED,LINE_COVERED\ng,p,C,1,99\n', 'utf8');
    const csvFail = parseCoverageReport(dir, { name: 'jvm', path: '.', commands: { coverageFile: 'target/site/jacoco/jacoco.csv' }, thresholds: { diffCoverage: 85 } });
    assert.equal(csvFail.passed, false);
    assert.equal(csvFail.summaryOnly, true);

    // Line-less Cobertura XML fails closed on source diff
    fs.writeFileSync(path.join(dir, 'coverage/coverage.xml'), '<coverage line-rate="0.99"></coverage>', 'utf8');
    const xmlFail = parseCoverageReport(dir, { name: 'py', path: '.', commands: { coverageFile: 'coverage/coverage.xml' }, thresholds: { diffCoverage: 85 } });
    assert.equal(xmlFail.passed, false);
    assert.equal(xmlFail.summaryOnly, true);

    // When no trackable source files changed (e.g. test-only diff), summary-only format is not blocked
    const testOnlyDir = setupBranchWithFile('tests/unit.test.mjs', 'export const ok = true;\n');
    fs.mkdirSync(path.join(testOnlyDir, 'coverage'), { recursive: true });
    fs.writeFileSync(path.join(testOnlyDir, 'coverage/coverage-summary.json'), JSON.stringify({ total: { lines: { pct: 95 } } }), 'utf8');
    const testOnlyOk = parseCoverageReport(testOnlyDir, { name: 'js', path: '.', commands: { coverageFile: 'coverage/coverage-summary.json' }, thresholds: { diffCoverage: 85 } });
    assert.equal(testOnlyOk.passed, true);
  });

  it('parseMutationReport handles Stryker ranges/exemptions, PITest subdirs, cargo-mutants, mutmut JSON/TXT, and go-mutesting', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    assert.equal(parseMutationReport(dir, { path: '.', thresholds: { mutationScore: 60 } }).found, false);

    // PITest subdir discovery + MEMORY_ERROR skip
    fs.mkdirSync(path.join(dir, 'target/pit-reports/20261126'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'target/pit-reports/20261126/mutations.xml'),
      '<mutations><mutation detected="true" status="KILLED"/><mutation detected="false" status="MEMORY_ERROR"/><mutation detected="false" status="SURVIVED"/></mutations>',
      'utf8'
    );
    const pit = parseMutationReport(dir, { path: '.', thresholds: { mutationScore: 50 } });
    assert.equal(pit.passed, true);
    assert.equal(pit.score, 50);
    fs.rmSync(path.join(dir, 'target'), { recursive: true, force: true });

    // cargo-mutants
    fs.mkdirSync(path.join(dir, 'mutants.out'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'mutants.out/outcomes.json'), JSON.stringify({ outcomes: [{ summary: 'CaughtMutant' }, { summary: 'Timeout' }, { summary: 'MissedMutant' }] }), 'utf8');
    const cargo = parseMutationReport(dir, { path: '.', thresholds: { mutationScore: 60 } });
    assert.equal(cargo.passed, true);
    assert.equal(cargo.killed, 2);
    assert.equal(cargo.survived, 1);
    fs.rmSync(path.join(dir, 'mutants.out'), { recursive: true, force: true });

    // mutmut json & txt
    fs.writeFileSync(path.join(dir, '.mutmut-results.json'), JSON.stringify({ killed: 3, timeout: 1, survived: 0 }), 'utf8');
    assert.equal(parseMutationReport(dir, { path: '.', thresholds: { mutationScore: 80 } }).score, 100);
    fs.unlinkSync(path.join(dir, '.mutmut-results.json'));

    fs.writeFileSync(path.join(dir, '.mutmut-results.txt'), 'Killed: 4\nTimeout: 0\nSurvived: 1\n', 'utf8');
    assert.equal(parseMutationReport(dir, { path: '.', thresholds: { mutationScore: 80 } }).score, 80);
    fs.unlinkSync(path.join(dir, '.mutmut-results.txt'));

    // go-mutesting
    fs.mkdirSync(path.join(dir, 'reports/mutation'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'reports/mutation/go-mutesting.txt'), 'PASS: m1\nPASS: m2\nFAIL: m3\n', 'utf8');
    assert.equal(parseMutationReport(dir, { path: '.', thresholds: { mutationScore: 60 } }).passed, true);
  });

  it('resists XML ReDoS and confines coverage/mutation report paths strictly inside repoRoot', async () => {
    const os = await import('node:os');
    const dir = setupBranchWithFile('src/new_mod.py', 'def f():\n    return 1\n');
    fs.mkdirSync(path.join(dir, 'coverage'), { recursive: true });

    // 1. Cobertura XML with 10,000 spaces inside <source> and <line> must parse linearly (< 250ms), and outside-repo <source>/etc must be rejected
    const spaces = ' '.repeat(10000);
    fs.writeFileSync(
      path.join(dir, 'coverage/coverage.xml'),
      `<coverage line-rate="0.99"><sources><source>${spaces}</source><source>/etc</source></sources><packages><package name="p"><classes><class filename="passwd"><lines><line number="1" hits="9" ${spaces}/></lines></class></classes></package></packages></coverage>`,
      'utf8'
    );
    const t0 = Date.now();
    const res = parseCoverageReport(dir, { name: 'py', path: '.', commands: { coverageFile: 'coverage/coverage.xml' }, thresholds: { diffCoverage: 85 } });
    assert.ok(Date.now() - t0 < 500, 'XML parsing must not exhibit quadratic/cubic ReDoS backtracking');
    assert.equal(res.passed, false);
    assert.equal(res.diffLineCoverage, 0);

    // 2. Symlinked mutation report pointing outside repoRoot fails closed (found: false)
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sealit-outside-mut-'));
    cleanups.push(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
    const outsideMut = path.join(outsideDir, 'mutation.json');
    fs.writeFileSync(outsideMut, JSON.stringify({ files: { 'src/new_mod.py': { mutants: [{ id: '1', status: 'Killed', mutatorName: 'X', replacement: 'Y', location: { start: { line: 1, column: 0 } } }] } } }), 'utf8');
    fs.mkdirSync(path.join(dir, 'reports/mutation'), { recursive: true });
    fs.symlinkSync(outsideMut, path.join(dir, 'reports/mutation/mutation.json'));
    const mutRes = parseMutationReport(dir, { path: '.', thresholds: { mutationScore: 50 } });
    assert.equal(mutRes.found, false);
    assert.equal(mutRes.passed, false);
  });
});
