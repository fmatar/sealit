import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { fileExists, readFileSafe, parseFrontmatter } from './core.mjs';
import { scaffoldArchlensPolicy } from './arch-trace.mjs';
import { installHooks } from './git-guard.mjs';
import { scaffoldIssueTemplates } from './pm-provider.mjs';

export const DEPRECATED_SDLC_SKILLS = [
  'sdlc-analyze',
  'sdlc-arch-trace',
  'sdlc-docs-wiki',
  'sdlc-feature-spec',
  'sdlc-help',
  'sdlc-init',
  'sdlc-initialize',
  'sdlc-kanban',
  'sdlc-peer-review',
  'sdlc-quality-gate',
  'sdlc-release-changelog',
  'sdlc-review-gate',
  'sdlc-tdd-implement',
  'sdlc-test-coverage'
];

export const CANONICAL_SDLC_SKILLS = [
  'sdlc',
  'sdlc-adr',
  'sdlc-doctor',
  'sdlc-flow',
  'sdlc-gate',
  'sdlc-product',
  'sdlc-release',
  'sdlc-status',
  'sdlc-tdd',
  'sdlc-wiki'
];

export const SUPPORTED_AGENTS = [
  {
    id: 'gemini',
    name: 'Google Gemini / Antigravity',
    badge: 'Antigravity & Gemini CLI',
    localPaths: ['.agent/skills/<skill>/SKILL.md', '.agent/scripts/', 'AGENTS.md'],
    globalPaths: ['~/.gemini/config/skills/<skill>/SKILL.md', '~/.gemini/config/scripts/'],
    defaultSelected: true
  },
  {
    id: 'claude',
    name: 'Anthropic Claude Code',
    badge: '.claude/skills + .claude/commands + CLAUDE.md',
    localPaths: ['.claude/skills/<skill>/SKILL.md', '.claude/commands/<skill>.md', '.claude/settings.json', 'CLAUDE.md'],
    globalPaths: ['~/.claude/skills/<skill>/SKILL.md', '~/.claude/commands/<skill>.md'],
    defaultSelected: true
  },
  {
    id: 'cursor',
    name: 'Cursor IDE',
    badge: '.cursor/rules/*.mdc + .cursorrules',
    localPaths: ['.cursor/rules/agentic-sdlc.mdc', '.cursor/rules/<skill>.mdc', '.cursorrules'],
    globalPaths: ['~/.cursor/rules/agentic-sdlc.mdc'],
    defaultSelected: true
  },
  {
    id: 'grok',
    name: 'xAI Grok CLI / Studio',
    badge: '.grok/skills + .grok/settings.json + GROK.md',
    localPaths: ['.grok/skills/<skill>/SKILL.md', '.grok/settings.json', 'GROK.md'],
    globalPaths: ['~/.grok/skills/<skill>/SKILL.md', '~/.grok/GROK.md'],
    defaultSelected: false
  },
  {
    id: 'windsurf',
    name: 'Windsurf IDE',
    badge: '.windsurf/workflows + .windsurf/rules + .windsurfrules',
    localPaths: ['.windsurf/rules/agentic-sdlc.md', '.windsurf/workflows/<skill>.md', '.windsurfrules'],
    globalPaths: ['~/.codeium/windsurf/memories/global_rules.md'],
    defaultSelected: false
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot & OpenAI Codex',
    badge: '.github/copilot-instructions.md + .github/prompts/*.prompt.md',
    localPaths: ['.github/copilot-instructions.md', '.github/prompts/<skill>.prompt.md', 'AGENTS.md'],
    globalPaths: ['~/.github/copilot-instructions.md'],
    defaultSelected: false
  }
];

