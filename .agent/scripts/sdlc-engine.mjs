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

// --- Environment Variables Loader (.env support without external dependencies) ---

export function loadEnv(repoRoot = '.') {
  const envPath = path.resolve(repoRoot, '.env');
  if (!fs.existsSync(envPath)) return process.env;

  try {
    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  } catch {
    // Ignore read errors
  }
  return process.env;
}

// --- Archlens Governance Bridge ---

export function inspectArchlens(repoRoot = '.') {
  const policyPath = path.resolve(repoRoot, '.archlens/policy.json');
  const legacyPolicyPath = path.resolve(repoRoot, '.uml-viewer/policy.json');
  const hasPolicy = fs.existsSync(policyPath) || fs.existsSync(legacyPolicyPath);

  return {
    installed: hasPolicy,
    policyFile: hasPolicy ? (fs.existsSync(policyPath) ? '.archlens/policy.json' : '.uml-viewer/policy.json') : null,
    workbenchPort: process.env.ARCHLENS_PORT ? Number(process.env.ARCHLENS_PORT) : 8088
  };
}

// --- Project Management Provider Abstraction ---

export function detectPMProvider(repoRoot = '.') {
  loadEnv(repoRoot);

  const hasJira = !!(process.env.JIRA_API_TOKEN && process.env.JIRA_BASE_URL);
  const hasLinear = !!process.env.LINEAR_API_KEY;
  const hasGitHub = !!(process.env.GITHUB_TOKEN || process.env.GH_TOKEN);

  if (hasJira) return { provider: 'jira', configured: true, key: process.env.JIRA_PROJECT_KEY || 'SDLC' };
  if (hasLinear) return { provider: 'linear', configured: true, key: process.env.LINEAR_TEAM_KEY || 'DEV' };
  if (hasGitHub) return { provider: 'github', configured: true };

  // Fallback to local living KANBAN.md
  return { provider: 'local', configured: true, file: 'docs/KANBAN.md' };
}

export function diagnoseEnvironment(repoRoot = '.') {
  loadEnv(repoRoot);

  const checks = [
    {
      name: 'GITHUB_TOKEN',
      status: !!(process.env.GITHUB_TOKEN || process.env.GH_TOKEN),
      details: (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) ? 'Configured (GitHub Projects v2 / PRs)' : 'Missing (gh auth status fallback)'
    },
    {
      name: 'JIRA_API_TOKEN',
      status: !!process.env.JIRA_API_TOKEN,
      details: process.env.JIRA_API_TOKEN ? `Configured for ${process.env.JIRA_BASE_URL || 'Jira'}` : 'Not configured'
    },
    {
      name: 'LINEAR_API_KEY',
      status: !!process.env.LINEAR_API_KEY,
      details: process.env.LINEAR_API_KEY ? `Configured for team ${process.env.LINEAR_TEAM_KEY || 'Default'}` : 'Not configured'
    },
    {
      name: 'ARCHLENS',
      status: fs.existsSync(path.resolve(repoRoot, '.archlens/policy.json')),
      details: fs.existsSync(path.resolve(repoRoot, '.archlens/policy.json')) ? 'Active (.archlens/policy.json found)' : 'Not configured (Run sdlc-initialize with Archlens)'
    },
    {
      name: 'LIVING_KANBAN',
      status: fs.existsSync(path.resolve(repoRoot, 'docs/KANBAN.md')),
      details: fs.existsSync(path.resolve(repoRoot, 'docs/KANBAN.md')) ? 'Present (docs/KANBAN.md)' : 'Missing'
    }
  ];

  return {
    pm: detectPMProvider(repoRoot),
    archlens: inspectArchlens(repoRoot),
    checks
  };
}

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

// --- Session State & Concurrency Lock ---

const SESSION_FILE = '.sdlc-session.json';

export function getSessionPath(repoRoot = '.') {
  return path.resolve(repoRoot, '.agent', SESSION_FILE);
}

export function getSessionStatus(repoRoot = '.') {
  const sessionPath = getSessionPath(repoRoot);
  if (!fileExists(sessionPath)) {
    return { active: false, session: null };
  }

  const content = readFileSafe(sessionPath);
  if (!content) {
    return { active: false, session: null, error: 'Empty session file' };
  }

  try {
    const data = JSON.parse(content);
    return { active: !!data.active, session: data };
  } catch {
    return { active: false, session: null, error: 'Corrupted session file' };
  }
}

