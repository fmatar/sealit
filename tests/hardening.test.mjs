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
import * as auditChainMod from '../.agent/scripts/lib/audit-chain.mjs';
import * as workbenchMod from '../.agent/scripts/lib/workbench-server.mjs';
import * as productDagMod from '../.agent/scripts/lib/product-dag.mjs';

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

  it('engine & library modules contain zero execSync/exec calls, zero legacy shell wrappers, and zero shell interpolations', async () => {
    const collectMjs = (dirPath) => {
      const out = [];
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) out.push(...collectMjs(full));
        else if (entry.isFile() && entry.name.endsWith('.mjs')) out.push(full);
      }
      return out;
    };
    const mjsFiles = collectMjs(SCRIPTS_SRC);
    assert.ok(mjsFiles.length >= 14, 'Expected to scan all .agent/scripts/**/*.mjs modules');
    for (const abs of mjsFiles) {
      const rel = path.relative(REPO_ROOT, abs).replace(/\\/g, '/');
      const src = fs.readFileSync(abs, 'utf8');
      assert.equal(
        /\bexecSync\b/.test(src),
        false,
        `Expected zero execSync references in ${rel}`
      );
      assert.equal(
        /(?:execSync|exec)\(\s*`[^`]*\$\{/.test(src),
        false,
        `Expected zero interpolated shell strings in ${rel}`
      );
    }
    const engineMod = await import('../.agent/scripts/sdlc-engine.mjs');
    assert.equal('execCommand' in coreMod, false, 'Expected execCommand removed from Ring 0 core.mjs');
    assert.equal('execAsync' in coreMod, false, 'Expected execAsync removed from Ring 0 core.mjs');
    assert.equal('execCommand' in engineMod, false, 'Expected execCommand removed from sdlc-engine.mjs');
    assert.equal('execAsync' in engineMod, false, 'Expected execAsync removed from sdlc-engine.mjs');
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

    // buildWikiCodeMap must honor .archlens/policy.json concentric rings (4 / 6 / 10 / 1) with zero outward imports
    const codeMap = buildWikiCodeMap(REPO_ROOT);
    assert.deepEqual(
      codeMap.rings.map((r) => ({ name: r.name, count: r.modules.length })),
      [
        { name: 'Ring 0: domain-core', count: 4 },
        { name: 'Ring 1: governance-models', count: 6 },
        { name: 'Ring 2: adapters-orchestrators', count: 10 },
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
      () => executeRelease({ bump: 'patch', repoRoot: dir }),
      /Refusing to execute release.*main/i
    );
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version, '0.0.1');
    assert.equal(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8').includes('## [0.0.2]'), false);

    // 2. Refuse directly on develop
    assert.equal(git(dir, 'checkout', '-q', '-b', 'develop').status, 0);
    assert.throws(
      () => executeRelease({ bump: 'patch', repoRoot: dir }),
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
      () => executeRelease({ bump: 'patch', repoRoot: dir }),
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
      () => executeRelease({ bump: 'patch', repoRoot: dir }),
      /Release git commit\/tag failed/i,
      'executeRelease must fail closed when git commit fails instead of swallowing errors'
    );
    fs.rmSync(hookPath, { force: true });
    assert.equal(git(dir, 'reset', '--hard', 'HEAD').status, 0);

    assert.equal(git(dir, 'tag', '-a', 'v0.0.2', '-m', 'pre-existing tag').status, 0);
    assert.throws(
      () => executeRelease({ bump: 'patch', repoRoot: dir }),
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

    const okRel = executeRelease({ bump: 'patch', repoRoot: dir });
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
    const compactSeed = { index: 0, timestamp: '2026-01-01T00:00:00.000Z', event: 'ADR_BATCH_COMPACTED', metadata: { count: 1 }, previousHash: '0'.repeat(64) };
    fs.writeFileSync(path.join(dir, 'docs/AUDIT_CHAIN.jsonl'), JSON.stringify({ ...compactSeed, currentHash: calculateRecordHash(compactSeed) }) + '\n', 'utf8');
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
    assert.match(releaseYaml, /command -v gh/);
    assert.match(releaseYaml, /api\.github\.com/);
  });
});

