import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createTempGitRepo, withoutReceiptEnv } from '../helpers/test-harness.mjs';
import {
  CANONICAL_SKILLS,
  RETIRED_SKILLS,
  SUPPORTED_AGENTS,
  auditSkills,
  installCIWorkflow,
  runDoctor,
  installFramework
} from '../../.agent/scripts/lib/install.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

function createSourceBundleFixture() {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-src-bundle-'));
  fs.mkdirSync(path.join(srcDir, '.agent/scripts/lib'), { recursive: true });
  fs.mkdirSync(path.join(srcDir, '.agent/schemas'), { recursive: true });
  fs.writeFileSync(path.join(srcDir, '.agent/scripts/sdlc-engine.mjs'), '#!/usr/bin/env node\nexport const ok = true;\n', 'utf8');
  fs.writeFileSync(path.join(srcDir, '.agent/scripts/lib/git.mjs'), 'export const g = 1;\n', 'utf8');
  fs.writeFileSync(path.join(srcDir, '.agent/schemas/sdlc-config.schema.json'), '{"type":"object"}\n', 'utf8');

  for (const id of CANONICAL_SKILLS) {
    const sDir = path.join(srcDir, '.agent/skills', id);
    fs.mkdirSync(sDir, { recursive: true });
    fs.writeFileSync(
      path.join(sDir, 'SKILL.md'),
      `---\nname: ${id}\ndescription: "Use when testing ${id} skill behavior. Not for unrelated tasks."\n---\n\n# ${id}\n\nRun \`node .agent/scripts/sdlc-engine.mjs status\` or call \`invoke_subagent\`.\n`,
      'utf8'
    );
  }
  return {
    srcDir,
    cleanup: () => fs.rmSync(srcDir, { recursive: true, force: true })
  };
}

