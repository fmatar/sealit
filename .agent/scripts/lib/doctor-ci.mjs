import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  fileExists,
  readFileSafe,
  inspectArchlens,
  detectPMProvider,
  parseCommandArgv,
  writeFileAtomic,
  readSessionStatus
} from './core.mjs';
import { createTicket, scaffoldIssueTemplates } from './pm-provider.mjs';
import { installHooks, inspectHooksHealth } from './git-guard.mjs';
import { scaffoldArchlensPolicy } from './arch-trace.mjs';

/**
 * Validates `.agent/sdlc-config.json` strictly on disk without synthesizing missing files.
 */
export function validateConfigFile(repoRoot = '.', customConfigPath = null) {
  const cfgPath = customConfigPath ? path.resolve(customConfigPath) : path.resolve(repoRoot, '.agent/sdlc-config.json');
  if (!fileExists(cfgPath)) {
    return {
      valid: false,
      exists: false,
      configPath: cfgPath,
      errors: ["Missing required .agent/sdlc-config.json — run 'node .agent/scripts/sdlc-engine.mjs detect' locally and commit it."],
      config: null
    };
  }

  let cfg;
  try {
    cfg = JSON.parse(readFileSafe(cfgPath) || '');
  } catch (err) {
    return {
      valid: false,
      exists: true,
      configPath: cfgPath,
      errors: [`Invalid JSON in .agent/sdlc-config.json: ${err?.message || err}`],
      config: null
    };
  }

  const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const hasControlChar = (v) => /[\x00-\x1f\x7f]/.test(v);
  const isCommandSpec = (v) => typeof v === 'string' || (Array.isArray(v) && v.every((item) => typeof item === 'string'));

  const errors = [];
  if (!isPlainObject(cfg)) {
    errors.push('Top-level config must be a JSON object.');
    return { valid: false, exists: true, configPath: cfgPath, errors, config: null };
  }

  if (typeof cfg.version !== 'string' || !cfg.version.trim()) {
    errors.push("Missing or invalid 'version' string.");
  }

  for (const optStr of ['$schema', 'generatedAt']) {
    if (cfg[optStr] !== undefined && typeof cfg[optStr] !== 'string') {
      errors.push(`'${optStr}' must be a string when present.`);
    }
  }

  if (cfg.profile !== undefined && !['standard', 'polyglot-monorepo', 'custom'].includes(cfg.profile)) {
    errors.push(`Invalid 'profile' '${cfg.profile}': expected standard, polyglot-monorepo, or custom.`);
  }

  if (cfg.ci !== undefined) {
    if (!isPlainObject(cfg.ci)) {
      errors.push("'ci' must be an object when present.");
    } else if (cfg.ci.runsOn !== undefined) {
      const ro = cfg.ci.runsOn;
      if (typeof ro === 'string') {
        if (!ro.trim() || hasControlChar(ro)) {
          errors.push("'ci.runsOn' must be a non-empty string without control characters.");
        }
      } else if (Array.isArray(ro) && ro.length > 0) {
        for (const item of ro) {
          if (typeof item !== 'string' || !item.trim() || hasControlChar(item)) {
            errors.push("Every entry in 'ci.runsOn' array must be a non-empty string without control characters.");
            break;
          }
        }
      } else {
        errors.push("'ci.runsOn' must be a non-empty string or non-empty array of strings.");
      }
    }
  }

  if (cfg.lanes !== undefined) {
    if (!isPlainObject(cfg.lanes)) {
      errors.push("'lanes' must be an object when present.");
    } else {
      for (const key of ['trivialMaxLines', 'standardMaxLines']) {
        if (cfg.lanes[key] !== undefined && (!Number.isInteger(cfg.lanes[key]) || cfg.lanes[key] < 1)) {
          errors.push(`'lanes.${key}' must be an integer >= 1.`);
        }
      }
    }
  }

  if (cfg.projectManagement !== undefined) {
    if (!isPlainObject(cfg.projectManagement)) {
      errors.push("'projectManagement' must be an object when present.");
    } else {
      if (
        cfg.projectManagement.provider !== undefined &&
        !['github', 'linear', 'jira', 'local'].includes(cfg.projectManagement.provider)
      ) {
        errors.push(`Invalid 'projectManagement.provider' '${cfg.projectManagement.provider}'.`);
      }
      for (const pmStr of ['key', 'livingBoard']) {
        if (cfg.projectManagement[pmStr] !== undefined && typeof cfg.projectManagement[pmStr] !== 'string') {
          errors.push(`'projectManagement.${pmStr}' must be a string.`);
        }
      }
    }
  }

  if (cfg.archlens !== undefined) {
    if (!isPlainObject(cfg.archlens)) {
      errors.push("'archlens' must be an object when present.");
    } else {
      for (const boolKey of ['enabled', 'enforceInQualityGate']) {
        if (cfg.archlens[boolKey] !== undefined && typeof cfg.archlens[boolKey] !== 'boolean') {
          errors.push(`'archlens.${boolKey}' must be a boolean.`);
        }
      }
      if (cfg.archlens.policyPath !== undefined && typeof cfg.archlens.policyPath !== 'string') {
        errors.push("'archlens.policyPath' must be a string.");
      }
      if (
        cfg.archlens.workbenchPort !== undefined &&
        (!Number.isInteger(cfg.archlens.workbenchPort) || cfg.archlens.workbenchPort < 1 || cfg.archlens.workbenchPort > 65535)
      ) {
        errors.push("'archlens.workbenchPort' must be an integer between 1 and 65535.");
      }
    }
  }

  if (!Array.isArray(cfg.modules)) {
    errors.push("Missing required 'modules' array.");
  } else {
    cfg.modules.forEach((mod, idx) => {
      if (!isPlainObject(mod)) {
        errors.push(`modules[${idx}] must be an object.`);
        return;
      }
      if (typeof mod.name !== 'string' || !mod.name.trim()) {
        errors.push(`modules[${idx}].name must be a non-empty string.`);
      }
      if (typeof mod.path !== 'string' || !mod.path.trim()) {
        errors.push(`modules[${idx}].path must be a non-empty string.`);
      }
      for (const modStr of ['stack', 'language']) {
        if (mod[modStr] !== undefined && typeof mod[modStr] !== 'string') {
          errors.push(`modules[${idx}].${modStr} must be a string.`);
        }
      }
      if (!isPlainObject(mod.commands)) {
        errors.push(`modules[${idx}].commands must be an object.`);
      } else {
        for (const reqCmd of ['test', 'coverage']) {
          if (mod.commands[reqCmd] !== undefined && !isCommandSpec(mod.commands[reqCmd])) {
            errors.push(`modules[${idx}].commands.${reqCmd} must be a string or array of strings.`);
          }
        }
        for (const optCmd of ['lint', 'build', 'mutation']) {
          if (mod.commands[optCmd] !== undefined && mod.commands[optCmd] !== null && !isCommandSpec(mod.commands[optCmd])) {
            errors.push(`modules[${idx}].commands.${optCmd} must be null, a string, or an array of strings.`);
          }
        }
        if (mod.commands.coverageFile !== undefined && typeof mod.commands.coverageFile !== 'string') {
          errors.push(`modules[${idx}].commands.coverageFile must be a string.`);
        }
      }
      if (mod.thresholds !== undefined) {
        if (!isPlainObject(mod.thresholds)) {
          errors.push(`modules[${idx}].thresholds must be an object.`);
        } else {
          for (const tKey of ['diffCoverage', 'mutationScore']) {
            const val = mod.thresholds[tKey];
            if (val !== undefined && val !== null && (typeof val !== 'number' || Number.isNaN(val) || val < 0 || val > 100)) {
              errors.push(`modules[${idx}].thresholds.${tKey} must be null or a number in [0, 100].`);
            }
          }
        }
      }
    });
  }

  return {
    valid: errors.length === 0,
    exists: true,
    configPath: cfgPath,
    errors,
    config: errors.length === 0 ? cfg : null
  };
}

