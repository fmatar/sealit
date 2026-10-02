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
  resolveAdHocTargets,
  loadEnv,
  detectPMProvider,
  inspectArchlens,
  diagnoseEnvironment
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
});
