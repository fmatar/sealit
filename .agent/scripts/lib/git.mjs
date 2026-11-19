import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

export const GIT_MAX_BUFFER = 64 * 1024 * 1024;
export const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const EMPTY_BLOB_SHA = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
const MAX_SYNTHETIC_DIFF_BYTES = 16 * 1024 * 1024;

export const TRUE_BINARY_EXT_RE =
  /\.(?:png|jpe?g|gif|webp|ico|bmp|tiff?|avif|mp[34]|mov|avi|mkv|wav|ogg|flac|woff2?|ttf|otf|eot|pdf|zip|tar|gz|tgz|bz2|xz|7z|rar|wasm|pyc|class|jar|so|dylib|dll|exe|bin|sqlite3?|db)$/i;

export class ChangeSetParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ChangeSetParseError';
    this.code = 'CHANGESET_PARSE_ERROR';
  }
}

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

    if (ch === "'") { inSingle = true; hasToken = true; continue; }
    if (ch === '"') { inDouble = true; hasToken = true; continue; }
    if (';|&<>`\n\r'.includes(ch) || (ch === '$' && next === '(')) {
      throw new Error(`Refusing shell compound command in configuration ('${cmdSpec}'): specify a single executable command or argv array without shell operators.`);
    }
    if (ch === ' ' || ch === '\t') {
      if (hasToken) { tokens.push(current); current = ''; hasToken = false; }
      continue;
    }
    current += ch;
    hasToken = true;
  }
  if (inSingle || inDouble) throw new Error(`Unterminated quote in configured command ('${cmdSpec}').`);
  if (hasToken) tokens.push(current);
  if (tokens.length === 0 || !tokens[0]) throw new Error('Configured command resolved to empty executable.');
  return { file: tokens[0], args: tokens.slice(1) };
}

export function runConfiguredCommand(cmdSpec, options = {}) {
  const { file, args } = parseCommandArgv(cmdSpec);
  const childEnv = { ...(options.env || process.env) };
  if (!options.env) { delete childEnv.NODE_TEST_CONTEXT; delete childEnv.NODE_V8_COVERAGE; }
  return execFileSync(file, args, { maxBuffer: GIT_MAX_BUFFER, ...options, env: childEnv });
}

const STRIPPED_GIT_ENV_KEYS = [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_EXTERNAL_DIFF', 'GIT_DIFF_OPTS',
  'GIT_LITERAL_PATHSPECS', 'GIT_GLOB_PATHSPECS', 'GIT_NOGLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS'
];

export function cleanGitEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  for (const k of STRIPPED_GIT_ENV_KEYS) delete env[k];
  return env;
}

export function gitExecBuffer(args, repoRoot = '.', input = undefined) {
  const absRoot = path.resolve(repoRoot);
  const res = spawnSync('git', ['-C', absRoot, '-c', 'core.quotepath=false', ...args], {
    cwd: absRoot, env: cleanGitEnv(), input, maxBuffer: GIT_MAX_BUFFER
  });
  return {
    status: res.status,
    stdout: Buffer.isBuffer(res.stdout) ? res.stdout : Buffer.from(res.stdout || '', 'utf8'),
    stderr: Buffer.isBuffer(res.stderr) ? res.stderr.toString('utf8') : res.stderr || '',
    error: res.error || null
  };
}