export function runDoctor(repoRoot = '.', { fix = false } = {}) {
  console.log('\n================================================================');
  console.log('🩺 AGENTIC SDLC FRAMEWORK DOCTOR & ENVIRONMENT HEALTHCHECK');
  console.log('================================================================');

  const tools = [
    { name: 'Git CLI', bin: 'git', args: ['--version'], minReq: 'git version' },
    { name: 'Node.js Runtime', bin: 'node', args: ['--version'], minReq: 'v' },
    { name: 'Skills CLI (npx skills)', bin: 'npx', args: ['skills', '--version'], minReq: '1.' },
    { name: 'GitHub CLI (gh)', bin: 'gh', args: ['--version'], minReq: 'gh version' },
    { name: 'Docker Engine', bin: 'docker', args: ['--version'], minReq: 'Docker version' }
  ];

  const toolResults = [];
  for (const t of tools) {
    try {
      const out = execFileSync(t.bin, t.args, { stdio: 'pipe', encoding: 'utf8' }).trim().split('\n')[0];
      toolResults.push({ name: t.name, status: true, version: out });
    } catch {
      toolResults.push({ name: t.name, status: false, version: 'Not found / Not installed' });
    }
  }

  console.log('\n🔧 System Toolchain:');
  for (const tr of toolResults) {
    const symbol = tr.status ? '✔' : '✖';
    console.log(`  ${symbol} ${tr.name.padEnd(20)}: ${tr.version}`);
  }

  const docAssets = [
    { name: 'Engine Config', path: '.agent/sdlc-config.json', critical: true },
    { name: 'Living Kanban', path: 'docs/KANBAN.md', critical: false },
    { name: 'Changelog', path: 'CHANGELOG.md', critical: false },
    { name: 'Spec Templates', path: 'docs/templates', critical: false },
    { name: 'Issue Templates', path: '.github/ISSUE_TEMPLATE/feature_request.md', critical: false },
    { name: 'Archlens Policy', path: '.archlens/policy.json', critical: false }
  ];

  console.log('\n📂 Framework Assets & Documentation:');
  const cfgValidation = validateConfigFile(repoRoot);
  const assetResults = [];
  for (const a of docAssets) {
    const isCfg = a.path === '.agent/sdlc-config.json';
    const present = isCfg ? cfgValidation.valid : fileExists(path.resolve(repoRoot, a.path));
    assetResults.push({
      name: a.name,
      path: a.path,
      status: present,
      critical: a.critical,
      ...(isCfg && cfgValidation.exists && !cfgValidation.valid ? { errors: cfgValidation.errors } : {})
    });
    const symbol = present ? '✔' : a.critical ? '✖' : '⚠';
    const detail = present
      ? `Present (${a.path})`
      : isCfg && cfgValidation.exists
        ? `INVALID (${cfgValidation.errors[0] || 'schema violation'})`
        : a.critical
          ? 'MISSING (Required)'
          : 'Optional / Recommended';
    console.log(`  ${symbol} ${a.name.padEnd(20)}: ${detail}`);
  }

  const sessionStatus = readSessionStatus(repoRoot);
  console.log('\n⚡ Session & Concurrency State:');
  if (sessionStatus.active && sessionStatus.session) {
    console.log(`  ⚠ Active Session: #${sessionStatus.session.issueId} (${sessionStatus.session.branch}) on Stage ${sessionStatus.session.stage}`);
  } else {
    console.log('  ✔ Active Sessions: Clean (no stale session locks detected)');
  }

  let hooks = inspectHooksHealth(repoRoot);
  if (hooks.isGitRepo) {
    console.log('\n🪝 Git Guard Hooks:');
    if (hooks.upToDate) {
      console.log('  ✔ 4-Layer Git Hooks  : Installed & SHA-256 template-verified');
    } else if (!hooks.installed) {
      console.log(`  ⚠ 4-Layer Git Hooks  : Missing [${hooks.missingHooks.join(', ')}]`);
    } else {
      console.log(`  ⚠ 4-Layer Git Hooks  : Outdated [${hooks.outdatedHooks.join(', ')}] — run doctor --fix or hooks install`);
    }
  }

  const autoFixed = [];
  if (fix) {
    console.log('\n🛠️ Running Doctor Auto-Fix for Missing or Outdated Framework Assets...');
    for (const a of assetResults) {
      if (!a.status) {
        if (a.path === 'docs/KANBAN.md') {
          createTicket({ title: 'Initialize Project Kanban', type: 'spike', repoRoot });
          autoFixed.push('docs/KANBAN.md');
        } else if (a.path === '.github/ISSUE_TEMPLATE/feature_request.md') {
          scaffoldIssueTemplates({ repoRoot });
          autoFixed.push('.github/ISSUE_TEMPLATE');
        } else if (a.path === '.archlens/policy.json') {
          scaffoldArchlensPolicy(repoRoot);
          autoFixed.push('.archlens/policy.json');
        }
      }
    }

    if (hooks.isGitRepo && !hooks.upToDate) {
      installHooks({ repoRoot });
      hooks = inspectHooksHealth(repoRoot);
      autoFixed.push('git-hooks');
    }
    if (!fs.existsSync(path.resolve(repoRoot, '.github/workflows/sdlc-quality-gate.yml'))) {
      installCIWorkflow({ repoRoot });
      autoFixed.push('.github/workflows/sdlc-quality-gate.yml');
    }
    console.log(`✅ Doctor Auto-Fix completed (${autoFixed.length} asset(s) healed).`);
  }

  const allPassed = toolResults.filter((t) => t.name.includes('Git') || t.name.includes('Node')).every((t) => t.status);
  console.log('================================================================\n');

  return {
    healthy: allPassed,
    toolchain: toolResults,
    assets: assetResults,
    hooks,
    sessionStatus,
    configValidation: cfgValidation,
    autoFixed
  };
}