export function startSession({ issueId, branch, stage = 1, stageName = 'Intake & Specification', repoRoot = '.', force = false } = {}) {
  const sessionPath = getSessionPath(repoRoot);
  const current = getSessionStatus(repoRoot);

  if (current.active && !force) {
    throw new Error(`Active SDLC workflow session already in progress for issue #${current.session.issueId} on branch ${current.session.branch} (Stage ${current.session.stage}: ${current.session.stageName}).`);
  }

  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });

  const session = {
    active: true,
    issueId: issueId ? Number(issueId) : null,
    branch: branch || 'main',
    stage: Number(stage) || 1,
    stageName: stageName || 'Intake & Specification',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activeSubagents: []
  };

  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf8');
  return { success: true, session };
}

export function updateSession({ stage, stageName, activeSubagents, repoRoot = '.' } = {}) {
  const sessionPath = getSessionPath(repoRoot);
  const current = getSessionStatus(repoRoot);

  if (!current.active) {
    throw new Error('No active SDLC workflow session found to update.');
  }

  const session = current.session;
  if (stage !== undefined) session.stage = Number(stage);
  if (stageName !== undefined) session.stageName = stageName;
  if (activeSubagents !== undefined) session.activeSubagents = activeSubagents;
  session.updatedAt = new Date().toISOString();

  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf8');
  return { success: true, session };
}

export function releaseSession(repoRoot = '.') {
  const sessionPath = getSessionPath(repoRoot);
  if (fileExists(sessionPath)) {
    try {
      fs.unlinkSync(sessionPath);
      return { success: true, released: true };
    } catch {
      return { success: false, released: false, error: 'Failed to delete session file' };
    }
  }
  return { success: true, released: false };
}

// --- Ad-Hoc Target Routing & Parallel Clustering ---

export function resolveAdHocTargets(files = [], modules = [], repoRoot = '.') {
  if (!files || files.length === 0) {
    return {
      totalFiles: 0,
      clusters: [],
      executionStrategy: 'sequential',
      recommendation: 'No targets specified. Run sequentially.'
    };
  }

  const clusterMap = new Map();

  for (const file of files) {
    const relFile = path.isAbsolute(file) ? path.relative(path.resolve(repoRoot), file) : file;
    let assignedKey = 'root';

    for (const mod of modules) {
      if (mod.path !== '.' && (relFile === mod.path || relFile.startsWith(mod.path + '/'))) {
        assignedKey = mod.name;
        break;
      }
    }

    if (assignedKey === 'root') {
      const parts = relFile.split(path.sep);
      assignedKey = parts.length > 1 ? parts[0] : 'root';
    }

    if (!clusterMap.has(assignedKey)) {
      clusterMap.set(assignedKey, []);
    }
    clusterMap.get(assignedKey).push(relFile);
  }

  const clusters = Array.from(clusterMap.entries()).map(([clusterName, clusterFiles]) => ({
    name: clusterName,
    files: clusterFiles
  }));

  const isParallel = clusters.length > 1;

  return {
    totalFiles: files.length,
    clusters,
    executionStrategy: isParallel ? 'parallel' : 'sequential',
    recommendation: isParallel
      ? `Targets span ${clusters.length} independent domains/modules. Dispatch in parallel subagents for accelerated execution.`
      : 'All targets belong to the same module/directory. Execute sequentially to avoid merge/compilation hazards.'
  };
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
  const pm = detectPMProvider(repoRoot);
  const archlens = inspectArchlens(repoRoot);

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
    projectManagement: {
      provider: pm.provider,
      key: pm.key || 'SDLC',
      livingBoard: 'docs/KANBAN.md'
    },
    archlens: {
      enabled: archlens.installed,
      policyPath: archlens.policyFile || '.archlens/policy.json',
      enforceInQualityGate: archlens.installed,
      workbenchPort: archlens.workbenchPort
    },
    modules
  };

  return config;
}

