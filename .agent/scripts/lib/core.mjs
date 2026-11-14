import fs from 'node:fs';
import path from 'node:path';
import { execSync, execFileSync, exec } from 'node:child_process';
import { promisify } from 'node:util';

const execPromise = promisify(exec);

// --- Environment Variables Loader (.env support without external dependencies) ---

export function loadEnv(repoRoot = '.') {
  const envPath = path.resolve(repoRoot, '.env');
  if (!fs.existsSync(envPath)) return process.env;

  try {
    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  } catch {
    // Ignore read errors
  }
  return process.env;
}

// --- Helper Functions & Async Subprocess Pool ---

export function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

export function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

export function normalizeTicketId(val) {
  if (val === null || val === undefined || val === '' || val === 'N/A') return null;
  const clean = String(val).trim().replace(/^#/, '');
  if (!clean || clean === 'N/A') return null;
  return clean;
}

export function parseTicketId(val) {
  const clean = normalizeTicketId(val);
  if (clean === null) return null;
  return /^\d+$/.test(clean) ? Number(clean) : clean;
}

export function resolveInsideRepo(repoRoot = '.', relPath = '') {
  const absRoot = path.resolve(repoRoot);
  const targetStr = String(relPath ?? '').trim();
  if (!targetStr) {
    throw new Error('Path traversal refused: empty path.');
  }
  const resolved = path.resolve(absRoot, targetStr);
  if (resolved !== absRoot && !resolved.startsWith(absRoot + path.sep)) {
    throw new Error(`Path traversal refused: '${relPath}' resolves outside repository root.`);
  }
  return resolved;
}

export function writeFileAtomic(filePath, content, options = 'utf8') {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmpPath, content, options);
  fs.renameSync(tmpPath, filePath);
}

