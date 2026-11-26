import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTempGitRepo, git } from '../helpers/test-harness.mjs';
import { computeContentTreeSha, resolveRange } from '../../.agent/scripts/lib/git.mjs';
import {
  computeKernelDigest,
  computeTreeHash,
  readActiveSession,
  readGateCache,
  readSessionStore,
  writeActiveSession,
  writeGateCache
} from '../../.agent/scripts/lib/session.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

describe('Ring 1: lib/session.mjs', () => {
  it('computeKernelDigest deterministically hashes sorted .mjs files and changes on any script edit (S3)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sealit-kdigest-'));
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'engine.mjs'), 'export const v = 1;\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'lib/a.mjs'), 'export const a = 1;\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored\n', 'utf8');

    const d1 = computeKernelDigest(dir);
    assert.match(d1, /^[a-f0-9]{64}$/);
    assert.equal(computeKernelDigest(dir), d1);

    // Non-JS files do not change kernel digest
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'changed\n', 'utf8');
    assert.equal(computeKernelDigest(dir), d1);

    // Editing a nested .mjs file invalidates the digest immediately
    fs.writeFileSync(path.join(dir, 'lib/a.mjs'), 'export const a = 2;\n', 'utf8');
    const d2 = computeKernelDigest(dir);
    assert.notEqual(d2, d1);

    // Missing directory returns valid empty sha256 digest without throwing
    const emptyDigest = computeKernelDigest(path.join(dir, 'missing'));
    assert.match(emptyDigest, /^[a-f0-9]{64}$/);
    assert.notEqual(emptyDigest, d2);
  });

  it('readSessionStore, readActiveSession, and writeActiveSession handle empty, legacy, multi-session, and corrupt stores', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);
    git(dir, 'checkout', '-q', '-b', 'feat/s1', 'develop');

    assert.deepEqual(readSessionStore(dir), { activeSessionId: null, sessions: {} });
    assert.equal(readActiveSession(dir), null);

    // Empty file returns empty store
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    const sessPath = path.join(dir, '.agent/.sealit-session.json');
    fs.writeFileSync(sessPath, '   \n', 'utf8');
    assert.deepEqual(readSessionStore(dir), { activeSessionId: null, sessions: {} });

    // Non-session JSON object falls back cleanly
    fs.writeFileSync(sessPath, '{"unrelated":true}\n', 'utf8');
    assert.deepEqual(readSessionStore(dir), { activeSessionId: null, sessions: {} });

    // Legacy single-session format normalizes ticket ID
    fs.writeFileSync(sessPath, JSON.stringify({ issueId: '#21', branch: 'feat/s1', active: true }), 'utf8');
    const legacy = readSessionStore(dir);
    assert.equal(legacy.activeSessionId, '21');
    assert.equal(readActiveSession(dir, 'feat/s1')?.issueId, '#21');

    // Multi-session write prefers activeSessionId on same branch and falls back to last active
    writeActiveSession(dir, (store) => {
      store.activeSessionId = '30';
      store.sessions = {
        '21': { issueId: '21', branch: 'feat/s1', active: true },
        '30': { issueId: '30', branch: 'feat/s1', active: true },
        '40': { issueId: '40', branch: 'feat/other', active: false }
      };
      return store;
    });
    assert.equal(readActiveSession(dir, 'feat/s1')?.issueId, '30');
    writeActiveSession(dir, (store) => { store.activeSessionId = '999'; return store; });
    assert.equal(readActiveSession(dir, 'feat/s1')?.issueId, '30');
    assert.equal(readActiveSession(dir, 'feat/other'), null);

    // Corrupt JSON throws SESSION_CORRUPT
    fs.writeFileSync(sessPath, '{not-json', 'utf8');
    assert.throws(() => readSessionStore(dir), (err) => err.code === 'SESSION_CORRUPT');
  });

  it('computeTreeHash incorporates kernelDigest and modulePolicy canonically, reuses precomputed git state, and writeGateCache locks safely', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);
    const kDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sealit-khash-'));
    cleanups.push(() => fs.rmSync(kDir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(kDir, 'sealit-engine.mjs'), 'export const v = 1;\n', 'utf8');

    git(dir, 'checkout', '-q', '-b', 'feat/cache-key', 'develop');
    fs.writeFileSync(path.join(dir, 'a.mjs'), 'export const a = 1;\n', 'utf8');
    git(dir, 'add', 'a.mjs');
    git(dir, 'commit', '-q', '-m', 'feat: add a');

    const polA = { commands: { test: 'npm test', lint: null }, thresholds: { diffCoverage: 85, mutationScore: 52 } };
    const polSameReordered = { thresholds: { mutationScore: 52, diffCoverage: 85 }, commands: { lint: null, test: 'npm test' } };
    const polRaised = { commands: { test: 'npm test', lint: null }, thresholds: { diffCoverage: 90, mutationScore: 52 } };

    const h1 = computeTreeHash({ repoRoot: dir, modulePath: '.', checkType: 'gate', baseBranch: 'develop', modulePolicy: polA, kernelDir: kDir });
    const hReordered = computeTreeHash({ repoRoot: dir, modulePath: '.', checkType: 'gate', baseBranch: 'develop', modulePolicy: polSameReordered, kernelDir: kDir });
    const hRaised = computeTreeHash({ repoRoot: dir, modulePath: '.', checkType: 'gate', baseBranch: 'develop', modulePolicy: polRaised, kernelDir: kDir });

    assert.equal(h1.cacheable, true);
    assert.equal(h1.hash, hReordered.hash, 'policy key ordering must be canonical');
    assert.notEqual(h1.hash, hRaised.hash, 'changing effective policy threshold must invalidate gate cache');

    // Precomputed { range, treeSha, cleanTree } produces byte-identical hash without re-spawning git
    const range = resolveRange({ baseBranch: 'develop', head: 'HEAD', repoRoot: dir });
    const treeSha = computeContentTreeSha(range.headSha, dir);
    const hPre = computeTreeHash({
      repoRoot: dir,
      modulePath: '.',
      checkType: 'gate',
      baseBranch: 'develop',
      modulePolicy: polA,
      kernelDir: kDir,
      precomputed: { range, treeSha, cleanTree: true }
    });
    assert.equal(hPre.cacheable, true);
    assert.equal(hPre.hash, h1.hash);

    // Mutating engine code in kernelDir invalidates computeTreeHash (S3)
    fs.writeFileSync(path.join(kDir, 'sealit-engine.mjs'), 'export const v = 2;\n', 'utf8');
    const hEngineChanged = computeTreeHash({ repoRoot: dir, modulePath: '.', checkType: 'gate', baseBranch: 'develop', modulePolicy: polA, kernelDir: kDir });
    assert.notEqual(hEngineChanged.hash, h1.hash);

    // Gate cache read/write + corrupt recovery + empty hash guard
    assert.equal(readGateCache(dir, 'root', ''), null);
    assert.equal(readGateCache(dir, 'root', h1.hash), null);
    writeGateCache(dir, 'root', '', { passed: true });
    writeGateCache(dir, 'root', h1.hash, { passed: true, diffCoveragePct: 92 });
    const cached = readGateCache(dir, 'root', h1.hash);
    assert.equal(cached.passed, true);
    assert.equal(cached.diffCoveragePct, 92);
    assert.ok(cached.cachedAt);

    const cacheFile = path.join(dir, '.agent/.cache/gate-cache.json');
    fs.writeFileSync(cacheFile, '{corrupt', 'utf8');
    assert.equal(readGateCache(dir, 'root', h1.hash), null);
    writeGateCache(dir, 'root', hRaised.hash, { passed: true, diffCoveragePct: 95 });
    assert.equal(readGateCache(dir, 'root', hRaised.hash)?.diffCoveragePct, 95);
  });
});
