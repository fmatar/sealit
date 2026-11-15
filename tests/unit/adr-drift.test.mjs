import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  createADR,
  listADRs,
  decideADR,
  compactADRs,
  checkSpecDrift,
  auditContractDrift
} from '../../.agent/scripts/lib/adr-drift.mjs';

describe('Unit: adr-drift.mjs', () => {
  let repoDir;

  before(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-unit-adr-git-'));
    execFileSync('git', ['init', '-b', 'develop'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir, stdio: 'pipe' });
    fs.writeFileSync(
      path.join(repoDir, 'package.json'),
      JSON.stringify({ name: 'demo', version: '0.1.0', dependencies: { a: '1.0.0' }, scripts: { test: 'node --test' } }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(repoDir, 'PRODUCT.md'),
      '# Product\n\n<!-- ADR_INDEX_START -->\n| ADR ID | Title |\n| :--- | :--- |\n<!-- ADR_INDEX_END -->\n\n## Vision\nOriginal.\n',
      'utf8'
    );
    fs.mkdirSync(path.join(repoDir, 'docs/adr'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'docs/adr/.gitkeep'), '', 'utf8');
    fs.mkdirSync(path.join(repoDir, 'docs/specs'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'docs/specs/cap-01.md'), '# CAP-01\n', 'utf8');
    fs.writeFileSync(
      path.join(repoDir, 'openapi.yaml'),
      'openapi: 3.0.0\npaths:\n  /users:\n    get:\n      summary: list\n    post:\n      summary: create\n  /health:\n    get:\n      summary: ok\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(repoDir, 'schema.graphql'),
      'type User {\n  id: ID!\n}\ninput CreateUserInput {\n  name: String!\n}\ninterface Node {\n  id: ID!\n}\n',
      'utf8'
    );
    execFileSync('git', ['add', '.'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['checkout', '-b', 'feature/issue-#22'], { cwd: repoDir, stdio: 'pipe' });
  });

  after(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    for (const f of fs.readdirSync(path.join(repoDir, 'docs/adr'))) {
      if (f !== '.gitkeep') fs.rmSync(path.join(repoDir, 'docs/adr', f), { force: true });
    }
    fs.rmSync(path.join(repoDir, 'docs/SRS.md'), { force: true });
    fs.rmSync(path.join(repoDir, 'docs/AUDIT_CHAIN.jsonl'), { force: true });
    fs.rmSync(path.join(repoDir, 'docs/DECISION_MAP.md'), { force: true });
    fs.rmSync(path.join(repoDir, '.agent/decision-graph.jsonl'), { force: true });
    execFileSync('git', ['checkout', '--', 'package.json', 'PRODUCT.md', 'docs/specs/cap-01.md', 'openapi.yaml', 'schema.graphql'], {
      cwd: repoDir,
      stdio: 'pipe'
    });
  });

  it('creates, lists, approves/rejects ADRs, syncs PRODUCT.md index, and rejects invalid actions', () => {
    assert.deepEqual(listADRs(repoDir), []);

    const tech = createADR({
      title: 'Use deterministic parser',
      scope: 'technical',
      ticketId: 22,
      supersedes: ['CAP-01'],
      context: 'Need deterministic parser',
      decision: 'Parse JSON directly',
      consequences: 'Predictable behavior',
      repoRoot: repoDir
    });
    assert.equal(tech.success, true);
    assert.equal(tech.adr.id, 'ADR-001');
    assert.equal(tech.adr.status, 'pending_approval');
    assert.match(fs.readFileSync(path.join(repoDir, 'PRODUCT.md'), 'utf8'), /ADR-001/);

    const prod = createADR({
      title: 'Change public API',
      scope: 'contract',
      ticketId: '#22',
      supersedes: ['CAP-02'],
      repoRoot: repoDir
    });
    assert.equal(prod.adr.id, 'ADR-002');
    assert.equal(prod.adr.status, 'pending_approval');

    assert.equal(listADRs(repoDir).length, 2);

    assert.throws(() => decideADR({ adrId: 'ADR-999', action: 'approve', repoRoot: repoDir }), /not found/i);
    assert.throws(() => decideADR({ adrId: 'ADR-002', action: 'defer', repoRoot: repoDir }), /Invalid ADR decision action/i);

    const rejected = decideADR({
      adrId: 'ADR-002',
      action: 'reject',
      reviewer: '@sec',
      reason: 'Breaking contract',
      repoRoot: repoDir
    });
    assert.equal(rejected.adr.status, 'rejected');

    const approved = decideADR({
      adrId: 'ADR-002',
      action: 'approve',
      reviewer: '@arch',
      reason: 'Updated docs',
      repoRoot: repoDir
    });
    assert.equal(approved.adr.status, 'accepted');
    const content = fs.readFileSync(approved.adr.fullPath, 'utf8');
    assert.match(content, /## 4\. Governance Review Decision/);
    assert.match(content, /@arch/);
  });

  it('compacts accepted ADRs into docs/SRS.md idempotently, refuses pending ADRs, and cleans ADR files', () => {
    const empty = compactADRs({ repoRoot: repoDir });
    assert.equal(empty.compactedCount, 0);

    const pending = createADR({ title: 'Pending Cap', scope: 'product', ticketId: 22, repoRoot: repoDir });
    assert.throws(() => compactADRs({ repoRoot: repoDir }), /pending_approval/i);
    decideADR({ adrId: pending.adr.id, action: 'approve', reviewer: '@lead', reason: 'ok', repoRoot: repoDir });

    const dry = compactADRs({ releaseVersion: '1.2.3', dryRun: true, repoRoot: repoDir });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.compactedCount, 1);
    assert.equal(dry.acceptedCount, 1);
    assert.equal(listADRs(repoDir).length, 1);

    const live = compactADRs({ releaseVersion: '1.2.3', dryRun: false, repoRoot: repoDir });
    assert.equal(live.success, true);
    assert.deepEqual(live.compactedAdrIds, ['ADR-001']);
    assert.equal(listADRs(repoDir).length, 0);
    assert.equal(fs.existsSync(path.join(repoDir, 'docs/adr/.gitkeep')), true);

    const srs = fs.readFileSync(path.join(repoDir, 'docs/SRS.md'), 'utf8');
    assert.match(srs, /## Compacted Architectural Decisions/);
    assert.match(srs, /`ADR-001`.*`1\.2\.3`/);
    assert.match(fs.readFileSync(path.join(repoDir, 'PRODUCT.md'), 'utf8'), /Compacted into SRS\.md \(1\.2\.3\)/);

    // Next ADR continues monotonic IDs beyond compacted SRS IDs
    const next = createADR({ title: 'Post compaction ADR', scope: 'technical', ticketId: 23, repoRoot: repoDir });
    assert.equal(next.adr.id, 'ADR-002');
  });

  it('detects package.json, spec, and compaction drift rules accurately', () => {
    // Version-only bump in package.json is NOT structural drift
    const pkg = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
    fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({ ...pkg, version: '0.1.1' }, null, 2) + '\n', 'utf8');
    assert.equal(checkSpecDrift({ diffFiles: ['package.json'], repoRoot: repoDir }).passed, true);

    // Dependency mutation without ADR fails closed
    fs.writeFileSync(
      path.join(repoDir, 'package.json'),
      JSON.stringify({ ...pkg, dependencies: { a: '1.0.0', b: '2.0.0' } }, null, 2) + '\n',
      'utf8'
    );
    const depDrift = checkSpecDrift({ diffFiles: ['package.json'], ticketId: 22, repoRoot: repoDir });
    assert.equal(depDrift.passed, false);
    assert.equal(depDrift.hasUndeclaredDrift, true);
    assert.match(depDrift.message, /UNDECLARED_SPEC_DRIFT/);

    // Spec change with pending ADR reports UNAPPROVED_ADR_DRIFT
    fs.writeFileSync(path.join(repoDir, 'docs/specs/cap-01.md'), '# CAP-01 updated\n', 'utf8');
    const pendingAdr = createADR({ title: 'Pending Spec ADR', scope: 'product', ticketId: 22, repoRoot: repoDir });
    const pendingDrift = checkSpecDrift({ diffFiles: ['package.json', 'docs/specs/cap-01.md'], ticketId: 22, repoRoot: repoDir });
    assert.equal(pendingDrift.passed, false);
    assert.match(pendingDrift.message, /UNAPPROVED_ADR_DRIFT/);

    // Approve linked ADR -> drift check passes
    decideADR({ adrId: pendingAdr.adr.id, action: 'approve', reviewer: '@arch', reason: 'approved', repoRoot: repoDir });
    const cleanDrift = checkSpecDrift({ diffFiles: ['package.json', 'docs/specs/cap-01.md'], ticketId: 22, repoRoot: repoDir });
    assert.equal(cleanDrift.passed, true);
    assert.deepEqual(cleanDrift.linkedADRs, [pendingAdr.adr.id]);
  });

  it('audits OpenAPI YAML/JSON and GraphQL breaking contract mutations', () => {
    const clean = auditContractDrift({ diffFiles: ['package.json'], baseBranch: 'develop', repoRoot: repoDir });
    assert.equal(clean.passed, true);
    assert.equal(clean.filesChecked, 0);

    // Removing HTTP method and entire route in OpenAPI YAML
    fs.writeFileSync(
      path.join(repoDir, 'openapi.yaml'),
      'openapi: 3.0.0\npaths:\n  /users:\n    get:\n      summary: list\n  /metrics:\n    get:\n      summary: added\n',
      'utf8'
    );
    // Removing GraphQL interface in schema.graphql
    fs.writeFileSync(
      path.join(repoDir, 'schema.graphql'),
      'type User {\n  id: ID!\n  email: String\n}\ninput CreateUserInput {\n  name: String!\n}\n',
      'utf8'
    );

    const broken = auditContractDrift({ diffFiles: ['openapi.yaml', 'schema.graphql'], baseBranch: 'develop', repoRoot: repoDir });
    assert.equal(broken.passed, false);
    assert.equal(broken.hasDrift, true);
    assert.equal(broken.filesChecked, 2);
    assert.ok(broken.breakingChanges.some((c) => c.type === 'ENDPOINT_REMOVED' && c.details.includes('/health')));
    assert.ok(broken.breakingChanges.some((c) => c.type === 'METHOD_REMOVED' && c.details.includes('POST')));
    assert.ok(broken.breakingChanges.some((c) => c.type === 'GRAPHQL_TYPE_REMOVED' && c.details.includes('Node')));
  });

  it('prunes decision-graph on compaction, detects scripts/exports/devDependencies drift, and audits OpenAPI JSON', () => {
    // Seed decision-graph with unrelated event + create & approve an ADR before compacting
    const graphPath = path.join(repoDir, '.agent/decision-graph.jsonl');
    fs.mkdirSync(path.dirname(graphPath), { recursive: true });
    fs.writeFileSync(graphPath, `${JSON.stringify({ type: 'SESSION_STARTED', id: 'S-1' })}\n`, 'utf8');

    const created = createADR({ title: 'Compact Me', scope: 'product', ticketId: 99, supersedes: ['CAP-09'], repoRoot: repoDir });
    decideADR({ adrId: created.adr.id, action: 'approve', reviewer: '@arch', reason: 'good', repoRoot: repoDir });
    const compacted = compactADRs({ releaseVersion: '2.0.0', dryRun: false, repoRoot: repoDir });
    assert.equal(compacted.success, true);

    const remainingGraph = fs.readFileSync(graphPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(remainingGraph.some((e) => e.id === 'S-1'), true);
    assert.equal(remainingGraph.some((e) => e.type === 'ADR_CREATED'), false);
    assert.equal(remainingGraph.some((e) => e.type === 'ADR_BATCH_COMPACTED'), true);
    assert.equal(fs.existsSync(path.join(repoDir, 'docs/DECISION_MAP.md')), true);

    // Non-structural package.json description edit passes without ADR
    const pkg = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
    fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({ ...pkg, description: 'docs wording' }, null, 2) + '\n', 'utf8');
    assert.equal(checkSpecDrift({ diffFiles: ['package.json'], repoRoot: repoDir }).passed, true);

    // Structural scripts & exports changes fail closed without ADR
    fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({ ...pkg, scripts: { test: 'pytest' }, exports: './index.mjs' }, null, 2) + '\n', 'utf8');
    const structDrift = checkSpecDrift({ diffFiles: ['package.json'], repoRoot: repoDir });
    assert.equal(structDrift.passed, false);
    assert.equal(structDrift.hasUndeclaredDrift, true);

    // Compacted SRS ADR does NOT exempt new spec drift
    fs.writeFileSync(path.join(repoDir, 'docs/specs/cap-09.md'), '# New CAP-09\n', 'utf8');
    const postCompactDrift = checkSpecDrift({ diffFiles: ['docs/specs/cap-09.md'], repoRoot: repoDir });
    assert.equal(postCompactDrift.passed, false);

    // OpenAPI JSON endpoint & method removal detection
    const apiJson = { openapi: '3.0.0', paths: { '/v1/items': { get: {}, delete: {} }, '/v1/legacy': { post: {} } } };
    fs.writeFileSync(path.join(repoDir, 'openapi.json'), JSON.stringify(apiJson), 'utf8');
    execFileSync('git', ['add', 'openapi.json'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'add openapi.json'], { cwd: repoDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(repoDir, 'openapi.json'), JSON.stringify({ openapi: '3.0.0', paths: { '/v1/items': { get: {} } } }), 'utf8');
    const jsonDrift = auditContractDrift({ diffFiles: ['openapi.json'], baseBranch: 'develop', repoRoot: repoDir });
    assert.equal(jsonDrift.passed, false);
    assert.ok(jsonDrift.breakingChanges.some((c) => c.type === 'ENDPOINT_REMOVED' && c.details.includes('/v1/legacy')));
    assert.ok(jsonDrift.breakingChanges.some((c) => c.type === 'METHOD_REMOVED' && c.details.includes('DELETE')));
  });

  it('covers polyglot stack manifests, DB/arch/PRD/spec triggers, CAP amendment on accept, blocking ADR remediation, and valid compaction exempt', () => {
    // Accepting ADR with CAP-XX in PRODUCT.md annotates AMENDED (ADR-XXX) and updates existing ADR index row
    fs.writeFileSync(
      path.join(repoDir, 'PRODUCT.md'),
      '# Product\n\n| CAP ID | Title | Spec | Targets | Status |\n| :--- | :--- | :--- | :--- | :--- |\n| CAP-01 | Core | S1 | T1 | `implemented` |\n\n<!-- ADR_INDEX_START -->\n| ADR ID | Title | Scope | Status | Ticket | Supersedes |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n<!-- ADR_INDEX_END -->\n',
      'utf8'
    );
    const created = createADR({
      title: 'Amend Cap 01',
      scope: 'contract',
      ticketId: 144,
      supersedes: 'CAP-01',
      autoAccept: false,
      repoRoot: repoDir
    });
    assert.equal(created.adr.scope, 'product');
    assert.equal(created.adr.status, 'pending_approval');

    // Blocking pending ADR returns remediation command
    const blocked = checkSpecDrift({ diffFiles: ['pom.xml'], ticketId: 144, repoRoot: repoDir });
    assert.equal(blocked.passed, false);
    assert.ok(blocked.blockingADRs.includes(created.adr.id));
    assert.match(blocked.remediationCommand, new RegExp(`adr decide --id ${created.adr.id}`));
    assert.match(blocked.message, /UNAPPROVED_ADR_DRIFT/);

    // Approve updates row and stamps CAP-01
    decideADR({ adrId: created.adr.id, action: 'approve', reviewer: '@lead', reason: 'approved', repoRoot: repoDir });
    const prodRaw = fs.readFileSync(path.join(repoDir, 'PRODUCT.md'), 'utf8');
    assert.match(prodRaw, new RegExp(`AMENDED \\(${created.adr.id}\\)`));

    // Missing ADR id fails closed
    assert.throws(() => decideADR({ adrId: 'ADR-9999', action: 'approve', repoRoot: repoDir }));

    // Every polyglot trigger category detection
    const multi = checkSpecDrift({
      diffFiles: [
        'Cargo.toml',
        'pyproject.toml',
        'go.mod',
        'requirements.txt',
        'build.gradle',
        'build.gradle.kts',
        'openapi.yaml',
        'swagger.json',
        'schema.graphql',
        'schema.gql',
        'prisma/migrations/001.sql',
        'docs/architecture/c4.mmd',
        '.archlens/policy.json',
        'docs/PRD.md',
        'docs/specs/CAP-02.md'
      ],
      ticketId: 999,
      repoRoot: repoDir
    });
    const cats = new Set(multi.triggers.map((t) => t.category));
    for (const c of [
      'DEPENDENCY_MANIFEST_MUTATION',
      'API_CONTRACT_MUTATION',
      'DB_SCHEMA_MIGRATION',
      'C4_ARCHITECTURE_BOUNDARY_SHIFT',
      'PRD_SRS_CONTRACT_MUTATION',
      'PRODUCT_SPEC_MUTATION'
    ]) {
      assert.equal(cats.has(c), true, `Missing trigger category ${c}`);
    }

    // Legitimate compaction exemption on isolated clean repo (0 remaining ADRs + ADR_BATCH_COMPACTED)
    const cmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-unit-adr-cmp-'));
    try {
      execFileSync('git', ['init', '-b', 'develop'], { cwd: cmpDir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: cmpDir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: cmpDir, stdio: 'pipe' });
      fs.writeFileSync(path.join(cmpDir, 'PRODUCT.md'), '# Product\n', 'utf8');
      fs.mkdirSync(path.join(cmpDir, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(cmpDir, 'docs/SRS.md'), '# SRS\n', 'utf8');
      execFileSync('git', ['add', '.'], { cwd: cmpDir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: cmpDir, stdio: 'pipe' });

      fs.writeFileSync(path.join(cmpDir, 'docs/SRS.md'), '# SRS\n\n## Compacted Architectural Decisions\n', 'utf8');
      fs.writeFileSync(path.join(cmpDir, 'docs/AUDIT_CHAIN.jsonl'), `${JSON.stringify({ event: 'ADR_BATCH_COMPACTED' })}\n`, 'utf8');
      const cmpCheck = checkSpecDrift({ diffFiles: ['docs/SRS.md'], repoRoot: cmpDir });
      assert.equal(cmpCheck.passed, true);
      assert.deepEqual(cmpCheck.linkedADRs, ['ADR_BATCH_COMPACTED']);

      // Remove synthetic unhashed line before running hash-chained createADR/compactADRs
      fs.rmSync(path.join(cmpDir, 'docs/AUDIT_CHAIN.jsonl'), { force: true });

      // Empty compactADRs response when 0 ADRs exist
      const emptyCmp = compactADRs({ repoRoot: cmpDir });
      assert.equal(emptyCmp.success, true);
      assert.deepEqual(emptyCmp.compactedAdrIds, []);
      assert.equal(emptyCmp.message, 'No ADRs present in docs/adr/ to compact.');

      // ticketId: null -> N/A in PRODUCT.md, dryRun: true keeps files, pipe-escaped Decision summary written into fresh SRS
      fs.rmSync(path.join(cmpDir, 'docs/SRS.md'), { force: true });
      const pipeAdr = createADR({
        title: 'Use Graph | Queue',
        scope: 'technical',
        ticketId: null,
        supersedes: [],
        decision: 'Adopt Foo | Bar pattern',
        autoAccept: true,
        repoRoot: cmpDir
      });
      const prodAfter = fs.readFileSync(path.join(cmpDir, 'PRODUCT.md'), 'utf8');
      assert.match(prodAfter, /\| Use Graph \/ Queue \| `technical` \| `accepted` \| N\/A \| None \|/);

      const dryCmp = compactADRs({ releaseVersion: '3.1.0', dryRun: true, repoRoot: cmpDir });
      assert.equal(dryCmp.success, true);
      assert.equal(dryCmp.dryRun, true);
      assert.equal(listADRs(cmpDir).length, 1);

      const realCmp = compactADRs({ releaseVersion: '3.1.0', dryRun: false, repoRoot: cmpDir });
      assert.equal(realCmp.success, true);
      assert.equal(listADRs(cmpDir).length, 0);
      const srsRaw = fs.readFileSync(path.join(cmpDir, 'docs/SRS.md'), 'utf8');
      assert.match(srsRaw, /# Software Requirements Specification \(SRS\)/);
      assert.match(srsRaw, new RegExp(`\`${pipeAdr.adr.id}\`.*Use Graph \\/ Queue.*\`3\\.1\\.0\`.*Adopt Foo \\/ Bar pattern`));

      // Untracked/new package.json treated as structural mutation
      const newPkgDrift = checkSpecDrift({ diffFiles: ['package.json'], repoRoot: cmpDir });
      assert.equal(newPkgDrift.passed, false);
      assert.equal(newPkgDrift.triggers[0].category, 'DEPENDENCY_MANIFEST_MUTATION');
    } finally {
      fs.rmSync(cmpDir, { recursive: true, force: true });
    }
  });
});
