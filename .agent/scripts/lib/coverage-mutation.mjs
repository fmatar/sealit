import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import {
  fileExists,
  readFileSafe,
  parseCommandArgv,
  runParallelTasks,
  getModifiedFiles,
  getUnifiedDiffByFile,
  extractAddedLinesFromDiff,
  resolveInsideRepo,
  resolveQualityThresholds,
  getExemptions
} from './core.mjs';
import { detectStackInDir } from './doctor-ci.mjs';
import { findAffectedTests } from './triage-review.mjs';

/**
 * Shell-free variant of buildSingleTestCommand: returns `{ file, args }`
 * for execFileSync/spawnSync so test filenames are never shell-parsed.
 */
export function buildSingleTestArgv(testFile, repoRoot = '.') {
  const raw = typeof testFile === 'string' ? testFile.trim() : '';
  if (!raw || raw.includes('\0') || raw.startsWith('-') || path.basename(raw).startsWith('-')) {
    throw new Error(`Invalid test target path: "${testFile}"`);
  }
  resolveInsideRepo(repoRoot, raw);
  const ext = path.extname(raw).toLowerCase();
  const baseName = path.basename(raw, ext);
  const detected = detectStackInDir(repoRoot);
  if (ext === '.java' || detected?.language === 'java') {
    if (detected?.type === 'java-gradle') return { file: './gradlew', args: ['test', '--tests', baseName] };
    return { file: './mvnw', args: ['test', `-Dtest=${baseName}`] };
  }
  if (ext === '.py' || detected?.language === 'python') return { file: 'pytest', args: [raw] };
  if (ext === '.go' || detected?.language === 'go') {
    const pkgDir = path.dirname(raw);
    return { file: 'go', args: ['test', '-v', `./${pkgDir === '.' ? '...' : pkgDir}`] };
  }
  if (ext === '.rs' || detected?.language === 'rust') return { file: 'cargo', args: ['test', '--test', baseName] };
  return { file: process.execPath, args: ['--test', raw] };
}

/** Human-readable command string (display only; never pass to a shell). */
export function buildSingleTestCommand(testFile, repoRoot = '.') {
  const ext = path.extname(testFile).toLowerCase();
  const baseName = path.basename(testFile, ext);
  const detected = detectStackInDir(repoRoot);

  if (ext === '.java' || detected?.language === 'java') {
    if (detected?.type === 'java-gradle') {
      return `./gradlew test --tests "${baseName}"`;
    }
    return `./mvnw test -Dtest="${baseName}"`;
  }
  if (ext === '.py' || detected?.language === 'python') {
    return `pytest "${testFile}"`;
  }
  if (ext === '.go' || detected?.language === 'go') {
    const pkgDir = path.dirname(testFile);
    return `go test -v "./${pkgDir === '.' ? '...' : pkgDir}"`;
  }
  if (ext === '.rs' || detected?.language === 'rust') {
    return `cargo test --test "${baseName}"`;
  }
  return `node --test "${testFile}"`;
}

