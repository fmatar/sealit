import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

export const GIT_MAX_BUFFER = 64 * 1024 * 1024;
export const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const MAX_SYNTHETIC_DIFF_BYTES = 16 * 1024 * 1024;

const TRUE_BINARY_EXT_RE =
  /\.(?:png|jpe?g|gif|webp|ico|bmp|tiff?|avif|mp[34]|mov|avi|mkv|wav|ogg|flac|woff2?|ttf|otf|eot|pdf|zip|tar|gz|tgz|bz2|xz|7z|rar|wasm|pyc|class|jar|so|dylib|dll|exe|bin|sqlite3?|db)$/i;

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

export function sameShaPrefix(a, b) {
  const sa = String(a || '').trim();
  const sb = String(b || '').trim();
  if (!sa || !sb || sa === 'HEAD' || sb === 'HEAD') return false;
  if (sa.length < 7 || sb.length < 7) return false;
  return sa === sb || sa.startsWith(sb) || sb.startsWith(sa);
}

export function assertNoSymlinkAncestors(baseRoot, targetPath) {
  const absBase = path.resolve(baseRoot);
  const absTarget = path.resolve(targetPath);
  if (absTarget !== absBase && !absTarget.startsWith(absBase + path.sep)) {
    const err = new Error(`Path traversal refused: '${targetPath}' resolves outside repository root ('${absBase}').`);
    err.code = 'OUTSIDE_REPO_PATH';
    throw err;
  }
  const rel = path.relative(absBase, absTarget);
  if (rel) {
    let cur = absBase;
    for (const part of rel.split(path.sep).filter(Boolean)) {
      cur = path.join(cur, part);
      try {
        if (fs.lstatSync(cur).isSymbolicLink()) {
          const err = new Error(`Path traversal refused: symlink component detected at '${cur}'.`);
          err.code = 'OUTSIDE_REPO_PATH';
          throw err;
        }
      } catch (err) {
        if (err && err.code === 'OUTSIDE_REPO_PATH') throw err;
        break;
      }
    }
  }
  if (fileExists(absBase)) {
    const realBase = fs.realpathSync(absBase);
    let checkCur = absTarget;
    while (checkCur.length >= absBase.length && !fileExists(checkCur)) {
      const parent = path.dirname(checkCur);
      if (parent === checkCur) break;
      checkCur = parent;
    }
    if (fileExists(checkCur)) {
      const realCheck = fs.realpathSync(checkCur);
      if (realCheck !== realBase && !realCheck.startsWith(realBase + path.sep)) {
        const err = new Error(`Path traversal refused: '${targetPath}' resolves outside repository root via symlink.`);
        err.code = 'OUTSIDE_REPO_PATH';
        throw err;
      }
    }
  }
  return absTarget;
}

export function resolveInsideRepo(repoRoot = '.', relPath = '') {
  const absRoot = path.resolve(repoRoot);
  const targetStr = String(relPath ?? '').trim();
  if (!targetStr) {
    const err = new Error('Path traversal refused: empty path.');
    err.code = 'OUTSIDE_REPO_PATH';
    throw err;
  }
  const resolved = path.resolve(absRoot, targetStr);
  return assertNoSymlinkAncestors(absRoot, resolved);
}

let atomicWriteCounter = 0;