export function loadConfig(repoRoot = '.') {
  const cfgPath = path.resolve(repoRoot, '.agent/sdlc-config.json');
  if (!fileExists(cfgPath)) return {};
  try {
    const parsed = JSON.parse(readFileSafe(cfgPath) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function readSessionRegistry(repoRoot = '.') {
  const sessionPath = path.resolve(repoRoot, '.agent/.sdlc-session.json');
  if (!fileExists(sessionPath)) {
    return { exists: false, active: null, activeSessionId: null, sessions: {}, raw: null };
  }
  try {
    const data = JSON.parse(readFileSafe(sessionPath) || '{}');
    if (data && data.sessions && typeof data.sessions === 'object') {
      const active = data.activeSessionId ? data.sessions[data.activeSessionId] || null : null;
      return {
        exists: true,
        active,
        activeSessionId: data.activeSessionId || null,
        sessions: data.sessions,
        raw: data
      };
    }
    if (data && data.active) {
      const id = normalizeTicketId(data.issueId) || String(data.issueId || '');
      return {
        exists: true,
        active: data,
        activeSessionId: id,
        sessions: id ? { [id]: data } : {},
        raw: data
      };
    }
    return { exists: true, active: null, activeSessionId: null, sessions: {}, raw: data };
  } catch {
    return { exists: true, active: null, activeSessionId: null, sessions: {}, raw: null };
  }
}

export function execCommand(cmd, options = {}) {
  try {
    return execSync(cmd, { stdio: 'pipe', encoding: 'utf8', ...options });
  } catch (error) {
    if (options.throwOnError) throw error;
    return error.stdout || error.stderr || '';
  }
}

/**
 * Parses a configured command specification (string or argv array) into `{ file, args }`
 * without invoking a shell, rejecting compound shell operators (`&&`, `||`, `;`, `|`, `>`, `<`, `` ` ``, `$()`).
 */
export function parseCommandArgv(cmdSpec) {
  if (Array.isArray(cmdSpec)) {
    const cleaned = cmdSpec.map((item) => String(item));
    if (cleaned.length === 0 || !cleaned[0].trim()) {
      throw new Error('Configured command argv array must contain at least an executable name.');
    }
    return { file: cleaned[0], args: cleaned.slice(1) };
  }

  if (typeof cmdSpec !== 'string' || !cmdSpec.trim()) {
    throw new Error('Configured command must be a non-empty string or argv array.');
  }

  const tokens = [];
  let current = '';
  let hasToken = false;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < cmdSpec.length; i++) {
    const ch = cmdSpec[i];
    const next = cmdSpec[i + 1];

    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        current += ch;
      }
      continue;
    }

    if (inDouble) {
      if (ch === '\\' && (next === '"' || next === '\\' || next === '$' || next === '`')) {
        current += next;
        i++;
        continue;
      }
      if (ch === '`') {
        throw new Error(`Refusing shell compound command in configuration ('${cmdSpec}'): backtick substitution is not allowed.`);
      }
      if (ch === '$' && next === '(') {
        throw new Error(`Refusing shell compound command in configuration ('${cmdSpec}'): command substitution $() is not allowed.`);
      }
      if (ch === '"') {
        inDouble = false;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '\\' && next !== undefined) {
      current += next;
      hasToken = true;
      i++;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      hasToken = true;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      hasToken = true;
      continue;
    }

    if (
      ch === ';' ||
      ch === '|' ||
      ch === '&' ||
      ch === '<' ||
      ch === '>' ||
      ch === '`' ||
      ch === '\n' ||
      ch === '\r' ||
      (ch === '$' && next === '(')
    ) {
      throw new Error(
        `Refusing shell compound command in configuration ('${cmdSpec}'): specify a single executable command or argv array without shell operators.`
      );
    }

    if (ch === ' ' || ch === '\t') {
      if (hasToken) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }

    current += ch;
    hasToken = true;
  }

  if (inSingle || inDouble) {
    throw new Error(`Unterminated quote in configured command ('${cmdSpec}').`);
  }

  if (hasToken) {
    tokens.push(current);
  }

  if (tokens.length === 0 || !tokens[0]) {
    throw new Error('Configured command resolved to empty executable.');
  }

  return { file: tokens[0], args: tokens.slice(1) };
}

/**
 * Executes a configured command (`string` or `string[]`) directly via `execFileSync` (never `/bin/sh`).
 */
export function runConfiguredCommand(cmdSpec, options = {}) {
  const { file, args } = parseCommandArgv(cmdSpec);
  return execFileSync(file, args, options);
}

export async function execAsync(cmd, options = {}) {
  try {
    const { stdout, stderr } = await execPromise(cmd, { encoding: 'utf8', ...options });
    return { ok: true, stdout: stdout || '', stderr: stderr || '' };
  } catch (error) {
    if (options.throwOnError) throw error;
    return {
      ok: false,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message || '',
      error
    };
  }
}

export async function runParallelTasks(tasks = [], concurrency = 4) {
  if (!Array.isArray(tasks) || tasks.length === 0) return [];
  const results = new Array(tasks.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < tasks.length) {
      const current = nextIdx++;
      results[current] = await tasks[current]();
    }
  }

  const workersCount = Math.max(1, Math.min(Number(concurrency) || 4, tasks.length));
  await Promise.all(Array.from({ length: workersCount }, () => worker()));
  return results;
}

export function parseFrontmatter(markdown = '') {
  if (!markdown.startsWith('---')) return { frontmatter: {}, body: markdown };
  const endIdx = markdown.indexOf('\n---', 3);
  if (endIdx === -1) return { frontmatter: {}, body: markdown };
  const rawYaml = markdown.slice(3, endIdx).trim();
  const body = markdown.slice(endIdx + 4).trim();
  const frontmatter = {};
  for (const line of rawYaml.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      let val = line.slice(colonIdx + 1).trim();
      if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
        val = val.slice(1, -1);
      }
      frontmatter[key] = val;
    }
  }
  return { frontmatter, body };
}

// --- Archlens Governance Bridge ---

export function inspectArchlens(repoRoot = '.') {
  const policyPath = path.resolve(repoRoot, '.archlens/policy.json');
  const legacyPolicyPath = path.resolve(repoRoot, '.uml-viewer/policy.json');
  const hasPolicy = fs.existsSync(policyPath) || fs.existsSync(legacyPolicyPath);

  return {
    installed: hasPolicy,
    policyFile: hasPolicy ? (fs.existsSync(policyPath) ? '.archlens/policy.json' : '.uml-viewer/policy.json') : null,
    workbenchPort: process.env.ARCHLENS_PORT ? Number(process.env.ARCHLENS_PORT) : 8088
  };
}