export const CONSTITUTIONAL_RULES_SUMMARY = `# Agentic SDLC Framework Invariants & Autonomous Rules
# Generated automatically by @fmatar/agentic-sdlc (Universal Engine v0.1.0)
# Adheres strictly to Robert C. Martin Clean Code & Clean Architecture

## 1. Zero Direct Pushes (4-Layer Git Guard — INV-01)
- Direct git commits, merges, or pushes to \`develop\` or \`main\` are STRICTLY FORBIDDEN.
- Every commit requires an active session in \`.agent/.sdlc-session.json\` matching the current branch (\`node .agent/scripts/sdlc-engine.mjs stage begin\`).
- Every merge into \`main\` requires a signed Stage 7 SHA-256 Merkle Gate Receipt in \`docs/AUDIT_CHAIN.jsonl\`.

## 2. PRODUCT.md Constitution & Spec Drift ADR Protocol (INV-03)
- Full-spec project handovers synthesize \`PRODUCT.md\` (\`CAP-XX\`, \`INV-XX\`, \`SPEC-XX\`) starting at Genesis Ticket \`#1\`.
- Any mutation to dependencies, C4 architecture boundaries, DB schemas, or API contracts MUST be accompanied by an ADR (\`node .agent/scripts/sdlc-engine.mjs adr create\`).

## 3. Robert Martin TDD & Dual-Gate Quality Verification (INV-02)
- Diff coverage threshold: >= 85% line and branch coverage.
- Mutation kill score: >= 80% using PITest, Stryker, mutmut, or cargo-mutants.
- Concentric ring Clean Architecture compliance: zero outer-layer imports into domain entities (\`.archlens/policy.json\`).

## 4. Universal Router + 8 Verb Skills Suite (ADR-004)
- \`/sdlc\`: Universal 1:1 subcommand router (\`/sdlc doctor\`, \`/sdlc begin #id\`, \`/sdlc status\`, \`/sdlc drift\`, \`/sdlc pre-pr\`, \`/sdlc gate\`, \`/sdlc kanban\`, \`/sdlc ui\`).
- \`/sdlc-flow\`: End-to-end ticket autopilot (\`stage begin\` -> TDD -> \`stage pre-pr\` -> parallel review -> \`stage complete\`).
- \`/sdlc-product\`: Constitutional \`PRODUCT.md\` autopilot, \`docs/specs/\` architect, and topological DAG waves.
- \`/sdlc-doctor\`: Stack detection, \`doctor --fix\`, 4-Layer Git hooks, \`.archlens/policy.json\`, and multi-agent installer.
- \`/sdlc-status\`: Active session, 8-stage progress, drift check, \`KANBAN.md\` state, and live Architecture Diff UI.
- \`/sdlc-tdd\`: Robert Martin Red-Green-Refactor TDD, polyglot test runners, and real coverage/mutation report parsers.
- \`/sdlc-gate\`: Parallel fork-join PR review subagents, \`gate --strict\`, and Stage 7 SHA-256 Merkle Gate Receipt.
- \`/sdlc-adr\`: Mint or approve Spec-Drift ADRs and synchronize \`docs/DECISION_MAP.md\`.
- \`/sdlc-release\`: README/Docs/Wiki sync, SemVer tagging, regression proofs, and live canary watchdog.
`;

/**
 * Resolves the root directory of the bundled Agentic SDLC Framework package
 * (whether invoked via `npx github:fmatar/agentic-sdlc-framework` or locally).
 */
export function resolvePackageRoot() {
  return path.resolve(import.meta.dirname, '../../..');
}

/**
 * Removes deprecated pre-v0.1.0 sdlc-* skill directories from any target directory.
 */
export function pruneDeprecatedSkills(skillsDir) {
  if (!skillsDir || !fileExists(skillsDir)) return [];
  const pruned = [];
  for (const deprecated of DEPRECATED_SDLC_SKILLS) {
    const candidate = path.join(skillsDir, deprecated);
    if (fileExists(candidate)) {
      try {
        fs.rmSync(candidate, { recursive: true, force: true });
        pruned.push(deprecated);
      } catch {}
    }
    const candidateMd = path.join(skillsDir, `${deprecated}.md`);
    if (fileExists(candidateMd)) {
      try {
        fs.unlinkSync(candidateMd);
        pruned.push(`${deprecated}.md`);
      } catch {}
    }
    const candidateMdc = path.join(skillsDir, `${deprecated}.mdc`);
    if (fileExists(candidateMdc)) {
      try {
        fs.unlinkSync(candidateMdc);
        pruned.push(`${deprecated}.mdc`);
      } catch {}
    }
  }
  return pruned;
}

function copyDirRecursive(srcDir, destDir) {
  if (!fileExists(srcDir)) return 0;
  fs.mkdirSync(destDir, { recursive: true });
  let count = 0;
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.cache' || entry.name === '.sdlc-session.json' || entry.name === '.DS_Store') {
      continue;
    }
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      count += copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      if (destPath.endsWith('.sh') || destPath.endsWith('.mjs')) {
        try {
          fs.chmodSync(destPath, 0o755);
        } catch {}
      }
      count++;
    }
  }
  return count;
}

function loadCanonicalSkills(packageRoot = resolvePackageRoot()) {
  const skillsRoot = path.join(packageRoot, '.agent/skills');
  const loaded = [];
  for (const skillName of CANONICAL_SDLC_SKILLS) {
    const skillPath = path.join(skillsRoot, skillName, 'SKILL.md');
    if (fileExists(skillPath)) {
      const raw = readFileSafe(skillPath) || '';
      const parsed = parseFrontmatter(raw);
      loaded.push({
        id: skillName,
        description: parsed.frontmatter.description || skillName,
        raw,
        body: parsed.body || raw
      });
    }
  }
  return loaded;
}

