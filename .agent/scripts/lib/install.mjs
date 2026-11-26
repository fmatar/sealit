import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { assertNoSymlinkAncestors, fileExists, gitOutput, parseFrontmatter, readFileSafe, resolveGitCommonRepoRoot, writeFileAtomic } from './git.mjs';
import { DEFAULT_CI_RUNS_ON, DEFAULT_QUALITY_GATE_CHECK, generateConfig, isEngineOwnerRepo, loadConfig, upgradeConfigToV010, validateConfigFile } from './config.mjs';
import { inspectReceiptKeyStatus, loadReceiptKey, verifyAuditChain } from './receipt.mjs';
import { inspectHooks, installHooks } from './guard.mjs';

export const CANONICAL_SKILLS = Object.freeze(['sealit', 'sealit-spec', 'sealit-adr', 'sealit-tdd', 'sealit-gate', 'sealit-flow']);
export const RETIRED_SKILLS = Object.freeze([
  'sdlc', 'sdlc-spec', 'sdlc-adr', 'sdlc-tdd', 'sdlc-gate', 'sdlc-flow',
  'sdlc-doctor', 'sdlc-product', 'sdlc-release', 'sdlc-status', 'sdlc-wiki', 'sdlc-initialize', 'sdlc-review', 'sdlc-test'
]);
export const SUPPORTED_AGENTS = Object.freeze(['antigravity', 'claude', 'cursor', 'codex', 'copilot']);
export const SEALIT_GITIGNORE_ENTRIES = Object.freeze([
  '.env', '.agent/.cache/', '.agent/.sealit-session.json', '.agent/.sealit-session.lock',
  '.agent/.sealit-config.lock', '.agent/.audit-chain.lock', '.agent/.receipt-key',
  '.agent/sealit-config.json.bak', '.stryker-tmp/', '.scratch/', 'coverage/', 'reports/'
]);
export const SDLC_GITIGNORE_ENTRIES = SEALIT_GITIGNORE_ENTRIES;

const SEALIT_ENGINE_CMD = 'node .agent/scripts/sealit-engine.mjs';
const LEGACY_CLAUDE_WILDCARDS = new Set([`Bash(${SEALIT_ENGINE_CMD} *)`, 'Bash(node .agent/scripts/sdlc-engine.mjs *)']);
// Read/measure commands only. Approve/sign/exempt/install commands (adr decide, review record, receipt,
// guard receipt, exemption add, protect, init, hooks, ci-workflow, doctor --fix) always prompt a human.
const CLAUDE_EXACT_ONLY = ['status', 'doctor', 'skill-audit', 'config check', 'session status'];
const CLAUDE_WITH_FLAGS = ['drift', 'test', 'coverage', 'mutation', 'gate', 'verify', 'guard verify', 'audit verify', 'review plan', 'review pr-body', 'pr-body', 'adr list', 'adr create', 'begin', 'end'];
export const CLAUDE_SEALIT_ALLOW_RULES = Object.freeze([
  ...CLAUDE_EXACT_ONLY.map((c) => `Bash(${SEALIT_ENGINE_CMD} ${c})`),
  ...CLAUDE_WITH_FLAGS.flatMap((c) => [`Bash(${SEALIT_ENGINE_CMD} ${c})`, `Bash(${SEALIT_ENGINE_CMD} ${c} *)`])
]);
export const CLAUDE_SEALIT_DENY_RULES = Object.freeze([
  'Read(.agent/.receipt-key)', 'Edit(.agent/.receipt-key)', 'Write(.agent/.receipt-key)',
  'Edit(.agent/.sealit-session.json)', 'Write(.agent/.sealit-session.json)'
]);
export const CLAUDE_SDLC_ALLOW_RULES = CLAUDE_SEALIT_ALLOW_RULES;

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ALLOWED_NPX_SPECS = new Set(['@sealit/cli', '@fmatar/sealit', 'github:fmatar/sealit']);

