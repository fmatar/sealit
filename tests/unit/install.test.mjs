import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createTempGitRepo, git, withoutReceiptEnv } from '../helpers/test-harness.mjs';
import { hasDirtyNonGovernanceFiles } from '../../.agent/scripts/lib/git.mjs';
import { checkArchRings } from '../../.agent/scripts/lib/drift.mjs';
import { beginSession } from '../../.agent/scripts/lib/guard.mjs';
import {
  CANONICAL_SKILLS,
  RETIRED_SKILLS,
  SUPPORTED_AGENTS,
  SDLC_GITIGNORE_ENTRIES,
  CLAUDE_SDLC_ALLOW_RULES,
  buildQualityGateWorkflow,
  upsertGitignore,
  auditSkills,
  installCIWorkflow,
  scaffoldArchlensPolicy,
  runDoctor,
  installFramework
} from '../../.agent/scripts/lib/install.mjs';

const ENGINE_CMD = 'node .agent/scripts/sdlc-engine.mjs';

// Claude Code Bash rule semantics: "Bash(X *)" matches X or X followed by a space; "Bash(X)" matches X exactly.
function claudeRuleAllows(rule, command) {
  const m = /^Bash\((.*)\)$/.exec(rule);
  if (!m) return false;
  const body = m[1];
  if (body.endsWith(' *')) {
    const prefix = body.slice(0, -2);
    return command === prefix || command.startsWith(`${prefix} `);
  }
  if (body.endsWith('*')) return command.startsWith(body.slice(0, -1));
  return command === body;
}

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

    // Canonical github:fmatar/agentic-sdlc-framework specifier produces zero RP1 findings while npx cowsay still triggers RP1
    fs.writeFileSync(
      path.join(srcDir, '.agent/skills/sdlc/SKILL.md'),
      '---\nname: sdlc\ndescription: "Use when routing /sdlc commands."\n---\nRun `npx --yes github:fmatar/agentic-sdlc-framework init` and `npx @scope/pkg@1.2.3` and `npx github:fmatar/agentic-sdlc-framework#v0.2.0`.\n',
      'utf8'
    );
    assert.equal(auditSkills(srcDir).findings.some((f) => f.rule === 'RP1'), false);
    fs.writeFileSync(
      path.join(srcDir, '.agent/skills/sdlc/SKILL.md'),
      '---\nname: sdlc\ndescription: "Use when routing /sdlc commands."\n---\nRun `npx cowsay hello`.\n',
      'utf8'
    );
    assert.equal(auditSkills(srcDir).findings.some((f) => f.rule === 'RP1'), true);
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
          modules: [{ name: 'custom', path: '.', commands: { test: 'node --test "tests/**/*.test.mjs"', coverage: 'npm run test:coverage' }, thresholds: { diffCoverage: 93, mutationScore: null } }]
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

    // Second install updates marked rules block in-place (zero duplication), skips up-to-date workflow/policy unless --force, and keeps skill output byte-identical to canonical source
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), `# Custom Header\n\n${fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')}`, 'utf8');
    await installFramework({ targetDir: dir, sourceRoot: src.srcDir, agents: ['all'], yes: true });
    const agentsMd = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    assert.ok(agentsMd.startsWith('# Custom Header'));
    assert.equal((agentsMd.match(/AGENTIC-SDLC-RULES:START/g) || []).length, 1);
    const canonicalSdlc = fs.readFileSync(path.join(dir, '.agent/skills/sdlc/SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(fs.readFileSync(path.join(dir, '.claude/skills/sdlc/SKILL.md'), 'utf8'), canonicalSdlc);
    assert.equal(fs.readFileSync(path.join(dir, '.cursor/skills/sdlc/SKILL.md'), 'utf8'), canonicalSdlc);

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

  it('generated Claude allowlist never prefix-matches approve/sign/exempt commands and migrates the legacy wildcard', async () => {
    const forbidden = [
      'adr decide --id ADR-001 --status approve --by @me',
      'review record --verdict approve',
      'receipt',
      'receipt --docs-only',
      'guard receipt --docs-only',
      'exemption add --mutant 3 --file a.mjs --reason equivalent',
      'protect main develop',
      'init --yes',
      'hooks install',
      'doctor --fix',
      'ci-workflow install --force'
    ];
    for (const sub of forbidden) {
      const cmd = `${ENGINE_CMD} ${sub}`;
      assert.equal(CLAUDE_SDLC_ALLOW_RULES.some((r) => claudeRuleAllows(r, cmd)), false, `must prompt for: ${cmd}`);
    }
    for (const sub of ['status', 'doctor', 'drift', 'gate --no-cache', 'coverage', 'mutation --full', 'review plan', 'adr list', 'verify', 'guard verify --sha abc', 'begin --checkout --title x', 'end --issue 7']) {
      const cmd = `${ENGINE_CMD} ${sub}`;
      assert.equal(CLAUDE_SDLC_ALLOW_RULES.some((r) => claudeRuleAllows(r, cmd)), true, `should auto-allow: ${cmd}`);
    }
    assert.equal(CLAUDE_SDLC_ALLOW_RULES.includes(`Bash(${ENGINE_CMD} *)`), false);

    const src = createSourceBundleFixture();
    cleanups.push(src.cleanup);

    // Fresh repo: narrow allowlist written
    const fresh = createTempGitRepo();
    cleanups.push(fresh.cleanup);
    await installFramework({ targetDir: fresh.dir, sourceRoot: src.srcDir, agents: ['claude'], yes: true });
    const freshSettings = JSON.parse(fs.readFileSync(path.join(fresh.dir, '.claude/settings.json'), 'utf8'));
    assert.deepEqual(freshSettings.permissions.allow, [...CLAUDE_SDLC_ALLOW_RULES]);

    // Legacy wildcard is replaced; user entries and other keys preserved
    const legacy = createTempGitRepo();
    cleanups.push(legacy.cleanup);
    fs.mkdirSync(path.join(legacy.dir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(legacy.dir, '.claude/settings.json'),
      JSON.stringify({ $schema: 'x', model: 'opus', permissions: { allow: ['Bash(npm test)', `Bash(${ENGINE_CMD} *)`], deny: ['Bash(rm -rf *)'] } }, null, 2),
      'utf8'
    );
    await installFramework({ targetDir: legacy.dir, sourceRoot: src.srcDir, agents: ['claude'], yes: true });
    const migrated = JSON.parse(fs.readFileSync(path.join(legacy.dir, '.claude/settings.json'), 'utf8'));
    assert.equal(migrated.model, 'opus');
    assert.deepEqual(migrated.permissions.deny, ['Bash(rm -rf *)']);
    assert.ok(migrated.permissions.allow.includes('Bash(npm test)'));
    assert.equal(migrated.permissions.allow.includes(`Bash(${ENGINE_CMD} *)`), false);
    for (const rule of CLAUDE_SDLC_ALLOW_RULES) assert.ok(migrated.permissions.allow.includes(rule));

    // User-managed settings without the legacy wildcard are left byte-identical
    const custom = createTempGitRepo();
    cleanups.push(custom.cleanup);
    fs.mkdirSync(path.join(custom.dir, '.claude'), { recursive: true });
    const customRaw = JSON.stringify({ permissions: { allow: ['Bash(npm test)'] } });
    fs.writeFileSync(path.join(custom.dir, '.claude/settings.json'), customRaw, 'utf8');
    await installFramework({ targetDir: custom.dir, sourceRoot: src.srcDir, agents: ['claude'], yes: true });
    assert.equal(fs.readFileSync(path.join(custom.dir, '.claude/settings.json'), 'utf8'), customRaw);

    // Symlinked settings pointing OUTSIDE the root (home-manager / shared dotfiles) are never unlinked or rewritten
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-outside-settings-'));
    cleanups.push(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
    for (const [label, body] of [
      ['no-legacy', { model: 'opus', permissions: { allow: ['Bash(npm test)'] } }],
      ['legacy', { model: 'opus', permissions: { allow: [`Bash(${ENGINE_CMD} *)`] } }]
    ]) {
      const r = createTempGitRepo();
      cleanups.push(r.cleanup);
      const outsideFile = path.join(outsideDir, `${label}.json`);
      const outsideRaw = JSON.stringify(body);
      fs.writeFileSync(outsideFile, outsideRaw, 'utf8');
      fs.mkdirSync(path.join(r.dir, '.claude'), { recursive: true });
      fs.symlinkSync(outsideFile, path.join(r.dir, '.claude/settings.json'));
      const res = await installFramework({ targetDir: r.dir, sourceRoot: src.srcDir, agents: ['claude'], yes: true });
      assert.equal(fs.lstatSync(path.join(r.dir, '.claude/settings.json')).isSymbolicLink(), true, `${label}: symlink kept`);
      assert.equal(fs.readFileSync(outsideFile, 'utf8'), outsideRaw, `${label}: outside file untouched`);
      if (label === 'legacy') assert.ok(res.warnings.some((w) => /outside/.test(w) && /settings\.json/.test(w)), JSON.stringify(res.warnings));
    }

    // Symlinked settings INSIDE the root are migrated through the link
    const inRoot = createTempGitRepo();
    cleanups.push(inRoot.cleanup);
    fs.mkdirSync(path.join(inRoot.dir, 'config'), { recursive: true });
    fs.mkdirSync(path.join(inRoot.dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(inRoot.dir, 'config/claude.json'), JSON.stringify({ permissions: { allow: [`Bash(${ENGINE_CMD} *)`] } }), 'utf8');
    fs.symlinkSync('../config/claude.json', path.join(inRoot.dir, '.claude/settings.json'));
    await installFramework({ targetDir: inRoot.dir, sourceRoot: src.srcDir, agents: ['claude'], yes: true });
    assert.equal(fs.lstatSync(path.join(inRoot.dir, '.claude/settings.json')).isSymbolicLink(), true);
    const linked = JSON.parse(fs.readFileSync(path.join(inRoot.dir, 'config/claude.json'), 'utf8'));
    assert.equal(linked.permissions.allow.includes(`Bash(${ENGINE_CMD} *)`), false);
    assert.ok(linked.permissions.allow.includes(`Bash(${ENGINE_CMD} status)`));
  });

  it('generated workflow verifies the receipt before installing or running PR code, drops persisted credentials, and doctor --fix upgrades the old order', () => {
    const wf = buildQualityGateWorkflow();
    const iVerify = wf.indexOf('- name: Verify Signed Stage 7 Gate Receipt');
    const iSetupNode = wf.indexOf('- name: Setup Node.js Runtime');
    assert.ok(iVerify > iSetupNode && iSetupNode > -1, 'verify needs node, so it runs after setup-node');
    assert.ok(iVerify < wf.indexOf('- name: Install Dependencies'), 'verify must run before npm ci/install');
    assert.ok(iVerify < wf.indexOf('npm test'), 'verify must run before PR tests');
    assert.ok(iVerify < wf.indexOf('gate --no-cache'), 'verify must run before the PR engine gate');
    assert.match(wf, /uses: actions\/checkout@v7\n\s+with:\n\s+fetch-depth: 0\n\s+persist-credentials: false/);

    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);
    // Rebuild the v0.1.0 layout: verify step moved to the end, credentials persisted.
    const blockStart = wf.lastIndexOf('\n', iVerify) + 1;
    const nextStep = wf.indexOf('\n      - name:', iVerify);
    const verifyBlock = wf.slice(blockStart, nextStep === -1 ? wf.length : nextStep + 1);
    const oldOrder = `${wf.slice(0, blockStart)}${wf.slice(blockStart + verifyBlock.length)}`.replace('          persist-credentials: false\n', '').trimEnd() + `\n\n${verifyBlock.trimEnd()}\n`;
    assert.ok(oldOrder.indexOf('Verify Signed Stage 7') > oldOrder.indexOf('Install Dependencies'));
    fs.mkdirSync(path.join(dir, '.github/workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github/workflows/sdlc-quality-gate.yml'), oldOrder, 'utf8');
    const res = installCIWorkflow({ repoRoot: dir, force: false, upgradeLegacy: true });
    assert.equal(res.upgraded, true);
    const upgraded = fs.readFileSync(path.join(dir, '.github/workflows/sdlc-quality-gate.yml'), 'utf8');
    assert.ok(upgraded.indexOf('Verify Signed Stage 7') < upgraded.indexOf('Install Dependencies'));
    assert.equal(installCIWorkflow({ repoRoot: dir, force: false, upgradeLegacy: true }).skipped, true);
  });

  it('setup-node cache follows the lockfile present at generation time and doctor flags a mismatch', () => {
    const cacheOf = (yml) => (/^\s+cache: '(\w+)'$/m.exec(yml) || [])[1] || null;

    const py = createTempGitRepo();
    cleanups.push(py.cleanup);
    fs.writeFileSync(path.join(py.dir, 'pyproject.toml'), '[project]\nname = "x"\n', 'utf8');
    installCIWorkflow({ repoRoot: py.dir, force: true });
    const pyWf = fs.readFileSync(path.join(py.dir, '.github/workflows/sdlc-quality-gate.yml'), 'utf8');
    assert.equal(cacheOf(pyWf), null, 'no lockfile => no cache key (setup-node would fail)');

    for (const [lock, expected] of [['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm'], ['yarn.lock', null], ['pnpm-lock.yaml', null]]) {
      const r = createTempGitRepo();
      cleanups.push(r.cleanup);
      fs.writeFileSync(path.join(r.dir, 'package.json'), '{"name":"x"}\n', 'utf8');
      fs.writeFileSync(path.join(r.dir, lock), '{}\n', 'utf8');
      installCIWorkflow({ repoRoot: r.dir, force: true });
      // The workflow only installs with npm; a pnpm/yarn cache needs extra tooling and yarn-berry would run repo JS before verify.
      assert.equal(cacheOf(fs.readFileSync(path.join(r.dir, '.github/workflows/sdlc-quality-gate.yml'), 'utf8')), expected, lock);
    }

    // An npm repo whose user removed the cache line is NOT regenerated (missing cache is only an optimization)
    const npmRepo = createTempGitRepo();
    cleanups.push(npmRepo.cleanup);
    fs.writeFileSync(path.join(npmRepo.dir, 'package-lock.json'), '{}\n', 'utf8');
    fs.mkdirSync(path.join(npmRepo.dir, '.github/workflows'), { recursive: true });
    const customNoCache = `${buildQualityGateWorkflow({ repoRoot: null })}      - name: My custom step\n        run: echo custom\n`;
    fs.writeFileSync(path.join(npmRepo.dir, '.github/workflows/sdlc-quality-gate.yml'), customNoCache, 'utf8');
    assert.equal(installCIWorkflow({ repoRoot: npmRepo.dir, force: false, upgradeLegacy: true }).skipped, true);
    assert.match(fs.readFileSync(path.join(npmRepo.dir, '.github/workflows/sdlc-quality-gate.yml'), 'utf8'), /My custom step/);

    // Other actions' `cache:` keys and correctly configured pnpm setups are never treated as broken
    const pyCustom = createTempGitRepo();
    cleanups.push(pyCustom.cleanup);
    fs.mkdirSync(path.join(pyCustom.dir, '.github/workflows'), { recursive: true });
    const withPip = `${buildQualityGateWorkflow({ repoRoot: null })}      - uses: actions/setup-python@v5\n        with:\n          python-version: '3.12'\n          cache: 'pip'\n`;
    fs.writeFileSync(path.join(pyCustom.dir, '.github/workflows/sdlc-quality-gate.yml'), withPip, 'utf8');
    assert.equal(installCIWorkflow({ repoRoot: pyCustom.dir, force: false, upgradeLegacy: true }).skipped, true);
    const pnpmCustom = createTempGitRepo();
    cleanups.push(pnpmCustom.cleanup);
    fs.writeFileSync(path.join(pnpmCustom.dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n', 'utf8');
    fs.mkdirSync(path.join(pnpmCustom.dir, '.github/workflows'), { recursive: true });
    const withPnpm = buildQualityGateWorkflow({ repoRoot: null }).replace("node-version: \"lts/*\"\n", "node-version: \"lts/*\"\n          cache: 'pnpm'\n");
    fs.writeFileSync(path.join(pnpmCustom.dir, '.github/workflows/sdlc-quality-gate.yml'), withPnpm, 'utf8');
    assert.equal(installCIWorkflow({ repoRoot: pnpmCustom.dir, force: false, upgradeLegacy: true }).skipped, true);
    assert.match(buildQualityGateWorkflow({ repoRoot: pyCustom.dir }), /package-manager-cache: false/, 'no npm lockfile => disable setup-node auto caching');
    assert.doesNotMatch(buildQualityGateWorkflow({ repoRoot: npmRepo.dir }), /package-manager-cache/);

    // A workflow caching npm in a repo without a lockfile (quoted or unquoted) is reported and repaired by doctor --fix
    withoutReceiptEnv(() => {
      fs.writeFileSync(path.join(py.dir, '.github/workflows/sdlc-quality-gate.yml'), buildQualityGateWorkflow({ repoRoot: null }).replace("node-version: \"lts/*\"\n", "node-version: \"lts/*\"\n          cache: npm\n"), 'utf8');
      assert.equal(runDoctor({ repoRoot: py.dir, fix: false }).workflow.legacyNeedsUpgrade, true);
      runDoctor({ repoRoot: py.dir, fix: true });
      assert.equal(cacheOf(fs.readFileSync(path.join(py.dir, '.github/workflows/sdlc-quality-gate.yml'), 'utf8')), null);
      assert.equal(runDoctor({ repoRoot: py.dir, fix: false }).workflow.legacyNeedsUpgrade, false);
    });
  });

  it('init preserves an invalid or malformed existing config with a warning and --force backs it up before regenerating', async () => {
    const src = createSourceBundleFixture();
    cleanups.push(src.cleanup);
    for (const badRaw of ['{"version":"0.1.0","modules":"nope","thresholdsCustom":93}\n', '{not-json\n']) {
      const r = createTempGitRepo();
      cleanups.push(r.cleanup);
      fs.mkdirSync(path.join(r.dir, '.agent'), { recursive: true });
      fs.writeFileSync(path.join(r.dir, '.agent/sdlc-config.json'), badRaw, 'utf8');
      const res = await installFramework({ targetDir: r.dir, sourceRoot: src.srcDir, agents: ['claude'], yes: true });
      assert.equal(fs.readFileSync(path.join(r.dir, '.agent/sdlc-config.json'), 'utf8'), badRaw, 'invalid config must be left byte-identical');
      assert.ok(res.warnings.some((w) => /left untouched/.test(w) && /--force/.test(w)), JSON.stringify(res.warnings));
      assert.equal(fs.existsSync(path.join(r.dir, '.github/workflows/sdlc-quality-gate.yml')), true, 'init still completes');

      const forced = await installFramework({ targetDir: r.dir, sourceRoot: src.srcDir, agents: ['claude'], yes: true, force: true });
      assert.equal(forced.success, true);
      assert.equal(fs.readFileSync(path.join(r.dir, '.agent/sdlc-config.json.bak'), 'utf8'), badRaw);
      const regenerated = JSON.parse(fs.readFileSync(path.join(r.dir, '.agent/sdlc-config.json'), 'utf8'));
      assert.ok(Array.isArray(regenerated.modules));
    }

    // A planted .bak symlink is never followed by --force
    const planted = createTempGitRepo();
    cleanups.push(planted.cleanup);
    const victimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-bak-victim-'));
    cleanups.push(() => fs.rmSync(victimDir, { recursive: true, force: true }));
    const victim = path.join(victimDir, 'bashrc');
    fs.writeFileSync(victim, 'VICTIM_UNTOUCHED', 'utf8');
    fs.mkdirSync(path.join(planted.dir, '.agent'), { recursive: true });
    fs.writeFileSync(path.join(planted.dir, '.agent/sdlc-config.json'), '{"version":"0.1.0","modules":"nope"}\n', 'utf8');
    fs.symlinkSync(victim, path.join(planted.dir, '.agent/sdlc-config.json.bak'));
    await installFramework({ targetDir: planted.dir, sourceRoot: src.srcDir, agents: ['claude'], yes: true, force: true });
    assert.equal(fs.readFileSync(victim, 'utf8'), 'VICTIM_UNTOUCHED');
    assert.equal(fs.lstatSync(path.join(planted.dir, '.agent/sdlc-config.json.bak')).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(path.join(planted.dir, '.agent/sdlc-config.json.bak'), 'utf8'), '{"version":"0.1.0","modules":"nope"}\n');

    // A symlinked config source is never copied into the repo as .bak (could exfiltrate e.g. credentials)
    const srcLinked = createTempGitRepo();
    cleanups.push(srcLinked.cleanup);
    const secretFile = path.join(victimDir, 'credentials');
    fs.writeFileSync(secretFile, 'TOP_SECRET', 'utf8');
    fs.mkdirSync(path.join(srcLinked.dir, '.agent'), { recursive: true });
    fs.symlinkSync(secretFile, path.join(srcLinked.dir, '.agent/sdlc-config.json'));
    const linkedRes = await installFramework({ targetDir: srcLinked.dir, sourceRoot: src.srcDir, agents: ['claude'], yes: true, force: true });
    assert.equal(fs.existsSync(path.join(srcLinked.dir, '.agent/sdlc-config.json.bak')), false);
    assert.equal(fs.readFileSync(secretFile, 'utf8'), 'TOP_SECRET');
    assert.equal(fs.lstatSync(path.join(srcLinked.dir, '.agent/sdlc-config.json')).isSymbolicLink(), false);
    assert.ok(linkedRes.warnings.some((w) => /symlink/i.test(w) && /backup/i.test(w)), JSON.stringify(linkedRes.warnings));
    assert.ok(SDLC_GITIGNORE_ENTRIES.includes('.agent/sdlc-config.json.bak'));
  });

  it('doctor enforces git >= 2.38 runtime floor', () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);
    withoutReceiptEnv(() => {
      runDoctor({ repoRoot: dir, fix: true });
      const oldGit = runDoctor({ repoRoot: dir, gitVersionRaw: 'git version 2.37.3' });
      assert.equal(oldGit.gitOk, false);
      assert.equal(oldGit.passed, false);
      assert.equal(oldGit.gitVersion, '2.37.3');

      const minGit = runDoctor({ repoRoot: dir, gitVersionRaw: 'git version 2.38.0 (Apple Git-143)' });
      assert.equal(minGit.gitOk, true);
      assert.equal(minGit.gitVersion, '2.38.0');
    });
  });

  it('merges allowlist into hook-only .claude/settings.json, gitignores .scratch/, and audits disable-model-invocation + openai.yaml + plugin.json parity', async () => {
    assert.ok(SDLC_GITIGNORE_ENTRIES.includes('.scratch/'));
    assert.ok(CLAUDE_SDLC_ALLOW_RULES.some((r) => claudeRuleAllows(r, `${ENGINE_CMD} pr-body`)));

    const src = createSourceBundleFixture();
    cleanups.push(src.cleanup);
    for (const id of CANONICAL_SKILLS) {
      fs.mkdirSync(path.join(src.srcDir, '.agent/skills', id, 'agents'), { recursive: true });
      const userOnly = id === 'sdlc';
      if (userOnly) {
        fs.writeFileSync(
          path.join(src.srcDir, '.agent/skills/sdlc/SKILL.md'),
          '---\nname: sdlc\ndescription: "Direct 1:1 CLI command router for explicit /sdlc invocations."\ndisable-model-invocation: true\n---\n\n# sdlc\n',
          'utf8'
        );
      }
      fs.writeFileSync(
        path.join(src.srcDir, '.agent/skills', id, 'agents/openai.yaml'),
        `interface:\n  display_name: "${id}"\n  short_description: "Summary for ${id}"\n${userOnly ? 'policy:\n  allow_implicit_invocation: false\n' : ''}`,
        'utf8'
      );
    }
    fs.writeFileSync(path.join(src.srcDir, 'package.json'), JSON.stringify({ name: '@fmatar/agentic-sdlc', version: '0.1.0' }), 'utf8');
    fs.mkdirSync(path.join(src.srcDir, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(
      path.join(src.srcDir, '.claude-plugin/plugin.json'),
      JSON.stringify({ name: 'agentic-sdlc', version: '0.1.0', skills: CANONICAL_SKILLS.map((s) => `./.agent/skills/${s}`) }),
      'utf8'
    );
    assert.equal(auditSkills(src.srcDir).passed, true, JSON.stringify(auditSkills(src.srcDir).findings));

    // Mismatched openai.yaml policy or drifted plugin.json version fails auditSkills
    fs.writeFileSync(
      path.join(src.srcDir, '.agent/skills/sdlc/agents/openai.yaml'),
      'interface:\n  display_name: "sdlc"\n  short_description: "Summary"\n',
      'utf8'
    );
    const mismatchAudit = auditSkills(src.srcDir);
    assert.equal(mismatchAudit.passed, false);
    assert.ok(mismatchAudit.findings.some((f) => f.rule === 'OAI1'));

    fs.writeFileSync(
      path.join(src.srcDir, '.agent/skills/sdlc/agents/openai.yaml'),
      'interface:\n  display_name: "sdlc"\n  short_description: "Summary"\npolicy:\n  allow_implicit_invocation: false\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(src.srcDir, '.claude-plugin/plugin.json'),
      JSON.stringify({ name: 'agentic-sdlc', version: '9.9.9', skills: [] }),
      'utf8'
    );
    const badPluginAudit = auditSkills(src.srcDir);
    assert.equal(badPluginAudit.passed, false);
    assert.ok(badPluginAudit.findings.some((f) => f.rule === 'PLG1'));

    // Hook-only .claude/settings.json (e.g. PreToolUse git-guardrails) gets CLAUDE_SDLC_ALLOW_RULES merged without losing hooks
    const hookRepo = createTempGitRepo();
    cleanups.push(hookRepo.cleanup);
    fs.mkdirSync(path.join(hookRepo.dir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(hookRepo.dir, '.claude/settings.json'),
      JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard.sh' }] }] } }, null, 2),
      'utf8'
    );
    await installFramework({ targetDir: hookRepo.dir, sourceRoot: src.srcDir, agents: ['claude', 'codex'], yes: true });
    const mergedSettings = JSON.parse(fs.readFileSync(path.join(hookRepo.dir, '.claude/settings.json'), 'utf8'));
    assert.equal(mergedSettings.hooks.PreToolUse.length, 1);
    assert.deepEqual(mergedSettings.permissions.allow, [...CLAUDE_SDLC_ALLOW_RULES]);
    assert.equal(fs.existsSync(path.join(hookRepo.dir, '.codex/skills/sdlc/agents/openai.yaml')), true);

    // Non-object valid JSON (null or []) in .claude/settings.json warns and stays untouched instead of throwing TypeError
    for (const rawNonObj of ['null\n', '["not-an-object"]\n']) {
      const nonObjRepo = createTempGitRepo();
      cleanups.push(nonObjRepo.cleanup);
      fs.mkdirSync(path.join(nonObjRepo.dir, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(nonObjRepo.dir, '.claude/settings.json'), rawNonObj, 'utf8');
      const rNonObj = await installFramework({ targetDir: nonObjRepo.dir, sourceRoot: src.srcDir, agents: ['claude'], yes: true });
      assert.equal(rNonObj.success, true);
      assert.equal(fs.readFileSync(path.join(nonObjRepo.dir, '.claude/settings.json'), 'utf8'), rawNonObj);
      assert.ok(rNonObj.warnings.some((w) => /settings\.json/i.test(w)));
    }

    // Plugin-backed repo rejects string plugin.json skills and rejects sdlc missing disable-model-invocation: true
    fs.writeFileSync(
      path.join(src.srcDir, '.claude-plugin/plugin.json'),
      JSON.stringify({ name: 'agentic-sdlc', version: '0.1.0', skills: './.agent/skills' }),
      'utf8'
    );
    assert.ok(auditSkills(src.srcDir).findings.some((f) => f.rule === 'PLG1'));
    fs.writeFileSync(
      path.join(src.srcDir, '.claude-plugin/plugin.json'),
      JSON.stringify({ name: 'agentic-sdlc', version: '0.1.0', skills: CANONICAL_SKILLS.map((s) => `./.agent/skills/${s}`) }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(src.srcDir, '.agent/skills/sdlc/SKILL.md'),
      '---\nname: sdlc\ndescription: "Use when routing /sdlc."\n---\n# sdlc\n',
      'utf8'
    );
    assert.ok(auditSkills(src.srcDir).findings.some((f) => f.rule === 'FM3'));
  });

  it('scaffolds a ring policy only when ring directories exist and gitignores coverage output', () => {
    assert.ok(SDLC_GITIGNORE_ENTRIES.includes('coverage/') && SDLC_GITIGNORE_ENTRIES.includes('reports/'));

    // Repo A: src/add.mjs only (no domain/application/adapters/entrypoints dirs)
    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-pol-a-'));
    cleanups.push(() => fs.rmSync(a, { recursive: true, force: true }));
    fs.mkdirSync(path.join(a, 'src'), { recursive: true });
    fs.writeFileSync(path.join(a, 'src/add.mjs'), 'export const add = (x, y) => x + y;\n', 'utf8');
    scaffoldArchlensPolicy(a);
    const pa = JSON.parse(fs.readFileSync(path.join(a, '.archlens/policy.json'), 'utf8'));
    assert.deepEqual(pa.levels, []);
    assert.deepEqual(pa.order, []);
    assert.equal(pa.src, 'src');
    assert.ok(pa.omit.includes('.agent'));
    assert.equal(checkArchRings({ repoRoot: a }).passed, true);

    // Repo B: index.mjs at root, no src/, plus .agent/scripts/x.mjs
    const b = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-pol-b-'));
    cleanups.push(() => fs.rmSync(b, { recursive: true, force: true }));
    fs.mkdirSync(path.join(b, '.agent/scripts'), { recursive: true });
    fs.writeFileSync(path.join(b, 'index.mjs'), 'export const ok = 1;\n', 'utf8');
    fs.writeFileSync(path.join(b, '.agent/scripts/x.mjs'), 'export const x = 1;\n', 'utf8');
    scaffoldArchlensPolicy(b);
    const pb = JSON.parse(fs.readFileSync(path.join(b, '.archlens/policy.json'), 'utf8'));
    assert.equal(pb.src, '.');
    assert.deepEqual(pb.levels, []);
    assert.deepEqual(pb.order, []);
    assert.ok(pb.omit.includes('.agent'));
    const bRings = checkArchRings({ repoRoot: b });
    assert.equal(bRings.passed, true);
    assert.equal(bRings.filesChecked, 1);

    // Repo C: src/domain/x.mjs exists -> classic 4-ring scaffold
    const c = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-pol-c-'));
    cleanups.push(() => fs.rmSync(c, { recursive: true, force: true }));
    fs.mkdirSync(path.join(c, 'src/domain'), { recursive: true });
    fs.writeFileSync(path.join(c, 'src/domain/x.mjs'), 'export const d = 1;\n', 'utf8');
    scaffoldArchlensPolicy(c);
    const pc = JSON.parse(fs.readFileSync(path.join(c, '.archlens/policy.json'), 'utf8'));
    assert.deepEqual(pc.order, ['domain', 'application', 'adapters', 'entrypoints']);
    assert.equal(pc.levels.length, 4);
  });

  it('init creates a receipt key only on first adoption', async () => {
    const src = createSourceBundleFixture();
    cleanups.push(src.cleanup);
    const hadEnv = Object.prototype.hasOwnProperty.call(process.env, 'SDLC_RECEIPT_KEY');
    const prevEnv = process.env.SDLC_RECEIPT_KEY;
    delete process.env.SDLC_RECEIPT_KEY;

    try {
      const fresh = createTempGitRepo();
      cleanups.push(fresh.cleanup);
      const r1 = await installFramework({ targetDir: fresh.dir, sourceRoot: src.srcDir, agents: ['claude'], yes: true });
      assert.equal(r1.receiptKeyCreated, true);
      const key = path.join(fresh.dir, '.agent/.receipt-key');
      if (process.platform !== 'win32') assert.equal(fs.statSync(key).mode & 0o777, 0o600);
      assert.equal(git(fresh.dir, 'check-ignore', '-q', '.agent/.receipt-key').status, 0);
      const before = fs.readFileSync(key, 'utf8');
      assert.ok(before.trim().length >= 32);

      const r2 = await installFramework({ targetDir: fresh.dir, sourceRoot: src.srcDir, agents: ['claude'], yes: true });
      assert.equal(r2.receiptKeyCreated, false);
      assert.equal(fs.readFileSync(key, 'utf8'), before);

      // Teammate repo with committed .agent/sdlc-config.json and no local key
      const team = createTempGitRepo();
      cleanups.push(team.cleanup);
      fs.mkdirSync(path.join(team.dir, '.agent'), { recursive: true });
      fs.writeFileSync(
        path.join(team.dir, '.agent/sdlc-config.json'),
        JSON.stringify({ version: '0.1.0', modules: [{ name: 'root', path: '.', commands: {}, thresholds: { diffCoverage: null, mutationScore: null } }] }),
        'utf8'
      );
      git(team.dir, 'add', '.agent/sdlc-config.json');
      git(team.dir, 'commit', '-qm', 'chore: existing config');
      const rTeam = await installFramework({ targetDir: team.dir, sourceRoot: src.srcDir, agents: ['claude'], yes: true });
      assert.equal(rTeam.receiptKeyCreated, false);
      assert.equal(fs.existsSync(path.join(team.dir, '.agent/.receipt-key')), false);
      assert.equal(runDoctor({ repoRoot: team.dir }).receiptKey.ciSecretHint, null);

      // Corrupt line 1 in docs/AUDIT_CHAIN.jsonl without .agent/sdlc-config.json -> no key file created
      const corrupt = createTempGitRepo();
      cleanups.push(corrupt.cleanup);
      fs.mkdirSync(path.join(corrupt.dir, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(corrupt.dir, 'docs/AUDIT_CHAIN.jsonl'), '{corrupt-line-1\n', 'utf8');
      const rCorrupt = await installFramework({ targetDir: corrupt.dir, sourceRoot: src.srcDir, agents: ['claude'], yes: true });
      assert.equal(rCorrupt.receiptKeyCreated, false);
      assert.equal(fs.existsSync(path.join(corrupt.dir, '.agent/.receipt-key')), false);

      // Env key present during first adoption -> no key file created
      process.env.SDLC_RECEIPT_KEY = 'env-provided-secret';
      const envRepo = createTempGitRepo();
      cleanups.push(envRepo.cleanup);
      const rEnv = await installFramework({ targetDir: envRepo.dir, sourceRoot: src.srcDir, agents: ['claude'], yes: true });
      assert.equal(rEnv.receiptKeyCreated, false);
      assert.equal(fs.existsSync(path.join(envRepo.dir, '.agent/.receipt-key')), false);
      assert.equal(runDoctor({ repoRoot: envRepo.dir }).receiptKey.ciSecretHint, null);
    } finally {
      if (hadEnv) process.env.SDLC_RECEIPT_KEY = prevEnv;
      else delete process.env.SDLC_RECEIPT_KEY;
    }
  });

  it('init skips npx-managed skills, never writes through their symlinks, and targets loaded agent paths', async () => {
    const src = createSourceBundleFixture();
    cleanups.push(src.cleanup);

    // 1. npx skills layout: .agents/skills/sdlc/SKILL.md ("NPX") + .claude/skills/sdlc -> ../../.agents/skills/sdlc
    const r1 = createTempGitRepo();
    cleanups.push(r1.cleanup);
    fs.mkdirSync(path.join(r1.dir, '.agents/skills/sdlc'), { recursive: true });
    fs.mkdirSync(path.join(r1.dir, '.claude/skills'), { recursive: true });
    fs.writeFileSync(path.join(r1.dir, '.agents/skills/sdlc/SKILL.md'), 'NPX', 'utf8');
    fs.symlinkSync('../../.agents/skills/sdlc', path.join(r1.dir, '.claude/skills/sdlc'));

    const res = await installFramework({ targetDir: r1.dir, sourceRoot: src.srcDir, agents: ['claude', 'copilot'], yes: true });
    assert.equal(res.success, true);
    assert.equal(fs.lstatSync(path.join(r1.dir, '.claude/skills/sdlc')).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(path.join(r1.dir, '.agents/skills/sdlc/SKILL.md'), 'utf8'), 'NPX');
    assert.ok(res.warnings.some((w) => /npx skills/.test(w) && /\bsdlc\b/.test(w)));
    assert.ok(res.warnings.some((w) => /\.agent\/skills/.test(w) && /\.agents\/skills/.test(w)));
    assert.ok(fs.existsSync(path.join(r1.dir, '.claude/skills/sdlc-gate/SKILL.md')));
    assert.ok(fs.existsSync(path.join(r1.dir, '.github/copilot-instructions.md')));

    // 2. Copilot-only local install provisions .claude/skills/sdlc* alongside .github/copilot-instructions.md
    const copRepo = createTempGitRepo();
    cleanups.push(copRepo.cleanup);
    await installFramework({ targetDir: copRepo.dir, sourceRoot: src.srcDir, agents: ['copilot'], yes: true });
    assert.ok(fs.existsSync(path.join(copRepo.dir, '.claude/skills/sdlc/SKILL.md')));
    assert.ok(fs.existsSync(path.join(copRepo.dir, '.github/copilot-instructions.md')));

    // 3. Outside directory symlink at .claude/skills/sdlc when NOT npx-managed -> still refused
    const r2 = createTempGitRepo();
    cleanups.push(r2.cleanup);
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-outside-skill-dir-'));
    cleanups.push(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
    fs.mkdirSync(path.join(r2.dir, '.claude/skills'), { recursive: true });
    fs.symlinkSync(outsideDir, path.join(r2.dir, '.claude/skills/sdlc'));
    await assert.rejects(
      () => installFramework({ targetDir: r2.dir, sourceRoot: src.srcDir, agents: ['claude'], yes: true }),
      /symlink/i
    );
    assert.equal(fs.existsSync(path.join(outsideDir, 'SKILL.md')), false);

    // 4. Global Antigravity targets ~/.gemini/config/skills and prunes legacy ~/.gemini/antigravity/skills/sdlc* while keeping user skills
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-agy-home-'));
    cleanups.push(() => fs.rmSync(fakeHome, { recursive: true, force: true }));
    fs.mkdirSync(path.join(fakeHome, '.gemini/antigravity/skills/sdlc'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.gemini/antigravity/skills/sdlc/SKILL.md'), 'legacy', 'utf8');
    fs.mkdirSync(path.join(fakeHome, '.gemini/antigravity/skills/design-system-builder'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.gemini/antigravity/skills/design-system-builder/SKILL.md'), 'keep', 'utf8');

    const gRes = await installFramework({ targetDir: r1.dir, sourceRoot: src.srcDir, agents: ['antigravity'], globalMode: true, homeDir: fakeHome, yes: true });
    assert.equal(gRes.success, true);
    assert.ok(fs.existsSync(path.join(fakeHome, '.gemini/config/skills/sdlc/SKILL.md')));
    assert.equal(fs.existsSync(path.join(fakeHome, '.gemini/antigravity/skills/sdlc')), false);
    assert.ok(fs.existsSync(path.join(fakeHome, '.gemini/antigravity/skills/design-system-builder/SKILL.md')));

    // 5. Global mode skips ~/.agents/skills/<id>/SKILL.md (npx skills -g) and refuses outside symlinks under homeDir
    fs.mkdirSync(path.join(fakeHome, '.agents/skills/sdlc'), { recursive: true });
    fs.mkdirSync(path.join(fakeHome, '.claude/skills'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.agents/skills/sdlc/SKILL.md'), 'GLOBAL_NPX', 'utf8');
    fs.symlinkSync('../../.agents/skills/sdlc', path.join(fakeHome, '.claude/skills/sdlc'));
    const gCoexist = await installFramework({ targetDir: r1.dir, sourceRoot: src.srcDir, agents: ['claude'], globalMode: true, homeDir: fakeHome, yes: true });
    assert.equal(gCoexist.success, true);
    assert.equal(fs.readFileSync(path.join(fakeHome, '.agents/skills/sdlc/SKILL.md'), 'utf8'), 'GLOBAL_NPX');
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude/skills/sdlc-gate/SKILL.md')));

    const badHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-bad-home-'));
    cleanups.push(() => fs.rmSync(badHome, { recursive: true, force: true }));
    fs.mkdirSync(path.join(badHome, '.claude/skills'), { recursive: true });
    fs.symlinkSync(outsideDir, path.join(badHome, '.claude/skills/sdlc'));
    await assert.rejects(
      () => installFramework({ targetDir: r1.dir, sourceRoot: src.srcDir, agents: ['claude'], globalMode: true, homeDir: badHome, yes: true }),
      /symlink/i
    );
    assert.equal(fs.existsSync(path.join(outsideDir, 'SKILL.md')), false);

    // 6. Planted external symlink at .agents -> outsideAgentsDir never acts as an npxManaged oracle
    const outsideAgents = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-outside-agents-'));
    cleanups.push(() => fs.rmSync(outsideAgents, { recursive: true, force: true }));
    fs.mkdirSync(path.join(outsideAgents, 'skills/sdlc'), { recursive: true });
    fs.writeFileSync(path.join(outsideAgents, 'skills/sdlc/SKILL.md'), 'OUTSIDE', 'utf8');
    const rOracle = createTempGitRepo();
    cleanups.push(rOracle.cleanup);
    fs.symlinkSync(outsideAgents, path.join(rOracle.dir, '.agents'));
    const oracleRes = await installFramework({ targetDir: rOracle.dir, sourceRoot: src.srcDir, agents: ['claude'], yes: true });
    assert.equal(oracleRes.success, true);
    assert.equal(oracleRes.warnings.some((w) => /npx skills/.test(w)), false);
    assert.ok(fs.existsSync(path.join(rOracle.dir, '.claude/skills/sdlc/SKILL.md')));
  });
});