export function normalizeAgentList(agentsInput = ['gemini', 'claude', 'cursor']) {
  const validIds = new Set(SUPPORTED_AGENTS.map((a) => a.id));
  const aliasMap = {
    antigravity: 'gemini',
    'google-gemini': 'gemini',
    'claude-code': 'claude',
    anthropic: 'claude',
    xai: 'grok',
    'grok-cli': 'grok',
    codeium: 'windsurf',
    opencode: 'windsurf',
    'github-copilot': 'copilot',
    codex: 'copilot',
    openai: 'copilot'
  };

  const rawList = Array.isArray(agentsInput)
    ? agentsInput
    : String(agentsInput || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

  if (rawList.includes('all') || rawList.includes('*')) {
    return SUPPORTED_AGENTS.map((a) => a.id);
  }

  const normalized = [];
  for (const item of rawList) {
    const key = aliasMap[item] || item;
    if (validIds.has(key) && !normalized.includes(key)) {
      normalized.push(key);
    }
  }

  return normalized.length > 0 ? normalized : ['gemini', 'claude', 'cursor'];
}

/**
 * Provisions native skills, slash commands, and constitutional rule files
 * for the selected AI coding tools in either local project or global user scope.
 */
export function provisionAgentIntegrations({
  agents = ['gemini', 'claude', 'cursor'],
  targetDir = '.',
  global = false,
  homeDir = os.homedir(),
  packageRoot = resolvePackageRoot()
} = {}) {
  const selectedIds = normalizeAgentList(agents);
  const skills = loadCanonicalSkills(packageRoot);
  const absTarget = path.resolve(targetDir);
  const filesCreated = [];
  const prunedSkills = [];

  // Always prune deprecated skills in common project/global directories
  if (global) {
    prunedSkills.push(...pruneDeprecatedSkills(path.join(homeDir, '.gemini/config/skills')));
    prunedSkills.push(...pruneDeprecatedSkills(path.join(homeDir, '.claude/skills')));
    prunedSkills.push(...pruneDeprecatedSkills(path.join(homeDir, '.claude/commands')));
    prunedSkills.push(...pruneDeprecatedSkills(path.join(homeDir, '.grok/skills')));
  } else {
    prunedSkills.push(...pruneDeprecatedSkills(path.join(absTarget, '.agent/skills')));
    prunedSkills.push(...pruneDeprecatedSkills(path.join(absTarget, '.agents/skills')));
    prunedSkills.push(...pruneDeprecatedSkills(path.join(absTarget, '.claude/skills')));
    prunedSkills.push(...pruneDeprecatedSkills(path.join(absTarget, '.claude/commands')));
    prunedSkills.push(...pruneDeprecatedSkills(path.join(absTarget, '.grok/skills')));
    prunedSkills.push(...pruneDeprecatedSkills(path.join(absTarget, '.cursor/rules')));
    prunedSkills.push(...pruneDeprecatedSkills(path.join(absTarget, '.windsurf/workflows')));
  }

  for (const agentId of selectedIds) {
    if (agentId === 'gemini') {
      const baseSkillsDir = global
        ? path.join(homeDir, '.gemini/config/skills')
        : path.join(absTarget, '.agent/skills');
      for (const sk of skills) {
        const destFile = path.join(baseSkillsDir, sk.id, 'SKILL.md');
        fs.mkdirSync(path.dirname(destFile), { recursive: true });
        fs.writeFileSync(destFile, sk.raw, 'utf8');
        filesCreated.push(global ? `~/.gemini/config/skills/${sk.id}/SKILL.md` : `.agent/skills/${sk.id}/SKILL.md`);
      }
      if (!global) {
        const agentsMdPath = path.join(absTarget, 'AGENTS.md');
        if (!fileExists(agentsMdPath)) {
          fs.writeFileSync(agentsMdPath, CONSTITUTIONAL_RULES_SUMMARY, 'utf8');
          filesCreated.push('AGENTS.md');
        }
      }
    }

    if (agentId === 'claude') {
      const claudeRoot = global ? path.join(homeDir, '.claude') : path.join(absTarget, '.claude');
      const claudeSkillsDir = path.join(claudeRoot, 'skills');
      const claudeCommandsDir = path.join(claudeRoot, 'commands');
      fs.mkdirSync(claudeSkillsDir, { recursive: true });
      fs.mkdirSync(claudeCommandsDir, { recursive: true });

      for (const sk of skills) {
        const skillFile = path.join(claudeSkillsDir, sk.id, 'SKILL.md');
        fs.mkdirSync(path.dirname(skillFile), { recursive: true });
        fs.writeFileSync(skillFile, sk.raw, 'utf8');

        const cmdFile = path.join(claudeCommandsDir, `${sk.id}.md`);
        const cmdContent = `---\ndescription: ${sk.description}\n---\n\n${sk.body}\n`;
        fs.writeFileSync(cmdFile, cmdContent, 'utf8');
        filesCreated.push(global ? `~/.claude/commands/${sk.id}.md` : `.claude/commands/${sk.id}.md`);
      }

      if (!global) {
        const claudeMdPath = path.join(absTarget, 'CLAUDE.md');
        fs.writeFileSync(claudeMdPath, CONSTITUTIONAL_RULES_SUMMARY, 'utf8');
        filesCreated.push('CLAUDE.md');

        const settingsPath = path.join(claudeRoot, 'settings.json');
        const settings = {
          rules: ['CLAUDE.md'],
          skillsDir: '.claude/skills',
          commands: {
            'sdlc-flow': 'node .agent/scripts/sdlc-engine.mjs gate --strict',
            'sdlc-test': 'node .agent/scripts/sdlc-engine.mjs test --affected-only',
            'sdlc-doctor': 'node .agent/scripts/sdlc-engine.mjs doctor --fix'
          }
        };
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
        filesCreated.push('.claude/settings.json');
      }
    }

    if (agentId === 'cursor') {
      const cursorRulesDir = global
        ? path.join(homeDir, '.cursor/rules')
        : path.join(absTarget, '.cursor/rules');
      fs.mkdirSync(cursorRulesDir, { recursive: true });

      const masterMdc = path.join(cursorRulesDir, 'agentic-sdlc.mdc');
      fs.writeFileSync(
        masterMdc,
        `---\ndescription: Agentic SDLC Framework Lifecycle, TDD, and Dual-Gate Quality Rules\nglobs: *\nalwaysApply: true\n---\n\n${CONSTITUTIONAL_RULES_SUMMARY}\n`,
        'utf8'
      );
      filesCreated.push(global ? '~/.cursor/rules/agentic-sdlc.mdc' : '.cursor/rules/agentic-sdlc.mdc');

      for (const sk of skills) {
        const skillMdc = path.join(cursorRulesDir, `${sk.id}.mdc`);
        fs.writeFileSync(
          skillMdc,
          `---\ndescription: ${sk.description}\nglobs: *\nalwaysApply: false\n---\n\n${sk.body}\n`,
          'utf8'
        );
        filesCreated.push(global ? `~/.cursor/rules/${sk.id}.mdc` : `.cursor/rules/${sk.id}.mdc`);
      }

      if (!global) {
        const cursorRulesLegacy = path.join(absTarget, '.cursorrules');
        fs.writeFileSync(cursorRulesLegacy, CONSTITUTIONAL_RULES_SUMMARY, 'utf8');
        filesCreated.push('.cursorrules');
      }
    }

    if (agentId === 'grok') {
      const grokRoot = global ? path.join(homeDir, '.grok') : path.join(absTarget, '.grok');
      const grokSkillsDir = path.join(grokRoot, 'skills');
      fs.mkdirSync(grokSkillsDir, { recursive: true });

      for (const sk of skills) {
        const destFile = path.join(grokSkillsDir, sk.id, 'SKILL.md');
        fs.mkdirSync(path.dirname(destFile), { recursive: true });
        fs.writeFileSync(destFile, sk.raw, 'utf8');
        filesCreated.push(global ? `~/.grok/skills/${sk.id}/SKILL.md` : `.grok/skills/${sk.id}/SKILL.md`);
      }

      const grokMdPath = global ? path.join(grokRoot, 'GROK.md') : path.join(absTarget, 'GROK.md');
      fs.writeFileSync(grokMdPath, CONSTITUTIONAL_RULES_SUMMARY, 'utf8');
      filesCreated.push(global ? '~/.grok/GROK.md' : 'GROK.md');

      const grokSettingsPath = path.join(grokRoot, 'settings.json');
      fs.writeFileSync(
        grokSettingsPath,
        JSON.stringify(
          {
            instructionsFile: global ? '~/.grok/GROK.md' : 'GROK.md',
            skillsDirectory: global ? '~/.grok/skills' : '.grok/skills',
            engineCommand: 'node .agent/scripts/sdlc-engine.mjs'
          },
          null,
          2
        ),
        'utf8'
      );
      filesCreated.push(global ? '~/.grok/settings.json' : '.grok/settings.json');
    }

    if (agentId === 'windsurf') {
      if (global) {
        const wsGlobal = path.join(homeDir, '.codeium/windsurf/memories/global_rules.md');
        fs.mkdirSync(path.dirname(wsGlobal), { recursive: true });
        fs.writeFileSync(wsGlobal, CONSTITUTIONAL_RULES_SUMMARY, 'utf8');
        filesCreated.push('~/.codeium/windsurf/memories/global_rules.md');
      } else {
        const wsRulesDir = path.join(absTarget, '.windsurf/rules');
        const wsWorkflowsDir = path.join(absTarget, '.windsurf/workflows');
        fs.mkdirSync(wsRulesDir, { recursive: true });
        fs.mkdirSync(wsWorkflowsDir, { recursive: true });

        fs.writeFileSync(path.join(wsRulesDir, 'agentic-sdlc.md'), CONSTITUTIONAL_RULES_SUMMARY, 'utf8');
        filesCreated.push('.windsurf/rules/agentic-sdlc.md');

        for (const sk of skills) {
          const wfPath = path.join(wsWorkflowsDir, `${sk.id}.md`);
          fs.writeFileSync(wfPath, `---\ndescription: ${sk.description}\n---\n\n${sk.body}\n`, 'utf8');
          filesCreated.push(`.windsurf/workflows/${sk.id}.md`);
        }

        const wsLegacy = path.join(absTarget, '.windsurfrules');
        fs.writeFileSync(wsLegacy, CONSTITUTIONAL_RULES_SUMMARY, 'utf8');
        filesCreated.push('.windsurfrules');
      }
    }

    if (agentId === 'copilot') {
      const ghDir = global ? path.join(homeDir, '.github') : path.join(absTarget, '.github');
      const promptsDir = path.join(ghDir, 'prompts');
      fs.mkdirSync(promptsDir, { recursive: true });

      const copilotInstr = path.join(ghDir, 'copilot-instructions.md');
      fs.writeFileSync(copilotInstr, CONSTITUTIONAL_RULES_SUMMARY, 'utf8');
      filesCreated.push(global ? '~/.github/copilot-instructions.md' : '.github/copilot-instructions.md');

      for (const sk of skills) {
        const promptFile = path.join(promptsDir, `${sk.id}.prompt.md`);
        fs.writeFileSync(
          promptFile,
          `---\nmode: 'agent'\ndescription: '${sk.description.replace(/'/g, "''")}'\n---\n\n${sk.body}\n`,
          'utf8'
        );
        filesCreated.push(global ? `~/.github/prompts/${sk.id}.prompt.md` : `.github/prompts/${sk.id}.prompt.md`);
      }

      if (!global) {
        const agentsMdPath = path.join(absTarget, 'AGENTS.md');
        if (!fileExists(agentsMdPath)) {
          fs.writeFileSync(agentsMdPath, CONSTITUTIONAL_RULES_SUMMARY, 'utf8');
          filesCreated.push('AGENTS.md');
        }
      }
    }
  }

  return {
    selectedAgents: selectedIds,
    skillsCount: skills.length,
    filesCreated,
    prunedSkills: Array.from(new Set(prunedSkills))
  };
}

/**
 * Interactive ANSI Multi-Select & Single-Select TUI Wizard using Node's built-in `readline`.
 */
async function promptMultiSelect(title, subtitle, items) {
  return new Promise((resolve) => {
    let cursor = 0;
    const selected = new Set(items.filter((i) => i.defaultSelected).map((_, idx) => idx));

    const render = (first = false) => {
      if (!first) {
        process.stdout.write(`\x1b[${items.length + 3}A\x1b[0J`);
      }
      process.stdout.write(`\x1b[1m\x1b[36m? ${title}\x1b[0m \x1b[2m${subtitle}\x1b[0m\n`);
      for (let i = 0; i < items.length; i++) {
        const isCur = i === cursor;
        const isSel = selected.has(i);
        const pointer = isCur ? '\x1b[36m❯\x1b[0m' : ' ';
        const checkbox = isSel ? '\x1b[32m◉\x1b[0m' : '\x1b[2m◯\x1b[0m';
        const label = isCur ? `\x1b[1m${items[i].label}\x1b[0m` : items[i].label;
        const hint = items[i].hint ? ` \x1b[2m(${items[i].hint})\x1b[0m` : '';
        process.stdout.write(`  ${pointer} ${checkbox} ${label}${hint}\n`);
      }
      process.stdout.write(`\x1b[2m  [↑/↓] Navigate   [Space] Toggle   [a] All   [Enter] Confirm\x1b[0m\n\n`);
    };

    readline.emitKeypressEvents(process.stdin);
    const wasRaw = process.stdin.isRaw;
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();

    render(true);

    const onKeypress = (str, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        if (process.stdin.isTTY) process.stdin.setRawMode(Boolean(wasRaw));
        process.stdin.removeListener('keypress', onKeypress);
        process.stdout.write('\n\x1b[31m✖ Installation cancelled.\x1b[0m\n');
        process.exit(130);
      }
      if (key.name === 'up' || key.name === 'k') {
        cursor = (cursor - 1 + items.length) % items.length;
        render(false);
      } else if (key.name === 'down' || key.name === 'j') {
        cursor = (cursor + 1) % items.length;
        render(false);
      } else if (key.name === 'space') {
        if (selected.has(cursor)) selected.delete(cursor);
        else selected.add(cursor);
        render(false);
      } else if (str === 'a' || str === 'A') {
        if (selected.size === items.length) selected.clear();
        else items.forEach((_, idx) => selected.add(idx));
        render(false);
      } else if (key.name === 'return' || key.name === 'enter') {
        if (process.stdin.isTTY) process.stdin.setRawMode(Boolean(wasRaw));
        process.stdin.removeListener('keypress', onKeypress);
        process.stdin.pause();
        const chosen = Array.from(selected).map((idx) => items[idx].value);
        resolve(chosen.length > 0 ? chosen : [items[0].value]);
      }
    };

    process.stdin.on('keypress', onKeypress);
  });
}

