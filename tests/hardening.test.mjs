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
  decideADR,
  compactADRs,
  listADRs,
  executeCompositeStage,
  executeRelease,
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
  verifyAuditChain,
  CANONICAL_SDLC_SKILLS,
  DEPRECATED_SDLC_SKILLS,
  provisionAgentIntegrations,
  installFramework,
  auditSkills,
  auditReadme,
  auditWiki,
  buildWikiCodeMap,
  parseMermaidDiagram,
  parseFrontmatter
} from '../.agent/scripts/sdlc-engine.mjs';
import * as coreMod from '../.agent/scripts/lib/core.mjs';
import * as gitGuardMod from '../.agent/scripts/lib/git-guard.mjs';
import * as qualityGateMod from '../.agent/scripts/lib/quality-gate.mjs';
import * as installerMod from '../.agent/scripts/lib/installer.mjs';
import * as pmMod from '../.agent/scripts/lib/pm-provider.mjs';

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
    assert.equal(skillRes.skillAudit.skillsScanned, 10, 'must scan all 10 canonical sdlc* skills');
    assert.ok(skillRes.skillAudit.skills.every((s) => s.skill.startsWith('sdlc')));
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
    const createdAdr = createADR({
      title: 'Govern spec and dependency update',
      scope: 'technical',
      ticketId: 107,
      supersedes: ['CAP-01'],
      repoRoot: dir
    });
    assert.equal(createdAdr.adr.status, 'pending_approval');
    decideADR({
      adrId: createdAdr.adr.id,
      action: 'approve',
      reviewer: '@test',
      reason: 'Approved technical ADR for ticket #107',
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

  it('prevents guard receipt --lane, session start --lane, and pre-edit --reason from bypassing triageChange or CRITICAL auto-escalation', () => {
    // 1. Pre-edit `stage begin --lane trivial --reason "..."` must NOT suppress auto-escalation when JS/CRITICAL files are edited
    const preEditBegin = runCLI(
      ['stage', 'begin', '--lane', 'trivial', '--reason', 'Initial guess before editing', '--title', 'Touch files', '--checkout'],
      null,
      dir
    );
    assert.equal(preEditBegin.success, true);
    assert.equal(preEditBegin.stage.session.laneDowngraded, false);

    fs.mkdirSync(path.join(dir, 'src/auth'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/auth/jwt.mjs'), 'export const signJwt = () => "tok";\n', 'utf8');
    assert.equal(git(dir, 'add', 'src/auth/jwt.mjs').status, 0);
    assert.equal(git(dir, 'commit', '-m', 'feat: add jwt signer').status, 0);

    // 2. `guard receipt --lane trivial` on CRITICAL diff MUST throw/fail closed without signing a receipt
    assert.throws(
      () => runCLI(['guard', 'receipt', '--lane', 'trivial', '--reason', 'Attempt bypass'], null, dir),
      /CRITICAL/
    );

    // 3. `stage pre-pr` must auto-escalate to `full` despite pre-edit `--reason` and withhold unmeasured receipt
    const critPrePr = runCLI(['stage', 'pre-pr', '--summary', 'Auth update'], null, dir);
    assert.equal(critPrePr.stage.lane, 'full');
    assert.equal(critPrePr.stage.receipt, null);

    // 4. `session start --lane trivial` on an existing CRITICAL diff must also reject downgrade
    assert.throws(
      () =>
        runCLI(
          ['session', 'start', '--issue', '107', '--branch', preEditBegin.stage.branch, '--lane', 'trivial', '--reason', 'Bypass', '--force'],
          null,
          dir
        ),
      /CRITICAL/
    );

    // 5. Even after a valid audited downgrade on a LOW-risk JS file, adding a CRITICAL file forces escalation to `full`
    assert.equal(git(dir, 'checkout', 'main').status, 0);
    const lowBegin = runCLI(['stage', 'begin', '--issue', '108', '--title', 'Helper', '--checkout'], null, dir);
    assert.equal(lowBegin.success, true);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/util.mjs'), 'export const id = (x) => x;\n', 'utf8');
    assert.equal(git(dir, 'add', 'src/util.mjs').status, 0);
    assert.equal(git(dir, 'commit', '-m', 'feat: add util').status, 0);

    // `guard receipt --lane trivial` without `--reason` on standard diff must fail
    assert.throws(
      () => runCLI(['guard', 'receipt', '--lane', 'trivial'], null, dir),
      /requires a non-empty --reason/
    );

    // Audited downgrade on LOW-risk diff succeeds
    const auditedPrePr = runCLI(
      ['stage', 'pre-pr', '--lane', 'trivial', '--reason', 'One-liner identity helper'],
      null,
      dir
    );
    assert.equal(auditedPrePr.stage.lane, 'trivial');
    assert.ok(auditedPrePr.stage.receipt);

    // Now introduce CRITICAL auth change on same branch -> `guard receipt` (without flags) must escalate to `full` and refuse unmeasured receipt!
    fs.mkdirSync(path.join(dir, 'src/security'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/security/secret.mjs'), 'export const check = () => true;\n', 'utf8');
    assert.equal(git(dir, 'add', 'src/security/secret.mjs').status, 0);
    assert.equal(git(dir, 'commit', '-m', 'feat: add security check').status, 0);

    const postCritReceipt = runCLI(['guard', 'receipt'], null, dir);
    assert.equal(postCritReceipt.success, false);
    const chain = verifyAuditChain(dir);
    assert.ok(chain.records.some((r) => r.event === 'LANE_DOWNGRADE_OVERRIDDEN'));
    assert.ok(chain.records.some((r) => r.event === 'LANE_AUTO_ESCALATED'));
  });
});

describe('Issue #109: Right-sized canonical skills, Claude unified packaging, and Cursor native skills', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-skills-109-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('enforces <=200-char Use-when/Not-for descriptions, zero hardcoded approve verdicts, and clean SkillSpector audit across all 10 canonical skills', () => {
    assert.equal(CANONICAL_SDLC_SKILLS.length, 10);
    assert.ok(CANONICAL_SDLC_SKILLS.every((id) => id.startsWith('sdlc')), 'all canonical skills must be sdlc*');

    const skillAudit = auditSkills(REPO_ROOT);
    assert.equal(skillAudit.skillsAudited, 10);
    assert.equal(skillAudit.totalFindings, 0);
    assert.equal(skillAudit.success, true);

    for (const skillId of CANONICAL_SDLC_SKILLS) {
      const skillPath = path.join(REPO_ROOT, '.agent/skills', skillId, 'SKILL.md');
      assert.equal(fs.existsSync(skillPath), true, `Missing canonical skill ${skillId}`);
      const raw = fs.readFileSync(skillPath, 'utf8');
      const { frontmatter, body } = parseFrontmatter(raw);

      assert.equal(frontmatter.name, skillId, `${skillId} frontmatter name mismatch`);
      assert.ok(
        frontmatter.description && frontmatter.description.length > 0 && frontmatter.description.length <= 200,
        `${skillId} description must be 1..200 chars (got ${frontmatter.description?.length || 0}): "${frontmatter.description}"`
      );
      assert.match(frontmatter.description, /\bUse when\b/, `${skillId} description must specify 'Use when' trigger`);
      assert.match(frontmatter.description, /\bNot for\b/, `${skillId} description must specify 'Not for' anti-trigger`);
      assert.equal(
        /--verdict\s+approve\b/.test(body),
        false,
        `${skillId} must derive review verdict from blockers rather than hardcoding '--verdict approve'`
      );
    }

    // Specific router & skill right-sizing invariants
    const routerRaw = fs.readFileSync(path.join(REPO_ROOT, '.agent/skills/sdlc/SKILL.md'), 'utf8');
    assert.match(routerRaw, /stage begin --issue/);
    assert.match(routerRaw, /\/sdlc quick/);
    assert.match(routerRaw, /\/sdlc triage/);
    assert.match(routerRaw, /sdlc-engine\.mjs doctor`\s*\|/);
    assert.match(routerRaw, /sdlc-engine\.mjs serve`\s*\|/);

    const gateRaw = fs.readFileSync(path.join(REPO_ROOT, '.agent/skills/sdlc-gate/SKILL.md'), 'utf8');
    assert.match(gateRaw, /review plan/);
    assert.match(gateRaw, /--verdict <approve\|request-changes>/);

    const statusParsed = parseFrontmatter(fs.readFileSync(path.join(REPO_ROOT, '.agent/skills/sdlc-status/SKILL.md'), 'utf8'));
    assert.equal(statusParsed.frontmatter.tools.includes('write_file'), false, 'sdlc-status must be read-only');
    assert.equal(statusParsed.frontmatter.tools.includes('edit_file'), false, 'sdlc-status must be read-only');

    const wikiRaw = fs.readFileSync(path.join(REPO_ROOT, '.agent/skills/sdlc-wiki/SKILL.md'), 'utf8');
    assert.equal(wikiRaw.includes('.agent/gate-receipts.jsonl'), false, 'sdlc-wiki must remain repo-agnostic');

    for (const guardedSkill of ['sdlc-doctor', 'sdlc-product', 'sdlc-release']) {
      const content = fs.readFileSync(path.join(REPO_ROOT, '.agent/skills', guardedSkill, 'SKILL.md'), 'utf8');
      assert.ok(content.includes('⚠️ Confirm with user before'), `${guardedSkill} must include confirmation gate`);
    }

    // Wiki code map & Skills-Reference alignment with ADR-010
    const codeMap = buildWikiCodeMap(REPO_ROOT);
    assert.deepEqual(
      codeMap.skills.map((s) => s.name),
      [...CANONICAL_SDLC_SKILLS].sort(),
      'buildWikiCodeMap must index all 10 canonical skills'
    );
    const skillsRefRaw = fs.readFileSync(path.join(REPO_ROOT, 'wiki/Skills-Reference.md'), 'utf8');
    assert.equal(/\/sdlc doctor`\s*\|\s*`node \.agent\/scripts\/sdlc-engine\.mjs doctor --fix`/.test(skillsRefRaw), false);
    assert.match(skillsRefRaw, /\/sdlc doctor`\s*\|\s*`node \.agent\/scripts\/sdlc-engine\.mjs doctor`/);
    assert.match(skillsRefRaw, /stage begin --issue/);
  });

  it('verifies every sdlc-engine.mjs subcommand referenced across all 10 SKILL.md files exists in sdlc-engine.mjs', () => {
    const engineSrc = fs.readFileSync(path.join(REPO_ROOT, '.agent/scripts/sdlc-engine.mjs'), 'utf8');
    const validCommands = new Set(['help', 'install']);
    for (const m of engineSrc.matchAll(/case\s+'([a-z0-9-]+)'\s*:/g)) {
      validCommands.add(m[1]);
    }

    let checkedReferences = 0;
    for (const skillId of CANONICAL_SDLC_SKILLS) {
      const raw = fs.readFileSync(path.join(REPO_ROOT, '.agent/skills', skillId, 'SKILL.md'), 'utf8');
      for (const m of raw.matchAll(/sdlc-engine\.mjs\s+([a-z0-9-]+)/g)) {
        const subcmd = m[1];
        checkedReferences++;
        assert.ok(
          validCommands.has(subcmd),
          `Skill '${skillId}' references unknown sdlc-engine.mjs subcommand '${subcmd}'`
        );
      }
    }
    assert.ok(checkedReferences >= 25, `Expected at least 25 verified CLI command references (got ${checkedReferences})`);
  });

  it('removes duplicate .claude/commands/sdlc*.md, syncs plugin.json version from package.json, and installs real .cursor/skills/<id>/SKILL.md', () => {
    // Seed legacy duplicate .claude/commands/sdlc*.md and a user-authored command that must be preserved
    const legacyCmdDir = path.join(dir, '.claude/commands');
    const standalonePersonaId = ['ub', 'mode'].join('-');
    fs.mkdirSync(legacyCmdDir, { recursive: true });
    fs.writeFileSync(path.join(legacyCmdDir, 'sdlc.md'), 'legacy duplicate router command\n', 'utf8');
    fs.writeFileSync(path.join(legacyCmdDir, 'sdlc-flow.md'), 'legacy duplicate flow command\n', 'utf8');
    fs.writeFileSync(path.join(legacyCmdDir, 'sdlc-review-gate.md'), 'legacy retired sdlc command\n', 'utf8');
    fs.writeFileSync(path.join(legacyCmdDir, `${standalonePersonaId}.md`), 'standalone persona command\n', 'utf8');
    fs.writeFileSync(path.join(legacyCmdDir, 'custom-deploy.md'), 'user custom command\n', 'utf8');

    const res = provisionAgentIntegrations({
      agents: ['claude', 'cursor'],
      targetDir: dir,
      global: false,
      packageRoot: REPO_ROOT
    });
    assert.equal(res.skillsCount, 10);

    // 1. Legacy canonical/deprecated .claude/commands/sdlc*.md pruned; standalone & custom commands preserved
    assert.equal(fs.existsSync(path.join(legacyCmdDir, 'sdlc.md')), false);
    assert.equal(fs.existsSync(path.join(legacyCmdDir, 'sdlc-flow.md')), false);
    assert.equal(fs.existsSync(path.join(legacyCmdDir, 'sdlc-review-gate.md')), false);
    assert.equal(fs.existsSync(path.join(legacyCmdDir, `${standalonePersonaId}.md`)), true);
    assert.equal(fs.existsSync(path.join(legacyCmdDir, 'custom-deploy.md')), true);

    // 2. All 10 .claude/skills/<id>/SKILL.md + Cowork .zip + .cursor/skills/<id>/SKILL.md + .cursor/rules/<id>.mdc exist
    for (const skillId of CANONICAL_SDLC_SKILLS) {
      assert.equal(fs.existsSync(path.join(dir, '.claude/commands', `${skillId}.md`)), false);
      const claudeSkillPath = path.join(dir, '.claude/skills', skillId, 'SKILL.md');
      assert.equal(fs.existsSync(claudeSkillPath), true, `Missing Claude skill ${skillId}`);
      const claudeParsed = parseFrontmatter(fs.readFileSync(claudeSkillPath, 'utf8'));
      assert.match(claudeParsed.frontmatter.description, /\bUse when\b/);

      assert.equal(fs.existsSync(path.join(dir, '.claude/cowork', `${skillId}.zip`)), true);

      const cursorSkillPath = path.join(dir, '.cursor/skills', skillId, 'SKILL.md');
      assert.equal(fs.existsSync(cursorSkillPath), true, `Missing Cursor native skill ${skillId}`);
      const cursorRaw = fs.readFileSync(cursorSkillPath, 'utf8');
      const cursorParsed = parseFrontmatter(cursorRaw);
      assert.equal(cursorParsed.frontmatter.name, skillId);
      assert.match(cursorParsed.frontmatter.description, /\bUse when\b/);
      assert.equal(/\b(read_file|write_file|edit_file|run_command|invoke_subagent)\b/.test(cursorRaw), false);

      const mdcPath = path.join(dir, '.cursor/rules', `${skillId}.mdc`);
      assert.equal(fs.existsSync(mdcPath), true);
      assert.equal(fs.readFileSync(mdcPath, 'utf8').includes('{{args}}'), false, `${skillId}.mdc must not leak {{args}}`);
    }

    // 3. .claude-plugin/plugin.json dynamically matches package.json version and omits duplicate "commands"
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const pluginManifest = JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin/plugin.json'), 'utf8'));
    assert.equal(pluginManifest.version, pkg.version);
    assert.equal(pluginManifest.skills, './.claude/skills');
    assert.equal(pluginManifest.commands, undefined);

    // 4. Global install also provisions ~/.cursor/skills/<id>/SKILL.md and avoids ~/.claude/commands/<id>.md
    const fakeHome = path.join(dir, 'fake-home');
    fs.mkdirSync(path.join(fakeHome, '.claude/commands'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.claude/commands/sdlc.md'), 'stale global cmd\n', 'utf8');
    provisionAgentIntegrations({
      agents: ['claude', 'cursor'],
      global: true,
      homeDir: fakeHome,
      packageRoot: REPO_ROOT
    });
    assert.equal(fs.existsSync(path.join(fakeHome, '.claude/commands/sdlc.md')), false);
    assert.equal(fs.existsSync(path.join(fakeHome, '.claude/skills/sdlc-tdd/SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(fakeHome, '.cursor/skills/sdlc-flow/SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(fakeHome, '.cursor/skills/sdlc-tdd/SKILL.md')), true);
  });
});

// ===========================================================================
// Issue #111: Slim npm package (<250 KB), untracked binaries, single workbench & v0.4.0 sync
// ===========================================================================
describe('Issue #111: Slim npm package (<250 KB), untracked binaries, and single workbench', () => {
  it('keeps npm pack tarball under 250 KB with all 10 canonical skills and zero third-party binaries', () => {
    const packOut = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const [packInfo] = JSON.parse(packOut);
    assert.ok(packInfo.size < 250_000, `Expected npm tarball < 250 KB, got ${packInfo.size} bytes`);
    assert.ok(packInfo.unpackedSize < 1_000_000, `Expected unpacked size < 1 MB, got ${packInfo.unpackedSize} bytes`);

    const packedPaths = packInfo.files.map((f) => f.path);
    for (const skillId of CANONICAL_SDLC_SKILLS) {
      assert.ok(
        packedPaths.includes(`.agent/skills/${skillId}/SKILL.md`),
        `npm tarball must include .agent/skills/${skillId}/SKILL.md`
      );
    }
    assert.equal(
      packedPaths.some((p) => p.includes('impeccable') || p.includes('scripts/bin')),
      false,
      'npm tarball must not ship impeccable assets or native binaries'
    );
  });

  it('untracks native skill binaries in git, removes abandoned workbench/, and aligns manifest/plugin/README versions', () => {
    const trackedBins = execFileSync('git', ['ls-files', '*scripts/bin*'], {
      cwd: REPO_ROOT,
      encoding: 'utf8'
    }).trim();
    assert.equal(trackedBins, '', `Expected zero tracked native binaries in git index, got:\n${trackedBins}`);

    const gitignoreRaw = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
    assert.match(gitignoreRaw, /\*\*\/skills\/\*\/scripts\/bin\//);

    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'workbench')), false, 'Duplicate SvelteKit workbench/ prototype must be removed');
    assert.equal(fs.existsSync(path.join(REPO_ROOT, '.agent/scripts/lib/workbench-server.mjs')), true);

    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const pluginManifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.claude-plugin/plugin.json'), 'utf8'));
    const readmeRaw = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
    assert.equal(pluginManifest.version, pkg.version, '.claude-plugin/plugin.json version must match package.json');
    assert.ok(readmeRaw.includes(`Version-${pkg.version}-`), `README.md badge must match package.json version ${pkg.version}`);
  });

  it('ignores git rm --cached files covered by .gitignore in gitDiffForFile and auditSecurity while catching unignored secrets', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-111-sec-'));
    const fakeAwsKey = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
    try {
      git(tmpDir, 'init', '-b', 'main');
      git(tmpDir, 'config', 'user.email', 'test@example.com');
      git(tmpDir, 'config', 'user.name', 'Test User');

      fs.mkdirSync(path.join(tmpDir, 'vendor/bin'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'vendor/bin/fake-binary'), `binary-bytes-${fakeAwsKey}-tail\n`, 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test\n', 'utf8');
      git(tmpDir, 'add', '.');
      git(tmpDir, 'commit', '-m', 'initial commit on main');

      git(tmpDir, 'checkout', '-b', 'feature/test-111');
      git(tmpDir, 'rm', '--cached', 'vendor/bin/fake-binary');
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'vendor/bin/\n', 'utf8');
      git(tmpDir, 'add', '.gitignore');
      git(tmpDir, 'commit', '-m', 'untrack vendor binary');

      fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test Updated\n', 'utf8');
      git(tmpDir, 'add', 'README.md');
      git(tmpDir, 'commit', '-m', 'second commit on branch');

      const diffForIgnored = coreMod.gitDiffForFile('vendor/bin/fake-binary', tmpDir);
      assert.equal(
        diffForIgnored.split('\n').some((l) => l.startsWith('+') && !l.startsWith('+++') && l.includes(fakeAwsKey)),
        false,
        `gitDiffForFile must not synthesize + lines for gitignored file removed via git rm --cached, got:\n${diffForIgnored}`
      );

      const cleanSec = qualityGateMod.auditSecurity(tmpDir);
      assert.equal(cleanSec.secretLeaksCount, 0, `Expected 0 secret leaks for gitignored cached-rm file, got: ${JSON.stringify(cleanSec.secretViolations)}`);
      assert.equal(cleanSec.passed, true);

      // Verify unignored untracked file with a real secret is still caught
      fs.writeFileSync(path.join(tmpDir, 'untracked-secret.txt'), `aws_key=${fakeAwsKey}\n`, 'utf8');
      const dirtySec = qualityGateMod.auditSecurity(tmpDir);
      assert.equal(dirtySec.passed, false);
      assert.ok(dirtySec.secretLeaksCount >= 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('preserves prior release rows in compactADRs and advances createADR numbering past compacted SRS.md rows', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-111-srs-'));
    try {
      fs.mkdirSync(path.join(tmpDir, 'docs/adr'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'docs/SRS.md'),
        [
          '# SRS',
          '',
          '## Compacted Architectural Decisions',
          '',
          '| ID | Title | Scope | Ticket | Supersedes | Compacted In Release | Decision |',
          '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
          '| `ADR-001` | Legacy v0.3.0 Architecture | `technical` | #63 | CAP-01 | `v0.3.0` | Keep modular lib split. |',
          '| `ADR-002` | Legacy v0.3.0 Skills | `architectural` | #68 | CAP-05 | `v0.3.0` | Consolidate skills. |',
          ''
        ].join('\n'),
        'utf8'
      );

      // Even if an in-flight ADR shares ADR-001 from a legacy reset, compacting into v0.4.0 must NOT overwrite the v0.3.0 row
      fs.writeFileSync(
        path.join(tmpDir, 'docs/adr/ADR-001-readme-landing.md'),
        [
          '---',
          'id: ADR-001',
          'title: New v0.4.0 README Template',
          'status: accepted',
          'scope: technical',
          'ticket: #100',
          'supersedes: CAP-11',
          'createdAt: 2026-11-12T00:00:00.000Z',
          '---',
          '',
          '# ADR-001: New v0.4.0 README Template',
          '',
          '## 2. Decision',
          'Add 10-30-90 README engine.'
        ].join('\n'),
        'utf8'
      );

      const compactRes = compactADRs({ releaseVersion: 'v0.4.0', repoRoot: tmpDir });
      assert.equal(compactRes.compactedCount, 1);

      const srsAfter = fs.readFileSync(path.join(tmpDir, 'docs/SRS.md'), 'utf8');
      assert.match(srsAfter, /\|\s*`ADR-001`\s*\|\s*Legacy v0\.3\.0 Architecture\s*\|.*\|\s*`v0\.3\.0`\s*\|/);
      assert.match(srsAfter, /\|\s*`ADR-002`\s*\|\s*Legacy v0\.3\.0 Skills\s*\|.*\|\s*`v0\.3\.0`\s*\|/);
      assert.match(srsAfter, /\|\s*`ADR-001`\s*\|\s*New v0\.4\.0 README Template\s*\|.*\|\s*`v0\.4\.0`\s*\|/);

      // Creating a new ADR when docs/adr/ is empty must advance past max ID in docs/SRS.md (ADR-002 -> ADR-003)
      const created = createADR({ title: 'Post-Compaction Decision', repoRoot: tmpDir });
      assert.equal(created.adr.id, 'ADR-003');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('audits wiki/*.md cleanly on a fresh checkout where gitignored .agent/.cache/ does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-111-wiki-'));
    try {
      fs.cpSync(path.join(REPO_ROOT, 'wiki'), path.join(tmpDir, 'wiki'), { recursive: true });
      fs.cpSync(path.join(REPO_ROOT, 'docs'), path.join(tmpDir, 'docs'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
      fs.cpSync(path.join(REPO_ROOT, '.agent/scripts'), path.join(tmpDir, '.agent/scripts'), { recursive: true });
      fs.cpSync(path.join(REPO_ROOT, '.agent/skills'), path.join(tmpDir, '.agent/skills'), { recursive: true });
      fs.cpSync(path.join(REPO_ROOT, '.agent/sdlc-config.json'), path.join(tmpDir, '.agent/sdlc-config.json'));
      fs.cpSync(path.join(REPO_ROOT, 'PRODUCT.md'), path.join(tmpDir, 'PRODUCT.md'));
      fs.mkdirSync(path.join(tmpDir, '.github/ISSUE_TEMPLATE'), { recursive: true });
      fs.cpSync(path.join(REPO_ROOT, '.github/ISSUE_TEMPLATE'), path.join(tmpDir, '.github/ISSUE_TEMPLATE'), { recursive: true });
      fs.cpSync(path.join(REPO_ROOT, '.github/PULL_REQUEST_TEMPLATE.md'), path.join(tmpDir, '.github/PULL_REQUEST_TEMPLATE.md'));

      // Explicitly ensure gitignored .agent/.cache does NOT exist in clean checkout simulation
      assert.equal(fs.existsSync(path.join(tmpDir, '.agent/.cache')), false);
      const wikiRes = auditWiki(tmpDir, { strict: true });
      assert.equal(wikiRes.passed, true, `Expected clean-checkout wiki audit to pass, got: ${JSON.stringify(wikiRes.findings)}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// Issue #114: README, Wiki, PRD & SRS documentation alignment + Archlens links
// ===========================================================================
describe('Issue #114: Documentation alignment & Archlens repository link hygiene', () => {
  it('links https://github.com/fmatar/archlens across README.md, llms.txt, CONTRIBUTING.md, wiki, PRD, and SRS', () => {
    const requiredDocPaths = [
      'README.md',
      'llms.txt',
      'CONTRIBUTING.md',
      'wiki/Home.md',
      'wiki/Architecture.md',
      'wiki/Skills-Reference.md',
      'wiki/Traceability.md',
      'wiki/Codebase-Map.md',
      'docs/PRD.md',
      'docs/SRS.md'
    ];

    for (const relPath of requiredDocPaths) {
      const content = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
      assert.ok(
        content.includes('https://github.com/fmatar/archlens'),
        `Expected ${relPath} to include canonical Archlens repository link https://github.com/fmatar/archlens`
      );
    }
  });

  it('passes strict README and Wiki audits with zero errors or polish warnings and removes obsolete v0.0.x docs', () => {
    const readmeRes = auditReadme(REPO_ROOT, { strict: true });
    assert.equal(readmeRes.passed, true, `README strict audit failed: ${JSON.stringify(readmeRes.findings)}`);
    assert.equal(readmeRes.errorsCount, 0);
    assert.equal(readmeRes.warningsCount, 0, `Expected 0 README polish warnings, got: ${JSON.stringify(readmeRes.findings)}`);

    const wikiRes = auditWiki(REPO_ROOT, { strict: true });
    assert.equal(wikiRes.passed, true, `Wiki strict audit failed: ${JSON.stringify(wikiRes.findings)}`);

    // Obsolete pre-v0.1 NoteZen-era docs must be removed
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'docs/SDLC_AGENTIC_OPERATIONS_GUIDE.md')), false);
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'docs/SDLC_COMPLIANCE_REPORT.md')), false);

    // Active prose in CONTRIBUTING.md, PRD.md, SRS.md (before Compacted Architectural Decisions), and wiki/Architecture.md must match ADR-010
    const contributing = fs.readFileSync(path.join(REPO_ROOT, 'CONTRIBUTING.md'), 'utf8');
    assert.match(contributing, /10 canonical skills/i);
    assert.doesNotMatch(contributing, /\b11 canonical skills\b/i);

    const prd = fs.readFileSync(path.join(REPO_ROOT, 'docs/PRD.md'), 'utf8');
    assert.doesNotMatch(prd, /SvelteKit 5|6 focused agentic skills/i);
    assert.match(prd, /CAP-11/);

    const srsActive = fs.readFileSync(path.join(REPO_ROOT, 'docs/SRS.md'), 'utf8').split('## Compacted Architectural Decisions')[0];
    assert.doesNotMatch(srsActive, /SvelteKit 5|6 focused agentic skills|8 Verb Skills/i);

    const archWiki = fs.readFileSync(path.join(REPO_ROOT, 'wiki/Architecture.md'), 'utf8');
    assert.match(archWiki, /readme-sync\.mjs/);
    assert.match(archWiki, /detectReadmeArchetype/);
    assert.match(archWiki, /scaffoldReadme/);
    assert.doesNotMatch(archWiki, /detectProjectArchetype|initReadme/);

    const traceWiki = fs.readFileSync(path.join(REPO_ROOT, 'wiki/Traceability.md'), 'utf8');
    assert.doesNotMatch(traceWiki, /\.agent\/gate-receipts\.jsonl/);
    assert.match(traceWiki, /STAGE_7_GATE_RECEIPT_SIGNED/);

    // buildWikiCodeMap must honor .archlens/policy.json concentric rings (4 / 6 / 6 / 1) with zero outward imports
    const codeMap = buildWikiCodeMap(REPO_ROOT);
    assert.deepEqual(
      codeMap.rings.map((r) => ({ name: r.name, count: r.modules.length })),
      [
        { name: 'Ring 0: domain-core', count: 4 },
        { name: 'Ring 1: governance-models', count: 6 },
        { name: 'Ring 2: adapters-orchestrators', count: 6 },
        { name: 'Ring 3: cli-entrypoints', count: 1 }
      ]
    );
    const ringIndexByPath = new Map(codeMap.modules.map((m) => [m.path, m.ringIndex]));
    for (const mod of codeMap.modules) {
      for (const imp of mod.imports) {
        if (ringIndexByPath.has(imp)) {
          assert.ok(
            mod.ringIndex >= ringIndexByPath.get(imp),
            `Expected inward-only ring import, got ${mod.path} (Ring ${mod.ringIndex}) -> ${imp} (Ring ${ringIndexByPath.get(imp)})`
          );
        }
      }
    }
  });
});

// ===========================================================================
// Issue #116: Zero author branding, retired legacy mode skill, clean footers & GitHub-width diagram
// ===========================================================================
describe('Issue #116: Author-neutral terminology, 10 canonical skills, clean footers, and GitHub-width How It Works diagram', () => {
  const authorPattern = new RegExp(
    [
      ['rob', 'ert', '(?:\\s+c\\.?)?\\s*', 'mar', 'tin'].join(''),
      ['unc', 'le', '\\s*', 'bob'].join('')
    ].join('|'),
    'i'
  );
  const retiredModeId = ['ub', 'mode'].join('-');
  const retiredModePattern = new RegExp(
    [
      retiredModeId,
      ['ub', 'mode'].join('_'),
      ['/sdlc\\s+', 'ub\\b'].join('')
    ].join('|'),
    'i'
  );

  it('removes all author-specific branding and retired mode ids across 100% of tracked files', () => {
    const trackedFiles = execFileSync('git', ['ls-files'], {
      cwd: REPO_ROOT,
      encoding: 'utf8'
    })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const authorHits = [];
    const retiredHits = [];

    for (const relPath of trackedFiles) {
      const fullPath = path.join(REPO_ROOT, relPath);
      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) continue;
      const content = fs.readFileSync(fullPath, 'utf8');
      if (authorPattern.test(content)) {
        authorHits.push(relPath);
      }
      if (retiredModePattern.test(content)) {
        retiredHits.push(relPath);
      }
    }

    assert.deepEqual(authorHits, [], `Expected zero author-branding matches across repo, found in: ${authorHits.join(', ')}`);
    assert.deepEqual(retiredHits, [], `Expected zero coupled persona-skill matches across 100% of tracked files, found in: ${retiredHits.join(', ')}`);

    assert.equal(CANONICAL_SDLC_SKILLS.length, 10);
    assert.equal(CANONICAL_SDLC_SKILLS.includes(retiredModeId), false);
    assert.equal(DEPRECATED_SDLC_SKILLS.includes(retiredModeId), false);
  });

  it('prunes retired sdlc-* skill directories, .md, .mdc, and Cowork .zip bundles in both local and global provisioning', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-116-prune-'));
    const legacySdlcSkill = 'sdlc-review-gate';
    try {
      const localTarget = path.join(tmpDir, 'repo');
      const fakeHome = path.join(tmpDir, 'home');

      // Seed retired sdlc-* skill artifacts in local repo
      fs.mkdirSync(path.join(localTarget, '.agent/skills', legacySdlcSkill), { recursive: true });
      fs.writeFileSync(path.join(localTarget, '.agent/skills', legacySdlcSkill, 'SKILL.md'), 'legacy\n', 'utf8');
      fs.mkdirSync(path.join(localTarget, '.claude/skills', legacySdlcSkill), { recursive: true });
      fs.writeFileSync(path.join(localTarget, '.claude/skills', legacySdlcSkill, 'SKILL.md'), 'legacy\n', 'utf8');
      fs.mkdirSync(path.join(localTarget, '.claude/cowork'), { recursive: true });
      fs.writeFileSync(path.join(localTarget, '.claude/cowork', `${legacySdlcSkill}.zip`), 'zip', 'utf8');
      fs.mkdirSync(path.join(localTarget, '.cursor/skills', legacySdlcSkill), { recursive: true });
      fs.writeFileSync(path.join(localTarget, '.cursor/skills', legacySdlcSkill, 'SKILL.md'), 'legacy\n', 'utf8');
      fs.mkdirSync(path.join(localTarget, '.cursor/rules'), { recursive: true });
      fs.writeFileSync(path.join(localTarget, '.cursor/rules', `${legacySdlcSkill}.mdc`), 'legacy\n', 'utf8');

      provisionAgentIntegrations({
        agents: ['gemini', 'claude', 'cursor'],
        targetDir: localTarget,
        global: false,
        packageRoot: REPO_ROOT
      });

      assert.equal(fs.existsSync(path.join(localTarget, '.agent/skills', legacySdlcSkill)), false);
      assert.equal(fs.existsSync(path.join(localTarget, '.claude/skills', legacySdlcSkill)), false);
      assert.equal(fs.existsSync(path.join(localTarget, '.claude/cowork', `${legacySdlcSkill}.zip`)), false);
      assert.equal(fs.existsSync(path.join(localTarget, '.cursor/skills', legacySdlcSkill)), false);
      assert.equal(fs.existsSync(path.join(localTarget, '.cursor/rules', `${legacySdlcSkill}.mdc`)), false);

      // Seed retired sdlc-* skill artifacts in global home directory
      fs.mkdirSync(path.join(fakeHome, '.gemini/config/skills', legacySdlcSkill), { recursive: true });
      fs.writeFileSync(path.join(fakeHome, '.gemini/config/skills', legacySdlcSkill, 'SKILL.md'), 'legacy\n', 'utf8');
      fs.mkdirSync(path.join(fakeHome, '.claude/skills', legacySdlcSkill), { recursive: true });
      fs.writeFileSync(path.join(fakeHome, '.claude/skills', legacySdlcSkill, 'SKILL.md'), 'legacy\n', 'utf8');
      fs.mkdirSync(path.join(fakeHome, '.claude/cowork'), { recursive: true });
      fs.writeFileSync(path.join(fakeHome, '.claude/cowork', `${legacySdlcSkill}.zip`), 'zip', 'utf8');
      fs.mkdirSync(path.join(fakeHome, '.cursor/skills', legacySdlcSkill), { recursive: true });
      fs.writeFileSync(path.join(fakeHome, '.cursor/skills', legacySdlcSkill, 'SKILL.md'), 'legacy\n', 'utf8');
      fs.mkdirSync(path.join(fakeHome, '.cursor/rules'), { recursive: true });
      fs.writeFileSync(path.join(fakeHome, '.cursor/rules', `${legacySdlcSkill}.mdc`), 'legacy\n', 'utf8');

      provisionAgentIntegrations({
        agents: ['gemini', 'claude', 'cursor'],
        global: true,
        homeDir: fakeHome,
        packageRoot: REPO_ROOT
      });

      assert.equal(fs.existsSync(path.join(fakeHome, '.gemini/config/skills', legacySdlcSkill)), false);
      assert.equal(fs.existsSync(path.join(fakeHome, '.claude/skills', legacySdlcSkill)), false);
      assert.equal(fs.existsSync(path.join(fakeHome, '.claude/cowork', `${legacySdlcSkill}.zip`)), false);
      assert.equal(fs.existsSync(path.join(fakeHome, '.cursor/skills', legacySdlcSkill)), false);
      assert.equal(fs.existsSync(path.join(fakeHome, '.cursor/rules', `${legacySdlcSkill}.mdc`)), false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('removes Archlens links from page footers while keeping inline README/Wiki architecture links', () => {
    const wikiFooter = fs.readFileSync(path.join(REPO_ROOT, 'wiki/_Footer.md'), 'utf8');
    assert.doesNotMatch(wikiFooter, /archlens/i, 'wiki/_Footer.md must not link to Archlens');

    const wikiSidebar = fs.readFileSync(path.join(REPO_ROOT, 'wiki/_Sidebar.md'), 'utf8');
    const sidebarBottomLinks = wikiSidebar.split('---')[1] || '';
    assert.doesNotMatch(sidebarBottomLinks, /github\.com\/fmatar\/archlens/i, 'wiki/_Sidebar.md bottom links must not link externally to Archlens');

    const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
    const [readmeBody, readmeFooter = ''] = readme.split('## Documentation & Roadmap');
    assert.ok(readmeBody.includes('https://github.com/fmatar/archlens'), 'README body must preserve inline Archlens link');
    assert.doesNotMatch(readmeFooter, /archlens/i, 'README footer sections must not contain links to Archlens');
  });

  it('renders a compact vertical flowchart TD in README How It Works that fits GitHub column width cleanly', () => {
    const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
    const howSection = readme.split('## How It Works')[1]?.split('\n### ')[0] || '';
    const mermaidMatch = howSection.match(/```mermaid\r?\n([\s\S]*?)```/);
    assert.ok(mermaidMatch, 'Expected Mermaid diagram under ## How It Works in README.md');

    const diagram = mermaidMatch[1].trim();
    assert.match(diagram, /%%\{init:\s*\{'theme':\s*'neutral'\}\}%%/, 'Diagram must use neutral theme');
    assert.match(diagram, /\bflowchart\s+TD\b/, 'Diagram must use top-down flowchart TD to fit GitHub page width');
    assert.doesNotMatch(diagram, /\bflowchart\s+LR\b/, 'Diagram must not use wide horizontal flowchart LR');
    assert.equal(diagram.includes('\\n'), false, 'Diagram must not contain raw \\n escape sequences');
    assert.doesNotMatch(diagram, /<br\s*\/?>/i, 'Diagram must not use HTML tags in labels');

    const parsed = parseMermaidDiagram(diagram);
    assert.ok(parsed.nodes.length >= 6, `Expected >= 6 nodes in How It Works diagram, got ${parsed.nodes.length}`);
    assert.ok(parsed.edges.length >= 7, `Expected >= 7 edges in How It Works diagram, got ${parsed.edges.length}`);
    for (const node of parsed.nodes) {
      assert.ok(
        node.label.length <= 62,
        `Node ${node.id} label exceeds 62-char compact width budget (${node.label.length}): "${node.label}"`
      );
    }

    // Verify maximum outgoing fan-out per node <= 3 so parallel columns stay <= ~720px (< GitHub 830px viewport)
    const fanOut = new Map();
    for (const edge of parsed.edges) {
      fanOut.set(edge.from, (fanOut.get(edge.from) || 0) + 1);
    }
    for (const [nodeId, count] of fanOut.entries()) {
      assert.ok(count <= 3, `Node ${nodeId} fans out to ${count} parallel nodes (must be <= 3 to fit GitHub page width)`);
    }

    // Verify wiki/Traceability.md also uses vertical flowchart TD rather than an 8-node horizontal chain
    const traceWiki = fs.readFileSync(path.join(REPO_ROOT, 'wiki/Traceability.md'), 'utf8');
    assert.doesNotMatch(traceWiki, /\bflowchart\s+LR\b/);
    assert.match(traceWiki, /\bflowchart\s+TD\b/);
  });
});

// ===========================================================================
// Issue #118: Strict sdlc* namespace isolation & decoupling from standalone coding-persona skills
// ===========================================================================
describe('Issue #118: Strict sdlc* namespace isolation and decoupling from standalone coding-persona skills', () => {
  const standalonePersonaId = ['ub', 'mode'].join('-');

  it('scopes both CANONICAL_SDLC_SKILLS and DEPRECATED_SDLC_SKILLS strictly to the sdlc* namespace', () => {
    assert.equal(CANONICAL_SDLC_SKILLS.length, 10);
    for (const id of CANONICAL_SDLC_SKILLS) {
      assert.match(id, /^sdlc(?:-[a-z0-9-]+)?$/, `Canonical skill "${id}" must reside in the sdlc* namespace`);
    }
    assert.ok(DEPRECATED_SDLC_SKILLS.length >= 14);
    for (const id of DEPRECATED_SDLC_SKILLS) {
      assert.match(id, /^sdlc-[a-z0-9-]+$/, `Deprecated skill "${id}" must be a retired sdlc-* framework skill, never a standalone persona skill`);
    }
  });

  it('preserves standalone personal and third-party skills untouched and leaks zero non-sdlc* skills during local and global install', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-118-isolation-'));
    try {
      const localTarget = path.join(tmpDir, 'repo');
      const cleanTarget = path.join(tmpDir, 'clean-repo');
      const fakeHome = path.join(tmpDir, 'home');
      const standaloneIds = [standalonePersonaId, 'ponytail', 'impeccable', 'team-style'];

      for (const id of standaloneIds) {
        const sentinelSkill = `---\nname: ${id}\ndescription: "SENTINEL-SKILL:${id}"\n---\n`;
        fs.mkdirSync(path.join(localTarget, '.agent/skills', id), { recursive: true });
        fs.writeFileSync(path.join(localTarget, '.agent/skills', id, 'SKILL.md'), sentinelSkill, 'utf8');
        fs.mkdirSync(path.join(localTarget, '.claude/skills', id), { recursive: true });
        fs.writeFileSync(path.join(localTarget, '.claude/skills', id, 'SKILL.md'), `SENTINEL-CLAUDE:${id}\n`, 'utf8');
        fs.mkdirSync(path.join(localTarget, '.claude/cowork'), { recursive: true });
        fs.writeFileSync(path.join(localTarget, '.claude/cowork', `${id}.zip`), `SENTINEL-ZIP:${id}`, 'utf8');
        fs.mkdirSync(path.join(localTarget, '.claude/commands'), { recursive: true });
        fs.writeFileSync(path.join(localTarget, '.claude/commands', `${id}.md`), `SENTINEL-CMD:${id}\n`, 'utf8');
        fs.mkdirSync(path.join(localTarget, '.cursor/skills', id), { recursive: true });
        fs.writeFileSync(path.join(localTarget, '.cursor/skills', id, 'SKILL.md'), `SENTINEL-CURSOR:${id}\n`, 'utf8');
        fs.mkdirSync(path.join(localTarget, '.cursor/rules'), { recursive: true });
        fs.writeFileSync(path.join(localTarget, '.cursor/rules', `${id}.mdc`), `SENTINEL-RULE:${id}\n`, 'utf8');

        fs.mkdirSync(path.join(fakeHome, '.gemini/config/skills', id), { recursive: true });
        fs.writeFileSync(path.join(fakeHome, '.gemini/config/skills', id, 'SKILL.md'), `SENTINEL-GLOBAL-GEMINI:${id}\n`, 'utf8');
        fs.mkdirSync(path.join(fakeHome, '.claude/skills', id), { recursive: true });
        fs.writeFileSync(path.join(fakeHome, '.claude/skills', id, 'SKILL.md'), `SENTINEL-GLOBAL-CLAUDE:${id}\n`, 'utf8');
        fs.mkdirSync(path.join(fakeHome, '.claude/cowork'), { recursive: true });
        fs.writeFileSync(path.join(fakeHome, '.claude/cowork', `${id}.zip`), `SENTINEL-GLOBAL-ZIP:${id}`, 'utf8');
        fs.mkdirSync(path.join(fakeHome, '.cursor/skills', id), { recursive: true });
        fs.writeFileSync(path.join(fakeHome, '.cursor/skills', id, 'SKILL.md'), `SENTINEL-GLOBAL-CURSOR:${id}\n`, 'utf8');
        fs.mkdirSync(path.join(fakeHome, '.cursor/rules'), { recursive: true });
        fs.writeFileSync(path.join(fakeHome, '.cursor/rules', `${id}.mdc`), `SENTINEL-GLOBAL-RULE:${id}\n`, 'utf8');
        fs.mkdirSync(path.join(fakeHome, '.grok/skills', id), { recursive: true });
        fs.writeFileSync(path.join(fakeHome, '.grok/skills', id, 'SKILL.md'), `SENTINEL-GLOBAL-GROK:${id}\n`, 'utf8');
      }

      installFramework({
        targetDir: localTarget,
        global: false,
        agents: ['gemini', 'claude', 'cursor', 'grok'],
        skipDetect: true,
        packageRoot: REPO_ROOT
      });

      installFramework({
        global: true,
        homeDir: fakeHome,
        agents: ['gemini', 'claude', 'cursor', 'grok'],
        skipDetect: true,
        packageRoot: REPO_ROOT
      });

      for (const id of standaloneIds) {
        const expectedSkill = `---\nname: ${id}\ndescription: "SENTINEL-SKILL:${id}"\n---\n`;
        assert.equal(fs.readFileSync(path.join(localTarget, '.agent/skills', id, 'SKILL.md'), 'utf8'), expectedSkill, `Local .agent/skills/${id}/SKILL.md must never be overwritten`);
        assert.equal(fs.readFileSync(path.join(localTarget, '.claude/skills', id, 'SKILL.md'), 'utf8'), `SENTINEL-CLAUDE:${id}\n`);
        assert.equal(fs.readFileSync(path.join(localTarget, '.claude/cowork', `${id}.zip`), 'utf8'), `SENTINEL-ZIP:${id}`);
        assert.equal(fs.readFileSync(path.join(localTarget, '.claude/commands', `${id}.md`), 'utf8'), `SENTINEL-CMD:${id}\n`);
        assert.equal(fs.readFileSync(path.join(localTarget, '.cursor/skills', id, 'SKILL.md'), 'utf8'), `SENTINEL-CURSOR:${id}\n`);
        assert.equal(fs.readFileSync(path.join(localTarget, '.cursor/rules', `${id}.mdc`), 'utf8'), `SENTINEL-RULE:${id}\n`);

        assert.equal(fs.readFileSync(path.join(fakeHome, '.gemini/config/skills', id, 'SKILL.md'), 'utf8'), `SENTINEL-GLOBAL-GEMINI:${id}\n`);
        assert.equal(fs.readFileSync(path.join(fakeHome, '.claude/skills', id, 'SKILL.md'), 'utf8'), `SENTINEL-GLOBAL-CLAUDE:${id}\n`);
        assert.equal(fs.readFileSync(path.join(fakeHome, '.claude/cowork', `${id}.zip`), 'utf8'), `SENTINEL-GLOBAL-ZIP:${id}`);
        assert.equal(fs.readFileSync(path.join(fakeHome, '.cursor/skills', id, 'SKILL.md'), 'utf8'), `SENTINEL-GLOBAL-CURSOR:${id}\n`);
        assert.equal(fs.readFileSync(path.join(fakeHome, '.cursor/rules', `${id}.mdc`), 'utf8'), `SENTINEL-GLOBAL-RULE:${id}\n`);
        assert.equal(fs.readFileSync(path.join(fakeHome, '.grok/skills', id, 'SKILL.md'), 'utf8'), `SENTINEL-GLOBAL-GROK:${id}\n`);
      }

      // Fresh clean target repo must receive strictly the 10 canonical sdlc* skills and zero non-sdlc* skills
      installFramework({
        targetDir: cleanTarget,
        global: false,
        agents: ['claude'],
        skipDetect: true,
        packageRoot: REPO_ROOT
      });
      const installedDirs = fs.readdirSync(path.join(cleanTarget, '.agent/skills')).sort();
      assert.deepEqual(installedDirs, [...CANONICAL_SDLC_SKILLS].sort(), 'installFramework must copy strictly CANONICAL_SDLC_SKILLS and leak zero non-sdlc* skills');
      assert.equal(fs.existsSync(path.join(cleanTarget, '.agent/skills/impeccable')), false);

      // Also verify auditSkills ignores standalone non-sdlc* skills even if they have unpinned npx calls
      fs.writeFileSync(
        path.join(localTarget, '.agent/skills/ponytail/SKILL.md'),
        '---\nname: ponytail\n---\nRun npx some-unpinned-pkg\n',
        'utf8'
      );
      const auditRes = auditSkills(localTarget);
      assert.equal(auditRes.success, true);
      assert.equal(auditRes.skillsScanned, 10);
      assert.equal(auditRes.totalFindings, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('documents workflow-vs-persona decoupling and strict sdlc* namespace isolation across skills, README, and Wiki', () => {
    const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
    assert.match(readme, /sdlc\*\s+namespace|standalone.*skills/i, 'README.md must document strict sdlc* namespace isolation');

    const wikiRef = fs.readFileSync(path.join(REPO_ROOT, 'wiki/Skills-Reference.md'), 'utf8');
    assert.match(wikiRef, /Namespace Isolation|Coding-Persona|standalone/i, 'wiki/Skills-Reference.md must document decoupling from standalone coding-persona skills');

    const doctorSkill = fs.readFileSync(path.join(REPO_ROOT, '.agent/skills/sdlc-doctor/SKILL.md'), 'utf8');
    assert.match(doctorSkill, /sdlc\*|standalone/i, 'sdlc-doctor/SKILL.md must state install leaves standalone skills untouched');
  });
});

// ===========================================================================
// Issue #120: Reset release baseline to version 0.0.1
// ===========================================================================
describe('Issue #120: Reset release baseline to version 0.0.1', () => {
  it('sets package.json, package-lock.json, plugin manifest, installer fallback, rule headers, and README badge to 0.0.1', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8'));
    const plugin = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.claude-plugin/plugin.json'), 'utf8'));
    const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');

    assert.equal(pkg.version, '0.0.1');
    assert.equal(lock.version, '0.0.1');
    assert.equal(lock.packages[''].version, '0.0.1');
    assert.equal(plugin.version, '0.0.1');
    assert.equal(installerMod.getFrameworkVersion(REPO_ROOT), '0.0.1');

    const emptyTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-120-ver-'));
    try {
      assert.equal(installerMod.getFrameworkVersion(emptyTmp), '0.0.1');
    } finally {
      fs.rmSync(emptyTmp, { recursive: true, force: true });
    }

    assert.ok(readme.includes('Version-0.0.1-'), 'README.md version badge must be 0.0.1');
    for (const rel of ['AGENTS.md', 'CLAUDE.md', '.cursorrules', '.windsurfrules', '.cursor/rules/agentic-sdlc.mdc']) {
      const content = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      assert.match(content, /Universal Engine v0\.0\.1/, `${rel} must declare Universal Engine v0.0.1`);
    }
  });

  it('resets CHANGELOG.md to a clean 0.0.1 baseline and removes legacy docs/proofs/proof-v0-*.md files', () => {
    const changelog = fs.readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
    assert.match(changelog, /^## \[0\.0\.1\]/m, 'CHANGELOG.md must define ## [0.0.1]');
    assert.doesNotMatch(
      changelog,
      /^## \[0\.(?:1|2|3|4)\.\d+\]/m,
      'CHANGELOG.md must not retain retired 0.1.x..0.4.x release headers'
    );

    const proofsDir = path.join(REPO_ROOT, 'docs/proofs');
    const proofEntries = fs.existsSync(proofsDir) ? fs.readdirSync(proofsDir) : [];
    assert.equal(
      proofEntries.some((f) => f.startsWith('proof-v0-')),
      false,
      `Legacy proof-v0-*.md files must be removed, found: ${proofEntries.join(', ')}`
    );
  });
});

// ===========================================================================
// Governance Hardening: release, stage begin, ADR approval, diff review plans & Node 24 CI actions
// ===========================================================================
describe('Governance Hardening: release, stage begin, ADR approval, diff review plans & Node 24 CI actions', () => {
  let dir;
  beforeEach(() => {
    dir = makeRepo();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('executeRelease refuses main/develop without mutating files, runs gate --strict, and fails closed when commit or tag fails', () => {
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n### Added\n- Feature\n', 'utf8');
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'tmp', version: '0.0.1', type: 'module', scripts: { test: 'node -e 0' } }, null, 2) + '\n',
      'utf8'
    );
    git(dir, 'add', 'CHANGELOG.md', 'package.json');
    assert.equal(git(dir, 'commit', '-q', '-m', 'chore: add changelog').status, 0);

    // 1. Refuse directly on main (before modifying package.json or CHANGELOG.md)
    assert.throws(
      () => executeRelease({ bump: 'patch', skipGate: true, repoRoot: dir }),
      /Refusing to execute release.*main/i
    );
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version, '0.0.1');
    assert.equal(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8').includes('## [0.0.2]'), false);

    // 2. Refuse directly on develop
    assert.equal(git(dir, 'checkout', '-q', '-b', 'develop').status, 0);
    assert.throws(
      () => executeRelease({ bump: 'patch', skipGate: true, repoRoot: dir }),
      /Refusing to execute release.*develop/i
    );

    // 3. Switch to release branch: verify executeRelease runs gate --strict (catches hardcoded secret that plain `gate` skips)
    assert.equal(git(dir, 'checkout', '-q', '-b', 'chore/release-v0.0.2').status, 0);
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
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
              coverage: `node -e "const fs=require('fs');fs.mkdirSync('coverage',{recursive:true});fs.writeFileSync('coverage/coverage-summary.json',JSON.stringify({total:{lines:{pct:95},branches:{pct:90}}}))"`,
              coverageFile: 'coverage/coverage-summary.json'
            },
            thresholds: { diffCoverage: 85, mutationScore: null }
          }
        ]
      }),
      'utf8'
    );
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    // Split token literal across runtime concatenation so our own repo's security scanner doesn't flag tests/hardening.test.mjs
    const fakeSecret = ['ghp', '_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'].join('');
    fs.writeFileSync(path.join(dir, 'src/leak.mjs'), `export const tok = "${fakeSecret}";\n`, 'utf8');
    fs.rmSync(path.join(dir, 'README.md'), { force: true });
    git(dir, 'add', '-A');
    assert.equal(git(dir, 'commit', '-q', '-m', 'test: add leak for strict gate check').status, 0);

    assert.throws(
      () => executeRelease({ bump: 'patch', skipGate: false, repoRoot: dir }),
      /Security Audit failed|Strict quality gate failed|Quality gate failed/i,
      'executeRelease must invoke gate --strict rather than non-strict gate'
    );

    // Clean up secret and test fail-closed when git commit fails (pre-commit hook exits 1) and when git tag already exists
    fs.rmSync(path.join(dir, 'src/leak.mjs'), { force: true });
    git(dir, 'add', '-A');
    assert.equal(git(dir, 'commit', '-q', '-m', 'chore: remove leak').status, 0);

    const hookPath = path.join(dir, '.git/hooks/pre-commit');
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.writeFileSync(hookPath, '#!/bin/sh\necho "hook blocked commit" >&2\nexit 1\n', { mode: 0o755 });
    assert.throws(
      () => executeRelease({ bump: 'patch', skipGate: true, repoRoot: dir }),
      /Release git commit\/tag failed/i,
      'executeRelease must fail closed when git commit fails instead of swallowing errors'
    );
    fs.rmSync(hookPath, { force: true });
    assert.equal(git(dir, 'reset', '--hard', 'HEAD').status, 0);

    assert.equal(git(dir, 'tag', '-a', 'v0.0.2', '-m', 'pre-existing tag').status, 0);
    assert.throws(
      () => executeRelease({ bump: 'patch', skipGate: true, repoRoot: dir }),
      /tag.*v0\.0\.2|already exists|Release git/i,
      'executeRelease must fail closed when git tag already exists instead of swallowing errors'
    );

    // Delete conflicting tag, add package-lock.json + .claude-plugin/plugin.json, and verify clean release commit + tag
    assert.equal(git(dir, 'tag', '-d', 'v0.0.2').status, 0);
    fs.writeFileSync(
      path.join(dir, 'package-lock.json'),
      JSON.stringify({ name: 'tmp', version: '0.0.1', packages: { '': { version: '0.0.1' } } }, null, 2) + '\n',
      'utf8'
    );
    fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'sdlc', version: '0.0.1' }, null, 2) + '\n', 'utf8');
    git(dir, 'add', 'package-lock.json', '.claude-plugin/plugin.json');
    assert.equal(git(dir, 'commit', '-q', '-m', 'chore: add lock and plugin').status, 0);

    const okRel = executeRelease({ bump: 'patch', skipGate: true, repoRoot: dir });
    assert.equal(okRel.success, true);
    assert.equal(okRel.newVersion, '0.0.2');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8')).version, '0.0.2');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin/plugin.json'), 'utf8')).version, '0.0.2');
    assert.equal(git(dir, 'tag', '-l', 'v0.0.2').stdout.trim(), 'v0.0.2');
  });

  it('stage begin refuses to auto-create remote issues without --create-issue and supports --local in full/standard lanes', () => {
    // 1. Omitting --issue, --local, --lane trivial, and --create-issue MUST fail closed without creating KANBAN/remote tickets
    assert.throws(
      () => executeCompositeStage({ action: 'begin', title: 'Unconfirmed Issue', repoRoot: dir }),
      /--issue|--local|--create-issue/i
    );
    const cliRefused = engine(dir, 'stage', 'begin', '--title', 'Unconfirmed CLI Issue');
    assert.notEqual(cliRefused.status, 0, 'CLI stage begin without --issue/--local/--create-issue must exit non-zero');
    assert.equal(fs.existsSync(path.join(dir, 'docs/KANBAN.md')), false, 'must not create a ticket in docs/KANBAN.md');

    // 2. Passing --local starts a full-lane session with a local L-* ID and checks out branch without creating a PM ticket
    const localBegin = runCLI(
      ['stage', 'begin', '--local', '--title', 'Local Full Session', '--type', 'fix', '--checkout'],
      null,
      dir
    );
    assert.equal(localBegin.success, true);
    assert.match(String(localBegin.stage.issueId), /^L-\d+$/);
    assert.equal(localBegin.stage.lane, 'full');
    assert.match(localBegin.stage.branch, /^feature\/L-\d+-local-full-session$/);
    assert.equal(fs.existsSync(path.join(dir, 'docs/KANBAN.md')), false, '--local must not create remote/KANBAN tickets');

    // 3. Passing --create-issue explicitly opts into ticket creation (hermetically pinned to local PM provider)
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({ projectManagement: { provider: 'local', livingBoard: 'docs/KANBAN.md' } }, null, 2),
      'utf8'
    );
    const explicitCreate = runCLI(
      ['stage', 'begin', '--create-issue', '--title', 'Confirmed Ticket', '--type', 'feat'],
      null,
      dir
    );
    assert.equal(explicitCreate.success, true);
    assert.equal(fs.existsSync(path.join(dir, 'docs/KANBAN.md')), true);
  });

  it('createADR defaults technical and architectural scopes to pending_approval until explicitly approved via decideADR, and prior accepted or compacted ADRs do not bypass pending or stateless CI checks', () => {
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'PRODUCT.md'), '# Constitution\n\n<!-- ADR_INDEX_START -->\n<!-- ADR_INDEX_END -->\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'docs/SRS.md'), '# SRS\n\n## Compacted Architectural Decisions\n| `ADR-000` | Prior | `technical` | #0 | CAP-01 | `v0.0.1` | Prior |\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'docs/AUDIT_CHAIN.jsonl'), '{"index":0,"event":"ADR_BATCH_COMPACTED"}\n', 'utf8');
    git(dir, 'add', '.');
    assert.equal(git(dir, 'commit', '-q', '-m', 'chore: seed historical compacted SRS and audit chain').status, 0);

    // Even with 0 files in docs/adr/ and historical ADR_BATCH_COMPACTED on main, mutating PRODUCT.md without an ADR MUST fail
    fs.writeFileSync(path.join(dir, 'PRODUCT.md'), '# Constitution\n- **INV-00**: Mutated\n\n<!-- ADR_INDEX_START -->\n<!-- ADR_INDEX_END -->\n', 'utf8');
    assert.equal(
      checkSpecDrift({ diffFiles: ['PRODUCT.md'], ticketId: null, repoRoot: dir }).passed,
      false,
      'historical ADR_BATCH_COMPACTED on main must not satisfy undeclared PRODUCT.md drift'
    );

    // Seed a pre-existing accepted ADR-001 on main so we also verify historical uncompacted ADRs never mask new drift
    const priorAdr = createADR({
      title: 'Baseline Historical Decision',
      scope: 'technical',
      ticketId: 1,
      supersedes: ['CAP-01'],
      repoRoot: dir
    });
    decideADR({
      adrId: priorAdr.adr.id,
      action: 'approve',
      reviewer: '@fady',
      reason: 'Baseline accepted on main',
      repoRoot: dir
    });
    git(dir, 'add', '.');
    assert.equal(git(dir, 'commit', '-q', '-m', 'chore: add baseline ADR-001').status, 0);

    assert.equal(git(dir, 'checkout', '-q', '-b', 'feature/L-900100-adr-gate').status, 0);
    fs.writeFileSync(path.join(dir, 'PRODUCT.md'), '# Constitution\n- **INV-01**: Updated\n\n<!-- ADR_INDEX_START -->\n<!-- ADR_INDEX_END -->\n', 'utf8');

    // Stateless CI check (ticketId: null) with zero ADR in the PR diff MUST fail despite accepted ADR-001 on main
    const statelessNoAdr = checkSpecDrift({
      diffFiles: ['PRODUCT.md'],
      ticketId: null,
      repoRoot: dir
    });
    assert.equal(statelessNoAdr.passed, false, 'stateless CI drift check must not pass from historical ADRs on main');

    const techAdr = runCLI(
      ['adr', 'create', '--title', 'Technical Drift Requires Approval', '--scope', 'technical', '--ticket', 'L-900100', '--supersedes', 'CAP-01'],
      null,
      dir
    );
    assert.equal(techAdr.adr.adr.status, 'pending_approval', 'technical ADRs must start in pending_approval');

    const driftWhilePending = checkSpecDrift({
      diffFiles: ['PRODUCT.md', techAdr.adr.relativePath],
      ticketId: 'L-900100',
      repoRoot: dir
    });
    assert.equal(driftWhilePending.passed, false, 'pending_approval technical ADR must not satisfy checkSpecDrift even when prior ADR-001 exists');

    const statelessWhilePending = checkSpecDrift({
      diffFiles: ['PRODUCT.md', techAdr.adr.relativePath],
      ticketId: null,
      repoRoot: dir
    });
    assert.equal(statelessWhilePending.passed, false, 'stateless CI drift check must block pending_approval ADRs');

    const approved = decideADR({
      adrId: techAdr.adr.adr.id,
      action: 'approve',
      reviewer: '@fady',
      reason: 'Explicitly reviewed and approved',
      repoRoot: dir
    });
    assert.equal(approved.adr.status, 'accepted');

    const driftAfterApprove = checkSpecDrift({
      diffFiles: ['PRODUCT.md', techAdr.adr.relativePath],
      ticketId: 'L-900100',
      repoRoot: dir
    });
    assert.equal(driftAfterApprove.passed, true, 'approved ADR with L-* ticket ID must satisfy checkSpecDrift');
    assert.deepEqual(driftAfterApprove.linkedADRs, ['ADR-002']);

    const statelessAfterApprove = checkSpecDrift({
      diffFiles: ['PRODUCT.md', techAdr.adr.relativePath],
      ticketId: null,
      repoRoot: dir
    });
    assert.equal(statelessAfterApprove.passed, true, 'stateless CI drift check must pass when accepted ADR-002 is in the PR diff');
    assert.deepEqual(statelessAfterApprove.linkedADRs, ['ADR-002']);
  });

  it('generateReviewPlan embeds modified file paths, diff stats, and actual unified diff hunks into every reviewer prompt', () => {
    assert.equal(git(dir, 'checkout', '-q', '-b', 'feature/issue-#122-auth-review').status, 0);
    startSession({
      issueId: '122',
      branch: 'feature/issue-#122-auth-review',
      stage: 6,
      lane: 'full',
      repoRoot: dir,
      force: true
    });
    fs.mkdirSync(path.join(dir, 'src/auth'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src/auth/jwt-verifier.mjs'),
      'export function verifyJwtSignature(token) {\n  return Boolean(token && token.includes("."));\n}\n',
      'utf8'
    );
    git(dir, 'add', 'src/auth/jwt-verifier.mjs');
    assert.equal(git(dir, 'commit', '-q', '-m', 'feat(auth): add jwt verifier').status, 0);

    const fullPlan = generateReviewPlan({ repoRoot: dir, lane: 'full' });
    assert.equal(fullPlan.subagentsCount, 3, 'CRITICAL auth file in full lane must schedule all 3 reviewers');
    assert.ok(Array.isArray(fullPlan.modifiedFiles));
    assert.ok(fullPlan.modifiedFiles.includes('src/auth/jwt-verifier.mjs'));
    assert.match(fullPlan.diff, /\+export function verifyJwtSignature/);

    for (const sub of fullPlan.payload.Subagents) {
      assert.ok(sub.Prompt.includes('src/auth/jwt-verifier.mjs'), `${sub.Role} prompt must include changed file path`);
      assert.match(sub.Prompt, /\+export function verifyJwtSignature/, `${sub.Role} prompt must embed the actual unified diff`);
      assert.equal(sub.Prompt.includes('flake-check --runs 10'), false, `${sub.Role} read-only prompt must not instruct running CLI flake-check`);
    }

    const stdPlan = generateReviewPlan({ repoRoot: dir, lane: 'standard' });
    assert.equal(stdPlan.subagentsCount, 1);
    assert.match(stdPlan.payload.Subagents[0].Prompt, /\+export function verifyJwtSignature/);
  });

  it('upgrades GitHub Actions workflows and installCIWorkflow template to Node 24 v7 actions with zero @v4 references', () => {
    const gateWf = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/sdlc-quality-gate.yml'), 'utf8');
    const wikiWf = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/publish-wiki.yml'), 'utf8');
    installCIWorkflow({ repoRoot: dir, force: true });
    const generatedWf = fs.readFileSync(path.join(dir, '.github/workflows/sdlc-quality-gate.yml'), 'utf8');

    for (const [label, content] of [
      ['.github/workflows/sdlc-quality-gate.yml', gateWf],
      ['generated sdlc-quality-gate.yml', generatedWf]
    ]) {
      assert.match(content, /actions\/checkout@v7/, `${label} must use actions/checkout@v7`);
      assert.match(content, /actions\/setup-node@v7/, `${label} must use actions/setup-node@v7`);
      assert.doesNotMatch(content, /actions\/(?:checkout|setup-node)@v4/, `${label} must not reference Node 20 @v4 actions`);
    }

    assert.match(wikiWf, /actions\/checkout@v7/, 'publish-wiki.yml must use actions/checkout@v7');
    assert.doesNotMatch(wikiWf, /actions\/checkout@v4/, 'publish-wiki.yml must not reference actions/checkout@v4');
  });

  it('enforces canonical Git Flow: default base branch develop, blocks direct feature PRs to main, and scaffolds release workflow', () => {
    // 1. In a single-branch repository (main only)
    assert.equal(coreMod.hasDevelopBranch(dir), false);
    assert.equal(coreMod.resolveDefaultBaseBranch(dir), 'main');

    // 2. Once develop exists, Git Flow becomes active
    git(dir, 'checkout', '-b', 'develop');
    assert.equal(coreMod.hasDevelopBranch(dir), true);
    assert.equal(coreMod.resolveDefaultBaseBranch(dir), 'develop');

    // 3. ensurePullRequest defaults baseBranch to develop
    let ghCaptured = [];
    const mockGh = (bin, args) => {
      ghCaptured.push({ bin, args });
      if (bin === 'git' && args[0] === 'push') return 'ok';
      if (bin === 'gh' && args[0] === 'pr' && args[1] === 'view') throw new Error('no PR');
      if (bin === 'gh' && args[0] === 'pr' && args[1] === 'create') {
        return 'https://github.com/fmatar/agentic-sdlc-framework/pull/201\n';
      }
      return '';
    };

    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({
        version: '2.1.0',
        projectManagement: { provider: 'github', key: 'SDLC' },
        modules: [{ name: 'root', path: '.', commands: { test: 'node -e 0' }, thresholds: { diffCoverage: 85, mutationScore: null } }]
      }),
      'utf8'
    );

    git(dir, 'checkout', '-b', 'feature/login-auth');
    startSession({
      issueId: 901,
      branch: 'feature/login-auth',
      stage: 5,
      repoRoot: dir,
      force: true
    });

    const prRes = pmMod.ensurePullRequest({
      issueId: 901,
      branch: 'feature/login-auth',
      title: 'feat: add login authentication',
      body: 'Closes #901',
      repoRoot: dir,
      execFn: mockGh
    });

    assert.equal(prRes.success, true);
    assert.equal(prRes.prNumber, 201);
    const prCreateCall = ghCaptured.find((c) => c.bin === 'gh' && c.args[0] === 'pr' && c.args[1] === 'create');
    assert.ok(prCreateCall, 'gh pr create must be called');
    const baseIdx = prCreateCall.args.indexOf('--base');
    assert.ok(baseIdx !== -1, '--base argument must be passed');
    assert.equal(prCreateCall.args[baseIdx + 1], 'develop', 'PR must target develop branch by default');

    // 4. verifyMergeGuard rejects direct merges from feature branch to main
    const directToMain = gitGuardMod.verifyMergeGuard({
      targetBranch: 'main',
      sourceBranch: 'feature/login-auth',
      repoRoot: dir
    });
    assert.equal(directToMain.allowed, false);
    assert.equal(directToMain.reasonCode, 'DIRECT_MERGE_TO_MAIN_FORBIDDEN');
    assert.match(directToMain.message, /Merges into 'main' must originate exclusively from 'develop'/);

    // 5. verifyMergeGuard allows merge to develop once Stage 7 receipt exists
    fs.writeFileSync(path.join(dir, 'login.mjs'), 'export const login = true;\n', 'utf8');
    git(dir, 'add', 'login.mjs');
    git(dir, 'commit', '-m', 'feat: login');
    const headSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    const receipt = issueGateReceipt({
      issueId: 901,
      branch: 'feature/login-auth',
      headSha,
      coveragePct: 90.0,
      mutationPct: 85.0,
      peerReviewApproved: true,
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(receipt.success, true);

    const mergeToDevelop = gitGuardMod.verifyMergeGuard({
      targetBranch: 'develop',
      sourceBranch: 'feature/login-auth',
      sourceSha: headSha,
      repoRoot: dir
    });
    assert.equal(mergeToDevelop.allowed, true);

    // 6. verifyMergeGuard allows develop to merge into main when backed by receipt
    const mergeDevelopToMain = gitGuardMod.verifyMergeGuard({
      targetBranch: 'main',
      sourceBranch: 'develop',
      sourceSha: headSha,
      repoRoot: dir
    });
    assert.equal(mergeDevelopToMain.allowed, true);

    // 7. installCIWorkflow scaffolds quality-gate, enforce-branch-flow, and release workflows
    const ciRes = installCIWorkflow({ repoRoot: dir, force: true });
    assert.equal(ciRes.success, true);
    assert.ok(fs.existsSync(path.join(dir, '.github/workflows/sdlc-quality-gate.yml')));
    assert.ok(fs.existsSync(path.join(dir, '.github/workflows/enforce-branch-flow.yml')));
    assert.ok(fs.existsSync(path.join(dir, '.github/workflows/release.yml')));

    const branchFlowYaml = fs.readFileSync(path.join(dir, '.github/workflows/enforce-branch-flow.yml'), 'utf8');
    assert.match(branchFlowYaml, /HEAD_REF:\s*\${{\s*github\.head_ref\s*}}/);
    assert.match(branchFlowYaml, /\$HEAD_REF.*!=.*develop/);
    assert.match(branchFlowYaml, /Branch policy violation/);

    const releaseYaml = fs.readFileSync(path.join(dir, '.github/workflows/release.yml'), 'utf8');
    assert.match(releaseYaml, /name:\s*Production Release/);
    assert.match(releaseYaml, /branches:\s*-\s*main/);
    assert.match(releaseYaml, /gate --strict/);
  });
});
