import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createTempGitRepo, git } from '../helpers/test-harness.mjs';
import {
  listADRs,
  createADR,
  decideADR,
  computeAlignmentHashes,
  checkSpecDrift,
  checkArchRings
} from '../../.agent/scripts/lib/drift.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

describe('Ring 1: lib/drift.mjs', () => {
  it('parses ADR_TEMPLATE.md frontmatter (ticket/ticketId, bracketed lists, CRLF) and drives createADR -> decideADR lifecycle', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    fs.writeFileSync(
      path.join(dir, 'PRODUCT.md'),
      '# Product\n\n<!-- ADR_INDEX_START -->\n| ADR ID | Title | Scope | Status | Ticket | Supersedes |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n<!-- ADR_INDEX_END -->\n',
      'utf8'
    );
    git(dir, 'add', 'PRODUCT.md');
    git(dir, 'commit', '-q', '-m', 'chore: add PRODUCT.md');

    git(dir, 'checkout', '-q', '-b', 'feat/adr-flow', 'develop');
    fs.writeFileSync(path.join(dir, 'PRODUCT.md'), fs.readFileSync(path.join(dir, 'PRODUCT.md'), 'utf8') + '\n## Vision\nUpdated.\n', 'utf8');

    // Drift fails before ADR exists
    const beforeAdr = checkSpecDrift({ ticketId: '77', repoRoot: dir });
    assert.equal(beforeAdr.passed, false);
    assert.ok(beforeAdr.triggers.some((t) => t.file === 'PRODUCT.md'));

    // Create ADR -> starts pending_approval -> blocks drift check
    const created = createADR({
      title: 'Update Vision Section',
      scope: 'product',
      ticket: '#77',
      supersedes: '[CAP-01, CAP-02]',
      context: 'Need clearer vision.',
      decision: 'Add Vision heading.',
      consequences: 'Clearer scope.',
      repoRoot: dir
    });
    assert.equal(created.success, true);
    assert.equal(created.id, 'ADR-001');

    const pendingCheck = checkSpecDrift({ ticketId: '77', repoRoot: dir });
    assert.equal(pendingCheck.passed, false);
    assert.deepEqual(pendingCheck.blockingADRs, ['ADR-001']);

    // Approve ADR -> drift check passes
    const approved = decideADR({
      adrId: 'ADR-001',
      status: 'approve',
      reviewer: '@architect',
      reason: 'Aligned with product scope',
      repoRoot: dir
    });
    assert.equal(approved.success, true);
    assert.equal(approved.adr.status, 'accepted');

    const passedCheck = checkSpecDrift({ ticketId: '77', repoRoot: dir });
    assert.equal(passedCheck.passed, true);
    assert.deepEqual(passedCheck.linkedADRs, ['ADR-001']);

    // Manual ADR authored from template with ticketId: and CRLF also parses cleanly
    fs.writeFileSync(
      path.join(dir, 'docs/adr/ADR-002-manual.md'),
      '---\r\nid: ADR-002\r\ntitle: "Manual ADR"\r\nscope: technical\r\nstatus: accepted\r\nticketId: 88\r\nsupersedes: [CAP-03]\r\n---\r\n# ADR-002\r\n',
      'utf8'
    );
    const adrs = listADRs(dir);
    const adr2 = adrs.find((a) => a.id === 'ADR-002');
    assert.equal(adr2?.ticket, '88');
    assert.deepEqual(adr2?.supersedes, ['CAP-03']);
  });

  it('catches 2-commit new package.json dependency drift, develop->main drift, and exempts non-structural package.json edits', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    git(dir, 'checkout', '-q', '-b', 'feat/two-commits', 'develop');
    // Commit 1 adds brand-new package.json with dependencies
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'app', version: '0.1.0', dependencies: { zod: '^3.23.0' } }, null, 2),
      'utf8'
    );
    git(dir, 'add', 'package.json');
    git(dir, 'commit', '-q', '-m', 'feat: add package.json with zod');

    // Commit 2 edits README.md (previously HEAD~1 fallback hid package.json!)
    fs.writeFileSync(path.join(dir, 'README.md'), '# Updated\n', 'utf8');
    git(dir, 'add', 'README.md');
    git(dir, 'commit', '-q', '-m', 'docs: update readme');

    const drift2Commit = checkSpecDrift({ ticketId: '50', repoRoot: dir });
    assert.equal(drift2Commit.passed, false);
    assert.ok(drift2Commit.triggers.some((t) => t.file === 'package.json'));

    // Non-structural package.json change (version/scripts/files) does NOT trigger drift
    const repo2 = createTempGitRepo();
    cleanups.push(repo2.cleanup);
    fs.writeFileSync(path.join(repo2.dir, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.1', dependencies: {} }), 'utf8');
    git(repo2.dir, 'add', 'package.json');
    git(repo2.dir, 'commit', '-q', '-m', 'chore: base pkg');
    git(repo2.dir, 'branch', '-f', 'main', 'HEAD');
    git(repo2.dir, 'checkout', '-q', '-b', 'feat/bump', 'develop');
    fs.writeFileSync(
      path.join(repo2.dir, 'package.json'),
      JSON.stringify({ name: 'x', version: '0.1.0', scripts: { test: 'node --test' }, dependencies: {} }),
      'utf8'
    );
    assert.equal(checkSpecDrift({ repoRoot: repo2.dir }).passed, true);

    // develop -> main PR (GITHUB_BASE_REF=main) catches drift on develop vs main
    git(repo2.dir, 'checkout', '-q', 'develop');
    fs.mkdirSync(path.join(repo2.dir, 'docs/specs'), { recursive: true });
    fs.writeFileSync(path.join(repo2.dir, 'docs/specs/cap-01.md'), '# Spec 1\n', 'utf8');
    git(repo2.dir, 'add', 'docs/specs/cap-01.md');
    git(repo2.dir, 'commit', '-q', '-m', 'feat: unapproved spec on develop');

    const prevBaseRef = process.env.GITHUB_BASE_REF;
    process.env.GITHUB_BASE_REF = 'main';
    try {
      const devToMain = checkSpecDrift({ repoRoot: repo2.dir });
      assert.equal(devToMain.passed, false);
      assert.ok(devToMain.triggers.some((t) => t.file === 'docs/specs/cap-01.md'));
    } finally {
      if (prevBaseRef === undefined) delete process.env.GITHUB_BASE_REF;
      else process.env.GITHUB_BASE_REF = prevBaseRef;
    }
  });

  it('fails closed on malformed OpenAPI JSON/YAML contracts and computes deterministic alignment hashes', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    git(dir, 'checkout', '-q', '-b', 'feat/contract', 'develop');
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs/openapi.json'), '{ invalid json', 'utf8');

    // Even with an accepted ADR, malformed OpenAPI JSON fails closed!
    const adr = createADR({ title: 'API Contract', scope: 'contract', ticket: '91', repoRoot: dir });
    decideADR({ adrId: adr.id, status: 'approve', reviewer: '@rev', reason: 'ok', repoRoot: dir });

    const badJsonDrift = checkSpecDrift({ ticketId: '91', repoRoot: dir });
    assert.equal(badJsonDrift.passed, false);
    assert.ok(badJsonDrift.triggers.some((t) => t.type === 'CONTRACT_PARSE_ERROR'));

    fs.writeFileSync(path.join(dir, 'docs/openapi.json'), JSON.stringify({ openapi: '3.1.0', info: { title: 'API', version: '1.0.0' }, paths: {} }), 'utf8');
    assert.equal(checkSpecDrift({ ticketId: '91', repoRoot: dir }).passed, true);

    const h1 = computeAlignmentHashes(dir);
    fs.writeFileSync(path.join(dir, 'PRODUCT.md'), '# Constitution v1\n', 'utf8');
    const h2 = computeAlignmentHashes(dir);
    assert.notEqual(h1.specHash, h2.specHash);
  });

  it('checkArchRings enforces concentric rings across .mjs and extensionless .ts/.tsx imports and detects cycles', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    fs.mkdirSync(path.join(dir, '.archlens'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src/core'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src/adapters'), { recursive: true });

    fs.writeFileSync(
      path.join(dir, '.archlens/policy.json'),
      JSON.stringify({
        title: 'demo',
        src: 'src',
        order: ['core', 'adapters'],
        levels: [['src/core/entity.ts', 'src/core/helper.ts'], ['src/adapters/http.ts']],
        omit: ['node_modules']
      }),
      'utf8'
    );

    // Valid inward dependency: adapters -> core (extensionless TS import)
    fs.writeFileSync(path.join(dir, 'src/core/helper.ts'), 'export const h = 1;\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'src/core/entity.ts'), "import { h } from './helper';\nexport const e = h;\n", 'utf8');
    fs.writeFileSync(path.join(dir, 'src/adapters/http.ts'), "import { e } from '../core/entity';\nexport const server = e;\n", 'utf8');

    const cleanRes = checkArchRings({ repoRoot: dir });
    assert.equal(cleanRes.passed, true);
    assert.deepEqual(cleanRes.violations, []);

    // Upward ring violation: core -> adapters (extensionless TS import)
    fs.writeFileSync(
      path.join(dir, 'src/core/entity.ts'),
      "import { server } from '../adapters/http';\nexport const e = server;\n",
      'utf8'
    );
    const upwardRes = checkArchRings({ repoRoot: dir });
    assert.equal(upwardRes.passed, false);
    assert.ok(upwardRes.violations.some((v) => v.type === 'LAYER_VIOLATION'));

    // Intra-ring cycle violation: entity <-> helper
    fs.writeFileSync(path.join(dir, 'src/core/entity.ts'), "import { h } from './helper';\nexport const e = h;\n", 'utf8');
    fs.writeFileSync(path.join(dir, 'src/core/helper.ts'), "import { e } from './entity';\nexport const h = e;\n", 'utf8');
    const cycleRes = checkArchRings({ repoRoot: dir });
    assert.equal(cycleRes.passed, false);
    assert.ok(cycleRes.violations.some((v) => v.type === 'CYCLE_VIOLATION'));
  });
});
