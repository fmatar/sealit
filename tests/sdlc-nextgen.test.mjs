import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execSync, execFileSync } from 'node:child_process';

import {
  CLAUDE_TOOL_MAP,
  toClaudeDialect,
  toClaudeSkill,
  mergeRulesFile
} from '../.agent/scripts/lib/installer.mjs';

import {
  // Core & Async Pool
  execAsync,
  runParallelTasks,
  // Content-Addressable SHA-256 Gate Cache
  computeTreeHash,
  getGateCacheHit,
  recordGateCache,
  clearGateCache,
  getGateCacheStats,
  // Context-Compressed Dossiers
  generateTicketDossier,
  // PRODUCT.md & Topological DAG Autopilot
  initProductConstitution,
  scaffoldCapabilitySpec,
  parseProductMarkdown,
  planProductDAG,
  controlProductDAG,
  // ADR Lifecycle & Spec-Drift Sentinel
  createADR,
  listADRs,
  decideADR,
  compactADRs,
  checkSpecDrift,
  // Causal Decision Graph
  appendDecisionEvent,
  buildDecisionGraph,
  syncDecisionMapMarkdown,
  // 4-Layer Git Lockdown & Cryptographic Gate Receipts
  verifyCommitGuard,
  verifyMergeGuard,
  verifyPushGuard,
  issueGateReceipt,
  verifyGateReceipt,
  // Existing + Upgraded Engine Exports
  startSession,
  updateSession,
  executeCompositeStage,
  findAffectedTests,
  buildSingleTestCommand,
  parseCoverageReport,
  parseMutationReport,
  generatePRSummary,
  checkArchDiff,
  scaffoldReproductionTest,
  generateRegressionProof,
  scaffoldIssueTemplates,
  loadIssueTemplate,
  formatTemplatedIssue,
  createTicket,
  transitionPMState,
  postPMComment,
  resolveOpenPRNumber,
  ensurePullRequest,
  formatConsolidatedReviewComment,
  hasGitHubRemote,
  detectPMProvider,
  installHooks,
  createWorkbenchServer,
  ensureWorkbenchRunning,
  buildArchDiffPayload,
  generateArchitectureWidget,
  executeRelease,
  SUPPORTED_AGENTS,
  CANONICAL_SDLC_SKILLS,
  DEPRECATED_SDLC_SKILLS,
  pruneDeprecatedSkills,
  installFramework,
  parseInstallArgs,
  formatCLIResult,
  inspectSourceModule,
  resolveArchlensRing,
  buildWikiCodeMap,
  auditWiki,
  syncWiki,
  detectReadmeArchetype,
  stripArchetypeBlocks,
  renderThemeWordmarkSvg,
  renderVhsDemoTape,
  scaffoldReadme,
  auditReadme,
  runCLI
} from '../.agent/scripts/sdlc-engine.mjs';

function initTempGitRepo(dir) {
  execSync('git init -b main', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "agent@sdlc.local"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "SDLC Agent"', { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Genesis Repo\n', 'utf8');
  execSync('git add README.md && git commit -m "chore: initial commit"', { cwd: dir, stdio: 'pipe' });
}

