import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  EMPTY_TREE_SHA,
  fileExists,
  readBlobs,
  readChangeSet,
  readFileSafe,
  parseCommandArgv,
  resolveInsideRepo,
  writeFileAtomic,
  withFileLock
} from './git.mjs';

export const DEFAULT_QUALITY_THRESHOLDS = Object.freeze({
  diffCoverage: 85,
  mutationScore: null
});

export const DEFAULT_QUALITY_GATE_CHECK = 'Universal Quality Gate, Spec-Drift & Merkle Receipt Defense';
export const STABLE_MUTANT_ID_RE = /^[A-Za-z0-9_-]+@\d+:\d+#[0-9a-f]{8}$/;

const LEGACY_TOP_KEYS = ['gates', 'testing', 'lanes', 'projectManagement', 'profile', 'generatedAt'];
const COMMAND_KEYS = ['lint', 'build', 'test', 'coverage', 'mutation'];

export const CONFIG_SCHEMA_KEYS = Object.freeze({
  root: Object.freeze(['$schema', 'version', 'ci', 'archlens', 'modules', 'exemptions', ...LEGACY_TOP_KEYS]),
  ci: Object.freeze(['runsOn', 'checkName']),
  archlens: Object.freeze(['enabled', 'policyPath']),
  module: Object.freeze(['name', 'path', 'language', 'stack', 'commands', 'thresholds']),
  commands: Object.freeze([...COMMAND_KEYS, 'coverageFile']),
  thresholds: Object.freeze(['diffCoverage', 'mutationScore']),
  exemption: Object.freeze(['id', 'file', 'reason', 'addedAt'])
});

function pushUnknownKeys(obj, allowed, scope, errors) {
  const allowSet = new Set(allowed);
  for (const key of Object.keys(obj)) {
    if (!allowSet.has(key)) {
      errors.push(`Unknown configuration key '${scope ? `${scope}.${key}` : key}'.`);
    }
  }
}

function normalizeThreshold(val, fallback) {
  if (val === null || val === false) return null;
  if (val === undefined) return fallback;
  const num = Number(val);
  return Number.isFinite(num) ? num : fallback;
}

export function migrateConfigObject(rawCfg) {
  const warnings = [];
  if (!rawCfg || typeof rawCfg !== 'object' || Array.isArray(rawCfg)) {
    return { config: null, warnings, migrated: false };
  }

  const clone = structuredClone(rawCfg);
  let migrated = false;

  for (const legacyKey of LEGACY_TOP_KEYS) {
    if (Object.prototype.hasOwnProperty.call(clone, legacyKey)) {
      migrated = true;
      warnings.push(`Deprecated config key '${legacyKey}' detected; run 'sdlc doctor --fix' to upgrade to v0.1.0 schema.`);
    }
  }

  const gates = clone.gates && typeof clone.gates === 'object' ? clone.gates : {};
  const testing = clone.testing && typeof clone.testing === 'object' ? clone.testing : {};

  if (Array.isArray(clone.modules) && clone.modules.length > 0 && clone.modules[0] && typeof clone.modules[0] === 'object') {
    const first = clone.modules[0];
    first.commands = first.commands && typeof first.commands === 'object' ? { ...first.commands } : {};
    first.thresholds = first.thresholds && typeof first.thresholds === 'object' ? { ...first.thresholds } : {};

    if (first.commands.test === undefined && testing.testCommand !== undefined) {
      first.commands.test = testing.testCommand;
    }
    if (first.commands.coverage === undefined && testing.coverageCommand !== undefined) {
      first.commands.coverage = testing.coverageCommand;
    }
    if (first.commands.mutation === undefined && testing.mutationCommand !== undefined) {
      first.commands.mutation = testing.mutationCommand;
    }

    if (first.thresholds.diffCoverage === undefined) {
      if (gates.minDiffCoverage !== undefined) first.thresholds.diffCoverage = gates.minDiffCoverage;
      else if (testing.coverageThreshold !== undefined) first.thresholds.diffCoverage = testing.coverageThreshold;
    }
    if (first.thresholds.mutationScore === undefined) {
      if (gates.minMutationScore !== undefined) first.thresholds.mutationScore = gates.minMutationScore;
      else if (testing.mutationThreshold !== undefined) first.thresholds.mutationScore = testing.mutationThreshold;
    }
  }

  if (Array.isArray(clone.modules)) {
    for (const mod of clone.modules) {
      if (!mod || typeof mod !== 'object') continue;
      mod.commands = mod.commands && typeof mod.commands === 'object' ? mod.commands : {};
      const defaultCov = mod.commands.coverage ? DEFAULT_QUALITY_THRESHOLDS.diffCoverage : null;
      const defaultMut = mod.commands.mutation ? 80 : DEFAULT_QUALITY_THRESHOLDS.mutationScore;
      mod.thresholds = {
        diffCoverage: normalizeThreshold(mod.thresholds?.diffCoverage, defaultCov),
        mutationScore: normalizeThreshold(mod.thresholds?.mutationScore, defaultMut)
      };
    }
  }

  if (!Array.isArray(clone.exemptions)) {
    const legacyExPath = clone.__legacyExemptions;
    clone.exemptions = Array.isArray(legacyExPath) ? legacyExPath : [];
  }

  clone.ci = {
    runsOn: clone.ci?.runsOn || "${{ vars.SDLC_RUNS_ON || 'ubuntu-latest' }}",
    checkName: clone.ci?.checkName || DEFAULT_QUALITY_GATE_CHECK
  };
  clone.archlens = {
    enabled: clone.archlens?.enabled !== false,
    policyPath: clone.archlens?.policyPath || '.archlens/policy.json'
  };

  return { config: clone, warnings, migrated };
}

