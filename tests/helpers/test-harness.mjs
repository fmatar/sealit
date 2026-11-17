import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function cleanTestGitEnv(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_COMMON_DIR;
  delete env.GIT_OBJECT_DIRECTORY;
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  delete env.GITHUB_BASE_REF;
  delete env.SDLC_RECEIPT_KEY;
  return env;
}

export function git(cwd, ...args) {
  return spawnSync('git', args, {
    cwd,
    env: cleanTestGitEnv(),
    encoding: 'utf8'
  });
}

function getOrBuildTemplateRepo(initialBranch, withDevelop) {
  const safeBranch = String(initialBranch || 'main').replace(/[^a-zA-Z0-9_-]/g, '_');
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  const tpl = path.join(os.tmpdir(), `sdlc-repo-tpl-v2-${uid}-${safeBranch}-${withDevelop ? 'dev' : 'nodev'}`);
  if (fs.existsSync(path.join(tpl, '.git', 'HEAD')) && fs.existsSync(path.join(tpl, 'README.md'))) {
    return tpl;
  }
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-tpl-build-'));
  git(staging, 'init', '-q', '-b', initialBranch);
  git(staging, 'config', 'user.name', 'Test Bot');
  git(staging, 'config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(staging, '.gitignore'), 'node_modules/\n.env\n.agent/.sdlc-session.json\n.agent/.sdlc-session.lock\n.agent/.receipt-key\n.agent/.audit-chain.lock\n.agent/.cache/\ncoverage/\nreports/\n', 'utf8');
  fs.writeFileSync(path.join(staging, 'README.md'), '# Test Repo\n', 'utf8');
  git(staging, 'add', '.gitignore', 'README.md');
  git(staging, 'commit', '-q', '-m', 'chore: initial commit');
  if (withDevelop && initialBranch !== 'develop') {
    git(staging, 'checkout', '-q', '-b', 'develop');
  }
  try {
    fs.renameSync(staging, tpl);
    return tpl;
  } catch {
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch {}
    if (fs.existsSync(path.join(tpl, '.git', 'HEAD'))) return tpl;
    throw new Error(`Failed to materialize template git repo at ${tpl}`);
  }
}

export function createTempGitRepo({ prefix = 'sdlc-v010-', withDevelop = true, initialBranch = 'main' } = {}) {
  const tpl = getOrBuildTemplateRepo(initialBranch, withDevelop);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.cpSync(tpl, dir, { recursive: true });
  const cleanup = () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  };
  return { dir, cleanup };
}

export function withoutReceiptEnv(fn) {
  const hadKey = Object.prototype.hasOwnProperty.call(process.env, 'SDLC_RECEIPT_KEY');
  const prev = process.env.SDLC_RECEIPT_KEY;
  delete process.env.SDLC_RECEIPT_KEY;
  let result;
  try {
    result = fn();
  } catch (err) {
    if (hadKey) process.env.SDLC_RECEIPT_KEY = prev;
    else delete process.env.SDLC_RECEIPT_KEY;
    throw err;
  }
  if (result && typeof result.then === 'function') {
    return result.finally(() => {
      if (hadKey) process.env.SDLC_RECEIPT_KEY = prev;
      else delete process.env.SDLC_RECEIPT_KEY;
    });
  }
  if (hadKey) process.env.SDLC_RECEIPT_KEY = prev;
  else delete process.env.SDLC_RECEIPT_KEY;
  return result;
}
