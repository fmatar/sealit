import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  scaffoldReproductionTest,
  assessRisk,
  triageChange,
  generatePRSummary,
  findAffectedTests,
  resolveAdHocTargets,
  generateReviewPlan,
  auditSkills
} from '../../.agent/scripts/lib/triage-review.mjs';
import { startSession, updateSession } from '../../.agent/scripts/lib/session.mjs';
import { verifyAuditChain } from '../../.agent/scripts/lib/audit-chain.mjs';

describe('Unit: triage-review.mjs', () => {
  let tmpDir;
  let gitDir;
  let seedRepo;
  let headSha;

  function cloneSeed(prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    fs.cpSync(seedRepo, dir, { recursive: true });
    return dir;
  }

  before(() => {
    seedRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-unit-triage-seed-'));
    execFileSync('git', ['init', '-q', '-b', 'develop'], { cwd: seedRepo, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: seedRepo, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: seedRepo, stdio: 'pipe' });
    execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'seed'], { cwd: seedRepo, stdio: 'pipe' });

    gitDir = cloneSeed('sdlc-unit-triage-git-');
    fs.mkdirSync(path.join(gitDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'src/app.mjs'), 'export const a = 1;\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: gitDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: gitDir, stdio: 'pipe' });
    execFileSync('git', ['checkout', '-q', '-b', 'feature/issue-#88'], { cwd: gitDir, stdio: 'pipe' });
    headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: gitDir, encoding: 'utf8' }).trim();
    fs.writeFileSync(path.join(gitDir, 'src/app.mjs'), 'export const a = 1;\nexport const b = 2;\n', 'utf8');
  });

  after(() => {
    fs.rmSync(gitDir, { recursive: true, force: true });
    fs.rmSync(seedRepo, { recursive: true, force: true });
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-unit-triage-'));
  });

  it('scaffolds polyglot failing reproduction harnesses with sanitized stack-trace comments', () => {
    try {
      const js = scaffoldReproductionTest({ error: 'TypeError at src/parser.mjs:12\nnext line\n*/\n', repoRoot: tmpDir });
      assert.equal(js.language, 'javascript');
      assert.equal(fs.existsSync(js.testPath), true);
      assert.match(js.testContent, /describe\(/);

      const py = scaffoldReproductionTest({ error: 'Boom', targetFile: 'app/calc.py', repoRoot: tmpDir });
      assert.equal(py.language, 'python');
      assert.match(path.basename(py.testPath), /^test_reproduce_calc_/);
      assert.match(py.testContent, /def test_reproduce_/);

      const go = scaffoldReproductionTest({ error: 'panic', targetFile: 'pkg/srv.go', repoRoot: tmpDir });
      assert.equal(go.language, 'go');
      assert.match(go.testContent, /t\.Fatalf/);

      const rs = scaffoldReproductionTest({ error: 'unwrap failed', targetFile: 'src/lib.rs', repoRoot: tmpDir });
      assert.equal(rs.language, 'rust');
      assert.match(rs.testContent, /#\[test\]/);

      const java = scaffoldReproductionTest({ error: 'NPE', targetFile: 'src/main/java/com/acme/Svc.java', repoRoot: tmpDir });
      assert.equal(java.language, 'java');
      assert.match(java.testContent, /@Test/);
      assert.match(java.relativePath, /^tests\/reproductions\/Reproduce.*\.java$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('assesses risk tiers and enforces lane triage upgrade/downgrade rules with audit ledger', () => {
    try {
      const low = assessRisk(['README.md', 'docs/notes.md'], tmpDir);
      assert.equal(low.riskLevel, 'LOW');
      assert.equal(low.score, 4);

      const crit = assessRisk(['.github/workflows/ci.yml', 'src/auth/security-audit.mjs'], tmpDir);
      assert.equal(crit.riskLevel, 'CRITICAL');
      assert.ok(crit.score >= 35);

      // Downgrade of CRITICAL blocked even with reason
      assert.throws(
        () => triageChange({ diffFiles: ['.github/workflows/ci.yml', 'src/auth/token.mjs'], laneOverride: 'standard', reason: 'hurry', repoRoot: tmpDir }),
        /Cannot downgrade execution lane below full for CRITICAL/i
      );

      // Downgrade of standard without reason throws
      assert.throws(
        () => triageChange({ diffFiles: ['src/index.js'], laneOverride: 'trivial', repoRoot: tmpDir }),
        /requires a non-empty --reason/i
      );

      // Valid downgrade logs audit record
      const down = triageChange({ diffFiles: ['src/index.js'], laneOverride: 'trivial', reason: 'verified zero side-effects', repoRoot: tmpDir });
      assert.equal(down.lane, 'trivial');
      assert.equal(down.downgraded, true);
      assert.equal(verifyAuditChain(tmpDir).recordsCount, 1);

      // Docs-only small edit selects trivial automatically
      const triv = triageChange({ diffFiles: ['README.md'], repoRoot: tmpDir });
      assert.equal(triv.computedLane, 'trivial');
      assert.equal(triv.requirements.reviewSubagents, 0);
      assert.equal(triv.requirements.coverageRequired, false);

      // Full lane review count scales 2 vs 3 by risk
      const fullRes = triageChange({ diffFiles: ['src/auth/token.mjs', '.github/workflows/ci.yml'], repoRoot: tmpDir });
      assert.equal(fullRes.lane, 'full');
      assert.equal(fullRes.requirements.reviewSubagents, 3);
      assert.equal(fullRes.requirements.mutationRequired, true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('maps affected tests, resolves ad-hoc targets, builds PR summaries, and generates review plans', () => {
    try {
      fs.mkdirSync(path.join(tmpDir, 'tests/sub'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'tests/sub/foo.test.mjs'), '', 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'tests/test_bar.py'), '', 'utf8');

      const found = findAffectedTests(['src/foo.mjs', 'pkg/bar.py'], tmpDir);
      assert.equal(found.length, 2);
      assert.ok(found.some((p) => p.endsWith('foo.test.mjs')));

      const targets = resolveAdHocTargets(['unknown/no_test.mjs'], [{ name: 'mod', path: 'packages/api' }], tmpDir);
      assert.equal(targets.totalFiles, 1);
      assert.equal(targets.executionStrategy, 'sequential');
      assert.ok(targets.clusters[0].files.includes('unknown/no_test.mjs'));

      const noDiffPlan = generateReviewPlan({ repoRoot: gitDir, lane: 'trivial', maxDiffChars: 200 });
      assert.equal(noDiffPlan.subagentsCount, 0);

      const fullPlan = generateReviewPlan({ repoRoot: gitDir, lane: 'full', maxDiffChars: 100 });
      assert.ok(fullPlan.subagentsCount >= 2);
      assert.equal(fullPlan.payload.Subagents.length, fullPlan.subagentsCount);

      startSession({ issueId: 88, branch: 'feature/issue-#88', lane: 'full', repoRoot: gitDir });
      updateSession({
        stage: 6,
        manifestUpdate: { coverageReport: '90.0%', coverageHeadSha: headSha, mutationScore: '65.0%', mutationHeadSha: headSha },
        repoRoot: gitDir
      });
      const summary = generatePRSummary({ issueId: 88, repoRoot: gitDir });
      assert.equal(summary.issueId, 88);
      assert.match(summary.markdown, /90\.0%/);
      assert.match(summary.markdown, /65\.0%/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('audits skills for FM1, FM2, RP1 unpinned npx, and AS3 cross-skill links', () => {
    try {
      fs.mkdirSync(path.join(tmpDir, '.agent/skills/sdlc-good'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, '.agent/skills/sdlc-bad'), { recursive: true });

      fs.writeFileSync(
        path.join(tmpDir, '.agent/skills/sdlc-good/SKILL.md'),
        '---\nname: sdlc-good\ndescription: "Valid skill description"\n---\nUse `npx mypkg@1.2.3` and self `.agent/skills/sdlc-good/SKILL.md`.\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(tmpDir, '.agent/skills/sdlc-bad/SKILL.md'),
        '---\nname: sdlc-bad\ndescription: Truncated value,\n---\nRun `npx -y unpinned-tool` and read `.agent/skills/sdlc-good/SKILL.md`.\n',
        'utf8'
      );

      const audit = auditSkills(tmpDir);
      assert.equal(audit.success, false);
      assert.equal(audit.skillsScanned, 2);
      const good = audit.skills.find((s) => s.skill === 'sdlc-good');
      const bad = audit.skills.find((s) => s.skill === 'sdlc-bad');
      assert.equal(good.findingsCount, 0);
      assert.equal(bad.findingsCount, 3);
      assert.deepEqual(bad.findings.map((f) => f.rule).sort(), ['AS3', 'FM2', 'RP1']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('renders stale/failed/passed PR summary pillars, TypeScript/unknown scaffolds, standard/truncated review plans, and risk tiers', () => {
    // TypeScript & unknown language reproduction scaffolding
    const ts = scaffoldReproductionTest({ error: 'Err */ malicious', targetFile: 'src/calc.ts', repoRoot: gitDir });
    assert.equal(ts.language, 'javascript');
    assert.match(ts.testContent, /describe/);

    const rb = scaffoldReproductionTest({ error: 'RuntimeError', targetFile: 'lib/worker.rb', repoRoot: gitDir });
    assert.equal(fs.existsSync(rb.testPath), true);

    // Risk tiers: MEDIUM source & CRITICAL auth vs LOW docs
    const med = assessRisk(['src/app.mjs', 'tests/app.test.mjs'], gitDir);
    assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(med.riskLevel));
    const secCrit = assessRisk(['src/crypto/token.mjs'], gitDir);
    assert.equal(secCrit.riskLevel, 'CRITICAL');

    // Review plan for standard lane (1 reviewer) & diff truncation
    fs.writeFileSync(path.join(gitDir, 'src/app.mjs'), 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n', 'utf8');
    const stdPlan = generateReviewPlan({ repoRoot: gitDir, lane: 'standard', maxDiffChars: 10 });
    assert.equal(stdPlan.subagentsCount, 1);
    assert.equal(stdPlan.diffTruncated, true);
    assert.equal(stdPlan.payload.Subagents[0].Role, 'PR Peer & Architecture Reviewer');

    // PR summary pillar matrices: STALE, FAILED, and PASSED with .archlens/policy.json
    fs.mkdirSync(path.join(gitDir, '.archlens'), { recursive: true });
    fs.writeFileSync(path.join(gitDir, '.archlens/policy.json'), JSON.stringify({ layers: [] }), 'utf8');
    startSession({ issueId: 89, branch: 'feature/issue-#88', lane: 'full', force: true, repoRoot: gitDir });

    updateSession({
      stage: 6,
      manifestUpdate: {
        coverageReport: '70.0%',
        coveragePassed: false,
        coverageHeadSha: headSha,
        mutationScore: '30.0%',
        mutationPassed: false,
        mutationHeadSha: headSha,
        gatePillars: {
          headSha,
          archPassed: false,
          lintPassed: false
        }
      },
      repoRoot: gitDir
    });
    const failedSummary = generatePRSummary({ issueId: 89, repoRoot: gitDir });
    assert.match(failedSummary.markdown, /❌ FAILED/);
    assert.match(failedSummary.markdown, /Violations Found/);

    updateSession({
      stage: 6,
      manifestUpdate: {
        coverageReport: '95.0%',
        coveragePassed: true,
        coverageHeadSha: '0000000000000000000000000000000000000000',
        mutationScore: '85.0%',
        mutationPassed: true,
        mutationHeadSha: headSha,
        gatePillars: {
          headSha,
          archPassed: true,
          lintPassed: true
        }
      },
      repoRoot: gitDir
    });
    const staleSummary = generatePRSummary({ issueId: 89, repoRoot: gitDir });
    assert.match(staleSummary.markdown, /STALE/);
    assert.match(staleSummary.markdown, /✅ PASSED/);
    assert.match(staleSummary.markdown, /Clean/);
  });

  it('exercises countChangedLines numstat/untracked, triageChange thresholds/keywords, resolveAdHocTargets strategies, and live auditSkills', () => {
    const triRepo = cloneSeed('sdlc-unit-triage-edge-');
    try {
      fs.writeFileSync(path.join(triRepo, 'styles.css'), 'body { color: red; }\n', 'utf8');
      execFileSync('git', ['add', '.'], { cwd: triRepo, stdio: 'pipe' });
      execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: triRepo, stdio: 'pipe' });

      // Invalid lane override throws
      assert.throws(() => triageChange({ laneOverride: 'bogus', repoRoot: triRepo }), /Invalid lane 'bogus'/);

      // Empty files with security intent upgrades to full
      const secIntent = triageChange({ diffFiles: [], intent: 'rotate jwt secret token', repoRoot: triRepo });
      assert.equal(secIntent.lane, 'full');

      // Custom config lane max lines + numstat vs untracked large file + protected doc non-trivial
      fs.mkdirSync(path.join(triRepo, '.agent'), { recursive: true });
      fs.writeFileSync(
        path.join(triRepo, '.agent/sdlc-config.json'),
        JSON.stringify({ lanes: { trivialMaxLines: 4, standardMaxLines: 10 } }),
        'utf8'
      );
      fs.mkdirSync(path.join(triRepo, 'docs/specs'), { recursive: true });
      fs.writeFileSync(path.join(triRepo, 'docs/specs/cap-01.md'), '# CAP-01\n', 'utf8');
      assert.throws(
        () => triageChange({ diffFiles: ['docs/specs/cap-01.md'], laneOverride: 'trivial', repoRoot: triRepo }),
        /requires a non-empty --reason/
      );
      const specTriage = triageChange({
        diffFiles: ['docs/specs/cap-01.md'],
        repoRoot: triRepo
      });
      assert.notEqual(specTriage.lane, 'trivial');
      const specOverride = triageChange({
        diffFiles: ['docs/specs/cap-01.md'],
        laneOverride: 'trivial',
        reason: 'docs alignment',
        repoRoot: triRepo
      });
      assert.equal(specOverride.lane, 'trivial');
      assert.equal(specOverride.downgraded, true);

      fs.writeFileSync(path.join(triRepo, 'styles.css'), 'body { color: blue; }\n', 'utf8');
      const smallCss = triageChange({ diffFiles: ['styles.css'], laneOverride: 'trivial', repoRoot: triRepo });
      assert.equal(smallCss.lane, 'trivial');

      const manyLines = Array.from({ length: 15 }, (_, i) => `export const v${i} = ${i};`).join('\n');
      fs.writeFileSync(path.join(triRepo, 'big.mjs'), manyLines, 'utf8');
      const bigTriage = triageChange({ diffFiles: ['big.mjs'], repoRoot: triRepo });
      assert.equal(bigTriage.lane, 'full');

      // resolveAdHocTargets sequential (1 cluster) vs parallel (>1 clusters)
      const seq = resolveAdHocTargets(['src/a.mjs', 'src/b.mjs']);
      assert.equal(seq.executionStrategy, 'sequential');
      assert.match(seq.recommendation, /sequentially/i);

      const par = resolveAdHocTargets(['src/a.mjs', 'scripts/b.mjs', 'tests/c.test.mjs']);
      assert.equal(par.executionStrategy, 'parallel');
      assert.match(par.recommendation, /parallel/i);

      // findAffectedTests mapping + docs-only empty
      fs.mkdirSync(path.join(triRepo, 'src'), { recursive: true });
      fs.mkdirSync(path.join(triRepo, 'tests'), { recursive: true });
      fs.writeFileSync(path.join(triRepo, 'src/calc.mjs'), 'export const add = (a, b) => a + b;\n', 'utf8');
      fs.writeFileSync(path.join(triRepo, 'tests/calc.test.mjs'), 'test("ok", ()=>{});\n', 'utf8');
      const mapped = findAffectedTests(['src/calc.mjs'], triRepo);
      assert.ok(mapped.some((f) => f.includes('calc.test.mjs')));
      assert.deepEqual(findAffectedTests(['docs/README.md'], triRepo), []);

      // generateReviewPlan trivial (0 subagents) & full (3 subagents)
      const trivPlan = generateReviewPlan({ repoRoot: triRepo, lane: 'trivial' });
      assert.equal(trivPlan.lane, 'trivial');
      assert.equal(trivPlan.subagentsCount, 0);
      assert.deepEqual(trivPlan.payload.Subagents, []);

      const fullPlan = generateReviewPlan({ repoRoot: triRepo, lane: 'full' });
      assert.equal(fullPlan.subagentsCount, 2);
      assert.equal(fullPlan.payload.Subagents[0].Role, 'PR Peer Reviewer');
      assert.equal(fullPlan.payload.Subagents[1].Role, 'Quality Gatekeeper');
      assert.match(fullPlan.payload.Subagents[0].Prompt, /Modified files/);

      fs.mkdirSync(path.join(triRepo, 'src/auth'), { recursive: true });
      fs.writeFileSync(path.join(triRepo, 'src/auth/token.mjs'), 'export const t = 1;\n', 'utf8');
      const highPlan = generateReviewPlan({ repoRoot: triRepo, lane: 'full' });
      assert.equal(highPlan.subagentsCount, 3);
      assert.equal(highPlan.payload.Subagents[2].Role, 'Security & Architectural Auditor');

      // auditSkills detects FM2, RP1, AS3 on sdlc* dirs and computes maxScore across clean + failing skills
      const badSkillDir = path.join(triRepo, '.agent/skills/sdlc-alpha');
      const goodSkillDir = path.join(triRepo, '.agent/skills/sdlc-clean');
      fs.mkdirSync(badSkillDir, { recursive: true });
      fs.mkdirSync(goodSkillDir, { recursive: true });
      fs.writeFileSync(
        path.join(badSkillDir, 'SKILL.md'),
        '---\nname: sdlc-alpha\ndescription: trailing comma,\n---\nRun npx some-pkg\nSee .agent/skills/sdlc-clean/SKILL.md\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(goodSkillDir, 'SKILL.md'),
        '---\nname: sdlc-clean\ndescription: "Clean quoted description"\n---\nUse /sdlc-alpha safely\n',
        'utf8'
      );
      const nonLiveAudit = auditSkills(triRepo, { live: false });
      assert.equal(nonLiveAudit.success, false);
      assert.equal(nonLiveAudit.skills.length, 2);
      const badRes = nonLiveAudit.skills.find((r) => r.skill === 'sdlc-alpha');
      assert.ok(badRes.findings.some((f) => f.rule === 'FM2'));
      assert.ok(badRes.findings.some((f) => f.rule === 'RP1'));
      assert.ok(badRes.findings.some((f) => f.rule === 'AS3'));
      assert.equal(badRes.score, 21);
      assert.equal(nonLiveAudit.maxScore, 21);
      assert.equal(nonLiveAudit.totalFindings, 3);

      // All 5 reproduction stack trace parsers + empty trace fallback + comment sanitization
      const j = scaffoldReproductionTest({ errorTrace: 'Boom */ evil\n  at com.app.Svc.call(src/main/java/Svc.java:42)', repoRoot: triRepo });
      assert.equal(j.language, 'java');
      assert.match(j.testContent, /\* \//);
      assert.match(j.testContent, /fail\(/);

      const py = scaffoldReproductionTest({ errorTrace: 'Trace """ bad\n  File "pkg/worker.py", line 17, in run', repoRoot: triRepo });
      assert.equal(py.language, 'python');
      assert.match(py.testContent, /def test_reproduce_worker\(\):/);
      assert.match(py.testContent, /pytest\.fail\(/);

      const goRes = scaffoldReproductionTest({ errorTrace: 'panic at pkg/router.go:29', repoRoot: triRepo });
      assert.equal(goRes.language, 'go');
      assert.match(goRes.testContent, /func TestReproducerouter\(t \*testing\.T\)/);
      assert.match(goRes.testContent, /t\.Fatalf\(/);

      const rsRes = scaffoldReproductionTest({ errorTrace: 'thread panicked at src/parser.rs:14', repoRoot: triRepo });
      assert.equal(rsRes.language, 'rust');
      assert.match(rsRes.testContent, /fn reproduce_parser\(\)/);
      assert.match(rsRes.testContent, /panic!\(/);

      const emptyRep = scaffoldReproductionTest({ errorTrace: '', repoRoot: triRepo });
      assert.match(emptyRep.testContent, /Reproduction Failure/);

      // Full generatePRSummary table branches (PENDING / N/A / SKIPPED, numeric fail, partial stale covSha, full pass)
      const noPolicyDir = cloneSeed('sdlc-unit-tr-nopol-');
      try {
        fs.mkdirSync(path.join(noPolicyDir, '.agent'), { recursive: true });
        fs.writeFileSync(path.join(noPolicyDir, '.agent/sdlc-config.json'), JSON.stringify({ gates: { minDiffCoverage: 85, minMutationScore: null } }), 'utf8');
        const nopolHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: noPolicyDir, encoding: 'utf8' }).trim();
        startSession({ issueId: 91, branch: 'feature/issue-#91', lane: 'standard', force: true, repoRoot: noPolicyDir });

        const pendSum = generatePRSummary({ issueId: 91, repoRoot: noPolicyDir });
        assert.match(pendSum.markdown, /\*\*Line & Branch Diff Coverage\*\* \| `>= 85%` \| Not Measured \| ⚪ PENDING/);
        assert.match(pendSum.markdown, /\*\*Mutation Kill Score\*\* \| `N\/A` \| Not Measured \| ⚪ N\/A/);
        assert.match(pendSum.markdown, /\*\*Archlens Clean Architecture\*\* \| 100% Policy \| N\/A \| ⚪ SKIPPED/);
        assert.match(pendSum.markdown, /\*\*Static Analysis & Linting\*\* \| 0 Violations \| Not Run \| ⏳ PENDING/);

        updateSession({
          manifestUpdate: { coverageReport: '60.0%', coverageHeadSha: nopolHead },
          repoRoot: noPolicyDir
        });
        const numFail = generatePRSummary({ issueId: 91, repoRoot: noPolicyDir });
        assert.match(numFail.markdown, /60\.0% \| ❌ FAILED/);

        updateSession({
          manifestUpdate: {
            coverageReport: '91.0%',
            coverageHeadSha: 'deadbeef00000000000000000000000000000000',
            mutationScore: '82.0%',
            mutationHeadSha: nopolHead,
            gatePillars: { headSha: nopolHead, archPassed: true, lintPassed: true }
          },
          repoRoot: noPolicyDir
        });
        fs.mkdirSync(path.join(noPolicyDir, '.archlens'), { recursive: true });
        fs.writeFileSync(path.join(noPolicyDir, '.archlens/policy.json'), '{"layers":[]}', 'utf8');
        const mixStale = generatePRSummary({ issueId: 91, repoRoot: noPolicyDir });
        assert.match(mixStale.markdown, /91\.0% \(stale prior commit\) \| ⏳ STALE \(re-run gate\)/);
        assert.match(mixStale.markdown, /82\.0% \| ✅ PASSED/);
        assert.match(mixStale.markdown, /Compliant \| ✅ PASSED/);
        assert.match(mixStale.markdown, /Clean \| ✅ PASSED/);
      } finally {
        fs.rmSync(noPolicyDir, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(triRepo, { recursive: true, force: true });
    }
  });

  it('asserts exact assessRisk scoring thresholds, countChangedLines boundaries, generateReviewPlan truncation/standard, and auditSkills FM1/live/empty paths', () => {
    // Exact score & riskLevel boundary arithmetic across all assessRisk branches
    assert.deepEqual(
      (() => {
        const res = assessRisk(['src/plain.mjs'], gitDir);
        return { score: res.score, riskLevel: res.riskLevel, totalFiles: res.totalFiles, rec: res.recommendation };
      })(),
      {
        score: 5,
        riskLevel: 'LOW',
        totalFiles: 1,
        rec: 'Standard risk profile: Standard Dual-Gate verification applies.'
      }
    );

    const medRes = assessRisk(['src/routes/users.mjs'], gitDir);
    assert.equal(medRes.score, 15);
    assert.equal(medRes.riskLevel, 'MEDIUM');
    assert.equal(medRes.factors[0].level, 'MEDIUM');
    assert.equal(medRes.factors[0].reason, 'Public API contract or endpoint controller');

    // Score >= 35 purely from MEDIUM factors promotes to HIGH; >= 60 promotes to CRITICAL
    const highFromMed = assessRisk(['src/routes/a.mjs', 'src/controller/b.mjs', 'src/usecase/c.mjs'], gitDir);
    assert.equal(highFromMed.score, 40);
    assert.equal(highFromMed.riskLevel, 'HIGH');
    assert.match(highFromMed.recommendation, /^HIGH RISK:/);

    const critFromMed = assessRisk(['src/api/1.mjs', 'src/api/2.mjs', 'src/api/3.mjs', 'src/api/4.mjs'], gitDir);
    assert.equal(critFromMed.score, 60);
    assert.equal(critFromMed.riskLevel, 'CRITICAL');
    assert.match(critFromMed.recommendation, /^CRITICAL RISK:/);

    const lockRes = assessRisk(['package-lock.json', 'src/model/item.mjs', 'src/service/run.mjs', 'src/guide.md'], gitDir);
    assert.equal(lockRes.score, 20 + 25 + 10 + 2);
    assert.equal(lockRes.riskLevel, 'HIGH');
    assert.equal(lockRes.factors[0].level, 'HIGH');
    assert.equal(lockRes.factors[1].level, 'HIGH');
    assert.equal(lockRes.factors[2].level, 'MEDIUM');
    assert.equal(lockRes.factors[3].level, 'LOW');

    const sqlRes = assessRisk(['db/001.sql', 'src/crypto/hash.mjs'], gitDir);
    assert.equal(sqlRes.score, 75);
    assert.equal(sqlRes.riskLevel, 'CRITICAL');
    assert.equal(sqlRes.factors[0].level, 'CRITICAL');
    assert.equal(sqlRes.factors[1].level, 'CRITICAL');

    // auditSkills empty/missing dir, FM1 missing name/description, clean self-ref + pinned npx, and live uvx path
    const skillTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-unit-tr-skill-'));
    try {
      const emptyAudit = auditSkills(skillTmp);
      assert.equal(emptyAudit.success, true);
      assert.equal(emptyAudit.skillsScanned, 0);
      assert.equal(emptyAudit.skillsAudited, 0);
      assert.equal(emptyAudit.totalFindings, 0);
      assert.equal(emptyAudit.maxScore, 0);
      assert.deepEqual(emptyAudit.skills, []);
      assert.equal(emptyAudit.skillspectorOutput, null);

      const fm1Dir = path.join(skillTmp, '.agent/skills/sdlc-broken');
      const okDir = path.join(skillTmp, '.agent/skills/sdlc-ok');
      fs.mkdirSync(fm1Dir, { recursive: true });
      fs.mkdirSync(okDir, { recursive: true });
      fs.writeFileSync(
        path.join(fm1Dir, 'SKILL.md'),
        '---\nname: sdlc-broken\n---\nline2\nnpx -y unpinned-tool\nref .agent/skills/sdlc-ok/SKILL.md\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(okDir, 'SKILL.md'),
        '---\nname: sdlc-ok\ndescription: "Valid quoted description"\n---\nnpx pkg@1.2.3\nself .agent/skills/sdlc-ok/SKILL.md\n',
        'utf8'
      );
      const a1 = auditSkills(skillTmp);
      assert.equal(a1.success, false);
      assert.equal(a1.skillsScanned, 2);
      const broken = a1.skills.find((s) => s.skill === 'sdlc-broken');
      const ok = a1.skills.find((s) => s.skill === 'sdlc-ok');
      assert.equal(ok.findingsCount, 0);
      assert.equal(ok.score, 0);
      assert.equal(ok.severity, 'LOW');
      assert.equal(broken.findingsCount, 3);
      assert.equal(broken.findings[0].rule, 'FM1');
      assert.equal(broken.findings[0].severity, 'MEDIUM');
      assert.match(broken.findings[0].message, /Missing required YAML frontmatter/);
      const rp1 = broken.findings.find((f) => f.rule === 'RP1');
      const as3 = broken.findings.find((f) => f.rule === 'AS3');
      assert.equal(rp1.line, 2);
      assert.equal(rp1.severity, 'MEDIUM');
      assert.match(rp1.message, /unpinned-tool/);
      assert.equal(as3.line, 3);
      assert.equal(as3.severity, 'MEDIUM');
      assert.match(as3.message, /sdlc-ok\/SKILL\.md/);

      // Live skillspector scan with local mock uvx executable on PATH
      const binDir = path.join(skillTmp, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      const uvxStub = path.join(binDir, 'uvx');
      fs.writeFileSync(uvxStub, '#!/bin/sh\necho "LIVE_UVX_OK"\n', { mode: 0o755 });
      const prevPath = process.env.PATH || '';
      process.env.PATH = `${binDir}${path.delimiter}${prevPath}`;
      try {
        const liveRes = auditSkills(skillTmp, { live: true });
        assert.match(liveRes.skillspectorOutput, /LIVE_UVX_OK/);
      } finally {
        process.env.PATH = prevPath;
      }
    } finally {
      fs.rmSync(skillTmp, { recursive: true, force: true });
    }

    // triageChange protected docs (product.md, prd.md, srs.md, adr) + numstat exact thresholds + generateReviewPlan standard & truncation
    const triBoundary = cloneSeed('sdlc-unit-tr-bnd-');
    try {
      fs.mkdirSync(path.join(triBoundary, '.agent'), { recursive: true });
      fs.mkdirSync(path.join(triBoundary, 'docs/adr'), { recursive: true });
      fs.mkdirSync(path.join(triBoundary, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(triBoundary, '.agent/sdlc-config.json'),
        JSON.stringify({ lanes: { trivialMaxLines: 3, standardMaxLines: 6 } }),
        'utf8'
      );
      fs.writeFileSync(path.join(triBoundary, 'note.md'), 'line1\n', 'utf8');
      fs.writeFileSync(path.join(triBoundary, 'src/mod.mjs'), 'export const a = 1;\n', 'utf8');
      execFileSync('git', ['add', '.'], { cwd: triBoundary, stdio: 'pipe' });
      execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: triBoundary, stdio: 'pipe' });
      execFileSync('git', ['checkout', '-q', '-b', 'feature/issue-#95'], { cwd: triBoundary, stdio: 'pipe' });

      // Protected files never eligible for trivial without --reason override
      for (const prot of ['PRODUCT.md', 'docs/PRD.md', 'docs/SRS.md', 'docs/adr/ADR-001.md']) {
        const t = triageChange({ diffFiles: [prot], repoRoot: triBoundary });
        assert.notEqual(t.lane, 'trivial', `${prot} should not auto-triage to trivial`);
      }

      // Exactly 3 changed lines in note.md stays trivial (<= trivialMaxLines)
      fs.writeFileSync(path.join(triBoundary, 'note.md'), 'line1\nline2\nline3\nline4\n', 'utf8');
      const eqTriv = triageChange({ diffFiles: ['note.md'], baseBranch: 'develop', repoRoot: triBoundary });
      assert.equal(eqTriv.changedLines, 3);
      assert.equal(eqTriv.lane, 'trivial');

      // 4 changed lines exceeds trivialMaxLines (3) -> standard; big diff truncates generateReviewPlan at 1024
      fs.writeFileSync(path.join(triBoundary, 'note.md'), 'line1\nline2\nline3\nline4\nline5\n', 'utf8');
      const overTriv = triageChange({ diffFiles: ['note.md'], baseBranch: 'develop', repoRoot: triBoundary });
      assert.equal(overTriv.changedLines, 4);
      assert.equal(overTriv.lane, 'standard');

      const hugeLines = Array.from({ length: 80 }, (_, i) => `export const val_${i} = 'payload_${i}_${'x'.repeat(20)}';`).join('\n');
      fs.writeFileSync(path.join(triBoundary, 'src/mod.mjs'), hugeLines, 'utf8');
      execFileSync('git', ['add', '.'], { cwd: triBoundary, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'big change'], { cwd: triBoundary, stdio: 'pipe' });

      const stdPlan = generateReviewPlan({ repoRoot: triBoundary, lane: 'standard', maxDiffChars: 200 });
      assert.equal(stdPlan.lane, 'standard');
      assert.equal(stdPlan.subagentsCount, 1);
      assert.equal(stdPlan.payload.Subagents[0].Role, 'PR Peer & Architecture Reviewer');
      assert.equal(stdPlan.diffTruncated, true);
      assert.match(stdPlan.diff, /\[diff truncated at 1024 chars/);
      assert.ok(stdPlan.headSha);
      assert.ok(stdPlan.baseSha);

      // Failing arch & lint pillars + numeric passing mutation score below minMut -> FAILED table rows
      startSession({ issueId: 95, branch: 'feature/issue-#95', force: true, repoRoot: triBoundary });
      const bndHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: triBoundary, encoding: 'utf8' }).trim();
      fs.writeFileSync(
        path.join(triBoundary, '.agent/sdlc-config.json'),
        JSON.stringify({ gates: { minDiffCoverage: 85, minMutationScore: 80 } }),
        'utf8'
      );
      fs.mkdirSync(path.join(triBoundary, '.archlens'), { recursive: true });
      fs.writeFileSync(path.join(triBoundary, '.archlens/policy.json'), '{"layers":[]}', 'utf8');
      updateSession({
        manifestUpdate: {
          coverageReport: '90.0%',
          mutationScore: '75.0%',
          gatePillars: { headSha: bndHead, coveragePassed: true, mutationPassed: false, archPassed: false, lintPassed: false }
        },
        repoRoot: triBoundary
      });
      const failSum = generatePRSummary({ issueId: 95, repoRoot: triBoundary });
      assert.match(failSum.markdown, /75\.0% \| ❌ FAILED/);
      assert.match(failSum.markdown, /Violations Found \| ❌ FAILED/);
    } finally {
      fs.rmSync(triBoundary, { recursive: true, force: true });
    }
  });
});