async function promptSingleSelect(title, items) {
  return new Promise((resolve) => {
    let cursor = 0;

    const render = (first = false) => {
      if (!first) {
        process.stdout.write(`\x1b[${items.length + 3}A\x1b[0J`);
      }
      process.stdout.write(`\x1b[1m\x1b[36m? ${title}\x1b[0m\n`);
      for (let i = 0; i < items.length; i++) {
        const isCur = i === cursor;
        const pointer = isCur ? '\x1b[36m❯\x1b[0m' : ' ';
        const radio = isCur ? '\x1b[32m●\x1b[0m' : '\x1b[2m○\x1b[0m';
        const label = isCur ? `\x1b[1m${items[i].label}\x1b[0m` : items[i].label;
        const hint = items[i].hint ? ` \x1b[2m— ${items[i].hint}\x1b[0m` : '';
        process.stdout.write(`  ${pointer} ${radio} ${label}${hint}\n`);
      }
      process.stdout.write(`\x1b[2m  [↑/↓] Navigate   [Enter] Select\x1b[0m\n\n`);
    };

    readline.emitKeypressEvents(process.stdin);
    const wasRaw = process.stdin.isRaw;
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();

    render(true);

    const onKeypress = (_, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        if (process.stdin.isTTY) process.stdin.setRawMode(Boolean(wasRaw));
        process.stdin.removeListener('keypress', onKeypress);
        process.stdout.write('\n\x1b[31m✖ Installation cancelled.\x1b[0m\n');
        process.exit(130);
      }
      if (key.name === 'up' || key.name === 'k') {
        cursor = (cursor - 1 + items.length) % items.length;
        render(false);
      } else if (key.name === 'down' || key.name === 'j') {
        cursor = (cursor + 1) % items.length;
        render(false);
      } else if (key.name === 'return' || key.name === 'enter') {
        if (process.stdin.isTTY) process.stdin.setRawMode(Boolean(wasRaw));
        process.stdin.removeListener('keypress', onKeypress);
        process.stdin.pause();
        resolve(items[cursor].value);
      }
    };

    process.stdin.on('keypress', onKeypress);
  });
}

