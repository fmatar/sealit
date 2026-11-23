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
  resolveGitCommonRepoRoot,
  resolveGitHooksDir,
  getCurrentGitBranch,
  hasBranch,
  hasDevelopBranch,
  resolveDefaultBaseBranch,
  resolveEffectiveDiffBase,
  resolveRange,
  readChangeSet,
  readBlobs,
  listTree,
  ChangeSetParseError,
  computeAlignmentHashes,
  computeContentTreeSha,
  isDocsOnlyFile,
  isDocsOnlyDiff,
  hasDirtyNonGovernanceFiles,
  normalizeTicketId,
  parseTicketId,
  unquoteGitPath,
  parseFrontmatter,
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

  it('parseEnvFile handles CRLF, export prefix, and inline comments without mutating process.env', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    fs.writeFileSync(
      path.join(dir, '.env'),
      '# comment\r\nexport LINEAR_API_KEY=lin_secret_123 # trailing comment\r\nQUOTED_HASH="val#keep"\r\nSINGLE_QUOTED=\'hello=world\'\r\n',
      'utf8'
    );
    const beforeKeys = Object.keys(process.env).sort();
    const parsed = parseEnvFile(dir);
    assert.deepEqual(Object.keys(process.env).sort(), beforeKeys);
    assert.equal(parsed.LINEAR_API_KEY, 'lin_secret_123');
    assert.equal(parsed.QUOTED_HASH, 'val#keep');
    assert.equal(parsed.SINGLE_QUOTED, 'hello=world');
  });

  it('writeFileAtomic writes atomically and withFileLock recovers from dead-PID and corrupt/0-byte stale locks', () => {
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

    // 0-byte/corrupt stale lockfile older than staleMs is reclaimed via mtimeMs
    fs.writeFileSync(lockPath, '', 'utf8');
    const oldDate = new Date(Date.now() - 120000);
    fs.utimesSync(lockPath, oldDate, oldDate);
    assert.equal(withFileLock(lockPath, () => 'reclaimed', { timeoutMs: 200, staleMs: 30000 }), 'reclaimed');
    assert.equal(fs.existsSync(lockPath), false);

    // Live-PID fresh lockfile times out with FILE_LOCK_TIMEOUT
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, createdAt: Date.now() }), 'utf8');
    try {
      assert.throws(() => withFileLock(lockPath, () => 1, { timeoutMs: 40, staleMs: 30000 }), (err) => err?.code === 'FILE_LOCK_TIMEOUT');
    } finally {
      fs.rmSync(lockPath, { force: true });
    }
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

    // Unborn 0-commit repository resolves symbolic HEAD branch instead of empty string
    const unbornDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-unborn-'));
    cleanups.push(() => fs.rmSync(unbornDir, { recursive: true, force: true }));
    git(unbornDir, 'init', '-q', '-b', 'feat/unborn');
    assert.equal(getCurrentGitBranch(unbornDir), 'feat/unborn');
  });

  it('resolveEffectiveDiffBase handles feature->develop, develop->main, main pushes, and 1-commit newborn repos', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    const prevBaseRef = process.env.GITHUB_BASE_REF;
    delete process.env.GITHUB_BASE_REF;
    try {
      git(dir, 'checkout', '-q', '-b', 'feat/a', 'develop');
      assert.equal(hasDevelopBranch(dir), true);
      assert.equal(hasBranch('main', dir), true);
      assert.equal(resolveDefaultBaseBranch(dir), 'develop');
      assert.equal(resolveEffectiveDiffBase(null, dir), 'develop');

      // GITHUB_BASE_REF=main overrides default develop on feature branch
      process.env.GITHUB_BASE_REF = 'main';
      assert.equal(resolveEffectiveDiffBase(null, dir), 'main');
      delete process.env.GITHUB_BASE_REF;

      // Checked-out develop compares against main
      git(dir, 'checkout', '-q', 'develop');
      assert.equal(resolveEffectiveDiffBase(null, dir), 'main');

      // Push directly on main falls back to HEAD~1..HEAD when >1 commit exists
      git(dir, 'checkout', '-q', 'main');
      fs.writeFileSync(path.join(dir, 'second.txt'), '2\n', 'utf8');
      git(dir, 'add', 'second.txt');
      git(dir, 'commit', '-q', '-m', 'chore: second on main');
      assert.equal(resolveEffectiveDiffBase(null, dir), 'main');
      const mainRange = resolveRange({ repoRoot: dir });
      const mainCs = readChangeSet({ ...mainRange, source: 'commit', repoRoot: dir });
      assert.deepEqual(mainCs.paths, ['second.txt']);

      // Single-commit newborn repo without develop or main returns committed files via empty-tree diff
      const newborn = createTempGitRepo({ withDevelop: false, initialBranch: 'feat/init' });
      cleanups.push(newborn.cleanup);
      fs.writeFileSync(path.join(newborn.dir, 'committed-on-root.mjs'), 'export const rootVal = 99;\n', 'utf8');
      git(newborn.dir, 'add', 'committed-on-root.mjs');
      git(newborn.dir, 'commit', '--amend', '-q', '--no-edit');
      const nbRange = resolveRange({ repoRoot: newborn.dir });
      const nbCs = readChangeSet({ ...nbRange, source: 'commit', repoRoot: newborn.dir });
      assert.equal(nbCs.paths.includes('committed-on-root.mjs'), true);
      assert.match(nbCs.patches.get('committed-on-root.mjs') || '', /\+export const rootVal = 99;/);
    } finally {
      if (prevBaseRef === undefined) delete process.env.GITHUB_BASE_REF;
      else process.env.GITHUB_BASE_REF = prevBaseRef;
    }

    // Symlink inside repo escaping repoRoot is blocked by resolveInsideRepo
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-sym-escape-'));
    cleanups.push(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
    fs.symlinkSync(outsideDir, path.join(dir, 'sym-out'));
    assert.throws(() => resolveInsideRepo(dir, 'sym-out/secret.txt'), /symlink|outside/i);
  });

  it('resolveEffectiveDiffBase and resolveRange support GitLab, Bitbucket, and Azure DevOps CI branch variables', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    const envKeys = [
      'GITHUB_BASE_REF',
      'GITHUB_REF_NAME',
      'GITHUB_REF',
      'CI_MERGE_REQUEST_TARGET_BRANCH_NAME',
      'CI_MERGE_REQUEST_SOURCE_BRANCH_NAME',
      'CI_COMMIT_REF_NAME',
      'BITBUCKET_PR_DESTINATION_BRANCH',
      'BITBUCKET_BRANCH',
      'SYSTEM_PULLREQUEST_TARGETBRANCH',
      'BUILD_SOURCEBRANCHNAME'
    ];
    const saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
    for (const k of envKeys) delete process.env[k];

    try {
      git(dir, 'checkout', '-q', '-b', 'feat/gitlab-mr', 'develop');
      assert.equal(resolveEffectiveDiffBase(null, dir), 'develop');

      // GitLab MR targeting main
      process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME = 'main';
      assert.equal(resolveEffectiveDiffBase(null, dir), 'main');
      delete process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME;

      // Bitbucket PR targeting main
      process.env.BITBUCKET_PR_DESTINATION_BRANCH = 'main';
      assert.equal(resolveEffectiveDiffBase(null, dir), 'main');
      delete process.env.BITBUCKET_PR_DESTINATION_BRANCH;

      // Azure DevOps PR targeting refs/heads/main (strips refs/heads/)
      process.env.SYSTEM_PULLREQUEST_TARGETBRANCH = 'refs/heads/main';
      assert.equal(resolveEffectiveDiffBase(null, dir), 'main');
      delete process.env.SYSTEM_PULLREQUEST_TARGETBRANCH;

      // Detached HEAD on GitHub/GitLab/Azure push pipelines for develop compares against main (ignores non-branch refs/pull/*)
      git(dir, 'checkout', '-q', '--detach', 'develop');
      for (const [k, v] of [
        ['GITHUB_REF_NAME', 'develop'],
        ['GITHUB_REF', 'refs/heads/develop'],
        ['CI_MERGE_REQUEST_SOURCE_BRANCH_NAME', 'develop'],
        ['CI_COMMIT_REF_NAME', 'develop'],
        ['BUILD_SOURCEBRANCHNAME', 'develop']
      ]) {
        process.env[k] = v;
        assert.equal(resolveEffectiveDiffBase(null, dir), 'main', `Expected ${k}=${v} to resolve base 'main'`);
        delete process.env[k];
      }
      process.env.GITHUB_REF = 'refs/pull/12/merge';
      assert.equal(resolveEffectiveDiffBase(null, dir), 'develop');
      delete process.env.GITHUB_REF;

      // Detached HEAD on Bitbucket push pipeline for main uses HEAD~1..HEAD unless PR destination is set
      git(dir, 'checkout', '-q', 'main');
      fs.writeFileSync(path.join(dir, 'ci-host.txt'), 'host\n', 'utf8');
      git(dir, 'add', 'ci-host.txt');
      git(dir, 'commit', '-q', '-m', 'chore: ci host commit on main');
      git(dir, 'checkout', '-q', '--detach', 'main');

      process.env.BITBUCKET_BRANCH = 'main';
      const pushRange = resolveRange({ repoRoot: dir });
      assert.notEqual(pushRange.baseSha, pushRange.headSha);

      process.env.BITBUCKET_PR_DESTINATION_BRANCH = 'main';
      const prAtBaseRange = resolveRange({ repoRoot: dir });
      assert.equal(prAtBaseRange.baseSha, prAtBaseRange.headSha);
    } finally {
      for (const k of envKeys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
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

    const wtRange = resolveRange({ repoRoot: dir });
    const wtCs = readChangeSet({ ...wtRange, source: 'worktree', repoRoot: dir });
    assert.equal(wtCs.paths.includes('src/secret.mjs'), true);
    assert.equal(wtCs.paths.includes(quotedRel), true);
    assert.equal(wtCs.paths.includes('src/nul.mjs'), true);
    assert.equal((wtCs.patches.get('src/secret.mjs') || '').includes(`+export const key = "${fakeAwsId}";`), true);
    assert.match(wtCs.patches.get(quotedRel) || '', /\+export const q = 2;/);
    assert.match(wtCs.patches.get('src/nul.mjs') || '', /Binary files .* differ/);
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

  it('isDocsOnlyDiff strictly distinguishes prose docs from agent skills, rules, dotfiles, specs, manifests, and code', () => {
    assert.equal(isDocsOnlyDiff([]), false);
    assert.equal(isDocsOnlyDiff(['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE', 'docs/guide.md', 'docs/logo-dark.svg']), true);
    for (const nonDoc of [
      '.agent/skills/sealit-gate/SKILL.md',
      '.claude/skills/sealit/SKILL.md',
      '.cursor/rules/sealit.mdc',
      '.codex/skills/sealit/SKILL.md',
      '.github/PULL_REQUEST_TEMPLATE.md',
      '.github/copilot-instructions.md',
      'AGENTS.md',
      'CLAUDE.md',
      'llms.txt',
      '.gitignore',
      '.gitattributes',
      '.editorconfig',
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
    assert.equal(parseTicketId('#42'), 42);
    assert.equal(parseTicketId('L-7'), 'L-7');
    assert.equal(parseTicketId(''), null);
    assert.equal(unquoteGitPath('"a\\tb\\nc\\\"d\\\\e"'), 'a\tb\nc"d\\e');
    assert.deepEqual(parseFrontmatter('---\nid: ADR-001\ntitle: "Quoted"\n---\nBody text').frontmatter, { id: 'ADR-001', title: 'Quoted' });
    assert.deepEqual(parseFrontmatter('No frontmatter').frontmatter, {});
    assert.equal(sameShaPrefix('abcdef1234567890', 'abcdef1'), true);
    assert.equal(sameShaPrefix('abc12', 'abc12'), false);
  });

  it('hasDirtyNonGovernanceFiles ignores gitignored session files and flags uncommitted tracked/untracked files', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.agent/.sealit-session.json'), '{}', 'utf8');
    assert.equal(hasDirtyNonGovernanceFiles(dir), false);

    fs.writeFileSync(path.join(dir, 'dirty.mjs'), 'export const x = 1;\n', 'utf8');
    assert.equal(hasDirtyNonGovernanceFiles(dir), true);
  });

  it('readChangeSet lists both sides of renames, exact-case paths, and ignores the 9-setting hostile config/env matrix', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    fs.mkdirSync(path.join(dir, 'docs/specs'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs/specs/cap-01.md'), '# Cap\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'src/core.js'), 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\nexport const d = 4;\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'src/a.js'), 'export const a0 = 0;\nexport const a1 = 1;\nexport const a2 = 2;\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'src/CaseFile.js'), 'export const cf = 1;\n', 'utf8');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'chore: base files');

    git(dir, 'checkout', '-q', '-b', 'feat/mv', 'develop');
    git(dir, 'mv', 'docs/specs/cap-01.md', 'docs/archive-cap-01.md');
    git(dir, 'mv', 'src/core.js', 'docs/core.md');
    git(dir, 'mv', '-f', 'src/CaseFile.js', 'src/casefile.tmp.js');
    git(dir, 'mv', '-f', 'src/casefile.tmp.js', 'src/casefile.js');
    fs.writeFileSync(path.join(dir, 'src/a.js'), 'export const a0 = 0;\nexport const a1 = 1;\nexport const k = 1;\nexport const a2 = 2;\n', 'utf8');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'refactor: move files and edit src/a.js');

    const expectedPaths = [
      'docs/archive-cap-01.md',
      'docs/core.md',
      'docs/specs/cap-01.md',
      'src/CaseFile.js',
      'src/a.js',
      'src/casefile.js',
      'src/core.js'
    ].sort();

    const matrix = [
      { label: 'default', cfg: null, env: null },
      { label: 'diff.noprefix', cfg: ['diff.noprefix', 'true'], env: null },
      { label: 'diff.mnemonicPrefix', cfg: ['diff.mnemonicPrefix', 'true'], env: null },
      { label: 'diff.external=echo', cfg: ['diff.external', 'echo'], env: null },
      { label: 'diff.renames=copies', cfg: ['diff.renames', 'copies'], env: null },
      { label: 'diff.srcPrefix=X/', cfg: ['diff.srcPrefix', 'X/'], env: null },
      { label: 'diff.context=10', cfg: ['diff.context', '10'], env: null },
      { label: 'GIT_EXTERNAL_DIFF=echo', cfg: null, env: ['GIT_EXTERNAL_DIFF', 'echo'] },
      { label: 'GIT_LITERAL_PATHSPECS=1', cfg: null, env: ['GIT_LITERAL_PATHSPECS', '1'] }
    ];

    const range = resolveRange({ baseBranch: 'develop', repoRoot: dir });
    for (const item of matrix) {
      if (item.cfg) git(dir, 'config', item.cfg[0], item.cfg[1]);
      const hadEnv = item.env ? Object.prototype.hasOwnProperty.call(process.env, item.env[0]) : false;
      const prevEnv = item.env ? process.env[item.env[0]] : undefined;
      if (item.env) process.env[item.env[0]] = item.env[1];
      try {
        const cs = readChangeSet({ ...range, source: 'commit', repoRoot: dir });
        assert.deepEqual(cs.paths, expectedPaths, `paths mismatch under ${item.label}`);
        assert.equal(isDocsOnlyDiff(cs), false, `docsOnly must be false under ${item.label}`);
        const patchA = cs.patches.get('src/a.js') || '';
        assert.match(patchA, /^\+export const k = 1;$/m, `added line missing under ${item.label}`);
        for (const hMatch of patchA.matchAll(/^@@ -\d+(?:,\d+)? \+\d+(?:,(\d+))? @@\n([\s\S]*?)(?=^@@ |(?![\s\S]))/gm)) {
          const expectedPlus = hMatch[1] === undefined ? 1 : Number(hMatch[1]);
          const actualPlus = hMatch[2].split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
          assert.equal(actualPlus, expectedPlus, `-U0 hunk count must equal + lines under ${item.label}`);
        }
      } finally {
        if (item.cfg) git(dir, 'config', '--unset', item.cfg[0]);
        if (item.env) {
          if (hadEnv) process.env[item.env[0]] = prevEnv;
          else delete process.env[item.env[0]];
        }
      }
    }

    const cleaned = cleanGitEnv({
      PATH: '/usr/bin',
      GIT_EXTERNAL_DIFF: 'echo',
      GIT_DIFF_OPTS: '-u',
      GIT_LITERAL_PATHSPECS: '1',
      GIT_GLOB_PATHSPECS: '1',
      GIT_NOGLOB_PATHSPECS: '1',
      GIT_ICASE_PATHSPECS: '1'
    });
    assert.equal(cleaned.PATH, '/usr/bin');
    assert.equal(cleaned.GIT_LITERAL_PATHSPECS, undefined);
    assert.equal(cleaned.GIT_EXTERNAL_DIFF, undefined);
  });

  it('readChangeSet on a pull/N/merge style merge commit only reports PR changes, -M reports only edited lines on moved files, and computeAlignmentHashes({ sha }) ignores uncommitted edits', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    // Seed multi-line file on develop
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'docs/specs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'PRODUCT.md'), '# Product v1 — UTF-8 ≥ … 🎉\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'docs/specs/cap-01.md'), '# Cap 01\n', 'utf8');
    const twentyLines = Array.from({ length: 20 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';
    fs.writeFileSync(path.join(dir, 'src/orig.mjs'), twentyLines, 'utf8');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'chore: seed develop');

    // Create PR branch: move src/orig.mjs -> src/moved.mjs and edit ONE line
    git(dir, 'checkout', '-q', '-b', 'feat/pr-move', 'develop');
    git(dir, 'mv', 'src/orig.mjs', 'src/moved.mjs');
    fs.writeFileSync(path.join(dir, 'src/moved.mjs'), twentyLines.replace('export const v10 = 10;', 'export const v10 = 999;'), 'utf8');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'feat: move and edit 1 line');
    const prHead = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    const moveRange = resolveRange({ baseBranch: 'develop', head: prHead, repoRoot: dir });
    const moveCs = readChangeSet({ ...moveRange, source: 'commit', repoRoot: dir });
    assert.deepEqual(moveCs.paths, ['src/moved.mjs', 'src/orig.mjs']);
    const movedPatch = moveCs.patches.get('src/moved.mjs') || '';
    const plusLines = movedPatch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
    assert.equal(plusLines.length, 1, 'moved file with 1 edited line must contribute exactly 1 added line');
    assert.equal(plusLines[0], '+export const v10 = 999;');

    // Advance develop independently, then create a pull/N/merge synthetic merge commit (parent 1 = develop, parent 2 = prHead)
    git(dir, 'checkout', '-q', 'develop');
    fs.writeFileSync(path.join(dir, 'src/already-on-develop.mjs'), 'export const devOnly = true;\n', 'utf8');
    git(dir, 'add', 'src/already-on-develop.mjs');
    git(dir, 'commit', '-q', '-m', 'feat: unrelated commit on develop');
    const devTip = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    git(dir, 'checkout', '-q', '--detach', devTip);
    assert.equal(git(dir, 'merge', '--no-ff', '-q', '-m', 'Merge pull request #99', prHead).status, 0);
    const prMergeSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    const prevBaseRef = process.env.GITHUB_BASE_REF;
    process.env.GITHUB_BASE_REF = 'develop';
    try {
      const ciRange = resolveRange({ repoRoot: dir });
      assert.equal(ciRange.baseSha, devTip);
      assert.equal(ciRange.headSha, prMergeSha);
      const ciCs = readChangeSet({ ...ciRange, source: 'commit', repoRoot: dir });
      assert.deepEqual(ciCs.paths, ['src/moved.mjs', 'src/orig.mjs'], 'pull/N/merge ChangeSet must exclude commits already on develop');
    } finally {
      if (prevBaseRef === undefined) delete process.env.GITHUB_BASE_REF;
      else process.env.GITHUB_BASE_REF = prevBaseRef;
    }

    // readBlobs handles UTF-8 multi-byte chars, missing blobs, tree objects, and external 160000 gitlink (<oid> submodule) cleanly
    git(dir, 'checkout', '-q', '-b', 'feat/ext-sub', prMergeSha);
    const externalSubOid = 'deadbeef'.repeat(5);
    git(dir, 'update-index', '--add', '--cacheinfo', `160000,${externalSubOid},vendor/ext-sub`);
    git(dir, 'commit', '-q', '-m', 'chore: add external submodule gitlink');
    const subSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    const blobs = readBlobs([`${subSha}:PRODUCT.md`, `${subSha}:missing.md`, `${subSha}:docs`, `${subSha}:vendor/ext-sub`], dir);
    assert.equal(blobs.get(`${subSha}:PRODUCT.md`), '# Product v1 — UTF-8 ≥ … 🎉\n');
    assert.equal(blobs.get(`${subSha}:missing.md`), null);
    assert.equal(blobs.get(`${subSha}:docs`), null);
    assert.equal(blobs.get(`${subSha}:vendor/ext-sub`), null);
    assert.deepEqual(listTree(prMergeSha, 'docs/specs', dir), ['docs/specs/cap-01.md']);

    // Commit binary file with " b/" in name (symmetric header parsing) + 100%-identical rename (rename to header)
    fs.mkdirSync(path.join(dir, 'src/my b'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/my b/nul.mjs'), Buffer.from('\x00export const sym = 1;\n', 'latin1'));
    git(dir, 'mv', 'docs/specs/cap-01.md', 'docs/specs/cap-01-renamed.md');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'feat: symmetric binary header and pure 100% rename');
    const symHead = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    const symCs = readChangeSet({ baseSha: subSha, headSha: symHead, source: 'commit', repoRoot: dir });
    assert.equal(symCs.patches.has('src/my b/nul.mjs'), true);
    assert.equal(symCs.patches.has('docs/specs/cap-01-renamed.md'), true);

    // Worktree stat-dirty unmodified file is filtered out via blob SHA-1 check; untracked symlink/NUL/empty files synthesize patches
    const fut = new Date(Date.now() + 20000);
    fs.utimesSync(path.join(dir, 'PRODUCT.md'), fut, fut);
    fs.symlinkSync('PRODUCT.md', path.join(dir, 'untracked-link.md'));
    fs.writeFileSync(path.join(dir, 'untracked-empty.mjs'), '', 'utf8');
    fs.writeFileSync(path.join(dir, 'untracked-nul.mjs'), Buffer.from('\x00const x = 1;\n', 'latin1'));
    const wtCheck = readChangeSet({ baseSha: symHead, headSha: symHead, source: 'worktree', repoRoot: dir });
    assert.equal(wtCheck.paths.includes('PRODUCT.md'), false, 'stat-only touch on unmodified file must be excluded');
    assert.equal(wtCheck.entries.find((e) => e.path === 'untracked-link.md')?.newMode, '120000');
    assert.match(wtCheck.patches.get('untracked-nul.mjs') || '', /Binary files .* differ/);
    fs.rmSync(path.join(dir, 'untracked-link.md'), { force: true });
    fs.rmSync(path.join(dir, 'untracked-empty.mjs'), { force: true });
    fs.rmSync(path.join(dir, 'untracked-nul.mjs'), { force: true });

    // computeAlignmentHashes({ sha }) ignores uncommitted spec edits on disk
    const committedHashes = computeAlignmentHashes({ sha: prMergeSha, repoRoot: dir });
    fs.writeFileSync(path.join(dir, 'PRODUCT.md'), '# Uncommitted tamper on disk!\n', 'utf8');
    assert.deepEqual(computeAlignmentHashes({ sha: prMergeSha, repoRoot: dir }), committedHashes);

    // isDocsOnlyDiff(changeSet) rejects symlinks (120000), gitlinks (160000), and executables (100755) under docs/
    assert.equal(isDocsOnlyDiff({ entries: [{ path: 'docs/guide.md', status: 'A', oldMode: '000000', newMode: '100644' }] }), true);
    assert.equal(isDocsOnlyDiff({ entries: [{ path: 'docs/link.md', status: 'A', oldMode: '000000', newMode: '120000' }] }), false);
    assert.equal(isDocsOnlyDiff({ entries: [{ path: 'docs/sub.md', status: 'A', oldMode: '000000', newMode: '160000' }] }), false);
    assert.equal(isDocsOnlyDiff({ entries: [{ path: 'docs/exec.md', status: 'M', oldMode: '100644', newMode: '100755' }] }), false);
    assert.throws(
      () => readChangeSet({ ...moveRange, source: 'commit', repoRoot: dir, _rawPatchOverride: '' }),
      (err) => err instanceof ChangeSetParseError && err.code === 'CHANGESET_PARSE_ERROR'
    );
    assert.throws(
      () => readChangeSet({ ...moveRange, source: 'bogus', repoRoot: dir }),
      (err) => err instanceof ChangeSetParseError && /Invalid ChangeSet source/.test(err.message)
    );

    // Header-only binary patch fallback (exact symmetric a/<kp> b/<kp> without suffix collision + quoted C-escaped path), empty/same-SHA ranges, and invalid readBlobs specs
    fs.mkdirSync(path.join(dir, 'z b'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.mjs'), Buffer.from('\x00const rootA = 1;\n', 'latin1'));
    fs.writeFileSync(path.join(dir, 'z b/a.mjs'), Buffer.from('\x00const nestedA = 2;\n', 'latin1'));
    git(dir, 'add', 'a.mjs', 'z b/a.mjs');
    git(dir, 'commit', '-q', '-m', 'feat: suffix collision binary paths');
    const colHead = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    const headerOnlyCs = readChangeSet({
      baseSha: subSha,
      headSha: colHead,
      source: 'commit',
      repoRoot: dir,
      _rawPatchOverride: [
        'diff --git a/src/my b/nul.mjs b/src/my b/nul.mjs\nBinary files a/src/my b/nul.mjs and b/src/my b/nul.mjs differ',
        'diff --git a/docs/specs/cap-01.md b/docs/specs/cap-01-renamed.md\nsimilarity index 100%\nrename from docs/specs/cap-01.md\nrename to docs/specs/cap-01-renamed.md',
        'diff --git a/z b/a.mjs b/z b/a.mjs\nBinary files a/z b/a.mjs and b/z b/a.mjs differ',
        'diff --git a/a.mjs b/a.mjs\nBinary files a/a.mjs and b/a.mjs differ',
        'diff --git "a/tab\\tname" "b/tab\\tname"\nBinary files differ'
      ].join('\n')
    });
    assert.match(headerOnlyCs.patches.get('a.mjs'), /a\/a\.mjs and b\/a\.mjs/);
    assert.match(headerOnlyCs.patches.get('z b/a.mjs'), /a\/z b\/a\.mjs and b\/z b\/a\.mjs/);
    assert.ok(headerOnlyCs.patches.get('tab\tname').includes('Binary files'));
    assert.deepEqual(readChangeSet({ baseSha: moveRange.headSha, headSha: moveRange.headSha, source: 'commit', repoRoot: dir }).paths, []);
    assert.equal(readBlobs([], dir).size, 0);
    assert.equal(readBlobs(['bad\nspec'], dir).get('bad\nspec'), null);
    assert.deepEqual(listTree('', '', dir), []);
    assert.deepEqual(listTree('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', '', dir), []);
    assert.deepEqual(listTree(prMergeSha, './docs/specs/', dir), ['docs/specs/cap-01.md']);

    // resolveRange: branchHint on base vs feature at base vs missing base ref fallback
    git(dir, 'checkout', '--', 'PRODUCT.md');
    git(dir, 'checkout', '-q', 'develop');
    const devHead = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    const devParent = git(dir, 'rev-parse', 'HEAD~1').stdout.trim();
    const pushBaseRange = resolveRange({ baseBranch: 'develop', branchHint: 'develop', repoRoot: dir });
    assert.equal(pushBaseRange.baseSha, devParent);
    const featAtBaseRange = resolveRange({ baseBranch: 'develop', branchHint: 'feat/aligned', repoRoot: dir });
    assert.equal(featAtBaseRange.baseSha, devHead);
    const missingBaseRange = resolveRange({ baseBranch: 'no-such-base', repoRoot: dir });
    assert.equal(missingBaseRange.baseSha, devParent);

    // worktree readChangeSet: staged-then-reverted file (cachedMissing) and untracked executable (100755)
    git(dir, 'checkout', '-q', '-b', 'feat/wt-edges', 'develop');
    fs.writeFileSync(path.join(dir, 'src/staged-only.js'), 'export const s = 1;\n', 'utf8');
    git(dir, 'add', 'src/staged-only.js');
    fs.unlinkSync(path.join(dir, 'src/staged-only.js'));
    fs.writeFileSync(path.join(dir, 'src/untracked-exec.sh'), '#!/bin/sh\necho ok\n', { mode: 0o755 });
    const wtEdgeCs = readChangeSet({ baseSha: devHead, headSha: devHead, source: 'worktree', repoRoot: dir });
    assert.equal(wtEdgeCs.paths.includes('src/staged-only.js'), true);
    assert.ok(wtEdgeCs.patches.get('src/staged-only.js').includes('+export const s = 1;'));
    assert.equal(wtEdgeCs.entries.find((e) => e.path === 'src/untracked-exec.sh')?.newMode, '100755');
  });
});