export function resolveConfigPath(repoRoot = '.', customConfigPath = null) {
  if (customConfigPath) {
    return path.isAbsolute(customConfigPath) ? customConfigPath : resolveInsideRepo(repoRoot, customConfigPath);
  }
  return path.resolve(repoRoot, '.agent/sdlc-config.json');
}

export function loadConfig(repoRoot = '.', customConfigPath = null) {
  const cfgPath = resolveConfigPath(repoRoot, customConfigPath);
  if (!fileExists(cfgPath)) {
    return { config: generateConfig(repoRoot), warnings: [], migrated: false, exists: false };
  }
  const rawText = readFileSafe(cfgPath);
  if (rawText === null) {
    throw new Error(`Unable to read configuration file at '${cfgPath}'.`);
  }
  const parsed = JSON.parse(rawText);
  const migrated = migrateConfigObject(parsed);
  return { ...migrated, exists: true };
}

export function validateConfigFile(repoRoot = '.', customConfigPath = null) {
  const errors = [];
  let cfgPath;
  try {
    cfgPath = resolveConfigPath(repoRoot, customConfigPath);
  } catch (err) {
    return { valid: false, errors: [err.message], warnings: [], config: null };
  }

  if (!fileExists(cfgPath)) {
    return { valid: false, errors: [`Missing configuration file: ${cfgPath}`], warnings: [], config: null };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch (err) {
    return { valid: false, errors: [`Invalid JSON in ${cfgPath}: ${err.message}`], warnings: [], config: null };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, errors: ['Configuration root must be a JSON object.'], warnings: [], config: null };
  }
  pushUnknownKeys(parsed, CONFIG_SCHEMA_KEYS.root, '', errors);

  if (typeof parsed.version !== 'string' || !parsed.version.trim()) {
    errors.push('Configuration requires a non-empty string "version".');
  }

  if (parsed.ci !== undefined) {
    if (!parsed.ci || typeof parsed.ci !== 'object' || Array.isArray(parsed.ci)) {
      errors.push('"ci" must be an object.');
    } else {
      pushUnknownKeys(parsed.ci, CONFIG_SCHEMA_KEYS.ci, 'ci', errors);
      if (parsed.ci.checkName !== undefined && (typeof parsed.ci.checkName !== 'string' || !parsed.ci.checkName.trim() || /[\r\n]/.test(parsed.ci.checkName))) {
        errors.push('ci.checkName must be a non-empty single-line string.');
      }
      if (parsed.ci.runsOn !== undefined) {
        const okStr = (s) => typeof s === 'string' && Boolean(s.trim()) && !/[\r\n\u0000-\u001f\u007f]/.test(s);
        const okRunsOn = okStr(parsed.ci.runsOn) || (Array.isArray(parsed.ci.runsOn) && parsed.ci.runsOn.length > 0 && parsed.ci.runsOn.every(okStr));
        if (!okRunsOn) errors.push('ci.runsOn must be a single-line string or non-empty array of single-line strings.');
      }
    }
  }

  if (parsed.archlens !== undefined) {
    if (!parsed.archlens || typeof parsed.archlens !== 'object' || Array.isArray(parsed.archlens)) {
      errors.push('"archlens" must be an object.');
    } else {
      pushUnknownKeys(parsed.archlens, CONFIG_SCHEMA_KEYS.archlens, 'archlens', errors);
      if (parsed.archlens.enabled !== undefined && typeof parsed.archlens.enabled !== 'boolean') {
        errors.push('archlens.enabled must be a boolean.');
      }
      if (parsed.archlens.policyPath !== undefined) {
        if (typeof parsed.archlens.policyPath !== 'string' || !parsed.archlens.policyPath.trim()) {
          errors.push('archlens.policyPath must be a non-empty string.');
        } else {
          try {
            resolveInsideRepo(repoRoot, parsed.archlens.policyPath);
          } catch (err) {
            errors.push(`archlens.policyPath invalid: ${err.message}`);
          }
        }
      }
    }
  }

  const migrated = migrateConfigObject(parsed);
  const extraWarnings = [];

  if (!Array.isArray(parsed.modules) || parsed.modules.length < 1) {
    errors.push('Configuration "modules" must be an array containing at least one module.');
  } else {
    parsed.modules.forEach((mod, idx) => {
      const label = `modules[${idx}]`;
      if (!mod || typeof mod !== 'object' || Array.isArray(mod)) {
        errors.push(`${label} must be an object.`);
        return;
      }
      pushUnknownKeys(mod, CONFIG_SCHEMA_KEYS.module, label, errors);
      if (typeof mod.name !== 'string' || !mod.name.trim()) {
        errors.push(`${label}.name must be a non-empty string.`);
      }
      if (typeof mod.path !== 'string' || !mod.path.trim()) {
        errors.push(`${label}.path must be a non-empty string.`);
      } else {
        try {
          resolveInsideRepo(repoRoot, mod.path);
        } catch (err) {
          errors.push(`${label}.path invalid: ${err.message}`);
        }
      }
      if (!mod.commands || typeof mod.commands !== 'object' || Array.isArray(mod.commands)) {
        errors.push(`${label}.commands must be an object.`);
      } else {
        pushUnknownKeys(mod.commands, CONFIG_SCHEMA_KEYS.commands, `${label}.commands`, errors);
        for (const cmdKey of COMMAND_KEYS) {
          const spec = mod.commands[cmdKey];
          if (spec === undefined || spec === null) continue;
          try {
            parseCommandArgv(spec);
          } catch (err) {
            errors.push(`${label}.commands.${cmdKey} invalid: ${err.message}`);
          }
        }
        if (mod.commands.coverageFile !== undefined && mod.commands.coverageFile !== null) {
          if (typeof mod.commands.coverageFile !== 'string' || !mod.commands.coverageFile.trim()) {
            errors.push(`${label}.commands.coverageFile must be a non-empty string or null.`);
          } else {
            try {
              resolveInsideRepo(repoRoot, path.join(mod.path || '.', mod.commands.coverageFile));
            } catch (err) {
              errors.push(`${label}.commands.coverageFile invalid: ${err.message}`);
            }
          }
        }
      }

      if (mod.thresholds !== undefined) {
        if (!mod.thresholds || typeof mod.thresholds !== 'object' || Array.isArray(mod.thresholds)) {
          errors.push(`${label}.thresholds must be an object.`);
        } else {
          pushUnknownKeys(mod.thresholds, CONFIG_SCHEMA_KEYS.thresholds, `${label}.thresholds`, errors);
          for (const tKey of ['diffCoverage', 'mutationScore']) {
            const tv = mod.thresholds[tKey];
            if (tv === undefined || tv === null) continue;
            if (typeof tv !== 'number' || !Number.isFinite(tv) || tv < 0 || tv > 100) {
              errors.push(`${label}.thresholds.${tKey} must be a number between 0 and 100 or null.`);
            }
          }
        }
      }

      const migMod = migrated.config?.modules?.[idx];
      if (migMod) {
        if (typeof migMod.thresholds?.diffCoverage === 'number' && !migMod.commands?.coverage) {
          errors.push(`${label}.thresholds.diffCoverage requires ${label}.commands.coverage (threshold without command is invalid).`);
        }
        if (typeof migMod.thresholds?.mutationScore === 'number' && !migMod.commands?.mutation) {
          errors.push(`${label}.thresholds.mutationScore requires ${label}.commands.mutation (threshold without command is invalid).`);
        }
      }
    });
  }

  if (parsed.exemptions !== undefined) {
    if (!Array.isArray(parsed.exemptions)) {
      errors.push('"exemptions" must be an array.');
    } else {
      parsed.exemptions.forEach((ex, idx) => {
        if (!ex || typeof ex !== 'object' || Array.isArray(ex)) {
          errors.push(`exemptions[${idx}] must be an object.`);
          return;
        }
        pushUnknownKeys(ex, CONFIG_SCHEMA_KEYS.exemption, `exemptions[${idx}]`, errors);
        if (typeof ex.id !== 'string' || !ex.id.trim()) {
          errors.push(`exemptions[${idx}].id must be non-empty.`);
        } else if (!STABLE_MUTANT_ID_RE.test(ex.id.trim())) {
          extraWarnings.push(`Legacy exemption id '${ex.id}' in '${ex.file || ''}' ignored; use '<mutatorName>@<line>:<col>#<sha256[0:8]>'.`);
        }
        if (typeof ex.file !== 'string' || !ex.file.trim()) {
          errors.push(`exemptions[${idx}].file must be non-empty.`);
        } else {
          try {
            resolveInsideRepo(repoRoot, ex.file);
          } catch (err) {
            errors.push(`exemptions[${idx}].file invalid: ${err.message}`);
          }
        }
        if (typeof ex.reason !== 'string' || ex.reason.trim().length < 5) {
          errors.push(`exemptions[${idx}].reason must be at least 5 characters.`);
        }
        if (ex.addedAt !== undefined && typeof ex.addedAt !== 'string') {
          errors.push(`exemptions[${idx}].addedAt must be a string.`);
        }
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: [...migrated.warnings, ...extraWarnings],
    config: errors.length === 0 ? migrated.config : null
  };
}

export function detectStack(repoRoot = '.') {
  const abs = path.resolve(repoRoot);
  const pkgPath = path.join(abs, 'package.json');

  if (fileExists(pkgPath)) {
    let pkg = {};
    try {
      pkg = JSON.parse(readFileSafe(pkgPath) || '{}');
    } catch {}
    const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const isTs = fileExists(path.join(abs, 'tsconfig.json')) || Boolean(deps.typescript);
    const hasStryker = Boolean(deps['@stryker-mutator/core']) || fileExists(path.join(abs, 'stryker.config.json'));

    const testCmd = scripts.test ? 'npm test' : 'node --test --test-reporter=dot "tests/**/*.test.mjs"';
    const covCmd = scripts['test:coverage']
      ? 'npm run test:coverage'
      : 'node --test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination=coverage/lcov.info --test-reporter=dot --test-reporter-destination=stdout "tests/**/*.test.mjs"';

    return {
      name: 'root',
      path: '.',
      language: isTs ? 'typescript' : 'javascript',
      commands: {
        lint: scripts.lint ? 'npm run --silent lint' : null,
        build: scripts.build ? 'npm run build' : null,
        test: testCmd,
        coverage: covCmd,
        coverageFile: 'coverage/lcov.info',
        mutation: hasStryker ? './node_modules/.bin/stryker run' : null
      },
      thresholds: {
        diffCoverage: 85,
        mutationScore: hasStryker ? 80 : null
      }
    };
  }

  const presets = [
    [['Cargo.toml'], 'rust', 'cargo clippy -- -D warnings', 'cargo build', 'cargo test', 'cargo tarpaulin --out Lcov --output-dir coverage', 'coverage/lcov.info'],
    [['go.mod'], 'go', 'go vet ./...', 'go build ./...', 'go test ./...', 'go test -coverprofile=coverage/cover.out ./...', 'coverage/cover.out'],
    [['pyproject.toml', 'requirements.txt'], 'python', null, null, 'pytest', 'pytest --cov --cov-report=xml:coverage/coverage.xml', 'coverage/coverage.xml'],
    [['pom.xml'], 'java', null, 'mvn test-compile', 'mvn test', 'mvn test jacoco:report', 'target/site/jacoco/jacoco.xml'],
    [['build.gradle', 'build.gradle.kts'], 'java', null, './gradlew classes', './gradlew test', './gradlew test jacocoTestReport', 'build/reports/jacoco/test/jacocoTestReport.xml']
  ];
  for (const [manifests, language, lint, build, test, coverage, coverageFile] of presets) {
    if (manifests.some((m) => fileExists(path.join(abs, m)))) {
      return {
        name: 'root',
        path: '.',
        language,
        commands: { lint, build, test, coverage, coverageFile, mutation: null },
        thresholds: { diffCoverage: 85, mutationScore: null }
      };
    }
  }

  return {
    name: 'root',
    path: '.',
    language: 'generic',
    commands: { lint: null, build: null, test: null, coverage: null, coverageFile: null, mutation: null },
    thresholds: { diffCoverage: null, mutationScore: null }
  };
}

export function generateConfig(repoRoot = '.') {
  const detected = detectStack(repoRoot);
  return {
    $schema: './schemas/sdlc-config.schema.json',
    version: '0.1.0',
    ci: {
      runsOn: "${{ vars.SDLC_RUNS_ON || 'ubuntu-latest' }}",
      checkName: DEFAULT_QUALITY_GATE_CHECK
    },
    archlens: {
      enabled: true,
      policyPath: '.archlens/policy.json'
    },
    modules: [detected],
    exemptions: []
  };
}

export function upgradeConfigToV010(rawCfg) {
  const { config } = migrateConfigObject(rawCfg);
  if (!config) return null;
  const cleanModules = (config.modules || []).map((mod) => ({
    name: mod.name,
    path: mod.path,
    ...(mod.language ? { language: mod.language } : {}),
    commands: {
      lint: mod.commands?.lint ?? null,
      build: mod.commands?.build ?? null,
      test: mod.commands?.test ?? null,
      coverage: mod.commands?.coverage ?? null,
      coverageFile: mod.commands?.coverageFile ?? null,
      mutation: mod.commands?.mutation ?? null
    },
    thresholds: {
      diffCoverage: mod.commands?.coverage ? (mod.thresholds?.diffCoverage ?? DEFAULT_QUALITY_THRESHOLDS.diffCoverage) : null,
      mutationScore: mod.commands?.mutation ? (mod.thresholds?.mutationScore ?? 80) : null
    }
  }));
  return {
    $schema: './schemas/sdlc-config.schema.json',
    version: '0.1.0',
    ci: {
      runsOn: config.ci?.runsOn || "${{ vars.SDLC_RUNS_ON || 'ubuntu-latest' }}",
      checkName: config.ci?.checkName || DEFAULT_QUALITY_GATE_CHECK
    },
    archlens: {
      enabled: config.archlens?.enabled !== false,
      policyPath: config.archlens?.policyPath || '.archlens/policy.json'
    },
    modules: cleanModules,
    exemptions: Array.isArray(config.exemptions) ? config.exemptions : []
  };
}

export function formatMutantIdentity(mut) {
  const name = String(mut?.mutatorName || '').trim();
  const line = mut?.location?.start?.line;
  const col = mut?.location?.start?.column;
  if (!name || !Number.isInteger(line) || line < 1 || !Number.isInteger(col) || col < 0) return null;
  const hash = crypto.createHash('sha256').update(String(mut?.replacement ?? ''), 'utf8').digest('hex').slice(0, 8);
  return `${name}@${line}:${col}#${hash}`;
}

export function resolveActiveExemptions(exemptions = []) {
  const activeSet = new Set();
  const warnings = [];
  for (const ex of Array.isArray(exemptions) ? exemptions : []) {
    if (!ex || typeof ex !== 'object') continue;
    const id = String(ex.id || '').trim();
    const file = String(ex.file || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (!id || !file) continue;
    if (!STABLE_MUTANT_ID_RE.test(id)) {
      warnings.push(`Legacy mutant exemption id '${id}' in '${file}' ignored; use '<mutatorName>@<line>:<col>#<sha256[0:8]>'.`);
      continue;
    }
    activeSet.add(`${file}::${id}`);
  }
  return { activeSet, warnings };
}

export function matchesMutatePatterns(relFile, patterns) {
  let matched = false;
  for (const raw of patterns) {
    const neg = raw.startsWith('!');
    const clean = (neg ? raw.slice(1) : raw).replace(/\\/g, '/').replace(/^\.\//, '').replace(/:\d+(?:-\d+)?$/, '');
    const re = new RegExp(
      '^' +
        clean
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\\\{([^{}\\]+)\\\}/g, (_, g) => `(?:${g.split(',').join('|')})`)
          .replace(/\*\*\//g, '\0D\0')
          .replace(/\*\*/g, '\0G\0')
          .replace(/\*/g, '[^/]*')
          .replace(/\?/g, '[^/]')
          .replace(/\0D\0/g, '(?:.+/)?')
          .replace(/\0G\0/g, '.*') +
        '$'
    );
    if (re.test(relFile)) matched = !neg;
  }
  return matched;
}

export function listExemptions(repoRoot = '.') {
  const { config } = loadConfig(repoRoot);
  return Array.isArray(config?.exemptions) ? config.exemptions : [];
}

export function addExemption({ id, file, reason, repoRoot = '.' } = {}) {
  let cleanId = String(id || '').trim();
  const cleanFile = String(file || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  const cleanReason = String(reason || '').trim();
  if (!cleanId) throw new Error('Exemption requires a non-empty mutant id.');
  resolveInsideRepo(repoRoot, cleanFile);
  if (cleanReason.length < 5) {
    throw new Error('Exemption requires a reason of at least 5 characters.');
  }
  if (!STABLE_MUTANT_ID_RE.test(cleanId)) {
    const repPath = path.resolve(repoRoot, 'reports/mutation/mutation.json');
    if (fileExists(repPath)) {
      try {
        const rep = JSON.parse(fs.readFileSync(repPath, 'utf8'));
        for (const [rawFile, fileObj] of Object.entries(rep?.files || {})) {
          const normRep = rawFile.replace(/\\/g, '/').replace(/^\.\//, '');
          if (normRep === cleanFile || (path.isAbsolute(rawFile) && normRep.endsWith(`/${cleanFile}`))) {
            const hit = (fileObj?.mutants || []).find((m) => String(m.id) === cleanId);
            const derived = hit ? formatMutantIdentity(hit) : null;
            if (derived) { cleanId = derived; break; }
          }
        }
      } catch {}
    }
    if (!STABLE_MUTANT_ID_RE.test(cleanId)) {
      throw new Error(`Exemption id '${cleanId}' must match '<mutatorName>@<line>:<col>#<sha256[0:8]>'.`);
    }
  }

  const cfgPath = resolveConfigPath(repoRoot);
  const lockPath = path.resolve(repoRoot, '.agent/.sdlc-config.lock');
  return withFileLock(lockPath, () => {
    const base = fileExists(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : generateConfig(repoRoot);
    const list = Array.isArray(base.exemptions) ? [...base.exemptions] : [];
    const entry = {
      id: cleanId,
      file: cleanFile,
      reason: cleanReason,
      addedAt: new Date().toISOString()
    };
    const existingIdx = list.findIndex((e) => e.id === cleanId && e.file === cleanFile);
    if (existingIdx !== -1) list[existingIdx] = entry;
    else list.push(entry);
    base.exemptions = list;
    writeFileAtomic(cfgPath, JSON.stringify(base, null, 2) + '\n');
    return { success: true, exemption: entry };
  });
}

function stableJson(val) {
  if (val === null || val === undefined || typeof val !== 'object') return JSON.stringify(val ?? null);
  if (Array.isArray(val)) return `[${val.map(stableJson).join(',')}]`;
  return `{${Object.keys(val).sort().map((k) => `${JSON.stringify(k)}:${stableJson(val[k])}`).join(',')}}`;
}

function parseJsonSafe(raw) {
  if (raw === null || raw === undefined) return { ok: false, present: false, value: null };
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? { ok: true, present: true, value } : { ok: false, present: true, value: null };
  } catch {
    return { ok: false, present: true, value: null };
  }
}

function normModDir(modPath) {
  const clean = String(modPath || '.').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  return clean || '.';
}

function mergeStrykerPolicy(baseParsed, headParsed, relPath, addTrigger) {
  if (!baseParsed.present && !headParsed.present) return null;
  if (headParsed.present && !headParsed.ok) {
    addTrigger(relPath);
    return baseParsed.ok ? structuredClone(baseParsed.value) : null;
  }
  const normPos = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');
  const normNeg = (p) => `!${String(p).slice(1).replace(/\\/g, '/').replace(/^\.\//, '')}`;
  const stripMut = ({ mutate: _m, ...rest }) => rest;
  if (!baseParsed.ok) {
    const eff = structuredClone(headParsed.value);
    if (Array.isArray(eff.mutate)) {
      if (eff.mutate.some((p) => String(p).startsWith('!'))) addTrigger(relPath);
      eff.mutate = [...new Set(eff.mutate.filter((p) => !String(p).startsWith('!')).map(normPos))];
    }
    if (stableJson(stripMut(eff)) !== '{}') addTrigger(relPath);
    return eff;
  }
  if (!headParsed.present) {
    addTrigger(relPath);
    return structuredClone(baseParsed.value);
  }
  const eff = structuredClone(headParsed.value);
  const bHasMut = Array.isArray(baseParsed.value.mutate);
  const hHasMut = Array.isArray(headParsed.value.mutate);
  if (!bHasMut && hHasMut) {
    addTrigger(relPath);
    delete eff.mutate;
  } else if (bHasMut || hHasMut) {
    const bMut = bHasMut ? baseParsed.value.mutate : [];
    const hMut = hHasMut ? headParsed.value.mutate : [];
    const bPos = [...new Set(bMut.filter((p) => !String(p).startsWith('!')).map(normPos))];
    const hPos = [...new Set(hMut.filter((p) => !String(p).startsWith('!')).map(normPos))];
    const bNegSet = new Set(bMut.filter((p) => String(p).startsWith('!')).map(normNeg));
    const hNeg = [...new Set(hMut.filter((p) => String(p).startsWith('!')).map(normNeg))];
    if (!hHasMut || bPos.some((p) => !hPos.includes(p)) || hNeg.some((n) => !bNegSet.has(n))) addTrigger(relPath);
    eff.mutate = [...new Set([...bPos, ...hPos]), ...hNeg.filter((n) => bNegSet.has(n))];
  }
  if (stableJson(stripMut(baseParsed.value)) !== stableJson(stripMut(headParsed.value))) addTrigger(relPath);
  return eff;
}

export function isEngineOwnerRepo({ repoRoot = '.', baseSha = null } = {}) {
  if (baseSha === EMPTY_TREE_SHA) return false;
  const raw = baseSha
    ? readBlobs([`${baseSha}:package.json`], repoRoot).get(`${baseSha}:package.json`) ?? null
    : (() => { try { return readFileSafe(resolveInsideRepo(repoRoot, 'package.json')); } catch { return null; } })();
  const parsed = parseJsonSafe(raw);
  return parsed.ok && parsed.value.name === '@fmatar/agentic-sdlc';
}

export function loadEffectivePolicy({ repoRoot = '.', baseSha = null, headSha = null, changedPaths = null } = {}) {
  const hasBase = Boolean(baseSha && baseSha !== EMPTY_TREE_SHA);
  const specs = [
    ...(hasBase ? ['.agent/sdlc-config.json', 'stryker.config.json'].map((f) => `${baseSha}:${f}`) : []),
    ...(headSha ? ['.agent/sdlc-config.json', 'stryker.config.json'].map((f) => `${headSha}:${f}`) : [])
  ];
  const blobs = specs.length > 0 ? readBlobs(specs, repoRoot) : new Map();
  const safeReadWorktree = (f) => {
    try { return readFileSafe(resolveInsideRepo(repoRoot, f)); } catch { return null; }
  };
  const getBaseRaw = (f) => (hasBase ? blobs.get(`${baseSha}:${f}`) ?? null : null);
  const getHeadRaw = (f) => (headSha ? blobs.get(`${headSha}:${f}`) ?? null : safeReadWorktree(f));

  const baseCfgParsed = parseJsonSafe(getBaseRaw('.agent/sdlc-config.json'));
  const headCfgParsed = parseJsonSafe(getHeadRaw('.agent/sdlc-config.json'));
  const baseRootStryker = parseJsonSafe(getBaseRaw('stryker.config.json'));
  const headRootStryker = parseJsonSafe(getHeadRaw('stryker.config.json'));
  const validMods = (arr) =>
    Array.isArray(arr) ? arr.filter((m) => m && typeof m === 'object' && !Array.isArray(m) && typeof m.name === 'string' && Boolean(m.name.trim())) : [];

  if (!hasBase || !baseCfgParsed.present || !baseCfgParsed.ok) {
    const headCfg = headCfgParsed.ok ? migrateConfigObject(headCfgParsed.value).config : generateConfig(repoRoot);
    const bootMods = validMods(headCfg?.modules);
    const subDirs = [...new Set(bootMods.map((m) => normModDir(m.path)).filter((d) => d !== '.'))];
    const subBlobs = headSha && subDirs.length > 0 ? readBlobs(subDirs.map((d) => `${headSha}:${d}/stryker.config.json`), repoRoot) : new Map();
    const strykerByModule = {};
    for (const m of bootMods) {
      const dir = normModDir(m.path);
      const parsed = dir === '.' ? headRootStryker : parseJsonSafe(headSha ? subBlobs.get(`${headSha}:${dir}/stryker.config.json`) ?? null : safeReadWorktree(`${dir}/stryker.config.json`));
      strykerByModule[m.name] = parsed.ok ? structuredClone(parsed.value) : null;
    }
    return {
      config: headCfg,
      stryker: headRootStryker.ok ? structuredClone(headRootStryker.value) : {},
      strykerByModule,
      policySource: 'bootstrap',
      policyTriggers: [],
      pendingExemptions: []
    };
  }

  const triggerMap = new Map();
  const addTrigger = (file) => {
    if (!triggerMap.has(file)) triggerMap.set(file, { file, type: 'GATE_POLICY_DRIFT', scope: 'architectural' });
  };

  const baseCfg = migrateConfigObject(baseCfgParsed.value).config;
  let headCfg = baseCfg;
  if (!headCfgParsed.present || !headCfgParsed.ok) {
    addTrigger('.agent/sdlc-config.json');
  } else {
    headCfg = migrateConfigObject(headCfgParsed.value).config;
  }

  const baseArchEn = baseCfg.archlens?.enabled !== false;
  const headArchEn = headCfg.archlens?.enabled !== false;
  const basePolPath = baseCfg.archlens?.policyPath || '.archlens/policy.json';
  const headPolPath = headCfg.archlens?.policyPath || '.archlens/policy.json';
  if (baseArchEn && (!headArchEn || headPolPath !== basePolPath)) addTrigger('.agent/sdlc-config.json');

  const baseModList = validMods(baseCfg.modules);
  const headModList = validMods(headCfg.modules);
  if (!Array.isArray(headCfg.modules) || headModList.length !== headCfg.modules.length || headModList.length === 0) {
    addTrigger('.agent/sdlc-config.json');
  }
  const baseByName = new Map(baseModList.map((m) => [m.name, m]));
  const headByName = new Map(headModList.map((m) => [m.name, m]));
  const mergeFloor = (bVal, hVal) => {
    const b = typeof bVal === 'number' ? bVal : null;
    const h = typeof hVal === 'number' ? hVal : null;
    if (b === null && h === null) return { value: null, loosened: false };
    if (b !== null && (h === null || h < b)) return { value: b, loosened: true };
    return { value: h, loosened: false };
  };

  const effModules = [];
  for (const hMod of headModList) {
    const bMod = baseByName.get(hMod.name);
    if (!bMod) {
      effModules.push(structuredClone(hMod));
      continue;
    }
    if (normModDir(hMod.path) !== normModDir(bMod.path)) addTrigger('.agent/sdlc-config.json');
    for (const ck of CONFIG_SCHEMA_KEYS.commands) {
      if (stableJson(hMod.commands?.[ck] ?? null) !== stableJson(bMod.commands?.[ck] ?? null)) {
        addTrigger('.agent/sdlc-config.json');
      }
    }
    const bActiveCov = bMod.commands?.coverage ? bMod.thresholds?.diffCoverage : null;
    const bActiveMut = bMod.commands?.mutation ? bMod.thresholds?.mutationScore : null;
    const covM = mergeFloor(bActiveCov, hMod.thresholds?.diffCoverage);
    const mutM = mergeFloor(bActiveMut, hMod.thresholds?.mutationScore);
    if (covM.loosened || mutM.loosened) addTrigger('.agent/sdlc-config.json');
    effModules.push({
      ...structuredClone(hMod),
      thresholds: { diffCoverage: covM.value, mutationScore: mutM.value }
    });
  }
  for (const bMod of baseModList) {
    if (!headByName.has(bMod.name)) {
      addTrigger('.agent/sdlc-config.json');
      effModules.push(structuredClone(bMod));
    }
  }

  const exKey = (ex) => `${String(ex?.file || '').replace(/\\/g, '/').replace(/^\.\//, '')}::${String(ex?.id || '').trim()}`;
  const baseEx = Array.isArray(baseCfg.exemptions) ? baseCfg.exemptions : [];
  const baseExSet = new Set(baseEx.map(exKey));
  const pendingExemptions = (Array.isArray(headCfg.exemptions) ? headCfg.exemptions : []).filter(
    (ex) => ex && typeof ex === 'object' && !baseExSet.has(exKey(ex))
  );

  const subDirs = [...new Set([...baseModList, ...headModList].map((m) => normModDir(m.path)).filter((d) => d !== '.'))];
  const subSpecs = [
    ...subDirs.map((d) => `${baseSha}:${d}/stryker.config.json`),
    ...(headSha ? subDirs.map((d) => `${headSha}:${d}/stryker.config.json`) : [])
  ];
  const subBlobs = subSpecs.length > 0 ? readBlobs(subSpecs, repoRoot) : new Map();
  const strykerByDir = new Map([['.', mergeStrykerPolicy(baseRootStryker, headRootStryker, 'stryker.config.json', addTrigger)]]);
  for (const dir of subDirs) {
    const rel = `${dir}/stryker.config.json`;
    const bSub = parseJsonSafe(subBlobs.get(`${baseSha}:${rel}`) ?? null);
    const hSub = parseJsonSafe(headSha ? subBlobs.get(`${headSha}:${rel}`) ?? null : safeReadWorktree(rel));
    strykerByDir.set(dir, mergeStrykerPolicy(bSub, hSub, rel, addTrigger));
  }
  const strykerByModule = {};
  for (const mod of effModules) {
    strykerByModule[mod.name] = strykerByDir.get(normModDir(mod.path)) ?? null;
  }

  if (!isEngineOwnerRepo({ repoRoot, baseSha })) {
    const diffPaths = Array.isArray(changedPaths)
      ? changedPaths
      : readChangeSet({ baseSha, headSha, source: headSha ? 'commit' : 'worktree', repoRoot }).paths;
    for (const p of diffPaths) {
      if (/^\.agent\/scripts\//.test(p)) addTrigger(p);
    }
  }

  return {
    config: {
      ...structuredClone(headCfg),
      archlens: { enabled: Boolean(baseArchEn || headArchEn), policyPath: baseArchEn ? basePolPath : headPolPath },
      modules: effModules,
      exemptions: structuredClone(baseEx)
    },
    stryker: strykerByDir.get('.') ?? {},
    strykerByModule,
    policySource: 'base+head',
    policyTriggers: [...triggerMap.values()],
    pendingExemptions
  };
}
