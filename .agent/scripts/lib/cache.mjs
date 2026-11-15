import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cleanGitEnv, fileExists, readFileSafe, writeFileAtomic } from './core.mjs';

const CACHE_REL_PATH = '.agent/.cache/gate-cache.json';

export function getGateCachePath(repoRoot = '.') {
  return path.resolve(repoRoot, CACHE_REL_PATH);
}

/**
 * Computes a deterministic SHA-256 hash representing the exact state of files
 * in a module (both git HEAD commit and any uncommitted modifications/untracked files)
 * as well as governance config (`.agent/sdlc-config.json`, `.archlens/policy.json`).
 */
export function computeTreeHash(repoRoot = '.', modulePath = '.') {
  const absRoot = path.resolve(repoRoot);
  const absMod = path.resolve(absRoot, modulePath);
  const hash = crypto.createHash('sha256');
  hash.update(`module:${modulePath}\n`);

  for (const cfgRel of ['.agent/sdlc-config.json', '.archlens/policy.json']) {
    const cfgAbs = path.resolve(absRoot, cfgRel);
    const cfgContent = fileExists(cfgAbs) ? readFileSafe(cfgAbs) || '' : '';
    hash.update(`cfg:${cfgRel}:${cfgContent}\n`);
  }

  let gitAvailable = false;
  try {
    const gitOpts = { cwd: absRoot, env: cleanGitEnv(), encoding: 'utf8', stdio: 'pipe' };
    const headSha = execFileSync('git', ['-C', absRoot, 'rev-parse', 'HEAD'], gitOpts).trim();
    const rawStatusOut = execFileSync('git', ['-C', absRoot, 'status', '--porcelain', '--untracked-files=all', '--', modulePath], gitOpts);
    const statusOut = rawStatusOut
      .split('\n')
      .filter((line) => !line.includes('.agent/') && !line.endsWith('.agent'))
      .join('\n');
    let diffOut = '';
    try {
      diffOut = execFileSync('git', ['-C', absRoot, 'diff', 'HEAD', '--', modulePath], gitOpts);
    } catch {}

    hash.update(`head:${headSha}\nstatus:${statusOut}\ndiff:${diffOut}\n`);

    // Also hash contents of untracked files so changes to untracked files invalidate cache
    for (const line of statusOut.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('?? ')) {
        let relFile = trimmed.slice(3).trim();
        if (relFile.startsWith('"') && relFile.endsWith('"')) {
          relFile = relFile.slice(1, -1).replace(/\\(.)/g, '$1');
        }
        if (relFile.startsWith('.agent')) continue;
        const fullFile = path.resolve(absRoot, relFile);
        if (fs.existsSync(fullFile) && fs.statSync(fullFile).isFile()) {
          hash.update(`untracked:${relFile}:${fs.readFileSync(fullFile, 'utf8')}\n`);
        }
      }
    }
    gitAvailable = true;
  } catch {}

  if (!gitAvailable && fs.existsSync(absMod)) {
    const walk = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.agent') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          const stat = fs.statSync(full);
          hash.update(`${path.relative(absMod, full)}:${stat.size}:${stat.mtimeMs}\n`);
        }
      }
    };
    walk(absMod);
  }

  return hash.digest('hex');
}

function loadCacheStore(repoRoot = '.') {
  const cachePath = getGateCachePath(repoRoot);
  if (!fileExists(cachePath)) {
    return { version: '1.0.0', entries: {} };
  }
  try {
    const parsed = JSON.parse(readFileSafe(cachePath));
    return parsed && typeof parsed.entries === 'object' ? parsed : { version: '1.0.0', entries: {} };
  } catch {
    return { version: '1.0.0', entries: {} };
  }
}

function saveCacheStore(repoRoot, store) {
  const cachePath = getGateCachePath(repoRoot);
  writeFileAtomic(cachePath, JSON.stringify(store, null, 2));
}

export function getGateCacheHit({ checkType = 'gate', modulePath = '.', repoRoot = '.' } = {}) {
  const treeHash = computeTreeHash(repoRoot, modulePath);
  const key = `${checkType}:${modulePath}:${treeHash}`;
  const store = loadCacheStore(repoRoot);
  const entry = store.entries[key] || null;

  return {
    hit: !!entry,
    key,
    treeHash,
    entry
  };
}

export function recordGateCache({ checkType = 'gate', modulePath = '.', result = {}, repoRoot = '.' } = {}) {
  const treeHash = computeTreeHash(repoRoot, modulePath);
  const key = `${checkType}:${modulePath}:${treeHash}`;
  const store = loadCacheStore(repoRoot);

  // Prune older entries for the same (checkType, modulePath) to keep cache compact
  const prefix = `${checkType}:${modulePath}:`;
  for (const existingKey of Object.keys(store.entries)) {
    if (existingKey.startsWith(prefix) && existingKey !== key) {
      delete store.entries[existingKey];
    }
  }

  const entry = {
    key,
    checkType,
    modulePath,
    treeHash,
    timestamp: new Date().toISOString(),
    result
  };

  store.entries[key] = entry;
  saveCacheStore(repoRoot, store);

  return {
    success: true,
    key,
    treeHash,
    entry
  };
}

export function getGateCacheStats(repoRoot = '.') {
  const store = loadCacheStore(repoRoot);
  const entries = Object.values(store.entries || {});
  return {
    cachePath: getGateCachePath(repoRoot),
    entriesCount: entries.length,
    entries
  };
}

export function clearGateCache(repoRoot = '.') {
  const cachePath = getGateCachePath(repoRoot);
  if (fileExists(cachePath)) {
    try {
      fs.unlinkSync(cachePath);
    } catch {}
  }
  return { success: true, cleared: true };
}
