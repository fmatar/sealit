import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

delete process.env.GITHUB_BASE_REF;
delete process.env.GITHUB_REF;
delete process.env.GITHUB_REF_NAME;
delete process.env.GITHUB_HEAD_REF;

export function cleanTestGitEnv(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_COMMON_DIR;
  delete env.GIT_OBJECT_DIRECTORY;
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  delete env.GITHUB_BASE_REF;
  delete env.GITHUB_REF;
  delete env.GITHUB_REF_NAME;
  delete env.GITHUB_HEAD_REF;
  delete env.SEALIT_RECEIPT_KEY;
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

const templateRepoCache = new Map();
process.once('exit', () => {
  for (const tpl of templateRepoCache.values()) {
    try { fs.rmSync(tpl, { recursive: true, force: true }); } catch {}
  }
});

function getOrBuildTemplateRepo(initialBranch, withDevelop) {
  const key = `${initialBranch || 'main'}::${withDevelop ? 'dev' : 'nodev'}`;
  const cached = templateRepoCache.get(key);
  if (cached && fs.existsSync(path.join(cached, '.git', 'HEAD'))) return cached;
  const tpl = fs.mkdtempSync(path.join(os.tmpdir(), 'sealit-repo-tpl-'));
  git(tpl, 'init', '-q', '-b', initialBranch);
  git(tpl, 'config', 'user.name', 'Test Bot');
  git(tpl, 'config', 'user.email', 'test@example.com');
  fs.writeFileSync(
    path.join(tpl, '.gitignore'),
    'node_modules/\n.env\n.agent/.sealit-session.json\n.agent/.sealit-session.lock\n.agent/.sealit-config.lock\n.agent/.sdlc-session.json\n.agent/.sdlc-session.lock\n.agent/.receipt-key\n.agent/.audit-chain.lock\n.agent/.cache/\ncoverage/\nreports/\n',
    'utf8'
  );
  fs.writeFileSync(path.join(tpl, 'README.md'), '# Test Repo\n', 'utf8');
  git(tpl, 'add', '.gitignore', 'README.md');
  git(tpl, 'commit', '-q', '-m', 'chore: initial commit');
  if (withDevelop && initialBranch !== 'develop') {
    git(tpl, 'checkout', '-q', '-b', 'develop');
  }
  templateRepoCache.set(key, tpl);
  return tpl;
}

export function createTempGitRepo({ prefix = 'sealit-v001-', withDevelop = true, initialBranch = 'main' } = {}) {
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
  const saved = ['SEALIT_RECEIPT_KEY', 'SDLC_RECEIPT_KEY'].map((k) => [
    k,
    Object.prototype.hasOwnProperty.call(process.env, k),
    process.env[k]
  ]);
  for (const [k] of saved) delete process.env[k];
  const restore = () => {
    for (const [k, had, val] of saved) {
      if (had) process.env[k] = val;
      else delete process.env[k];
    }
  };
  let result;
  try {
    result = fn();
  } catch (err) {
    restore();
    throw err;
  }
  if (result && typeof result.then === 'function') {
    return result.finally(restore);
  }
  restore();
  return result;
}