function normalizeCoverageSourcePath(rawSfPath, repoRoot, modDir) {
  const absRoot = path.resolve(repoRoot);
  const normRaw = String(rawSfPath || '').trim().replace(/\\/g, '/');
  if (!normRaw) return '';
  if (path.isAbsolute(normRaw)) {
    return path.relative(absRoot, path.resolve(normRaw)).replace(/\\/g, '/').replace(/^\.\//, '');
  }
  const fromMod = path.relative(absRoot, path.resolve(modDir, normRaw)).replace(/\\/g, '/').replace(/^\.\//, '');
  if (!fromMod.startsWith('..')) return fromMod;
  return normRaw.replace(/^\.\//, '');
}

function parseLcovFileRecords(raw, repoRoot, modDir) {
  const records = new Map();
  let current = null;
  let totalLf = 0;
  let totalLh = 0;
  let hasPerLineData = false;

  const ensureRecord = (sfPath) => {
    const key = normalizeCoverageSourcePath(sfPath, repoRoot, modDir);
    if (!key) return null;
    if (!records.has(key)) {
      records.set(key, { daLines: new Map(), brdaLines: new Map(), lf: 0, lh: 0 });
    }
    return records.get(key);
  };

  for (const rawLine of String(raw).split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('SF:')) {
      current = ensureRecord(line.slice(3));
    } else if (line.startsWith('DA:') && current) {
      const parts = line.slice(3).split(',');
      const lineNo = parseInt(parts[0], 10);
      const hits = parseInt(parts[1], 10) || 0;
      if (Number.isFinite(lineNo) && lineNo > 0) {
        hasPerLineData = true;
        current.daLines.set(lineNo, (current.daLines.get(lineNo) || 0) + hits);
      }
    } else if (line.startsWith('BRDA:') && current) {
      const parts = line.slice(5).split(',');
      const lineNo = parseInt(parts[0], 10);
      const taken = parts[3] === '-' ? 0 : parseInt(parts[3], 10) || 0;
      if (Number.isFinite(lineNo) && lineNo > 0) {
        if (!current.brdaLines.has(lineNo)) current.brdaLines.set(lineNo, []);
        current.brdaLines.get(lineNo).push(taken);
      }
    } else if (line.startsWith('LF:')) {
      const lf = parseInt(line.slice(3), 10) || 0;
      totalLf += lf;
      if (current) current.lf += lf;
    } else if (line.startsWith('LH:')) {
      const lh = parseInt(line.slice(3), 10) || 0;
      totalLh += lh;
      if (current) current.lh += lh;
    } else if (line === 'end_of_record') {
      current = null;
    }
  }

  return { records, totalLf, totalLh, hasPerLineData };
}

function computeLcovDiffIntersection(records, repoRoot, mod) {
  if (!fileExists(path.resolve(repoRoot, '.git'))) {
    return { diffApplicable: false, diffLineCoverage: null, diffBranchCoverage: null, diffLinesCovered: 0, diffLinesTotal: 0 };
  }
  const allModified = getModifiedFiles(null, repoRoot);
  const modPrefix =
    mod?.path && mod.path !== '.' ? mod.path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '') : null;
  const scopedFiles = modPrefix
    ? allModified.filter((f) => f === modPrefix || f.startsWith(`${modPrefix}/`))
    : allModified;
  if (scopedFiles.length === 0) {
    return { diffApplicable: false, diffLineCoverage: null, diffBranchCoverage: null, diffLinesCovered: 0, diffLinesTotal: 0 };
  }

  const diffsByFile = getUnifiedDiffByFile(null, repoRoot, scopedFiles);
  let diffLinesTotal = 0;
  let diffLinesCovered = 0;
  let diffBranchesTotal = 0;
  let diffBranchesCovered = 0;

  for (const filePath of scopedFiles) {
    const rec = records.get(filePath);
    if (!rec || rec.daLines.size === 0) continue;
    const addedLines = extractAddedLinesFromDiff(diffsByFile.get(filePath) || '');
    for (const lineNo of addedLines) {
      if (!rec.daLines.has(lineNo)) continue;
      diffLinesTotal++;
      if ((rec.daLines.get(lineNo) || 0) > 0) diffLinesCovered++;
      const branches = rec.brdaLines.get(lineNo);
      if (branches && branches.length > 0) {
        for (const taken of branches) {
          diffBranchesTotal++;
          if (taken > 0) diffBranchesCovered++;
        }
      }
    }
  }

  if (diffLinesTotal === 0) {
    return { diffApplicable: false, diffLineCoverage: null, diffBranchCoverage: null, diffLinesCovered: 0, diffLinesTotal: 0 };
  }
  const diffLineCoverage = Number(((diffLinesCovered / diffLinesTotal) * 100).toFixed(2));
  const diffBranchCoverage =
    diffBranchesTotal > 0 ? Number(((diffBranchesCovered / diffBranchesTotal) * 100).toFixed(2)) : null;
  return { diffApplicable: true, diffLineCoverage, diffBranchCoverage, diffLinesCovered, diffLinesTotal };
}

function buildCoverageResult(file, pct, threshold, extra = {}) {
  const rounded = Number(pct.toFixed(2));
  return {
    found: true,
    file,
    lineCoverage: rounded,
    repoLineCoverage: rounded,
    diffLineCoverage: null,
    diffApplicable: false,
    branchCoverage: null,
    formatted: `${pct.toFixed(1)}%`,
    threshold,
    passed: threshold === null ? true : pct >= threshold,
    ...extra
  };
}

export function parseCoverageReport(repoRoot = '.', mod = null) {
  const { minCov: threshold } = resolveQualityThresholds(repoRoot, mod);
  const modDir = mod?.path && mod.path !== '.' ? path.resolve(repoRoot, mod.path) : path.resolve(repoRoot);

  const candidates = [
    mod?.commands?.coverageFile,
    'coverage/coverage-summary.json',
    'coverage/lcov.info',
    'target/site/jacoco/jacoco.csv',
    'build/reports/jacoco/test/jacocoTestReport.csv',
    'coverage.xml',
    'cobertura.xml',
    'coverage.out'
  ].filter(Boolean);

  for (const relPath of candidates) {
    const fullPath = path.resolve(modDir, relPath);
    if (!fileExists(fullPath)) continue;
    const raw = readFileSafe(fullPath);
    if (!raw) continue;

    if (relPath.endsWith('.json')) {
      try {
        const data = JSON.parse(raw);
        const linePct = Number(data.total?.lines?.pct ?? data.lines?.pct);
        const branchPct = Number(data.total?.branches?.pct ?? data.branches?.pct ?? linePct);
        if (!Number.isNaN(linePct)) {
          return buildCoverageResult(relPath, linePct, threshold, { branchCoverage: Number(branchPct.toFixed(2)) });
        }
      } catch {}
    }

    if (relPath.endsWith('lcov.info') || relPath.endsWith('.lcov')) {
      const { records, totalLf, totalLh, hasPerLineData } = parseLcovFileRecords(raw, repoRoot, modDir);
      let daTotal = 0;
      let daCovered = 0;
      if (totalLf === 0 && hasPerLineData) {
        for (const rec of records.values()) {
          for (const hits of rec.daLines.values()) {
            daTotal++;
            if (hits > 0) daCovered++;
          }
        }
      }
      const lf = totalLf > 0 ? totalLf : daTotal;
      const lh = totalLf > 0 ? totalLh : daCovered;
      if (lf > 0) {
        const repoPct = Number(((lh / lf) * 100).toFixed(2));
        const diffMetrics = hasPerLineData
          ? computeLcovDiffIntersection(records, repoRoot, mod)
          : { diffApplicable: false, diffLineCoverage: null, diffBranchCoverage: null, diffLinesCovered: 0, diffLinesTotal: 0 };
        const effectivePct = diffMetrics.diffApplicable ? diffMetrics.diffLineCoverage : repoPct;
        const passed = threshold === null ? true : effectivePct >= threshold;
        const reason =
          !passed && diffMetrics.diffApplicable
            ? `Diff line coverage ${effectivePct.toFixed(1)}% (${diffMetrics.diffLinesCovered}/${diffMetrics.diffLinesTotal} changed lines) < ${threshold}% (${relPath}; repo-wide ${repoPct.toFixed(1)}%)`
            : undefined;
        return buildCoverageResult(relPath, effectivePct, threshold, {
          lineCoverage: effectivePct,
          repoLineCoverage: repoPct,
          diffLineCoverage: diffMetrics.diffLineCoverage,
          diffApplicable: diffMetrics.diffApplicable,
          diffLinesCovered: diffMetrics.diffLinesCovered,
          diffLinesTotal: diffMetrics.diffLinesTotal,
          branchCoverage: diffMetrics.diffBranchCoverage,
          passed,
          ...(reason ? { reason } : {})
        });
      }
    }

    if (relPath.endsWith('.csv')) {
      const lines = raw.trim().split('\n');
      if (lines.length > 1) {
        const headers = lines[0].split(',').map((h) => h.trim());
        const missedIdx = headers.indexOf('LINE_MISSED');
        const coveredIdx = headers.indexOf('LINE_COVERED');
        if (missedIdx !== -1 && coveredIdx !== -1) {
          let missed = 0;
          let covered = 0;
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',');
            missed += parseInt(cols[missedIdx], 10) || 0;
            covered += parseInt(cols[coveredIdx], 10) || 0;
          }
          const total = missed + covered;
          if (total > 0) return buildCoverageResult(relPath, (covered / total) * 100, threshold);
        }
      }
    }

    if (relPath.endsWith('.xml')) {
      const match = raw.match(/line-rate=["']([0-9.]+)["']/);
      if (match) return buildCoverageResult(relPath, parseFloat(match[1]) * 100, threshold);
    }

    if (relPath.endsWith('coverage.out')) {
      let totalStmts = 0;
      let coveredStmts = 0;
      for (const line of raw.split('\n')) {
        if (!line || line.startsWith('mode:')) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          const stmts = parseInt(parts[1], 10) || 0;
          totalStmts += stmts;
          if ((parseInt(parts[2], 10) || 0) > 0) coveredStmts += stmts;
        }
      }
      if (totalStmts > 0) return buildCoverageResult(relPath, (coveredStmts / totalStmts) * 100, threshold);
    }
  }

  // Fail closed: no report means nothing was measured.
  return {
    found: false,
    file: null,
    lineCoverage: null,
    repoLineCoverage: null,
    diffLineCoverage: null,
    diffApplicable: false,
    branchCoverage: null,
    formatted: null,
    threshold,
    passed: false,
    reason: `No coverage report found (looked for: ${candidates.join(', ')}).`
  };
}

function isMutantExempted(exemptions, { id = null, file = null, mutator = null, line = null } = {}) {
  if (!Array.isArray(exemptions) || exemptions.length === 0) return false;
  const normFile = file ? String(file).replace(/\\/g, '/') : null;
  const fileLineKey = normFile && line !== null ? `${normFile}:${line}` : null;
  return exemptions.some((ex) => {
    const exId = ex?.mutantId ? String(ex.mutantId) : '';
    const exFile = ex?.file ? String(ex.file).replace(/\\/g, '/') : null;
    if (id && exId === String(id)) return true;
    if (fileLineKey && exId === fileLineKey) return true;
    if (exFile && normFile && (normFile === exFile || normFile.endsWith('/' + exFile))) {
      if (!exId) return true;
      if (line !== null && exId === String(line)) return true;
      if (mutator && exId === String(mutator)) return true;
    }
    return false;
  });
}

function buildMutationSuccessResult({
  tool,
  file,
  killed,
  total,
  exemptedCount = 0,
  explicitScore = null,
  threshold,
  searchedPaths,
  warnings = []
}) {
  const score =
    typeof explicitScore === 'number' && Number.isFinite(explicitScore) && exemptedCount === 0
      ? Number(explicitScore.toFixed(2))
      : total > 0
        ? Number(((killed / total) * 100).toFixed(2))
        : 100;
  return {
    found: true,
    tool,
    file,
    killed,
    total,
    mutationScore: score,
    formatted: `${score.toFixed(1)}%`,
    threshold,
    exemptedCount,
    passed: threshold === null ? true : score >= threshold,
    diagnostics: {
      status: 'OK',
      searchedPaths,
      warnings,
      errors: []
    }
  };
}

