import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';
import { SdlcNodeTestRunner } from '../helpers/stryker-node-runner.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

function runParityShard(cfg, testFiles) {
  return new Promise((resolve, reject) => {
    const runnerUrl = pathToFileURL(path.join(REPO_ROOT, 'tests/helpers/stryker-node-runner.mjs')).href;
    const shardCfg = { ...cfg, tap: { ...(cfg.tap || {}), testFiles } };
    const script = [
      `import { SdlcNodeTestRunner } from ${JSON.stringify(runnerUrl)};`,
      `const runner = new SdlcNodeTestRunner(${JSON.stringify(shardCfg)}, console);`,
      'await runner.init();',
      'const dry = await runner.dryRun({ disableBail: true });',
      'const failed = dry.tests.filter((t) => t.status !== "success" && t.status !== 0);',
      'process.stdout.write(JSON.stringify({ count: dry.tests.length, failed }) + "\\n");'
    ].join('\n');
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_V8_COVERAGE;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Shard [${testFiles.join(', ')}] exited ${code}: ${err || out}`));
      const lines = out.trim().split('\n').filter(Boolean);
      try {
        resolve(JSON.parse(lines[lines.length - 1]));
      } catch (e) {
        reject(new Error(`Unparseable shard output for [${testFiles.join(', ')}]: ${out}\n${err}`));
      }
    });
  });
}

describe('Stryker in-process node:test runner parity & configuration', () => {
  it('stryker.config.json omits Node-22-incompatible --test-isolation=none and passes full-suite parity under SdlcNodeTestRunner', { timeout: 240_000 }, async () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'stryker.config.json'), 'utf8'));
    assert.equal((cfg.tap?.nodeArgs || []).includes('--test-isolation=none'), false);
    const allFiles = cfg.tap?.testFiles || [];
    assert.equal(allFiles.length, 11);
    assert.equal((cfg.mutator?.excludedMutations || []).includes('Regex'), false, 'Regex mutations must be enabled');

    // Run every configured Stryker test file through SdlcNodeTestRunner.init() + dryRun() in parallel OS shards
    const shardCount = Math.min(6, allFiles.length);
    const shards = Array.from({ length: shardCount }, () => []);
    allFiles.forEach((f, idx) => shards[idx % shardCount].push(f));
    const results = await Promise.all(shards.map((s) => runParityShard(cfg, s)));
    const totalCount = results.reduce((acc, r) => acc + r.count, 0);
    const allFailed = results.flatMap((r) => r.failed);
    assert.ok(totalCount >= 50, `Expected >=50 unit tests in Stryker suite, got ${totalCount}`);
    assert.deepEqual(allFailed, []);
  });

  it('matches node --test semantics for suite-once before/after, 3-arg it(name, opts, fn), t context, skip/todo, idempotent init(), and cross-suite perTest kills', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-stryker-shim-'));
    cleanups.push(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    const primaryFile = path.join(tmpDir, 'primary.test.mjs');
    const secondaryFile = path.join(tmpDir, 'secondary.test.mjs');
    const nsKey = INSTRUMENTER_CONSTANTS.NAMESPACE;

    fs.writeFileSync(
      primaryFile,
      `import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.__hookCounts = { before: 0, after: 0, each: 0 };

describe('suite semantics', () => {
  before(() => { globalThis.__hookCounts.before++; });
  after(() => { globalThis.__hookCounts.after++; });
  beforeEach(() => { globalThis.__hookCounts.each++; });

  it('first test covers mutant 99 directly while leaving mutant 42 for cross-suite fallback', (t) => {
    assert.equal(typeof t?.name, 'string');
    const ns = globalThis[${JSON.stringify(nsKey)}];
    if (ns?.currentTestId && ns?.mutantCoverage?.perTest) {
      ns.mutantCoverage.perTest[ns.currentTestId] = { '99': 1 };
    }
    assert.equal(1, 1);
  });

  it('second test uses 3-arg options signature', { timeout: 2000 }, (t) => {
    assert.match(t.name, /second test/);
  });

  it.skip('skipped test never executes', () => {
    throw new Error('should be skipped');
  });

  it.todo('todo test never executes', () => {
    throw new Error('should be todo');
  });
});
`,
      'utf8'
    );

    fs.writeFileSync(
      secondaryFile,
      `import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('secondary cross-suite', () => {
  it('kills mutant 42 (uncovered by primary) while primary-covered mutant 99 is pruned from secondary', () => {
    const ns = globalThis[${JSON.stringify(nsKey)}];
    if (ns?.currentTestId && ns?.mutantCoverage?.perTest) {
      ns.mutantCoverage.perTest[ns.currentTestId] = { '42': 1, '99': 1 };
    }
    assert.notEqual(ns?.activeMutant, '42', 'secondary suite killed mutant 42');
  });
});
`,
      'utf8'
    );

    // 1. Parity check: native node --test passes both files cleanly
    execFileSync(process.execPath, ['--test', primaryFile, secondaryFile], { stdio: 'pipe' });

    // 2. SdlcNodeTestRunner runs in-process with identical pass set, suite-once before/after, idempotent init(), and preserved cross-suite perTest coverage
    const savedCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const runner = new SdlcNodeTestRunner(
        { mutate: ['src/a.mjs'], tap: { testFiles: ['primary.test.mjs', 'secondary.test.mjs'] } },
        console
      );
      await runner.init();
      const firstCount = runner.tests.length;
      assert.equal(firstCount, 3, 'Expected 3 runnable tests (skip/todo excluded from execution)');

      // Second init() on cached ESM modules remains idempotent
      await runner.init();
      assert.equal(runner.tests.length, firstCount);

      const dry = await runner.dryRun({});
      assert.equal(dry.tests.every((r) => r.status === 'success' || r.status === 0), true);
      assert.deepEqual(globalThis.__hookCounts, { before: 1, after: 1, each: 2 });

      // Cross-suite fallback preserves mutant '42' (missed by primary) on secondary.test.mjs while pruning primary-covered '99'
      const secondaryTest = runner.tests.find((t) => t.fileName === 'secondary.test.mjs');
      assert.ok(dry.mutantCoverage.perTest[secondaryTest.id]?.['42'], 'Expected uncovered-by-primary mutant 42 preserved on secondary');
      assert.equal(dry.mutantCoverage.perTest[secondaryTest.id]?.['99'], undefined);

      const mutRes = await runner.mutantRun({
        activeMutant: { id: '42' },
        testFilter: Object.keys(dry.mutantCoverage.perTest).filter((tid) => dry.mutantCoverage.perTest[tid]?.['42'])
      });
      assert.equal(mutRes.status, 'killed');
    } finally {
      process.chdir(savedCwd);
      delete globalThis.__hookCounts;
    }
  });
});