export function installCIWorkflow({ repoRoot = '.', force = false, runsOn = null } = {}) {
  console.log('⚙️ Scaffolding GitHub Actions Quality Gate CI/CD Workflow...');
  const workflowDir = path.resolve(repoRoot, '.github/workflows');
  fs.mkdirSync(workflowDir, { recursive: true });

  const workflowPath = path.resolve(workflowDir, 'sdlc-quality-gate.yml');
  if (fs.existsSync(workflowPath) && !force) {
    console.log(`⚠️ Workflow file already exists at ${workflowPath}. Use force to overwrite.`);
    return { success: true, created: false, path: workflowPath, reason: 'Already exists' };
  }

  const isDefaultRunsOn = (val) => {
    if (typeof val !== 'string') return false;
    const trimmed = val.trim();
    return (
      trimmed === 'ubuntu-latest' ||
      trimmed === 'self-hosted' ||
      trimmed === "${{ vars.SDLC_RUNS_ON || 'ubuntu-latest' }}" ||
      trimmed === "${{ vars.SDLC_RUNS_ON || 'self-hosted' }}"
    );
  };

  let cfgRunsOn = null;
  const cfgPath = path.resolve(repoRoot, '.agent/sdlc-config.json');
  if (fileExists(cfgPath)) {
    try {
      const cfg = JSON.parse(readFileSafe(cfgPath) || '{}');
      if (cfg?.ci?.runsOn) {
        cfgRunsOn = cfg.ci.runsOn;
      }
    } catch {}
  }

  let configuredRunsOn = runsOn;
  if (!configuredRunsOn && cfgRunsOn && !isDefaultRunsOn(cfgRunsOn)) {
    configuredRunsOn = cfgRunsOn;
  }
  if (!configuredRunsOn && fs.existsSync(workflowPath)) {
    try {
      const existingWorkflow = readFileSafe(workflowPath);
      const runsOnMatch = existingWorkflow.match(/^[ \t]*runs-on:[ \t]*(.+)$/m);
      if (runsOnMatch) {
        let existingVal = runsOnMatch[1].replace(/\s+#.*$/, '').trim();
        if (existingVal.startsWith('[') && existingVal.endsWith(']')) {
          try {
            const parsed = JSON.parse(existingVal);
            if (Array.isArray(parsed) && parsed.length > 0) {
              existingVal = parsed;
            }
          } catch {}
        }
        if (existingVal && !isDefaultRunsOn(existingVal)) {
          configuredRunsOn = existingVal;
        }
      }
    } catch {}
  }
  if (!configuredRunsOn && cfgRunsOn) {
    configuredRunsOn = cfgRunsOn;
  }

  let runsOnYaml = "${{ vars.SDLC_RUNS_ON || 'ubuntu-latest' }}";
  if (Array.isArray(configuredRunsOn) && configuredRunsOn.length > 0) {
    for (const item of configuredRunsOn) {
      if (/[\r\n]/.test(String(item))) {
        throw new Error('Invalid ci.runsOn entry: newline characters are not permitted.');
      }
    }
    runsOnYaml = `[${configuredRunsOn.map((item) => JSON.stringify(String(item))).join(', ')}]`;
  } else if (typeof configuredRunsOn === 'string' && configuredRunsOn.trim()) {
    if (/[\r\n]/.test(configuredRunsOn)) {
      throw new Error('Invalid ci.runsOn value: newline characters are not permitted.');
    }
    runsOnYaml = configuredRunsOn.trim();
  }

  const hasNpmLockfile =
    fileExists(path.resolve(repoRoot, 'package-lock.json')) ||
    fileExists(path.resolve(repoRoot, 'npm-shrinkwrap.json'));
  const nodeCacheYaml = hasNpmLockfile ? "\n          cache: 'npm'" : '';

  const workflowContent = `name: SDLC Quality Gate

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main, develop ]

permissions:
  contents: read

jobs:
  quality-gate:
    name: Universal Quality Gate, Spec-Drift & Merkle Receipt Defense
    runs-on: ${runsOnYaml}

    steps:
      - name: Checkout Code
        uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - name: Enforce Branch Flow Policy
        if: github.event_name == 'pull_request' && github.base_ref == 'main'
        env:
          HEAD_REF: \${{ github.head_ref }}
        run: |
          if [ "\$HEAD_REF" != "develop" ]; then
            echo "::error::Branch policy violation: Pull requests targeting 'main' must originate exclusively from 'develop'. Direct merges from '\$HEAD_REF' into 'main' are forbidden."
            exit 1
          fi
          echo "Branch policy validated: PR targeting 'main' originates from 'develop'."

      - name: Setup Node.js Runtime
        uses: actions/setup-node@v7
        with:
          node-version: 'lts/*'${nodeCacheYaml}

      - name: Install Dependencies
        run: |
          if [ -f "package-lock.json" ]; then
            npm ci --no-audit --no-fund
          elif [ -f "package.json" ]; then
            npm install --no-audit --no-fund
          fi

      - name: Verify Spec Drift
        run: |
          if [ -f ".agent/scripts/sdlc-engine.mjs" ]; then
            node .agent/scripts/sdlc-engine.mjs drift check
          fi

      - name: Validate SDLC Configuration
        run: |
          if [ -f ".agent/scripts/sdlc-engine.mjs" ]; then
            node .agent/scripts/sdlc-engine.mjs config check
          fi

      - name: Verify Universal Quality Gate & Hash-Chain Audit Ledger
        run: |
          if [ -f ".agent/scripts/sdlc-engine.mjs" ]; then
            node .agent/scripts/sdlc-engine.mjs audit verify
            node .agent/scripts/sdlc-engine.mjs skill-audit
            node .agent/scripts/sdlc-engine.mjs gate --strict --no-cache
          elif npm run | grep -q 'gate'; then
            npm run gate
          else
            npm test
          fi

      - name: Verify Signed Stage 7 Gate Receipt
        if: github.event_name == 'pull_request'
        env:
          SDLC_RECEIPT_KEY: \${{ secrets.SDLC_RECEIPT_KEY }}
          PR_HEAD_SHA: \${{ github.event.pull_request.head.sha }}
          PR_HEAD_REPO: \${{ github.event.pull_request.head.repo.full_name }}
          BASE_REPO: \${{ github.repository }}
        run: |
          if [ "\$PR_HEAD_REPO" != "\$BASE_REPO" ]; then
            echo "::warning::Skipping Stage 7 gate receipt verification for fork pull request (\$PR_HEAD_REPO)."
            exit 0
          fi
          if [ -z "\$SDLC_RECEIPT_KEY" ]; then
            echo "::error::Missing SDLC_RECEIPT_KEY secret: configure the repository secret SDLC_RECEIPT_KEY to verify Stage 7 gate receipts."
            exit 1
          fi
          if [ -f ".agent/scripts/sdlc-engine.mjs" ]; then
            node .agent/scripts/sdlc-engine.mjs guard verify --sha "\$PR_HEAD_SHA"
          fi
`;

  writeFileAtomic(workflowPath, workflowContent);
  console.log(`✅ GitHub Actions workflow scaffolded at ${workflowPath}`);

  const branchFlowPath = path.resolve(workflowDir, 'enforce-branch-flow.yml');
  const branchFlowContent = `name: Enforce Branch Flow Policy

on:
  pull_request:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: enforce-branch-flow-\${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  enforce-develop-source:
    name: Enforce Merge From Develop Only
    runs-on: ${runsOnYaml}
    steps:
      - name: Validate Pull Request Source Branch
        env:
          BASE_REF: \${{ github.base_ref }}
          HEAD_REF: \${{ github.head_ref }}
        run: |
          echo "Target branch (base): \$BASE_REF"
          echo "Source branch (head): \$HEAD_REF"
          if [ "\$HEAD_REF" != "develop" ]; then
            echo "::error::Branch policy violation: Pull requests targeting 'main' must originate exclusively from 'develop'. Direct merges from '\$HEAD_REF' into 'main' are forbidden."
            exit 1
          fi
          echo "Branch policy validated: PR targeting 'main' originates from 'develop'."
`;
  if (!fs.existsSync(branchFlowPath) || force) {
    writeFileAtomic(branchFlowPath, branchFlowContent);
    console.log(`✅ GitHub Actions branch flow policy scaffolded at ${branchFlowPath}`);
  }

  const releasePath = path.resolve(workflowDir, 'release.yml');
  const releaseContent = `name: Production Release

on:
  push:
    branches:
      - main
    paths-ignore:
      - 'media/**'
  workflow_dispatch:

permissions:
  contents: write
  packages: write
  id-token: write

concurrency:
  group: release-\${{ github.ref }}
  cancel-in-progress: false

jobs:
  release:
    name: Tag & Production Release
    runs-on: ${runsOnYaml}

    steps:
      - name: Checkout Code
        uses: actions/checkout@v7
        with:
          fetch-depth: 0
          token: \${{ secrets.GITHUB_TOKEN }}

      - name: Setup Node.js Runtime
        uses: actions/setup-node@v7
        with:
          node-version: "lts/*"
          registry-url: 'https://registry.npmjs.org'

      - name: Install Dependencies
        run: |
          if [ -f "package-lock.json" ]; then
            npm ci --no-audit --no-fund
          elif [ -f "package.json" ]; then
            npm install --no-audit --no-fund
          fi

      - name: Verify Strict Quality Gate
        run: |
          node .agent/scripts/sdlc-engine.mjs gate --strict --no-cache

      - name: Inspect Package Version & Release Tag
        id: version_check
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          PKG_NAME=\$(node -p "require('./package.json').name || ''" || true)
          VERSION=\$(node -p "require('./package.json').version")
          TAG="v\${VERSION}"
          echo "pkg_name=\${PKG_NAME}" >> \$GITHUB_OUTPUT
          echo "version=\${VERSION}" >> \$GITHUB_OUTPUT
          echo "tag=\${TAG}" >> \$GITHUB_OUTPUT
          if git rev-parse -q --verify "refs/tags/\${TAG}" >/dev/null 2>&1; then
            echo "tag_exists=true" >> \$GITHUB_OUTPUT
            echo "Release tag \${TAG} already exists."
          else
            echo "tag_exists=false" >> \$GITHUB_OUTPUT
            echo "Release tag \${TAG} does not exist yet."
          fi
          RELEASE_EXISTS=false
          if command -v gh >/dev/null 2>&1 && gh release view "\${TAG}" >/dev/null 2>&1; then
            RELEASE_EXISTS=true
          elif node -e "
            const https = require('node:https');
            const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
            const tag = process.argv[1] || '';
            if (!owner || !repo || !tag) process.exit(1);
            const req = https.get({
              hostname: 'api.github.com',
              path: '/repos/' + owner + '/' + repo + '/releases/tags/' + encodeURIComponent(tag),
              headers: {
                'User-Agent': 'agentic-sdlc-release',
                'Authorization': 'token ' + (process.env.GH_TOKEN || '')
              }
            }, (res) => {
              res.resume();
              process.exit(res.statusCode === 200 ? 0 : 1);
            });
            req.on('error', () => process.exit(1));
          " "\${TAG}" >/dev/null 2>&1; then
            RELEASE_EXISTS=true
          fi
          if [ "\$RELEASE_EXISTS" = "true" ]; then
            echo "release_exists=true" >> \$GITHUB_OUTPUT
            echo "GitHub Release \${TAG} already exists."
          else
            echo "release_exists=false" >> \$GITHUB_OUTPUT
            echo "GitHub Release \${TAG} does not exist yet."
          fi
          if [ -n "\${PKG_NAME}" ] && npm view "\${PKG_NAME}@\${VERSION}" version >/dev/null 2>&1; then
            echo "npm_published=true" >> \$GITHUB_OUTPUT
            echo "npm package \${PKG_NAME}@\${VERSION} is already published."
          else
            echo "npm_published=false" >> \$GITHUB_OUTPUT
            echo "npm package \${PKG_NAME}@\${VERSION} is not yet published."
          fi

      - name: Extract Release Notes from CHANGELOG.md
        if: steps.version_check.outputs.release_exists == 'false'
        id: release_notes
        env:
          VERSION: \${{ steps.version_check.outputs.version }}
          TAG: \${{ steps.version_check.outputs.tag }}
        run: |
          awk -v ver="\$VERSION" '
            { sub(/\\r\$/, "") }
            index(\$0, "## [" ver "]") == 1 { found=1; next }
            found && index(\$0, "## [") == 1 { exit }
            found { print }
          ' CHANGELOG.md > release-notes.md || true
          if [ ! -s release-notes.md ]; then
            echo "### Release \$TAG" > release-notes.md
            echo "Production release triggered by merging 'develop' into 'main'." >> release-notes.md
          fi
          cat release-notes.md

      - name: Create Git Tag & GitHub Release
        if: steps.version_check.outputs.tag_exists == 'false' || steps.version_check.outputs.release_exists == 'false'
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          TAG: \${{ steps.version_check.outputs.tag }}
          VERSION: \${{ steps.version_check.outputs.version }}
          TAG_EXISTS: \${{ steps.version_check.outputs.tag_exists }}
          RELEASE_EXISTS: \${{ steps.version_check.outputs.release_exists }}
        run: |
          if [ "\${TAG_EXISTS}" != "true" ]; then
            git config user.name "github-actions[bot]"
            git config user.email "github-actions[bot]@users.noreply.github.com"
            git tag -a "\$TAG" -m "Release \$TAG"
            git push origin "\$TAG"
          fi
          if [ "\${RELEASE_EXISTS}" != "true" ]; then
            if command -v gh >/dev/null 2>&1; then
              gh release create "\$TAG" \\
                --title "Release \$TAG" \\
                --notes-file release-notes.md
            else
              node -e "
                const fs = require('node:fs');
                const https = require('node:https');
                const body = fs.readFileSync('release-notes.md', 'utf8');
                const payload = JSON.stringify({
                  tag_name: process.env.TAG,
                  name: 'Release ' + process.env.TAG,
                  body,
                  draft: false,
                  prerelease: false
                });
                const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
                const req = https.request({
                  hostname: 'api.github.com',
                  path: '/repos/' + owner + '/' + repo + '/releases',
                  method: 'POST',
                  headers: {
                    'User-Agent': 'agentic-sdlc-release',
                    'Authorization': 'token ' + process.env.GH_TOKEN,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                  }
                }, res => {
                  let data = '';
                  res.on('data', chunk => data += chunk);
                  res.on('end', () => {
                    console.log('GitHub Release API Status:', res.statusCode);
                    if (res.statusCode === 422 && data.includes('already_exists')) {
                      console.log('GitHub Release already exists (already_exists); continuing idempotently.');
                      return;
                    }
                    if (res.statusCode >= 400) {
                      console.error('API Error:', data);
                      process.exit(1);
                    }
                    console.log('GitHub Release created successfully via REST API.');
                  });
                });
                req.on('error', err => { console.error(err); process.exit(1); });
                req.write(payload);
                req.end();
              "
            fi
          fi

      - name: Publish Package to NPM (When NPM_TOKEN is configured)
        if: steps.version_check.outputs.npm_published == 'false'
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
        run: |
          if [ -n "\${NODE_AUTH_TOKEN}" ]; then
            echo "Publishing package to npm registry..."
            npm publish --access public
          else
            echo "NPM_TOKEN secret is not set; skipping live npm publish."
            echo "Verifying package packing integrity via npm pack --dry-run..."
            npm pack --dry-run
          fi
`;
  if (!fs.existsSync(releasePath) || force) {
    writeFileAtomic(releasePath, releaseContent);
    console.log(`✅ GitHub Actions release workflow scaffolded at ${releasePath}`);
  }

  return {
    success: true,
    created: true,
    runsOn: runsOnYaml,
    path: workflowPath,
    branchFlowPath,
    releasePath
  };
}

export function inspectCIWorkflows(repoRoot = '.') {
  const workflowsDir = path.join(repoRoot, '.github/workflows');
  const detected = {
    testCommand: null,
    lintCommand: null,
    buildCommand: null
  };

  if (!fileExists(workflowsDir)) return detected;

  try {
    const files = fs
      .readdirSync(workflowsDir)
      .filter((f) => (f.endsWith('.yml') || f.endsWith('.yaml')) && !/^sdlc-quality-gate\.ya?ml$/i.test(f));
    for (const file of files) {
      const content = readFileSafe(path.join(workflowsDir, file));
      if (!content) continue;

      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        const match = trimmed.match(/^(-\s*)?run:\s*(.+)$/);
        if (match) {
          const runCmd = match[2].trim();
          let isSingleExecutable = false;
          try {
            parseCommandArgv(runCmd);
            isSingleExecutable = true;
          } catch {}
          if (!isSingleExecutable) continue;
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
  } catch {}

  return detected;
}

export function detectStackInDir(dirPath) {
  const absDir = path.resolve(dirPath);

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

  if (fileExists(path.join(absDir, 'package.json'))) {
    const pkgRaw = readFileSafe(path.join(absDir, 'package.json')) || '{}';
    let pkg = {};
    try {
      pkg = JSON.parse(pkgRaw);
    } catch {}

    const scripts = pkg.scripts || {};
    const testCmd = scripts['test:coverage'] ? 'npm run test:coverage' : scripts.test ? 'npm run test' : 'npm test';
    const lintCmd = scripts['lint'] ? 'npm run lint' : scripts['format:check'] ? 'npm run format:check' : null;
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

export function discoverModules(repoRoot = '.') {
  const modules = [];

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

  if (modules.length === 0) {
    modules.push({
      name: 'default',
      path: '.',
      stack: 'generic-script',
      language: 'generic',
      commands: {
        test: 'npm test',
        coverage: 'npm run test:coverage',
        coverageFile: 'coverage/coverage-summary.json',
        mutation: 'npx stryker run',
        lint: 'npm run lint',
        build: 'npm run build'
      },
      thresholds: {
        diffCoverage: 85,
        mutationScore: 80
      }
    });
  }

  return modules;
}

export function matchFilesToModules(files, modules) {
  const touched = new Set();
  const nonRootModules = modules.filter((m) => m.path !== '.');
  const rootModule = modules.find((m) => m.path === '.');

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

export function generateConfig(repoRoot = '.') {
  const ciCommands = inspectCIWorkflows(repoRoot);
  const modules = discoverModules(repoRoot);
  const pm = detectPMProvider(repoRoot);
  const archlens = inspectArchlens(repoRoot);

  if (modules.length === 1 && modules[0].path === '.') {
    if (ciCommands.testCommand) modules[0].commands.test = ciCommands.testCommand;
    if (ciCommands.lintCommand) modules[0].commands.lint = ciCommands.lintCommand;
    if (ciCommands.buildCommand) modules[0].commands.build = ciCommands.buildCommand;
  }

  return {
    $schema: './schemas/sdlc-config.schema.json',
    version: '2.1.0',
    generatedAt: new Date().toISOString(),
    profile: modules.length > 1 ? 'polyglot-monorepo' : 'standard',
    ci: {
      runsOn: "${{ vars.SDLC_RUNS_ON || 'ubuntu-latest' }}"
    },
    lanes: {
      trivialMaxLines: 25,
      standardMaxLines: 200
    },
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
}

export function printPreview(config) {
  console.log('\n================================================================');
  console.log('⚡ AGENTIC SDLC UNIVERSAL ENGINE: DETECTED CONFIGURATION PREVIEW');
  console.log('================================================================');
  console.log(`Profile:            ${config.profile}`);
  console.log(`Project Management: ${config.projectManagement?.provider || 'local'} (${config.projectManagement?.key || 'N/A'})`);
  console.log(
    `Archlens Clean Arch:${config.archlens?.enabled ? ' Enabled (' + config.archlens.policyPath + ')' : ' Disabled / Not Configured'}`
  );
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