export async function runInteractiveWizard() {
  console.log('\n\x1b[1m\x1b[35m╭──────────────────────────────────────────────────────────────────────────╮\x1b[0m');
  console.log('\x1b[1m\x1b[35m│\x1b[0m   ⚡ \x1b[1mAGENTIC SDLC FRAMEWORK — INTERACTIVE MULTI-AGENT INSTALLER (v0.1.0)\x1b[0m  \x1b[1m\x1b[35m│\x1b[0m');
  console.log('\x1b[1m\x1b[35m│\x1b[0m   \x1b[2m6 Consolidated Skills • Dual-Gate TDD • 4-Layer Git Guard • Archlens\x1b[0m   \x1b[1m\x1b[35m│\x1b[0m');
  console.log('\x1b[1m\x1b[35m╰──────────────────────────────────────────────────────────────────────────╯\x1b[0m\n');

  const agents = await promptMultiSelect(
    'Select the AI coding agents & IDEs to configure:',
    '(Press Space to toggle, Enter to confirm)',
    SUPPORTED_AGENTS.map((a) => ({
      label: a.name,
      hint: a.badge,
      value: a.id,
      defaultSelected: a.defaultSelected
    }))
  );

  const scope = await promptSingleSelect('Select installation scope:', [
    {
      label: 'Local Workspace (Recommended)',
      hint: 'Installs skills, engine (.agent/scripts), templates, and project rules into current directory',
      value: 'local'
    },
    {
      label: 'Global User Environment',
      hint: 'Installs skills & scripts globally into ~/.gemini, ~/.claude, ~/.grok, ~/.cursor',
      value: 'global'
    }
  ]);

  let addons = ['detect', 'hooks', 'archlens'];
  let pmProvider = 'github';
  if (scope === 'local') {
    pmProvider = await promptSingleSelect('Select your Project Management & Ticket Provider:', [
      {
        label: 'GitHub Issues & Projects v2 (Recommended)',
        hint: 'Uses gh CLI + .github/ISSUE_TEMPLATE/*.md',
        value: 'github'
      },
      {
        label: 'Linear (GraphQL API)',
        hint: 'Uses LINEAR_API_KEY + LINEAR_TEAM_KEY with local KANBAN.md mirror',
        value: 'linear'
      },
      {
        label: 'Jira (REST API v3)',
        hint: 'Uses JIRA_BASE_URL + JIRA_EMAIL + JIRA_API_TOKEN with local KANBAN.md mirror',
        value: 'jira'
      },
      {
        label: 'Local Kanban Only (Offline)',
        hint: 'Manages tickets exclusively in docs/KANBAN.md',
        value: 'local'
      }
    ]);

    addons = await promptMultiSelect(
      'Select SDLC Governance & Automation Add-ons:',
      '(Press Space to toggle, Enter to confirm)',
      [
        {
          label: 'Auto-Detect Project Stack',
          hint: 'Generates .agent/sdlc-config.json for Node, Java, Python, Go, or Rust',
          value: 'detect',
          defaultSelected: true
        },
        {
          label: '4-Layer Git Guard Hooks',
          hint: 'Installs pre-commit, pre-merge-commit, and pre-push hooks',
          value: 'hooks',
          defaultSelected: true
        },
        {
          label: 'Archlens Concentric Ring Policy',
          hint: 'Scaffolds .archlens/policy.json Clean Architecture boundaries',
          value: 'archlens',
          defaultSelected: true
        },
        {
          label: 'GitHub Actions Quality Gate CI',
          hint: 'Scaffolds .github/workflows/sdlc-quality-gate.yml',
          value: 'ci',
          defaultSelected: false
        }
      ]
    );
  }

  return {
    agents,
    global: scope === 'global',
    pmProvider,
    skipDetect: !addons.includes('detect'),
    withHooks: addons.includes('hooks'),
    withArchlens: addons.includes('archlens'),
    withCi: addons.includes('ci')
  };
}

