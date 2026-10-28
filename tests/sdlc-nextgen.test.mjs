import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execSync } from 'node:child_process';

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
  detectPMProvider,
  installHooks,
  createWorkbenchServer,
  buildArchDiffPayload,
  generateArchitectureWidget,
  SUPPORTED_AGENTS,
  CANONICAL_SDLC_SKILLS,
  DEPRECATED_SDLC_SKILLS,
  pruneDeprecatedSkills,
  installFramework,
  parseInstallArgs,
  inspectSourceModule,
  resolveArchlensRing,
  buildWikiCodeMap,
  auditWiki,
  syncWiki,
  runCLI
} from '../.agent/scripts/sdlc-engine.mjs';

function initTempGitRepo(dir) {
  execSync('git init -b main', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "agent@sdlc.local"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "SDLC Agent"', { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Genesis Repo\n', 'utf8');
  execSync('git add README.md && git commit -m "chore: initial commit"', { cwd: dir, stdio: 'pipe' });
}

function httpRequest(port, method, urlPath, bodyObj = null) {
  return new Promise((resolve, reject) => {
    const payload = bodyObj ? JSON.stringify(bodyObj) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {}
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

      const wb = createWorkbenchServer({ port: 0, repoRoot: tmpDir });
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
      assert.equal(CANONICAL_SDLC_SKILLS.length, 10);
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
      assert.equal(cliRes.installed.skillsCount, 10);
      assert.ok(cliRes.installed.prunedSkills.includes('sdlc-kanban'));

      // Deprecated skill removed, custom skill preserved, 6 canonical skills present
      assert.equal(fs.existsSync(legacySkillDir), false);
      assert.equal(fs.existsSync(customSkillDir), true);
      for (const s of CANONICAL_SDLC_SKILLS) {
        assert.equal(fs.existsSync(path.join(tmpDir, '.agent/skills', s, 'SKILL.md')), true);
        assert.equal(fs.existsSync(path.join(tmpDir, '.claude/skills', s, 'SKILL.md')), true);
        assert.equal(fs.existsSync(path.join(tmpDir, '.claude/commands', `${s}.md`)), true);
        assert.equal(fs.existsSync(path.join(tmpDir, '.grok/skills', s, 'SKILL.md')), true);
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
  });
});
