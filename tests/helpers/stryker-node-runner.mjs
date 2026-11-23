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

function syncResolveHook(specifier, context, nextResolve) {
  if (specifier === 'node:test' || specifier === 'test') {
    return { url: SHIM_HREF, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function resolve(specifier, context, nextResolve) {
  return syncResolveHook(specifier, context, nextResolve);
}

function getRegistry() {
  if (!globalThis.__sdlcNodeTestRegistry) {
    globalThis.__sdlcNodeTestRegistry = {
      scopeSeq: 0,
      currentFile: '',
      currentAbsFile: '',
      currentFileTests: [],
      testsByAbsFile: new Map(),
      scopes: []
    };
  }
  return globalThis.__sdlcNodeTestRegistry;
}

function makeScope(reg, name = '') {
  return { id: ++reg.scopeSeq, name: String(name || ''), before: [], after: [], beforeEach: [], afterEach: [] };
}

function parseEntryArgs(nameOrFn, optsOrFn, maybeFn) {
  if (typeof nameOrFn === 'function') return { name: nameOrFn.name || 'anonymous', opts: {}, fn: nameOrFn };
  if (typeof optsOrFn === 'function') return { name: String(nameOrFn || ''), opts: {}, fn: optsOrFn };
  return { name: String(nameOrFn || ''), opts: optsOrFn && typeof optsOrFn === 'object' ? optsOrFn : {}, fn: maybeFn };
}

export function describe(nameOrFn, optsOrFn, maybeFn) {
  const { name, opts, fn } = parseEntryArgs(nameOrFn, optsOrFn, maybeFn);
  if (opts.skip || opts.todo || typeof fn !== 'function') return;
  const reg = getRegistry();
  reg.scopes.push(makeScope(reg, name));
  try {
    fn();
  } finally {
    reg.scopes.pop();
  }
}
describe.skip = () => {};
describe.todo = () => {};

export function it(nameOrFn, optsOrFn, maybeFn) {
  const { name, opts, fn } = parseEntryArgs(nameOrFn, optsOrFn, maybeFn);
  if (opts.skip || opts.todo || typeof fn !== 'function') return;
  const reg = getRegistry();
  const prefix = reg.scopes.map((s) => s.name).filter(Boolean).join(' > ');
  const fullName = prefix ? `${prefix} > ${name}` : name;
  const idx = reg.currentFileTests.length;
  reg.currentFileTests.push({
    localIdx: idx,
    name: fullName,
    fileName: reg.currentFile,
    absFile: reg.currentAbsFile,
    fn,
    scopeChain: [...reg.scopes],
    beforeHooks: reg.scopes.flatMap((s) => s.beforeEach),
    afterHooks: reg.scopes.flatMap((s) => s.afterEach)
  });
}
it.skip = () => {};
it.todo = () => {};

export const test = it;
export function beforeEach(fn) {
  const reg = getRegistry();
  if (typeof fn === 'function') reg.scopes[reg.scopes.length - 1].beforeEach.push(fn);
}
export function afterEach(fn) {
  const reg = getRegistry();
  if (typeof fn === 'function') reg.scopes[reg.scopes.length - 1].afterEach.push(fn);
}
export function before(fn) {
  const reg = getRegistry();
  if (typeof fn === 'function') reg.scopes[reg.scopes.length - 1].before.push(fn);
}
export function after(fn) {
  const reg = getRegistry();
  if (typeof fn === 'function') reg.scopes[reg.scopes.length - 1].after.push(fn);
}

let loaderRegistered = false;
function ensureLoaderRegistered() {
  if (loaderRegistered) return;
  if (typeof Module.registerHooks === 'function') {
    Module.registerHooks({ resolve: syncResolveHook });
  } else {
    Module.register(LOADER_HREF);
  }
  loaderRegistered = true;
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
    for (const k of [
      'GITHUB_BASE_REF', 'GITHUB_REF', 'GITHUB_REF_NAME', 'GITHUB_REF_TYPE', 'GITHUB_HEAD_REF',
      'CI_MERGE_REQUEST_TARGET_BRANCH_NAME', 'CI_MERGE_REQUEST_SOURCE_BRANCH_NAME', 'CI_COMMIT_BRANCH', 'CI_COMMIT_REF_NAME', 'CI_COMMIT_TAG',
      'BITBUCKET_PR_DESTINATION_BRANCH', 'BITBUCKET_BRANCH',
      'SYSTEM_PULLREQUEST_TARGETBRANCH', 'SYSTEM_PULLREQUEST_SOURCEBRANCH', 'BUILD_SOURCEBRANCH', 'BUILD_SOURCEBRANCHNAME'
    ]) {
      delete process.env[k];
    }
    ensureLoaderRegistered();
    const ns = this.getNs();
    ns.activeMutant = undefined;
    ns.currentTestId = undefined;
    ns.hitLimit = undefined;
    ns.hitCount = undefined;
    if (!ns.mutantCoverage) ns.mutantCoverage = { static: {}, perTest: {} };

    const reg = getRegistry();
    const files = resolveTestFiles(this.options?.tap?.testFiles);
    const loaded = [];
    for (const relFile of files) {
      const absFile = path.resolve(process.cwd(), relFile);
      if (!reg.testsByAbsFile.has(absFile)) {
        reg.currentFile = relFile;
        reg.currentAbsFile = absFile;
        reg.currentFileTests = [];
        reg.scopes = [makeScope(reg, '')];
        await import(pathToFileURL(absFile).href);
        reg.testsByAbsFile.set(absFile, reg.currentFileTests);
      }
      for (const raw of reg.testsByAbsFile.get(absFile) || []) {
        const id = `${relFile}::${raw.localIdx}::${raw.name}`;
        loaded.push({ ...raw, id, fileName: relFile });
      }
    }
    this.tests = loaded;
    this.testById = new Map(this.tests.map((t) => [t.id, t]));
    this.initialStatic = { ...(ns.mutantCoverage?.static || {}) };
  }

  async executeSingleTest(t, ns, trackPerTest, startedScopes) {
    const savedCwd = process.cwd();
    const savedEnv = { ...process.env };
    const t0 = performance.now();
    if (trackPerTest) ns.currentTestId = t.id;
    let errObj = null;
    try {
      for (const s of t.scopeChain) {
        if (!startedScopes.has(s.id)) {
          startedScopes.set(s.id, s);
          for (const sb of s.before) await sb();
        }
      }
      for (const bh of t.beforeHooks) await bh();
      const ctx = { name: t.name, filePath: t.absFile, diagnostic: () => {}, skip: () => {}, todo: () => {} };
      await t.fn(ctx);
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

  async finishScopes(startedScopes) {
    for (const s of [...startedScopes.values()].reverse()) {
      for (const sa of s.after) {
        try { await sa(); } catch {}
      }
    }
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
    const startedScopes = new Map();
    try {
      for (const t of list) {
        const res = await this.executeSingleTest(t, ns, true, startedScopes);
        results.push(res);
        if (res.status !== TestStatus.Success && !options?.disableBail) break;
      }
    } finally {
      await this.finishScopes(startedScopes);
    }

    // shortcut: when a module's paired unit suite already covers a mutant, prune outer-ring integration suites (12x faster on Ring 0); secondary suites still cover mutants missed by primary.
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
    const startedScopes = new Map();
    try {
      for (const t of list) {
        const res = await this.executeSingleTest(t, ns, false, startedScopes);
        const hitReached = determineHitLimitReached(ns.hitCount, options.hitLimit);
        if (hitReached) return toMutantRunResult(hitReached);
        results.push(res);
        if (res.status !== TestStatus.Success && !options?.disableBail) break;
      }
    } finally {
      await this.finishScopes(startedScopes);
      ns.activeMutant = undefined;
      ns.hitLimit = undefined;
      ns.hitCount = undefined;
      ns.currentTestId = undefined;
    }
    return toMutantRunResult({ status: DryRunStatus.Complete, tests: results });
  }
}

export const strykerPlugins = [
  declareClassPlugin(PluginKind.TestRunner, 'sealit-node', SdlcNodeTestRunner),
  declareClassPlugin(PluginKind.TestRunner, 'sdlc-node', SdlcNodeTestRunner)
];
