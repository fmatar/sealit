#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileExists, resolveInsideRepo, runConfiguredCommand } from './lib/git.mjs';
import { addExemption, listExemptions, loadConfig, validateConfigFile } from './lib/config.mjs';
import { issueGateReceipt, verifyAuditChain, verifyGateReceipt } from './lib/receipt.mjs';
import { checkArchRings, checkSpecDrift, createADR, decideADR, listADRs } from './lib/drift.mjs';
import {
  buildReviewPlan,
  measureModuleCoverage,
  measureModuleMutation,
  resolveAffectedTests,
  runGate
} from './lib/measure.mjs';
import {
  applyBranchProtection,
  beginSession,
  endSession,
  getSessionStatus,
  installHooks,
  postMergeCleanup,
  recordReviewVerdict,
  verifyCommitGuard,
  verifyMergeGuard,
  verifyPushGuard
} from './lib/guard.mjs';
import { auditSkills, installCIWorkflow, installFramework, runDoctor } from './lib/install.mjs';

const ENGINE_FILE = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(ENGINE_FILE), '../../..');

function readPackageVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')).version || '0.1.0';
  } catch {
    return '0.1.0';
  }
}

export function buildHelpText() {
  return `Agentic SDLC Alignment + Proof Kernel v${readPackageVersion()}

Usage:
  sdlc <command> [flags] [--json] [--verbose]

Onboarding & Health:
  init [--agents antigravity,claude,cursor,codex,copilot] [--global] [--yes] [--force]
  doctor [--fix]                                        Verify Node >=22, config, hooks, key & skills
  config check                                          Validate .agent/sdlc-config.json
  skill-audit                                           Audit canonical skills in .agent/skills/

Branch & Alignment:
  begin [--issue <id>] [--title "<desc>"] [--type <feat|fix|chore>] [--checkout] [--worktree <dir>]
  status                                                Show active session, diff mode & gate readiness
  drift [--base <branch>]                               Verify spec, dependency, contract & ring alignment
  adr <create|list|decide> [flags]                      Manage Architecture Decision Records in docs/adr/

Verification & Cryptographic Receipt:
  test [--affected-only]                                Run configured or diff-affected unit tests
  coverage [--no-cache]                                 Measure diff line coverage against threshold
  mutation [--full] [--no-cache]                        Run diff-scoped or full mutation check
  exemption <add|list> [--mutant <id> --file <p> --reason "<why>"]
  gate [--no-cache] [--online]                          Single verification path -> writes lastGate record
  review <plan|record> [--verdict <approve|request-changes>] [--reviewer <id>] [--pr <n>]
  receipt [--docs-only]                                 Sign HEAD + treeSha + specHash Stage 7 receipt
  verify [--sha <sha>] [--branch <name>] [--chain-only] Verify AUDIT_CHAIN.jsonl & signed merge receipt
  end [--issue <id>]                                    Close active session after merge`;
}

function extractGlobalFlags(rawArgs = []) {
  const rest = [];
  let jsonMode = false;
  let verbose = false;
  let help = false;
  let version = false;

  for (const arg of rawArgs) {
    if (arg === '--json') jsonMode = true;
    else if (arg === '--verbose') verbose = true;
    else if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--version' || arg === '-v') version = true;
    else rest.push(arg);
  }
  return { rest, jsonMode, verbose, help, version };
}

function parseFlags(args, { bools = [], values = [], deprecatedBools = [] } = {}) {
  const boolSet = new Set(bools);
  const depSet = new Set(deprecatedBools);
  const valSet = new Set(values);
  const flags = {};
  const positionals = [];
  const warnings = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-') || arg === '-') {
      positionals.push(arg);
      continue;
    }
    const eqIdx = arg.indexOf('=');
    const key = eqIdx !== -1 ? arg.slice(0, eqIdx) : arg;

    if (boolSet.has(key)) {
      flags[key] = eqIdx !== -1 ? arg.slice(eqIdx + 1) !== 'false' : true;
      continue;
    }
    if (depSet.has(key)) {
      flags[key] = true;
      warnings.push(`Flag '${key}' is deprecated in v0.1.0 and acts as a no-op.`);
      continue;
    }
    if (valSet.has(key)) {
      if (eqIdx !== -1) {
        flags[key] = arg.slice(eqIdx + 1);
      } else if (i + 1 < args.length) {
        flags[key] = args[++i];
      } else {
        return { error: `Flag '${key}' requires a value.`, exitCode: 2 };
      }
      continue;
    }
    return { error: `Unknown flag '${key}'.`, exitCode: 2 };
  }
  return { flags, positionals, warnings, error: null, exitCode: 0 };
}