export function gitExec(args, repoRoot = '.') {
  const res = gitExecBuffer(args, repoRoot);
  return { status: res.status, stdout: res.stdout.toString('utf8'), stderr: res.stderr, error: res.error };
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

export function resolveEffectiveDiffBase(baseBranch = null, repoRoot = '.', refsMap = null, curBranchOverride = null) {
  if (baseBranch && String(baseBranch).trim()) return String(baseBranch).trim();
  if (process.env.GITHUB_BASE_REF && String(process.env.GITHUB_BASE_REF).trim()) {
    return String(process.env.GITHUB_BASE_REF).trim();
  }
  let curBranch = curBranchOverride !== null ? String(curBranchOverride).trim() : getCurrentGitBranch(repoRoot);
  if (curBranch === 'HEAD') {
    const ghRef = String(process.env.GITHUB_REF_NAME || '').trim() || String(process.env.GITHUB_REF || '').replace(/^refs\/heads\//, '').trim();
    if (ghRef && !ghRef.startsWith('refs/')) curBranch = ghRef;
  }
  const refs = refsMap || readGitRefsMap(repoRoot);
  if (curBranch === 'develop' && hasBranch('main', repoRoot, refs)) return 'main';
  if ((curBranch === 'main' || curBranch === 'master') && hasBranch(curBranch, repoRoot, refs)) return curBranch;
  return resolveDefaultBaseBranch(repoRoot, refs);
}

export function resolveRange({ baseBranch = null, head = 'HEAD', branchHint = null, repoRoot = '.' } = {}) {
  const refs = readGitRefsMap(repoRoot);
  const curBranch = branchHint !== null ? String(branchHint).trim() : head === 'HEAD' ? getCurrentGitBranch(repoRoot) : '';
  const effectiveBase = resolveEffectiveDiffBase(baseBranch, repoRoot, refs, curBranch);
  const headSha =
    head === 'HEAD'
      ? refs.get('HEAD') || (gitOutput(['rev-parse', '--verify', '-q', 'HEAD^{commit}'], repoRoot) || '').trim() || null
      : (gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', `${head}^{commit}`], repoRoot) || '').trim() || null;
  if (!headSha) return { effectiveBase, baseSha: EMPTY_TREE_SHA, headSha: null };
  for (const candidate of [`origin/${effectiveBase}`, effectiveBase]) {
    let refSha = refs.get(`refs/remotes/${candidate}`) || refs.get(`refs/heads/${candidate}`) || '';
    if (!refSha && !candidate.startsWith('origin/')) {
      refSha = (gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', `${candidate}^{commit}`], repoRoot) || '').trim();
    }
    if (!refSha) continue;
    const isPushOnBase = refSha === headSha && head === 'HEAD' && (curBranch === effectiveBase || (curBranch === 'HEAD' && !process.env.GITHUB_BASE_REF));
    if (isPushOnBase) {
      const parentSha = (gitOutput(['rev-parse', '--verify', '-q', `${headSha}~1^{commit}`], repoRoot) || '').trim();
      return { effectiveBase, baseSha: parentSha || EMPTY_TREE_SHA, headSha };
    }
    if (refSha === headSha) return { effectiveBase, baseSha: headSha, headSha };
    const mb = (gitOutput(['merge-base', '--end-of-options', refSha, headSha], repoRoot) || '').trim();
    return { effectiveBase, baseSha: mb || EMPTY_TREE_SHA, headSha };
  }
  const parentSha = (gitOutput(['rev-parse', '--verify', '-q', `${headSha}~1^{commit}`], repoRoot) || '').trim();
  return { effectiveBase, baseSha: parentSha || EMPTY_TREE_SHA, headSha };
}

export function unquoteGitPath(raw) {
  const trimmed = String(raw || '').trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed
      .slice(1, -1)
      .replace(/\\(["\\tnr])/g, (_, ch) => (ch === 't' ? '\t' : ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch));
  }
  return trimmed;
}

export function readBlobs(specs = [], repoRoot = '.') {
  const out = new Map();
  if (!Array.isArray(specs) || specs.length === 0) return out;
  const uniqueValid = [...new Set(specs.filter((s) => typeof s === 'string' && s && !s.includes('\n') && !s.includes('\0')))];
  for (const s of specs) out.set(s, null);
  if (uniqueValid.length === 0) return out;
  const res = gitExecBuffer(['cat-file', '--batch'], repoRoot, Buffer.from(`${uniqueValid.join('\n')}\n`, 'utf8'));
  if (res.error || res.status !== 0) throw new Error(`git cat-file --batch failed: ${res.stderr || res.error?.message}`);
  const buf = res.stdout;
  let pos = 0;
  for (const spec of uniqueValid) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl === -1) break;
    const hdr = buf.subarray(pos, nl).toString('utf8');
    pos = nl + 1;
    if (hdr.endsWith(' missing') || /^[0-9a-f]{40,64}\s+submodule$/i.test(hdr)) continue;
    const m = hdr.match(/^([0-9a-f]{40,64})\s+(\S+)\s+(\d+)$/i);
    if (!m) throw new Error(`Malformed cat-file --batch header: ${hdr}`);
    const size = Number(m[3]);
    const body = buf.subarray(pos, pos + size);
    pos += size + 1;
    if (m[2] === 'blob') out.set(spec, body.toString('utf8'));
  }
  return out;
}

export function listTree(sha, prefix = '', repoRoot = '.') {
  const cleanSha = String(sha || '').trim();
  if (!cleanSha) return [];
  const res = gitExecBuffer(['ls-tree', '-r', '-z', '--name-only', '--full-tree', '--end-of-options', cleanSha], repoRoot);
  if (res.error || res.status !== 0) return [];
  const normPrefix = String(prefix || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  return res.stdout
    .toString('utf8')
    .split('\0')
    .filter((p) => p && (!normPrefix || p === normPrefix || p.startsWith(`${normPrefix}/`)))
    .sort();
}

function parsePatchSections(rawDiff, knownPaths) {
  const patches = new Map();
  if (!rawDiff) return patches;
  for (const section of String(rawDiff).replace(/\r\n/g, '\n').split(/(?=^diff --git )/m)) {
    if (!section.startsWith('diff --git ')) continue;
    const nl = section.indexOf('\n');
    const hdr = nl === -1 ? section : section.slice(0, nl);
    const plusMatch = section.match(/^\+\+\+ (?:"b\/(.+?)"|b\/(.+))$/m);
    const renMatch = !plusMatch ? section.match(/^rename to (.+)$/m) : null;
    let cleanPath = null;
    if (plusMatch) cleanPath = plusMatch[1] ? unquoteGitPath(`"${plusMatch[1]}"`) : plusMatch[2].trim();
    else if (renMatch) cleanPath = unquoteGitPath(renMatch[1]);
    else {
      for (const kp of knownPaths) {
        if (hdr === `diff --git a/${kp} b/${kp}`) { cleanPath = kp; break; }
      }
      if (!cleanPath) {
        const q = hdr.match(/ "b\/((?:\\.|[^"\\])+)"$/);
        if (q) cleanPath = unquoteGitPath(`"${q[1]}"`);
      }
    }
    if (!cleanPath) continue;
    cleanPath = cleanPath.replace(/\\/g, '/').replace(/^\.\//, '');
    const prev = patches.get(cleanPath);
    patches.set(cleanPath, prev ? `${prev}\n${section}` : section);
  }
  return patches;
}

function synthesizeUntrackedPatch(relFile, absFile) {
  if (TRUE_BINARY_EXT_RE.test(relFile)) return `diff --git a/${relFile} b/${relFile}\nBinary files /dev/null and b/${relFile} differ`;
  const st = fs.lstatSync(absFile);
  if (st.isSymbolicLink()) return `diff --git a/${relFile} b/${relFile}\nnew file mode 120000\n--- /dev/null\n+++ b/${relFile}\n@@ -0,0 +1 @@\n+${fs.readlinkSync(absFile)}`;
  if (!st.isFile() || st.size === 0) return `diff --git a/${relFile} b/${relFile}\nnew file mode 100644`;
  if (st.size > MAX_SYNTHETIC_DIFF_BYTES) throw new ChangeSetParseError(`File '${relFile}' exceeds ${MAX_SYNTHETIC_DIFF_BYTES} bytes.`);
  const rawBuf = fs.readFileSync(absFile);
  if (rawBuf.includes(0)) return `diff --git a/${relFile} b/${relFile}\nBinary files /dev/null and b/${relFile} differ`;
  const lines = rawBuf.toString('utf8').replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  return `diff --git a/${relFile} b/${relFile}\n--- /dev/null\n+++ b/${relFile}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}`;
}

export function readChangeSet({ baseSha, headSha = null, source = 'commit', repoRoot = '.', _rawPatchOverride = undefined } = {}) {
  const effBase = String(baseSha || EMPTY_TREE_SHA).trim();
  if (source !== 'commit' && source !== 'worktree') throw new ChangeSetParseError(`Invalid ChangeSet source '${source}'.`);
  if (source === 'commit') {
    const effHead = String(headSha || '').trim();
    if (!effHead || effBase === effHead) return { source, baseSha: effBase, headSha: effHead || null, paths: [], entries: [], patches: new Map() };
    const rawRes = gitExecBuffer(['diff-tree', '-r', '-z', '--raw', '--no-renames', '--end-of-options', effBase, effHead], repoRoot);
    if (rawRes.error || rawRes.status !== 0) throw new ChangeSetParseError(`diff-tree --raw failed: ${rawRes.stderr}`);
    const patchRes = _rawPatchOverride !== undefined ? { status: 0, stdout: Buffer.from(_rawPatchOverride, 'utf8'), stderr: '', error: null } : gitExecBuffer(['diff-tree', '-r', '-p', '-U0', '-M', '--no-ext-diff', '--no-textconv', '--end-of-options', effBase, effHead], repoRoot);
    if (patchRes.error || patchRes.status !== 0) throw new ChangeSetParseError(`diff-tree -p failed: ${patchRes.stderr}`);
    return buildChangeSetFromPlumbing(source, effBase, effHead, rawRes.stdout.toString('utf8'), patchRes.stdout.toString('utf8'), repoRoot);
  }
  const rawRes = gitExecBuffer(['diff-index', '-z', '--raw', '--no-renames', '--end-of-options', effBase], repoRoot);
  if (rawRes.error || rawRes.status !== 0) throw new ChangeSetParseError(`diff-index --raw failed: ${rawRes.stderr}`);
  const patchRes = _rawPatchOverride !== undefined ? { status: 0, stdout: Buffer.from(_rawPatchOverride, 'utf8'), stderr: '', error: null } : gitExecBuffer(['diff-index', '-p', '-U0', '-M', '--no-ext-diff', '--no-textconv', '--end-of-options', effBase], repoRoot);
  if (patchRes.error || patchRes.status !== 0) throw new ChangeSetParseError(`diff-index -p failed: ${patchRes.stderr}`);
  return buildChangeSetFromPlumbing(source, effBase, headSha, rawRes.stdout.toString('utf8'), patchRes.stdout.toString('utf8'), repoRoot);
}

function buildChangeSetFromPlumbing(source, baseSha, headSha, rawText, patchText, repoRoot) {
  const tokens = rawText ? rawText.split('\0') : [];
  let entries = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    if (!tokens[i]) continue;
    const m = tokens[i].match(/^:(\d{6}) (\d{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([A-Z])\d*$/i);
    if (!m) throw new ChangeSetParseError(`Malformed raw diff header: ${tokens[i]}`);
    entries.push({ path: tokens[i + 1].replace(/\\/g, '/'), status: m[5].toUpperCase(), oldMode: m[1], newMode: m[2], oldOid: m[3], newOid: m[4] });
  }
  const patches = parsePatchSections(patchText, new Set(entries.map((e) => e.path)));
  if (source === 'worktree') {
    entries = entries.filter((e) => {
      if (e.status !== 'M' || !/^0+$/.test(e.newOid) || e.oldMode !== e.newMode || patches.has(e.path)) return true;
      try {
        const buf = fs.readFileSync(path.resolve(repoRoot, e.path));
        return crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex') !== e.oldOid;
      } catch {
        return true;
      }
    });
    const seen = new Set(entries.map((e) => e.path));
    const cachedRaw = gitExecBuffer(['diff-index', '--cached', '-z', '--raw', '--no-renames', '--end-of-options', baseSha], repoRoot);
    if (!cachedRaw.error && cachedRaw.status === 0 && cachedRaw.stdout.length > 0) {
      const cToks = cachedRaw.stdout.toString('utf8').split('\0');
      const cachedMissing = [];
      for (let i = 0; i + 1 < cToks.length; i += 2) {
        if (!cToks[i] || seen.has(cToks[i + 1].replace(/\\/g, '/'))) continue;
        const m = cToks[i].match(/^:(\d{6}) (\d{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([A-Z])\d*$/i);
        if (m) cachedMissing.push({ path: cToks[i + 1].replace(/\\/g, '/'), status: m[5].toUpperCase(), oldMode: m[1], newMode: m[2], oldOid: m[3], newOid: m[4] });
      }
      if (cachedMissing.length > 0) {
        const cachedPatch = gitExecBuffer(['diff-index', '--cached', '-p', '-U0', '-M', '--no-ext-diff', '--no-textconv', '--end-of-options', baseSha], repoRoot);
        const cPatches = parsePatchSections(cachedPatch.stdout.toString('utf8'), new Set(cachedMissing.map((e) => e.path)));
        for (const ce of cachedMissing) {
          seen.add(ce.path);
          entries.push(ce);
          if (cPatches.has(ce.path)) patches.set(ce.path, cPatches.get(ce.path));
        }
      }
    }
    const untrackedRes = gitExecBuffer(['ls-files', '-z', '--others', '--exclude-standard'], repoRoot);
    for (const uf of (untrackedRes.error || untrackedRes.status !== 0 ? '' : untrackedRes.stdout.toString('utf8')).split('\0').filter(Boolean)) {
      const norm = uf.replace(/\\/g, '/');
      if (seen.has(norm)) continue;
      const abs = path.resolve(repoRoot, norm);
      if (!fileExists(abs)) continue;
      const st = fs.lstatSync(abs);
      const newMode = st.isSymbolicLink() ? '120000' : st.mode & 0o111 ? '100755' : '100644';
      entries.push({ path: norm, status: 'A', oldMode: '000000', newMode, oldOid: '0'.repeat(40), newOid: '0'.repeat(40) });
      patches.set(norm, synthesizeUntrackedPatch(norm, abs));
    }
  }
  for (const e of entries) {
    if (e.status === 'D' || (!/^0+$/.test(e.oldOid) && e.oldOid === e.newOid && e.oldMode !== e.newMode)) continue;
    if (e.newMode === '160000' || TRUE_BINARY_EXT_RE.test(e.path) || e.newOid === EMPTY_BLOB_SHA) continue;
    if (!patches.has(e.path)) throw new ChangeSetParseError(`Missing patch section for changed entry '${e.path}'.`);
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const paths = [...new Set(entries.map((e) => e.path))].sort();
  return { source, baseSha, headSha, paths, entries, patches };
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

export function isDocsOnlyDiff(filesOrChangeSet = []) {
  if (filesOrChangeSet && !Array.isArray(filesOrChangeSet) && Array.isArray(filesOrChangeSet.entries)) {
    const entries = filesOrChangeSet.entries;
    if (entries.length === 0) return false;
    return entries.every(
      (e) =>
        (e.oldMode === '000000' || e.oldMode === '100644') &&
        (e.newMode === '000000' || e.newMode === '100644') &&
        isDocsOnlyFile(e.path)
    );
  }
  if (!Array.isArray(filesOrChangeSet) || filesOrChangeSet.length === 0) return false;
  return filesOrChangeSet.every((f) => isDocsOnlyFile(f));
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
    if (!Object.prototype.hasOwnProperty.call(frontmatter, key)) frontmatter[key] = val; // first key wins (as decideADR rewrites the first)
  }
  return { frontmatter, body };
}

export const ADR_PATH_RE = /^docs\/adr\/(?:ADR-\d+[^/]*|\d+-[^/]+)\.md$/i;

export function normalizeCanonicalAdrId(raw, fallback = '') {
  const s = String(raw || '').trim();
  const m = s.match(/^(?:ADR-)?(\d+)$/i);
  if (m) return `ADR-${String(Number(m[1])).padStart(3, '0')}`;
  return (s || fallback).toUpperCase();
}

export function parseAdrFilenameId(relOrBase = '') {
  const baseName = path.posix.basename(String(relOrBase || '').replace(/\\/g, '/'));
  const sdlcMatch = baseName.match(/^ADR-(\d+)/i);
  if (sdlcMatch) return { id: normalizeCanonicalAdrId(sdlcMatch[1]), num: Number(sdlcMatch[1]), isMadr: false };
  const madrMatch = baseName.match(/^(\d+)-[^/]+\.md$/i);
  if (madrMatch) return { id: normalizeCanonicalAdrId(madrMatch[1]), num: Number(madrMatch[1]), isMadr: true };
  return { id: baseName.replace(/\.md$/i, '').toUpperCase(), num: null, isMadr: false };
}

export function computeAlignmentHashes(arg = '.') {
  const { sha = 'HEAD', repoRoot = '.' } = typeof arg === 'string' ? { repoRoot: arg } : arg || {};
  const specHasher = crypto.createHash('sha256');
  const adrHasher = crypto.createHash('sha256');
  const commitSha = (gitOutput(['rev-parse', '--verify', '-q', '--end-of-options', `${sha}^{commit}`], repoRoot) || '').trim();
  if (!commitSha) return { specHash: specHasher.digest('hex'), adrHashes: adrHasher.digest('hex') };

  const specFiles = [
    'PRODUCT.md', 'docs/PRD.md', 'docs/SRS.md', '.archlens/policy.json',
    ...listTree(commitSha, 'docs/specs', repoRoot).filter((f) => /^docs\/specs\/[^/]+\.md$/.test(f))
  ];
  const adrFiles = listTree(commitSha, 'docs/adr', repoRoot).filter((f) => ADR_PATH_RE.test(f));
  const blobs = readBlobs([...specFiles, ...adrFiles].map((f) => `${commitSha}:${f}`), repoRoot);

  for (const rel of specFiles) {
    const raw = blobs.get(`${commitSha}:${rel}`);
    if (raw !== null && raw !== undefined) specHasher.update(`file:${rel}:${raw.replace(/\r\n/g, '\n')}\n`);
  }
  for (const rel of adrFiles) {
    const raw = blobs.get(`${commitSha}:${rel}`);
    if (!raw) continue;
    const { frontmatter } = parseFrontmatter(raw);
    if (String(frontmatter.status || '').toLowerCase() !== 'accepted') continue;
    const id = normalizeCanonicalAdrId(frontmatter.id, parseAdrFilenameId(rel).id);
    const digest = crypto.createHash('sha256').update(raw.replace(/\r\n/g, '\n')).digest('hex');
    adrHasher.update(`${id}:${digest}\n`);
  }
  return { specHash: specHasher.digest('hex'), adrHashes: adrHasher.digest('hex') };
}
