/**
 * Hardening regression suite — governance, L-128000 ring isolation & audit hardening.
 * Hermetic: every test works in an OS temp dir; nothing touches the network
 * or tracked files in this repository.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

import {
  coreMod,
  gitGuardMod,
  qualityGateMod,
  pmMod,
  auditChainMod,
  workbenchMod,
  productDagMod,
  issueGateReceipt,
  verifyGateReceipt,
  calculateRecordHash,
  createWorkbenchServer,
  createADR,
  decideADR,
  executeCompositeStage,
  executeRelease,
  startSession,
  runCLI,
  formatCLIResult,
  generateReviewPlan,
  verifyCommitGuard,
  installCIWorkflow,
  checkSpecDrift,
  verifyAuditChain,
  REPO_ROOT,
  git,
  engine,
  makeRepo,
  writeSession,
  dispatchReq
} from './helpers/hardening-harness.mjs';
// ===========================================================================
// Governance Hardening: release, stage begin, ADR approval, diff review plans & Node 24 CI actions
// ===========================================================================
describe('Governance Hardening: release, stage begin, ADR approval, diff review plans & Node 24 CI actions', () => {
  let dir;
  beforeEach(() => {
    dir = makeRepo();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('executeRelease refuses main/develop without mutating files, runs gate --strict, and fails closed when commit or tag fails', () => {
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n### Added\n- Feature\n', 'utf8');
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'tmp', version: '0.0.1', type: 'module', scripts: { test: 'node -e 0' } }, null, 2) + '\n',
      'utf8'
    );
    git(dir, 'add', 'CHANGELOG.md', 'package.json');
    assert.equal(git(dir, 'commit', '-q', '-m', 'chore: add changelog').status, 0);

    // 1. Refuse directly on main (before modifying package.json or CHANGELOG.md)
    assert.throws(
      () => executeRelease({ bump: 'patch', repoRoot: dir }),
      /Refusing to execute release.*main/i
    );
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version, '0.0.1');
    assert.equal(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8').includes('## [0.0.2]'), false);

    // 2. Refuse directly on develop
    assert.equal(git(dir, 'checkout', '-q', '-b', 'develop').status, 0);
    assert.throws(
      () => executeRelease({ bump: 'patch', repoRoot: dir }),
      /Refusing to execute release.*develop/i
    );

    // 3. Switch to release branch: verify executeRelease runs gate --strict (catches hardcoded secret that plain `gate` skips)
    assert.equal(git(dir, 'checkout', '-q', '-b', 'chore/release-v0.0.2').status, 0);
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({
        version: '2.1.0',
        modules: [
          {
            name: 'root',
            path: '.',
            commands: {
              test: 'node -e 0',
              coverage: `node -e "const fs=require('fs');fs.mkdirSync('coverage',{recursive:true});fs.writeFileSync('coverage/coverage-summary.json',JSON.stringify({total:{lines:{pct:95},branches:{pct:90}}}))"`,
              coverageFile: 'coverage/coverage-summary.json'
            },
            thresholds: { diffCoverage: 85, mutationScore: null }
          }
        ]
      }),
      'utf8'
    );
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    // Split token literal across runtime concatenation so our own repo's security scanner doesn't flag tests/hardening-governance.test.mjs
    const fakeSecret = ['ghp', '_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'].join('');
    fs.writeFileSync(path.join(dir, 'src/leak.mjs'), `export const tok = "${fakeSecret}";\n`, 'utf8');
    fs.rmSync(path.join(dir, 'README.md'), { force: true });
    git(dir, 'add', '-A');
    assert.equal(git(dir, 'commit', '-q', '-m', 'test: add leak for strict gate check').status, 0);

    assert.throws(
      () => executeRelease({ bump: 'patch', repoRoot: dir }),
      /Security Audit failed|Strict quality gate failed|Quality gate failed/i,
      'executeRelease must invoke gate --strict rather than non-strict gate'
    );

    // Clean up secret and test fail-closed when git commit fails (pre-commit hook exits 1) and when git tag already exists
    fs.rmSync(path.join(dir, 'src/leak.mjs'), { force: true });
    git(dir, 'add', '-A');
    assert.equal(git(dir, 'commit', '-q', '-m', 'chore: remove leak').status, 0);

    const hookPath = path.join(dir, '.git/hooks/pre-commit');
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.writeFileSync(hookPath, '#!/bin/sh\necho "hook blocked commit" >&2\nexit 1\n', { mode: 0o755 });
    assert.throws(
      () => executeRelease({ bump: 'patch', repoRoot: dir }),
      /Release git commit\/tag failed/i,
      'executeRelease must fail closed when git commit fails instead of swallowing errors'
    );
    fs.rmSync(hookPath, { force: true });
    assert.equal(git(dir, 'reset', '--hard', 'HEAD').status, 0);

    assert.equal(git(dir, 'tag', '-a', 'v0.0.2', '-m', 'pre-existing tag').status, 0);
    assert.throws(
      () => executeRelease({ bump: 'patch', repoRoot: dir }),
      /tag.*v0\.0\.2|already exists|Release git/i,
      'executeRelease must fail closed when git tag already exists instead of swallowing errors'
    );

    // Delete conflicting tag, add package-lock.json + .claude-plugin/plugin.json, and verify clean release commit + tag
    assert.equal(git(dir, 'tag', '-d', 'v0.0.2').status, 0);
    fs.writeFileSync(
      path.join(dir, 'package-lock.json'),
      JSON.stringify({ name: 'tmp', version: '0.0.1', packages: { '': { version: '0.0.1' } } }, null, 2) + '\n',
      'utf8'
    );
    fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'sdlc', version: '0.0.1' }, null, 2) + '\n', 'utf8');
    git(dir, 'add', 'package-lock.json', '.claude-plugin/plugin.json');
    assert.equal(git(dir, 'commit', '-q', '-m', 'chore: add lock and plugin').status, 0);

    const okRel = executeRelease({ bump: 'patch', repoRoot: dir });
    assert.equal(okRel.success, true);
    assert.equal(okRel.newVersion, '0.0.2');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8')).version, '0.0.2');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin/plugin.json'), 'utf8')).version, '0.0.2');
    assert.equal(git(dir, 'tag', '-l', 'v0.0.2').stdout.trim(), 'v0.0.2');
  });

  it('stage begin refuses to auto-create remote issues without --create-issue and supports --local in full/standard lanes', () => {
    // 1. Omitting --issue, --local, --lane trivial, and --create-issue MUST fail closed without creating KANBAN/remote tickets
    assert.throws(
      () => executeCompositeStage({ action: 'begin', title: 'Unconfirmed Issue', repoRoot: dir }),
      /--issue|--local|--create-issue/i
    );
    const cliRefused = engine(dir, 'stage', 'begin', '--title', 'Unconfirmed CLI Issue');
    assert.notEqual(cliRefused.status, 0, 'CLI stage begin without --issue/--local/--create-issue must exit non-zero');
    assert.equal(fs.existsSync(path.join(dir, 'docs/KANBAN.md')), false, 'must not create a ticket in docs/KANBAN.md');

    // 2. Passing --local starts a full-lane session with a local L-* ID and checks out branch without creating a PM ticket
    const localBegin = runCLI(
      ['stage', 'begin', '--local', '--title', 'Local Full Session', '--type', 'fix', '--checkout'],
      null,
      dir
    );
    assert.equal(localBegin.success, true);
    assert.match(String(localBegin.stage.issueId), /^L-\d+$/);
    assert.equal(localBegin.stage.lane, 'full');
    assert.match(localBegin.stage.branch, /^feature\/L-\d+-local-full-session$/);
    assert.equal(fs.existsSync(path.join(dir, 'docs/KANBAN.md')), false, '--local must not create remote/KANBAN tickets');

    // 3. Passing --create-issue explicitly opts into ticket creation (hermetically pinned to local PM provider)
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({ projectManagement: { provider: 'local', livingBoard: 'docs/KANBAN.md' } }, null, 2),
      'utf8'
    );
    const explicitCreate = runCLI(
      ['stage', 'begin', '--create-issue', '--title', 'Confirmed Ticket', '--type', 'feat'],
      null,
      dir
    );
    assert.equal(explicitCreate.success, true);
    assert.equal(fs.existsSync(path.join(dir, 'docs/KANBAN.md')), true);
  });

  it('createADR defaults technical and architectural scopes to pending_approval until explicitly approved via decideADR, and prior accepted or compacted ADRs do not bypass pending or stateless CI checks', () => {
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'PRODUCT.md'), '# Constitution\n\n<!-- ADR_INDEX_START -->\n<!-- ADR_INDEX_END -->\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'docs/SRS.md'), '# SRS\n\n## Compacted Architectural Decisions\n| `ADR-000` | Prior | `technical` | #0 | CAP-01 | `v0.0.1` | Prior |\n', 'utf8');
    const compactSeed = { index: 0, timestamp: '2026-01-01T00:00:00.000Z', event: 'ADR_BATCH_COMPACTED', metadata: { count: 1 }, previousHash: '0'.repeat(64) };
    fs.writeFileSync(path.join(dir, 'docs/AUDIT_CHAIN.jsonl'), JSON.stringify({ ...compactSeed, currentHash: calculateRecordHash(compactSeed) }) + '\n', 'utf8');
    git(dir, 'add', '.');
    assert.equal(git(dir, 'commit', '-q', '-m', 'chore: seed historical compacted SRS and audit chain').status, 0);

    // Even with 0 files in docs/adr/ and historical ADR_BATCH_COMPACTED on main, mutating PRODUCT.md without an ADR MUST fail
    fs.writeFileSync(path.join(dir, 'PRODUCT.md'), '# Constitution\n- **INV-00**: Mutated\n\n<!-- ADR_INDEX_START -->\n<!-- ADR_INDEX_END -->\n', 'utf8');
    assert.equal(
      checkSpecDrift({ diffFiles: ['PRODUCT.md'], ticketId: null, repoRoot: dir }).passed,
      false,
      'historical ADR_BATCH_COMPACTED on main must not satisfy undeclared PRODUCT.md drift'
    );

    // Seed a pre-existing accepted ADR-001 on main so we also verify historical uncompacted ADRs never mask new drift
    const priorAdr = createADR({
      title: 'Baseline Historical Decision',
      scope: 'technical',
      ticketId: 1,
      supersedes: ['CAP-01'],
      repoRoot: dir
    });
    decideADR({
      adrId: priorAdr.adr.id,
      action: 'approve',
      reviewer: '@fady',
      reason: 'Baseline accepted on main',
      repoRoot: dir
    });
    git(dir, 'add', '.');
    assert.equal(git(dir, 'commit', '-q', '-m', 'chore: add baseline ADR-001').status, 0);

    assert.equal(git(dir, 'checkout', '-q', '-b', 'feature/L-900100-adr-gate').status, 0);
    fs.writeFileSync(path.join(dir, 'PRODUCT.md'), '# Constitution\n- **INV-01**: Updated\n\n<!-- ADR_INDEX_START -->\n<!-- ADR_INDEX_END -->\n', 'utf8');

    // Stateless CI check (ticketId: null) with zero ADR in the PR diff MUST fail despite accepted ADR-001 on main
    const statelessNoAdr = checkSpecDrift({
      diffFiles: ['PRODUCT.md'],
      ticketId: null,
      repoRoot: dir
    });
    assert.equal(statelessNoAdr.passed, false, 'stateless CI drift check must not pass from historical ADRs on main');

    const techAdr = runCLI(
      ['adr', 'create', '--title', 'Technical Drift Requires Approval', '--scope', 'technical', '--ticket', 'L-900100', '--supersedes', 'CAP-01'],
      null,
      dir
    );
    assert.equal(techAdr.adr.adr.status, 'pending_approval', 'technical ADRs must start in pending_approval');

    const driftWhilePending = checkSpecDrift({
      diffFiles: ['PRODUCT.md', techAdr.adr.relativePath],
      ticketId: 'L-900100',
      repoRoot: dir
    });
    assert.equal(driftWhilePending.passed, false, 'pending_approval technical ADR must not satisfy checkSpecDrift even when prior ADR-001 exists');

    const statelessWhilePending = checkSpecDrift({
      diffFiles: ['PRODUCT.md', techAdr.adr.relativePath],
      ticketId: null,
      repoRoot: dir
    });
    assert.equal(statelessWhilePending.passed, false, 'stateless CI drift check must block pending_approval ADRs');

    const approved = decideADR({
      adrId: techAdr.adr.adr.id,
      action: 'approve',
      reviewer: '@fady',
      reason: 'Explicitly reviewed and approved',
      repoRoot: dir
    });
    assert.equal(approved.adr.status, 'accepted');

    const driftAfterApprove = checkSpecDrift({
      diffFiles: ['PRODUCT.md', techAdr.adr.relativePath],
      ticketId: 'L-900100',
      repoRoot: dir
    });
    assert.equal(driftAfterApprove.passed, true, 'approved ADR with L-* ticket ID must satisfy checkSpecDrift');
    assert.deepEqual(driftAfterApprove.linkedADRs, ['ADR-002']);

    const statelessAfterApprove = checkSpecDrift({
      diffFiles: ['PRODUCT.md', techAdr.adr.relativePath],
      ticketId: null,
      repoRoot: dir
    });
    assert.equal(statelessAfterApprove.passed, true, 'stateless CI drift check must pass when accepted ADR-002 is in the PR diff');
    assert.deepEqual(statelessAfterApprove.linkedADRs, ['ADR-002']);
  });

  it('generateReviewPlan embeds modified file paths, diff stats, and actual unified diff hunks into every reviewer prompt', () => {
    assert.equal(git(dir, 'checkout', '-q', '-b', 'feature/issue-#122-auth-review').status, 0);
    startSession({
      issueId: '122',
      branch: 'feature/issue-#122-auth-review',
      stage: 6,
      lane: 'full',
      repoRoot: dir,
      force: true
    });
    fs.mkdirSync(path.join(dir, 'src/auth'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src/auth/jwt-verifier.mjs'),
      'export function verifyJwtSignature(token) {\n  return Boolean(token && token.includes("."));\n}\n',
      'utf8'
    );
    git(dir, 'add', 'src/auth/jwt-verifier.mjs');
    assert.equal(git(dir, 'commit', '-q', '-m', 'feat(auth): add jwt verifier').status, 0);

    const fullPlan = generateReviewPlan({ repoRoot: dir, lane: 'full' });
    assert.equal(fullPlan.subagentsCount, 3, 'CRITICAL auth file in full lane must schedule all 3 reviewers');
    assert.ok(Array.isArray(fullPlan.modifiedFiles));
    assert.ok(fullPlan.modifiedFiles.includes('src/auth/jwt-verifier.mjs'));
    assert.match(fullPlan.diff, /\+export function verifyJwtSignature/);

    for (const sub of fullPlan.payload.Subagents) {
      assert.ok(sub.Prompt.includes('src/auth/jwt-verifier.mjs'), `${sub.Role} prompt must include changed file path`);
      assert.match(sub.Prompt, /\+export function verifyJwtSignature/, `${sub.Role} prompt must embed the actual unified diff`);
      assert.equal(sub.Prompt.includes('flake-check --runs 10'), false, `${sub.Role} read-only prompt must not instruct running CLI flake-check`);
    }

    const stdPlan = generateReviewPlan({ repoRoot: dir, lane: 'standard' });
    assert.equal(stdPlan.subagentsCount, 1);
    assert.match(stdPlan.payload.Subagents[0].Prompt, /\+export function verifyJwtSignature/);
  });

  it('upgrades GitHub Actions workflows and installCIWorkflow template to Node 24 v7 actions with zero @v4 references', () => {
    const gateWf = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/sdlc-quality-gate.yml'), 'utf8');
    const wikiWf = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/publish-wiki.yml'), 'utf8');
    installCIWorkflow({ repoRoot: dir, force: true });
    const generatedWf = fs.readFileSync(path.join(dir, '.github/workflows/sdlc-quality-gate.yml'), 'utf8');

    for (const [label, content] of [
      ['.github/workflows/sdlc-quality-gate.yml', gateWf],
      ['generated sdlc-quality-gate.yml', generatedWf]
    ]) {
      assert.match(content, /actions\/checkout@v7/, `${label} must use actions/checkout@v7`);
      assert.match(content, /actions\/setup-node@v7/, `${label} must use actions/setup-node@v7`);
      assert.doesNotMatch(content, /actions\/(?:checkout|setup-node)@v4/, `${label} must not reference Node 20 @v4 actions`);
    }

    assert.match(wikiWf, /actions\/checkout@v7/, 'publish-wiki.yml must use actions/checkout@v7');
    assert.doesNotMatch(wikiWf, /actions\/checkout@v4/, 'publish-wiki.yml must not reference actions/checkout@v4');
  });

  it('enforces canonical Git Flow: default base branch develop, blocks direct feature PRs to main, and scaffolds release workflow', () => {
    // 1. In a single-branch repository (main only)
    assert.equal(coreMod.hasDevelopBranch(dir), false);
    assert.equal(coreMod.resolveDefaultBaseBranch(dir), 'main');

    // 2. Once develop exists, Git Flow becomes active
    git(dir, 'checkout', '-b', 'develop');
    assert.equal(coreMod.hasDevelopBranch(dir), true);
    assert.equal(coreMod.resolveDefaultBaseBranch(dir), 'develop');

    // 3. ensurePullRequest defaults baseBranch to develop
    let ghCaptured = [];
    const mockGh = (bin, args) => {
      ghCaptured.push({ bin, args });
      if (bin === 'git' && args[0] === 'push') return 'ok';
      if (bin === 'gh' && args[0] === 'pr' && args[1] === 'view') throw new Error('no PR');
      if (bin === 'gh' && args[0] === 'pr' && args[1] === 'create') {
        return 'https://github.com/fmatar/agentic-sdlc-framework/pull/201\n';
      }
      return '';
    };

    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({
        version: '2.1.0',
        projectManagement: { provider: 'github', key: 'SDLC' },
        modules: [{ name: 'root', path: '.', commands: { test: 'node -e 0' }, thresholds: { diffCoverage: 85, mutationScore: null } }]
      }),
      'utf8'
    );

    git(dir, 'checkout', '-b', 'feature/login-auth');
    startSession({
      issueId: 901,
      branch: 'feature/login-auth',
      stage: 5,
      repoRoot: dir,
      force: true
    });

    const prRes = pmMod.ensurePullRequest({
      issueId: 901,
      branch: 'feature/login-auth',
      title: 'feat: add login authentication',
      body: 'Closes #901',
      repoRoot: dir,
      execFn: mockGh
    });

    assert.equal(prRes.success, true);
    assert.equal(prRes.prNumber, 201);
    const prCreateCall = ghCaptured.find((c) => c.bin === 'gh' && c.args[0] === 'pr' && c.args[1] === 'create');
    assert.ok(prCreateCall, 'gh pr create must be called');
    const baseIdx = prCreateCall.args.indexOf('--base');
    assert.ok(baseIdx !== -1, '--base argument must be passed');
    assert.equal(prCreateCall.args[baseIdx + 1], 'develop', 'PR must target develop branch by default');

    // 4. verifyMergeGuard rejects direct merges from feature branch to main
    const directToMain = gitGuardMod.verifyMergeGuard({
      targetBranch: 'main',
      sourceBranch: 'feature/login-auth',
      repoRoot: dir
    });
    assert.equal(directToMain.allowed, false);
    assert.equal(directToMain.reasonCode, 'DIRECT_MERGE_TO_MAIN_FORBIDDEN');
    assert.match(directToMain.message, /Merges into 'main' must originate exclusively from 'develop'/);

    // 5. verifyMergeGuard allows merge to develop once Stage 7 receipt exists
    fs.writeFileSync(path.join(dir, 'login.mjs'), 'export const login = true;\n', 'utf8');
    git(dir, 'add', 'login.mjs');
    git(dir, 'commit', '-m', 'feat: login');
    const headSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    const receipt = issueGateReceipt({
      issueId: 901,
      branch: 'feature/login-auth',
      headSha,
      coveragePct: 90.0,
      mutationPct: 85.0,
      peerReviewApproved: true,
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(receipt.success, true);

    const mergeToDevelop = gitGuardMod.verifyMergeGuard({
      targetBranch: 'develop',
      sourceBranch: 'feature/login-auth',
      sourceSha: headSha,
      repoRoot: dir
    });
    assert.equal(mergeToDevelop.allowed, true);

    // 6. verifyMergeGuard allows develop to merge into main when backed by receipt
    const mergeDevelopToMain = gitGuardMod.verifyMergeGuard({
      targetBranch: 'main',
      sourceBranch: 'develop',
      sourceSha: headSha,
      repoRoot: dir
    });
    assert.equal(mergeDevelopToMain.allowed, true);

    // 7. installCIWorkflow scaffolds quality-gate, enforce-branch-flow, and release workflows
    const ciRes = installCIWorkflow({ repoRoot: dir, force: true });
    assert.equal(ciRes.success, true);
    assert.ok(fs.existsSync(path.join(dir, '.github/workflows/sdlc-quality-gate.yml')));
    assert.ok(fs.existsSync(path.join(dir, '.github/workflows/enforce-branch-flow.yml')));
    assert.ok(fs.existsSync(path.join(dir, '.github/workflows/release.yml')));

    const branchFlowYaml = fs.readFileSync(path.join(dir, '.github/workflows/enforce-branch-flow.yml'), 'utf8');
    assert.match(branchFlowYaml, /HEAD_REF:\s*\${{\s*github\.head_ref\s*}}/);
    assert.match(branchFlowYaml, /\$HEAD_REF.*!=.*develop/);
    assert.match(branchFlowYaml, /Branch policy violation/);

    const releaseYaml = fs.readFileSync(path.join(dir, '.github/workflows/release.yml'), 'utf8');
    assert.match(releaseYaml, /name:\s*Production Release/);
    assert.match(releaseYaml, /branches:\s*-\s*main/);
    assert.match(releaseYaml, /gate --strict/);
    assert.match(releaseYaml, /command -v gh/);
    assert.match(releaseYaml, /api\.github\.com/);
  });
});

// ===========================================================================
// L-128000 Hardening: Ring 0, Redaction, Release & Workbench
// ===========================================================================
describe('L-128000 Hardening: Ring 0, Redaction, Release & Workbench', () => {
  let dir;
  beforeEach(() => {
    dir = makeRepo();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('appendAuditRecord refuses to append to a corrupted docs/AUDIT_CHAIN.jsonl', () => {
    auditChainMod.appendAuditRecord({ event: 'INIT_OK', metadata: { step: 1 }, repoRoot: dir });
    const auditPath = path.join(dir, 'docs/AUDIT_CHAIN.jsonl');
    const lines = fs.readFileSync(auditPath, 'utf8').trim().split('\n');
    const entry = JSON.parse(lines[0]);
    entry.event = 'TAMPERED_EVENT';
    fs.writeFileSync(auditPath, JSON.stringify(entry) + '\n', 'utf8');

    assert.throws(
      () => auditChainMod.appendAuditRecord({ event: 'NEXT', repoRoot: dir }),
      /Refusing to append to corrupted audit ledger/i
    );
  });

  it('verifyGateReceipt and guard verify CLI reject commits modifying config/code after receipt while allowing audit/session logs', () => {
    assert.equal(git(dir, 'checkout', '-q', '-b', 'feature/receipt-integrity').status, 0);
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\ncoverage/\n', 'utf8');
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/app.mjs'), 'export const v = 1;\n', 'utf8');
    git(dir, 'add', '-A');
    assert.equal(git(dir, 'commit', '-q', '-m', 'feat: initial app').status, 0);
    const sha1 = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    const issued = issueGateReceipt({
      issueId: 501,
      branch: 'feature/receipt-integrity',
      headSha: sha1,
      coveragePct: 92.5,
      mutationPct: null,
      peerReviewApproved: true,
      reviewer: '@reviewer',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(issued.success, true);

    // Committing docs/AUDIT_CHAIN.jsonl alone keeps the receipt valid
    git(dir, 'add', '-f', 'docs/AUDIT_CHAIN.jsonl');
    assert.equal(git(dir, 'commit', '-q', '-m', 'chore: record receipt').status, 0);
    const shaAuditOnly = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    assert.equal(
      verifyGateReceipt({ headSha: shaAuditOnly, branch: 'feature/receipt-integrity', repoRoot: dir }).valid,
      true
    );

    const guardValidCli = runCLI(
      ['guard', 'verify', '--sha', shaAuditOnly, '--branch', 'feature/receipt-integrity'],
      null,
      dir
    );
    assert.equal(guardValidCli.success, true);
    assert.match(formatCLIResult(guardValidCli, ['guard', 'verify']), /Verified Stage 7 gate receipt/i);

    // Committing only .agent/.sdlc-session.json also keeps the receipt valid
    startSession({ issueId: 501, branch: 'feature/receipt-integrity', repoRoot: dir, force: true });
    git(dir, 'add', '-f', '.agent/.sdlc-session.json');
    assert.equal(git(dir, 'commit', '-q', '-m', 'chore: update session').status, 0);
    const shaSessionOnly = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    assert.equal(
      verifyGateReceipt({ headSha: shaSessionOnly, branch: 'feature/receipt-integrity', repoRoot: dir }).valid,
      true
    );

    // Modifying .agent/sdlc-config.json after receipt invalidates it
    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({ version: '2.1.0', modules: [{ name: 'root', path: '.', thresholds: { diffCoverage: 0, mutationScore: 0 } }] }),
      'utf8'
    );
    git(dir, 'add', '-f', '.agent/sdlc-config.json');
    assert.equal(git(dir, 'commit', '-q', '-m', 'chore: lower thresholds').status, 0);
    const shaConfigTampered = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    assert.equal(
      verifyGateReceipt({ headSha: shaConfigTampered, branch: 'feature/receipt-integrity', repoRoot: dir }).valid,
      false
    );

    const guardInvalidCli = runCLI(
      ['guard', 'verify', '--sha', shaConfigTampered, '--branch', 'feature/receipt-integrity'],
      null,
      dir
    );
    assert.equal(guardInvalidCli.success, false);

    // Issuing a fresh receipt and modifying .agent/scripts/sdlc-engine.mjs also invalidates it
    const reIssued = issueGateReceipt({
      issueId: 501,
      branch: 'feature/receipt-integrity',
      headSha: shaConfigTampered,
      coveragePct: 93,
      mutationPct: null,
      peerReviewApproved: true,
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(reIssued.success, true);
    fs.appendFileSync(path.join(dir, '.agent/scripts/sdlc-engine.mjs'), '\n// post-receipt edit\n', 'utf8');
    git(dir, 'add', '-f', '.agent/scripts/sdlc-engine.mjs');
    assert.equal(git(dir, 'commit', '-q', '-m', 'chore: post-receipt engine edit').status, 0);
    const shaScriptTampered = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    assert.equal(
      verifyGateReceipt({ headSha: shaScriptTampered, branch: 'feature/receipt-integrity', repoRoot: dir }).valid,
      false
    );
  });

  it('auditSecurity redacts secret prefixes instead of printing raw tokens', () => {
    assert.equal(git(dir, 'checkout', '-q', '-b', 'feature/secret-redaction').status, 0);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const fakePat = ['ghp', '_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcd'].join('');
    fs.writeFileSync(path.join(dir, 'src/config.mjs'), `export const gh = "${fakePat}";\n`, 'utf8');
    git(dir, 'add', 'src/config.mjs');
    assert.equal(git(dir, 'commit', '-q', '-m', 'test: add leak').status, 0);

    const secRes = qualityGateMod.auditSecurity(dir);
    assert.equal(secRes.passed, false);
    assert.ok(secRes.secretViolations.length >= 1);
    assert.equal(secRes.secretViolations[0].redacted, '[REDACTED:GitHub Personal Access Token]');
    assert.equal(JSON.stringify(secRes).includes('ghp_ABCDE'), false);

    const cliRes = runCLI(['security-audit'], null, dir);
    assert.equal(cliRes.success, false);
    assert.equal(cliRes.security.secretViolations[0].redacted, '[REDACTED:GitHub Personal Access Token]');
    assert.equal(JSON.stringify(cliRes).includes('ghp_ABCDE'), false);
    const formatted = formatCLIResult(cliRes);
    assert.equal(formatted.includes('ghp_ABCDE'), false);
  });

  it('generateRegressionProof marks failed liveProbe responses as verified: false', () => {
    const res = qualityGateMod.generateRegressionProof({
      targetName: 'probe-fail',
      apiEndpoints: [{ method: 'GET', path: 'http://127.0.0.1:1/unreachable', liveProbe: true }],
      repoRoot: dir
    });
    assert.equal(res.success, true);
    assert.equal(res.apiProofs.length, 1);
    assert.equal(res.apiProofs[0].verified, false);
    assert.equal(res.apiProofs[0].source, 'live-probe-fallback');
  });

  it('release rejects --skip-gate and safely bumps pom.xml, pyproject.toml, and Cargo.toml project versions', () => {
    const cliSkip = runCLI(['release', '--skip-gate'], null, dir);
    assert.equal(cliSkip.success, false);
    assert.match(String(cliSkip.error || ''), /forbidden/i);

    assert.throws(
      () => executeRelease({ bump: 'patch', skipGate: true, repoRoot: dir }),
      /Bypassing strict quality gate/i
    );

    const seedMinimalRepo = (manifestName, manifestContent) => {
      const subDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-poly-rel-'));
      git(subDir, 'init', '-q', '-b', 'main');
      git(subDir, 'config', 'user.email', 'agent@sdlc.local');
      git(subDir, 'config', 'user.name', 'SDLC Agent');
      git(subDir, 'config', 'commit.gpgsign', 'false');
      fs.mkdirSync(path.join(subDir, '.agent'), { recursive: true });
      fs.writeFileSync(
        path.join(subDir, '.agent/sdlc-config.json'),
        JSON.stringify({
          version: '2.1.0',
          modules: [
            {
              name: 'root',
              path: '.',
              commands: {
                test: 'node -e 0',
                coverage: `node -e "const fs=require('fs');fs.mkdirSync('coverage',{recursive:true});fs.writeFileSync('coverage/coverage-summary.json',JSON.stringify({total:{lines:{pct:95},branches:{pct:90}}}))"`,
                coverageFile: 'coverage/coverage-summary.json'
              },
              thresholds: { diffCoverage: 85, mutationScore: null }
            }
          ]
        }),
        'utf8'
      );
      fs.writeFileSync(path.join(subDir, manifestName), manifestContent, 'utf8');
      fs.writeFileSync(path.join(subDir, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n- Changes\n', 'utf8');
      git(subDir, 'add', '-A');
      assert.equal(git(subDir, 'commit', '-q', '-m', 'chore: init').status, 0);
      assert.equal(git(subDir, 'checkout', '-q', '-b', 'chore/release').status, 0);
      return subDir;
    };

    const mavenDir = seedMinimalRepo(
      'pom.xml',
      `<project>
  <parent>
    <groupId>org.example</groupId>
    <artifactId>parent</artifactId>
    <version>3.1.0</version>
  </parent>
  <artifactId>my-service</artifactId>
  <version>1.2.3</version>
  <dependencies>
    <dependency>
      <groupId>org.dep</groupId>
      <artifactId>lib</artifactId>
      <version>4.0.0</version>
    </dependency>
  </dependencies>
</project>\n`
    );
    const pyDir = seedMinimalRepo(
      'pyproject.toml',
      `[tool.pytest]
version = "9.9.9"

[project]
name = "py-svc"
version = "0.4.1"
`
    );
    const cargoDir = seedMinimalRepo(
      'Cargo.toml',
      `[dependencies]
serde = { version = "1.0.200" }

[package]
name = "rust-svc"
version = "2.0.5"
`
    );

    try {
      const mavenDry = executeRelease({ bump: 'patch', dryRun: true, repoRoot: mavenDir });
      assert.equal(mavenDry.manifestType, 'pom.xml');
      const mavenRel = executeRelease({ bump: 'patch', noTag: true, repoRoot: mavenDir });
      assert.equal(mavenRel.success, true);
      assert.ok(mavenRel.updatedFiles.includes('pom.xml'));
      assert.equal(mavenRel.newVersion, '1.2.4');
      const pomOut = fs.readFileSync(path.join(mavenDir, 'pom.xml'), 'utf8');
      assert.ok(pomOut.includes('<version>3.1.0</version>'), 'parent POM version must not change');
      assert.ok(pomOut.includes('<version>1.2.4</version>'), 'project POM version must bump to 1.2.4');
      assert.ok(pomOut.includes('<version>4.0.0</version>'), 'dependency version must not change');

      const pyDry = executeRelease({ bump: 'minor', dryRun: true, repoRoot: pyDir });
      assert.equal(pyDry.manifestType, 'pyproject.toml');
      const pyRel = executeRelease({ bump: 'minor', noTag: true, repoRoot: pyDir });
      assert.equal(pyRel.success, true);
      assert.ok(pyRel.updatedFiles.includes('pyproject.toml'));
      assert.equal(pyRel.newVersion, '0.5.0');
      const pyOut = fs.readFileSync(path.join(pyDir, 'pyproject.toml'), 'utf8');
      assert.ok(pyOut.includes('version = "9.9.9"'), '[tool.pytest] version must not change');
      assert.ok(pyOut.includes('version = "0.5.0"'), '[project] version must bump to 0.5.0');

      const cargoDry = executeRelease({ bump: 'major', dryRun: true, repoRoot: cargoDir });
      assert.equal(cargoDry.manifestType, 'Cargo.toml');
      const cargoRel = executeRelease({ bump: 'major', noTag: true, repoRoot: cargoDir });
      assert.equal(cargoRel.success, true);
      assert.ok(cargoRel.updatedFiles.includes('Cargo.toml'));
      assert.equal(cargoRel.newVersion, '3.0.0');
      const cargoOut = fs.readFileSync(path.join(cargoDir, 'Cargo.toml'), 'utf8');
      assert.ok(cargoOut.includes('version = "1.0.200"'), '[dependencies] version must not change');
      assert.ok(cargoOut.includes('version = "3.0.0"'), '[package] version must bump to 3.0.0');
    } finally {
      fs.rmSync(mavenDir, { recursive: true, force: true });
      fs.rmSync(pyDir, { recursive: true, force: true });
      fs.rmSync(cargoDir, { recursive: true, force: true });
    }
  });

  it('stage begin --checkout propagates git checkout failures instead of succeeding silently', () => {
    assert.throws(() =>
      executeCompositeStage({
        action: 'begin',
        issueId: 77,
        branch: 'feature/bad..branch',
        checkoutBranch: true,
        repoRoot: dir
      })
    );
  });

  it('pm-provider passes auth headers via curl -K - stdin and pollCIPRChecks reads gh JSON status', () => {
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify({ version: '2.1.0', projectManagement: { provider: 'linear', key: 'SDLC' } }),
      'utf8'
    );

    const curlCalls = [];
    const testLinearKey = ['lin_api', '_test_secret_token_999'].join('');
    const prevKey = process.env.LINEAR_API_KEY;
    process.env.LINEAR_API_KEY = testLinearKey;
    try {
      const mockExec = (bin, args, opts) => {
        curlCalls.push({ bin, args, opts });
        if (String(args).includes('WorkflowStates') || String(opts?.input || '').includes('Authorization')) {
          const body = String(args.join(' '));
          if (body.includes('workflowStates')) {
            return JSON.stringify({ data: { workflowStates: { nodes: [{ id: 'st-1', name: 'In Progress', type: 'started' }] } } }) + '\n200\n';
          }
        }
        return JSON.stringify({ data: { issueUpdate: { success: true } } }) + '\n200\n';
      };
      const tr = pmMod.transitionPMState({
        issueId: 'SDLC-42',
        state: 'in-progress',
        repoRoot: dir,
        execFn: mockExec
      });
      assert.equal(tr.success, true);
      assert.ok(curlCalls.length >= 1);
      for (const call of curlCalls) {
        assert.equal(call.bin, 'curl');
        assert.ok(call.args.includes('-K') && call.args.includes('-'));
        assert.equal(call.args.join(' ').includes(testLinearKey), false, 'secret token must never appear in argv');
        assert.ok(String(call.opts?.input || '').includes(`Authorization: ${testLinearKey}`));
      }
    } finally {
      if (prevKey === undefined) delete process.env.LINEAR_API_KEY;
      else process.env.LINEAR_API_KEY = prevKey;
    }

    const passRes = pmMod.pollCIPRChecks(42, {
      timeoutSeconds: 5,
      pollIntervalSeconds: 0.05,
      repoRoot: dir,
      execFn: () => JSON.stringify([{ name: 'failover-dr-test', state: 'SUCCESS', bucket: 'pass' }])
    });
    assert.equal(passRes.passed, true);

    const failRes = pmMod.pollCIPRChecks(42, {
      timeoutSeconds: 5,
      pollIntervalSeconds: 0.05,
      repoRoot: dir,
      execFn: () => JSON.stringify([{ name: 'unit-tests', state: 'FAILURE', bucket: 'fail' }])
    });
    assert.equal(failRes.passed, false);
    assert.match(String(failRes.error || ''), /unit-tests/);
  });

  it('workbench-server escapes SSR HTML, serves /widget without writing disk files, and rejects bodies >64KiB with 413', async () => {
    const html = workbenchMod.renderWorkbenchHTML(dir, () => ({
      active: true,
      session: {
        issueId: '<img src=x onerror=alert(1)>',
        branch: 'feature/<script>alert(1)</script>',
        stage: 3
      }
    }));
    assert.equal(html.includes('<script>alert(1)</script>'), false);
    assert.equal(html.includes('<img src=x onerror=alert(1)>'), false);
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));

    const wb = createWorkbenchServer({ port: 0, repoRoot: dir });
    const widgetPath = path.join(dir, '.agent/workbench/index.html');
    fs.rmSync(widgetPath, { force: true });
    const wRes = await dispatchReq(wb, 'GET', `/widget?token=${wb.token}`);
    assert.equal(wRes.status, 200);
    assert.ok(wRes.body.includes('<!DOCTYPE html>') || wRes.body.includes('<html'));
    assert.equal(fs.existsSync(widgetPath), false, 'GET /widget must not write .agent/workbench/index.html');

    const oversized = await dispatchReq(wb, 'POST', '/api/adr/decide', {
      body: { adrId: 'ADR-001', action: 'approve', reason: 'x'.repeat(70000) },
      headers: { 'X-SDLC-Token': wb.token }
    });
    assert.equal(oversized.status, 413);
  });

  it('planProductDAG detects circular capability dependencies with hasCycle: true and success: false', () => {
    productDagMod.initProductConstitution({
      title: 'Cycle Demo',
      vision: 'Detect dependency cycles',
      capabilities: [
        { id: 'CAP-01', title: 'Alpha', spec: 'docs/specs/cap-01.md', dependsOn: ['CAP-02'] },
        { id: 'CAP-02', title: 'Beta', spec: 'docs/specs/cap-02.md', dependsOn: ['CAP-01'] }
      ],
      repoRoot: dir
    });
    const dag = productDagMod.planProductDAG({ repoRoot: dir });
    assert.equal(dag.hasCycle, true);
    assert.equal(dag.success, false);
    assert.ok(dag.cycleNodes.includes('CAP-01'));
    assert.ok(dag.cycleNodes.includes('CAP-02'));
  });

  it('guard and audit chain unit invariants kill threshold, branch, stage, merge, push, and hook mutants', () => {
    const genesis = '0'.repeat(64);
    const auditPath = path.join(dir, 'docs/AUDIT_CHAIN.jsonl');

    // 1. verifyAuditChain: missing, empty, malformed JSON, index mismatch, previousHash mismatch, currentHash mismatch
    const missingChain = auditChainMod.verifyAuditChain(dir);
    assert.equal(missingChain.valid, true);
    assert.equal(missingChain.recordsCount, 0);
    assert.equal(missingChain.chainHead, genesis);
    assert.equal(missingChain.merkleRoot, genesis);
    assert.deepEqual(missingChain.records, []);
    assert.match(missingChain.message, /No audit records/);

    fs.mkdirSync(path.dirname(auditPath), { recursive: true });
    fs.writeFileSync(auditPath, '   \n', 'utf8');
    const emptyChain = auditChainMod.verifyAuditChain(dir);
    assert.equal(emptyChain.valid, true);
    assert.equal(emptyChain.recordsCount, 0);
    assert.equal(emptyChain.chainHead, genesis);
    assert.deepEqual(emptyChain.records, []);
    assert.match(emptyChain.message, /Audit chain is empty/);

    fs.writeFileSync(auditPath, '{not-valid-json\n', 'utf8');
    const badJsonChain = auditChainMod.verifyAuditChain(dir);
    assert.equal(badJsonChain.valid, false);
    assert.equal(badJsonChain.errorIndex, 0);
    assert.equal(badJsonChain.recordsCount, 1);
    assert.match(badJsonChain.error, /Malformed JSON/);

    fs.writeFileSync(
      auditPath,
      JSON.stringify({ index: 3, timestamp: '2026-01-01T00:00:00Z', event: 'E', metadata: {}, previousHash: genesis, currentHash: genesis }) + '\n',
      'utf8'
    );
    const badIdxChain = auditChainMod.verifyAuditChain(dir);
    assert.equal(badIdxChain.valid, false);
    assert.equal(badIdxChain.errorIndex, 0);
    assert.match(badIdxChain.error, /Index mismatch/);

    const badPrevHash = 'f'.repeat(64);
    const recalculatedForBadPrev = calculateRecordHash({
      index: 0,
      timestamp: '2026-01-01T00:00:00Z',
      event: 'E',
      metadata: {},
      previousHash: badPrevHash
    });
    fs.writeFileSync(
      auditPath,
      JSON.stringify({ index: 0, timestamp: '2026-01-01T00:00:00Z', event: 'E', metadata: {}, previousHash: badPrevHash, currentHash: recalculatedForBadPrev }) + '\n',
      'utf8'
    );
    const badPrevChain = auditChainMod.verifyAuditChain(dir);
    assert.equal(badPrevChain.valid, false);
    assert.equal(badPrevChain.errorIndex, 0);
    assert.match(badPrevChain.error, /previousHash mismatch/);

    fs.writeFileSync(
      auditPath,
      JSON.stringify({ index: 0, timestamp: '2026-01-01T00:00:00Z', event: 'E', metadata: {}, previousHash: genesis, currentHash: 'e'.repeat(64) }) + '\n',
      'utf8'
    );
    const badCurChain = auditChainMod.verifyAuditChain(dir);
    assert.equal(badCurChain.valid, false);
    assert.equal(badCurChain.errorIndex, 0);
    assert.match(badCurChain.error, /SHA-256 tampering detected/);

    // Verify verifyGateReceipt refuses corrupted audit chain
    const corruptedReceipt = verifyGateReceipt({ branch: 'main', repoRoot: dir });
    assert.equal(corruptedReceipt.valid, false);
    assert.match(corruptedReceipt.reason, /Audit hash chain corrupted/);

    // Reset clean chain and verify missing signing key case
    fs.rmSync(auditPath, { force: true });
    fs.rmSync(path.join(dir, '.agent/.receipt-key'), { force: true });
    const prevReceiptEnv = process.env.SDLC_RECEIPT_KEY;
    delete process.env.SDLC_RECEIPT_KEY;
    try {
      const noKeyRes = verifyGateReceipt({ branch: 'main', repoRoot: dir });
      assert.equal(noKeyRes.valid, false);
      assert.match(noKeyRes.reason, /No receipt signing key/);
    } finally {
      if (prevReceiptEnv !== undefined) process.env.SDLC_RECEIPT_KEY = prevReceiptEnv;
    }

    // 2. issueGateReceipt threshold checks across module config, testing config, standard lane, and null thresholds
    const cfgPath = path.join(dir, '.agent/sdlc-config.json');
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ version: '2.1.0', modules: [{ name: 'root', path: '.', thresholds: { diffCoverage: 85, mutationScore: 52 } }] }),
      'utf8'
    );

    const lowCov = issueGateReceipt({
      issueId: 601,
      branch: 'main',
      coveragePct: 70,
      mutationPct: 60,
      peerReviewApproved: true,
      reviewer: '@rev',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(lowCov.success, false);
    assert.deepEqual(lowCov.missing, ['coveragePct']);
    assert.match(lowCov.reason, /coverage 70% is below configured threshold 85%/);

    const lowMut = issueGateReceipt({
      issueId: 601,
      branch: 'main',
      coveragePct: 90,
      mutationPct: 40,
      peerReviewApproved: true,
      reviewer: '@rev',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(lowMut.success, false);
    assert.deepEqual(lowMut.missing, ['mutationPct']);
    assert.match(lowMut.reason, /mutation score 40% is below configured threshold 52%/);

    const stdOk = issueGateReceipt({
      issueId: 602,
      branch: 'main',
      lane: 'standard',
      coveragePct: 90,
      peerReviewApproved: true,
      reviewer: '@rev',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(stdOk.success, true);
    assert.equal(stdOk.receipt.lane, 'standard');
    assert.equal(stdOk.receipt.mutationPct, null);

    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ version: '2.1.0', testing: { coverageThreshold: 80, mutationThreshold: 50 }, modules: [] }),
      'utf8'
    );
    const testingOk = issueGateReceipt({
      issueId: 603,
      branch: 'main',
      coveragePct: 82,
      mutationPct: 51,
      peerReviewApproved: true,
      reviewer: '@rev',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(testingOk.success, true);

    const testingFail = issueGateReceipt({
      issueId: 603,
      branch: 'main',
      coveragePct: 79,
      mutationPct: 51,
      peerReviewApproved: true,
      reviewer: '@rev',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(testingFail.success, false);
    assert.deepEqual(testingFail.missing, ['coveragePct']);

    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ version: '2.1.0', modules: [{ name: 'docs', path: '.', thresholds: { diffCoverage: null, mutationScore: null } }] }),
      'utf8'
    );
    const nullThresholdsOk = issueGateReceipt({
      issueId: 604,
      branch: 'main',
      coveragePct: 10,
      mutationPct: 10,
      peerReviewApproved: true,
      reviewer: '@rev',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(nullThresholdsOk.success, true);

    // 3. verifyGateReceipt resolving headSha solely from branch ref
    assert.equal(git(dir, 'checkout', '-q', '-b', 'feature/branch-resolve').status, 0);
    const branchRec = issueGateReceipt({
      issueId: 605,
      branch: 'feature/branch-resolve',
      coveragePct: 95,
      mutationPct: 60,
      peerReviewApproved: true,
      reviewer: '@rev',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(branchRec.success, true);
    const byBranchOnly = verifyGateReceipt({ branch: 'feature/branch-resolve', repoRoot: dir });
    assert.equal(byBranchOnly.valid, true);
    assert.equal(byBranchOnly.receipt.receiptId, branchRec.receipt.receiptId);

    // 4. git-guard verifyCommitGuard: branch mismatch, stage 1 block, stage 2 pass
    assert.equal(git(dir, 'checkout', '-q', '-b', 'feature/b').status, 0);
    startSession({ issueId: 701, branch: 'feature/a', stage: 2, repoRoot: dir, force: true });
    const mismatch = verifyCommitGuard({ repoRoot: dir });
    assert.equal(mismatch.allowed, false);
    assert.equal(mismatch.layer, 'LAYER_2_BRANCH_MISMATCH');
    assert.ok(mismatch.message.includes('feature/a') && mismatch.message.includes('feature/b'));

    startSession({ issueId: 701, branch: 'feature/b', stage: 1, repoRoot: dir, force: true });
    const stage1Block = verifyCommitGuard({ repoRoot: dir });
    assert.equal(stage1Block.allowed, false);
    assert.equal(stage1Block.layer, 'LAYER_2_STAGE_NOT_READY');
    assert.equal(stage1Block.stage, 1);

    startSession({ issueId: 701, branch: 'feature/b', stage: 2, repoRoot: dir, force: true });
    const stage2Pass = verifyCommitGuard({ repoRoot: dir });
    assert.equal(stage2Pass.allowed, true);
    assert.equal(stage2Pass.layer, 'PASSED');

    // 5. git-guard verifyMergeGuard: non-protected target, sourceSha mismatch vs develop, missing receipt
    const featureMerge = gitGuardMod.verifyMergeGuard({ targetBranch: 'feature/other', repoRoot: dir });
    assert.equal(featureMerge.allowed, true);
    assert.match(featureMerge.message, /non-protected branch/);

    assert.equal(git(dir, 'checkout', '-q', '-b', 'develop', 'main').status, 0);
    fs.writeFileSync(path.join(dir, 'develop-unreceipted.mjs'), 'export const d = 1;\n', 'utf8');
    git(dir, 'add', 'develop-unreceipted.mjs');
    assert.equal(git(dir, 'commit', '-q', '-m', 'chore: unreceipted commit on develop').status, 0);
    const developSha = git(dir, 'rev-parse', 'develop').stdout.trim();
    assert.equal(git(dir, 'checkout', '-q', '-').status, 0);
    fs.writeFileSync(path.join(dir, 'work.mjs'), 'export const w = 1;\n', 'utf8');
    git(dir, 'add', 'work.mjs');
    assert.equal(git(dir, 'commit', '-q', '-m', 'feat: work on feature/b').status, 0);
    const unmergedSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    const shaMismatch = gitGuardMod.verifyMergeGuard({
      targetBranch: 'main',
      sourceBranch: null,
      sourceSha: unmergedSha,
      repoRoot: dir
    });
    assert.equal(shaMismatch.allowed, false);
    assert.equal(shaMismatch.reasonCode, 'DIRECT_MERGE_TO_MAIN_FORBIDDEN');

    const missingReceiptMerge = gitGuardMod.verifyMergeGuard({
      targetBranch: 'main',
      sourceBranch: 'develop',
      sourceSha: developSha,
      repoRoot: dir
    });
    assert.equal(missingReceiptMerge.allowed, false);
    assert.equal(missingReceiptMerge.layer, 'LAYER_3_GATE_RECEIPT_REQUIRED');

    // 6. git-guard verifyPushGuard & core.hooksPath custom hook installation
    const blockedPush = gitGuardMod.verifyPushGuard({ remoteBranch: 'main', repoRoot: dir });
    assert.equal(blockedPush.allowed, false);
    assert.equal(blockedPush.layer, 'LAYER_3_PROTECTED_PUSH');

    const allowedPush = gitGuardMod.verifyPushGuard({ remoteBranch: 'feature/b', repoRoot: dir });
    assert.equal(allowedPush.allowed, true);
    assert.equal(allowedPush.layer, 'PASSED');

    assert.equal(git(dir, 'config', 'core.hooksPath', '.custom-hooks').status, 0);
    const hooksRes = gitGuardMod.installHooks({ repoRoot: dir });
    assert.equal(hooksRes.success, true);
    assert.ok(hooksRes.hooksDir.endsWith('.custom-hooks'));
    assert.equal(fs.existsSync(path.join(dir, '.custom-hooks/pre-commit')), true);
    assert.equal(fs.existsSync(path.join(dir, '.custom-hooks/pre-merge-commit')), true);
    assert.equal(fs.existsSync(path.join(dir, '.custom-hooks/pre-push')), true);
  });
});

// ===========================================================================
// Audit hardening & base-branch alignment regressions
// ===========================================================================
describe('Audit hardening & base-branch alignment regressions', () => {
  let dir;
  beforeEach(() => {
    dir = makeRepo();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('guard verify succeeds without --branch on detached HEAD, main, and develop, while rejecting wrong --branch', () => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    assert.equal(git(dir, 'checkout', '-b', 'feature/detached-verify').status, 0);
    fs.writeFileSync(path.join(dir, 'src/mod.mjs'), 'export const ok = true;\n', 'utf8');
    assert.equal(git(dir, 'add', 'src/mod.mjs').status, 0);
    assert.equal(git(dir, 'commit', '-q', '-m', 'feat: add mod').status, 0);
    const featureSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    const receipt = issueGateReceipt({
      issueId: '#200',
      branch: 'feature/detached-verify',
      headSha: featureSha,
      lane: 'full',
      coveragePct: 95,
      mutationPct: 85,
      peerReviewApproved: true,
      reviewer: '@reviewer',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(receipt.success, true);

    assert.equal(git(dir, 'checkout', '--detach', featureSha).status, 0);
    const detachedCli = runCLI(['guard', 'verify', '--sha', featureSha], null, dir);
    assert.equal(detachedCli.success, true);
    assert.match(formatCLIResult(detachedCli, ['guard', 'verify']), /Verified Stage 7 gate receipt/i);

    assert.equal(git(dir, 'checkout', 'main').status, 0);
    const mainCli = runCLI(['guard', 'verify', '--sha', featureSha], null, dir);
    assert.equal(mainCli.success, true);

    assert.equal(git(dir, 'checkout', '-b', 'develop').status, 0);
    const developCli = runCLI(['guard', 'verify', '--sha', featureSha], null, dir);
    assert.equal(developCli.success, true);

    const wrongBranchCli = runCLI(['guard', 'verify', '--sha', featureSha, '--branch', 'feature/wrong'], null, dir);
    assert.equal(wrongBranchCli.success, false);
  });

  it('sdlc-quality-gate.yml, release.yml, and installCIWorkflow enforce --no-cache, safe receipt guards, and REST release fallback', () => {
    const wfInstall = installCIWorkflow({ repoRoot: dir, force: true });
    assert.equal(wfInstall.success, true);

    const gateWfPaths = [
      path.join(REPO_ROOT, '.github/workflows/sdlc-quality-gate.yml'),
      path.join(dir, '.github/workflows/sdlc-quality-gate.yml')
    ];
    for (const wfPath of gateWfPaths) {
      const content = fs.readFileSync(wfPath, 'utf8');
      assert.match(content, /sdlc-engine\.mjs gate --strict --no-cache/);
      const receiptStep = content.match(/- name: Verify Signed Stage 7 Gate Receipt[\s\S]*/)?.[0] || '';
      assert.ok(receiptStep.length > 0, `Expected Verify Signed Stage 7 Gate Receipt step in ${wfPath}`);
      assert.match(receiptStep, /if:\s*github\.event_name\s*==\s*'pull_request'/);
      assert.equal(receiptStep.includes("github.base_ref == 'main'"), false);
      assert.match(receiptStep, /PR_HEAD_SHA:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/);
      assert.match(receiptStep, /PR_HEAD_REPO:\s*\$\{\{\s*github\.event\.pull_request\.head\.repo\.full_name\s*\}\}/);
      assert.match(receiptStep, /BASE_REPO:\s*\$\{\{\s*github\.repository\s*\}\}/);
      assert.match(receiptStep, /\[\s*"\$PR_HEAD_REPO"\s*!=\s*"\$BASE_REPO"\s*\]/);
      assert.match(receiptStep, /\[\s*-z\s*"\$SDLC_RECEIPT_KEY"\s*\]/);
      assert.match(receiptStep, /::error::Missing SDLC_RECEIPT_KEY secret/);
      assert.match(receiptStep, /exit 1/);
      assert.equal(receiptStep.includes('.agent/.receipt-key'), false);
      assert.match(receiptStep, /guard verify --sha "\$PR_HEAD_SHA"/);
      assert.equal(receiptStep.includes('guard verify --sha "${{'), false);
    }

    const releaseWfPaths = [
      path.join(REPO_ROOT, '.github/workflows/release.yml'),
      path.join(dir, '.github/workflows/release.yml')
    ];
    for (const relPath of releaseWfPaths) {
      const content = fs.readFileSync(relPath, 'utf8');
      assert.match(content, /sdlc-engine\.mjs gate --strict --no-cache/);
      assert.match(content, /\/releases\/tags\//);
      assert.match(content, /res\.statusCode\s*===\s*422\s*&&\s*data\.includes\('already_exists'\)/);
    }
  });

  it('product-dag and pm-provider read modules[].thresholds.mutationScore from sdlc-config.json and list 9 Verb Skills', () => {
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.agent/sdlc-config.json'),
      JSON.stringify(
        {
          version: '1.0.0',
          modules: [{ name: 'root', path: '.', thresholds: { diffCoverage: 88, mutationScore: 52 } }]
        },
        null,
        2
      ),
      'utf8'
    );

    const initRes = productDagMod.initProductConstitution({
      title: 'Config Bars System',
      capabilities: [
        {
          id: 'CAP-01',
          title: 'Core Capability',
          problem: 'Problem',
          inputs: 'Input',
          processing: 'Process',
          outputs: 'Output'
        }
      ],
      autoProvisionGenesis: false,
      repoRoot: dir
    });
    assert.equal(initRes.success, true);

    const srsContent = fs.readFileSync(path.join(dir, 'docs/SRS.md'), 'utf8');
    assert.match(srsContent, /88%/);
    assert.match(srsContent, /52%/);
    assert.equal(srsContent.includes('80%'), false);
    assert.match(srsContent, /9 Verb Skills \(10 Canonical Skills\)/);
    assert.match(srsContent, /\/sdlc-wiki/);
    assert.equal(srsContent.includes('8 Verb Skills'), false);

    const specMd = productDagMod.renderCapabilitySpecMarkdown({
      capId: 'CAP-01',
      title: 'Core Capability',
      repoRoot: dir
    });
    assert.match(specMd, />=\s*88%/);
    assert.match(specMd, />=\s*52%/);
    assert.equal(specMd.includes('80%'), false);

    const untemplatedIssue = pmMod.formatTemplatedIssue({
      title: 'Add config bar support',
      type: 'feat',
      repoRoot: dir
    });
    assert.match(untemplatedIssue.body, />= 88% diff test coverage, >= 52% mutation/);

    fs.mkdirSync(path.join(dir, '.github/ISSUE_TEMPLATE'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.github/ISSUE_TEMPLATE/feature_request.md'),
      [
        '---',
        'name: Feature Request',
        'labels: enhancement',
        '---',
        'A clear and concise description of what the problem is.',
        'A clear and concise description of what you want to happen.',
        '- [ ] Diff line coverage `>= 85%` and configured mutation score (`.agent/sdlc-config.json`)'
      ].join('\n'),
      'utf8'
    );
    const templatedIssue = pmMod.formatTemplatedIssue({
      title: 'Add config bar support',
      type: 'feat',
      repoRoot: dir
    });
    assert.match(templatedIssue.body, /`>= 88%` and `>= 52%` mutation score/);
  });

  it('generateRegressionProof distinguishes verified UI/API proofs from unverified fallback or sample entries', () => {
    fs.mkdirSync(path.join(dir, 'src/components'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/components/PresentView.svelte'), '<main>Present</main>\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'src/api-sample.json'), JSON.stringify({ ok: true }), 'utf8');

    const res = qualityGateMod.generateRegressionProof({
      targetName: 'proof-check',
      apiEndpoints: [
        { method: 'GET', path: '/api/no-sample' },
        { method: 'GET', path: '/api/with-sample', sampleResponse: { ok: true } },
        { method: 'GET', path: '/api/with-file', file: 'src/api-sample.json' }
      ],
      uiRoutes: [
        { path: '/missing', component: 'MissingView' },
        { path: '/present', component: 'PresentView', file: 'src/components/PresentView.svelte' }
      ],
      repoRoot: dir
    });

    assert.equal(res.success, true);
    assert.equal(res.apiProofs[0].verified, false);
    assert.equal(res.apiProofs[1].verified, false);
    assert.equal(res.apiProofs[1].source, 'sample');
    assert.equal(res.apiProofs[2].verified, true);
    assert.equal(res.uiProofs[0].verified, false);
    assert.equal(res.uiProofs[0].sourceFile, null);
    assert.equal(res.uiProofs[1].verified, true);
    assert.equal(res.uiProofs[1].sourceFile, 'src/components/PresentView.svelte');

    const proofMd = fs.readFileSync(res.proofFilePath, 'utf8');
    assert.match(proofMd, /`\/api\/no-sample`.*⚠️ UNVERIFIED \(fallback\)/);
    assert.match(proofMd, /`\/api\/with-sample`.*⚠️ SAMPLE \(not probed\)/);
    assert.match(proofMd, /`\/api\/with-file`.*✅ VERIFIED/);
    assert.match(proofMd, /`\/missing`.*⚠️ UNVERIFIED \(fallback\)/);
    assert.match(proofMd, /`\/present`.*✅ VERIFIED/);

    const emptyRes = qualityGateMod.generateRegressionProof({ targetName: 'empty-proof', repoRoot: dir });
    assert.match(emptyRes.markdown, /⚠️ SAMPLE \(not probed\)/);
  });

  it('generateReviewPlan targets develop instead of hardcoding main when develop branch exists', () => {
    assert.equal(git(dir, 'checkout', '-b', 'develop').status, 0);
    fs.mkdirSync(path.join(dir, 'src/auth'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/base.mjs'), 'export const base = 1;\n', 'utf8');
    assert.equal(git(dir, 'add', 'src/base.mjs').status, 0);
    assert.equal(git(dir, 'commit', '-q', '-m', 'chore: base develop commit').status, 0);

    assert.equal(git(dir, 'checkout', '-b', 'feature/review-develop').status, 0);
    fs.writeFileSync(path.join(dir, 'src/auth/jwt-verifier.mjs'), 'export function verifyJwtSignature() { return true; }\n', 'utf8');
    assert.equal(git(dir, 'add', 'src/auth/jwt-verifier.mjs').status, 0);
    assert.equal(git(dir, 'commit', '-q', '-m', 'feat: add jwt verifier').status, 0);

    writeSession(dir, { issueId: '#201', branch: 'feature/review-develop', lane: 'full' });

    const plan = generateReviewPlan({ repoRoot: dir, lane: 'full' });
    assert.equal(plan.subagentsCount, 3);
    for (const sub of plan.payload.Subagents) {
      assert.match(sub.Prompt, /develop/);
      assert.equal(sub.Prompt.includes('against main'), false);
    }
  });

  it('workbench-server removes inline onclick handlers on dynamic node IDs and delegates via data-node-id', () => {
    fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.agent/decision-graph.jsonl'),
      JSON.stringify({ type: 'CAPABILITY_REGISTERED', id: 'CAP-"\'\\01', label: 'Node with quotes', category: 'CAPABILITY', status: 'ACTIVE' }) + '\n',
      'utf8'
    );

    const workbenchHtml = workbenchMod.renderWorkbenchHTML(dir);
    const widgetRes = workbenchMod.generateArchitectureWidget({ repoRoot: dir, writeDefault: false });

    for (const rendered of [workbenchHtml, widgetRes.html]) {
      assert.match(rendered, /data-node-id="/);
      assert.match(rendered, /\.closest\('\[data-node-id\]'\)/);
      assert.equal(rendered.includes('onclick="inspectNode('), false);
      assert.equal(rendered.includes('onclick="selectLineageNode('), false);
    }
  });

  it('verifyGateReceipt rejects subsequent .agent/workbench/ commits and .gitignore excludes .agent/.audit-chain.lock', () => {
    const gitignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
    assert.match(gitignore, /^\.agent\/\.audit-chain\.lock$/m);

    assert.equal(git(dir, 'checkout', '-b', 'feature/workbench-tamper').status, 0);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/ok.mjs'), 'export const ok = true;\n', 'utf8');
    assert.equal(git(dir, 'add', 'src/ok.mjs').status, 0);
    assert.equal(git(dir, 'commit', '-q', '-m', 'feat: initial commit').status, 0);
    const receiptSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    const receipt = issueGateReceipt({
      issueId: '#202',
      branch: 'feature/workbench-tamper',
      headSha: receiptSha,
      lane: 'full',
      coveragePct: 95,
      mutationPct: 85,
      peerReviewApproved: true,
      reviewer: '@reviewer',
      driftCheckPassed: true,
      repoRoot: dir
    });
    assert.equal(receipt.success, true);

    fs.mkdirSync(path.join(dir, '.agent/workbench'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.agent/workbench/injected.js'), 'console.log("pwn");\n', 'utf8');
    assert.equal(git(dir, 'add', '-f', '.agent/workbench/injected.js').status, 0);
    assert.equal(git(dir, 'commit', '-q', '-m', 'chore: modify workbench file after receipt').status, 0);
    const postReceiptSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    const verified = verifyGateReceipt({ headSha: postReceiptSha, branch: 'feature/workbench-tamper', repoRoot: dir });
    assert.equal(verified.valid, false);

    assert.equal(git(dir, 'add', '-f', '.agent/.receipt-key').status, 0);
    assert.equal(auditChainMod.loadReceiptKey(dir), null);
    const verifiedWithCommittedKey = verifyGateReceipt({
      headSha: receiptSha,
      branch: 'feature/workbench-tamper',
      repoRoot: dir
    });
    assert.equal(verifiedWithCommittedKey.valid, false);
  });

  it('hasDevelopBranch reflects packed and deleted develop refs immediately without timestamp caching', () => {
    assert.equal(coreMod.hasDevelopBranch(dir), false);
    assert.equal(git(dir, 'checkout', '-b', 'develop').status, 0);
    assert.equal(coreMod.hasDevelopBranch(dir), true);

    assert.equal(git(dir, 'pack-refs', '--all').status, 0);
    assert.equal(coreMod.hasDevelopBranch(dir), true);

    assert.equal(git(dir, 'checkout', 'main').status, 0);
    assert.equal(git(dir, 'branch', '-D', 'develop').status, 0);
    assert.equal(coreMod.hasDevelopBranch(dir), false);
  });
});
