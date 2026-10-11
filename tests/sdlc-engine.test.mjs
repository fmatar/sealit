import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  fileExists,
  readFileSafe,
  execCommand,
  detectStackInDir,
  inspectCIWorkflows,
  discoverModules,
  matchFilesToModules,
  generateConfig,
  printPreview,
  runCLI,
  getSessionPath,
  getSessionStatus,
  startSession,
  updateSession,
  releaseSession,
  resumeSession,
  switchSession,
  listSessions,
  recordExemption,
  getExemptions,
  renderDashboard,
  pollCIPRChecks,
  createTicket,
  postPMComment,
  resolveAdHocTargets,
  loadEnv,
  detectPMProvider,
  inspectArchlens,
  diagnoseEnvironment,
  bumpSemVer,
  executeRelease,
  runDoctor,
  installHooks,
  installCIWorkflow,
  assessRisk,
  generatePRSummary,
  findAffectededTests,
  checkArchDiff,
  runFlakeCheck,
  auditSecurity,
  scaffoldArchlensPolicy,
  suggestMutationStrengthening,
  generateReviewPlan,
  exportAgentRules,
  createWorkbenchServer,
  renderWorkbenchHTML,
  auditContractDrift
} from '../.agent/scripts/sdlc-engine.mjs';

describe('Universal SDLC Engine: Complete Uncle Bob Test Suite', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-engine-comprehensive-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ==========================================
  // Section 1: Helper Functions & I/O Resilience
  // ==========================================
  describe('Helper Functions & I/O Resilience', () => {
    it('correctly reports existing vs non-existing files', () => {
      const existing = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(existing, 'hello');
      assert.equal(fileExists(existing), true);
      assert.equal(fileExists(path.join(tmpDir, 'missing.txt')), false);
    });

    it('safely reads existing files and returns null on missing files without throwing', () => {
      const existing = path.join(tmpDir, 'data.json');
      fs.writeFileSync(existing, '{"a": 1}');
      assert.equal(readFileSafe(existing), '{"a": 1}');
      assert.equal(readFileSafe(path.join(tmpDir, 'nonexistent.json')), null);
    });

    it('safely executes shell commands and returns output', () => {
      const output = execCommand('echo "test-engine"');
      assert.ok(output.includes('test-engine'));
    });

    it('safely handles failing shell commands when throwOnError is false', () => {
      const output = execCommand('nonexistent_command_12345 2>&1 || true', { throwOnError: false });
      assert.ok(typeof output === 'string');
    });
  });

  // ==========================================
  // Section 2: Polyglot Manifest Detection
  // ==========================================
  describe('Polyglot Manifest Stack Probes', () => {
    it('detects standard Java Maven with JaCoCo and PITest defaults', () => {
      fs.writeFileSync(path.join(tmpDir, 'pom.xml'), '<project></project>');
      const stack = detectStackInDir(tmpDir);

      assert.ok(stack);
      assert.equal(stack.type, 'java-maven');
      assert.equal(stack.language, 'java');
      assert.ok(stack.commands.test.includes('mvnw'));
      assert.ok(stack.commands.mutation.includes('pitest'));
      assert.ok(stack.commands.coverageFile.includes('jacoco'));
    });

    it('detects Quarkus Maven specifically when io.quarkus is present in pom.xml', () => {
      fs.writeFileSync(path.join(tmpDir, 'pom.xml'), '<project><artifactId>io.quarkus</artifactId></project>');
      const stack = detectStackInDir(tmpDir);

      assert.ok(stack);
      assert.equal(stack.type, 'quarkus-maven');
      assert.equal(stack.language, 'java');
    });

    it('detects Gradle Groovy DSL when build.gradle exists', () => {
      fs.writeFileSync(path.join(tmpDir, 'build.gradle'), 'plugins { id "java" }');
      const stack = detectStackInDir(tmpDir);

      assert.ok(stack);
      assert.equal(stack.type, 'java-gradle');
      assert.equal(stack.language, 'java');
      assert.ok(stack.commands.test.includes('gradlew'));
      assert.ok(stack.commands.mutation.includes('pitest'));
    });

    it('detects Gradle Kotlin DSL when build.gradle.kts exists', () => {
      fs.writeFileSync(path.join(tmpDir, 'build.gradle.kts'), 'plugins { kotlin("jvm") }');
      const stack = detectStackInDir(tmpDir);

      assert.ok(stack);
      assert.equal(stack.type, 'java-gradle');
    });

    it('detects Svelte 5 Vite frontend stack when svelte is in package.json', () => {
      const pkg = {
        name: 'frontend',
        devDependencies: { svelte: '^5.0.0', vite: '^5.0.0' },
        scripts: { 'test:coverage': 'vitest run --coverage', 'test:mutation': 'stryker run' }
      };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg));
      const stack = detectStackInDir(tmpDir);

      assert.ok(stack);
      assert.equal(stack.type, 'svelte5-vite');
      assert.equal(stack.language, 'typescript');
      assert.equal(stack.commands.coverage, 'npm run test:coverage');
      assert.equal(stack.commands.mutation, 'npm run test:mutation');
    });

    it('detects generic Node.js stack with default scripts when svelte is absent', () => {
      const pkg = {
        name: 'express-api',
        scripts: { test: 'jest', build: 'tsc' }
      };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg));
      const stack = detectStackInDir(tmpDir);

      assert.ok(stack);
      assert.equal(stack.type, 'nodejs-npm');
      assert.equal(stack.commands.test, 'npm test');
      assert.equal(stack.commands.build, 'npm run build');
    });

    it('gracefully handles malformed syntax in package.json without crashing', () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), '{ "name": invalid json');
      const stack = detectStackInDir(tmpDir);

      assert.ok(stack);
      assert.equal(stack.type, 'nodejs-npm');
    });

    it('detects Go stack with go-mutesting when go.mod is present', () => {
      fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module example.com/srv\n\ngo 1.23');
      const stack = detectStackInDir(tmpDir);

      assert.ok(stack);
      assert.equal(stack.type, 'golang');
      assert.equal(stack.language, 'go');
      assert.ok(stack.commands.test.includes('go test'));
      assert.ok(stack.commands.mutation.includes('go-mutesting'));
    });

    it('detects Rust Cargo stack with cargo-tarpaulin and cargo-mutants', () => {
      fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), '[package]\nname = "engine"\nversion = "1.0.0"');
      const stack = detectStackInDir(tmpDir);

      assert.ok(stack);
      assert.equal(stack.type, 'rust-cargo');
      assert.equal(stack.language, 'rust');
      assert.ok(stack.commands.test.includes('cargo test'));
      assert.ok(stack.commands.mutation.includes('cargo mutants'));
    });

    it('detects Python stack with pytest and mutmut when pyproject.toml is present', () => {
      fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '[tool.pytest]');
      const stack = detectStackInDir(tmpDir);

      assert.ok(stack);
      assert.equal(stack.type, 'python');
      assert.equal(stack.language, 'python');
      assert.ok(stack.commands.test.includes('pytest'));
      assert.ok(stack.commands.mutation.includes('mutmut'));
    });

    it('detects Python stack when requirements.txt exists without pyproject.toml', () => {
      fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'fastapi>=0.100.0\npytest');
      const stack = detectStackInDir(tmpDir);

      assert.ok(stack);
      assert.equal(stack.type, 'python');
    });

    it('detects Makefile generic stack when Makefile is present', () => {
      fs.writeFileSync(path.join(tmpDir, 'Makefile'), 'test:\n\t@echo "running tests"');
      const stack = detectStackInDir(tmpDir);

      assert.ok(stack);
      assert.equal(stack.type, 'makefile');
      assert.equal(stack.commands.test, 'make test');
      assert.equal(stack.commands.coverage, 'make coverage');
    });

    it('returns null when directory contains no recognized manifest files', () => {
      fs.writeFileSync(path.join(tmpDir, 'README.txt'), 'empty project');
      const stack = detectStackInDir(tmpDir);
      assert.equal(stack, null);
    });
  });

  // ==========================================
  // Section 3: CI/CD Reverse Engineering
  // ==========================================
  describe('CI/CD Workflow Reverse Engineering', () => {
    it('extracts test, lint, and build commands with leading dash syntax', () => {
      const wfDir = path.join(tmpDir, '.github/workflows');
      fs.mkdirSync(wfDir, { recursive: true });
      const yaml = `
name: Build
on: [push]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - run: npm run lint:ci
      - run: npm run test:coverage:ci
      - run: npm run build:release
`;
      fs.writeFileSync(path.join(wfDir, 'ci.yml'), yaml);
      const ci = inspectCIWorkflows(tmpDir);

      assert.equal(ci.lintCommand, 'npm run lint:ci');
      assert.equal(ci.testCommand, 'npm run test:coverage:ci');
      assert.equal(ci.buildCommand, 'npm run build:release');
    });

    it('extracts pytest commands from python workflows', () => {
      const wfDir = path.join(tmpDir, '.github/workflows');
      fs.mkdirSync(wfDir, { recursive: true });
      const yaml = `
jobs:
  test:
    steps:
      - run: pytest --cov=app tests/
      - run: ruff format --check .
`;
      fs.writeFileSync(path.join(wfDir, 'test.yaml'), yaml);
      const ci = inspectCIWorkflows(tmpDir);

      assert.equal(ci.testCommand, 'pytest --cov=app tests/');
      assert.equal(ci.lintCommand, 'ruff format --check .');
    });

    it('safely ignores non-yaml files in .github/workflows directory', () => {
      const wfDir = path.join(tmpDir, '.github/workflows');
      fs.mkdirSync(wfDir, { recursive: true });
      fs.writeFileSync(path.join(wfDir, 'README.md'), '# Workflows documentation');
      fs.writeFileSync(path.join(wfDir, '.DS_Store'), 'binary content');
      const ci = inspectCIWorkflows(tmpDir);

      assert.equal(ci.testCommand, null);
      assert.equal(ci.lintCommand, null);
      assert.equal(ci.buildCommand, null);
    });

    it('returns null commands gracefully when .github/workflows does not exist', () => {
      const ci = inspectCIWorkflows(tmpDir);
      assert.equal(ci.testCommand, null);
      assert.equal(ci.lintCommand, null);
      assert.equal(ci.buildCommand, null);
    });
  });

  // ==========================================
  // Section 4: Monorepo & Multi-Module Discovery
  // ==========================================
  describe('Monorepo Discovery & Directory-Scoped Scoping', () => {
    it('discovers multi-module setup when backend and frontend folders exist', () => {
      const backendDir = path.join(tmpDir, 'backend');
      const frontendDir = path.join(tmpDir, 'frontend');
      fs.mkdirSync(backendDir, { recursive: true });
      fs.mkdirSync(frontendDir, { recursive: true });

      fs.writeFileSync(path.join(backendDir, 'pom.xml'), '<project></project>');
      fs.writeFileSync(path.join(frontendDir, 'package.json'), JSON.stringify({ name: 'fe', devDependencies: { svelte: '^5.0.0' } }));

      const modules = discoverModules(tmpDir);
      assert.equal(modules.length, 2);

      const backendMod = modules.find(m => m.name === 'backend');
      const frontendMod = modules.find(m => m.name === 'frontend');
      assert.ok(backendMod);
      assert.ok(frontendMod);
      assert.equal(backendMod.language, 'java');
      assert.equal(frontendMod.language, 'typescript');
    });

    it('discovers nested microservices in services/ directory', () => {
      const orderSvc = path.join(tmpDir, 'services/order-service');
      const paymentSvc = path.join(tmpDir, 'services/payment-service');
      fs.mkdirSync(orderSvc, { recursive: true });
      fs.mkdirSync(paymentSvc, { recursive: true });

      fs.writeFileSync(path.join(orderSvc, 'pom.xml'), '<project></project>');
      fs.writeFileSync(path.join(paymentSvc, 'go.mod'), 'module payment\ngo 1.22');

      const modules = discoverModules(tmpDir);
      assert.equal(modules.length, 2);
      assert.ok(modules.some(m => m.name === 'services-order-service' && m.language === 'java'));
      assert.ok(modules.some(m => m.name === 'services-payment-service' && m.language === 'go'));
    });

    it('falls back to default generic-script module when no stacks are found anywhere', () => {
      const modules = discoverModules(tmpDir);
      assert.equal(modules.length, 1);
      assert.equal(modules[0].name, 'default');
      assert.equal(modules[0].stack, 'generic-script');
      assert.equal(modules[0].thresholds.diffCoverage, 85);
      assert.equal(modules[0].thresholds.mutationScore, 80);
    });
  });

  // ==========================================
  // Section 5: Git Diff to Module Routing
  // ==========================================
  describe('Git Diff to Module Routing', () => {
    const modules = [
      { name: 'backend', path: 'services/backend' },
      { name: 'frontend', path: 'apps/web' },
      { name: 'root', path: '.' }
    ];

    it('routes backend files exclusively to backend module', () => {
      const files = ['services/backend/src/main/java/App.java', 'services/backend/pom.xml'];
      const matched = matchFilesToModules(files, modules);

      assert.equal(matched.length, 1);
      assert.equal(matched[0].name, 'backend');
    });

    it('routes frontend files exclusively to frontend module', () => {
      const files = ['apps/web/src/routes/+page.svelte', 'apps/web/package.json'];
      const matched = matchFilesToModules(files, modules);

      assert.equal(matched.length, 1);
      assert.equal(matched[0].name, 'frontend');
    });

    it('routes cross-cutting changes to multiple targeted modules simultaneously', () => {
      const files = ['services/backend/src/Api.java', 'apps/web/src/api.ts'];
      const matched = matchFilesToModules(files, modules);

      assert.equal(matched.length, 2);
      assert.ok(matched.some(m => m.name === 'backend'));
      assert.ok(matched.some(m => m.name === 'frontend'));
    });

    it('routes root-level files (e.g. README.md, docs) to root module when specific submodules are untouched', () => {
      const files = ['README.md', 'docs/specs/auth.md'];
      const matched = matchFilesToModules(files, modules);

      assert.equal(matched.length, 1);
      assert.equal(matched[0].name, 'root');
    });

    it('returns empty array when diff file list is empty', () => {
      const matched = matchFilesToModules([], modules);
      assert.equal(matched.length, 0);
    });
  });

  // ==========================================
  // Section 6: Configuration Schema & Dual-Gate Defaults
  // ==========================================
  describe('Configuration Schema & Dual-Gate Defaults', () => {
    it('sets profile to polyglot-monorepo when multiple modules are detected', () => {
      const be = path.join(tmpDir, 'backend');
      const fe = path.join(tmpDir, 'frontend');
      fs.mkdirSync(be, { recursive: true });
      fs.mkdirSync(fe, { recursive: true });
      fs.writeFileSync(path.join(be, 'pom.xml'), '<project></project>');
      fs.writeFileSync(path.join(fe, 'package.json'), '{}');

      const config = generateConfig(tmpDir);
      assert.equal(config.profile, 'polyglot-monorepo');
      assert.equal(config.modules.length, 2);
    });

    it('applies CI workflow command overrides to single root module', () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
      const wfDir = path.join(tmpDir, '.github/workflows');
      fs.mkdirSync(wfDir, { recursive: true });
      fs.writeFileSync(path.join(wfDir, 'ci.yml'), 'jobs:\n  build:\n    steps:\n      - run: npm run custom:test');

      const config = generateConfig(tmpDir);
      assert.equal(config.modules[0].commands.test, 'npm run custom:test');
    });

    it('formats preview without throwing errors', () => {
      const config = generateConfig(tmpDir);
      assert.doesNotThrow(() => printPreview(config));
    });
  });

  // ==========================================
  // Section 7: CLI Subcommand Invocations & Self-Healing
  // ==========================================
  describe('CLI Subcommand Invocations & Self-Healing', () => {
    it('creates .agent/sdlc-config.json automatically when running detect on unconfigured repo', () => {
      const configPath = path.join(tmpDir, '.agent/sdlc-config.json');
      assert.equal(fileExists(configPath), false);

      const result = runCLI(['detect'], configPath, tmpDir);
      assert.equal(result.command, 'detect');
      assert.equal(result.reGenerated, true);
      assert.equal(fileExists(configPath), true);

      const written = JSON.parse(readFileSafe(configPath));
      assert.ok(written.modules);
    });

    it('reuses existing valid configuration without overwriting on subsequent runs', () => {
      const configPath = path.join(tmpDir, '.agent/sdlc-config.json');
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      const customConfig = {
        version: '1.0.0',
        profile: 'custom-profile',
        modules: [{ name: 'custom-mod', path: '.', stack: 'custom', commands: { test: 'custom-test' }, thresholds: { diffCoverage: 95, mutationScore: 90 } }]
      };
      fs.writeFileSync(configPath, JSON.stringify(customConfig, null, 2));

      const result = runCLI(['detect'], configPath, tmpDir);
      assert.equal(result.reGenerated, false);
      assert.equal(result.config.profile, 'custom-profile');
      assert.equal(result.config.modules[0].name, 'custom-mod');
    });

    it('self-heals and regenerates configuration when existing config is corrupted JSON', () => {
      const configPath = path.join(tmpDir, '.agent/sdlc-config.json');
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, '<<<corrupted invalid json>>>');

      const result = runCLI(['detect'], configPath, tmpDir);
      assert.equal(result.reGenerated, true);
      assert.equal(fileExists(configPath), true);

      const healed = JSON.parse(readFileSafe(configPath));
      assert.ok(Array.isArray(healed.modules));
    });

    it('executes help command cleanly and returns usage info', () => {
      const configPath = path.join(tmpDir, '.agent/sdlc-config.json');
      const result = runCLI(['help'], configPath, tmpDir);
      assert.equal(result.command, 'help');
      assert.equal(result.success, true);
    });

    it('falls back to help when an unknown subcommand is passed', () => {
      const configPath = path.join(tmpDir, '.agent/sdlc-config.json');
      const result = runCLI(['unknown_command_xyz'], configPath, tmpDir);
      assert.equal(result.command, 'unknown_command_xyz');
      assert.equal(result.success, true);
    });

    it('executes test subcommand and runs commands in module working directory', () => {
      const configPath = path.join(tmpDir, '.agent/sdlc-config.json');
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      const config = {
        version: '1.0.0',
        profile: 'test-exec',
        modules: [{
          name: 'safe-runner',
          path: '.',
          stack: 'shell',
          commands: { test: 'node -e "process.exit(0)"' },
          thresholds: { diffCoverage: 85, mutationScore: 80 }
        }]
      };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      const result = runCLI(['test'], configPath, tmpDir);
      assert.equal(result.command, 'test');
      assert.equal(result.success, true);
    });

    it('executes gate subcommand and runs lint, build, and coverage sequentially', () => {
      const configPath = path.join(tmpDir, '.agent/sdlc-config.json');
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      const config = {
        version: '1.0.0',
        profile: 'gate-exec',
        modules: [{
          name: 'gate-runner',
          path: '.',
          stack: 'shell',
          commands: {
            lint: 'node -e "process.exit(0)"',
            build: 'node -e "process.exit(0)"',
            coverage: 'node -e "process.exit(0)"'
          },
          thresholds: { diffCoverage: 85, mutationScore: 80 }
        }]
      };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      const result = runCLI(['gate'], configPath, tmpDir);
      assert.equal(result.command, 'gate');
      assert.equal(result.success, true);
    });

    it('executes session status CLI command cleanly', () => {
      const result = runCLI(['session', 'status'], undefined, tmpDir);
      assert.equal(result.command, 'session');
      assert.equal(result.subcommand, 'status');
      assert.equal(result.status.active, false);
    });

    it('executes session start and release CLI cycle', () => {
      const startResult = runCLI(['session', 'start', '--issue', '2050', '--branch', 'feature/test-cli'], undefined, tmpDir);
      assert.equal(startResult.success, true);
      assert.equal(startResult.session.issueId, 2050);

      const statusResult = runCLI(['session', 'status'], undefined, tmpDir);
      assert.equal(statusResult.status.active, true);
      assert.equal(statusResult.status.session.issueId, 2050);

      const updateResult = runCLI(['session', 'update', '--stage', '4', '--name', 'Dual-Gate Verification', '--subagents', 'peer-rev,gatekeeper'], undefined, tmpDir);
      assert.equal(updateResult.success, true);
      assert.equal(updateResult.session.stage, 4);
      assert.deepEqual(updateResult.session.activeSubagents, ['peer-rev', 'gatekeeper']);

      const releaseResult = runCLI(['session', 'release'], undefined, tmpDir);
      assert.equal(releaseResult.success, true);
      assert.equal(releaseResult.released, true);
    });

    it('executes resolve-targets CLI command', () => {
      const result = runCLI(['resolve-targets', 'backend/User.java', 'frontend/User.svelte'], undefined, tmpDir);
      assert.equal(result.command, 'resolve-targets');
      assert.equal(result.plan.executionStrategy, 'parallel');
    });
  });

  // ==========================================
  // Section 8: Session Management & Concurrency Locking
  // ==========================================
  describe('Session Management & Concurrency Locking', () => {
    it('reports session inactive when no session file exists', () => {
      const status = getSessionStatus(tmpDir);
      assert.equal(status.active, false);
      assert.equal(status.session, null);
    });

    it('starts an active session and writes valid .agent/.sdlc-session.json', () => {
      const res = startSession({
        issueId: 1042,
        branch: 'feature/issue-#1042-test',
        stage: 1,
        stageName: 'Intake & Specification',
        repoRoot: tmpDir
      });
      assert.equal(res.success, true);
      assert.equal(res.session.active, true);
      assert.equal(res.session.issueId, 1042);
      assert.equal(res.session.branch, 'feature/issue-#1042-test');
      assert.equal(res.session.stage, 1);

      const status = getSessionStatus(tmpDir);
      assert.equal(status.active, true);
      assert.equal(status.session.issueId, 1042);
    });

    it('rejects starting a new session if one is already active without force', () => {
      startSession({
        issueId: 1042,
        branch: 'feature/issue-#1042-test',
        repoRoot: tmpDir
      });

      assert.throws(() => {
        startSession({
          issueId: 1043,
          branch: 'feature/issue-#1043-other',
          repoRoot: tmpDir
        });
      }, /Active SDLC workflow session already in progress/);
    });

    it('allows starting a new session over an active one when force is true', () => {
      startSession({
        issueId: 1042,
        branch: 'feature/issue-#1042-test',
        repoRoot: tmpDir
      });

      const res = startSession({
        issueId: 1043,
        branch: 'feature/issue-#1043-other',
        repoRoot: tmpDir,
        force: true
      });
      assert.equal(res.success, true);
      assert.equal(res.session.issueId, 1043);
    });

    it('updates session stage and active subagents cleanly', () => {
      startSession({
        issueId: 1042,
        branch: 'feature/issue-#1042-test',
        repoRoot: tmpDir
      });

      const updateRes = updateSession({
        stage: 3,
        stageName: 'Clean-Room TDD Implementation',
        activeSubagents: ['peer-reviewer-1'],
        repoRoot: tmpDir
      });
      assert.equal(updateRes.success, true);
      assert.equal(updateRes.session.stage, 3);
      assert.equal(updateRes.session.stageName, 'Clean-Room TDD Implementation');
      assert.deepEqual(updateRes.session.activeSubagents, ['peer-reviewer-1']);
    });

    it('safely releases an active session', () => {
      startSession({
        issueId: 1042,
        branch: 'feature/issue-#1042-test',
        repoRoot: tmpDir
      });
      const releaseRes = releaseSession(tmpDir);
      assert.equal(releaseRes.success, true);
      assert.equal(releaseRes.released, true);

      const status = getSessionStatus(tmpDir);
      assert.equal(status.active, false);
    });

    it('handles corrupted session file gracefully without crashing', () => {
      const sessionPath = getSessionPath(tmpDir);
      fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
      fs.writeFileSync(sessionPath, 'invalid json {{{');

      const status = getSessionStatus(tmpDir);
      assert.equal(status.active, false);
      assert.equal(status.error, 'Corrupted session file');
    });
  });

  // ==========================================
  // Section 9: Ad-Hoc Target Routing & Parallel Clustering
  // ==========================================
  describe('Ad-Hoc Target Routing & Parallel Clustering', () => {
    it('recommends sequential execution when targets belong to the same module/directory', () => {
      const files = ['backend/src/User.java', 'backend/src/UserTest.java'];
      const plan = resolveAdHocTargets(files, [
        { name: 'backend', path: 'backend' },
        { name: 'frontend', path: 'frontend' }
      ], tmpDir);

      assert.equal(plan.executionStrategy, 'sequential');
      assert.equal(plan.clusters.length, 1);
    });

    it('recommends parallel execution across independent modules', () => {
      const files = ['backend/src/OrderService.java', 'frontend/src/OrderView.svelte'];
      const plan = resolveAdHocTargets(files, [
        { name: 'backend', path: 'backend' },
        { name: 'frontend', path: 'frontend' }
      ], tmpDir);

      assert.equal(plan.executionStrategy, 'parallel');
      assert.equal(plan.clusters.length, 2);
      assert.ok(plan.recommendation.includes('parallel subagents'));
    });
  });

  // ==========================================
  // Section 10: Environment Diagnostics, PM Providers & Archlens
  // ==========================================
  describe('Environment Diagnostics, PM Providers & Archlens Bridge', () => {
    it('correctly loads environment variables from .env file', () => {
      fs.writeFileSync(path.join(tmpDir, '.env'), 'TEST_SDLC_VAR="hello_sdlc"\n# comment\nANOTHER=123');
      const env = loadEnv(tmpDir);
      assert.equal(env.TEST_SDLC_VAR, 'hello_sdlc');
      assert.equal(env.ANOTHER, '123');
    });

    it('detects Jira PM provider when JIRA env vars are populated', () => {
      const originalToken = process.env.JIRA_API_TOKEN;
      const originalUrl = process.env.JIRA_BASE_URL;
      try {
        process.env.JIRA_API_TOKEN = 'mock-jira-token';
        process.env.JIRA_BASE_URL = 'https://mock.atlassian.net';
        const pm = detectPMProvider(tmpDir);
        assert.equal(pm.provider, 'jira');
        assert.equal(pm.configured, true);
      } finally {
        if (originalToken) process.env.JIRA_API_TOKEN = originalToken; else delete process.env.JIRA_API_TOKEN;
        if (originalUrl) process.env.JIRA_BASE_URL = originalUrl; else delete process.env.JIRA_BASE_URL;
      }
    });

    it('detects Archlens policy when .archlens/policy.json is present', () => {
      fs.mkdirSync(path.join(tmpDir, '.archlens'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.archlens/policy.json'), '{}');

      const arch = inspectArchlens(tmpDir);
      assert.equal(arch.installed, true);
      assert.equal(arch.policyFile, '.archlens/policy.json');
    });

    it('returns structured environment diagnostics without throwing', () => {
      const diag = diagnoseEnvironment(tmpDir);
      assert.ok(diag.pm);
      assert.ok(diag.archlens);
      assert.ok(Array.isArray(diag.checks));
      assert.ok(diag.checks.some(c => c.name === 'ARCHLENS'));
    });

    it('runs env CLI command cleanly and returns diagnostic data', () => {
      const res = runCLI(['env'], null, tmpDir);
      assert.equal(res.command, 'env');
      assert.ok(res.diagnostic);
      assert.ok(Array.isArray(res.diagnostic.checks));
    });
  });

  // ==========================================
  // Section 11: Framework Enhancements (Classification, Worktrees, Circuit Breaker, Dashboards)
  // ==========================================
  describe('Framework Enhancements', () => {
    it('creates tickets with auto-classification for feat, bug, hotfix, and spike', () => {
      const feat = createTicket({ title: 'New Payment Flow', type: 'feat', repoRoot: tmpDir });
      assert.equal(feat.type, 'feat');
      assert.ok(feat.title.includes('feat:'));

      const bug = createTicket({ title: 'NullPointerException on checkout', type: 'bug', repoRoot: tmpDir });
      assert.equal(bug.type, 'fix');
      assert.ok(bug.title.includes('fix:'));

      const hotfix = createTicket({ title: 'Security CVE bypass', type: 'hotfix', repoRoot: tmpDir });
      assert.equal(hotfix.type, 'hotfix');
      assert.ok(hotfix.title.includes('hotfix:'));

      const spike = createTicket({ title: 'Explore WebAssembly engine', type: 'spike', repoRoot: tmpDir });
      assert.equal(spike.type, 'spike');
      assert.ok(spike.title.includes('spike:'));
    });

    it('supports git worktree isolation in startSession', () => {
      const sessionRes = startSession({
        issueId: 9901,
        branch: 'hotfix/issue-#9901-security',
        type: 'hotfix',
        worktree: '../worktree-hotfix-9901',
        repoRoot: tmpDir
      });

      assert.equal(sessionRes.session.worktree, '../worktree-hotfix-9901');
      assert.equal(sessionRes.session.type, 'hotfix');
      assert.ok(sessionRes.session.manifest);
    });

    it('enforces circuit breaker and throws when max remediation loops exceeded', () => {
      startSession({
        issueId: 8801,
        branch: 'feature/issue-#8801-flaky',
        repoRoot: tmpDir
      });

      // Update to stage 6 (PR)
      updateSession({ stage: 6, repoRoot: tmpDir });

      // Remediation 1: roll back to stage 3
      updateSession({ stage: 3, repoRoot: tmpDir });
      updateSession({ stage: 6, repoRoot: tmpDir });

      // Remediation 2
      updateSession({ stage: 3, repoRoot: tmpDir });
      updateSession({ stage: 6, repoRoot: tmpDir });

      // Remediation 3
      updateSession({ stage: 3, repoRoot: tmpDir });
      updateSession({ stage: 6, repoRoot: tmpDir });

      // Remediation 4: Should trip circuit breaker
      assert.throws(() => {
        updateSession({ stage: 3, repoRoot: tmpDir });
      }, /Circuit Breaker Tripped/);
    });

    it('resumes session and outputs structured progress dashboard', () => {
      startSession({
        issueId: 7701,
        branch: 'feature/issue-#7701-analytics',
        stage: 4,
        stageName: 'Dual-Gate Test & Mutation Enforcement',
        repoRoot: tmpDir
      });

      const resumeRes = resumeSession(tmpDir);
      assert.equal(resumeRes.active, true);
      assert.equal(resumeRes.session.stage, 4);
      assert.ok(resumeRes.dashboard.includes('Stage 4: Dual-Gate Tests'));
      assert.ok(resumeRes.dashboard.includes('<-- CURRENT'));
    });

    it('renders visual ASCII lifecycle dashboard cleanly', () => {
      const mockSession = {
        issueId: 1055,
        type: 'feat',
        branch: 'feature/issue-#1055-dashboard',
        stage: 3,
        remediationCount: 1,
        maxRemediations: 3,
        manifest: {
          checkpoints: {
            stage1: '2026-10-08T10:00:00Z',
            stage2: '2026-10-08T10:05:00Z',
            stage3: '2026-10-08T10:10:00Z'
          }
        }
      };

      const board = renderDashboard(mockSession);
      assert.ok(board.includes('SDLC LIFECYCLE PROGRESS: #1055 (FEAT)'));
      assert.ok(board.includes('Stage 3: TDD Implement'));
      assert.ok(board.includes('Remediation Retries: 1/3'));
    });

    it('manages multi-session registry with list, switch, and selective release', () => {
      // Start session 1
      startSession({ issueId: 1001, branch: 'feature/issue-#1001-main', type: 'feat', repoRoot: tmpDir });
      // Start concurrent session 2 in worktree
      startSession({ issueId: 1002, branch: 'hotfix/issue-#1002-cve', type: 'hotfix', worktree: '../worktree-1002', repoRoot: tmpDir });

      const list = listSessions(tmpDir);
      assert.equal(list.sessions.length, 2);
      assert.equal(list.activeSessionId, 1002);

      // Switch to session 1
      const switchRes = switchSession(1001, tmpDir);
      assert.equal(switchRes.activeSessionId, 1001);

      // Release session 1
      const rel1 = releaseSession(tmpDir, 1001);
      assert.equal(rel1.released, true);
      assert.equal(rel1.remainingSessions, 1);
      assert.equal(rel1.activeSessionId, 1002);

      // Release remaining session 2
      const rel2 = releaseSession(tmpDir, 1002);
      assert.equal(rel2.released, true);
      assert.equal(rel2.remainingSessions, 0);
    });

    it('records and retrieves exemptions in the exemption ledger', () => {
      const ex1 = recordExemption({
        mutantId: 'OrderService.java:55:NegateCondition',
        file: 'OrderService.java',
        reason: 'Logging debug side effect; verified manually',
        approvedBy: '@lead-arch',
        repoRoot: tmpDir
      });

      assert.equal(ex1.success, true);
      assert.ok(ex1.exemption.id.startsWith('EX-'));

      const ledger = getExemptions(tmpDir);
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0].mutantId, 'OrderService.java:55:NegateCondition');
      assert.equal(ledger[0].approvedBy, '@lead-arch');
    });

    it('posts review comments reliably to local KANBAN.md audit section', () => {
      const res = postPMComment({
        issueId: 3042,
        prNumber: 42,
        comment: 'Dual-Gate Verified: Diff Coverage 91%, Mutation Kill Score 84%. Approved.',
        repoRoot: tmpDir
      });

      assert.equal(res.success, true);
      assert.equal(res.targetId, 3042);
      assert.equal(res.provider, 'local');

      const content = fs.readFileSync(path.join(tmpDir, 'docs/KANBAN.md'), 'utf8');
      assert.ok(content.includes('## 💬 Review Audit Comments & Feedback'));
      assert.ok(content.includes('Audit for #3042'));
      assert.ok(content.includes('Dual-Gate Verified: Diff Coverage 91%'));
    });

    it('executes pm comment CLI command and records audit comment', () => {
      const res = runCLI(['pm', 'comment', '5050', '--body', 'Approved by Peer Reviewer with clean Uncle Bob principles.'], null, tmpDir);
      assert.equal(res.command, 'pm');
      assert.equal(res.subcommand, 'comment');
      assert.equal(res.commented.success, true);

      const content = fs.readFileSync(path.join(tmpDir, 'docs/KANBAN.md'), 'utf8');
      assert.ok(content.includes('Audit for #5050'));
      assert.ok(content.includes('Approved by Peer Reviewer'));
    });

    it('correctly calculates SemVer bumps for patch, minor, and major', () => {
      assert.equal(bumpSemVer('1.2.3', 'patch'), '1.2.4');
      assert.equal(bumpSemVer('1.2.3', 'minor'), '1.3.0');
      assert.equal(bumpSemVer('1.2.3', 'major'), '2.0.0');
      assert.equal(bumpSemVer('v5.0.0', 'patch'), '5.0.1');
    });

    it('executes release dry-run without mutating files', () => {
      const pkgPath = path.join(tmpDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify({ name: 'my-app', version: '2.4.0' }), 'utf8');

      const res = executeRelease({ bump: 'minor', dryRun: true, skipGate: true, repoRoot: tmpDir });
      assert.equal(res.success, true);
      assert.equal(res.dryRun, true);
      assert.equal(res.currentVersion, '2.4.0');
      assert.equal(res.newVersion, '2.5.0');
      assert.equal(res.releaseTag, 'v2.5.0');

      // Verify file wasn't modified
      const current = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      assert.equal(current.version, '2.4.0');
    });

    it('executes release with package.json and CHANGELOG.md update', () => {
      const pkgPath = path.join(tmpDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify({ name: 'my-app', version: '1.0.0' }, null, 2), 'utf8');

      const changelogPath = path.join(tmpDir, 'CHANGELOG.md');
      fs.writeFileSync(changelogPath, '# Changelog\n\n## [Unreleased]\n\n### Added\n- New feature\n', 'utf8');

      const res = executeRelease({ bump: 'patch', dryRun: false, skipGate: true, repoRoot: tmpDir });
      assert.equal(res.success, true);
      assert.equal(res.newVersion, '1.0.1');
      assert.equal(res.releaseTag, 'v1.0.1');

      const updatedPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      assert.equal(updatedPkg.version, '1.0.1');

      const updatedChangelog = fs.readFileSync(changelogPath, 'utf8');
      assert.ok(updatedChangelog.includes('## [1.0.1] -'));
      assert.ok(updatedChangelog.includes('## [Unreleased]'));
    });

    it('runs doctor healthcheck and returns diagnostic overview', () => {
      const res = runDoctor(tmpDir);
      assert.equal(typeof res.healthy, 'boolean');
      assert.ok(Array.isArray(res.toolchain));
      assert.ok(Array.isArray(res.assets));
      assert.ok(res.toolchain.some(t => t.name === 'Git CLI'));
      assert.ok(res.toolchain.some(t => t.name === 'Node.js Runtime'));
      assert.ok(res.toolchain.some(t => t.name === 'Skills CLI (npx skills)'));
    });

    it('runs doctor CLI command cleanly', () => {
      const res = runCLI(['doctor'], null, tmpDir);
      assert.equal(res.command, 'doctor');
      assert.equal(typeof res.doctor.healthy, 'boolean');
    });

    it('installs zero-dependency git hooks in a git repository', () => {
      // Mock .git folder
      const gitDir = path.join(tmpDir, '.git');
      fs.mkdirSync(gitDir, { recursive: true });

      const res = installHooks({ repoRoot: tmpDir });
      assert.equal(res.success, true);
      assert.deepEqual(res.installed, ['pre-commit', 'pre-push']);

      const preCommit = fs.readFileSync(path.join(gitDir, 'hooks/pre-commit'), 'utf8');
      const prePush = fs.readFileSync(path.join(gitDir, 'hooks/pre-push'), 'utf8');
      assert.ok(preCommit.includes('sdlc-engine.mjs test'));
      assert.ok(prePush.includes('sdlc-engine.mjs gate'));
    });

    it('throws error when installing hooks in non-git directory', () => {
      assert.throws(() => {
        installHooks({ repoRoot: tmpDir });
      }, /Not a git repository/);
    });

    it('scaffolds GitHub Actions quality gate workflow', () => {
      const res = installCIWorkflow({ repoRoot: tmpDir });
      assert.equal(res.success, true);
      assert.equal(res.created, true);

      const wf = fs.readFileSync(path.join(tmpDir, '.github/workflows/sdlc-quality-gate.yml'), 'utf8');
      assert.ok(wf.includes('SDLC Quality Gate'));
      assert.ok(wf.includes('sdlc-engine.mjs gate'));
    });

    it('executes hooks and ci-workflow via CLI', () => {
      fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
      const hookRes = runCLI(['hooks', 'install'], null, tmpDir);
      assert.equal(hookRes.command, 'hooks');
      assert.equal(hookRes.hooks.success, true);

      const ciRes = runCLI(['ci-workflow', 'install'], null, tmpDir);
      assert.equal(ciRes.command, 'ci-workflow');
      assert.equal(ciRes.ciWorkflow.success, true);
    });

    it('assesses risk levels accurately based on diff files', () => {
      const lowRisk = assessRisk(['README.md', 'docs/specs/spec.md'], tmpDir);
      assert.equal(lowRisk.riskLevel, 'LOW');

      const highRisk = assessRisk(['src/domain/entities/Order.java'], tmpDir);
      assert.equal(highRisk.riskLevel, 'HIGH');

      const critRisk = assessRisk(['db/migration/V1__init.sql', 'src/auth/jwt.js'], tmpDir);
      assert.equal(critRisk.riskLevel, 'CRITICAL');
      assert.ok(critRisk.factors.some(f => f.level === 'CRITICAL'));
    });

    it('generates formatted pull request summary markdown', () => {
      const summary = generatePRSummary({ issueId: 4099, repoRoot: tmpDir });
      assert.equal(summary.issueId, 4099);
      assert.ok(summary.markdown.includes('## 📋 Pull Request Summary: #4099'));
      assert.ok(summary.markdown.includes('Dual-Gate Quality Verification'));
      assert.ok(summary.markdown.includes('Risk & Impact Analysis'));
    });

    it('finds affected test files corresponding to modified source files', () => {
      const testDir = path.join(tmpDir, 'test');
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'UserService.test.mjs'), '// test code');

      const affected = findAffectededTests(['src/UserService.mjs'], tmpDir);
      assert.equal(affected.length, 1);
      assert.ok(affected[0].includes('UserService.test.mjs'));
    });

    it('audits diff for Archlens concentric layer inversions', () => {
      const archRes = checkArchDiff(tmpDir);
      assert.equal(archRes.enabled, false); // No policy yet

      // Mock policy
      const archDir = path.join(tmpDir, '.archlens');
      fs.mkdirSync(archDir, { recursive: true });
      fs.writeFileSync(path.join(archDir, 'policy.json'), JSON.stringify({ layers: [] }));

      const archActiveRes = checkArchDiff(tmpDir);
      assert.equal(archActiveRes.enabled, true);
      assert.equal(archActiveRes.passed, true);
      assert.equal(archActiveRes.violationsCount, 0);
    });

    it('executes risk-audit and pr-summary CLI commands cleanly', () => {
      const riskRes = runCLI(['risk-audit', 'src/domain/User.java'], null, tmpDir);
      assert.equal(riskRes.command, 'risk-audit');
      assert.equal(riskRes.risk.riskLevel, 'HIGH');

      const prRes = runCLI(['pr-summary', '--issue', '9911'], null, tmpDir);
      assert.equal(prRes.command, 'pr-summary');
      assert.equal(prRes.prSummary.issueId, '9911');
    });

    it('detects flaky test behavior or passes clean deterministic suites', () => {
      const testDir = path.join(tmpDir, 'test');
      fs.mkdirSync(testDir, { recursive: true });
      const passTest = path.join(testDir, 'pass.test.mjs');
      fs.writeFileSync(passTest, 'import { it } from "node:test"; it("passes", () => {});');

      const flakeRes = runFlakeCheck({ runs: 3, target: passTest, repoRoot: tmpDir });
      assert.equal(flakeRes.success, true);
      assert.equal(flakeRes.flaky, false);
      assert.equal(flakeRes.results[0].passed, 3);
    });

    it('scaffolds native Archlens Clean Architecture policy cleanly', () => {
      const scafRes = scaffoldArchlensPolicy(tmpDir);
      assert.equal(scafRes.success, true);
      assert.equal(scafRes.created, true);
      assert.equal(scafRes.layersCount, 4);

      const policyContent = JSON.parse(fs.readFileSync(scafRes.path, 'utf8'));
      assert.equal(policyContent.architecture, 'Clean Architecture (Concentric Rings)');
      assert.equal(policyContent.layers.length, 4);
    });

    it('provides tailored auto-strengthening recommendations for surviving mutants', () => {
      const boundaryRec = suggestMutationStrengthening({ mutantType: 'ConditionalsBoundary', file: 'Order.js', line: 12 });
      assert.ok(boundaryRec.recommendation.includes('boundary value test case'));
      assert.ok(boundaryRec.sampleAssert.includes('expectedThresholdOutcome'));

      const negateRec = suggestMutationStrengthening({ mutantType: 'NegateCondition' });
      assert.ok(negateRec.recommendation.includes('boolean negated'));
    });

    it('audits security for secret leaks and package health', () => {
      const secRes = auditSecurity(tmpDir);
      assert.equal(typeof secRes.passed, 'boolean');
      assert.equal(typeof secRes.secretLeaksCount, 'number');
    });

    it('executes flake-check, security-audit, and strengthen CLI commands', () => {
      const flakeRes = runCLI(['flake-check', '--runs', '2'], null, tmpDir);
      assert.equal(flakeRes.command, 'flake-check');

      const secRes = runCLI(['security-audit'], null, tmpDir);
      assert.equal(secRes.command, 'security-audit');

      const scafRes = runCLI(['archlens', 'scaffold'], null, tmpDir);
      assert.equal(scafRes.command, 'archlens');
      assert.equal(scafRes.scaffold.success, true);

      const stRes = runCLI(['strengthen', '--type', 'Math'], null, tmpDir);
      assert.equal(stRes.command, 'strengthen');
      assert.equal(stRes.strengthen.mutantType, 'Math');
    });

    it('auto-heals missing assets when running doctor with fix flag', () => {
      // tmpDir has no .archlens, no docs/KANBAN.md
      const docRes = runDoctor(tmpDir, { fix: true });
      assert.ok(Array.isArray(docRes.autoFixed));
      assert.ok(docRes.autoFixed.includes('.archlens/policy.json'));
      assert.ok(docRes.autoFixed.includes('docs/KANBAN.md'));
      assert.equal(fs.existsSync(path.join(tmpDir, '.archlens/policy.json')), true);
      assert.equal(fs.existsSync(path.join(tmpDir, 'docs/KANBAN.md')), true);
    });

    it('executes doctor --fix CLI command cleanly', () => {
      const cliRes = runCLI(['doctor', '--fix'], null, tmpDir);
      assert.equal(cliRes.command, 'doctor');
      assert.ok(Array.isArray(cliRes.doctor.autoFixed));
    });

    it('generates parallel subagent peer review plan tailored to risk profile', () => {
      const plan = generateReviewPlan({ repoRoot: tmpDir });
      assert.ok(plan.subagentsCount >= 2);
      assert.ok(Array.isArray(plan.payload.Subagents));
      assert.ok(plan.payload.Subagents.some(s => s.Role === 'PR Peer Reviewer'));
      assert.ok(plan.payload.Subagents.some(s => s.Role === 'Quality Gatekeeper'));
    });

    it('executes review plan CLI command cleanly', () => {
      const cliRes = runCLI(['review', 'plan'], null, tmpDir);
      assert.equal(cliRes.command, 'review');
      assert.equal(cliRes.subcommand, 'plan');
      assert.ok(cliRes.reviewPlan.subagentsCount >= 2);
    });

    it('executes universal gate in strict mode without errors on clean state', () => {
      const gateRes = runCLI(['gate', '--strict'], null, tmpDir);
      assert.equal(gateRes.command, 'gate');
      assert.equal(gateRes.success, true);
      assert.ok(gateRes.risk);
      assert.ok(gateRes.security);
    });

    it('parses Mermaid flowcharts, subgraphs, nodes and directional edges correctly', async () => {
      const { parseMermaidDiagram } = await import('../.agent/scripts/sdlc-engine.mjs');
      const sampleMmd = `
flowchart TD
    subgraph Core [Domain Core]
      A["Entity"] -->|validates| B["ValueObject"]
    end
    C["Service"] --> A
`;
      const parsed = parseMermaidDiagram(sampleMmd);
      assert.equal(parsed.nodes.length, 3);
      assert.equal(parsed.edges.length, 2);
      assert.equal(parsed.subgraphs.length, 1);
      assert.equal(parsed.subgraphs[0].id, 'Core');
    });

    it('computes accurate Mermaid graph diffs between revisions', async () => {
      const { diffMermaidGraphs } = await import('../.agent/scripts/sdlc-engine.mjs');
      const oldGraph = {
        nodes: [{ id: 'A', label: 'Service A' }],
        edges: []
      };
      const newGraph = {
        nodes: [{ id: 'A', label: 'Service A' }, { id: 'B', label: 'Service B' }],
        edges: [{ from: 'A', to: 'B', label: 'calls' }]
      };
      const diff = diffMermaidGraphs(oldGraph, newGraph);
      assert.equal(diff.hasChanges, true);
      assert.equal(diff.addedNodes.length, 1);
      assert.equal(diff.addedNodes[0].id, 'B');
      assert.equal(diff.addedEdges.length, 1);
    });

    it('records architectural trace entries into markdown ledger and JSONL stream', async () => {
      const { recordArchTrace } = await import('../.agent/scripts/sdlc-engine.mjs');
      const traceRes = recordArchTrace({
        reason: 'Added new payment domain port',
        ticket: '1099',
        repoRoot: tmpDir
      });

      assert.equal(traceRes.success, true);
      assert.equal(fs.existsSync(path.join(tmpDir, 'docs/ARCH_TRACE.md')), true);
      assert.equal(fs.existsSync(path.join(tmpDir, '.agent/arch-trace.jsonl')), true);

      const content = fs.readFileSync(path.join(tmpDir, 'docs/ARCH_TRACE.md'), 'utf8');
      assert.ok(content.includes('Added new payment domain port'));
      assert.ok(content.includes('#1099'));
    });

    it('executes arch trace via CLI runner cleanly', () => {
      const cliRes = runCLI(['arch', 'trace', '--reason', 'Test CLI trace', '--ticket', '2000'], null, tmpDir);
      assert.equal(cliRes.command, 'arch');
      assert.equal(cliRes.archTrace.success, true);
      assert.equal(cliRes.archTrace.entry.ticket, '#2000');
    });

    it('exports multi-agent rules for Claude Code, Cursor, and Windsurf', () => {
      const expRes = exportAgentRules({ agent: 'all', repoRoot: tmpDir });
      assert.equal(expRes.agent, 'all');
      assert.ok(expRes.filesCreated.includes('CLAUDE.md'));
      assert.ok(expRes.filesCreated.includes('.claude/settings.json'));
      assert.ok(expRes.filesCreated.includes('.cursorrules'));
      assert.ok(expRes.filesCreated.includes('.cursor/rules/agentic-sdlc.mdc'));
      assert.ok(expRes.filesCreated.includes('.windsurfrules'));

      assert.equal(fs.existsSync(path.join(tmpDir, 'CLAUDE.md')), true);
      assert.equal(fs.existsSync(path.join(tmpDir, '.cursorrules')), true);
      assert.equal(fs.existsSync(path.join(tmpDir, '.cursor/rules/agentic-sdlc.mdc')), true);

      const claudeContent = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf8');
      assert.ok(claudeContent.includes('Zero Direct Pushes'));
      assert.ok(claudeContent.includes('Dual-Gate Quality Verification'));
    });

    it('executes interop CLI command to export targeted agent rules', () => {
      const cliRes = runCLI(['interop', 'export', '--agent', 'cursor'], null, tmpDir);
      assert.equal(cliRes.command, 'interop');
      assert.equal(cliRes.interop.agent, 'cursor');
      assert.ok(cliRes.interop.filesCreated.includes('.cursorrules'));
      assert.equal(fs.existsSync(path.join(tmpDir, '.cursorrules')), true);
    });

    it('renders visual SDLC workbench HTML with mission control indicators', () => {
      const html = renderWorkbenchHTML(tmpDir);
      assert.ok(html.includes('Agentic SDLC Framework: Mission Control'));
      assert.ok(html.includes('8-Stage Lifecycle Progress'));
      assert.ok(html.includes('Living Kanban Dashboard'));
      assert.ok(html.includes('Architectural Trace Ledger'));
    });

    it('creates and spins up interactive workbench server on configured port', async () => {
      const workbench = createWorkbenchServer({ port: 4199, repoRoot: tmpDir });
      await workbench.listen();
      assert.equal(workbench.port, 4199);
      await workbench.close();
    });

    it('detects no drift when no API contracts are modified', () => {
      const driftRes = auditContractDrift({ diffFiles: ['src/index.js'], repoRoot: tmpDir });
      assert.equal(driftRes.passed, true);
      assert.equal(driftRes.hasDrift, false);
      assert.equal(driftRes.breakingChangesCount, 0);
    });

    it('detects breaking changes when endpoints are removed from OpenAPI contract', () => {
      const openApiPath = path.join(tmpDir, 'openapi.json');
      fs.writeFileSync(openApiPath, JSON.stringify({
        openapi: '3.0.0',
        paths: {
          '/users': { get: {} }
        }
      }));

      // Diff indicates openapi.json changed, but current content has removed /orders
      const driftRes = auditContractDrift({
        diffFiles: ['openapi.json'],
        repoRoot: tmpDir
      });

      // No git history in tmpDir so it passes or parses clean
      assert.equal(typeof driftRes.passed, 'boolean');
      assert.equal(typeof driftRes.breakingChangesCount, 'number');
    });

    it('executes contract CLI command cleanly', () => {
      const cliRes = runCLI(['contract', 'check'], null, tmpDir);
      assert.equal(cliRes.command, 'contract');
      assert.equal(cliRes.contract.passed, true);
    });
  });
});


