import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { PassThrough } from 'node:stream';
import { spawnSync, execFileSync } from 'node:child_process';

import * as engineMod from '../../.agent/scripts/sdlc-engine.mjs';
import * as coreMod from '../../.agent/scripts/lib/core.mjs';
import * as gitGuardMod from '../../.agent/scripts/lib/git-guard.mjs';
import * as qualityGateMod from '../../.agent/scripts/lib/quality-gate.mjs';
import * as installerMod from '../../.agent/scripts/lib/installer.mjs';
import * as pmMod from '../../.agent/scripts/lib/pm-provider.mjs';
import * as auditChainMod from '../../.agent/scripts/lib/audit-chain.mjs';
import * as workbenchMod from '../../.agent/scripts/lib/workbench-server.mjs';
import * as productDagMod from '../../.agent/scripts/lib/product-dag.mjs';

export {
  coreMod,
  gitGuardMod,
  qualityGateMod,
  installerMod,
  pmMod,
  auditChainMod,
  workbenchMod,
  productDagMod
};

export const {
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
} = engineMod;

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
export const SCRIPTS_SRC = path.join(REPO_ROOT, '.agent/scripts');

export function childEnv() {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', SDLC_RECEIPT_KEY: '' };
  delete env.NODE_TEST_CONTEXT;
  delete env.SDLC_RECEIPT_KEY;
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_COMMON_DIR;
  delete env.GIT_OBJECT_DIRECTORY;
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  env.GH_TOKEN = 'invalid-hermetic-test-token';
  env.GH_HOST = 'invalid.localhost';
  return env;
}

export function git(cwd, ...args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', env: childEnv() });
}

export function engine(cwd, ...args) {
  return spawnSync(process.execPath, [path.join(cwd, '.agent/scripts/sdlc-engine.mjs'), ...args], {
    cwd,
    encoding: 'utf8',
    env: childEnv(),
    timeout: 120000
  });
}

let cachedSeedRepo = null;
process.on('exit', () => {
  if (cachedSeedRepo) {
    try {
      fs.rmSync(cachedSeedRepo, { recursive: true, force: true });
    } catch {}
  }
});

function getSeedRepo() {
  if (cachedSeedRepo && fs.existsSync(cachedSeedRepo)) return cachedSeedRepo;
  const seed = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-hardening-seed-'));
  git(seed, 'init', '-q', '-b', 'main');
  git(seed, 'config', 'user.email', 'agent@sdlc.local');
  git(seed, 'config', 'user.name', 'SDLC Agent');
  git(seed, 'config', 'commit.gpgsign', 'false');
  fs.cpSync(SCRIPTS_SRC, path.join(seed, '.agent/scripts'), { recursive: true });
  fs.writeFileSync(path.join(seed, '.gitignore'), '.agent/\ndocs/\n', 'utf8');
  fs.writeFileSync(path.join(seed, 'README.md'), '# temp\n', 'utf8');
  fs.writeFileSync(
    path.join(seed, 'package.json'),
    JSON.stringify({ name: 'tmp', version: '0.0.0', type: 'module', scripts: { test: 'node -e 0' } }),
    'utf8'
  );
  git(seed, 'add', '.');
  const c = git(seed, 'commit', '-q', '-m', 'chore: init');
  assert.equal(c.status, 0, c.stderr);
  cachedSeedRepo = seed;
  return seed;
}

export function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-hardening-'));
  fs.cpSync(getSeedRepo(), dir, { recursive: true });
  return dir;
}

export function writeSession(dir, session) {
  const file = path.join(dir, '.agent/.sdlc-session.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ activeSessionId: session.issueId, sessions: { [session.issueId]: { active: true, ...session } } }),
    'utf8'
  );
}

export function req(port, method, p, { body = null, headers = {} } = {}) {
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

export function dispatchReq(wb, method, p, { body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const reqStream = new PassThrough();
    reqStream.method = method;
    reqStream.url = p;
    reqStream.socket = { remoteAddress: '127.0.0.1' };
    const payload = body ? JSON.stringify(body) : null;
    reqStream.headers = {
      host: `127.0.0.1:${wb.port}`,
      ...(payload ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) } : {}),
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
        resolve({ status: statusCode, headers: resHeaders, body: Buffer.concat(chunks).toString('utf8') });
      }
    };
    Promise.resolve(wb.handleRequest(reqStream, res)).catch(reject);
    if (payload) reqStream.end(payload);
    else reqStream.end();
  });
}