describe('Ring 2: lib/install.mjs', () => {
  it('exposes the 6 canonical skills and 5 supported agent targets and audits skill hygiene', () => {
    assert.deepEqual(CANONICAL_SKILLS, ['sdlc', 'sdlc-spec', 'sdlc-adr', 'sdlc-tdd', 'sdlc-gate', 'sdlc-flow']);
    assert.deepEqual(SUPPORTED_AGENTS, ['antigravity', 'claude', 'cursor', 'codex', 'copilot']);
    assert.equal(RETIRED_SKILLS.includes('sdlc-wiki'), true);

    const { srcDir, cleanup } = createSourceBundleFixture();
    cleanups.push(cleanup);

    const okAudit = auditSkills(srcDir);
    assert.equal(okAudit.passed, true);
    assert.equal(okAudit.skillsCount, 6);

    // Unpinned third-party npx and cross-skill path trigger findings
    fs.writeFileSync(
      path.join(srcDir, '.agent/skills/sdlc/SKILL.md'),
      '---\nname: sdlc\ndescription: "Missing trigger phrase"\n---\nRun `npx some-unpinned-tool` and see [other](../sdlc-gate/SKILL.md).\n',
      'utf8'
    );
    const badAudit = auditSkills(srcDir);
    assert.equal(badAudit.passed, false);
    assert.ok(badAudit.findings.some((f) => f.rule === 'FM2'));
    assert.ok(badAudit.findings.some((f) => f.rule === 'RP1'));
    assert.ok(badAudit.findings.some((f) => f.rule === 'AS3'));
  });

  it('runDoctor reports receipt key status and doctor --fix preserves custom config while upgrading legacy v0.0.x CI workflow', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);
    const src = createSourceBundleFixture();
    cleanups.push(src.cleanup);

    withoutReceiptEnv(() => {
      // Copy canonical skills into dir so auditSkills passes
      fs.cpSync(path.join(src.srcDir, '.agent/skills'), path.join(dir, '.agent/skills'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.agent/.receipt-key'), 'secret-key-hex\n', { mode: 0o600 });

      // Write custom threshold (diffCoverage: 93) and legacy v0.0.x workflow missing --branch "$GITHUB_HEAD_REF"
      fs.writeFileSync(
        path.join(dir, '.agent/sdlc-config.json'),
        JSON.stringify({
          version: '0.1.0',
          archlens: { enabled: true, policyPath: '.archlens/policy.json' },
          modules: [{ name: 'custom', path: '.', commands: { test: 'node --test "tests/**/*.test.mjs"' }, thresholds: { diffCoverage: 93, mutationScore: null } }]
        }),
        'utf8'
      );
      fs.mkdirSync(path.join(dir, '.github/workflows'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.github/workflows/sdlc-quality-gate.yml'),
        'name: Legacy\njobs:\n  q:\n    steps:\n      - run: node .agent/scripts/sdlc-engine.mjs gate --strict --no-cache\n      - run: node .agent/scripts/sdlc-engine.mjs guard verify --sha "$PR_HEAD_SHA"\n',
        'utf8'
      );

      const diagBefore = runDoctor({ repoRoot: dir, fix: false });
      assert.equal(diagBefore.receiptKey.source, 'file');
      assert.equal(diagBefore.receiptKey.usable, true);
      assert.ok(diagBefore.receiptKey.ciSecretHint.includes('gh secret set SDLC_RECEIPT_KEY'));
      assert.equal(diagBefore.hooks.upToDate, false);

      const healed = runDoctor({ repoRoot: dir, fix: true });
      assert.equal(healed.passed, true);
      assert.equal(healed.hooks.upToDate, true);

      // Custom threshold 93 preserved (never clobbered with 85!)
      const preservedCfg = JSON.parse(fs.readFileSync(path.join(dir, '.agent/sdlc-config.json'), 'utf8'));
      assert.equal(preservedCfg.modules[0].name, 'custom');
      assert.equal(preservedCfg.modules[0].thresholds.diffCoverage, 93);

      // Legacy workflow upgraded with self-hosted runner guard and --branch "$GITHUB_HEAD_REF"
      const wf = fs.readFileSync(path.join(dir, '.github/workflows/sdlc-quality-gate.yml'), 'utf8');
      assert.match(wf, /runner\.environment == 'github-hosted'/);
      assert.match(wf, /--branch "\$GITHUB_HEAD_REF"/);
      assert.match(wf, /SDLC_RECEIPT_KEY: ci-dummy-test-key/);
    });
  });

  it('installFramework honors POSIX homeDir in --global mode, unlinks symlinks safely, preserves malformed .claude/settings.json, and prunes retired sdlc-* skills only', async () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);
    const src = createSourceBundleFixture();
    cleanups.push(src.cleanup);
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-fake-home-'));
    cleanups.push(() => fs.rmSync(fakeHome, { recursive: true, force: true }));

    // 1. Pre-plant a symlink at .claude/skills/sdlc/SKILL.md pointing to an outside victim file
    const victimFile = path.join(fakeHome, 'victim.txt');
    fs.writeFileSync(victimFile, 'DO_NOT_OVERWRITE', 'utf8');
    fs.mkdirSync(path.join(dir, '.claude/skills/sdlc'), { recursive: true });
    fs.symlinkSync(victimFile, path.join(dir, '.claude/skills/sdlc/SKILL.md'));

    // 2. Pre-plant a retired sdlc-wiki skill AND a user-owned custom-skill
    fs.mkdirSync(path.join(dir, '.claude/skills/sdlc-wiki'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude/skills/sdlc-wiki/SKILL.md'), 'old', 'utf8');
    fs.mkdirSync(path.join(dir, '.claude/skills/my-custom-skill'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude/skills/my-custom-skill/SKILL.md'), 'keep me', 'utf8');

    // 3. Pre-plant malformed .claude/settings.json
    fs.writeFileSync(path.join(dir, '.claude/settings.json'), '{malformed-json', 'utf8');

    const localRes = await installFramework({
      targetDir: dir,
      sourceRoot: src.srcDir,
      agents: ['claude', 'cursor'],
      yes: true
    });
    // Victim file untouched because symlink was unlinked before write!
    assert.equal(fs.readFileSync(victimFile, 'utf8'), 'DO_NOT_OVERWRITE');
    assert.equal(fs.lstatSync(path.join(dir, '.claude/skills/sdlc/SKILL.md')).isSymbolicLink(), false);
    // Retired sdlc-wiki pruned; user my-custom-skill untouched!
    assert.equal(fs.existsSync(path.join(dir, '.claude/skills/sdlc-wiki')), false);
    assert.equal(fs.readFileSync(path.join(dir, '.claude/skills/my-custom-skill/SKILL.md'), 'utf8'), 'keep me');
    // Malformed .claude/settings.json NOT overwritten with {} and flagged in warnings/errors!
    assert.equal(fs.readFileSync(path.join(dir, '.claude/settings.json'), 'utf8'), '{malformed-json');
    assert.ok(localRes.warnings.some((w) => /settings\.json/i.test(w)));
    // Cursor gets .cursor/skills/sdlc* + single .cursor/rules/agentic-sdlc.mdc (zero duplicate sdlc-*.mdc files!)
    assert.equal(fs.existsSync(path.join(dir, '.cursor/skills/sdlc-gate/SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(dir, '.cursor/rules/agentic-sdlc.mdc')), true);
    assert.equal(fs.existsSync(path.join(dir, '.cursor/rules/sdlc-gate.mdc')), false);

    // 4. Global install with custom homeDir uses custom homeDir path in global skill commands!
    const globalRes = await installFramework({
      targetDir: dir,
      sourceRoot: src.srcDir,
      agents: ['claude'],
      globalMode: true,
      homeDir: fakeHome,
      yes: true
    });
    assert.equal(globalRes.success, true);
    const globalSkill = fs.readFileSync(path.join(fakeHome, '.claude/skills/sdlc/SKILL.md'), 'utf8');
    assert.equal(globalSkill.includes(path.join(fakeHome, '.agentic-sdlc/scripts/sdlc-engine.mjs')), true);
    assert.equal(fs.existsSync(path.join(fakeHome, '.claude/CLAUDE.md')), true);
  });

  it('drives interactive onboarding wizard via injected input/output streams without a real TTY', async () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);
    const src = createSourceBundleFixture();
    cleanups.push(src.cleanup);

    const input = new PassThrough();
    const output = new PassThrough();
    let capturedOut = '';
    output.on('data', (chunk) => {
      capturedOut += chunk.toString('utf8');
    });

    const installPromise = installFramework({
      targetDir: dir,
      sourceRoot: src.srcDir,
      yes: false,
      input,
      output
    });
    input.write('claude,antigravity\n');
    input.end();

    const res = await installPromise;
    assert.equal(res.success, true);
    assert.match(capturedOut, /Select AI agents/i);
    assert.equal(fs.existsSync(path.join(dir, '.claude/skills/sdlc-flow/SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(dir, '.agent/skills/sdlc-flow/SKILL.md')), true);
  });
});
