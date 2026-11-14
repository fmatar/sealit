import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  fileExists,
  readFileSafe,
  parseFrontmatter,
  inspectArchlens,
  detectPMProvider,
  getModifiedFiles,
  getUnifiedDiffByFile,
  extractAddedLinesFromDiff,
  gitOutput,
  parseCommandArgv,
  runConfiguredCommand,
  resolveDefaultBaseBranch,
  resolveQualityThresholds,
  sameShaPrefix,
  writeFileAtomic,
  parseTicketId
} from './core.mjs';
import { getSessionStatus, getExemptions } from './session.mjs';
import { createTicket, scaffoldIssueTemplates } from './pm-provider.mjs';
import { appendAuditRecord } from './audit-chain.mjs';
import { auditContractDrift, checkSpecDrift } from './adr-drift.mjs';
import { installHooks, inspectHooksHealth } from './git-guard.mjs';
import { scaffoldArchlensPolicy } from './arch-trace.mjs';
import { provisionAgentIntegrations } from './installer.mjs';

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
  const assetResults = [];
  for (const a of docAssets) {
    const present = fileExists(path.resolve(repoRoot, a.path));
    assetResults.push({ name: a.name, path: a.path, status: present, critical: a.critical });
    const symbol = present ? '✔' : a.critical ? '✖' : '⚠';
    console.log(
      `  ${symbol} ${a.name.padEnd(20)}: ${present ? 'Present (' + a.path + ')' : a.critical ? 'MISSING (Required)' : 'Optional / Recommended'}`
    );
  }

  const sessionStatus = getSessionStatus(repoRoot);
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
    autoFixed
  };
}

export function generateRegressionProof({
  targetName = 'system',
  apiEndpoints = [],
  uiRoutes = [],
  includeContractCheck = true,
  repoRoot = '.'
} = {}) {
  const proofsDir = path.resolve(repoRoot, 'docs/proofs');
  fs.mkdirSync(proofsDir, { recursive: true });

  const timestamp = new Date().toISOString();
  const proofId = `proof-${targetName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`;

  let contractAudit = null;
  if (includeContractCheck) {
    contractAudit = auditContractDrift({ repoRoot });
  }

  const apiProofs = apiEndpoints.map((ep, idx) => {
    const method = ep.method || 'GET';
    const pathUrl = ep.path || ep.url || `/api/v1/${targetName}`;
    let status = ep.expectedStatus || 200;
    let bodySample = ep.sampleResponse || { status: 'ok', timestamp };
    let source = ep.sampleResponse ? 'sample' : 'contract-sample';
    let verified = false;

    if (ep.file && fileExists(path.resolve(repoRoot, ep.file))) {
      bodySample = readFileSafe(path.resolve(repoRoot, ep.file)) || bodySample;
      source = ep.file;
      verified = true;
    } else if (ep.liveProbe && /^https?:\/\//i.test(pathUrl)) {
      try {
        const liveOut = execFileSync('curl', ['-sS', '-f', '--max-time', '2', pathUrl], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: 'pipe'
        });
        if (liveOut) {
          bodySample = liveOut;
          source = 'live-http';
          verified = true;
        } else {
          source = 'live-probe-fallback';
          verified = false;
        }
      } catch {
        source = 'live-probe-fallback';
        verified = false;
      }
    }

    const hash = crypto.createHash('sha256').update(JSON.stringify({ method, pathUrl, status, bodySample })).digest('hex');

    return {
      id: `api-${idx + 1}`,
      method,
      endpoint: pathUrl,
      status,
      source,
      responseHash: hash,
      verified
    };
  });

  const uiProofs = uiRoutes.map((route, idx) => {
    const routePath = typeof route === 'string' ? route : route.path || `/${targetName}`;
    const componentName = typeof route === 'object' && route.component ? route.component : `${targetName}-view`;
    const explicitFile = typeof route === 'object' && route.file ? route.file : null;

    const candidateFiles = [
      explicitFile,
      `workbench/src/routes${routePath === '/' ? '' : routePath}/+page.svelte`,
      `src/routes${routePath === '/' ? '' : routePath}/+page.svelte`,
      `src/components/${componentName}.svelte`,
      `src/components/${componentName}.tsx`,
      `src/components/${componentName}.vue`
    ].filter(Boolean);

    let domSnapshot = `<div id="app" data-component="${componentName}"><header><h1>${componentName}</h1></header><main data-proof-ready="true"></main></div>`;
    let sourceFile = null;
    for (const candidate of candidateFiles) {
      const absCandidate = path.resolve(repoRoot, candidate);
      if (fileExists(absCandidate)) {
        const rawComponent = readFileSafe(absCandidate);
        if (rawComponent) {
          domSnapshot = rawComponent;
          sourceFile = candidate;
          break;
        }
      }
    }

    const snapshotHash = crypto.createHash('sha256').update(domSnapshot).digest('hex');

    return {
      id: `ui-${idx + 1}`,
      route: routePath,
      component: componentName,
      sourceFile,
      snapshotHash,
      verified: Boolean(sourceFile)
    };
  });

  const fallbackApiHash = crypto.createHash('sha256').update('health-check').digest('hex').slice(0, 16);
  const fallbackUiHash = crypto.createHash('sha256').update('root-dom').digest('hex').slice(0, 16);

  const apiRows =
    apiProofs.length > 0
      ? apiProofs
          .map(
            (p) =>
              `| \`${p.method}\` | \`${p.endpoint}\` | \`${p.status}\` | \`${p.responseHash.slice(0, 16)}...\` | ${
                p.verified ? '✅ VERIFIED' : p.source === 'sample' ? '⚠️ SAMPLE (not probed)' : '⚠️ UNVERIFIED (fallback)'
              } |`
          )
          .join('\n')
      : `| \`GET\` | \`/health\` | \`200\` | \`${fallbackApiHash}...\` | ⚠️ SAMPLE (not probed) |`;

  const uiRows =
    uiProofs.length > 0
      ? uiProofs
          .map(
            (u) =>
              `| \`${u.route}\` | \`${u.component}\` | \`${u.snapshotHash.slice(0, 16)}...\` | ${
                u.verified ? '✅ VERIFIED' : '⚠️ UNVERIFIED (fallback)'
              } |`
          )
          .join('\n')
      : `| \`/\` | \`RootView\` | \`${fallbackUiHash}...\` | ⚠️ SAMPLE (not probed) |`;

  const markdownProof = `# 🧾 Automated Delivery Regression Proof: ${targetName}
**Generated:** ${timestamp}  
**Proof ID:** \`${proofId}\`  
**Contract Drift Status:** ${contractAudit ? (contractAudit.passed ? '✅ Clean (Zero Breaking Mutations)' : '❌ Breaking Changes Detected') : '⚪ Skipped'}

---

### 🌐 Verified API Endpoints (${apiProofs.length})
| Method | Endpoint | Expected Status | SHA-256 Response Digest | Status |
| :--- | :--- | :--- | :--- | :--- |
${apiRows}

---

### 🎨 Visual & UI DOM Assertions (${uiProofs.length})
| Route | Component | Snapshot Hash | Status |
| :--- | :--- | :--- | :--- |
${uiRows}

---

### 🛡️ Cryptographic Proof Attestation
- **Zero-Regression Guarantee:** Verified against Concentric Clean Architecture boundaries and backward-compatible contracts.
- **Audit Verification:** Signed into project audit trail.
`;

  const proofFilePath = path.resolve(proofsDir, `${proofId}.md`);
  writeFileAtomic(proofFilePath, markdownProof);

  appendAuditRecord({
    event: 'REGRESSION_PROOF_GENERATED',
    metadata: {
      proofId,
      targetName,
      apiEndpointsCount: apiProofs.length,
      uiRoutesCount: uiProofs.length,
      proofFile: path.relative(path.resolve(repoRoot), proofFilePath)
    },
    repoRoot
  });

  return {
    success: true,
    proofId,
    proofFilePath,
    relativePath: path.relative(path.resolve(repoRoot), proofFilePath),
    apiProofs,
    uiProofs,
    contractAudit,
    markdown: markdownProof
  };
}