/**
 * Core programmatic installer used by both `npx github:fmatar/agentic-sdlc-framework install`
 * and unit tests.
 */
export function installFramework({
  targetDir = '.',
  repoRoot = '.',
  global = false,
  agents = ['gemini', 'claude', 'cursor'],
  pmProvider = null,
  withArchlens = false,
  withHooks = false,
  withCi = false,
  skipDetect = false,
  homeDir = os.homedir(),
  packageRoot = resolvePackageRoot(),
  onDetect = null,
  onInstallCi = null
} = {}) {
  const isGlobal = Boolean(global);
  const absTarget = path.resolve(repoRoot, targetDir);
  const srcSkills = path.join(packageRoot, '.agent/skills');
  const srcScripts = path.join(packageRoot, '.agent/scripts');
  const srcTemplates = path.join(packageRoot, 'docs/templates');

  let destSkills;
  let destScripts;
  const prePruned = [];

  if (isGlobal) {
    destSkills = path.join(homeDir, '.gemini/config/skills');
    destScripts = path.join(homeDir, '.gemini/config/scripts');
    fs.mkdirSync(destSkills, { recursive: true });
    fs.mkdirSync(destScripts, { recursive: true });
    prePruned.push(...pruneDeprecatedSkills(destSkills));
    if (path.resolve(srcScripts) !== path.resolve(destScripts)) {
      copyDirRecursive(srcScripts, destScripts);
    }
  } else {
    fs.mkdirSync(absTarget, { recursive: true });
    destSkills = path.join(absTarget, '.agent/skills');
    destScripts = path.join(absTarget, '.agent/scripts');
    const destTemplates = path.join(absTarget, 'docs/templates');

    prePruned.push(...pruneDeprecatedSkills(destSkills));
    prePruned.push(...pruneDeprecatedSkills(path.join(absTarget, '.agents/skills')));

    if (path.resolve(srcSkills) !== path.resolve(destSkills)) {
      copyDirRecursive(srcSkills, destSkills);
    }
    if (path.resolve(srcScripts) !== path.resolve(destScripts)) {
      copyDirRecursive(srcScripts, destScripts);
    }
    if (fileExists(srcTemplates) && path.resolve(srcTemplates) !== path.resolve(destTemplates)) {
      copyDirRecursive(srcTemplates, destTemplates);
    }
  }

  const agentResult = provisionAgentIntegrations({
    agents,
    targetDir: absTarget,
    global: isGlobal,
    homeDir,
    packageRoot
  });

  const allPruned = Array.from(new Set([...prePruned, ...agentResult.prunedSkills]));

  const addonsInstalled = [];
  if (!isGlobal) {
    scaffoldIssueTemplates({ repoRoot: absTarget });
    addonsInstalled.push('.github/ISSUE_TEMPLATE');

    if (withArchlens) {
      scaffoldArchlensPolicy(absTarget);
      addonsInstalled.push('.archlens/policy.json');
    }
    if (withHooks && fileExists(path.join(absTarget, '.git'))) {
      installHooks({ repoRoot: absTarget });
      addonsInstalled.push('git-hooks');
    }
    if (withCi && typeof onInstallCi === 'function') {
      onInstallCi({ repoRoot: absTarget });
      addonsInstalled.push('.github/workflows/sdlc-quality-gate.yml');
    }
    if (!skipDetect && typeof onDetect === 'function') {
      onDetect(absTarget);
      addonsInstalled.push('stack-detect');
    }
    if (pmProvider) {
      const cfgPath = path.join(absTarget, '.agent/sdlc-config.json');
      let cfgObj = {};
      if (fileExists(cfgPath)) {
        try {
          cfgObj = JSON.parse(readFileSafe(cfgPath)) || {};
        } catch {}
      }
      cfgObj.projectManagement = {
        ...(cfgObj.projectManagement || {}),
        provider: String(pmProvider).toLowerCase()
      };
      fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
      fs.writeFileSync(cfgPath, JSON.stringify(cfgObj, null, 2) + '\n', 'utf8');
      addonsInstalled.push(`pm:${String(pmProvider).toLowerCase()}`);
    }
  }

  return {
    success: true,
    global: isGlobal,
    mode: isGlobal ? 'global' : 'local',
    targetDir: isGlobal ? homeDir : absTarget,
    destSkills,
    destScripts,
    selectedAgents: agentResult.selectedAgents,
    skillsCount: agentResult.skillsCount,
    filesCreated: agentResult.filesCreated,
    prunedSkills: allPruned,
    addonsInstalled
  };
}

