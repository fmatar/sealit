import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  DEFAULT_QUALITY_THRESHOLDS,
  loadEnv,
  fileExists,
  readFileSafe,
  cleanGitEnv,
  normalizeTicketId,
  parseTicketId,
  resolveInsideRepo,
  writeFileAtomic,
  loadConfig,
  sameShaPrefix,
  resolveQualityThresholds,
  readSessionRegistry,
  parseCommandArgv,
  runConfiguredCommand,
  runParallelTasks,
  parseFrontmatter,
  inspectArchlens,
  detectPMProvider,
  diagnoseEnvironment,
  hasGitHubRemote,
  gitOutput,
  gitDiffForFile,
  getUnifiedDiffByFile,
  extractAddedLinesFromDiff,
  hasDevelopBranch,
  resolveDefaultBaseBranch,
  getModifiedFiles,
  getSessionFilePath,
  readSessionFileState,
  patchActiveSessionManifest,
  getExemptionsPath,
  getExemptions,
  readSessionStatus
} from '../../.agent/scripts/lib/core.mjs';

describe('Unit: core.mjs', () => {
  let tmpDir;
  let gitDir;
  let headSha;

  before(() => {
    gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-unit-core-git-'));
    execFileSync('git', ['init', '-b', 'develop'], { cwd: gitDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: gitDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: gitDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(gitDir, 'src.js'), 'const a = 1;\nconst b = 2;\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: gitDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: gitDir, stdio: 'pipe' });
    execFileSync('git', ['checkout', '-b', 'feature/issue-#5'], { cwd: gitDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(gitDir, 'src.js'), 'const a = 1;\nconst b = 20;\nconst c = 3;\n', 'utf8');
    fs.writeFileSync(path.join(gitDir, 'untracked.js'), 'export const u = 1;\n', 'utf8');
    fs.mkdirSync(path.join(gitDir, '.agent'), { recursive: true });
    fs.writeFileSync(path.join(gitDir, '.agent/.sdlc-session.json'), '{}', 'utf8');
    headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: gitDir, encoding: 'utf8' }).trim();
  });

  after(() => {
    fs.rmSync(gitDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-unit-core-'));
  });

  it('handles path safety, atomic writes, ticket ids, and .env loading without overriding existing env', () => {
    const prevFoo = process.env.SDLC_TEST_ENV_FOO;
    const prevKeep = process.env.SDLC_TEST_ENV_KEEP;
    delete process.env.SDLC_TEST_ENV_FOO;
    process.env.SDLC_TEST_ENV_KEEP = 'preset';
    try {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        '# comment\nSDLC_TEST_ENV_FOO="quoted value"\nSDLC_TEST_ENV_BAR=\'single\'\nSDLC_TEST_ENV_KEEP=overridden\nBADLINE\n',
        'utf8'
      );
      loadEnv(tmpDir);
      assert.equal(process.env.SDLC_TEST_ENV_FOO, 'quoted value');
      assert.equal(process.env.SDLC_TEST_ENV_BAR, 'single');
      assert.equal(process.env.SDLC_TEST_ENV_KEEP, 'preset');
    } finally {
      if (prevFoo === undefined) delete process.env.SDLC_TEST_ENV_FOO;
      else process.env.SDLC_TEST_ENV_FOO = prevFoo;
      if (prevKeep === undefined) delete process.env.SDLC_TEST_ENV_KEEP;
      else process.env.SDLC_TEST_ENV_KEEP = prevKeep;
      delete process.env.SDLC_TEST_ENV_BAR;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('validates resolveInsideRepo boundaries, atomic writes, ticket normalization, and SHA prefixes', () => {
    try {
      const target = path.join(tmpDir, 'nested/file.txt');
      writeFileAtomic(target, 'hello');
      assert.equal(fileExists(target), true);
      assert.equal(readFileSafe(target), 'hello');
      assert.equal(readFileSafe(path.join(tmpDir, 'missing.txt')), null);

      assert.equal(resolveInsideRepo(tmpDir, '.'), path.resolve(tmpDir));
      assert.equal(resolveInsideRepo(tmpDir, 'nested/file.txt'), path.resolve(target));
      assert.throws(() => resolveInsideRepo(tmpDir, '../outside.txt'), /outside repository root/i);
      assert.throws(() => resolveInsideRepo(tmpDir, `../${path.basename(tmpDir)}-sibling/x`), /outside repository root/i);

      assert.equal(normalizeTicketId('#136'), '136');
      assert.equal(normalizeTicketId(' L-4 '), 'L-4');
      assert.equal(normalizeTicketId(''), null);
      assert.equal(normalizeTicketId(null), null);
      assert.equal(parseTicketId('#42'), 42);
      assert.equal(parseTicketId('42'), 42);
      assert.equal(parseTicketId('L-7'), 'L-7');
      assert.equal(parseTicketId(null), null);

      assert.equal(sameShaPrefix('abcdef1', 'abcdef1999'), true);
      assert.equal(sameShaPrefix('abcdef', 'abcdef1999'), false);
      assert.equal(sameShaPrefix('abcdef1', 'abcdef2999'), false);
      assert.equal(sameShaPrefix('', 'abcdef1'), false);
      assert.equal(sameShaPrefix('HEAD', 'HEAD'), false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('resolves quality thresholds precedence, frontmatter, Archlens metadata, and PM providers', () => {
    const prevPm = process.env.SDLC_PM_PROVIDER;
    const prevJiraTok = process.env.JIRA_API_TOKEN;
    const prevJiraUrl = process.env.JIRA_BASE_URL;
    const prevLin = process.env.LINEAR_API_KEY;
    delete process.env.SDLC_PM_PROVIDER;
    delete process.env.JIRA_API_TOKEN;
    delete process.env.JIRA_BASE_URL;
    delete process.env.LINEAR_API_KEY;
    try {
      const noCfg = resolveQualityThresholds(tmpDir);
      assert.equal(noCfg.configExists, false);
      assert.equal(noCfg.minCov, DEFAULT_QUALITY_THRESHOLDS.diffCoverage);
      assert.equal(noCfg.minMut, DEFAULT_QUALITY_THRESHOLDS.mutationScore);
      assert.equal(inspectArchlens(tmpDir).installed, false);
      assert.ok(['local', 'github'].includes(detectPMProvider(tmpDir).provider));

      fs.mkdirSync(path.join(tmpDir, '.agent'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, '.archlens'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, '.archlens/policy.json'),
        JSON.stringify({ layers: [{ name: 'Ring 0' }, { name: 'Ring 1' }] }),
        'utf8'
      );
      const arch = inspectArchlens(tmpDir);
      assert.equal(arch.installed, true);
      assert.equal(arch.policyFile, '.archlens/policy.json');
      assert.equal(arch.workbenchPort, 8088);

      fs.writeFileSync(
        path.join(tmpDir, '.agent/sdlc-config.json'),
        JSON.stringify({
          gates: { minDiffCoverage: 91 },
          testing: { coverageThreshold: 87, mutationThreshold: 63 },
          projectManagement: { provider: 'local' }
        }),
        'utf8'
      );
      assert.deepEqual(detectPMProvider(tmpDir), { provider: 'local', configured: true, file: 'docs/KANBAN.md' });

      fs.writeFileSync(
        path.join(tmpDir, '.agent/sdlc-config.json'),
        JSON.stringify({
          gates: { minDiffCoverage: 91 },
          testing: { coverageThreshold: 87, mutationThreshold: 63 },
          projectManagement: { provider: 'jira', projectKey: 'ENG' }
        }),
        'utf8'
      );
      assert.equal(loadConfig(tmpDir).gates.minDiffCoverage, 91);
      const resCfg = resolveQualityThresholds(tmpDir, { thresholds: { diffCoverage: 75, mutationScore: null } });
      assert.equal(resCfg.configExists, true);
      assert.equal(resCfg.minCov, 91);
      assert.equal(resCfg.minMut, 63);

      assert.deepEqual(detectPMProvider(tmpDir), { provider: 'jira', configured: true, key: 'ENG' });
      process.env.SDLC_PM_PROVIDER = 'linear';
      assert.equal(detectPMProvider(tmpDir).provider, 'linear');
      process.env.SDLC_PM_PROVIDER = 'github';
      assert.equal(detectPMProvider(tmpDir).provider, 'github');

      const parsedFm = parseFrontmatter(
        '---\nid: ADR-001\ntitle: "Quoted Title"\nsupersedes: CAP-01, CAP-02\ndraft: false\ncount: 3\n---\n\nBody text\n'
      );
      assert.equal(parsedFm.frontmatter.id, 'ADR-001');
      assert.equal(parsedFm.frontmatter.title, 'Quoted Title');
      assert.equal(parsedFm.body, 'Body text');
      assert.deepEqual(parseFrontmatter('no frontmatter').frontmatter, {});
    } finally {
      if (prevPm === undefined) delete process.env.SDLC_PM_PROVIDER;
      else process.env.SDLC_PM_PROVIDER = prevPm;
      if (prevJiraTok === undefined) delete process.env.JIRA_API_TOKEN;
      else process.env.JIRA_API_TOKEN = prevJiraTok;
      if (prevJiraUrl === undefined) delete process.env.JIRA_BASE_URL;
      else process.env.JIRA_BASE_URL = prevJiraUrl;
      if (prevLin === undefined) delete process.env.LINEAR_API_KEY;
      else process.env.LINEAR_API_KEY = prevLin;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('parses command argv safely, rejects shell injection, and executes bounded parallel tasks', async () => {
    assert.deepEqual(parseCommandArgv(['node', '--version']), { file: 'node', args: ['--version'] });
    assert.deepEqual(parseCommandArgv(`node -e 'hi there'`), { file: 'node', args: ['-e', 'hi there'] });
    assert.throws(() => parseCommandArgv([]), /executable name/i);
    assert.throws(() => parseCommandArgv('a | b'), /Refusing shell compound command/i);
    assert.throws(() => parseCommandArgv('a; rm -rf'), /Refusing shell compound command/i);
    assert.throws(() => parseCommandArgv('echo $(id)'), /Refusing shell compound command/i);

    assert.equal(runConfiguredCommand(['node', '-e', 'process.stdout.write("ok")'], { encoding: 'utf8', stdio: 'pipe' }), 'ok');
    assert.deepEqual(await runParallelTasks([], 4), []);
    const out = await runParallelTasks([async () => 'x', async () => 'y', async () => 'z'], 2);
    assert.deepEqual(out, ['x', 'y', 'z']);
  });

  it('reads unified diffs, added line numbers, modified files, and session/exemption files cleanly', () => {
    try {
      // Git probes against shared repo
      assert.equal(gitOutput(['rev-parse', 'HEAD'], gitDir).trim(), headSha);
      assert.equal(hasDevelopBranch(gitDir), true);
      assert.equal(resolveDefaultBaseBranch(gitDir), 'develop');

      const mods = getModifiedFiles(null, gitDir);
      assert.ok(mods.includes('src.js'));
      assert.ok(mods.includes('untracked.js'));
      assert.equal(mods.includes('.agent/.sdlc-session.json'), false);

      const singleDiff = gitDiffForFile('src.js', gitDir, 'develop');
      assert.match(singleDiff, /\+const b = 20;/);
      const untrackedDiff = gitDiffForFile('untracked.js', gitDir, 'develop');
      assert.match(untrackedDiff, /\+export const u = 1;/);

      const batchDiffs = getUnifiedDiffByFile('develop', gitDir, ['src.js', 'untracked.js']);
      assert.ok(batchDiffs.get('src.js'));
      assert.ok(batchDiffs.get('untracked.js'));

      const added = extractAddedLinesFromDiff('@@ -1,3 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 20;\n+const c = 3;\n');
      assert.deepEqual([...added], [2, 3]);
      assert.deepEqual([...extractAddedLinesFromDiff('+++ b/new.js\n+first\n+second')], [1, 2]);

      // Session state parser & patching
      assert.equal(readSessionRegistry(tmpDir).exists, false);
      assert.equal(readSessionFileState(tmpDir).exists, false);
      assert.equal(readSessionStatus(tmpDir).active, false);
      assert.equal(patchActiveSessionManifest(tmpDir, { x: 1 }), false);

      const sPath = getSessionFilePath(tmpDir);
      fs.mkdirSync(path.dirname(sPath), { recursive: true });
      fs.writeFileSync(sPath, '', 'utf8');
      assert.match(readSessionFileState(tmpDir).error, /Empty session file/i);

      fs.writeFileSync(sPath, '[1,2]', 'utf8');
      assert.match(readSessionFileState(tmpDir).error, /Invalid session file structure/i);

      fs.writeFileSync(sPath, '{broken', 'utf8');
      assert.match(readSessionFileState(tmpDir).error, /Corrupted session file/i);

      fs.writeFileSync(
        sPath,
        JSON.stringify({
          activeSessionId: 5,
          sessions: { '5': { issueId: 5, active: true, branch: 'feature/issue-#5', manifest: { a: 1 } } }
        }),
        'utf8'
      );
      const st = readSessionFileState(tmpDir);
      assert.equal(st.active, true);
      assert.equal(st.session.issueId, 5);
      assert.equal(patchActiveSessionManifest(tmpDir, { b: 2 }), true);
      assert.equal(readSessionFileState(tmpDir).session.manifest.b, 2);

      // Exemptions
      const exPath = getExemptionsPath(tmpDir);
      assert.deepEqual(getExemptions(tmpDir), []);
      fs.writeFileSync(exPath, JSON.stringify({ exemptions: [{ id: 'EX-1', file: 'a.mjs' }] }), 'utf8');
      assert.equal(getExemptions(tmpDir).length, 1);
      fs.writeFileSync(exPath, '{bad', 'utf8');
      assert.deepEqual(getExemptions(tmpDir), []);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('tokenizes shell escapes/quotes safely, diagnoses environment, and checks main-only/remote repos', () => {
    try {
      // Escaped quotes/backslashes/dollars/backticks inside double quotes & outer escapes
      assert.deepEqual(parseCommandArgv('node -e "a\\"b\\\\c\\$d\\`e"'), { file: 'node', args: ['-e', 'a"b\\c$d`e'] });
      assert.deepEqual(parseCommandArgv('node --flag\\ value'), { file: 'node', args: ['--flag value'] });
      assert.deepEqual(parseCommandArgv(`echo 'single "quoted"'`), { file: 'echo', args: ['single "quoted"'] });

      // All forbidden shell operators & unterminated quotes fail closed
      for (const bad of ['   ', 42, 'a && b', 'a > b', 'a < b', 'echo `id`', 'a\nb', '"echo $(id)"', '"echo `id`"', '"unterminated', "'unterminated"]) {
        assert.throws(() => parseCommandArgv(bad));
      }

      // Environment diagnostics
      const diag = diagnoseEnvironment(gitDir);
      assert.equal(Array.isArray(diag.checks), true);
      assert.equal(diag.checks.length >= 4, true);
      assert.equal(diag.archlens.workbenchPort, 8088);

      // Repo without develop branch resolves default base branch to main
      execFileSync('git', ['init', '-b', 'main'], { cwd: tmpDir, stdio: 'pipe' });
      assert.equal(hasDevelopBranch(tmpDir), false);
      assert.equal(resolveDefaultBaseBranch(tmpDir), 'main');
      assert.equal(hasGitHubRemote(tmpDir), false);

      // Packed-refs develop detection
      fs.writeFileSync(
        path.join(tmpDir, '.git/packed-refs'),
        '1234567890abcdef1234567890abcdef12345678 refs/remotes/origin/develop\n',
        'utf8'
      );
      assert.equal(hasDevelopBranch(tmpDir), true);
      assert.equal(resolveDefaultBaseBranch(tmpDir), 'develop');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('covers quality threshold precedence, PM env/config branches, frontmatter edge cases, and git diff maps', () => {
    const savedEnv = {
      JIRA_API_TOKEN: process.env.JIRA_API_TOKEN,
      JIRA_BASE_URL: process.env.JIRA_BASE_URL,
      JIRA_PROJECT_KEY: process.env.JIRA_PROJECT_KEY,
      LINEAR_API_KEY: process.env.LINEAR_API_KEY,
      LINEAR_TEAM_KEY: process.env.LINEAR_TEAM_KEY
    };
    const restoreEnv = () => {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    };

    const diffRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-unit-core-diff-'));
    try {
      // Threshold resolution: module aggregation, all-null opt-out, and explicit gates override
      fs.mkdirSync(path.join(tmpDir, '.agent'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, '.agent/sdlc-config.json'),
        JSON.stringify({
          modules: [
            { path: 'a', thresholds: { diffCoverage: 70, mutationScore: 55 } },
            { path: 'b', thresholds: { diffCoverage: 88, mutationScore: 62 } }
          ]
        }),
        'utf8'
      );
      const agg = resolveQualityThresholds(tmpDir);
      assert.equal(agg.minCov, 88);
      assert.equal(agg.minMut, 62);
      assert.equal(agg.diffCoverage, 88);
      assert.equal(agg.mutationScore, 62);
      assert.equal(agg.configExists, true);

      fs.writeFileSync(
        path.join(tmpDir, '.agent/sdlc-config.json'),
        JSON.stringify({ modules: [{ path: 'a', thresholds: { diffCoverage: null, mutationScore: null } }] }),
        'utf8'
      );
      const allNull = resolveQualityThresholds(tmpDir);
      assert.equal(allNull.minCov, null);
      assert.equal(allNull.minMut, null);

      fs.writeFileSync(
        path.join(tmpDir, '.agent/sdlc-config.json'),
        JSON.stringify({ gates: { minDiffCoverage: 91, minMutationScore: 76 } }),
        'utf8'
      );
      assert.equal(resolveQualityThresholds(tmpDir).minCov, 91);
      assert.equal(resolveQualityThresholds(tmpDir).minMut, 76);

      // parseFrontmatter edge cases
      assert.deepEqual(parseFrontmatter('no frontmatter here'), { frontmatter: {}, body: 'no frontmatter here' });
      assert.deepEqual(parseFrontmatter('---\nunclosed: true\n'), { frontmatter: {}, body: '---\nunclosed: true\n' });
      const fm = parseFrontmatter(`---\nurl: "https://example.com"\nsingle: 'ok'\n---\n\nBody text`);
      assert.equal(fm.frontmatter.url, 'https://example.com');
      assert.equal(fm.frontmatter.single, 'ok');
      assert.equal(fm.body, 'Body text');

      // detectPMProvider & diagnoseEnvironment across env + config providers
      delete process.env.JIRA_API_TOKEN;
      delete process.env.JIRA_BASE_URL;
      delete process.env.LINEAR_API_KEY;
      for (const [prov, key, expectedKey] of [
        ['jira', 'PROJ', 'PROJ'],
        ['linear', 'ENG', 'ENG'],
        ['github', 'GH', 'GH']
      ]) {
        fs.writeFileSync(
          path.join(tmpDir, '.agent/sdlc-config.json'),
          JSON.stringify({ projectManagement: { provider: prov, projectKey: key } }),
          'utf8'
        );
        const det = detectPMProvider(tmpDir);
        assert.equal(det.provider, prov);
        assert.equal(det.configured, true);
        assert.equal(det.key, expectedKey);
      }

      process.env.JIRA_API_TOKEN = 'tok';
      process.env.JIRA_BASE_URL = 'https://jira.example.com';
      process.env.JIRA_PROJECT_KEY = 'JKEY';
      assert.deepEqual(detectPMProvider(tmpDir), { provider: 'jira', configured: true, key: 'JKEY' });
      delete process.env.JIRA_API_TOKEN;
      process.env.LINEAR_API_KEY = 'lin-key';
      process.env.LINEAR_TEAM_KEY = 'TEAM';
      assert.deepEqual(detectPMProvider(tmpDir), { provider: 'linear', configured: true, key: 'TEAM' });

      fs.mkdirSync(path.join(tmpDir, '.archlens'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.archlens/policy.json'), '{}', 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'docs/KANBAN.md'), '# Kanban\n', 'utf8');
      const diagFull = diagnoseEnvironment(tmpDir);
      assert.equal(diagFull.checks.find((c) => c.name === 'LINEAR_API_KEY').status, true);
      assert.equal(diagFull.checks.find((c) => c.name === 'ARCHLENS').status, true);
      assert.equal(diagFull.checks.find((c) => c.name === 'LIVING_KANBAN').status, true);
      assert.match(diagFull.checks.find((c) => c.name === 'LINEAR_API_KEY').details, /TEAM/);

      // gitDiffForFile, getUnifiedDiffByFile, extractAddedLinesFromDiff on tracked, working, and untracked files
      fs.cpSync(path.join(gitDir, '.git'), path.join(diffRepo, '.git'), { recursive: true });
      execFileSync('git', ['checkout', '-q', '-B', 'develop'], { cwd: diffRepo, stdio: 'pipe' });
      fs.writeFileSync(path.join(diffRepo, 'a.js'), 'const a = 1;\n', 'utf8');
      fs.writeFileSync(path.join(diffRepo, '.gitignore'), 'ignored.js\n', 'utf8');
      execFileSync('git', ['add', '.'], { cwd: diffRepo, stdio: 'pipe' });
      execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: diffRepo, stdio: 'pipe' });

      execFileSync('git', ['checkout', '-b', 'feature/issue-#9'], { cwd: diffRepo, stdio: 'pipe' });
      fs.writeFileSync(path.join(diffRepo, 'a.js'), 'const a = 1;\nconst b = 2;\n', 'utf8');
      execFileSync('git', ['add', 'a.js'], { cwd: diffRepo, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'modify a'], { cwd: diffRepo, stdio: 'pipe' });

      fs.writeFileSync(path.join(diffRepo, 'a.js'), 'const a = 1;\nconst b = 2;\nconst c = 3;\n', 'utf8');
      fs.writeFileSync(path.join(diffRepo, 'untracked.js'), 'export const u = 9;\n', 'utf8');
      fs.writeFileSync(path.join(diffRepo, 'ignored.js'), 'export const ig = 1;\n', 'utf8');

      const mapAll = getUnifiedDiffByFile('develop', diffRepo);
      assert.equal(mapAll.has('a.js'), true);
      assert.equal(mapAll.has('untracked.js'), true);
      assert.equal(mapAll.has('ignored.js'), false);

      const singleTracked = gitDiffForFile('a.js', diffRepo, 'develop');
      const addedLines = extractAddedLinesFromDiff(singleTracked);
      assert.equal(addedLines instanceof Set, true);
      assert.equal(addedLines.has(2), true);
      assert.equal(addedLines.has(3), true);

      const syntheticUntracked = gitDiffForFile('untracked.js', diffRepo, 'develop');
      assert.match(syntheticUntracked, /\+\+\+ b\/untracked\.js/);
      assert.match(syntheticUntracked, /\+export const u = 9;/);
      assert.equal(extractAddedLinesFromDiff(syntheticUntracked).has(1), true);
      assert.equal(gitDiffForFile('ignored.js', diffRepo, 'develop'), '');
      assert.equal(gitDiffForFile('missing.js', diffRepo, 'develop'), '');
    } finally {
      restoreEnv();
      fs.rmSync(diffRepo, { recursive: true, force: true });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('cleanGitEnv strips inherited GIT_* hook variables and isolates gitOutput', () => {
    const sanitized = cleanGitEnv({
      PATH: '/usr/bin',
      CUSTOM_KEEP: 'ok',
      GIT_DIR: '/bad/.git',
      GIT_WORK_TREE: '/bad',
      GIT_INDEX_FILE: '/bad/index',
      GIT_COMMON_DIR: '/bad/.git',
      GIT_OBJECT_DIRECTORY: '/bad/objects',
      GIT_ALTERNATE_OBJECT_DIRECTORIES: '/bad/alt'
    });
    assert.equal(sanitized.PATH, '/usr/bin');
    assert.equal(sanitized.CUSTOM_KEEP, 'ok');
    for (const k of [
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'GIT_COMMON_DIR',
      'GIT_OBJECT_DIRECTORY',
      'GIT_ALTERNATE_OBJECT_DIRECTORIES'
    ]) {
      assert.equal(k in sanitized, false);
    }

    const prevGitDir = process.env.GIT_DIR;
    process.env.GIT_DIR = '/nonexistent-bad-git-dir';
    try {
      const top = (gitOutput(['rev-parse', '--show-toplevel'], gitDir) || '').trim();
      assert.equal(fs.realpathSync(top), fs.realpathSync(gitDir));
    } finally {
      if (prevGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = prevGitDir;
    }
  });
});