function httpRequest(port, method, urlPath, bodyObj = null, token = 'nextgen-test-token') {
  return new Promise((resolve, reject) => {
    const payload = bodyObj ? JSON.stringify(bodyObj) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(token ? { 'X-SDLC-Token': token } : {})
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, body: data, json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('Next-Gen Agentic SDLC: Modular Libs, PRODUCT.md Autopilot, Spec Drift/ADR, 4-Layer Guard & Decision Workbench', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-nextgen-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // =========================================================================
  // 1. Async Parallel Subprocess Engine & Content-Addressable SHA-256 Cache
  // =========================================================================
  describe('1. Async Parallel Pool & Content-Addressable SHA-256 Gate Cache', () => {
    it('executes async commands and runs parallel tasks with concurrency limits', async () => {
      const out = await execAsync('echo "async-pool-ok"', { cwd: tmpDir });
      assert.ok(out.stdout.includes('async-pool-ok'));

      const order = [];
      const tasks = [1, 2, 3, 4, 5].map((n) => async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push(n);
        return n * 10;
      });

      const results = await runParallelTasks(tasks, 2);
      assert.deepEqual(results, [10, 20, 30, 40, 50]);
      assert.equal(order.length, 5);
    });

    it('records SHA-256 gate cache hits and invalidates automatically when workspace files change', () => {
      initTempGitRepo(tmpDir);
      const srcFile = path.join(tmpDir, 'src.js');
      fs.writeFileSync(srcFile, 'export const a = 1;\n', 'utf8');

      const hash1 = computeTreeHash(tmpDir, '.');
      assert.equal(typeof hash1, 'string');
      assert.equal(hash1.length, 64);

      // Initially miss
      const miss = getGateCacheHit({ checkType: 'coverage', modulePath: '.', repoRoot: tmpDir });
      assert.equal(miss.hit, false);

      // Record pass
      const rec = recordGateCache({
        checkType: 'coverage',
        modulePath: '.',
        result: { passed: true, coveragePct: 94.5 },
        repoRoot: tmpDir
      });
      assert.equal(rec.success, true);

      // Now hit on identical tree state
      const hit = getGateCacheHit({ checkType: 'coverage', modulePath: '.', repoRoot: tmpDir });
      assert.equal(hit.hit, true);
      assert.equal(hit.entry.result.coveragePct, 94.5);

      // Mutate file -> hash changes -> cache misses deterministically
      fs.writeFileSync(srcFile, 'export const a = 2;\n', 'utf8');
      const hash2 = computeTreeHash(tmpDir, '.');
      assert.notEqual(hash1, hash2);

      const invalidated = getGateCacheHit({ checkType: 'coverage', modulePath: '.', repoRoot: tmpDir });
      assert.equal(invalidated.hit, false);

      const stats = getGateCacheStats(tmpDir);
      assert.equal(stats.entriesCount, 1);

      clearGateCache(tmpDir);
      assert.equal(getGateCacheStats(tmpDir).entriesCount, 0);
    });
  });

  // =========================================================================
  // 2. PRODUCT.md Constitution, Genesis Ticket #1 & Topological DAG Waves
  // =========================================================================
  describe('2. PRODUCT.md Constitution & Topological DAG Scheduler', () => {
    it('synthesizes PRODUCT.md with canonical CAP-XX, INV-XX, SPEC-XX IDs and provisions Genesis Ticket #1', () => {
      const initRes = initProductConstitution({
        title: 'Realtime Order Mesh',
        vision: 'Zero-latency event-driven order execution engine.',
        capabilities: [
          { title: 'Order Intake & Validation', spec: 'docs/specs/order-intake.md' },
          { title: 'Ledger Settlement Stream', spec: 'docs/specs/settlement.md', dependsOn: ['CAP-01'] },
          { title: 'Operator Mission UI', spec: 'docs/specs/operator-ui.md', dependsOn: ['CAP-01'] }
        ],
        invariants: [
          'Zero direct commits or merges to main without Stage 7 Gate Receipt',
          'All domain entities remain pure and free of framework imports'
        ],
        repoRoot: tmpDir
      });

      assert.equal(initRes.success, true);
      assert.equal(fs.existsSync(path.join(tmpDir, 'PRODUCT.md')), true);
      assert.equal(fs.existsSync(path.join(tmpDir, 'docs/PRD.md')), true);
      assert.equal(fs.existsSync(path.join(tmpDir, 'docs/SRS.md')), true);
      const specContent = fs.readFileSync(path.join(tmpDir, 'docs/specs/order-intake.md'), 'utf8');
      assert.ok(specContent.includes('## 1. PRD Slice: Problem Alignment & Scope'));
      assert.ok(specContent.includes('## 2. Functional Requirements (IEEE 29148 SRS)'));
      assert.equal(initRes.genesisTicket.issueId, 1);
      assert.ok(initRes.genesisTicket.branch.includes('feature/issue-#1-product-genesis'));

      const specRes = scaffoldCapabilitySpec({
        capId: 'CAP-04',
        title: 'Realtime Risk Scoring',
        problem: 'Detect anomalous order velocity before ledger settlement.',
        dependsOn: ['CAP-01', 'CAP-02'],
        repoRoot: tmpDir
      });
      assert.equal(specRes.success, true);
      assert.equal(fs.existsSync(specRes.absSpecPath), true);

      const parsed = parseProductMarkdown(tmpDir);
      assert.equal(parsed.title, 'Realtime Order Mesh');
      assert.equal(parsed.capabilities.length, 4);
      assert.equal(parsed.capabilities[0].id, 'CAP-01');
      assert.equal(parsed.capabilities[1].id, 'CAP-02');
      assert.equal(parsed.capabilities[3].id, 'CAP-04');
      assert.deepEqual(parsed.capabilities[1].dependsOn, ['CAP-01']);
      assert.equal(parsed.invariants.length, 2);
      assert.equal(parsed.invariants[0].id, 'INV-01');
    });

    it('computes topological DAG execution waves and supports pause/resume/trigger controls', () => {
      initProductConstitution({
        title: 'Multi-Wave Platform',
        capabilities: [
          { title: 'Core Domain Schema' },
          { title: 'REST Adapter Port', dependsOn: ['CAP-01'] },
          { title: 'SvelteKit Dashboard', dependsOn: ['CAP-01'] },
          { title: 'E2E Canary Telemetry', dependsOn: ['CAP-02', 'CAP-03'] }
        ],
        repoRoot: tmpDir
      });

      const dagPlan = planProductDAG({ repoRoot: tmpDir, autoProvision: false });
      assert.equal(dagPlan.success, true);
      assert.ok(dagPlan.waves.length >= 3);
      // Wave 1 has CAP-01; Wave 2 has CAP-02 and CAP-03 in parallel; Wave 3 has CAP-04
      const capWaveMap = new Map();
      dagPlan.waves.forEach((w) => w.items.forEach((item) => capWaveMap.set(item.id, w.wave)));
      assert.ok(capWaveMap.get('CAP-01') < capWaveMap.get('CAP-02'));
      assert.equal(capWaveMap.get('CAP-02'), capWaveMap.get('CAP-03'));
      assert.ok(capWaveMap.get('CAP-03') < capWaveMap.get('CAP-04'));

      const pauseRes = controlProductDAG({ action: 'pause', reason: 'Awaiting Product ADR review', repoRoot: tmpDir });
      assert.equal(pauseRes.state.status, 'paused');

      const resumeRes = controlProductDAG({ action: 'resume', repoRoot: tmpDir });
      assert.equal(resumeRes.state.status, 'running');
    });
  });

  // =========================================================================
  // 3. Dual-Enforced Spec Drift Sentinel & ADR Lifecycle
  // =========================================================================
  describe('3. Spec-Drift Sentinel & ADR Lifecycle (Technical Auto-Accept vs Product Approval)', () => {
    it('flags UNDECLARED_SPEC_DRIFT when dependencies, contracts, or C4 diagrams change without a linked ADR', () => {
      initTempGitRepo(tmpDir);
      initProductConstitution({
        title: 'Drift Guard App',
        capabilities: [{ title: 'Core API', spec: 'docs/specs/core-api.md' }],
        repoRoot: tmpDir
      });
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'app', dependencies: {} }, null, 2));
      execSync('git add . && git commit -m "chore: baseline product and package"', { cwd: tmpDir, stdio: 'pipe' });

      // Checkout feature branch for ticket #12 and mutate package.json + openapi.json without ADR
      execSync('git checkout -b feature/issue-#12-new-dep', { cwd: tmpDir, stdio: 'pipe' });
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'app', dependencies: { redis: '^4.0.0' } }, null, 2)
      );
      fs.writeFileSync(path.join(tmpDir, 'openapi.json'), JSON.stringify({ openapi: '3.0.0', paths: { '/v2/stream': {} } }));

      const driftRes = checkSpecDrift({
        diffFiles: ['package.json', 'openapi.json', 'docs/PRD.md', 'docs/SRS.md'],
        ticketId: 12,
        repoRoot: tmpDir
      });

      assert.equal(driftRes.passed, false);
      assert.equal(driftRes.hasUndeclaredDrift, true);
      assert.ok(driftRes.triggers.length >= 4);
      assert.ok(driftRes.triggers.some((t) => t.category === 'PRD_SRS_CONTRACT_MUTATION'));

      // Now mint a linked technical ADR for ticket #12
      const adrRes = createADR({
        title: 'Adopt Redis Streams & v2 Endpoint',
        scope: 'technical',
        ticketId: 12,
        supersedes: ['CAP-01'],
        context: 'Polling caused high latency under load.',
        decision: 'Use Redis Streams and expose /v2/stream.',
        consequences: 'Requires Redis container in local dev.',
        repoRoot: tmpDir
      });

      assert.equal(adrRes.success, true);
      assert.equal(adrRes.adr.status, 'accepted');
      assert.equal(adrRes.adr.id, 'ADR-001');
      assert.equal(fs.existsSync(adrRes.filePath), true);

      // Product.md should automatically be patched with ADR-001 reference
      const productRaw = fs.readFileSync(path.join(tmpDir, 'PRODUCT.md'), 'utf8');
      assert.ok(productRaw.includes('ADR-001'));

      // Re-run drift sentinel with the ADR present in diff -> passes!
      const driftAfter = checkSpecDrift({
        diffFiles: ['package.json', 'openapi.json', adrRes.relativePath],
        ticketId: 12,
        repoRoot: tmpDir
      });
      assert.equal(driftAfter.passed, true);
      assert.equal(driftAfter.hasUndeclaredDrift, false);
    });

    it('places Product/Contract ADRs in pending_approval until approved or rejected', () => {
      initProductConstitution({
        title: 'FinTech Core',
        capabilities: [{ title: 'Multi-Currency Ledger' }],
        repoRoot: tmpDir
      });

      const prodAdr = createADR({
        title: 'Pivot from Multi-Currency to USD-Only MVP',
        scope: 'product',
        ticketId: 19,
        supersedes: ['CAP-01'],
        context: 'FX provider compliance requires 6-month audit.',
        decision: 'Launch USD-only ledger for Milestone 1.',
        consequences: 'CAP-01 scope narrowed to USD.',
        repoRoot: tmpDir
      });

      assert.equal(prodAdr.adr.status, 'pending_approval');

      // Approve via decideADR
      const decided = decideADR({
        adrId: prodAdr.adr.id,
        action: 'approve',
        reviewer: '@fady',
        reason: 'Approved for faster MVP launch',
        repoRoot: tmpDir
      });

      assert.equal(decided.success, true);
      assert.equal(decided.adr.status, 'accepted');
      const allAdrs = listADRs(tmpDir);
      assert.equal(allAdrs.length, 1);
      assert.equal(allAdrs[0].status, 'accepted');
    });
  });

  // =========================================================================
  // 4. Context-Compressed Subagent Dossiers (.agent/dossiers/)
  // =========================================================================
  describe('4. Context-Compressed Subagent Dossiers', () => {
    it('generates compact ticket dossier with linked CAP-XX, ADR constraints, and exported AST symbols', () => {
      initProductConstitution({
        title: 'Dossier Demo',
        capabilities: [{ title: 'Payment Gateway Port', spec: 'docs/specs/payment.md' }],
        invariants: ['Idempotency key required on all mutations'],
        repoRoot: tmpDir
      });

      createADR({
        title: 'Use Stripe PaymentIntents',
        scope: 'technical',
        ticketId: 7,
        supersedes: ['CAP-01'],
        decision: 'Use PaymentIntents API with idempotency keys.',
        repoRoot: tmpDir
      });

      const sampleCode = path.join(tmpDir, 'payment-service.mjs');
      fs.writeFileSync(
        sampleCode,
        `export class PaymentService {\n  async chargeOrder(orderId, amount) { return true; }\n}\nexport function validateIdempotencyKey(key) { return !!key; }\n`,
        'utf8'
      );

      const dossierRes = generateTicketDossier({
        issueId: 7,
        capabilityId: 'CAP-01',
        targetFiles: ['payment-service.mjs'],
        repoRoot: tmpDir
      });

      assert.equal(dossierRes.success, true);
      assert.equal(fs.existsSync(dossierRes.jsonPath), true);
      assert.equal(fs.existsSync(dossierRes.markdownPath), true);
      assert.equal(dossierRes.dossier.issueId, 7);
      assert.ok(dossierRes.dossier.fileSignatures[0].exports.includes('PaymentService'));
      assert.ok(dossierRes.dossier.fileSignatures[0].exports.includes('validateIdempotencyKey'));
      assert.equal(dossierRes.dossier.activeADRs.length, 1);
      assert.equal(dossierRes.dossier.activeADRs[0].id, 'ADR-001');
      const dossierMd = fs.readFileSync(dossierRes.markdownPath, 'utf8');
      assert.ok(dossierMd.includes('## 📋 Capability Spec & IEEE 29148 SRS Excerpt'));
      assert.ok(dossierMd.includes('## 2. Functional Requirements (IEEE 29148 SRS)'));
    });
  });

  // =========================================================================
  // 5. Strict 4-Layer Git Lockdown & Stage 7 Cryptographic Gate Receipts
  // =========================================================================
  describe('5. Strict 4-Layer Git Lockdown & Cryptographic Gate Receipts', () => {
    it('blocks commits on main/develop and blocks commits when no matching SDLC session is active', () => {
      initTempGitRepo(tmpDir);

      // Layer 1: On main branch -> commit guard MUST fail
      const onMain = verifyCommitGuard({ repoRoot: tmpDir });
      assert.equal(onMain.allowed, false);
      assert.equal(onMain.layer, 'LAYER_1_PROTECTED_BRANCH');

      // Switch to feature branch, but no active SDLC session yet -> Layer 2 MUST fail
      execSync('git checkout -b feature/issue-#42-ledger', { cwd: tmpDir, stdio: 'pipe' });
      const noSession = verifyCommitGuard({ repoRoot: tmpDir });
      assert.equal(noSession.allowed, false);
      assert.equal(noSession.layer, 'LAYER_2_SESSION_REQUIRED');

      // Start session on #42 matching branch at stage 2 -> allowed!
      startSession({
        issueId: 42,
        branch: 'feature/issue-#42-ledger',
        stage: 2,
        repoRoot: tmpDir,
        force: true
      });
      const withSession = verifyCommitGuard({ repoRoot: tmpDir });
      assert.equal(withSession.allowed, true);
    });

    it('blocks merges into main without a valid Stage 7 Cryptographic Gate Receipt and allows once signed', () => {
      initTempGitRepo(tmpDir);
      execSync('git checkout -b feature/issue-#88-auth', { cwd: tmpDir, stdio: 'pipe' });
      fs.writeFileSync(path.join(tmpDir, 'auth.mjs'), 'export const auth = true;\n', 'utf8');
      execSync('git add auth.mjs && git commit -m "feat: add auth module"', { cwd: tmpDir, stdio: 'pipe' });

      startSession({
        issueId: 88,
        branch: 'feature/issue-#88-auth',
        stage: 7,
        repoRoot: tmpDir,
        force: true
      });

      // Before signing receipt -> merge guard into main MUST block
      const beforeReceipt = verifyMergeGuard({
        targetBranch: 'main',
        sourceBranch: 'feature/issue-#88-auth',
        repoRoot: tmpDir
      });
      assert.equal(beforeReceipt.allowed, false);
      assert.equal(beforeReceipt.reasonCode, 'MISSING_STAGE_7_GATE_RECEIPT');

      // Issue cryptographic Stage 7 Gate Receipt for current HEAD SHA
      const receiptRes = issueGateReceipt({
        issueId: 88,
        branch: 'feature/issue-#88-auth',
        coveragePct: 92.4,
        mutationPct: 86.0,
        peerReviewApproved: true,
        driftCheckPassed: true,
        repoRoot: tmpDir
      });
      assert.equal(receiptRes.success, true);
      assert.equal(receiptRes.receipt.headSha.length, 40);

      // Verify receipt directly and via merge guard
      const checkReceipt = verifyGateReceipt({
        headSha: receiptRes.receipt.headSha,
        repoRoot: tmpDir
      });
      assert.equal(checkReceipt.valid, true);

      const afterReceipt = verifyMergeGuard({
        targetBranch: 'main',
        sourceBranch: 'feature/issue-#88-auth',
        sourceSha: receiptRes.receipt.headSha,
        repoRoot: tmpDir
      });
      assert.equal(afterReceipt.allowed, true);
    });
  });

  // =========================================================================
  // 6. Causal Decision Graph & SvelteKit Workbench Bidirectional API
  // =========================================================================
  describe('6. Causal Decision Graph, DECISION_MAP.md & Workbench API Routes', () => {
    it('builds causal decision graph linking CAP -> SPEC -> TICKET -> ADR -> ARCH and syncs docs/DECISION_MAP.md', () => {
      initProductConstitution({
        title: 'Causal Mesh',
        capabilities: [{ title: 'Event Router', spec: 'docs/specs/router.md' }],
        invariants: ['Zero message loss'],
        repoRoot: tmpDir
      });

      createADR({
        title: 'Switch Router Queue to NATS JetStream',
        scope: 'technical',
        ticketId: 5,
        supersedes: ['CAP-01'],
        decision: 'Use NATS JetStream for persistent replay.',
        repoRoot: tmpDir
      });

      appendDecisionEvent({
        type: 'ARCH_COMPONENT_UPDATED',
        id: 'ARCH-NatsAdapter',
        label: 'NatsJetStreamAdapter',
        ticketId: 5,
        linksTo: ['ADR-001', 'CAP-01'],
        repoRoot: tmpDir
      });

      const graph = buildDecisionGraph(tmpDir);
      assert.ok(graph.nodes.some((n) => n.id === 'CAP-01'));
      assert.ok(graph.nodes.some((n) => n.id === 'ADR-001'));
      assert.ok(graph.nodes.some((n) => n.id === 'ARCH-NatsAdapter'));
      assert.ok(graph.edges.length >= 2);
      assert.equal(graph.driftPivots.length, 1);

      const mapRes = syncDecisionMapMarkdown(tmpDir);
      assert.equal(mapRes.success, true);
      assert.equal(fs.existsSync(path.join(tmpDir, 'docs/DECISION_MAP.md')), true);
      const mapMd = fs.readFileSync(path.join(tmpDir, 'docs/DECISION_MAP.md'), 'utf8');
      assert.ok(mapMd.includes('flowchart'));
      assert.ok(mapMd.includes('ADR-001'));
      assert.ok(mapMd.includes('CAP-01'));
    });

    it('serves SvelteKit workbench API endpoints (/api/decision-graph, /api/product, /api/adr/decide, /api/dag/control)', async () => {
      initProductConstitution({
        title: 'Workbench API App',
        capabilities: [{ title: 'Realtime Analytics' }],
        repoRoot: tmpDir
      });

      const pendingAdr = createADR({
        title: 'Change Analytics Retention to 30 Days',
        scope: 'product',
        ticketId: 10,
        supersedes: ['CAP-01'],
        decision: '30-day hot retention in ClickHouse.',
        repoRoot: tmpDir
      });
      assert.equal(pendingAdr.adr.status, 'pending_approval');

      const wb = createWorkbenchServer({ port: 0, repoRoot: tmpDir, token: 'nextgen-test-token' });
      const srv = await wb.listen();
      const assignedPort = srv.address().port;

      try {
        // 1. GET /api/decision-graph
        const graphRes = await httpRequest(assignedPort, 'GET', '/api/decision-graph');
        assert.equal(graphRes.status, 200);
        assert.ok(graphRes.json.nodes.some((n) => n.id === 'CAP-01'));
        assert.ok(graphRes.json.nodes.some((n) => n.id === 'ADR-001'));

        // 2. GET /api/product
        const prodRes = await httpRequest(assignedPort, 'GET', '/api/product');
        assert.equal(prodRes.status, 200);
        assert.equal(prodRes.json.product.title, 'Workbench API App');

        // 3. POST /api/adr/decide to approve ADR-001 from UI
        const decideRes = await httpRequest(assignedPort, 'POST', '/api/adr/decide', {
          adrId: 'ADR-001',
          action: 'approve',
          reviewer: '@ui-operator',
          reason: 'Approved via SvelteKit Mission Control'
        });
        assert.equal(decideRes.status, 200);
        assert.equal(decideRes.json.adr.status, 'accepted');

        // 4. POST /api/dag/control to pause DAG from UI
        const dagRes = await httpRequest(assignedPort, 'POST', '/api/dag/control', {
          action: 'pause',
          reason: 'Operator maintenance window'
        });
        assert.equal(dagRes.status, 200);
        assert.equal(dagRes.json.state.status, 'paused');
      } finally {
        await wb.close();
      }
    });

    it('executes new CLI commands (product, adr, drift, decision-graph, dossier, guard, cache)', () => {
      const pCli = runCLI(['product', 'init', '--title', 'CLI Product', '--vision', 'Build end to end'], null, tmpDir);
      assert.equal(pCli.command, 'product');
      assert.equal(pCli.product.success, true);

      const adrCli = runCLI(
        ['adr', 'create', '--title', 'CLI Technical ADR', '--scope', 'technical', '--ticket', '1', '--decision', 'Use SQLite'],
        null,
        tmpDir
      );
      assert.equal(adrCli.command, 'adr');
      assert.equal(adrCli.adr.adr.status, 'accepted');

      const dgCli = runCLI(['decision-graph', 'sync'], null, tmpDir);
      assert.equal(dgCli.command, 'decision-graph');
      assert.equal(dgCli.decisionGraph.success, true);

      const cacheCli = runCLI(['cache', 'status'], null, tmpDir);
      assert.equal(cacheCli.command, 'cache');
      assert.equal(typeof cacheCli.cache.entriesCount, 'number');
    });
  });

  // =========================================================================
  // 7. v0.1.0 Hardening: Composite Stage CLI, Polyglot Runners, Real Coverage/Mutation Parsers & Policy ArchDiff
  // =========================================================================
  describe('7. v0.1.0 Hardening: Composite Stage CLI, Polyglot Runners & Real Parsers', () => {
    it('executes composite stage lifecycle (begin -> pre-pr -> complete) atomically', () => {
      initTempGitRepo(tmpDir);
      initProductConstitution({
        title: 'Composite Stage Demo',
        capabilities: [{ title: 'Stage CLI', spec: 'docs/specs/stage.md' }],
        repoRoot: tmpDir
      });
      execSync('git add . && git commit -m "chore: add product constitution"', { cwd: tmpDir, stdio: 'pipe' });

      const beginRes = runCLI(
        ['stage', 'begin', '--issue=77', '--title=Composite Lifecycle', '--type=feat', '--checkout'],
        null,
        tmpDir
      );
      assert.equal(beginRes.success, true);
      assert.equal(beginRes.stage.action, 'begin');
      assert.equal(beginRes.stage.issueId, '77');
      assert.equal(beginRes.stage.stage, 2);

      const prePrRes = runCLI(
        ['stage', 'pre-pr', '--issue=77', '--summary', 'Verified pre-PR composite stage'],
        null,
        tmpDir
      );
      assert.equal(prePrRes.stage.action, 'pre-pr');
      assert.equal(prePrRes.stage.stage, 6);
      assert.ok(fs.existsSync(prePrRes.stage.decisionMapPath));
      assert.ok(prePrRes.stage.prSummary.markdown.includes('Not Measured'));

      const completeRes = runCLI(['stage', 'complete', '--issue=77', '--pr=#99'], null, tmpDir);
      assert.equal(completeRes.success, true);
      assert.equal(completeRes.stage.action, 'complete');
      assert.equal(completeRes.stage.stage, 8);
    });

    it('constructs stack-aware single-test commands across Java, Python, Go, Rust, and Node', () => {
      assert.equal(buildSingleTestCommand('tests/auth.test.mjs', tmpDir), 'node --test "tests/auth.test.mjs"');
      assert.equal(buildSingleTestCommand('tests/test_auth.py', tmpDir), 'pytest "tests/test_auth.py"');
      assert.equal(buildSingleTestCommand('pkg/auth/auth_test.go', tmpDir), 'go test -v "./pkg/auth"');
      assert.equal(buildSingleTestCommand('tests/auth_test.rs', tmpDir), 'cargo test --test "auth_test"');
      assert.equal(buildSingleTestCommand('src/test/java/OrderServiceTest.java', tmpDir), './mvnw test -Dtest="OrderServiceTest"');

      fs.writeFileSync(path.join(tmpDir, 'build.gradle'), 'plugins { id "java" }\n', 'utf8');
      assert.equal(
        buildSingleTestCommand('src/test/java/OrderServiceTest.java', tmpDir),
        './gradlew test --tests "OrderServiceTest"'
      );
    });

    it('parses coverage reports (JSON, LCOV, JaCoCo CSV, Cobertura XML, Go coverprofile) and mutation reports (Stryker, PITest)', () => {
      // 1. JSON coverage-summary.json
      fs.mkdirSync(path.join(tmpDir, 'coverage'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'coverage/coverage-summary.json'),
        JSON.stringify({ total: { lines: { pct: 91.5 }, branches: { pct: 88.2 } } }),
        'utf8'
      );
      const jsonCov = parseCoverageReport(tmpDir);
      assert.equal(jsonCov.found, true);
      assert.equal(jsonCov.lineCoverage, 91.5);
      assert.equal(jsonCov.passed, true);
      fs.unlinkSync(path.join(tmpDir, 'coverage/coverage-summary.json'));

      // 2. LCOV
      fs.writeFileSync(path.join(tmpDir, 'coverage/lcov.info'), 'SF:src/a.js\nLF:100\nLH:80\nend_of_record\n', 'utf8');
      const lcovCov = parseCoverageReport(tmpDir);
      assert.equal(lcovCov.found, true);
      assert.equal(lcovCov.lineCoverage, 80);
      assert.equal(lcovCov.passed, false);
      fs.unlinkSync(path.join(tmpDir, 'coverage/lcov.info'));

      // 3. JaCoCo CSV
      fs.mkdirSync(path.join(tmpDir, 'target/site/jacoco'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'target/site/jacoco/jacoco.csv'),
        'GROUP,PACKAGE,CLASS,LINE_MISSED,LINE_COVERED\napp,com.demo,Svc,5,95\n',
        'utf8'
      );
      const jacocoCov = parseCoverageReport(tmpDir);
      assert.equal(jacocoCov.found, true);
      assert.equal(jacocoCov.lineCoverage, 95);
      assert.equal(jacocoCov.passed, true);
      fs.unlinkSync(path.join(tmpDir, 'target/site/jacoco/jacoco.csv'));

      // 4. Cobertura / pytest XML
      fs.writeFileSync(path.join(tmpDir, 'coverage.xml'), '<coverage line-rate="0.895"></coverage>', 'utf8');
      const xmlCov = parseCoverageReport(tmpDir);
      assert.equal(xmlCov.found, true);
      assert.equal(xmlCov.lineCoverage, 89.5);
      fs.unlinkSync(path.join(tmpDir, 'coverage.xml'));

      // 5. Go coverage.out
      fs.writeFileSync(
        path.join(tmpDir, 'coverage.out'),
        'mode: set\ngithub.com/org/pkg/a.go:1.1,10.2 8 1\ngithub.com/org/pkg/a.go:12.1,20.2 2 0\n',
        'utf8'
      );
      const goCov = parseCoverageReport(tmpDir);
      assert.equal(goCov.found, true);
      assert.equal(goCov.lineCoverage, 80);

      // 6. Stryker mutation.json
      fs.mkdirSync(path.join(tmpDir, 'reports/mutation'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'reports/mutation/mutation.json'),
        JSON.stringify({
          files: {
            'src/a.js': {
              mutants: [{ status: 'Killed' }, { status: 'Killed' }, { status: 'Timeout' }, { status: 'Survived' }]
            }
          }
        }),
        'utf8'
      );
      const strykerMut = parseMutationReport(tmpDir);
      assert.equal(strykerMut.found, true);
      assert.equal(strykerMut.mutationScore, 75);
      assert.equal(strykerMut.passed, false);
      fs.unlinkSync(path.join(tmpDir, 'reports/mutation/mutation.json'));

      // 7. PITest mutations.xml
      fs.mkdirSync(path.join(tmpDir, 'target/pit-reports'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'target/pit-reports/mutations.xml'),
        `<mutations><mutation detected='true'/><mutation detected='true'/><mutation detected='true'/><mutation detected='true'/><mutation detected='false'/></mutations>`,
        'utf8'
      );
      const pitMut = parseMutationReport(tmpDir);
      assert.equal(pitMut.found, true);
      assert.equal(pitMut.mutationScore, 80);
      assert.equal(pitMut.passed, true);
    });

    it('enforces .archlens/policy.json ring dependencies in checkArchDiff and scaffolds polyglot reproduction tests', () => {
      initTempGitRepo(tmpDir);
      fs.mkdirSync(path.join(tmpDir, '.archlens'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, '.archlens/policy.json'),
        JSON.stringify({
          layers: [
            { name: 'CoreRing', paths: ['src/core'], allowedDependencies: [] },
            { name: 'UseCaseRing', paths: ['src/usecases'], allowedDependencies: ['CoreRing'] },
            { name: 'AdapterRing', paths: ['src/adapters'], allowedDependencies: ['CoreRing', 'UseCaseRing'] }
          ]
        }),
        'utf8'
      );
      fs.mkdirSync(path.join(tmpDir, 'src/usecases'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src/usecases/order.mjs'), 'export const x = 1;\n', 'utf8');
      execSync('git add . && git commit -m "chore: setup policy"', { cwd: tmpDir, stdio: 'pipe' });

      // Switch to feature branch and modify UseCaseRing to import AdapterRing (violates allowedDependencies: ['CoreRing'])
      execSync('git checkout -b feature/issue-#70-policy-test', { cwd: tmpDir, stdio: 'pipe' });
      fs.writeFileSync(
        path.join(tmpDir, 'src/usecases/order.mjs'),
        `import { db } from '../adapters/postgres.mjs';\nexport const x = 1;\n`,
        'utf8'
      );
      execSync('git add . && git commit -m "feat: add illegal outer import"', { cwd: tmpDir, stdio: 'pipe' });

      const archRes = checkArchDiff(tmpDir);
      assert.equal(archRes.enabled, true);
      assert.equal(archRes.passed, false);
      assert.equal(archRes.violationsCount, 1);
      assert.equal(archRes.violations[0].sourceLayer, 'UseCaseRing');
      assert.equal(archRes.violations[0].targetLayer, 'AdapterRing');

      // Polyglot reproduction test generation (.py, .java, .go, .rs)
      const pyRepro = scaffoldReproductionTest({
        errorTrace: 'ValueError: invalid literal\n  File "src/billing/calc.py", line 19',
        repoRoot: tmpDir
      });
      assert.equal(pyRepro.language, 'python');
      assert.ok(pyRepro.testContent.includes('pytest.fail'));

      const javaRepro = scaffoldReproductionTest({
        errorTrace: 'NullPointerException at OrderService.java:44',
        targetFile: 'src/main/java/OrderService.java',
        repoRoot: tmpDir
      });
      assert.equal(javaRepro.language, 'java');
      assert.ok(javaRepro.testContent.includes('@Test'));

      // Real file digest in generateRegressionProof
      fs.mkdirSync(path.join(tmpDir, 'src/components'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src/components/CheckoutView.svelte'), '<main>Checkout v2</main>', 'utf8');
      const proof = generateRegressionProof({
        targetName: 'checkout',
        uiRoutes: [{ path: '/checkout', component: 'CheckoutView' }],
        repoRoot: tmpDir
      });
      assert.equal(proof.uiProofs[0].sourceFile, 'src/components/CheckoutView.svelte');

      // Safe markdown backticks & $() in createTicket / postPMComment
      const safeTicket = createTicket({
        title: 'Fix `shell` $(echo INJECTED) parsing',
        body: 'Code block:\n```sh\n$(echo PWNED)\n```',
        repoRoot: tmpDir
      });
      assert.equal(safeTicket.success, true);

      // Hybrid Architecture Diff & Decision Lineage UI snapshot generator
      const archPayload = buildArchDiffPayload(tmpDir);
      assert.equal(typeof archPayload.rings, 'object');
      assert.ok(Array.isArray(archPayload.modifiedFiles));

      const widgetOut = path.join(tmpDir, 'custom-arch-widget.html');
      const widgetRes = generateArchitectureWidget({ outputPath: widgetOut, repoRoot: tmpDir });
      assert.equal(widgetRes.success, true);
      assert.equal(fs.existsSync(widgetOut), true);
      assert.equal(fs.existsSync(path.join(tmpDir, '.agent/workbench/index.html')), true);
      const widgetHtml = fs.readFileSync(widgetOut, 'utf8');
      assert.ok(widgetHtml.includes('SDLC Architecture Diff & Decision Workbench'));
    });

    it('provisions all 6 AI coding tools (Gemini, Claude, Cursor, Grok, Windsurf, Copilot) and prunes deprecated skills (CAP-07 / ADR-003)', () => {
      initTempGitRepo(tmpDir);
      // Pre-seed deprecated skills and a custom user skill to verify selective pruning
      const legacySkillDir = path.join(tmpDir, '.agent/skills/sdlc-kanban');
      const customSkillDir = path.join(tmpDir, '.agent/skills/my-custom-skill');
      fs.mkdirSync(legacySkillDir, { recursive: true });
      fs.mkdirSync(customSkillDir, { recursive: true });
      fs.writeFileSync(path.join(legacySkillDir, 'SKILL.md'), 'legacy', 'utf8');
      fs.writeFileSync(path.join(customSkillDir, 'SKILL.md'), 'custom', 'utf8');

      assert.equal(SUPPORTED_AGENTS.length, 6);
      assert.equal(CANONICAL_SDLC_SKILLS.length, 11);
      assert.ok(CANONICAL_SDLC_SKILLS.includes('ub-mode'));
      assert.ok(DEPRECATED_SDLC_SKILLS.includes('sdlc-kanban'));
      assert.ok(DEPRECATED_SDLC_SKILLS.includes('sdlc-init'));
      assert.ok(DEPRECATED_SDLC_SKILLS.includes('sdlc-review-gate'));

      const parsed = parseInstallArgs(
        [
          'install',
          '--target',
          tmpDir,
          '--agents',
          'gemini,claude,cursor,grok,windsurf,copilot',
          '--with-archlens',
          '--with-hooks',
          '--with-ci',
          '--yes'
        ],
        process.cwd()
      );
      assert.deepEqual(parsed.agents, ['gemini', 'claude', 'cursor', 'grok', 'windsurf,copilot'.split(',')].flat());
      assert.equal(parsed.withArchlens, true);
      assert.equal(parsed.withHooks, true);
      assert.equal(parsed.withCi, true);

      const cliRes = runCLI(
        [
          'install',
          '--target',
          tmpDir,
          '--agents',
          'gemini,claude,cursor,grok,windsurf,copilot',
          '--with-archlens',
          '--with-hooks',
          '--with-ci',
          '--yes'
        ],
        null,
        process.cwd()
      );
      assert.equal(cliRes.installed.success, true);
      assert.equal(cliRes.installed.skillsCount, 11);
      assert.ok(cliRes.installed.prunedSkills.includes('sdlc-kanban'));

      // Deprecated skill removed, custom skill preserved, 11 canonical skills present across runtimes
      assert.equal(fs.existsSync(legacySkillDir), false);
      assert.equal(fs.existsSync(customSkillDir), true);
      for (const s of CANONICAL_SDLC_SKILLS) {
        assert.equal(fs.existsSync(path.join(tmpDir, '.agent/skills', s, 'SKILL.md')), true);
        assert.equal(fs.existsSync(path.join(tmpDir, '.claude/skills', s, 'SKILL.md')), true);
        assert.equal(fs.existsSync(path.join(tmpDir, '.claude/commands', `${s}.md`)), false);
        assert.equal(fs.existsSync(path.join(tmpDir, '.grok/skills', s, 'SKILL.md')), true);
        assert.equal(fs.existsSync(path.join(tmpDir, '.cursor/skills', s, 'SKILL.md')), true);
        assert.equal(fs.existsSync(path.join(tmpDir, '.cursor/rules', `${s}.mdc`)), true);
        assert.equal(fs.existsSync(path.join(tmpDir, '.windsurf/workflows', `${s}.md`)), true);
        assert.equal(fs.existsSync(path.join(tmpDir, '.github/prompts', `${s}.prompt.md`)), true);
      }
      assert.equal(fs.existsSync(path.join(tmpDir, 'AGENTS.md')), true);
      assert.equal(fs.existsSync(path.join(tmpDir, 'CLAUDE.md')), true);
      assert.equal(fs.existsSync(path.join(tmpDir, 'GROK.md')), true);
      assert.equal(fs.existsSync(path.join(tmpDir, '.cursorrules')), true);
      assert.equal(fs.existsSync(path.join(tmpDir, '.windsurfrules')), true);
      assert.equal(fs.existsSync(path.join(tmpDir, '.github/copilot-instructions.md')), true);
      assert.equal(fs.existsSync(path.join(tmpDir, '.archlens/policy.json')), true);
      assert.equal(fs.existsSync(path.join(tmpDir, '.github/workflows/sdlc-quality-gate.yml')), true);

      // Verify global install into isolated homeDir
      const fakeHome = path.join(tmpDir, 'fake-home');
      fs.mkdirSync(fakeHome, { recursive: true });
      const globalRes = installFramework({
        global: true,
        homeDir: fakeHome,
        agents: ['gemini', 'claude', 'grok'],
        packageRoot: process.cwd()
      });
      assert.equal(globalRes.success, true);
      assert.equal(globalRes.mode, 'global');
      assert.equal(fs.existsSync(path.join(fakeHome, '.gemini/config/skills/sdlc-flow/SKILL.md')), true);
      assert.equal(fs.existsSync(path.join(fakeHome, '.claude/skills/sdlc-flow/SKILL.md')), true);
      assert.equal(fs.existsSync(path.join(fakeHome, '.grok/skills/sdlc-flow/SKILL.md')), true);
    });

    it('scaffolds canonical GitHub issue/PR templates and executes 4-operation parity across GitHub, Linear, and Jira (CAP-10 / ADR-006)', () => {
      initTempGitRepo(tmpDir);

      // 1. Scaffold canonical templates via CLI (`sdlc-engine ticket templates`)
      const tplRes = runCLI(['ticket', 'templates'], null, tmpDir);
      assert.equal(tplRes.success, true);
      assert.equal(tplRes.templates.created.length, 5);
      assert.equal(fs.existsSync(path.join(tmpDir, '.github/ISSUE_TEMPLATE/feature_request.md')), true);
      assert.equal(fs.existsSync(path.join(tmpDir, '.github/ISSUE_TEMPLATE/bug_report.md')), true);
      assert.equal(fs.existsSync(path.join(tmpDir, '.github/ISSUE_TEMPLATE/hotfix_incident.md')), true);
      assert.equal(fs.existsSync(path.join(tmpDir, '.github/ISSUE_TEMPLATE/architecture_spike.md')), true);
      assert.equal(fs.existsSync(path.join(tmpDir, '.github/pull_request_template.md')), true);

      // 2. Verify hotfix & spike template loading and rendering
      const hotfixTpl = loadIssueTemplate('hotfix', tmpDir);
      assert.equal(hotfixTpl.name, 'Production Hotfix Incident (P0)');
      assert.ok(hotfixTpl.file.endsWith('hotfix_incident.md'));
      assert.ok(hotfixTpl.labels.includes('priority:critical'));

      const spikeFormatted = formatTemplatedIssue({
        title: 'Evaluate CQRS Event Store',
        type: 'spike',
        problem: 'High write contention on audit log',
        solution: 'Compare Postgres append-only vs Kafka',
        repoRoot: tmpDir
      });
      assert.equal(spikeFormatted.template.name, 'Architecture Spike & ADR Exploration');
      assert.ok(spikeFormatted.template.file.endsWith('architecture_spike.md'));
      assert.ok(spikeFormatted.body.includes('High write contention on audit log'));

      // 3. Verify explicit PM provider override via .agent/sdlc-config.json
      fs.mkdirSync(path.join(tmpDir, '.agent'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, '.agent/sdlc-config.json'),
        JSON.stringify({ projectManagement: { provider: 'linear' } }),
        'utf8'
      );
      assert.equal(detectPMProvider(tmpDir).provider, 'linear');

      // 4. Test Linear GraphQL createTicket, transitionPMState, and postPMComment with mock execFn
      const linearCalls = [];
      const mockLinearExec = (bin, args) => {
        linearCalls.push({ bin, args });
        const payloadIdx = args.indexOf('-d');
        const payload = payloadIdx !== -1 ? args[payloadIdx + 1] : '';
        if (payload.includes('query Teams')) {
          return JSON.stringify({ data: { teams: { nodes: [{ id: 'team-123', key: 'ENG', name: 'Engineering' }] } } });
        }
        if (payload.includes('mutation IssueCreate')) {
          return JSON.stringify({
            data: {
              issueCreate: {
                success: true,
                issue: { id: 'uuid-99', identifier: 'ENG-42', url: 'https://linear.app/acme/issue/ENG-42', title: 'feat: Linear Ticket' }
              }
            }
          });
        }
        if (payload.includes('query WorkflowStates')) {
          return JSON.stringify({
            data: {
              workflowStates: {
                nodes: [
                  { id: 'state-in-progress', name: 'In Progress', type: 'started' },
                  { id: 'state-done', name: 'Done', type: 'completed' }
                ]
              }
            }
          });
        }
        return JSON.stringify({ data: { issueUpdate: { success: true }, commentCreate: { success: true } } });
      };

      const linearCreated = createTicket({
        title: 'Linear Ticket',
        type: 'feat',
        problem: 'Need Linear GraphQL ticket creation',
        solution: 'Call issueCreate mutation',
        repoRoot: tmpDir,
        execFn: mockLinearExec
      });
      assert.equal(linearCreated.provider, 'linear');
      assert.equal(linearCreated.issueId, 'ENG-42');
      assert.equal(linearCreated.url, 'https://linear.app/acme/issue/ENG-42');
      assert.ok(fs.readFileSync(path.join(tmpDir, 'docs/KANBAN.md'), 'utf8').includes('ENG-42'));

      const linearTrans = transitionPMState({
        issueId: 'ENG-42',
        state: 'in-progress',
        repoRoot: tmpDir,
        execFn: mockLinearExec
      });
      assert.equal(linearTrans.provider, 'linear');
      assert.equal(linearTrans.stateId, 'state-in-progress');

      // 5. Switch to Jira provider and test REST API v3 createTicket + transitionPMState
      fs.writeFileSync(
        path.join(tmpDir, '.agent/sdlc-config.json'),
        JSON.stringify({ projectManagement: { provider: 'jira' } }),
        'utf8'
      );
      assert.equal(detectPMProvider(tmpDir).provider, 'jira');

      const mockJiraExec = (bin, args) => {
        if (args.includes('GET') && args.some((a) => a.includes('/transitions'))) {
          return JSON.stringify({
            transitions: [
              { id: '31', name: 'In progress', to: { name: 'In Progress' } },
              { id: '41', name: 'Done', to: { name: 'Done' } }
            ]
          });
        }
        if (args.includes('POST') && args.some((a) => a.endsWith('/rest/api/3/issue'))) {
          return JSON.stringify({ id: '10099', key: 'SDLC-88' });
        }
        return JSON.stringify({ ok: true });
      };

      const jiraCreated = createTicket({
        title: 'Jira Ticket',
        type: 'hotfix',
        problem: 'Production 502 spike',
        solution: 'Rollback canary and patch pool size',
        repoRoot: tmpDir,
        execFn: mockJiraExec
      });
      assert.equal(jiraCreated.provider, 'jira');
      assert.equal(jiraCreated.issueId, 'SDLC-88');
      assert.equal(jiraCreated.template, 'Production Hotfix Incident (P0)');
      assert.ok(fs.readFileSync(path.join(tmpDir, 'docs/KANBAN.md'), 'utf8').includes('SDLC-88'));

      const jiraTrans = transitionPMState({
        issueId: 'SDLC-88',
        state: 'done',
        repoRoot: tmpDir,
        execFn: mockJiraExec
      });
      assert.equal(jiraTrans.provider, 'jira');
      assert.equal(jiraTrans.transitionId, '41');
    });

    it('synchronizes AST-to-Wiki Codebase-Map.md, classifies Archlens rings, and audits wiki/*.md for drift or broken paths (CAP-11 / ADR-007)', () => {
      initTempGitRepo(tmpDir);
      initProductConstitution({
        title: 'Wiki Sync App',
        capabilities: [{ title: 'Domain Ledger', spec: 'docs/specs/ledger.md' }],
        repoRoot: tmpDir
      });

      // Create sample source modules across rings
      fs.mkdirSync(path.join(tmpDir, 'src/domain'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'src/adapters'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'src/domain/ledger.mjs'),
        'export class LedgerEntity {}\nexport function computeBalance(txs) { return txs.length; }\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(tmpDir, 'src/adapters/http.mjs'),
        'import { computeBalance } from "../domain/ledger.mjs";\nexport function handleGetBalance() { return computeBalance([]); }\n',
        'utf8'
      );

      // 1. Inspect source module exports & line numbers
      const modInfo = inspectSourceModule('src/adapters/http.mjs', tmpDir);
      assert.equal(modInfo.name, 'http.mjs');
      assert.equal(modInfo.exports[0].name, 'handleGetBalance');
      assert.equal(modInfo.exports[0].line, 2);
      assert.ok(modInfo.imports.includes('src/domain/ledger.mjs'));

      // 2. Sync wiki with --init to scaffold wiki pages and generate wiki/Codebase-Map.md
      const syncRes = runCLI(['wiki', 'sync', '--init'], null, tmpDir);
      assert.equal(syncRes.command, 'wiki');
      assert.equal(syncRes.subcommand, 'sync');
      assert.equal(syncRes.success, true);
      assert.equal(fs.existsSync(path.join(tmpDir, 'wiki/Codebase-Map.md')), true);
      const mapMd = fs.readFileSync(path.join(tmpDir, 'wiki/Codebase-Map.md'), 'utf8');
      assert.ok(mapMd.includes('LedgerEntity'));
      assert.ok(mapMd.includes('handleGetBalance'));
      assert.ok(mapMd.includes('Ring 0: Domain Core & Primitives'));

      // 3. Inject a broken code path and deprecated skill reference into wiki/Home.md -> auditWiki must catch both
      fs.writeFileSync(
        path.join(tmpDir, 'wiki/Home.md'),
        '# Broken Wiki\nRun `.agent/skills/sdlc-kanban/scripts/nonexistent.sh` with `sdlc-kanban`.\n',
        'utf8'
      );
      const brokenAudit = auditWiki(tmpDir, { strict: true });
      assert.equal(brokenAudit.passed, false);
      assert.ok(brokenAudit.findings.some((f) => f.rule === 'DEPRECATED_SKILL_REF' && f.target === 'sdlc-kanban'));
      assert.ok(brokenAudit.findings.some((f) => f.rule === 'BROKEN_CODE_PATH'));

      // 4. Verify live repository wiki passes strict audit with 100% module & skill coverage
      const repoSync = syncWiki({ repoRoot: process.cwd() });
      assert.equal(repoSync.success, true, JSON.stringify(repoSync.audit.findings));
      const repoAudit = auditWiki(process.cwd(), { strict: true });
      assert.equal(repoAudit.passed, true, JSON.stringify(repoAudit.findings));
      assert.equal(repoAudit.errorsCount, 0);
      assert.equal(repoAudit.coveragePct, 100);
    });

    it('provisions Claude Code & Cowork skills without foreign runtime tool names, preserves existing CLAUDE.md/settings.json, builds Cowork account skill zip bundles, and prints CLI output across subcommands', () => {
      initTempGitRepo(tmpDir);

      // Seed existing custom CLAUDE.md and .claude/settings.json with user keys + legacy invalid keys
      const customClaudeMd = '# My Custom Project Instructions\nAlways run `npm run verify` before opening a PR.\n';
      fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), customClaudeMd, 'utf8');
      fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, '.claude/settings.json'),
        JSON.stringify(
          {
            model: 'claude-sonnet-4-20250514',
            rules: ['CLAUDE.md'],
            skillsDir: '.claude/skills',
            commands: { 'sdlc-flow': 'bad' },
            permissions: { allow: ['Bash(npm test)'] }
          },
          null,
          2
        ),
        'utf8'
      );

      // Run installer twice to verify non-destructive preservation AND idempotency
      installFramework({
        targetDir: tmpDir,
        repoRoot: tmpDir,
        agents: ['claude', 'cursor', 'grok'],
        skipDetect: true,
        packageRoot: process.cwd()
      });
      const res = installFramework({
        targetDir: tmpDir,
        repoRoot: tmpDir,
        agents: ['claude', 'cursor', 'grok'],
        skipDetect: true,
        packageRoot: process.cwd()
      });
      assert.equal(res.success, true);

      // 1. CLAUDE.md preserved existing user instructions and appended SDLC block once
      const updatedClaudeMd = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf8');
      assert.ok(updatedClaudeMd.includes('My Custom Project Instructions'), 'Must preserve existing CLAUDE.md content');
      assert.ok(updatedClaudeMd.includes('Always run `npm run verify`'), 'Must preserve user lines in CLAUDE.md');
      assert.ok(updatedClaudeMd.includes('Zero Direct Pushes'), 'Must include SDLC constitutional rules');
      const markerMatches = updatedClaudeMd.match(/<!-- AGENTIC-SDLC-RULES:START -->/g) || [];
      assert.equal(markerMatches.length, 1, 'Running install twice must remain idempotent');

      // 2. .claude/settings.json uses valid Claude Code keys, removes legacy invalid keys, preserves user keys
      const settings = JSON.parse(fs.readFileSync(path.join(tmpDir, '.claude/settings.json'), 'utf8'));
      assert.equal(settings.rules, undefined, 'rules is not a valid Claude Code settings key');
      assert.equal(settings.skillsDir, undefined, 'skillsDir is not a valid Claude Code settings key');
      assert.equal(settings.commands, undefined, 'commands is not a valid Claude Code settings key');
      assert.equal(settings.model, 'claude-sonnet-4-20250514', 'Must preserve existing user settings');
      assert.ok(Array.isArray(settings.permissions?.allow), 'Must configure permissions.allow');
      assert.ok(settings.permissions.allow.includes('Bash(npm test)'), 'Must preserve existing permissions.allow');
      assert.ok(
        settings.permissions.allow.some((p) => p.includes('sdlc-engine.mjs')),
        'Must allow sdlc-engine.mjs execution'
      );

      // 3. All 11 Claude, Cursor, and Grok skills and Cowork .zip bundles have clean frontmatter and zero Antigravity tool names
      for (const skillId of CANONICAL_SDLC_SKILLS) {
        const claudeSkill = fs.readFileSync(path.join(tmpDir, '.claude/skills', skillId, 'SKILL.md'), 'utf8');
        const cursorSkill = fs.readFileSync(path.join(tmpDir, '.cursor/skills', skillId, 'SKILL.md'), 'utf8');
        const grokSkill = fs.readFileSync(path.join(tmpDir, '.grok/skills', skillId, 'SKILL.md'), 'utf8');
        assert.equal(fs.existsSync(path.join(tmpDir, '.claude/commands', `${skillId}.md`)), false, 'Must not emit duplicate .claude/commands');

        for (const content of [claudeSkill, cursorSkill, grokSkill]) {
          assert.equal(/^tools:/m.test(content), false, `${skillId} must not include Antigravity tools: frontmatter`);
          assert.equal(content.includes('<agent-embed'), false, `${skillId} must not include <agent-embed>`);
          assert.equal(content.includes('<artifactDir>'), false, `${skillId} must not include <artifactDir>`);
          assert.equal(/\b(read_file|write_file|edit_file|run_command|invoke_subagent)\b/.test(content), false, `${skillId} must not reference Antigravity tool names`);
        }

        assert.ok(claudeSkill.includes('allowed-tools:'), `${skillId} must include allowed-tools in SKILL.md frontmatter`);
        assert.equal(claudeSkill.includes('user-invocable:'), false, `${skillId} must not have non-standard user-invocable in SKILL.md`);

        // Cowork account-level skill .zip bundle exists and starts with PK\x03\x04 ZIP signature containing <skillId>/SKILL.md
        const zipPath = path.join(tmpDir, '.claude/cowork', `${skillId}.zip`);
        assert.equal(fs.existsSync(zipPath), true, `Cowork zip bundle missing for ${skillId}`);
        const zipBuf = fs.readFileSync(zipPath);
        assert.equal(zipBuf[0], 0x50); // 'P'
        assert.equal(zipBuf[1], 0x4b); // 'K'
        assert.equal(zipBuf[2], 0x03);
        assert.equal(zipBuf[3], 0x04);
        assert.ok(zipBuf.toString('utf8').includes(`${skillId}/SKILL.md`));
      }

      // 4. .claude-plugin/plugin.json exists so Cowork / Claude Code can also load the repo as a plugin
      const pluginJsonPath = path.join(tmpDir, '.claude-plugin/plugin.json');
      assert.equal(fs.existsSync(pluginJsonPath), true);
      const pluginManifest = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
      assert.equal(pluginManifest.name, 'agentic-sdlc');

      // 5. CLI subcommands produce non-empty stdout when invoked as a subprocess
      const statusOut = execFileSync('node', [path.resolve('.agent/scripts/sdlc-engine.mjs'), 'session', 'status'], {
        cwd: tmpDir,
        encoding: 'utf8'
      });
      assert.ok(statusOut.trim().length > 0, 'session status must print human-readable output');

      const driftOut = execFileSync('node', [path.resolve('.agent/scripts/sdlc-engine.mjs'), 'drift', 'check'], {
        cwd: tmpDir,
        encoding: 'utf8'
      });
      assert.ok(driftOut.trim().length > 0, 'drift check must print human-readable output');

      const uiOut = execFileSync('node', [path.resolve('.agent/scripts/sdlc-engine.mjs'), 'ui-snapshot'], {
        cwd: tmpDir,
        encoding: 'utf8'
      });
      assert.ok(uiOut.includes('index.html'), 'ui-snapshot must print snapshot path');

      // 6. Verify serve --snapshot-only & formatCLIResult across all subcommand branches
      const serveSnap = runCLI(['serve', '--snapshot-only'], null, tmpDir);
      assert.equal(serveSnap.workbench.snapshotOnly, true);
      assert.ok(formatCLIResult(serveSnap).includes('snapshot generated'));
      assert.ok(formatCLIResult(serveSnap, ['--json']).includes('"snapshotOnly": true'));
      assert.equal(formatCLIResult({ command: 'detect' }), '');
      assert.ok(formatCLIResult({ command: 'session', subcommand: 'dashboard', dashboard: 'STAGE 2/8' }).includes('STAGE 2/8'));
      assert.ok(formatCLIResult({ command: 'session', subcommand: 'dashboard' }).includes('No active SDLC session'));
      assert.ok(
        formatCLIResult({
          command: 'session',
          subcommand: 'status',
          status: { active: true, session: { issueId: 42, branch: 'feature/42', stage: 2, stageName: 'Branch' } }
        }).includes('#42')
      );
      assert.ok(formatCLIResult({ command: 'session', subcommand: 'list', sessions: { 42: {} }, activeSessionId: 42 }).includes('#42'));
      assert.ok(formatCLIResult({ command: 'session', subcommand: 'release', released: true }).includes('Released'));
      assert.ok(formatCLIResult({ command: 'stage', stage: { action: 'begin', issueId: 42, branch: 'feat/42', stage: 2 } }).includes('#42'));
      assert.ok(formatCLIResult({ command: 'stage', stage: { action: 'pre-pr', issueId: 42, drift: { passed: true }, wikiAudit: { passed: true } } }).includes('Pre-PR'));
      assert.ok(formatCLIResult({ command: 'stage', stage: { action: 'complete', issueId: 42, stage: 8, released: true } }).includes('Stage Complete'));
      assert.ok(formatCLIResult({ command: 'drift', drift: { passed: false, reason: 'Missing ADR' } }).includes('Missing ADR'));
      assert.ok(formatCLIResult({ command: 'adr', adrs: [{ id: 'ADR-001', title: 'Test', scope: 'technical', status: 'accepted', file: 'docs/adr/ADR-001.md' }] }).includes('ADR-001'));
      assert.ok(formatCLIResult({ command: 'adr', adr: { id: 'ADR-002', title: 'Created', file: 'docs/adr/ADR-002.md' } }).includes('ADR-002'));
      assert.ok(formatCLIResult({ command: 'decision-graph', subcommand: 'sync', decisionGraph: { nodesCount: 3, edgesCount: 2, markdownPath: 'docs/DECISION_MAP.md' } }).includes('DECISION_MAP.md'));
      assert.ok(formatCLIResult({ command: 'skill-audit', skillAudit: { skillsAudited: 10, totalFindings: 0, success: true } }).includes('PASSED'));
      assert.ok(formatCLIResult({ command: 'audit', audit: { valid: true, entriesCount: 5 } }).includes('VALID'));
      assert.ok(formatCLIResult({ command: 'stats', stats: { currentStage: '2/8', activeBranch: 'feat', completedSessions: 1, totalSessions: 2, velocityScore: 50, estimatedHoursSaved: 5, totalDollarSavingsUSD: 600 } }).includes('$600'));
      assert.ok(formatCLIResult({ command: 'cache', cache: { entriesCount: 2 } }).includes('2 cached'));
      assert.ok(formatCLIResult({ command: 'ticket', issueId: 99, provider: 'local', title: 'Test' }).includes('#99'));
      assert.ok(formatCLIResult({ command: 'product', spec: { capId: 'CAP-01', specPath: 'docs/specs/cap-01.md' } }).includes('CAP-01'));
      assert.ok(formatCLIResult({ command: 'review', review: { verdict: 'approve', reviewer: 'bot' } }).includes('approve'));
      assert.ok(formatCLIResult({ command: 'interop', interop: { selectedAgents: ['claude'], filesCreated: ['CLAUDE.md'] } }).includes('claude'));
    });

    it('translates canonical skills to Claude dialect with CLAUDE_TOOL_MAP and mergeRulesFile', () => {
      assert.equal(CLAUDE_TOOL_MAP.read_file, 'Read');
      assert.equal(CLAUDE_TOOL_MAP.write_file, 'Write');
      assert.equal(CLAUDE_TOOL_MAP.edit_file, 'Edit');
      assert.equal(CLAUDE_TOOL_MAP.run_command, 'Bash');
      assert.equal(CLAUDE_TOOL_MAP.invoke_subagent, 'Agent');

      const dialectOut = toClaudeDialect('Use `read_file` and <agent-embed src="foo"></agent-embed>');
      assert.ok(dialectOut.includes('Read'));
      assert.equal(dialectOut.includes('<agent-embed'), false);
      assert.ok(dialectOut.includes('.agent/workbench/index.html'));

      const dummySkill = {
        id: 'sdlc-sample',
        raw: '---\nname: sdlc-sample\ndescription: Test sample {{args}}\ntools: read_file, run_command, invoke_subagent\n---\n\nRun `run_command` and `read_file`.\n'
      };
      const cs = toClaudeSkill(dummySkill);
      assert.equal(cs.id, 'sdlc-sample');
      assert.ok(cs.allowedTools.includes('Read'));
      assert.ok(cs.allowedTools.includes('Bash'));
      assert.ok(cs.allowedTools.includes('Agent'));
      assert.ok(cs.markdown.includes('allowed-tools: Read, Bash, Agent'));
      assert.ok(cs.markdown.includes('description: Test sample $ARGUMENTS'));

      const rulesPath = path.join(tmpDir, 'TEST_RULES.md');
      const r1 = mergeRulesFile(rulesPath, '# Rules\n');
      assert.equal(r1.mode, 'created');
      const r2 = mergeRulesFile(rulesPath, '# Rules\n');
      assert.equal(r2.mode, 'replaced');
      const customPath = path.join(tmpDir, 'CUSTOM_RULES.md');
      fs.writeFileSync(customPath, '# Custom Project\n', 'utf8');
      const r3 = mergeRulesFile(customPath, '# Rules\n');
      assert.equal(r3.mode, 'appended');
      const r4 = mergeRulesFile(customPath, '# Rules v2\n');
      assert.equal(r4.mode, 'updated');
    });

    it('implements ADR lifecycle compaction (compactADRs + release compaction) and resolves all 6 field-tested engine bugs', () => {
      initTempGitRepo(tmpDir);

      // --- 1. Initialize Product Constitution & Test Bug A (non-destructive product spec) ---
      initProductConstitution({
        title: 'Quantum Ledger',
        vision: 'Deterministic clearinghouse.',
        capabilities: [{ id: 'CAP-01', title: 'Core Clearing', spec: 'docs/specs/cap-01-clearing.md' }],
        repoRoot: tmpDir
      });

      // Hand-write custom domain sections in docs/PRD.md, docs/SRS.md, and docs/specs/cap-01-clearing.md
      const prdPath = path.join(tmpDir, 'docs/PRD.md');
      const srsPath = path.join(tmpDir, 'docs/SRS.md');
      const cap1SpecPath = path.join(tmpDir, 'docs/specs/cap-01-clearing.md');
      fs.writeFileSync(
        prdPath,
        fs.readFileSync(prdPath, 'utf8') + '\n## Custom Domain PRD Section\nBespoke regulatory rules for ISO-20022.\n',
        'utf8'
      );
      fs.writeFileSync(
        srsPath,
        fs.readFileSync(srsPath, 'utf8') + '\n## Custom Domain SRS Section\nSub-millisecond settlement SLA.\n',
        'utf8'
      );
      fs.writeFileSync(cap1SpecPath, '# Custom Hand-Crafted CAP-01 Spec\nDo not overwrite me.\n', 'utf8');

      // Scaffold CAP-02 without --force -> must preserve custom sections in PRD.md & SRS.md and insert CAP-02
      const spec2 = scaffoldCapabilitySpec({
        capId: 'CAP-02',
        title: 'FX Netting Engine',
        dependsOn: ['CAP-01'],
        repoRoot: tmpDir
      });
      assert.equal(spec2.success, true);
      const prdAfter = fs.readFileSync(prdPath, 'utf8');
      const srsAfter = fs.readFileSync(srsPath, 'utf8');
      assert.ok(prdAfter.includes('Custom Domain PRD Section'), 'Bug A: PRD.md custom content must be preserved');
      assert.ok(prdAfter.includes('CAP-02 (FX Netting Engine)'), 'Bug A: CAP-02 must be surgical-inserted into PRD.md');
      assert.ok(srsAfter.includes('Custom Domain SRS Section'), 'Bug A: SRS.md custom content must be preserved');
      assert.ok(srsAfter.includes('`CAP-02`') && srsAfter.includes('FX Netting Engine'), 'Bug A: CAP-02 must be surgical-inserted into SRS.md');

      // Re-running scaffoldCapabilitySpec on CAP-01 without force must NOT overwrite existing docs/specs/cap-01-clearing.md
      scaffoldCapabilitySpec({
        capId: 'CAP-01',
        title: 'Core Clearing',
        repoRoot: tmpDir
      });
      assert.ok(
        fs.readFileSync(cap1SpecPath, 'utf8').includes('Do not overwrite me.'),
        'Bug A: existing capability spec file must not be overwritten unless force is true'
      );

      // --- 2. Test Bug C (buildDecisionGraph depends_on direction & linksTo deduplication) ---
      const adr1 = createADR({
        title: 'Use LMAX Disruptor RingBuffer',
        scope: 'technical',
        ticketId: 10,
        supersedes: ['CAP-01'],
        decision: 'Adopt single-writer ring buffer for clearing.',
        repoRoot: tmpDir
      });
      const adr2 = createADR({
        title: 'Add T+0 Instant Settlement Window',
        scope: 'product',
        ticketId: 11,
        supersedes: ['CAP-02'],
        decision: 'Support real-time T+0 settlement cutoff.',
        repoRoot: tmpDir
      });
      assert.equal(adr1.adr.status, 'accepted');
      assert.equal(adr2.adr.status, 'pending_approval');

      const graphBefore = buildDecisionGraph(tmpDir);
      // CAP-02 depends on CAP-01: edge must be CAP-02 -> CAP-01 (depends_on), NOT CAP-01 -> CAP-02
      assert.ok(
        graphBefore.edges.some((e) => e.from === 'CAP-02' && e.to === 'CAP-01' && e.relation === 'depends_on'),
        'Bug C: CAP-02 -->|depends_on| CAP-01 must exist'
      );
      assert.equal(
        graphBefore.edges.some((e) => e.from === 'CAP-01' && e.to === 'CAP-02' && e.relation === 'depends_on'),
        false,
        'Bug C: backwards CAP-01 -->|depends_on| CAP-02 must not exist'
      );
      assert.equal(
        graphBefore.edges.some((e) => e.from === 'CAP-01' && e.to === 'CAP-02' && e.relation === 'realized_by'),
        false,
        'Bug C: bogus CAP-01 -->|realized_by| CAP-02 must not exist'
      );
      assert.equal(
        graphBefore.edges.some((e) => e.from === '#10' && e.to === 'ADR-001' && e.relation === 'amended_by_adr'),
        false,
        'Bug C: duplicate #ticket -> ADR amended_by_adr edge must be skipped'
      );

      // --- 3. Test ADR Lifecycle Compaction (compactADRs, checkSpecDrift, CLI & Release) ---
      // Attempting to compact while ADR-002 is pending_approval MUST throw
      assert.throws(
        () => compactADRs({ releaseVersion: 'v1.0.0', repoRoot: tmpDir }),
        /ADR-002/,
        'compactADRs must abort when any ADR is pending_approval'
      );

      // Approve ADR-002 via CLI decide command
      runCLI(['adr', 'decide', 'ADR-002', 'approve'], null, tmpDir);

      // Dry-run compaction leaves ADR files on disk
      const dryCompact = compactADRs({ releaseVersion: 'v1.0.0', dryRun: true, repoRoot: tmpDir });
      assert.equal(dryCompact.dryRun, true);
      assert.equal(dryCompact.compactedCount, 2);
      assert.equal(listADRs(tmpDir).length, 2);

      // Execute compaction via CLI: `adr compact --release v1.0.0`
      const compactCliRes = runCLI(['adr', 'compact', '--release', 'v1.0.0'], null, tmpDir);
      assert.equal(compactCliRes.success, true);
      assert.equal(compactCliRes.compact.compactedCount, 2);
      assert.deepEqual(compactCliRes.compact.compactedAdrIds, ['ADR-001', 'ADR-002']);
      assert.ok(formatCLIResult(compactCliRes).includes('v1.0.0'));

      // Individual ADR files deleted
      assert.equal(listADRs(tmpDir).length, 0);

      // docs/SRS.md has ## Compacted Architectural Decisions table with ADR-001 and ADR-002
      const srsCompacted = fs.readFileSync(srsPath, 'utf8');
      assert.ok(srsCompacted.includes('## Compacted Architectural Decisions'));
      assert.ok(srsCompacted.includes('ADR-001') && srsCompacted.includes('Adopt single-writer ring buffer'));
      assert.ok(srsCompacted.includes('ADR-002') && srsCompacted.includes('v1.0.0'));

      // PRODUCT.md ADR index block reset
      const productCompacted = fs.readFileSync(path.join(tmpDir, 'PRODUCT.md'), 'utf8');
      assert.ok(productCompacted.includes('Compacted into SRS.md (v1.0.0)'));
      assert.equal(productCompacted.includes('| ADR-001 |'), false);

      // .agent/decision-graph.jsonl pruned of ADR_CREATED/ADR_DECIDED and has ADR_BATCH_COMPACTED
      const dgRaw = fs.readFileSync(path.join(tmpDir, '.agent/decision-graph.jsonl'), 'utf8');
      assert.equal(dgRaw.includes('"type":"ADR_CREATED"'), false);
      assert.equal(dgRaw.includes('"type":"ADR_DECIDED"'), false);
      assert.ok(dgRaw.includes('"type":"ADR_BATCH_COMPACTED"'));

      // docs/AUDIT_CHAIN.jsonl has ADR_BATCH_COMPACTED
      const auditRaw = fs.readFileSync(path.join(tmpDir, 'docs/AUDIT_CHAIN.jsonl'), 'utf8');
      assert.ok(auditRaw.includes('"event":"ADR_BATCH_COMPACTED"'));

      // checkSpecDrift passes on ADR compaction diff
      const driftOnCompact = checkSpecDrift({
        diffFiles: ['PRODUCT.md', 'docs/SRS.md', 'docs/adr/ADR-001-use-lmax.md'],
        ticketId: 11,
        repoRoot: tmpDir
      });
      assert.equal(driftOnCompact.passed, true, 'checkSpecDrift must allow ADR compaction diffs');

      // --- 4. Test Bug B (issueGateReceipt parameter aliases, null defaults, docsOnly, guard receipt flags) ---
      const aliasReceipt = issueGateReceipt({
        issueId: 20,
        branch: 'feature/issue-#20-alias',
        coverage: 88.6,
        mutationScore: 81.4,
        peerReviewApproved: true,
        reviewer: '@qa',
        driftCheckPassed: true,
        repoRoot: tmpDir
      });
      assert.equal(aliasReceipt.success, true);
      assert.equal(aliasReceipt.receipt.coveragePct, 88.6);
      assert.equal(aliasReceipt.receipt.mutationPct, 81.4);
      assert.equal(aliasReceipt.receipt.docsOnly, false);

      const docsOnlyReceipt = issueGateReceipt({
        issueId: 21,
        branch: 'feature/issue-#21-docs',
        docsOnly: true,
        peerReviewApproved: true,
        reviewer: '@writer',
        driftCheckPassed: true,
        repoRoot: tmpDir
      });
      assert.equal(docsOnlyReceipt.success, true);
      assert.equal(docsOnlyReceipt.receipt.coveragePct, null);
      assert.equal(docsOnlyReceipt.receipt.mutationPct, null);
      assert.equal(docsOnlyReceipt.receipt.docsOnly, true);

      startSession({ issueId: 22, branch: 'feature/issue-#22-cli', stage: 6, repoRoot: tmpDir, force: true });
      updateSession({
        manifestUpdate: { peerReview: { verdict: 'approve', reviewer: '@cli-reviewer' } },
        repoRoot: tmpDir
      });
      const cliGuardReceipt = runCLI(['guard', 'receipt', '--docs-only'], null, tmpDir);
      assert.equal(cliGuardReceipt.success, true);
      assert.equal(cliGuardReceipt.receipt.receipt.coveragePct, null);
      assert.equal(cliGuardReceipt.receipt.receipt.mutationPct, null);
      assert.equal(cliGuardReceipt.receipt.receipt.docsOnly, true);

      // --- 5. Test Bug D (updateLocalKanbanState preserves 6-column Traceability Matrix rows) ---
      createTicket({
        title: 'Preserve 6-column matrix row',
        type: 'feat',
        repoRoot: tmpDir,
        execFn: () => {
          throw new Error('offline');
        }
      });
      const kanbanBefore = fs.readFileSync(path.join(tmpDir, 'docs/KANBAN.md'), 'utf8');
      const idMatch = kanbanBefore.match(/\*\*(#\d+)\*\*/);
      assert.ok(idMatch, 'Kanban must have a ticket in the Traceability Matrix');
      const createdId = idMatch[1].replace('#', '');

      transitionPMState({
        issueId: createdId,
        state: 'in-review',
        repoRoot: tmpDir,
        execFn: () => {
          throw new Error('offline');
        }
      });
      const kanbanAfter = fs.readFileSync(path.join(tmpDir, 'docs/KANBAN.md'), 'utf8');
      const matrixLine = kanbanAfter
        .split('\n')
        .find((l) => l.includes(`**#${createdId}**`));
      assert.ok(matrixLine, 'Bug D: 6-column Traceability Matrix row must still exist with **#<id>**');
      const matrixCells = matrixLine.split('|').map((c) => c.trim());
      assert.equal(matrixCells.length, 8, 'Bug D: Traceability Matrix row must remain a 6-column row (8 split elements)');
      assert.equal(matrixCells[2], '`status:in-review`');
      assert.equal(matrixCells[4], 'Core');

      // --- 6. Test Bug E (First-time wiki sync without --init scaffolds Skills-Reference.md & passes strict audit) ---
      const freshWikiRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-fresh-wiki-'));
      try {
        initTempGitRepo(freshWikiRepo);
        installFramework({
          targetDir: freshWikiRepo,
          repoRoot: freshWikiRepo,
          agents: ['gemini'],
          skipDetect: true,
          packageRoot: process.cwd()
        });
        const firstWikiSync = runCLI(['wiki', 'sync'], null, freshWikiRepo);
        assert.equal(firstWikiSync.success, true, JSON.stringify(firstWikiSync.wikiAudit?.findings));
        assert.equal(fs.existsSync(path.join(freshWikiRepo, 'wiki/Home.md')), true);
        assert.equal(fs.existsSync(path.join(freshWikiRepo, 'wiki/Skills-Reference.md')), true);
        const strictWiki = auditWiki(freshWikiRepo, { strict: true });
        assert.equal(strictWiki.passed, true, JSON.stringify(strictWiki.findings));

        const gitignoreContent = fs.readFileSync(path.join(freshWikiRepo, '.gitignore'), 'utf8');
        assert.ok(gitignoreContent.includes('.agent/skills/*/scripts/bin/'));
        assert.ok(gitignoreContent.includes('.agent/workbench/index.html'));
        assert.ok(gitignoreContent.includes('.agent/arch-trace.jsonl'));
        assert.ok(gitignoreContent.includes('docs/ARCH_TRACE.md'));
      } finally {
        fs.rmSync(freshWikiRepo, { recursive: true, force: true });
      }

      // Also verify executeRelease automatically compacts in-flight ADRs when cutting a release
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'quantum', version: '1.0.0' }, null, 2));
      createADR({
        title: 'Release Auto-Compacted Decision',
        scope: 'technical',
        ticketId: 30,
        supersedes: ['CAP-01'],
        decision: 'Compact me automatically on release.',
        repoRoot: tmpDir
      });
      assert.equal(listADRs(tmpDir).length, 1);
      const relRes = executeRelease({ bump: 'minor', skipGate: true, repoRoot: tmpDir });
      assert.equal(relRes.success, true);
      assert.equal(relRes.newVersion, '1.1.0');
      assert.equal(relRes.compactedAdrs.compactedCount, 1);
      assert.equal(listADRs(tmpDir).length, 0);

      // --- 7. Test Bug F (ensureWorkbenchRunning stdio:'ignore' + unref, pinned @fmatar/archlens-skill, .gitignore) ---
      let spawnedOpts = null;
      let unrefCalled = false;
      const wbSpawn = ensureWorkbenchRunning({
        port: 4120,
        repoRoot: process.cwd(),
        spawn: true,
        spawnFn: (_cmd, _args, opts) => {
          spawnedOpts = opts;
          return {
            unref() {
              unrefCalled = true;
            }
          };
        }
      });
      assert.equal(wbSpawn.started, true);
      assert.equal(spawnedOpts.stdio, 'ignore');
      assert.equal(spawnedOpts.detached, true);
      assert.equal(unrefCalled, true);

      const mcpJson = fs.readFileSync(path.resolve('.mcp.json'), 'utf8');
      assert.ok(mcpJson.includes('@fmatar/archlens-skill@'), '.mcp.json must pin @fmatar/archlens-skill version');
    });

    it('discovers/creates GitHub PRs in stage pre-pr, formats 4-section consolidated reviews, posts strictly to the PR via review record/pm comment, and fails loudly when GitHub remote comment fails (#99)', () => {
      initTempGitRepo(tmpDir);

      // 1. Without a GitHub remote, hasGitHubRemote is false; once a github.com remote is added, it is true
      assert.equal(hasGitHubRemote(tmpDir), false);
      execSync('git remote add origin https://github.com/fmatar/agentic-sdlc-framework.git', { cwd: tmpDir, stdio: 'pipe' });
      assert.equal(hasGitHubRemote(tmpDir), true);

      // 2. detectPMProvider honors projectManagement.provider === "github" in .agent/sdlc-config.json
      fs.mkdirSync(path.join(tmpDir, '.agent'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, '.agent/sdlc-config.json'),
        JSON.stringify({
          version: '2.1.0',
          projectManagement: { provider: 'github', key: 'SDLC' },
          modules: [{ name: 'root', path: '.', commands: { test: 'node -e 0' }, thresholds: { diffCoverage: 85, mutationScore: null } }]
        }),
        'utf8'
      );
      assert.equal(detectPMProvider(tmpDir).provider, 'github');

      // 3. Start session on feature branch and verify ensurePullRequest creates a PR when none is open
      execSync('git checkout -b feature/issue-#99-pr-review', { cwd: tmpDir, stdio: 'pipe' });
      startSession({
        issueId: 99,
        branch: 'feature/issue-#99-pr-review',
        stage: 5,
        repoRoot: tmpDir,
        force: true
      });
      updateSession({
        manifestUpdate: { coverageReport: '92.4%', mutationScore: '84.1%' },
        repoRoot: tmpDir
      });

      const ghCalls = [];
      let prCreated = false;
      const mockGhExec = (bin, args) => {
        ghCalls.push({ bin, args });
        if (bin === 'git' && args[0] === 'push') {
          return 'Everything up-to-date';
        }
        if (bin === 'gh' && args[0] === 'pr' && args[1] === 'view') {
          if (!prCreated) throw new Error('no pull requests found for branch');
          return JSON.stringify({ number: 104, url: 'https://github.com/fmatar/agentic-sdlc-framework/pull/104' });
        }
        if (bin === 'gh' && args[0] === 'pr' && args[1] === 'create') {
          prCreated = true;
          return 'https://github.com/fmatar/agentic-sdlc-framework/pull/104\n';
        }
        if (bin === 'gh' && args[0] === 'pr' && args[1] === 'comment') {
          return 'https://github.com/fmatar/agentic-sdlc-framework/pull/104#issuecomment-1\n';
        }
        if (bin === 'gh' && args[0] === 'issue' && args[1] === 'comment') {
          return 'https://github.com/fmatar/agentic-sdlc-framework/issues/99#issuecomment-2\n';
        }
        return '';
      };

      const ensured = ensurePullRequest({
        issueId: 99,
        branch: 'feature/issue-#99-pr-review',
        title: 'fix: publish consolidated peer review to PR',
        body: '## Summary\nCloses #99',
        repoRoot: tmpDir,
        execFn: mockGhExec
      });
      assert.equal(ensured.success, true);
      assert.equal(ensured.created, true);
      assert.equal(ensured.prNumber, 104);
      assert.equal(ensured.prUrl, 'https://github.com/fmatar/agentic-sdlc-framework/pull/104');

      // Calling resolveOpenPRNumber now finds 104 from the session manifest without needing a new PR
      const resolvedPr = resolveOpenPRNumber({ repoRoot: tmpDir, execFn: mockGhExec });
      assert.equal(resolvedPr, 104);

      // 4. formatConsolidatedReviewComment produces all 4 required sections
      const formattedMd = formatConsolidatedReviewComment({
        issueId: 99,
        prNumber: 104,
        branch: 'feature/issue-#99-pr-review',
        headSha: 'abcdef1234567890',
        verdict: 'approve',
        reviewer: '@sdlc-gate',
        peerReviewSummary: 'Zero test smells; F.I.R.S.T. isolation verified.',
        archSecuritySummary: 'Zero Concentric Clean Architecture ring inversions.',
        coveragePct: '92.4%',
        mutationPct: '84.1%',
        receiptId: 'GATE-RECEIPT-#99-abcdef12'
      });
      assert.ok(formattedMd.includes('APPROVED'), 'Section 1: Verdict header must be present');
      assert.ok(formattedMd.includes('abcdef12'), 'Section 1: Commit SHA must be present');
      assert.ok(formattedMd.includes('Subagent 1: PR Peer Reviewer'), 'Section 2: Subagent 1 section must be present');
      assert.ok(formattedMd.includes('Zero test smells; F.I.R.S.T. isolation verified.'), 'Section 2 body must be included');
      assert.ok(formattedMd.includes('Subagent 2: Architecture & Security Gatekeeper'), 'Section 3: Subagent 2 section must be present');
      assert.ok(formattedMd.includes('Zero Concentric Clean Architecture ring inversions.'), 'Section 3 body must be included');
      assert.ok(formattedMd.includes('9-Pillar Quality Gate'), 'Section 4: 9-Pillar table must be present');
      assert.ok(formattedMd.includes('GATE-RECEIPT-#99-abcdef12'), 'Section 4: Stage 7 Receipt ID must be present');

      // 5. postPMComment auto-detects prNumber (104) from session and posts ONLY to the PR (not duplicate on the Issue)
      ghCalls.length = 0;
      const commentRes = postPMComment({
        issueId: 99,
        comment: formattedMd,
        repoRoot: tmpDir,
        execFn: mockGhExec
      });
      assert.equal(commentRes.success, true);
      assert.equal(commentRes.provider, 'github');
      assert.equal(commentRes.prNumber, 104);
      const prCommentCalls = ghCalls.filter((c) => c.bin === 'gh' && c.args[0] === 'pr' && c.args[1] === 'comment');
      const issueCommentCalls = ghCalls.filter((c) => c.bin === 'gh' && c.args[0] === 'issue' && c.args[1] === 'comment');
      assert.equal(prCommentCalls.length, 1, 'Must post comment to the PR via gh pr comment');
      assert.equal(prCommentCalls[0].args[2], '104');
      assert.equal(issueCommentCalls.length, 0, 'Must NOT post a duplicate comment to the Issue when an open PR exists');

      // 6. When a GitHub remote is configured and gh pr comment fails, postPMComment fails loudly (success: false)
      const failingGhExec = () => {
        throw new Error('HTTP 401: Bad credentials or sandbox network blocked');
      };
      const failedComment = postPMComment({
        issueId: 99,
        prNumber: 104,
        comment: 'Should fail loudly on GitHub remote error',
        repoRoot: tmpDir,
        execFn: failingGhExec
      });
      assert.equal(failedComment.success, false, 'Must fail loudly when GitHub remote exists and gh fails');
      assert.ok(failedComment.error.includes('401') || failedComment.error.includes('GitHub'));

      // 7. Unified `review record` records verdict, signs receipt when measurements exist, and publishes 4-section comment
      const reviewCliRes = runCLI(
        [
          'review',
          'record',
          '--verdict',
          'approve',
          '--reviewer',
          '@sdlc-gate',
          '--peer-review',
          'TDD Red-Green-Refactor verified.',
          '--arch-review',
          'Archlens concentric rings verified.',
          '--no-comment'
        ],
        null,
        tmpDir
      );
      assert.equal(reviewCliRes.success, true);
      assert.equal(reviewCliRes.review.verdict, 'approve');
      assert.equal(reviewCliRes.review.reviewer, '@sdlc-gate');
      assert.ok(reviewCliRes.review.formattedComment.includes('TDD Red-Green-Refactor verified.'));
      assert.ok(reviewCliRes.review.formattedComment.includes('Archlens concentric rings verified.'));
    });
  });

  describe('8. 10-30-90 Developer Landing Page README Engine (#100)', () => {
    it('detects CLI, SDK, and Platform archetypes across Node, Rust, Python, Go, and Compose manifests', () => {
      const cliDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-readme-cli-'));
      const sdkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-readme-sdk-'));
      const platDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-readme-plat-'));
      const goCliDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-readme-gocli-'));
      const rustBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-readme-rbin-'));
      try {
        fs.writeFileSync(path.join(cliDir, 'package.json'), JSON.stringify({ name: '@acme/forge-cli', version: '1.4.0', bin: { forge: './bin/forge.js' } }));
        assert.equal(detectReadmeArchetype(cliDir), 'cli');

        fs.writeFileSync(path.join(sdkDir, 'package.json'), JSON.stringify({ name: '@acme/forge-sdk', version: '2.0.0', main: './dist/index.js' }));
        assert.equal(detectReadmeArchetype(sdkDir), 'sdk');

        fs.writeFileSync(path.join(platDir, 'docker-compose.yml'), 'services:\n  web:\n    image: nginx:alpine\n');
        assert.equal(detectReadmeArchetype(platDir), 'platform');

        fs.writeFileSync(path.join(goCliDir, 'go.mod'), 'module github.com/acme/gocli\n');
        fs.mkdirSync(path.join(goCliDir, 'cmd'), { recursive: true });
        assert.equal(detectReadmeArchetype(goCliDir), 'cli');

        fs.writeFileSync(path.join(rustBinDir, 'Cargo.toml'), '[package]\nname = "zap"\nversion = "0.1.0"\n[[bin]]\nname = "zap"\n');
        assert.equal(detectReadmeArchetype(rustBinDir), 'cli');

        const sampleTemplate = [
          '<!-- TEMPLATE_GUIDE_START -->',
          'Internal authoring guide',
          '<!-- TEMPLATE_GUIDE_END -->',
          '# Demo',
          '<!-- ARCHETYPE:cli -->',
          'CLI_HERO_BLOCK',
          '<!-- /ARCHETYPE:cli -->',
          '<!-- ARCHETYPE:sdk -->',
          'SDK_HERO_BLOCK',
          '<!-- /ARCHETYPE:sdk -->',
          '<!-- ARCHETYPE:platform -->',
          'PLATFORM_HERO_BLOCK',
          '<!-- /ARCHETYPE:platform -->'
        ].join('\n');
        const strippedSdk = stripArchetypeBlocks(sampleTemplate, 'sdk');
        assert.ok(strippedSdk.includes('SDK_HERO_BLOCK'));
        assert.equal(strippedSdk.includes('CLI_HERO_BLOCK'), false);
        assert.equal(strippedSdk.includes('PLATFORM_HERO_BLOCK'), false);
        assert.equal(strippedSdk.includes('ARCHETYPE:'), false);
        assert.equal(strippedSdk.includes('Internal authoring guide'), false);

        const nullTitleSvg = renderThemeWordmarkSvg({ title: null, mode: 'dark' });
        assert.ok(nullTitleSvg.includes('aria-label="Project"'));
        const escapedSvg = renderThemeWordmarkSvg({ title: 'A&B <Core>', mode: 'light' });
        assert.ok(escapedSvg.includes('A&amp;B &lt;Core&gt;'));

        const safeTape = renderVhsDemoTape({
          title: 'CLI\nInjected',
          demoCmd: 'forge "hello\\world"\nExec evil',
          outputPath: 'docs/demo.gif\nExec evil'
        });
        assert.equal(safeTape.includes('\nExec evil'), false);
        assert.ok(safeTape.includes('Type "forge \\"hello\\\\world\\" Exec evil"'));
      } finally {
        fs.rmSync(cliDir, { recursive: true, force: true });
        fs.rmSync(sdkDir, { recursive: true, force: true });
        fs.rmSync(platDir, { recursive: true, force: true });
        fs.rmSync(goCliDir, { recursive: true, force: true });
        fs.rmSync(rustBinDir, { recursive: true, force: true });
      }
    });

    it('scaffolds 10-30-90 READMEs + companion assets idempotently across archetypes, honors --no-assets cleanly, and rejects unknown archetypes', () => {
      const cliDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-readme-init-cli-'));
      const platDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-readme-init-plat-'));
      const pySdkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-readme-init-pysdk-'));
      const rustLibDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-readme-init-rlib-'));
      const pyCliDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-readme-init-pycli-'));
      try {
        fs.writeFileSync(path.join(cliDir, 'package.json'), JSON.stringify({ name: '@acme/forge-cli', version: '1.4.0', license: 'MIT', bin: { forge: './bin/forge.js' } }));
        fs.writeFileSync(path.join(cliDir, 'LICENSE'), 'MIT\n');
        fs.writeFileSync(path.join(cliDir, 'CONTRIBUTING.md'), '# Contributing\n');

        const initCliRes = runCLI(['readme', 'init', '--hook', 'Deterministic build accelerator for monorepos that cuts CI times by 70%.'], null, cliDir);
        assert.equal(initCliRes.success, true);
        assert.equal(initCliRes.readme.written, true);
        assert.equal(initCliRes.readme.archetype, 'cli');
        assert.equal(fs.existsSync(path.join(cliDir, 'docs/logo-light.svg')), true);
        assert.equal(fs.existsSync(path.join(cliDir, 'docs/logo-dark.svg')), true);
        assert.equal(fs.existsSync(path.join(cliDir, 'llms.txt')), true);
        assert.equal(fs.existsSync(path.join(cliDir, 'docs/demo.tape')), true);

        const cliReadme = fs.readFileSync(path.join(cliDir, 'README.md'), 'utf8');
        assert.ok(cliReadme.includes('<picture>'));
        assert.ok(cliReadme.includes("%%{init: {'theme': 'neutral'}}%%"));
        assert.equal(cliReadme.includes('docs/demo.gif'), false);
        assert.equal(auditReadme(cliDir, { strict: true }).warningsCount, 0);

        // Idempotent default preserves existing README.md; --force + docs/demo.gif switches to GIF hero
        fs.appendFileSync(path.join(cliDir, 'README.md'), '\n<!-- custom-marker -->\n');
        assert.equal(scaffoldReadme({ repoRoot: cliDir }).written, false);
        assert.ok(fs.readFileSync(path.join(cliDir, 'README.md'), 'utf8').includes('<!-- custom-marker -->'));

        fs.writeFileSync(path.join(cliDir, 'docs/demo.gif'), 'GIF89a');
        assert.equal(runCLI(['readme', 'init', '--force'], null, cliDir).readme.written, true);
        assert.ok(fs.readFileSync(path.join(cliDir, 'README.md'), 'utf8').includes('docs/demo.gif'));

        // Platform, Rust SDK & Python CLI scaffolds pass strict audit cleanly
        fs.writeFileSync(path.join(platDir, 'compose.yaml'), 'services:\n  api:\n    image: node:22\n');
        assert.equal(scaffoldReadme({ repoRoot: platDir }).archetype, 'platform');
        assert.ok(fs.readFileSync(path.join(platDir, 'README.md'), 'utf8').includes('docker compose up'));
        assert.equal(auditReadme(platDir, { strict: true }).passed, true);

        fs.writeFileSync(path.join(rustLibDir, 'Cargo.toml'), '[package]\nname = "hyper-ledger"\nversion = "0.4.2"\n[lib]\npath = "src/lib.rs"\n');
        scaffoldReadme({ repoRoot: rustLibDir });
        assert.ok(fs.readFileSync(path.join(rustLibDir, 'README.md'), 'utf8').includes('cargo add hyper-ledger'));
        assert.equal(auditReadme(rustLibDir, { strict: true }).passed, true);

        fs.writeFileSync(path.join(pyCliDir, 'pyproject.toml'), '[project]\nname = "pulse-cli"\nversion = "1.2.0"\n[project.scripts]\npulse = "pulse.cli:main"\n');
        scaffoldReadme({ repoRoot: pyCliDir });
        assert.ok(fs.readFileSync(path.join(pyCliDir, 'README.md'), 'utf8').includes('pip install pulse-cli'));
        assert.equal(auditReadme(pyCliDir, { strict: true }).passed, true);

        // --no-assets omits missing logo/llms.txt links so post-init strict audit passes (success === true)
        fs.writeFileSync(path.join(pySdkDir, 'pyproject.toml'), '[project]\nname = "vector-kit"\nversion = "0.9.0"\n');
        const pySdkRes = runCLI(['readme', 'init', '--title', 'Vector Kit SDK', '--archetype', 'sdk', '--no-assets'], null, pySdkDir);
        assert.equal(pySdkRes.readme.written, true);
        assert.equal(pySdkRes.success, true, `Expected --no-assets init to pass strict audit: ${JSON.stringify(pySdkRes.readmeAudit?.findings)}`);
        assert.equal(fs.existsSync(path.join(pySdkDir, 'llms.txt')), false);
        assert.ok(fs.readFileSync(path.join(pySdkDir, 'README.md'), 'utf8').includes('from vector_kit import Client'));

        // Unknown --archetype throws descriptive boundary error
        assert.throws(() => scaffoldReadme({ repoRoot: pySdkDir, archetype: 'unknown-type', force: true }), /Unsupported README archetype/);
      } finally {
        fs.rmSync(cliDir, { recursive: true, force: true });
        fs.rmSync(platDir, { recursive: true, force: true });
        fs.rmSync(pySdkDir, { recursive: true, force: true });
        fs.rmSync(rustLibDir, { recursive: true, force: true });
        fs.rmSync(pyCliDir, { recursive: true, force: true });
      }
    });

    it('enforces tiered 10-30-90 blueprint audit rules, boundary security, gate --strict integration, and dogfoods root README', () => {
      const badDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-readme-bad-'));
      try {
        // Missing README returns MISSING_README
        assert.equal(auditReadme(badDir, { strict: true }).findings[0].rule, 'MISSING_README');

        const badReadme = [
          '# Bloated Project {{UNRESOLVED_TOKEN}}',
          '',
          '![b1](https://img.shields.io/badge/a-1-blue)',
          '![b2](https://img.shields.io/badge/b-2-blue)',
          '![b3](https://img.shields.io/badge/c-3-blue)',
          '![b4](https://img.shields.io/badge/d-4-blue)',
          '![b5](https://img.shields.io/badge/e-5-blue)',
          '',
          'See [Missing Spec](./docs/does-not-exist.md), [Escape](/etc/hosts), and inline `[Example](ignored/inline.md)`.',
          '<img srcset="docs/missing-1x.svg 1x, docs/missing-2x.svg 2x">',
          '',
          '## Why Bloated?',
          'Pain description.',
          '',
          '## Quickstart',
          '```bash',
          '## shell comment inside fence must not truncate Quickstart',
          'git clone https://example.com/app.git',
          '```',
          '',
          '## How It Works',
          '```mermaid',
          'flowchart LR',
          '  A["In"] --> B["Out"]',
          '```'
        ].join('\n');
        fs.writeFileSync(path.join(badDir, 'README.md'), badReadme, 'utf8');

        const strictBad = runCLI(['readme', 'audit', '--strict'], null, badDir);
        assert.equal(strictBad.success, false);
        const findings = strictBad.readmeAudit.findings;
        assert.ok(findings.some((f) => f.rule === 'LEFTOVER_TEMPLATE_TOKEN'));
        assert.ok(findings.some((f) => f.rule === 'BADGE_CHRISTMAS_TREE'));
        assert.ok(findings.some((f) => f.rule === 'GIT_CLONE_FIRST_QUICKSTART'));
        assert.ok(findings.some((f) => f.rule === 'BROKEN_README_LINK' && f.target === './docs/does-not-exist.md'));
        assert.ok(findings.some((f) => f.rule === 'BROKEN_README_LINK' && f.target === '/etc/hosts'));
        assert.ok(findings.some((f) => f.rule === 'BROKEN_README_LINK' && f.target === 'docs/missing-2x.svg'));
        assert.equal(findings.some((f) => f.target === 'ignored/inline.md'), false, 'Inline backtick code spans must not trigger broken link errors');
        assert.equal(findings.find((f) => f.rule === 'NON_NEUTRAL_MERMAID')?.severity, 'WARN');
        assert.equal(findings.find((f) => f.rule === 'MISSING_THEME_AWARE_LOGO')?.severity, 'WARN');

        // Final H2 Quickstart without letter 'z' or unresolved tokens still fails strictly on GIT_CLONE_FIRST_QUICKSTART alone
        fs.writeFileSync(
          path.join(badDir, 'README.md'),
          '# App\n\n## Why App?\nPain.\n\n## Quickstart\n```bash\n## setup step\ngit clone https://example.com/app.git\n```\n'
        );
        const cloneOnlyAudit = auditReadme(badDir, { strict: true });
        assert.equal(cloneOnlyAudit.passed, false);
        assert.deepEqual(
          cloneOnlyAudit.findings.filter((f) => f.severity === 'ERROR').map((f) => f.rule),
          ['GIT_CLONE_FIRST_QUICKSTART']
        );

        // gate --strict blocks when README.md has hard errors
        const gateCfgPath = path.join(badDir, '.agent/sdlc-config.json');
        fs.mkdirSync(path.dirname(gateCfgPath), { recursive: true });
        fs.writeFileSync(
          gateCfgPath,
          JSON.stringify({
            version: '1.0.0',
            modules: [
              {
                name: 'root',
                path: '.',
                commands: {
                  coverage: `node -e "require('fs').mkdirSync('coverage',{recursive:true});require('fs').writeFileSync('coverage/coverage-summary.json',JSON.stringify({total:{lines:{pct:95},branches:{pct:90}}}))"`
                },
                thresholds: { diffCoverage: 85, mutationScore: null }
              }
            ]
          })
        );
        assert.throws(() => runCLI(['gate', '--strict'], gateCfgPath, badDir), /README Audit failed/);

        // SVG & VHS newline/null sanitization + wiki neutral Mermaid support
        assert.ok(renderThemeWordmarkSvg({ title: null, mode: 'dark' }).includes('<svg'));
        const safeTape = renderVhsDemoTape({
          title: 'Demo\nExec echo pwned',
          demoCmd: 'forge --run "a\\b"\nExec echo pwned',
          outputPath: 'docs/demo.gif\nExec echo pwned'
        });
        assert.equal(/^Exec\b/m.test(safeTape), false);

        syncWiki({ repoRoot: badDir, generateMissing: true });
        fs.writeFileSync(
          path.join(badDir, 'wiki/Architecture.md'),
          "# Architecture\n\n```mermaid\n%%{init: {'theme': 'neutral'}}%%\nflowchart LR\n  Core[\"Domain Core\"] --> Port[\"Port\"]\n```\n"
        );
        assert.equal(auditWiki(badDir, { strict: true }).findings.some((f) => f.rule === 'INVALID_MERMAID_DIAGRAM'), false);

        // Template exists and this repository dogfoods the 10-30-90 blueprint with 0 errors and 0 warnings
        assert.equal(fs.existsSync(path.resolve('docs/templates/README_TEMPLATE.md')), true);
        const repoSelfAudit = auditReadme(process.cwd(), { strict: true });
        assert.equal(repoSelfAudit.passed, true, JSON.stringify(repoSelfAudit.findings));
        assert.equal(repoSelfAudit.errorsCount, 0);
        assert.equal(repoSelfAudit.warningsCount, 0);
      } finally {
        fs.rmSync(badDir, { recursive: true, force: true });
      }
    });
  });
});
