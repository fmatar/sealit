import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';
import { commonTokens, declareClassPlugin, PluginKind, tokens } from '@stryker-mutator/api/plugin';
import { determineHitLimitReached, DryRunStatus, TestStatus, toMutantRunResult } from '@stryker-mutator/api/test-runner';

const SELF_URL = new URL(import.meta.url);
SELF_URL.search = '';
const SHIM_HREF = `${SELF_URL.href}?shim=1`;
const LOADER_HREF = `${SELF_URL.href}?loader=1`;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'node:test' || specifier === 'test') {
    return { url: SHIM_HREF, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

function getRegistry() {
  if (!globalThis.__sdlcNodeTestRegistry) {
    globalThis.__sdlcNodeTestRegistry = {
      currentFile: '',
      currentAbsFile: '',
      scopes: [{ name: '', beforeEach: [], afterEach: [] }],
      tests: []
    };
  }
  return globalThis.__sdlcNodeTestRegistry;
}

export function describe(name, fn) {
  const reg = getRegistry();
  reg.scopes.push({ name: String(name || ''), beforeEach: [], afterEach: [] });
  try {
    fn();
  } finally {
    reg.scopes.pop();
  }
}

export function it(name, fn) {
  const reg = getRegistry();
  const prefix = reg.scopes.map((s) => s.name).filter(Boolean).join(' > ');
  const fullName = prefix ? `${prefix} > ${name}` : String(name || '');
  const id = `${reg.currentFile}::${reg.tests.length}::${fullName}`;
  const beforeHooks = reg.scopes.flatMap((s) => s.beforeEach);
  const afterHooks = reg.scopes.flatMap((s) => s.afterEach);
  reg.tests.push({
    id,
    name: fullName,
    fileName: reg.currentFile,
    absFile: reg.currentAbsFile,
    fn,
    beforeHooks,
    afterHooks
  });
}

export const test = it;
export function beforeEach(fn) {
  const reg = getRegistry();
  reg.scopes[reg.scopes.length - 1].beforeEach.push(fn);
}
export function afterEach(fn) {
  const reg = getRegistry();
  reg.scopes[reg.scopes.length - 1].afterEach.push(fn);
}
export function before(fn) {
  beforeEach(fn);
}
export function after(fn) {
  afterEach(fn);
}

let loaderRegistered = false;
function ensureLoaderRegistered() {
  if (!loaderRegistered) {
    Module.register(LOADER_HREF);
    loaderRegistered = true;
  }
}

function resolveTestFiles(patterns) {
  const list = Array.isArray(patterns) && patterns.length > 0 ? patterns : ['tests/unit/*.test.mjs'];
  const found = [];
  const seen = new Set();
  for (const pat of list) {
    const matches = /[?*[\]{}]/.test(pat) ? fs.globSync(pat, { cwd: process.cwd() }) : (fs.existsSync(pat) ? [pat] : []);
    for (const rel of matches) {
      const norm = rel.replace(/\\/g, '/');
      if (norm.includes('node_modules/') || seen.has(norm)) continue;
      seen.add(norm);
      found.push(norm);
    }
  }
  return found;
}

export class SdlcNodeTestRunner {
  static inject = tokens(commonTokens.options, commonTokens.logger);

  constructor(options, log) {
    this.options = options;
    this.log = log;
    this.nsKey = INSTRUMENTER_CONSTANTS.NAMESPACE;
    this.initialStatic = {};
    this.tests = [];
    this.testById = new Map();
  }

  capabilities() {
    return { reloadEnvironment: false };
  }

  getNs() {
    if (!globalThis[this.nsKey]) globalThis[this.nsKey] = {};
    return globalThis[this.nsKey];
  }

  async init() {
    process.env.GIT_CEILING_DIRECTORIES = path.dirname(process.cwd());
    ensureLoaderRegistered();
    const ns = this.getNs();
    ns.activeMutant = undefined;
    ns.currentTestId = undefined;
    ns.hitLimit = undefined;
    ns.hitCount = undefined;
    if (!ns.mutantCoverage) ns.mutantCoverage = { static: {}, perTest: {} };

    const reg = getRegistry();
    reg.tests = [];
    const files = resolveTestFiles(this.options?.tap?.testFiles);
    for (const relFile of files) {
      const absFile = path.resolve(process.cwd(), relFile);
      reg.currentFile = relFile;
      reg.currentAbsFile = absFile;
      reg.scopes = [{ name: '', beforeEach: [], afterEach: [] }];
      await import(pathToFileURL(absFile).href);
    }
    this.tests = [...reg.tests];
    this.testById = new Map(this.tests.map((t) => [t.id, t]));
    this.initialStatic = { ...(ns.mutantCoverage?.static || {}) };
  }

  async executeSingleTest(t, ns, trackPerTest) {
    const savedCwd = process.cwd();
    const savedEnv = { ...process.env };
    const t0 = performance.now();
    if (trackPerTest) ns.currentTestId = t.id;
    let errObj = null;
    try {
      for (const bh of t.beforeHooks) await bh();
      await t.fn();
    } catch (err) {
      errObj = err || new Error('Test failed');
    } finally {
      if (trackPerTest) ns.currentTestId = undefined;
      for (const ah of t.afterHooks) {
        try { await ah(); } catch (cleanupErr) { if (!errObj) errObj = cleanupErr; }
      }
      if (process.cwd() !== savedCwd) {
        try { process.chdir(savedCwd); } catch {}
      }
      for (const k of Object.keys(process.env)) {
        if (!Object.prototype.hasOwnProperty.call(savedEnv, k)) delete process.env[k];
      }
      Object.assign(process.env, savedEnv);
    }
    const timeSpentMs = Math.max(0, Math.round(performance.now() - t0));
    if (!errObj) {
      return { id: t.id, name: t.name, fileName: t.fileName, timeSpentMs, status: TestStatus.Success };
    }
    return {
      id: t.id,
      name: t.name,
      fileName: t.fileName,
      timeSpentMs,
      status: TestStatus.Failed,
      failureMessage: errObj?.stack || errObj?.message || String(errObj)
    };
  }

  async dryRun(options) {
    const ns = this.getNs();
    ns.activeMutant = undefined;
    ns.hitLimit = undefined;
    ns.hitCount = undefined;
    if (!ns.mutantCoverage) ns.mutantCoverage = { static: {}, perTest: {} };
    for (const k of Object.keys(ns.mutantCoverage.static)) delete ns.mutantCoverage.static[k];
    Object.assign(ns.mutantCoverage.static, this.initialStatic);
    for (const k of Object.keys(ns.mutantCoverage.perTest)) delete ns.mutantCoverage.perTest[k];

    const filterFiles = Array.isArray(options?.testFiles) && options.testFiles.length > 0
      ? new Set(options.testFiles.map((f) => path.resolve(process.cwd(), f)))
      : null;
    const list = filterFiles ? this.tests.filter((t) => filterFiles.has(t.absFile)) : this.tests;
    const results = [];
    for (const t of list) {
      const res = await this.executeSingleTest(t, ns, true);
      results.push(res);
      if (res.status !== TestStatus.Success && !options?.disableBail) break;
    }

    const mutatedSources = new Set((this.options?.mutate || []).map((m) => String(m).split(':')[0].replace(/^\.\//, '')));
    const configuredFiles = resolveTestFiles(this.options?.tap?.testFiles);
    if (mutatedSources.size === 1 && configuredFiles.length > 1 && !filterFiles) {
      const primaryFile = configuredFiles[0];
      const primaryCovered = new Set();
      for (const t of list) {
        if (t.fileName !== primaryFile) continue;
        for (const mId of Object.keys(ns.mutantCoverage.perTest[t.id] || {})) primaryCovered.add(mId);
      }
      if (primaryCovered.size > 0) {
        for (const t of list) {
          if (t.fileName === primaryFile) continue;
          const map = ns.mutantCoverage.perTest[t.id];
          if (map) {
            for (const mId of primaryCovered) delete map[mId];
          }
        }
      }
    }

    return {
      status: DryRunStatus.Complete,
      tests: results,
      mutantCoverage: structuredClone(ns.mutantCoverage)
    };
  }

  async mutantRun(options) {
    const ns = this.getNs();
    const filterIds = Array.isArray(options?.testFilter) && options.testFilter.length > 0 ? options.testFilter : null;
    const list = filterIds ? filterIds.map((id) => this.testById.get(id)).filter(Boolean) : this.tests;

    ns.activeMutant = String(options.activeMutant.id);
    ns.hitLimit = options.hitLimit;
    ns.hitCount = options.hitLimit !== undefined ? 0 : undefined;
    const results = [];
    try {
      for (const t of list) {
        const res = await this.executeSingleTest(t, ns, false);
        const hitReached = determineHitLimitReached(ns.hitCount, options.hitLimit);
        if (hitReached) return toMutantRunResult(hitReached);
        results.push(res);
        if (res.status !== TestStatus.Success && !options?.disableBail) break;
      }
    } finally {
      ns.activeMutant = undefined;
      ns.hitLimit = undefined;
      ns.hitCount = undefined;
      ns.currentTestId = undefined;
    }
    return toMutantRunResult({ status: DryRunStatus.Complete, tests: results });
  }
}

export const strykerPlugins = [declareClassPlugin(PluginKind.TestRunner, 'sdlc-node', SdlcNodeTestRunner)];
