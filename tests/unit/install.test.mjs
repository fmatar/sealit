import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createTempGitRepo, git, withoutReceiptEnv } from '../helpers/test-harness.mjs';
import { hasDirtyNonGovernanceFiles } from '../../.agent/scripts/lib/git.mjs';
import { beginSession } from '../../.agent/scripts/lib/guard.mjs';
import {
  CANONICAL_SKILLS,
  RETIRED_SKILLS,
  SUPPORTED_AGENTS,
  SDLC_GITIGNORE_ENTRIES,
  upsertGitignore,
  auditSkills,
  installCIWorkflow,
  scaffoldArchlensPolicy,
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

      // Legacy workflow upgraded with self-hosted runner guard, fork PR block, trusted base archive, and guard verify --sha ... --branch "$GITHUB_HEAD_REF"
      const wf = fs.readFileSync(path.join(dir, '.github/workflows/sdlc-quality-gate.yml'), 'utf8');
      assert.match(wf, /runner\.environment == 'github-hosted'/);
      assert.match(wf, /guard verify --sha "\$PR_HEAD_SHA" --branch "\$GITHUB_HEAD_REF"/);
      assert.match(wf, /guard verify --sha "\$PR_HEAD_SHA"$/m);
      assert.match(wf, /SDLC_RECEIPT_KEY: ci-dummy-test-key/);
      assert.match(wf, /git archive "origin\/\$BASE_REF"/);

      // 0-byte .agent/.receipt-key fails runDoctor instead of reporting HEALTHY
      fs.writeFileSync(path.join(dir, '.agent/.receipt-key'), '', { mode: 0o600 });
      const emptyKeyDoc = runDoctor({ repoRoot: dir, fix: false });
      assert.equal(emptyKeyDoc.passed, false);
      assert.match(emptyKeyDoc.receiptKey.error || '', /empty/i);
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
      agents: ['claude', 'cursor', 'codex', 'copilot'],
      yes: true
    });
    assert.equal(localRes.success, true);
    assert.equal(localRes.globalMode, false);
    assert.equal(fs.existsSync(path.join(dir, '.codex/skills/sdlc/SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(dir, '.github/copilot-instructions.md')), true);
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

    // 5. Parent-directory symlink (.cursor -> outsideDir) inside targetDir is refused/unlinked without writing into outsideDir!
    const symTargetRepo = createTempGitRepo();
    cleanups.push(symTargetRepo.cleanup);
    const outsideVictimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-parent-sym-'));
    cleanups.push(() => fs.rmSync(outsideVictimDir, { recursive: true, force: true }));
    fs.symlinkSync(outsideVictimDir, path.join(symTargetRepo.dir, '.cursor'));
    await assert.rejects(
      () => installFramework({ targetDir: symTargetRepo.dir, sourceRoot: src.srcDir, agents: ['cursor'], yes: true }),
      /symlink/i
    );
    assert.equal(fs.existsSync(path.join(outsideVictimDir, 'skills')), false);

    // 6. auditSkills catches missing dir, bad frontmatter, >160 lines, unpinned npx, and cross-skill relative links
    const badSkillRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-bad-skills-'));
    cleanups.push(() => fs.rmSync(badSkillRepo, { recursive: true, force: true }));
    assert.equal(auditSkills(badSkillRepo).passed, false);
    fs.mkdirSync(path.join(badSkillRepo, '.agent/skills/sdlc'), { recursive: true });
    fs.writeFileSync(
      path.join(badSkillRepo, '.agent/skills/sdlc/SKILL.md'),
      `---\nname: wrong\ndescription: "Bad desc"\n---\nRun npx cowsay hi and see ../sdlc-flow/SKILL.md\n${'line\n'.repeat(165)}`,
      'utf8'
    );
    const badAudit = auditSkills(badSkillRepo);
    assert.equal(badAudit.passed, false);
    assert.ok(badAudit.findings.some((f) => f.rule === 'FM1'));
    assert.ok(badAudit.findings.some((f) => f.rule === 'FM2'));
    assert.ok(badAudit.findings.some((f) => f.rule === 'LEN1'));
    assert.ok(badAudit.findings.some((f) => f.rule === 'RP1'));
    assert.ok(badAudit.findings.some((f) => f.rule === 'AS3'));
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

    // Second install updates marked rules block in-place (zero duplication), skips up-to-date workflow/policy unless --force, and preserves tools: only on antigravity
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), `# Custom Header\n\n${fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')}`, 'utf8');
    await installFramework({ targetDir: dir, sourceRoot: src.srcDir, agents: ['all'], yes: true });
    const agentsMd = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    assert.ok(agentsMd.startsWith('# Custom Header'));
    assert.equal((agentsMd.match(/AGENTIC-SDLC-RULES:START/g) || []).length, 1);
    assert.match(fs.readFileSync(path.join(dir, '.claude/skills/sdlc/SKILL.md'), 'utf8'), /\bTask\b/);
    assert.match(fs.readFileSync(path.join(dir, '.cursor/skills/sdlc/SKILL.md'), 'utf8'), /\bsubagent\b/);

    const wfSkip = installCIWorkflow({ repoRoot: dir, force: false });
    assert.equal(wfSkip.skipped, true);
    assert.equal(wfSkip.installed, false);
    const wfForce = installCIWorkflow({ repoRoot: dir, force: true });
    assert.equal(wfForce.upgraded, true);
    assert.equal(scaffoldArchlensPolicy(dir, { force: false }).created, false);
    assert.equal(scaffoldArchlensPolicy(dir, { force: true }).created, true);
  });

  it('installFramework updates the real file behind in-repo CLAUDE.md <-> AGENTS.md symlinks and global homeDir symlinks while replacing external symlinks with warning', async () => {
    const src = createSourceBundleFixture();
    cleanups.push(src.cleanup);

    // 1. In-repo CLAUDE.md -> AGENTS.md
    const r1 = createTempGitRepo();
    cleanups.push(r1.cleanup);
    fs.writeFileSync(path.join(r1.dir, 'AGENTS.md'), '# My rules\nAlways use tabs.\n', 'utf8');
    fs.symlinkSync('AGENTS.md', path.join(r1.dir, 'CLAUDE.md'));
    const res1 = await installFramework({ targetDir: r1.dir, sourceRoot: src.srcDir, agents: ['claude'], yes: true });
    assert.equal(res1.success, true);
    assert.equal(fs.lstatSync(path.join(r1.dir, 'CLAUDE.md')).isSymbolicLink(), true);
    const agentsText1 = fs.readFileSync(path.join(r1.dir, 'AGENTS.md'), 'utf8');
    assert.match(agentsText1, /Always use tabs\./);
    assert.equal((agentsText1.match(/AGENTIC-SDLC-RULES:START/g) || []).length, 1);

    // 2. Reverse: AGENTS.md -> CLAUDE.md
    const r2 = createTempGitRepo();
    cleanups.push(r2.cleanup);
    fs.writeFileSync(path.join(r2.dir, 'CLAUDE.md'), '# My claude rules\nAlways use spaces.\n', 'utf8');
    fs.symlinkSync('CLAUDE.md', path.join(r2.dir, 'AGENTS.md'));
    const res2 = await installFramework({ targetDir: r2.dir, sourceRoot: src.srcDir, agents: ['claude'], yes: true });
    assert.equal(res2.success, true);
    assert.equal(fs.lstatSync(path.join(r2.dir, 'AGENTS.md')).isSymbolicLink(), true);
    const claudeText2 = fs.readFileSync(path.join(r2.dir, 'CLAUDE.md'), 'utf8');
    assert.match(claudeText2, /Always use spaces\./);
    assert.equal((claudeText2.match(/AGENTIC-SDLC-RULES:START/g) || []).length, 1);

    // 3. Global mode: homeDir/.claude/CLAUDE.md -> homeDir/dotfiles/CLAUDE.md
    const r3 = createTempGitRepo();
    cleanups.push(r3.cleanup);
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-sym-home-'));
    cleanups.push(() => fs.rmSync(homeDir, { recursive: true, force: true }));
    fs.mkdirSync(path.join(homeDir, 'dotfiles'), { recursive: true });
    fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(homeDir, 'dotfiles/CLAUDE.md'), '# Dotfile rules\nKeep me.\n', 'utf8');
    fs.symlinkSync(path.join(homeDir, 'dotfiles/CLAUDE.md'), path.join(homeDir, '.claude/CLAUDE.md'));
    const res3 = await installFramework({ targetDir: r3.dir, sourceRoot: src.srcDir, agents: ['claude'], globalMode: true, homeDir, yes: true });
    assert.equal(res3.success, true);
    assert.equal(fs.lstatSync(path.join(homeDir, '.claude/CLAUDE.md')).isSymbolicLink(), true);
    const dotText = fs.readFileSync(path.join(homeDir, 'dotfiles/CLAUDE.md'), 'utf8');
    assert.match(dotText, /# Dotfile rules/);
    assert.equal((dotText.match(/AGENTIC-SDLC-RULES:START/g) || []).length, 1);

    // 4. Out-of-repo CLAUDE.md symlink is replaced with a regular file and warns
    const r4 = createTempGitRepo();
    cleanups.push(r4.cleanup);
    const outsideVictim = path.join(homeDir, 'outside-claude.md');
    fs.writeFileSync(outsideVictim, 'OUTSIDE_UNTOUCHED', 'utf8');
    fs.symlinkSync(outsideVictim, path.join(r4.dir, 'CLAUDE.md'));
    const res4 = await installFramework({ targetDir: r4.dir, sourceRoot: src.srcDir, agents: ['claude'], yes: true });
    assert.equal(res4.success, true);
    assert.equal(fs.lstatSync(path.join(r4.dir, 'CLAUDE.md')).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(outsideVictim, 'utf8'), 'OUTSIDE_UNTOUCHED');
    assert.ok(res4.warnings.some((w) => /Replaced symlink/.test(w)));
  });

  it('installFramework and runDoctor provision and audit managed .gitignore entries idempotently without dirtying fresh repos', async () => {
    const src = createSourceBundleFixture();
    cleanups.push(src.cleanup);

    // 1. CRLF preservation & idempotency
    const r1 = createTempGitRepo();
    cleanups.push(r1.cleanup);
    git(r1.dir, 'rm', '-q', '.gitignore');
    git(r1.dir, 'commit', '-qm', 'chore: remove harness gitignore');
    fs.writeFileSync(path.join(r1.dir, '.gitignore'), 'dist/\r\n', 'utf8');
    await installFramework({ targetDir: r1.dir, sourceRoot: src.srcDir, agents: ['claude'], yes: true });
    await installFramework({ targetDir: r1.dir, sourceRoot: src.srcDir, agents: ['claude'], yes: true });
    const raw1 = fs.readFileSync(path.join(r1.dir, '.gitignore'), 'utf8');
    assert.match(raw1, /\r\n/);
    const lines1 = raw1.split(/\r?\n/).map((l) => l.trim());
    assert.ok(lines1.includes('dist/'));
    for (const entry of SDLC_GITIGNORE_ENTRIES) {
      assert.equal(lines1.filter((l) => l === entry).length, 1, `Expected single entry ${entry}`);
    }
    assert.equal(git(r1.dir, 'check-ignore', '-q', '.agent/.receipt-key').status, 0);

    // 2. Fresh repo without .gitignore stays clean after init -> begin -> commit code
    const r2 = createTempGitRepo();
    cleanups.push(r2.cleanup);
    git(r2.dir, 'rm', '-q', '.gitignore');
    git(r2.dir, 'commit', '-qm', 'chore: fresh repo without gitignore');
    await installFramework({ targetDir: r2.dir, sourceRoot: src.srcDir, agents: ['claude'], yes: true });
    git(r2.dir, 'add', '-A');
    git(r2.dir, 'commit', '--no-verify', '-qm', 'chore: initial sdlc scaffold');
    const sess = beginSession({ checkout: true, title: 'clean tree', repoRoot: r2.dir });
    assert.equal(sess.success, true);
    fs.mkdirSync(path.join(r2.dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(r2.dir, 'src/a.js'), 'export const a = 1;\n', 'utf8');
    git(r2.dir, 'add', 'src/a.js');
    git(r2.dir, 'commit', '-qm', 'feat: add a');
    assert.equal(hasDirtyNonGovernanceFiles(r2.dir), false);

    // 3. In-repo .gitignore symlink -> config/gitignore writes through the link
    const r3 = createTempGitRepo();
    cleanups.push(r3.cleanup);
    git(r3.dir, 'rm', '-q', '.gitignore');
    git(r3.dir, 'commit', '-qm', 'chore: rm gitignore');
    fs.mkdirSync(path.join(r3.dir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(r3.dir, 'config/gitignore'), 'custom/\n', 'utf8');
    fs.symlinkSync('config/gitignore', path.join(r3.dir, '.gitignore'));
    const igSymRes = upsertGitignore(r3.dir);
    assert.equal(igSymRes.updated, true);
    assert.equal(fs.lstatSync(path.join(r3.dir, '.gitignore')).isSymbolicLink(), true);
    const linkedIg = fs.readFileSync(path.join(r3.dir, 'config/gitignore'), 'utf8');
    assert.match(linkedIg, /^custom\/$/m);
    assert.match(linkedIg, /^\.agent\/\.receipt-key$/m);

    // 4. runDoctor flags missing critical gitignore entries and --fix repairs them
    withoutReceiptEnv(() => {
      fs.writeFileSync(path.join(r1.dir, '.agent/.receipt-key'), 'deadbeef\n', { mode: 0o600 });
      fs.writeFileSync(path.join(r1.dir, '.gitignore'), 'dist/\n', 'utf8');
      const docBad = runDoctor({ repoRoot: r1.dir, fix: false });
      assert.equal(docBad.passed, false);
      assert.equal(docBad.gitignore.upToDate, false);
      assert.ok(docBad.gitignore.missing.includes('.agent/.receipt-key'));
      const docFixed = runDoctor({ repoRoot: r1.dir, fix: true });
      assert.equal(docFixed.passed, true);
      assert.equal(docFixed.gitignore.upToDate, true);
    });
  });
});
