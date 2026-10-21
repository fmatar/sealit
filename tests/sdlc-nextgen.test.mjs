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
  installHooks,
  createWorkbenchServer,
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
      assert.equal(initRes.genesisTicket.issueId, 1);
      assert.ok(initRes.genesisTicket.branch.includes('feature/issue-#1-product-genesis'));

      const parsed = parseProductMarkdown(tmpDir);
      assert.equal(parsed.title, 'Realtime Order Mesh');
      assert.equal(parsed.capabilities.length, 3);
      assert.equal(parsed.capabilities[0].id, 'CAP-01');
      assert.equal(parsed.capabilities[1].id, 'CAP-02');
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
        diffFiles: ['package.json', 'openapi.json'],
        ticketId: 12,
        repoRoot: tmpDir
      });

      assert.equal(driftRes.passed, false);
      assert.equal(driftRes.hasUndeclaredDrift, true);
      assert.ok(driftRes.triggers.length >= 2);

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
});