function countMutmutIdList(rawList) {
  let count = 0;
  for (const token of String(rawList || '').split(/[\s,]+/)) {
    const t = token.trim();
    if (!t) continue;
    const rangeMatch = t.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start < 100000) {
        count += end - start + 1;
      }
      continue;
    }
    if (/^\d+$/.test(t)) count += 1;
  }
  return count;
}

export function tryParseStrykerReport(modDir, relFile, exemptions, threshold, searchedPaths) {
  const absPath = path.resolve(modDir, relFile);
  if (!fileExists(absPath)) return null;
  let data;
  try {
    data = JSON.parse(readFileSafe(absPath) || '{}');
  } catch (err) {
    return {
      ok: false,
      error: { file: relFile, tool: 'stryker', errorType: 'UNSUPPORTED_OR_CORRUPT_REPORT', message: `Malformed JSON: ${err.message}` }
    };
  }
  if (!data || typeof data !== 'object' || (!data.files && typeof data.mutationScore !== 'number')) {
    return {
      ok: false,
      error: { file: relFile, tool: 'stryker', errorType: 'UNSUPPORTED_OR_CORRUPT_REPORT', message: 'Missing files map and mutationScore.' }
    };
  }
  let killed = 0;
  let total = 0;
  let exemptedCount = 0;
  for (const [filePath, fileObj] of Object.entries(data.files || {})) {
    for (const mutant of fileObj?.mutants || []) {
      if (mutant.status === 'Ignored' || mutant.status === 'CompileError') continue;
      if (
        isMutantExempted(exemptions, {
          id: mutant.id,
          file: filePath,
          mutator: mutant.mutatorName,
          line: mutant.location?.start?.line ?? null
        })
      ) {
        exemptedCount++;
        continue;
      }
      total++;
      if (mutant.status === 'Killed' || mutant.status === 'Timeout') killed++;
    }
  }
  if (total === 0 && exemptedCount === 0 && typeof data.mutationScore === 'number') {
    return {
      ok: true,
      result: buildMutationSuccessResult({
        tool: 'stryker',
        file: relFile,
        killed: 0,
        total: 0,
        exemptedCount: 0,
        explicitScore: data.mutationScore,
        threshold,
        searchedPaths
      })
    };
  }
  if (total > 0 || exemptedCount > 0) {
    return {
      ok: true,
      result: buildMutationSuccessResult({
        tool: 'stryker',
        file: relFile,
        killed,
        total,
        exemptedCount,
        explicitScore: typeof data.mutationScore === 'number' && exemptedCount === 0 ? data.mutationScore : null,
        threshold,
        searchedPaths
      })
    };
  }
  return {
    ok: false,
    error: {
      file: relFile,
      tool: 'stryker',
      errorType: 'EMPTY_REPORT',
      zeroMutants: true,
      message: 'Stryker report contains zero evaluable mutants.'
    }
  };
}

function mutationError(file, tool, errorType, message) {
  return { ok: false, error: { file, tool, errorType, message } };
}

function readJsonMutationFile(modDir, relFile, tool, invalidMessage) {
  const absPath = path.resolve(modDir, relFile);
  if (!fileExists(absPath)) return { status: 'missing' };
  let data;
  try {
    data = JSON.parse(readFileSafe(absPath) || 'null');
  } catch (err) {
    return { status: 'error', result: mutationError(relFile, tool, 'UNSUPPORTED_OR_CORRUPT_REPORT', `Malformed JSON: ${err.message}`) };
  }
  if (!data || typeof data !== 'object') {
    return { status: 'error', result: mutationError(relFile, tool, 'UNSUPPORTED_OR_CORRUPT_REPORT', invalidMessage) };
  }
  return { status: 'ok', data };
}

function finalizeMutationParse({ tool, relFile, killed, total, exemptedCount, threshold, searchedPaths, errorType = 'EMPTY_REPORT', emptyMessage }) {
  if (total > 0 || exemptedCount > 0) {
    return { ok: true, result: buildMutationSuccessResult({ tool, file: relFile, killed, total, exemptedCount, threshold, searchedPaths }) };
  }
  return mutationError(relFile, tool, errorType, emptyMessage);
}

