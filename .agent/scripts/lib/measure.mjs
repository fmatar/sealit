import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  computeContentTreeSha, fileExists, getCurrentGitBranch, getModifiedFiles,
  getUnifiedDiffByFile, gitOutput, hasDirtyNonGovernanceFiles, isDocsOnlyDiff,
  parseCommandArgv, readFileSafe, resolveDiffComparisonState, resolveInsideRepo,
  runConfiguredCommand, writeFileAtomic
} from './git.mjs';
import { listExemptions, validateConfigFile } from './config.mjs';
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

export function scanDiffSecrets(repoRoot = '.', { baseBranch = null, runNpmAudit = false, diffGetter = null } = {}) {
  const secretViolations = [];
  let diffFiles = [];
  try {
    diffFiles = getModifiedFiles(baseBranch, repoRoot);
    const diffsByFile = diffGetter ? diffGetter(baseBranch, repoRoot, diffFiles) : getUnifiedDiffByFile(baseBranch, repoRoot, diffFiles);
    for (const file of diffFiles) {
      try {
        const diffOutput = diffsByFile.get(file) || '';
        if (!diffOutput) continue;
        const isTest = isTestFilePath(file);
        const lines = diffOutput.replace(/\r\n/g, '\n').split('\n');
        let addedIdx = 0;
        for (const line of lines) {
          if (!line.startsWith('+') || line.startsWith('+++')) continue;
          addedIdx++;
          for (const sp of SECRET_PATTERNS) {
            if (sp.skipInTests && isTest) continue;
            if (sp.regex.test(line)) {
              secretViolations.push({
                file,
                type: 'SECRET_LEAK',
                pattern: sp.name,
                addedLineIndex: addedIdx
              });
            }
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
      cwd: path.resolve(repoRoot),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    });
    if (res.error) {
      auditError = `npm audit execution failed: ${res.error.message}`;
    } else {
      try {
        const parsed = JSON.parse(res.stdout || '{}');
        const vulns = parsed?.metadata?.vulnerabilities || {};
        const highCount = Number(vulns.high || 0) + Number(vulns.critical || 0);
        if (highCount > 0) {
          auditError = `npm audit reported ${highCount} high/critical vulnerability(s).`;
        }
      } catch (err) {
        auditError = `npm audit returned unparseable JSON: ${err.message}`;
      }
    }
  }

  return {
    passed: secretViolations.length === 0 && !auditError,
    filesScanned: diffFiles.length,
    secretViolations,
    auditError
  };
}

export function requireFreshReport(report, mod, repoRoot, startedAt) {
  if (!report || !report.found) {
    return { ...(report || {}), found: false, passed: false, reason: report?.reason || 'Report not found on disk.' };
  }
  const modDir = mod?.path && mod.path !== '.' ? resolveInsideRepo(repoRoot, mod.path) : path.resolve(repoRoot);
  let mtimeMs;
  try {
    mtimeMs = fs.statSync(path.resolve(modDir, report.file)).mtimeMs;
  } catch (err) {
    return {
      ...report,
      passed: false,
      stale: true,
      reason: `Unable to stat report '${report.file}': ${err.message}`
    };
  }
  if (mtimeMs + 2000 < startedAt) {
    return {
      ...report,
      passed: false,
      stale: true,
      reason: `Report '${report.file}' is stale (not regenerated by this run).`
    };
  }
  return report;
}

function tryRealpath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function normalizeReportPathToRepoRel(rawSf, absRepo, modCwd) {
  const clean = String(rawSf || '').trim().replace(/\\/g, '/');
  if (!clean) return '';
  const absCandidate = path.isAbsolute(clean) ? path.normalize(clean) : path.resolve(modCwd, clean);
  if (absCandidate.startsWith(absRepo + path.sep)) {
    return path.relative(absRepo, absCandidate).replace(/\\/g, '/');
  }
  const realRepo = tryRealpath(absRepo);
  const realCand = tryRealpath(absCandidate);
  if (realCand.startsWith(realRepo + path.sep)) {
    return path.relative(realRepo, realCand).replace(/\\/g, '/');
  }
  return clean.replace(/^\.\//, '');
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

export function parseCoverageReport(repoRoot = '.', mod = {}, { baseBranch = null } = {}) {
  const absRepo = path.resolve(repoRoot);
  const modCwd = mod?.path && mod.path !== '.' ? resolveInsideRepo(absRepo, mod.path) : absRepo;
  const modPrefix = path.relative(absRepo, modCwd).replace(/\\/g, '/');
  const threshold = mod?.thresholds?.diffCoverage ?? 85;

  const candidates = [
    mod?.commands?.coverageFile,
    'coverage/lcov.info',
    'coverage/coverage.xml',
    'coverage/cobertura-coverage.xml',
    'target/site/jacoco/jacoco.xml',
    'build/reports/jacoco/test/jacocoTestReport.xml',
    'coverage/cover.out'
  ].filter(Boolean);

  const relFound = candidates.find((rel) => fileExists(path.resolve(modCwd, rel)));
  if (!relFound) {
    return { found: false, passed: false, threshold, reason: `No coverage report found in ${mod.path || '.'}.` };
  }

  const raw = fs.readFileSync(path.resolve(modCwd, relFound), 'utf8');
  let repoLineCoverage = 0;
  let fileLineHits = null;

  if (relFound.endsWith('.info') || raw.includes('end_of_record')) {
    const lcov = parseLcovContent(raw, absRepo, modCwd);
    fileLineHits = lcov.fileLineHits;
    repoLineCoverage = lcov.totalLF > 0 ? Number(((lcov.totalLH / lcov.totalLF) * 100).toFixed(2)) : 100;
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
  if (fileLineHits) {
    const modFiles = getModifiedFiles(baseBranch, absRepo).filter((f) =>
      !modPrefix ? true : f === modPrefix || f.startsWith(`${modPrefix}/`)
    );
    const sourceModFiles = modFiles.filter((f) => isTrackableSourceFile(f));
    if (sourceModFiles.length > 0) {
      const diffMap = getUnifiedDiffByFile(baseBranch, absRepo, sourceModFiles);
      const addedByFile = extractAddedLinesByFile(diffMap);
      let diffTotal = 0;
      let diffHit = 0;

      for (const [file, addedLines] of addedByFile.entries()) {
        const reported = fileLineHits.get(file);
        if (reported) {
          for (const [ln] of addedLines.entries()) {
            if (reported.has(ln)) {
              diffTotal++;
              if (reported.get(ln) > 0) diffHit++;
            }
          }
        } else {
          // Unimported file absent from LCOV: every executable added line counts as 0 hits
          for (const [, text] of addedLines.entries()) {
            if (isExecutableSourceLine(text)) {
              diffTotal++;
            }
          }
        }
      }
      if (diffTotal > 0) {
        diffLineCoverage = Number(((diffHit / diffTotal) * 100).toFixed(2));
      }
    }
  }

  const passed = threshold === null ? true : diffLineCoverage >= threshold;
  return {
    found: true,
    passed,
    file: relFound,
    threshold,
    repoLineCoverage,
    diffLineCoverage,
    formatted: `${diffLineCoverage.toFixed(1)}%`,
    reason: passed ? null : `Diff line coverage ${diffLineCoverage.toFixed(1)}% is below threshold ${threshold}%.`
  };
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
  const norm = modRelTest.replace(/\\/g, '/');
  const m = norm.match(/^tests\/unit\/(.+?)\.test\.[cm]?[jt]s$/);
  if (!m) return null;
  const stem = m[1];
  if (stem === 'cli') {
    return explicitMutateFiles.find((f) => f.endsWith('sdlc-engine.mjs')) || null;
  }
  return explicitMutateFiles.find((f) => path.basename(f).replace(/\.[cm]?[jt]sx?$/i, '') === stem) || null;
}

export function buildMutationPlan(repoRoot = '.', mod = {}, { full = false, noCache = false, baseBranch = null } = {}) {
  const baseCmd = mod?.commands?.mutation;
  if (!baseCmd) return { skip: true, reason: 'not-configured', commandArgv: null, targets: [] };
  const parsed = parseCommandArgv(baseCmd);
  const baseTokens = [parsed.file, ...parsed.args];
  const isStryker = baseTokens.some((t) => /stryker/i.test(t));

  if (full || !isStryker) {
    return { skip: false, diffScoped: false, full: Boolean(full), commandArgv: baseTokens, targets: [] };
  }

  const absRepo = path.resolve(repoRoot);
  const modCwd = mod?.path && mod.path !== '.' ? resolveInsideRepo(absRepo, mod.path) : absRepo;
  const modPrefix = path.relative(absRepo, modCwd).replace(/\\/g, '/');
  const strykerCfgPath = path.join(modCwd, 'stryker.config.json');
  const strykerCfg = fileExists(strykerCfgPath) ? JSON.parse(readFileSafe(strykerCfgPath) || '{}') : {};
  const explicitMutate = Array.isArray(strykerCfg.mutate) ? strykerCfg.mutate.map((f) => f.replace(/^\.\//, '')) : [];
  const mutateSet = new Set(explicitMutate);

  const modified = getModifiedFiles(baseBranch, absRepo)
    .filter((f) => (!modPrefix ? true : f === modPrefix || f.startsWith(`${modPrefix}/`)))
    .map((f) => (!modPrefix ? f : f.slice(modPrefix.length + 1)));

  const directSources = modified.filter((f) => (mutateSet.size > 0 ? mutateSet.has(f) : isTrackableSourceFile(f)));
  const directSet = new Set(directSources);
  const pairedSources = modified
    .filter((f) => isTestFilePath(f))
    .map((t) => mapUnitTestToSource(t, explicitMutate))
    .filter((s) => s && !directSet.has(s));

  const allSources = [...new Set([...directSources, ...pairedSources])];
  if (allSources.length === 0) {
    return { skip: true, diffScoped: true, reason: 'diff-no-mutated-sources', commandArgv: null, targets: [] };
  }

  const repoPathsForDiff = directSources.map((s) => (modPrefix ? `${modPrefix}/${s}` : s));
  const diffMap = getUnifiedDiffByFile(baseBranch, absRepo, repoPathsForDiff);
  const targets = [];
  for (const src of directSources) {
    const repoKey = modPrefix ? `${modPrefix}/${src}` : src;
    const ranges = extractChangedHunkRanges(diffMap.get(repoKey) || diffMap.get(src) || '');
    if (ranges.length > 0) {
      for (const r of ranges) targets.push(`${src}:${r.start}-${r.end}`);
    } else {
      targets.push(src);
    }
  }
  for (const ps of pairedSources) targets.push(ps);

  // Build fast 1:1 paired stryker config when stryker.config.json uses tap.testFiles
  let configArg = [];
  if (fileExists(strykerCfgPath) && Array.isArray(strykerCfg?.tap?.testFiles)) {
    const pairedTests = allSources.map((s) => mapSourceToUnitTest(s, modCwd));
    if (pairedTests.every(Boolean)) {
      const scopedCfgRel = '.agent/.cache/stryker-diff.config.json';
      const scopedCfg = {
        ...strykerCfg,
        tap: { ...strykerCfg.tap, testFiles: [...new Set(pairedTests)] }
      };
      writeFileAtomic(path.join(modCwd, scopedCfgRel), JSON.stringify(scopedCfg, null, 2) + '\n');
      configArg = [scopedCfgRel];
    }
  }

  const scopedTokens = [
    ...baseTokens,
    ...configArg,
    '-m',
    targets.join(','),
    '--incrementalFile',
    'reports/stryker-diff-incremental.json',
    ...(noCache ? ['--force'] : []),
    '--allowEmpty'
  ];

  return { skip: false, diffScoped: true, full: false, commandArgv: scopedTokens, targets, matchedSources: allSources };
}

function parseTargetRangeFilter(targets = null) {
  if (!Array.isArray(targets) || targets.length === 0) return null;
  const map = new Map();
  for (const raw of targets) {
    const str = String(raw || '').trim();
    const m = str.match(/^(.+?):(\d+)-(\d+)$/);
    if (m) {
      const file = m[1].replace(/\\/g, '/').replace(/^\.\//, '');
      const list = map.get(file) || [];
      if (list !== 'ALL') {
        list.push({ start: Number(m[2]), end: Number(m[3]) });
        map.set(file, list);
      }
    } else if (str) {
      map.set(str.replace(/\\/g, '/').replace(/^\.\//, ''), 'ALL');
    }
  }
  return map;
}

function findPitestReport(modCwd) {
  for (const base of ['target/pit-reports', 'build/reports/pitest']) {
    const absBase = path.join(modCwd, base);
    if (!fileExists(absBase)) continue;
    const direct = path.join(absBase, 'mutations.xml');
    if (fileExists(direct)) return `${base}/mutations.xml`;
    const subs = fs
      .readdirSync(absBase, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `${base}/${d.name}/mutations.xml`)
      .filter((rel) => fileExists(path.join(modCwd, rel)))
      .sort();
    if (subs.length > 0) return subs[subs.length - 1];
  }
  return null;
}

export function parseMutationReport(repoRoot = '.', mod = {}, { targets = null } = {}) {
  const absRepo = path.resolve(repoRoot);
  const modCwd = mod?.path && mod.path !== '.' ? resolveInsideRepo(absRepo, mod.path) : absRepo;
  const threshold = mod?.thresholds?.mutationScore ?? 80;
  const exemptions = listExemptions(absRepo);
  const exemptSet = new Set(exemptions.map((e) => `${e.file.replace(/\\/g, '/')}::${e.id}`));

  const strykerRel = 'reports/mutation/mutation.json';
  const cargoRel = 'mutants.out/outcomes.json';
  const mutmutJsonRel = '.mutmut-results.json';
  const mutmutTxtRel = '.mutmut-results.txt';
  const goMutRel = 'reports/mutation/go-mutesting.txt';
  const pitRel = findPitestReport(modCwd);

  const finalize = ({ relFile, killed, survived, exempted = 0 }) => {
    const denom = killed + survived;
    if (denom === 0 && exempted === 0) {
      return { found: true, passed: false, zeroMutants: true, file: relFile, threshold, score: 0, formatted: '0.0%', reason: 'EMPTY_REPORT: 0 evaluable mutants found.' };
    }
    const score = denom === 0 ? 100 : Number(((killed / denom) * 100).toFixed(2));
    const passed = threshold === null ? true : score >= threshold;
    const reason = passed ? null : `Mutation score ${score.toFixed(1)}% is below threshold ${threshold}%.`;
    return { found: true, passed, zeroMutants: false, file: relFile, threshold, killed, survived, exempted, total: denom + exempted, score, formatted: `${score.toFixed(1)}%`, reason };
  };

  if (fileExists(path.join(modCwd, strykerRel))) {
    const parsed = JSON.parse(fs.readFileSync(path.join(modCwd, strykerRel), 'utf8'));
    const rangeFilter = parseTargetRangeFilter(targets);
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
        if (exemptSet.has(`${relFile}::${mut.id}`)) {
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
    let killed = 0;
    let survived = 0;
    for (const m of xml.matchAll(/<mutation\b[^>]*\bdetected="(true|false)"[^>]*\bstatus="([^"]+)"/g)) {
      const detected = m[1] === 'true';
      const status = m[2].toUpperCase();
      if (status === 'MEMORY_ERROR' || status === 'RUN_ERROR') continue;
      if (detected) killed++;
      else survived++;
    }
    return finalize({ relFile: pitRel, killed, survived });
  }

  if (fileExists(path.join(modCwd, cargoRel))) {
    const parsed = JSON.parse(fs.readFileSync(path.join(modCwd, cargoRel), 'utf8'));
    const outcomes = Array.isArray(parsed.outcomes) ? parsed.outcomes : Array.isArray(parsed) ? parsed : [];
    let killed = 0;
    let survived = 0;
    for (const o of outcomes) {
      const sum = String(o.summary || o.outcome || '').toLowerCase();
      if (sum.includes('caught') || sum.includes('killed') || sum.includes('timeout')) killed++;
      else if (sum.includes('missed') || sum.includes('survived')) survived++;
    }
    return finalize({ relFile: cargoRel, killed, survived });
  }

  if (fileExists(path.join(modCwd, mutmutJsonRel))) {
    const parsed = JSON.parse(fs.readFileSync(path.join(modCwd, mutmutJsonRel), 'utf8'));
    const killed = Number(parsed.killed || 0) + Number(parsed.timeout || 0);
    const survived = Number(parsed.survived || 0);
    return finalize({ relFile: mutmutJsonRel, killed, survived });
  }

  if (fileExists(path.join(modCwd, mutmutTxtRel))) {
    const txt = fs.readFileSync(path.join(modCwd, mutmutTxtRel), 'utf8');
    const km = txt.match(/(?:Killed|🎉)\s*:?\s*(\d+)/i);
    const tm = txt.match(/(?:Timeout|⏰)\s*:?\s*(\d+)/i);
    const sm = txt.match(/(?:Survived|🙁)\s*:?\s*(\d+)/i);
    const killed = (km ? Number(km[1]) : 0) + (tm ? Number(tm[1]) : 0);
    const survived = sm ? Number(sm[1]) : 0;
    return finalize({ relFile: mutmutTxtRel, killed, survived });
  }

  if (fileExists(path.join(modCwd, goMutRel))) {
    const txt = fs.readFileSync(path.join(modCwd, goMutRel), 'utf8');
    const killed = [...txt.matchAll(/^PASS:/gm)].length;
    const survived = [...txt.matchAll(/^FAIL:/gm)].length;
    return finalize({ relFile: goMutRel, killed, survived });
  }

  return { found: false, passed: false, threshold, reason: 'No mutation report found on disk.' };
}

export function measureModuleCoverage(repoRoot = '.', mod = {}, { verbose = false, baseBranch = null } = {}) {
  if (!mod.commands?.coverage) {
    return { found: false, passed: false, reason: `Module '${mod.name}' has no coverage command configured.` };
  }
  const modCwd = mod.path && mod.path !== '.' ? resolveInsideRepo(repoRoot, mod.path) : path.resolve(repoRoot);
  if (mod.commands.coverageFile) {
    fs.mkdirSync(path.dirname(path.resolve(modCwd, mod.commands.coverageFile)), { recursive: true });
  }
  const startedAt = Date.now();
  runConfiguredCommand(mod.commands.coverage, { cwd: modCwd, stdio: verbose ? 'inherit' : 'pipe', encoding: 'utf8' });
  return requireFreshReport(parseCoverageReport(repoRoot, mod, { baseBranch }), mod, repoRoot, startedAt);
}

export function measureModuleMutation(repoRoot = '.', mod = {}, { full = false, noCache = false, verbose = false, baseBranch = null } = {}) {
  const plan = buildMutationPlan(repoRoot, mod, { full, noCache, baseBranch });
  if (plan.skip) {
    const status = plan.reason || 'not-configured';
    return { found: false, passed: true, skipped: true, score: null, status, formatted: `skipped (${status})` };
  }
  const modCwd = mod.path && mod.path !== '.' ? resolveInsideRepo(repoRoot, mod.path) : path.resolve(repoRoot);
  const startedAt = Date.now();
  let runnerErr = null;
  try {
    runConfiguredCommand(plan.commandArgv, { cwd: modCwd, stdio: verbose ? 'inherit' : 'pipe', encoding: 'utf8' });
  } catch (err) {
    runnerErr = err;
  }
  const checked = requireFreshReport(
    parseMutationReport(repoRoot, mod, { targets: plan.diffScoped ? plan.targets : null }),
    mod,
    repoRoot,
    startedAt
  );
  if (checked.found && !checked.stale) {
    if (checked.zeroMutants && plan.diffScoped) {
      return { ...checked, passed: true, skipped: true, score: null, status: 'diff-zero-mutants', formatted: 'skipped (diff-zero-mutants)' };
    }
    return { ...checked, status: 'measured' };
  }
  if (runnerErr) throw runnerErr;
  return checked;
}

export function runGate(repoRoot = '.', { noCache = false, online = false, verbose = false, baseBranch = null, writeSessionFn = null } = {}) {
  const cfgCheck = validateConfigFile(repoRoot);
  if (!cfgCheck.valid) {
    return { passed: false, stage: 'config', errors: cfgCheck.errors, reason: `Invalid configuration: ${cfgCheck.errors.join('; ')}` };
  }
  const config = cfgCheck.config;
  const activeSession = readActiveSession(repoRoot);
  const effectiveBase = baseBranch || activeSession?.baseBranch || null;
  const modifiedFiles = getModifiedFiles(effectiveBase, repoRoot);
  const mode = modifiedFiles.length > 0 && isDocsOnlyDiff(modifiedFiles) ? 'docs-only' : 'code';

  const drift = checkSpecDrift({ ticketId: activeSession?.issueId || null, baseBranch: effectiveBase, repoRoot });
  const arch =
    config.archlens?.enabled !== false
      ? checkArchRings({ repoRoot, policyPath: config.archlens?.policyPath || '.archlens/policy.json' })
      : { passed: true, violations: [] };
  const secrets = scanDiffSecrets(repoRoot, { baseBranch: effectiveBase, runNpmAudit: Boolean(online || process.env.CI === 'true') });

  const moduleResults = [];
  let lintPassed = true;
  let buildPassed = true;
  let testsPassed = true;
  let minDiffCov = null;
  let minMutation = null;
  let mutationStatus = mode === 'docs-only' ? 'docs-only' : 'not-configured';
  const dirty = hasDirtyNonGovernanceFiles(repoRoot, { allowAuditChain: true });

  if (mode === 'code' && drift.passed && arch.passed && secrets.passed) {
    for (const mod of config.modules) {
      const modCwd = mod.path && mod.path !== '.' ? resolveInsideRepo(repoRoot, mod.path) : path.resolve(repoRoot);
      const tree = computeTreeHash({ repoRoot, modulePath: mod.path || '.', checkType: 'gate' });
      const cached = !noCache && !dirty && tree.cacheable ? readGateCache(repoRoot, mod.name, tree.hash) : null;

      if (cached && cached.passed === true) {
        if (typeof cached.diffCoveragePct === 'number') minDiffCov = minDiffCov === null ? cached.diffCoveragePct : Math.min(minDiffCov, cached.diffCoveragePct);
        if (typeof cached.mutationPct === 'number') minMutation = minMutation === null ? cached.mutationPct : Math.min(minMutation, cached.mutationPct);
        if (cached.mutationStatus) mutationStatus = cached.mutationStatus;
        moduleResults.push({ module: mod.name, cached: true, ...cached });
        continue;
      }

      const stdioOpt = verbose ? 'inherit' : 'pipe';
      const runCmd = (spec) => runConfiguredCommand(spec, { cwd: modCwd, stdio: stdioOpt, encoding: 'utf8' });
      let modCovPct = null;
      let modMutPct = null;
      let modMutStatus = 'not-configured';

      if (mod.commands?.lint) {
        try { runCmd(mod.commands.lint); } catch (err) {
          lintPassed = false;
          moduleResults.push({ module: mod.name, passed: false, failedStep: 'lint', error: err.message });
          break;
        }
      }
      if (mod.commands?.build) {
        try { runCmd(mod.commands.build); } catch (err) {
          buildPassed = false;
          moduleResults.push({ module: mod.name, passed: false, failedStep: 'build', error: err.message });
          break;
        }
      }
      try {
        if (mod.commands?.coverage && mod.thresholds?.diffCoverage !== null) {
          const cov = measureModuleCoverage(repoRoot, mod, { verbose, baseBranch: effectiveBase });
          modCovPct = cov.diffLineCoverage ?? null;
          if (!cov.passed) {
            testsPassed = false;
            moduleResults.push({ module: mod.name, passed: false, failedStep: 'coverage', coverage: cov, error: cov.reason });
            break;
          }
        } else if (mod.commands?.test) {
          runCmd(mod.commands.test);
        }
      } catch (err) {
        testsPassed = false;
        moduleResults.push({ module: mod.name, passed: false, failedStep: 'test', error: err.message });
        break;
      }

      if (mod.commands?.mutation && mod.thresholds?.mutationScore !== null) {
        try {
          const mut = measureModuleMutation(repoRoot, mod, { noCache, verbose, baseBranch: effectiveBase });
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
      if (!dirty && tree.cacheable) writeGateCache(repoRoot, mod.name, tree.hash, entrySummary);
      moduleResults.push({ module: mod.name, cached: false, ...entrySummary });
    }
  }

  const allModulesPassed =
    mode === 'docs-only' || (moduleResults.length === config.modules.length && moduleResults.every((m) => m.passed === true));
  const passed = drift.passed && arch.passed && secrets.passed && lintPassed && buildPassed && testsPassed && allModulesPassed;
  const rawHeadSha = (gitOutput(['rev-parse', '--verify', 'HEAD'], repoRoot) || '').trim() || null;
  const recordedHeadSha = dirty ? 'DIRTY_WORKING_TREE' : rawHeadSha;
  const treeSha = !dirty && rawHeadSha ? computeContentTreeSha(rawHeadSha, repoRoot) : null;
  const { specHash, adrHashes } = computeAlignmentHashes(repoRoot);

  const lastGate = {
    passed, headSha: recordedHeadSha, treeSha, mode, specHash, adrHashes,
    lintPassed, buildPassed, testsPassed, diffCoveragePct: minDiffCov,
    mutationPct: minMutation, mutationStatus, secretScanPassed: secrets.passed,
    archPassed: arch.passed, driftPassed: drift.passed, measuredAt: new Date().toISOString()
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

  return { passed, mode, dirty, headSha: recordedHeadSha, modifiedFiles, drift, arch, secrets, modules: moduleResults, lastGate };
}

export function resolveAffectedTests(repoRoot = '.', { baseBranch = null } = {}) {
  const absRepo = path.resolve(repoRoot);
  const modified = getModifiedFiles(baseBranch, absRepo);
  const tests = new Set();
  for (const f of modified) {
    if (isTestFilePath(f) && fileExists(path.join(absRepo, f))) {
      tests.add(f);
      continue;
    }
    const mapped = mapSourceToUnitTest(f, absRepo);
    if (mapped) tests.add(mapped);
  }
  return [...tests].sort();
}

export function buildReviewPlan(repoRoot = '.', { baseBranch = null } = {}) {
  const { effectiveBase, headSha, mergeBase } = resolveDiffComparisonState(baseBranch, repoRoot);
  const modifiedFiles = getModifiedFiles(effectiveBase, repoRoot);
  const mode = modifiedFiles.length > 0 && isDocsOnlyDiff(modifiedFiles) ? 'docs-only' : 'code';
  const diffsByFile = getUnifiedDiffByFile(effectiveBase, repoRoot, modifiedFiles);
  let fullDiff = '';
  let changedLines = 0;
  for (const chunk of diffsByFile.values()) {
    fullDiff += `${chunk}\n`;
    changedLines += chunk.split('\n').filter((l) => (l.startsWith('+') && !l.startsWith('+++')) || (l.startsWith('-') && !l.startsWith('---'))).length;
  }
  const boundedDiff = fullDiff.length > 32000 ? `${fullDiff.slice(0, 32000)}\n... [diff truncated at 32kB]` : fullDiff;

  const touchesGovernanceOrSec = modifiedFiles.some((f) =>
    /^(?:PRODUCT\.md|docs\/specs\/|docs\/adr\/|\.archlens\/|\.github\/workflows\/)/.test(f) || /(?:receipt|guard|security|drift|auth|crypto)/i.test(f)
  );
  const needsArchReviewer = mode === 'code' && (changedLines > 200 || touchesGovernanceOrSec);

  const reviewers = mode === 'docs-only'
    ? [{ role: 'Docs Alignment Reviewer', focus: 'Verify clarity, link accuracy, and zero unintended spec drift.' }]
    : [
        {
          role: 'PR Peer Reviewer',
          focus: 'Verify behavioral correctness, edge cases, TDD test quality, and YAGNI simplicity.',
          prompt: `Review branch diff (${mergeBase?.slice(0, 7) || effectiveBase}..${headSha?.slice(0, 7) || 'HEAD'}).\nModified files: ${modifiedFiles.join(', ')}\nReturn structured verdict: approve | request-changes, blockers: [], notes.\n\nDiff:\n${boundedDiff}`
        },
        ...(needsArchReviewer
          ? [
              {
                role: 'Architecture & Security Reviewer',
                focus: 'Verify Concentric Clean Architecture ring boundaries, fail-closed error handling, shell-free execution (INV-04), and spec/ADR alignment.',
                prompt: `Audit security and architecture invariants on diff (${mergeBase?.slice(0, 7) || effectiveBase}..${headSha?.slice(0, 7) || 'HEAD'}).\nModified files: ${modifiedFiles.join(', ')}\nReturn structured verdict: approve | request-changes, blockers: [], notes.\n\nDiff:\n${boundedDiff}`
              }
            ]
          : [])
      ];

  return {
    mode,
    baseBranch: effectiveBase,
    mergeBase,
    headSha,
    changedLines,
    modifiedFiles,
    reviewers
  };
}