// --- Project Management Provider Abstraction ---

export function detectPMProvider(repoRoot = '.') {
  loadEnv(repoRoot);

  const explicitEnv = (process.env.SDLC_PM_PROVIDER || '').toLowerCase().trim();
  if (explicitEnv === 'jira') {
    return { provider: 'jira', configured: true, key: process.env.JIRA_PROJECT_KEY || 'SDLC' };
  }
  if (explicitEnv === 'linear') {
    return { provider: 'linear', configured: true, key: process.env.LINEAR_TEAM_KEY || 'DEV' };
  }
  if (explicitEnv === 'github') {
    return { provider: 'github', configured: true };
  }
  if (explicitEnv === 'local') {
    return { provider: 'local', configured: true, file: 'docs/KANBAN.md' };
  }

  const hasJira = !!(process.env.JIRA_API_TOKEN && process.env.JIRA_BASE_URL);
  const hasLinear = !!process.env.LINEAR_API_KEY;

  if (hasJira) return { provider: 'jira', configured: true, key: process.env.JIRA_PROJECT_KEY || 'SDLC' };
  if (hasLinear) return { provider: 'linear', configured: true, key: process.env.LINEAR_TEAM_KEY || 'DEV' };

  const cfgPath = path.resolve(repoRoot, '.agent/sdlc-config.json');
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      const cfgProvider = (cfg?.projectManagement?.provider || '').toLowerCase().trim();
      const cfgKey = cfg?.projectManagement?.projectKey || cfg?.projectManagement?.key || 'SDLC';
      if (cfgProvider === 'jira') return { provider: 'jira', configured: true, key: process.env.JIRA_PROJECT_KEY || cfgKey };
      if (cfgProvider === 'linear') return { provider: 'linear', configured: true, key: process.env.LINEAR_TEAM_KEY || cfgKey };
      if (cfgProvider === 'github') return { provider: 'github', configured: true, key: cfgKey };
      if (cfgProvider === 'local') return { provider: 'local', configured: true, file: 'docs/KANBAN.md' };
    } catch {}
  }

  if (hasGitHubRemote(repoRoot)) {
    return { provider: 'github', configured: true };
  }

  let hasGhCliAuth = false;
  try {
    execFileSync('gh', ['auth', 'status'], { cwd: repoRoot, stdio: 'pipe' });
    hasGhCliAuth = true;
  } catch {}

  const hasGitHub = !!(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || hasGhCliAuth);
  if (hasGitHub) return { provider: 'github', configured: true };

  return { provider: 'local', configured: true, file: 'docs/KANBAN.md' };
}

export function diagnoseEnvironment(repoRoot = '.') {
  loadEnv(repoRoot);

  let hasGhCliAuth = false;
  try {
    execFileSync('gh', ['auth', 'status'], { cwd: repoRoot, stdio: 'pipe' });
    hasGhCliAuth = true;
  } catch {}

  const hasGithubToken = !!(process.env.GITHUB_TOKEN || process.env.GH_TOKEN);

  const checks = [
    {
      name: 'GITHUB_AUTH',
      status: hasGithubToken || hasGhCliAuth,
      details: hasGithubToken ? 'Configured via GITHUB_TOKEN' : (hasGhCliAuth ? 'Active via gh CLI (Keyring authenticated)' : 'Missing (Configure GITHUB_TOKEN or run gh auth login)')
    },
    {
      name: 'JIRA_API_TOKEN',
      status: !!process.env.JIRA_API_TOKEN,
      details: process.env.JIRA_API_TOKEN ? `Configured for ${process.env.JIRA_BASE_URL || 'Jira'}` : 'Not configured'
    },
    {
      name: 'LINEAR_API_KEY',
      status: !!process.env.LINEAR_API_KEY,
      details: process.env.LINEAR_API_KEY ? `Configured for team ${process.env.LINEAR_TEAM_KEY || 'Default'}` : 'Not configured'
    },
    {
      name: 'ARCHLENS',
      status: fs.existsSync(path.resolve(repoRoot, '.archlens/policy.json')),
      details: fs.existsSync(path.resolve(repoRoot, '.archlens/policy.json')) ? 'Active (.archlens/policy.json found)' : 'Not configured (Run sdlc-initialize with Archlens)'
    },
    {
      name: 'LIVING_KANBAN',
      status: fs.existsSync(path.resolve(repoRoot, 'docs/KANBAN.md')),
      details: fs.existsSync(path.resolve(repoRoot, 'docs/KANBAN.md')) ? 'Present (docs/KANBAN.md)' : 'Missing'
    }
  ];

  return {
    pm: detectPMProvider(repoRoot),
    archlens: inspectArchlens(repoRoot),
    checks
  };
}