export function parseInstallArgs(args = [], repoRoot = '.') {
  let isGlobal = false;
  let targetDir = '.';
  let agentsArg = null;
  let pmProvider = null;
  let withArchlens = false;
  let withHooks = false;
  let withCi = false;
  let skipDetect = false;
  let nonInteractive = false;
  let help = false;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      help = true;
    } else if (arg === '-g' || arg === '--global') {
      isGlobal = true;
    } else if (arg === '-l' || arg === '--local' || arg === '--target' || arg === '-t') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        targetDir = args[++i];
      }
    } else if (arg.startsWith('--target=')) {
      targetDir = arg.split('=')[1];
    } else if (arg === '--agents' || arg === '--agent' || arg === '-a') {
      if (args[i + 1]) agentsArg = args[++i];
    } else if (arg.startsWith('--agents=')) {
      agentsArg = arg.split('=')[1];
    } else if (arg === '--pm' || arg === '--provider') {
      if (args[i + 1]) pmProvider = args[++i].toLowerCase();
    } else if (arg.startsWith('--pm=') || arg.startsWith('--provider=')) {
      pmProvider = arg.split('=')[1].toLowerCase();
    } else if (arg === '--with-archlens') {
      withArchlens = true;
    } else if (arg === '--with-hooks') {
      withHooks = true;
    } else if (arg === '--with-ci') {
      withCi = true;
    } else if (arg === '--skip-detect') {
      skipDetect = true;
    } else if (arg === '-y' || arg === '--yes' || arg === '--non-interactive') {
      nonInteractive = true;
    } else if (!arg.startsWith('-') && i === 1) {
      targetDir = arg;
    }
  }

  return {
    help,
    repoRoot,
    targetDir,
    global: isGlobal,
    agentsArg,
    agents: agentsArg ? normalizeAgentList(agentsArg) : ['gemini', 'claude', 'cursor'],
    pmProvider,
    withArchlens,
    withHooks,
    withCi,
    skipDetect,
    nonInteractive
  };
}