function failInvalid(result, message, exitCode = 2) {
  result.success = false;
  result.exitCode = exitCode;
  result.error = message;
  return result;
}

export async function runCLI(customArgs = null, customConfigPath = null, repoRoot = '.', { isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY), onProgress = null } = {}) {
  const rawArgs = Array.isArray(customArgs) ? customArgs : process.argv.slice(2);
  const { rest, jsonMode, verbose, help, version } = extractGlobalFlags(rawArgs);
  const progressFn = !jsonMode ? onProgress : null;

  if (version) {
    return { command: 'version', success: true, version: readPackageVersion() };
  }
  if (help) {
    return { command: 'help', success: true, help: buildHelpText() };
  }

  if (rest.length === 0) {
    const cfgExists = fileExists(path.resolve(repoRoot, '.agent/sdlc-config.json'));
    if (!cfgExists && isTTY) {
      const initRes = await installFramework({ targetDir: repoRoot, yes: false });
      return { command: 'init', success: initRes.success, init: initRes, warnings: initRes.warnings };
    }
    return { command: 'help', success: true, help: buildHelpText() };
  }

  const rawCmd = rest[0].toLowerCase();
  const cmdArgs = rest.slice(1);
  const result = { command: rawCmd, success: true, warnings: [] };

  switch (rawCmd) {
    case 'help':
      result.help = buildHelpText();
      return result;

    case 'init':
    case 'install': {
      const p = parseFlags(cmdArgs, {
        bools: ['--global', '--yes', '-y', '--force'],
        values: ['--agents', '--agent', '--target', '--home'],
        deprecatedBools: ['--with-hooks', '--with-ci', '--with-archlens', '--non-interactive']
      });
      if (p.error) return failInvalid(result, p.error, p.exitCode);
      result.warnings.push(...p.warnings);
      const initRes = await installFramework({
        targetDir: p.flags['--target'] || repoRoot,
        agents: p.flags['--agents'] || p.flags['--agent'] || null,
        globalMode: Boolean(p.flags['--global']),
        homeDir: p.flags['--home'] || null,
        force: Boolean(p.flags['--force']),
        yes: Boolean(p.flags['--yes'] || p.flags['-y'] || p.flags['--non-interactive'] || !isTTY)
      });
      result.init = initRes;
      result.warnings.push(...(initRes.warnings || []));
      result.success = initRes.success;
      return result;
    }

    case 'doctor': {
      const p = parseFlags(cmdArgs, { bools: ['--fix'] });
      if (p.error) return failInvalid(result, p.error, p.exitCode);
      const doc = runDoctor({ repoRoot, fix: Boolean(p.flags['--fix']) });
      result.doctor = doc;
      result.success = doc.passed;
      return result;
    }

    case 'config': {
      const sub = (cmdArgs[0] || 'check').toLowerCase();
      if (sub !== 'check') return failInvalid(result, `Unknown config subcommand '${sub}'. Expected 'check'.`);
      const cfg = validateConfigFile(repoRoot, customConfigPath);
      result.config = cfg;
      result.warnings.push(...(cfg.warnings || []));
      result.success = cfg.valid;
      return result;
    }

    case 'skill-audit': {
      const p = parseFlags(cmdArgs, { deprecatedBools: ['--live'] });
      if (p.error) return failInvalid(result, p.error, p.exitCode);
      const audit = auditSkills(repoRoot);
      result.skillAudit = audit;
      result.success = audit.passed;
      return result;
    }

    case 'begin':
    case 'end':
    case 'stage': {
      let action = rawCmd;
      let subArgs = cmdArgs;
      if (rawCmd === 'stage') {
        const sub = (cmdArgs[0] || '').toLowerCase();
        subArgs = cmdArgs.slice(1);
        if (sub === 'begin') action = 'begin';
        else if (sub === 'complete' || sub === 'end') action = 'end';
        else return failInvalid(result, `Unknown stage subcommand '${sub}'. Expected 'begin' or 'complete'.`);
      }
      if (action === 'begin') {
        const p = parseFlags(subArgs, {
          bools: ['--checkout', '--local'],
          values: ['--issue', '--title', '--type', '--branch', '--worktree'],
          deprecatedBools: ['--ui', '--create-issue']
        });
        if (p.error) return failInvalid(result, p.error, p.exitCode);
        result.warnings.push(...p.warnings);
        const begun = beginSession({
          issueId: p.flags['--issue'] || p.positionals[0] || null,
          title: p.flags['--title'] || p.positionals[1] || 'work',
          type: p.flags['--type'] || 'feat',
          branch: p.flags['--branch'] || null,
          checkout: Boolean(p.flags['--checkout']),
          worktree: p.flags['--worktree'] || null,
          repoRoot
        });
        result.command = 'begin';
        result.begin = begun;
        result.success = begun.success;
        if (!begun.success) result.error = begun.error;
        return result;
      }
      const p = parseFlags(subArgs, { values: ['--issue', '--pr'] });
      if (p.error) return failInvalid(result, p.error, p.exitCode);
      const ended = endSession({ issueId: p.flags['--issue'] || p.positionals[0] || null, repoRoot });
      result.command = 'end';
      result.end = ended;
      result.success = ended.success;
      if (!ended.success) result.error = ended.error;
      return result;
    }

    case 'status':
    case 'session': {
      if (rawCmd === 'session' && cmdArgs[0] && cmdArgs[0].toLowerCase() !== 'status') {
        return failInvalid(result, `Unknown session subcommand '${cmdArgs[0]}'. Expected 'status'.`);
      }
      const subArgs = rawCmd === 'session' && cmdArgs[0] ? cmdArgs.slice(1) : cmdArgs;
      const p = parseFlags(subArgs, {});
      if (p.error) return failInvalid(result, p.error, p.exitCode);
      if (p.positionals.length > 0) return failInvalid(result, `Unexpected argument '${p.positionals[0]}'.`);
      result.command = 'status';
      result.status = getSessionStatus(repoRoot);
      return result;
    }

    case 'drift': {
      const subArgs = cmdArgs[0] && cmdArgs[0].toLowerCase() === 'check' ? cmdArgs.slice(1) : cmdArgs;
      const p = parseFlags(subArgs, { values: ['--base', '--ticket'] });
      if (p.error) return failInvalid(result, p.error, p.exitCode);
      const sess = getSessionStatus(repoRoot);
      const drift = checkSpecDrift({
        ticketId: p.flags['--ticket'] || sess.session?.issueId || null,
        baseBranch: p.flags['--base'] || null,
        repoRoot
      });
      const { config } = loadConfig(repoRoot, customConfigPath);
      const arch =
        config.archlens?.enabled !== false
          ? checkArchRings({ repoRoot, policyPath: config.archlens?.policyPath || '.archlens/policy.json' })
          : { passed: true, violations: [] };
      result.drift = drift;
      result.arch = arch;
      result.success = drift.passed && arch.passed;
      return result;
    }

    case 'adr': {
      const sub = (cmdArgs[0] || 'list').toLowerCase();
      const subArgs = cmdArgs.slice(1);
      if (sub === 'list') {
        result.adrs = listADRs(repoRoot);
        return result;
      }
      if (sub === 'create') {
        const p = parseFlags(subArgs, {
          values: ['--title', '--scope', '--ticket', '--supersedes', '--context', '--decision', '--consequences']
        });
        if (p.error) return failInvalid(result, p.error, p.exitCode);
        try {
          result.adr = createADR({
            title: p.flags['--title'],
            scope: p.flags['--scope'] || 'technical',
            ticket: p.flags['--ticket'] || null,
            supersedes: p.flags['--supersedes'] || [],
            context: p.flags['--context'],
            decision: p.flags['--decision'],
            consequences: p.flags['--consequences'],
            repoRoot
          });
        } catch (err) {
          return failInvalid(result, err.message, 1);
        }
        return result;
      }
      if (sub === 'decide') {
        const p = parseFlags(subArgs, { values: ['--id', '--status', '--by', '--reviewer', '--reason'] });
        if (p.error) return failInvalid(result, p.error, p.exitCode);
        const decided = decideADR({
          adrId: p.flags['--id'] || p.positionals[0],
          status: p.flags['--status'] || p.positionals[1],
          reviewer: p.flags['--reviewer'] || p.flags['--by'] || '@reviewer',
          reason: p.flags['--reason'] || '',
          repoRoot
        });
        result.adr = decided.adr || null;
        result.success = decided.success;
        if (!decided.success) result.error = decided.error;
        return result;
      }
      return failInvalid(result, `Unknown adr subcommand '${sub}'. Expected 'create', 'list', or 'decide'.`);
    }

    case 'test': {
      const p = parseFlags(cmdArgs, { bools: ['--affected-only'] });
      if (p.error) return failInvalid(result, p.error, p.exitCode);
      const { config } = loadConfig(repoRoot, customConfigPath);
      const usesNodeTest = config.modules.length === 1 && /\bnode\b.*--test\b/.test(String(config.modules[0]?.commands?.test || ''));
      if (p.flags['--affected-only'] && usesNodeTest) {
        const affected = resolveAffectedTests(repoRoot);
        if (affected.length > 0) {
          const safeTestPaths = affected.map((f) => (f.startsWith('./') ? f : `./${f}`));
          runConfiguredCommand([process.execPath, '--test', '--test-reporter=dot', ...safeTestPaths], {
            cwd: path.resolve(repoRoot),
            stdio: verbose && !jsonMode ? 'inherit' : 'pipe'
          });
          result.tests = { mode: 'affected', files: affected, passed: true };
          return result;
        }
      }
      for (const mod of config.modules) {
        if (!mod.commands?.test) continue;
        const modCwd = mod.path && mod.path !== '.' ? resolveInsideRepo(repoRoot, mod.path) : path.resolve(repoRoot);
        runConfiguredCommand(mod.commands.test, { cwd: modCwd, stdio: verbose && !jsonMode ? 'inherit' : 'pipe' });
      }
      result.tests = { mode: 'full', passed: true };
      return result;
    }

    case 'coverage': {
      const p = parseFlags(cmdArgs, { bools: ['--no-cache'] });
      if (p.error) return failInvalid(result, p.error, p.exitCode);
      const { config } = loadConfig(repoRoot, customConfigPath);
      const reports = config.modules.map((mod) => ({
        module: mod.name,
        ...measureModuleCoverage(repoRoot, mod, { verbose: verbose && !jsonMode })
      }));
      result.coverage = reports;
      result.success = reports.every((r) => r.passed);
      return result;
    }

    case 'mutation': {
      const p = parseFlags(cmdArgs, { bools: ['--full', '--no-cache'] });
      if (p.error) return failInvalid(result, p.error, p.exitCode);
      const { config } = loadConfig(repoRoot, customConfigPath);
      const reports = config.modules.map((mod) => ({
        module: mod.name,
        ...measureModuleMutation(repoRoot, mod, {
          full: Boolean(p.flags['--full']),
          noCache: Boolean(p.flags['--no-cache']),
          verbose: verbose && !jsonMode,
          onProgress: progressFn
        })
      }));
      result.mutation = reports;
      result.success = reports.every((r) => r.passed);
      return result;
    }

    case 'exemption': {
      const sub = (cmdArgs[0] || 'list').toLowerCase();
      const subArgs = cmdArgs.slice(1);
      if (sub === 'list') {
        result.exemptions = listExemptions(repoRoot);
        return result;
      }
      if (sub === 'add') {
        const p = parseFlags(subArgs, { values: ['--mutant', '--id', '--file', '--reason'] });
        if (p.error) return failInvalid(result, p.error, p.exitCode);
        const added = addExemption({
          id: p.flags['--mutant'] || p.flags['--id'],
          file: p.flags['--file'],
          reason: p.flags['--reason'],
          repoRoot
        });
        result.exemption = added.exemption;
        return result;
      }
      return failInvalid(result, `Unknown exemption subcommand '${sub}'. Expected 'list' or 'add'.`);
    }

    case 'gate': {
      const p = parseFlags(cmdArgs, {
        bools: ['--no-cache', '--online'],
        deprecatedBools: ['--strict', '--allow-offline']
      });
      if (p.error) return failInvalid(result, p.error, p.exitCode);
      result.warnings.push(...p.warnings);
      const gate = runGate(repoRoot, {
        noCache: Boolean(p.flags['--no-cache']),
        online: Boolean(p.flags['--online']),
        verbose: verbose && !jsonMode,
        onProgress: progressFn
      });
      result.gate = gate;
      result.success = gate.passed;
      return result;
    }

    case 'review': {
      const sub = (cmdArgs[0] || 'plan').toLowerCase();
      const subArgs = cmdArgs.slice(1);
      if (sub === 'plan') {
        const p = parseFlags(subArgs, { values: ['--base'] });
        if (p.error) return failInvalid(result, p.error, p.exitCode);
        result.reviewPlan = buildReviewPlan(repoRoot, { baseBranch: p.flags['--base'] || null });
        return result;
      }
      if (sub === 'record') {
        const p = parseFlags(subArgs, {
          values: ['--verdict', '--reviewer', '--pr', '--notes', '--peer-review', '--arch-review']
        });
        if (p.error) return failInvalid(result, p.error, p.exitCode);
        const rec = recordReviewVerdict({
          verdict: p.flags['--verdict'],
          reviewer: p.flags['--reviewer'] || '@sdlc-gate',
          prNumber: p.flags['--pr'] || null,
          notes: p.flags['--notes'] || '',
          peerReview: p.flags['--peer-review'] || '',
          archReview: p.flags['--arch-review'] || '',
          repoRoot
        });
        result.review = rec;
        result.success = rec.success;
        if (!rec.success) result.error = rec.reason;
        return result;
      }
      return failInvalid(result, `Unknown review subcommand '${sub}'. Expected 'plan' or 'record'.`);
    }

    case 'receipt': {
      const p = parseFlags(cmdArgs, { bools: ['--docs-only'] });
      if (p.error) return failInvalid(result, p.error, p.exitCode);
      const issued = issueGateReceipt({ repoRoot, docsOnly: Boolean(p.flags['--docs-only']) });
      result.receipt = issued;
      result.success = issued.success;
      if (!issued.success) result.error = issued.reason;
      return result;
    }

    case 'verify':
    case 'audit': {
      if (rawCmd === 'audit' && cmdArgs[0] && cmdArgs[0].toLowerCase() !== 'verify') {
        return failInvalid(result, `Unknown audit subcommand '${cmdArgs[0]}'. Expected 'verify'.`);
      }
      const subArgs = rawCmd === 'audit' && cmdArgs[0]?.toLowerCase() === 'verify' ? cmdArgs.slice(1) : cmdArgs;
      const p = parseFlags(subArgs, { bools: ['--chain-only'], values: ['--sha', '--branch'] });
      if (p.error) return failInvalid(result, p.error, p.exitCode);
      result.command = 'verify';
      if (rawCmd === 'audit' || p.flags['--chain-only']) {
        const chain = verifyAuditChain(repoRoot);
        result.verify = chain;
        result.success = chain.valid;
        if (!chain.valid) result.error = chain.error;
        return result;
      }
      const ver = verifyGateReceipt({
        headSha: p.flags['--sha'] || p.positionals[0] || null,
        branch: p.flags['--branch'] || null,
        repoRoot
      });
      result.verify = ver;
      result.success = ver.valid;
      if (!ver.valid) result.error = ver.reason;
      return result;
    }

    case 'guard': {
      const sub = (cmdArgs[0] || 'verify').toLowerCase();
      const subArgs = cmdArgs.slice(1);
      if (sub === 'pre-commit') {
        const g = verifyCommitGuard({ repoRoot });
        result.guard = g;
        result.success = g.allowed;
        if (!g.allowed) result.error = g.message;
        return result;
      }
      if (sub === 'pre-merge' || sub === 'pre-merge-commit') {
        const p = parseFlags(subArgs, { values: ['--sha', '--branch', '--target'] });
        if (p.error) return failInvalid(result, p.error, p.exitCode);
        const g = verifyMergeGuard({
          targetBranch: p.flags['--target'] || null,
          sourceBranch: p.flags['--branch'] || null,
          sourceSha: p.flags['--sha'] || null,
          repoRoot
        });
        result.guard = g;
        result.success = g.allowed;
        if (!g.allowed) result.error = g.message;
        return result;
      }
      if (sub === 'pre-push') {
        let stdinText = '';
        if (!process.stdin.isTTY) {
          try { stdinText = fs.readFileSync(0, 'utf8'); } catch {}
        }
        const g = verifyPushGuard({ stdinText, repoRoot });
        result.guard = g;
        result.success = g.allowed;
        if (!g.allowed) result.error = g.message;
        return result;
      }
      if (sub === 'post-merge') {
        result.guard = postMergeCleanup({ repoRoot });
        return result;
      }
      if (sub === 'receipt') {
        return runCLI(['receipt', ...subArgs, ...(jsonMode ? ['--json'] : [])], customConfigPath, repoRoot);
      }
      if (sub === 'verify') {
        return runCLI(['verify', ...subArgs, ...(jsonMode ? ['--json'] : [])], customConfigPath, repoRoot);
      }
      return failInvalid(result, `Unknown guard subcommand '${sub}'.`);
    }

    case 'hooks': {
      const sub = (cmdArgs[0] || 'install').toLowerCase();
      if (sub !== 'install') return failInvalid(result, `Unknown hooks subcommand '${sub}'. Expected 'install'.`);
      result.hooks = installHooks({ repoRoot });
      return result;
    }

    case 'protect': {
      const p = parseFlags(cmdArgs, { bools: ['--no-admins'], values: ['--approvals'] });
      if (p.error) return failInvalid(result, p.error, p.exitCode);
      const branches = p.positionals.length > 0 ? p.positionals : ['main', 'develop'];
      const prot = applyBranchProtection({
        branches,
        enforceAdmins: !p.flags['--no-admins'],
        requiredApprovals: Number(p.flags['--approvals'] || 0),
        repoRoot
      });
      result.protect = prot;
      result.success = prot.success;
      return result;
    }

    case 'ci-workflow': {
      const p = parseFlags(cmdArgs.filter((a) => a !== 'install'), { bools: ['--force'] });
      if (p.error) return failInvalid(result, p.error, p.exitCode);
      result.ciWorkflow = installCIWorkflow({ repoRoot, force: Boolean(p.flags['--force']), upgradeLegacy: true });
      return result;
    }

    default:
      return failInvalid(result, `Unknown command '${rawCmd}'. Run 'sdlc --help' for usage.`, 2);
  }
}

