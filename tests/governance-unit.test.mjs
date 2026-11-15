import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PassThrough } from 'node:stream';

import {
  DEFAULT_QUALITY_THRESHOLDS,
  loadConfig,
  loadEnv,
  fileExists,
  readFileSafe,
  normalizeTicketId,
  parseTicketId,
  resolveInsideRepo,
  writeFileAtomic,
  sameShaPrefix,
  resolveQualityThresholds,
  parseCommandArgv,
  runConfiguredCommand,
  runParallelTasks,
  parseFrontmatter,
  inspectArchlens,
  detectPMProvider,
  extractAddedLinesFromDiff,
  readSessionRegistry,
  getExemptionsPath,
  getExemptions
} from '../.agent/scripts/lib/core.mjs';

import {
  AUDIT_LEDGER_FILE,
  GENESIS_HASH,
  calculateRecordHash,
  appendAuditRecord,
  verifyAuditChain,
  loadReceiptKey,
  signReceiptPayload,
  verifyReceiptSignature,
  issueGateReceipt,
  verifyGateReceipt
} from '../.agent/scripts/lib/audit-chain.mjs';

import {
  verifyCommitGuard,
  verifyMergeGuard,
  verifyPushGuard,
  buildHookTemplates,
  inspectHooksHealth,
  installHooks,
  DEFAULT_QUALITY_GATE_CHECK,
  applyBranchProtection
} from '../.agent/scripts/lib/git-guard.mjs';

import {
  listADRs,
  createADR,
  decideADR,
  compactADRs,
  checkSpecDrift,
  auditContractDrift
} from '../.agent/scripts/lib/adr-drift.mjs';

import {
  getSessionStatus,
  startSession,
  updateSession,
  switchSession,
  listSessions,
  renderDashboard,
  resumeSession,
  releaseSession,
  recordExemption,
  calculateSessionStats,
  receiptInputsFromSession,
  reconcileSessionLaneWithDiff
} from '../.agent/scripts/lib/session.mjs';

import {
  checkArchDiff,
  parseMermaidDiagram,
  diffMermaidGraphs,
  scaffoldArchlensPolicy
} from '../.agent/scripts/lib/arch-trace.mjs';

import {
  buildSingleTestArgv,
  buildSingleTestCommand,
  parseCoverageReport,
  parseMutationReport,
  suggestMutationStrengthening
} from '../.agent/scripts/lib/coverage-mutation.mjs';

import {
  scaffoldReproductionTest,
  assessRisk,
  VALID_LANES,
  LANE_RANK,
  triageChange,
  generatePRSummary,
  findAffectedTests,
  resolveAdHocTargets,
  generateReviewPlan,
  auditSkills
} from '../.agent/scripts/lib/triage-review.mjs';

import {
  createWorkbenchServer,
  renderWorkbenchHTML,
  generateArchitectureWidget
} from '../.agent/scripts/lib/workbench-server.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

function dispatchHttp(wb, method, urlPath, { body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = new PassThrough();
    req.method = method;
    req.url = urlPath;
    req.socket = { remoteAddress: '127.0.0.1' };
    const payload = body === null || body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
    req.headers = {
      host: `127.0.0.1:${wb.port}`,
      ...(payload !== null ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) } : {}),
      ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    };

    const resHeaders = {};
    let statusCode = 200;
    const chunks = [];
    const res = {
      headersSent: false,
      writeHead(code, hdrs = {}) {
        statusCode = code;
        res.headersSent = true;
        for (const [k, v] of Object.entries(hdrs)) resHeaders[String(k).toLowerCase()] = v;
        return res;
      },
      setHeader(k, v) {
        resHeaders[String(k).toLowerCase()] = v;
      },
      write(chunk) {
        if (chunk !== undefined && chunk !== null) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'));
        }
      },
      end(chunk) {
        res.headersSent = true;
        if (chunk !== undefined && chunk !== null) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'));
        }
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}
        resolve({ status: statusCode, headers: resHeaders, body: text, json });
      }
    };

    Promise.resolve(wb.handleRequest(req, res)).catch(reject);
    if (payload !== null) req.end(payload);
    else req.end();
  });
}

