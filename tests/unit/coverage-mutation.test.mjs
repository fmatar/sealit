import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  buildSingleTestArgv,
  buildSingleTestCommand,
  parseCoverageReport,
  parseMutationReport,
  runFlakeCheck,
  suggestMutationStrengthening
} from '../../.agent/scripts/lib/coverage-mutation.mjs';
import { cleanGitEnv, parseCommandArgv } from '../../.agent/scripts/lib/core.mjs';
import { recordExemption } from '../../.agent/scripts/lib/session.mjs';

const gitSync = (args, opts) => execFileSync('git', args, { stdio: 'pipe', env: cleanGitEnv(), ...opts });

describe('Unit: coverage-mutation.mjs', () => {
  let tmpDir;
  let gitDir;

  before(() => {
    gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-unit-cov-git-'));
    gitSync(['init', '-b', 'develop'], { cwd: gitDir });
    gitSync(['config', 'user.email', 'test@example.com'], { cwd: gitDir });
    gitSync(['config', 'user.name', 'Test'], { cwd: gitDir });
    fs.mkdirSync(path.join(gitDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'src/math.js'), 'export function add(a, b) {\n  return a + b;\n}\n', 'utf8');
    gitSync(['add', '.'], { cwd: gitDir });
    gitSync(['commit', '-m', 'init'], { cwd: gitDir });
    gitSync(['checkout', '-b', 'feature/issue-#31'], { cwd: gitDir });
    fs.writeFileSync(
      path.join(gitDir, 'src/math.js'),
      'export function add(a, b) {\n  return a + b;\n}\nexport function sub(a, b) {\n  return a - b;\n}\n',
      'utf8'
    );
  });

  after(() => {
    fs.rmSync(gitDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-unit-cov-'));
    fs.mkdirSync(path.join(tmpDir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.agent/sdlc-config.json'),
      JSON.stringify({ gates: { minDiffCoverage: 85, minMutationScore: 60 } }),
      'utf8'
    );
  });

  it('constructs stack-aware single test argv & command strings across all languages', () => {
    try {
      assert.deepEqual(buildSingleTestArgv('tests/a.test.mjs', tmpDir), { file: process.execPath, args: ['--test', 'tests/a.test.mjs'] });
      assert.match(buildSingleTestCommand('tests/a.test.mjs', tmpDir), /^node --test "tests\/a\.test\.mjs"$/);
      assert.deepEqual(buildSingleTestArgv('src/test/AppTest.java', tmpDir).args, ['test', '-Dtest=AppTest']);
      assert.deepEqual(buildSingleTestArgv('pkg/service_test.go', tmpDir).file, 'go');
      assert.deepEqual(buildSingleTestArgv('tests/test_app.py', tmpDir).args, ['tests/test_app.py']);
      assert.deepEqual(buildSingleTestArgv('tests/parser_test.rs', tmpDir).args, ['test', '--test', 'parser_test']);

      fs.writeFileSync(path.join(tmpDir, 'build.gradle'), 'plugins { id "java" }\n', 'utf8');
      assert.deepEqual(buildSingleTestArgv('src/test/SpecTest.java', tmpDir), { file: './gradlew', args: ['test', '--tests', 'SpecTest'] });
      assert.equal(buildSingleTestCommand('src/test/SpecTest.java', tmpDir), './gradlew test --tests "SpecTest"');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('parses coverage-summary JSON, JaCoCo CSV, XML, Go coverprofile, DA-only LCOV, and fails closed when missing', () => {
    try {
      const missing = parseCoverageReport(tmpDir);
      assert.equal(missing.found, false);
      assert.equal(missing.passed, false);
      assert.equal(missing.threshold, 85);

      // coverage-summary.json boundary 85 vs 84.99
      fs.mkdirSync(path.join(tmpDir, 'coverage'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'coverage/coverage-summary.json'),
        JSON.stringify({ total: { lines: { pct: 84.99 }, branches: { pct: 70 } } }),
        'utf8'
      );
      const jsonFail = parseCoverageReport(tmpDir);
      assert.equal(jsonFail.found, true);
      assert.equal(jsonFail.passed, false);
      assert.equal(jsonFail.lineCoverage, 84.99);
      assert.equal(jsonFail.branchCoverage, 70);

      fs.writeFileSync(
        path.join(tmpDir, 'coverage/coverage-summary.json'),
        JSON.stringify({ total: { lines: { pct: 85 } } }),
        'utf8'
      );
      assert.equal(parseCoverageReport(tmpDir).passed, true);
      fs.rmSync(path.join(tmpDir, 'coverage/coverage-summary.json'));

      // LCOV DA-only fallback (no LF/LH lines)
      fs.writeFileSync(
        path.join(tmpDir, 'coverage/lcov.info'),
        'SF:src/a.js\nDA:1,1\nDA:2,1\nDA:3,1\nDA:4,0\nDA:5,1\nend_of_record\n',
        'utf8'
      );
      const lcov = parseCoverageReport(tmpDir);
      assert.equal(lcov.found, true);
      assert.equal(lcov.lineCoverage, 80);
      assert.equal(lcov.passed, false);
      fs.rmSync(path.join(tmpDir, 'coverage/lcov.info'));

      // JaCoCo CSV
      fs.mkdirSync(path.join(tmpDir, 'target/site/jacoco'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'target/site/jacoco/jacoco.csv'),
        'GROUP,PACKAGE,CLASS,LINE_MISSED,LINE_COVERED\ng,p,C,1,9\n',
        'utf8'
      );
      const csv = parseCoverageReport(tmpDir);
      assert.equal(csv.lineCoverage, 90);
      assert.equal(csv.passed, true);
      fs.rmSync(path.join(tmpDir, 'target'), { recursive: true, force: true });

      // Cobertura XML
      fs.writeFileSync(path.join(tmpDir, 'coverage.xml'), '<coverage line-rate="0.86" branch-rate="0.5"></coverage>', 'utf8');
      const xml = parseCoverageReport(tmpDir);
      assert.equal(xml.lineCoverage, 86);
      assert.equal(xml.passed, true);
      fs.rmSync(path.join(tmpDir, 'coverage.xml'));

      // Go coverage.out
      fs.writeFileSync(
        path.join(tmpDir, 'coverage.out'),
        'mode: set\npkg/a.go:1.1,2.2 3 1\npkg/a.go:3.1,4.2 1 0\n',
        'utf8'
      );
      const goCov = parseCoverageReport(tmpDir);
      assert.equal(goCov.lineCoverage, 75);
      assert.equal(goCov.passed, false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('computes LCOV diff-line intersection when git modified lines are uncovered despite high repo-wide coverage', () => {
    fs.mkdirSync(path.join(gitDir, '.agent'), { recursive: true });
    fs.writeFileSync(path.join(gitDir, '.agent/sdlc-config.json'), JSON.stringify({ gates: { minDiffCoverage: 85 } }), 'utf8');
    fs.mkdirSync(path.join(gitDir, 'coverage'), { recursive: true });
    // Lines 1-3 covered (100% of old code), newly added lines 4-6 uncovered!
    fs.writeFileSync(
      path.join(gitDir, 'coverage/lcov.info'),
      'SF:src/math.js\nDA:1,2\nDA:2,2\nDA:3,2\nDA:4,0\nDA:5,0\nDA:6,0\nLF:6\nLH:3\nend_of_record\n',
      'utf8'
    );
    const diffRes = parseCoverageReport(gitDir);
    assert.equal(diffRes.found, true);
    assert.equal(diffRes.diffApplicable, true);
    assert.equal(diffRes.diffLineCoverage, 0);
    assert.equal(diffRes.repoLineCoverage, 50);
    assert.equal(diffRes.passed, false);
    assert.match(diffRes.reason, /Diff line coverage 0\.0%/);
  });

  it('parses Stryker, PITest, Cargo Mutants, mutmut, go-mutesting reports, exemptions, and fail-closed diagnostics', () => {
    try {
      const missing = parseMutationReport(tmpDir);
      assert.equal(missing.found, false);
      assert.equal(missing.diagnostics.status, 'MISSING_REPORT');
      assert.ok(missing.diagnostics.searchedPaths.length >= 6);

      // Stryker with Ignored + Exempted + Survived + Timeout + Killed
      fs.mkdirSync(path.join(tmpDir, 'reports/mutation'), { recursive: true });
      recordExemption({ mutantId: 'mut-ex', file: 'src/a.js', reason: 'benign', repoRoot: tmpDir });
      fs.writeFileSync(
        path.join(tmpDir, 'reports/mutation/mutation.json'),
        JSON.stringify({
          files: {
            'src/a.js': {
              mutants: [
                { id: '1', mutatorName: 'Math', status: 'Killed', location: { start: { line: 10 } } },
                { id: '2', mutatorName: 'Math', status: 'Timeout', location: { start: { line: 11 } } },
                { id: 'mut-ex', mutatorName: 'Block', status: 'Survived', location: { start: { line: 12 } } },
                { id: '4', mutatorName: 'Math', status: 'Ignored', location: { start: { line: 13 } } },
                { id: '5', mutatorName: 'Math', status: 'NoCoverage', location: { start: { line: 14 } } }
              ]
            }
          }
        }),
        'utf8'
      );
      const stryker = parseMutationReport(tmpDir);
      assert.equal(stryker.found, true);
      assert.equal(stryker.tool, 'stryker');
      assert.equal(stryker.exemptedCount, 1);
      // 3 evaluable after exemption & Ignored (id 1 killed, 2 timeout, 5 noCoverage) => 2/3 = 66.67%
      assert.equal(stryker.killed, 2);
      assert.equal(stryker.total, 3);
      assert.equal(stryker.passed, true);
      assert.equal(stryker.diagnostics.status, 'OK');

      // Stryker empty mutants -> EMPTY_REPORT fail-closed
      fs.writeFileSync(path.join(tmpDir, 'reports/mutation/mutation.json'), JSON.stringify({ files: {} }), 'utf8');
      const emptyStryker = parseMutationReport(tmpDir);
      assert.equal(emptyStryker.found, false);
      assert.equal(emptyStryker.diagnostics.status, 'EMPTY_REPORT');
      fs.rmSync(path.join(tmpDir, 'reports/mutation/mutation.json'));

      // PITest XML
      fs.mkdirSync(path.join(tmpDir, 'target/pit-reports'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'target/pit-reports/mutations.xml'),
        `<mutations>
          <mutation detected='true' status='KILLED'><sourceFile>A.java</sourceFile><lineNumber>1</lineNumber><mutator>M</mutator></mutation>
          <mutation detected='true' status='TIMED_OUT'><sourceFile>A.java</sourceFile><lineNumber>2</lineNumber><mutator>M</mutator></mutation>
          <mutation detected='false' status='SURVIVED'><sourceFile>A.java</sourceFile><lineNumber>3</lineNumber><mutator>M</mutator></mutation>
        </mutations>`,
        'utf8'
      );
      const pitest = parseMutationReport(tmpDir);
      assert.equal(pitest.tool, 'pitest');
      assert.equal(pitest.killed, 2);
      assert.equal(pitest.total, 3);
      assert.equal(pitest.passed, true);
      fs.rmSync(path.join(tmpDir, 'target'), { recursive: true, force: true });

      // Cargo mutants outcomes array + counters
      fs.mkdirSync(path.join(tmpDir, 'mutants.out'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'mutants.out/outcomes.json'),
        JSON.stringify({
          outcomes: [
            { summary: 'CaughtMutant', scenario: { Mutant: { file: 'src/lib.rs', line: 5 } } },
            { summary: 'MissedMutant', scenario: { Mutant: { file: 'src/lib.rs', line: 6 } } },
            { summary: 'Unviable', scenario: { Mutant: { file: 'src/lib.rs', line: 7 } } }
          ]
        }),
        'utf8'
      );
      const cargo = parseMutationReport(tmpDir);
      assert.equal(cargo.tool, 'cargo-mutants');
      assert.equal(cargo.killed, 1);
      assert.equal(cargo.total, 2);
      assert.equal(cargo.passed, false);
      fs.rmSync(path.join(tmpDir, 'mutants.out'), { recursive: true, force: true });

      // mutmut JSON & text
      fs.writeFileSync(path.join(tmpDir, 'mutmut.json'), JSON.stringify({ killed: 3, survived: 2, timeout: 0, suspicious: 0 }), 'utf8');
      const mutJson = parseMutationReport(tmpDir);
      assert.equal(mutJson.tool, 'mutmut');
      assert.equal(mutJson.mutationScore, 60);
      assert.equal(mutJson.passed, true);
      fs.rmSync(path.join(tmpDir, 'mutmut.json'));

      fs.writeFileSync(path.join(tmpDir, 'mutmut-results.txt'), 'Killed: 4\nSurvived: 1\nTimeout: 1\nSuspicious: 0\n', 'utf8');
      const mutTxt = parseMutationReport(tmpDir);
      assert.equal(mutTxt.tool, 'mutmut');
      assert.equal(mutTxt.killed, 5);
      assert.equal(mutTxt.total, 6);
      fs.rmSync(path.join(tmpDir, 'mutmut-results.txt'));

      // go-mutesting JSON & text
      fs.writeFileSync(path.join(tmpDir, 'go-mutesting.json'), JSON.stringify({ passed: 3, failed: 1 }), 'utf8');
      const goJson = parseMutationReport(tmpDir);
      assert.equal(goJson.tool, 'go-mutesting');
      assert.equal(goJson.mutationScore, 75);
      fs.rmSync(path.join(tmpDir, 'go-mutesting.json'));

      fs.writeFileSync(
        path.join(tmpDir, 'go-mutesting.txt'),
        'PASS "pkg/a.go:1:1"\nPASS "pkg/a.go:2:1"\nFAIL "pkg/a.go:3:1"\n',
        'utf8'
      );
      const goMut = parseMutationReport(tmpDir);
      assert.equal(goMut.tool, 'go-mutesting');
      assert.equal(goMut.killed, 2);
      assert.equal(goMut.total, 3);
      assert.equal(goMut.passed, true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('runs flake check on passing/failing targets and generates targeted strengthening advice', () => {
    try {
      const skipped = runFlakeCheck({ repoRoot: tmpDir });
      assert.equal(skipped.passed, true);
      assert.match(skipped.message, /skipped/i);

      fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'tests/ok.test.mjs'),
        `import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('ok', () => assert.equal(1, 1));\n`,
        'utf8'
      );
      const ok = runFlakeCheck({ runs: 1, target: 'tests/ok.test.mjs', repoRoot: tmpDir });
      assert.equal(ok.passed, true);
      assert.equal(ok.results[0].iterations, 2);
      assert.equal(ok.results[0].passed, 2);

      fs.writeFileSync(
        path.join(tmpDir, 'tests/fail.test.mjs'),
        `import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('fail', () => assert.equal(1, 2));\n`,
        'utf8'
      );
      const bad = runFlakeCheck({ runs: 2, target: 'tests/fail.test.mjs', repoRoot: tmpDir });
      assert.equal(bad.passed, false);
      assert.equal(bad.failedTestFiles, 1);

      const b = suggestMutationStrengthening({ mutantType: 'ConditionalsBoundary', file: 'a.mjs', line: 10 });
      assert.match(b.recommendation, /threshold - 1/);
      assert.match(b.sampleAssert, /calculate\(10\)/);
      assert.match(suggestMutationStrengthening({ mutantType: 'NegateCondition' }).recommendation, /true and false/i);
      assert.match(suggestMutationStrengthening({ mutantType: 'Math' }).recommendation, /non-zero/i);
      assert.match(suggestMutationStrengthening({ mutantType: 'VoidMethodCall' }).recommendation, /observable state/i);
      assert.match(suggestMutationStrengthening({ mutantType: 'EmptyReturn' }).recommendation, /non-empty/i);
      assert.match(suggestMutationStrengthening({ mutantType: 'Unknown' }).recommendation, /assertion density/i);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('parses polyglot edge formats, exemptions by file:line & mutator, LCOV BRDA, and corrupt/empty errors', () => {
    try {
      // LCOV with BRDA branch records on modified lines 4-6 in gitDir computes diffBranchCoverage
      fs.mkdirSync(path.join(gitDir, 'coverage'), { recursive: true });
      fs.writeFileSync(
        path.join(gitDir, 'coverage/lcov.info'),
        'SF:src/math.js\nDA:1,1\nDA:2,1\nDA:4,1\nDA:5,1\nDA:6,0\nBRDA:4,0,0,1\nBRDA:5,0,1,0\nBRDA:6,0,0,-\nLF:5\nLH:4\nend_of_record\n',
        'utf8'
      );
      const lcovBrda = parseCoverageReport(gitDir);
      assert.equal(lcovBrda.diffApplicable, true);
      assert.equal(lcovBrda.branchCoverage, 33.33);
      assert.equal(lcovBrda.diffLineCoverage, 66.67);

      // Corrupt & missing coverage-summary.json
      fs.mkdirSync(path.join(tmpDir, 'coverage'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'coverage/coverage-summary.json'), '{bad-json', 'utf8');
      assert.equal(parseCoverageReport(tmpDir).found, false);
      fs.writeFileSync(path.join(tmpDir, 'coverage/coverage-summary.json'), JSON.stringify({ total: {} }), 'utf8');
      assert.equal(parseCoverageReport(tmpDir).found, false);
      fs.rmSync(path.join(tmpDir, 'coverage'), { recursive: true, force: true });

      // Sub-module path + Stryker corrupt/explicitScore
      fs.mkdirSync(path.join(tmpDir, 'sub/reports/mutation'), { recursive: true });
      const mod = { path: 'sub', thresholds: { diffCoverage: 80, mutationScore: 60 } };
      fs.writeFileSync(path.join(tmpDir, 'sub/reports/mutation/mutation.json'), '{corrupt', 'utf8');
      assert.equal(parseMutationReport(tmpDir, mod).diagnostics.status, 'UNSUPPORTED_OR_CORRUPT_REPORT');
      fs.writeFileSync(path.join(tmpDir, 'sub/reports/mutation/mutation.json'), JSON.stringify({ foo: 1 }), 'utf8');
      assert.equal(parseMutationReport(tmpDir, mod).diagnostics.status, 'UNSUPPORTED_OR_CORRUPT_REPORT');
      fs.writeFileSync(path.join(tmpDir, 'sub/reports/mutation/mutation.json'), JSON.stringify({ files: {}, mutationScore: 72.5 }), 'utf8');
      const expStryker = parseMutationReport(tmpDir, mod);
      assert.equal(expStryker.found, true);
      assert.equal(expStryker.mutationScore, 72.5);
      fs.rmSync(path.join(tmpDir, 'sub'), { recursive: true, force: true });

      // PITest empty & corrupt XML + self-closing attr variant
      fs.mkdirSync(path.join(tmpDir, 'target/pit-reports'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'target/pit-reports/mutations.xml'), '<mutations></mutations>', 'utf8');
      assert.equal(parseMutationReport(tmpDir).diagnostics.status, 'EMPTY_REPORT');
      fs.writeFileSync(path.join(tmpDir, 'target/pit-reports/mutations.xml'), 'not xml', 'utf8');
      assert.equal(parseMutationReport(tmpDir).diagnostics.status, 'UNSUPPORTED_OR_CORRUPT_REPORT');
      fs.writeFileSync(path.join(tmpDir, 'target/pit-reports/mutations.xml'), `<mutations><mutation detected='true'/><mutation detected='false'/></mutations>`, 'utf8');
      const selfClose = parseMutationReport(tmpDir);
      assert.equal(selfClose.killed, 1);
      assert.equal(selfClose.total, 2);
      fs.rmSync(path.join(tmpDir, 'target'), { recursive: true, force: true });

      // Cargo Mutants counter-only, empty, corrupt
      fs.mkdirSync(path.join(tmpDir, 'mutants.out'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'mutants.out/outcomes.json'), '{bad', 'utf8');
      assert.equal(parseMutationReport(tmpDir).diagnostics.status, 'UNSUPPORTED_OR_CORRUPT_REPORT');
      fs.writeFileSync(path.join(tmpDir, 'mutants.out/outcomes.json'), JSON.stringify({ outcomes: [] }), 'utf8');
      assert.equal(parseMutationReport(tmpDir).diagnostics.status, 'EMPTY_REPORT');
      fs.writeFileSync(path.join(tmpDir, 'mutants.out/outcomes.json'), JSON.stringify({ caught: 4, missed: 1, timeout: 1 }), 'utf8');
      const cargoCounts = parseMutationReport(tmpDir);
      assert.equal(cargoCounts.killed, 5);
      assert.equal(cargoCounts.total, 6);
      fs.rmSync(path.join(tmpDir, 'mutants.out'), { recursive: true, force: true });

      // Mutmut JSON array with file:line & mutator exemptions + emoji/range text + corrupt/empty
      recordExemption({ mutantId: 'a.py:6', file: 'a.py', reason: 'line exempt', repoRoot: tmpDir });
      recordExemption({ mutantId: 'Num', file: 'a.py', reason: 'mutator exempt', repoRoot: tmpDir });
      fs.writeFileSync(
        path.join(tmpDir, 'mutmut.json'),
        JSON.stringify([
          { id: 1, status: 'killed', file: 'a.py', line: 5 },
          { id: 2, status: 'survived', file: 'a.py', line: 6 },
          { id: 3, status: 'skipped', file: 'a.py', line: 7 },
          { id: 4, status: 'suspicious', file: 'a.py', mutator: 'Num', line: 8 },
          { id: 5, status: 'survived', file: 'a.py', line: 9 }
        ]),
        'utf8'
      );
      const mutArr = parseMutationReport(tmpDir);
      assert.equal(mutArr.tool, 'mutmut');
      assert.equal(mutArr.exemptedCount, 2);
      assert.equal(mutArr.killed, 1);
      assert.equal(mutArr.total, 2);
      fs.rmSync(path.join(tmpDir, 'mutmut.json'));

      fs.mkdirSync(path.join(tmpDir, 'reports/mutation'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'reports/mutation/mutmut-results.txt'), '🎉 1-3, 5\n🙁 6, 8-9\n🤔 10\n⏰ 11\n', 'utf8');
      const mutEmoji = parseMutationReport(tmpDir);
      assert.equal(mutEmoji.killed, 5);
      assert.equal(mutEmoji.total, 9);
      fs.writeFileSync(path.join(tmpDir, 'reports/mutation/mutmut-results.txt'), '', 'utf8');
      assert.equal(parseMutationReport(tmpDir).diagnostics.status, 'EMPTY_REPORT');
      fs.writeFileSync(path.join(tmpDir, 'reports/mutation/mutmut-results.txt'), 'unrecognized output', 'utf8');
      assert.equal(parseMutationReport(tmpDir).diagnostics.status, 'UNSUPPORTED_OR_CORRUPT_REPORT');
      fs.rmSync(path.join(tmpDir, 'reports/mutation/mutmut-results.txt'));

      // Go-mutesting JSON mutants array & SKIP/DUPLICATED + text SKIP + corrupt
      fs.writeFileSync(
        path.join(tmpDir, 'go-mutesting.json'),
        JSON.stringify({ mutants: [{ status: 'PASS', file: 'g.go', line: 1 }, { status: 'FAIL', file: 'g.go', line: 2 }, { status: 'SKIP' }, { status: 'DUPLICATED' }] }),
        'utf8'
      );
      const goArr = parseMutationReport(tmpDir);
      assert.equal(goArr.killed, 1);
      assert.equal(goArr.total, 2);
      fs.rmSync(path.join(tmpDir, 'go-mutesting.json'));

      fs.writeFileSync(path.join(tmpDir, 'go-mutesting.txt'), 'SKIP "g.go:1:1"\nPASS "g.go:2:1"\nFAIL "g.go:3:1"\n', 'utf8');
      const goSkip = parseMutationReport(tmpDir);
      assert.equal(goSkip.killed, 1);
      assert.equal(goSkip.total, 2);
      fs.writeFileSync(path.join(tmpDir, 'go-mutesting.txt'), 'nonsense', 'utf8');
      assert.equal(parseMutationReport(tmpDir).diagnostics.status, 'UNSUPPORTED_OR_CORRUPT_REPORT');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

import * as cmOpt from '../../.agent/scripts/lib/coverage-mutation.mjs';

describe('coverage-mutation diff/hunk scoping optimization', () => {
  it('extractChangedHunkRanges parses hunks, zero-count deletions, coalesces close hunks, and handles synthesized untracked diffs', () => {
    assert.deepEqual(cmOpt.extractChangedHunkRanges(''), []);
    assert.deepEqual(cmOpt.extractChangedHunkRanges('Binary files a/x.png and b/x.png differ\n'), []);

    const multiHunk = [
      'diff --git a/src/a.mjs b/src/a.mjs',
      '--- a/src/a.mjs',
      '+++ b/src/a.mjs',
      '@@ -10,2 +10,2 @@ function a() {',
      '+const x = 1;',
      '@@ -14,2 +14,3 @@',
      '+const y = 2;',
      '@@ -50 +50 @@',
      '+const z = 3;',
      '@@ -70,3 +69,0 @@',
      '-removed()'
    ].join('\n');
    assert.deepEqual(cmOpt.extractChangedHunkRanges(multiHunk, { maxGapLines: 5 }), [
      { start: 10, end: 16 },
      { start: 50, end: 50 },
      { start: 69, end: 69 }
    ]);

    assert.deepEqual(cmOpt.extractChangedHunkRanges('@@ -1,2 +0,0 @@\n-allGone\n'), [
      { start: 1, end: 1 }
    ]);

    const untrackedDiff = '+++ b/src/new.mjs\n+export const a = 1;\n+export const b = 2;\n+export const c = 3;\n';
    assert.deepEqual(cmOpt.extractChangedHunkRanges(untrackedDiff), [{ start: 1, end: 3 }]);
  });

  it('buildMutationExecutionPlan skips docs/config-only diffs, scopes Stryker to changed hunks & paired tests, and honors --full', () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cm-plan-stryker-'));
    try {
      fs.mkdirSync(path.join(tmpDir, '.agent/scripts/lib'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'tests/unit'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.agent/scripts/lib/core.mjs'), 'export const a = 1;\n');
      fs.writeFileSync(path.join(tmpDir, '.agent/scripts/lib/session.mjs'), 'export const s = 2;\n');
      fs.writeFileSync(path.join(tmpDir, 'tests/unit/session.test.mjs'), "import '../.agent/scripts/lib/session.mjs';\n");
      fs.writeFileSync(
        path.join(tmpDir, 'stryker.config.json'),
        JSON.stringify({
          mutate: ['.agent/scripts/lib/core.mjs', '.agent/scripts/lib/session.mjs']
        })
      );

      const mod = {
        name: 'root',
        path: '.',
        commands: { mutation: 'npx stryker run' }
      };

      const docsPlan = cmOpt.buildMutationExecutionPlan({
        repoRoot: tmpDir,
        mod,
        modifiedFiles: ['README.md', 'docs/guide.md', '.agent/skills/sdlc/SKILL.md', 'stryker.config.json'],
        diffByFile: new Map()
      });
      assert.equal(docsPlan.skip, true);
      assert.equal(docsPlan.reason, 'diff-no-mutated-sources');
      assert.equal(docsPlan.command, null);

      const fullOverride = cmOpt.buildMutationExecutionPlan({
        repoRoot: tmpDir,
        mod,
        modifiedFiles: ['README.md'],
        diffByFile: new Map(),
        full: true
      });
      assert.equal(fullOverride.skip, false);
      assert.equal(fullOverride.diffScoped, false);
      assert.equal(fullOverride.reason, 'full-mode');
      assert.equal(fullOverride.command, 'npx stryker run');

      const sourceDiff = new Map([
        ['.agent/scripts/lib/core.mjs', '@@ -10,2 +10,11 @@\n+const x = 1;\n'],
        ['.agent/scripts/lib/session.mjs', '@@ -5,1 +5,4 @@\n+const y = 2;\n']
      ]);
      const hunkPlan = cmOpt.buildMutationExecutionPlan({
        repoRoot: tmpDir,
        mod,
        modifiedFiles: ['.agent/scripts/lib/core.mjs', '.agent/scripts/lib/session.mjs', 'README.md'],
        diffByFile: sourceDiff
      });
      assert.equal(hunkPlan.skip, false);
      assert.equal(hunkPlan.diffScoped, true);
      assert.equal(hunkPlan.tool, 'stryker');
      assert.match(hunkPlan.command, /-m \.agent\/scripts\/lib\/core\.mjs:10-20,\.agent\/scripts\/lib\/session\.mjs:5-8\b/);
      assert.match(hunkPlan.command, /--incrementalFile reports\/stryker-diff-incremental\.json/);
      assert.doesNotMatch(hunkPlan.command, /--force\b/);
      assert.match(hunkPlan.command, /--allowEmpty\b/);

      const noCachePlan = cmOpt.buildMutationExecutionPlan({
        repoRoot: tmpDir,
        mod,
        modifiedFiles: ['.agent/scripts/lib/core.mjs'],
        diffByFile: sourceDiff,
        noCache: true
      });
      assert.match(noCachePlan.command, /--force\b/);

      const testOnlyPlan = cmOpt.buildMutationExecutionPlan({
        repoRoot: tmpDir,
        mod,
        modifiedFiles: ['tests/unit/session.test.mjs'],
        diffByFile: new Map([['tests/unit/session.test.mjs', '@@ -1,1 +1,2 @@\n+assert.ok(1);\n']])
      });
      assert.equal(testOnlyPlan.skip, false);
      assert.equal(testOnlyPlan.diffScoped, true);
      assert.ok(testOnlyPlan.targets.includes('.agent/scripts/lib/session.mjs'));
      assert.match(testOnlyPlan.command, /-m \.agent\/scripts\/lib\/session\.mjs(?:\s|$)/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('buildMutationExecutionPlan handles polyglot tools (Rust, Go, Python) and preserves custom wrappers', () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cm-plan-poly-'));
    try {
      const rustPlan = cmOpt.buildMutationExecutionPlan({
        repoRoot: tmpDir,
        mod: { name: 'rust', path: '.', commands: { mutation: 'cargo mutants --no-shuffle' } },
        modifiedFiles: ['src/lib.rs'],
        diffByFile: new Map([['src/lib.rs', 'diff --git a/src/lib.rs b/src/lib.rs\n@@ -1,1 +1,2 @@\n+pub fn x() {}\n']])
      });
      assert.equal(rustPlan.skip, false);
      assert.equal(rustPlan.diffScoped, true);
      assert.equal(rustPlan.tool, 'cargo-mutants');
      assert.match(rustPlan.command, /^cargo mutants --no-shuffle --in-diff /);

      const goPlan = cmOpt.buildMutationExecutionPlan({
        repoRoot: tmpDir,
        mod: { name: 'go', path: '.', commands: { mutation: 'go-mutesting ./...' } },
        modifiedFiles: ['pkg/auth/token.go', 'pkg/billing/fee_test.go'],
        diffByFile: new Map()
      });
      assert.equal(goPlan.skip, false);
      assert.equal(goPlan.diffScoped, true);
      assert.equal(goPlan.tool, 'go-mutesting');
      assert.equal(goPlan.command, 'go-mutesting ./pkg/auth ./pkg/billing');

      const pyPlan = cmOpt.buildMutationExecutionPlan({
        repoRoot: tmpDir,
        mod: { name: 'py', path: '.', commands: { mutation: 'mutmut run' } },
        modifiedFiles: ['app/service.py'],
        diffByFile: new Map()
      });
      assert.equal(pyPlan.skip, false);
      assert.equal(pyPlan.diffScoped, true);
      assert.equal(pyPlan.tool, 'mutmut');
      assert.equal(pyPlan.command, 'mutmut run --paths-to-mutate app/service.py');

      const customPlan = cmOpt.buildMutationExecutionPlan({
        repoRoot: tmpDir,
        mod: { name: 'custom', path: '.', commands: { mutation: 'npm run custom-script' } },
        modifiedFiles: ['src/index.mjs'],
        diffByFile: new Map()
      });
      assert.equal(customPlan.skip, false);
      assert.equal(customPlan.diffScoped, false);
      assert.equal(customPlan.reason, 'custom-command-unscoped');
      assert.equal(customPlan.command, 'npm run custom-script');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('tryParseStrykerReport flags zeroMutants while keeping unscoped parseMutationReport fail-closed', () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cm-empty-stryker-'));
    try {
      fs.mkdirSync(path.join(tmpDir, 'reports/mutation'), { recursive: true });
      const reportPath = path.join(tmpDir, 'reports/mutation/mutation.json');
      fs.writeFileSync(
        reportPath,
        JSON.stringify({
          schemaVersion: '1',
          files: {
            'src/comment.mjs': { source: '// just a comment\n', language: 'javascript', mutants: [] }
          }
        })
      );
      const raw = cmOpt.tryParseStrykerReport(
        tmpDir,
        'reports/mutation/mutation.json',
        [],
        52,
        ['reports/mutation/mutation.json']
      );
      assert.equal(raw.ok, false);
      assert.equal(raw.error.errorType, 'EMPTY_REPORT');
      assert.equal(raw.error.zeroMutants, true);

      const parsed = parseMutationReport(tmpDir);
      assert.equal(parsed.found, false);
      assert.equal(parsed.passed, false);
      assert.equal(parsed.diagnostics.errors[0].zeroMutants, true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('runFlakeCheckParallel executes iterations concurrently and flags failing or flaky runs accurately', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cm-flake-parallel-'));
    try {
      fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'flake-parallel-tmp', type: 'module' })
      );
      fs.writeFileSync(
        path.join(tmpDir, 'tests/pass.test.mjs'),
        "import test from 'node:test'; import assert from 'node:assert/strict'; test('ok', () => assert.equal(1, 1));\n"
      );
      fs.writeFileSync(
        path.join(tmpDir, 'tests/fail.test.mjs'),
        "import test from 'node:test'; import assert from 'node:assert/strict'; test('bad', () => assert.equal(1, 2));\n"
      );

      const emptyRes = await cmOpt.runFlakeCheckParallel({ runs: 3, repoRoot: tmpDir });
      assert.equal(emptyRes.passed, true);
      assert.equal(emptyRes.flaky, false);

      const okRes = await cmOpt.runFlakeCheckParallel({
        runs: 4,
        target: 'tests/pass.test.mjs',
        repoRoot: tmpDir,
        concurrency: 2
      });
      assert.equal(okRes.passed, true);
      assert.equal(okRes.flaky, false);
      assert.equal(okRes.results[0].iterations, 4);
      assert.equal(okRes.results[0].passed, 4);
      assert.equal(okRes.results[0].failed, 0);

      const failRes = await cmOpt.runFlakeCheckParallel({
        runs: 2,
        target: 'tests/fail.test.mjs',
        repoRoot: tmpDir,
        concurrency: 2
      });
      assert.equal(failRes.passed, false);
      assert.equal(failRes.flaky, false);
      assert.equal(failRes.failedTestFiles, 1);
      assert.equal(failRes.results[0].failed, 2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('buildSingleTestArgv rejects leading-dash option smuggling and repo-root escapes while preserving valid argv', () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cm-argv-guard-'));
    try {
      assert.throws(() => cmOpt.buildSingleTestArgv('-e process.exit(0)', tmpDir), /option|invalid|dash|outside/i);
      assert.throws(() => cmOpt.buildSingleTestArgv('tests/-rf.test.mjs', tmpDir), /option|invalid|dash/i);
      assert.throws(() => cmOpt.buildSingleTestArgv('../outside.test.mjs', tmpDir), /outside repository root/i);
      const okNode = cmOpt.buildSingleTestArgv('tests/sample.test.mjs', tmpDir);
      assert.equal(okNode.file, process.execPath);
      assert.deepEqual(okNode.args, ['--test', 'tests/sample.test.mjs']);
      const okPy = cmOpt.buildSingleTestArgv('tests/test_sample.py', tmpDir);
      assert.equal(okPy.file, 'pytest');
      assert.deepEqual(okPy.args, ['tests/test_sample.py']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('buildMutationExecutionPlan emits lossless commandArgv tokens even with backslashes and spaces', () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cm-argv-plan-'));
    try {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src/a.mjs'), 'export const x = 1;\n');
      fs.writeFileSync(path.join(tmpDir, 'stryker.config.json'), JSON.stringify({ mutate: ['src/**/*.mjs'] }));
      const mod = { name: 'root', path: '.', commands: { mutation: '"./my dir\\\\sub/stryker" run' } };
      const plan = cmOpt.buildMutationExecutionPlan({
        repoRoot: tmpDir,
        mod,
        modifiedFiles: ['src/a.mjs'],
        diffByFile: new Map()
      });
      assert.equal(plan.diffScoped, true);
      assert.ok(Array.isArray(plan.commandArgv));
      assert.equal(plan.commandArgv[0], './my dir\\sub/stryker');
      assert.ok(plan.commandArgv.includes('-m'));
      assert.equal(parseCommandArgv(plan.command).file, './my dir\\sub/stryker');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('runFlakeCheck and runFlakeCheckParallel do not deadlock on >256KB test stdout and clamp bad concurrency', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cm-flake-pipe-'));
    try {
      fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'flake-pipe-tmp', type: 'module' }));
      fs.writeFileSync(
        path.join(tmpDir, 'tests/noisy.test.mjs'),
        "import test from 'node:test'; import assert from 'node:assert/strict'; test('noisy', () => { process.stdout.write('x'.repeat(256 * 1024)); process.stderr.write('y'.repeat(128 * 1024)); assert.equal(1, 1); });\n"
      );

      const syncRes = cmOpt.runFlakeCheck({ runs: 2, target: 'tests/noisy.test.mjs', repoRoot: tmpDir, concurrency: 2 });
      assert.equal(syncRes.passed, true);
      assert.equal(syncRes.results[0].passed, 2);

      const parallelRes = await cmOpt.runFlakeCheckParallel({ runs: 2, target: 'tests/noisy.test.mjs', repoRoot: tmpDir, concurrency: 0 });
      assert.equal(parallelRes.passed, true);
      assert.equal(parallelRes.results[0].passed, 2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