export function printInstallerHelp() {
  console.log(`
⚡ Agentic SDLC Framework — Universal Multi-Agent Installer (v0.1.0)

Usage:
  npx github:fmatar/agentic-sdlc-framework install [options]

Options:
  --agents <list>      Comma-separated agents: gemini,claude,cursor,grok,windsurf,copilot,all
  -g, --global         Install globally into ~/.gemini, ~/.claude, ~/.grok, ~/.cursor
  -l, --local [dir]    Install into target project directory (default: current directory)
  --target <dir>       Alias for --local <dir>
  --with-archlens      Scaffold .archlens/policy.json Clean Architecture boundaries
  --with-hooks         Install 4-Layer Git Guard hooks (pre-commit, pre-merge, pre-push)
  --with-ci            Scaffold .github/workflows/sdlc-quality-gate.yml
  --skip-detect        Skip automatic polyglot stack detection
  -y, --yes            Run non-interactively with recommended defaults
  -h, --help           Display this help guide

Examples:
  # Launch the interactive multi-agent TUI wizard
  npx github:fmatar/agentic-sdlc-framework install

  # Install non-interactively for Claude Code, Gemini, Grok, and Cursor
  npx github:fmatar/agentic-sdlc-framework install --agents claude,gemini,grok,cursor --yes

  # Install globally for all supported agents
  npx github:fmatar/agentic-sdlc-framework install --global --agents all --yes
`);
}

export async function runInstallerCLI(args = [], { repoRoot = '.', onDetect = null, onInstallCi = null } = {}) {
  const parsed = parseInstallArgs(args, repoRoot);
  if (parsed.help) {
    printInstallerHelp();
    return { success: true, help: true };
  }

  const canRunTui =
    Boolean(process.stdin.isTTY && process.stdout.isTTY) &&
    !parsed.nonInteractive &&
    !parsed.agentsArg &&
    !process.env.CI &&
    !process.env.NODE_TEST_CONTEXT;

  let options = {
    ...parsed
  };

  if (canRunTui) {
    const wizardChoices = await runInteractiveWizard();
    options = {
      ...options,
      ...wizardChoices
    };
  }

  const res = installFramework({
    ...options,
    onDetect,
    onInstallCi
  });

  console.log('\n\x1b[1m\x1b[32m✅ Agentic SDLC Framework Installation Complete!\x1b[0m');
  console.log(`   • \x1b[1mMode\x1b[0m:             ${res.mode.toUpperCase()} (${res.targetDir})`);
  console.log(`   • \x1b[1mSDLC Skills\x1b[0m:      ${res.skillsCount} canonical skills loaded (${CANONICAL_SDLC_SKILLS.join(', ')})`);
  console.log(`   • \x1b[1mConfigured Tools\x1b[0m: ${res.selectedAgents.join(', ')}`);
  if (res.prunedSkills.length > 0) {
    console.log(`   • \x1b[1mPruned Legacy\x1b[0m:    Removed ${res.prunedSkills.length} deprecated skill item(s)`);
  }
  if (res.addonsInstalled.length > 0) {
    console.log(`   • \x1b[1mGovernance\x1b[0m:       ${res.addonsInstalled.join(', ')}`);
  }
  console.log('\n👉 \x1b[1mNext Step\x1b[0m: Prompt your agent with \x1b[36m/sdlc-product\x1b[0m or \x1b[36m/sdlc-flow\x1b[0m!\n');

  return res;
}
