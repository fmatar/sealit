import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeContentTreeSha,
  fileExists,
  getCurrentGitBranch,
  hasDirtyNonGovernanceFiles,
  normalizeTicketId,
  resolveGitCommonRepoRoot,
  resolveRange,
  withFileLock,
  writeFileAtomic
} from './git.mjs';

const DEFAULT_SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function stablePolicyJson(val) {
  if (val === null || val === undefined || typeof val !== 'object') return JSON.stringify(val ?? null);
  if (Array.isArray(val)) return `[${val.map(stablePolicyJson).join(',')}]`;
  return `{${Object.keys(val).sort().map((k) => `${JSON.stringify(k)}:${stablePolicyJson(val[k])}`).join(',')}}`;
}

export function computeKernelDigest(scriptsDir = null) {
  const baseDir = path.resolve(scriptsDir || DEFAULT_SCRIPTS_DIR);
  const hash = crypto.createHash('sha256');
  const collect = (dir, prefix = '') => {
    if (!fileExists(dir)) return [];
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...collect(full, rel));
      else if (entry.isFile() && /\.[cm]?js$/i.test(entry.name)) out.push([rel, full]);
    }
    return out;
  };
  const files = collect(baseDir).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [rel, full] of files) {
    hash.update(`file:${rel}\0`);
    hash.update(fs.readFileSync(full));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function resolveSessionPaths(repoRoot = '.') {
  const commonRoot = resolveGitCommonRepoRoot(repoRoot);
  return {
    sessionPath: path.join(commonRoot, '.agent', '.sealit-session.json'),
    lockPath: path.join(commonRoot, '.agent', '.sealit-session.lock')
  };
}

export function readSessionStore(repoRoot = '.') {
  const { sessionPath } = resolveSessionPaths(repoRoot);
  if (!fileExists(sessionPath)) {
    return { activeSessionId: null, sessions: {} };
  }
  const raw = fs.readFileSync(sessionPath, 'utf8').trim();
  if (!raw) return { activeSessionId: null, sessions: {} };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const corruptErr = new Error(`Corrupted session store at '${sessionPath}': ${err.message}`);
    corruptErr.code = 'SESSION_CORRUPT';
    throw corruptErr;
  }
  if (parsed && typeof parsed === 'object' && parsed.sessions && typeof parsed.sessions === 'object') {
    return {
      activeSessionId: parsed.activeSessionId !== undefined && parsed.activeSessionId !== null ? String(parsed.activeSessionId) : null,
      sessions: parsed.sessions
    };
  }
  if (parsed && typeof parsed === 'object' && parsed.issueId !== undefined) {
    const id = String(normalizeTicketId(parsed.issueId) || parsed.issueId);
    return {
      activeSessionId: id,
      sessions: { [id]: parsed }
    };
  }
  return { activeSessionId: null, sessions: {} };
}

export function readActiveSession(repoRoot = '.', targetBranch = null) {
  const store = readSessionStore(repoRoot);
  const branch = targetBranch || getCurrentGitBranch(repoRoot);
  const entries = Object.values(store.sessions || {});
  if (branch) {
    const byBranch = entries.filter((s) => s && s.active !== false && s.branch === branch);
    if (byBranch.length > 0) {
      const preferred = byBranch.find((s) => String(normalizeTicketId(s.issueId) || s.issueId) === store.activeSessionId);
      return preferred || byBranch[byBranch.length - 1];
    }
  }
  if (store.activeSessionId && store.sessions[store.activeSessionId] && store.sessions[store.activeSessionId].active !== false) {
    if (!branch) return store.sessions[store.activeSessionId];
  }
  return null;
}

export function writeActiveSession(repoRoot, updater) {
  const { sessionPath, lockPath } = resolveSessionPaths(repoRoot);
  return withFileLock(lockPath, () => {
    const current = readSessionStore(repoRoot);
    const updated = updater(structuredClone(current)) || current;
    writeFileAtomic(sessionPath, JSON.stringify(updated, null, 2) + '\n', 0o600);
    return updated;
  });
}

export function computeTreeHash({
  repoRoot = '.',
  modulePath = '.',
  checkType = '',
  baseBranch = null,
  modulePolicy = null,
  precomputed = null,
  kernelDir = null
} = {}) {
  const absRoot = path.resolve(repoRoot);
  const hash = crypto.createHash('sha256');
  const kernelDigest = computeKernelDigest(kernelDir);
  const policySig = modulePolicy ? stablePolicyJson(modulePolicy) : '';
  hash.update(`kernel:${kernelDigest}\nmodule:${modulePath}\nnode:${process.version}\ncheckType:${checkType}\nbase:${baseBranch || ''}\npolicy:${policySig}\n`);

  const range = precomputed?.range || resolveRange({ baseBranch, head: 'HEAD', repoRoot: absRoot });
  const dirty = precomputed?.cleanTree === true ? false : hasDirtyNonGovernanceFiles(absRoot, { allowAuditChain: true });
  if (!range.headSha || dirty) {
    return { hash: hash.digest('hex'), cacheable: false };
  }
  const treeSha = precomputed?.treeSha || computeContentTreeSha(range.headSha, absRoot);
  if (!treeSha) return { hash: hash.digest('hex'), cacheable: false };
  hash.update(`head:${range.headSha}\nmb:${range.baseSha}\ntree:${treeSha}\n`);
  return { hash: hash.digest('hex'), cacheable: true };
}

function resolveGateCachePaths(repoRoot = '.') {
  const cacheDir = path.join(resolveGitCommonRepoRoot(repoRoot), '.agent', '.cache');
  return {
    cachePath: path.join(cacheDir, 'gate-cache.json'),
    lockPath: path.join(cacheDir, '.gate-cache.lock')
  };
}

export function readGateCache(repoRoot = '.', moduleName = 'root', treeHash = '') {
  if (!treeHash) return null;
  const { cachePath } = resolveGateCachePaths(repoRoot);
  if (!fileExists(cachePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return parsed?.entries?.[`${moduleName}:${treeHash}`] ?? null;
  } catch {
    return null;
  }
}

export function writeGateCache(repoRoot = '.', moduleName = 'root', treeHash = '', value = {}) {
  if (!treeHash) return;
  const { cachePath, lockPath } = resolveGateCachePaths(repoRoot);
  withFileLock(lockPath, () => {
    let existing = { entries: {} };
    if (fileExists(cachePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        if (parsed && typeof parsed === 'object' && parsed.entries && typeof parsed.entries === 'object') {
          existing = parsed;
        }
      } catch {
        existing = { entries: {} };
      }
    }
    existing.entries[`${moduleName}:${treeHash}`] = {
      ...value,
      cachedAt: new Date().toISOString()
    };
    writeFileAtomic(cachePath, JSON.stringify(existing, null, 2) + '\n');
  });
}
