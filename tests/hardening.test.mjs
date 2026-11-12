/**
 * Hardening regression suite (issue #91).
 * These tests exercise real behaviour: they spawn the CLI, install the real
 * git hooks into throwaway repos, run `git commit` / `git merge`, and assert
 * on exit codes and side effects rather than on returned objects alone.
 * Hermetic: every test works in an OS temp dir; nothing touches the network
 * or tracked files in this repository.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawnSync, execFileSync } from 'node:child_process';

import {
  issueGateReceipt,
  verifyGateReceipt,
  calculateRecordHash,
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
  calculateSessionStats,
  generateReviewPlan,
  runDoctor,
  verifyCommitGuard,
  installCIWorkflow,
  generateConfig,
  checkSpecDrift,
  verifyAuditChain
} from '../.agent/scripts/sdlc-engine.mjs';
import * as coreMod from '../.agent/scripts/lib/core.mjs';
import * as gitGuardMod from '../.agent/scripts/lib/git-guard.mjs';
import * as qualityGateMod from '../.agent/scripts/lib/quality-gate.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const SCRIPTS_SRC = path.join(REPO_ROOT, '.agent/scripts');

function childEnv() {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', SDLC_RECEIPT_KEY: '' };
  delete env.NODE_TEST_CONTEXT;
  delete env.SDLC_RECEIPT_KEY;
  // Make any accidental `gh` invocation fail fast instead of hitting the live API.
  env.GH_TOKEN = 'invalid-hermetic-test-token';
  env.GH_HOST = 'invalid.localhost';
  return env;
}

function git(cwd, ...args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', env: childEnv() });
}

function engine(cwd, ...args) {
  return spawnSync(process.execPath, [path.join(cwd, '.agent/scripts/sdlc-engine.mjs'), ...args], {
    cwd,
    encoding: 'utf8',
    env: childEnv(),
    timeout: 120000
  });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-hardening-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'agent@sdlc.local');
  git(dir, 'config', 'user.name', 'SDLC Agent');
  git(dir, 'config', 'commit.gpgsign', 'false');
  fs.cpSync(SCRIPTS_SRC, path.join(dir, '.agent/scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.gitignore'), '.agent/\ndocs/\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'README.md'), '# temp\n', 'utf8');
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'tmp', version: '0.0.0', type: 'module', scripts: { test: 'node -e 0' } }),
    'utf8'
  );
  git(dir, 'add', '.');
  const c = git(dir, 'commit', '-q', '-m', 'chore: init');
  assert.equal(c.status, 0, c.stderr);
  return dir;
}

function writeSession(dir, session) {
  const file = path.join(dir, '.agent/.sdlc-session.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ activeSessionId: session.issueId, sessions: { [session.issueId]: { active: true, ...session } } }),
    'utf8'
  );
}

// ===========================================================================
// Fix 1: exit codes are honoured and the hooks actually block
// ===========================================================================
describe('Fix 1: CLI exit codes & blocking git hooks', () => {
  let dir;
  beforeEach(() => {
    dir = makeRepo();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('exits non-zero for an unknown command', () => {
    const r = engine(dir, 'bogus-cmd');
    assert.notEqual(r.status, 0);
  });

  it('exits 0 for help', () => {
    assert.equal(engine(dir, 'help').status, 0);
  });

  it('`guard pre-commit` exits non-zero on main', () => {
    const r = engine(dir, 'guard', 'pre-commit');
    assert.equal(r.status, 1, r.stdout + r.stderr);
  });

  it('pre-commit hook blocks commits on main and on a branch without a session; allows with a session', () => {
    assert.equal(engine(dir, 'hooks', 'install').status, 0);
    const hook = fs.readFileSync(path.join(dir, '.git/hooks/pre-commit'), 'utf8');
    assert.doesNotMatch(hook.trim(), /exit 0$/);

    fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
    git(dir, 'add', 'a.txt');
    assert.notEqual(git(dir, 'commit', '-q', '-m', 'feat: on main').status, 0, 'commit on main must be blocked');

    git(dir, 'checkout', '-q', '-b', 'feature/issue-7-x');
    assert.notEqual(git(dir, 'commit', '-q', '-m', 'feat: no session').status, 0, 'commit without session must be blocked');

    writeSession(dir, { issueId: 7, branch: 'feature/issue-7-x', stage: 3 });
    const ok = git(dir, 'commit', '-q', '-m', 'feat: with session');
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  });

  it('pre-merge-commit hook blocks a --no-ff merge into main without a receipt, and allows it with one', () => {
    assert.equal(engine(dir, 'hooks', 'install').status, 0);
    git(dir, 'checkout', '-q', '-b', 'feature/issue-8-y');
    writeSession(dir, {
      issueId: 8,
      branch: 'feature/issue-8-y',
      stage: 6,
      manifest: { coverageReport: '91.0%', mutationScore: '82.0%', peerReview: { verdict: 'approve', reviewer: '@alice' } }
    });
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
    git(dir, 'add', 'b.txt');
    assert.equal(git(dir, 'commit', '-q', '-m', 'feat: b').status, 0);

    git(dir, 'checkout', '-q', 'main');
    const blocked = git(dir, 'merge', '--no-ff', '-q', '-m', 'merge', 'feature/issue-8-y');
    assert.notEqual(blocked.status, 0, 'merge without receipt must be blocked');
    git(dir, 'merge', '--abort');
    assert.equal(fs.existsSync(path.join(dir, 'b.txt')), false);

    git(dir, 'checkout', '-q', 'feature/issue-8-y');
    const rec = engine(dir, 'guard', 'receipt');
    assert.equal(rec.status, 0, rec.stdout + rec.stderr);
    git(dir, 'checkout', '-q', 'main');
    const merged = git(dir, 'merge', '--no-ff', '-q', '-m', 'merge', 'feature/issue-8-y');
    assert.equal(merged.status, 0, merged.stdout + merged.stderr);
  });
});

// ===========================================================================
// Fix 2: no shell interpolation of filenames
// ===========================================================================
describe('Fix 2: filenames never reach a shell', () => {
  let dir;
  beforeEach(() => {
    dir = makeRepo();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  for (const cmd of [['security-audit'], ['arch', 'diff'], ['flake-check', '--runs', '2'], ['test', '--affected-only']]) {
    it(`\`${cmd.join(' ')}\` does not execute $(...) in a filename`, () => {
      fs.mkdirSync(path.join(dir, '.archlens'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.archlens/policy.json'), JSON.stringify({ layers: [] }));
      const evil = '$(touch PWNED).test.mjs';
      fs.writeFileSync(path.join(dir, evil), 'export {};\n');
      git(dir, 'add', '--', evil);
      git(dir, 'commit', '-q', '--no-verify', '-m', 'evil');
      fs.writeFileSync(path.join(dir, '$(touch PWNED2).js'), 'export {};\n');
      engine(dir, ...cmd);
      assert.equal(fs.existsSync(path.join(dir, 'PWNED')), false, 'command substitution executed');
      assert.equal(fs.existsSync(path.join(dir, 'PWNED2')), false, 'command substitution executed');
    });
  }

  it('security-audit still detects a secret in an untracked file and exits non-zero', () => {
    fs.writeFileSync(path.join(dir, 'leak.js'), `const api_key = "abcdefghijklmnopqrstuvwxyz123456";\n`);
    const r = engine(dir, 'security-audit');
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
  });

  it('no engine source builds a shell string with ${} inside execSync(`...`)', () => {
    const files = [path.join(SCRIPTS_SRC, 'sdlc-engine.mjs'), ...fs.readdirSync(path.join(SCRIPTS_SRC, 'lib')).map((f) => path.join(SCRIPTS_SRC, 'lib', f))];
    const offenders = [];
    for (const f of files.filter((x) => x.endsWith('.mjs'))) {
      const src = fs.readFileSync(f, 'utf8');
      const re = /execSync\(\s*`[^`]*\$\{/g;
      if (re.test(src)) offenders.push(path.basename(f));
    }
    assert.deepEqual(offenders, []);
  });
});

// ===========================================================================
// Fix 3: receipts carry measured values and are signed
// ===========================================================================
describe('Fix 3: measured, HMAC-signed gate receipts', () => {
  let dir;
  beforeEach(() => {
    dir = makeRepo();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('refuses to issue a receipt without measured coverage / review', () => {
    const r = issueGateReceipt({ issueId: 1, branch: 'feature/x', repoRoot: dir });
    assert.equal(r.success, false);
    assert.ok(r.missing.includes('coveragePct'));
    assert.ok(r.missing.includes('mutationPct'));
    assert.ok(r.missing.includes('peerReviewApproved'));
    assert.ok(r.missing.includes('driftCheckPassed'));
    assert.equal(fs.existsSync(path.join(dir, 'docs/AUDIT_CHAIN.jsonl')), false);
  });

  it('accepts coverage/mutationScore aliases, null mutation (not-configured), and docsOnly receipts', () => {
    const alias = issueGateReceipt({
      issueId: 10,
      branch: 'feature/alias',
      coverage: 89.2,
      mutationScore: 81.5,
      peerReviewApproved: true,
      reviewer: '@alice',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(alias.success, true);
    assert.equal(alias.receipt.coveragePct, 89.2);
    assert.equal(alias.receipt.mutationPct, 81.5);
    assert.equal(alias.receipt.docsOnly, false);
    assert.equal(alias.receipt.mutationStatus, 'measured');

    const noMut = issueGateReceipt({
      issueId: 11,
      branch: 'feature/no-mut',
      coveragePct: 90,
      mutationPct: null,
      peerReviewApproved: true,
      reviewer: '@alice',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(noMut.success, true);
    assert.equal(noMut.receipt.coveragePct, 90);
    assert.equal(noMut.receipt.mutationPct, null);
    assert.equal(noMut.receipt.docsOnly, false);
    assert.equal(noMut.receipt.mutationStatus, 'not-configured');

    const docsExplicit = issueGateReceipt({
      issueId: 12,
      branch: 'feature/docs',
      docsOnly: true,
      peerReviewApproved: true,
      reviewer: '@alice',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(docsExplicit.success, true);
    assert.equal(docsExplicit.receipt.coveragePct, null);
    assert.equal(docsExplicit.receipt.mutationPct, null);
    assert.equal(docsExplicit.receipt.docsOnly, true);
    assert.equal(docsExplicit.receipt.mutationStatus, 'docs-only');

    const docsImplicit = issueGateReceipt({
      issueId: 13,
      branch: 'feature/docs-null',
      coveragePct: null,
      mutationPct: null,
      peerReviewApproved: true,
      reviewer: '@alice',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(docsImplicit.success, true);
    assert.equal(docsImplicit.receipt.docsOnly, true);
    assert.equal(docsImplicit.receipt.mutationStatus, 'docs-only');
  });

  it('`guard receipt` exits non-zero when the session has no measurements', () => {
    git(dir, 'checkout', '-q', '-b', 'feature/issue-3-z');
    writeSession(dir, { issueId: 3, branch: 'feature/issue-3-z', stage: 6, manifest: {} });
    const r = engine(dir, 'guard', 'receipt');
    assert.notEqual(r.status, 0);
  });

  it('signs receipts with HMAC-SHA256 and detects a re-hashed forgery', () => {
    const r = issueGateReceipt({
      issueId: 2,
      branch: 'feature/x',
      coveragePct: 91,
      mutationPct: 82,
      peerReviewApproved: true,
      reviewer: '@alice',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(r.success, true);
    assert.equal(r.receipt.signature.alg, 'HMAC-SHA256');
    assert.equal(verifyGateReceipt({ headSha: r.receipt.headSha, repoRoot: dir }).valid, true);

    // Forge: change the coverage and recompute the (unkeyed) chain hash.
    const ledger = path.join(dir, 'docs/AUDIT_CHAIN.jsonl');
    const rec = JSON.parse(fs.readFileSync(ledger, 'utf8').trim().split('\n').pop());
    rec.metadata.coveragePct = 99;
    rec.currentHash = calculateRecordHash(rec);
    fs.writeFileSync(ledger, JSON.stringify(rec) + '\n');
    const v = verifyGateReceipt({ headSha: r.receipt.headSha, repoRoot: dir });
    assert.equal(v.valid, false);
  });

  it('stage pre-pr builds the receipt from the measured session manifest (no 85/80 defaults)', () => {
    git(dir, 'checkout', '-q', '-b', 'feature/issue-4-w');
    startSession({ issueId: 4, branch: 'feature/issue-4-w', stage: 3, repoRoot: dir, force: true });
    updateSession({
      manifestUpdate: { coverageReport: '73.2%', mutationScore: '61.5%', peerReview: { verdict: 'approve', reviewer: '@bob' } },
      repoRoot: dir
    });
    const res = executeCompositeStage({ action: 'pre-pr', issueId: 4, repoRoot: dir });
    assert.ok(res.receipt, JSON.stringify(res.receiptError || res));
    assert.equal(res.receipt.coveragePct, 73.2);
    assert.equal(res.receipt.mutationPct, 61.5);
    assert.equal(res.receipt.peerReviewApproved, true);
  });
});

// ===========================================================================
// Fix 4: coverage / mutation gates fail closed
// ===========================================================================
describe('Fix 4: fail-closed coverage & mutation gates', () => {
  let dir;
  beforeEach(() => {
    dir = makeRepo();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function writeConfig(commands, thresholds = { diffCoverage: 85, mutationScore: 80 }) {
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({ version: 1, modules: [{ name: 'root', path: '.', commands, thresholds }] })
    );
  }

  it('parsers report passed:false when no report exists', () => {
    assert.equal(parseCoverageReport(dir, { path: '.', thresholds: { diffCoverage: 85 } }).passed, false);
    assert.equal(parseMutationReport(dir, { path: '.', thresholds: { mutationScore: 80 } }).passed, false);
  });

  it('`coverage` exits non-zero without a report and does not cache a pass', () => {
    writeConfig({ test: 'node -e 0', coverage: 'node -e 0', mutation: 'node -e 0' });
    assert.notEqual(engine(dir, 'coverage').status, 0);
    assert.notEqual(engine(dir, 'coverage').status, 0, 'second run must not hit a cached pass');
  });

  it('`mutation` exits non-zero without a report', () => {
    writeConfig({ test: 'node -e 0', coverage: 'node -e 0', mutation: 'node -e 0' });
    assert.notEqual(engine(dir, 'mutation').status, 0);
  });

  it('`mutation` parses a real Stryker JSON report (schema from this repo\'s own run) against the threshold', () => {
    // Fixture trimmed from reports/mutation/mutation.json produced by `npm run test:mutation`: 3 Killed + 1 Survived = 75%.
    const fixture = path.join(REPO_ROOT, 'tests/fixtures/stryker-mutation.json');
    const copy = `node -e "require('fs').mkdirSync('reports/mutation',{recursive:true});require('fs').copyFileSync(${JSON.stringify(fixture).replace(/"/g, "'")},'reports/mutation/mutation.json')"`;
    writeConfig({ test: 'node -e 0', coverage: 'node -e 0', mutation: copy }, { diffCoverage: 85, mutationScore: 70 });
    const ok = engine(dir, 'mutation', '--no-cache');
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.equal(parseMutationReport(dir, { path: '.', thresholds: { mutationScore: 70 } }).mutationScore, 75);
    writeConfig({ test: 'node -e 0', coverage: 'node -e 0', mutation: copy }, { diffCoverage: 85, mutationScore: 80 });
    assert.notEqual(engine(dir, 'mutation', '--no-cache').status, 0, '75% must fail an 80% threshold');
  });

  it('`gate` fails when coverage is below threshold and passes when above', () => {
    const write = (pct) =>
      `node -e "require('fs').mkdirSync('coverage',{recursive:true});require('fs').writeFileSync('coverage/coverage-summary.json',JSON.stringify({total:{lines:{pct:${pct}},branches:{pct:${pct}}}}))"`;
    writeConfig({ test: 'node -e 0', coverage: write(40) });
    assert.notEqual(engine(dir, 'gate').status, 0);
    writeConfig({ test: 'node -e 0', coverage: write(95) });
    const ok = engine(dir, 'gate');
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  });
});

// ===========================================================================
// Fix 5: workbench is loopback-only, token-authenticated, same-origin
// ===========================================================================
function req(port, method, p, { body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: p,
        method,
        headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers }
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      }
    );
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

describe('Fix 5: workbench auth', () => {
  let dir, wb, port;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-wb-'));
    createADR({ title: 'Product change', scope: 'product', ticketId: 1, decision: 'x', repoRoot: dir });
    wb = createWorkbenchServer({ port: 0, repoRoot: dir });
    const srv = await wb.listen();
    port = srv.address().port;
  });
  afterEach(async () => {
    await wb.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('binds to 127.0.0.1 only', () => {
    assert.equal(wb.server.address().address, '127.0.0.1');
  });

  it('exposes a random token of at least 128 bits', () => {
    assert.match(wb.token, /^[a-f0-9]{32,}$/);
  });

  it('rejects requests without the token (401) and accepts with it', async () => {
    assert.equal((await req(port, 'GET', '/api/status')).status, 401);
    assert.equal((await req(port, 'GET', '/')).status, 401);
    assert.equal((await req(port, 'GET', `/api/status?token=${wb.token}`)).status, 200);
    assert.equal((await req(port, 'GET', '/api/status', { headers: { 'X-SDLC-Token': wb.token } })).status, 200);
  });

  it('never sends Access-Control-Allow-Origin: *', async () => {
    const r = await req(port, 'GET', `/api/status?token=${wb.token}`);
    assert.notEqual(r.headers['access-control-allow-origin'], '*');
  });

  it('rejects cross-origin requests even with the token', async () => {
    const r = await req(port, 'GET', '/api/status', { headers: { 'X-SDLC-Token': wb.token, Origin: 'https://evil.example' } });
    assert.equal(r.status, 403);
  });

  it('human-only ADR approval requires the token', async () => {
    const adrId = listADRs(dir)[0].id;
    const denied = await req(port, 'POST', '/api/adr/decide', { body: { adrId, action: 'approve' } });
    assert.equal(denied.status, 401);
    assert.equal(listADRs(dir)[0].status, 'pending_approval');
    const ok = await req(port, 'POST', '/api/adr/decide', {
      body: { adrId, action: 'approve', reviewer: '@fady' },
      headers: { 'X-SDLC-Token': wb.token }
    });
    assert.equal(ok.status, 200);
    assert.equal(listADRs(dir)[0].status, 'accepted');
  });
});

// ===========================================================================
// PR 1 (#103): Truthful CLI telemetry, SHA-256 hook drift doctor & baseline
// ===========================================================================
describe('Issue #103: Truthful CLI telemetry, hook drift doctor & baseline', () => {
  let dir;
  beforeEach(() => {
    dir = makeRepo();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('formatCLIResult displays real producer counts for audit, skill-audit, adr, drift, and review plan', () => {
    const recRes = runCLI(['audit', 'record', '--event', 'REAL_EVENT'], null, dir);
    const recText = formatCLIResult(recRes);
    assert.match(recText, /REAL_EVENT/);
    assert.match(recText, /[a-f0-9]{8,}/);

    const verRes = runCLI(['audit', 'verify'], null, dir);
    const verText = formatCLIResult(verRes);
    assert.match(verText, /VALID \(1 record\(s\)\)/);

    const skillRes = runCLI(['skill-audit'], null, REPO_ROOT);
    assert.ok(skillRes.skillAudit.skillsScanned >= 11, 'must scan ub-mode alongside sdlc* skills');
    assert.ok(skillRes.skillAudit.skills.some((s) => s.skill === 'ub-mode'));
    const skillText = formatCLIResult(skillRes);
    assert.match(skillText, new RegExp(`${skillRes.skillAudit.skillsScanned} skill\\(s\\) checked`));

    const adrRes = runCLI(['adr', 'create', '--title', 'Truthful Baseline', '--scope', 'technical'], null, dir);
    const adrText = formatCLIResult(adrRes);
    assert.match(adrText, /ADR-001/);
    assert.match(adrText, /Truthful Baseline/);

    const driftRes = runCLI(['drift', 'check'], null, dir);
    const driftText = formatCLIResult(driftRes);
    assert.match(driftText, /Spec-Drift Check Passed/);

    const planRes = runCLI(['review', 'plan'], null, dir);
    const planText = formatCLIResult(planRes);
    assert.match(planText, /risk=/i);
  });

  it('help command documents all major engine subcommand groups', () => {
    const h = engine(dir, 'help');
    assert.equal(h.status, 0);
    const out = h.stdout;
    for (const cmd of [
      'detect',
      'doctor',
      'test',
      'coverage',
      'mutation',
      'gate',
      'stage',
      'session',
      'product',
      'spec',
      'adr',
      'drift',
      'review',
      'release',
      'hooks',
      'protect',
      'wiki',
      'readme',
      'skill-audit',
      'security-audit',
      'audit',
      'stats',
      'ui-snapshot',
      'serve',
      'interop'
    ]) {
      assert.ok(out.includes(cmd), `help output missing '${cmd}'`);
    }
  });

  it('calculateSessionStats reports $0 when totalSessions is 0 even with trace events, and marks savings as estimates', () => {
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.agent/arch-trace.jsonl'),
      Array.from({ length: 27 }, (_, i) => JSON.stringify({ seq: i + 1 })).join('\n') + '\n',
      'utf8'
    );

    const zeroStats = calculateSessionStats(dir);
    assert.equal(zeroStats.totalSessions, 0);
    assert.equal(zeroStats.estimatedHoursSaved, 0);
    assert.equal(zeroStats.totalDollarSavingsUSD, 0);
    assert.equal(zeroStats.isEstimate, true);

    startSession({ issueId: 42, branch: 'feature/issue-42', stage: 6, repoRoot: dir, force: true });
    const activeStats = calculateSessionStats(dir);
    assert.equal(activeStats.totalSessions, 1);
    assert.ok(activeStats.estimatedHoursSaved > 0);
    assert.equal(activeStats.isEstimate, true);

    const statsText = formatCLIResult({ command: 'stats', stats: activeStats });
    assert.match(statsText, /est\./i);
  });

  it('inspectHooksHealth detects missing and outdated git hooks, and doctor --fix refreshes stale hooks', () => {
    assert.equal(typeof gitGuardMod.inspectHooksHealth, 'function');
    const missing = gitGuardMod.inspectHooksHealth(dir);
    assert.equal(missing.installed, false);
    assert.equal(missing.upToDate, false);

    assert.equal(engine(dir, 'hooks', 'install').status, 0);
    const fresh = gitGuardMod.inspectHooksHealth(dir);
    assert.equal(fresh.installed, true);
    assert.equal(fresh.upToDate, true);
    assert.deepEqual(fresh.outdatedHooks, []);

    // Simulate an Oct-27 stale hook with trailing `exit 0` / different content
    fs.appendFileSync(path.join(dir, '.git/hooks/pre-push'), '\n# stale legacy footer\nexit 0\n', 'utf8');
    const stale = gitGuardMod.inspectHooksHealth(dir);
    assert.equal(stale.installed, true);
    assert.equal(stale.upToDate, false);
    assert.ok(stale.outdatedHooks.includes('pre-push'));

    const docDiag = runDoctor(dir, { fix: false });
    assert.equal(docDiag.hooks.upToDate, false);
    assert.equal(gitGuardMod.inspectHooksHealth(dir).upToDate, false, 'diagnose-only doctor must not mutate hooks');

    const docFix = runDoctor(dir, { fix: true });
    assert.ok(docFix.autoFixed.includes('git-hooks'));
    assert.equal(gitGuardMod.inspectHooksHealth(dir).upToDate, true);
  });

  it('generateReviewPlan never references deprecated sdlc-review-gate or tells read-only subagents to post comments, and verifyCommitGuard recommends stage begin', () => {
    const plan = generateReviewPlan({ repoRoot: dir });
    const serialized = JSON.stringify(plan);
    assert.equal(serialized.includes('sdlc-review-gate'), false);
    assert.equal(serialized.includes('MANDATORILY post'), false);

    const guard = verifyCommitGuard({ branch: 'feature/issue-99-test', repoRoot: dir });
    assert.equal(guard.allowed, false);
    assert.match(guard.message, /stage begin/);
    assert.doesNotMatch(guard.message, /session start/);
  });

  it('gate --strict evaluates assessRisk against actual modified files on the branch', () => {
    fs.rmSync(path.join(dir, 'README.md'), { force: true });
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'chore: remove stub readme');

    git(dir, 'checkout', '-q', '-b', 'feature/issue-50-auth');
    fs.mkdirSync(path.join(dir, 'src/auth'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/auth/token.js'), 'export const verify = () => true;\n', 'utf8');
    git(dir, 'add', 'src/auth/token.js');
    git(dir, 'commit', '-q', '-m', 'feat: auth token');

    fs.mkdirSync(path.join(dir, 'coverage'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'coverage/coverage-summary.json'),
      JSON.stringify({ total: { lines: { pct: 95 }, branches: { pct: 90 } } }),
      'utf8'
    );
    const cfgPath = path.join(dir, '.agent/sdlc-config.json');
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({
        version: '2.1.0',
        modules: [
          {
            name: 'root',
            path: '.',
            commands: {
              test: 'node -e 0',
              coverage: 'node -e 0',
              coverageFile: 'coverage/coverage-summary.json'
            },
            thresholds: { diffCoverage: 85, mutationScore: null }
          }
        ]
      }),
      'utf8'
    );
    const res = runCLI(['gate', '--strict'], cfgPath, dir);
    assert.equal(res.risk.riskLevel, 'CRITICAL');
    assert.ok(res.risk.totalFiles >= 1);
  });
});

describe('Issue #105: GitHub Actions quality-gate CI, configurable runners, local schema & shell-free execution', () => {
  let dir;
  beforeEach(() => {
    dir = makeRepo();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('installCIWorkflow uses vars.SDLC_RUNS_ON fallback by default and honors config ci.runsOn string/array + CLI flag', () => {
    const defaultRes = installCIWorkflow({ repoRoot: dir });
    assert.equal(defaultRes.created, true);
    const defaultYaml = fs.readFileSync(path.join(dir, '.github/workflows/sdlc-quality-gate.yml'), 'utf8');
    assert.match(defaultYaml, /permissions:\s*\n\s*contents:\s*read/);
    assert.match(defaultYaml, /runs-on:\s*\$\{\{\s*vars\.SDLC_RUNS_ON\s*\|\|\s*'ubuntu-latest'\s*\}\}/);
    assert.match(defaultYaml, /sdlc-engine\.mjs skill-audit/);
    assert.match(defaultYaml, /sdlc-engine\.mjs gate --strict/);
    assert.throws(
      () => installCIWorkflow({ repoRoot: dir, force: true, runsOn: 'ubuntu-latest\n    permissions: write-all' }),
      /newline characters are not permitted/
    );

    const cfgPath = path.join(dir, '.agent/sdlc-config.json');
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({
        version: '2.1.0',
        ci: { runsOn: 'local-archlens' },
        modules: []
      }),
      'utf8'
    );
    installCIWorkflow({ repoRoot: dir, force: true });
    const singleRunnerYaml = fs.readFileSync(path.join(dir, '.github/workflows/sdlc-quality-gate.yml'), 'utf8');
    assert.match(singleRunnerYaml, /runs-on:\s*local-archlens/);

    fs.writeFileSync(
      cfgPath,
      JSON.stringify({
        version: '2.1.0',
        ci: { runsOn: ['self-hosted', 'local-archlens'] },
        modules: []
      }),
      'utf8'
    );
    installCIWorkflow({ repoRoot: dir, force: true });
    const arrayRunnerYaml = fs.readFileSync(path.join(dir, '.github/workflows/sdlc-quality-gate.yml'), 'utf8');
    assert.match(arrayRunnerYaml, /runs-on:\s*\["self-hosted",\s*"local-archlens"\]/);

    runCLI(['ci-workflow', 'install', '--force', '--runs-on', 'mac-mini-runner'], cfgPath, dir);
    const cliRunnerYaml = fs.readFileSync(path.join(dir, '.github/workflows/sdlc-quality-gate.yml'), 'utf8');
    assert.match(cliRunnerYaml, /runs-on:\s*mac-mini-runner/);
  });

  it('parseCommandArgv & runConfiguredCommand execute single commands and argv arrays without a shell and reject shell operators', () => {
    assert.equal(typeof coreMod.parseCommandArgv, 'function');
    assert.equal(typeof coreMod.runConfiguredCommand, 'function');

    const parsed = coreMod.parseCommandArgv('node -e "const x = 1; if (x && true) process.exit(0)"');
    assert.equal(parsed.file, 'node');
    assert.deepEqual(parsed.args, ['-e', 'const x = 1; if (x && true) process.exit(0)']);

    const arrParsed = coreMod.parseCommandArgv(['node', '--version']);
    assert.equal(arrParsed.file, 'node');
    assert.deepEqual(arrParsed.args, ['--version']);

    assert.throws(
      () => coreMod.parseCommandArgv('npm test && echo pwned'),
      /Refusing shell compound command/
    );
    assert.throws(
      () => coreMod.parseCommandArgv('npm test; rm -rf /'),
      /Refusing shell compound command/
    );
    assert.throws(
      () => coreMod.parseCommandArgv('echo $(whoami)'),
      /Refusing shell compound command/
    );

    const out = coreMod.runConfiguredCommand(['node', '-e', 'process.stdout.write("SAFE_EXEC")'], {
      cwd: dir,
      stdio: 'pipe',
      encoding: 'utf8'
    });
    assert.equal(out, 'SAFE_EXEC');
  });

  it('engine & library modules contain zero execSync calls outside legacy coreMod.execCommand shim', () => {
    const shellFreeModules = [
      '.agent/scripts/sdlc-engine.mjs',
      '.agent/scripts/lib/quality-gate.mjs',
      '.agent/scripts/lib/arch-trace.mjs',
      '.agent/scripts/lib/audit-chain.mjs',
      '.agent/scripts/lib/session.mjs',
      '.agent/scripts/lib/cache.mjs',
      '.agent/scripts/lib/git-guard.mjs'
    ];
    for (const rel of shellFreeModules) {
      const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      assert.equal(
        /\bexecSync\b/.test(src),
        false,
        `Expected zero execSync references in ${rel}`
      );
    }
  });

  it('ships valid local JSON schema and dogfoods configurable runner workflows in repository', () => {
    const schemaPath = path.join(REPO_ROOT, '.agent/schemas/sdlc-config.schema.json');
    assert.equal(fs.existsSync(schemaPath), true, 'Expected .agent/schemas/sdlc-config.schema.json to exist');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    assert.ok(schema.$schema.includes('json-schema.org'));
    assert.ok(schema.properties.ci);
    assert.ok(schema.properties.modules);

    const generatedCfg = generateConfig(dir);
    assert.equal(generatedCfg.$schema, './schemas/sdlc-config.schema.json');

    const repoConfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.agent/sdlc-config.json'), 'utf8'));
    assert.equal(repoConfig.$schema, './schemas/sdlc-config.schema.json');
    assert.doesNotThrow(() => coreMod.parseCommandArgv(repoConfig.modules[0].commands.coverage));

    const gateWf = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/sdlc-quality-gate.yml'), 'utf8');
    const wikiWf = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/publish-wiki.yml'), 'utf8');
    assert.match(gateWf, /vars\.SDLC_RUNS_ON/);
    assert.match(gateWf, /permissions:\s*\n\s*contents:\s*read/);
    assert.match(wikiWf, /vars\.SDLC_RUNS_ON/);
    assert.equal(wikiWf.includes('git config --global'), false);
    assert.match(wikiWf, /mktemp -d/);
    assert.match(wikiWf, /trap 'rm -rf "\$WIKI_DIR"' EXIT/);

    const repoPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    assert.ok(repoPkg.files.includes('.agent/schemas'));
  });

  it('applyBranchProtection enforces required quality-gate status check and enforce_admins when workflow is present', () => {
    installCIWorkflow({ repoRoot: dir });
    const calls = [];
    const res = gitGuardMod.applyBranchProtection({
      branches: ['main'],
      requiredApprovals: 2,
      repoRoot: dir,
      execFn: (bin, args, opts) => {
        calls.push({ bin, args, opts, body: JSON.parse(opts.input) });
        return '';
      }
    });
    assert.equal(res.localHookInstalled, true);
    assert.deepEqual(res.errors, []);
    assert.equal(res.protectedBranches.length, 1);
    assert.deepEqual(res.protectedBranches[0], {
      branch: 'main',
      remoteProtected: true,
      enforceAdmins: true,
      requiredChecks: [gitGuardMod.DEFAULT_QUALITY_GATE_CHECK]
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'gh');
    assert.deepEqual(calls[0].args, [
      'api',
      '--method',
      'PUT',
      'repos/:owner/:repo/branches/main/protection',
      '-H',
      'Accept: application/vnd.github+json',
      '--input',
      '-'
    ]);
    assert.equal(calls[0].opts.cwd, dir);
    assert.equal(calls[0].opts.stdio, 'pipe');
    assert.deepEqual(calls[0].body, {
      required_status_checks: {
        strict: true,
        contexts: [gitGuardMod.DEFAULT_QUALITY_GATE_CHECK]
      },
      enforce_admins: true,
      required_pull_request_reviews: {
        dismiss_stale_reviews: true,
        require_code_owner_reviews: false,
        required_approving_review_count: 2
      },
      restrictions: null
    });

    const fallbackRes = gitGuardMod.applyBranchProtection({
      branches: ['develop'],
      requiredChecks: [],
      enforceAdmins: false,
      requiredApprovals: -3,
      repoRoot: dir,
      execFn: (_bin, _args, opts) => {
        const parsed = JSON.parse(opts.input);
        assert.equal(parsed.required_status_checks, null);
        assert.equal(parsed.enforce_admins, false);
        assert.equal(parsed.required_pull_request_reviews.required_approving_review_count, 0);
        throw new Error('offline');
      }
    });
    assert.deepEqual(fallbackRes.protectedBranches[0], {
      branch: 'develop',
      remoteProtected: false,
      localProtected: true
    });
  });
});

describe('Issue #107: Risk-proportional execution lanes, instant pre-commit guard & spec-drift precision', () => {
  let dir;
  beforeEach(() => {
    dir = makeRepo();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('checkSpecDrift guards PRODUCT.md and docs/specs/*.md while exempting non-structural package.json edits', () => {
    fs.mkdirSync(path.join(dir, 'docs/specs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'PRODUCT.md'), '# Constitution\n- **INV-01**: Original\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'docs/specs/cap-01.md'), '# CAP-01\nOriginal spec\n', 'utf8');
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        name: 'demo-pkg',
        version: '0.3.2',
        description: 'Old desc',
        scripts: { test: 'node --test' },
        files: ['bin'],
        dependencies: { picocolors: '^1.0.0' }
      }, null, 2),
      'utf8'
    );
    assert.equal(git(dir, 'add', '.').status, 0);
    assert.equal(git(dir, 'commit', '-m', 'chore: baseline specs and package').status, 0);
    assert.equal(git(dir, 'checkout', '-b', 'feature/issue-#107-lanes').status, 0);

    // 1. Non-structural package.json change (version, scripts, files, description) -> NO drift trigger
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        name: 'demo-pkg',
        version: '0.4.0',
        description: 'Updated desc',
        scripts: { test: 'node --test', lint: 'node --check index.js' },
        files: ['bin', '.agent/schemas'],
        dependencies: { picocolors: '^1.0.0' }
      }, null, 2),
      'utf8'
    );
    const nonStructural = checkSpecDrift({ diffFiles: ['package.json'], ticketId: 107, repoRoot: dir });
    assert.equal(nonStructural.passed, true);
    assert.equal(nonStructural.triggers.length, 0);

    // 2. Structural package.json change (dependencies added) -> DEPENDENCY_MANIFEST_MUTATION
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        name: 'demo-pkg',
        version: '0.4.0',
        dependencies: { picocolors: '^1.0.0', zod: '^3.22.0' }
      }, null, 2),
      'utf8'
    );
    const structuralPkg = checkSpecDrift({ diffFiles: ['package.json'], ticketId: 107, repoRoot: dir });
    assert.equal(structuralPkg.passed, false);
    assert.equal(structuralPkg.triggers[0].category, 'DEPENDENCY_MANIFEST_MUTATION');

    // 3. PRODUCT.md and docs/specs/*.md mutations -> PRODUCT_SPEC_MUTATION until ADR exists
    fs.writeFileSync(path.join(dir, 'PRODUCT.md'), '# Constitution\n- **INV-01**: Mutated\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'docs/specs/cap-01.md'), '# CAP-01\nMutated spec\n', 'utf8');
    const specMut = checkSpecDrift({
      diffFiles: ['PRODUCT.md', 'docs/specs/cap-01.md'],
      ticketId: 107,
      repoRoot: dir
    });
    assert.equal(specMut.passed, false);
    assert.equal(specMut.triggers.length, 2);
    assert.ok(specMut.triggers.every((t) => t.category === 'PRODUCT_SPEC_MUTATION'));

    // 4. Accepted ADR for ticket #107 governs both PRODUCT_SPEC_MUTATION and DEPENDENCY_MANIFEST_MUTATION
    createADR({
      title: 'Govern spec and dependency update',
      scope: 'technical',
      ticketId: 107,
      supersedes: ['CAP-01'],
      repoRoot: dir
    });
    const governed = checkSpecDrift({
      diffFiles: ['package.json', 'PRODUCT.md', 'docs/specs/cap-01.md'],
      ticketId: 107,
      repoRoot: dir
    });
    assert.equal(governed.passed, true);
    assert.ok(governed.linkedADRs.includes('ADR-001'));
  });

  it('triageChange classifies trivial, standard, and full lanes accurately and audits downward overrides', () => {
    assert.equal(typeof qualityGateMod.triageChange, 'function');
    assert.equal(git(dir, 'checkout', '-b', 'feature/issue-#107-triage').status, 0);

    // 1. Trivial docs/CSS diff (<= 25 lines, LOW risk, 0 drift triggers)
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs/guide.md'), '# Guide\nFixed a typo.\n', 'utf8');
    const trivialRes = qualityGateMod.triageChange({
      diffFiles: ['docs/guide.md'],
      repoRoot: dir
    });
    assert.equal(trivialRes.lane, 'trivial');
    assert.equal(trivialRes.computedLane, 'trivial');
    assert.equal(trivialRes.requirements.remoteTicketRequired, false);
    assert.equal(trivialRes.requirements.coverageRequired, false);
    assert.equal(trivialRes.requirements.mutationRequired, false);
    assert.equal(trivialRes.requirements.reviewSubagents, 0);

    // 2. Standard source code diff (<= 200 lines, LOW/MEDIUM risk, 0 drift triggers)
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/formatter.mjs'), 'export const fmt = (x) => String(x).trim();\n', 'utf8');
    const standardRes = qualityGateMod.triageChange({
      diffFiles: ['src/formatter.mjs'],
      repoRoot: dir
    });
    assert.equal(standardRes.lane, 'standard');
    assert.equal(standardRes.computedLane, 'standard');
    assert.equal(standardRes.requirements.coverageRequired, true);
    assert.equal(standardRes.requirements.mutationRequired, false);
    assert.equal(standardRes.requirements.reviewSubagents, 1);

    // Upward override standard -> full requires no reason
    const escalated = qualityGateMod.triageChange({
      diffFiles: ['src/formatter.mjs'],
      laneOverride: 'full',
      repoRoot: dir
    });
    assert.equal(escalated.lane, 'full');
    assert.equal(escalated.overridden, true);
    assert.equal(escalated.downgraded, false);

    // Downward override standard -> trivial without --reason MUST throw
    assert.throws(
      () => qualityGateMod.triageChange({ diffFiles: ['src/formatter.mjs'], laneOverride: 'trivial', repoRoot: dir }),
      /requires a non-empty --reason/
    );

    // Downward override with --reason succeeds and appends LANE_DOWNGRADE_OVERRIDDEN to audit chain
    const downgraded = qualityGateMod.triageChange({
      diffFiles: ['src/formatter.mjs'],
      laneOverride: 'trivial',
      reason: 'Comment-only tweak in JS file',
      repoRoot: dir
    });
    assert.equal(downgraded.lane, 'trivial');
    assert.equal(downgraded.downgraded, true);
    assert.equal(downgraded.reason, 'Comment-only tweak in JS file');
    const chain = verifyAuditChain(dir);
    assert.equal(chain.valid, true);
    assert.ok(chain.records.some((r) => r.event === 'LANE_DOWNGRADE_OVERRIDDEN'));

    // 3. CRITICAL risk diff -> full lane; downward override FORBIDDEN even with reason
    fs.mkdirSync(path.join(dir, 'src/auth'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/auth/jwt.mjs'), 'export const verifyJwt = () => true;\n', 'utf8');
    const criticalRes = qualityGateMod.triageChange({
      diffFiles: ['src/auth/jwt.mjs'],
      repoRoot: dir
    });
    assert.equal(criticalRes.lane, 'full');
    assert.equal(criticalRes.riskLevel, 'CRITICAL');
    assert.throws(
      () =>
        qualityGateMod.triageChange({
          diffFiles: ['src/auth/jwt.mjs'],
          laneOverride: 'standard',
          reason: 'Try to skip mutation on auth',
          repoRoot: dir
        }),
      /CRITICAL/
    );

    // 4. Invalid lane name throws
    assert.throws(
      () => qualityGateMod.triageChange({ diffFiles: ['docs/guide.md'], laneOverride: 'turbo', repoRoot: dir }),
      /Invalid lane/
    );

    // 5. CLI `triage` command + formatCLIResult
    const cliTriage = runCLI(['triage', 'docs/guide.md'], null, dir);
    assert.equal(cliTriage.success, true);
    assert.equal(cliTriage.triage.lane, 'trivial');
    assert.match(formatCLIResult(cliTriage, ['triage']), /trivial/i);
  });

  it('issueGateReceipt and verifyGateReceipt enforce lane-specific receipt contracts for trivial, standard, and full lanes', () => {
    assert.equal(git(dir, 'checkout', '-b', 'feature/issue-#107-receipts').status, 0);
    fs.writeFileSync(path.join(dir, 'note.md'), 'hello\n', 'utf8');
    assert.equal(git(dir, 'add', 'note.md').status, 0);
    assert.equal(git(dir, 'commit', '-m', 'docs: add note').status, 0);

    // 1. Trivial lane: signs valid receipt with null coverage/mutation & auto-trivial-gate, still requires driftCheckPassed===true
    const trivialBadDrift = issueGateReceipt({
      issueId: 'L-1001',
      branch: 'feature/issue-#107-receipts',
      lane: 'trivial',
      repoRoot: dir
    });
    assert.equal(trivialBadDrift.success, false);
    assert.deepEqual(trivialBadDrift.missing, ['driftCheckPassed']);

    const trivialRejectedReview = issueGateReceipt({
      issueId: 'L-1001',
      branch: 'feature/issue-#107-receipts',
      lane: 'trivial',
      peerReviewApproved: false,
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(trivialRejectedReview.success, true);
    assert.equal(trivialRejectedReview.receipt.peerReviewApproved, false);
    assert.equal(verifyGateReceipt({ headSha: trivialRejectedReview.receipt.headSha, repoRoot: dir }).valid, false);

    const trivialOk = issueGateReceipt({
      issueId: 'L-1001',
      branch: 'feature/issue-#107-receipts',
      lane: 'trivial',
      laneReason: 'Docs typo',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(trivialOk.success, true);
    assert.equal(trivialOk.receipt.lane, 'trivial');
    assert.equal(trivialOk.receipt.laneReason, 'Docs typo');
    assert.equal(trivialOk.receipt.coveragePct, null);
    assert.equal(trivialOk.receipt.mutationPct, null);
    assert.equal(trivialOk.receipt.docsOnly, false);
    assert.equal(trivialOk.receipt.mutationStatus, 'trivial-lane');
    assert.equal(trivialOk.receipt.peerReviewApproved, true);
    assert.equal(trivialOk.receipt.reviewer, '@auto-trivial-gate');
    assert.equal(verifyGateReceipt({ headSha: trivialOk.receipt.headSha, repoRoot: dir }).valid, true);

    // 2. Standard lane: requires coveragePct & peerReviewApproved, allows omitted mutationPct ('standard-lane-skipped')
    const stdMissingCov = issueGateReceipt({
      issueId: 107,
      branch: 'feature/issue-#107-receipts',
      lane: 'standard',
      peerReviewApproved: true,
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(stdMissingCov.success, false);
    assert.deepEqual(stdMissingCov.missing, ['coveragePct']);

    const stdMissingReview = issueGateReceipt({
      issueId: 107,
      branch: 'feature/issue-#107-receipts',
      lane: 'standard',
      coveragePct: 88.5,
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(stdMissingReview.success, false);
    assert.deepEqual(stdMissingReview.missing, ['peerReviewApproved']);

    const stdOk = issueGateReceipt({
      issueId: 107,
      branch: 'feature/issue-#107-receipts',
      lane: 'standard',
      coveragePct: 88.5,
      peerReviewApproved: true,
      reviewer: '@std-reviewer',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(stdOk.success, true);
    assert.equal(stdOk.receipt.lane, 'standard');
    assert.equal(stdOk.receipt.coveragePct, 88.5);
    assert.equal(stdOk.receipt.mutationPct, null);
    assert.equal(stdOk.receipt.mutationStatus, 'standard-lane-skipped');
    assert.equal(verifyGateReceipt({ headSha: stdOk.receipt.headSha, repoRoot: dir }).valid, true);

    const stdMeasuredMut = issueGateReceipt({
      issueId: 107,
      branch: 'feature/issue-#107-receipts',
      lane: 'standard',
      coveragePct: 91.0,
      mutationPct: 64.0,
      peerReviewApproved: true,
      reviewer: '@std-reviewer',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(stdMeasuredMut.success, true);
    assert.equal(stdMeasuredMut.receipt.mutationStatus, 'measured');
    assert.equal(stdMeasuredMut.receipt.mutationPct, 64.0);
  });

  it('generateReviewPlan scales subagents (0 trivial, 1 standard, 2-3 full), hooks pre-commit is instant, and stage pre-pr auto-escalates when diff outgrows trivial lane', () => {
    // 1. Pre-commit hook template omits slow `test --affected-only`
    const templates = gitGuardMod.buildHookTemplates();
    assert.match(templates['pre-commit'], /guard pre-commit/);
    assert.equal(templates['pre-commit'].includes('test --affected-only'), false);

    // 2. Review plan scaling by lane
    assert.equal(generateReviewPlan({ repoRoot: dir, lane: 'trivial' }).subagentsCount, 0);
    assert.equal(generateReviewPlan({ repoRoot: dir, lane: 'standard' }).subagentsCount, 1);
    assert.ok(generateReviewPlan({ repoRoot: dir, lane: 'full' }).subagentsCount >= 2);

    // 3. `stage begin --lane trivial` creates local L-* session on chore/quick-* without workbench HTML bloat
    const quickBegin = runCLI(
      ['stage', 'begin', '--lane', 'trivial', '--title', 'Fix typo in docs', '--checkout'],
      null,
      dir
    );
    assert.equal(quickBegin.success, true);
    assert.match(String(quickBegin.stage.issueId), /^L-/);
    assert.equal(quickBegin.stage.branch, 'chore/quick-fix-typo-in-docs');
    assert.equal(quickBegin.stage.session.lane, 'trivial');
    assert.equal(fs.existsSync(path.join(dir, '.agent/workbench/index.html')), false);

    // Trivial docs edit stays in trivial lane and signs receipt directly in `stage pre-pr`
    fs.writeFileSync(path.join(dir, 'README.md'), '# Genesis Repo\nFixed typo.\n', 'utf8');
    assert.equal(git(dir, 'add', 'README.md').status, 0);
    assert.equal(git(dir, 'commit', '-m', 'docs: fix typo').status, 0);

    const quickPrePr = runCLI(['stage', 'pre-pr', '--summary', 'Fix typo in docs'], null, dir);
    assert.equal(quickPrePr.success, true);
    assert.equal(quickPrePr.stage.lane, 'trivial');
    assert.ok(quickPrePr.stage.receipt, 'Expected trivial lane stage pre-pr to sign Stage 7 receipt automatically');
    assert.equal(quickPrePr.stage.receipt.lane, 'trivial');
    assert.equal(quickPrePr.stage.receipt.mutationStatus, 'trivial-lane');

    // Complete local trivial session cleanly
    const quickDone = runCLI(['stage', 'complete'], null, dir);
    assert.equal(quickDone.success, true);
    assert.equal(quickDone.stage.released, true);

    // 4. Auto-escalation: start trivial, but edit source JS -> pre-pr escalates session to standard and withholds unmeasured receipt
    assert.equal(git(dir, 'checkout', 'main').status, 0);
    const sneakyBegin = runCLI(
      ['stage', 'begin', '--lane', 'trivial', '--title', 'Quick tweak', '--checkout', '--ui'],
      null,
      dir
    );
    assert.equal(sneakyBegin.success, true);
    assert.equal(fs.existsSync(path.join(dir, '.agent/workbench/index.html')), true);

    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/logic.mjs'), 'export const compute = (a, b) => a + b;\n', 'utf8');
    assert.equal(git(dir, 'add', 'src/logic.mjs').status, 0);
    assert.equal(git(dir, 'commit', '-m', 'feat: add compute logic').status, 0);

    const escalatedPrePr = runCLI(['stage', 'pre-pr', '--summary', 'Added logic'], null, dir);
    assert.equal(escalatedPrePr.stage.lane, 'standard');
    assert.equal(escalatedPrePr.stage.receipt, null, 'Escalated standard lane must not auto-sign unmeasured trivial receipt');
    const chain = verifyAuditChain(dir);
    assert.ok(chain.records.some((r) => r.event === 'LANE_AUTO_ESCALATED'));
  });
});
