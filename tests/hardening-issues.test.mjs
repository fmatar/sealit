/**
 * Hardening regression suite — issue regressions (#131 through #135).
 * Hermetic: every test works in an OS temp dir; nothing touches the network
 * or tracked files in this repository.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';

import {
  coreMod,
  qualityGateMod,
  installerMod,
  pmMod,
  auditChainMod,
  productDagMod,
  issueGateReceipt,
  verifyGateReceipt,
  parseCoverageReport,
  parseMutationReport,
  createWorkbenchServer,
  createADR,
  listADRs,
  executeCompositeStage,
  startSession,
  updateSession,
  runCLI,
  formatCLIResult,
  generateReviewPlan,
  runDoctor,
  installCIWorkflow,
  generateConfig,
  CANONICAL_SDLC_SKILLS,
  provisionAgentIntegrations,
  installFramework,
  auditSkills,
  buildWikiCodeMap,
  REPO_ROOT,
  childEnv,
  git,
  engine,
  makeRepo,
  writeSession,
  dispatchReq
} from './helpers/hardening-harness.mjs';
// ===========================================================================
// Issue #131: Real hunk diff coverage, unified thresholds, Red TDD harness,
//             truthful review pillars & fail-closed offline security audit
// ===========================================================================
describe('Issue #131: Gate hunk diff coverage, unified thresholds, Red TDD & truthful review', () => {
  let dir;
  beforeEach(() => {
    dir = makeRepo();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('enforces real hunk diff coverage on LCOV diffs even when repo-wide coverage exceeds threshold', () => {
    // Establish develop base branch with a well-covered baseline module (90/100 lines covered = 90%)
    assert.equal(git(dir, 'checkout', '-b', 'develop').status, 0);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const baseLines = Array.from({ length: 100 }, (_, i) => `export const c${i} = ${i};`).join('\n') + '\n';
    fs.writeFileSync(path.join(dir, 'src/math.mjs'), baseLines, 'utf8');
    git(dir, 'add', 'src/math.mjs');
    assert.equal(git(dir, 'commit', '-q', '-m', 'feat: baseline math module').status, 0);

    // Branch to feature branch and add 10 new executable lines in hunk (lines 101..110)
    assert.equal(git(dir, 'checkout', '-b', 'feature/issue-131-diff-cov').status, 0);
    const addedLines = Array.from({ length: 10 }, (_, i) => `export function f${i}() { return ${i}; }`).join('\n') + '\n';
    fs.writeFileSync(path.join(dir, 'src/math.mjs'), baseLines + addedLines, 'utf8');
    git(dir, 'add', 'src/math.mjs');
    assert.equal(git(dir, 'commit', '-q', '-m', 'feat: add untested hunk lines').status, 0);

    // LCOV has 95/110 covered overall (86.4% >= 85%) ONLY because baseline lines are covered;
    // the 10 changed hunk lines (101..110) all have 0 hits -> diff coverage is 0%!
    const lcovLines = ['TN:', 'SF:src/math.mjs'];
    for (let ln = 1; ln <= 100; ln++) lcovLines.push(`DA:${ln},${ln <= 95 ? 1 : 0}`);
    for (let ln = 101; ln <= 110; ln++) lcovLines.push(`DA:${ln},0`);
    lcovLines.push('LF:110', 'LH:95', 'end_of_record', '');
    fs.mkdirSync(path.join(dir, 'coverage'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'coverage/lcov.info'), lcovLines.join('\n'), 'utf8');

    const failRes = parseCoverageReport(dir, { path: '.', thresholds: { diffCoverage: 85 } });
    assert.equal(failRes.found, true);
    assert.equal(failRes.diffApplicable, true);
    assert.ok(failRes.repoLineCoverage > 85, `expected repo coverage > 85, got ${failRes.repoLineCoverage}`);
    assert.equal(failRes.diffLineCoverage, 0);
    assert.equal(failRes.lineCoverage, 0);
    assert.equal(failRes.passed, false);

    // Now cover lines 101..110 in the hunk even if overall repo coverage stays at 60/110 (54.5%)
    const passLcov = ['TN:', 'SF:src/math.mjs'];
    for (let ln = 1; ln <= 100; ln++) passLcov.push(`DA:${ln},${ln <= 50 ? 1 : 0}`);
    for (let ln = 101; ln <= 110; ln++) passLcov.push(`DA:${ln},1`);
    passLcov.push('LF:110', 'LH:60', 'end_of_record', '');
    fs.writeFileSync(path.join(dir, 'coverage/lcov.info'), passLcov.join('\n'), 'utf8');

    const passRes = parseCoverageReport(dir, { path: '.', thresholds: { diffCoverage: 85 } });
    assert.equal(passRes.found, true);
    assert.equal(passRes.diffApplicable, true);
    assert.equal(passRes.diffLineCoverage, 100);
    assert.equal(passRes.lineCoverage, 100);
    assert.equal(passRes.passed, true);

    // Docs-only branch (no executable source hunk changes) falls back cleanly with diffApplicable: false
    assert.equal(git(dir, 'checkout', 'develop').status, 0);
    assert.equal(git(dir, 'checkout', '-b', 'feature/issue-131-docs-only').status, 0);
    fs.writeFileSync(path.join(dir, 'README.md'), '# updated docs\n', 'utf8');
    git(dir, 'add', 'README.md');
    assert.equal(git(dir, 'commit', '-q', '-m', 'docs: update readme').status, 0);
    fs.writeFileSync(path.join(dir, 'coverage/lcov.info'), passLcov.join('\n'), 'utf8');

    const docsRes = parseCoverageReport(dir, { path: '.', thresholds: { diffCoverage: 85 } });
    assert.equal(docsRes.found, true);
    assert.equal(docsRes.diffApplicable, false);
    assert.equal(docsRes.diffLineCoverage, null);
    assert.equal(docsRes.passed, false); // repoLineCoverage 54.5% < 85%
  });

  it('resolves coverage & mutation thresholds identically across core, parsers, receipts, product-dag, pm-provider, and PR summary', () => {
    assert.equal(typeof coreMod.resolveQualityThresholds, 'function');

    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({
        version: '2.1.0',
        testing: { coverageThreshold: 78, mutationThreshold: 59 },
        modules: [{ name: 'root', path: '.', thresholds: { diffCoverage: 91, mutationScore: 63 } }]
      }),
      'utf8'
    );

    // Explicit testing.* overrides modules.* consistently across every subsystem (including when mod is passed)
    const resolved = coreMod.resolveQualityThresholds(dir);
    assert.equal(resolved.minCov, 78);
    assert.equal(resolved.minMut, 59);

    fs.mkdirSync(path.join(dir, 'coverage'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'coverage/coverage-summary.json'),
      JSON.stringify({ total: { lines: { pct: 80 }, branches: { pct: 80 } } }),
      'utf8'
    );
    const covDefaultMod = parseCoverageReport(dir);
    assert.equal(covDefaultMod.threshold, 78);
    assert.equal(covDefaultMod.passed, true);

    fs.mkdirSync(path.join(dir, 'reports/mutation'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'reports/mutation/mutation.json'),
      JSON.stringify({ mutationScore: 61, files: {} }),
      'utf8'
    );
    const mutDefaultMod = parseMutationReport(dir);
    assert.equal(mutDefaultMod.threshold, 59);
    assert.equal(mutDefaultMod.passed, true);

    const prSummary = qualityGateMod.generatePRSummary({ issueId: 131, repoRoot: dir });
    assert.match(prSummary.markdown, />= 78%/);
    assert.match(prSummary.markdown, />= 59%/);

    const reviewMd = pmMod.formatConsolidatedReviewComment({ issueId: 131, headSha: 'abc12345', repoRoot: dir });
    assert.match(reviewMd, />= 78%/);
    assert.match(reviewMd, />= 59%/);

    const receiptCheck = auditChainMod.issueGateReceipt({
      issueId: 131,
      branch: 'feature/issue-131',
      coveragePct: 79,
      mutationPct: 58,
      peerReviewApproved: true,
      reviewer: '@rev',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(receiptCheck.success, false);
    assert.deepEqual(receiptCheck.missing, ['mutationPct']);

    // Check module-only config with no testing/gates section
    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({
        version: '2.1.0',
        modules: [{ name: 'root', path: '.', thresholds: { diffCoverage: 91, mutationScore: 63 } }]
      }),
      'utf8'
    );
    assert.equal(parseCoverageReport(dir).threshold, 91);
    assert.equal(parseCoverageReport(dir).passed, false);
    assert.equal(parseMutationReport(dir).threshold, 63);
    assert.equal(parseMutationReport(dir).passed, false);
  });

  it('scaffoldReproductionTest generates a Red failing JS test that fails execution prior to fixing', () => {
    const cleanScaf = qualityGateMod.scaffoldReproductionTest({
      errorTrace: 'TypeError: boom\n    at AuthController (/app/src/routes/auth.mjs:15:3)',
      repoRoot: dir
    });
    assert.equal(cleanScaf.success, true);
    const run = spawnSync(process.execPath, ['--test', cleanScaf.testPath], {
      cwd: dir,
      encoding: 'utf8',
      env: childEnv()
    });
    assert.doesNotMatch(run.stdout + run.stderr, /SyntaxError/, 'generated test must be valid JavaScript');
    assert.notEqual(run.status, 0, 'scaffolded Red reproduction test must fail before applying fix');

    // Trace containing `*/` must not prematurely terminate the JSDoc comment and cause SyntaxError
    const slashStarScaf = qualityGateMod.scaffoldReproductionTest({
      errorTrace: 'Error: bad */ comment token\n    at AuthController (/app/src/routes/auth.mjs:16:3)',
      repoRoot: dir
    });
    const run2 = spawnSync(process.execPath, ['--test', slashStarScaf.testPath], {
      cwd: dir,
      encoding: 'utf8',
      env: childEnv()
    });
    assert.doesNotMatch(run2.stdout + run2.stderr, /SyntaxError/, 'trace with */ must not break JSDoc block');
    assert.notEqual(run2.status, 0);
  });

  it('formatConsolidatedReviewComment and generatePRSummary report unverified/failed pillars truthfully', () => {
    const unverifiedMd = pmMod.formatConsolidatedReviewComment({
      issueId: 131,
      branch: 'feature/issue-131',
      headSha: '1111222233334444',
      verdict: 'approve',
      repoRoot: dir
    });
    assert.doesNotMatch(unverifiedMd, /Unit & Integration Tests[^\n]*✅ PASSED/);
    assert.doesNotMatch(unverifiedMd, /Archlens Concentric Rings[^\n]*✅ PASSED/);
    assert.doesNotMatch(unverifiedMd, /Security & CVE Audit[^\n]*✅ PASSED/);
    assert.doesNotMatch(unverifiedMd, /Diff Test Coverage[^\n]*✅ Verified/);

    const failedMd = pmMod.formatConsolidatedReviewComment({
      issueId: 131,
      branch: 'feature/issue-131',
      headSha: '1111222233334444',
      verdict: 'request_changes',
      coveragePct: '42.0%',
      mutationPct: '10.0%',
      testsPassed: false,
      archPassed: false,
      securityPassed: false,
      driftPassed: false,
      repoRoot: dir
    });
    assert.match(failedMd, /Diff Test Coverage[^\n]*❌ 42\.0%/);
    assert.match(failedMd, /Mutation Kill Score[^\n]*❌ 10\.0%/);
    assert.match(failedMd, /Archlens Concentric Rings[^\n]*❌ FAILED/);
    assert.match(failedMd, /Security & CVE Audit[^\n]*❌ FAILED/);
    assert.match(failedMd, /Spec-Drift Sentinel[^\n]*❌ FAILED/);

    // Session with failing coverage must not print ✅ PASSED in generatePRSummary
    writeSession(dir, {
      issueId: '131',
      branch: 'feature/issue-131',
      type: 'fix',
      manifest: { coverageReport: '42.0%' }
    });
    const pr = qualityGateMod.generatePRSummary({ issueId: 131, repoRoot: dir });
    assert.doesNotMatch(pr.markdown, /Line & Branch Diff Coverage[^\n]*✅ PASSED/);
    assert.match(pr.markdown, /Line & Branch Diff Coverage[^\n]*❌ FAILED/);
  });

  it('auditSecurity fails closed when npm audit errors in strict/CI mode unless --allow-offline is set', () => {
    fs.writeFileSync(
      path.join(dir, 'package-lock.json'),
      JSON.stringify({ name: 'tmp', version: '0.0.1', packages: { '': { version: '0.0.1' } } }),
      'utf8'
    );
    const offlineExec = () => {
      const err = new Error('getaddrinfo ENOTFOUND registry.npmjs.org');
      err.stdout = '';
      err.stderr = 'npm error code ENOTFOUND';
      throw err;
    };

    const strictFail = qualityGateMod.auditSecurity(dir, { strict: true, execFn: offlineExec });
    assert.equal(strictFail.passed, false);
    assert.equal(strictFail.packageAuditPassed, false);
    assert.equal(strictFail.packageAuditStatus, 'audit-error');

    const bypassed = qualityGateMod.auditSecurity(dir, { strict: true, allowOffline: true, execFn: offlineExec });
    assert.equal(bypassed.passed, true);
    assert.equal(bypassed.packageAuditPassed, true);
    assert.equal(bypassed.packageAuditStatus, 'offline-bypassed');

    const vulnExec = () => {
      const err = new Error('vulnerabilities found');
      err.stdout = JSON.stringify({ metadata: { vulnerabilities: { high: 2, critical: 1 } } });
      throw err;
    };
    const vulnRes = qualityGateMod.auditSecurity(dir, { strict: true, allowOffline: true, execFn: vulnExec });
    assert.equal(vulnRes.passed, false);
    assert.equal(vulnRes.packageAuditStatus, 'vulnerable');

    const prevCI = process.env.CI;
    try {
      process.env.CI = 'true';
      const ciFail = qualityGateMod.auditSecurity(dir, { execFn: offlineExec });
      assert.equal(ciFail.passed, false);
      assert.equal(ciFail.packageAuditStatus, 'audit-error');
    } finally {
      if (prevCI === undefined) delete process.env.CI;
      else process.env.CI = prevCI;
    }
  });

  it('extractAddedLinesFromDiff, untracked LCOV diff hunks, gates.* precedence, and gatePillars headSha freshness work end-to-end', () => {
    const parsed = coreMod.extractAddedLinesFromDiff([
      'diff --git a/src/a.mjs b/src/a.mjs',
      '--- a/src/a.mjs',
      '+++ b/src/a.mjs',
      '@@ -2,3 +2,4 @@',
      ' const keep = 1;',
      '-const old = 2;',
      '+const next = 2;',
      '+++ b/literal-content-stays-inside-hunk',
      '@@ -10,0 +11,2 @@',
      '+export const x = 1;',
      '+export const y = 2;'
    ].join('\n'));
    assert.deepEqual([...parsed], [3, 4, 11, 12]);

    // gates.* overrides testing.* and modules.*; explicit null disables mutation
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({
        version: '2.1.0',
        gates: { minDiffCoverage: 92, minMutationScore: null },
        testing: { coverageThreshold: 70, mutationThreshold: 55 },
        modules: [{ name: 'root', path: '.', commands: { test: 'node -e 0', coverage: 'node -e 0' }, thresholds: { diffCoverage: 85, mutationScore: 80 } }]
      }),
      'utf8'
    );
    const gateBars = coreMod.resolveQualityThresholds(dir);
    assert.equal(gateBars.minCov, 92);
    assert.equal(gateBars.minMut, null);
    const disabledPrd = productDagMod.renderProductPrdMarkdown({ title: 'Demo', repoRoot: dir });
    assert.ok(disabledPrd.includes('Diff Test Coverage `>= 92%`'));
    assert.equal(disabledPrd.includes('Mutation Score'), false);

    // Run `gate` on active session and verify gatePillars headSha + stale detection on next commit
    assert.equal(git(dir, 'checkout', '-b', 'develop').status, 0);
    assert.equal(git(dir, 'checkout', '-b', 'feature/issue-131-pillars').status, 0);
    // Also verify untracked new working-tree file LCOV diff intersection (`core.mjs` synthesized diff without @@ header)
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'coverage'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/untracked.mjs'), 'export function u() {\n  return 42;\n}\n', 'utf8');
    fs.writeFileSync(
      path.join(dir, 'coverage/lcov.info'),
      ['TN:', 'SF:src/untracked.mjs', 'DA:1,0', 'DA:2,0', 'LF:2', 'LH:0', 'end_of_record', ''].join('\n'),
      'utf8'
    );
    const untrackedFail = parseCoverageReport(dir, { path: '.', thresholds: { diffCoverage: 85 } });
    assert.equal(untrackedFail.diffApplicable, true);
    assert.equal(untrackedFail.diffLineCoverage, 0);
    assert.equal(untrackedFail.passed, false);
    fs.rmSync(path.join(dir, 'src/untracked.mjs'));

    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({
        version: '2.1.0',
        modules: [
          {
            name: 'root',
            path: '.',
            commands: {
              test: 'node -e 0',
              coverage: `node -e "const fs=require('fs');fs.mkdirSync('coverage',{recursive:true});fs.writeFileSync('coverage/lcov.info',['TN:','SF:src/new.mjs','DA:1,1','DA:2,1','LF:2','LH:2','end_of_record'].join('\\n'))"`,
              lint: 'node -e 0'
            },
            thresholds: { diffCoverage: 85, mutationScore: null }
          }
        ]
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(dir, 'src/new.mjs'), 'export const a = 1;\nexport const b = 2;\n', 'utf8');
    git(dir, 'add', 'src/new.mjs');
    assert.equal(git(dir, 'commit', '-q', '-m', 'feat: add new module').status, 0);

    startSession({ issueId: 131, title: 'pillars test', type: 'fix', lane: 'standard', branch: 'feature/issue-131-pillars', repoRoot: dir });
    const head1 = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    // Run gate (non-strict) via CLI and verify lintPassed/coveragePassed/unitTestsPassed recorded
    const gateRun = engine(dir, 'gate', '--no-cache');
    assert.equal(gateRun.status, 0, gateRun.stdout + gateRun.stderr);

    const freshComment = pmMod.formatConsolidatedReviewComment({ issueId: 131, headSha: head1, verdict: 'approve', repoRoot: dir });
    assert.match(freshComment, /Unit & Integration Tests[^\n]*✅ PASSED/);
    assert.match(freshComment, /Diff Test Coverage[^\n]*✅ 100\.0%/);

    // Advance HEAD with a new commit -> prior gatePillars become STALE for new headSha
    fs.writeFileSync(path.join(dir, 'src/new.mjs'), 'export const a = 1;\nexport const b = 3;\n', 'utf8');
    git(dir, 'add', 'src/new.mjs');
    assert.equal(git(dir, 'commit', '-q', '-m', 'feat: modify after gate').status, 0);
    const head2 = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    const staleComment = pmMod.formatConsolidatedReviewComment({ issueId: 131, headSha: head2, verdict: 'approve', repoRoot: dir });
    assert.match(staleComment, /Unit & Integration Tests[^\n]*⏳ STALE/);
    assert.doesNotMatch(staleComment, /Unit & Integration Tests[^\n]*✅ PASSED/);
  });
});

describe('Issue #131 Review Blocker Regressions', () => {
  const cleanChildEnv = () => {
    const env = { ...process.env };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    delete env.GIT_INDEX_FILE;
    delete env.NODE_TEST_CONTEXT;
    return env;
  };

  const initTempRepo = async (prefix) => {
    const { execFileSync } = await import('node:child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const gitExec = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: cleanChildEnv(), stdio: 'pipe' }).trim();
    gitExec(['init']);
    gitExec(['config', 'user.email', 'test@example.com']);
    gitExec(['config', 'user.name', 'Test User']);
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'), '# Temp Repo\n', 'utf8');
    gitExec(['add', '.']);
    gitExec(['commit', '-m', 'init']);
    const sha1 = gitExec(['rev-parse', 'HEAD']);
    return { dir, gitExec, execFileSync, sha1 };
  };

  it('B1/BLK-01: formatConsolidatedReviewComment and generatePRSummary mark stale coverage/mutation from prior commit as STALE', async () => {
    const { dir, gitExec, sha1 } = await initTempRepo('sdlc-b1-stale-');
    try {
      const pmMod = await import('../.agent/scripts/lib/pm-provider.mjs');
      const qgMod = await import('../.agent/scripts/lib/quality-gate.mjs');
      fs.writeFileSync(
        path.join(dir, '.agent/sdlc-config.json'),
        JSON.stringify({
          version: '1.0.0',
          modules: [{ name: 'root', path: '.', commands: {}, thresholds: { diffCoverage: 85, mutationScore: 80 } }]
        }),
        'utf8'
      );
      fs.writeFileSync(
        path.join(dir, '.agent/.sdlc-session.json'),
        JSON.stringify({
          issueId: 131,
          branch: 'feature/issue-#131-b1',
          lane: 'full',
          manifest: {
            coverageReport: '94.0%',
            mutationScore: '86.0%',
            gatePillars: {
              strict: true,
              headSha: sha1,
              unitTestsPassed: true,
              coveragePassed: true,
              mutationPassed: true,
              lintPassed: true,
              securityPassed: true,
              archPassed: true,
              flakePassed: true,
              contractPassed: true,
              auditChainValid: true,
              driftPassed: true,
              wikiPassed: true,
              readmePassed: true
            }
          }
        }),
        'utf8'
      );

      // Advance HEAD after gate ran on sha1
      fs.writeFileSync(path.join(dir, 'app.js'), 'export const x = 2;\n', 'utf8');
      gitExec(['add', 'app.js']);
      gitExec(['commit', '-m', 'second commit invalidates prior metrics']);
      const sha2 = gitExec(['rev-parse', 'HEAD']);
      assert.notEqual(sha2, sha1);

      const staleReview = pmMod.formatConsolidatedReviewComment({
        issueId: 131,
        headSha: sha2,
        verdict: 'approve',
        repoRoot: dir
      });
      assert.equal(staleReview.includes('✅ 94.0%'), false, 'stale coverage from prior commit must not render green');
      assert.equal(staleReview.includes('✅ 86.0%'), false, 'stale mutation from prior commit must not render green');
      assert.match(staleReview, /STALE/i);

      const staleSummary = qgMod.generatePRSummary({ issueId: 131, repoRoot: dir });
      assert.equal(staleSummary.markdown.includes('✅ 94.0%'), false, 'PR summary must not render stale prior-commit coverage as green');
      assert.equal(staleSummary.markdown.includes('✅ 86.0%'), false, 'PR summary must not render stale prior-commit mutation as green');
      assert.equal(staleSummary.markdown.includes('✅ PASSED'), false, 'PR summary must not render stale prior-commit gate pillars as PASSED');
      assert.match(staleSummary.markdown, /STALE/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('B2/BLK-02: gatePillars preserve same-SHA pass flags across trivial/cached gates, record failed command runs as false, and fail runFlakeCheck on 0% pass', async () => {
    const { dir, gitExec, execFileSync } = await initTempRepo('sdlc-b2-pillars-');
    try {
      const qgMod = await import('../.agent/scripts/lib/quality-gate.mjs');
      const sessMod = await import('../.agent/scripts/lib/session.mjs');
      const enginePath = path.resolve('.agent/scripts/sdlc-engine.mjs');
      const runEngine = (cliArgs) =>
        execFileSync(process.execPath, [enginePath, ...cliArgs], {
          cwd: dir,
          encoding: 'utf8',
          env: { ...cleanChildEnv(), CI: 'false' },
          stdio: 'pipe'
        });

      gitExec(['checkout', '-b', 'feature/issue-#131-b2']);
      fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'test/fail.test.mjs'),
        'import { it } from "node:test"; import assert from "node:assert/strict"; it("always fails", () => { assert.equal(1, 2); });\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(dir, '.agent/sdlc-config.json'),
        JSON.stringify({
          version: '1.0.0',
          modules: [
            {
              name: 'root',
              path: '.',
              commands: {
                lint: 'node -e "process.exit(0)"',
                test: 'node -e "process.exit(1)"',
                coverage: 'node -e "process.exit(1)"'
              },
              thresholds: { diffCoverage: 85, mutationScore: null }
            }
          ]
        }),
        'utf8'
      );
      gitExec(['add', 'test/fail.test.mjs', '.agent/sdlc-config.json']);
      gitExec(['commit', '-m', 'setup config and failing test']);
      const headSha = gitExec(['rev-parse', 'HEAD']);

      sessMod.startSession({
        issueId: 131,
        branch: 'feature/issue-#131-b2',
        lane: 'full',
        repoRoot: dir
      });
      sessMod.updateSession({
        manifestUpdate: {
          gatePillars: {
            strict: true,
            headSha,
            lintPassed: true,
            coveragePassed: true,
            unitTestsPassed: true,
            securityPassed: true,
            updatedAt: '2026-01-01T00:00:00.000Z'
          }
        },
        repoRoot: dir
      });

      // Stage/create only a trivial docs change so --lane trivial is respected
      fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'docs/note.md'), '# Note\n', 'utf8');

      // 1. Trivial gate on same SHA must update updatedAt/lintPassed WITHOUT wiping unitTestsPassed/coveragePassed
      runEngine(['gate', '--lane', 'trivial', '--reason', 'docs only']);
      const sessAfterTrivial = sessMod.getSessionStatus(dir).session;
      assert.notEqual(sessAfterTrivial.manifest.gatePillars.updatedAt, '2026-01-01T00:00:00.000Z');
      assert.equal(sessAfterTrivial.manifest.gatePillars.lintPassed, true);
      assert.equal(sessAfterTrivial.manifest.gatePillars.unitTestsPassed, true);
      assert.equal(sessAfterTrivial.manifest.gatePillars.coveragePassed, true);

      // 2. Failing `test` command must record unitTestsPassed: false even when command throws
      let testThrew = false;
      try {
        runEngine(['test']);
      } catch {
        testThrew = true;
      }
      assert.equal(testThrew, true);
      const sessAfterFailedTest = sessMod.getSessionStatus(dir).session;
      assert.equal(sessAfterFailedTest.manifest.gatePillars.unitTestsPassed, false);

      // Reset coveragePassed/unitTestsPassed to true on same SHA, then verify failing `coverage` records false
      sessMod.updateSession({
        manifestUpdate: {
          gatePillars: {
            ...sessAfterFailedTest.manifest.gatePillars,
            coveragePassed: true,
            unitTestsPassed: true
          }
        },
        repoRoot: dir
      });
      let covThrew = false;
      try {
        runEngine(['coverage', '--no-cache']);
      } catch {
        covThrew = true;
      }
      assert.equal(covThrew, true);
      const sessAfterFailedCov = sessMod.getSessionStatus(dir).session;
      assert.equal(sessAfterFailedCov.manifest.gatePillars.coveragePassed, false);
      assert.equal(sessAfterFailedCov.manifest.gatePillars.unitTestsPassed, false);

      // 3. Failing 0%-pass test suite must fail runFlakeCheck and `flake-check` CLI
      const flakeRes = qgMod.runFlakeCheck({ runs: 2, target: 'test/fail.test.mjs', repoRoot: dir });
      assert.equal(flakeRes.flaky, false);
      assert.equal(flakeRes.passed, false);
      assert.equal(flakeRes.results[0].failed, 2);

      let flakeCliFailed = false;
      try {
        runEngine(['flake-check', '--runs', '2', '--target', 'test/fail.test.mjs']);
      } catch {
        flakeCliFailed = true;
      }
      assert.equal(flakeCliFailed, true, 'flake-check CLI must exit non-zero when all runs fail');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('B3/BLK-03: resolves identical thresholds (gates > testing > mod.thresholds) across coverage, mutation, receipts, PR summary, and review', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-b3-precedence-'));
    try {
      const coreMod = await import('../.agent/scripts/lib/core.mjs');
      const qgMod = await import('../.agent/scripts/lib/quality-gate.mjs');
      const sessMod = await import('../.agent/scripts/lib/session.mjs');

      fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'coverage'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'reports/mutation'), { recursive: true });

      const mod = { name: 'app', path: '.', thresholds: { diffCoverage: 92, mutationScore: 65 } };
      // Case A: testing.* overrides mod.thresholds everywhere (including null mutationThreshold)
      fs.writeFileSync(
        path.join(dir, '.agent/sdlc-config.json'),
        JSON.stringify({
          version: '1.0.0',
          testing: { coverageThreshold: 78, mutationThreshold: null },
          modules: [mod]
        }),
        'utf8'
      );

      const resA = coreMod.resolveQualityThresholds(dir);
      const resAMod = coreMod.resolveQualityThresholds(dir, mod);
      assert.equal(resA.minCov, 78);
      assert.equal(resA.minMut, null);
      assert.equal(resAMod.minCov, 78);
      assert.equal(resAMod.minMut, null);

      fs.writeFileSync(
        path.join(dir, 'coverage/coverage-summary.json'),
        JSON.stringify({ total: { lines: { pct: 80 }, branches: { pct: 80 } } }),
        'utf8'
      );
      const covA = qgMod.parseCoverageReport(dir, mod);
      assert.equal(covA.threshold, 78);
      assert.equal(covA.passed, true);

      const receiptIn = sessMod.receiptInputsFromSession(
        { lane: 'full', manifest: { coverageReport: '80.0%' } },
        { driftCheckPassed: true, repoRoot: dir }
      );
      assert.equal(receiptIn.mutationPct, null, 'null testing.mutationThreshold must make mutationPct null on full-lane receipts');

      // Case B: gates.* overrides testing.* and mod.thresholds everywhere
      fs.writeFileSync(
        path.join(dir, '.agent/sdlc-config.json'),
        JSON.stringify({
          version: '1.0.0',
          gates: { minDiffCoverage: 90, minMutationScore: 72 },
          testing: { coverageThreshold: 76, mutationThreshold: 55 },
          modules: [mod]
        }),
        'utf8'
      );
      const resB = coreMod.resolveQualityThresholds(dir);
      const resBMod = coreMod.resolveQualityThresholds(dir, mod);
      assert.equal(resB.minCov, 90);
      assert.equal(resB.minMut, 72);
      assert.equal(resBMod.minCov, 90);
      assert.equal(resBMod.minMut, 72);

      fs.writeFileSync(
        path.join(dir, 'reports/mutation/mutation.json'),
        JSON.stringify({ files: { 'a.js': { mutants: [{ status: 'Killed' }, { status: 'Killed' }, { status: 'Killed' }, { status: 'Survived' }] } } }),
        'utf8'
      );
      // 75% >= 72% -> passes
      const mutB = qgMod.parseMutationReport(dir, mod);
      assert.equal(mutB.threshold, 72);
      assert.equal(mutB.passed, true);

      // Case C: ad-hoc mod.thresholds without gates/testing in config still takes effect
      fs.unlinkSync(path.join(dir, '.agent/sdlc-config.json'));
      const resC = coreMod.resolveQualityThresholds(dir, { thresholds: { diffCoverage: 88, mutationScore: 70 } });
      assert.equal(resC.minCov, 88);
      assert.equal(resC.minMut, 70);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('BLK-04: scaffoldReproductionTest safely escapes backslashes, quotes, Rust braces, Python """ and */ across polyglot templates', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-blk04-escape-'));
    try {
      const qgMod = await import('../.agent/scripts/lib/quality-gate.mjs');
      const { execFileSync } = await import('node:child_process');
      const nastyTrace = 'Fail C:\\tmp\\x "q" `bt` ${x} """triple""" {foo:bar} */ panic!';

      const targets = [
        { file: 'src/App.java', lang: 'java' },
        { file: 'src/app.py', lang: 'python' },
        { file: 'src/app.go', lang: 'go' },
        { file: 'src/app.rs', lang: 'rust' },
        { file: 'src/app.mjs', lang: 'javascript' }
      ];

      for (const { file, lang } of targets) {
        const dirInject = path.posix.join(path.posix.dirname(file), 'bad_*/_"inject"', path.posix.basename(file));
        const res = qgMod.scaffoldReproductionTest({
          errorTrace: `${nastyTrace}\n  at ${file}:12`,
          targetFile: dirInject,
          repoRoot: dir
        });
        assert.equal(res.language, lang);
        assert.equal(res.testContent.includes('"""triple"""'), false, `${lang} must escape triple quotes`);
        if (lang !== 'python') {
          const harnessIdx = res.testContent.indexOf('Bug Reproduction Harness:');
          const blockCloseIdx = res.testContent.indexOf('*/');
          assert.ok(harnessIdx !== -1 && blockCloseIdx > harnessIdx, `${lang} JSDoc block comment must not terminate prematurely`);
          assert.ok(res.testContent.slice(0, blockCloseIdx).includes('* / panic!'), `${lang} JSDoc block comment must escape */`);
        }

        if (lang === 'rust') {
          assert.match(res.testContent, /panic!\("\{\}",/, 'Rust panic! must use "{}" format placeholder so braces in trace never break compilation');
        }
        if (lang === 'python') {
          try {
            execFileSync('python3', ['-m', 'py_compile', res.testPath], { cwd: dir, stdio: 'pipe' });
          } catch (err) {
            if (err?.code !== 'ENOENT') throw err;
          }
        }
        if (lang === 'javascript') {
          execFileSync(process.execPath, ['--check', res.testPath], { cwd: dir, stdio: 'pipe' });
        }
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Issue #132: Git Flow develop base, atomic session I/O, receipt allowlist & non-colliding local IDs', () => {
  const cleanChildEnv = () => {
    const env = { ...process.env };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    delete env.GIT_INDEX_FILE;
    delete env.NODE_TEST_CONTEXT;
    return env;
  };

  it('uses resolveDefaultBaseBranch (develop over main) in reconcileSessionLaneWithDiff, buildArchDiffPayload, and triage CLI', async () => {
    const { execFileSync } = await import('node:child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-132-develop-'));
    const gitExec = (args) =>
      execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: cleanChildEnv(), stdio: 'pipe' }).trim();
    try {
      gitExec(['init', '-b', 'main']);
      gitExec(['config', 'user.email', 'test@example.com']);
      gitExec(['config', 'user.name', 'Test User']);
      fs.writeFileSync(path.join(dir, 'README.md'), '# Base\n', 'utf8');
      gitExec(['add', '.']);
      gitExec(['commit', '-m', 'init main']);

      // develop diverges from main with a CRITICAL security file
      gitExec(['checkout', '-b', 'develop']);
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src/develop-only-auth.js'), 'export const jwtSecret = true;\n', 'utf8');
      gitExec(['add', '.']);
      gitExec(['commit', '-m', 'feat(develop): prior develop auth commit']);

      // feature branch off develop modifies ONLY a 1-line trivial doc file
      gitExec(['checkout', '-b', 'feature/issue-#132-docs-only']);
      fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'docs/tiny.md'), 'hello\n', 'utf8');
      gitExec(['add', '.']);
      gitExec(['commit', '-m', 'docs: add tiny doc']);

      const sessMod = await import('../.agent/scripts/lib/session.mjs');
      const wbMod = await import('../.agent/scripts/lib/workbench-server.mjs');
      const sess = sessMod.startSession({
        issueId: 132,
        branch: 'feature/issue-#132-docs-only',
        lane: 'trivial',
        laneDowngraded: true,
        laneReason: 'docs change only',
        repoRoot: dir
      }).session;

      // 1. reconcileSessionLaneWithDiff must diff against develop (docs/tiny.md only), not main (src/develop-only-auth.js)
      const reconciled = sessMod.reconcileSessionLaneWithDiff({ session: sess, repoRoot: dir });
      assert.equal(reconciled.lane, 'trivial', 'trivial doc change on branch off develop must not escalate from older develop auth commits');

      // 2. buildArchDiffPayload must list only docs/tiny.md (against develop), not main..HEAD files
      const payload = wbMod.buildArchDiffPayload(dir);
      const allRingFiles = Object.values(payload.rings).flat();
      assert.ok(allRingFiles.includes('docs/tiny.md'));
      assert.equal(allRingFiles.includes('src/develop-only-auth.js'), false, 'buildArchDiffPayload must diff against develop when present');

      // 3. `sdlc-engine triage --json` must evaluate diff relative to develop without polluting repo with sdlc-config.json
      const enginePath = path.resolve('.agent/scripts/sdlc-engine.mjs');
      const triageOut = execFileSync(process.execPath, [enginePath, 'triage', '--json'], {
        cwd: dir,
        encoding: 'utf8',
        env: cleanChildEnv(),
        stdio: 'pipe'
      });
      const triageJson = JSON.parse(triageOut.slice(triageOut.indexOf('{')));
      assert.equal(triageJson.triage.riskLevel, 'LOW');
      assert.equal(triageJson.triage.computedLane, 'trivial');
      assert.equal(fs.existsSync(path.join(dir, '.agent/sdlc-config.json')), false, 'read-only triage must not write .agent/sdlc-config.json');

      // Explicitly passing --base=main includes develop's auth file and escalates to full
      const triageMainOut = execFileSync(process.execPath, [enginePath, 'triage', '--base=main', '--json'], {
        cwd: dir,
        encoding: 'utf8',
        env: cleanChildEnv(),
        stdio: 'pipe'
      });
      const triageMainJson = JSON.parse(triageMainOut.slice(triageMainOut.indexOf('{')));
      assert.equal(triageMainJson.triage.computedLane, 'full');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('enforces atomic session/exemption writes and reuses shared core session helpers without duplication', async () => {
    const sessionSrc = fs.readFileSync(path.resolve('.agent/scripts/lib/session.mjs'), 'utf8');
    const pmSrc = fs.readFileSync(path.resolve('.agent/scripts/lib/pm-provider.mjs'), 'utf8');
    assert.equal(/\bfs\.writeFileSync\b/.test(sessionSrc), false, 'session.mjs must use writeFileAtomic for all session and exemption writes');
    assert.equal(/\bfunction\s+readActiveSessionFromDisk\b/.test(pmSrc), false, 'pm-provider.mjs must share session disk reader from core.mjs');
    assert.equal(/\bfunction\s+patchActiveSessionManifest\b/.test(pmSrc), false, 'pm-provider.mjs must share session manifest patcher from core.mjs');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-132-atomic-'));
    try {
      const sessMod = await import('../.agent/scripts/lib/session.mjs');
      const pmMod = await import('../.agent/scripts/lib/pm-provider.mjs');
      const coreMod = await import('../.agent/scripts/lib/core.mjs');
      sessMod.startSession({ issueId: 132, branch: 'feature/issue-#132-atomic', lane: 'full', repoRoot: dir });
      sessMod.updateSession({ stage: 3, stageName: 'TDD', manifestUpdate: { prNumber: 999 }, repoRoot: dir });
      const exIds = [];
      for (let i = 0; i < 5; i++) {
        const res = sessMod.recordExemption({ mutantId: `m${i}`, file: 'a.mjs', reason: 'equivalent mutant', approvedBy: 'tester', repoRoot: dir });
        exIds.push(res.exemption.id);
      }
      assert.equal(new Set(exIds).size, 5, `exemption IDs collided: ${exIds.join(', ')}`);

      assert.equal(pmMod.resolveOpenPRNumber({ repoRoot: dir }), 999);
      assert.equal(coreMod.readSessionFileState(dir).session.stage, 3);
      assert.equal(sessMod.getExemptions(dir).length, 5);
      const agentFiles = fs.readdirSync(path.join(dir, '.agent'));
      assert.equal(agentFiles.some((f) => f.endsWith('.tmp')), false, 'atomic writes must leave zero .tmp leftovers');

      // Legacy flat session object with active: true and omitted issueId must not regress or throw TypeError
      fs.writeFileSync(
        path.join(dir, '.agent/.sdlc-session.json'),
        JSON.stringify({ active: true, branch: 'feature/legacy', stage: 2, manifest: { checkpoints: {} } }, null, 2),
        'utf8'
      );
      assert.equal(coreMod.readSessionFileState(dir).active, true);
      assert.equal(coreMod.readSessionFileState(dir).session.branch, 'feature/legacy');
      assert.equal(coreMod.readSessionRegistry(dir).active.branch, 'feature/legacy');
      assert.equal(coreMod.patchActiveSessionManifest(dir, { prNumber: 888 }), true);
      assert.equal(coreMod.readSessionFileState(dir).session.manifest.prNumber, 888);
      sessMod.updateSession({ stage: 3, stageName: 'TDD', repoRoot: dir });
      assert.equal(coreMod.readSessionFileState(dir).active, true);
      assert.equal(coreMod.readSessionFileState(dir).session.stage, 3);
      assert.equal(coreMod.readSessionRegistry(dir).active.stage, 3);
      assert.throws(
        () => sessMod.startSession({ issueId: 133, branch: 'feature/issue-#133', repoRoot: dir }),
        /Active SDLC workflow session already in progress for issue #unknown on branch feature\/legacy/
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('allows docs/DECISION_MAP.md and docs/KANBAN.md in Stage 7 receipt post-signature ancestor diffs while rejecting code edits', async () => {
    const { execFileSync } = await import('node:child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-132-receipt-allowlist-'));
    const gitExec = (args) =>
      execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: cleanChildEnv(), stdio: 'pipe' }).trim();
    try {
      gitExec(['init', '-b', 'develop']);
      gitExec(['config', 'user.email', 'test@example.com']);
      gitExec(['config', 'user.name', 'Test User']);
      fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.agent/sdlc-config.json'), JSON.stringify({ version: '1.0.0', modules: [] }), 'utf8');
      gitExec(['add', '.']);
      gitExec(['commit', '-m', 'init develop']);

      gitExec(['checkout', '-b', 'feature/issue-#132-receipt']);
      fs.writeFileSync(path.join(dir, 'code.mjs'), 'export const v = 1;\n', 'utf8');
      gitExec(['add', 'code.mjs']);
      gitExec(['commit', '-m', 'feat: implement code']);
      const reviewedSha = gitExec(['rev-parse', 'HEAD']);

      const auditMod = await import('../.agent/scripts/lib/audit-chain.mjs');
      const issued = auditMod.issueGateReceipt({
        issueId: 132,
        branch: 'feature/issue-#132-receipt',
        headSha: reviewedSha,
        lane: 'full',
        coveragePct: 92,
        mutationPct: 85,
        peerReviewApproved: true,
        reviewer: 'reviewer',
        driftCheckPassed: true,
        repoRoot: dir
      });
      assert.equal(issued.success, true);

      // Post-signature bookkeeping commit modifying AUDIT_CHAIN, DECISION_MAP, and KANBAN must still verify cleanly
      fs.writeFileSync(path.join(dir, 'docs/DECISION_MAP.md'), '# Decision Map\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'docs/KANBAN.md'), '# Kanban\n', 'utf8');
      gitExec(['add', 'docs/AUDIT_CHAIN.jsonl', 'docs/DECISION_MAP.md', 'docs/KANBAN.md']);
      gitExec(['commit', '-m', 'chore(audit): sign receipt and update decision map / kanban']);
      const bookkeepingSha = gitExec(['rev-parse', 'HEAD']);

      const verifiedBookkeeping = auditMod.verifyGateReceipt({
        headSha: bookkeepingSha,
        branch: 'feature/issue-#132-receipt',
        repoRoot: dir
      });
      assert.equal(
        verifiedBookkeeping.valid,
        true,
        `expected bookkeeping commit after receipt to verify cleanly: ${verifiedBookkeeping.reason || ''}`
      );
      const verifiedHeadRef = auditMod.verifyGateReceipt({
        headSha: 'HEAD',
        branch: 'feature/issue-#132-receipt',
        repoRoot: dir
      });
      assert.equal(
        verifiedHeadRef.valid,
        true,
        `expected symbolic HEAD ref to resolve and verify cleanly on bookkeeping commit: ${verifiedHeadRef.reason || ''}`
      );

      // Modifying source code after the receipt must STILL fail closed
      fs.writeFileSync(path.join(dir, 'code.mjs'), 'export const v = 2;\n', 'utf8');
      gitExec(['add', 'code.mjs']);
      gitExec(['commit', '-m', 'fix: unverified post-receipt code change']);
      const dirtySha = gitExec(['rev-parse', 'HEAD']);

      const verifiedDirty = auditMod.verifyGateReceipt({
        headSha: dirtySha,
        branch: 'feature/issue-#132-receipt',
        repoRoot: dir
      });
      assert.equal(verifiedDirty.valid, false, 'post-receipt code mutations must invalidate receipt verification');

      // Validly HMAC-signed receipt with non-hex headSha option injection must STILL fail closed without passing options to git
      const badReceipt = {
        headSha: '--help',
        branch: 'feature/issue-#132-receipt',
        peerReviewApproved: true,
        driftCheckPassed: true
      };
      const receiptKey = auditMod.loadReceiptKey(dir);
      auditMod.appendAuditRecord({
        event: 'STAGE_7_GATE_RECEIPT_SIGNED',
        metadata: {
          ...badReceipt,
          signature: { alg: 'HMAC-SHA256', value: auditMod.signReceiptPayload(badReceipt, receiptKey) }
        },
        repoRoot: dir
      });
      assert.equal(
        auditMod.verifyReceiptSignature(
          {
            ...badReceipt,
            signature: { alg: 'HMAC-SHA256', value: auditMod.signReceiptPayload(badReceipt, receiptKey) }
          },
          receiptKey
        ),
        true
      );
      const verifiedForged = auditMod.verifyGateReceipt({
        headSha: dirtySha,
        branch: 'feature/issue-#132-receipt',
        repoRoot: dir
      });
      assert.equal(verifiedForged.valid, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('generates non-colliding local ticket and session IDs under rapid bursts and avoids trailing hyphen branch slugs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-132-ids-'));
    try {
      fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.agent/sdlc-config.json'),
        JSON.stringify({ version: '1.0.0', projectManagement: { provider: 'local', livingBoard: 'docs/KANBAN.md' }, modules: [] }),
        'utf8'
      );

      const pmMod = await import('../.agent/scripts/lib/pm-provider.mjs');
      const sessMod = await import('../.agent/scripts/lib/session.mjs');

      // 1. Burst local ticket creation (15 calls in <5ms) must yield 15 distinct numeric IDs
      const createdTickets = [];
      for (let i = 0; i < 15; i++) {
        const res = pmMod.createTicket({ title: `Burst Ticket ${i}`, type: 'feat', repoRoot: dir });
        createdTickets.push(res.issueId);
      }
      assert.equal(new Set(createdTickets.map(String)).size, 15, `local ticket IDs collided: ${createdTickets.join(', ')}`);
      for (const id of createdTickets) {
        assert.match(String(id), /^\d+$/);
      }

      // 2. Burst local session creation & trailing-hyphen slug sanitization
      const boundaryTitle = `${'a'.repeat(39)}-tail`;
      const localIds = [];
      for (let i = 0; i < 6; i++) {
        const begun = sessMod.executeCompositeStage({
          action: 'begin',
          localOnly: true,
          title: boundaryTitle,
          repoRoot: dir
        });
        localIds.push(begun.issueId);
        assert.equal(begun.branch.endsWith('-'), false, `branch slug must not end in hyphen: ${begun.branch}`);
      }
      assert.equal(new Set(localIds).size, 6, `local session IDs collided: ${localIds.join(', ')}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Issue #133: CI Portability, Config Validation, Wiki Stdout & Graph Fidelity', () => {
  it('defaults generated/tracked workflows and config runsOn to ubuntu-latest and enforces fail-closed config check in CI', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-133-ci-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'tmp-ci', version: '1.0.0' }), 'utf8');

      // 1. generateConfig & installCIWorkflow default to ubuntu-latest fallback
      const cfg = generateConfig(dir);
      assert.equal(cfg.ci?.runsOn, "${{ vars.SDLC_RUNS_ON || 'ubuntu-latest' }}");

      const wfRes = installCIWorkflow({ repoRoot: dir, force: true });
      assert.equal(wfRes.success, true);

      for (const wfRel of [
        '.github/workflows/sdlc-quality-gate.yml',
        '.github/workflows/enforce-branch-flow.yml',
        '.github/workflows/release.yml'
      ]) {
        const wf = fs.readFileSync(path.join(dir, wfRel), 'utf8');
        assert.match(wf, /runs-on:\s*\$\{\{\s*vars\.SDLC_RUNS_ON\s*\|\|\s*'ubuntu-latest'\s*\}\}/, `${wfRel} must fallback to ubuntu-latest`);
        assert.doesNotMatch(wf, /'self-hosted'/, `${wfRel} must not default to self-hosted`);
      }

      const generatedGateWf = fs.readFileSync(path.join(dir, '.github/workflows/sdlc-quality-gate.yml'), 'utf8');
      assert.match(generatedGateWf, /actions\/checkout@v7/);
      assert.match(generatedGateWf, /actions\/setup-node@v7/);
      assert.match(generatedGateWf, /node \.agent\/scripts\/sdlc-engine\.mjs config check/);
      assert.doesNotMatch(generatedGateWf, /node \.agent\/scripts\/sdlc-engine\.mjs detect\b/);

      // 2. Checked-in repository config & workflows use portable ubuntu-latest fallback and fail-closed config check
      const repoConfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.agent/sdlc-config.json'), 'utf8'));
      assert.equal(repoConfig.ci?.runsOn, "${{ vars.SDLC_RUNS_ON || 'ubuntu-latest' }}");

      for (const repoWfRel of [
        '.github/workflows/sdlc-quality-gate.yml',
        '.github/workflows/enforce-branch-flow.yml',
        '.github/workflows/publish-wiki.yml',
        '.github/workflows/release.yml'
      ]) {
        const content = fs.readFileSync(path.join(REPO_ROOT, repoWfRel), 'utf8');
        assert.match(content, /runs-on:\s*\$\{\{\s*vars\.SDLC_RUNS_ON\s*\|\|\s*'ubuntu-latest'\s*\}\}/, `Repo ${repoWfRel} must fallback to ubuntu-latest`);
        assert.doesNotMatch(content, /local-agentic-sdlc-framework/, `Repo ${repoWfRel} must not hardcode local-agentic-sdlc-framework`);
      }

      const repoGateWf = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/sdlc-quality-gate.yml'), 'utf8');
      assert.match(repoGateWf, /node \.agent\/scripts\/sdlc-engine\.mjs config check/);
      assert.doesNotMatch(repoGateWf, /node \.agent\/scripts\/sdlc-engine\.mjs detect\b/);

      // 3. CLI `config check` fails loudly without creating .agent/sdlc-config.json when missing or invalid
      const execEngineIn = (cwd, cmdArgs) =>
        spawnSync(process.execPath, [path.join(REPO_ROOT, '.agent/scripts/sdlc-engine.mjs'), ...cmdArgs], {
          cwd,
          encoding: 'utf8',
          env: childEnv()
        });

      const missingRes = execEngineIn(dir, ['config', 'check']);
      assert.notEqual(missingRes.status, 0, 'config check must exit non-zero when .agent/sdlc-config.json is missing');
      assert.equal(fs.existsSync(path.join(dir, '.agent/sdlc-config.json')), false, 'config check must not synthesize missing config');

      fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.agent/sdlc-config.json'), '{broken json', 'utf8');
      const brokenRes = execEngineIn(dir, ['config', 'check']);
      assert.notEqual(brokenRes.status, 0, 'config check must exit non-zero on invalid JSON');

      fs.writeFileSync(path.join(dir, '.agent/sdlc-config.json'), JSON.stringify({ version: '2.1.0', ci: { runsOn: 'bad\nrunner' }, modules: [] }), 'utf8');
      const badSchemaRes = execEngineIn(dir, ['config', 'check']);
      assert.notEqual(badSchemaRes.status, 0, 'config check must reject control characters in ci.runsOn');

      fs.writeFileSync(path.join(dir, '.agent/sdlc-config.json'), JSON.stringify(cfg, null, 2), 'utf8');
      const validRes = execEngineIn(dir, ['config', 'check']);
      assert.equal(validRes.status, 0, `valid config check failed: ${validRes.stderr}`);
      assert.match(validRes.stdout, /valid/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('emits human-readable stdout without --json for wiki map and core CLI verification commands', () => {
    const wikiMapRes = engine(REPO_ROOT, 'wiki', 'map');
    assert.equal(wikiMapRes.status, 0, `wiki map failed: ${wikiMapRes.stderr}`);
    assert.ok(wikiMapRes.stdout.trim().length > 0, 'wiki map without --json must print stdout');
    assert.match(wikiMapRes.stdout, /Codebase Map/i);
    assert.match(wikiMapRes.stdout, /core\.mjs/);
    assert.match(wikiMapRes.stdout, /\bI=/);

    const wikiMapJsonRes = engine(REPO_ROOT, 'wiki', 'map', '--json');
    assert.equal(wikiMapJsonRes.status, 0);
    const parsedMap = JSON.parse(wikiMapJsonRes.stdout);
    assert.ok(Array.isArray(parsedMap.codeMap?.modules));

    for (const cmdArgs of [
      ['wiki', 'audit'],
      ['arch', 'diff'],
      ['drift', 'check'],
      ['audit', 'verify'],
      ['config', 'check']
    ]) {
      const cliOut = engine(REPO_ROOT, ...cmdArgs);
      assert.equal(cliOut.status, 0, `${cmdArgs.join(' ')} failed: ${cliOut.stderr}`);
      assert.ok(cliOut.stdout.trim().length > 0, `${cmdArgs.join(' ')} without --json must emit deterministic stdout`);
    }
  });

  it('renders all Mermaid dependency edges including >45 edges and intra-ring cycles in renderCodebaseMapMarkdown', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-133-wiki-edges-'));
    try {
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(dir, '.archlens'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'wiki'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.archlens/policy.json'),
        JSON.stringify({
          title: 'Dense Graph Test',
          layers: [{ name: 'Ring 0: Core', paths: ['src/'], ring: 0 }]
        }),
        'utf8'
      );

      // Build 12 modules forming a complete graph minus self-loops -> 12 * 11 = 132 edges (>45) including tail cycle m10 <-> m11
      const names = Array.from({ length: 12 }, (_, idx) => `m${String(idx).padStart(2, '0')}.mjs`);
      for (let i = 0; i < names.length; i++) {
        const imports = names
          .filter((_, j) => j !== i)
          .map((other, idx) => `import { fn_${idx} } from './${other}';`)
          .join('\n');
        fs.writeFileSync(path.join(dir, 'src', names[i]), `${imports}\nexport function fn_${i}() { return ${i}; }\n`, 'utf8');
      }

      const wikiMod = await import('../.agent/scripts/lib/wiki-sync.mjs');
      const codeMap = wikiMod.buildWikiCodeMap(dir);
      const md = wikiMod.renderCodebaseMapMarkdown(codeMap);

      const mermaidBlock = md.match(/```mermaid\n([\s\S]*?)```/)?.[1] || '';
      const edgeLines = mermaidBlock.split('\n').filter((line) => /^\s*M_\S+\s*-->\s*M_\S+\s*$/.test(line));
      assert.equal(edgeLines.length, 132);
      assert.ok(edgeLines.length > 50, `Expected >50 rendered edges without .slice(0, 45), got ${edgeLines.length}`);
      assert.match(mermaidBlock, /M_src_m10_mjs --> M_src_m11_mjs/, 'tail intra-ring edge must not be truncated');
      assert.match(mermaidBlock, /M_src_m11_mjs --> M_src_m10_mjs/, 'reverse cycle edge must not be truncated');

      // Verify checked-in wiki/Codebase-Map.md also renders every import edge cleanly (none truncated at 45)
      const repoMap = wikiMod.buildWikiCodeMap(REPO_ROOT);
      const expectedRepoEdges = new Set();
      const repoNodes = new Set(repoMap.modules.map((m) => m.path));
      for (const m of repoMap.modules) {
        for (const imp of m.imports) {
          if (repoNodes.has(imp) && imp !== m.path) {
            expectedRepoEdges.add(`${m.path}->${imp}`);
          }
        }
      }
      const checkedInMap = fs.readFileSync(path.join(REPO_ROOT, 'wiki/Codebase-Map.md'), 'utf8');
      const checkedInMermaid = checkedInMap.match(/```mermaid\n([\s\S]*?)```/)?.[1] || '';
      const checkedInEdges = checkedInMermaid.split('\n').filter((line) => /^\s*M_\S+\s*-->\s*M_\S+\s*$/.test(line));
      assert.equal(
        checkedInEdges.length,
        expectedRepoEdges.size,
        `wiki/Codebase-Map.md must render all ${expectedRepoEdges.size} module edges, got ${checkedInEdges.length}`
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('removes dead workbench/src/routes probe in generateRegressionProof and supports clean findAffectedTests API', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-133-hygiene-'));
    try {
      const qgSource = fs.readFileSync(path.join(REPO_ROOT, '.agent/scripts/lib/quality-gate.mjs'), 'utf8');
      assert.equal(qgSource.includes('workbench/src/routes'), false, 'Dead workbench/src/routes probe must be removed');

      fs.mkdirSync(path.join(dir, '.agent/workbench'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.agent/workbench/index.html'), '<main>Live Workbench</main>\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'src/OrderEngine.mjs'), 'export const ok = true;\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'tests/OrderEngine.test.mjs'), '// unit test\n', 'utf8');

      const proof = qualityGateMod.generateRegressionProof({
        targetName: 'workbench',
        uiRoutes: [{ path: '/' }, { path: '/nonexistent', component: 'GhostView' }],
        repoRoot: dir
      });
      assert.equal(proof.uiProofs[0].verified, true);
      assert.equal(proof.uiProofs[0].sourceFile, '.agent/workbench/index.html');
      assert.equal(proof.uiProofs[1].verified, false);
      assert.equal(proof.uiProofs[1].sourceFile, null);

      const affected = qualityGateMod.findAffectedTests(['src/OrderEngine.mjs'], dir);
      assert.deepEqual(affected, ['tests/OrderEngine.test.mjs']);
      assert.deepEqual(qualityGateMod.findAffectededTests(['src/OrderEngine.mjs'], dir), ['tests/OrderEngine.test.mjs']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('validates every schema error path in validateConfigFile, runDoctor invalid config detection, and CLI formatters', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-133-cfg-branches-'));
    try {
      // Missing config file
      const missing = qualityGateMod.validateConfigFile(dir);
      assert.equal(missing.valid, false);
      assert.equal(missing.exists, false);

      fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
      const cfgPath = path.join(dir, '.agent/sdlc-config.json');

      // Malformed JSON
      fs.writeFileSync(cfgPath, '{not valid json', 'utf8');
      const malformed = qualityGateMod.validateConfigFile(dir);
      assert.equal(malformed.valid, false);
      assert.equal(malformed.exists, true);
      assert.match(malformed.errors[0], /Invalid JSON/);

      // Non-object top level
      fs.writeFileSync(cfgPath, '[]', 'utf8');
      const arrTop = qualityGateMod.validateConfigFile(dir);
      assert.equal(arrTop.valid, false);
      assert.match(arrTop.errors[0], /JSON object/);

      // All field validation error paths
      const badCases = [
        [{ version: '', modules: [] }, /'version'/],
        [{ version: '2.1.0', $schema: 123, generatedAt: 456, modules: [] }, /'\$schema'/],
        [{ version: '2.1.0', profile: 'invalid-profile', modules: [] }, /Invalid 'profile'/],
        [{ version: '2.1.0', ci: 'bad', modules: [] }, /'ci' must be an object/],
        [{ version: '2.1.0', ci: { runsOn: '' }, modules: [] }, /'ci\.runsOn' must be a non-empty string without control characters/],
        [{ version: '2.1.0', ci: { runsOn: 'ubuntu-\x07bell' }, modules: [] }, /'ci\.runsOn' must be a non-empty string without control characters/],
        [{ version: '2.1.0', ci: { runsOn: ['ubuntu-latest', 'bad\nrunner'] }, modules: [] }, /Every entry in 'ci\.runsOn' array/],
        [{ version: '2.1.0', ci: { runsOn: [] }, modules: [] }, /'ci\.runsOn' must be a non-empty string or non-empty array/],
        [{ version: '2.1.0', lanes: 'bad', modules: [] }, /'lanes' must be an object/],
        [{ version: '2.1.0', lanes: { trivialMaxLines: 0, standardMaxLines: -5 }, modules: [] }, /'lanes\.trivialMaxLines'/],
        [{ version: '2.1.0', projectManagement: 'bad', modules: [] }, /'projectManagement' must be an object/],
        [{ version: '2.1.0', projectManagement: { provider: 'bugzilla', key: 12, livingBoard: 34 }, modules: [] }, /projectManagement\.provider/],
        [{ version: '2.1.0', archlens: 'bad', modules: [] }, /'archlens' must be an object/],
        [{ version: '2.1.0', archlens: { enabled: 'yes', policyPath: 12, enforceInQualityGate: 'no', workbenchPort: 0 }, modules: [] }, /'archlens\.workbenchPort'/],
        [{ version: '2.1.0', modules: 'not-array' }, /Missing required 'modules' array/],
        [{ version: '2.1.0', modules: ['bad-mod'] }, /modules\[0\] must be an object/],
        [{ version: '2.1.0', modules: [{ path: '.' }] }, /modules\[0\]\.name/],
        [{ version: '2.1.0', modules: [{ name: 'root', path: '.' }] }, /modules\[0\]\.commands/],
        [{ version: '2.1.0', modules: [{ name: 'root', path: '.', stack: 12, language: 34, commands: { test: 42, lint: 99, coverageFile: 7 } }] }, /modules\[0\]\.commands\.test/],
        [{ version: '2.1.0', modules: [{ name: 'root', path: '.', commands: { test: 'node --test' }, thresholds: 'bad' }] }, /modules\[0\]\.thresholds must be an object/],
        [{ version: '2.1.0', modules: [{ path: '', thresholds: { diffCoverage: 150, mutationScore: -1 } }] }, /modules\[0\]\.path/]
      ];
      for (const [payload, expectedRegex] of badCases) {
        fs.writeFileSync(cfgPath, JSON.stringify(payload), 'utf8');
        const res = qualityGateMod.validateConfigFile(dir);
        assert.equal(res.valid, false, `Expected invalid for ${JSON.stringify(payload)}`);
        assert.match(res.errors.join(' | '), expectedRegex);

        const cliInvalid = runCLI(['config', 'check'], null, dir);
        assert.equal(cliInvalid.success, false);
        assert.equal(cliInvalid.exitCode, 1);
        const formattedErr = formatCLIResult(cliInvalid, ['config', 'check']);
        assert.match(formattedErr, /Config Check Failed/);
      }

      // runDoctor flags invalid config cleanly
      fs.writeFileSync(cfgPath, JSON.stringify({ version: '2.1.0', modules: [{ name: 'root', path: '.', commands: { test: 'node --test' }, thresholds: { diffCoverage: 120 } }] }), 'utf8');
      const doc = runDoctor(dir);
      assert.equal(doc.configValidation.valid, false);
      assert.equal(doc.assets.find((a) => a.path === '.agent/sdlc-config.json')?.status, false);

      // Unknown subcommand on `config` exits cleanly with code 2
      const badSub = runCLI(['config', 'bogus'], null, dir);
      assert.equal(badSub.success, false);
      assert.equal(badSub.exitCode, 2);

      // Valid config (including archlens + docs-only nullable diffCoverage) passes validate, schema parity, and formatCLIResult
      const configSchema = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.agent/schemas/sdlc-config.schema.json'), 'utf8'));
      assert.deepEqual(configSchema.properties.modules.items.properties.thresholds.properties.diffCoverage.type, ['number', 'null']);
      fs.writeFileSync(
        cfgPath,
        JSON.stringify({
          $schema: './schemas/sdlc-config.schema.json',
          version: '2.1.0',
          generatedAt: '2026-11-14T00:00:00.000Z',
          profile: 'custom',
          ci: { runsOn: ['ubuntu-latest'] },
          lanes: { trivialMaxLines: 25, standardMaxLines: 200 },
          projectManagement: { provider: 'github', key: 'SDLC', livingBoard: 'docs/KANBAN.md' },
          archlens: { enabled: true, policyPath: '.archlens/policy.json', enforceInQualityGate: true, workbenchPort: 8088 },
          modules: [
            {
              name: 'root',
              path: '.',
              stack: 'nodejs-npm',
              language: 'javascript',
              commands: { test: 'node --test', lint: null, build: ['node', '-e', '0'], mutation: null, coverageFile: 'coverage/lcov.info' },
              thresholds: { diffCoverage: null, mutationScore: null }
            }
          ]
        }),
        'utf8'
      );
      const cliValid = runCLI(['config', 'validate'], cfgPath, dir);
      assert.equal(cliValid.success, true);
      assert.match(formatCLIResult(cliValid, ['config', 'validate']), /is valid \(1 module\(s\), profile=custom\)/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// Issue #134: Wave 2 Clean Architecture Cycle Breakup & Quality-Gate Decomposition
// ===========================================================================
describe('Issue #134: Ring 2 cycle breakup, quality-gate decomposition, intra-layer cycle checkArchDiff, Archlens policy alignment, and Ring 0 shell removal', () => {
  it('detects intra-ring mutual cycles, transitive cycles, and dynamic import()/require() violations while ignoring comments', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-134-archdiff-'));
    try {
      git(dir, 'init', '-q');
      git(dir, 'config', 'user.email', 'test@example.com');
      git(dir, 'config', 'user.name', 'Test User');
      git(dir, 'checkout', '-q', '-b', 'develop');

      fs.mkdirSync(path.join(dir, '.archlens'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'src/domain'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'src/usecases'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'src/adapters'), { recursive: true });

      fs.writeFileSync(
        path.join(dir, '.archlens/policy.json'),
        JSON.stringify({
          title: 'cycle-test',
          src: 'src',
          prefix: null,
          hierarchical: true,
          order: ['domain', 'usecases', 'adapters'],
          levels: [['src/domain'], ['src/usecases'], ['src/adapters']],
          lang: 'typescript'
        }),
        'utf8'
      );

      // Baseline on develop: adapters/a.mjs imports adapters/b.mjs (valid intra-ring one-way edge) + commented/method-call fake imports
      fs.writeFileSync(
        path.join(dir, 'src/domain/entity.mjs'),
        '// import { db } from "../adapters/b.mjs";\n/*\n * placeholder comment\n */\nexport const id = 1;\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(dir, 'src/usecases/order.mjs'),
        'import { id } from "../domain/entity.mjs";\nconst auth = { require: (x) => x };\nauth.require("../adapters/b.mjs");\nexport const runOrder = () => id;\n',
        'utf8'
      );
      fs.writeFileSync(path.join(dir, 'src/adapters/b.mjs'), 'import { id } from "../domain/entity.mjs";\nexport const bFn = () => id;\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'src/adapters/a.mjs'), 'import { bFn } from "./b.mjs";\nexport const aFn = () => bFn();\n', 'utf8');

      git(dir, 'add', '.');
      git(dir, 'commit', '-q', '--no-verify', '-m', 'chore: baseline acyclic graph');

      const { checkArchDiff } = await import('../.agent/scripts/lib/arch-trace.mjs');
      const baselineRes = checkArchDiff(dir);
      assert.equal(baselineRes.enabled, true);
      assert.equal(baselineRes.passed, true);
      assert.equal(baselineRes.cyclesCount, 0);

      // Adding a line inside an existing block comment in domain/entity.mjs must be ignored cleanly
      fs.writeFileSync(
        path.join(dir, 'src/domain/entity.mjs'),
        '// import { db } from "../adapters/b.mjs";\n/*\n * import { bFn } from "../adapters/b.mjs";\n */\nexport const id = 1;\n',
        'utf8'
      );
      const commentEditRes = checkArchDiff(dir);
      assert.equal(commentEditRes.passed, true);
      assert.equal(commentEditRes.cyclesCount, 0);

      // Introduce an intra-ring mutual cycle (adapters/b <-> a), a 3-node transitive cycle (c -> d -> e -> c), AND dynamic import + re-export inversion in usecases
      fs.writeFileSync(
        path.join(dir, 'src/adapters/b.mjs'),
        'import { id } from "../domain/entity.mjs";\nconst aMod = require("./a.mjs");\nexport const bFn = () => id + Boolean(aMod);\n',
        'utf8'
      );
      fs.writeFileSync(path.join(dir, 'src/adapters/c.mjs'), 'import { dFn } from "./d.mjs";\nexport const cFn = () => dFn();\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'src/adapters/d.mjs'), 'import { eFn } from "./e.mjs";\nexport const dFn = () => eFn();\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'src/adapters/e.mjs'), 'import { cFn } from "./c.mjs";\nexport const eFn = () => cFn();\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, 'src/usecases/order.mjs'),
        'import { id } from "../domain/entity.mjs";\nexport { cFn } from "../adapters/c.mjs";\nexport async function runOrder() { return (await import("../adapters/b.mjs")).bFn() + id; }\n',
        'utf8'
      );

      const badRes = checkArchDiff(dir);
      assert.equal(badRes.passed, false);
      assert.ok(badRes.cyclesCount >= 2, `Expected both 2-node and 3-node cycles detected, got ${JSON.stringify(badRes)}`);
      assert.ok(badRes.violations.some((v) => v.type === 'CYCLE' && /a\.mjs/.test(v.rule) && /b\.mjs/.test(v.rule)));
      assert.ok(badRes.violations.some((v) => v.type === 'CYCLE' && /c\.mjs/.test(v.rule) && /d\.mjs/.test(v.rule) && /e\.mjs/.test(v.rule)));
      assert.ok(badRes.violations.some((v) => v.sourceLayer === 'usecases' && v.targetLayer === 'adapters' && v.imported.includes('b.mjs')));
      assert.ok(badRes.violations.some((v) => v.sourceLayer === 'usecases' && v.targetLayer === 'adapters' && v.imported.includes('c.mjs')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the .agent/scripts module graph 100% acyclic with zero Ring 2 circular dependencies', async () => {
    const wikiMod = await import('../.agent/scripts/lib/wiki-sync.mjs');
    const codeMap = wikiMod.buildWikiCodeMap(REPO_ROOT);

    // Build full adjacency list from inspectSourceModule across all engine/lib modules
    const graph = new Map();
    for (const mod of codeMap.modules) {
      graph.set(
        mod.path,
        mod.imports.filter((imp) => codeMap.modules.some((m) => m.path === imp))
      );
    }

    const visited = new Set();
    const stack = new Set();
    const trace = [];
    const foundCycles = [];
    const dfs = (node) => {
      visited.add(node);
      stack.add(node);
      trace.push(node);
      for (const next of graph.get(node) || []) {
        if (!visited.has(next)) {
          dfs(next);
        } else if (stack.has(next)) {
          const idx = trace.indexOf(next);
          foundCycles.push(trace.slice(idx).concat(next));
        }
      }
      trace.pop();
      stack.delete(node);
    };
    for (const modPath of graph.keys()) {
      if (!visited.has(modPath)) dfs(modPath);
    }

    assert.deepEqual(foundCycles, [], `Expected zero cycles across .agent/scripts, found: ${JSON.stringify(foundCycles)}`);

    // Verify specific broken Ring 2 cycle pairs
    const byPath = new Map(codeMap.modules.map((m) => [m.path, m.imports]));
    assert.equal(byPath.get('.agent/scripts/lib/arch-trace.mjs')?.includes('.agent/scripts/lib/session.mjs'), false);
    assert.equal(byPath.get('.agent/scripts/lib/workbench-server.mjs')?.includes('.agent/scripts/lib/session.mjs'), false);
    assert.equal(byPath.get('.agent/scripts/lib/wiki-sync.mjs')?.includes('.agent/scripts/lib/installer.mjs'), false);
    assert.equal(byPath.get('.agent/scripts/lib/session.mjs')?.includes('.agent/scripts/lib/quality-gate.mjs'), false);
    assert.deepEqual(byPath.get('.agent/scripts/lib/core.mjs'), []);

    // Verify live repo checkArchDiff passes with zero cycles
    const { checkArchDiff } = await import('../.agent/scripts/lib/arch-trace.mjs');
    const liveArch = checkArchDiff(REPO_ROOT);
    assert.equal(liveArch.enabled, true);
    assert.equal(liveArch.passed, true);
    assert.equal(liveArch.cyclesCount, 0);
  });

  it('decomposes quality-gate.mjs into 4 focused modules while preserving 100% of public named exports and aligned .archlens/policy.json', async () => {
    const decomposedFiles = [
      '.agent/scripts/lib/coverage-mutation.mjs',
      '.agent/scripts/lib/security-audit.mjs',
      '.agent/scripts/lib/doctor-ci.mjs',
      '.agent/scripts/lib/triage-review.mjs'
    ];
    for (const rel of decomposedFiles) {
      const abs = path.join(REPO_ROOT, rel);
      assert.equal(fs.existsSync(abs), true, `Expected decomposed module ${rel} to exist`);
      const lineCount = fs.readFileSync(abs, 'utf8').split('\n').length;
      assert.ok(lineCount > 50 && lineCount < 1400, `Expected ${rel} to be cohesive, got ${lineCount} lines`);
    }

    const qgLineCount = fs.readFileSync(path.join(REPO_ROOT, '.agent/scripts/lib/quality-gate.mjs'), 'utf8').split('\n').length;
    assert.ok(qgLineCount < 120, `Expected slim quality-gate.mjs barrel (<120 lines), got ${qgLineCount}`);

    const expectedExports = [
      'validateConfigFile',
      'runDoctor',
      'generateRegressionProof',
      'monitorCanaryHealthAndWatchdog',
      'installCIWorkflow',
      'exportAgentRules',
      'scaffoldReproductionTest',
      'assessRisk',
      'VALID_LANES',
      'LANE_RANK',
      'triageChange',
      'generatePRSummary',
      'findAffectedTests',
      'findAffectededTests',
      'buildSingleTestArgv',
      'buildSingleTestCommand',
      'parseCoverageReport',
      'parseMutationReport',
      'runFlakeCheck',
      'auditSecurity',
      'suggestMutationStrengthening',
      'resolveAdHocTargets',
      'generateReviewPlan',
      'inspectCIWorkflows',
      'detectStackInDir',
      'discoverModules',
      'matchFilesToModules',
      'generateConfig',
      'printPreview',
      'auditSkills'
    ];
    const engineMod = await import('../.agent/scripts/sdlc-engine.mjs');
    for (const sym of expectedExports) {
      assert.notEqual(qualityGateMod[sym], undefined, `Expected quality-gate.mjs to preserve export '${sym}'`);
      assert.notEqual(engineMod[sym], undefined, `Expected sdlc-engine.mjs to preserve export '${sym}'`);
    }

    // Repo .archlens/policy.json uses Archlens MCP canonical order/levels schema covering all 21 modules
    const repoPolicy = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.archlens/policy.json'), 'utf8'));
    assert.equal('layers' in repoPolicy, false, 'Repo .archlens/policy.json must omit legacy layers key for Archlens MCP');
    assert.equal(Array.isArray(repoPolicy.order), true);
    assert.equal(Array.isArray(repoPolicy.levels), true);
    assert.deepEqual(repoPolicy.levels.map((grp) => grp.length), [4, 6, 10, 1]);
  });
});

// ===========================================================================
// Issue #135: Workbench asset externalization, CSP/headers, dialect hygiene, global portability & template sync
// ===========================================================================
describe('Issue #135: Workbench asset externalization, security headers, dialect hygiene & global portability', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-135-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('externalizes HTML/CSS/JS out of workbench-server.mjs, sets strict CSP/security headers, and removes stale SvelteKit copy', async () => {
    const assetsDir = path.join(REPO_ROOT, '.agent/scripts/workbench-assets');
    for (const f of ['workbench.css', 'shared-client.js', 'widget.html', 'widget.js', 'mission-control.html', 'mission-control.js']) {
      assert.equal(fs.existsSync(path.join(assetsDir, f)), true, `Missing external workbench asset: ${f}`);
    }

    const serverLines = fs.readFileSync(path.join(REPO_ROOT, '.agent/scripts/lib/workbench-server.mjs'), 'utf8').split('\n').length;
    assert.ok(serverLines < 650, `Expected slim workbench-server.mjs (<650 lines), got ${serverLines}`);

    createADR({ title: 'Workbench ADR', scope: 'product', ticketId: 135, decision: 'Use external assets', repoRoot: dir });
    const wb = createWorkbenchServer({ port: 0, repoRoot: dir });

    for (const route of [`/?token=${wb.token}`, `/widget?token=${wb.token}`, `/api/status?token=${wb.token}`, '/api/status']) {
      const res = await dispatchReq(wb, 'GET', route);
      assert.equal(res.headers['x-content-type-options'], 'nosniff', `${route} must set X-Content-Type-Options: nosniff`);
      assert.equal(res.headers['referrer-policy'], 'no-referrer', `${route} must set Referrer-Policy: no-referrer`);
      const csp = String(res.headers['content-security-policy'] || '');
      assert.match(csp, /script-src 'nonce-[^']+'/, `${route} CSP must require a per-request script nonce`);
      assert.match(csp, /style-src 'nonce-[^']+'/, `${route} CSP must require a per-request style nonce`);
      assert.equal(csp.includes('unsafe-inline'), false, `${route} CSP must never allow unsafe-inline`);
      assert.match(csp, /object-src 'none'/);
      assert.match(csp, /base-uri 'none'/);
      assert.match(csp, /frame-ancestors 'none'/);

      if (route.startsWith('/?') || route.startsWith('/widget')) {
        const nonceMatch = csp.match(/script-src 'nonce-([^']+)'/);
        assert.ok(nonceMatch, 'CSP script-src nonce must be present');
        assert.ok(res.body.includes(`<style nonce="${nonceMatch[1]}">`), `${route} style tag must carry matching CSP nonce`);
        assert.ok(res.body.includes(`<script nonce="${nonceMatch[1]}">`), `${route} script tag must carry matching CSP nonce`);
        assert.doesNotMatch(res.body, /\bon(?:click|input)=["']/, `${route} must not use inline event handler attributes`);
        assert.doesNotMatch(res.body, /\bstyle=["']/, `${route} must not emit inline style attributes`);
        assert.doesNotMatch(res.body, /\{\{[A-Z0-9_]+\}\}/, `${route} must not leave unresolved template placeholders`);
      }
    }

    const adrRes = await dispatchReq(wb, 'POST', '/api/adr/decide', {
      body: { adrId: listADRs(dir)[0].id, action: 'approve', reviewer: '@qa' },
      headers: { 'X-SDLC-Token': wb.token }
    });
    assert.equal(adrRes.status, 200);
    assert.doesNotMatch(adrRes.body, /SvelteKit/i, 'Default workbench ADR reason must not mention SvelteKit');

    productDagMod.initProductConstitution({
      title: 'Clean Workbench Spec',
      capabilities: [{ id: 'CAP-01', title: 'Core Engine' }],
      repoRoot: dir
    });
    const srs = fs.readFileSync(path.join(dir, 'docs/SRS.md'), 'utf8');
    assert.doesNotMatch(srs, /SvelteKit/i, 'Generated SRS C4 diagram must not reference SvelteKit');

    const { checkArchDiff } = await import('../.agent/scripts/lib/arch-trace.mjs');
    const liveArch = checkArchDiff(REPO_ROOT);
    assert.equal(liveArch.passed, true);
    assert.equal(liveArch.cyclesCount, 0);
  });

  it('strips TypeName/conversationId/BypassSandbox leaks across all runtimes and quotes globs: "*" in Cursor rules', () => {
    const sample =
      'Call `invoke_subagent` (`TypeName: "research"`). Message same subagent `conversationId`s. Re-run (`BypassSandbox: true`).';
    const claudeText = installerMod.toClaudeDialect(sample);
    for (const leak of ['TypeName', 'conversationId', 'BypassSandbox']) {
      assert.equal(claudeText.includes(leak), false, `toClaudeDialect leaked '${leak}'`);
    }

    provisionAgentIntegrations({ agents: 'all', targetDir: dir, packageRoot: REPO_ROOT });

    const generatedFiles = [];
    const walkDirs = [
      path.join(dir, '.claude/skills'),
      path.join(dir, '.cursor/skills'),
      path.join(dir, '.cursor/rules'),
      path.join(dir, '.grok/skills'),
      path.join(dir, '.windsurf/workflows'),
      path.join(dir, '.github/prompts')
    ];
    for (const rootDir of walkDirs) {
      if (!fs.existsSync(rootDir)) continue;
      for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
        const full = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
          for (const sub of fs.readdirSync(full)) {
            if (sub.endsWith('.md')) generatedFiles.push(path.join(full, sub));
          }
        } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdc')) {
          generatedFiles.push(full);
        }
      }
    }
    assert.ok(generatedFiles.length >= 40, `Expected >=40 generated agent files, got ${generatedFiles.length}`);

    for (const f of generatedFiles) {
      const text = fs.readFileSync(f, 'utf8');
      for (const forbidden of [
        /\bTypeName\b/,
        /\bconversationId\b/,
        /\bBypassSandbox\b/,
        /<agent-embed\b/,
        /<artifactDir>/,
        /\b(?:read_file|write_file|edit_file|run_command|invoke_subagent)\b/
      ]) {
        assert.equal(forbidden.test(text), false, `${path.relative(dir, f)} leaked ${forbidden}`);
      }
      if (f.endsWith('.mdc')) {
        assert.match(text, /^globs:\s*"\*"$/m, `${path.relative(dir, f)} must quote globs: "*"`);
      }
    }

    // Checked-in .claude/ and .cursor/ files in REPO_ROOT must match the leak-free generator output
    for (const sk of CANONICAL_SDLC_SKILLS) {
      for (const rel of [
        `.claude/skills/${sk}/SKILL.md`,
        `.cursor/skills/${sk}/SKILL.md`,
        `.cursor/rules/${sk}.mdc`
      ]) {
        const raw = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
        assert.equal(/\b(TypeName|conversationId|BypassSandbox)\b/.test(raw), false, `Checked-in ${rel} contains Antigravity leak`);
        if (rel.endsWith('.mdc')) {
          assert.match(raw, /^globs:\s*"\*"$/m, `Checked-in ${rel} must quote globs: "*"`);
        }
      }
    }
    const masterRule = fs.readFileSync(path.join(REPO_ROOT, '.cursor/rules/agentic-sdlc.mdc'), 'utf8');
    assert.match(masterRule, /^globs:\s*"\*"$/m, 'Checked-in .cursor/rules/agentic-sdlc.mdc must quote globs: "*"');
  });

  it('makes --global installs portable across repos without local .agent/scripts/ and keeps release/issue/PR templates aligned', () => {
    const fakeHome = path.join(dir, 'home');
    const emptyRepo = path.join(dir, 'empty-user-repo');
    fs.mkdirSync(fakeHome, { recursive: true });
    fs.mkdirSync(emptyRepo, { recursive: true });

    const res = installFramework({
      global: true,
      homeDir: fakeHome,
      agents: ['gemini', 'claude', 'cursor', 'grok', 'windsurf', 'copilot'],
      skipDetect: true,
      packageRoot: REPO_ROOT
    });
    assert.equal(res.success, true);

    const globalEngineScript = path.join(fakeHome, '.agentic-sdlc/scripts/sdlc-engine.mjs');
    assert.equal(fs.existsSync(globalEngineScript), true, 'Global install must copy scripts to ~/.agentic-sdlc/scripts/');

    const grokSettings = JSON.parse(fs.readFileSync(path.join(fakeHome, '.grok/settings.json'), 'utf8'));
    assert.equal(
      grokSettings.engineCommand.includes('.agent/scripts/sdlc-engine.mjs') && !grokSettings.engineCommand.includes('$HOME/.agentic-sdlc'),
      false,
      `Global grok settings engineCommand must reference global engine path, got: ${grokSettings.engineCommand}`
    );

    const helpRun = spawnSync('sh', ['-c', `${grokSettings.engineCommand} --help`], {
      cwd: emptyRepo,
      encoding: 'utf8',
      env: { ...childEnv(), HOME: fakeHome }
    });
    assert.equal(helpRun.status, 0, `Global engineCommand must run inside empty repo: ${helpRun.stderr}`);

    for (const rel of [
      '.claude/skills/sdlc/SKILL.md',
      '.claude/skills/sdlc-flow/SKILL.md',
      '.cursor/rules/agentic-sdlc.mdc',
      '.grok/GROK.md',
      '.codeium/windsurf/memories/global_rules.md',
      '.github/copilot-instructions.md',
      '.github/prompts/sdlc-flow.prompt.md'
    ]) {
      const content = fs.readFileSync(path.join(fakeHome, rel), 'utf8');
      assert.equal(
        /\bnode \.agent\/scripts\/sdlc-engine\.mjs\b/.test(content),
        false,
        `Global file ${rel} must not hardcode bare 'node .agent/scripts/sdlc-engine.mjs'`
      );
    }

    const releaseSkill = fs.readFileSync(path.join(REPO_ROOT, '.agent/skills/sdlc-release/SKILL.md'), 'utf8');
    assert.match(releaseSkill, /release <patch\|minor\|major> --no-tag\b/m);
    const step3Lines = releaseSkill.split('\n').filter((l) => l.includes('sdlc-engine.mjs release <'));
    assert.ok(
      step3Lines.some((l) => l.includes('--no-tag') && !l.includes('--dry-run')),
      'sdlc-release Step 3 execution command must pass --no-tag'
    );

    for (const tplRel of [
      '.github/ISSUE_TEMPLATE/bug_report.md',
      '.github/ISSUE_TEMPLATE/feature_request.md',
      '.github/ISSUE_TEMPLATE/architecture_spike.md',
      '.github/ISSUE_TEMPLATE/hotfix_incident.md',
      '.github/PULL_REQUEST_TEMPLATE.md'
    ]) {
      const tpl = fs.readFileSync(path.join(REPO_ROOT, tplRel), 'utf8');
      assert.doesNotMatch(tpl, /(?:svelte|spotless|mvnw)/i, `${tplRel} still contains stale stack reference`);
      for (const stale of ['sdlc-tdd-implement', 'sdlc-feature-spec', 'sdlc-quality-gate', 'sdlc-test-coverage', 'sdlc-peer-review', 'sdlc-kanban']) {
        assert.equal(tpl.includes(stale), false, `${tplRel} still contains stale reference '${stale}'`);
      }
    }
  });

  it('prevents empty ADR supersedes fields from capturing createdAt and escapes <, >, &, and line separators in SSR script payloads', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-135-adr-xss-'));
    try {
      const adrDir = path.join(tmp, 'docs/adr');
      fs.mkdirSync(adrDir, { recursive: true });
      fs.writeFileSync(
        path.join(adrDir, 'ADR-001-empty-supersedes.md'),
        '---\nid: ADR-001\ntitle: Empty Supersedes\nstatus: accepted\nscope: technical\nticket: #1\nsupersedes: \ncreatedAt: 2026-11-14T00:00:00.000Z\n---\n',
        'utf8'
      );
      const { listADRs } = await import(new URL('../.agent/scripts/lib/decision-graph.mjs', import.meta.url).href);
      const adrs = listADRs(tmp);
      assert.equal(adrs.length, 1);
      assert.deepEqual(adrs[0].supersedes, [], 'Empty supersedes: must not capture next YAML line createdAt');

      const assetsDir = path.join(REPO_ROOT, '.agent/scripts/workbench-assets');
      for (const f of fs.readdirSync(assetsDir)) {
        if (!f.endsWith('.html') && !f.endsWith('.js')) continue;
        const body = fs.readFileSync(path.join(assetsDir, f), 'utf8');
        assert.doesNotMatch(body, /\bstyle\s*=/, `Inline style attribute found in workbench asset ${f}`);
      }

      const { renderWorkbenchHTML } = await import(new URL('../.agent/scripts/lib/workbench-server.mjs', import.meta.url).href);
      const evil = '</script><script>alert(1)&>\u2028\u2029';
      const html = renderWorkbenchHTML(tmp, () => ({ active: true, session: { issueId: '1', stage: 2, branch: evil, lane: 'full' } }), { cspNonce: 'testnonce123' });
      assert.ok(html.includes('<style nonce="testnonce123">'), 'HTML must attach CSP nonce to inline <style>');
      assert.ok(html.includes('<script nonce="testnonce123">'), 'HTML must attach CSP nonce to inline <script>');
      const [, scriptSection = ''] = html.split('<script nonce="testnonce123">');
      assert.equal(scriptSection.includes('</script><script>alert(1)'), false, 'safeJsonScriptPayload must neutralize </script> breakout');
      assert.equal(scriptSection.includes('\u2028') || scriptSection.includes('\u2029'), false, 'safeJsonScriptPayload must escape U+2028/U+2029 line separators inside script block');
      assert.ok(
        scriptSection.includes('\\u003c/script\\u003e') &&
          scriptSection.includes('\\u0026') &&
          scriptSection.includes('\\u003e') &&
          scriptSection.includes('\\u2028') &&
          scriptSection.includes('\\u2029'),
        'safeJsonScriptPayload must escape <, >, &, U+2028, and U+2029'
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
