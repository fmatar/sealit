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
  updateSession
} from '../.agent/scripts/sdlc-engine.mjs';

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
    assert.equal(fs.existsSync(path.join(dir, 'docs/AUDIT_CHAIN.jsonl')), false);
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