function normalizeAgentList(rawAgents) {
  const items = Array.isArray(rawAgents) ? rawAgents : String(rawAgents || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (items.includes('all')) return [...SUPPORTED_AGENTS];
  const out = new Set();
  for (const item of items) {
    const norm = item === 'gemini' ? 'antigravity' : item;
    if (SUPPORTED_AGENTS.includes(norm)) out.add(norm);
  }
  return out.size > 0 ? [...out] : ['antigravity', 'claude', 'cursor'];
}

function unlinkIfSymlink(targetPath) {
  try { if (fs.lstatSync(targetPath).isSymbolicLink()) { fs.unlinkSync(targetPath); return true; } } catch {}
  return false;
}

function safeWriteFile(targetPath, content, mode = undefined, baseRoot = null) {
  if (baseRoot) assertNoSymlinkAncestors(baseRoot, path.dirname(targetPath));
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  unlinkIfSymlink(targetPath);
  fs.writeFileSync(targetPath, content, typeof mode === 'number' ? { encoding: 'utf8', mode } : 'utf8');
}

function safeRemoveDir(targetDir, baseRoot = null) {
  if (baseRoot) assertNoSymlinkAncestors(baseRoot, path.dirname(targetDir));
  if (!unlinkIfSymlink(targetDir) && fileExists(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
}

function safeCopyDir(srcDir, dstDir, { chmodExecutable = false, errors = [], fsImpl = fs, baseRoot = null } = {}) {
  if (!fileExists(srcDir)) return;
  if (baseRoot) assertNoSymlinkAncestors(baseRoot, path.dirname(dstDir));
  unlinkIfSymlink(dstDir);
  fsImpl.mkdirSync(dstDir, { recursive: true });
  for (const entry of fsImpl.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    unlinkIfSymlink(dstPath);
    if (entry.isDirectory()) {
      safeCopyDir(srcPath, dstPath, { chmodExecutable, errors, fsImpl, baseRoot });
    } else if (entry.isFile()) {
      fsImpl.copyFileSync(srcPath, dstPath);
      if (chmodExecutable && entry.name.endsWith('.mjs') && process.platform !== 'win32') {
        try { fsImpl.chmodSync(dstPath, 0o755); } catch (err) { errors.push(`chmodSync failed for '${dstPath}': ${err.message}`); }
      }
    }
  }
}

export function buildRulesBlock() {
  return [
    '<!-- SEALIT-RULES:START -->',
    '# Sealit Alignment + Proof Kernel Rules (v0.0.2)',
    '_Generated by sealit v0.0.2 (https://sealit.dev)_',
    '',
    '## 1. Git Flow & Active Session Guard (INV-01)',
    '- Never commit, merge, or push directly to `main` or `develop`.',
    '- Every commit requires an active session in `.agent/.sealit-session.json` matching the current branch (`node .agent/scripts/sealit-engine.mjs begin --checkout --title "<desc>"`).',
    '- Feature, fix, and chore PRs target `develop`; PRs targeting `main` originate exclusively from `develop`.',
    '- Merges into `develop` or `main` require a signed Stage 7 HMAC-SHA256 Gate Receipt in `docs/AUDIT_CHAIN.jsonl`.',
    '',
    '## 2. Single-Path Measured Gate & Architecture Rings (INV-02 & INV-04)',
    '- `node .agent/scripts/sealit-engine.mjs gate` evaluates `docs-only` vs `code` diffs, enforces `.archlens/policy.json` concentric rings, scans diffs for leaked secrets, and measures configured lint, build, test, diff coverage, and diff mutation thresholds.',
    '- All configured commands execute without shell interpolation (`INV-04`).',
    '',
    '## 3. Spec & ADR Alignment (INV-03)',
    '- Changes to `PRODUCT.md`, `docs/specs/*`, `.archlens/policy.json`, dependencies, schemas, or API contracts require an accepted ADR (`node .agent/scripts/sealit-engine.mjs adr create` -> `adr decide --status approve`).',
    '',
    '## 4. Canonical Skills Suite (6 Skills)',
    '- `/sealit`: Direct 1:1 CLI router (`init`, `doctor`, `begin`, `status`, `drift`, `adr`, `test`, `coverage`, `mutation`, `gate`, `review`, `receipt`, `verify`, `end`).',
    '- `/sealit-spec`: Pure-Markdown specification and `PRODUCT.md` alignment skill.',
    '- `/sealit-adr`: Spec-drift ADR creation and human approval workflow.',
    '- `/sealit-tdd`: Red-Green-Refactor TDD and measured diff coverage/mutation runner.',
    '- `/sealit-gate`: Read-only reviewer subagent dispatch, `sealit gate`, and signed Stage 7 receipt.',
    '- `/sealit-flow`: End-to-end branch delivery orchestrator (`begin -> align -> tdd -> gate -> receipt -> end`).',
    '<!-- SEALIT-RULES:END -->'
  ].join('\n');
}

function resolveUserFileTarget(filePath, allowedRoot = null, warnings = [], { onOutside = 'replace' } = {}) {
  if (allowedRoot) assertNoSymlinkAncestors(allowedRoot, path.dirname(filePath));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const st = fs.lstatSync(filePath, { throwIfNoEntry: false });
  if (!st || !st.isSymbolicLink()) return filePath;
  try {
    const realTarget = fs.realpathSync(filePath);
    const realRoot = allowedRoot ? fs.realpathSync(path.resolve(allowedRoot)) : null;
    if (realRoot) {
      const rel = path.relative(realRoot, realTarget);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        assertNoSymlinkAncestors(realRoot, path.dirname(realTarget));
        return realTarget;
      }
    }
  } catch {}
  if (onOutside === 'skip') {
    warnings.push(`Skipped updating '${path.basename(filePath)}': symlink target is outside the allowed root.`);
    return null;
  }
  fs.unlinkSync(filePath);
  warnings.push(`Replaced symlink '${path.basename(filePath)}' (target outside allowed root) with a regular file.`);
  return filePath;
}

export function upsertGitignore(targetDir = '.', { warnings = [] } = {}) {
  const absTarget = path.resolve(targetDir);
  const resolvedPath = resolveUserFileTarget(path.join(absTarget, '.gitignore'), absTarget, warnings);
  const exists = fileExists(resolvedPath);
  const raw = exists ? fs.readFileSync(resolvedPath, 'utf8') : '';
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lineSet = new Set(raw.split(/\r?\n/).map((l) => l.trim()));
  const missing = SEALIT_GITIGNORE_ENTRIES.filter((entry) => !lineSet.has(entry));
  if (missing.length === 0 && exists) {
    return { updated: false, added: [], path: resolvedPath };
  }
  const block = `# Sealit local state & secrets (managed)${eol}${missing.join(eol)}${eol}`;
  const trimmed = raw.trimEnd();
  const next = trimmed ? `${trimmed}${eol}${eol}${block}` : block;
  const effectiveRoot = resolvedPath !== path.join(absTarget, '.gitignore') ? fs.realpathSync(absTarget) : absTarget;
  assertNoSymlinkAncestors(effectiveRoot, path.dirname(resolvedPath));
  writeFileAtomic(resolvedPath, next);
  return { updated: true, added: missing, path: resolvedPath };
}

export function inspectGitignore(repoRoot = '.') {
  const absRoot = path.resolve(repoRoot);
  const rawPath = path.join(absRoot, '.gitignore');
  let content = null;
  try {
    const st = fs.lstatSync(rawPath, { throwIfNoEntry: false });
    if (st?.isSymbolicLink()) {
      const realTarget = fs.realpathSync(rawPath);
      const realRoot = fs.realpathSync(absRoot);
      const rel = path.relative(realRoot, realTarget);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        content = fs.readFileSync(realTarget, 'utf8');
      }
    } else if (st?.isFile()) {
      content = fs.readFileSync(rawPath, 'utf8');
    }
  } catch {}
  const lineSet = new Set(String(content || '').split(/\r?\n/).map((l) => l.trim()));
  const missing = SEALIT_GITIGNORE_ENTRIES.filter((entry) => !lineSet.has(entry));
  return {
    exists: content !== null,
    upToDate: missing.length === 0,
    criticalOk: !missing.includes('.agent/.receipt-key') && !missing.includes('.agent/.sealit-session.json'),
    missing
  };
}

const RULES_MARKER_RE = /<!-- (?:SEALIT|AGENTIC-SDLC)-RULES:START -->[\s\S]*?<!-- (?:SEALIT|AGENTIC-SDLC)-RULES:END -->/;

function upsertMarkedRulesFile(filePath, rulesBlock, baseRoot = null, warnings = []) {
  const resolvedPath = resolveUserFileTarget(filePath, baseRoot, warnings);
  const effectiveRoot = resolvedPath !== filePath && baseRoot ? fs.realpathSync(path.resolve(baseRoot)) : baseRoot;
  if (fileExists(resolvedPath)) {
    const existing = fs.readFileSync(resolvedPath, 'utf8');
    if (RULES_MARKER_RE.test(existing)) {
      const updated = existing.replace(RULES_MARKER_RE, () => rulesBlock);
      safeWriteFile(resolvedPath, updated.endsWith('\n') ? updated : `${updated}\n`, undefined, effectiveRoot);
      return;
    }
    safeWriteFile(resolvedPath, `${existing.trimEnd()}\n\n${rulesBlock}\n`, undefined, effectiveRoot);
    return;
  }
  safeWriteFile(resolvedPath, `${rulesBlock}\n`, undefined, effectiveRoot);
}

function adaptSkillContent(rawMarkdown, { globalEnginePath = null } = {}) {
  const out = String(rawMarkdown || '').replace(/\r\n/g, '\n');
  return globalEnginePath ? out.replace(/node \.agent\/scripts\/sealit-engine\.mjs/g, `node "${globalEnginePath}"`) : out;
}

function collectNpxManagedSkills(rootDir) {
  try { assertNoSymlinkAncestors(rootDir, path.join(rootDir, '.agents/skills')); } catch { return new Set(); }
  const realRoot = fs.realpathSync(rootDir);
  return new Set(CANONICAL_SKILLS.filter((id) => {
    try {
      const rel = path.relative(realRoot, fs.realpathSync(path.join(rootDir, '.agents/skills', id, 'SKILL.md')));
      return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
    } catch { return false; }
  }));
}

export function auditSkills(repoRoot = '.') {
  const absRoot = path.resolve(repoRoot);
  const skillsDir = path.join(absRoot, '.agent/skills');
  const findings = [];
  if (!fileExists(skillsDir)) {
    return { passed: false, skillsCount: 0, findings: [{ skill: '*', rule: 'DIR_MISSING', message: 'Missing .agent/skills directory.' }] };
  }
  const pluginPath = path.join(absRoot, '.claude-plugin/plugin.json');
  const hasPlugin = fileExists(pluginPath);

  for (const id of CANONICAL_SKILLS) {
    const skillPath = path.join(skillsDir, id, 'SKILL.md');
    if (!fileExists(skillPath)) {
      findings.push({ skill: id, rule: 'SKILL_MISSING', message: `Missing canonical skill '${id}/SKILL.md'.` });
      continue;
    }
    const raw = fs.readFileSync(skillPath, 'utf8').replace(/\r\n/g, '\n');
    const linesCount = raw.split('\n').length;
    const { frontmatter, body } = parseFrontmatter(raw);
    const isUserOnly = String(frontmatter['disable-model-invocation'] || '').toLowerCase() === 'true';

    if (!frontmatter.name || frontmatter.name !== id) {
      findings.push({ skill: id, rule: 'FM1', message: `Frontmatter 'name' must equal '${id}'.` });
    }
    const desc = String(frontmatter.description || '');
    if (!desc || desc.length > 220 || (!isUserOnly && !/\bUse when\b/i.test(desc))) {
      findings.push({ skill: id, rule: 'FM2', message: `Frontmatter 'description' in '${id}' must be <=220 chars${isUserOnly ? '' : " and include 'Use when'"}.` });
    }
    if (linesCount > 160) {
      findings.push({ skill: id, rule: 'LEN1', message: `Skill '${id}' exceeds 160 lines (${linesCount}).` });
    }
    for (const m of body.matchAll(/\bnpx\s+(?:--yes\s+|-y\s+)?(@?[a-z0-9._/:-]+)(?![@#/\w.:-])/gi)) {
      if (!ALLOWED_NPX_SPECS.has(m[1])) {
        findings.push({ skill: id, rule: 'RP1', message: `Unpinned npx package '${m[1]}' in '${id}/SKILL.md'.` });
      }
    }
    if (/\.\.\/(?:sealit|sdlc)-[a-z0-9-]+\/SKILL\.md/i.test(body)) {
      findings.push({ skill: id, rule: 'AS3', message: `Cross-skill relative file link detected in '${id}/SKILL.md'.` });
    }

    if (hasPlugin && isUserOnly !== (id === 'sealit')) {
      findings.push({ skill: id, rule: 'FM3', message: `Skill '${id}' must ${id === 'sealit' ? 'set' : 'omit'} 'disable-model-invocation: true'.` });
    }
    const oaiPath = path.join(skillsDir, id, 'agents/openai.yaml');
    if (fileExists(oaiPath) || hasPlugin) {
      const oaiRaw = readFileSafe(oaiPath) || '';
      const oaiDisablesImplicit = /^\s*allow_implicit_invocation:\s*false\s*(?:#.*)?$/m.test(oaiRaw);
      if (!oaiRaw || !/\bdisplay_name:/.test(oaiRaw) || !/\bshort_description:/.test(oaiRaw) || oaiDisablesImplicit !== isUserOnly) {
        findings.push({ skill: id, rule: 'OAI1', message: `Missing or out-of-sync '${id}/agents/openai.yaml' metadata.` });
      }
    }
  }

  if (hasPlugin) {
    try {
      const plg = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));
      const pkgRaw = readFileSafe(path.join(absRoot, 'package.json'));
      const pkgVer = pkgRaw ? JSON.parse(pkgRaw).version : null;
      const expectedSkills = CANONICAL_SKILLS.map((s) => `./.agent/skills/${s}`);
      const skillsOk = Array.isArray(plg.skills) && JSON.stringify(plg.skills) === JSON.stringify(expectedSkills);
      if ((pkgVer && plg.version !== pkgVer) || !skillsOk) {
        findings.push({ skill: '*', rule: 'PLG1', message: '.claude-plugin/plugin.json version or skills array out of sync.' });
      }
    } catch {
      findings.push({ skill: '*', rule: 'PLG1', message: 'Malformed .claude-plugin/plugin.json.' });
    }
  }

  return { passed: findings.length === 0, skillsCount: CANONICAL_SKILLS.length, findings };
}

// The generated workflow only installs with npm. A pnpm/yarn cache would need extra tooling, and yarn-berry's
// `yarnPath` would execute repository JavaScript inside setup-node, before the receipt is verified.
const NODE_CACHE_LOCKFILES = Object.freeze({ npm: ['package-lock.json', 'npm-shrinkwrap.json'], yarn: ['yarn.lock'], pnpm: ['pnpm-lock.yaml'] });

function detectNodeCache(repoRoot = null) {
  if (!repoRoot) return null;
  return NODE_CACHE_LOCKFILES.npm.some((f) => fileExists(path.resolve(repoRoot, f))) ? 'npm' : null;
}

export function buildQualityGateWorkflow({
  runsOn = DEFAULT_CI_RUNS_ON,
  checkName = DEFAULT_QUALITY_GATE_CHECK,
  repoRoot = null
} = {}) {
  const runsOnYaml = Array.isArray(runsOn) ? JSON.stringify(runsOn) : runsOn;
  const safeCheckName = String(checkName || DEFAULT_QUALITY_GATE_CHECK).replace(/[\r\n]+/g, ' ');
  const nodeCache = detectNodeCache(repoRoot);
  const ownerRepo = Boolean(repoRoot && isEngineOwnerRepo({ repoRoot }));
  // No npm lockfile: also disable setup-node's packageManager-driven auto caching (package.json is PR-controlled).
  const cacheLine = nodeCache ? `\n          cache: '${nodeCache}'` : '\n          package-manager-cache: false';
  const ownerGuardStep = ownerRepo
    ? `      - name: Require Self-Hosted Runner Policy
        if: (github.repository == 'fmatar/sealit' || github.repository == 'fmatar/agentic-sdlc-framework') && runner.environment == 'github-hosted'
        run: |
          echo "::error::This repository must run exclusively on self-hosted runners (configure vars.SEALIT_RUNS_ON)."
          exit 1

`
    : '';
  const gateStep = ownerRepo
    ? `      - name: Verify Universal Quality Gate & Hash-Chain Audit Ledger
        env:
          SEALIT_RECEIPT_KEY: ci-dummy-test-key
          SDLC_RECEIPT_KEY: ci-dummy-test-key
        run: |
          if [ -f ".agent/scripts/sealit-engine.mjs" ]; then
            node .agent/scripts/sealit-engine.mjs config check
            node .agent/scripts/sealit-engine.mjs verify --chain-only
            node .agent/scripts/sealit-engine.mjs skill-audit
            node .agent/scripts/sealit-engine.mjs gate --no-cache
          else
            npm test
          fi`
    : `      - name: Verify Universal Quality Gate & Hash-Chain Audit Ledger
        env:
          SEALIT_RECEIPT_KEY: ci-dummy-test-key
          SDLC_RECEIPT_KEY: ci-dummy-test-key
          BASE_REF: \${{ github.base_ref }}
        run: |
          GATE_BIN=""
          if [ "\${GITHUB_EVENT_NAME}" = "pull_request" ] && [ -n "$BASE_REF" ]; then
            for eng in sealit-engine.mjs sdlc-engine.mjs; do
              if git cat-file -e "origin/$BASE_REF:.agent/scripts/$eng" 2>/dev/null; then
                TRUSTED_GATE_DIR="$(mktemp -d)"
                trap 'rm -rf "$TRUSTED_GATE_DIR"' EXIT
                git archive "origin/$BASE_REF" .agent/scripts | tar -x -C "$TRUSTED_GATE_DIR"
                GATE_BIN="$TRUSTED_GATE_DIR/.agent/scripts/$eng"
                break
              fi
            done
          fi
          if [ -z "$GATE_BIN" ] && [ -f ".agent/scripts/sealit-engine.mjs" ]; then
            GATE_BIN=".agent/scripts/sealit-engine.mjs"
          fi
          if [ -n "$GATE_BIN" ]; then
            node "$GATE_BIN" config check
            node "$GATE_BIN" verify --chain-only
            node "$GATE_BIN" skill-audit
            node "$GATE_BIN" gate --no-cache
          else
            npm test
          fi`;
  return `name: Sealit Quality Gate

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

permissions:
  contents: read

concurrency:
  group: sealit-gate-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  quality-gate:
    name: ${JSON.stringify(safeCheckName)}
    runs-on: ${runsOnYaml}

    steps:
${ownerGuardStep}      - name: Block Unverified Fork Pull Requests
        if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository
        env:
          PR_HEAD_REPO: \${{ github.event.pull_request.head.repo.full_name }}
        run: |
          echo "::error::Fork pull request ($PR_HEAD_REPO) requires maintainer branch verification and a signed Stage 7 gate receipt."
          exit 1

      - name: Checkout Code
        uses: actions/checkout@v7
        with:
          fetch-depth: 0
          persist-credentials: false

      - name: Enforce Branch Flow Policy
        if: github.event_name == 'pull_request' && github.base_ref == 'main'
        env:
          HEAD_REF: \${{ github.head_ref }}
          PR_HEAD_REPO: \${{ github.event.pull_request.head.repo.full_name }}
          BASE_REPO: \${{ github.repository }}
        run: |
          if [ "$PR_HEAD_REPO" != "$BASE_REPO" ] || [ "$HEAD_REF" != "develop" ]; then
            echo "::error::Pull requests targeting 'main' must originate exclusively from same-repo 'develop' (got '$PR_HEAD_REPO:$HEAD_REF')."
            exit 1
          fi

      - name: Setup Node.js Runtime
        uses: actions/setup-node@v7
        with:
          node-version: "lts/*"${cacheLine}

      - name: Verify Signed Stage 7 Gate Receipt
        if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository
        env:
          SEALIT_RECEIPT_KEY: \${{ secrets.SEALIT_RECEIPT_KEY || secrets.SDLC_RECEIPT_KEY }}
          SDLC_RECEIPT_KEY: \${{ secrets.SEALIT_RECEIPT_KEY || secrets.SDLC_RECEIPT_KEY }}
          PR_HEAD_SHA: \${{ github.event.pull_request.head.sha }}
          BASE_REF: \${{ github.base_ref }}
          GITHUB_HEAD_REF: \${{ github.head_ref }}
        run: |
          if [ -z "$SEALIT_RECEIPT_KEY" ] && ! git cat-file -e "origin/$BASE_REF:.agent/allowed_signers" 2>/dev/null; then
            echo "::error::Missing SEALIT_RECEIPT_KEY secret (and no .agent/allowed_signers on base branch)."
            exit 1
          fi
          TRUSTED_DIR="\${RUNNER_TEMP:-/tmp}/sealit-trusted-verifier"
          rm -rf "$TRUSTED_DIR" && mkdir -p "$TRUSTED_DIR"
          if git cat-file -e "origin/$BASE_REF:.agent/scripts/sealit-engine.mjs" 2>/dev/null; then
            git archive "origin/$BASE_REF" .agent/scripts | tar -x -C "$TRUSTED_DIR"
            ENGINE_BIN="$TRUSTED_DIR/.agent/scripts/sealit-engine.mjs"
          elif git cat-file -e "origin/$BASE_REF:.agent/scripts/sdlc-engine.mjs" 2>/dev/null; then
            git archive "origin/$BASE_REF" .agent/scripts | tar -x -C "$TRUSTED_DIR"
            ENGINE_BIN="$TRUSTED_DIR/.agent/scripts/sdlc-engine.mjs"
          elif [ -f ".agent/scripts/sealit-engine.mjs" ]; then
            ENGINE_BIN=".agent/scripts/sealit-engine.mjs"
          else
            echo "::error::Missing .agent/scripts/sealit-engine.mjs; refusing unverified pull request."
            exit 1
          fi
          if [ "$BASE_REF" = "main" ]; then
            node "$ENGINE_BIN" guard verify --sha "$PR_HEAD_SHA"
          else
            node "$ENGINE_BIN" guard verify --sha "$PR_HEAD_SHA" --branch "$GITHUB_HEAD_REF"
          fi

      - name: Install Dependencies
        run: |
          if [ -f "package-lock.json" ]; then
            npm ci --no-audit --no-fund
          elif [ -f "package.json" ]; then
            npm install --no-audit --no-fund
          fi

${gateStep}
`;
}

function isLegacySealitWorkflow(raw = '', repoRoot = null) {
  if (!raw.includes('sealit-engine.mjs') && !raw.includes('sdlc-engine.mjs')) return false;
  if (!raw.includes('sealit-engine.mjs')) return true;
  const iVerify = raw.indexOf('Verify Signed Stage 7 Gate Receipt');
  const iInstall = raw.indexOf('Install Dependencies');
  const consumerMissingTrustedGate = repoRoot && !isEngineOwnerRepo({ repoRoot }) && !raw.includes('TRUSTED_GATE_DIR=');
  return !raw.includes('--branch "$GITHUB_HEAD_REF"') || raw.includes('gate --strict') || !raw.includes('git archive "origin/$BASE_REF"') ||
    /\bnode "\$ENGINE_BIN" verify --sha\b/.test(raw) || !raw.includes('persist-credentials: false') || !raw.includes('allowed_signers') ||
    raw.includes('Verify Env-Isolated Test Suite') || (iVerify !== -1 && iInstall !== -1 && iInstall < iVerify) || Boolean(consumerMissingTrustedGate);
}

// Only the setup-node step's own `cache:` matters, and only when that manager's lockfile is missing (setup-node fails).
function setupNodeCacheIsBroken(raw = '', repoRoot = null) {
  const lines = raw.split('\n');
  const at = lines.findIndex((l) => l.includes('actions/setup-node@'));
  if (at === -1 || !repoRoot) return false;
  let start = at;
  while (start > 0 && !/^\s*- /.test(lines[start])) start--;
  const stepIndent = (/^(\s*)/.exec(lines[start]) || ['', ''])[1].length;
  let end = start + 1;
  while (end < lines.length && !(/^\s*- /.test(lines[end]) && (/^(\s*)/.exec(lines[end])[1].length <= stepIndent))) end++;
  const declared = (/^\s+cache:\s*['"]?([\w-]+)['"]?\s*$/m.exec(lines.slice(start, end).join('\n')) || [])[1];
  const locks = NODE_CACHE_LOCKFILES[declared];
  return Boolean(locks) && !locks.some((f) => fileExists(path.resolve(repoRoot, f)));
}

function workflowNeedsUpgrade(raw = '', repoRoot = null) {
  if (isLegacySealitWorkflow(raw, repoRoot)) return true;
  return (raw.includes('sealit-engine.mjs') || raw.includes('sdlc-engine.mjs')) && setupNodeCacheIsBroken(raw, repoRoot);
}

export function installCIWorkflow({ repoRoot = '.', force = false, upgradeLegacy = false } = {}) {
  const wfPath = path.resolve(repoRoot, '.github/workflows/sealit-quality-gate.yml');
  const legacyWfPath = path.resolve(repoRoot, '.github/workflows/sdlc-quality-gate.yml');
  const exists = fileExists(wfPath);
  const legacyExists = !exists && fileExists(legacyWfPath);
  const activeWf = exists ? wfPath : legacyExists ? legacyWfPath : null;
  if (activeWf && !force && (!upgradeLegacy || !workflowNeedsUpgrade(readFileSafe(activeWf) || '', repoRoot))) {
    return { installed: false, upgraded: false, skipped: true, path: activeWf };
  }
  let config = null;
  try { ({ config } = loadConfig(repoRoot)); } catch { config = null; } // malformed config: fall back to defaults
  const content = buildQualityGateWorkflow({
    runsOn: config?.ci?.runsOn || DEFAULT_CI_RUNS_ON,
    checkName: config?.ci?.checkName || DEFAULT_QUALITY_GATE_CHECK,
    repoRoot
  });
  writeFileAtomic(wfPath, content);
  if (fileExists(legacyWfPath)) { try { fs.unlinkSync(legacyWfPath); } catch {} }
  return { installed: !exists && !legacyExists, upgraded: exists || legacyExists, skipped: false, path: wfPath };
}

export function scaffoldArchlensPolicy(repoRoot = '.', { force = false } = {}) {
  const absRoot = path.resolve(repoRoot);
  const policyPath = path.join(absRoot, '.archlens/policy.json');
  if (fileExists(policyPath) && !force) return { created: false, path: policyPath };
  const hasRings = ['domain', 'application', 'adapters', 'entrypoints'].some((r) => fileExists(path.join(absRoot, 'src', r)));
  const defaultPolicy = {
    title: path.basename(absRoot) || 'project',
    src: hasRings || fileExists(path.join(absRoot, 'src')) ? 'src' : '.',
    hierarchical: true,
    order: hasRings ? ['domain', 'application', 'adapters', 'entrypoints'] : [],
    levels: hasRings ? [['src/domain/**'], ['src/application/**'], ['src/adapters/**'], ['src/entrypoints/**']] : [],
    omit: ['node_modules', '.git', 'coverage', 'reports', 'dist', 'build', 'target', ...(hasRings ? [] : ['.agent'])]
  };
  writeFileAtomic(policyPath, JSON.stringify(defaultPolicy, null, 2) + '\n');
  return { created: true, path: policyPath };
}

export function runDoctor({ repoRoot = '.', fix = false, gitVersionRaw = null } = {}) {
  const absRoot = path.resolve(repoRoot);
  const nodeMajor = Number(process.versions.node.split('.')[0]) || 0;
  const nodeOk = nodeMajor >= 22;
  const rawGitVer = gitVersionRaw !== null ? String(gitVersionRaw) : gitOutput(['--version'], absRoot) || '';
  const gitMatch = rawGitVer.match(/git version (\d+)\.(\d+)(?:\.(\d+))?/i);
  const gitVersion = gitMatch ? `${gitMatch[1]}.${gitMatch[2]}${gitMatch[3] ? `.${gitMatch[3]}` : ''}` : null;
  const gitOk = Boolean(gitMatch && (Number(gitMatch[1]) > 2 || (Number(gitMatch[1]) === 2 && Number(gitMatch[2]) >= 38)));

  const cfgPath = path.join(absRoot, '.agent/sealit-config.json');
  const legacyCfgPath = path.join(absRoot, '.agent/sdlc-config.json');
  let cfgCheck = validateConfigFile(absRoot);
  if (fix) {
    if (!fileExists(cfgPath) && !fileExists(legacyCfgPath)) {
      writeFileAtomic(cfgPath, JSON.stringify(generateConfig(absRoot), null, 2) + '\n');
      cfgCheck = validateConfigFile(absRoot);
    } else if (cfgCheck.valid && (cfgCheck.warnings.length > 0 || (!fileExists(cfgPath) && fileExists(legacyCfgPath)))) {
      const srcCfg = fileExists(cfgPath) ? cfgPath : legacyCfgPath;
      const upgraded = upgradeConfigToV010(JSON.parse(fs.readFileSync(srcCfg, 'utf8')));
      if (upgraded) writeFileAtomic(cfgPath, JSON.stringify(upgraded, null, 2) + '\n');
      if (srcCfg === legacyCfgPath) { try { fs.unlinkSync(legacyCfgPath); } catch {} }
      cfgCheck = validateConfigFile(absRoot);
    }
    for (const d of ['.agent/skills', '.claude/skills', '.cursor/skills', '.codex/skills']) {
      pruneRetiredSkillsInDir(path.join(absRoot, d), absRoot);
    }
    const rb = buildRulesBlock();
    for (const rf of ['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md']) {
      const rp = path.join(absRoot, rf);
      if (fileExists(rp) && /AGENTIC-SDLC-RULES:START/.test(readFileSafe(rp) || '')) upsertMarkedRulesFile(rp, rb, absRoot);
    }
  }
  const legacyCfgOnly = !fileExists(cfgPath) && fileExists(legacyCfgPath);
  cfgCheck = { ...cfgCheck, legacyNeedsMigration: legacyCfgOnly };

  const policyPath = path.join(absRoot, '.archlens/policy.json');
  if (fix && !fileExists(policyPath)) scaffoldArchlensPolicy(absRoot, { force: false });
  const policyOk = fileExists(policyPath);

  if (fix) upsertGitignore(absRoot);
  const gitignore = inspectGitignore(absRoot);

  if (fix && fileExists(path.join(absRoot, '.git'))) installHooks({ repoRoot: absRoot });
  const hooks = inspectHooks(absRoot);

  const wfPath = path.join(absRoot, '.github/workflows/sealit-quality-gate.yml');
  const legacyWfPath = path.join(absRoot, '.github/workflows/sdlc-quality-gate.yml');
  if (fix) installCIWorkflow({ repoRoot: absRoot, force: false, upgradeLegacy: true });
  const activeWfPath = fileExists(wfPath) ? wfPath : fileExists(legacyWfPath) ? legacyWfPath : null;
  const wfExists = Boolean(activeWfPath);
  const wfLegacy = wfExists && (activeWfPath === legacyWfPath || workflowNeedsUpgrade(readFileSafe(activeWfPath) || '', absRoot));

  if (fix && process.platform !== 'win32') {
    const commonRoot = resolveGitCommonRepoRoot(absRoot);
    const keyPath = fileExists(path.join(absRoot, '.agent/.receipt-key')) ? path.join(absRoot, '.agent/.receipt-key') : path.join(commonRoot, '.agent/.receipt-key');
    if (fileExists(keyPath)) { try { fs.chmodSync(keyPath, 0o600); } catch {} }
  }
  const keyInfo = inspectReceiptKeyStatus(absRoot);
  const ciSecretHint = wfExists && keyInfo.source === 'file' && keyInfo.usable
    ? "Provision CI secret with: tr -d '\\r\\n' < .agent/.receipt-key | gh secret set SEALIT_RECEIPT_KEY"
    : null;

  const skills = auditSkills(absRoot);
  const auditChain = verifyAuditChain(absRoot);

  const passed =
    nodeOk && gitOk && cfgCheck.valid && !legacyCfgOnly && policyOk && gitignore.criticalOk &&
    hooks.upToDate && wfExists && !wfLegacy && !keyInfo.committed && !keyInfo.error && skills.passed && auditChain.valid;

  return {
    passed, nodeVersion: process.version, nodeOk, gitVersion, gitOk, config: cfgCheck, policyOk, gitignore, hooks,
    workflow: { exists: wfExists, legacyNeedsUpgrade: wfLegacy, path: '.github/workflows/sealit-quality-gate.yml' },
    receiptKey: { ...keyInfo, ciSecretHint }, skills,
    auditChain: { valid: auditChain.valid, recordsCount: auditChain.recordsCount, gateReceiptsCount: auditChain.gateReceiptsCount, error: auditChain.error || null }
  };
}

function promptLine(rl, question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(String(answer || '').trim())));
}

async function resolveSelectedAgents({ agents, yes, input, output }) {
  if (agents) return normalizeAgentList(agents);
  const inStream = input || process.stdin;
  const outStream = output || process.stdout;
  if (yes || (!input && !inStream.isTTY)) return ['antigravity', 'claude', 'cursor'];
  const rl = readline.createInterface({ input: inStream, output: outStream });
  try {
    const ans = await promptLine(rl, `Select AI agents to configure (${SUPPORTED_AGENTS.join(', ')}, or all) [antigravity,claude,cursor]: `);
    return normalizeAgentList(ans || 'antigravity,claude,cursor');
  } finally {
    rl.close();
  }
}

function pruneRetiredSkillsInDir(skillsParentDir, baseRoot = null, names = RETIRED_SKILLS) {
  if (baseRoot) assertNoSymlinkAncestors(baseRoot, skillsParentDir);
  if (!fileExists(skillsParentDir)) return;
  for (const retired of names) {
    safeRemoveDir(path.join(skillsParentDir, retired), baseRoot);
  }
}

function updateClaudeSettingsJson(settingsPath, warnings, baseRoot = null, { force = false } = {}) {
  if (baseRoot) assertNoSymlinkAncestors(baseRoot, path.dirname(settingsPath));
  if (!fs.lstatSync(settingsPath, { throwIfNoEntry: false })) {
    writeFileAtomic(settingsPath, JSON.stringify({ permissions: { allow: [...CLAUDE_SEALIT_ALLOW_RULES], deny: [...CLAUDE_SEALIT_DENY_RULES] } }, null, 2) + '\n');
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8') || '{}');
  } catch {
    warnings.push(`Unreadable or malformed JSON in '${settingsPath}'; left untouched so user configuration is not lost.`);
    return;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed.permissions !== undefined && (!parsed.permissions || typeof parsed.permissions !== 'object' || Array.isArray(parsed.permissions)))) {
    warnings.push(`Non-object JSON structure in '${settingsPath}'; left untouched so user configuration is not lost.`);
    return;
  }
  const allow = parsed?.permissions?.allow;
  const isLegacySdlcRule = (r) => LEGACY_CLAUDE_WILDCARDS.has(r) || String(r).startsWith('Bash(node .agent/scripts/sdlc-engine.mjs ');
  const matchedLegacy = Array.isArray(allow) ? allow.find(isLegacySdlcRule) : null;
  const missingAllowArray = allow === undefined || allow === null;
  if (!matchedLegacy && !missingAllowArray && !force) return;
  const target = resolveUserFileTarget(settingsPath, baseRoot, warnings, { onOutside: 'skip' });
  if (!target) return;
  const kept = Array.isArray(allow) ? allow.filter((r) => !isLegacySdlcRule(r)) : [];
  const keptDeny = Array.isArray(parsed?.permissions?.deny) ? parsed.permissions.deny : [];
  parsed.permissions = {
    ...(parsed.permissions || {}),
    allow: [...kept, ...CLAUDE_SEALIT_ALLOW_RULES.filter((r) => !kept.includes(r))],
    deny: [...keptDeny, ...CLAUDE_SEALIT_DENY_RULES.filter((r) => !keptDeny.includes(r))]
  };
  writeFileAtomic(target, JSON.stringify(parsed, null, 2) + '\n');
  if (matchedLegacy && LEGACY_CLAUDE_WILDCARDS.has(matchedLegacy)) {
    warnings.push(`Replaced legacy '${matchedLegacy}' in '${settingsPath}' with read/measure-only rules; approvals now prompt.`);
  }
}

export async function installFramework({
  targetDir = '.', sourceRoot = PACKAGE_ROOT, agents = null, globalMode = false,
  homeDir = null, force = false, yes = false, input = null, output = null, fsImpl = fs
} = {}) {
  const absTarget = path.resolve(targetDir);
  const absSource = path.resolve(sourceRoot);
  const selectedAgents = await resolveSelectedAgents({ agents, yes, input, output });
  const warnings = [];
  const errors = [];
  const rulesBlock = buildRulesBlock();

  if (globalMode) {
    const resolvedHome = path.resolve(homeDir || os.homedir());
    const globalRoot = path.join(resolvedHome, '.sealit');
    safeCopyDir(path.join(absSource, '.agent/scripts'), path.join(globalRoot, 'scripts'), { chmodExecutable: true, errors, fsImpl, baseRoot: resolvedHome });
    safeCopyDir(path.join(absSource, '.agent/schemas'), path.join(globalRoot, 'schemas'), { chmodExecutable: false, errors, fsImpl, baseRoot: resolvedHome });
    for (const rel of ['scripts/sdlc-engine.mjs', 'schemas/sdlc-config.schema.json']) safeRemoveDir(path.join(globalRoot, rel), resolvedHome);

    const defaultHome = path.resolve(os.homedir());
    const globalEnginePath =
      process.platform !== 'win32' && resolvedHome === defaultHome
        ? '$HOME/.sealit/scripts/sealit-engine.mjs'
        : path.join(globalRoot, 'scripts', 'sealit-engine.mjs');

    const agentSkillDirs = {
      antigravity: path.join(resolvedHome, '.gemini/config/skills'),
      claude: path.join(resolvedHome, '.claude/skills'),
      cursor: path.join(resolvedHome, '.cursor/skills'),
      codex: path.join(resolvedHome, '.codex/skills'),
      copilot: path.join(resolvedHome, '.copilot/skills')
    };

    const globalNpxManaged = collectNpxManagedSkills(resolvedHome);
    for (const agent of selectedAgents) {
      const dstBase = agentSkillDirs[agent];
      if (!dstBase) continue;
      pruneRetiredSkillsInDir(dstBase, resolvedHome);
      if (agent === 'antigravity') {
        pruneRetiredSkillsInDir(path.join(resolvedHome, '.gemini/antigravity/skills'), resolvedHome, [...CANONICAL_SKILLS, ...RETIRED_SKILLS]);
      }
      const skipped = [];
      for (const skillId of CANONICAL_SKILLS) {
        if (globalNpxManaged.has(skillId)) { skipped.push(skillId); continue; }
        const raw = readFileSafe(path.join(absSource, '.agent/skills', skillId, 'SKILL.md'));
        if (!raw) continue;
        safeWriteFile(path.join(dstBase, skillId, 'SKILL.md'), adaptSkillContent(raw, { globalEnginePath }), undefined, resolvedHome);
        const oaiRaw = readFileSafe(path.join(absSource, '.agent/skills', skillId, 'agents/openai.yaml'));
        if (oaiRaw && agent === 'codex') safeWriteFile(path.join(dstBase, skillId, 'agents/openai.yaml'), oaiRaw, undefined, resolvedHome);
      }
      if (skipped.length > 0) warnings.push(`Skipped installing ${skipped.join(', ')} into '${dstBase}': managed by npx skills (~/.agents/skills/).`);
      if (agent === 'claude') {
        upsertMarkedRulesFile(path.join(resolvedHome, '.claude/CLAUDE.md'), rulesBlock, resolvedHome, warnings);
        updateClaudeSettingsJson(path.join(resolvedHome, '.claude/settings.json'), warnings, resolvedHome, { force });
      }
    }

    return { success: errors.length === 0, globalMode: true, homeDir: resolvedHome, agents: selectedAgents, warnings, errors };
  }

  // Local repository installation
  if (absSource !== absTarget) {
    safeCopyDir(path.join(absSource, '.agent/scripts'), path.join(absTarget, '.agent/scripts'), { chmodExecutable: true, errors, fsImpl, baseRoot: absTarget });
    safeCopyDir(path.join(absSource, '.agent/schemas'), path.join(absTarget, '.agent/schemas'), { chmodExecutable: false, errors, fsImpl, baseRoot: absTarget });
    safeCopyDir(path.join(absSource, 'docs/templates'), path.join(absTarget, 'docs/templates'), { chmodExecutable: false, errors, fsImpl, baseRoot: absTarget });
    for (const rel of ['.agent/scripts/sdlc-engine.mjs', '.agent/schemas/sdlc-config.schema.json']) safeRemoveDir(path.join(absTarget, rel), absTarget);
  }

  pruneRetiredSkillsInDir(path.join(absTarget, '.agent/skills'), absTarget);
  for (const skillId of CANONICAL_SKILLS) {
    const srcSkillPath = path.join(absSource, '.agent/skills', skillId, 'SKILL.md');
    const dstSkillPath = path.join(absTarget, '.agent/skills', skillId, 'SKILL.md');
    if (fileExists(srcSkillPath) && srcSkillPath !== dstSkillPath) {
      safeWriteFile(dstSkillPath, fs.readFileSync(srcSkillPath, 'utf8'), undefined, absTarget);
    }
    const srcOaiPath = path.join(absSource, '.agent/skills', skillId, 'agents/openai.yaml');
    const dstOaiPath = path.join(absTarget, '.agent/skills', skillId, 'agents/openai.yaml');
    if (fileExists(srcOaiPath) && srcOaiPath !== dstOaiPath) {
      safeWriteFile(dstOaiPath, fs.readFileSync(srcOaiPath, 'utf8'), undefined, absTarget);
    }
  }

  // Never silently replace an existing config: invalid ones are left untouched unless --force (which backs up first).
  const cfgPath = path.join(absTarget, '.agent/sealit-config.json');
  const legacyCfgPath = path.join(absTarget, '.agent/sdlc-config.json');
  assertNoSymlinkAncestors(absTarget, path.dirname(cfgPath));
  const cfgExists = fileExists(cfgPath) || fileExists(legacyCfgPath);
  const activeCfgPath = fileExists(cfgPath) ? cfgPath : legacyCfgPath;
  const cfgCheck = cfgExists && !force ? validateConfigFile(absTarget) : null;
  if (cfgExists && force) {
    if (fs.lstatSync(activeCfgPath).isSymbolicLink()) {
      warnings.push('Not writing a backup of the symlinked .agent/sealit-config.json (its target is never copied into the repo); the symlink is replaced by a regular file.');
    } else {
      writeFileAtomic(`${cfgPath}.bak`, fs.readFileSync(activeCfgPath));
    }
    if (activeCfgPath === legacyCfgPath) { try { fs.unlinkSync(legacyCfgPath); } catch {} }
  }
  if (!cfgExists || force) {
    writeFileAtomic(cfgPath, JSON.stringify(generateConfig(absTarget), null, 2) + '\n');
  } else if (!cfgCheck.valid) {
    warnings.push(`Invalid .agent/sealit-config.json left untouched: ${cfgCheck.errors.join('; ')}; fix it or rerun with --force to regenerate (a .bak copy is kept).`);
  } else if (!fileExists(cfgPath) && fileExists(legacyCfgPath) && !fs.lstatSync(legacyCfgPath).isSymbolicLink()) {
    const upgraded = upgradeConfigToV010(JSON.parse(fs.readFileSync(legacyCfgPath, 'utf8')));
    if (upgraded) writeFileAtomic(cfgPath, JSON.stringify(upgraded, null, 2) + '\n');
    try { fs.unlinkSync(legacyCfgPath); } catch {}
  }
  upsertGitignore(absTarget, { warnings });

  assertNoSymlinkAncestors(absTarget, path.join(absTarget, '.archlens'));
  scaffoldArchlensPolicy(absTarget, { force: false });
  const hasGit = fileExists(path.join(absTarget, '.git'));
  if (hasGit) installHooks({ repoRoot: absTarget, fsImpl });
  const chain = verifyAuditChain(absTarget);
  const receiptKeyCreated = hasGit && !cfgExists && chain.valid && chain.gateReceiptsCount === 0 && inspectReceiptKeyStatus(absTarget).source === 'none';
  if (receiptKeyCreated) loadReceiptKey(absTarget, { create: true });
  assertNoSymlinkAncestors(absTarget, path.join(absTarget, '.github/workflows'));
  installCIWorkflow({ repoRoot: absTarget, force, upgradeLegacy: true });

  upsertMarkedRulesFile(path.join(absTarget, 'AGENTS.md'), rulesBlock, absTarget, warnings);

  const npxManaged = collectNpxManagedSkills(absTarget);
  if (npxManaged.size > 0) {
    warnings.push(`Detected sealit skill(s) in both '.agent/skills' and '.agents/skills' (${[...npxManaged].join(', ')}); harnesses scanning both directories may list them twice.`);
  }
  const localSkillTargets = { claude: '.claude/skills', copilot: '.claude/skills', cursor: '.cursor/skills', codex: '.codex/skills' };
  for (const relDir of new Set(selectedAgents.map((a) => localSkillTargets[a]).filter(Boolean))) {
    const absSkillBase = path.join(absTarget, relDir);
    pruneRetiredSkillsInDir(absSkillBase, absTarget);
    const skipped = [];
    for (const skillId of CANONICAL_SKILLS) {
      if (npxManaged.has(skillId)) { skipped.push(skillId); continue; }
      const raw = readFileSafe(path.join(absTarget, '.agent/skills', skillId, 'SKILL.md'));
      if (raw) safeWriteFile(path.join(absSkillBase, skillId, 'SKILL.md'), adaptSkillContent(raw), undefined, absTarget);
      if (relDir === '.codex/skills') {
        const oaiRaw = readFileSafe(path.join(absTarget, '.agent/skills', skillId, 'agents/openai.yaml'));
        if (oaiRaw) safeWriteFile(path.join(absSkillBase, skillId, 'agents/openai.yaml'), oaiRaw, undefined, absTarget);
      }
    }
    if (skipped.length > 0) warnings.push(`Skipped installing ${skipped.join(', ')} into '${relDir}': managed by npx skills (.agents/skills/).`);
  }

  for (const agent of selectedAgents) {
    if (agent === 'claude') {
      upsertMarkedRulesFile(path.join(absTarget, 'CLAUDE.md'), rulesBlock, absTarget, warnings);
      updateClaudeSettingsJson(path.join(absTarget, '.claude/settings.json'), warnings, absTarget, { force });
    } else if (agent === 'cursor') {
      const rulesDir = path.join(absTarget, '.cursor/rules');
      assertNoSymlinkAncestors(absTarget, rulesDir);
      if (fileExists(rulesDir)) {
        for (const name of fs.readdirSync(rulesDir)) {
          if (/^(?:sealit|sdlc|agentic-sdlc).*\.mdc$/i.test(name)) safeRemoveDir(path.join(rulesDir, name), absTarget);
        }
      }
      safeWriteFile(
        path.join(absTarget, '.cursor/rules/sealit.mdc'),
        `---\ndescription: "Sealit v0.0.2 Governance Rules"\nalwaysApply: true\n---\n\n${rulesBlock}\n`,
        undefined,
        absTarget
      );
    } else if (agent === 'copilot') {
      upsertMarkedRulesFile(path.join(absTarget, '.github/copilot-instructions.md'), rulesBlock, absTarget, warnings);
    }
  }

  return { success: errors.length === 0, globalMode: false, targetDir: absTarget, agents: selectedAgents, receiptKeyCreated, warnings, errors };
}