// ===========================================================================
// L-128000 Hardening: Ring 0, Redaction, Release & Workbench
// ===========================================================================
describe('L-128000 Hardening: Ring 0, Redaction, Release & Workbench', () => {
  let dir;
  beforeEach(() => {
    dir = makeRepo();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('appendAuditRecord refuses to append to a corrupted docs/AUDIT_CHAIN.jsonl', () => {
    auditChainMod.appendAuditRecord({ event: 'INIT_OK', metadata: { step: 1 }, repoRoot: dir });
    const auditPath = path.join(dir, 'docs/AUDIT_CHAIN.jsonl');
    const lines = fs.readFileSync(auditPath, 'utf8').trim().split('\n');
    const entry = JSON.parse(lines[0]);
    entry.event = 'TAMPERED_EVENT';
    fs.writeFileSync(auditPath, JSON.stringify(entry) + '\n', 'utf8');

    assert.throws(
      () => auditChainMod.appendAuditRecord({ event: 'NEXT', repoRoot: dir }),
      /Refusing to append to corrupted audit ledger/i
    );
  });

  it('verifyGateReceipt and guard verify CLI reject commits modifying config/code after receipt while allowing audit/session logs', () => {
    assert.equal(git(dir, 'checkout', '-q', '-b', 'feature/receipt-integrity').status, 0);
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\ncoverage/\n', 'utf8');
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/app.mjs'), 'export const v = 1;\n', 'utf8');
    git(dir, 'add', '-A');
    assert.equal(git(dir, 'commit', '-q', '-m', 'feat: initial app').status, 0);
    const sha1 = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    const issued = issueGateReceipt({
      issueId: 501,
      branch: 'feature/receipt-integrity',
      headSha: sha1,
      coveragePct: 92.5,
      mutationPct: null,
      peerReviewApproved: true,
      reviewer: '@reviewer',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(issued.success, true);

    // Committing docs/AUDIT_CHAIN.jsonl alone keeps the receipt valid
    git(dir, 'add', '-f', 'docs/AUDIT_CHAIN.jsonl');
    assert.equal(git(dir, 'commit', '-q', '-m', 'chore: record receipt').status, 0);
    const shaAuditOnly = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    assert.equal(
      verifyGateReceipt({ headSha: shaAuditOnly, branch: 'feature/receipt-integrity', repoRoot: dir }).valid,
      true
    );

    const guardValidCli = runCLI(
      ['guard', 'verify', '--sha', shaAuditOnly, '--branch', 'feature/receipt-integrity'],
      null,
      dir
    );
    assert.equal(guardValidCli.success, true);
    assert.match(formatCLIResult(guardValidCli, ['guard', 'verify']), /Verified Stage 7 gate receipt/i);

    // Committing only .agent/.sdlc-session.json also keeps the receipt valid
    startSession({ issueId: 501, branch: 'feature/receipt-integrity', repoRoot: dir, force: true });
    git(dir, 'add', '-f', '.agent/.sdlc-session.json');
    assert.equal(git(dir, 'commit', '-q', '-m', 'chore: update session').status, 0);
    const shaSessionOnly = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    assert.equal(
      verifyGateReceipt({ headSha: shaSessionOnly, branch: 'feature/receipt-integrity', repoRoot: dir }).valid,
      true
    );

    // Modifying .agent/sdlc-config.json after receipt invalidates it
    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({ version: '2.1.0', modules: [{ name: 'root', path: '.', thresholds: { diffCoverage: 0, mutationScore: 0 } }] }),
      'utf8'
    );
    git(dir, 'add', '-f', '.agent/sdlc-config.json');
    assert.equal(git(dir, 'commit', '-q', '-m', 'chore: lower thresholds').status, 0);
    const shaConfigTampered = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    assert.equal(
      verifyGateReceipt({ headSha: shaConfigTampered, branch: 'feature/receipt-integrity', repoRoot: dir }).valid,
      false
    );

    const guardInvalidCli = runCLI(
      ['guard', 'verify', '--sha', shaConfigTampered, '--branch', 'feature/receipt-integrity'],
      null,
      dir
    );
    assert.equal(guardInvalidCli.success, false);

    // Issuing a fresh receipt and modifying .agent/scripts/sdlc-engine.mjs also invalidates it
    const reIssued = issueGateReceipt({
      issueId: 501,
      branch: 'feature/receipt-integrity',
      headSha: shaConfigTampered,
      coveragePct: 93,
      mutationPct: null,
      peerReviewApproved: true,
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(reIssued.success, true);
    fs.appendFileSync(path.join(dir, '.agent/scripts/sdlc-engine.mjs'), '\n// post-receipt edit\n', 'utf8');
    git(dir, 'add', '-f', '.agent/scripts/sdlc-engine.mjs');
    assert.equal(git(dir, 'commit', '-q', '-m', 'chore: post-receipt engine edit').status, 0);
    const shaScriptTampered = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    assert.equal(
      verifyGateReceipt({ headSha: shaScriptTampered, branch: 'feature/receipt-integrity', repoRoot: dir }).valid,
      false
    );
  });

  it('auditSecurity redacts secret prefixes instead of printing raw tokens', () => {
    assert.equal(git(dir, 'checkout', '-q', '-b', 'feature/secret-redaction').status, 0);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const fakePat = ['ghp', '_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcd'].join('');
    fs.writeFileSync(path.join(dir, 'src/config.mjs'), `export const gh = "${fakePat}";\n`, 'utf8');
    git(dir, 'add', 'src/config.mjs');
    assert.equal(git(dir, 'commit', '-q', '-m', 'test: add leak').status, 0);

    const secRes = qualityGateMod.auditSecurity(dir);
    assert.equal(secRes.passed, false);
    assert.ok(secRes.secretViolations.length >= 1);
    assert.equal(secRes.secretViolations[0].redacted, '[REDACTED:GitHub Personal Access Token]');
    assert.equal(JSON.stringify(secRes).includes('ghp_ABCDE'), false);

    const cliRes = runCLI(['security-audit'], null, dir);
    assert.equal(cliRes.success, false);
    assert.equal(cliRes.security.secretViolations[0].redacted, '[REDACTED:GitHub Personal Access Token]');
    assert.equal(JSON.stringify(cliRes).includes('ghp_ABCDE'), false);
    const formatted = formatCLIResult(cliRes);
    assert.equal(formatted.includes('ghp_ABCDE'), false);
  });

  it('generateRegressionProof marks failed liveProbe responses as verified: false', () => {
    const res = qualityGateMod.generateRegressionProof({
      targetName: 'probe-fail',
      apiEndpoints: [{ method: 'GET', path: 'http://127.0.0.1:1/unreachable', liveProbe: true }],
      repoRoot: dir
    });
    assert.equal(res.success, true);
    assert.equal(res.apiProofs.length, 1);
    assert.equal(res.apiProofs[0].verified, false);
    assert.equal(res.apiProofs[0].source, 'live-probe-fallback');
  });

  it('release rejects --skip-gate and safely bumps pom.xml, pyproject.toml, and Cargo.toml project versions', () => {
    const cliSkip = runCLI(['release', '--skip-gate'], null, dir);
    assert.equal(cliSkip.success, false);
    assert.match(String(cliSkip.error || ''), /forbidden/i);

    assert.throws(
      () => executeRelease({ bump: 'patch', skipGate: true, repoRoot: dir }),
      /Bypassing strict quality gate/i
    );

    const seedMinimalRepo = (manifestName, manifestContent) => {
      const subDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-poly-rel-'));
      git(subDir, 'init', '-q', '-b', 'main');
      git(subDir, 'config', 'user.email', 'agent@sdlc.local');
      git(subDir, 'config', 'user.name', 'SDLC Agent');
      git(subDir, 'config', 'commit.gpgsign', 'false');
      fs.mkdirSync(path.join(subDir, '.agent'), { recursive: true });
      fs.writeFileSync(
        path.join(subDir, '.agent/sdlc-config.json'),
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
      fs.writeFileSync(path.join(subDir, manifestName), manifestContent, 'utf8');
      fs.writeFileSync(path.join(subDir, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n- Changes\n', 'utf8');
      git(subDir, 'add', '-A');
      assert.equal(git(subDir, 'commit', '-q', '-m', 'chore: init').status, 0);
      assert.equal(git(subDir, 'checkout', '-q', '-b', 'chore/release').status, 0);
      return subDir;
    };

    const mavenDir = seedMinimalRepo(
      'pom.xml',
      `<project>
  <parent>
    <groupId>org.example</groupId>
    <artifactId>parent</artifactId>
    <version>3.1.0</version>
  </parent>
  <artifactId>my-service</artifactId>
  <version>1.2.3</version>
  <dependencies>
    <dependency>
      <groupId>org.dep</groupId>
      <artifactId>lib</artifactId>
      <version>4.0.0</version>
    </dependency>
  </dependencies>
</project>\n`
    );
    const pyDir = seedMinimalRepo(
      'pyproject.toml',
      `[tool.pytest]
version = "9.9.9"

[project]
name = "py-svc"
version = "0.4.1"
`
    );
    const cargoDir = seedMinimalRepo(
      'Cargo.toml',
      `[dependencies]
serde = { version = "1.0.200" }

[package]
name = "rust-svc"
version = "2.0.5"
`
    );

    try {
      const mavenDry = executeRelease({ bump: 'patch', dryRun: true, repoRoot: mavenDir });
      assert.equal(mavenDry.manifestType, 'pom.xml');
      const mavenRel = executeRelease({ bump: 'patch', noTag: true, repoRoot: mavenDir });
      assert.equal(mavenRel.success, true);
      assert.ok(mavenRel.updatedFiles.includes('pom.xml'));
      assert.equal(mavenRel.newVersion, '1.2.4');
      const pomOut = fs.readFileSync(path.join(mavenDir, 'pom.xml'), 'utf8');
      assert.ok(pomOut.includes('<version>3.1.0</version>'), 'parent POM version must not change');
      assert.ok(pomOut.includes('<version>1.2.4</version>'), 'project POM version must bump to 1.2.4');
      assert.ok(pomOut.includes('<version>4.0.0</version>'), 'dependency version must not change');

      const pyDry = executeRelease({ bump: 'minor', dryRun: true, repoRoot: pyDir });
      assert.equal(pyDry.manifestType, 'pyproject.toml');
      const pyRel = executeRelease({ bump: 'minor', noTag: true, repoRoot: pyDir });
      assert.equal(pyRel.success, true);
      assert.ok(pyRel.updatedFiles.includes('pyproject.toml'));
      assert.equal(pyRel.newVersion, '0.5.0');
      const pyOut = fs.readFileSync(path.join(pyDir, 'pyproject.toml'), 'utf8');
      assert.ok(pyOut.includes('version = "9.9.9"'), '[tool.pytest] version must not change');
      assert.ok(pyOut.includes('version = "0.5.0"'), '[project] version must bump to 0.5.0');

      const cargoDry = executeRelease({ bump: 'major', dryRun: true, repoRoot: cargoDir });
      assert.equal(cargoDry.manifestType, 'Cargo.toml');
      const cargoRel = executeRelease({ bump: 'major', noTag: true, repoRoot: cargoDir });
      assert.equal(cargoRel.success, true);
      assert.ok(cargoRel.updatedFiles.includes('Cargo.toml'));
      assert.equal(cargoRel.newVersion, '3.0.0');
      const cargoOut = fs.readFileSync(path.join(cargoDir, 'Cargo.toml'), 'utf8');
      assert.ok(cargoOut.includes('version = "1.0.200"'), '[dependencies] version must not change');
      assert.ok(cargoOut.includes('version = "3.0.0"'), '[package] version must bump to 3.0.0');
    } finally {
      fs.rmSync(mavenDir, { recursive: true, force: true });
      fs.rmSync(pyDir, { recursive: true, force: true });
      fs.rmSync(cargoDir, { recursive: true, force: true });
    }
  });

  it('stage begin --checkout propagates git checkout failures instead of succeeding silently', () => {
    assert.throws(() =>
      executeCompositeStage({
        action: 'begin',
        issueId: 77,
        branch: 'feature/bad..branch',
        checkoutBranch: true,
        repoRoot: dir
      })
    );
  });

  it('pm-provider passes auth headers via curl -K - stdin and pollCIPRChecks reads gh JSON status', () => {
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({ version: '2.1.0', projectManagement: { provider: 'linear', key: 'SDLC' } }),
      'utf8'
    );

    const curlCalls = [];
    const testLinearKey = ['lin_api', '_test_secret_token_999'].join('');
    const prevKey = process.env.LINEAR_API_KEY;
    process.env.LINEAR_API_KEY = testLinearKey;
    try {
      const mockExec = (bin, args, opts) => {
        curlCalls.push({ bin, args, opts });
        if (String(args).includes('WorkflowStates') || String(opts?.input || '').includes('Authorization')) {
          const body = String(args.join(' '));
          if (body.includes('workflowStates')) {
            return JSON.stringify({ data: { workflowStates: { nodes: [{ id: 'st-1', name: 'In Progress', type: 'started' }] } } }) + '\n200\n';
          }
        }
        return JSON.stringify({ data: { issueUpdate: { success: true } } }) + '\n200\n';
      };
      const tr = pmMod.transitionPMState({
        issueId: 'SDLC-42',
        state: 'in-progress',
        repoRoot: dir,
        execFn: mockExec
      });
      assert.equal(tr.success, true);
      assert.ok(curlCalls.length >= 1);
      for (const call of curlCalls) {
        assert.equal(call.bin, 'curl');
        assert.ok(call.args.includes('-K') && call.args.includes('-'));
        assert.equal(call.args.join(' ').includes(testLinearKey), false, 'secret token must never appear in argv');
        assert.ok(String(call.opts?.input || '').includes(`Authorization: ${testLinearKey}`));
      }
    } finally {
      if (prevKey === undefined) delete process.env.LINEAR_API_KEY;
      else process.env.LINEAR_API_KEY = prevKey;
    }

    const passRes = pmMod.pollCIPRChecks(42, {
      timeoutSeconds: 5,
      pollIntervalSeconds: 0.05,
      repoRoot: dir,
      execFn: () => JSON.stringify([{ name: 'failover-dr-test', state: 'SUCCESS', bucket: 'pass' }])
    });
    assert.equal(passRes.passed, true);

    const failRes = pmMod.pollCIPRChecks(42, {
      timeoutSeconds: 5,
      pollIntervalSeconds: 0.05,
      repoRoot: dir,
      execFn: () => JSON.stringify([{ name: 'unit-tests', state: 'FAILURE', bucket: 'fail' }])
    });
    assert.equal(failRes.passed, false);
    assert.match(String(failRes.error || ''), /unit-tests/);
  });

  it('workbench-server escapes SSR HTML, serves /widget without writing disk files, and rejects bodies >64KiB with 413', async () => {
    const html = workbenchMod.renderWorkbenchHTML(dir, () => ({
      active: true,
      session: {
        issueId: '<img src=x onerror=alert(1)>',
        branch: 'feature/<script>alert(1)</script>',
        stage: 3
      }
    }));
    assert.equal(html.includes('<script>alert(1)</script>'), false);
    assert.equal(html.includes('<img src=x onerror=alert(1)>'), false);
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));

    const wb = createWorkbenchServer({ port: 0, repoRoot: dir });
    const srv = await wb.listen();
    const port = srv.address().port;
    try {
      const widgetPath = path.join(dir, '.agent/workbench/index.html');
      fs.rmSync(widgetPath, { force: true });
      const wRes = await req(port, 'GET', `/widget?token=${wb.token}`);
      assert.equal(wRes.status, 200);
      assert.ok(wRes.body.includes('<!DOCTYPE html>') || wRes.body.includes('<html'));
      assert.equal(fs.existsSync(widgetPath), false, 'GET /widget must not write .agent/workbench/index.html');

      const oversized = await req(port, 'POST', '/api/adr/decide', {
        body: { adrId: 'ADR-001', action: 'approve', reason: 'x'.repeat(70000) },
        headers: { 'X-SDLC-Token': wb.token }
      });
      assert.equal(oversized.status, 413);
    } finally {
      await wb.close();
    }
  });

  it('planProductDAG detects circular capability dependencies with hasCycle: true and success: false', () => {
    productDagMod.initProductConstitution({
      title: 'Cycle Demo',
      vision: 'Detect dependency cycles',
      capabilities: [
        { id: 'CAP-01', title: 'Alpha', spec: 'docs/specs/cap-01.md', dependsOn: ['CAP-02'] },
        { id: 'CAP-02', title: 'Beta', spec: 'docs/specs/cap-02.md', dependsOn: ['CAP-01'] }
      ],
      repoRoot: dir
    });
    const dag = productDagMod.planProductDAG({ repoRoot: dir });
    assert.equal(dag.hasCycle, true);
    assert.equal(dag.success, false);
    assert.ok(dag.cycleNodes.includes('CAP-01'));
    assert.ok(dag.cycleNodes.includes('CAP-02'));
  });

  it('guard and audit chain unit invariants kill threshold, branch, stage, merge, push, and hook mutants', () => {
    const genesis = '0'.repeat(64);
    const auditPath = path.join(dir, 'docs/AUDIT_CHAIN.jsonl');

    // 1. verifyAuditChain: missing, empty, malformed JSON, index mismatch, previousHash mismatch, currentHash mismatch
    const missingChain = auditChainMod.verifyAuditChain(dir);
    assert.equal(missingChain.valid, true);
    assert.equal(missingChain.recordsCount, 0);
    assert.equal(missingChain.chainHead, genesis);
    assert.equal(missingChain.merkleRoot, genesis);
    assert.deepEqual(missingChain.records, []);
    assert.match(missingChain.message, /No audit records/);

    fs.mkdirSync(path.dirname(auditPath), { recursive: true });
    fs.writeFileSync(auditPath, '   \n', 'utf8');
    const emptyChain = auditChainMod.verifyAuditChain(dir);
    assert.equal(emptyChain.valid, true);
    assert.equal(emptyChain.recordsCount, 0);
    assert.equal(emptyChain.chainHead, genesis);
    assert.deepEqual(emptyChain.records, []);
    assert.match(emptyChain.message, /Audit chain is empty/);

    fs.writeFileSync(auditPath, '{not-valid-json\n', 'utf8');
    const badJsonChain = auditChainMod.verifyAuditChain(dir);
    assert.equal(badJsonChain.valid, false);
    assert.equal(badJsonChain.errorIndex, 0);
    assert.equal(badJsonChain.recordsCount, 1);
    assert.match(badJsonChain.error, /Malformed JSON/);

    fs.writeFileSync(
      auditPath,
      JSON.stringify({ index: 3, timestamp: '2026-01-01T00:00:00Z', event: 'E', metadata: {}, previousHash: genesis, currentHash: genesis }) + '\n',
      'utf8'
    );
    const badIdxChain = auditChainMod.verifyAuditChain(dir);
    assert.equal(badIdxChain.valid, false);
    assert.equal(badIdxChain.errorIndex, 0);
    assert.match(badIdxChain.error, /Index mismatch/);

    const badPrevHash = 'f'.repeat(64);
    const recalculatedForBadPrev = calculateRecordHash({
      index: 0,
      timestamp: '2026-01-01T00:00:00Z',
      event: 'E',
      metadata: {},
      previousHash: badPrevHash
    });
    fs.writeFileSync(
      auditPath,
      JSON.stringify({ index: 0, timestamp: '2026-01-01T00:00:00Z', event: 'E', metadata: {}, previousHash: badPrevHash, currentHash: recalculatedForBadPrev }) + '\n',
      'utf8'
    );
    const badPrevChain = auditChainMod.verifyAuditChain(dir);
    assert.equal(badPrevChain.valid, false);
    assert.equal(badPrevChain.errorIndex, 0);
    assert.match(badPrevChain.error, /previousHash mismatch/);

    fs.writeFileSync(
      auditPath,
      JSON.stringify({ index: 0, timestamp: '2026-01-01T00:00:00Z', event: 'E', metadata: {}, previousHash: genesis, currentHash: 'e'.repeat(64) }) + '\n',
      'utf8'
    );
    const badCurChain = auditChainMod.verifyAuditChain(dir);
    assert.equal(badCurChain.valid, false);
    assert.equal(badCurChain.errorIndex, 0);
    assert.match(badCurChain.error, /SHA-256 tampering detected/);

    // Verify verifyGateReceipt refuses corrupted audit chain
    const corruptedReceipt = verifyGateReceipt({ branch: 'main', repoRoot: dir });
    assert.equal(corruptedReceipt.valid, false);
    assert.match(corruptedReceipt.reason, /Audit hash chain corrupted/);

    // Reset clean chain and verify missing signing key case
    fs.rmSync(auditPath, { force: true });
    fs.rmSync(path.join(dir, '.agent/.receipt-key'), { force: true });
    const prevReceiptEnv = process.env.SDLC_RECEIPT_KEY;
    delete process.env.SDLC_RECEIPT_KEY;
    try {
      const noKeyRes = verifyGateReceipt({ branch: 'main', repoRoot: dir });
      assert.equal(noKeyRes.valid, false);
      assert.match(noKeyRes.reason, /No receipt signing key/);
    } finally {
      if (prevReceiptEnv !== undefined) process.env.SDLC_RECEIPT_KEY = prevReceiptEnv;
    }

    // 2. issueGateReceipt threshold checks across module config, testing config, standard lane, and null thresholds
    const cfgPath = path.join(dir, '.agent/sdlc-config.json');
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ version: '2.1.0', modules: [{ name: 'root', path: '.', thresholds: { diffCoverage: 85, mutationScore: 52 } }] }),
      'utf8'
    );

    const lowCov = issueGateReceipt({
      issueId: 601,
      branch: 'main',
      coveragePct: 70,
      mutationPct: 60,
      peerReviewApproved: true,
      reviewer: '@rev',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(lowCov.success, false);
    assert.deepEqual(lowCov.missing, ['coveragePct']);
    assert.match(lowCov.reason, /coverage 70% is below configured threshold 85%/);

    const lowMut = issueGateReceipt({
      issueId: 601,
      branch: 'main',
      coveragePct: 90,
      mutationPct: 40,
      peerReviewApproved: true,
      reviewer: '@rev',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(lowMut.success, false);
    assert.deepEqual(lowMut.missing, ['mutationPct']);
    assert.match(lowMut.reason, /mutation score 40% is below configured threshold 52%/);

    const stdOk = issueGateReceipt({
      issueId: 602,
      branch: 'main',
      lane: 'standard',
      coveragePct: 90,
      peerReviewApproved: true,
      reviewer: '@rev',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(stdOk.success, true);
    assert.equal(stdOk.receipt.lane, 'standard');
    assert.equal(stdOk.receipt.mutationPct, null);

    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ version: '2.1.0', testing: { coverageThreshold: 80, mutationThreshold: 50 }, modules: [] }),
      'utf8'
    );
    const testingOk = issueGateReceipt({
      issueId: 603,
      branch: 'main',
      coveragePct: 82,
      mutationPct: 51,
      peerReviewApproved: true,
      reviewer: '@rev',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(testingOk.success, true);

    const testingFail = issueGateReceipt({
      issueId: 603,
      branch: 'main',
      coveragePct: 79,
      mutationPct: 51,
      peerReviewApproved: true,
      reviewer: '@rev',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(testingFail.success, false);
    assert.deepEqual(testingFail.missing, ['coveragePct']);

    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ version: '2.1.0', modules: [{ name: 'docs', path: '.', thresholds: { diffCoverage: null, mutationScore: null } }] }),
      'utf8'
    );
    const nullThresholdsOk = issueGateReceipt({
      issueId: 604,
      branch: 'main',
      coveragePct: 10,
      mutationPct: 10,
      peerReviewApproved: true,
      reviewer: '@rev',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(nullThresholdsOk.success, true);

    // 3. verifyGateReceipt resolving headSha solely from branch ref
    assert.equal(git(dir, 'checkout', '-q', '-b', 'feature/branch-resolve').status, 0);
    const branchRec = issueGateReceipt({
      issueId: 605,
      branch: 'feature/branch-resolve',
      coveragePct: 95,
      mutationPct: 60,
      peerReviewApproved: true,
      reviewer: '@rev',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(branchRec.success, true);
    const byBranchOnly = verifyGateReceipt({ branch: 'feature/branch-resolve', repoRoot: dir });
    assert.equal(byBranchOnly.valid, true);
    assert.equal(byBranchOnly.receipt.receiptId, branchRec.receipt.receiptId);

    // 4. git-guard verifyCommitGuard: branch mismatch, stage 1 block, stage 2 pass
    assert.equal(git(dir, 'checkout', '-q', '-b', 'feature/b').status, 0);
    startSession({ issueId: 701, branch: 'feature/a', stage: 2, repoRoot: dir, force: true });
    const mismatch = verifyCommitGuard({ repoRoot: dir });
    assert.equal(mismatch.allowed, false);
    assert.equal(mismatch.layer, 'LAYER_2_BRANCH_MISMATCH');
    assert.ok(mismatch.message.includes('feature/a') && mismatch.message.includes('feature/b'));

    startSession({ issueId: 701, branch: 'feature/b', stage: 1, repoRoot: dir, force: true });
    const stage1Block = verifyCommitGuard({ repoRoot: dir });
    assert.equal(stage1Block.allowed, false);
    assert.equal(stage1Block.layer, 'LAYER_2_STAGE_NOT_READY');
    assert.equal(stage1Block.stage, 1);

    startSession({ issueId: 701, branch: 'feature/b', stage: 2, repoRoot: dir, force: true });
    const stage2Pass = verifyCommitGuard({ repoRoot: dir });
    assert.equal(stage2Pass.allowed, true);
    assert.equal(stage2Pass.layer, 'PASSED');

    // 5. git-guard verifyMergeGuard: non-protected target, sourceSha mismatch vs develop, missing receipt
    const featureMerge = gitGuardMod.verifyMergeGuard({ targetBranch: 'feature/other', repoRoot: dir });
    assert.equal(featureMerge.allowed, true);
    assert.match(featureMerge.message, /non-protected branch/);

    assert.equal(git(dir, 'checkout', '-q', '-b', 'develop', 'main').status, 0);
    fs.writeFileSync(path.join(dir, 'develop-unreceipted.mjs'), 'export const d = 1;\n', 'utf8');
    git(dir, 'add', 'develop-unreceipted.mjs');
    assert.equal(git(dir, 'commit', '-q', '-m', 'chore: unreceipted commit on develop').status, 0);
    const developSha = git(dir, 'rev-parse', 'develop').stdout.trim();
    assert.equal(git(dir, 'checkout', '-q', '-').status, 0);
    fs.writeFileSync(path.join(dir, 'work.mjs'), 'export const w = 1;\n', 'utf8');
    git(dir, 'add', 'work.mjs');
    assert.equal(git(dir, 'commit', '-q', '-m', 'feat: work on feature/b').status, 0);
    const unmergedSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    const shaMismatch = gitGuardMod.verifyMergeGuard({
      targetBranch: 'main',
      sourceBranch: null,
      sourceSha: unmergedSha,
      repoRoot: dir
    });
    assert.equal(shaMismatch.allowed, false);
    assert.equal(shaMismatch.reasonCode, 'DIRECT_MERGE_TO_MAIN_FORBIDDEN');

    const missingReceiptMerge = gitGuardMod.verifyMergeGuard({
      targetBranch: 'main',
      sourceBranch: 'develop',
      sourceSha: developSha,
      repoRoot: dir
    });
    assert.equal(missingReceiptMerge.allowed, false);
    assert.equal(missingReceiptMerge.layer, 'LAYER_3_GATE_RECEIPT_REQUIRED');

    // 6. git-guard verifyPushGuard & core.hooksPath custom hook installation
    const blockedPush = gitGuardMod.verifyPushGuard({ remoteBranch: 'main', repoRoot: dir });
    assert.equal(blockedPush.allowed, false);
    assert.equal(blockedPush.layer, 'LAYER_3_PROTECTED_PUSH');

    const allowedPush = gitGuardMod.verifyPushGuard({ remoteBranch: 'feature/b', repoRoot: dir });
    assert.equal(allowedPush.allowed, true);
    assert.equal(allowedPush.layer, 'PASSED');

    assert.equal(git(dir, 'config', 'core.hooksPath', '.custom-hooks').status, 0);
    const hooksRes = gitGuardMod.installHooks({ repoRoot: dir });
    assert.equal(hooksRes.success, true);
    assert.ok(hooksRes.hooksDir.endsWith('.custom-hooks'));
    assert.equal(fs.existsSync(path.join(dir, '.custom-hooks/pre-commit')), true);
    assert.equal(fs.existsSync(path.join(dir, '.custom-hooks/pre-merge-commit')), true);
    assert.equal(fs.existsSync(path.join(dir, '.custom-hooks/pre-push')), true);
  });
});

// ===========================================================================
// Audit hardening & base-branch alignment regressions
// ===========================================================================
describe('Audit hardening & base-branch alignment regressions', () => {
  let dir;
  beforeEach(() => {
    dir = makeRepo();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('guard verify succeeds without --branch on detached HEAD, main, and develop, while rejecting wrong --branch', () => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    assert.equal(git(dir, 'checkout', '-b', 'feature/detached-verify').status, 0);
    fs.writeFileSync(path.join(dir, 'src/mod.mjs'), 'export const ok = true;\n', 'utf8');
    assert.equal(git(dir, 'add', 'src/mod.mjs').status, 0);
    assert.equal(git(dir, 'commit', '-q', '-m', 'feat: add mod').status, 0);
    const featureSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    const receipt = issueGateReceipt({
      issueId: '#200',
      branch: 'feature/detached-verify',
      headSha: featureSha,
      lane: 'full',
      coveragePct: 95,
      mutationPct: 85,
      peerReviewApproved: true,
      reviewer: '@reviewer',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(receipt.success, true);

    assert.equal(git(dir, 'checkout', '--detach', featureSha).status, 0);
    const detachedCli = runCLI(['guard', 'verify', '--sha', featureSha], null, dir);
    assert.equal(detachedCli.success, true);
    assert.match(formatCLIResult(detachedCli, ['guard', 'verify']), /Verified Stage 7 gate receipt/i);

    assert.equal(git(dir, 'checkout', 'main').status, 0);
    const mainCli = runCLI(['guard', 'verify', '--sha', featureSha], null, dir);
    assert.equal(mainCli.success, true);

    assert.equal(git(dir, 'checkout', '-b', 'develop').status, 0);
    const developCli = runCLI(['guard', 'verify', '--sha', featureSha], null, dir);
    assert.equal(developCli.success, true);

    const wrongBranchCli = runCLI(['guard', 'verify', '--sha', featureSha, '--branch', 'feature/wrong'], null, dir);
    assert.equal(wrongBranchCli.success, false);
  });

  it('sdlc-quality-gate.yml, release.yml, and installCIWorkflow enforce --no-cache, safe receipt guards, and REST release fallback', () => {
    const wfInstall = installCIWorkflow({ repoRoot: dir, force: true });
    assert.equal(wfInstall.success, true);

    const gateWfPaths = [
      path.join(REPO_ROOT, '.github/workflows/sdlc-quality-gate.yml'),
      path.join(dir, '.github/workflows/sdlc-quality-gate.yml')
    ];
    for (const wfPath of gateWfPaths) {
      const content = fs.readFileSync(wfPath, 'utf8');
      assert.match(content, /sdlc-engine\.mjs gate --strict --no-cache/);
      const receiptStep = content.match(/- name: Verify Signed Stage 7 Gate Receipt[\s\S]*/)?.[0] || '';
      assert.ok(receiptStep.length > 0, `Expected Verify Signed Stage 7 Gate Receipt step in ${wfPath}`);
      assert.match(receiptStep, /if:\s*github\.event_name\s*==\s*'pull_request'/);
      assert.equal(receiptStep.includes("github.base_ref == 'main'"), false);
      assert.match(receiptStep, /PR_HEAD_SHA:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/);
      assert.match(receiptStep, /PR_HEAD_REPO:\s*\$\{\{\s*github\.event\.pull_request\.head\.repo\.full_name\s*\}\}/);
      assert.match(receiptStep, /BASE_REPO:\s*\$\{\{\s*github\.repository\s*\}\}/);
      assert.match(receiptStep, /\[\s*"\$PR_HEAD_REPO"\s*!=\s*"\$BASE_REPO"\s*\]/);
      assert.match(receiptStep, /\[\s*-z\s*"\$SDLC_RECEIPT_KEY"\s*\]/);
      assert.match(receiptStep, /::error::Missing SDLC_RECEIPT_KEY secret/);
      assert.match(receiptStep, /exit 1/);
      assert.equal(receiptStep.includes('.agent/.receipt-key'), false);
      assert.match(receiptStep, /guard verify --sha "\$PR_HEAD_SHA"/);
      assert.equal(receiptStep.includes('guard verify --sha "${{'), false);
    }

    const releaseWfPaths = [
      path.join(REPO_ROOT, '.github/workflows/release.yml'),
      path.join(dir, '.github/workflows/release.yml')
    ];
    for (const relPath of releaseWfPaths) {
      const content = fs.readFileSync(relPath, 'utf8');
      assert.match(content, /sdlc-engine\.mjs gate --strict --no-cache/);
      assert.match(content, /\/releases\/tags\//);
      assert.match(content, /res\.statusCode\s*===\s*422\s*&&\s*data\.includes\('already_exists'\)/);
    }
  });

  it('product-dag and pm-provider read modules[].thresholds.mutationScore from sdlc-config.json and list 9 Verb Skills', () => {
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify(
        {
          version: '1.0.0',
          modules: [{ name: 'root', path: '.', thresholds: { diffCoverage: 88, mutationScore: 52 } }]
        },
        null,
        2
      ),
      'utf8'
    );

    const initRes = productDagMod.initProductConstitution({
      title: 'Config Bars System',
      capabilities: [
        {
          id: 'CAP-01',
          title: 'Core Capability',
          problem: 'Problem',
          inputs: 'Input',
          processing: 'Process',
          outputs: 'Output'
        }
      ],
      autoProvisionGenesis: false,
      repoRoot: dir
    });
    assert.equal(initRes.success, true);

    const srsContent = fs.readFileSync(path.join(dir, 'docs/SRS.md'), 'utf8');
    assert.match(srsContent, /88%/);
    assert.match(srsContent, /52%/);
    assert.equal(srsContent.includes('80%'), false);
    assert.match(srsContent, /9 Verb Skills \(10 Canonical Skills\)/);
    assert.match(srsContent, /\/sdlc-wiki/);
    assert.equal(srsContent.includes('8 Verb Skills'), false);

    const specMd = productDagMod.renderCapabilitySpecMarkdown({
      capId: 'CAP-01',
      title: 'Core Capability',
      repoRoot: dir
    });
    assert.match(specMd, />=\s*88%/);
    assert.match(specMd, />=\s*52%/);
    assert.equal(specMd.includes('80%'), false);

    const untemplatedIssue = pmMod.formatTemplatedIssue({
      title: 'Add config bar support',
      type: 'feat',
      repoRoot: dir
    });
    assert.match(untemplatedIssue.body, />= 88% diff test coverage, >= 52% mutation/);

    fs.mkdirSync(path.join(dir, '.github/ISSUE_TEMPLATE'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.github/ISSUE_TEMPLATE/feature_request.md'),
      [
        '---',
        'name: Feature Request',
        'labels: enhancement',
        '---',
        'A clear and concise description of what the problem is.',
        'A clear and concise description of what you want to happen.',
        '- [ ] Diff line coverage `>= 85%` and configured mutation score (`.agent/sdlc-config.json`)'
      ].join('\n'),
      'utf8'
    );
    const templatedIssue = pmMod.formatTemplatedIssue({
      title: 'Add config bar support',
      type: 'feat',
      repoRoot: dir
    });
    assert.match(templatedIssue.body, /`>= 88%` and `>= 52%` mutation score/);
  });

  it('generateRegressionProof distinguishes verified UI/API proofs from unverified fallback or sample entries', () => {
    fs.mkdirSync(path.join(dir, 'src/components'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/components/PresentView.svelte'), '<main>Present</main>\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'src/api-sample.json'), JSON.stringify({ ok: true }), 'utf8');

    const res = qualityGateMod.generateRegressionProof({
      targetName: 'proof-check',
      apiEndpoints: [
        { method: 'GET', path: '/api/no-sample' },
        { method: 'GET', path: '/api/with-sample', sampleResponse: { ok: true } },
        { method: 'GET', path: '/api/with-file', file: 'src/api-sample.json' }
      ],
      uiRoutes: [
        { path: '/missing', component: 'MissingView' },
        { path: '/present', component: 'PresentView', file: 'src/components/PresentView.svelte' }
      ],
      repoRoot: dir
    });

    assert.equal(res.success, true);
    assert.equal(res.apiProofs[0].verified, false);
    assert.equal(res.apiProofs[1].verified, false);
    assert.equal(res.apiProofs[1].source, 'sample');
    assert.equal(res.apiProofs[2].verified, true);
    assert.equal(res.uiProofs[0].verified, false);
    assert.equal(res.uiProofs[0].sourceFile, null);
    assert.equal(res.uiProofs[1].verified, true);
    assert.equal(res.uiProofs[1].sourceFile, 'src/components/PresentView.svelte');

    const proofMd = fs.readFileSync(res.proofFilePath, 'utf8');
    assert.match(proofMd, /`\/api\/no-sample`.*⚠️ UNVERIFIED \(fallback\)/);
    assert.match(proofMd, /`\/api\/with-sample`.*⚠️ SAMPLE \(not probed\)/);
    assert.match(proofMd, /`\/api\/with-file`.*✅ VERIFIED/);
    assert.match(proofMd, /`\/missing`.*⚠️ UNVERIFIED \(fallback\)/);
    assert.match(proofMd, /`\/present`.*✅ VERIFIED/);

    const emptyRes = qualityGateMod.generateRegressionProof({ targetName: 'empty-proof', repoRoot: dir });
    assert.match(emptyRes.markdown, /⚠️ SAMPLE \(not probed\)/);
  });

  it('generateReviewPlan targets develop instead of hardcoding main when develop branch exists', () => {
    assert.equal(git(dir, 'checkout', '-b', 'develop').status, 0);
    fs.mkdirSync(path.join(dir, 'src/auth'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/base.mjs'), 'export const base = 1;\n', 'utf8');
    assert.equal(git(dir, 'add', 'src/base.mjs').status, 0);
    assert.equal(git(dir, 'commit', '-q', '-m', 'chore: base develop commit').status, 0);

    assert.equal(git(dir, 'checkout', '-b', 'feature/review-develop').status, 0);
    fs.writeFileSync(path.join(dir, 'src/auth/jwt-verifier.mjs'), 'export function verifyJwtSignature() { return true; }\n', 'utf8');
    assert.equal(git(dir, 'add', 'src/auth/jwt-verifier.mjs').status, 0);
    assert.equal(git(dir, 'commit', '-q', '-m', 'feat: add jwt verifier').status, 0);

    writeSession(dir, { issueId: '#201', branch: 'feature/review-develop', lane: 'full' });

    const plan = generateReviewPlan({ repoRoot: dir, lane: 'full' });
    assert.equal(plan.subagentsCount, 3);
    for (const sub of plan.payload.Subagents) {
      assert.match(sub.Prompt, /develop/);
      assert.equal(sub.Prompt.includes('against main'), false);
    }
  });

  it('workbench-server removes inline onclick handlers on dynamic node IDs and delegates via data-node-id', () => {
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.agent/decision-graph.jsonl'),
      JSON.stringify({ type: 'CAPABILITY_REGISTERED', id: 'CAP-"\'\\01', label: 'Node with quotes', category: 'CAPABILITY', status: 'ACTIVE' }) + '\n',
      'utf8'
    );

    const workbenchHtml = workbenchMod.renderWorkbenchHTML(dir);
    const widgetRes = workbenchMod.generateArchitectureWidget({ repoRoot: dir, writeDefault: false });

    for (const rendered of [workbenchHtml, widgetRes.html]) {
      assert.match(rendered, /data-node-id="/);
      assert.match(rendered, /\.closest\('\[data-node-id\]'\)/);
      assert.equal(rendered.includes('onclick="inspectNode('), false);
      assert.equal(rendered.includes('onclick="selectLineageNode('), false);
    }
  });

  it('verifyGateReceipt rejects subsequent .agent/workbench/ commits and .gitignore excludes .agent/.audit-chain.lock', () => {
    const gitignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
    assert.match(gitignore, /^\.agent\/\.audit-chain\.lock$/m);

    assert.equal(git(dir, 'checkout', '-b', 'feature/workbench-tamper').status, 0);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/ok.mjs'), 'export const ok = true;\n', 'utf8');
    assert.equal(git(dir, 'add', 'src/ok.mjs').status, 0);
    assert.equal(git(dir, 'commit', '-q', '-m', 'feat: initial commit').status, 0);
    const receiptSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    const receipt = issueGateReceipt({
      issueId: '#202',
      branch: 'feature/workbench-tamper',
      headSha: receiptSha,
      lane: 'full',
      coveragePct: 95,
      mutationPct: 85,
      peerReviewApproved: true,
      reviewer: '@reviewer',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(receipt.success, true);

    fs.mkdirSync(path.join(dir, '.agent/workbench'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.agent/workbench/injected.js'), 'console.log("pwn");\n', 'utf8');
    assert.equal(git(dir, 'add', '-f', '.agent/workbench/injected.js').status, 0);
    assert.equal(git(dir, 'commit', '-q', '-m', 'chore: modify workbench file after receipt').status, 0);
    const postReceiptSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    const verified = verifyGateReceipt({ headSha: postReceiptSha, branch: 'feature/workbench-tamper', repoRoot: dir });
    assert.equal(verified.valid, false);

    assert.equal(git(dir, 'add', '-f', '.agent/.receipt-key').status, 0);
    assert.equal(auditChainMod.loadReceiptKey(dir), null);
    const verifiedWithCommittedKey = verifyGateReceipt({
      headSha: receiptSha,
      branch: 'feature/workbench-tamper',
      repoRoot: dir
    });
    assert.equal(verifiedWithCommittedKey.valid, false);
  });

  it('hasDevelopBranch reflects packed and deleted develop refs immediately without timestamp caching', () => {
    assert.equal(coreMod.hasDevelopBranch(dir), false);
    assert.equal(git(dir, 'checkout', '-b', 'develop').status, 0);
    assert.equal(coreMod.hasDevelopBranch(dir), true);

    assert.equal(git(dir, 'pack-refs', '--all').status, 0);
    assert.equal(coreMod.hasDevelopBranch(dir), true);

    assert.equal(git(dir, 'checkout', 'main').status, 0);
    assert.equal(git(dir, 'branch', '-D', 'develop').status, 0);
    assert.equal(coreMod.hasDevelopBranch(dir), false);
  });
});

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
