import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkArchRings } from '../../.agent/scripts/lib/drift.mjs';
import { auditSkills, CANONICAL_SKILLS } from '../../.agent/scripts/lib/install.mjs';
import { validateConfigFile } from '../../.agent/scripts/lib/config.mjs';
import { verifyAuditChain } from '../../.agent/scripts/lib/receipt.mjs';
import { runCLI, readPackageVersion } from '../../.agent/scripts/sdlc-engine.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const EXPECTED_RUNTIME_FILES = [
  '.agent/scripts/sdlc-engine.mjs',
  '.agent/scripts/lib/config.mjs',
  '.agent/scripts/lib/drift.mjs',
  '.agent/scripts/lib/git.mjs',
  '.agent/scripts/lib/guard.mjs',
  '.agent/scripts/lib/install.mjs',
  '.agent/scripts/lib/measure.mjs',
  '.agent/scripts/lib/receipt.mjs'
];

function walkJsFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsFiles(full, base));
    else if (/\.[cm]?[jt]s$/i.test(entry.name)) out.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return out.sort();
}

describe('v0.1.0 Structural & Governance Invariants', () => {
  it('Invariant 1: Exact 8-file runtime kernel, every file < 850 LOC, and 0 Archlens ring or cycle violations', () => {
    const actualFiles = walkJsFiles(path.join(REPO_ROOT, '.agent/scripts'), REPO_ROOT);
    assert.deepEqual(actualFiles, [...EXPECTED_RUNTIME_FILES].sort());
    assert.equal(fs.existsSync(path.join(REPO_ROOT, '.agent/scripts/workbench-assets')), false);

    for (const rel of EXPECTED_RUNTIME_FILES) {
      const lines = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').split('\n').length;
      assert.ok(lines <= 850, `Expected ${rel} <= 850 lines, got ${lines}`);
    }

    const arch = checkArchRings({ repoRoot: REPO_ROOT });
    assert.equal(arch.passed, true, JSON.stringify(arch.violations));
  });

  it('Invariant 2: Package metadata, Node >=22 floor, zero runtime deps, valid dogfood config, and Claude plugin packaging', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.version, '0.2.0');
    assert.equal(readPackageVersion('/nonexistent/sdlc-missing/scripts'), pkg.version);
    assert.equal(pkg.engines?.node, '>=22.0.0');
    assert.deepEqual(pkg.dependencies || {}, {});
    assert.match(pkg.scripts.test, /tests\/\*\*\/\*\.test\.mjs/);

    for (const f of pkg.files) {
      assert.equal(fs.existsSync(path.join(REPO_ROOT, f)), true, `package.json files entry missing on disk: ${f}`);
    }

    const pluginJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.claude-plugin/plugin.json'), 'utf8'));
    assert.equal(pluginJson.version, '0.2.0');
    assert.deepEqual(pluginJson.skills, CANONICAL_SKILLS.map((s) => `./.agent/skills/${s}`));
    for (const s of CANONICAL_SKILLS) {
      assert.equal(fs.existsSync(path.join(REPO_ROOT, `.agent/skills/${s}/agents/openai.yaml`)), true, `Missing openai.yaml for ${s}`);
    }

    const cfgCheck = validateConfigFile(REPO_ROOT);
    assert.equal(cfgCheck.valid, true, cfgCheck.errors.join('; '));
    assert.deepEqual(cfgCheck.warnings, []);
  });

  it('Invariant 3: Canonical 6 skills pass skill-audit and zero vendored/mirrored bloat remains tracked in git', () => {
    const skillsRes = auditSkills(REPO_ROOT);
    assert.equal(skillsRes.passed, true, JSON.stringify(skillsRes.findings));
    assert.equal(skillsRes.skillsCount, CANONICAL_SKILLS.length);

    for (const s of CANONICAL_SKILLS) {
      const raw = fs.readFileSync(path.join(REPO_ROOT, `.agent/skills/${s}/SKILL.md`), 'utf8');
      assert.doesNotMatch(raw, /^tools:/m, `Unexpected non-portable tools: frontmatter in ${s}`);
      assert.doesNotMatch(raw, /invoke_subagent/, `Unexpected Antigravity-only invoke_subagent token in ${s}`);
      assert.match(raw, /\.agent\/sdlc-config\.json/, `Expected kernel check on .agent/sdlc-config.json in ${s}`);
      if (s === 'sdlc-gate' || s === 'sdlc-flow') {
        assert.match(raw, /\/sdlc init/, `Expected /sdlc init stop-and-offer in ${s}`);
      }
    }

    const tracked = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);

    const forbiddenPrefixes = [
      '.agent/skills/impeccable/',
      '.agent/workbench/',
      '.agent/skills/sdlc-doctor/',
      '.agent/skills/sdlc-product/',
      '.agent/skills/sdlc-release/',
      '.agent/skills/sdlc-status/',
      '.agent/skills/sdlc-wiki/',
      '.claude/skills/',
      '.claude/agents/impeccable',
      '.claude/cowork/',
      '.cursor/skills/',
      '.cursor/agents/impeccable',
      '.cursor/rules/',
      '.github/skills/impeccable/',
      '.github/agents/impeccable',
      '.impeccable/',
      'wiki/',
      'docs/KANBAN.md',
      'docs/DECISION_MAP.md',
      'docs/ARCH_TRACE.md',
      '.github/workflows/enforce-branch-flow.yml',
      '.github/workflows/publish-wiki.yml'
    ];
    for (const t of tracked) {
      for (const bad of forbiddenPrefixes) {
        assert.equal(t === bad || t.startsWith(bad), false, `Forbidden legacy/mirrored file still tracked in git: ${t}`);
      }
    }
  });

  it('Invariant 4: Workflows enforce self-hosted runner policy, main-branch release receipt guard, and env-isolated tests', async () => {
    const qg = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/sdlc-quality-gate.yml'), 'utf8');
    const cfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.agent/sdlc-config.json'), 'utf8'));
    assert.equal(qg.includes(`runs-on: ${cfg.ci.runsOn}`), true);
    assert.match(qg, /runner\.environment == 'github-hosted'/);
    assert.match(qg, /--branch "\$GITHUB_HEAD_REF"/);
    assert.match(qg, /SDLC_RECEIPT_KEY: ci-dummy-test-key/);
    assert.match(qg, /git archive "origin\/\$BASE_REF"/);
    const { buildQualityGateWorkflow } = await import('../../.agent/scripts/lib/install.mjs');
    assert.equal(qg, buildQualityGateWorkflow({ runsOn: cfg.ci.runsOn, checkName: cfg.ci.checkName, repoRoot: REPO_ROOT }), 'repo workflow must equal the generator output');

    const rel = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/release.yml'), 'utf8');
    assert.equal(rel.includes(`runs-on: ${cfg.ci.runsOn}`), true);
    assert.match(rel, /runner\.environment == 'github-hosted'/);
    assert.match(rel, /refs\/heads\/main/);
    assert.match(rel, /sdlc-engine\.mjs verify/);

    // Audit #10: Active docs/skills/specs never claim Audit Ledger is a Merkle tree
    for (const docRel of ['README.md', 'PRODUCT.md', 'CONTRIBUTING.md', 'docs/PRD.md']) {
      const docTxt = fs.readFileSync(path.join(REPO_ROOT, docRel), 'utf8');
      assert.equal(/\bMerkle\b/i.test(docTxt), false, `Unexpected 'Merkle' terminology in ${docRel}`);
    }
  });

  it('Invariant 5: Read-only CLI commands never mutate process.env or dirty git status, and audit chain is intact', async () => {
    const envBefore = JSON.stringify(process.env);
    const statusBefore = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' });

    for (const args of [['help'], ['status', '--json'], ['doctor', '--json'], ['skill-audit', '--json'], ['verify', '--chain-only', '--json']]) {
      const res = await runCLI(args, null, REPO_ROOT);
      assert.equal(typeof res, 'object');
    }

    const statusAfter = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.equal(statusAfter, statusBefore);
    assert.equal(JSON.stringify(process.env), envBefore);

    const chain = verifyAuditChain(REPO_ROOT);
    assert.equal(chain.valid, true, chain.error);
    assert.ok(chain.gateReceiptsCount >= 40);
  });
});
