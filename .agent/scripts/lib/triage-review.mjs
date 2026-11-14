import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  fileExists,
  readFileSafe,
  parseFrontmatter,
  inspectArchlens,
  getModifiedFiles,
  getUnifiedDiffByFile,
  gitOutput,
  resolveDefaultBaseBranch,
  resolveQualityThresholds,
  sameShaPrefix,
  parseTicketId,
  readSessionStatus
} from './core.mjs';
import { appendAuditRecord } from './audit-chain.mjs';
import { checkSpecDrift } from './adr-drift.mjs';

export function scaffoldReproductionTest({
  errorTrace = '',
  targetFile = null,
  repoRoot = '.'
} = {}) {
  const cleanTrace = (errorTrace || '').trim();
  const guessedTarget =
    targetFile ||
    cleanTrace.match(/at\s+.*?\((.*?):\d+:\d+\)/)?.[1] ||
    cleanTrace.match(/File\s+"([^"]+)",\s+line\s+\d+/)?.[1] ||
    cleanTrace.match(/([a-zA-Z0-9_./-]+\.(?:java|py|go|rs|mjs|js|ts)):\d+/)?.[1] ||
    'src/index.mjs';
  const ext = path.extname(guessedTarget).toLowerCase();
  const baseName = path.basename(guessedTarget, ext);
  const firstLine = cleanTrace ? cleanTrace.split('\n')[0] : 'Reproduction Failure';
  const sanitizeComment = (text) =>
    String(text || '')
      .replace(/\*\//g, '* /')
      .replace(/"""/g, '\\"\\"\\"');
  const sanitizeSingleLineComment = (text) => sanitizeComment(text).replace(/[\r\n]+/g, ' ');
  const sanitizePyDoc = (text) => String(text || '').replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"').replace(/\*\//g, '* /');
  const safeTargetComment = sanitizeComment(guessedTarget);
  const safeBaseComment = sanitizeComment(baseName);
  const safeTraceComment = sanitizeComment(cleanTrace);
  const safeFirstLineComment = sanitizeSingleLineComment(firstLine);
  const stamp = Date.now().toString().slice(-4);

  const testDir = path.resolve(repoRoot, 'tests/reproductions');
  fs.mkdirSync(testDir, { recursive: true });

  let testFileName = `reproduce-${baseName.toLowerCase()}-${stamp}.test.mjs`;
  let language = 'javascript';
  let testContent = '';

  const headerComment = `/**
 * MANDATORY BUG REPRODUCTION HARNESS (Red-Green-Refactor TDD)
 * Target Source: ${safeTargetComment}
 * Stack / Error Trace:
 * ${safeTraceComment.split('\n').map((l) => ' * ' + l).join('\n')}
 * Bug Reproduction Harness: ${safeBaseComment}
 */`;

  if (ext === '.java') {
    language = 'java';
    const className = `Reproduce${baseName.replace(/[^a-zA-Z0-9]/g, '')}${stamp}Test`;
    testFileName = `${className}.java`;
    testContent = `${headerComment}
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

public class ${className} {
    @Test
    void reproducesFailureBeforeFix() {
        // Red Phase: Replace with invocation of ${sanitizeSingleLineComment(baseName)} triggering: ${safeFirstLineComment}
        fail(${JSON.stringify(`Unresolved defect in ${guessedTarget}: ${firstLine}`)});
    }
}
`;
  } else if (ext === '.py') {
    language = 'python';
    testFileName = `test_reproduce_${baseName.toLowerCase()}_${stamp}.py`;
    testContent = `"""
MANDATORY BUG REPRODUCTION HARNESS (Red-Green-Refactor TDD)
Target Source: ${sanitizePyDoc(guessedTarget)}
Bug Reproduction Harness: ${sanitizePyDoc(baseName)}
Trace: ${sanitizePyDoc(firstLine)}
"""
import pytest

def test_reproduce_${baseName.toLowerCase().replace(/[^a-z0-9_]/g, '_')}():
    # Red Phase: Invoking ${sanitizeSingleLineComment(guessedTarget)} must not raise ${safeFirstLineComment}
    pytest.fail(${JSON.stringify(`Unresolved defect in ${guessedTarget}: ${firstLine}`)})
`;
  } else if (ext === '.go') {
    language = 'go';
    testFileName = `reproduce_${baseName.toLowerCase()}_${stamp}_test.go`;
    testContent = `${headerComment}
package reproductions

import "testing"

func TestReproduce${baseName.replace(/[^a-zA-Z0-9]/g, '')}(t *testing.T) {
\t// Red Phase: Invoking ${sanitizeSingleLineComment(guessedTarget)} must not fail with: ${safeFirstLineComment}
\tt.Fatalf("Unresolved defect in %s: %s", ${JSON.stringify(guessedTarget)}, ${JSON.stringify(firstLine)})
}
`;
  } else if (ext === '.rs') {
    language = 'rust';
    testFileName = `reproduce_${baseName.toLowerCase()}_${stamp}_test.rs`;
    testContent = `${headerComment}
#[test]
fn reproduce_${baseName.toLowerCase().replace(/[^a-z0-9_]/g, '_')}() {
    panic!("{}", ${JSON.stringify(`Unresolved defect in ${guessedTarget}: ${firstLine}`)});
}
`;
  } else {
    testContent = `import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

${headerComment}
describe(${JSON.stringify(`Bug Reproduction Harness: ${baseName}`)}, () => {
  it('reproduces failure with failing assertion before applying fix', async () => {
    const targetModulePath = ${JSON.stringify(guessedTarget)};
    assert.ok(targetModulePath, 'Target module path must be defined');

    // Red Phase: Replace with real reproduction invoking targetModulePath before implementing fix.
    assert.fail(\`Unresolved defect in \${targetModulePath}: \${${JSON.stringify(firstLine)}}\`);
  });
});
`;
  }

  const testFilePath = path.resolve(testDir, testFileName);
  fs.writeFileSync(testFilePath, testContent, 'utf8');

  return {
    success: true,
    created: true,
    language,
    targetFile: guessedTarget,
    testPath: testFilePath,
    relativePath: path.relative(path.resolve(repoRoot), testFilePath),
    testContent
  };
}

export function assessRisk(diffFiles = [], repoRoot = '.') {
  const files = diffFiles.length > 0 ? diffFiles : getModifiedFiles(null, repoRoot);
  let score = 0;
  const factors = [];

  for (const file of files) {
    const lower = file.toLowerCase();

    if (lower.includes('migration') || lower.includes('flyway') || lower.includes('liquibase') || lower.endsWith('.sql')) {
      score += 40;
      factors.push({ file, level: 'CRITICAL', reason: 'Database schema migration / DDL change' });
    } else if (
      lower.includes('auth') ||
      lower.includes('jwt') ||
      lower.includes('crypto') ||
      lower.includes('secret') ||
      lower.includes('security')
    ) {
      score += 35;
      factors.push({ file, level: 'CRITICAL', reason: 'Security, cryptographic, or authentication logic' });
    } else if (lower.endsWith('package-lock.json') || lower.endsWith('yarn.lock') || lower.endsWith('cargo.lock')) {
      score += 20;
      factors.push({ file, level: 'HIGH', reason: 'Dependency graph / lockfile modification' });
    } else if (
      lower.includes('domain') ||
      lower.includes('entity') ||
      lower.includes('model') ||
      lower.includes('.archlens')
    ) {
      score += 25;
      factors.push({ file, level: 'HIGH', reason: 'Core domain entity or architectural governance change' });
    } else if (
      lower.includes('controller') ||
      lower.includes('resource') ||
      lower.includes('route') ||
      lower.includes('api')
    ) {
      score += 15;
      factors.push({ file, level: 'MEDIUM', reason: 'Public API contract or endpoint controller' });
    } else if (lower.includes('service') || lower.includes('usecase')) {
      score += 10;
      factors.push({ file, level: 'MEDIUM', reason: 'Application business service logic' });
    } else if (lower.endsWith('.md') || lower.endsWith('.css') || lower.includes('docs/')) {
      score += 2;
      factors.push({ file, level: 'LOW', reason: 'Documentation, styles, or informational asset' });
    } else {
      score += 5;
      factors.push({ file, level: 'LOW', reason: 'Standard source code modification' });
    }
  }

  let riskLevel = 'LOW';
  if (score >= 60 || factors.some((f) => f.level === 'CRITICAL')) {
    riskLevel = 'CRITICAL';
  } else if (score >= 35 || factors.some((f) => f.level === 'HIGH')) {
    riskLevel = 'HIGH';
  } else if (score >= 15) {
    riskLevel = 'MEDIUM';
  }

  return {
    score,
    riskLevel,
    totalFiles: files.length,
    factors,
    recommendation:
      riskLevel === 'CRITICAL'
        ? 'CRITICAL RISK: Mandatory dual-peer review and full regression audit required.'
        : riskLevel === 'HIGH'
          ? 'HIGH RISK: Deep mutation testing and architectural validation required.'
          : 'Standard risk profile: Standard Dual-Gate verification applies.'
  };
}

export const VALID_LANES = ['trivial', 'standard', 'full'];
export const LANE_RANK = { trivial: 0, standard: 1, full: 2 };

const TRIVIAL_DOC_STYLE_EXTS = new Set(['.md', '.mdx', '.txt', '.rst', '.css', '.scss', '.svg']);

function isTrivialEligibleFile(filePath) {
  const norm = String(filePath).replace(/\\/g, '/').toLowerCase();
  if (
    norm === 'product.md' ||
    norm.endsWith('/product.md') ||
    norm === 'docs/prd.md' ||
    norm.endsWith('/docs/prd.md') ||
    norm === 'docs/srs.md' ||
    norm.endsWith('/docs/srs.md') ||
    norm.startsWith('docs/specs/') ||
    norm.includes('/docs/specs/') ||
    norm.startsWith('docs/adr/') ||
    norm.includes('/docs/adr/')
  ) {
    return false;
  }
  return TRIVIAL_DOC_STYLE_EXTS.has(path.extname(norm));
}

function countChangedLines(files, baseBranch = null, repoRoot = '.') {
  if (!files || files.length === 0) return 0;
  const resolvedBase = baseBranch || resolveDefaultBaseBranch(repoRoot);
  const numstatMap = new Map();
  const numstatOut =
    gitOutput(['diff', '--numstat', `origin/${resolvedBase}`], repoRoot) ??
    gitOutput(['diff', '--numstat', resolvedBase], repoRoot) ??
    gitOutput(['diff', '--numstat', 'HEAD'], repoRoot) ??
    '';

  for (const line of numstatOut.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\t+/);
    if (parts.length >= 3) {
      const added = Number.parseInt(parts[0], 10) || 0;
      const deleted = Number.parseInt(parts[1], 10) || 0;
      const rel = parts.slice(2).join('\t').replace(/\\/g, '/');
      numstatMap.set(rel, added + deleted);
    }
  }

  let total = 0;
  for (const f of files) {
    const norm = String(f).replace(/\\/g, '/');
    if (numstatMap.has(norm)) {
      total += numstatMap.get(norm);
    } else {
      const full = path.resolve(repoRoot, norm);
      if (fileExists(full)) {
        const raw = readFileSafe(full) || '';
        total += raw ? raw.split('\n').length : 0;
      }
    }
  }
  return total;
}

/**
 * Classifies a change into one of three risk-proportional execution lanes:
 * - `trivial`: docs/CSS/comments <= trivialMaxLines (default 25), LOW risk, 0 drift triggers
 * - `standard`: normal feature/bugfix <= standardMaxLines (default 200), LOW/MEDIUM risk, 0 drift triggers
 * - `full`: HIGH/CRITICAL risk, any spec-drift trigger, or > standardMaxLines changed lines
 */
export function triageChange({
  diffFiles = [],
  intent = '',
  laneOverride = null,
  reason = null,
  baseBranch = null,
  ticketId = null,
  repoRoot = '.'
} = {}) {
  const resolvedBase = baseBranch || resolveDefaultBaseBranch(repoRoot);
  let trivialMaxLines = 25;
  let standardMaxLines = 200;
  const cfgPath = path.resolve(repoRoot, '.agent/sdlc-config.json');
  if (fileExists(cfgPath)) {
    try {
      const cfg = JSON.parse(readFileSafe(cfgPath) || '{}');
      if (Number(cfg?.lanes?.trivialMaxLines) > 0) trivialMaxLines = Number(cfg.lanes.trivialMaxLines);
      if (Number(cfg?.lanes?.standardMaxLines) > 0) standardMaxLines = Number(cfg.lanes.standardMaxLines);
    } catch {}
  }

  const normOverride = laneOverride ? String(laneOverride).trim().toLowerCase() : null;
  if (normOverride && !VALID_LANES.includes(normOverride)) {
    throw new Error(`Invalid lane '${laneOverride}'. Expected one of: ${VALID_LANES.join(', ')}.`);
  }

  const files = diffFiles.length > 0 ? diffFiles : getModifiedFiles(resolvedBase, repoRoot);
  const changedLines = countChangedLines(files, resolvedBase, repoRoot);
  const risk = files.length > 0 ? assessRisk(files, repoRoot) : { score: 0, riskLevel: 'LOW', totalFiles: 0, factors: [] };
  const drift =
    files.length > 0
      ? checkSpecDrift({ diffFiles: files, baseBranch: resolvedBase, ticketId, repoRoot })
      : { passed: true, triggers: [] };

  let computedLane = 'standard';
  let docsOrStyleOnly = false;

  if (files.length === 0) {
    const cleanIntent = String(intent || '');
    if (/\b(auth|jwt|crypto|secret|security|migration|flyway|schema|ddl|breaking|release)\b/i.test(cleanIntent)) {
      computedLane = 'full';
    } else if (/\b(typo|spelling|readme|comment|copy|css|padding|color|badge|docs?-only|link fix)\b/i.test(cleanIntent)) {
      computedLane = 'trivial';
      docsOrStyleOnly = true;
    } else {
      computedLane = 'standard';
    }
  } else {
    docsOrStyleOnly = files.every(isTrivialEligibleFile);
    if (risk.riskLevel === 'CRITICAL' || risk.riskLevel === 'HIGH' || drift.triggers.length > 0 || changedLines > standardMaxLines) {
      computedLane = 'full';
    } else if (docsOrStyleOnly && changedLines <= trivialMaxLines && risk.riskLevel === 'LOW') {
      computedLane = 'trivial';
    } else {
      computedLane = 'standard';
    }
  }

  let effectiveLane = computedLane;
  let overridden = false;
  let downgraded = false;
  const cleanReason = reason && String(reason).trim() ? String(reason).trim() : null;

  if (normOverride && normOverride !== computedLane) {
    if (LANE_RANK[normOverride] > LANE_RANK[computedLane]) {
      effectiveLane = normOverride;
      overridden = true;
    } else if (files.length === 0 && computedLane !== 'full') {
      // Pre-edit triage at `stage begin`: allow explicit lane selection without a downgrade audit,
      // because `stage pre-pr` and `gate` automatically re-triage the actual diff before merge.
      effectiveLane = normOverride;
      overridden = true;
    } else {
      if (risk.riskLevel === 'CRITICAL') {
        throw new Error('Cannot downgrade execution lane below full for CRITICAL risk changes.');
      }
      if (!cleanReason) {
        throw new Error(
          `Downgrading execution lane from '${computedLane}' to '${normOverride}' requires a non-empty --reason for the audit ledger.`
        );
      }
      appendAuditRecord({
        event: 'LANE_DOWNGRADE_OVERRIDDEN',
        metadata: {
          fromLane: computedLane,
          toLane: normOverride,
          reason: cleanReason,
          riskLevel: risk.riskLevel,
          changedLines,
          filesCount: files.length
        },
        repoRoot
      });
      effectiveLane = normOverride;
      overridden = true;
      downgraded = true;
    }
  }

  return {
    lane: effectiveLane,
    computedLane,
    overridden,
    downgraded,
    reason: cleanReason,
    riskLevel: risk.riskLevel,
    riskScore: risk.score,
    changedLines,
    filesCount: files.length,
    docsOrStyleOnly,
    driftTriggersCount: drift.triggers.length,
    thresholds: { trivialMaxLines, standardMaxLines },
    requirements: {
      remoteTicketRequired: effectiveLane !== 'trivial',
      coverageRequired: effectiveLane !== 'trivial',
      mutationRequired: effectiveLane === 'full',
      reviewSubagents:
        effectiveLane === 'trivial'
          ? 0
          : effectiveLane === 'standard'
            ? 1
            : risk.riskLevel === 'CRITICAL' || risk.riskLevel === 'HIGH'
              ? 3
              : 2,
      strictGate: effectiveLane === 'full'
    }
  };
}

export function generatePRSummary({ issueId = null, repoRoot = '.' } = {}) {
  const current = readSessionStatus(repoRoot);
  const activeSess = current.session;
  const issue = issueId || activeSess?.issueId || 'N/A';
  const branch = activeSess?.branch || 'current-branch';
  const type = activeSess?.type || 'feat';

  const baseRef = resolveDefaultBaseBranch(repoRoot);
  const diffFiles = getModifiedFiles(null, repoRoot);
  const risk = assessRisk(diffFiles, repoRoot);
  const archInfo = inspectArchlens(repoRoot);

  const { minCov, minMut } = resolveQualityThresholds(repoRoot);

  const statSummary = (
    gitOutput(['diff', '--stat', `origin/${baseRef}...HEAD`], repoRoot) ||
    gitOutput(['diff', '--stat', `${baseRef}...HEAD`], repoRoot) ||
    gitOutput(['diff', '--stat', 'HEAD~1'], repoRoot) ||
    gitOutput(['diff', '--stat'], repoRoot) ||
    ''
  ).trim();

  const currentHeadSha = (gitOutput(['rev-parse', 'HEAD'], repoRoot) || '').trim() || null;
  const covReport = activeSess?.manifest?.coverageReport || null;
  const mutReport = activeSess?.manifest?.mutationScore || null;
  const pillars = activeSess?.manifest?.gatePillars || null;
  const pillarsStale = Boolean(pillars?.headSha && currentHeadSha && !sameShaPrefix(pillars.headSha, currentHeadSha));
  const covSha = activeSess?.manifest?.coverageHeadSha || pillars?.headSha || null;
  const mutSha = activeSess?.manifest?.mutationHeadSha || pillars?.headSha || null;
  const covStale = Boolean(covReport && currentHeadSha && (pillarsStale || (covSha && !sameShaPrefix(covSha, currentHeadSha))));
  const mutStale = Boolean(mutReport && currentHeadSha && (pillarsStale || (mutSha && !sameShaPrefix(mutSha, currentHeadSha))));
  const covNum = covReport ? Number.parseFloat(String(covReport).replace('%', '')) : NaN;
  const mutNum = mutReport ? Number.parseFloat(String(mutReport).replace('%', '')) : NaN;
  const covStatusLabel = !covReport
    ? '⚪ PENDING'
    : covStale
      ? '⏳ STALE (re-run gate)'
      : pillars?.coveragePassed === false || (minCov !== null && Number.isFinite(covNum) && covNum < minCov)
        ? '❌ FAILED'
        : '✅ PASSED';
  const mutStatusLabel =
    minMut === null && !mutReport
      ? '⚪ N/A'
      : !mutReport
        ? '⚪ PENDING'
        : mutStale
          ? '⏳ STALE (re-run gate)'
          : pillars?.mutationPassed === false || (minMut !== null && Number.isFinite(mutNum) && mutNum < minMut)
            ? '❌ FAILED'
            : '✅ PASSED';
  const archStatusLabel = !archInfo.installed
    ? '⚪ SKIPPED'
    : pillarsStale
      ? '⏳ STALE (re-run gate)'
      : pillars?.archPassed === true
        ? '✅ PASSED'
        : pillars?.archPassed === false
          ? '❌ FAILED'
          : '⏳ PENDING';
  const lintStatusLabel = pillarsStale
    ? '⏳ STALE (re-run gate)'
    : pillars?.lintPassed === true
      ? '✅ PASSED'
      : pillars?.lintPassed === false
        ? '❌ FAILED'
        : '⏳ PENDING';
  const covAchievedDisplay = !covReport ? 'Not Measured' : covStale ? `${covReport} (stale prior commit)` : covReport;
  const mutAchievedDisplay = !mutReport ? 'Not Measured' : mutStale ? `${mutReport} (stale prior commit)` : mutReport;
  const archAchievedDisplay = !archInfo.installed
    ? 'N/A'
    : pillarsStale
      ? 'Stale (prior commit)'
      : pillars?.archPassed === true
        ? 'Compliant'
        : pillars?.archPassed === false
          ? 'Violations Found'
          : 'Configured';
  const lintAchievedDisplay = pillarsStale
    ? 'Stale (prior commit)'
    : pillars?.lintPassed === true
      ? 'Clean'
      : pillars?.lintPassed === false
        ? 'Violations Found'
        : 'Not Run';

  const parsedTicket = parseTicketId(issue);
  const ticketDisplay =
    parsedTicket === null ? 'N/A' : typeof parsedTicket === 'number' ? `#${parsedTicket}` : String(parsedTicket);
  const covThreshLabel = minCov === null ? 'N/A' : `>= ${minCov}%`;
  const mutThreshLabel = minMut === null ? 'N/A' : `>= ${minMut}%`;

  const summary = `## 📋 Pull Request Summary: ${ticketDisplay}

### 🎯 Overview & Classification
- **Type**: \`${type.toUpperCase()}\`
- **Associated Ticket**: \`${ticketDisplay}\`
- **Branch**: \`${branch}\`
- **Pre-Flight Risk Profile**: \`${risk.riskLevel}\` (Score: ${risk.score})

---

### 🛡️ Dual-Gate Quality Verification
| Metric | Threshold | Achieved | Status |
| :--- | :--- | :--- | :--- |
| **Line & Branch Diff Coverage** | \`${covThreshLabel}\` | ${covAchievedDisplay} | ${covStatusLabel} |
| **Mutation Kill Score** | \`${mutThreshLabel}\` | ${mutAchievedDisplay} | ${mutStatusLabel} |
| **Archlens Clean Architecture** | 100% Policy | ${archAchievedDisplay} | ${archStatusLabel} |
| **Static Analysis & Linting** | 0 Violations | ${lintAchievedDisplay} | ${lintStatusLabel} |

---

### 🔍 Risk & Impact Analysis
- **Assessed Risk**: **${risk.riskLevel}**
- **Recommendation**: ${risk.recommendation}
${risk.factors.slice(0, 5).map((f) => `- \`${f.file}\`: **${f.level}** (${f.reason})`).join('\n')}

---

### 📦 Files Changed & Stat
\`\`\`text
${statSummary || diffFiles.join('\n') || 'No modified files detected'}
\`\`\`

---

### 🚀 Developer Showcase & Verification
1. Run local automated quality gate:
   \`\`\`bash
   node .agent/scripts/sdlc-engine.mjs gate
   \`\`\`
2. Verify affected unit tests:
   \`\`\`bash
   node .agent/scripts/sdlc-engine.mjs test --affected-only
   \`\`\`
`;

  return {
    issueId: issue,
    branch,
    type,
    risk,
    markdown: summary
  };
}

export function findAffectedTests(diffFiles = [], repoRoot = '.') {
  const files = diffFiles.length > 0 ? diffFiles : getModifiedFiles(null, repoRoot);
  const matchedTests = new Set();

  for (const file of files) {
    const ext = path.extname(file);
    const basename = path.basename(file, ext);

    const candidateNames = [
      `${basename}.test${ext}`,
      `${basename}.spec${ext}`,
      `${basename}Test${ext}`,
      `${basename}_test${ext}`,
      `test_${basename}${ext}`
    ];

    const searchDirs = ['test', 'tests', 'src/test', 'spec', 'specs'];
    for (const sDir of searchDirs) {
      const fullDir = path.resolve(repoRoot, sDir);
      if (fs.existsSync(fullDir)) {
        try {
          const findRecursive = (dir) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                findRecursive(fullPath);
              } else if (candidateNames.includes(entry.name)) {
                matchedTests.add(path.relative(path.resolve(repoRoot), fullPath));
              }
            }
          };
          findRecursive(fullDir);
        } catch {}
      }
    }
  }

  return Array.from(matchedTests);
}

/**
 * @deprecated Use `findAffectedTests` (corrected spelling) instead.
 */
export function findAffectededTests(diffFiles = [], repoRoot = '.') {
  return findAffectedTests(diffFiles, repoRoot);
}


export function resolveAdHocTargets(files = [], modules = [], repoRoot = '.') {
  if (!files || files.length === 0) {
    return {
      totalFiles: 0,
      clusters: [],
      executionStrategy: 'sequential',
      recommendation: 'No targets specified. Run sequentially.'
    };
  }

  const clusterMap = new Map();

  for (const file of files) {
    const relFile = path.isAbsolute(file) ? path.relative(path.resolve(repoRoot), file) : file;
    let assignedKey = 'root';

    for (const mod of modules) {
      if (mod.path !== '.' && (relFile === mod.path || relFile.startsWith(mod.path + '/'))) {
        assignedKey = mod.name;
        break;
      }
    }

    if (assignedKey === 'root') {
      const parts = relFile.split(path.sep);
      assignedKey = parts.length > 1 ? parts[0] : 'root';
    }

    if (!clusterMap.has(assignedKey)) {
      clusterMap.set(assignedKey, []);
    }
    clusterMap.get(assignedKey).push(relFile);
  }

  const clusters = Array.from(clusterMap.entries()).map(([clusterName, clusterFiles]) => ({
    name: clusterName,
    files: clusterFiles
  }));

  const isParallel = clusters.length > 1;

  return {
    totalFiles: files.length,
    clusters,
    executionStrategy: isParallel ? 'parallel' : 'sequential',
    recommendation: isParallel
      ? `Targets span ${clusters.length} independent domains/modules. Dispatch in parallel subagents for accelerated execution.`
      : 'All targets belong to the same module/directory. Execute sequentially to avoid merge/compilation hazards.'
  };
}

export function generateReviewPlan({ repoRoot = '.', lane = null, maxDiffChars = 40000 } = {}) {
  const current = readSessionStatus(repoRoot);
  const activeSess = current.session;
  const issueId = activeSess?.issueId || 'N/A';
  const branch = activeSess?.branch || 'current-branch';
  const baseRef = resolveDefaultBaseBranch(repoRoot);
  const diffFiles = getModifiedFiles(null, repoRoot);
  const risk = assessRisk(diffFiles, repoRoot);
  const resolvedLane = VALID_LANES.includes(lane)
    ? lane
    : VALID_LANES.includes(activeSess?.lane)
      ? activeSess.lane
      : 'full';

  const baseSha =
    (gitOutput(['merge-base', `origin/${baseRef}`, 'HEAD'], repoRoot) ||
      gitOutput(['merge-base', baseRef, 'HEAD'], repoRoot) ||
      '').trim() || null;
  const headSha = (gitOutput(['rev-parse', 'HEAD'], repoRoot) || '').trim() || null;
  const diffStat = (
    gitOutput(['diff', '--stat', `origin/${baseRef}...HEAD`], repoRoot) ||
    gitOutput(['diff', '--stat', `${baseRef}...HEAD`], repoRoot) ||
    gitOutput(['diff', '--stat', 'HEAD~1'], repoRoot) ||
    ''
  ).trim();
  const diffsByFile = getUnifiedDiffByFile(baseRef, repoRoot, diffFiles);
  const rawDiff = diffFiles
    .map((file) => diffsByFile.get(file) || '')
    .filter(Boolean)
    .join('\n');
  const budget = Math.max(1024, Number(maxDiffChars) || 40000);
  const diffTruncated = rawDiff.length > budget;
  const diff = diffTruncated
    ? `${rawDiff.slice(0, budget)}\n... [diff truncated at ${budget} chars; inspect full files via read_file]`
    : rawDiff;

  const filesLabel = diffFiles.length > 0 ? diffFiles.join(', ') : 'none';
  const issueRef = String(issueId).startsWith('L-') || issueId === 'N/A' ? String(issueId) : `#${issueId}`;
  const diffContextBlock = [
    `Base SHA: ${baseSha || baseRef} | HEAD SHA: ${headSha || 'working-tree'}`,
    `Modified files (${diffFiles.length}): ${filesLabel}`,
    ...(diffStat ? [`Diff Stat:\n${diffStat}`] : []),
    `Unified Diff:\n\`\`\`diff\n${diff || '(no diff hunks detected)'}\n\`\`\``
  ].join('\n');

  if (resolvedLane === 'trivial') {
    return {
      issueId,
      branch,
      lane: 'trivial',
      riskLevel: risk.riskLevel,
      baseSha,
      headSha,
      modifiedFiles: diffFiles,
      diffStat,
      diff,
      diffTruncated,
      subagentsCount: 0,
      payload: { Subagents: [] }
    };
  }

  if (resolvedLane === 'standard') {
    const subagents = [
      {
        TypeName: 'research',
        Role: 'PR Peer & Architecture Reviewer',
        Prompt: `Follow sdlc-gate review guidelines. Audit git diff against ${baseRef} on branch ${branch} for ticket ${issueRef} (standard lane, risk: ${risk.riskLevel}).
1. Audit logic correctness, behavioral test smells (no assertion-free tests), and F.I.R.S.T. isolation.
2. Verify coverage metrics against .agent/sdlc-config.json thresholds.
3. Inspect modified files for hardcoded secrets, unsafe shell interpolation, concentric layer inversions (.archlens/policy.json), and undeclared spec drift.
4. Return a structured read-only verdict (verdict: approve | request-changes, blockers, notes) so the orchestrator can publish it via review record.

${diffContextBlock}`
      }
    ];
    return {
      issueId,
      branch,
      lane: 'standard',
      riskLevel: risk.riskLevel,
      baseSha,
      headSha,
      modifiedFiles: diffFiles,
      diffStat,
      diff,
      diffTruncated,
      subagentsCount: subagents.length,
      payload: { Subagents: subagents }
    };
  }

  const subagents = [
    {
      TypeName: 'research',
      Role: 'PR Peer Reviewer',
      Prompt: `Follow sdlc-gate review guidelines. Audit git diff against ${baseRef} on branch ${branch} for ticket ${issueRef}.
1. Audit for behavioral test smells (no assertion-free tests, no trivial getters, no mock abuse) and F.I.R.S.T. isolation.
2. Verify Dual-Gate metrics against .agent/sdlc-config.json thresholds.
3. Verify README.md and CHANGELOG.md alignment when user-facing behavior changes.
4. Return a structured read-only verdict (verdict: approve | request-changes, blockers, notes) so the orchestrator can publish it via review record.

${diffContextBlock}`
    },
    {
      TypeName: 'research',
      Role: 'Quality Gatekeeper',
      Prompt: `Follow sdlc-gate architectural & security guidelines. Inspect modified files on branch ${branch} for ticket ${issueRef}.
1. Check pre-flight risk profile (detected: ${risk.riskLevel}, modified files: ${diffFiles.length}).
2. Inspect modified files for hardcoded secrets, unsafe shell interpolation, or package CVEs.
3. Verify zero concentric layer inversions against .archlens/policy.json and zero undeclared API contract drift.
4. Return a structured read-only gate report (verdict: approve | request-changes, blockers, notes).

${diffContextBlock}`
    }
  ];

  if (risk.riskLevel === 'CRITICAL' || risk.riskLevel === 'HIGH') {
    subagents.push({
      TypeName: 'research',
      Role: 'Security & Architectural Auditor',
      Prompt: `Conduct deep read-only security and architectural invariant audit on branch ${branch} for ticket ${issueRef} (${risk.riskLevel} risk).
1. Inspect migration files, auth handlers, CLI execution paths, and domain models for injection, credential leaks, or privilege bypasses.
2. Audit test determinism risks (shared mutable state, unseeded randomness, wall-clock or network coupling).
3. Validate concentric layer decoupling against .archlens/policy.json.
4. Return a structured read-only audit verdict (verdict: approve | request-changes, blockers, notes).

${diffContextBlock}`
    });
  }

  const payload = { Subagents: subagents };
  return {
    issueId,
    branch,
    lane: 'full',
    riskLevel: risk.riskLevel,
    baseSha,
    headSha,
    modifiedFiles: diffFiles,
    diffStat,
    diff,
    diffTruncated,
    subagentsCount: subagents.length,
    payload
  };
}

/**
 * Audits `.agent/skills/*` against NVIDIA SkillSpector static rules (`RP1` unpinned npx,
 * `AS3` cross-skill file enumeration, frontmatter YAML truncation, and optional live `uvx` scan).
 */
export function auditSkills(repoRoot = '.', { live = false } = {}) {
  const skillsDir = path.resolve(repoRoot, '.agent/skills');
  const results = [];
  let totalFindings = 0;

  if (fs.existsSync(skillsDir)) {
    const entries = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('sdlc'))
      .map((d) => d.name)
      .sort();

    for (const skillName of entries) {
      const skillFile = path.join(skillsDir, skillName, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      const content = fs.readFileSync(skillFile, 'utf8');
      const { frontmatter, body } = parseFrontmatter(content);
      const findings = [];

      // 1. YAML frontmatter truncation check (unquoted # in description)
      if (!frontmatter.name || !frontmatter.description) {
        findings.push({
          rule: 'FM1',
          severity: 'MEDIUM',
          message: 'Missing required YAML frontmatter name or description'
        });
      } else if (frontmatter.description.trim().endsWith(',')) {
        findings.push({
          rule: 'FM2',
          severity: 'MEDIUM',
          message: 'Description appears truncated by an unquoted YAML # comment'
        });
      }

      // 2. SkillSpector RP1: Unpinned npx package invocation
      const lines = (body || content).split('\n');
      lines.forEach((line, idx) => {
        if (
          /\bnpx\s+(?:-[yY]\s+)?(?:github:[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+|@[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+|[a-zA-Z0-9_.-]+)(?![a-zA-Z0-9_.-]|@[0-9])/i.test(
            line
          )
        ) {
          findings.push({
            rule: 'RP1',
            severity: 'MEDIUM',
            line: idx + 1,
            message: `Unpinned npx package invocation detected: "${line.trim()}"`
          });
        }
        // 3. SkillSpector AS3: Cross-skill file enumeration (.agent/skills/<other>/SKILL.md)
        const crossMatch = line.match(/\.agent\/skills\/([a-z0-9-]+)\/SKILL\.md/i);
        if (crossMatch && crossMatch[1] !== skillName) {
          findings.push({
            rule: 'AS3',
            severity: 'MEDIUM',
            line: idx + 1,
            message: `Cross-skill file enumeration referencing ${crossMatch[0]} (use skill identifier instead)`
          });
        }
      });

      totalFindings += findings.length;
      results.push({
        skill: skillName,
        score: findings.length === 0 ? 0 : findings.length * 7,
        severity: 'LOW',
        findingsCount: findings.length,
        findings
      });
    }
  }

  let skillspectorOutput = null;
  if (live) {
    try {
      skillspectorOutput = execFileSync(
        'uvx',
        ['--from', 'git+https://github.com/NVIDIA/skillspector.git', 'skillspector', 'scan', skillsDir, '--recursive', '--no-llm'],
        { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' }
      );
    } catch (err) {
      skillspectorOutput = err.stdout ? String(err.stdout) : err.message;
    }
  }

  return {
    success: totalFindings === 0,
    skillsScanned: results.length,
    skillsAudited: results.length,
    totalFindings,
    maxScore: results.reduce((max, r) => Math.max(max, r.score), 0),
    skills: results,
    skillspectorOutput
  };
}