describe('Governance Core Unit & Mutation Suite (#136)', () => {
  let tmpDir;
  let origReceiptKey;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-gov-unit-'));
    origReceiptKey = process.env.SDLC_RECEIPT_KEY;
    delete process.env.SDLC_RECEIPT_KEY;
  });

  afterEach(() => {
    if (origReceiptKey !== undefined) process.env.SDLC_RECEIPT_KEY = origReceiptKey;
    else delete process.env.SDLC_RECEIPT_KEY;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Stryker Mutation Configuration & Thresholds', () => {
    it('expands stryker.config.json across core governance modules with enforced break threshold >= 52', () => {
      const cfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'stryker.config.json'), 'utf8'));
      const expectedMutate = [
        '.agent/scripts/lib/audit-chain.mjs',
        '.agent/scripts/lib/git-guard.mjs',
        '.agent/scripts/lib/core.mjs',
        '.agent/scripts/lib/adr-drift.mjs',
        '.agent/scripts/lib/session.mjs',
        '.agent/scripts/lib/arch-trace.mjs',
        '.agent/scripts/lib/coverage-mutation.mjs',
        '.agent/scripts/lib/triage-review.mjs'
      ];
      for (const target of expectedMutate) {
        assert.ok(cfg.mutate.includes(target), `stryker.config.json mutate must include ${target}`);
      }
      assert.ok(cfg.thresholds && typeof cfg.thresholds.break === 'number', 'stryker.config.json must configure numeric thresholds.break');
      assert.ok(cfg.thresholds.break >= 52, `Expected stryker.config.json thresholds.break >= 52, got ${cfg.thresholds.break}`);
    });
  });

  describe('Polyglot Mutation Report Parsers & Fail-Closed Diagnostics', () => {
    function writeMutCfg(minMut = 75) {
      fs.mkdirSync(path.join(tmpDir, '.agent'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, '.agent/sdlc-config.json'),
        JSON.stringify({ version: '2.1.0', modules: [{ name: 'mod', path: '.', thresholds: { diffCoverage: 80, mutationScore: minMut } }] }),
        'utf8'
      );
    }

    it('parses Rust cargo mutants outcomes.json (array & counters) with exact boundary checks and exemptions', () => {
      writeMutCfg(75);
      fs.mkdirSync(path.join(tmpDir, 'mutants.out'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'mutants.out/outcomes.json'),
        JSON.stringify({
          total_mutants: 5,
          caught: 2,
          missed: 1,
          timeout: 1,
          unviable: 1,
          outcomes: [
            { scenario: { Mutant: { file: 'src/lib.rs', span: { start: { line: 10 } } } }, summary: 'CaughtMutant' },
            { scenario: { Mutant: { file: 'src/lib.rs', span: { start: { line: 14 } } } }, summary: 'CaughtMutant' },
            { scenario: { Mutant: { file: 'src/lib.rs', span: { start: { line: 18 } } } }, summary: 'Timeout' },
            { scenario: { Mutant: { file: 'src/lib.rs', span: { start: { line: 22 } } } }, summary: 'MissedMutant' },
            { scenario: { Mutant: { file: 'src/lib.rs', span: { start: { line: 30 } } } }, summary: 'Unviable' }
          ]
        }),
        'utf8'
      );

      const exact = parseMutationReport(tmpDir);
      assert.equal(exact.found, true);
      assert.equal(exact.tool, 'cargo-mutants');
      assert.equal(exact.file, 'mutants.out/outcomes.json');
      assert.equal(exact.killed, 3);
      assert.equal(exact.total, 4);
      assert.equal(exact.mutationScore, 75);
      assert.equal(exact.passed, true);
      assert.equal(exact.diagnostics.status, 'OK');

      writeMutCfg(75.01);
      assert.equal(parseMutationReport(tmpDir).passed, false);

      // Exempting the single missed mutant on src/lib.rs:22 raises score to 100%
      recordExemption({ mutantId: 'src/lib.rs:22', file: 'src/lib.rs', reason: 'Equivalent logging branch', repoRoot: tmpDir });
      const withEx = parseMutationReport(tmpDir);
      assert.equal(withEx.exemptedCount, 1);
      assert.equal(withEx.mutationScore, 100);
      assert.equal(withEx.passed, true);

      // Summary-counter-only outcomes.json fallback when outcomes array is omitted
      fs.unlinkSync(getExemptionsPath(tmpDir));
      fs.writeFileSync(
        path.join(tmpDir, 'mutants.out/outcomes.json'),
        JSON.stringify({ total_mutants: 5, caught: 3, missed: 1, timeout: 0, unviable: 1 }),
        'utf8'
      );
      writeMutCfg(75);
      const summaryOnly = parseMutationReport(tmpDir);
      assert.equal(summaryOnly.found, true);
      assert.equal(summaryOnly.tool, 'cargo-mutants');
      assert.equal(summaryOnly.mutationScore, 75);
      assert.equal(summaryOnly.passed, true);
    });

    it('parses Python mutmut JSON and CLI text reports with exemptions and boundary thresholds', () => {
      writeMutCfg(80);
      fs.mkdirSync(path.join(tmpDir, 'reports/mutation'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'reports/mutation/mutmut.json'),
        JSON.stringify({
          mutants: [
            { id: '1', file: 'app/calc.py', line: 5, status: 'killed' },
            { id: '2', file: 'app/calc.py', line: 8, status: 'killed' },
            { id: '3', file: 'app/calc.py', line: 12, status: 'timeout' },
            { id: '4', file: 'app/calc.py', line: 16, status: 'killed' },
            { id: '5', file: 'app/calc.py', line: 20, status: 'survived' },
            { id: '6', file: 'app/calc.py', line: 24, status: 'skipped' }
          ]
        }),
        'utf8'
      );

      const jsonRes = parseMutationReport(tmpDir);
      assert.equal(jsonRes.found, true);
      assert.equal(jsonRes.tool, 'mutmut');
      assert.equal(jsonRes.file, 'reports/mutation/mutmut.json');
      assert.equal(jsonRes.killed, 4);
      assert.equal(jsonRes.total, 5);
      assert.equal(jsonRes.mutationScore, 80);
      assert.equal(jsonRes.passed, true);

      fs.rmSync(path.join(tmpDir, 'reports/mutation/mutmut.json'));
      fs.writeFileSync(
        path.join(tmpDir, 'mutmut-results.txt'),
        [
          '---- app/calc.py (6) ----',
          '🎉 1-3',
          '⏰ 4',
          '🙁 5',
          '🔇 6'
        ].join('\n'),
        'utf8'
      );
      const txtRes = parseMutationReport(tmpDir);
      assert.equal(txtRes.found, true);
      assert.equal(txtRes.tool, 'mutmut');
      assert.equal(txtRes.file, 'mutmut-results.txt');
      assert.equal(txtRes.mutationScore, 80);
      assert.equal(txtRes.passed, true);

      // mutmut v3 key-status output format
      fs.writeFileSync(
        path.join(tmpDir, 'mutmut-results.txt'),
        [
          'app.calc.x_add__mutmut_1: killed',
          'app.calc.x_add__mutmut_2: survived',
          'app.calc.x_add__mutmut_3: timeout',
          'app.calc.x_add__mutmut_4: no tests',
          'app.calc.x_add__mutmut_5: skipped'
        ].join('\n'),
        'utf8'
      );
      writeMutCfg(50);
      const v3Res = parseMutationReport(tmpDir);
      assert.equal(v3Res.found, true);
      assert.equal(v3Res.killed, 2);
      assert.equal(v3Res.total, 4);
      assert.equal(v3Res.mutationScore, 50);
      assert.equal(v3Res.passed, true);
    });

    it('parses Go go-mutesting text (PASS=killed, FAIL=survived) and JSON reports', () => {
      writeMutCfg(75);
      fs.writeFileSync(
        path.join(tmpDir, 'go-mutesting.txt'),
        [
          'PASS "/pkg/math/calc.go" with checksum 1111aaaa',
          'PASS "/pkg/math/calc.go" with checksum 2222bbbb',
          'PASS "/pkg/math/calc.go" with checksum 3333cccc',
          'FAIL "/pkg/math/calc.go" with checksum 4444dddd',
          'SKIP "/pkg/math/calc.go" with checksum 5555eeee',
          'The mutation score is 0.750000 (3 passed, 1 failed, 0 duplicated, 1 skipped, total is 5)'
        ].join('\n'),
        'utf8'
      );

      const txtRes = parseMutationReport(tmpDir);
      assert.equal(txtRes.found, true);
      assert.equal(txtRes.tool, 'go-mutesting');
      assert.equal(txtRes.file, 'go-mutesting.txt');
      assert.equal(txtRes.killed, 3);
      assert.equal(txtRes.total, 4);
      assert.equal(txtRes.mutationScore, 75);
      assert.equal(txtRes.passed, true);

      fs.rmSync(path.join(tmpDir, 'go-mutesting.txt'));
      fs.mkdirSync(path.join(tmpDir, 'reports/mutation'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'reports/mutation/go-mutesting.json'),
        JSON.stringify({
          mutants: [
            { id: 'm1', file: 'pkg/math/calc.go', line: 11, status: 'PASS' },
            { id: 'm2', file: 'pkg/math/calc.go', line: 15, status: 'FAIL' }
          ]
        }),
        'utf8'
      );
      writeMutCfg(51);
      const jsonRes = parseMutationReport(tmpDir);
      assert.equal(jsonRes.found, true);
      assert.equal(jsonRes.tool, 'go-mutesting');
      assert.equal(jsonRes.mutationScore, 50);
      assert.equal(jsonRes.passed, false);
    });

    it('fails closed with structured diagnostics when reports are missing, corrupt, or unsupported/empty', () => {
      writeMutCfg(60);
      const missing = parseMutationReport(tmpDir);
      assert.equal(missing.found, false);
      assert.equal(missing.passed, false);
      assert.equal(missing.mutationScore, null);
      assert.equal(missing.diagnostics.status, 'MISSING_REPORT');
      assert.ok(Array.isArray(missing.diagnostics.searchedPaths));
      assert.ok(missing.diagnostics.searchedPaths.includes('mutants.out/outcomes.json'));
      assert.ok(missing.diagnostics.searchedPaths.includes('mutmut-results.txt'));
      assert.ok(missing.diagnostics.searchedPaths.includes('go-mutesting.txt'));

      // Corrupt Stryker JSON must fail closed with diagnostic error details
      fs.mkdirSync(path.join(tmpDir, 'reports/mutation'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'reports/mutation/mutation.json'), '{not-valid-json', 'utf8');
      const corrupt = parseMutationReport(tmpDir);
      assert.equal(corrupt.found, false);
      assert.equal(corrupt.passed, false);
      assert.equal(corrupt.diagnostics.status, 'UNSUPPORTED_OR_CORRUPT_REPORT');
      assert.ok(corrupt.diagnostics.errors.length >= 1);
      assert.equal(corrupt.diagnostics.errors[0].file, 'reports/mutation/mutation.json');

      // Unsupported / zero viable mutants cargo outcomes.json fails closed cleanly
      fs.rmSync(path.join(tmpDir, 'reports/mutation/mutation.json'));
      fs.mkdirSync(path.join(tmpDir, 'mutants.out'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'mutants.out/outcomes.json'), JSON.stringify({ unexpected: true, outcomes: [] }), 'utf8');
      const empty = parseMutationReport(tmpDir);
      assert.equal(empty.found, false);
      assert.equal(empty.passed, false);
      assert.ok(['EMPTY_REPORT', 'UNSUPPORTED_OR_CORRUPT_REPORT'].includes(empty.diagnostics.status));
      assert.ok(empty.diagnostics.errors.some((e) => e.file === 'mutants.out/outcomes.json'));
    });

    it('parses LCOV/JSON/Clover/Cobertura/Go/JaCoCo coverage reports and buildSingleTestArgv accurately', () => {
      fs.mkdirSync(path.join(tmpDir, 'coverage'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'coverage/coverage-summary.json'), JSON.stringify({ total: { lines: { pct: 85 }, branches: { pct: 70 } } }), 'utf8');
      writeMutCfg(52);
      const modAtThreshold = { path: '.', thresholds: { diffCoverage: 85 } };
      assert.equal(parseCoverageReport(tmpDir, modAtThreshold).passed, true);
      assert.equal(parseCoverageReport(tmpDir, { path: '.', thresholds: { diffCoverage: 85.01 } }).passed, false);

      fs.rmSync(path.join(tmpDir, 'coverage/coverage-summary.json'));
      fs.writeFileSync(path.join(tmpDir, 'coverage/lcov.info'), 'SF:src/a.js\nDA:1,1\nDA:2,0\nDA:3,1\nDA:4,1\nLF:4\nLH:3\nend_of_record\n', 'utf8');
      const lcov = parseCoverageReport(tmpDir, { path: '.', thresholds: { diffCoverage: 75 } });
      assert.equal(lcov.found, true);
      assert.equal(lcov.lineCoverage, 75);
      assert.equal(lcov.passed, true);

      assert.deepEqual(buildSingleTestArgv('foo.py', tmpDir), { file: 'pytest', args: ['foo.py'] });
      assert.deepEqual(buildSingleTestArgv('pkg/calc_test.go', tmpDir), { file: 'go', args: ['test', '-v', './pkg'] });
      assert.deepEqual(buildSingleTestArgv('tests/lib_test.rs', tmpDir), { file: 'cargo', args: ['test', '--test', 'lib_test'] });
      assert.ok(buildSingleTestCommand('tests/a.test.mjs', tmpDir).includes('node --test'));
      assert.ok(suggestMutationStrengthening({ mutantType: 'ConditionalsBoundary', file: 'a.mjs', line: 5 }).recommendation.includes('threshold'));
    });
  });

  describe('Linear Hash-Chain Terminology, Backward Compatibility & In-Process Workbench', () => {
    it('maintains chainHead and backwards-compatible merkleRoot in audit-chain while eliminating Merkle mislabeling in workbench', async () => {
      const emptyVerify = verifyAuditChain(tmpDir);
      assert.equal(emptyVerify.valid, true);
      assert.equal(emptyVerify.chainHead, GENESIS_HASH);
      assert.equal(emptyVerify.merkleRoot, GENESIS_HASH);

      const rec = appendAuditRecord({ event: 'HASH_CHAIN_TEST', metadata: { ok: true }, repoRoot: tmpDir });
      const verified = verifyAuditChain(tmpDir);
      assert.equal(verified.valid, true);
      assert.equal(verified.chainHead, rec.record.currentHash);
      assert.equal(verified.merkleRoot, rec.record.currentHash);

      const html = renderWorkbenchHTML(tmpDir);
      assert.doesNotMatch(html, /Merkle/i, 'Mission Control HTML should describe linear hash chain rather than Merkle tree');
      assert.match(html, /Hash-Chain|Hash Chain/i);

      const widget = generateArchitectureWidget({ repoRoot: tmpDir, writeDefault: false });
      assert.doesNotMatch(widget.html, /Merkle/i, 'Widget HTML should describe linear hash chain rather than Merkle tree');
      assert.match(widget.html, /Hash-Chain|Hash Chain/i);

      const wb = createWorkbenchServer({ port: 0, repoRoot: tmpDir, token: 'unit-token' });
      assert.equal(typeof wb.handleRequest, 'function', 'createWorkbenchServer must expose pure in-process handleRequest');

      const statusRes = await dispatchHttp(wb, 'GET', `/api/status?token=${wb.token}`);
      assert.equal(statusRes.status, 200);
      assert.equal(statusRes.json.audit.chainHead, rec.record.currentHash);
      assert.equal(statusRes.json.audit.merkleRoot, rec.record.currentHash);
    });

    it('detects tampering, chain breaks, invalid index, and validates HMAC gate receipts across lanes', () => {
      const r0 = appendAuditRecord({ event: 'E0', metadata: {}, repoRoot: tmpDir });
      appendAuditRecord({ event: 'E1', metadata: { n: 1 }, repoRoot: tmpDir });

      // Corrupt hash calculation on second entry
      const ledgerPath = path.join(tmpDir, AUDIT_LEDGER_FILE);
      const lines = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n');
      const e1 = JSON.parse(lines[1]);
      e1.metadata.n = 2;
      fs.writeFileSync(ledgerPath, `${lines[0]}\n${JSON.stringify(e1)}\n`, 'utf8');
      const tampered = verifyAuditChain(tmpDir);
      assert.equal(tampered.valid, false);
      assert.equal(tampered.errorIndex, 1);

      // Restore and verify clean HMAC signing + tampered signature rejection
      fs.unlinkSync(ledgerPath);
      const key = loadReceiptKey(tmpDir, { create: true });
      assert.ok(Buffer.isBuffer(key) && key.length >= 32);
      const missing = issueGateReceipt({ issueId: 136, branch: 'feature/issue-#136', repoRoot: tmpDir });
      assert.equal(missing.success, false);
      assert.ok(missing.missing.includes('coveragePct'));

      const sha = 'a'.repeat(40);
      const issued = issueGateReceipt({
        issueId: 136,
        branch: 'feature/issue-#136',
        headSha: sha,
        lane: 'full',
        coveragePct: 91,
        mutationPct: 68,
        peerReviewApproved: true,
        reviewer: '@peer',
        driftCheckPassed: true,
        repoRoot: tmpDir
      });
      assert.equal(issued.success, true);
      assert.equal(verifyReceiptSignature(issued.auditRecord.metadata, key), true);
      assert.equal(verifyReceiptSignature({ ...issued.auditRecord.metadata, coveragePct: 99 }, key), false);

      const verified = verifyGateReceipt({ headSha: sha, branch: 'feature/issue-#136', repoRoot: tmpDir });
      assert.equal(verified.valid, true);
      assert.equal(verified.chainHead, issued.auditRecord.currentHash);
    });
  });

  describe('Core Resolvers, Spec Drift, Sessions, Guards, Arch-Diff & Triage Boundaries', () => {
    it('enforces resolveQualityThresholds precedence, sameShaPrefix lengths, parseCommandArgv, and resolveInsideRepo', () => {
      fs.mkdirSync(path.join(tmpDir, '.agent'), { recursive: true });
      assert.deepEqual(resolveQualityThresholds(tmpDir).configExists, false);
      assert.equal(resolveQualityThresholds(tmpDir).minCov, DEFAULT_QUALITY_THRESHOLDS.diffCoverage);

      fs.writeFileSync(
        path.join(tmpDir, '.agent/sdlc-config.json'),
        JSON.stringify({
          gates: { minDiffCoverage: 92 },
          projectManagement: { provider: 'local' },
          testing: { coverageThreshold: 88, mutationThreshold: 64 },
          modules: [{ name: 'a', path: '.', thresholds: { diffCoverage: 80, mutationScore: 55 } }]
        }),
        'utf8'
      );
      const resolved = resolveQualityThresholds(tmpDir);
      assert.equal(resolved.minCov, 92);
      assert.equal(resolved.minMut, 64);
      assert.equal(resolveQualityThresholds(tmpDir, { thresholds: { diffCoverage: 99, mutationScore: null } }).minMut, 64);

      assert.equal(sameShaPrefix('abcdef1', 'abcdef1234567'), true);
      assert.equal(sameShaPrefix('abcdef', 'abcdef1234567'), false);
      assert.equal(sameShaPrefix('HEAD', 'HEAD'), false);

      assert.deepEqual(parseCommandArgv('node -e "console.log(1)"'), { file: 'node', args: ['-e', 'console.log(1)'] });
      assert.throws(() => parseCommandArgv('echo a && echo b'), /Refusing shell compound command/);
      assert.throws(() => parseCommandArgv('echo `id`'), /Refusing shell compound command/);
      assert.throws(() => parseCommandArgv(''), /non-empty string or argv array/);

      assert.throws(() => resolveInsideRepo(tmpDir, '../escape'), /escapes repository root|outside/i);
      assert.ok(resolveInsideRepo(tmpDir, 'src/a.mjs').endsWith('src/a.mjs'));

      assert.equal(normalizeTicketId('#136'), '136');
      assert.equal(parseTicketId('136'), 136);
      assert.equal(fileExists(path.join(tmpDir, '.agent/sdlc-config.json')), true);
      assert.ok(readFileSafe(path.join(tmpDir, '.agent/sdlc-config.json')).includes('gates'));
      writeFileAtomic(path.join(tmpDir, 'atomic.txt'), 'ok');
      assert.equal(readFileSafe(path.join(tmpDir, 'atomic.txt')), 'ok');
      assert.equal(inspectArchlens(tmpDir).installed, false);
      const prevPmEnv = process.env.SDLC_PM_PROVIDER;
      delete process.env.SDLC_PM_PROVIDER;
      try {
        assert.equal(detectPMProvider(tmpDir).provider, 'local');
        process.env.SDLC_PM_PROVIDER = 'linear';
        assert.equal(detectPMProvider(tmpDir).provider, 'linear');
      } finally {
        if (prevPmEnv === undefined) delete process.env.SDLC_PM_PROVIDER;
        else process.env.SDLC_PM_PROVIDER = prevPmEnv;
      }
      assert.deepEqual([...extractAddedLinesFromDiff('@@ -0,0 +1,2 @@\n+line1\n+line2')], [1, 2]);
      assert.equal(typeof loadEnv(tmpDir), 'object');
      assert.ok(readSessionRegistry(tmpDir).exists === false);
      assert.ok(getExemptionsPath(tmpDir).endsWith('sdlc-exemptions.json'));
      assert.deepEqual(getExemptions(tmpDir), []);
      assert.deepEqual(loadConfig(tmpDir).gates, { minDiffCoverage: 92 });
      const resSync = runConfiguredCommand(['node', '-e', 'process.stdout.write("hi")'], { encoding: 'utf8', stdio: 'pipe' });
      assert.equal(resSync, 'hi');
    });

    it('runs parallel tasks with bounded concurrency and handles ADR frontmatter + Spec-Drift rules', async () => {
      const vals = await runParallelTasks([async () => 1, async () => 2, async () => 3], 2);
      assert.deepEqual(vals, [1, 2, 3]);

      const fm = parseFrontmatter('---\ntitle: "A"\nsupersedes:\ncreatedAt: 2026-11-14T00:00:00Z\n---\nbody');
      assert.equal(fm.frontmatter.supersedes, '');
      assert.equal(fm.frontmatter.title, 'A');

      const adr = createADR({ title: 'Adopt strict parser', scope: 'technical', ticketId: 136, decision: 'Use strict regex', repoRoot: tmpDir });
      assert.equal(listADRs(tmpDir).length, 1);

      const blocked = checkSpecDrift({ diffFiles: ['openapi.json'], ticketId: 136, repoRoot: tmpDir });
      assert.equal(blocked.passed, false);
      assert.equal(blocked.hasUndeclaredDrift, true);

      decideADR({ adrId: adr.adr.id, action: 'approve', reviewer: '@arch', repoRoot: tmpDir });
      const allowed = checkSpecDrift({ diffFiles: ['openapi.json'], ticketId: 136, repoRoot: tmpDir });
      assert.equal(allowed.passed, true);

      const clean = checkSpecDrift({ diffFiles: ['src/app.mjs'], ticketId: 136, repoRoot: tmpDir });
      assert.equal(clean.passed, true);
      assert.equal(auditContractDrift({ diffFiles: ['openapi.yaml'], repoRoot: tmpDir }).breakingChangesCount >= 1, true);
      assert.equal(compactADRs({ releaseVersion: '0.1.0', dryRun: true, repoRoot: tmpDir }).compactedCount, 1);
    });

    it('manages session registry lifecycle, stats, lane reconciliation, and receipt inputs', () => {
      assert.equal(calculateSessionStats(tmpDir).totalSessions, 0);

      startSession({ issueId: 136, branch: 'feature/issue-#136', stage: 2, lane: 'standard', repoRoot: tmpDir });
      updateSession({ stage: 5, manifestUpdate: { coverageReport: '90.0%', peerReview: { verdict: 'approve', reviewer: '@r' } }, repoRoot: tmpDir });
      startSession({ issueId: 137, branch: 'feature/issue-#137', stage: 2, lane: 'trivial', repoRoot: tmpDir, force: true });

      assert.equal(listSessions(tmpDir).sessions.length, 2);
      switchSession(136, tmpDir);
      assert.equal(resumeSession(tmpDir).session.issueId, 136);
      assert.ok(renderDashboard(getSessionStatus(tmpDir).session).includes('#136'));

      const stats = calculateSessionStats(tmpDir);
      assert.equal(stats.completedSessions, 1);
      assert.equal(stats.totalSessions, 2);
      assert.equal(stats.velocityScore, 50);

      const inputs = receiptInputsFromSession(getSessionStatus(tmpDir).session, { driftCheckPassed: true, repoRoot: tmpDir });
      assert.equal(inputs.coveragePct, 90);
      assert.equal(inputs.peerReviewApproved, true);

      const recon = reconcileSessionLaneWithDiff({
        session: { issueId: 136, lane: 'trivial', stage: 3, laneDowngraded: false },
        diffFiles: ['src/security/auth.mjs'],
        repoRoot: tmpDir
      });
      assert.equal(recon.lane, 'full');
      assert.equal(recon.escalated, true);

      releaseSession(tmpDir, 136);
      releaseSession(tmpDir, 137);
      assert.equal(getSessionStatus(tmpDir).active, false);
    });

    it('enforces Layer 1/2/3/4 git guards, hooks health, and branch protection', () => {
      assert.equal(verifyCommitGuard({ branch: 'main', repoRoot: tmpDir }).layer, 'LAYER_1_PROTECTED_BRANCH');
      assert.equal(verifyCommitGuard({ branch: 'develop', repoRoot: tmpDir }).layer, 'LAYER_1_PROTECTED_BRANCH');
      assert.equal(verifyCommitGuard({ branch: 'feature/issue-#136', repoRoot: tmpDir }).layer, 'LAYER_2_SESSION_REQUIRED');

      startSession({ issueId: 136, branch: 'feature/issue-#136', stage: 1, repoRoot: tmpDir });
      assert.equal(verifyCommitGuard({ branch: 'feature/issue-#136', repoRoot: tmpDir }).layer, 'LAYER_2_STAGE_NOT_READY');
      assert.equal(verifyCommitGuard({ branch: 'feature/issue-#999', repoRoot: tmpDir }).layer, 'LAYER_2_BRANCH_MISMATCH');

      updateSession({ stage: 2, repoRoot: tmpDir });
      assert.equal(verifyCommitGuard({ branch: 'feature/issue-#136', repoRoot: tmpDir }).allowed, true);

      assert.equal(verifyMergeGuard({ targetBranch: 'feature/x', repoRoot: tmpDir }).allowed, true);
      assert.equal(verifyMergeGuard({ targetBranch: 'main', sourceBranch: 'feature/x', repoRoot: tmpDir }).reasonCode, 'MISSING_STAGE_7_GATE_RECEIPT');
      assert.equal(verifyPushGuard({ remoteBranch: 'develop', repoRoot: tmpDir }).layer, 'LAYER_3_PROTECTED_PUSH');

      fs.mkdirSync(path.join(tmpDir, '.git/hooks'), { recursive: true });
      const templates = buildHookTemplates();
      assert.ok(templates['pre-commit'] && templates['pre-merge-commit'] && templates['pre-push']);
      const installed = installHooks({ repoRoot: tmpDir });
      assert.equal(installed.success, true);
      const health = inspectHooksHealth(tmpDir);
      assert.equal(health.installed, true);
      assert.equal(health.upToDate, true);

      let called = false;
      const bp = applyBranchProtection({
        branches: ['main'],
        requiredChecks: [DEFAULT_QUALITY_GATE_CHECK],
        repoRoot: tmpDir,
        execFn: () => {
          called = true;
          return '';
        }
      });
      assert.equal(called, true);
      assert.equal(bp.protectedBranches[0].requiredChecks[0], DEFAULT_QUALITY_GATE_CHECK);
    });

    it('detects architecture layer violations, AST Mermaid diffs, risk scores, PR summaries & skill audit', () => {
      assert.equal(checkArchDiff(tmpDir).enabled, false);
      const policyRes = scaffoldArchlensPolicy(tmpDir);
      assert.equal(policyRes.success, true);

      const gOld = parseMermaidDiagram('graph TD\n  A-->B\n');
      const gNew = parseMermaidDiagram('graph TD\n  A-->B\n  B-->C\n');
      const diff = diffMermaidGraphs(gOld, gNew);
      assert.equal(diff.hasChanges, true);
      assert.ok(diff.addedNodes.some((n) => n.id === 'C'));

      assert.equal(VALID_LANES.length, 3);
      assert.equal(LANE_RANK.full > LANE_RANK.standard && LANE_RANK.standard > LANE_RANK.trivial, true);
      assert.equal(assessRisk(['migrations/001.sql', 'auth/jwt.mjs'], tmpDir).riskLevel, 'CRITICAL');
      assert.equal(assessRisk(['src/domain/user.mjs', 'package-lock.json'], tmpDir).riskLevel, 'HIGH');
      assert.equal(assessRisk(['src/api/routes.mjs'], tmpDir).riskLevel, 'MEDIUM');
      assert.equal(assessRisk(['README.md'], tmpDir).riskLevel, 'LOW');

      assert.equal(triageChange({ diffFiles: ['docs/guide.md'], repoRoot: tmpDir }).computedLane, 'trivial');
      assert.equal(triageChange({ diffFiles: ['PRODUCT.md'], repoRoot: tmpDir }).computedLane, 'full');
      assert.equal(triageChange({ diffFiles: ['src/app.mjs'], repoRoot: tmpDir }).computedLane, 'standard');
      assert.throws(() => triageChange({ diffFiles: ['src/app.mjs'], laneOverride: 'trivial', repoRoot: tmpDir }), /--reason/);

      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src/widget.mjs'), 'export const x = 1;\n', 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'tests/widget.test.mjs'), 'import "../src/widget.mjs";\n', 'utf8');
      assert.ok(findAffectedTests(['src/widget.mjs'], tmpDir).includes('tests/widget.test.mjs'));
      assert.equal(resolveAdHocTargets(['src/widget.mjs'], [], tmpDir).totalFiles, 1);

      const summary = generatePRSummary({ issueId: 136, repoRoot: tmpDir });
      assert.ok(summary.markdown.includes('## '));
      const repro = scaffoldReproductionTest({ errorTrace: 'Error in src/calc.py:12', targetFile: 'src/calc.py', repoRoot: tmpDir });
      assert.equal(repro.language, 'python');

      assert.ok(generateReviewPlan({ repoRoot: tmpDir, lane: 'full' }).payload.Subagents.length >= 2);
      assert.equal(auditSkills(REPO_ROOT).success, true);
    });
  });
});