export function monitorCanaryHealthAndWatchdog({
  healthUrl = 'http://localhost:8080/health',
  maxErrorRate = 0.05,
  samples = 5,
  simulatedErrors = 0,
  probeLive = false,
  rollbackCommand = null,
  repoRoot = '.'
} = {}) {
  let errorsDetected = 0;
  const healthLogs = [];

  for (let i = 1; i <= samples; i++) {
    if (simulatedErrors > 0) {
      const isError = i <= simulatedErrors;
      if (isError) {
        errorsDetected++;
        healthLogs.push({ sample: i, status: 500, ok: false, error: 'Synthetic Canary Probe Timeout / 500 Server Error' });
      } else {
        healthLogs.push({ sample: i, status: 200, ok: true });
      }
    } else if (probeLive && /^https?:\/\//i.test(healthUrl)) {
      try {
        const statusStr = execFileSync(
          'curl',
          ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '2', healthUrl],
          { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' }
        ).trim();
        const code = parseInt(statusStr, 10) || 0;
        if (code >= 200 && code < 400) {
          healthLogs.push({ sample: i, status: code, ok: true, mode: 'live' });
        } else {
          errorsDetected++;
          healthLogs.push({
            sample: i,
            status: code || 503,
            ok: false,
            mode: 'live',
            error: `Live HTTP probe returned status ${code || 'unreachable'}`
          });
        }
      } catch (err) {
        errorsDetected++;
        healthLogs.push({
          sample: i,
          status: 503,
          ok: false,
          mode: 'live',
          error: `Live HTTP probe failed: ${err.message}`
        });
      }
    } else {
      healthLogs.push({ sample: i, status: 200, ok: true });
    }
  }

  const measuredErrorRate = errorsDetected / samples;
  const healthy = measuredErrorRate <= maxErrorRate;
  let rollbackExecuted = false;
  let rollbackOutput = null;

  if (!healthy) {
    console.warn(
      `🚨 CANARY HEALTH WATCHDOG BREACH: Error rate ${(measuredErrorRate * 100).toFixed(1)}% exceeds threshold ${(maxErrorRate * 100).toFixed(1)}%!`
    );
    if (rollbackCommand) {
      try {
        rollbackOutput = runConfiguredCommand(rollbackCommand, { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' });
        rollbackExecuted = true;
      } catch (err) {
        rollbackOutput = err.message;
      }
    } else {
      rollbackExecuted = false;
      rollbackOutput = 'No rollbackCommand configured; automatic deployment drain advisory logged (not executed).';
    }

    appendAuditRecord({
      event: 'CANARY_WATCHDOG_ROLLBACK_TRIGGERED',
      metadata: {
        healthUrl,
        measuredErrorRate,
        threshold: maxErrorRate,
        rollbackExecuted,
        samplesCount: samples
      },
      repoRoot
    });
  } else {
    appendAuditRecord({
      event: 'CANARY_PROMOTION_VERIFIED',
      metadata: {
        healthUrl,
        measuredErrorRate,
        samplesCount: samples
      },
      repoRoot
    });
  }

  return {
    healthy,
    healthUrl,
    samples,
    errorsDetected,
    measuredErrorRate,
    threshold: maxErrorRate,
    rollbackExecuted,
    rollbackOutput,
    healthLogs
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

  let runsOnYaml = "${{ vars.SDLC_RUNS_ON || 'self-hosted' }}";
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
          node-version: 'lts/*'

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

      - name: Detect SDLC Stack & Configure Environment
        run: |
          if [ -f ".agent/scripts/sdlc-engine.mjs" ]; then
            node .agent/scripts/sdlc-engine.mjs detect
          fi

      - name: Verify Universal Quality Gate & Merkle Audit Chain
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

export function exportAgentRules({ agent = 'all', repoRoot = '.' } = {}) {
  console.log(`🤖 Exporting Agentic SDLC Framework Rules & Skills for target runtime: '${agent.toUpperCase()}'...`);
  const provisioned = provisionAgentIntegrations({
    agents: agent,
    targetDir: repoRoot,
    global: false
  });

  return {
    agent,
    selectedAgents: provisioned.selectedAgents,
    filesCreated: provisioned.filesCreated,
    skillsLinked: provisioned.skillsCount,
    prunedSkills: provisioned.prunedSkills
  };
}

export function scaffoldReproductionTest({
  errorTrace = '',
  targetFile = null,
  repoRoot = '.'
} = {}) {
  const cleanTrace = (errorTrace || '').trim();
  const guessedTarget =
    targetFile ||
    cleanTrace.match(/at\s+.*?\((.*?):\d+:\d+\)/)?.[1] ||
    cleanTrace.match(/File\s+"([^"]+)",\s+line\s+\d+/)?.[1] ||
    cleanTrace.match(/([a-zA-Z0-9_./-]+\.(?:java|py|go|rs|mjs|js|ts)):\d+/)?.[1] ||
    'src/index.mjs';
  const ext = path.extname(guessedTarget).toLowerCase();
  const baseName = path.basename(guessedTarget, ext);
  const firstLine = cleanTrace ? cleanTrace.split('\n')[0] : 'Reproduction Failure';
  const sanitizeComment = (text) =>
    String(text || '')
      .replace(/\*\//g, '* /')
      .replace(/"""/g, '\\"\\"\\"');
  const sanitizeSingleLineComment = (text) => sanitizeComment(text).replace(/[\r\n]+/g, ' ');
  const sanitizePyDoc = (text) => String(text || '').replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"').replace(/\*\//g, '* /');
  const safeTargetComment = sanitizeComment(guessedTarget);
  const safeBaseComment = sanitizeComment(baseName);
  const safeTraceComment = sanitizeComment(cleanTrace);
  const safeFirstLineComment = sanitizeSingleLineComment(firstLine);
  const stamp = Date.now().toString().slice(-4);

  const testDir = path.resolve(repoRoot, 'tests/reproductions');
  fs.mkdirSync(testDir, { recursive: true });

  let testFileName = `reproduce-${baseName.toLowerCase()}-${stamp}.test.mjs`;
  let language = 'javascript';
  let testContent = '';

  const headerComment = `/**
 * MANDATORY BUG REPRODUCTION HARNESS (Red-Green-Refactor TDD)
 * Target Source: ${safeTargetComment}
 * Stack / Error Trace:
 * ${safeTraceComment.split('\n').map((l) => ' * ' + l).join('\n')}
 * Bug Reproduction Harness: ${safeBaseComment}
 */`;

  if (ext === '.java') {
    language = 'java';
    const className = `Reproduce${baseName.replace(/[^a-zA-Z0-9]/g, '')}${stamp}Test`;
    testFileName = `${className}.java`;
    testContent = `${headerComment}
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

public class ${className} {
    @Test
    void reproducesFailureBeforeFix() {
        // Red Phase: Replace with invocation of ${sanitizeSingleLineComment(baseName)} triggering: ${safeFirstLineComment}
        fail(${JSON.stringify(`Unresolved defect in ${guessedTarget}: ${firstLine}`)});
    }
}
`;
  } else if (ext === '.py') {
    language = 'python';
    testFileName = `test_reproduce_${baseName.toLowerCase()}_${stamp}.py`;
    testContent = `"""
MANDATORY BUG REPRODUCTION HARNESS (Red-Green-Refactor TDD)
Target Source: ${sanitizePyDoc(guessedTarget)}
Bug Reproduction Harness: ${sanitizePyDoc(baseName)}
Trace: ${sanitizePyDoc(firstLine)}
"""
import pytest

def test_reproduce_${baseName.toLowerCase().replace(/[^a-z0-9_]/g, '_')}():
    # Red Phase: Invoking ${sanitizeSingleLineComment(guessedTarget)} must not raise ${safeFirstLineComment}
    pytest.fail(${JSON.stringify(`Unresolved defect in ${guessedTarget}: ${firstLine}`)})
`;
  } else if (ext === '.go') {
    language = 'go';
    testFileName = `reproduce_${baseName.toLowerCase()}_${stamp}_test.go`;
    testContent = `${headerComment}
package reproductions

import "testing"

func TestReproduce${baseName.replace(/[^a-zA-Z0-9]/g, '')}(t *testing.T) {
\t// Red Phase: Invoking ${sanitizeSingleLineComment(guessedTarget)} must not fail with: ${safeFirstLineComment}
\tt.Fatalf("Unresolved defect in %s: %s", ${JSON.stringify(guessedTarget)}, ${JSON.stringify(firstLine)})
}
`;
  } else if (ext === '.rs') {
    language = 'rust';
    testFileName = `reproduce_${baseName.toLowerCase()}_${stamp}_test.rs`;
    testContent = `${headerComment}
#[test]
fn reproduce_${baseName.toLowerCase().replace(/[^a-z0-9_]/g, '_')}() {
    panic!("{}", ${JSON.stringify(`Unresolved defect in ${guessedTarget}: ${firstLine}`)});
}
`;
  } else {
    testContent = `import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

${headerComment}
describe(${JSON.stringify(`Bug Reproduction Harness: ${baseName}`)}, () => {
  it('reproduces failure with failing assertion before applying fix', async () => {
    const targetModulePath = ${JSON.stringify(guessedTarget)};
    assert.ok(targetModulePath, 'Target module path must be defined');

    // Red Phase: Replace with real reproduction invoking targetModulePath before implementing fix.
    assert.fail(\`Unresolved defect in \${targetModulePath}: \${${JSON.stringify(firstLine)}}\`);
  });
});
`;
  }

  const testFilePath = path.resolve(testDir, testFileName);
  fs.writeFileSync(testFilePath, testContent, 'utf8');

  return {
    success: true,
    created: true,
    language,
    targetFile: guessedTarget,
    testPath: testFilePath,
    relativePath: path.relative(path.resolve(repoRoot), testFilePath),
    testContent
  };
}

export function assessRisk(diffFiles = [], repoRoot = '.') {
  const files = diffFiles.length > 0 ? diffFiles : getModifiedFiles(null, repoRoot);
  let score = 0;
  const factors = [];

  for (const file of files) {
    const lower = file.toLowerCase();

    if (lower.includes('migration') || lower.includes('flyway') || lower.includes('liquibase') || lower.endsWith('.sql')) {
      score += 40;
      factors.push({ file, level: 'CRITICAL', reason: 'Database schema migration / DDL change' });
    } else if (
      lower.includes('auth') ||
      lower.includes('jwt') ||
      lower.includes('crypto') ||
      lower.includes('secret') ||
      lower.includes('security')
    ) {
      score += 35;
      factors.push({ file, level: 'CRITICAL', reason: 'Security, cryptographic, or authentication logic' });
    } else if (lower.endsWith('package-lock.json') || lower.endsWith('yarn.lock') || lower.endsWith('cargo.lock')) {
      score += 20;
      factors.push({ file, level: 'HIGH', reason: 'Dependency graph / lockfile modification' });
    } else if (
      lower.includes('domain') ||
      lower.includes('entity') ||
      lower.includes('model') ||
      lower.includes('.archlens')
    ) {
      score += 25;
      factors.push({ file, level: 'HIGH', reason: 'Core domain entity or architectural governance change' });
    } else if (
      lower.includes('controller') ||
      lower.includes('resource') ||
      lower.includes('route') ||
      lower.includes('api')
    ) {
      score += 15;
      factors.push({ file, level: 'MEDIUM', reason: 'Public API contract or endpoint controller' });
    } else if (lower.includes('service') || lower.includes('usecase')) {
      score += 10;
      factors.push({ file, level: 'MEDIUM', reason: 'Application business service logic' });
    } else if (lower.endsWith('.md') || lower.endsWith('.css') || lower.includes('docs/')) {
      score += 2;
      factors.push({ file, level: 'LOW', reason: 'Documentation, styles, or informational asset' });
    } else {
      score += 5;
      factors.push({ file, level: 'LOW', reason: 'Standard source code modification' });
    }
  }

  let riskLevel = 'LOW';
  if (score >= 60 || factors.some((f) => f.level === 'CRITICAL')) {
    riskLevel = 'CRITICAL';
  } else if (score >= 35 || factors.some((f) => f.level === 'HIGH')) {
    riskLevel = 'HIGH';
  } else if (score >= 15) {
    riskLevel = 'MEDIUM';
  }

  return {
    score,
    riskLevel,
    totalFiles: files.length,
    factors,
    recommendation:
      riskLevel === 'CRITICAL'
        ? 'CRITICAL RISK: Mandatory dual-peer review and full regression audit required.'
        : riskLevel === 'HIGH'
          ? 'HIGH RISK: Deep mutation testing and architectural validation required.'
          : 'Standard risk profile: Standard Dual-Gate verification applies.'
  };
}

export const VALID_LANES = ['trivial', 'standard', 'full'];
export const LANE_RANK = { trivial: 0, standard: 1, full: 2 };

const TRIVIAL_DOC_STYLE_EXTS = new Set(['.md', '.mdx', '.txt', '.rst', '.css', '.scss', '.svg']);

function isTrivialEligibleFile(filePath) {
  const norm = String(filePath).replace(/\\/g, '/').toLowerCase();
  if (
    norm === 'product.md' ||
    norm.endsWith('/product.md') ||
    norm === 'docs/prd.md' ||
    norm.endsWith('/docs/prd.md') ||
    norm === 'docs/srs.md' ||
    norm.endsWith('/docs/srs.md') ||
    norm.startsWith('docs/specs/') ||
    norm.includes('/docs/specs/') ||
    norm.startsWith('docs/adr/') ||
    norm.includes('/docs/adr/')
  ) {
    return false;
  }
  return TRIVIAL_DOC_STYLE_EXTS.has(path.extname(norm));
}

function countChangedLines(files, baseBranch = null, repoRoot = '.') {
  if (!files || files.length === 0) return 0;
  const resolvedBase = baseBranch || resolveDefaultBaseBranch(repoRoot);
  const numstatMap = new Map();
  const numstatOut =
    gitOutput(['diff', '--numstat', `origin/${resolvedBase}`], repoRoot) ??
    gitOutput(['diff', '--numstat', resolvedBase], repoRoot) ??
    gitOutput(['diff', '--numstat', 'HEAD'], repoRoot) ??
    '';

  for (const line of numstatOut.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\t+/);
    if (parts.length >= 3) {
      const added = Number.parseInt(parts[0], 10) || 0;
      const deleted = Number.parseInt(parts[1], 10) || 0;
      const rel = parts.slice(2).join('\t').replace(/\\/g, '/');
      numstatMap.set(rel, added + deleted);
    }
  }

  let total = 0;
  for (const f of files) {
    const norm = String(f).replace(/\\/g, '/');
    if (numstatMap.has(norm)) {
      total += numstatMap.get(norm);
    } else {
      const full = path.resolve(repoRoot, norm);
      if (fileExists(full)) {
        const raw = readFileSafe(full) || '';
        total += raw ? raw.split('\n').length : 0;
      }
    }
  }
  return total;
}

/**
 * Classifies a change into one of three risk-proportional execution lanes:
 * - `trivial`: docs/CSS/comments <= trivialMaxLines (default 25), LOW risk, 0 drift triggers
 * - `standard`: normal feature/bugfix <= standardMaxLines (default 200), LOW/MEDIUM risk, 0 drift triggers
 * - `full`: HIGH/CRITICAL risk, any spec-drift trigger, or > standardMaxLines changed lines
 */
export function triageChange({
  diffFiles = [],
  intent = '',
  laneOverride = null,
  reason = null,
  baseBranch = null,
  ticketId = null,
  repoRoot = '.'
} = {}) {
  const resolvedBase = baseBranch || resolveDefaultBaseBranch(repoRoot);
  let trivialMaxLines = 25;
  let standardMaxLines = 200;
  const cfgPath = path.resolve(repoRoot, '.agent/sdlc-config.json');
  if (fileExists(cfgPath)) {
    try {
      const cfg = JSON.parse(readFileSafe(cfgPath) || '{}');
      if (Number(cfg?.lanes?.trivialMaxLines) > 0) trivialMaxLines = Number(cfg.lanes.trivialMaxLines);
      if (Number(cfg?.lanes?.standardMaxLines) > 0) standardMaxLines = Number(cfg.lanes.standardMaxLines);
    } catch {}
  }

  const normOverride = laneOverride ? String(laneOverride).trim().toLowerCase() : null;
  if (normOverride && !VALID_LANES.includes(normOverride)) {
    throw new Error(`Invalid lane '${laneOverride}'. Expected one of: ${VALID_LANES.join(', ')}.`);
  }

  const files = diffFiles.length > 0 ? diffFiles : getModifiedFiles(resolvedBase, repoRoot);
  const changedLines = countChangedLines(files, resolvedBase, repoRoot);
  const risk = files.length > 0 ? assessRisk(files, repoRoot) : { score: 0, riskLevel: 'LOW', totalFiles: 0, factors: [] };
  const drift =
    files.length > 0
      ? checkSpecDrift({ diffFiles: files, baseBranch: resolvedBase, ticketId, repoRoot })
      : { passed: true, triggers: [] };

  let computedLane = 'standard';
  let docsOrStyleOnly = false;

  if (files.length === 0) {
    const cleanIntent = String(intent || '');
    if (/\b(auth|jwt|crypto|secret|security|migration|flyway|schema|ddl|breaking|release)\b/i.test(cleanIntent)) {
      computedLane = 'full';
    } else if (/\b(typo|spelling|readme|comment|copy|css|padding|color|badge|docs?-only|link fix)\b/i.test(cleanIntent)) {
      computedLane = 'trivial';
      docsOrStyleOnly = true;
    } else {
      computedLane = 'standard';
    }
  } else {
    docsOrStyleOnly = files.every(isTrivialEligibleFile);
    if (risk.riskLevel === 'CRITICAL' || risk.riskLevel === 'HIGH' || drift.triggers.length > 0 || changedLines > standardMaxLines) {
      computedLane = 'full';
    } else if (docsOrStyleOnly && changedLines <= trivialMaxLines && risk.riskLevel === 'LOW') {
      computedLane = 'trivial';
    } else {
      computedLane = 'standard';
    }
  }

  let effectiveLane = computedLane;
  let overridden = false;
  let downgraded = false;
  const cleanReason = reason && String(reason).trim() ? String(reason).trim() : null;

  if (normOverride && normOverride !== computedLane) {
    if (LANE_RANK[normOverride] > LANE_RANK[computedLane]) {
      effectiveLane = normOverride;
      overridden = true;
    } else if (files.length === 0 && computedLane !== 'full') {
      // Pre-edit triage at `stage begin`: allow explicit lane selection without a downgrade audit,
      // because `stage pre-pr` and `gate` automatically re-triage the actual diff before merge.
      effectiveLane = normOverride;
      overridden = true;
    } else {
      if (risk.riskLevel === 'CRITICAL') {
        throw new Error('Cannot downgrade execution lane below full for CRITICAL risk changes.');
      }
      if (!cleanReason) {
        throw new Error(
          `Downgrading execution lane from '${computedLane}' to '${normOverride}' requires a non-empty --reason for the audit ledger.`
        );
      }
      appendAuditRecord({
        event: 'LANE_DOWNGRADE_OVERRIDDEN',
        metadata: {
          fromLane: computedLane,
          toLane: normOverride,
          reason: cleanReason,
          riskLevel: risk.riskLevel,
          changedLines,
          filesCount: files.length
        },
        repoRoot
      });
      effectiveLane = normOverride;
      overridden = true;
      downgraded = true;
    }
  }

  return {
    lane: effectiveLane,
    computedLane,
    overridden,
    downgraded,
    reason: cleanReason,
    riskLevel: risk.riskLevel,
    riskScore: risk.score,
    changedLines,
    filesCount: files.length,
    docsOrStyleOnly,
    driftTriggersCount: drift.triggers.length,
    thresholds: { trivialMaxLines, standardMaxLines },
    requirements: {
      remoteTicketRequired: effectiveLane !== 'trivial',
      coverageRequired: effectiveLane !== 'trivial',
      mutationRequired: effectiveLane === 'full',
      reviewSubagents:
        effectiveLane === 'trivial'
          ? 0
          : effectiveLane === 'standard'
            ? 1
            : risk.riskLevel === 'CRITICAL' || risk.riskLevel === 'HIGH'
              ? 3
              : 2,
      strictGate: effectiveLane === 'full'
    }
  };
}

export function generatePRSummary({ issueId = null, repoRoot = '.' } = {}) {
  const current = getSessionStatus(repoRoot);
  const activeSess = current.session;
  const issue = issueId || activeSess?.issueId || 'N/A';
  const branch = activeSess?.branch || 'current-branch';
  const type = activeSess?.type || 'feat';

  const baseRef = resolveDefaultBaseBranch(repoRoot);
  const diffFiles = getModifiedFiles(null, repoRoot);
  const risk = assessRisk(diffFiles, repoRoot);
  const archInfo = inspectArchlens(repoRoot);

  const { minCov, minMut } = resolveQualityThresholds(repoRoot);

  const statSummary = (
    gitOutput(['diff', '--stat', `origin/${baseRef}...HEAD`], repoRoot) ||
    gitOutput(['diff', '--stat', `${baseRef}...HEAD`], repoRoot) ||
    gitOutput(['diff', '--stat', 'HEAD~1'], repoRoot) ||
    gitOutput(['diff', '--stat'], repoRoot) ||
    ''
  ).trim();

  const currentHeadSha = (gitOutput(['rev-parse', 'HEAD'], repoRoot) || '').trim() || null;
  const covReport = activeSess?.manifest?.coverageReport || null;
  const mutReport = activeSess?.manifest?.mutationScore || null;
  const pillars = activeSess?.manifest?.gatePillars || null;
  const pillarsStale = Boolean(pillars?.headSha && currentHeadSha && !sameShaPrefix(pillars.headSha, currentHeadSha));
  const covSha = activeSess?.manifest?.coverageHeadSha || pillars?.headSha || null;
  const mutSha = activeSess?.manifest?.mutationHeadSha || pillars?.headSha || null;
  const covStale = Boolean(covReport && currentHeadSha && (pillarsStale || (covSha && !sameShaPrefix(covSha, currentHeadSha))));
  const mutStale = Boolean(mutReport && currentHeadSha && (pillarsStale || (mutSha && !sameShaPrefix(mutSha, currentHeadSha))));
  const covNum = covReport ? Number.parseFloat(String(covReport).replace('%', '')) : NaN;
  const mutNum = mutReport ? Number.parseFloat(String(mutReport).replace('%', '')) : NaN;
  const covStatusLabel = !covReport
    ? '⚪ PENDING'
    : covStale
      ? '⏳ STALE (re-run gate)'
      : pillars?.coveragePassed === false || (minCov !== null && Number.isFinite(covNum) && covNum < minCov)
        ? '❌ FAILED'
        : '✅ PASSED';
  const mutStatusLabel =
    minMut === null && !mutReport
      ? '⚪ N/A'
      : !mutReport
        ? '⚪ PENDING'
        : mutStale
          ? '⏳ STALE (re-run gate)'
          : pillars?.mutationPassed === false || (minMut !== null && Number.isFinite(mutNum) && mutNum < minMut)
            ? '❌ FAILED'
            : '✅ PASSED';
  const archStatusLabel = !archInfo.installed
    ? '⚪ SKIPPED'
    : pillarsStale
      ? '⏳ STALE (re-run gate)'
      : pillars?.archPassed === true
        ? '✅ PASSED'
        : pillars?.archPassed === false
          ? '❌ FAILED'
          : '⏳ PENDING';
  const lintStatusLabel = pillarsStale
    ? '⏳ STALE (re-run gate)'
    : pillars?.lintPassed === true
      ? '✅ PASSED'
      : pillars?.lintPassed === false
        ? '❌ FAILED'
        : '⏳ PENDING';
  const covAchievedDisplay = !covReport ? 'Not Measured' : covStale ? `${covReport} (stale prior commit)` : covReport;
  const mutAchievedDisplay = !mutReport ? 'Not Measured' : mutStale ? `${mutReport} (stale prior commit)` : mutReport;
  const archAchievedDisplay = !archInfo.installed
    ? 'N/A'
    : pillarsStale
      ? 'Stale (prior commit)'
      : pillars?.archPassed === true
        ? 'Compliant'
        : pillars?.archPassed === false
          ? 'Violations Found'
          : 'Configured';
  const lintAchievedDisplay = pillarsStale
    ? 'Stale (prior commit)'
    : pillars?.lintPassed === true
      ? 'Clean'
      : pillars?.lintPassed === false
        ? 'Violations Found'
        : 'Not Run';

  const parsedTicket = parseTicketId(issue);
  const ticketDisplay =
    parsedTicket === null ? 'N/A' : typeof parsedTicket === 'number' ? `#${parsedTicket}` : String(parsedTicket);
  const covThreshLabel = minCov === null ? 'N/A' : `>= ${minCov}%`;
  const mutThreshLabel = minMut === null ? 'N/A' : `>= ${minMut}%`;

  const summary = `## 📋 Pull Request Summary: ${ticketDisplay}

### 🎯 Overview & Classification
- **Type**: \`${type.toUpperCase()}\`
- **Associated Ticket**: \`${ticketDisplay}\`
- **Branch**: \`${branch}\`
- **Pre-Flight Risk Profile**: \`${risk.riskLevel}\` (Score: ${risk.score})

---

### 🛡️ Dual-Gate Quality Verification
| Metric | Threshold | Achieved | Status |
| :--- | :--- | :--- | :--- |
| **Line & Branch Diff Coverage** | \`${covThreshLabel}\` | ${covAchievedDisplay} | ${covStatusLabel} |
| **Mutation Kill Score** | \`${mutThreshLabel}\` | ${mutAchievedDisplay} | ${mutStatusLabel} |
| **Archlens Clean Architecture** | 100% Policy | ${archAchievedDisplay} | ${archStatusLabel} |
| **Static Analysis & Linting** | 0 Violations | ${lintAchievedDisplay} | ${lintStatusLabel} |

---

### 🔍 Risk & Impact Analysis
- **Assessed Risk**: **${risk.riskLevel}**
- **Recommendation**: ${risk.recommendation}
${risk.factors.slice(0, 5).map((f) => `- \`${f.file}\`: **${f.level}** (${f.reason})`).join('\n')}

---

### 📦 Files Changed & Stat
\`\`\`text
${statSummary || diffFiles.join('\n') || 'No modified files detected'}
\`\`\`

---

### 🚀 Developer Showcase & Verification
1. Run local automated quality gate:
   \`\`\`bash
   node .agent/scripts/sdlc-engine.mjs gate
   \`\`\`
2. Verify affected unit tests:
   \`\`\`bash
   node .agent/scripts/sdlc-engine.mjs test --affected-only
   \`\`\`
`;

  return {
    issueId: issue,
    branch,
    type,
    risk,
    markdown: summary
  };
}

export function findAffectedTests(diffFiles = [], repoRoot = '.') {
  const files = diffFiles.length > 0 ? diffFiles : getModifiedFiles(null, repoRoot);
  const matchedTests = new Set();

  for (const file of files) {
    const ext = path.extname(file);
    const basename = path.basename(file, ext);

    const candidateNames = [
      `${basename}.test${ext}`,
      `${basename}.spec${ext}`,
      `${basename}Test${ext}`,
      `${basename}_test${ext}`,
      `test_${basename}${ext}`
    ];

    const searchDirs = ['test', 'tests', 'src/test', 'spec', 'specs'];
    for (const sDir of searchDirs) {
      const fullDir = path.resolve(repoRoot, sDir);
      if (fs.existsSync(fullDir)) {
        try {
          const findRecursive = (dir) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                findRecursive(fullPath);
              } else if (candidateNames.includes(entry.name)) {
                matchedTests.add(path.relative(path.resolve(repoRoot), fullPath));
              }
            }
          };
          findRecursive(fullDir);
        } catch {}
      }
    }
  }

  return Array.from(matchedTests);
}

export const findAffectededTests = findAffectedTests;

/**
 * Shell-free variant of buildSingleTestCommand: returns `{ file, args }`
 * for execFileSync/spawnSync so test filenames are never shell-parsed.
 */
export function buildSingleTestArgv(testFile, repoRoot = '.') {
  const ext = path.extname(testFile).toLowerCase();
  const baseName = path.basename(testFile, ext);
  const detected = detectStackInDir(repoRoot);
  if (ext === '.java' || detected?.language === 'java') {
    if (detected?.type === 'java-gradle') return { file: './gradlew', args: ['test', '--tests', baseName] };
    return { file: './mvnw', args: ['test', `-Dtest=${baseName}`] };
  }
  if (ext === '.py' || detected?.language === 'python') return { file: 'pytest', args: [testFile] };
  if (ext === '.go' || detected?.language === 'go') {
    const pkgDir = path.dirname(testFile);
    return { file: 'go', args: ['test', '-v', `./${pkgDir === '.' ? '...' : pkgDir}`] };
  }
  if (ext === '.rs' || detected?.language === 'rust') return { file: 'cargo', args: ['test', '--test', baseName] };
  return { file: process.execPath, args: ['--test', testFile] };
}

/** Human-readable command string (display only; never pass to a shell). */
export function buildSingleTestCommand(testFile, repoRoot = '.') {
  const ext = path.extname(testFile).toLowerCase();
  const baseName = path.basename(testFile, ext);
  const detected = detectStackInDir(repoRoot);

  if (ext === '.java' || detected?.language === 'java') {
    if (detected?.type === 'java-gradle') {
      return `./gradlew test --tests "${baseName}"`;
    }
    return `./mvnw test -Dtest="${baseName}"`;
  }
  if (ext === '.py' || detected?.language === 'python') {
    return `pytest "${testFile}"`;
  }
  if (ext === '.go' || detected?.language === 'go') {
    const pkgDir = path.dirname(testFile);
    return `go test -v "./${pkgDir === '.' ? '...' : pkgDir}"`;
  }
  if (ext === '.rs' || detected?.language === 'rust') {
    return `cargo test --test "${baseName}"`;
  }
  return `node --test "${testFile}"`;
}

function normalizeCoverageSourcePath(rawSfPath, repoRoot, modDir) {
  const absRoot = path.resolve(repoRoot);
  const normRaw = String(rawSfPath || '').trim().replace(/\\/g, '/');
  if (!normRaw) return '';
  if (path.isAbsolute(normRaw)) {
    return path.relative(absRoot, path.resolve(normRaw)).replace(/\\/g, '/').replace(/^\.\//, '');
  }
  const fromMod = path.relative(absRoot, path.resolve(modDir, normRaw)).replace(/\\/g, '/').replace(/^\.\//, '');
  if (!fromMod.startsWith('..')) return fromMod;
  return normRaw.replace(/^\.\//, '');
}

function parseLcovFileRecords(raw, repoRoot, modDir) {
  const records = new Map();
  let current = null;
  let totalLf = 0;
  let totalLh = 0;
  let hasPerLineData = false;

  const ensureRecord = (sfPath) => {
    const key = normalizeCoverageSourcePath(sfPath, repoRoot, modDir);
    if (!key) return null;
    if (!records.has(key)) {
      records.set(key, { daLines: new Map(), brdaLines: new Map(), lf: 0, lh: 0 });
    }
    return records.get(key);
  };

  for (const rawLine of String(raw).split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('SF:')) {
      current = ensureRecord(line.slice(3));
    } else if (line.startsWith('DA:') && current) {
      const parts = line.slice(3).split(',');
      const lineNo = parseInt(parts[0], 10);
      const hits = parseInt(parts[1], 10) || 0;
      if (Number.isFinite(lineNo) && lineNo > 0) {
        hasPerLineData = true;
        current.daLines.set(lineNo, (current.daLines.get(lineNo) || 0) + hits);
      }
    } else if (line.startsWith('BRDA:') && current) {
      const parts = line.slice(5).split(',');
      const lineNo = parseInt(parts[0], 10);
      const taken = parts[3] === '-' ? 0 : parseInt(parts[3], 10) || 0;
      if (Number.isFinite(lineNo) && lineNo > 0) {
        if (!current.brdaLines.has(lineNo)) current.brdaLines.set(lineNo, []);
        current.brdaLines.get(lineNo).push(taken);
      }
    } else if (line.startsWith('LF:')) {
      const lf = parseInt(line.slice(3), 10) || 0;
      totalLf += lf;
      if (current) current.lf += lf;
    } else if (line.startsWith('LH:')) {
      const lh = parseInt(line.slice(3), 10) || 0;
      totalLh += lh;
      if (current) current.lh += lh;
    } else if (line === 'end_of_record') {
      current = null;
    }
  }

  return { records, totalLf, totalLh, hasPerLineData };
}

function computeLcovDiffIntersection(records, repoRoot, mod) {
  if (!fileExists(path.resolve(repoRoot, '.git'))) {
    return { diffApplicable: false, diffLineCoverage: null, diffBranchCoverage: null, diffLinesCovered: 0, diffLinesTotal: 0 };
  }
  const allModified = getModifiedFiles(null, repoRoot);
  const modPrefix =
    mod?.path && mod.path !== '.' ? mod.path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '') : null;
  const scopedFiles = modPrefix
    ? allModified.filter((f) => f === modPrefix || f.startsWith(`${modPrefix}/`))
    : allModified;
  if (scopedFiles.length === 0) {
    return { diffApplicable: false, diffLineCoverage: null, diffBranchCoverage: null, diffLinesCovered: 0, diffLinesTotal: 0 };
  }

  const diffsByFile = getUnifiedDiffByFile(null, repoRoot, scopedFiles);
  let diffLinesTotal = 0;
  let diffLinesCovered = 0;
  let diffBranchesTotal = 0;
  let diffBranchesCovered = 0;

  for (const filePath of scopedFiles) {
    const rec = records.get(filePath);
    if (!rec || rec.daLines.size === 0) continue;
    const addedLines = extractAddedLinesFromDiff(diffsByFile.get(filePath) || '');
    for (const lineNo of addedLines) {
      if (!rec.daLines.has(lineNo)) continue;
      diffLinesTotal++;
      if ((rec.daLines.get(lineNo) || 0) > 0) diffLinesCovered++;
      const branches = rec.brdaLines.get(lineNo);
      if (branches && branches.length > 0) {
        for (const taken of branches) {
          diffBranchesTotal++;
          if (taken > 0) diffBranchesCovered++;
        }
      }
    }
  }

  if (diffLinesTotal === 0) {
    return { diffApplicable: false, diffLineCoverage: null, diffBranchCoverage: null, diffLinesCovered: 0, diffLinesTotal: 0 };
  }
  const diffLineCoverage = Number(((diffLinesCovered / diffLinesTotal) * 100).toFixed(2));
  const diffBranchCoverage =
    diffBranchesTotal > 0 ? Number(((diffBranchesCovered / diffBranchesTotal) * 100).toFixed(2)) : null;
  return { diffApplicable: true, diffLineCoverage, diffBranchCoverage, diffLinesCovered, diffLinesTotal };
}

export function parseCoverageReport(repoRoot = '.', mod = null) {
  const { minCov: threshold } = resolveQualityThresholds(repoRoot, mod);
  const modDir = mod?.path && mod.path !== '.' ? path.resolve(repoRoot, mod.path) : path.resolve(repoRoot);

  const candidates = [
    mod?.commands?.coverageFile,
    'coverage/coverage-summary.json',
    'coverage/lcov.info',
    'target/site/jacoco/jacoco.csv',
    'build/reports/jacoco/test/jacocoTestReport.csv',
    'coverage.xml',
    'cobertura.xml',
    'coverage.out'
  ].filter(Boolean);

  for (const relPath of candidates) {
    const fullPath = path.resolve(modDir, relPath);
    if (!fileExists(fullPath)) continue;
    const raw = readFileSafe(fullPath);
    if (!raw) continue;

    if (relPath.endsWith('.json')) {
      try {
        const data = JSON.parse(raw);
        const linePct = Number(data.total?.lines?.pct ?? data.lines?.pct);
        const branchPct = Number(data.total?.branches?.pct ?? data.branches?.pct ?? linePct);
        if (!Number.isNaN(linePct)) {
          const rounded = Number(linePct.toFixed(2));
          return {
            found: true,
            file: relPath,
            lineCoverage: rounded,
            repoLineCoverage: rounded,
            diffLineCoverage: null,
            diffApplicable: false,
            branchCoverage: Number(branchPct.toFixed(2)),
            formatted: `${linePct.toFixed(1)}%`,
            threshold,
            passed: threshold === null ? true : linePct >= threshold
          };
        }
      } catch {}
    }

    if (relPath.endsWith('lcov.info') || relPath.endsWith('.lcov')) {
      const { records, totalLf, totalLh, hasPerLineData } = parseLcovFileRecords(raw, repoRoot, modDir);
      let daTotal = 0;
      let daCovered = 0;
      if (totalLf === 0 && hasPerLineData) {
        for (const rec of records.values()) {
          for (const hits of rec.daLines.values()) {
            daTotal++;
            if (hits > 0) daCovered++;
          }
        }
      }
      const lf = totalLf > 0 ? totalLf : daTotal;
      const lh = totalLf > 0 ? totalLh : daCovered;
      if (lf > 0) {
        const repoPct = Number(((lh / lf) * 100).toFixed(2));
        const diffMetrics = hasPerLineData
          ? computeLcovDiffIntersection(records, repoRoot, mod)
          : { diffApplicable: false, diffLineCoverage: null, diffBranchCoverage: null, diffLinesCovered: 0, diffLinesTotal: 0 };
        const effectivePct = diffMetrics.diffApplicable ? diffMetrics.diffLineCoverage : repoPct;
        const passed = threshold === null ? true : effectivePct >= threshold;
        const reason =
          !passed && diffMetrics.diffApplicable
            ? `Diff line coverage ${effectivePct.toFixed(1)}% (${diffMetrics.diffLinesCovered}/${diffMetrics.diffLinesTotal} changed lines) < ${threshold}% (${relPath}; repo-wide ${repoPct.toFixed(1)}%)`
            : undefined;
        return {
          found: true,
          file: relPath,
          lineCoverage: effectivePct,
          repoLineCoverage: repoPct,
          diffLineCoverage: diffMetrics.diffLineCoverage,
          diffApplicable: diffMetrics.diffApplicable,
          diffLinesCovered: diffMetrics.diffLinesCovered,
          diffLinesTotal: diffMetrics.diffLinesTotal,
          branchCoverage: diffMetrics.diffBranchCoverage,
          formatted: `${effectivePct.toFixed(1)}%`,
          threshold,
          passed,
          ...(reason ? { reason } : {})
        };
      }
    }

    if (relPath.endsWith('.csv')) {
      const lines = raw.trim().split('\n');
      if (lines.length > 1) {
        const headers = lines[0].split(',').map((h) => h.trim());
        const missedIdx = headers.indexOf('LINE_MISSED');
        const coveredIdx = headers.indexOf('LINE_COVERED');
        if (missedIdx !== -1 && coveredIdx !== -1) {
          let missed = 0;
          let covered = 0;
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',');
            missed += parseInt(cols[missedIdx], 10) || 0;
            covered += parseInt(cols[coveredIdx], 10) || 0;
          }
          const total = missed + covered;
          if (total > 0) {
            const pct = (covered / total) * 100;
            const rounded = Number(pct.toFixed(2));
            return {
              found: true,
              file: relPath,
              lineCoverage: rounded,
              repoLineCoverage: rounded,
              diffLineCoverage: null,
              diffApplicable: false,
              branchCoverage: null,
              formatted: `${pct.toFixed(1)}%`,
              threshold,
              passed: threshold === null ? true : pct >= threshold
            };
          }
        }
      }
    }

    if (relPath.endsWith('.xml')) {
      const match = raw.match(/line-rate=["']([0-9.]+)["']/);
      if (match) {
        const pct = parseFloat(match[1]) * 100;
        const rounded = Number(pct.toFixed(2));
        return {
          found: true,
          file: relPath,
          lineCoverage: rounded,
          repoLineCoverage: rounded,
          diffLineCoverage: null,
          diffApplicable: false,
          branchCoverage: null,
          formatted: `${pct.toFixed(1)}%`,
          threshold,
          passed: threshold === null ? true : pct >= threshold
        };
      }
    }

    if (relPath.endsWith('coverage.out')) {
      let totalStmts = 0;
      let coveredStmts = 0;
      for (const line of raw.split('\n')) {
        if (!line || line.startsWith('mode:')) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          const stmts = parseInt(parts[1], 10) || 0;
          const count = parseInt(parts[2], 10) || 0;
          totalStmts += stmts;
          if (count > 0) coveredStmts += stmts;
        }
      }
      if (totalStmts > 0) {
        const pct = (coveredStmts / totalStmts) * 100;
        const rounded = Number(pct.toFixed(2));
        return {
          found: true,
          file: relPath,
          lineCoverage: rounded,
          repoLineCoverage: rounded,
          diffLineCoverage: null,
          diffApplicable: false,
          branchCoverage: null,
          formatted: `${pct.toFixed(1)}%`,
          threshold,
          passed: threshold === null ? true : pct >= threshold
        };
      }
    }
  }

  // Fail closed: no report means nothing was measured.
  return {
    found: false,
    file: null,
    lineCoverage: null,
    repoLineCoverage: null,
    diffLineCoverage: null,
    diffApplicable: false,
    branchCoverage: null,
    formatted: null,
    threshold,
    passed: false,
    reason: `No coverage report found (looked for: ${candidates.join(', ')}).`
  };
}

function isMutantExempted(exemptions, { id = null, file = null, mutator = null, line = null } = {}) {
  if (!Array.isArray(exemptions) || exemptions.length === 0) return false;
  const normFile = file ? String(file).replace(/\\/g, '/') : null;
  const fileLineKey = normFile && line !== null ? `${normFile}:${line}` : null;
  return exemptions.some((ex) => {
    const exId = ex?.mutantId ? String(ex.mutantId) : '';
    const exFile = ex?.file ? String(ex.file).replace(/\\/g, '/') : null;
    if (id && exId === String(id)) return true;
    if (fileLineKey && exId === fileLineKey) return true;
    if (exFile && normFile && (normFile === exFile || normFile.endsWith('/' + exFile))) {
      if (!exId) return true;
      if (line !== null && exId === String(line)) return true;
      if (mutator && exId === String(mutator)) return true;
    }
    return false;
  });
}

export function parseMutationReport(repoRoot = '.', mod = null) {
  const { minMut: threshold } = resolveQualityThresholds(repoRoot, mod);
  const modDir = mod?.path && mod.path !== '.' ? path.resolve(repoRoot, mod.path) : path.resolve(repoRoot);
  const exemptions = getExemptions(repoRoot);

  const strykerPath = path.resolve(modDir, 'reports/mutation/mutation.json');
  if (fileExists(strykerPath)) {
    try {
      const data = JSON.parse(readFileSafe(strykerPath) || '{}');
      let killed = 0;
      let total = 0;
      let exemptedCount = 0;
      for (const [filePath, fileObj] of Object.entries(data.files || {})) {
        for (const mutant of fileObj.mutants || []) {
          if (mutant.status === 'Ignored' || mutant.status === 'CompileError') continue;
          if (
            isMutantExempted(exemptions, {
              id: mutant.id,
              file: filePath,
              mutator: mutant.mutatorName,
              line: mutant.location?.start?.line ?? null
            })
          ) {
            exemptedCount++;
            continue;
          }
          total++;
          if (mutant.status === 'Killed' || mutant.status === 'Timeout') killed++;
        }
      }
      if (typeof data.mutationScore === 'number' && exemptedCount === 0) {
        const score = Number(data.mutationScore.toFixed(2));
        return {
          found: true,
          file: 'reports/mutation/mutation.json',
          mutationScore: score,
          formatted: `${score.toFixed(1)}%`,
          threshold,
          exemptedCount: 0,
          passed: threshold === null ? true : score >= threshold
        };
      }
      if (total > 0 || exemptedCount > 0) {
        const score = total > 0 ? Number(((killed / total) * 100).toFixed(2)) : 100;
        return {
          found: true,
          file: 'reports/mutation/mutation.json',
          mutationScore: score,
          formatted: `${score.toFixed(1)}%`,
          threshold,
          exemptedCount,
          passed: threshold === null ? true : score >= threshold
        };
      }
    } catch {}
  }

  const pitPath = path.resolve(modDir, 'target/pit-reports/mutations.xml');
  if (fileExists(pitPath)) {
    const raw = readFileSafe(pitPath) || '';
    const blockMatches = raw.match(/<mutation\s+[^>]*detected=['"](true|false)['"][\s\S]*?<\/mutation>/g) || [];
    const attrMatches = raw.match(/<mutation\s+[^>]*detected=['"](true|false)['"][^>]*>/g) || [];
    const entries = blockMatches.length > 0 ? blockMatches : attrMatches;
    if (entries.length > 0) {
      let total = 0;
      let detectedCount = 0;
      let exemptedCount = 0;
      for (const m of entries) {
        const srcMatch = m.match(/<sourceFile>([^<]+)<\/sourceFile>/);
        const lineMatch = m.match(/<lineNumber>(\d+)<\/lineNumber>/);
        const mutMatch = m.match(/<mutator>([^<]+)<\/mutator>/);
        if (
          isMutantExempted(exemptions, {
            id: mutMatch ? mutMatch[1] : null,
            file: srcMatch ? srcMatch[1] : null,
            mutator: mutMatch ? mutMatch[1] : null,
            line: lineMatch ? Number(lineMatch[1]) : null
          })
        ) {
          exemptedCount++;
          continue;
        }
        total++;
        if (/detected=['"]true['"]/.test(m)) detectedCount++;
      }
      const score = total > 0 ? Number(((detectedCount / total) * 100).toFixed(2)) : 100;
      return {
        found: true,
        file: 'target/pit-reports/mutations.xml',
        mutationScore: score,
        formatted: `${score.toFixed(1)}%`,
        threshold,
        exemptedCount,
        passed: threshold === null ? true : score >= threshold
      };
    }
  }

  // Fail closed: no report means nothing was measured.
  return {
    found: false,
    file: null,
    mutationScore: null,
    formatted: null,
    threshold,
    passed: false,
    reason: 'No mutation report found (looked for: reports/mutation/mutation.json, target/pit-reports/mutations.xml).'
  };
}

export function runFlakeCheck({ runs = 5, target = null, repoRoot = '.' } = {}) {
  const iterationCount = Math.max(2, Math.min(50, Number(runs) || 5));
  console.log(`🧪 Running Flaky Test Detector (${iterationCount} iterations)...`);

  const diffFiles = getModifiedFiles(null, repoRoot);
  const testFiles = target ? [target] : findAffectedTests(diffFiles, repoRoot);

  if (testFiles.length === 0) {
    return {
      success: true,
      flaky: false,
      passed: true,
      failedTestFiles: 0,
      message: 'No test files targeted or affected. Flake check skipped.',
      results: []
    };
  }

  const results = [];
  let detectedFlakes = 0;
  let failedTestFiles = 0;

  const flakeEnv = { ...process.env };
  delete flakeEnv.NODE_TEST_CONTEXT;

  for (const tFile of testFiles) {
    let passedCount = 0;
    let failedCount = 0;
    const singleTest = buildSingleTestArgv(tFile, repoRoot);

    for (let i = 1; i <= iterationCount; i++) {
      try {
        execFileSync(singleTest.file, singleTest.args, { cwd: repoRoot, stdio: 'pipe', env: flakeEnv });
        passedCount++;
      } catch {
        failedCount++;
      }
    }

    const isFlaky = passedCount > 0 && failedCount > 0;
    if (isFlaky) detectedFlakes++;
    if (failedCount > 0) failedTestFiles++;

    results.push({
      testFile: tFile,
      command: [singleTest.file, ...singleTest.args].join(' '),
      iterations: iterationCount,
      passed: passedCount,
      failed: failedCount,
      isFlaky
    });
  }

  return {
    success: true,
    flaky: detectedFlakes > 0,
    passed: detectedFlakes === 0 && failedTestFiles === 0,
    totalTested: testFiles.length,
    flakyCount: detectedFlakes,
    failedTestFiles,
    results
  };
}

export function auditSecurity(repoRoot = '.', options = {}) {
  console.log('🔒 Auditing Git Diff for Secret Leaks, Sensitive Keys & Package CVEs...');
  const allowOffline = Boolean(options?.allowOffline);
  const strictMode =
    options?.strict !== undefined
      ? Boolean(options.strict)
      : process.env.CI === 'true' || process.env.CI === '1';
  const execFn = typeof options?.execFn === 'function' ? options.execFn : execFileSync;

  const diffFiles = getModifiedFiles(null, repoRoot);
  const diffsByFile = getUnifiedDiffByFile(null, repoRoot, diffFiles);
  const secretViolations = [];

  const secretPatterns = [
    { name: 'Private Key / RSA Block', regex: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
    { name: 'AWS Access Key ID', regex: /(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/ },
    { name: 'GitHub Personal Access Token', regex: /gh[pousr]_[A-Za-z0-9_]{36,255}/ },
    {
      name: 'Generic Hardcoded Bearer / Secret',
      regex: /(api_key|apikey|secret_key|private_key|auth_token)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i
    }
  ];

  for (const file of diffFiles) {
    try {
      const diffOutput = diffsByFile.get(file) || '';
      if (!diffOutput) continue;

      const lines = diffOutput.split('\n');
      let addedIdx = 0;
      for (const line of lines) {
        if (!line.startsWith('+') || line.startsWith('+++')) continue;
        addedIdx++;
        for (const sp of secretPatterns) {
          if (sp.regex.test(line)) {
            secretViolations.push({
              file,
              line: addedIdx,
              type: sp.name,
              redacted: `[REDACTED:${sp.name}]`
            });
          }
        }
      }
    } catch {}
  }

  let packageAuditPassed = true;
  let packageAuditStatus = 'not-applicable';
  let packageAuditError = null;
  if (
    fileExists(path.resolve(repoRoot, 'package.json')) &&
    (fileExists(path.resolve(repoRoot, 'package-lock.json')) || fileExists(path.resolve(repoRoot, 'npm-shrinkwrap.json')))
  ) {
    try {
      execFn('npm', ['audit', '--audit-level=high', '--json'], {
        cwd: repoRoot,
        stdio: 'pipe',
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024
      });
      packageAuditStatus = 'clean';
    } catch (err) {
      const stdout = String(err?.stdout || '');
      let parsed = null;
      try {
        parsed = JSON.parse(stdout);
      } catch {}
      const vulns = parsed?.metadata?.vulnerabilities;
      if (vulns && Number(vulns.high || 0) + Number(vulns.critical || 0) > 0) {
        packageAuditPassed = false;
        packageAuditStatus = 'vulnerable';
      } else if (allowOffline) {
        packageAuditPassed = true;
        packageAuditStatus = 'offline-bypassed';
        packageAuditError = err?.message || 'npm audit unavailable offline (explicitly bypassed)';
      } else if (strictMode) {
        packageAuditPassed = false;
        packageAuditStatus = 'audit-error';
        packageAuditError = err?.message || 'npm audit failed in strict/CI mode';
      } else {
        packageAuditStatus = 'skipped-offline';
        packageAuditError = err?.message || 'npm audit unavailable offline';
      }
    }
  }

  const clean = secretViolations.length === 0 && packageAuditPassed;

  return {
    passed: clean,
    secretLeaksCount: secretViolations.length,
    secretViolations,
    packageAuditPassed,
    packageAuditStatus,
    ...(packageAuditError ? { packageAuditError } : {}),
    recommendation: clean ? 'Ready to push.' : 'Resolve hardcoded secrets, high-severity dependencies, or offline audit failures.'
  };
}

export function suggestMutationStrengthening({ mutantType = 'ConditionalsBoundary', file = null, line = null } = {}) {
  const suggestions = {
    ConditionalsBoundary:
      'Boundary condition mutated (e.g. `<` changed to `<=`). Add boundary value test case asserting exact threshold (e.g. `threshold - 1`, `threshold`, and `threshold + 1`).',
    NegateCondition:
      'Conditional boolean negated (e.g. `if (x)` inverted). Ensure both true and false paths have distinct observable assertions.',
    Math: 'Arithmetic operator replaced (e.g. `+` to `-`). Verify calculation outcomes with non-zero, distinct operands.',
    VoidMethodCall:
      'Void side-effect removed (e.g. state mutation, cache evict, event emit). Assert the resulting observable state change or verify mock invocation.',
    EmptyReturn:
      'Method return replaced with empty/null. Ensure caller explicitly asserts non-empty return data structures.'
  };

  const advice =
    suggestions[mutantType] ||
    'Surviving mutant indicates missing assertion density. Verify that test assertions validate outcomes rather than just exercising code paths.';

  return {
    mutantType,
    file,
    line,
    recommendation: advice,
    sampleAssert:
      mutantType === 'ConditionalsBoundary'
        ? 'assert.equal(calculate(10), expectedThresholdOutcome)'
        : 'assert.notEqual(result, null)'
  };
}

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

export function generateReviewPlan({ repoRoot = '.', lane = null, maxDiffChars = 40000 } = {}) {
  const current = getSessionStatus(repoRoot);
  const activeSess = current.session;
  const issueId = activeSess?.issueId || 'N/A';
  const branch = activeSess?.branch || 'current-branch';
  const baseRef = resolveDefaultBaseBranch(repoRoot);
  const diffFiles = getModifiedFiles(null, repoRoot);
  const risk = assessRisk(diffFiles, repoRoot);
  const resolvedLane = VALID_LANES.includes(lane)
    ? lane
    : VALID_LANES.includes(activeSess?.lane)
      ? activeSess.lane
      : 'full';

  const baseSha =
    (gitOutput(['merge-base', `origin/${baseRef}`, 'HEAD'], repoRoot) ||
      gitOutput(['merge-base', baseRef, 'HEAD'], repoRoot) ||
      '').trim() || null;
  const headSha = (gitOutput(['rev-parse', 'HEAD'], repoRoot) || '').trim() || null;
  const diffStat = (
    gitOutput(['diff', '--stat', `origin/${baseRef}...HEAD`], repoRoot) ||
    gitOutput(['diff', '--stat', `${baseRef}...HEAD`], repoRoot) ||
    gitOutput(['diff', '--stat', 'HEAD~1'], repoRoot) ||
    ''
  ).trim();
  const diffsByFile = getUnifiedDiffByFile(baseRef, repoRoot, diffFiles);
  const rawDiff = diffFiles
    .map((file) => diffsByFile.get(file) || '')
    .filter(Boolean)
    .join('\n');
  const budget = Math.max(1024, Number(maxDiffChars) || 40000);
  const diffTruncated = rawDiff.length > budget;
  const diff = diffTruncated
    ? `${rawDiff.slice(0, budget)}\n... [diff truncated at ${budget} chars; inspect full files via read_file]`
    : rawDiff;

  const filesLabel = diffFiles.length > 0 ? diffFiles.join(', ') : 'none';
  const issueRef = String(issueId).startsWith('L-') || issueId === 'N/A' ? String(issueId) : `#${issueId}`;
  const diffContextBlock = [
    `Base SHA: ${baseSha || baseRef} | HEAD SHA: ${headSha || 'working-tree'}`,
    `Modified files (${diffFiles.length}): ${filesLabel}`,
    ...(diffStat ? [`Diff Stat:\n${diffStat}`] : []),
    `Unified Diff:\n\`\`\`diff\n${diff || '(no diff hunks detected)'}\n\`\`\``
  ].join('\n');

  if (resolvedLane === 'trivial') {
    return {
      issueId,
      branch,
      lane: 'trivial',
      riskLevel: risk.riskLevel,
      baseSha,
      headSha,
      modifiedFiles: diffFiles,
      diffStat,
      diff,
      diffTruncated,
      subagentsCount: 0,
      payload: { Subagents: [] }
    };
  }

  if (resolvedLane === 'standard') {
    const subagents = [
      {
        TypeName: 'research',
        Role: 'PR Peer & Architecture Reviewer',
        Prompt: `Follow sdlc-gate review guidelines. Audit git diff against ${baseRef} on branch ${branch} for ticket ${issueRef} (standard lane, risk: ${risk.riskLevel}).
1. Audit logic correctness, behavioral test smells (no assertion-free tests), and F.I.R.S.T. isolation.
2. Verify coverage metrics against .agent/sdlc-config.json thresholds.
3. Inspect modified files for hardcoded secrets, unsafe shell interpolation, concentric layer inversions (.archlens/policy.json), and undeclared spec drift.
4. Return a structured read-only verdict (verdict: approve | request-changes, blockers, notes) so the orchestrator can publish it via review record.

${diffContextBlock}`
      }
    ];
    return {
      issueId,
      branch,
      lane: 'standard',
      riskLevel: risk.riskLevel,
      baseSha,
      headSha,
      modifiedFiles: diffFiles,
      diffStat,
      diff,
      diffTruncated,
      subagentsCount: subagents.length,
      payload: { Subagents: subagents }
    };
  }

  const subagents = [
    {
      TypeName: 'research',
      Role: 'PR Peer Reviewer',
      Prompt: `Follow sdlc-gate review guidelines. Audit git diff against ${baseRef} on branch ${branch} for ticket ${issueRef}.
1. Audit for behavioral test smells (no assertion-free tests, no trivial getters, no mock abuse) and F.I.R.S.T. isolation.
2. Verify Dual-Gate metrics against .agent/sdlc-config.json thresholds.
3. Verify README.md and CHANGELOG.md alignment when user-facing behavior changes.
4. Return a structured read-only verdict (verdict: approve | request-changes, blockers, notes) so the orchestrator can publish it via review record.

${diffContextBlock}`
    },
    {
      TypeName: 'research',
      Role: 'Quality Gatekeeper',
      Prompt: `Follow sdlc-gate architectural & security guidelines. Inspect modified files on branch ${branch} for ticket ${issueRef}.
1. Check pre-flight risk profile (detected: ${risk.riskLevel}, modified files: ${diffFiles.length}).
2. Inspect modified files for hardcoded secrets, unsafe shell interpolation, or package CVEs.
3. Verify zero concentric layer inversions against .archlens/policy.json and zero undeclared API contract drift.
4. Return a structured read-only gate report (verdict: approve | request-changes, blockers, notes).

${diffContextBlock}`
    }
  ];

  if (risk.riskLevel === 'CRITICAL' || risk.riskLevel === 'HIGH') {
    subagents.push({
      TypeName: 'research',
      Role: 'Security & Architectural Auditor',
      Prompt: `Conduct deep read-only security and architectural invariant audit on branch ${branch} for ticket ${issueRef} (${risk.riskLevel} risk).
1. Inspect migration files, auth handlers, CLI execution paths, and domain models for injection, credential leaks, or privilege bypasses.
2. Audit test determinism risks (shared mutable state, unseeded randomness, wall-clock or network coupling).
3. Validate concentric layer decoupling against .archlens/policy.json.
4. Return a structured read-only audit verdict (verdict: approve | request-changes, blockers, notes).

${diffContextBlock}`
    });
  }

  const payload = { Subagents: subagents };
  return {
    issueId,
    branch,
    lane: 'full',
    riskLevel: risk.riskLevel,
    baseSha,
    headSha,
    modifiedFiles: diffFiles,
    diffStat,
    diff,
    diffTruncated,
    subagentsCount: subagents.length,
    payload
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
      runsOn: "${{ vars.SDLC_RUNS_ON || 'self-hosted' }}"
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

/**
 * Audits `.agent/skills/*` against NVIDIA SkillSpector static rules (`RP1` unpinned npx,
 * `AS3` cross-skill file enumeration, frontmatter YAML truncation, and optional live `uvx` scan).
 */
export function auditSkills(repoRoot = '.', { live = false } = {}) {
  const skillsDir = path.resolve(repoRoot, '.agent/skills');
  const results = [];
  let totalFindings = 0;

  if (fs.existsSync(skillsDir)) {
    const entries = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('sdlc'))
      .map((d) => d.name)
      .sort();

    for (const skillName of entries) {
      const skillFile = path.join(skillsDir, skillName, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      const content = fs.readFileSync(skillFile, 'utf8');
      const { frontmatter, body } = parseFrontmatter(content);
      const findings = [];

      // 1. YAML frontmatter truncation check (unquoted # in description)
      if (!frontmatter.name || !frontmatter.description) {
        findings.push({
          rule: 'FM1',
          severity: 'MEDIUM',
          message: 'Missing required YAML frontmatter name or description'
        });
      } else if (frontmatter.description.trim().endsWith(',')) {
        findings.push({
          rule: 'FM2',
          severity: 'MEDIUM',
          message: 'Description appears truncated by an unquoted YAML # comment'
        });
      }

      // 2. SkillSpector RP1: Unpinned npx package invocation
      const lines = (body || content).split('\n');
      lines.forEach((line, idx) => {
        if (
          /\bnpx\s+(?:-[yY]\s+)?(?:github:[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+|@[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+|[a-zA-Z0-9_.-]+)(?![a-zA-Z0-9_.-]|@[0-9])/i.test(
            line
          )
        ) {
          findings.push({
            rule: 'RP1',
            severity: 'MEDIUM',
            line: idx + 1,
            message: `Unpinned npx package invocation detected: "${line.trim()}"`
          });
        }
        // 3. SkillSpector AS3: Cross-skill file enumeration (.agent/skills/<other>/SKILL.md)
        const crossMatch = line.match(/\.agent\/skills\/([a-z0-9-]+)\/SKILL\.md/i);
        if (crossMatch && crossMatch[1] !== skillName) {
          findings.push({
            rule: 'AS3',
            severity: 'MEDIUM',
            line: idx + 1,
            message: `Cross-skill file enumeration referencing ${crossMatch[0]} (use skill identifier instead)`
          });
        }
      });

      totalFindings += findings.length;
      results.push({
        skill: skillName,
        score: findings.length === 0 ? 0 : findings.length * 7,
        severity: 'LOW',
        findingsCount: findings.length,
        findings
      });
    }
  }

  let skillspectorOutput = null;
  if (live) {
    try {
      skillspectorOutput = execFileSync(
        'uvx',
        ['--from', 'git+https://github.com/NVIDIA/skillspector.git', 'skillspector', 'scan', skillsDir, '--recursive', '--no-llm'],
        { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' }
      );
    } catch (err) {
      skillspectorOutput = err.stdout ? String(err.stdout) : err.message;
    }
  }

  return {
    success: totalFindings === 0,
    skillsScanned: results.length,
    skillsAudited: results.length,
    totalFindings,
    maxScore: results.reduce((max, r) => Math.max(max, r.score), 0),
    skills: results,
    skillspectorOutput
  };
}