function tryParsePitestReport(modDir, relFile, exemptions, threshold, searchedPaths) {
  const absPath = path.resolve(modDir, relFile);
  if (!fileExists(absPath)) return null;
  const raw = readFileSafe(absPath) || '';
  const blockMatches = raw.match(/<mutation\s+[^>]*detected=['"](true|false)['"][\s\S]*?<\/mutation>/g) || [];
  const attrMatches = raw.match(/<mutation\s+[^>]*detected=['"](true|false)['"][^>]*>/g) || [];
  const entries = blockMatches.length > 0 ? blockMatches : attrMatches;
  if (entries.length === 0) {
    const isEmptyXml = /<mutations\b/i.test(raw);
    return mutationError(
      relFile,
      'pitest',
      isEmptyXml ? 'EMPTY_REPORT' : 'UNSUPPORTED_OR_CORRUPT_REPORT',
      isEmptyXml ? 'PITest mutations.xml contains zero mutations.' : 'Malformed or unsupported PITest XML report.'
    );
  }
  let total = 0;
  let killed = 0;
  let exemptedCount = 0;
  for (const m of entries) {
    const srcMatch = m.match(/<sourceFile>([^<]+)<\/sourceFile>/);
    const lineMatch = m.match(/<lineNumber>(\d+)<\/lineNumber>/);
    const mutMatch = m.match(/<mutator>([^<]+)<\/mutator>/);
    const mut = mutMatch ? mutMatch[1] : null;
    if (isMutantExempted(exemptions, { id: mut, file: srcMatch ? srcMatch[1] : null, mutator: mut, line: lineMatch ? Number(lineMatch[1]) : null })) {
      exemptedCount++;
      continue;
    }
    total++;
    if (/detected=['"]true['"]/.test(m)) killed++;
  }
  return { ok: true, result: buildMutationSuccessResult({ tool: 'pitest', file: relFile, killed, total, exemptedCount, threshold, searchedPaths }) };
}

function tryParseCargoMutantsReport(modDir, relFile, exemptions, threshold, searchedPaths) {
  const loaded = readJsonMutationFile(modDir, relFile, 'cargo-mutants', 'Invalid cargo-mutants outcomes object.');
  if (loaded.status === 'missing') return null;
  if (loaded.status === 'error') return loaded.result;
  const data = loaded.data;
  let killed = 0;
  let total = 0;
  let exemptedCount = 0;
  for (const entry of Array.isArray(data.outcomes) ? data.outcomes : []) {
    const summary = String(entry?.summary || entry?.outcome || '').trim().toLowerCase();
    if (!summary || summary === 'unviable' || summary === 'skipped' || summary === 'buildfailure') continue;
    const meta = entry?.scenario?.Mutant || entry?.mutant || {};
    const ctx = { id: entry?.id || meta.replacement || null, file: meta.file || entry?.file || null, mutator: meta.genre || entry?.mutator || null, line: meta.span?.start?.line ?? entry?.line ?? null };
    if (isMutantExempted(exemptions, ctx)) {
      exemptedCount++;
      continue;
    }
    if (summary === 'caughtmutant' || summary === 'caught' || summary === 'killed' || summary === 'timeout') {
      killed++;
      total++;
    } else if (summary === 'missedmutant' || summary === 'missed' || summary === 'survived') {
      total++;
    }
  }
  if (total === 0 && exemptedCount === 0 && (typeof data.caught === 'number' || typeof data.missed === 'number' || typeof data.timeout === 'number')) {
    killed = (Number(data.caught) || 0) + (Number(data.timeout) || 0);
    total = killed + (Number(data.missed) || 0);
  }
  return finalizeMutationParse({ tool: 'cargo-mutants', relFile, killed, total, exemptedCount, threshold, searchedPaths, emptyMessage: 'cargo-mutants outcomes.json has zero viable mutants.' });
}

function tryParseMutmutJsonReport(modDir, relFile, exemptions, threshold, searchedPaths) {
  const loaded = readJsonMutationFile(modDir, relFile, 'mutmut', 'Invalid mutmut JSON report.');
  if (loaded.status === 'missing') return null;
  if (loaded.status === 'error') return loaded.result;
  const data = loaded.data;
  const items = Array.isArray(data) ? data : Array.isArray(data.mutants) ? data.mutants : Array.isArray(data.results) ? data.results : null;
  let killed = 0;
  let total = 0;
  let exemptedCount = 0;
  if (items) {
    for (const m of items) {
      const status = String(m?.status || '').trim().toLowerCase();
      if (!status || status === 'skipped' || status === 'incompetent' || status === 'typecheck') continue;
      if (isMutantExempted(exemptions, { id: m?.id ?? null, file: m?.file || m?.filename || null, mutator: m?.mutator || m?.mutatorName || null, line: m?.line ?? m?.lineno ?? null })) {
        exemptedCount++;
        continue;
      }
      if (status === 'killed' || status === 'timeout') {
        killed++;
        total++;
      } else if (status === 'survived' || status === 'suspicious' || status === 'no_tests' || status === 'no tests' || status === 'untested') {
        total++;
      }
    }
  } else if (typeof data.killed === 'number' || typeof data.survived === 'number') {
    killed = (Number(data.killed) || 0) + (Number(data.timeout) || 0);
    total = killed + (Number(data.survived) || 0) + (Number(data.suspicious) || 0) + (Number(data.no_tests) || 0) + (Number(data.untested) || 0);
  }
  return finalizeMutationParse({ tool: 'mutmut', relFile, killed, total, exemptedCount, threshold, searchedPaths, emptyMessage: 'mutmut JSON report contains zero evaluable mutants.' });
}

function tryParseMutmutTextReport(modDir, relFile, exemptions, threshold, searchedPaths) {
  const absPath = path.resolve(modDir, relFile);
  if (!fileExists(absPath)) return null;
  const raw = readFileSafe(absPath) || '';
  if (!raw.trim()) return mutationError(relFile, 'mutmut', 'EMPTY_REPORT', 'mutmut text report is empty.');
  let killed = 0;
  let total = 0;
  let exemptedCount = 0;
  let currentFile = null;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const hdr = trimmed.match(/^----\s+(.+?)\s+\(\d+\)\s+----$/);
    if (hdr) {
      currentFile = hdr[1].trim();
      continue;
    }
    const kv = trimmed.match(/^([^\s:]+):\s*(killed|survived|timeout|suspicious|no tests|no_tests|untested|skipped|incompetent)\b/i);
    if (kv) {
      const status = kv[2].toLowerCase();
      if (status === 'skipped' || status === 'incompetent') continue;
      const inferredFile = currentFile || (kv[1].includes('.') ? kv[1].split('.x_')[0].replace(/\./g, '/') + '.py' : null);
      if (isMutantExempted(exemptions, { id: kv[1], file: inferredFile })) {
        exemptedCount++;
        continue;
      }
      if (status === 'killed' || status === 'timeout') killed++;
      total++;
      continue;
    }
    if (trimmed.startsWith('🎉') || trimmed.startsWith('⏰') || /^(?:Killed|Timeout)\s*:/i.test(trimmed)) {
      const payload = trimmed.replace(/^(?:🎉|⏰|Killed:|Timeout:)\s*/i, '');
      const n = /^\d+$/.test(payload) && /^(?:Killed|Timeout)\s*:/i.test(trimmed) ? Number(payload) : countMutmutIdList(payload);
      killed += n;
      total += n;
    } else if (trimmed.startsWith('🙁') || trimmed.startsWith('🤔') || /^(?:Survived|Suspicious|Untested|No tests)\s*:/i.test(trimmed)) {
      const payload = trimmed.replace(/^(?:🙁|🤔|Survived:|Suspicious:|Untested:|No tests:)\s*/i, '');
      total += /^\d+$/.test(payload) && /^(?:Survived|Suspicious|Untested|No tests)\s*:/i.test(trimmed) ? Number(payload) : countMutmutIdList(payload);
    }
  }
  return finalizeMutationParse({ tool: 'mutmut', relFile, killed, total, exemptedCount, threshold, searchedPaths, errorType: 'UNSUPPORTED_OR_CORRUPT_REPORT', emptyMessage: 'Unrecognized mutmut text output.' });
}

function tryParseGoMutestingJsonReport(modDir, relFile, exemptions, threshold, searchedPaths) {
  const loaded = readJsonMutationFile(modDir, relFile, 'go-mutesting', 'Invalid go-mutesting JSON object.');
  if (loaded.status === 'missing') return null;
  if (loaded.status === 'error') return loaded.result;
  const data = loaded.data;
  let killed = 0;
  let total = 0;
  let exemptedCount = 0;
  if (Array.isArray(data.mutants)) {
    for (const m of data.mutants) {
      const status = String(m?.status || '').trim().toUpperCase();
      if (!status || status === 'SKIP' || status === 'SKIPPED' || status === 'DUPLICATED') continue;
      if (isMutantExempted(exemptions, { id: m?.id ?? null, file: m?.file || null, mutator: m?.mutator || null, line: m?.line ?? null })) {
        exemptedCount++;
        continue;
      }
      if (status === 'PASS' || status === 'PASSED' || status === 'KILLED') {
        killed++;
        total++;
      } else if (status === 'FAIL' || status === 'FAILED' || status === 'SURVIVED') {
        total++;
      }
    }
  } else if (typeof data.passed === 'number' || typeof data.failed === 'number') {
    killed = Number(data.passed) || 0;
    total = killed + (Number(data.failed) || 0);
  }
  return finalizeMutationParse({ tool: 'go-mutesting', relFile, killed, total, exemptedCount, threshold, searchedPaths, emptyMessage: 'go-mutesting JSON contains zero evaluable mutants.' });
}

function tryParseGoMutestingTextReport(modDir, relFile, exemptions, threshold, searchedPaths) {
  const absPath = path.resolve(modDir, relFile);
  if (!fileExists(absPath)) return null;
  const raw = readFileSafe(absPath) || '';
  if (!raw.trim()) return mutationError(relFile, 'go-mutesting', 'EMPTY_REPORT', 'go-mutesting text report is empty.');
  let killed = 0;
  let total = 0;
  let exemptedCount = 0;
  for (const line of raw.split('\n')) {
    const item = line.trim().match(/^(PASS|FAIL|SKIP)\s+"([^"]+)"(?:\s+with\s+checksum\s+([a-f0-9]+))?/i);
    if (!item || item[1].toUpperCase() === 'SKIP') continue;
    if (isMutantExempted(exemptions, { id: item[3] || null, file: item[2] })) {
      exemptedCount++;
      continue;
    }
    total++;
    if (item[1].toUpperCase() === 'PASS') killed++;
  }
  if (total === 0 && exemptedCount === 0) {
    const summaryMatch = raw.match(/The mutation score is\s+[\d.]+\s+\((\d+)\s+passed,\s*(\d+)\s+failed\b/i);
    if (summaryMatch) {
      killed = Number(summaryMatch[1]) || 0;
      total = killed + (Number(summaryMatch[2]) || 0);
    }
  }
  if (total > 0 || exemptedCount > 0) {
    return {
      ok: true,
      result: buildMutationSuccessResult({ tool: 'go-mutesting', file: relFile, killed, total, exemptedCount, threshold, searchedPaths })
    };
  }
  return {
    ok: false,
    error: { file: relFile, tool: 'go-mutesting', errorType: 'UNSUPPORTED_OR_CORRUPT_REPORT', message: 'Unrecognized go-mutesting text report.' }
  };
}

export function parseMutationReport(repoRoot = '.', mod = null) {
  const { minMut: threshold } = resolveQualityThresholds(repoRoot, mod);
  const modDir = mod?.path && mod.path !== '.' ? path.resolve(repoRoot, mod.path) : path.resolve(repoRoot);
  const exemptions = getExemptions(repoRoot);

  const candidates = [
    { file: 'reports/mutation/mutation.json', parser: tryParseStrykerReport },
    { file: 'target/pit-reports/mutations.xml', parser: tryParsePitestReport },
    { file: 'mutants.out/outcomes.json', parser: tryParseCargoMutantsReport },
    { file: 'reports/mutation/outcomes.json', parser: tryParseCargoMutantsReport },
    { file: 'outcomes.json', parser: tryParseCargoMutantsReport },
    { file: 'reports/mutation/mutmut.json', parser: tryParseMutmutJsonReport },
    { file: 'mutmut-results.json', parser: tryParseMutmutJsonReport },
    { file: 'mutmut.json', parser: tryParseMutmutJsonReport },
    { file: 'reports/mutation/mutmut-results.txt', parser: tryParseMutmutTextReport },
    { file: 'mutmut-results.txt', parser: tryParseMutmutTextReport },
    { file: 'reports/mutation/go-mutesting.json', parser: tryParseGoMutestingJsonReport },
    { file: 'go-mutesting.json', parser: tryParseGoMutestingJsonReport },
    { file: 'reports/mutation/go-mutesting.txt', parser: tryParseGoMutestingTextReport },
    { file: 'go-mutesting.txt', parser: tryParseGoMutestingTextReport }
  ];
  const searchedPaths = candidates.map((c) => c.file);
  const errors = [];

  for (const candidate of candidates) {
    const parsed = candidate.parser(modDir, candidate.file, exemptions, threshold, searchedPaths);
    if (!parsed) continue;
    if (parsed.ok) return parsed.result;
    if (parsed.error) errors.push(parsed.error);
  }

  // Fail closed: no valid report means nothing was measured.
  const hasCorruptOrUnsupported = errors.some((e) => e.errorType === 'UNSUPPORTED_OR_CORRUPT_REPORT');
  const status = errors.length === 0 ? 'MISSING_REPORT' : hasCorruptOrUnsupported ? 'UNSUPPORTED_OR_CORRUPT_REPORT' : 'EMPTY_REPORT';
  const reason =
    errors.length > 0
      ? `Mutation report could not be parsed cleanly (${errors.map((e) => `${e.file}: ${e.message}`).join('; ')}).`
      : `No mutation report found (looked for: ${searchedPaths.join(', ')}).`;

  return {
    found: false,
    tool: errors[0]?.tool || null,
    file: errors[0]?.file || null,
    mutationScore: null,
    formatted: null,
    threshold,
    passed: false,
    reason,
    diagnostics: {
      status,
      searchedPaths,
      errors
    }
  };
}

function normalizeRelPosix(p = '') {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}

function compileSimpleGlob(pattern = '') {
  let raw = normalizeRelPosix(pattern).replace(/^!+/, '');
  const idx = raw.lastIndexOf(':');
  if (idx > 0 && /^\d+(?::\d+)?-\d+(?::\d+)?$/.test(raw.slice(idx + 1))) {
    raw = raw.slice(0, idx);
  }
  let re = '^';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '*') {
      if (raw[i + 1] === '*') {
        if (raw[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else if (ch === '{') {
      const close = raw.indexOf('}', i);
      if (close !== -1) {
        const opts = raw
          .slice(i + 1, close)
          .split(',')
          .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        re += `(?:${opts.join('|')})`;
        i = close;
      } else {
        re += '\\{';
      }
    } else if ('.+^$|()[]\\'.includes(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }
  re += '$';
  return new RegExp(re);
}

function isTestFilePath(relFile = '') {
  const n = normalizeRelPosix(relFile);
  return (
    /(?:^|\/)(?:tests?|__tests__|specs?)\//i.test(n) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(n) ||
    /_test\.go$/i.test(n) ||
    /(?:^|\/)test_[^/]+\.py$/i.test(n) ||
    /_test\.py$/i.test(n) ||
    /Tests?\.(?:java|kt|scala)$/i.test(n)
  );
}

function isNonMutatedDocOrConfig(relFile = '') {
  const n = normalizeRelPosix(relFile);
  if (/\.(?:md|mdx|txt|rst|adoc|png|jpe?g|gif|svg|ico|webp|pdf|csv|tsv)$/i.test(n)) return true;
  if (/^(?:docs|wiki|\.github|\.agent\/(?:skills|schemas|rules|workbench|workflows)|coverage|reports|\.stryker-tmp)\//i.test(n)) {
    return true;
  }
  const base = path.posix.basename(n);
  return /^(?:stryker\.conf(?:ig)?\.|package(?:-lock)?\.json$|tsconfig.*\.json$|\.gitignore$|\.gitattributes$|\.editorconfig$|\.prettier.*|\.eslint.*|yarn\.lock$|pnpm-lock\.yaml$|Cargo\.lock$|go\.sum$)/i.test(
    base
  );
}

function testFileStem(relFile = '') {
  const base = path.posix.basename(normalizeRelPosix(relFile));
  return base
    .replace(/\.(?:test|spec)\.[cm]?[jt]sx?$/i, '')
    .replace(/_test\.(?:go|py)$/i, '')
    .replace(/^test_/, '')
    .replace(/\.(?:py|rs|go|java|kt|[cm]?[jt]sx?)$/i, '');
}

function loadStrykerMutateConfig(modCwd) {
  const explicitFiles = [];
  const positiveMatchers = [];
  const negativeMatchers = [];
  for (const cfgName of ['stryker.config.json', 'stryker.conf.json']) {
    const abs = path.join(modCwd, cfgName);
    if (!fileExists(abs)) continue;
    try {
      const parsed = JSON.parse(readFileSafe(abs) || '{}');
      const entries = Array.isArray(parsed.mutate) ? parsed.mutate : [];
      for (const rawEntry of entries) {
        if (typeof rawEntry !== 'string' || !rawEntry.trim()) continue;
        const entry = rawEntry.trim();
        const isNeg = entry.startsWith('!');
        const pattern = normalizeRelPosix(isNeg ? entry.slice(1) : entry).replace(/:\d+(?::\d+)?-\d+(?::\d+)?$/, '');
        if (!pattern) continue;
        const matcher = compileSimpleGlob(pattern);
        if (isNeg) {
          negativeMatchers.push(matcher);
        } else {
          positiveMatchers.push(matcher);
          if (!/[*?{}\[\]]/.test(pattern)) explicitFiles.push(pattern);
        }
      }
      break;
    } catch {}
  }
  const matchesMutate = (relFile) => {
    const n = normalizeRelPosix(relFile);
    if (!n || isTestFilePath(n) || isNonMutatedDocOrConfig(n)) return false;
    if (negativeMatchers.some((re) => re.test(n))) return false;
    if (positiveMatchers.length > 0) return positiveMatchers.some((re) => re.test(n));
    return /\.[cm]?[jt]sx?$/i.test(n);
  };
  return { explicitFiles, matchesMutate };
}

function collectCandidateSourcesInDir(modCwd, matcherFn, explicitFiles = []) {
  const found = new Set(explicitFiles.filter((f) => fileExists(path.join(modCwd, f)) && matcherFn(f)));
  const searchRoots = ['.agent/scripts', 'src', 'lib', 'app', 'pkg'];
  const walk = (absDir, depth) => {
    if (depth > 5 || !fs.existsSync(absDir)) return;
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.stryker-tmp') continue;
      const absChild = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(absChild, depth + 1);
      } else {
        const rel = normalizeRelPosix(path.relative(modCwd, absChild));
        if (matcherFn(rel)) found.add(rel);
      }
    }
  };
  for (const root of searchRoots) {
    walk(path.join(modCwd, root), 0);
  }
  return Array.from(found);
}

function pairTestFilesToSources(changedTests, modCwd, matcherFn, explicitFiles = []) {
  if (changedTests.length === 0) return [];
  const candidates = collectCandidateSourcesInDir(modCwd, matcherFn, explicitFiles);
  const byStem = new Map();
  for (const c of candidates) {
    const stem = path.posix.basename(c).replace(/\.[^.]+$/, '');
    if (!byStem.has(stem)) byStem.set(stem, []);
    byStem.get(stem).push(c);
  }
  const paired = new Set();
  for (const tFile of changedTests) {
    const stem = testFileStem(tFile);
    if (stem && byStem.has(stem)) {
      for (const c of byStem.get(stem)) paired.add(c);
    }
    const absTest = path.join(modCwd, tFile);
    if (fileExists(absTest)) {
      const content = readFileSafe(absTest) || '';
      const importRe = /(?:from|import|require)\s*(?:\(\s*)?['"](\.[^'"]+)['"]/g;
      let m;
      while ((m = importRe.exec(content)) !== null) {
        const resolvedAbs = path.resolve(path.dirname(absTest), m[1]);
        const rel = normalizeRelPosix(path.relative(modCwd, resolvedAbs));
        if (matcherFn(rel) && fileExists(resolvedAbs)) paired.add(rel);
      }
    }
  }
  return Array.from(paired).sort();
}

function detectMutationTool(baseCmd = '') {
  const { file, args } = parseCommandArgv(baseCmd);
  const bin = path.basename(file || '').toLowerCase();
  const all = [bin, ...args.map((a) => String(a).toLowerCase())];
  if (bin === 'stryker' || ((bin === 'npx' || bin === 'pnpx' || bin === 'bunx') && args.some((a) => String(a).toLowerCase() === 'stryker'))) {
    return 'stryker';
  }
  if (bin === 'cargo-mutants' || (bin === 'cargo' && args.includes('mutants'))) return 'cargo-mutants';
  if (bin === 'go-mutesting' || all.some((t) => t.endsWith('go-mutesting'))) return 'go-mutesting';
  if (bin === 'mutmut') return 'mutmut';
  if (all.some((t) => t.includes('pitest'))) return 'pitest';
  return 'generic';
}

function stripFlagsWithValues(tokens, valueFlags = [], boolFlags = []) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (valueFlags.some((f) => tok === f)) {
      i += 1;
      continue;
    }
    if (valueFlags.some((f) => f.startsWith('--') && tok.startsWith(`${f}=`))) continue;
    if (boolFlags.includes(tok)) continue;
    out.push(tok);
  }
  return out;
}

function formatCommandTokens(tokens) {
  return tokens
    .map((t) => (/[\s"'$`\\]/.test(t) ? `"${String(t).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : t))
    .join(' ');
}

function lookupDiffText(diffMap, modRelFile, repoRelFile) {
  if (!diffMap) return '';
  if (diffMap instanceof Map) {
    return diffMap.get(modRelFile) ?? diffMap.get(repoRelFile) ?? '';
  }
  if (typeof diffMap === 'object') {
    return diffMap[modRelFile] ?? diffMap[repoRelFile] ?? '';
  }
  return '';
}

export function extractChangedHunkRanges(diffText = '', { maxGapLines = 5 } = {}) {
  const text = String(diffText || '');
  if (!text || /Binary files .* differ/i.test(text)) return [];
  const raw = [];
  const hunkRe = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
  let match;
  while ((match = hunkRe.exec(text)) !== null) {
    const startRaw = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    const start = Math.max(1, startRaw);
    const end = count === 0 ? start : start + count - 1;
    raw.push({ start, end });
  }
  if (raw.length === 0) {
    if (/^\+\+\+ b\//m.test(text)) {
      const addedCount = text
        .split('\n')
        .filter((line) => line.startsWith('+') && !line.startsWith('+++ '))
        .length;
      if (addedCount > 0) return [{ start: 1, end: addedCount }];
    }
    return [];
  }
  raw.sort((a, b) => a.start - b.start || a.end - b.end);
  const gap = Math.max(0, Number(maxGapLines) || 0);
  const merged = [{ ...raw[0] }];
  for (let i = 1; i < raw.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = raw[i];
    if (curr.start <= prev.end + 1 + gap) {
      prev.end = Math.max(prev.end, curr.end);
    } else {
      merged.push({ ...curr });
    }
  }
  return merged;
}

const planResult = (overrides = {}) => ({
  command: null,
  commandArgv: null,
  skip: false,
  reason: null,
  diffScoped: false,
  full: false,
  tool: null,
  targets: [],
  matchedSourceFiles: [],
  pairedTestFiles: [],
  warnings: [],
  ...overrides
});

const cmdPlan = (tokens, overrides = {}) => planResult({ command: formatCommandTokens(tokens), commandArgv: tokens, ...overrides });
const tryParseArgv = (cmd) => { try { const p = parseCommandArgv(cmd); return [p.file, ...p.args]; } catch { return null; } };

const skipNoSources = (tool, pairedTestFiles = []) =>
  planResult({ skip: true, reason: 'diff-no-mutated-sources', diffScoped: true, tool, pairedTestFiles });

const resolveDiffLookup = (diffByFile, baseBranch, repoRoot, files, repoRelByModRel) =>
  diffByFile !== null
    ? diffByFile
    : files.length > 0
      ? getUnifiedDiffByFile(baseBranch, repoRoot, files.map((f) => repoRelByModRel.get(f) || f))
      : new Map();

export function buildMutationExecutionPlan({
  repoRoot = '.',
  mod = null,
  modifiedFiles = null,
  diffByFile = null,
  baseBranch = null,
  full = false,
  noCache = false
} = {}) {
  const baseCmd = String(mod?.commands?.mutation || '').trim();
  if (!baseCmd) return planResult({ reason: 'no-command-configured', full: Boolean(full) });
  const tool = detectMutationTool(baseCmd);
  const fallbackArgv = tryParseArgv(baseCmd);
  if (full) return planResult({ command: baseCmd, commandArgv: fallbackArgv, reason: 'full-mode', full: true, tool });
  if (tool === 'generic') return planResult({ command: baseCmd, commandArgv: fallbackArgv, reason: 'custom-command-unscoped', tool });

  const absRepo = path.resolve(repoRoot);
  const modCwd = mod?.path && mod.path !== '.' ? path.resolve(repoRoot, mod.path) : absRepo;
  const modPrefix = normalizeRelPosix(path.relative(absRepo, modCwd));
  const rawFiles = Array.isArray(modifiedFiles) ? modifiedFiles : getModifiedFiles(baseBranch, repoRoot);

  const scopedPairs = [];
  for (const rawFile of rawFiles) {
    const repoRel = normalizeRelPosix(rawFile);
    if (!repoRel) continue;
    if (!modPrefix) scopedPairs.push({ modRel: repoRel, repoRel });
    else if (repoRel === modPrefix || repoRel.startsWith(`${modPrefix}/`)) {
      scopedPairs.push({ modRel: repoRel.slice(modPrefix.length + 1), repoRel });
    }
  }
  if (scopedPairs.length === 0) return planResult({ command: baseCmd, commandArgv: fallbackArgv, reason: 'no-diff-files', tool });

  const baseTokens = fallbackArgv || (() => { const p = parseCommandArgv(baseCmd); return [p.file, ...p.args]; })();
  const modRelFiles = scopedPairs.map((p) => p.modRel);
  const repoRelByModRel = new Map(scopedPairs.map((p) => [p.modRel, p.repoRel]));

  if (tool === 'stryker') {
    const { explicitFiles, matchesMutate } = loadStrykerMutateConfig(modCwd);
    const directSources = modRelFiles.filter((f) => matchesMutate(f));
    const directSet = new Set(directSources);
    const changedTests = modRelFiles.filter((f) => isTestFilePath(f));
    const pairedSources = pairTestFilesToSources(changedTests, modCwd, matchesMutate, explicitFiles).filter((f) => !directSet.has(f));
    const allSources = [...directSources, ...pairedSources];
    if (allSources.length === 0) return skipNoSources(tool, changedTests);

    const diffMap = resolveDiffLookup(diffByFile, baseBranch, repoRoot, directSources, repoRelByModRel);
    const targets = [];
    for (const src of directSources) {
      const ranges = extractChangedHunkRanges(lookupDiffText(diffMap, src, repoRelByModRel.get(src) || src));
      if (ranges.length > 0 && ranges.length <= 25) {
        for (const r of ranges) targets.push(`${src}:${r.start}-${r.end}`);
      } else {
        targets.push(src);
      }
    }
    targets.push(...pairedSources);

    const cleaned = stripFlagsWithValues(baseTokens, ['-m', '--mutate', '--incrementalFile'], ['--force', '--allowEmpty']);
    const scopedTokens = [
      ...cleaned,
      '-m',
      targets.join(','),
      '--incrementalFile',
      'reports/stryker-diff-incremental.json',
      ...(noCache ? ['--force'] : []),
      '--allowEmpty'
    ];
    return cmdPlan(scopedTokens, { diffScoped: true, tool, targets, matchedSourceFiles: allSources, pairedTestFiles: changedTests });
  }

  if (tool === 'cargo-mutants') {
    const rustSources = modRelFiles.filter((f) => /\.rs$/i.test(f) && !isNonMutatedDocOrConfig(f));
    if (rustSources.length === 0) return skipNoSources(tool);
    const diffMap = resolveDiffLookup(diffByFile, baseBranch, repoRoot, rustSources, repoRelByModRel);
    const chunks = rustSources.map((f) => lookupDiffText(diffMap, f, repoRelByModRel.get(f) || f)).filter(Boolean);
    const cleaned = stripFlagsWithValues(baseTokens, ['--in-diff', '-f', '--file']);
    if (chunks.length > 0) {
      const relPatch = '.agent/.cache/mutation-diff.patch';
      const absPatch = path.join(modCwd, relPatch);
      fs.mkdirSync(path.dirname(absPatch), { recursive: true });
      fs.writeFileSync(absPatch, `${chunks.join('\n').trimEnd()}\n`, 'utf8');
      return cmdPlan([...cleaned, '--in-diff', relPatch], { diffScoped: true, tool, targets: rustSources, matchedSourceFiles: rustSources });
    }
    return cmdPlan([...cleaned, '-f', rustSources.join(',')], { diffScoped: true, tool, targets: rustSources, matchedSourceFiles: rustSources });
  }

  if (tool === 'go-mutesting') {
    const goFiles = modRelFiles.filter((f) => /\.go$/i.test(f) && !isNonMutatedDocOrConfig(f));
    if (goFiles.length === 0) return skipNoSources(tool);
    const pkgs = Array.from(new Set(goFiles.map((f) => (path.posix.dirname(f) === '.' ? '.' : `./${path.posix.dirname(f)}`))));
    const filtered = baseTokens.filter((t) => t !== './...');
    return cmdPlan([...filtered, ...pkgs], {
      diffScoped: true,
      tool,
      targets: pkgs,
      matchedSourceFiles: goFiles.filter((f) => !isTestFilePath(f)),
      pairedTestFiles: goFiles.filter((f) => isTestFilePath(f))
    });
  }

  if (tool === 'mutmut') {
    const pySources = modRelFiles.filter((f) => /\.py$/i.test(f) && !isTestFilePath(f) && !isNonMutatedDocOrConfig(f));
    const pyTests = modRelFiles.filter((f) => /\.py$/i.test(f) && isTestFilePath(f));
    const pairedPy = pairTestFilesToSources(pyTests, modCwd, (f) => /\.py$/i.test(f) && !isTestFilePath(f) && !isNonMutatedDocOrConfig(f)).filter(
      (f) => !pySources.includes(f)
    );
    const targets = [...pySources, ...pairedPy];
    if (targets.length === 0) return skipNoSources(tool, pyTests);
    const cleaned = stripFlagsWithValues(baseTokens, ['--paths-to-mutate']);
    return cmdPlan([...cleaned, '--paths-to-mutate', targets.join(',')], {
      diffScoped: true,
      tool,
      targets,
      matchedSourceFiles: targets,
      pairedTestFiles: pyTests
    });
  }

  // Pitest / JVM
  const jvmSources = modRelFiles.filter((f) => /\.(?:java|kt|scala)$/i.test(f) && !isTestFilePath(f) && !isNonMutatedDocOrConfig(f));
  if (jvmSources.length === 0) return skipNoSources(tool);
  const classGlobs = jvmSources
    .map((f) => f.match(/src\/main\/(?:java|kotlin|scala)\/(.+)\.[^.]+$/)?.[1])
    .filter(Boolean)
    .map((cls) => `${cls.replace(/\//g, '.')}*`);
  if (classGlobs.length > 0 && !baseTokens.some((t) => t.startsWith('-DtargetClasses='))) {
    return cmdPlan([...baseTokens, `-DtargetClasses=${classGlobs.join(',')}`], { diffScoped: true, tool, targets: classGlobs, matchedSourceFiles: jvmSources });
  }
  return cmdPlan(baseTokens, { tool, targets: jvmSources, matchedSourceFiles: jvmSources });
}

function prepareFlakeExecution({ runs = 5, target = null, repoRoot = '.' } = {}) {
  const iterationCount = Math.max(2, Math.min(50, Number(runs) || 5));
  const diffFiles = getModifiedFiles(null, repoRoot);
  const testFiles = target ? [target] : findAffectedTests(diffFiles, repoRoot);
  const flakeEnv = { ...process.env };
  delete flakeEnv.NODE_TEST_CONTEXT;
  return { iterationCount, testFiles, flakeEnv };
}

function buildFlakeSummary(results = []) {
  let detectedFlakes = 0;
  let failedTestFiles = 0;
  for (const r of results) {
    if (r.isFlaky) detectedFlakes++;
    if (r.failed > 0) failedTestFiles++;
  }
  return {
    success: true,
    flaky: detectedFlakes > 0,
    passed: detectedFlakes === 0 && failedTestFiles === 0,
    totalTested: results.length,
    flakyCount: detectedFlakes,
    failedTestFiles,
    results
  };
}

const FLAKE_TIMEOUT_MS = 120_000;
const normalizeFlakeConcurrency = (concurrency, fallback = 1) => Math.max(1, Math.min(16, Number(concurrency) || fallback));

function spawnFlakeIterationAsync(file, args, options) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { ...options, stdio: 'ignore', timeout: FLAKE_TIMEOUT_MS });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

const FLAKE_WORKER_SCRIPT = [
  "import fs from 'node:fs';",
  "import { spawn } from 'node:child_process';",
  "const payload = JSON.parse(fs.readFileSync(0, 'utf8'));",
  'const tasks = payload.tasks || [];',
  'const concurrency = Math.max(1, Math.min(payload.concurrency || 4, tasks.length || 1));',
  'const out = new Array(tasks.length);',
  'let idx = 0;',
  'const runOne = (t) => new Promise((res) => {',
  `  const ch = spawn(t.file, t.args, { cwd: payload.cwd, stdio: 'ignore', timeout: ${FLAKE_TIMEOUT_MS}, env: process.env });`,
  "  ch.on('error', () => res(false));",
  "  ch.on('close', (c) => res(c === 0));",
  '});',
  'async function worker() { while (idx < tasks.length) { const i = idx++; out[i] = await runOne(tasks[i]); } }',
  'await Promise.all(Array.from({ length: concurrency }, () => worker()));',
  'process.stdout.write(JSON.stringify(out));'
].join('\n');

function emptyFlakeSkippedResult() {
  return {
    success: true,
    flaky: false,
    passed: true,
    failedTestFiles: 0,
    message: 'No test files targeted or affected. Flake check skipped.',
    results: []
  };
}

function buildFlakeSpecs(testFiles, iterationCount, repoRoot) {
  const fileSpecs = testFiles.map((tFile) => ({
    tFile,
    singleTest: buildSingleTestArgv(tFile, repoRoot)
  }));
  const flatTasks = [];
  for (let fIdx = 0; fIdx < fileSpecs.length; fIdx++) {
    const { singleTest } = fileSpecs[fIdx];
    for (let i = 0; i < iterationCount; i++) {
      flatTasks.push({ fIdx, file: singleTest.file, args: singleTest.args });
    }
  }
  return { fileSpecs, flatTasks };
}

function summarizeFlakeCounts(fileSpecs, counts, iterationCount) {
  const results = fileSpecs.map(({ tFile, singleTest }, idx) => ({
    testFile: tFile,
    command: [singleTest.file, ...singleTest.args].join(' '),
    iterations: iterationCount,
    passed: counts[idx].passed,
    failed: counts[idx].failed,
    isFlaky: counts[idx].passed > 0 && counts[idx].failed > 0
  }));
  return buildFlakeSummary(results);
}

export function runFlakeCheck({ runs = 5, target = null, repoRoot = '.', concurrency = Math.max(2, Math.min(8, os.cpus().length)) } = {}) {
  const { iterationCount, testFiles, flakeEnv } = prepareFlakeExecution({ runs, target, repoRoot });
  console.log(`🧪 Running Flaky Test Detector (${iterationCount} iterations)...`);
  if (testFiles.length === 0) return emptyFlakeSkippedResult();

  const { fileSpecs, flatTasks } = buildFlakeSpecs(testFiles, iterationCount, repoRoot);
  const counts = fileSpecs.map(() => ({ passed: 0, failed: 0 }));
  const workerConcurrency = normalizeFlakeConcurrency(concurrency, 1);

  if (workerConcurrency > 1 && flatTasks.length > 1) {
    const rawOut = execFileSync(process.execPath, ['--input-type=module', '-e', FLAKE_WORKER_SCRIPT], {
      cwd: repoRoot,
      env: flakeEnv,
      input: JSON.stringify({ cwd: repoRoot, concurrency: workerConcurrency, tasks: flatTasks.map(({ file, args }) => ({ file, args })) }),
      encoding: 'utf8',
      timeout: Math.max(FLAKE_TIMEOUT_MS, Math.min(600_000, flatTasks.length * 30_000)),
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const outcomes = JSON.parse(rawOut);
    for (let i = 0; i < flatTasks.length; i++) {
      const fIdx = flatTasks[i].fIdx;
      if (outcomes[i]) counts[fIdx].passed++;
      else counts[fIdx].failed++;
    }
  } else {
    for (const task of flatTasks) {
      try {
        execFileSync(task.file, task.args, { cwd: repoRoot, stdio: 'ignore', timeout: FLAKE_TIMEOUT_MS, env: flakeEnv });
        counts[task.fIdx].passed++;
      } catch {
        counts[task.fIdx].failed++;
      }
    }
  }

  return summarizeFlakeCounts(fileSpecs, counts, iterationCount);
}

export async function runFlakeCheckParallel({
  runs = 5,
  target = null,
  repoRoot = '.',
  concurrency = Math.max(2, Math.min(8, os.cpus().length))
} = {}) {
  const { iterationCount, testFiles, flakeEnv } = prepareFlakeExecution({ runs, target, repoRoot });
  console.log(`🧪 Running Parallel Flaky Test Detector (${iterationCount} iterations)...`);
  if (testFiles.length === 0) return emptyFlakeSkippedResult();

  const { fileSpecs, flatTasks } = buildFlakeSpecs(testFiles, iterationCount, repoRoot);
  const asyncTasks = flatTasks.map((t) => async () => ({
    fIdx: t.fIdx,
    ok: await spawnFlakeIterationAsync(t.file, t.args, { cwd: repoRoot, env: flakeEnv })
  }));

  const outcomes = await runParallelTasks(asyncTasks, normalizeFlakeConcurrency(concurrency, 1));
  const counts = fileSpecs.map(() => ({ passed: 0, failed: 0 }));
  for (const outcome of outcomes) {
    if (outcome.ok) counts[outcome.fIdx].passed++;
    else counts[outcome.fIdx].failed++;
  }

  return summarizeFlakeCounts(fileSpecs, counts, iterationCount);
}

export function suggestMutationStrengthening({ mutantType = 'ConditionalsBoundary', file = null, line = null } = {}) {
  const suggestions = {
    ConditionalsBoundary:
      'Boundary condition mutated (e.g. `<` changed to `<=`). Add boundary value test case asserting exact threshold (e.g. `threshold - 1`, `threshold`, and `threshold + 1`).',
    NegateCondition:
      'Conditional boolean negated (e.g. `if (x)` inverted). Ensure both true and false paths have distinct observable assertions.',
    Math: 'Arithmetic operator replaced (e.g. `+` to `-`). Verify calculation outcomes with non-zero, distinct operands.',
    VoidMethodCall:
      'Void side-effect removed (e.g. state mutation, cache evict, event emit). Assert the resulting observable state change or verify mock invocation.',
    EmptyReturn:
      'Method return replaced with empty/null. Ensure caller explicitly asserts non-empty return data structures.'
  };

  const advice =
    suggestions[mutantType] ||
    'Surviving mutant indicates missing assertion density. Verify that test assertions validate outcomes rather than just exercising code paths.';

  return {
    mutantType,
    file,
    line,
    recommendation: advice,
    sampleAssert:
      mutantType === 'ConditionalsBoundary'
        ? 'assert.equal(calculate(10), expectedThresholdOutcome)'
        : 'assert.notEqual(result, null)'
  };
}
