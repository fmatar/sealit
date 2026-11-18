import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  TRUE_BINARY_EXT_RE, computeContentTreeSha, fileExists, getCurrentGitBranch, gitExecBuffer,
  hasDirtyNonGovernanceFiles, isDocsOnlyDiff, parseCommandArgv, readBlobs, readChangeSet,
  readFileSafe, resolveInsideRepo, resolveRange, runConfiguredCommand, writeFileAtomic
} from './git.mjs';
import {
  formatMutantIdentity, listExemptions, loadEffectivePolicy,
  matchesMutatePatterns, resolveActiveExemptions, validateConfigFile
} from './config.mjs';
import { computeTreeHash, readActiveSession, readGateCache, writeActiveSession, writeGateCache } from './receipt.mjs';
import { checkArchRings, checkSpecDrift, computeAlignmentHashes } from './drift.mjs';

const SECRET_PATTERNS = [
  { name: 'Private Key / PGP Block', regex: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY(?: BLOCK)?-----/ },
  { name: 'AWS Access Key ID', regex: /(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/ },
  { name: 'GitHub Personal Access Token', regex: /(?:gh[pousr]_[A-Za-z0-9_]{36,255}|github_pat_[A-Za-z0-9_]{22,255})/ },
  { name: 'OpenAI / Anthropic Secret Key', regex: /sk-(?:proj|svcacct|ant)-[A-Za-z0-9_-]{20,}/ },
  { name: 'Stripe Live Key', regex: /[sr]k_live_[A-Za-z0-9]{20,}/ },
  { name: 'Slack Token', regex: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'npm Automation Token', regex: /npm_[A-Za-z0-9]{36}/ },
  { name: 'Google Cloud API Key', regex: /AIza[0-9A-Za-z-_]{35}/ },
  { name: 'Credentialed Database URL', regex: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s'"`]+:[^@\s'"`]{6,}@/i },
  { name: 'Hardcoded Secret Assignment', regex: /(?:api_?key|secret_?key|private_?key|access_?token|auth_?token|client_?secret|bearer_?token)\s*[:=]\s*['"`][A-Za-z0-9+/=._-]{20,}['"`]/i, skipInTests: true }
];

function isTestFilePath(relPath = '') {
  const norm = String(relPath || '').replace(/\\/g, '/');
  return /(?:^|\/)(?:tests?|__tests__|spec)\//i.test(norm) || /\.(?:test|spec)\.[A-Za-z0-9]+$/i.test(norm) || /_test\.(?:go|py|rs)$/i.test(norm);
}

function isTrackableSourceFile(relPath = '') {
  const norm = String(relPath || '').replace(/\\/g, '/');
  if (isTestFilePath(norm)) return false;
  return /\.(?:[cm]?js|[cm]?ts|tsx|jsx|py|go|rs|java|kt)$/i.test(norm);
}

function isExecutableSourceLine(lineText = '') {
  const t = String(lineText || '').trim();
  if (!t) return false;
  if (t.startsWith('//') || t.startsWith('#') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('*/')) return false;
  if (/^[{}()[\];,]+$/.test(t)) return false;
  if (/^(?:import|export\s+type|type\s+\w+|interface\s+\w+)\b/.test(t) && !t.includes('=>') && !t.includes('=')) return false;
  return true;
}

export function scanDiffSecrets(repoRoot = '.', { baseBranch = null, changeSet = null, runNpmAudit = false } = {}) {
  const secretViolations = [];
  let diffFiles = [];
  try {
    const cs = changeSet || readChangeSet({ ...resolveRange({ baseBranch, repoRoot }), source: 'worktree', repoRoot });
    diffFiles = cs.paths;
    const binEntries = cs.entries.filter(
      (e) => e.status !== 'D' && !TRUE_BINARY_EXT_RE.test(e.path) && /^Binary files .* differ$/m.test(cs.patches.get(e.path) || '')
    );
    const binBlobs =
      cs.source === 'commit' && cs.headSha && binEntries.length > 0
        ? readBlobs(binEntries.map((e) => `${cs.headSha}:${e.path}`), repoRoot)
        : new Map();

    for (const entry of cs.entries) {
      const file = entry.path;
      try {
        if (entry.status === 'D' || (!/^0+$/.test(entry.oldOid) && entry.oldOid === entry.newOid && entry.oldMode !== entry.newMode)) continue;
        if (entry.newMode === '160000' || TRUE_BINARY_EXT_RE.test(file) || entry.newOid === 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391') continue;
        const diffOutput = cs.patches.get(file) || '';
        if (!diffOutput) { secretViolations.push({ file, type: 'SCAN_ERROR', error: 'Modified file missing from ChangeSet patches.' }); continue; }
        let lines = diffOutput.replace(/\r\n/g, '\n').split('\n');
        if (/^Binary files .* differ$/m.test(diffOutput)) {
          let rawText = null;
          if (cs.source === 'commit' && cs.headSha) rawText = binBlobs.get(`${cs.headSha}:${file}`) ?? null;
          else {
            const abs = resolveInsideRepo(repoRoot, file);
            if (fileExists(abs)) {
              if (fs.statSync(abs).size > 16 * 1024 * 1024) throw new Error(`File '${file}' exceeds 16 MiB for secret scan.`);
              rawText = fs.readFileSync(abs).toString('utf8');
            } else {
              const idx = gitExecBuffer(['show', `:${file}`], repoRoot);
              if (!idx.error && idx.status === 0) rawText = idx.stdout.toString('utf8');
            }
          }
          if (rawText === null) { secretViolations.push({ file, type: 'SCAN_ERROR', error: 'Unexpanded binary text diff.' }); continue; }
          lines = rawText.replace(/\0/g, '').replace(/\r\n/g, '\n').split('\n').map((l) => `+${l}`);
        }
        const isTest = isTestFilePath(file);
        let addedIdx = 0;
        for (const line of lines) {
          if (!line.startsWith('+') || line.startsWith('+++')) continue;
          addedIdx++;
          for (const sp of SECRET_PATTERNS) {
            if (sp.skipInTests && isTest) continue;
            if (sp.regex.test(line)) secretViolations.push({ file, type: 'SECRET_LEAK', pattern: sp.name, addedLineIndex: addedIdx });
          }
        }
      } catch (err) {
        secretViolations.push({ file, type: 'SCAN_ERROR', error: err.message });
      }
    }
  } catch (err) {
    secretViolations.push({ file: '*', type: 'SCAN_ERROR', error: err.message });
  }

  let auditError = null;
  if (runNpmAudit && fileExists(path.resolve(repoRoot, 'package.json')) && fileExists(path.resolve(repoRoot, 'package-lock.json'))) {
    const res = spawnSync('npm', ['audit', '--json', '--audit-level=high'], {
      cwd: path.resolve(repoRoot), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024
    });
    if (res.error) {
      auditError = `npm audit execution failed: ${res.error.message}`;
    } else {
      try {
        const parsed = JSON.parse(res.stdout || '{}');
        if (parsed?.error || (res.status !== 0 && !parsed?.metadata?.vulnerabilities)) {
          auditError = `npm audit failed (exit ${res.status}): ${parsed?.error?.summary || 'missing vulnerability metadata'}`;
        } else {
          const vulns = parsed?.metadata?.vulnerabilities || {};
          const highCount = Number(vulns.high || 0) + Number(vulns.critical || 0);
          if (highCount > 0) auditError = `npm audit reported ${highCount} high/critical vulnerability(s).`;
        }
      } catch (err) {
        auditError = `npm audit returned unparseable JSON: ${err.message}`;
      }
    }
  }

  return { passed: secretViolations.length === 0 && !auditError, filesScanned: diffFiles.length, secretViolations, auditError };
}

export function requireFreshReport(report, mod, repoRoot, startedAt) {
  if (!report || !report.found) {
    return { ...(report || {}), found: false, passed: false, reason: report?.reason || 'Report not found on disk.' };
  }
  let mtimeMs;
  try {
    const absRep = resolveInsideRepo(repoRoot, path.join(mod?.path || '.', report.file));
    mtimeMs = fs.statSync(absRep).mtimeMs;
  } catch (err) {
    return { ...report, passed: false, stale: true, reason: `Unable to stat report '${report.file}': ${err.message}` };
  }
  if (mtimeMs + 2000 < startedAt) {
    return { ...report, passed: false, stale: true, reason: `Report '${report.file}' is stale (not regenerated by this run).` };
  }
  return report;
}

function tryRealpath(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

function normalizeReportPathToRepoRel(rawSf, absRepo, modCwd) {
  const clean = String(rawSf || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!clean) return '';
  let absCandidate = path.isAbsolute(clean) ? path.normalize(clean) : path.resolve(modCwd, clean);
  if (!path.isAbsolute(clean) && modCwd !== absRepo && !fileExists(absCandidate) && fileExists(path.resolve(absRepo, clean))) {
    absCandidate = path.resolve(absRepo, clean);
  }
  if (absCandidate.startsWith(absRepo + path.sep)) {
    return path.relative(absRepo, absCandidate).replace(/\\/g, '/');
  }
  const realRepo = tryRealpath(absRepo);
  const realCand = tryRealpath(absCandidate);
  if (realCand.startsWith(realRepo + path.sep)) {
    return path.relative(realRepo, realCand).replace(/\\/g, '/');
  }
  return clean;
}

function extractAddedLinesByFile(diffMap) {
  const out = new Map();
  for (const [file, diffText] of diffMap.entries()) {
    const lineMap = new Map();
    const lines = String(diffText || '').replace(/\r\n/g, '\n').split('\n');
    let curNewLine = 0;
    let inHunk = false;
    for (const line of lines) {
      const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) {
        curNewLine = Number(hunk[1]);
        inHunk = true;
        continue;
      }
      if (!inHunk) continue;
      if (line.startsWith('+') && !line.startsWith('+++')) {
        lineMap.set(curNewLine, line.slice(1));
        curNewLine++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        // deleted line does not advance new file line counter
      } else if (line.startsWith(' ')) {
        curNewLine++;
      }
    }
    if (lineMap.size > 0) out.set(file, lineMap);
  }
  return out;
}

function parseLcovContent(raw, absRepo, modCwd) {
  const fileLineHits = new Map();
  let curFile = null;
  let totalLF = 0;
  let totalLH = 0;

  for (const line of String(raw || '').replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('SF:')) {
      curFile = normalizeReportPathToRepoRel(line.slice(3), absRepo, modCwd);
      if (!fileLineHits.has(curFile)) fileLineHits.set(curFile, new Map());
    } else if (line.startsWith('DA:') && curFile) {
      const [lnStr, hitsStr] = line.slice(3).split(',');
      const ln = Number(lnStr);
      const hits = Number(hitsStr);
      if (Number.isInteger(ln) && ln > 0 && Number.isFinite(hits)) {
        const m = fileLineHits.get(curFile);
        m.set(ln, (m.get(ln) || 0) + hits);
      }
    } else if (line.startsWith('end_of_record')) {
      curFile = null;
    }
  }

  for (const m of fileLineHits.values()) {
    for (const hits of m.values()) {
      totalLF++;
      if (hits > 0) totalLH++;
    }
  }
  return { fileLineHits, totalLF, totalLH };
}

export function parseCoverageReport(repoRoot = '.', mod = {}, { baseBranch = null, changeSet = null } = {}) {
  const absRepo = path.resolve(repoRoot);
  const modCwd = mod?.path && mod.path !== '.' ? resolveInsideRepo(absRepo, mod.path) : absRepo;
  const modPrefix = path.relative(absRepo, modCwd).replace(/\\/g, '/');
  const threshold = mod?.thresholds?.diffCoverage ?? 85;

  const candidates = [
    mod?.commands?.coverageFile, 'coverage/lcov.info', 'coverage/coverage-summary.json',
    'coverage/coverage.xml', 'coverage/cobertura-coverage.xml', 'target/site/jacoco/jacoco.xml',
    'target/site/jacoco/jacoco.csv', 'build/reports/jacoco/test/jacocoTestReport.xml', 'coverage/cover.out'
  ].filter(Boolean);

  const relFound = candidates.find((rel) => {
    try { return fileExists(resolveInsideRepo(absRepo, path.join(mod.path || '.', rel))); } catch { return false; }
  });
  if (!relFound) {
    return { found: false, passed: false, threshold, reason: `No coverage report found in ${mod.path || '.'}.` };
  }

  const raw = fs.readFileSync(resolveInsideRepo(absRepo, path.join(mod.path || '.', relFound)), 'utf8');
  let repoLineCoverage = 0;
  let fileLineHits = null;

  const cs = changeSet || readChangeSet({ ...resolveRange({ baseBranch, repoRoot: absRepo }), source: 'worktree', repoRoot: absRepo });
  const modFiles = cs.entries
    .filter((e) => e.status !== 'D')
    .map((e) => e.path)
    .filter((f) => (!modPrefix ? true : f === modPrefix || f.startsWith(`${modPrefix}/`)));
  const sourceModFiles = modFiles.filter((f) => isTrackableSourceFile(f));

  if (relFound.endsWith('.info') || raw.includes('end_of_record')) {
    const lcov = parseLcovContent(raw, absRepo, modCwd);
    fileLineHits = lcov.fileLineHits;
    repoLineCoverage = lcov.totalLF > 0 ? Number(((lcov.totalLH / lcov.totalLF) * 100).toFixed(2)) : (sourceModFiles.length === 0 ? 100 : 0);
  } else if (relFound.endsWith('.json')) {
    const parsed = JSON.parse(raw);
    repoLineCoverage = Number(parsed?.total?.lines?.pct ?? 0);
  } else if (relFound.endsWith('.csv')) {
    const rows = raw.replace(/\r\n/g, '\n').trim().split('\n');
    const hdr = (rows[0] || '').split(',');
    const mIdx = hdr.indexOf('LINE_MISSED');
    const cIdx = hdr.indexOf('LINE_COVERED');
    let missed = 0; let covered = 0;
    for (const r of rows.slice(1)) {
      const cols = r.split(',');
      if (mIdx >= 0 && cIdx >= 0) { missed += Number(cols[mIdx] || 0); covered += Number(cols[cIdx] || 0); }
    }
    repoLineCoverage = missed + covered > 0 ? Number(((covered / (missed + covered)) * 100).toFixed(2)) : 0;
  } else if (raw.includes('<coverage') && raw.includes('line-rate=')) {
    const m = raw.match(/<coverage[^>]*\bline-rate="([0-9.]+)"/);
    repoLineCoverage = m ? Number((Number(m[1]) * 100).toFixed(2)) : 0;
  } else if (raw.includes('<report') && raw.includes('type="LINE"')) {
    const counters = [...raw.matchAll(/<counter\s+type="LINE"\s+missed="(\d+)"\s+covered="(\d+)"\s*\/>/g)];
    if (counters.length > 0) {
      const last = counters[counters.length - 1];
      const missed = Number(last[1]);
      const covered = Number(last[2]);
      repoLineCoverage = missed + covered > 0 ? Number(((covered / (missed + covered)) * 100).toFixed(2)) : 100;
    }
  } else if (raw.startsWith('mode:')) {
    let total = 0;
    let covered = 0;
    for (const line of raw.replace(/\r\n/g, '\n').split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const stmts = Number(parts[1]) || 0;
        const count = Number(parts[2]) || 0;
        total += stmts;
        if (count > 0) covered += stmts;
      }
    }
    repoLineCoverage = total > 0 ? Number(((covered / total) * 100).toFixed(2)) : 100;
  }

  let diffLineCoverage = repoLineCoverage;
  if (fileLineHits && sourceModFiles.length > 0) {
      const sourceSet = new Set(sourceModFiles);
      const diffMap = new Map([...cs.patches.entries()].filter(([k]) => sourceSet.has(k)));
      const addedByFile = extractAddedLinesByFile(diffMap);
      let diffTotal = 0;
      let diffHit = 0;

      for (const [file, addedLines] of addedByFile.entries()) {
        const reported = fileLineHits.get(file);
        if (reported && reported.size > 0) {
          for (const [ln] of addedLines.entries()) {
            if (reported.has(ln)) {
              diffTotal++;
              if (reported.get(ln) > 0) diffHit++;
            }
          }
        } else {
          // Unimported file absent from LCOV: every executable added line counts as 0 hits
          for (const [, text] of addedLines.entries()) {
            if (isExecutableSourceLine(text)) diffTotal++;
          }
        }
      }
      if (diffTotal > 0) diffLineCoverage = Number(((diffHit / diffTotal) * 100).toFixed(2));
  }

  const passed = threshold === null ? true : diffLineCoverage >= threshold;
  const reason = passed ? null : `Diff line coverage ${diffLineCoverage.toFixed(1)}% is below threshold ${threshold}%.`;
  return { found: true, passed, file: relFound, threshold, repoLineCoverage, diffLineCoverage, formatted: `${diffLineCoverage.toFixed(1)}%`, reason };
}

export function extractChangedHunkRanges(diffText = '', { maxGapLines = 5, maxRanges = 25 } = {}) {
  const text = String(diffText || '').replace(/\r\n/g, '\n');
  if (!text || /^Binary files .* differ$/m.test(text)) return [];
  const raw = [];
  const hunkRe = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
  let match;
  while ((match = hunkRe.exec(text)) !== null) {
    const start = Math.max(1, Number(match[1]));
    const count = match[2] === undefined ? 1 : Number(match[2]);
    const end = count === 0 ? start : start + count - 1;
    raw.push({ start, end });
  }
  if (raw.length === 0) return [];
  raw.sort((a, b) => a.start - b.start || a.end - b.end);

  const mergeWithGap = (gap) => {
    const merged = [{ ...raw[0] }];
    for (let i = 1; i < raw.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = raw[i];
      if (curr.start <= prev.end + 1 + gap) prev.end = Math.max(prev.end, curr.end);
      else merged.push({ ...curr });
    }
    return merged;
  };

  let merged = mergeWithGap(maxGapLines);
  if (merged.length > maxRanges) {
    merged = [{ start: merged[0].start, end: merged[merged.length - 1].end }];
  }
  return merged;
}

function mapSourceToUnitTest(modRelSource, modCwd) {
  const norm = modRelSource.replace(/\\/g, '/');
  if (norm === '.agent/scripts/sdlc-engine.mjs') {
    const cand = 'tests/unit/cli.test.mjs';
    return fileExists(path.join(modCwd, cand)) ? cand : null;
  }
  const stem = path.basename(norm).replace(/\.[cm]?[jt]sx?$/i, '');
  const cand = `tests/unit/${stem}.test.mjs`;
  return fileExists(path.join(modCwd, cand)) ? cand : null;
}

function mapUnitTestToSource(modRelTest, explicitMutateFiles) {
  const m = modRelTest.replace(/\\/g, '/').match(/^tests\/unit\/(.+?)\.test\.[cm]?[jt]s$/);
  if (!m) return null;
  if (m[1] === 'cli') return explicitMutateFiles.find((f) => f.endsWith('sdlc-engine.mjs')) || null;
  return explicitMutateFiles.find((f) => path.basename(f).replace(/\.[cm]?[jt]sx?$/i, '') === m[1]) || null;
}

export function buildMutationPlan(repoRoot = '.', mod = {}, { full = false, noCache = false, baseBranch = null, changeSet = null, strykerConfig = null } = {}) {
  const baseCmd = mod?.commands?.mutation;
  if (!baseCmd) return { skip: true, reason: 'not-configured', commandArgv: null, targets: [] };
  const parsed = parseCommandArgv(baseCmd);
  const baseTokens = [parsed.file, ...parsed.args];
  if (!baseTokens.some((t) => /stryker/i.test(t))) {
    return { skip: false, diffScoped: false, full: Boolean(full), commandArgv: baseTokens, targets: [] };
  }

  const absRepo = path.resolve(repoRoot);
  const modCwd = mod?.path && mod.path !== '.' ? resolveInsideRepo(absRepo, mod.path) : absRepo;
  const modPrefix = path.relative(absRepo, modCwd).replace(/\\/g, '/');
  const strykerCfgPath = path.join(modCwd, 'stryker.config.json');
  const strykerCfg = strykerConfig || (fileExists(strykerCfgPath) ? JSON.parse(readFileSafe(strykerCfgPath) || '{}') : {});
  const explicitMutate = Array.isArray(strykerCfg.mutate) ? strykerCfg.mutate.map((f) => f.replace(/^\.\//, '')) : [];
  const concreteMutate = explicitMutate.filter((f) => !f.startsWith('!') && !/[?*[\]{}]/.test(f) && matchesMutatePatterns(f, explicitMutate));
  const defaultIncFile = strykerCfg.incrementalFile || 'reports/stryker-incremental.json';
  const extraFlags = noCache ? ['--force'] : [];
  const runIdx = baseTokens.indexOf('run');
  const hasPositionalCfg = runIdx >= 0 && baseTokens.slice(runIdx + 1).some((t) => !t.startsWith('-'));
  const canScopeTap = runIdx >= 0 && !hasPositionalCfg && (fileExists(strykerCfgPath) || Boolean(strykerConfig)) && (!strykerCfg.testRunner || strykerCfg.testRunner === 'tap' || strykerCfg.testRunner === 'sdlc-node') && Array.isArray(strykerCfg?.tap?.testFiles);
  const modSlug = String(mod.name || 'root').replace(/[^a-zA-Z0-9_-]/g, '_');
  const scopedReporters = [...new Set([...(Array.isArray(strykerCfg.reporters) ? strykerCfg.reporters : ['clear-text', 'progress']), 'json'])];
  const jsonRepArgs = !Array.isArray(strykerCfg.reporters) || !strykerCfg.reporters.includes('json') ? ['--reporters', scopedReporters.join(',')] : [];
  const writeScopedCfg = (name, extra) => {
    const absCfg = path.join(absRepo, '.agent/.cache', `${modSlug}-${name}`);
    writeFileAtomic(absCfg, JSON.stringify({ ...strykerCfg, reporters: scopedReporters, ...extra }, null, 2) + '\n');
    return path.relative(modCwd, absCfg).replace(/\\/g, '/');
  };

  const orderTests = (primary) => (strykerCfg.testRunner === 'sdlc-node' ? [primary, ...strykerCfg.tap.testFiles.filter((f) => f !== primary)] : [primary]);
  const makeShards = (sources, targetsBySource = null) => {
    const stems = sources.map((s) => path.basename(s).replace(/\.[cm]?[jt]sx?$/i, ''));
    if (sources.length <= 1 || !canScopeTap || new Set(stems).size !== sources.length) return null;
    const paired = sources.map((s) => mapSourceToUnitTest(s, modCwd));
    if (!paired.every(Boolean) || new Set(paired).size !== paired.length) return null;
    return sources.map((src, idx) => {
      const stem = stems[idx];
      const reportRel = `reports/mutation/shard-${idx}-${stem}.json`;
      const cfgRel = writeScopedCfg(`stryker-shard-${idx}-${stem}.config.json`, {
        thresholds: { ...(strykerCfg.thresholds || {}), break: null },
        jsonReporter: { ...(strykerCfg.jsonReporter || {}), fileName: reportRel },
        tap: { ...strykerCfg.tap, testFiles: orderTests(paired[idx]) }
      });
      const mutSpec = (targetsBySource?.get(src) || [src]).join(',');
      return { src, reportRel, commandArgv: [...baseTokens, cfgRel, '-m', mutSpec, '--incrementalFile', `reports/stryker-${stem}-incremental.json`, ...extraFlags, '--allowEmpty'] };
    });
  };

  if (full) {
    return { skip: false, diffScoped: false, full: true, commandArgv: [...baseTokens, ...jsonRepArgs, ...extraFlags], targets: [], shards: makeShards(concreteMutate) };
  }

  const cs = changeSet || readChangeSet({ ...resolveRange({ baseBranch, repoRoot: absRepo }), source: 'worktree', repoRoot: absRepo });
  const modified = cs.entries
    .filter((e) => e.status !== 'D' && e.newMode !== '160000')
    .map((e) => e.path)
    .filter((f) => (!modPrefix ? true : f === modPrefix || f.startsWith(`${modPrefix}/`)))
    .map((f) => (!modPrefix ? f : f.slice(modPrefix.length + 1)));
  if (explicitMutate.length > 0) {
    const negPatterns = explicitMutate.filter((p) => p.startsWith('!')).map((p) => p.slice(1));
    const unmutatedSources = modified.filter(
      (f) => isTrackableSourceFile(f) && !matchesMutatePatterns(f, explicitMutate) && (negPatterns.length === 0 || !matchesMutatePatterns(f, negPatterns))
    );
    if (unmutatedSources.length > 0) {
      return { skip: false, diffScoped: true, status: 'diff-unmutated-sources', unmutatedSources, reason: `Changed source file(s) outside Stryker mutate scope: ${unmutatedSources.join(', ')}`, commandArgv: null, targets: [] };
    }
  }
  const directSources = modified.filter((f) => (explicitMutate.length > 0 ? matchesMutatePatterns(f, explicitMutate) : isTrackableSourceFile(f)));
  const directSet = new Set(directSources);
  const pairedSources = modified.filter((f) => isTestFilePath(f)).map((t) => mapUnitTestToSource(t, concreteMutate)).filter((s) => s && !directSet.has(s));
  const allSources = [...new Set([...directSources, ...pairedSources])];
  if (allSources.length === 0) {
    return { skip: true, diffScoped: true, reason: 'diff-no-mutated-sources', commandArgv: null, targets: [] };
  }

  const targets = [];
  const targetsBySource = new Map();
  for (const src of directSources) {
    const ranges = extractChangedHunkRanges(cs.patches.get(modPrefix ? `${modPrefix}/${src}` : src) || cs.patches.get(src) || '');
    const srcTargets = ranges.length > 0 ? ranges.map((r) => `${src}:${r.start}-${r.end}`) : [src];
    targets.push(...srcTargets);
    targetsBySource.set(src, srcTargets);
  }
  for (const ps of pairedSources) {
    targets.push(ps);
    targetsBySource.set(ps, [ps]);
  }

  let configArg = [];
  let incFile = defaultIncFile;
  if (allSources.length === 1 && canScopeTap) {
    const pairedTest = mapSourceToUnitTest(allSources[0], modCwd);
    if (pairedTest) {
      const stem = path.basename(allSources[0]).replace(/\.[cm]?[jt]sx?$/i, '');
      configArg = [writeScopedCfg('stryker-diff.config.json', {
        jsonReporter: { ...(strykerCfg.jsonReporter || {}), fileName: 'reports/mutation/mutation.json' },
        tap: { ...strykerCfg.tap, testFiles: orderTests(pairedTest) }
      })];
      incFile = `reports/stryker-${stem}-incremental.json`;
    }
  }

  const shards = makeShards(allSources, targetsBySource);
  const scopedTokens = [...baseTokens, ...(configArg.length > 0 ? configArg : jsonRepArgs), '-m', targets.join(','), '--incrementalFile', incFile, ...extraFlags, '--allowEmpty'];
  return { skip: false, diffScoped: true, full: false, commandArgv: scopedTokens, targets, matchedSources: allSources, shards };
}

function parseTargetRangeFilter(targets = null, absRepo = null, modCwd = null) {
  if (!Array.isArray(targets) || targets.length === 0) return null;
  const map = new Map();
  const normKey = (f) => (absRepo && modCwd ? normalizeReportPathToRepoRel(f, absRepo, modCwd) : f.replace(/\\/g, '/').replace(/^\.\//, ''));
  for (const raw of targets) {
    const str = String(raw || '').trim();
    const m = str.match(/^(.+?):(\d+)-(\d+)$/);
    if (m) {
      const file = normKey(m[1]);
      const list = map.get(file) || [];
      if (list !== 'ALL') {
        list.push({ start: Number(m[2]), end: Number(m[3]) });
        map.set(file, list);
      }
    } else if (str) {
      map.set(normKey(str), 'ALL');
    }
  }
  return map;
}

function findPitestReport(modCwd) {
  for (const base of ['target/pit-reports', 'build/reports/pitest']) {
    const absBase = path.join(modCwd, base);
    if (!fileExists(absBase)) continue;
    if (fileExists(path.join(absBase, 'mutations.xml'))) return `${base}/mutations.xml`;
    const subs = fs.readdirSync(absBase, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `${base}/${d.name}/mutations.xml`).filter((rel) => fileExists(path.join(modCwd, rel))).sort();
    if (subs.length > 0) return subs[subs.length - 1];
  }
  return null;
}

export function parseMutationReport(repoRoot = '.', mod = {}, { targets = null, exemptions = null } = {}) {
  const absRepo = path.resolve(repoRoot);
  const modCwd = mod?.path && mod.path !== '.' ? resolveInsideRepo(absRepo, mod.path) : absRepo;
  const threshold = mod?.thresholds?.mutationScore ?? 80;
  const { activeSet: exemptSet, warnings } = resolveActiveExemptions(exemptions ?? listExemptions(absRepo));

  const [strykerRel, cargoRel, mutmutJsonRel, mutmutTxtRel, goMutRel] = [
    'reports/mutation/mutation.json', 'mutants.out/outcomes.json', '.mutmut-results.json', '.mutmut-results.txt', 'reports/mutation/go-mutesting.txt'
  ];
  const pitRel = findPitestReport(modCwd);

  const finalize = ({ relFile, killed, survived, exempted = 0 }) => {
    const denom = killed + survived;
    if (denom === 0 && exempted === 0) {
      return { found: true, passed: false, zeroMutants: true, file: relFile, threshold, warnings, score: 0, formatted: '0.0%', reason: 'EMPTY_REPORT: 0 evaluable mutants found.' };
    }
    const score = denom === 0 ? 100 : Number(((killed / denom) * 100).toFixed(2));
    const passed = threshold === null ? true : score >= threshold;
    const reason = passed ? null : `Mutation score ${score.toFixed(1)}% is below threshold ${threshold}%.`;
    return { found: true, passed, zeroMutants: false, file: relFile, threshold, warnings, killed, survived, exempted, total: denom + exempted, score, formatted: `${score.toFixed(1)}%`, reason };
  };

  if (fileExists(path.join(modCwd, strykerRel))) {
    const parsed = JSON.parse(fs.readFileSync(path.join(modCwd, strykerRel), 'utf8'));
    const rangeFilter = parseTargetRangeFilter(targets, absRepo, modCwd);
    let killed = 0;
    let survived = 0;
    let exempted = 0;

    for (const [rawFile, fileObj] of Object.entries(parsed.files || {})) {
      const relFile = normalizeReportPathToRepoRel(rawFile, absRepo, modCwd);
      const filterRule = rangeFilter ? rangeFilter.get(relFile) : 'ALL';
      if (rangeFilter && !filterRule) continue;

      for (const mut of fileObj.mutants || []) {
        if (filterRule && filterRule !== 'ALL') {
          const line = Number(mut?.location?.start?.line || 0);
          if (!filterRule.some((r) => line >= r.start && line <= r.end)) continue;
        }
        const status = String(mut.status || '');
        if (status === 'Ignored' || status === 'CompileError') continue;
        const mutIdentity = formatMutantIdentity(mut);
        if (mutIdentity && exemptSet.has(`${relFile}::${mutIdentity}`)) {
          exempted++;
          continue;
        }
        if (status === 'Killed' || status === 'Timeout') killed++;
        else if (status === 'Survived' || status === 'NoCoverage' || status === 'RuntimeError') survived++;
      }
    }
    return finalize({ relFile: strykerRel, killed, survived, exempted });
  }

  if (pitRel) {
    const xml = fs.readFileSync(path.join(modCwd, pitRel), 'utf8');
    let killed = 0; let survived = 0;
    for (const m of xml.matchAll(/<mutation\b[^>]*\bdetected="(true|false)"[^>]*\bstatus="([^"]+)"/g)) {
      const status = m[2].toUpperCase();
      if (status === 'MEMORY_ERROR' || status === 'RUN_ERROR') continue;
      if (m[1] === 'true') killed++; else survived++;
    }
    return finalize({ relFile: pitRel, killed, survived });
  }
  if (fileExists(path.join(modCwd, cargoRel))) {
    const parsed = JSON.parse(fs.readFileSync(path.join(modCwd, cargoRel), 'utf8'));
    const outcomes = Array.isArray(parsed.outcomes) ? parsed.outcomes : Array.isArray(parsed) ? parsed : [];
    let killed = 0; let survived = 0;
    for (const o of outcomes) {
      const sum = String(o.summary || o.outcome || '').toLowerCase();
      if (sum.includes('caught') || sum.includes('killed') || sum.includes('timeout')) killed++;
      else if (sum.includes('missed') || sum.includes('survived')) survived++;
    }
    return finalize({ relFile: cargoRel, killed, survived });
  }
  if (fileExists(path.join(modCwd, mutmutJsonRel))) {
    const parsed = JSON.parse(fs.readFileSync(path.join(modCwd, mutmutJsonRel), 'utf8'));
    return finalize({ relFile: mutmutJsonRel, killed: Number(parsed.killed || 0) + Number(parsed.timeout || 0), survived: Number(parsed.survived || 0) });
  }
  if (fileExists(path.join(modCwd, mutmutTxtRel))) {
    const txt = fs.readFileSync(path.join(modCwd, mutmutTxtRel), 'utf8');
    const km = txt.match(/(?:Killed|🎉)\s*:?\s*(\d+)/i);
    const tm = txt.match(/(?:Timeout|⏰)\s*:?\s*(\d+)/i);
    const sm = txt.match(/(?:Survived|🙁)\s*:?\s*(\d+)/i);
    return finalize({ relFile: mutmutTxtRel, killed: (km ? Number(km[1]) : 0) + (tm ? Number(tm[1]) : 0), survived: sm ? Number(sm[1]) : 0 });
  }
  if (fileExists(path.join(modCwd, goMutRel))) {
    const txt = fs.readFileSync(path.join(modCwd, goMutRel), 'utf8');
    return finalize({ relFile: goMutRel, killed: [...txt.matchAll(/^PASS:/gm)].length, survived: [...txt.matchAll(/^FAIL:/gm)].length });
  }

  return { found: false, passed: false, threshold, reason: 'No mutation report found on disk.' };
}

export function measureModuleCoverage(repoRoot = '.', mod = {}, { verbose = false, baseBranch = null, changeSet = null } = {}) {
  if (!mod.commands?.coverage) {
    return { found: false, passed: false, reason: `Module '${mod.name}' has no coverage command configured.` };
  }
  const modCwd = mod.path && mod.path !== '.' ? resolveInsideRepo(repoRoot, mod.path) : path.resolve(repoRoot);
  if (mod.commands.coverageFile) {
    fs.mkdirSync(path.dirname(path.resolve(modCwd, mod.commands.coverageFile)), { recursive: true });
  }
  const startedAt = Date.now();
  runConfiguredCommand(mod.commands.coverage, { cwd: modCwd, stdio: verbose ? 'inherit' : 'pipe', encoding: 'utf8' });
  return requireFreshReport(parseCoverageReport(repoRoot, mod, { baseBranch, changeSet }), mod, repoRoot, startedAt);
}

export function measureModuleMutation(repoRoot = '.', mod = {}, { full = false, noCache = false, verbose = false, baseBranch = null, changeSet = null, strykerConfig = null, exemptions = null, onProgress = null } = {}) {
  const plan = buildMutationPlan(repoRoot, mod, { full, noCache, baseBranch, changeSet, strykerConfig });
  if (plan.status === 'diff-unmutated-sources') {
    return { found: false, passed: false, skipped: false, score: null, status: plan.status, unmutatedSources: plan.unmutatedSources, formatted: '0.0% (diff-unmutated-sources)', reason: plan.reason };
  }
  if (plan.skip) {
    const status = plan.reason || 'not-configured';
    return { found: false, passed: true, skipped: true, score: null, status, formatted: `skipped (${status})` };
  }
  const modCwd = mod.path && mod.path !== '.' ? resolveInsideRepo(repoRoot, mod.path) : path.resolve(repoRoot);
  const startedAt = Date.now();
  let runnerErr = null;
  if (Array.isArray(plan.shards) && plan.shards.length > 0) {
    const mergedReportAbs = path.join(modCwd, 'reports/mutation/mutation.json');
    fs.rmSync(mergedReportAbs, { force: true });
    const mergedFiles = {};
    for (let i = 0; i < plan.shards.length; i++) {
      const shard = plan.shards[i];
      const shardAbs = path.join(modCwd, shard.reportRel);
      fs.rmSync(shardAbs, { force: true });
      const shardStart = Date.now();
      if (onProgress) onProgress(`[gate] Mutation shard ${i + 1}/${plan.shards.length}: ${shard.src}`);
      runConfiguredCommand(shard.commandArgv, { cwd: modCwd, stdio: verbose ? 'inherit' : 'pipe', encoding: 'utf8' });
      let shardFiles = null;
      if (fileExists(shardAbs) && fs.statSync(shardAbs).mtimeMs + 2000 >= shardStart) {
        try {
          const parsed = JSON.parse(fs.readFileSync(shardAbs, 'utf8'));
          if (parsed?.files && typeof parsed.files === 'object' && !Array.isArray(parsed.files)) shardFiles = parsed.files;
        } catch {}
      }
      if (!shardFiles) {
        return { found: false, passed: false, threshold: mod?.thresholds?.mutationScore ?? 80, reason: `Invalid or missing mutation shard report '${shard.reportRel}'.` };
      }
      Object.assign(mergedFiles, shardFiles);
    }
    writeFileAtomic(mergedReportAbs, JSON.stringify({ schemaVersion: '2', files: mergedFiles }, null, 2) + '\n');
  } else {
    if (onProgress) onProgress(`[gate] Running mutation check (${mod.name})...`);
    try { runConfiguredCommand(plan.commandArgv, { cwd: modCwd, stdio: verbose ? 'inherit' : 'pipe', encoding: 'utf8' }); } catch (err) { runnerErr = err; }
  }
  const checked = requireFreshReport(parseMutationReport(repoRoot, mod, { targets: plan.diffScoped ? plan.targets : null, exemptions }), mod, repoRoot, startedAt);
  if (checked.found && !checked.stale) {
    if (checked.zeroMutants && plan.diffScoped) {
      return { ...checked, passed: true, skipped: true, score: null, status: 'diff-zero-mutants', formatted: 'skipped (diff-zero-mutants)' };
    }
    return { ...checked, status: 'measured' };
  }
  if (runnerErr) throw runnerErr;
  return checked;
}

export function runGate(repoRoot = '.', { noCache = false, online = false, verbose = false, baseBranch = null, writeSessionFn = null, onProgress = null } = {}) {
  const cfgCheck = validateConfigFile(repoRoot);
  if (!cfgCheck.valid) {
    return { passed: false, stage: 'config', errors: cfgCheck.errors, reason: `Invalid configuration: ${cfgCheck.errors.join('; ')}` };
  }
  if (hasDirtyNonGovernanceFiles(repoRoot, { allowAuditChain: true })) {
    return { passed: false, stage: 'dirty', dirty: true, reason: 'DIRTY_WORKING_TREE: commit or stash before gating.' };
  }
  const activeSession = readActiveSession(repoRoot);
  const effectiveBase = baseBranch || activeSession?.baseBranch || null;
  const range = resolveRange({ baseBranch: effectiveBase, head: 'HEAD', repoRoot });
  const cs = readChangeSet({ ...range, source: 'commit', repoRoot });
  const policy = loadEffectivePolicy({ repoRoot, baseSha: range.baseSha, headSha: range.headSha, changedPaths: cs.paths });
  const config = policy.config;
  const modifiedFiles = cs.paths;
  const mode = isDocsOnlyDiff(cs) ? 'docs-only' : 'code';

  if (onProgress) onProgress(`[gate] Checking spec/ADR drift, architecture rings & secrets (mode=${mode})...`);
  const drift = checkSpecDrift({ ticketId: activeSession?.issueId || null, baseBranch: range.effectiveBase, changeSet: cs, policyTriggers: policy.policyTriggers, repoRoot });
  const arch =
    config.archlens?.enabled !== false
      ? checkArchRings({ repoRoot, policyPath: config.archlens?.policyPath || '.archlens/policy.json', sha: range.headSha })
      : { passed: true, violations: [] };
  const secrets = scanDiffSecrets(repoRoot, { baseBranch: range.effectiveBase, changeSet: cs, runNpmAudit: Boolean(online || process.env.CI === 'true') });

  const moduleResults = [];
  let [lintPassed, buildPassed, testsPassed, minDiffCov, minMutation] = [true, true, true, null, null];
  let mutationStatus = mode === 'docs-only' ? 'docs-only' : 'not-configured';

  if (mode === 'code' && drift.passed && arch.passed && secrets.passed) {
    for (const mod of config.modules) {
      const modCwd = mod.path && mod.path !== '.' ? resolveInsideRepo(repoRoot, mod.path) : path.resolve(repoRoot);
      const tree = computeTreeHash({ repoRoot, modulePath: mod.path || '.', checkType: 'gate', baseBranch: range.effectiveBase });
      const cached = !noCache && tree.cacheable ? readGateCache(repoRoot, mod.name, tree.hash) : null;

      if (cached && cached.passed === true) {
        if (typeof cached.diffCoveragePct === 'number') minDiffCov = minDiffCov === null ? cached.diffCoveragePct : Math.min(minDiffCov, cached.diffCoveragePct);
        if (typeof cached.mutationPct === 'number') minMutation = minMutation === null ? cached.mutationPct : Math.min(minMutation, cached.mutationPct);
        if (cached.mutationStatus) mutationStatus = cached.mutationStatus;
        moduleResults.push({ module: mod.name, cached: true, ...cached });
        continue;
      }

      const stdioOpt = verbose ? 'inherit' : 'pipe';
      const runCmd = (spec) => runConfiguredCommand(spec, { cwd: modCwd, stdio: stdioOpt, encoding: 'utf8' });
      let [modCovPct, modMutPct, modMutStatus] = [null, null, 'not-configured'];

      if (mod.commands?.lint) {
        if (onProgress) onProgress(`[gate] Running lint (${mod.name})...`);
        try { runCmd(mod.commands.lint); } catch (err) {
          lintPassed = false;
          moduleResults.push({ module: mod.name, passed: false, failedStep: 'lint', error: err.message });
          break;
        }
      }
      if (mod.commands?.build) {
        if (onProgress) onProgress(`[gate] Running build (${mod.name})...`);
        try { runCmd(mod.commands.build); } catch (err) {
          buildPassed = false;
          moduleResults.push({ module: mod.name, passed: false, failedStep: 'build', error: err.message });
          break;
        }
      }
      try {
        if (mod.thresholds?.diffCoverage !== null && mod.thresholds?.diffCoverage !== undefined) {
          if (onProgress) onProgress(`[gate] Measuring diff coverage (${mod.name})...`);
          const cov = measureModuleCoverage(repoRoot, mod, { verbose, baseBranch: range.effectiveBase, changeSet: cs });
          modCovPct = cov.diffLineCoverage ?? null;
          if (!cov.passed) {
            testsPassed = false;
            moduleResults.push({ module: mod.name, passed: false, failedStep: 'coverage', coverage: cov, error: cov.reason });
            break;
          }
        } else if (mod.commands?.test) {
          if (onProgress) onProgress(`[gate] Running tests (${mod.name})...`);
          runCmd(mod.commands.test);
        }
      } catch (err) {
        testsPassed = false;
        moduleResults.push({ module: mod.name, passed: false, failedStep: 'test', error: err.message });
        break;
      }

      if (mod.thresholds?.mutationScore !== null && mod.thresholds?.mutationScore !== undefined) {
        if (!mod.commands?.mutation) {
          moduleResults.push({ module: mod.name, passed: false, failedStep: 'mutation', error: `Module '${mod.name}' has no mutation command configured.` });
          break;
        }
        try {
          const mut = measureModuleMutation(repoRoot, mod, { noCache, verbose, baseBranch: range.effectiveBase, changeSet: cs, strykerConfig: policy.stryker, exemptions: config.exemptions, onProgress });
          modMutPct = mut.score ?? null;
          modMutStatus = mut.status || 'measured';
          if (!mut.passed) {
            moduleResults.push({ module: mod.name, passed: false, failedStep: 'mutation', mutation: mut, error: mut.reason });
            break;
          }
        } catch (err) {
          moduleResults.push({ module: mod.name, passed: false, failedStep: 'mutation', error: err.message });
          break;
        }
      }

      if (modCovPct !== null) minDiffCov = minDiffCov === null ? modCovPct : Math.min(minDiffCov, modCovPct);
      if (modMutPct !== null) minMutation = minMutation === null ? modMutPct : Math.min(minMutation, modMutPct);
      mutationStatus = modMutStatus;
      const entrySummary = { passed: true, diffCoveragePct: modCovPct, mutationPct: modMutPct, mutationStatus: modMutStatus };
      if (tree.cacheable) writeGateCache(repoRoot, mod.name, tree.hash, entrySummary);
      moduleResults.push({ module: mod.name, cached: false, ...entrySummary });
    }
  }

  const allModulesPassed =
    mode === 'docs-only' || (moduleResults.length === config.modules.length && moduleResults.every((m) => m.passed === true));
  const passed = drift.passed && arch.passed && secrets.passed && lintPassed && buildPassed && testsPassed && allModulesPassed;
  const recordedHeadSha = range.headSha;
  const treeSha = recordedHeadSha ? computeContentTreeSha(recordedHeadSha, repoRoot) : null;
  const { specHash, adrHashes } = computeAlignmentHashes({ sha: recordedHeadSha || 'HEAD', repoRoot });

  const lastGate = {
    passed, headSha: recordedHeadSha, treeSha, mode, specHash, adrHashes,
    policySource: policy.policySource, pendingExemptions: policy.pendingExemptions,
    lintPassed, buildPassed, testsPassed, diffCoveragePct: minDiffCov,
    mutationPct: minMutation, mutationStatus, secretScanPassed: secrets.passed,
    archPassed: arch.passed, driftPassed: drift.passed,
    modules: moduleResults.map((m) => ({ module: m.module, passed: m.passed, diffCoveragePct: m.diffCoveragePct ?? null, mutationPct: m.mutationPct ?? null, mutationStatus: m.mutationStatus || 'not-configured' })),
    measuredAt: new Date().toISOString()
  };

  const persistFn = writeSessionFn || writeActiveSession;
  if (activeSession || writeSessionFn) {
    const curBranch = getCurrentGitBranch(repoRoot);
    persistFn(repoRoot, (store) => {
      const targetKey = Object.keys(store.sessions || {}).find((k) => store.sessions[k]?.branch === curBranch) || store.activeSessionId;
      if (targetKey && store.sessions[targetKey]) store.sessions[targetKey].lastGate = lastGate;
      return store;
    });
  }

  return { passed, mode, dirty: false, headSha: recordedHeadSha, policySource: policy.policySource, pendingExemptions: policy.pendingExemptions, modifiedFiles, drift, arch, secrets, modules: moduleResults, lastGate };
}

export function resolveAffectedTests(repoRoot = '.', { baseBranch = null } = {}) {
  const absRepo = path.resolve(repoRoot);
  const modified = readChangeSet({ ...resolveRange({ baseBranch, repoRoot: absRepo }), source: 'worktree', repoRoot: absRepo })
    .entries.filter((e) => e.status !== 'D')
    .map((e) => e.path);
  const tests = new Set();
  for (const f of modified) {
    if (/\.(?:test|spec)\.[cm]?js$/i.test(f) && !f.startsWith('-') && fileExists(path.join(absRepo, f))) {
      tests.add(f);
      continue;
    }
    if (isTestFilePath(f)) return [];
    const mapped = mapSourceToUnitTest(f, absRepo);
    if (mapped) tests.add(mapped);
  }
  return [...tests].sort();
}
