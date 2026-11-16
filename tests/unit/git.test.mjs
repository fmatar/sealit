import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTempGitRepo, git } from '../helpers/test-harness.mjs';
import {
  cleanGitEnv,
  gitOutput,
  gitExec,
  parseCommandArgv,
  runConfiguredCommand,
  resolveInsideRepo,
  writeFileAtomic,
  withFileLock,
  parseEnvFile,
  getRepoEnv,
  resolveGitCommonRepoRoot,
  resolveGitHooksDir,
  getCurrentGitBranch,
  hasBranch,
  hasDevelopBranch,
  resolveDefaultBaseBranch,
  resolveEffectiveDiffBase,
  resolveDiffComparisonState,
  getModifiedFiles,
  getUnifiedDiffByFile,
  computeContentTreeSha,
  isDocsOnlyFile,
  isDocsOnlyDiff,
  hasDirtyNonGovernanceFiles,
  normalizeTicketId,
  sameShaPrefix
} from '../../.agent/scripts/lib/git.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()();
  }
});

describe('Ring 0: lib/git.mjs', () => {
  it('parseCommandArgv strips matched quotes for globs and = flags and blocks shell metacharacters', () => {
    const parsed = parseCommandArgv('node --test --test-reporter=dot "tests/**/*.test.mjs" \'--name=a=b\'');
    assert.deepEqual(parsed, {
      file: 'node',
      args: ['--test', '--test-reporter=dot', 'tests/**/*.test.mjs', '--name=a=b']
    });

    const fromArr = parseCommandArgv(['node', '--check', 'src/index.mjs']);
    assert.deepEqual(fromArr, { file: 'node', args: ['--check', 'src/index.mjs'] });

    for (const bad of [
      'npm test && echo pwn',
      'npm test; ls',
      'npm test | cat',
      'echo `whoami`',
      'echo "$(id)"',
      'node a.js > /tmp/x',
      'node "unterminated',
      ''
    ]) {
      assert.throws(() => parseCommandArgv(bad));
    }

    const out = runConfiguredCommand([process.execPath, '-e', 'process.stdout.write(process.argv[1])', 'tests/**/*.test.mjs'], {
      encoding: 'utf8'
    });
    assert.equal(out, 'tests/**/*.test.mjs');
  });

  it('resolveInsideRepo permits repo-internal paths and blocks traversal or empty paths', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    assert.equal(resolveInsideRepo(dir, '.'), path.resolve(dir));
    assert.equal(resolveInsideRepo(dir, 'src/a.mjs'), path.resolve(dir, 'src/a.mjs'));
    assert.throws(() => resolveInsideRepo(dir, '../../etc/passwd'), /outside repository root/i);
    assert.throws(() => resolveInsideRepo(dir, ''), /empty path/i);
  });

  it('parseEnvFile and getRepoEnv handle CRLF and inline comments without mutating process.env', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    fs.writeFileSync(
      path.join(dir, '.env'),
      '# comment\r\nLINEAR_API_KEY=lin_secret_123 # trailing comment\r\nQUOTED_HASH="val#keep"\r\nSINGLE_QUOTED=\'hello=world\'\r\n',
      'utf8'
    );
    const beforeKeys = Object.keys(process.env).sort();
    const parsed = parseEnvFile(dir);
    assert.deepEqual(Object.keys(process.env).sort(), beforeKeys);
    assert.equal(parsed.LINEAR_API_KEY, 'lin_secret_123');
    assert.equal(parsed.QUOTED_HASH, 'val#keep');
    assert.equal(parsed.SINGLE_QUOTED, 'hello=world');
    assert.equal(getRepoEnv('LINEAR_API_KEY', dir), 'lin_secret_123');

    process.env.LINEAR_API_KEY = 'override_from_env';
    try {
      assert.equal(getRepoEnv('LINEAR_API_KEY', dir), 'override_from_env');
    } finally {
      delete process.env.LINEAR_API_KEY;
    }
  });

  it('writeFileAtomic writes atomically and withFileLock recovers from dead-PID stale locks', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    const target = path.join(dir, 'nested/state.json');
    writeFileAtomic(target, '{"ok":true}\n', 0o600);
    assert.equal(fs.readFileSync(target, 'utf8'), '{"ok":true}\n');

    const lockPath = path.join(dir, '.agent/.test.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 99999999, createdAt: Date.now() - 120000 }), 'utf8');

    const value = withFileLock(lockPath, () => {
      assert.equal(fs.existsSync(lockPath), true);
      return 42;
    });
    assert.equal(value, 42);
    assert.equal(fs.existsSync(lockPath), false);
  });

  it('cleanGitEnv strips GIT_* overrides and linked worktrees share common repo root and hooks dir', () => {
    const stripped = cleanGitEnv({ GIT_DIR: '/bad', GIT_INDEX_FILE: '/bad/idx', PATH: process.env.PATH });
    assert.equal(stripped.GIT_DIR, undefined);
    assert.equal(stripped.GIT_INDEX_FILE, undefined);

    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);
    const wtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-wt-'));
    fs.rmSync(wtDir, { recursive: true, force: true });
    cleanups.push(() => {
      git(dir, 'worktree', 'remove', '--force', wtDir);
      fs.rmSync(wtDir, { recursive: true, force: true });
    });

    assert.equal(git(dir, 'worktree', 'add', '-q', '-b', 'feat/wt', wtDir, 'develop').status, 0);
    assert.equal(fs.realpathSync(resolveGitCommonRepoRoot(wtDir)), fs.realpathSync(dir));
    assert.equal(fs.realpathSync(resolveGitHooksDir(wtDir)), fs.realpathSync(path.join(dir, '.git/hooks')));
    assert.equal(getCurrentGitBranch(wtDir), 'feat/wt');
  });

  it('resolveEffectiveDiffBase handles feature->develop, develop->main, main pushes, and 1-commit newborn repos', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    git(dir, 'checkout', '-q', '-b', 'feat/a', 'develop');
    assert.equal(hasDevelopBranch(dir), true);
    assert.equal(hasBranch('main', dir), true);
    assert.equal(resolveDefaultBaseBranch(dir), 'develop');
    assert.equal(resolveEffectiveDiffBase(null, dir), 'develop');

    // Checked-out develop compares against main
    git(dir, 'checkout', '-q', 'develop');
    assert.equal(resolveEffectiveDiffBase(null, dir), 'main');

    // GITHUB_BASE_REF=main overrides default develop
    const prevBaseRef = process.env.GITHUB_BASE_REF;
    process.env.GITHUB_BASE_REF = 'main';
    try {
      assert.equal(resolveEffectiveDiffBase(null, dir), 'main');
    } finally {
      if (prevBaseRef === undefined) delete process.env.GITHUB_BASE_REF;
      else process.env.GITHUB_BASE_REF = prevBaseRef;
    }

    // Push directly on main falls back to HEAD~1..HEAD when >1 commit exists
    git(dir, 'checkout', '-q', 'main');
    fs.writeFileSync(path.join(dir, 'second.txt'), '2\n', 'utf8');
    git(dir, 'add', 'second.txt');
    git(dir, 'commit', '-q', '-m', 'chore: second on main');
    assert.equal(resolveEffectiveDiffBase(null, dir), 'main');
    const mainPushState = resolveDiffComparisonState(null, dir);
    assert.equal(mainPushState.committedRange, 'HEAD~1..HEAD');
    assert.deepEqual(getModifiedFiles(null, dir), ['second.txt']);

    // Single-commit newborn repo without develop or main returns committed files via empty-tree diff
    const newborn = createTempGitRepo({ withDevelop: false, initialBranch: 'feat/init' });
    cleanups.push(newborn.cleanup);
    fs.writeFileSync(path.join(newborn.dir, 'committed-on-root.mjs'), 'export const rootVal = 99;\n', 'utf8');
    git(newborn.dir, 'add', 'committed-on-root.mjs');
    git(newborn.dir, 'commit', '--amend', '-q', '--no-edit');
    assert.equal(getModifiedFiles(null, newborn.dir).includes('committed-on-root.mjs'), true);
    assert.match(getUnifiedDiffByFile(null, newborn.dir).get('committed-on-root.mjs') || '', /\+export const rootVal = 99;/);

    // Symlink inside repo escaping repoRoot is blocked by resolveInsideRepo
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-sym-escape-'));
    cleanups.push(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
    fs.symlinkSync(outsideDir, path.join(dir, 'sym-out'));
    assert.throws(() => resolveInsideRepo(dir, 'sym-out/secret.txt'), /symlink|outside/i);
  });

  it('gitOutput 64 MiB maxBuffer survives >2 MiB lockfile diffs and handles C-quoted and NUL-padded files', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    git(dir, 'checkout', '-q', '-b', 'feat/large-diff', 'develop');
    const hugeLock = Array.from({ length: 12000 }, (_, i) => `"pkg-${i}": { "version": "1.0.${i}", "integrity": "sha512-${'a'.repeat(60)}" }`).join(',\n');
    fs.writeFileSync(path.join(dir, 'package-lock.json'), `{\n${hugeLock}\n}\n`, 'utf8');
    const fakeAwsId = ['AKIA', '1234567890ABCDEF'].join('');
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/secret.mjs'), `export const key = "${fakeAwsId}";\n`, 'utf8');
    const quotedRel = 'src/quote"file.mjs';
    fs.writeFileSync(path.join(dir, quotedRel), 'export const q = 2;\n', 'utf8');
    git(dir, 'add', 'package-lock.json', 'src/secret.mjs', quotedRel);
    git(dir, 'commit', '-q', '-m', 'feat: large lockfile plus source');

    // Stage a NUL-padded source file as well
    fs.writeFileSync(path.join(dir, 'src/nul.mjs'), Buffer.from('\x00export const n = 3;\x00\n', 'latin1'));
    git(dir, 'add', 'src/nul.mjs');

    const modFiles = getModifiedFiles(null, dir);
    assert.equal(modFiles.includes('src/secret.mjs'), true);
    assert.equal(modFiles.includes(quotedRel), true);
    assert.equal(modFiles.includes('src/nul.mjs'), true);

    const diffs = getUnifiedDiffByFile(null, dir, modFiles);
    assert.equal((diffs.get('src/secret.mjs') || '').includes(`+export const key = "${fakeAwsId}";`), true);
    assert.match(diffs.get(quotedRel) || '', /\+export const q = 2;/);
    assert.match(diffs.get('src/nul.mjs') || '', /\+export const n = 3;/);
  });

  it('computeContentTreeSha is invariant across docs/AUDIT_CHAIN.jsonl commits and changes on code edits', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    git(dir, 'checkout', '-q', '-b', 'feat/tree-sha', 'develop');
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/index.mjs'), 'export const v = 1;\n', 'utf8');
    git(dir, 'add', 'src/index.mjs');
    git(dir, 'commit', '-q', '-m', 'feat: code commit');
    const sha1 = gitOutput(['rev-parse', 'HEAD'], dir).trim();
    const tree1 = computeContentTreeSha(sha1, dir);
    assert.match(tree1, /^[0-9a-f]{64}$/);

    fs.writeFileSync(path.join(dir, 'docs/AUDIT_CHAIN.jsonl'), '{"index":0}\n', 'utf8');
    git(dir, 'add', 'docs/AUDIT_CHAIN.jsonl');
    git(dir, 'commit', '-q', '-m', 'chore: append audit receipt');
    const sha2 = gitOutput(['rev-parse', 'HEAD'], dir).trim();
    assert.equal(computeContentTreeSha(sha2, dir), tree1);

    fs.writeFileSync(path.join(dir, 'src/index.mjs'), 'export const v = 2;\n', 'utf8');
    git(dir, 'add', 'src/index.mjs');
    git(dir, 'commit', '-q', '-m', 'feat: mutate code');
    const sha3 = gitOutput(['rev-parse', 'HEAD'], dir).trim();
    assert.notEqual(computeContentTreeSha(sha3, dir), tree1);
  });

  it('isDocsOnlyDiff strictly distinguishes prose docs from specs, manifests, contracts, and source files', () => {
    assert.equal(isDocsOnlyDiff([]), false);
    assert.equal(isDocsOnlyDiff(['README.md', 'CHANGELOG.md', 'docs/guide.md', 'docs/logo-dark.svg']), true);
    for (const nonDoc of [
      'requirements.txt',
      'CMakeLists.txt',
      'docs/openapi.yaml',
      'PRODUCT.md',
      'docs/PRD.md',
      'docs/SRS.md',
      'docs/specs/cap-01.md',
      'docs/adr/ADR-001.md',
      'docs/AUDIT_CHAIN.jsonl',
      'src/index.mjs'
    ]) {
      assert.equal(isDocsOnlyFile(nonDoc), false, `Expected ${nonDoc} not to be docs-only`);
      assert.equal(isDocsOnlyDiff(['README.md', nonDoc]), false);
    }

    assert.equal(normalizeTicketId('#42'), '42');
    assert.equal(normalizeTicketId('N/A'), null);
    assert.equal(sameShaPrefix('abcdef1234567890', 'abcdef1'), true);
    assert.equal(sameShaPrefix('abc12', 'abc12'), false);
  });

  it('hasDirtyNonGovernanceFiles ignores gitignored session files and flags uncommitted tracked/untracked files', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.agent/.sdlc-session.json'), '{}', 'utf8');
    assert.equal(hasDirtyNonGovernanceFiles(dir), false);

    fs.writeFileSync(path.join(dir, 'dirty.mjs'), 'export const x = 1;\n', 'utf8');
    assert.equal(hasDirtyNonGovernanceFiles(dir), true);
  });
});