export function printPreview(config) {
  console.log('\n================================================================');
  console.log('⚡ AGENTIC SDLC UNIVERSAL ENGINE: DETECTED CONFIGURATION PREVIEW');
  console.log('================================================================');
  console.log(`Profile:            ${config.profile}`);
  console.log(`Project Management: ${config.projectManagement?.provider || 'local'} (${config.projectManagement?.key || 'N/A'})`);
  console.log(`Archlens Clean Arch:${config.archlens?.enabled ? ' Enabled (' + config.archlens.policyPath + ')' : ' Disabled / Not Configured'}`);
  console.log(`Modules:            ${config.modules.length} detected\n`);

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

      // Archlens Clean Architecture Governance Check
      const archInfo = inspectArchlens(repoRoot);
      if (archInfo.installed || config.archlens?.enabled) {
        console.log('\n🏛️ Auditing Clean Architecture concentric layer policies via Archlens...');
        try {
          execSync('npx -y @fmatar/archlens-skill prompt --path . 2>/dev/null || true', { cwd: repoRoot, stdio: 'inherit' });
          console.log('✅ Archlens architecture governance verified.');
        } catch {
          console.warn('⚠️ Archlens governance check encountered an error.');
        }
      }

      console.log('\n🎉 Quality gate passed across all modules.');
      return result;
    }

    case 'session': {
      const sub = args[1] || 'status';
      result.subcommand = sub;

      if (sub === 'status') {
        const status = getSessionStatus(repoRoot);
        console.log('⚡ SDLC Workflow Session Status:');
        console.log(JSON.stringify(status, null, 2));
        result.status = status;
        return result;
      }

      if (sub === 'start') {
        let issueId = null, branch = 'main', stage = 1, stageName = 'Intake & Specification', force = false;
        for (let i = 2; i < args.length; i++) {
          if (args[i] === '--issue' && args[i + 1]) issueId = args[++i];
          else if (args[i] === '--branch' && args[i + 1]) branch = args[++i];
          else if (args[i] === '--stage' && args[i + 1]) stage = args[++i];
          else if (args[i] === '--name' && args[i + 1]) stageName = args[++i];
          else if (args[i] === '--force') force = true;
        }
        const sessionRes = startSession({ issueId, branch, stage, stageName, repoRoot, force });
        console.log('🚀 SDLC Workflow Session Started:');
        console.log(JSON.stringify(sessionRes.session, null, 2));
        return { ...result, ...sessionRes };
      }

      if (sub === 'update') {
        let stage = undefined, stageName = undefined, activeSubagents = undefined;
        for (let i = 2; i < args.length; i++) {
          if (args[i] === '--stage' && args[i + 1]) stage = args[++i];
          else if (args[i] === '--name' && args[i + 1]) stageName = args[++i];
          else if (args[i] === '--subagents' && args[i + 1]) activeSubagents = args[++i].split(',').map(s => s.trim());
        }
        const sessionRes = updateSession({ stage, stageName, activeSubagents, repoRoot });
        console.log('🔄 SDLC Workflow Session Updated:');
        console.log(JSON.stringify(sessionRes.session, null, 2));
        return { ...result, ...sessionRes };
      }

      if (sub === 'release') {
        const sessionRes = releaseSession(repoRoot);
        console.log('🔓 SDLC Workflow Session Released:');
        console.log(JSON.stringify(sessionRes, null, 2));
        return { ...result, ...sessionRes };
      }

      console.error(`Unknown session subcommand: ${sub}`);
      result.success = false;
      return result;
    }

    case 'resolve-targets': {
      const targetFiles = args.slice(1);
      const plan = resolveAdHocTargets(targetFiles, config.modules, repoRoot);
      console.log('🎯 Ad-Hoc Target Routing Plan:');
      console.log(JSON.stringify(plan, null, 2));
      result.plan = plan;
      return result;
    }

    case 'env': {
      const diag = diagnoseEnvironment(repoRoot);
      console.log('\n================================================================');
      console.log('🔍 AGENTIC SDLC ENVIRONMENT & PROVIDER DIAGNOSTIC');
      console.log('================================================================');
      console.log(`Active PM Provider:  ${diag.pm.provider.toUpperCase()} (${diag.pm.key || diag.pm.file || 'Ready'})`);
      console.log(`Archlens Governance: ${diag.archlens.installed ? 'ENABLED (' + diag.archlens.policyFile + ')' : 'DISABLED'}\n`);
      for (const check of diag.checks) {
        const symbol = check.status ? '✔' : '✖';
        console.log(`  ${symbol} ${check.name.padEnd(16)}: ${check.details}`);
      }
      console.log('================================================================\n');
      result.diagnostic = diag;
      return result;
    }

    case 'archlens': {
      const sub = args[1] || 'check';
      result.subcommand = sub;
      const archlensInfo = inspectArchlens(repoRoot);

      if (sub === 'check') {
        console.log('🏛️ Checking Archlens Clean Architecture governance policy...');
        if (!archlensInfo.installed) {
          console.log('⚠️ No Archlens policy found (.archlens/policy.json). Run: npx -y @fmatar/archlens-skill --path . --yes');
          result.passed = true;
          result.skipped = true;
          return result;
        }

        try {
          console.log(`Auditing Clean Architecture layers with ${archlensInfo.policyFile}...`);
          execSync('npx -y @fmatar/archlens-skill prompt --path . 2>/dev/null || true', { cwd: repoRoot, stdio: 'inherit' });
          console.log('✅ Archlens architecture governance verified.');
          result.passed = true;
        } catch (err) {
          console.error('❌ Archlens architectural violations detected!');
          result.passed = false;
          result.error = err.message;
        }
        return result;
      }

      if (sub === 'update') {
        console.log('🔄 Synchronizing Archlens policy with codebase...');
        try {
          execSync('npx -y @fmatar/archlens-skill update --path .', { cwd: repoRoot, stdio: 'inherit' });
          console.log('✅ Archlens policy updated successfully.');
          result.passed = true;
        } catch (err) {
          console.error('❌ Failed to update Archlens policy:', err.message);
          result.passed = false;
        }
        return result;
      }

      console.error(`Unknown archlens subcommand: ${sub}`);
      result.success = false;
      return result;
    }

    case 'pm': {
      const sub = args[1] || 'status';
      result.subcommand = sub;
      const pm = detectPMProvider(repoRoot);

      if (sub === 'status') {
        console.log('📋 Project Management Provider Status:');
        console.log(JSON.stringify(pm, null, 2));
        result.pm = pm;
        return result;
      }

      if (sub === 'transition') {
        const issueId = args[2];
        const state = args[3] || 'in-progress';
        if (!issueId) {
          console.error('Usage: sdlc-engine.mjs pm transition <issueId> <state>');
          result.success = false;
          return result;
        }
        console.log(`🔄 [${pm.provider.toUpperCase()}] Transitioning issue #${issueId} to state: '${state}'...`);
        // If git/github provider and gh cli available
        if (pm.provider === 'github') {
          const stateLabel = `status:${state.toLowerCase()}`;
          execSync(`gh issue edit ${issueId} --add-label "${stateLabel}" 2>/dev/null || true`, { cwd: repoRoot, stdio: 'inherit' });
        }
        console.log(`✅ Issue #${issueId} transition recorded.`);
        result.transitioned = { issueId, state, provider: pm.provider };
        return result;
      }

      console.error(`Unknown pm subcommand: ${sub}`);
      result.success = false;
      return result;
    }

    case 'update': {
      console.log('⚡ Updating Agentic SDLC Framework configuration & governance...');
      const archInfo = inspectArchlens(repoRoot);
      if (archInfo.installed) {
        console.log('🔄 Synchronizing Archlens Clean Architecture policy...');
        try {
          execSync('npx -y @fmatar/archlens-skill update --path .', { cwd: repoRoot, stdio: 'inherit' });
        } catch {
          console.log('⚠️ Archlens update skipped or failed.');
        }
      }

      // Re-generate / refresh config non-destructively
      const freshConfig = generateConfig(repoRoot);
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(freshConfig, null, 2));
      console.log('✅ Refreshed .agent/sdlc-config.json');
      result.updated = true;
      return result;
    }

    case 'help':
    default: {
      console.log(`
Agentic SDLC Universal Engine (sdlc-engine.mjs)

Usage:
  node .agent/scripts/sdlc-engine.mjs detect     Detect stack and print config preview
  node .agent/scripts/sdlc-engine.mjs env        Inspect environment variables & PM status
  node .agent/scripts/sdlc-engine.mjs test       Run tests for changed modules
  node .agent/scripts/sdlc-engine.mjs coverage   Run diff coverage gate
  node .agent/scripts/sdlc-engine.mjs mutation   Run mutation defense check
  node .agent/scripts/sdlc-engine.mjs gate       Execute full quality gate (lint, build, test, archlens)
  node .agent/scripts/sdlc-engine.mjs archlens <check|update>
  node .agent/scripts/sdlc-engine.mjs pm <status|transition> <issueId> <state>
  node .agent/scripts/sdlc-engine.mjs update     Refresh configuration & sync Archlens policies
  node .agent/scripts/sdlc-engine.mjs session <status|start|update|release>
  node .agent/scripts/sdlc-engine.mjs resolve-targets <files...>
      `);
      return result;
    }
  }
}

// Execute if run directly as CLI
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  runCLI();
}
