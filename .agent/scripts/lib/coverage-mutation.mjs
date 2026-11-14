import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  fileExists,
  readFileSafe,
  getModifiedFiles,
  getUnifiedDiffByFile,
  extractAddedLinesFromDiff,
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
  const ext = path.extname(testFile).toLowerCase();
  const baseName = path.basename(testFile, ext);
  const detected = detectStackInDir(repoRoot);
  if (ext === '.java' || detected?.language === 'java') {
    if (detected?.type === 'java-gradle') return { file: './gradlew', args: ['test', '--tests', baseName] };
    return { file: './mvnw', args: ['test', `-Dtest=${baseName}`] };
  }
  if (ext === '.py' || detected?.language === 'python') return { file: 'pytest', args: [testFile] };
  if (ext === '.go' || detected?.language === 'go') {
    const pkgDir = path.dirname(testFile);
    return { file: 'go', args: ['test', '-v', `./${pkgDir === '.' ? '...' : pkgDir}`] };
  }
  if (ext === '.rs' || detected?.language === 'rust') return { file: 'cargo', args: ['test', '--test', baseName] };
  return { file: process.execPath, args: ['--test', testFile] };
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
          const rounded = Number(linePct.toFixed(2));
          return {
            found: true,
            file: relPath,
            lineCoverage: rounded,
            repoLineCoverage: rounded,
            diffLineCoverage: null,
            diffApplicable: false,
            branchCoverage: Number(branchPct.toFixed(2)),
            formatted: `${linePct.toFixed(1)}%`,
            threshold,
            passed: threshold === null ? true : linePct >= threshold
          };
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
        return {
          found: true,
          file: relPath,
          lineCoverage: effectivePct,
          repoLineCoverage: repoPct,
          diffLineCoverage: diffMetrics.diffLineCoverage,
          diffApplicable: diffMetrics.diffApplicable,
          diffLinesCovered: diffMetrics.diffLinesCovered,
          diffLinesTotal: diffMetrics.diffLinesTotal,
          branchCoverage: diffMetrics.diffBranchCoverage,
          formatted: `${effectivePct.toFixed(1)}%`,
          threshold,
          passed,
          ...(reason ? { reason } : {})
        };
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
          if (total > 0) {
            const pct = (covered / total) * 100;
            const rounded = Number(pct.toFixed(2));
            return {
              found: true,
              file: relPath,
              lineCoverage: rounded,
              repoLineCoverage: rounded,
              diffLineCoverage: null,
              diffApplicable: false,
              branchCoverage: null,
              formatted: `${pct.toFixed(1)}%`,
              threshold,
              passed: threshold === null ? true : pct >= threshold
            };
          }
        }
      }
    }

    if (relPath.endsWith('.xml')) {
      const match = raw.match(/line-rate=["']([0-9.]+)["']/);
      if (match) {
        const pct = parseFloat(match[1]) * 100;
        const rounded = Number(pct.toFixed(2));
        return {
          found: true,
          file: relPath,
          lineCoverage: rounded,
          repoLineCoverage: rounded,
          diffLineCoverage: null,
          diffApplicable: false,
          branchCoverage: null,
          formatted: `${pct.toFixed(1)}%`,
          threshold,
          passed: threshold === null ? true : pct >= threshold
        };
      }
    }

    if (relPath.endsWith('coverage.out')) {
      let totalStmts = 0;
      let coveredStmts = 0;
      for (const line of raw.split('\n')) {
        if (!line || line.startsWith('mode:')) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          const stmts = parseInt(parts[1], 10) || 0;
          const count = parseInt(parts[2], 10) || 0;
          totalStmts += stmts;
          if (count > 0) coveredStmts += stmts;
        }
      }
      if (totalStmts > 0) {
        const pct = (coveredStmts / totalStmts) * 100;
        const rounded = Number(pct.toFixed(2));
        return {
          found: true,
          file: relPath,
          lineCoverage: rounded,
          repoLineCoverage: rounded,
          diffLineCoverage: null,
          diffApplicable: false,
          branchCoverage: null,
          formatted: `${pct.toFixed(1)}%`,
          threshold,
          passed: threshold === null ? true : pct >= threshold
        };
      }
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

export function parseMutationReport(repoRoot = '.', mod = null) {
  const { minMut: threshold } = resolveQualityThresholds(repoRoot, mod);
  const modDir = mod?.path && mod.path !== '.' ? path.resolve(repoRoot, mod.path) : path.resolve(repoRoot);
  const exemptions = getExemptions(repoRoot);

  const strykerPath = path.resolve(modDir, 'reports/mutation/mutation.json');
  if (fileExists(strykerPath)) {
    try {
      const data = JSON.parse(readFileSafe(strykerPath) || '{}');
      let killed = 0;
      let total = 0;
      let exemptedCount = 0;
      for (const [filePath, fileObj] of Object.entries(data.files || {})) {
        for (const mutant of fileObj.mutants || []) {
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
      if (typeof data.mutationScore === 'number' && exemptedCount === 0) {
        const score = Number(data.mutationScore.toFixed(2));
        return {
          found: true,
          file: 'reports/mutation/mutation.json',
          mutationScore: score,
          formatted: `${score.toFixed(1)}%`,
          threshold,
          exemptedCount: 0,
          passed: threshold === null ? true : score >= threshold
        };
      }
      if (total > 0 || exemptedCount > 0) {
        const score = total > 0 ? Number(((killed / total) * 100).toFixed(2)) : 100;
        return {
          found: true,
          file: 'reports/mutation/mutation.json',
          mutationScore: score,
          formatted: `${score.toFixed(1)}%`,
          threshold,
          exemptedCount,
          passed: threshold === null ? true : score >= threshold
        };
      }
    } catch {}
  }

  const pitPath = path.resolve(modDir, 'target/pit-reports/mutations.xml');
  if (fileExists(pitPath)) {
    const raw = readFileSafe(pitPath) || '';
    const blockMatches = raw.match(/<mutation\s+[^>]*detected=['"](true|false)['"][\s\S]*?<\/mutation>/g) || [];
    const attrMatches = raw.match(/<mutation\s+[^>]*detected=['"](true|false)['"][^>]*>/g) || [];
    const entries = blockMatches.length > 0 ? blockMatches : attrMatches;
    if (entries.length > 0) {
      let total = 0;
      let detectedCount = 0;
      let exemptedCount = 0;
      for (const m of entries) {
        const srcMatch = m.match(/<sourceFile>([^<]+)<\/sourceFile>/);
        const lineMatch = m.match(/<lineNumber>(\d+)<\/lineNumber>/);
        const mutMatch = m.match(/<mutator>([^<]+)<\/mutator>/);
        if (
          isMutantExempted(exemptions, {
            id: mutMatch ? mutMatch[1] : null,
            file: srcMatch ? srcMatch[1] : null,
            mutator: mutMatch ? mutMatch[1] : null,
            line: lineMatch ? Number(lineMatch[1]) : null
          })
        ) {
          exemptedCount++;
          continue;
        }
        total++;
        if (/detected=['"]true['"]/.test(m)) detectedCount++;
      }
      const score = total > 0 ? Number(((detectedCount / total) * 100).toFixed(2)) : 100;
      return {
        found: true,
        file: 'target/pit-reports/mutations.xml',
        mutationScore: score,
        formatted: `${score.toFixed(1)}%`,
        threshold,
        exemptedCount,
        passed: threshold === null ? true : score >= threshold
      };
    }
  }

  // Fail closed: no report means nothing was measured.
  return {
    found: false,
    file: null,
    mutationScore: null,
    formatted: null,
    threshold,
    passed: false,
    reason: 'No mutation report found (looked for: reports/mutation/mutation.json, target/pit-reports/mutations.xml).'
  };
}

export function runFlakeCheck({ runs = 5, target = null, repoRoot = '.' } = {}) {
  const iterationCount = Math.max(2, Math.min(50, Number(runs) || 5));
  console.log(`🧪 Running Flaky Test Detector (${iterationCount} iterations)...`);

  const diffFiles = getModifiedFiles(null, repoRoot);
  const testFiles = target ? [target] : findAffectedTests(diffFiles, repoRoot);

  if (testFiles.length === 0) {
    return {
      success: true,
      flaky: false,
      passed: true,
      failedTestFiles: 0,
      message: 'No test files targeted or affected. Flake check skipped.',
      results: []
    };
  }

  const results = [];
  let detectedFlakes = 0;
  let failedTestFiles = 0;

  const flakeEnv = { ...process.env };
  delete flakeEnv.NODE_TEST_CONTEXT;

  for (const tFile of testFiles) {
    let passedCount = 0;
    let failedCount = 0;
    const singleTest = buildSingleTestArgv(tFile, repoRoot);

    for (let i = 1; i <= iterationCount; i++) {
      try {
        execFileSync(singleTest.file, singleTest.args, { cwd: repoRoot, stdio: 'pipe', env: flakeEnv });
        passedCount++;
      } catch {
        failedCount++;
      }
    }

    const isFlaky = passedCount > 0 && failedCount > 0;
    if (isFlaky) detectedFlakes++;
    if (failedCount > 0) failedTestFiles++;

    results.push({
      testFile: tFile,
      command: [singleTest.file, ...singleTest.args].join(' '),
      iterations: iterationCount,
      passed: passedCount,
      failed: failedCount,
      isFlaky
    });
  }

  return {
    success: true,
    flaky: detectedFlakes > 0,
    passed: detectedFlakes === 0 && failedTestFiles === 0,
    totalTested: testFiles.length,
    flakyCount: detectedFlakes,
    failedTestFiles,
    results
  };
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