export function cliExitCode(res) {
  if (!res) return 1;
  if (typeof res.exitCode === 'number') return res.exitCode;
  return res.success === false ? 1 : 0;
}

export function formatCLIResult(cmd, res = {}) {
  if (res.help) return res.help;
  if (res.version) return res.version;
  if (res.error) return `Error: ${res.error}`;

  switch (res.command || cmd) {
    case 'init':
    case 'install':
      return `Initialized @fmatar/agentic-sdlc (${(res.init?.agents || []).join(', ')})`;
    case 'doctor': {
      const d = res.doctor;
      return [
        `SDLC Doctor: ${d.passed ? 'HEALTHY' : 'ISSUES FOUND'}`,
        `  Node Runtime  : ${d.nodeVersion} (${d.nodeOk ? 'OK' : 'Requires >=22.0.0'})`,
        `  Config        : ${d.config.valid ? 'Valid' : `Invalid (${d.config.errors.join('; ')})`}`,
        `  Archlens Rings: ${d.policyOk ? 'Present' : 'Missing'}`,
        `  4-Layer Hooks : ${d.hooks.upToDate ? 'Up to date' : `Missing/Outdated [${[...d.hooks.missingHooks, ...d.hooks.outdatedHooks].join(', ')}]`}`,
        `  CI Workflow   : ${d.workflow.exists ? (d.workflow.legacyNeedsUpgrade ? 'Needs v0.1.0 upgrade (--fix)' : 'Up to date') : 'Missing'}`,
        `  Receipt Key   : ${d.receiptKey.source} (${d.receiptKey.usable ? `usable${d.receiptKey.mode !== null ? `, mode 0${d.receiptKey.mode.toString(8)}, untracked` : ''}` : d.receiptKey.error || 'not provisioned'})`,
        ...(d.receiptKey.ciSecretHint ? [`                  ${d.receiptKey.ciSecretHint}`] : []),
        `  Skills Audit  : ${d.skills.passed ? `Passed (${d.skills.skillsCount}/6)` : `${d.skills.findings.length} finding(s)`}`,
        `  Audit Ledger  : ${d.auditChain.valid ? `Verified (${d.auditChain.recordsCount} records, ${d.auditChain.gateReceiptsCount} receipts)` : d.auditChain.error}`
      ].join('\n');
    }
    case 'begin':
      return `Session started: #${res.begin?.session?.issueId} on branch '${res.begin?.branch}'`;
    case 'end':
      return `Session #${res.end?.issueId} closed.`;
    case 'status': {
      const s = res.status;
      return `Branch: ${s.branch || 'detached'} | Session: ${s.active ? `#${s.session.issueId}` : 'none'} | Mode: ${s.mode} | Drift: ${s.drift.passed ? 'clean' : 'drift'} | Receipt ready: ${s.readyForReceipt ? 'yes' : 'no'}`;
    }
    case 'drift':
      return [res.drift?.message, res.arch?.message].filter(Boolean).join(' | ') || 'Aligned.';
    case 'adr':
      if (Array.isArray(res.adrs)) return `ADRs (${res.adrs.length}): ${res.adrs.map((a) => `${a.id} [${a.status}]`).join(', ') || 'none'}`;
      return `ADR ${res.adr?.id}: ${res.adr?.status} (${res.adr?.file || ''})`;
    case 'gate': {
      const g = res.gate || {};
      const header = `Gate ${g.passed ? 'PASSED' : 'FAILED'} [mode=${g.mode || 'unknown'}, head=${g.headSha?.slice(0, 8) || 'dirty'}]`;
      if (g.passed) return header;
      const details = [];
      if (g.reason) details.push(`  - ${g.reason}`);
      if (g.drift && !g.drift.passed) details.push(`  - drift: ${g.drift.message || 'Spec/ADR drift detected'}`);
      if (g.arch && !g.arch.passed) details.push(`  - arch: ${g.arch.message || `${g.arch.violations?.length || 1} ring violation(s)`}`);
      if (g.secrets && !g.secrets.passed) {
        const parts = [
          ...(g.secrets.secretViolations || []).map((v) => `${v.file} (${v.pattern || v.type || 'secret'})`),
          ...(g.secrets.auditError ? [g.secrets.auditError] : [])
        ];
        details.push(`  - secrets: ${parts.join('; ') || 'secret/audit check failed'}`);
      }
      for (const m of g.modules || []) {
        if (!m.passed) details.push(`  - ${m.module} (${m.failedStep || 'module'}): ${m.error || 'check failed'}`);
      }
      return details.length > 0 ? `${header}\n${details.join('\n')}` : header;
    }
    case 'coverage':
      return (res.coverage || [])
        .map((c) => `${c.module}: ${c.formatted || 'n/a'} (${c.passed ? 'PASS' : c.reason || 'FAIL'})`)
        .join('\n') || (res.success ? 'OK' : 'Failed');
    case 'mutation':
      return (res.mutation || [])
        .map((m) => `${m.module}: ${m.formatted || 'n/a'} (${m.passed ? 'PASS' : m.reason || 'FAIL'})`)
        .join('\n') || (res.success ? 'OK' : 'Failed');
    case 'receipt':
      return `Issued Stage 7 receipt ${res.receipt?.receipt?.receiptId}`;
    case 'verify':
      return res.verify?.receipt
        ? `Verified Stage 7 receipt ${res.verify.receipt.receiptId} for ${res.verify.targetSha?.slice(0, 8)}`
        : res.verify?.message || 'Verified.';
    case 'guard':
      return `Git Guard: ${res.guard?.allowed !== false ? 'ALLOWED' : 'BLOCKED'}`;
    default:
      return res.success ? 'OK' : 'Failed';
  }
}

const isDirectRun =
  process.argv[1] &&
  (() => {
    try {
      return fs.realpathSync(process.argv[1]) === fs.realpathSync(ENGINE_FILE);
    } catch {
      return path.resolve(process.argv[1]) === ENGINE_FILE;
    }
  })();

if (isDirectRun) {
  const jsonMode = process.argv.includes('--json');
  const onProgress = jsonMode ? null : (msg) => process.stderr.write(`${msg}\n`);
  runCLI(null, null, '.', { onProgress })
    .then((res) => {
      const code = cliExitCode(res);
      if (jsonMode) {
        process.stdout.write(JSON.stringify(res, null, 2) + '\n');
      } else {
        for (const w of res.warnings || []) process.stderr.write(`Warning: ${w}\n`);
        const text = formatCLIResult(res.command, res);
        if (code === 0) process.stdout.write(`${text}\n`);
        else process.stderr.write(`${text}\n`);
      }
      process.exit(code);
    })
    .catch((err) => {
      if (jsonMode) {
        process.stdout.write(JSON.stringify({ success: false, error: err.message }, null, 2) + '\n');
      } else {
        process.stderr.write(`Error: ${err.message}\n`);
      }
      process.exit(1);
    });
}
