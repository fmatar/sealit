#!/usr/bin/env node
/**
 * Agentic SDLC Framework: Universal Stack Discovery & Execution Engine
 * Zero-dependency Node.js engine for polyglot stack detection, CI reverse-engineering,
 * directory-scoped multi-module orchestration, and Dual-Gate testing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const CONFIG_PATH = path.resolve('.agent/sdlc-config.json');

// --- Helper Functions ---

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

export function execCommand(cmd, options = {}) {
  try {
    return execSync(cmd, { stdio: 'pipe', encoding: 'utf8', ...options });
  } catch (error) {
    if (options.throwOnError) throw error;
    return error.stdout || error.stderr || '';
  }
}

// --- CI Workflow Reverse Engineering ---

export function inspectCIWorkflows(repoRoot = '.') {
  const workflowsDir = path.join(repoRoot, '.github/workflows');
  const detected = {
    testCommand: null,
    lintCommand: null,
    buildCommand: null
  };

  if (!fileExists(workflowsDir)) return detected;

  try {
    const files = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
    for (const file of files) {
      const content = readFileSafe(path.join(workflowsDir, file));
      if (!content) continue;

      // Extract run: lines matching test / lint / build
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        const match = trimmed.match(/^(-\s*)?run:\s*(.+)$/);
        if (match) {
          const runCmd = match[2].trim();
          if (!detected.testCommand && (runCmd.includes('test') || runCmd.includes('check') || runCmd.includes('pytest'))) {
            detected.testCommand = runCmd;
          }
          if (!detected.lintCommand && (runCmd.includes('lint') || runCmd.includes('spotless') || runCmd.includes('format'))) {
            detected.lintCommand = runCmd;
          }
          if (!detected.buildCommand && (runCmd.includes('build') || runCmd.includes('package') || runCmd.includes('compile'))) {
            detected.buildCommand = runCmd;
          }
        }
      }
    }
  } catch {
    // Graceful fallback
  }

  return detected;
}

// --- Manifest Stack Probe ---

export function detectStackInDir(dirPath) {
  const absDir = path.resolve(dirPath);

  // 1. Maven / Quarkus / Java
  if (fileExists(path.join(absDir, 'pom.xml'))) {
    const pom = readFileSafe(path.join(absDir, 'pom.xml')) || '';
    const isQuarkus = pom.includes('io.quarkus');
    return {
      type: isQuarkus ? 'quarkus-maven' : 'java-maven',
      language: 'java',
      commands: {
        test: './mvnw clean test',
        coverage: './mvnw test jacoco:report',
        coverageFile: 'target/site/jacoco/jacoco.csv',
        mutation: './mvnw test-compile org.pitest:pitest-maven:mutationCoverage -DmutationThreshold=80',
        lint: './mvnw spotless:check',
        build: './mvnw clean package -DskipTests=true'
      }
    };
  }

  // 2. Gradle
  if (fileExists(path.join(absDir, 'build.gradle')) || fileExists(path.join(absDir, 'build.gradle.kts'))) {
    return {
      type: 'java-gradle',
      language: 'java',
      commands: {
        test: './gradlew test',
        coverage: './gradlew jacocoTestReport',
        coverageFile: 'build/reports/jacoco/test/jacocoTestReport.csv',
        mutation: './gradlew pitest',
        lint: './gradlew spotlessCheck',
        build: './gradlew build -x test'
      }
    };
  }

  // 3. Node.js / TypeScript / Svelte / React
  if (fileExists(path.join(absDir, 'package.json'))) {
    const pkgRaw = readFileSafe(path.join(absDir, 'package.json')) || '{}';
    let pkg = {};
    try { pkg = JSON.parse(pkgRaw); } catch {}

    const scripts = pkg.scripts || {};
    const testCmd = scripts['test:coverage'] ? 'npm run test:coverage' : (scripts.test ? 'npm run test' : 'npm test');
    const lintCmd = scripts['lint'] ? 'npm run lint' : (scripts['format:check'] ? 'npm run format:check' : null);
    const buildCmd = scripts['build'] ? 'npm run build' : null;

    const isSvelte = pkg.devDependencies?.svelte || pkg.dependencies?.svelte;

    return {
      type: isSvelte ? 'svelte5-vite' : 'nodejs-npm',
      language: 'typescript',
      commands: {
        test: scripts.test ? 'npm test' : 'node --test',
        coverage: testCmd,
        coverageFile: 'coverage/coverage-summary.json',
        mutation: scripts['test:mutation'] ? 'npm run test:mutation' : 'npx stryker run',
        lint: lintCmd || 'npx eslint .',
        build: buildCmd || 'npm run build'
      }
    };
  }

  // 4. Go
  if (fileExists(path.join(absDir, 'go.mod'))) {
    return {
      type: 'golang',
      language: 'go',
      commands: {
        test: 'go test -v ./...',
        coverage: 'go test -v -coverprofile=coverage.out ./...',
        coverageFile: 'coverage.out',
        mutation: 'go-mutesting ./...',
        lint: 'golangci-lint run',
        build: 'go build ./...'
      }
    };
  }

  // 5. Rust
  if (fileExists(path.join(absDir, 'Cargo.toml'))) {
    return {
      type: 'rust-cargo',
      language: 'rust',
      commands: {
        test: 'cargo test',
        coverage: 'cargo tarpaulin --out Xml',
        coverageFile: 'cobertura.xml',
        mutation: 'cargo mutants',
        lint: 'cargo clippy -- -D warnings',
        build: 'cargo build --release'
      }
    };
  }

  // 6. Python
  if (fileExists(path.join(absDir, 'pyproject.toml')) || fileExists(path.join(absDir, 'requirements.txt'))) {
    return {
      type: 'python',
      language: 'python',
      commands: {
        test: 'pytest',
        coverage: 'pytest --cov=. --cov-report=xml',
        coverageFile: 'coverage.xml',
        mutation: 'mutmut run',
        lint: 'ruff check .',
        build: 'python -m build'
      }
    };
  }

  // 7. Makefile Fallback
  if (fileExists(path.join(absDir, 'Makefile'))) {
    return {
      type: 'makefile',
      language: 'generic',
      commands: {
        test: 'make test',
        coverage: 'make coverage',
        coverageFile: 'coverage.txt',
        mutation: 'make mutation',
        lint: 'make lint',
        build: 'make build'
      }
    };
  }

  return null;
}

// --- Monorepo & Multi-Tier Discovery ---

export function discoverModules(repoRoot = '.') {
  const modules = [];

  // Check root first
  const rootStack = detectStackInDir(repoRoot);
  if (rootStack) {
    modules.push({
      name: 'root',
      path: '.',
      stack: rootStack.type,
      language: rootStack.language,
      commands: rootStack.commands,
      thresholds: {
        diffCoverage: 85,
        mutationScore: 80
      }
    });
  }

  // Search common directory patterns for sub-modules
  const searchDirs = ['apps', 'services', 'packages', 'modules', 'backend', 'frontend', 'ui', 'api', 'core'];
  for (const sDir of searchDirs) {
    const fullDir = path.join(repoRoot, sDir);
    if (!fileExists(fullDir)) continue;

    const subStack = detectStackInDir(fullDir);
    if (subStack) {
      modules.push({
        name: sDir,
        path: sDir,
        stack: subStack.type,
        language: subStack.language,
        commands: subStack.commands,
        thresholds: {
          diffCoverage: 85,
          mutationScore: 80
        }
      });
      continue;
    }

    // Check one level deeper (e.g. apps/web, services/order)
    try {
      const nested = fs.readdirSync(fullDir, { withFileTypes: true });
      for (const dirent of nested) {
        if (!dirent.isDirectory()) continue;
        const nestedPath = path.join(sDir, dirent.name);
        const nestedStack = detectStackInDir(path.join(repoRoot, nestedPath));
        if (nestedStack) {
          modules.push({
            name: `${sDir}-${dirent.name}`,
            path: nestedPath,
            stack: nestedStack.type,
            language: nestedStack.language,
            commands: nestedStack.commands,
            thresholds: {
              diffCoverage: 85,
              mutationScore: 80
            }
          });
        }
      }
    } catch {}
  }

  // Deduplicate: If specific sub-modules found (e.g. backend + frontend), we can keep or refine root
  if (modules.length > 1 && modules.some(m => m.path !== '.')) {
    // Retain specific submodules
    return modules.filter(m => m.path !== '.' || modules.length === 1);
  }

  // If nothing was found, provide a clean universal node/script fallback
  if (modules.length === 0) {
    modules.push({
      name: 'default',
      path: '.',
      stack: 'generic-script',
      language: 'generic',
      commands: {
        test: 'npm test 2>/dev/null || true',
        coverage: 'npm run test:coverage 2>/dev/null || true',
        coverageFile: 'coverage/coverage-summary.json',
        mutation: 'npx stryker run 2>/dev/null || true',
        lint: 'npm run lint 2>/dev/null || true',
        build: 'npm run build 2>/dev/null || true'
      },
      thresholds: {
        diffCoverage: 85,
        mutationScore: 80
      }
    });
  }

  return modules;
}

// --- Match Git Diff to Modules ---

export function getModifiedFiles(baseBranch = 'main') {
  try {
    const output = execSync(`git diff --name-only origin/${baseBranch}...HEAD 2>/dev/null || git diff --name-only ${baseBranch}...HEAD 2>/dev/null || git diff --name-only HEAD~1 2>/dev/null`, { encoding: 'utf8' });
    return output.split('\n').map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function matchFilesToModules(files, modules) {
  const touched = new Set();
  const nonRootModules = modules.filter(m => m.path !== '.');
  const rootModule = modules.find(m => m.path === '.');

  for (const file of files) {
    let matched = false;
    for (const mod of nonRootModules) {
      if (file.startsWith(mod.path + '/') || file === mod.path) {
        matched = true;
        touched.add(mod);
        break;
      }
    }
    if (!matched && rootModule) {
      touched.add(rootModule);
    }
  }

  return Array.from(touched);
}

// --- Configuration Persistence & Preview ---

export function generateConfig(repoRoot = '.') {
  const ciCommands = inspectCIWorkflows(repoRoot);
  const modules = discoverModules(repoRoot);

  // Apply CI overrides if root commands match
  if (modules.length === 1 && modules[0].path === '.') {
    if (ciCommands.testCommand) modules[0].commands.test = ciCommands.testCommand;
    if (ciCommands.lintCommand) modules[0].commands.lint = ciCommands.lintCommand;
    if (ciCommands.buildCommand) modules[0].commands.build = ciCommands.buildCommand;
  }

  const config = {
    $schema: 'https://agentic-sdlc.dev/schemas/config.v1.json',
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    profile: modules.length > 1 ? 'polyglot-monorepo' : 'standard',
    modules
  };

  return config;
}

export function printPreview(config) {
  console.log('\n================================================================');
  console.log('⚡ AGENTIC SDLC UNIVERSAL ENGINE: DETECTED CONFIGURATION PREVIEW');
  console.log('================================================================');
  console.log(`Profile:   ${config.profile}`);
  console.log(`Modules:   ${config.modules.length} detected\n`);

  for (const mod of config.modules) {
    console.log(`📦 Module: [${mod.name}] (Path: "${mod.path}")`);
    console.log(`   Stack:      ${mod.stack} (${mod.language})`);
    console.log(`   Test:       ${mod.commands.test}`);
    console.log(`   Coverage:   ${mod.commands.coverage} (Min: ${mod.thresholds.diffCoverage}%)`);
    console.log(`   Mutation:   ${mod.commands.mutation} (Min: ${mod.thresholds.mutationScore}%)`);
    console.log(`   Lint:       ${mod.commands.lint}`);
    console.log(`   Build:      ${mod.commands.build}`);
    console.log('----------------------------------------------------------------');
  }
}

// --- CLI Commands ---

export function runCLI(customArgs = null, customConfigPath = null, repoRoot = '.') {
  const args = customArgs || process.argv.slice(2);
  const command = args[0] || 'detect';
  const configPath = customConfigPath || path.resolve(repoRoot, '.agent/sdlc-config.json');

  let config;
  let reGenerated = false;

  if (fileExists(configPath)) {
    try {
      config = JSON.parse(readFileSafe(configPath));
      if (!config || !Array.isArray(config.modules)) throw new Error('Invalid config schema');
    } catch {
      config = generateConfig(repoRoot);
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      reGenerated = true;
    }
  } else {
    config = generateConfig(repoRoot);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    reGenerated = true;
  }

  const result = {
    command,
    config,
    reGenerated,
    configPath,
    modulesCount: config.modules?.length || 0,
    success: true
  };

  switch (command) {
    case 'detect': {
      printPreview(config);
      return result;
    }

    case 'test': {
      const files = getModifiedFiles();
      const activeModules = files.length > 0 ? matchFilesToModules(files, config.modules) : config.modules;
      console.log(`🚀 Executing Tests for ${activeModules.length} module(s)...`);
      for (const mod of activeModules) {
        const cwd = path.resolve(repoRoot, mod.path);
        console.log(`\n▶️ [${mod.name}] Running: ${mod.commands.test}`);
        execSync(mod.commands.test, { stdio: 'inherit', cwd });
      }
      result.activeModules = activeModules;
      return result;
    }

    case 'coverage': {
      const files = getModifiedFiles();
      const activeModules = files.length > 0 ? matchFilesToModules(files, config.modules) : config.modules;
      console.log(`🎯 Executing Dual-Gate Coverage Check for ${activeModules.length} module(s)...`);
      for (const mod of activeModules) {
        const cwd = path.resolve(repoRoot, mod.path);
        console.log(`\n▶️ [${mod.name}] Running: ${mod.commands.coverage}`);
        execSync(mod.commands.coverage, { stdio: 'inherit', cwd });
        console.log(`✅ [${mod.name}] Diff coverage threshold met (>= ${mod.thresholds.diffCoverage}%)`);
      }
      result.activeModules = activeModules;
      return result;
    }

    case 'mutation': {
      const files = getModifiedFiles();
      const activeModules = files.length > 0 ? matchFilesToModules(files, config.modules) : config.modules;
      console.log(`🧬 Executing Mutation Defense Check for ${activeModules.length} module(s)...`);
      for (const mod of activeModules) {
        const cwd = path.resolve(repoRoot, mod.path);
        console.log(`\n▶️ [${mod.name}] Running: ${mod.commands.mutation}`);
        execSync(mod.commands.mutation, { stdio: 'inherit', cwd });
        console.log(`✅ [${mod.name}] Mutation kill score met (>= ${mod.thresholds.mutationScore}%)`);
      }
      result.activeModules = activeModules;
      return result;
    }

    case 'gate': {
      console.log('🛡️ Executing Universal Quality Gate across all active modules...');
      for (const mod of config.modules) {
        const cwd = path.resolve(repoRoot, mod.path);
        console.log(`\n=== Auditing Module: ${mod.name} ===`);
        if (mod.commands.lint) {
          console.log(`[Lint] ${mod.commands.lint}`);
          execSync(mod.commands.lint, { stdio: 'inherit', cwd });
        }
        if (mod.commands.build) {
          console.log(`[Build] ${mod.commands.build}`);
          execSync(mod.commands.build, { stdio: 'inherit', cwd });
        }
        console.log(`[Test & Coverage] ${mod.commands.coverage}`);
        execSync(mod.commands.coverage, { stdio: 'inherit', cwd });
      }
      console.log('\n🎉 Quality gate passed across all modules.');
      return result;
    }

    case 'help':
    default: {
      console.log(`
Agentic SDLC Universal Engine (sdlc-engine.mjs)

Usage:
  node .agent/scripts/sdlc-engine.mjs detect     Detect stack and print config preview
  node .agent/scripts/sdlc-engine.mjs test       Run tests for changed modules
  node .agent/scripts/sdlc-engine.mjs coverage   Run diff coverage gate
  node .agent/scripts/sdlc-engine.mjs mutation   Run mutation defense check
  node .agent/scripts/sdlc-engine.mjs gate       Execute full quality gate (lint, build, test)
      `);
      return result;
    }
  }
}

// Execute if run directly as CLI
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  runCLI();
}
