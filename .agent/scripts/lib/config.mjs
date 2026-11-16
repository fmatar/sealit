import fs from 'node:fs';
import path from 'node:path';
import {
  fileExists,
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

const LEGACY_TOP_KEYS = ['gates', 'testing', 'lanes', 'projectManagement', 'profile', 'generatedAt'];
const COMMAND_KEYS = ['lint', 'build', 'test', 'coverage', 'mutation'];

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
      const defaultMut = mod.commands.mutation ? 80 : DEFAULT_QUALITY_THRESHOLDS.mutationScore;
      mod.thresholds = {
        diffCoverage: normalizeThreshold(mod.thresholds?.diffCoverage, DEFAULT_QUALITY_THRESHOLDS.diffCoverage),
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

  if (typeof parsed.version !== 'string' || !parsed.version.trim()) {
    errors.push('Configuration requires a non-empty string "version".');
  }

  if (!Array.isArray(parsed.modules) || parsed.modules.length < 1) {
    errors.push('Configuration "modules" must be an array containing at least one module.');
  } else {
    parsed.modules.forEach((mod, idx) => {
      const label = `modules[${idx}]`;
      if (!mod || typeof mod !== 'object' || Array.isArray(mod)) {
        errors.push(`${label} must be an object.`);
        return;
      }
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
        for (const cmdKey of COMMAND_KEYS) {
          const spec = mod.commands[cmdKey];
          if (spec === undefined || spec === null) continue;
          try {
            parseCommandArgv(spec);
          } catch (err) {
            errors.push(`${label}.commands.${cmdKey} invalid: ${err.message}`);
          }
        }
        if (
          mod.commands.coverageFile !== undefined &&
          mod.commands.coverageFile !== null &&
          (typeof mod.commands.coverageFile !== 'string' || !mod.commands.coverageFile.trim())
        ) {
          errors.push(`${label}.commands.coverageFile must be a non-empty string or null.`);
        }
      }

      if (mod.thresholds !== undefined) {
        if (!mod.thresholds || typeof mod.thresholds !== 'object' || Array.isArray(mod.thresholds)) {
          errors.push(`${label}.thresholds must be an object.`);
        } else {
          for (const tKey of ['diffCoverage', 'mutationScore']) {
            const tv = mod.thresholds[tKey];
            if (tv === undefined || tv === null) continue;
            if (typeof tv !== 'number' || !Number.isFinite(tv) || tv < 0 || tv > 100) {
              errors.push(`${label}.thresholds.${tKey} must be a number between 0 and 100 or null.`);
            }
          }
        }
      }
    });
  }

  if (parsed.exemptions !== undefined) {
    if (!Array.isArray(parsed.exemptions)) {
      errors.push('"exemptions" must be an array.');
    } else {
      parsed.exemptions.forEach((ex, idx) => {
        if (!ex || typeof ex !== 'object') {
          errors.push(`exemptions[${idx}] must be an object.`);
          return;
        }
        if (typeof ex.id !== 'string' || !ex.id.trim()) errors.push(`exemptions[${idx}].id must be non-empty.`);
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
      });
    }
  }

  const migrated = migrateConfigObject(parsed);
  return {
    valid: errors.length === 0,
    errors,
    warnings: migrated.warnings,
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

  if (fileExists(path.join(abs, 'Cargo.toml'))) {
    return {
      name: 'root',
      path: '.',
      language: 'rust',
      commands: {
        lint: 'cargo clippy -- -D warnings',
        build: 'cargo build',
        test: 'cargo test',
        coverage: 'cargo tarpaulin --out Lcov --output-dir coverage',
        coverageFile: 'coverage/lcov.info',
        mutation: null
      },
      thresholds: { diffCoverage: 85, mutationScore: null }
    };
  }

  if (fileExists(path.join(abs, 'go.mod'))) {
    return {
      name: 'root',
      path: '.',
      language: 'go',
      commands: {
        lint: 'go vet ./...',
        build: 'go build ./...',
        test: 'go test ./...',
        coverage: 'go test -coverprofile=coverage/cover.out ./...',
        coverageFile: 'coverage/cover.out',
        mutation: null
      },
      thresholds: { diffCoverage: 85, mutationScore: null }
    };
  }

  if (fileExists(path.join(abs, 'pyproject.toml')) || fileExists(path.join(abs, 'requirements.txt'))) {
    return {
      name: 'root',
      path: '.',
      language: 'python',
      commands: {
        lint: null,
        build: null,
        test: 'pytest',
        coverage: 'pytest --cov --cov-report=xml:coverage/coverage.xml',
        coverageFile: 'coverage/coverage.xml',
        mutation: null
      },
      thresholds: { diffCoverage: 85, mutationScore: null }
    };
  }

  if (fileExists(path.join(abs, 'pom.xml'))) {
    return {
      name: 'root',
      path: '.',
      language: 'java',
      commands: {
        lint: null,
        build: 'mvn test-compile',
        test: 'mvn test',
        coverage: 'mvn test jacoco:report',
        coverageFile: 'target/site/jacoco/jacoco.xml',
        mutation: null
      },
      thresholds: { diffCoverage: 85, mutationScore: null }
    };
  }

  if (fileExists(path.join(abs, 'build.gradle')) || fileExists(path.join(abs, 'build.gradle.kts'))) {
    return {
      name: 'root',
      path: '.',
      language: 'java',
      commands: {
        lint: null,
        build: './gradlew classes',
        test: './gradlew test',
        coverage: './gradlew test jacocoTestReport',
        coverageFile: 'build/reports/jacoco/test/jacocoTestReport.xml',
        mutation: null
      },
      thresholds: { diffCoverage: 85, mutationScore: null }
    };
  }

  return {
    name: 'root',
    path: '.',
    language: 'generic',
    commands: {
      lint: null,
      build: null,
      test: null,
      coverage: null,
      coverageFile: null,
      mutation: null
    },
    thresholds: { diffCoverage: 85, mutationScore: null }
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
      diffCoverage: mod.thresholds?.diffCoverage ?? DEFAULT_QUALITY_THRESHOLDS.diffCoverage,
      mutationScore: mod.thresholds?.mutationScore ?? DEFAULT_QUALITY_THRESHOLDS.mutationScore
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

export function listExemptions(repoRoot = '.') {
  const { config } = loadConfig(repoRoot);
  return Array.isArray(config?.exemptions) ? config.exemptions : [];
}

export function addExemption({ id, file, reason, repoRoot = '.' } = {}) {
  const cleanId = String(id || '').trim();
  const cleanFile = String(file || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  const cleanReason = String(reason || '').trim();
  if (!cleanId) throw new Error('Exemption requires a non-empty mutant id.');
  resolveInsideRepo(repoRoot, cleanFile);
  if (cleanReason.length < 5) {
    throw new Error('Exemption requires a reason of at least 5 characters.');
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
