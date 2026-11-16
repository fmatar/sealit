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

export function createTempGitRepo({ prefix = 'sdlc-v010-', withDevelop = true, initialBranch = 'main' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(dir, 'init', '-q', '-b', initialBranch);
  git(dir, 'config', 'user.name', 'Test Bot');
  git(dir, 'config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n.env\n.agent/.sdlc-session.json\n.agent/.sdlc-session.lock\n.agent/.receipt-key\n.agent/.audit-chain.lock\n.agent/.cache/\ncoverage/\nreports/\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'README.md'), '# Test Repo\n', 'utf8');
  git(dir, 'add', '.gitignore', 'README.md');
  git(dir, 'commit', '-q', '-m', 'chore: initial commit');
  if (withDevelop && initialBranch !== 'develop') {
    git(dir, 'checkout', '-q', '-b', 'develop');
  }
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
