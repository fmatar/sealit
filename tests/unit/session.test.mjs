import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { cleanGitEnv } from '../../.agent/scripts/lib/core.mjs';
import {
  getSessionPath,
  getSessionStatus,
  startSession,
  updateSession,
  switchSession,
  listSessions,
  renderDashboard,
  resumeSession,
  releaseSession,
  recordExemption,
  calculateSessionStats,
  receiptInputsFromSession,
  reconcileSessionLaneWithDiff,
  executeCompositeStage
} from '../../.agent/scripts/lib/session.mjs';

describe('Unit: session.mjs', () => {
  let tmpDir;
  let gitDir;
  let seedRepo;
  let prevPm;

  function cloneSeed(prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    fs.cpSync(seedRepo, dir, { recursive: true });
    return dir;
  }

  before(() => {
    prevPm = process.env.SDLC_PM_PROVIDER;
    process.env.SDLC_PM_PROVIDER = 'local';

    seedRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-unit-sess-seed-'));
    const gitOpts = { cwd: seedRepo, env: cleanGitEnv(), stdio: 'pipe' };
    execFileSync('git', ['init', '-q', '-b', 'develop'], gitOpts);
    execFileSync('git', ['config', 'user.email', 'test@example.com'], gitOpts);
    execFileSync('git', ['config', 'user.name', 'Test'], gitOpts);
    fs.writeFileSync(path.join(seedRepo, 'README.md'), 'init\n', 'utf8');
    execFileSync('git', ['add', '.'], gitOpts);
    execFileSync('git', ['commit', '-q', '-m', 'init'], gitOpts);

    gitDir = cloneSeed('sdlc-unit-sess-git-');
    const gdOpts = { cwd: gitDir, env: cleanGitEnv(), stdio: 'pipe' };
    fs.mkdirSync(path.join(gitDir, 'wiki'), { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'README.md'), '# Demo\n\nQuick demo readme.\n', 'utf8');
    fs.writeFileSync(path.join(gitDir, 'wiki/Home.md'), '# Home\n', 'utf8');
    execFileSync('git', ['add', '.'], gdOpts);
    execFileSync('git', ['commit', '-q', '-m', 'init-demo'], gdOpts);
    execFileSync('git', ['checkout', '-q', '-b', 'feature/issue-#101'], gdOpts);
  });

  after(() => {
    if (prevPm === undefined) delete process.env.SDLC_PM_PROVIDER;
    else process.env.SDLC_PM_PROVIDER = prevPm;
    fs.rmSync(gitDir, { recursive: true, force: true });
    fs.rmSync(seedRepo, { recursive: true, force: true });
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-unit-sess-'));
  });

  it('manages multi-session registry start, update, circuit breaker, switch, resume, dashboard, and release', () => {
    try {
      assert.throws(() => updateSession({ stage: 3, repoRoot: tmpDir }), /No active SDLC workflow session/);
      assert.deepEqual(releaseSession(tmpDir), { success: true, released: false });

      const s1 = startSession({ issueId: 11, branch: 'feature/issue-#11', lane: 'standard', repoRoot: tmpDir });
      assert.equal(s1.success, true);
      assert.equal(s1.session.lane, 'standard');

      // Concurrent session without force/worktree fails closed
      assert.throws(() => startSession({ issueId: 12, branch: 'feature/issue-#12', lane: 'full', repoRoot: tmpDir }), /already in progress/i);

      const s2 = startSession({ issueId: 12, branch: 'feature/issue-#12', lane: 'full', force: true, repoRoot: tmpDir });
      assert.equal(s2.registry.activeSessionId, 12);
      assert.equal(listSessions(tmpDir).sessions.length, 2);

      // Update & circuit breaker when returning to Stage 3 from Stage >= 6
      for (let i = 0; i < 3; i++) {
        updateSession({ stage: 6, repoRoot: tmpDir });
        updateSession({ stage: 3, repoRoot: tmpDir });
      }
      updateSession({ stage: 6, manifestUpdate: { customFlag: true }, lane: 'invalid-ignored', repoRoot: tmpDir });
      assert.throws(() => updateSession({ stage: 3, repoRoot: tmpDir }), /Circuit Breaker Tripped/i);

      const resumed = resumeSession(tmpDir);
      assert.equal(resumed.active, true);
      assert.equal(resumed.session.issueId, 12);
      assert.equal(resumed.session.manifest.customFlag, true);

      const dash = renderDashboard(resumed.session);
      assert.match(dash, /#12/);
      assert.match(dash, /CURRENT/);

      const switched = switchSession('#11', tmpDir);
      assert.equal(switched.activeSessionId, 11);
      assert.throws(() => switchSession(999, tmpDir), /does not exist/i);

      // Release one keeps remaining active session, missing returns false, releasing last cleans file
      assert.equal(releaseSession(tmpDir, 999).success, false);
      const rel11 = releaseSession(tmpDir, 11);
      assert.equal(rel11.released, true);
      assert.equal(rel11.remainingSessions, 1);

      const rel12 = releaseSession(tmpDir);
      assert.equal(rel12.released, true);
      assert.equal(rel12.remainingSessions, 0);
      assert.equal(fs.existsSync(getSessionPath(tmpDir)), false);
      assert.equal(getSessionStatus(tmpDir).active, false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('records monotonic exemptions, computes stats, extracts receipt inputs, and reconciles lanes', () => {
    try {
      const ex1 = recordExemption({ mutantId: 'm1', file: 'a.mjs', reason: 'logging', repoRoot: tmpDir });
      const ex2 = recordExemption({ mutantId: 'm2', file: 'b.mjs', reason: 'equivalent', repoRoot: tmpDir });
      assert.equal(ex1.exemption.id, 'EX-1');
      assert.equal(ex2.exemption.id, 'EX-2');

      const emptyStats = calculateSessionStats(tmpDir);
      assert.equal(emptyStats.traceEventsCount, 0);
      assert.equal(emptyStats.totalSessions, 0);

      startSession({
        issueId: 40,
        branch: 'feature/issue-#40',
        lane: 'full',
        repoRoot: tmpDir
      });
      updateSession({
        stage: 7,
        manifestUpdate: {
          coverageReport: '88.5%',
          mutationScore: 'not-configured',
          reviewers: [{ role: 'PR', verdict: 'approve', blockers: 0 }]
        },
        repoRoot: tmpDir
      });
      const sess = getSessionStatus(tmpDir).session;
      const inputs = receiptInputsFromSession(sess, { driftCheckPassed: true, repoRoot: tmpDir });
      assert.equal(inputs.coveragePct, 88.5);
      assert.equal(inputs.mutationPct, undefined);
      assert.equal(inputs.driftCheckPassed, true);

      // Trivial session touching critical security file auto-upgrades to full
      const rec = reconcileSessionLaneWithDiff({
        session: { ...sess, lane: 'trivial', issueId: 'L-1' },
        diffFiles: ['.agent/scripts/lib/security-audit.mjs'],
        repoRoot: tmpDir
      });
      assert.equal(rec.escalated, true);
      assert.equal(rec.lane, 'full');

      // No active session reconciliation
      const noSessRec = reconcileSessionLaneWithDiff({ session: null, diffFiles: [], repoRoot: tmpDir });
      assert.equal(noSessRec.escalated, false);
      assert.equal(noSessRec.session, null);

      const fullStats = calculateSessionStats(tmpDir);
      assert.equal(fullStats.activeSessionId, 40);
      assert.equal(fullStats.totalSessions, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('executes composite begin and complete stage flows with local allocation and validation', () => {
    // Clean stale session in gitDir
    fs.rmSync(path.join(gitDir, '.agent/.sdlc-session.json'), { force: true });

    assert.throws(
      () => executeCompositeStage({ action: 'begin', title: 'Missing ticket', repoRoot: gitDir }),
      /Refusing to create a remote issue/i
    );
    assert.throws(
      () => executeCompositeStage({ action: 'bogus', repoRoot: gitDir }),
      /Unknown composite stage action/i
    );

    const localBegin = executeCompositeStage({
      action: 'begin',
      localOnly: true,
      lane: 'trivial',
      title: 'Fix typo in docs',
      repoRoot: gitDir
    });
    assert.equal(localBegin.success, true);
    assert.equal(localBegin.issueId, 'L-1');
    assert.equal(localBegin.lane, 'trivial');
    assert.match(localBegin.branch, /^chore\/quick-fix-typo-in-docs/);

    const secondLocal = executeCompositeStage({
      action: 'begin',
      localOnly: true,
      lane: 'standard',
      title: 'Second local task',
      repoRoot: gitDir
    });
    assert.equal(secondLocal.issueId, 'L-2');
    assert.equal(secondLocal.lane, 'standard');

    const comp = executeCompositeStage({
      action: 'complete',
      issueId: 'L-2',
      repoRoot: gitDir
    });
    assert.equal(comp.success, true);
    assert.equal(comp.stage, 8);
    assert.equal(comp.released, true);
    releaseSession(gitDir, 'L-1');
  });

  it('supports worktree concurrent sessions, rich dashboard states, and stage transitions', () => {
    try {
      const s1 = startSession({ issueId: 201, branch: 'feature/issue-#201', type: 'fix', lane: 'standard', worktree: '/tmp/wt-201', repoRoot: tmpDir });
      const s2 = startSession({ issueId: 202, branch: 'feature/issue-#202', lane: 'full', worktree: '/tmp/wt-202', repoRoot: tmpDir });
      assert.equal(s1.session.type, 'fix');
      assert.equal(s2.session.worktree, '/tmp/wt-202');
      assert.equal(listSessions(tmpDir).sessions.length, 2);

      // Update checkpoints & remediationCount and render dashboard at stage 4 and stage 8
      updateSession({
        stage: 4,
        activeSubagents: ['reviewer-1'],
        manifestUpdate: { coverageReport: '92.0%', mutationScore: '70.0%' },
        repoRoot: tmpDir
      });
      const st4 = getSessionStatus(tmpDir).session;
      const dash4 = renderDashboard({ ...st4, remediationCount: 1 });
      assert.match(dash4, /#202/);
      assert.match(dash4, /92\.0%|Stage 4/);

      updateSession({ stage: 8, manifestUpdate: { prNumber: 500 }, repoRoot: tmpDir });
      const st8 = getSessionStatus(tmpDir).session;
      const dash8 = renderDashboard(st8);
      assert.match(dash8, /Stage 8/);

      const stats = calculateSessionStats(tmpDir);
      assert.equal(stats.totalSessions, 2);
      assert.equal(stats.completedSessions, 1);

      // Unknown stage falls back cleanly to default stage name
      const stUnknown = updateSession({ stage: 99, repoRoot: tmpDir });
      assert.equal(stUnknown.success, true);
      assert.equal(stUnknown.session.stageName, 'Intake & Specification');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('exercises hotfix start defaults, circuit breaker trip, resume, release errors/cleanup, and composite begin branches', async () => {
    const compRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-unit-sess-edge-'));
    try {
      // Inactive resume & release
      assert.deepEqual(resumeSession(compRepo), { active: false, message: 'No active session to resume.' });
      assert.deepEqual(releaseSession(compRepo), { success: true, released: false });
      assert.throws(() => updateSession({ stage: 2, repoRoot: compRepo }), /No active SDLC workflow session/);

      // Hotfix auto-branch, invalid lane fallback, laneDowngraded trim, stage 1 checkpoint
      const hot = startSession({
        issueId: 301,
        type: 'hotfix',
        lane: 'nonexistent',
        laneDowngraded: true,
        laneReason: '  emergency patch  ',
        worktree: 'wt/301',
        stage: 1,
        repoRoot: compRepo
      });
      assert.equal(hot.session.type, 'hotfix');
      assert.equal(hot.session.branch, 'hotfix/issue-#301');
      assert.equal(hot.session.lane, 'full');
      assert.equal(hot.session.laneReason, 'emergency patch');
      assert.equal(hot.session.laneDowngraded, true);
      assert.ok(hot.session.manifest.checkpoints.stage1);

      // Conflict without force or worktree throws exact message
      assert.throws(
        () => startSession({ issueId: 302, repoRoot: compRepo }),
        /Active SDLC workflow session already in progress for issue #301 on branch hotfix\/issue-#301/
      );

      // Remediation circuit breaker trips on 4th regression (stage >= 6 -> stage 3)
      updateSession({ stage: 6, repoRoot: compRepo });
      updateSession({ stage: 3, repoRoot: compRepo });
      updateSession({ stage: 6, repoRoot: compRepo });
      updateSession({ stage: 3, repoRoot: compRepo });
      updateSession({ stage: 6, repoRoot: compRepo });
      updateSession({ stage: 3, repoRoot: compRepo });
      updateSession({ stage: 6, repoRoot: compRepo });
      assert.throws(
        () => updateSession({ stage: 3, repoRoot: compRepo }),
        /Circuit Breaker Tripped: Ticket #301 has exceeded max automated remediations \(3\)/
      );

      // Update fields, incrementRemediation, renderDashboard icons, and resumeSession
      updateSession({
        stage: 5,
        stageName: 'Docs & Showcase',
        lane: 'standard',
        laneReason: 'reduced',
        laneDowngraded: true,
        activeSubagents: ['sub-1'],
        incrementRemediation: true,
        repoRoot: compRepo
      });
      const resumed = resumeSession(compRepo);
      assert.equal(resumed.active, true);
      assert.equal(resumed.nextRecommendedAction, 'Continue from Stage 5: Docs & Showcase');
      assert.match(resumed.dashboard, /✅ Stage 1:/);
      assert.match(resumed.dashboard, /▶️  Stage 5: Docs & Showcase\s+<-- CURRENT/);
      assert.match(resumed.dashboard, /⬜ Stage 8: Release & Done/);
      assert.match(resumed.dashboard, /Worktree: wt\/301/);
      assert.match(resumed.dashboard, /⚠️ Remediation Retries: 4\/3/);

      // Release missing issue, multi-session release promotion, and final session deletion
      const missRel = releaseSession(compRepo, 999);
      assert.equal(missRel.success, false);
      assert.equal(missRel.released, false);
      assert.match(missRel.error, /Ticket #999|ticket #999/i);

      startSession({ issueId: 302, branch: 'feature/issue-#302', worktree: 'wt/302', repoRoot: compRepo });
      const rel1 = releaseSession(compRepo, 301);
      assert.equal(rel1.success, true);
      assert.equal(rel1.remainingSessions, 1);
      assert.equal(rel1.activeSessionId, 302);
      const rel2 = releaseSession(compRepo, 302);
      assert.equal(rel2.success, true);
      assert.equal(rel2.remainingSessions, 0);
      assert.equal(fs.existsSync(getSessionPath(compRepo)), false);

      // Composite stage begin error guard & slug/branch construction
      fs.cpSync(path.join(seedRepo, '.git'), path.join(compRepo, '.git'), { recursive: true });
      fs.writeFileSync(path.join(compRepo, 'README.md'), 'init\n', 'utf8');

      assert.throws(
        () => executeCompositeStage({ action: 'begin', lane: 'standard', title: 'Missing Issue', repoRoot: compRepo }),
        /Refusing to create a remote issue automatically/
      );

      const hotBeg = executeCompositeStage({
        action: 'begin',
        issueId: '#310',
        type: 'hotfix',
        lane: 'full',
        title: '---Fix Critical Crash!!!---',
        checkoutBranch: true,
        repoRoot: compRepo
      });
      assert.equal(hotBeg.branch, 'hotfix/issue-#310-fix-critical-crash');
      assert.equal(hotBeg.stage, 2);

      // Composite stage pre-pr (failed drift -> receiptError, then passing drift -> receipt + complete)
      fs.mkdirSync(path.join(compRepo, '.agent'), { recursive: true });
      fs.writeFileSync(
        path.join(compRepo, '.agent/sdlc-config.json'),
        JSON.stringify({ projectManagement: { provider: 'local' }, gates: { minDiffCoverage: 85, minMutationScore: null } }),
        'utf8'
      );
      const compHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: compRepo, encoding: 'utf8' }).trim();
      updateSession({
        manifestUpdate: {
          coverageReport: '90.0%',
          peerReview: { verdict: 'approve', reviewer: '@qa', headSha: compHead }
        },
        repoRoot: compRepo
      });
      // Inject undeclared drift via pom.xml -> pre-pr reports receiptError
      fs.writeFileSync(path.join(compRepo, 'pom.xml'), '<project/>', 'utf8');
      const driftPrePr = executeCompositeStage({ action: 'pre-pr', summary: 'Blocked by drift', withUi: false, repoRoot: compRepo });
      assert.equal(driftPrePr.action, 'pre-pr');
      assert.equal(driftPrePr.receipt, null);
      assert.equal(driftPrePr.receiptError, 'Spec-drift or wiki audit failed; no receipt issued.');
      fs.rmSync(path.join(compRepo, 'pom.xml'), { force: true });

      const cleanPrePr = executeCompositeStage({ action: 'pre-pr', summary: 'Clean ship', withUi: false, repoRoot: compRepo });
      assert.equal(cleanPrePr.action, 'pre-pr');
      assert.equal(cleanPrePr.lane, 'full');
      assert.ok(cleanPrePr.receipt);
      assert.ok(cleanPrePr.decisionMapPath);

      const compDone = executeCompositeStage({ action: 'complete', issueId: '#310', prNumber: 88, repoRoot: compRepo });
      assert.equal(compDone.action, 'complete');
      assert.equal(compDone.stage, 8);
      assert.equal(compDone.released, true);

      // Empty stats, mixed stats with arch-trace.jsonl, receiptInputsFromSession, and CRITICAL auto-escalation
      const emptyStats = calculateSessionStats(compRepo);
      assert.equal(emptyStats.totalSessions, 0);
      assert.equal(emptyStats.completedSessions, 0);
      assert.equal(emptyStats.estimatedHoursSaved, 0);
      assert.equal(emptyStats.totalDollarSavingsUSD, 0);
      assert.equal(emptyStats.velocityScore, 0);
      assert.equal(emptyStats.currentStage, 'Idle');
      assert.equal(emptyStats.activeBranch, 'main');

      startSession({ issueId: 401, branch: 'feature/issue-#401', stage: 3, lane: 'trivial', repoRoot: compRepo });
      startSession({ issueId: 402, branch: 'feature/issue-#402', stage: 6, lane: 'standard', worktree: 'wt/402', repoRoot: compRepo });
      fs.writeFileSync(path.join(compRepo, '.agent/arch-trace.jsonl'), '{"id":1}\n{"id":2}\n', 'utf8');
      const mixedStats = calculateSessionStats(compRepo);
      assert.equal(mixedStats.totalSessions, 2);
      assert.equal(mixedStats.completedSessions, 1);
      assert.equal(mixedStats.estimatedHoursSaved, 3);
      assert.equal(mixedStats.totalDollarSavingsUSD, 360);
      assert.equal(mixedStats.velocityScore, 50);
      assert.equal(mixedStats.traceEventsCount, 2);
      assert.equal(mixedStats.isEstimate, true);

      const docsInputs = receiptInputsFromSession(
        { lane: 'full', manifest: { docsOnly: true, coverage: '91.5%', peerReview: { verdict: 'approve', reviewer: '@peer' } } },
        { driftCheckPassed: true, repoRoot: compRepo }
      );
      assert.equal(docsInputs.docsOnly, true);
      assert.equal(docsInputs.coveragePct, null);
      assert.equal(docsInputs.peerReviewApproved, true);
      assert.equal(docsInputs.reviewer, '@peer');

      const regInputs = receiptInputsFromSession(
        { lane: 'full', manifest: { coverage: '91.5%', peerReview: { verdict: 'request-changes', reviewer: '@sec' } } },
        { driftCheckPassed: true, repoRoot: compRepo }
      );
      assert.equal(regInputs.coveragePct, 91.5);
      assert.equal(regInputs.mutationPct, null);
      assert.equal(regInputs.peerReviewApproved, false);

      const escRec = reconcileSessionLaneWithDiff({
        session: { active: true, issueId: 401, lane: 'trivial', laneDowngraded: true },
        diffFiles: ['src/auth/jwt.mjs'],
        repoRoot: compRepo
      });
      assert.equal(escRec.escalated, true);
      assert.equal(escRec.lane, 'full');
      assert.equal(escRec.laneReason, null);
      assert.equal(escRec.laneDowngraded, false);
      const auditRaw = fs.readFileSync(path.join(compRepo, 'docs/AUDIT_CHAIN.jsonl'), 'utf8');
      assert.match(auditRaw, /"event":"LANE_AUTO_ESCALATED"/);

      // Explicit local/trivial/createIssue begin branches + missing summary pre-pr + worktree release cleanup
      releaseSession(compRepo, 401);
      releaseSession(compRepo, 402);
      const cleanBegRepo = cloneSeed('sdlc-unit-sess-clean-');
      try {
        fs.mkdirSync(path.join(cleanBegRepo, '.agent'), { recursive: true });
        fs.writeFileSync(
          path.join(cleanBegRepo, '.agent/sdlc-config.json'),
          JSON.stringify({ projectManagement: { provider: 'local' } }),
          'utf8'
        );
        execFileSync('git', ['add', '.'], { cwd: cleanBegRepo, stdio: 'pipe' });
        execFileSync('git', ['commit', '-q', '-m', 'config'], { cwd: cleanBegRepo, stdio: 'pipe' });

        const trivBeg = executeCompositeStage({
          action: 'begin',
          lane: 'trivial',
          title: 'typo Fix Deliberately Longer Than Forty Characters For Slug Truncation',
          repoRoot: cleanBegRepo
        });
        assert.equal(trivBeg.session.type, 'chore');
        assert.match(trivBeg.branch, /^chore\/quick-/);
        assert.ok(trivBeg.branch.replace('chore/quick-', '').length <= 40);
        assert.equal(trivBeg.issueId, 'L-1');
      } finally {
        fs.rmSync(cleanBegRepo, { recursive: true, force: true });
      }
      startSession({ issueId: 499, branch: 'feature/issue-#499', stage: 2, repoRoot: compRepo });
      fs.writeFileSync(path.join(compRepo, 'docs/KANBAN.md'), '# Kanban\n', 'utf8');

      // Stage 5 -> Stage 3 does NOT trip remediation circuit breaker (only stage >= 6 increments)
      updateSession({ stage: 5, repoRoot: compRepo });
      const back5 = updateSession({ stage: 3, lane: 'full', laneReason: 'escalated', laneDowngraded: false, activeSubagents: [], repoRoot: compRepo });
      assert.equal(back5.session.remediationCount, 0);
      assert.equal(back5.session.laneDowngraded, false);
      updateSession({ stage: 6, repoRoot: compRepo });
      updateSession({ stage: 7, repoRoot: compRepo });

      // Stage 1 Kanban sync + releaseSession with real git worktree directory removal
      const wtDir = path.join(compRepo, 'wt-real');
      execFileSync('git', ['worktree', 'add', '-b', 'feature/wt-real', wtDir], { cwd: compRepo, stdio: 'pipe' });
      assert.equal(fs.existsSync(wtDir), true);
      startSession({ issueId: 505, branch: 'feature/wt-real', stage: 1, worktree: 'wt-real', force: false, repoRoot: compRepo });
      const relWt = releaseSession(compRepo, 505);
      assert.equal(relWt.success, true);
      assert.equal(relWt.released, true);
      assert.equal(fs.existsSync(wtDir), false);

      // Local PM issue creation via executeCompositeStage begin --create-issue + L-1 pre-pr without summary
      const createdBeg = executeCompositeStage({
        action: 'begin',
        lane: 'standard',
        createIssue: true,
        title: 'Local PM Issue',
        summary: 'Seeded issue',
        repoRoot: compRepo
      });
      assert.equal(createdBeg.success, true);
      assert.ok(createdBeg.issueId);
      releaseSession(compRepo, createdBeg.issueId);

      // Legacy single-session updateSession key fallback and releaseSession(repoRoot, null) cleanup
      fs.writeFileSync(
        getSessionPath(compRepo),
        JSON.stringify({ active: true, branch: 'feature/legacy', stage: 2, stageName: 'Plan', manifest: { checkpoints: {} } }),
        'utf8'
      );
      const legUp = updateSession({ stage: 4, stageName: 'Testing', repoRoot: compRepo });
      assert.equal(legUp.session.stage, 4);
      const legRel = releaseSession(compRepo, null);
      assert.equal(legRel.released, true);
    } finally {
      fs.rmSync(compRepo, { recursive: true, force: true });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('receiptInputsFromSession honors mutationSkippedReason only when explicitly set by diff-scoped gate and preserves fail-closed checks', () => {
    const tmpSkipDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-unit-sess-skip-'));
    try {
      fs.mkdirSync(path.join(tmpSkipDir, '.agent'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpSkipDir, '.agent/sdlc-config.json'),
        JSON.stringify({ gates: { minDiffCoverage: 85, minMutationScore: 52 }, thresholds: { diffCoverage: 85, mutationScore: 52 } })
      );

      const unrun = receiptInputsFromSession(
        {
          lane: 'full',
          manifest: { coverageReport: '90.0%', peerReview: { verdict: 'approve', reviewer: 'alice' } }
        },
        { driftCheckPassed: true, repoRoot: tmpSkipDir }
      );
      assert.equal(unrun.mutationPct, undefined);

      const diffSkipped = receiptInputsFromSession(
        {
          lane: 'full',
          manifest: {
            coverageReport: '90.0%',
            mutationSkippedReason: 'diff-no-mutated-sources',
            gatePillars: { mutationPassed: true },
            peerReview: { verdict: 'approve', reviewer: 'alice' }
          }
        },
        { driftCheckPassed: true, repoRoot: tmpSkipDir }
      );
      assert.equal(diffSkipped.mutationPct, null);

      const failedSkip = receiptInputsFromSession(
        {
          lane: 'full',
          manifest: {
            coverageReport: '90.0%',
            mutationSkippedReason: 'diff-no-mutated-sources',
            gatePillars: { mutationPassed: false },
            peerReview: { verdict: 'approve', reviewer: 'alice' }
          }
        },
        { driftCheckPassed: true, repoRoot: tmpSkipDir }
      );
      assert.equal(failedSkip.mutationPct, undefined);

      const skipGitOpts = { cwd: tmpSkipDir, env: cleanGitEnv(), encoding: 'utf8', stdio: 'pipe' };
      execFileSync('git', ['init', '-q', '-b', 'develop'], skipGitOpts);
      execFileSync('git', ['config', 'user.email', 'test@example.com'], skipGitOpts);
      execFileSync('git', ['config', 'user.name', 'Test'], skipGitOpts);
      execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], skipGitOpts);
      const curSha = execFileSync('git', ['rev-parse', 'HEAD'], skipGitOpts).trim();

      const staleSkipSha = receiptInputsFromSession(
        {
          lane: 'full',
          manifest: {
            coverageReport: '90.0%',
            mutationSkippedReason: 'diff-no-mutated-sources',
            mutationHeadSha: 'deadbeef1234',
            gatePillars: { mutationPassed: true },
            peerReview: { verdict: 'approve', reviewer: 'alice' }
          }
        },
        { driftCheckPassed: true, repoRoot: tmpSkipDir }
      );
      assert.equal(staleSkipSha.mutationPct, undefined);

      const matchingSkipSha = receiptInputsFromSession(
        {
          lane: 'full',
          manifest: {
            coverageReport: '90.0%',
            mutationSkippedReason: 'diff-zero-mutants',
            mutationHeadSha: curSha,
            gatePillars: { mutationPassed: true },
            peerReview: { verdict: 'approve', reviewer: 'alice' }
          }
        },
        { driftCheckPassed: true, repoRoot: tmpSkipDir }
      );
      assert.equal(matchingSkipSha.mutationPct, null);

      const measured = receiptInputsFromSession(
        {
          lane: 'full',
          manifest: {
            coverageReport: '90.0%',
            mutationScore: '54.7%',
            peerReview: { verdict: 'approve', reviewer: 'alice' }
          }
        },
        { driftCheckPassed: true, repoRoot: tmpSkipDir }
      );
      assert.equal(measured.mutationPct, 54.7);
    } finally {
      fs.rmSync(tmpSkipDir, { recursive: true, force: true });
    }
  });
});