export function writeFileAtomic(filePath, content, mode = undefined) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${++atomicWriteCounter}.tmp`);
  try {
    const writeOpts = typeof mode === 'number' ? { encoding: 'utf8', mode } : 'utf8';
    fs.writeFileSync(tmpPath, content, Buffer.isBuffer(content) ? (typeof mode === 'number' ? { mode } : undefined) : writeOpts);
    if (typeof mode === 'number' && process.platform !== 'win32') {
      fs.chmodSync(tmpPath, mode);
    }
    try {
      if (fs.lstatSync(filePath).isSymbolicLink()) fs.unlinkSync(filePath);
    } catch {}
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
    throw err;
  }
}

function isPidAlive(pid) {
  const num = Number(pid);
  if (!Number.isInteger(num) || num <= 0) return false;
  try {
    process.kill(num, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

export function withFileLock(lockPath, fn, { timeoutMs = 5000, staleMs = 30000 } = {}) {
  const absLock = path.resolve(lockPath);
  fs.mkdirSync(path.dirname(absLock), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  let acquired = false;

  while (Date.now() <= deadline) {
    try {
      const payload = JSON.stringify({ pid: process.pid, createdAt: Date.now() });
      fs.writeFileSync(absLock, payload, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      acquired = true;
      break;
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err;
      try {
        let stale = false;
        try {
          const parsed = JSON.parse(fs.readFileSync(absLock, 'utf8'));
          stale = !isPidAlive(parsed?.pid) || Date.now() - Number(parsed?.createdAt || 0) > staleMs;
        } catch {
          stale = Date.now() - fs.statSync(absLock).mtimeMs > staleMs;
        }
        if (stale) {
          const reclaimPath = `${absLock}.reclaim.${process.pid}.${Date.now()}`;
          fs.renameSync(absLock, reclaimPath);
          fs.unlinkSync(reclaimPath);
          continue;
        }
      } catch {}
      const sleepEnd = Date.now() + 15;
      while (Date.now() < sleepEnd) {
        // bounded spin on local file lock contention
      }
    }
  }

  if (!acquired) {
    const err = new Error(`Timed out acquiring file lock '${absLock}' after ${timeoutMs}ms.`);
    err.code = 'FILE_LOCK_TIMEOUT';
    throw err;
  }

  try {
    return fn();
  } finally {
    try {
      fs.unlinkSync(absLock);
    } catch {}
  }
}

export function parseEnvFile(repoRoot = '.') {
  const envPath = path.resolve(repoRoot, '.env');
  const out = {};
  if (!fileExists(envPath)) return out;
  const raw = readFileSafe(envPath);
  if (!raw) return out;

  for (const rawLine of raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim().replace(/^export\s+/, '');
    if (!key) continue;
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"') && val.length >= 2) || (val.startsWith("'") && val.endsWith("'") && val.length >= 2)) {
      val = val.slice(1, -1);
    } else {
      const hashIdx = val.search(/\s+#/);
      if (hashIdx !== -1) val = val.slice(0, hashIdx).trim();
    }
    out[key] = val;
  }
  return out;
}

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
      if (ch === "'") inSingle = false;
      else current += ch;
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
      if (ch === '"') inDouble = false;
      else current += ch;
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

  if (hasToken) tokens.push(current);
  if (tokens.length === 0 || !tokens[0]) {
    throw new Error('Configured command resolved to empty executable.');
  }

  return { file: tokens[0], args: tokens.slice(1) };
}

export function runConfiguredCommand(cmdSpec, options = {}) {
  const { file, args } = parseCommandArgv(cmdSpec);
  const childEnv = { ...(options.env || process.env) };
  if (!options.env) {
    delete childEnv.NODE_TEST_CONTEXT;
    delete childEnv.NODE_V8_COVERAGE;
  }
  return execFileSync(file, args, { maxBuffer: GIT_MAX_BUFFER, ...options, env: childEnv });
}

export function cleanGitEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_COMMON_DIR;
  delete env.GIT_OBJECT_DIRECTORY;
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  delete env.GIT_EXTERNAL_DIFF;
  delete env.GIT_DIFF_OPTS;
  return env;
}

export function gitExec(args, repoRoot = '.') {
  const absRoot = path.resolve(repoRoot);
  const res = spawnSync('git', ['-C', absRoot, '-c', 'core.quotepath=false', ...args], {
    cwd: absRoot,
    env: cleanGitEnv(),
    encoding: 'utf8',
    maxBuffer: GIT_MAX_BUFFER
  });
  return {
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    error: res.error || null
  };
}

export function gitOutput(args, repoRoot = '.') {
  const res = gitExec(args, repoRoot);
  if (res.error || res.status !== 0) return null;
  return res.stdout;
}

export function resolveGitCommonRepoRoot(repoRoot = '.') {
  const absRoot = path.resolve(repoRoot);
  try {
    const dotGit = path.join(absRoot, '.git');
    if (fs.lstatSync(dotGit).isDirectory() && !fileExists(path.join(dotGit, 'commondir'))) return absRoot;
  } catch {}
  const commonRaw = (gitOutput(['rev-parse', '--git-common-dir'], absRoot) || '').trim();
  if (!commonRaw) return absRoot;
  const absCommon = path.resolve(absRoot, commonRaw);
  if (path.basename(absCommon) === '.git') {
    return path.dirname(absCommon);
  }
  return absRoot;
}

export function resolveGitHooksDir(repoRoot = '.') {
  const absRoot = path.resolve(repoRoot);
  const hooksRaw = (gitOutput(['rev-parse', '--git-path', 'hooks'], absRoot) || '').trim();
  if (hooksRaw) return path.resolve(absRoot, hooksRaw);
  return path.join(resolveGitCommonRepoRoot(absRoot), '.git', 'hooks');
}

function readGitRefsMap(repoRoot = '.') {
  const map = new Map();
  const out = gitOutput(['show-ref', '--head'], repoRoot) || '';
  for (const line of out.split('\n')) {
    const idx = line.indexOf(' ');
    if (idx > 0) map.set(line.slice(idx + 1).trim(), line.slice(0, idx).trim());
  }
  return map;
}

export function getCurrentGitBranch(repoRoot = '.') {
  try {
    const dotGit = path.resolve(repoRoot, '.git');
    if (fs.lstatSync(dotGit).isDirectory()) {
      const headRaw = (readFileSafe(path.join(dotGit, 'HEAD')) || '').trim();
      if (headRaw.startsWith('ref: refs/heads/')) {
        const branch = headRaw.slice('ref: refs/heads/'.length).trim();
        if (branch) return branch;
      } else if (/^[0-9a-f]{40,64}$/i.test(headRaw)) {
        return 'HEAD';
      }
    }
  } catch {}
  return (
    gitOutput(['symbolic-ref', '-q', '--short', 'HEAD'], repoRoot) ||
    gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot) ||
    ''
  ).trim();
}

export function hasBranch(branchName, repoRoot = '.', refsMap = null) {
  const cleanBranch = String(branchName || '').trim();
  if (!cleanBranch) return false;
  const refs = refsMap || readGitRefsMap(repoRoot);
  if (refs.has(`refs/heads/${cleanBranch}`) || refs.has(`refs/remotes/origin/${cleanBranch}`)) return true;
  for (const ref of refs.keys()) {
    if (ref.startsWith('refs/remotes/')) {
      const rest = ref.slice('refs/remotes/'.length);
      const slash = rest.indexOf('/');
      if (slash > 0 && rest.slice(slash + 1) === cleanBranch) return true;
    }
  }
  return false;
}

export function hasDevelopBranch(repoRoot = '.') {
  return hasBranch('develop', repoRoot);
}

export function resolveDefaultBaseBranch(repoRoot = '.', refsMap = null) {
  const refs = refsMap || readGitRefsMap(repoRoot);
  if (hasBranch('develop', repoRoot, refs)) return 'develop';
  if (hasBranch('main', repoRoot, refs)) return 'main';
  if (refs.has('refs/remotes/origin/HEAD')) {
    const originHead = (gitOutput(['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'], repoRoot) || '').trim();
    if (originHead.startsWith('origin/')) {
      const target = originHead.slice('origin/'.length).trim();
      if (target) return target;
    }
  }
  if (hasBranch('master', repoRoot, refs)) return 'master';
  return 'main';
}

export function resolveEffectiveDiffBase(baseBranch = null, repoRoot = '.', refsMap = null) {
  if (baseBranch && String(baseBranch).trim()) return String(baseBranch).trim();
  if (process.env.GITHUB_BASE_REF && String(process.env.GITHUB_BASE_REF).trim()) {
    return String(process.env.GITHUB_BASE_REF).trim();
  }
  let curBranch = getCurrentGitBranch(repoRoot);
  if (curBranch === 'HEAD') {
    const ghRef = String(process.env.GITHUB_REF_NAME || '').trim() || String(process.env.GITHUB_REF || '').replace(/^refs\/heads\//, '').trim();
    if (ghRef && !ghRef.startsWith('refs/')) curBranch = ghRef;
  }
  const refs = refsMap || readGitRefsMap(repoRoot);
  if (curBranch === 'develop' && hasBranch('main', repoRoot, refs)) return 'main';
  if ((curBranch === 'main' || curBranch === 'master') && hasBranch(curBranch, repoRoot, refs)) return curBranch;
  return resolveDefaultBaseBranch(repoRoot, refs);
}

export function resolveDiffComparisonState(baseBranch = null, repoRoot = '.', { includePushFallback = true } = {}) {
  const refs = readGitRefsMap(repoRoot);
  const effectiveBase = resolveEffectiveDiffBase(baseBranch, repoRoot, refs);
  const headSha = refs.get('HEAD') || '';
  if (!headSha) return { effectiveBase, headSha: null, mergeBase: null, committedRange: null };
  const curBranch = getCurrentGitBranch(repoRoot);
  for (const candidate of [`origin/${effectiveBase}`, effectiveBase]) {
    let refSha = refs.get(`refs/remotes/${candidate}`) || refs.get(`refs/heads/${candidate}`) || '';
    if (!refSha && !candidate.startsWith('origin/')) {
      refSha = (gitOutput(['rev-parse', '--verify', '--end-of-options', `${candidate}^{commit}`], repoRoot) || '').trim();
    }
    if (!refSha) continue;
    const isPushOnBase = refSha === headSha && (curBranch === effectiveBase || (curBranch === 'HEAD' && !process.env.GITHUB_BASE_REF));
    if (isPushOnBase) {
      if (!includePushFallback) return { effectiveBase, headSha, mergeBase: headSha, committedRange: null };
      const parentSha = (gitOutput(['rev-parse', '--verify', 'HEAD~1^{commit}'], repoRoot) || '').trim();
      if (parentSha) return { effectiveBase, headSha, mergeBase: parentSha, committedRange: 'HEAD~1..HEAD' };
      return { effectiveBase, headSha, mergeBase: EMPTY_TREE_SHA, committedRange: `${EMPTY_TREE_SHA}..HEAD` };
    }
    const mb = refSha === headSha ? headSha : (gitOutput(['merge-base', '--end-of-options', candidate, 'HEAD'], repoRoot) || '').trim() || refSha;
    return { effectiveBase, headSha, mergeBase: mb, committedRange: `${candidate}...HEAD` };
  }
  if (!includePushFallback) return { effectiveBase, headSha, mergeBase: headSha, committedRange: null };
  const parentSha = (gitOutput(['rev-parse', '--verify', 'HEAD~1^{commit}'], repoRoot) || '').trim();
  if (parentSha) return { effectiveBase, headSha, mergeBase: parentSha, committedRange: 'HEAD~1..HEAD' };
  return { effectiveBase, headSha, mergeBase: EMPTY_TREE_SHA, committedRange: `${EMPTY_TREE_SHA}..HEAD` };
}

export function unquoteGitPath(raw) {
  const trimmed = String(raw || '').trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed
      .slice(1, -1)
      .replace(/\\(["\\tnr])/g, (_, ch) => {
        if (ch === 't') return '\t';
        if (ch === 'n') return '\n';
        if (ch === 'r') return '\r';
        return ch;
      });
  }
  return trimmed;
}

function readBoundedSyntheticDiff(file, repoRoot, withHunkHeader = false, { strict = false, preferIndex = false } = {}) {
  if (!file || TRUE_BINARY_EXT_RE.test(file)) return '';
  try {
    let rawBuf = null;
    if (preferIndex) {
      const idxRes = gitExec(['show', `:${file}`], repoRoot);
      if (!idxRes.error && idxRes.status === 0 && idxRes.stdout !== undefined) {
        rawBuf = Buffer.from(idxRes.stdout, 'utf8');
      }
    }
    if (!rawBuf) {
      const abs = resolveInsideRepo(repoRoot, file);
      const stat = fs.statSync(abs);
      if (!stat.isFile()) return '';
      if (stat.size > MAX_SYNTHETIC_DIFF_BYTES) {
        if (strict) throw new Error(`File '${file}' exceeds ${MAX_SYNTHETIC_DIFF_BYTES} bytes for secret scan.`);
        return '';
      }
      rawBuf = fs.readFileSync(abs);
    }
    const raw = rawBuf.toString('utf8').replace(/\0/g, '').replace(/\r\n/g, '\n');
    const lines = raw.split('\n');
    const plusBody = lines.map((l) => `+${l}`).join('\n');
    if (withHunkHeader) {
      return `--- a/${file}\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${plusBody}`;
    }
    return `+++ b/${file}\n${plusBody}`;
  } catch (err) {
    if (strict && err?.code !== 'ENOENT') throw err;
    return '';
  }
}

function expandBinaryTextDiffSection(section, file, repoRoot, { strict = false, preferIndex = false } = {}) {
  if (!section || !/^Binary files .* differ$/m.test(section) || TRUE_BINARY_EXT_RE.test(file)) {
    return section;
  }
  const synth = readBoundedSyntheticDiff(file, repoRoot, true, { strict, preferIndex });
  return synth ? `${section}\n${synth}` : section;
}

export const SAFE_DIFF_FLAGS = Object.freeze(['--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--src-prefix=a/', '--dst-prefix=b/']);

export function getModifiedFiles(baseBranch = null, repoRoot = '.') {
  const { headSha, mergeBase } = resolveDiffComparisonState(baseBranch, repoRoot);
  const files = new Set();
  const collect = (out) => {
    if (!out) return;
    for (const rawLine of out.replace(/\r\n/g, '\n').split('\n')) {
      const clean = unquoteGitPath(rawLine).replace(/\\/g, '/').replace(/^\.\//, '');
      if (clean) files.add(clean);
    }
  };

  if (mergeBase) {
    collect(gitOutput(['diff', '--name-only', '--no-renames', '--diff-filter=ACMRTUXBD', '--end-of-options', mergeBase], repoRoot));
    collect(gitOutput(['diff', '--cached', '--name-only', '--no-renames', '--diff-filter=ACMRTUXBD', '--end-of-options', mergeBase], repoRoot));
  } else if (headSha) {
    collect(gitOutput(['diff', '--name-only', '--no-renames', '--diff-filter=ACMRTUXBD', 'HEAD'], repoRoot));
    collect(gitOutput(['diff', '--cached', '--name-only', '--no-renames', '--diff-filter=ACMRTUXBD'], repoRoot));
  } else {
    collect(gitOutput(['diff', '--cached', '--name-only', '--no-renames', '--diff-filter=ACMRTUXBD'], repoRoot));
    collect(gitOutput(['diff', '--name-only', '--no-renames', '--diff-filter=ACMRTUXBD'], repoRoot));
  }
  collect(gitOutput(['ls-files', '--others', '--exclude-standard'], repoRoot));
  return [...files].sort();
}

function appendUnifiedDiffChunks(rawDiff, map, repoRoot = '.', onlyIfMissing = false, opts = {}) {
  if (!rawDiff) return;
  const normalized = String(rawDiff).replace(/\r\n/g, '\n');
  const sections = normalized.split(/(?=^diff --git )/m);
  for (const section of sections) {
    if (!section.startsWith('diff --git ')) continue;
    const headerEnd = section.indexOf('\n');
    const header = headerEnd === -1 ? section : section.slice(0, headerEnd);
    const plusMatch = section.match(/^\+\+\+ (?:"b\/(.+?)"|b\/(.+))$/m);
    const pairMatch = header.match(/^diff --git (?:"a\/(.+?)"|a\/(.+?)) (?:"b\/(.+?)"|b\/(.+))$/);
    let cleanPath = null;
    if (plusMatch) {
      cleanPath = plusMatch[1] ? unquoteGitPath(`"${plusMatch[1]}"`) : plusMatch[2].trim();
    } else if (pairMatch) {
      const rawB = pairMatch[3] ? `"${pairMatch[3]}"` : pairMatch[4] || (pairMatch[1] ? `"${pairMatch[1]}"` : pairMatch[2]);
      cleanPath = unquoteGitPath(rawB);
    }
    if (!cleanPath) continue;
    cleanPath = cleanPath.replace(/\\/g, '/').replace(/^\.\//, '');
    if (onlyIfMissing && map.has(cleanPath)) continue;
    const expanded = expandBinaryTextDiffSection(section, cleanPath, repoRoot, opts);
    const prev = map.get(cleanPath);
    map.set(cleanPath, prev ? `${prev}\n${expanded}` : expanded);
  }
}

export function getUnifiedDiffByFile(baseBranch = null, repoRoot = '.', files = null, { strict = false } = {}) {
  const diffMap = new Map();
  if (Array.isArray(files) && files.length === 0) return diffMap;
  const { headSha, mergeBase } = resolveDiffComparisonState(baseBranch, repoRoot);
  const pathArgs = Array.isArray(files) && files.length > 0 && files.length <= 200 ? ['--', ...files.map((f) => `:(literal)${f}`)] : ['--'];
  const gitDiffStrict = (args) => {
    const out = gitOutput(args, repoRoot);
    if (out === null && strict) throw new Error(`git ${args.slice(0, 2).join(' ')} failed.`);
    return out;
  };

  if (mergeBase) {
    const unified = gitDiffStrict(['diff', ...SAFE_DIFF_FLAGS, mergeBase, ...pathArgs]);
    if (unified !== null) {
      appendUnifiedDiffChunks(unified, diffMap, repoRoot, false, { strict, preferIndex: false });
    }
    const cachedOnly = gitDiffStrict(['diff', ...SAFE_DIFF_FLAGS, '--cached', mergeBase, ...pathArgs]);
    if (cachedOnly) {
      appendUnifiedDiffChunks(cachedOnly, diffMap, repoRoot, true, { strict, preferIndex: true });
    }
  } else {
    const workingDiff =
      (headSha ? gitDiffStrict(['diff', ...SAFE_DIFF_FLAGS, 'HEAD', ...pathArgs]) : null) ??
      gitDiffStrict(['diff', ...SAFE_DIFF_FLAGS, '--cached', ...pathArgs]) ??
      gitDiffStrict(['diff', ...SAFE_DIFF_FLAGS, ...pathArgs]) ??
      '';
    appendUnifiedDiffChunks(workingDiff, diffMap, repoRoot, false, { strict, preferIndex: false });
  }

  const untrackedOut = gitDiffStrict(['ls-files', '--others', '--exclude-standard']) || '';
  const untrackedList = untrackedOut
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((f) => unquoteGitPath(f).replace(/\\/g, '/').replace(/^\.\//, ''))
    .filter(Boolean);
  const targetFilter = Array.isArray(files) ? new Set(files.map((f) => f.replace(/\\/g, '/').replace(/^\.\//, ''))) : null;

  for (const uf of untrackedList) {
    if (targetFilter && !targetFilter.has(uf)) continue;
    if (!diffMap.has(uf)) {
      const synth = readBoundedSyntheticDiff(uf, repoRoot, true, { strict });
      if (synth) diffMap.set(uf, synth);
    }
  }
  return diffMap;
}

export function computeContentTreeSha(commitRef = 'HEAD', repoRoot = '.') {
  const ref = String(commitRef || 'HEAD').trim();
  if (!ref) return null;
  const lsOut = gitOutput(['ls-tree', '-r', '--full-tree', '--end-of-options', ref], repoRoot);
  if (lsOut === null) return null;
  const filtered = lsOut
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => {
      if (!line.trim()) return false;
      const tabIdx = line.indexOf('\t');
      if (tabIdx === -1) return true;
      const rel = unquoteGitPath(line.slice(tabIdx + 1)).replace(/\\/g, '/');
      return rel !== 'docs/AUDIT_CHAIN.jsonl';
    })
    .sort();
  return crypto.createHash('sha256').update(filtered.join('\n')).digest('hex');
}

const EXCLUDED_FROM_DOCS_ONLY_RE =
  /^(?:PRODUCT\.md|docs\/PRD\.md|docs\/SRS\.md|docs\/specs\/|docs\/adr\/|docs\/AUDIT_CHAIN\.jsonl)|(?:^|\/)(?:AGENTS\.md|CLAUDE\.md|llms\.txt|\.)/i;

const CONTRACT_OR_MANIFEST_RE =
  /(?:^|\/)(?:requirements[^/]*\.txt|constraints[^/]*\.txt|CMakeLists\.txt|package(?:-lock)?\.json|Cargo\.(?:toml|lock)|pyproject\.toml|go\.(?:mod|sum)|pom\.xml|build\.gradle(?:\.kts)?|[^/]*(?:openapi|swagger)[^/]*\.(?:ya?ml|json))$/i;

const PURE_DOC_ALLOW_RE =
  /(?:\.(?:md|mdx|rst|adoc)$|^(?:LICENSE|NOTICE|AUTHORS|CHANGELOG|CONTRIBUTING|SECURITY|CODE_OF_CONDUCT)(?:\.[A-Za-z0-9]+)?$|^(?:docs|media)\/.*\.(?:svg|png|jpe?g|webp|gif)$)/i;

export function isDocsOnlyFile(relPath = '') {
  const norm = String(relPath || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!norm) return false;
  if (EXCLUDED_FROM_DOCS_ONLY_RE.test(norm)) return false;
  if (CONTRACT_OR_MANIFEST_RE.test(norm)) return false;
  return PURE_DOC_ALLOW_RE.test(norm);
}

export function isDocsOnlyDiff(files = []) {
  if (!Array.isArray(files) || files.length === 0) return false;
  return files.every((f) => isDocsOnlyFile(f));
}

export function readTreeBlobMap(treeOrCommitRef, repoRoot = '.') {
  const ref = String(treeOrCommitRef || '').trim();
  if (!ref) return null;
  const out = gitOutput(['ls-tree', '-r', '--full-tree', '--end-of-options', ref], repoRoot);
  if (out === null) return null;
  const map = new Map();
  for (const line of out.replace(/\r\n/g, '\n').split('\n')) {
    if (!line.trim()) continue;
    const tabIdx = line.indexOf('\t');
    if (tabIdx === -1) continue;
    const meta = line.slice(0, tabIdx).trim();
    const rel = unquoteGitPath(line.slice(tabIdx + 1)).replace(/\\/g, '/');
    if (rel === 'docs/AUDIT_CHAIN.jsonl') continue;
    map.set(rel, meta);
  }
  return map;
}

export function verifyCleanThreeWayMergeTrees({ mbSha, p1Ref, p2Ref, targetRef, repoRoot = '.' } = {}) {
  if (!mbSha || !p1Ref || !p2Ref || !targetRef) return false;
  const mapMb = readTreeBlobMap(mbSha, repoRoot);
  const mapP1 = readTreeBlobMap(p1Ref, repoRoot);
  const mapP2 = readTreeBlobMap(p2Ref, repoRoot);
  const mapTarget = readTreeBlobMap(targetRef, repoRoot);
  if (!mapMb || !mapP1 || !mapP2 || !mapTarget) return false;

  const allFiles = new Set([...mapMb.keys(), ...mapP1.keys(), ...mapP2.keys(), ...mapTarget.keys()]);
  for (const f of allFiles) {
    const eMb = mapMb.get(f);
    const e1 = mapP1.get(f);
    const e2 = mapP2.get(f);
    const eT = mapTarget.get(f);
    if (e1 === e2) {
      if (eT !== e1) return false;
    } else if (e1 === eMb) {
      if (eT !== e2) return false;
    } else if (e2 === eMb) {
      if (eT !== e1) return false;
    } else {
      return false;
    }
  }
  return true;
}

export function hasDirtyNonGovernanceFiles(repoRoot = '.', { allowAuditChain = false } = {}) {
  const out = gitOutput(['status', '--porcelain', '--untracked-files=all'], repoRoot);
  if (out === null) return true;
  for (const line of out.replace(/\r\n/g, '\n').split('\n')) {
    if (!line.trim()) continue;
    const rawRel = line.slice(3).trim();
    const arrowIdx = rawRel.indexOf(' -> ');
    const targetRel = unquoteGitPath(arrowIdx !== -1 ? rawRel.slice(arrowIdx + 4) : rawRel).replace(/\\/g, '/');
    if (allowAuditChain && arrowIdx === -1 && targetRel === 'docs/AUDIT_CHAIN.jsonl') continue;
    return true;
  }
  return false;
}

export function parseFrontmatter(markdown = '') {
  const normalized = String(markdown || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.startsWith('---\n') && normalized !== '---') {
    return { frontmatter: {}, body: normalized };
  }
  const endIdx = normalized.indexOf('\n---', 3);
  if (endIdx === -1) return { frontmatter: {}, body: normalized };
  const rawYaml = normalized.slice(4, endIdx).trim();
  const body = normalized.slice(endIdx + 4).replace(/^\n/, '').trim();
  const frontmatter = {};
  for (const line of rawYaml.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    if (!key) continue;
    let val = line.slice(colonIdx + 1).trim();
    if ((val.startsWith("'") && val.endsWith("'") && val.length >= 2) || (val.startsWith('"') && val.endsWith('"') && val.length >= 2)) {
      val = val.slice(1, -1);
    }
    frontmatter[key] = val;
  }
  return { frontmatter, body };
}

export function computeAlignmentHashes(repoRoot = '.') {
  const specHasher = crypto.createHash('sha256');
  const specFiles = ['PRODUCT.md', 'docs/PRD.md', 'docs/SRS.md', '.archlens/policy.json'];
  const specsDir = path.resolve(repoRoot, 'docs/specs');
  if (fileExists(specsDir)) {
    for (const e of fs.readdirSync(specsDir).filter((f) => f.endsWith('.md')).sort()) {
      specFiles.push(`docs/specs/${e}`);
    }
  }
  for (const rel of specFiles) {
    const abs = path.resolve(repoRoot, rel);
    if (fileExists(abs)) {
      specHasher.update(`file:${rel}:${(readFileSafe(abs) || '').replace(/\r\n/g, '\n')}\n`);
    }
  }

  const adrHasher = crypto.createHash('sha256');
  const adrDir = path.resolve(repoRoot, 'docs/adr');
  if (fileExists(adrDir)) {
    for (const name of fs.readdirSync(adrDir).filter((n) => /^ADR-\d+.*\.md$/i.test(n)).sort()) {
      const raw = readFileSafe(path.join(adrDir, name));
      if (!raw) continue;
      const { frontmatter } = parseFrontmatter(raw);
      if (String(frontmatter.status || '').toLowerCase() !== 'accepted') continue;
      const idMatch = name.match(/^(ADR-\d+)/i);
      const id = (frontmatter.id || (idMatch ? idMatch[1] : name.replace(/\.md$/i, ''))).toUpperCase();
      const sha = crypto.createHash('sha256').update(raw.replace(/\r\n/g, '\n')).digest('hex');
      adrHasher.update(`${id}:${sha}\n`);
    }
  }
  return { specHash: specHasher.digest('hex'), adrHashes: adrHasher.digest('hex') };
}
