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

    // Valid YAML OpenAPI contract passes; invalid scope/id/status on createADR/decideADR handled cleanly
    fs.writeFileSync(path.join(dir, 'docs/openapi.yaml'), 'openapi: "3.1.0"\ninfo:\n  title: "Demo"\n  version: "1.0"\npaths: {}\n', 'utf8');
    assert.equal(checkSpecDrift({ ticketId: '91', repoRoot: dir }).passed, true);
    assert.throws(() => createADR({ title: '', repoRoot: dir }));
    assert.throws(() => createADR({ title: 'Bad Scope', scope: 'invalid', repoRoot: dir }));
    assert.equal(decideADR({ adrId: '', status: 'approve', repoRoot: dir }).success, false);
    assert.equal(decideADR({ adrId: 'ADR-999', status: 'approve', repoRoot: dir }).success, false);
    assert.equal(decideADR({ adrId: adr.id, status: 'banana', repoRoot: dir }).success, false);
    assert.equal(decideADR({ adrId: adr.id, status: 'supersede', repoRoot: dir }).adr.status, 'superseded');
    assert.equal(decideADR({ adrId: adr.id, status: 'approve', repoRoot: dir }).adr.status, 'accepted');

    // Cross-nested YAML brackets or missing OpenAPI info/paths fails closed
    fs.writeFileSync(path.join(dir, 'docs/openapi.yaml'), 'openapi: "3.1.0"\ninfo: { title: [bad }\npaths: {}\n', 'utf8');
    assert.equal(checkSpecDrift({ ticketId: '91', repoRoot: dir }).passed, false);
    fs.unlinkSync(path.join(dir, 'docs/openapi.yaml'));

    // Newborn 1-commit repo catches dependency drift on root commit
    const nb = createTempGitRepo({ withDevelop: false, initialBranch: 'feat/genesis' });
    cleanups.push(nb.cleanup);
    fs.writeFileSync(path.join(nb.dir, 'package.json'), JSON.stringify({ name: 'nb', dependencies: { express: '^5.0.0' } }), 'utf8');
    git(nb.dir, 'add', 'package.json');
    git(nb.dir, 'commit', '--amend', '-q', '--no-edit');
    assert.equal(checkSpecDrift({ repoRoot: nb.dir }).passed, false);

    const h1 = computeAlignmentHashes(dir);
    fs.writeFileSync(path.join(dir, 'PRODUCT.md'), '# Constitution v1\n', 'utf8');
    const h2 = computeAlignmentHashes(dir);
    assert.notEqual(h1.specHash, h2.specHash);

    // Deleting an accepted ADR or docs/AUDIT_CHAIN.jsonl triggers SPEC_DELETED drift
    const delRepo = createTempGitRepo();
    cleanups.push(delRepo.cleanup);
    const createdDelAdr = createADR({ title: 'Baseline Decision', scope: 'technical', ticket: '12', repoRoot: delRepo.dir });
    decideADR({ adrId: createdDelAdr.id, status: 'approve', reviewer: '@arch', reason: 'ok', repoRoot: delRepo.dir });
    git(delRepo.dir, 'add', createdDelAdr.file, 'docs/AUDIT_CHAIN.jsonl');
    git(delRepo.dir, 'commit', '-q', '-m', 'chore: baseline ADR and audit ledger');
    git(delRepo.dir, 'checkout', '-q', '-b', 'feat/delete-adr', 'develop');
    git(delRepo.dir, 'rm', '-q', createdDelAdr.file, 'docs/AUDIT_CHAIN.jsonl');
    const delDrift = checkSpecDrift({ repoRoot: delRepo.dir });
    assert.equal(delDrift.passed, false);
    assert.ok(delDrift.triggers.some((t) => t.file === createdDelAdr.file && t.type === 'SPEC_DELETED'));
    assert.ok(delDrift.triggers.some((t) => t.file === 'docs/AUDIT_CHAIN.jsonl' && t.type === 'SPEC_DELETED'));
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

    // String literal containing '/*' does NOT hide subsequent upward import before a block comment!
    fs.writeFileSync(path.join(dir, 'src/core/helper.ts'), 'export const h = 1;\n', 'utf8');
    fs.writeFileSync(
      path.join(dir, 'src/core/entity.ts'),
      "export const glob = 'packages/*';\nimport { server } from '../adapters/http';\n/* trailing comment */\nexport const e = server;\n",
      'utf8'
    );
    const commentStringRes = checkArchRings({ repoRoot: dir });
    assert.equal(commentStringRes.passed, false);
    assert.ok(commentStringRes.violations.some((v) => v.type === 'LAYER_VIOLATION'));

    // Comments containing fake imports are stripped; dynamic import()/require(), unmapped modules, glob patterns, and invalid policy JSON are enforced
    fs.writeFileSync(
      path.join(dir, 'src/core/entity.ts'),
      "// import '../adapters/http';\n/* import '../adapters/http'; */\nexport const s = \"escaped \\\" /* still string\";\nexport const h = 1;\n",
      'utf8'
    );
    assert.equal(checkArchRings({ repoRoot: dir }).passed, true);

    fs.writeFileSync(path.join(dir, 'src/core/entity.ts'), "export const dyn = () => import('../adapters/http');\n", 'utf8');
    assert.equal(checkArchRings({ repoRoot: dir }).passed, false);

    fs.writeFileSync(path.join(dir, 'src/core/unmapped.ts'), 'export const u = 1;\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'src/core/entity.ts'), 'export const e = 1;\n', 'utf8');
    assert.ok(checkArchRings({ repoRoot: dir }).violations.some((v) => v.type === 'UNMAPPED_MODULE'));
    fs.unlinkSync(path.join(dir, 'src/core/unmapped.ts'));

    // Glob level pattern matching + invalid JSON policy + missing policy file
    fs.writeFileSync(
      path.join(dir, '.archlens/policy.json'),
      JSON.stringify({ title: 'glob', src: 'src', order: ['core', 'adapters'], levels: [['src/core/**'], ['src/adapters/**']] }),
      'utf8'
    );
    assert.equal(checkArchRings({ repoRoot: dir }).passed, true);
    fs.writeFileSync(path.join(dir, '.archlens/policy.json'), '{bad-policy', 'utf8');
    assert.equal(checkArchRings({ repoRoot: dir }).passed, false);
    fs.unlinkSync(path.join(dir, '.archlens/policy.json'));
    assert.equal(checkArchRings({ repoRoot: dir }).passed, true);

    // OpenAPI JSON/YAML validation branches: missing version, missing info/paths, tab indentation, comments with brackets, escaped quotes, unbalanced quotes
    git(dir, 'checkout', '-q', '-b', 'feat/oas-edges', 'develop');
    fs.mkdirSync(path.join(dir, 'api'), { recursive: true });
    for (const [name, body, expectPass] of [
      ['openapi-no-ver.json', JSON.stringify({ info: {}, paths: {} }), false],
      ['openapi-no-paths.json', JSON.stringify({ openapi: '3.0.0', info: {} }), false],
      ['openapi-no-ver.yaml', 'info:\n  title: x\npaths: {}\n', false],
      ['openapi-no-info.yaml', 'openapi: 3.0.0\npaths: {}\n', false],
      ['openapi-tabs.yaml', 'openapi: 3.0.0\ninfo:\n\ttitle: tab\npaths: {}\n', false],
      ['openapi-unbalanced.yaml', 'openapi: 3.0.0\ninfo:\n  title: "unclosed\npaths: {}\n', false],
      ['openapi-comments.yaml', 'openapi: 3.0.0\n# comment with [unmatched {\ninfo: { title: "a\\"b", desc: \'c#d\' }\nwebhooks: {}\n', true]
    ]) {
      const p = path.join(dir, 'api', name);
      fs.writeFileSync(p, body, 'utf8');
      if (expectPass) {
        const a = createADR({ title: `Contract ${name}`, scope: 'contract', ticket: '99', repoRoot: dir });
        decideADR({ adrId: a.id, status: 'approve', reviewer: '@r', reason: 'ok', repoRoot: dir });
      }
      assert.equal(checkSpecDrift({ ticketId: '99', repoRoot: dir }).passed, expectPass, `Failed expectation for ${name}`);
      fs.unlinkSync(p);
    }
  });

  it('checkSpecDrift flags git-mv of governance files as SPEC_DELETED (spec, PRODUCT.md, ring policy, ledger)', () => {
    for (const [from, to, content] of [
      ['docs/specs/cap-01.md', 'docs/archive/cap-01.md', '# Cap 1\n'],
      ['PRODUCT.md', 'docs/PRODUCT-v1.md', '# Product\n'],
      ['.archlens/policy.json', '.archlens/policy.old.json', '{"title":"t","order":["core"],"levels":[["src/**"]]}'],
      ['docs/AUDIT_CHAIN.jsonl', 'docs/AUDIT_CHAIN.old.jsonl', '{"index":0}\n']
    ]) {
      const { dir, cleanup } = createTempGitRepo();
      cleanups.push(cleanup);

      fs.mkdirSync(path.dirname(path.join(dir, from)), { recursive: true });
      fs.mkdirSync(path.dirname(path.join(dir, to)), { recursive: true });
      fs.writeFileSync(path.join(dir, from), content, 'utf8');
      git(dir, 'add', from);
      git(dir, 'commit', '-q', '-m', `chore: add ${from}`);

      git(dir, 'checkout', '-q', '-b', 'feat/rename-gov', 'develop');
      git(dir, 'mv', from, to);
      git(dir, 'commit', '-q', '-m', `refactor: rename ${from}`);

      const d = checkSpecDrift({ baseBranch: 'develop', repoRoot: dir });
      assert.equal(d.passed, false, `Expected failure for rename of ${from}`);
      assert.ok(
        d.triggers.some((t) => t.file === from && t.type === 'SPEC_DELETED'),
        `Expected SPEC_DELETED trigger for ${from}, got ${JSON.stringify(d.triggers)}`
      );
      if (from === 'docs/AUDIT_CHAIN.jsonl') {
        assert.match(d.message, /cannot be deleted/);
      }
    }
  });

  it('an edit to an ADR accepted at merge base does not govern drift and raises ADR_MUTATION', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    fs.mkdirSync(path.join(dir, 'docs/adr'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'docs/adr/ADR-001-base.md'),
      '---\nid: ADR-001\ntitle: Base\nstatus: accepted\nscope: technical\nticket: "1"\n---\n\n# ADR-001\n',
      'utf8'
    );
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', dependencies: {} }, null, 2) + '\n', 'utf8');
    git(dir, 'add', 'docs/adr/ADR-001-base.md', 'package.json');
    git(dir, 'commit', '-q', '-m', 'chore: base accepted ADR and pkg');

    git(dir, 'checkout', '-q', '-b', 'feat/edit-accepted-adr', 'develop');
    fs.appendFileSync(path.join(dir, 'docs/adr/ADR-001-base.md'), 'typo fix\n', 'utf8');
    git(dir, 'commit', '-qam', 'docs: typo in accepted ADR');

    const adrOnly = checkSpecDrift({ baseBranch: 'develop', repoRoot: dir });
    assert.equal(adrOnly.passed, false);
    assert.deepEqual(adrOnly.triggers.map((t) => t.type), ['ADR_MUTATION']);
    assert.deepEqual(adrOnly.linkedADRs, []);

    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', dependencies: { lodash: '^4' } }, null, 2) + '\n', 'utf8');
    git(dir, 'commit', '-qam', 'feat: add lodash');

    const withDep = checkSpecDrift({ baseBranch: 'develop', repoRoot: dir });
    assert.equal(withDep.passed, false);
    assert.deepEqual(withDep.triggers.map((t) => t.type).sort(), ['ADR_MUTATION', 'DEPENDENCY_DRIFT']);
    assert.deepEqual(withDep.linkedADRs, []);

    // Renaming (or case-renaming) an accepted-at-base ADR still triggers ADR_MUTATION + SPEC_DELETED and never governs drift
    git(dir, 'mv', 'docs/adr/ADR-001-base.md', 'docs/adr/ADR-001-renamed.md');
    git(dir, 'commit', '-qm', 'refactor: rename base ADR alongside dep change');
    const afterRename = checkSpecDrift({ baseBranch: 'develop', repoRoot: dir });
    assert.equal(afterRename.passed, false);
    assert.deepEqual(afterRename.linkedADRs, []);
    assert.ok(afterRename.triggers.some((t) => t.type === 'ADR_MUTATION'));
    assert.ok(afterRename.triggers.some((t) => t.type === 'SPEC_DELETED' && t.file === 'docs/adr/ADR-001-base.md'));

    // Case-only rename of AUDIT_CHAIN.jsonl on case-insensitive FS still raises contract error
    fs.writeFileSync(path.join(dir, 'docs/AUDIT_CHAIN.jsonl'), '{"index":0}\n', 'utf8');
    git(dir, 'add', 'docs/AUDIT_CHAIN.jsonl');
    git(dir, 'commit', '--amend', '--no-edit', '-q');
    git(dir, 'checkout', '-q', 'develop');
    fs.writeFileSync(path.join(dir, 'docs/AUDIT_CHAIN.jsonl'), '{"index":0}\n', 'utf8');
    git(dir, 'add', 'docs/AUDIT_CHAIN.jsonl');
    git(dir, 'commit', '-qm', 'chore: add base ledger');
    git(dir, 'checkout', '-q', '-b', 'feat/case-ledger', 'develop');
    git(dir, 'mv', 'docs/AUDIT_CHAIN.jsonl', 'docs/audit_chain.jsonl');
    git(dir, 'commit', '-qm', 'refactor: lowercase ledger');
    const caseLedgerDrift = checkSpecDrift({ baseBranch: 'develop', repoRoot: dir });
    assert.equal(caseLedgerDrift.passed, false);
    assert.match(caseLedgerDrift.message, /cannot be deleted/);
  });

  it('editing a superseded-at-base ADR back to accepted cannot govern new drift', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    fs.mkdirSync(path.join(dir, 'docs/adr'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'docs/adr/ADR-001-old.md'),
      '---\nid: ADR-001\ntitle: Old\nstatus: superseded\nscope: technical\nticket: "1"\n---\n\n# ADR-001\n',
      'utf8'
    );
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', dependencies: {} }, null, 2) + '\n', 'utf8');
    git(dir, 'add', 'docs/adr/ADR-001-old.md', 'package.json');
    git(dir, 'commit', '-q', '-m', 'chore: base superseded ADR');

    git(dir, 'checkout', '-q', '-b', 'feat/resurrect-adr', 'develop');
    fs.writeFileSync(
      path.join(dir, 'docs/adr/ADR-001-old.md'),
      '---\nid: ADR-001\ntitle: Old\nstatus: accepted\nscope: technical\nticket: "1"\n---\n\n# ADR-001\n',
      'utf8'
    );
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', dependencies: { lodash: '^4' } }, null, 2) + '\n', 'utf8');
    git(dir, 'commit', '-qam', 'chore: flip superseded ADR to accepted');

    const d = checkSpecDrift({ baseBranch: 'develop', repoRoot: dir });
    assert.equal(d.passed, false);
    assert.deepEqual(d.linkedADRs, []);
    assert.ok(d.triggers.some((t) => t.type === 'ADR_MUTATION'));
  });

  it('createADR rejects frontmatter injection and duplicate frontmatter keys never upgrade an ADR to accepted', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);
    fs.writeFileSync(path.join(dir, 'PRODUCT.md'), '# Product\n\n<!-- ADR_INDEX_START -->\n<!-- ADR_INDEX_END -->\n', 'utf8');

    assert.throws(() => createADR({ title: 'Inject', ticket: 'L-3\nstatus: accepted\ndecidedBy: @human', repoRoot: dir }), /Invalid ADR ticket/);
    assert.throws(() => createADR({ title: 'Inject', ticket: 'L-3', supersedes: 'ADR-1\nstatus: accepted', repoRoot: dir }), /Invalid ADR supersedes/);
    assert.equal(listADRs(dir).length, 0, 'rejected input must not write an ADR');

    // Title newlines are JSON-escaped, so they can never introduce a status line
    const created = createADR({ title: 'Title\nstatus: accepted', ticket: 'L-3', supersedes: '[ADR-001, CAP-02]', repoRoot: dir });
    assert.equal(created.success, true);
    assert.equal(listADRs(dir).find((a) => a.id === created.id).status, 'pending_approval');

    // Hand-edited duplicate keys: the first occurrence wins (matches decideADR, which rewrites the first status line)
    fs.writeFileSync(
      path.join(dir, 'docs/adr/ADR-099-dup.md'),
      '---\nid: ADR-099\ntitle: Dup\nstatus: pending_approval\nticket: "1"\nstatus: accepted\n---\n\n# ADR-099\n',
      'utf8'
    );
    assert.equal(listADRs(dir).find((a) => a.id === 'ADR-099').status, 'pending_approval');
  });

  it('a new accepted ADR still governs drift, including superseding an older accepted ADR', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    fs.mkdirSync(path.join(dir, 'docs/adr'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'docs/adr/ADR-001-old.md'),
      '---\nid: ADR-001\ntitle: Old\nstatus: accepted\nscope: technical\nticket: "1"\n---\n\n# ADR-001\n',
      'utf8'
    );
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', dependencies: {} }, null, 2) + '\n', 'utf8');
    git(dir, 'add', 'docs/adr/ADR-001-old.md', 'package.json');
    git(dir, 'commit', '-q', '-m', 'chore: base');

    git(dir, 'checkout', '-q', '-b', 'feat/supersede', 'develop');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', dependencies: { lodash: '^4' } }, null, 2) + '\n', 'utf8');

    const created = createADR({ title: 'New Choice', scope: 'technical', ticket: '2', supersedes: 'ADR-001', repoRoot: dir });
    assert.equal(created.success, true);
    assert.equal(decideADR({ adrId: created.id, status: 'approve', reviewer: '@r', reason: 'ok', repoRoot: dir }).success, true);
    assert.equal(decideADR({ adrId: 'ADR-001', status: 'supersede', reviewer: '@r', reason: 'replaced', repoRoot: dir }).success, true);

    const d = checkSpecDrift({ baseBranch: 'develop', repoRoot: dir });
    assert.equal(d.passed, true);
    assert.deepEqual(d.linkedADRs, [created.id]);
    assert.ok(d.triggers.some((t) => t.type === 'ADR_MUTATION' && t.file.includes('ADR-001')));
  });
});