/**
 * Runs `git` with an argv array (never through a shell) and returns stdout,
 * or null when git exits non-zero. Filenames and refs are passed verbatim,
 * so values like `$(cmd).js` can never be interpreted by a shell.
 */
export function gitOutput(args, repoRoot = '.') {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

export function hasGitHubRemote(repoRoot = '.') {
  if (process.env.GH_HOST === 'invalid.localhost') return false;
  const originUrl = gitOutput(['config', '--get', 'remote.origin.url'], repoRoot) || '';
  return /github\.com/i.test(originUrl.trim());
}

/**
 * Returns a unified diff for one file: branch/commit diff + working tree diff,
 * and for unignored untracked files a synthetic all-added diff of its content.
 */
export function gitDiffForFile(file, repoRoot = '.', baseBranch = null) {
  const resolvedBase = baseBranch || resolveDefaultBaseBranch(repoRoot);
  const committedDiff =
    gitOutput(['diff', `origin/${resolvedBase}...HEAD`, '--', file], repoRoot) ??
    gitOutput(['diff', `${resolvedBase}...HEAD`, '--', file], repoRoot) ??
    gitOutput(['diff', 'HEAD~1', '--', file], repoRoot) ??
    '';
  const working =
    gitOutput(['diff', 'HEAD', '--', file], repoRoot) ||
    gitOutput(['diff', '--', file], repoRoot) ||
    '';
  if (committedDiff || working) {
    return [committedDiff, working].filter(Boolean).join('\n');
  }
  const tracked = gitOutput(['ls-files', '--error-unmatch', '--', file], repoRoot);
  if (tracked === null) {
    const untrackedUnignored = gitOutput(['ls-files', '--others', '--exclude-standard', '--', file], repoRoot);
    if (!untrackedUnignored || !untrackedUnignored.trim()) {
      return '';
    }
    try {
      const abs = path.resolve(repoRoot, file);
      if (fs.statSync(abs).isFile()) {
        const body = fs.readFileSync(abs, 'utf8');
        return `+++ b/${file}\n` + body.split('\n').map((l) => `+${l}`).join('\n');
      }
    } catch {}
  }
  return '';
}

function appendUnifiedDiffChunks(rawDiff, map) {
  if (!rawDiff) return;
  const sections = String(rawDiff).split(/(?=^diff --git )/m);
  for (const section of sections) {
    if (!section.startsWith('diff --git ')) continue;
    const headerEnd = section.indexOf('\n');
    const header = headerEnd === -1 ? section : section.slice(0, headerEnd);
    const bMatch = header.match(/ b\/(.+)$/) || section.match(/^\+\+\+ b\/(.+)$/m);
    const aMatch = header.match(/^diff --git a\/(.+?) b\//);
    const filePath = (bMatch && bMatch[1]) || (aMatch && aMatch[1]) || null;
    if (!filePath) continue;
    const cleanPath = filePath.replace(/^"|"$/g, '').trim();
    const prev = map.get(cleanPath);
    map.set(cleanPath, prev ? `${prev}\n${section}` : section);
  }
}

/**
 * Computes unified diffs for multiple files in 2 batched `git diff` spawns instead of O(N) spawns.
 */
export function getUnifiedDiffByFile(baseBranch = null, repoRoot = '.', files = null) {
  const resolvedBase = baseBranch || resolveDefaultBaseBranch(repoRoot);
  const diffMap = new Map();
  const pathArgs = Array.isArray(files) && files.length > 0 && files.length <= 200 ? ['--', ...files] : [];
  const committedDiff =
    gitOutput(['diff', '--no-color', `origin/${resolvedBase}...HEAD`, ...pathArgs], repoRoot) ??
    gitOutput(['diff', '--no-color', `${resolvedBase}...HEAD`, ...pathArgs], repoRoot) ??
    gitOutput(['diff', '--no-color', 'HEAD~1', ...pathArgs], repoRoot) ??
    '';
  const workingDiff =
    gitOutput(['diff', '--no-color', 'HEAD', ...pathArgs], repoRoot) ??
    gitOutput(['diff', '--no-color', ...pathArgs], repoRoot) ??
    '';

  appendUnifiedDiffChunks(committedDiff, diffMap);
  appendUnifiedDiffChunks(workingDiff, diffMap);

  const untrackedOut = gitOutput(['ls-files', '--others', '--exclude-standard'], repoRoot) || '';
  const untrackedSet = new Set(untrackedOut.split('\n').map((s) => s.trim()).filter(Boolean));
  const candidateFiles = Array.isArray(files) && files.length > 0 ? files : Array.from(untrackedSet);
  for (const file of candidateFiles) {
    if (!diffMap.has(file) && untrackedSet.has(file)) {
      try {
        const abs = path.resolve(repoRoot, file);
        if (fs.statSync(abs).isFile()) {
          const body = fs.readFileSync(abs, 'utf8');
          diffMap.set(file, `+++ b/${file}\n` + body.split('\n').map((l) => `+${l}`).join('\n'));
        }
      } catch {}
    }
  }
  return diffMap;
}

export function hasDevelopBranch(repoRoot = '.') {
  try {
    const absRoot = path.resolve(repoRoot);
    const gitPath = path.join(absRoot, '.git');
    if (fs.existsSync(gitPath) && fs.statSync(gitPath).isDirectory()) {
      if (fs.existsSync(path.join(gitPath, 'refs', 'heads', 'develop'))) {
        return true;
      }
      const remotesDir = path.join(gitPath, 'refs', 'remotes');
      if (fs.existsSync(remotesDir)) {
        for (const remote of fs.readdirSync(remotesDir, { withFileTypes: true })) {
          if (remote.isDirectory() && fs.existsSync(path.join(remotesDir, remote.name, 'develop'))) {
            return true;
          }
        }
      }
      const packedRefsPath = path.join(gitPath, 'packed-refs');
      if (fs.existsSync(packedRefsPath)) {
        const packed = fs.readFileSync(packedRefsPath, 'utf8');
        if (/(^|\n)[0-9a-f]{40,}\s+refs\/(heads\/develop|remotes\/[^/\s]+\/develop)(\s|$)/.test(packed)) {
          return true;
        }
      }
      return false;
    }

    const branches = gitOutput(['branch', '-a'], repoRoot) || '';
    return /(^|\n)[ *]*remotes\/[^/]+\/develop($|\n)|(^|\n)[ *]*develop($|\n)/.test(branches);
  } catch {
    return false;
  }
}

export function resolveDefaultBaseBranch(repoRoot = '.') {
  return hasDevelopBranch(repoRoot) ? 'develop' : 'main';
}

export function getModifiedFiles(baseBranch = null, repoRoot = '.') {
  const resolvedBase = baseBranch || resolveDefaultBaseBranch(repoRoot);
  const lines = (out) => (out || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const branchOut =
    gitOutput(['diff', '--name-only', `origin/${resolvedBase}...HEAD`], repoRoot) ??
    gitOutput(['diff', '--name-only', `${resolvedBase}...HEAD`], repoRoot) ??
    gitOutput(['diff', '--name-only', 'HEAD~1'], repoRoot);
  const workingFiles = [
    ...lines(gitOutput(['diff', '--name-only', 'HEAD'], repoRoot)),
    ...lines(gitOutput(['ls-files', '--others', '--exclude-standard'], repoRoot))
  ];
  return Array.from(new Set([...lines(branchOut), ...workingFiles]));
}
