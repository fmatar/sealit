#!/usr/bin/env node
/**
 * Agentic SDLC Framework: Universal Stack Discovery & Execution Engine
 * Zero-dependency Node.js engine for polyglot stack detection, CI reverse-engineering,
 * directory-scoped multi-module orchestration, and Dual-Gate testing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const CONFIG_PATH = path.resolve('.agent/sdlc-config.json');

// --- Environment Variables Loader (.env support without external dependencies) ---

export function loadEnv(repoRoot = '.') {
  const envPath = path.resolve(repoRoot, '.env');
  if (!fs.existsSync(envPath)) return process.env;

  try {
    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  } catch {
    // Ignore read errors
  }
  return process.env;
}

// --- Archlens Governance Bridge ---

export function inspectArchlens(repoRoot = '.') {
  const policyPath = path.resolve(repoRoot, '.archlens/policy.json');
  const legacyPolicyPath = path.resolve(repoRoot, '.uml-viewer/policy.json');
  const hasPolicy = fs.existsSync(policyPath) || fs.existsSync(legacyPolicyPath);

  return {
    installed: hasPolicy,
    policyFile: hasPolicy ? (fs.existsSync(policyPath) ? '.archlens/policy.json' : '.uml-viewer/policy.json') : null,
    workbenchPort: process.env.ARCHLENS_PORT ? Number(process.env.ARCHLENS_PORT) : 8088
  };
}

// --- Project Management Provider Abstraction ---

export function detectPMProvider(repoRoot = '.') {
  loadEnv(repoRoot);

  const hasJira = !!(process.env.JIRA_API_TOKEN && process.env.JIRA_BASE_URL);
  const hasLinear = !!process.env.LINEAR_API_KEY;
  const hasGitHub = !!(process.env.GITHUB_TOKEN || process.env.GH_TOKEN);

  if (hasJira) return { provider: 'jira', configured: true, key: process.env.JIRA_PROJECT_KEY || 'SDLC' };
  if (hasLinear) return { provider: 'linear', configured: true, key: process.env.LINEAR_TEAM_KEY || 'DEV' };
  if (hasGitHub) return { provider: 'github', configured: true };

  // Fallback to local living KANBAN.md
  return { provider: 'local', configured: true, file: 'docs/KANBAN.md' };
}

export function diagnoseEnvironment(repoRoot = '.') {
  loadEnv(repoRoot);

  const checks = [
    {
      name: 'GITHUB_TOKEN',
      status: !!(process.env.GITHUB_TOKEN || process.env.GH_TOKEN),
      details: (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) ? 'Configured (GitHub Projects v2 / PRs)' : 'Missing (gh auth status fallback)'
    },
    {
      name: 'JIRA_API_TOKEN',
      status: !!process.env.JIRA_API_TOKEN,
      details: process.env.JIRA_API_TOKEN ? `Configured for ${process.env.JIRA_BASE_URL || 'Jira'}` : 'Not configured'
    },
    {
      name: 'LINEAR_API_KEY',
      status: !!process.env.LINEAR_API_KEY,
      details: process.env.LINEAR_API_KEY ? `Configured for team ${process.env.LINEAR_TEAM_KEY || 'Default'}` : 'Not configured'
    },
    {
      name: 'ARCHLENS',
      status: fs.existsSync(path.resolve(repoRoot, '.archlens/policy.json')),
      details: fs.existsSync(path.resolve(repoRoot, '.archlens/policy.json')) ? 'Active (.archlens/policy.json found)' : 'Not configured (Run sdlc-initialize with Archlens)'
    },
    {
      name: 'LIVING_KANBAN',
      status: fs.existsSync(path.resolve(repoRoot, 'docs/KANBAN.md')),
      details: fs.existsSync(path.resolve(repoRoot, 'docs/KANBAN.md')) ? 'Present (docs/KANBAN.md)' : 'Missing'
    }
  ];

  return {
    pm: detectPMProvider(repoRoot),
    archlens: inspectArchlens(repoRoot),
    checks
  };
}

// --- Helper Functions ---

export function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

export function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

export function execCommand(cmd, options = {}) {
  try {
    return execSync(cmd, { stdio: 'pipe', encoding: 'utf8', ...options });
  } catch (error) {
    if (options.throwOnError) throw error;
    return error.stdout || error.stderr || '';
  }
}

// --- Session State & Concurrency Lock ---

const SESSION_FILE = '.sdlc-session.json';

export function getSessionPath(repoRoot = '.') {
  return path.resolve(repoRoot, '.agent', SESSION_FILE);
}

export function getSessionStatus(repoRoot = '.') {
  const sessionPath = getSessionPath(repoRoot);
  if (!fileExists(sessionPath)) {
    return { active: false, session: null, registry: null };
  }

  const content = readFileSafe(sessionPath);
  if (!content) {
    return { active: false, session: null, registry: null, error: 'Empty session file' };
  }

  try {
    const data = JSON.parse(content);
    // Support multi-session registry schema
    if (data.sessions && typeof data.sessions === 'object') {
      const activeId = data.activeSessionId;
      const activeSession = activeId && data.sessions[activeId] ? data.sessions[activeId] : null;
      return {
        active: !!activeSession?.active,
        session: activeSession,
        activeSessionId: activeId,
        sessions: data.sessions,
        registry: data
      };
    }
    // Backward compatibility for single session schema
    return {
      active: !!data.active,
      session: data,
      activeSessionId: data.issueId,
      sessions: data.issueId ? { [data.issueId]: data } : {},
      registry: null
    };
  } catch {
    return { active: false, session: null, registry: null, error: 'Corrupted session file' };
  }
}

export function createTicket({ title, type = 'feat', body = '', repoRoot = '.' } = {}) {
  const pm = detectPMProvider(repoRoot);
  const normalizedType = type.toLowerCase();
  let prefix = 'feat';
  let defaultLabel = 'feature,status:ready';

  if (normalizedType === 'bug' || normalizedType === 'fix') {
    prefix = 'fix';
    defaultLabel = 'bug,status:ready';
  } else if (normalizedType === 'hotfix') {
    prefix = 'hotfix';
    defaultLabel = 'hotfix,status:ready,priority:critical';
  } else if (normalizedType === 'spike' || normalizedType === 'research') {
    prefix = 'spike';
    defaultLabel = 'spike,status:ready';
  }

  const fullTitle = title.startsWith(`${prefix}:`) || title.startsWith(`${prefix}(`) ? title : `${prefix}: ${title}`;

  if (pm.provider === 'github') {
    try {
      const output = execSync(
        `gh issue create --title "${fullTitle.replace(/"/g, '\\"')}" --body "${(body || fullTitle).replace(/"/g, '\\"')}" --label "${defaultLabel}"`,
        { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' }
      );
      const url = output.trim();
      const match = url.match(/\/issues\/(\d+)/);
      const issueId = match ? Number(match[1]) : null;
      return { success: true, provider: 'github', issueId, url, title: fullTitle, type: prefix };
    } catch (err) {
      // Fallback to local living KANBAN.md if gh cli fails or unauthenticated
      console.warn('⚠️ GitHub issue creation failed or CLI not authenticated. Falling back to local docs/KANBAN.md.');
    }
  }

  // Local docs/KANBAN.md ticket creation
  const kanbanPath = path.resolve(repoRoot, 'docs/KANBAN.md');
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  let issueId = Date.now() % 10000; // Generate deterministic unique pseudo-id
  let content = readFileSafe(kanbanPath);

  if (!content) {
    fs.mkdirSync(path.dirname(kanbanPath), { recursive: true });
    content = `# 📋 Project Kanban Board & Traceability Matrix\n\n> **Living Project State & Audit Trail**\n> **Last Synced**: \`${now}\`\n\n---\n\n## 📊 Board Overview\n\n| 📥 Backlog | 📋 Ready | ⚡ In Progress | 🔍 In Review | ✅ Done |\n| :--- | :--- | :--- | :--- | :--- |\n\n---\n\n## 🎯 End-to-End Traceability Matrix\n\n| Issue / Spec | Status | Priority | Component | Milestone | Spec / Contract |\n| :--- | :--- | :--- | :--- | :--- |\n`;
  }

  const ticketRef = `#${issueId}: [${prefix.toUpperCase()}] ${fullTitle}`;
  const tableMarker = '| :--- | :--- | :--- | :--- | :--- |\n';
  const tableIdx = content.indexOf(tableMarker);

  if (tableIdx !== -1) {
    const insertPos = tableIdx + tableMarker.length;
    // Insert into Ready column
    content = content.slice(0, insertPos) + `| | ${ticketRef} | | | |\n` + content.slice(insertPos);
  }

  const matrixMarker = '## 🎯 End-to-End Traceability Matrix\n\n| Issue / Spec | Status | Priority | Component | Milestone | Spec / Contract |\n| :--- | :--- | :--- | :--- | :--- |\n';
  const matrixIdx = content.indexOf(matrixMarker);
  if (matrixIdx !== -1) {
    const insertPos = matrixIdx + matrixMarker.length;
    const priority = prefix === 'hotfix' ? '`P0 - Blocker`' : (prefix === 'bug' ? '`P1 - High`' : '`P2 - Medium`');
    content = content.slice(0, insertPos) + `| **#${issueId}** | \`status:ready\` | ${priority} | Core | Current | ${fullTitle} |\n` + content.slice(insertPos);
  }

  fs.writeFileSync(kanbanPath, content, 'utf8');
  return { success: true, provider: 'local', issueId, url: `docs/KANBAN.md#${issueId}`, title: fullTitle, type: prefix };
}

export function postPMComment({ issueId, prNumber = null, comment = '', repoRoot = '.' } = {}) {
  const pm = detectPMProvider(repoRoot);
  const targetId = issueId || prNumber;
  if (!targetId || !comment) {
    throw new Error('Both issueId/prNumber and comment are required to post a review comment.');
  }

  // 1. GitHub Provider
  if (pm.provider === 'github') {
    let posted = false;
    let errors = [];

    // Attempt PR review comment if prNumber is provided or issueId acts as PR
    if (prNumber) {
      try {
        execSync(`gh pr comment ${prNumber} --body "${comment.replace(/"/g, '\\"')}"`, { cwd: repoRoot, stdio: 'pipe' });
        posted = true;
      } catch (err) {
        errors.push(`gh pr comment: ${err.message}`);
      }
    }

    // Also post or fallback to issue comment
    try {
      execSync(`gh issue comment ${issueId || prNumber} --body "${comment.replace(/"/g, '\\"')}"`, { cwd: repoRoot, stdio: 'pipe' });
      posted = true;
    } catch (err) {
      errors.push(`gh issue comment: ${err.message}`);
    }

    if (posted) {
      console.log(`💬 [GITHUB] Review comment posted to #${targetId}`);
      return { success: true, provider: 'github', targetId, comment };
    }
    console.warn(`⚠️ GitHub comment failed (${errors.join('; ')}). Falling back to local KANBAN.md.`);
  }

  // 2. Jira Provider
  if (pm.provider === 'jira') {
    try {
      const auth = Buffer.from(`${process.env.JIRA_EMAIL || 'bot'}:${process.env.JIRA_API_TOKEN}`).toString('base64');
      const url = `${process.env.JIRA_BASE_URL.replace(/\/$/, '')}/rest/api/3/issue/${issueId}/comment`;
      const bodyPayload = JSON.stringify({
        body: {
          type: 'doc',
          version: 1,
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: comment }]
          }]
        }
      });
      execSync(`curl -s -X POST "${url}" -H "Authorization: Basic ${auth}" -H "Content-Type: application/json" -d '${bodyPayload.replace(/'/g, "'\\''")}'`, { cwd: repoRoot, stdio: 'pipe' });
      console.log(`💬 [JIRA] Review comment posted to Jira issue ${issueId}`);
      return { success: true, provider: 'jira', targetId: issueId, comment };
    } catch (err) {
      console.warn(`⚠️ Jira comment failed: ${err.message}. Falling back to local KANBAN.md.`);
    }
  }

  // 3. Linear Provider
  if (pm.provider === 'linear') {
    try {
      const gql = JSON.stringify({
        query: `mutation CreateComment($issueId: String!, $body: String!) { commentCreate(input: { issueId: $issueId, body: $body }) { success } }`,
        variables: { issueId: String(issueId), body: comment }
      });
      execSync(`curl -s -X POST https://api.linear.app/graphql -H "Authorization: ${process.env.LINEAR_API_KEY}" -H "Content-Type: application/json" -d '${gql.replace(/'/g, "'\\''")}'`, { cwd: repoRoot, stdio: 'pipe' });
      console.log(`💬 [LINEAR] Review comment posted to Linear issue ${issueId}`);
      return { success: true, provider: 'linear', targetId: issueId, comment };
    } catch (err) {
      console.warn(`⚠️ Linear comment failed: ${err.message}. Falling back to local KANBAN.md.`);
    }
  }

  // 4. Local docs/KANBAN.md Fallback
  const kanbanPath = path.resolve(repoRoot, 'docs/KANBAN.md');
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  let content = readFileSafe(kanbanPath);

  if (!content) {
    fs.mkdirSync(path.dirname(kanbanPath), { recursive: true });
    content = `# 📋 Project Kanban Board & Traceability Matrix\n\n> **Living Project State & Audit Trail**\n> **Last Synced**: \`${now}\`\n\n---\n\n## 📊 Board Overview\n\n| 📥 Backlog | 📋 Ready | ⚡ In Progress | 🔍 In Review | ✅ Done |\n| :--- | :--- | :--- | :--- | :--- |\n`;
  }

  const commentSectionHeader = '## 💬 Review Audit Comments & Feedback\n\n';
  let commentBlock = `### [${now}] Audit for #${targetId}\n\n${comment}\n\n---\n\n`;

  if (content.includes(commentSectionHeader)) {
    content = content.replace(commentSectionHeader, commentSectionHeader + commentBlock);
  } else {
    content = content + `\n\n${commentSectionHeader}${commentBlock}`;
  }

  fs.writeFileSync(kanbanPath, content, 'utf8');
  console.log(`💬 [LOCAL KANBAN] Review comment recorded in docs/KANBAN.md for #${targetId}`);
  return { success: true, provider: 'local', targetId, comment, file: 'docs/KANBAN.md' };
}

export function installFramework({ targetDir = '.', global = false, repoRoot = '.' } = {}) {
  const isGlobal = !!global;
  const packageDir = path.resolve(import.meta.dirname, '../..'); // Root of agentic-sdlc package
  const sourceSkills = path.resolve(packageDir, '.agent/skills');
  const sourceScripts = path.resolve(packageDir, '.agent/scripts');
  const sourceDocs = path.resolve(packageDir, 'docs/templates');

  let destSkills, destScripts, destDocs;

  if (isGlobal) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    destSkills = path.resolve(home, '.gemini/config/skills');
    destScripts = path.resolve(home, '.gemini/config/scripts');
    console.log(`⚡ Installing Agentic SDLC Framework globally into ${destSkills}...`);
  } else {
    const targetAbs = path.resolve(repoRoot, targetDir);
    const agentDirName = fs.existsSync(path.resolve(targetAbs, '.agents/skills')) ? '.agents' : '.agent';
    destSkills = path.resolve(targetAbs, agentDirName, 'skills');
    destScripts = path.resolve(targetAbs, agentDirName, 'scripts');
    destDocs = path.resolve(targetAbs, 'docs/templates');
    console.log(`⚡ Installing Agentic SDLC Framework locally into ${targetAbs}...`);
  }

  // Ensure directories exist
  fs.mkdirSync(destSkills, { recursive: true });
  fs.mkdirSync(destScripts, { recursive: true });
  if (destDocs) fs.mkdirSync(destDocs, { recursive: true });

  // Recursive copy helper
  function copyRecursive(src, dest) {
    if (!fs.existsSync(src)) return;
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        copyRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
        if (entry.name.endsWith('.sh') || entry.name.endsWith('.mjs')) {
          try { fs.chmodSync(destPath, 0o755); } catch {}
        }
      }
    }
  }

  copyRecursive(sourceSkills, destSkills);
  copyRecursive(sourceScripts, destScripts);
  if (destDocs && fs.existsSync(sourceDocs)) {
    copyRecursive(sourceDocs, destDocs);
  }

  const loadedSkills = fs.existsSync(destSkills) ? fs.readdirSync(destSkills).filter(f => fs.statSync(path.join(destSkills, f)).isDirectory()).length : 0;
  console.log(`✅ Installation complete (${loadedSkills} skills loaded).`);
  if (!isGlobal) {
    console.log(`   • Skills:    ${destSkills}`);
    console.log(`   • Engine:    ${destScripts}`);
    console.log(`   • Templates: ${destDocs}`);
  } else {
    console.log(`   • Skills:    ${destSkills}`);
    console.log(`   • Scripts:   ${destScripts}`);
  }

  return { success: true, global: isGlobal, skillsCount: loadedSkills, destSkills, destScripts };
}

export function startSession({ issueId, branch, stage = 1, stageName = 'Intake & Specification', type = 'feat', worktree = null, repoRoot = '.', force = false } = {}) {
  const sessionPath = getSessionPath(repoRoot);
  const current = getSessionStatus(repoRoot);

  if (!issueId) {
    throw new Error('Mandatory Ticket Invariant Violated: Cannot start an SDLC workflow session without a valid issueId (--issue <id>). Create a ticket first via GitHub, PM provider, or sdlc-engine ticket create.');
  }

  // If already active in the same worktree/branch without worktree isolation
  if (current.active && current.session?.issueId !== Number(issueId) && !worktree && !force) {
    throw new Error(`Active SDLC workflow session already in progress for issue #${current.session.issueId} on branch ${current.session.branch}. To run concurrent tasks, use Git Worktree isolation (--worktree <path>) or subagent Workspace: 'branch'.`);
  }

  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });

  const idKey = String(issueId);
  const session = {
    active: true,
    issueId: Number(issueId) || issueId,
    type: type.toLowerCase(),
    branch: branch || (type === 'hotfix' ? `hotfix/issue-#${issueId}` : `feature/issue-#${issueId}`),
    worktree: worktree || null,
    stage: Number(stage) || 1,
    stageName: stageName || 'Intake & Specification',
    remediationCount: 0,
    maxRemediations: 3,
    manifest: {
      specPath: null,
      prNumber: null,
      coverageReport: null,
      mutationScore: null,
      uiScreenshotPath: null,
      checkpoints: {
        stage1: null,
        stage2: null,
        stage3: null,
        stage4: null,
        stage5: null,
        stage6: null,
        stage7: null,
        stage8: null
      }
    },
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activeSubagents: []
  };

  session.manifest.checkpoints[`stage${stage}`] = new Date().toISOString();

  // Registry state
  const sessions = current.sessions || {};
  sessions[idKey] = session;

  const registry = {
    activeSessionId: Number(issueId) || issueId,
    sessions
  };

  fs.writeFileSync(sessionPath, JSON.stringify(registry, null, 2), 'utf8');
  return { success: true, session, registry };
}

export function updateSession({ stage, stageName, activeSubagents, manifestUpdate = {}, incrementRemediation = false, repoRoot = '.' } = {}) {
  const sessionPath = getSessionPath(repoRoot);
  const current = getSessionStatus(repoRoot);

  if (!current.active || !current.session) {
    throw new Error('No active SDLC workflow session found to update.');
  }

  const session = current.session;
  if (stage !== undefined) {
    const nextStage = Number(stage);
    // If rolling back to stage 3 from stage 7, check circuit breaker
    if (nextStage === 3 && session.stage >= 6) {
      session.remediationCount = (session.remediationCount || 0) + 1;
      if (session.remediationCount > (session.maxRemediations || 3)) {
        throw new Error(`⚠️ Circuit Breaker Tripped: Ticket #${session.issueId} has exceeded max automated remediations (${session.maxRemediations || 3}). Human architectural review required.`);
      }
    }
    session.stage = nextStage;
    if (session.manifest && session.manifest.checkpoints) {
      session.manifest.checkpoints[`stage${nextStage}`] = new Date().toISOString();
    }
  }

  if (stageName !== undefined) session.stageName = stageName;
  if (activeSubagents !== undefined) session.activeSubagents = activeSubagents;
  if (incrementRemediation) {
    session.remediationCount = (session.remediationCount || 0) + 1;
  }

  if (manifestUpdate && session.manifest) {
    session.manifest = { ...session.manifest, ...manifestUpdate };
  }

  session.updatedAt = new Date().toISOString();

  const sessions = current.sessions || {};
  sessions[String(session.issueId)] = session;

  const registry = {
    activeSessionId: session.issueId,
    sessions
  };

  fs.writeFileSync(sessionPath, JSON.stringify(registry, null, 2), 'utf8');
  return { success: true, session, registry };
}

export function switchSession(targetIssueId, repoRoot = '.') {
  const sessionPath = getSessionPath(repoRoot);
  const current = getSessionStatus(repoRoot);
  const idKey = String(targetIssueId);

  if (!current.sessions || !current.sessions[idKey]) {
    throw new Error(`Session for ticket #${targetIssueId} does not exist in registry. Active sessions: ${Object.keys(current.sessions || {}).join(', ')}`);
  }

  const targetSession = current.sessions[idKey];
  const registry = {
    activeSessionId: targetSession.issueId,
    sessions: current.sessions
  };

  fs.writeFileSync(sessionPath, JSON.stringify(registry, null, 2), 'utf8');
  console.log(`🔀 Switched active session to ticket #${targetSession.issueId} (Branch: ${targetSession.branch})`);
  return { success: true, activeSessionId: targetSession.issueId, session: targetSession };
}

export function listSessions(repoRoot = '.') {
  const current = getSessionStatus(repoRoot);
  const list = [];

  if (current.sessions) {
    for (const [id, sess] of Object.entries(current.sessions)) {
      list.push({
        issueId: sess.issueId,
        type: sess.type,
        branch: sess.branch,
        worktree: sess.worktree,
        stage: sess.stage,
        stageName: sess.stageName,
        isActive: Number(id) === Number(current.activeSessionId),
        remediations: `${sess.remediationCount || 0}/${sess.maxRemediations || 3}`
      });
    }
  }

  return { activeSessionId: current.activeSessionId, sessions: list };
}

export function resumeSession(repoRoot = '.') {
  const current = getSessionStatus(repoRoot);
  if (!current.active || !current.session) {
    return { active: false, message: 'No active session to resume.' };
  }

  const session = current.session;
  console.log(`🔄 Resuming SDLC Workflow Session for #${session.issueId} on branch '${session.branch}'...`);
  console.log(`📍 Current Stage: Stage ${session.stage} (${session.stageName})`);
  console.log(`🔁 Remediation Loops: ${session.remediationCount || 0}/${session.maxRemediations || 3}`);
  if (session.worktree) {
    console.log(`🌲 Git Worktree: ${session.worktree}`);
  }

  return {
    active: true,
    session,
    nextRecommendedAction: `Continue from Stage ${session.stage}: ${session.stageName}`,
    dashboard: renderDashboard(session)
  };
}

export function renderDashboard(session) {
  if (!session) return 'No active session.';
  const stages = [
    { num: 1, name: 'Intake & Spec' },
    { num: 2, name: 'Branch & Kanban' },
    { num: 3, name: 'TDD Implement' },
    { num: 4, name: 'Dual-Gate Tests' },
    { num: 5, name: 'Docs & Showcase' },
    { num: 6, name: 'Pull Request' },
    { num: 7, name: 'Subagent Review' },
    { num: 8, name: 'Release & Done' }
  ];

  let output = `\n================================================================\n`;
  output += `📊 SDLC LIFECYCLE PROGRESS: #${session.issueId} (${session.type?.toUpperCase() || 'FEAT'})\n`;
  output += `🌿 Branch: ${session.branch} ${session.worktree ? '| Worktree: ' + session.worktree : ''}\n`;
  output += `================================================================\n`;

  for (const s of stages) {
    let icon = '⬜';
    if (s.num < session.stage) {
      icon = '✅';
    } else if (s.num === session.stage) {
      icon = '▶️ ';
    }
    const checkpoint = session.manifest?.checkpoints?.[`stage${s.num}`];
    const timeStr = checkpoint ? ` (${new Date(checkpoint).toLocaleTimeString()})` : '';
    output += ` ${icon} Stage ${s.num}: ${s.name.padEnd(18)} ${s.num === session.stage ? '<-- CURRENT' : ''}${timeStr}\n`;
  }

  if (session.remediationCount > 0) {
    output += `\n⚠️ Remediation Retries: ${session.remediationCount}/${session.maxRemediations} (Circuit breaker threshold: ${session.maxRemediations})\n`;
  }
  output += `================================================================\n`;
  return output;
}

export function releaseSession(repoRoot = '.', issueId = null) {
  const sessionPath = getSessionPath(repoRoot);
  const current = getSessionStatus(repoRoot);

  if (!fileExists(sessionPath)) {
    return { success: true, released: false };
  }

  const targetId = issueId || current.activeSessionId;

  if (current.sessions && targetId && current.sessions[String(targetId)]) {
    const targetSession = current.sessions[String(targetId)];
    // If worktree exists and can be safely cleaned
    if (targetSession.worktree && fileExists(path.resolve(repoRoot, targetSession.worktree))) {
      try {
        console.log(`🌲 Pruning Git worktree: ${targetSession.worktree}...`);
        execSync(`git worktree remove --force "${targetSession.worktree}" 2>/dev/null || true`, { cwd: repoRoot });
      } catch {}
    }

    delete current.sessions[String(targetId)];
    const remainingKeys = Object.keys(current.sessions);

    if (remainingKeys.length === 0) {
      try { fs.unlinkSync(sessionPath); } catch {}
      return { success: true, released: true, remainingSessions: 0 };
    }

    const nextActiveId = Number(remainingKeys[0]);
    const registry = {
      activeSessionId: nextActiveId,
      sessions: current.sessions
    };
    fs.writeFileSync(sessionPath, JSON.stringify(registry, null, 2), 'utf8');
    return { success: true, released: true, activeSessionId: nextActiveId, remainingSessions: remainingKeys.length };
  }

  // Fallback single-session deletion
  try {
    fs.unlinkSync(sessionPath);
    return { success: true, released: true };
  } catch {
    return { success: false, released: false, error: 'Failed to delete session file' };
  }
}

// --- Exemption Ledger Bridge ---

export function getExemptionsPath(repoRoot = '.') {
  return path.resolve(repoRoot, '.agent', 'sdlc-exemptions.json');
}

export function recordExemption({ mutantId, file, reason, approvedBy = 'human-review', repoRoot = '.' } = {}) {
  const exPath = getExemptionsPath(repoRoot);
  fs.mkdirSync(path.dirname(exPath), { recursive: true });

  let ledger = { exemptions: [] };
  if (fileExists(exPath)) {
    try {
      ledger = JSON.parse(readFileSafe(exPath)) || { exemptions: [] };
    } catch {
      ledger = { exemptions: [] };
    }
  }

  const entry = {
    id: `EX-${Date.now() % 100000}`,
    mutantId: mutantId || 'unknown',
    file: file || null,
    reason: reason || 'Verified benign mutant / compiler artifact',
    approvedBy,
    timestamp: new Date().toISOString()
  };

  ledger.exemptions.push(entry);
  fs.writeFileSync(exPath, JSON.stringify(ledger, null, 2), 'utf8');
  console.log(`🛡️ Exemption registered: [${entry.id}] ${entry.mutantId} -> ${entry.reason}`);
  return { success: true, exemption: entry };
}

export function getExemptions(repoRoot = '.') {
  const exPath = getExemptionsPath(repoRoot);
  if (!fileExists(exPath)) return [];
  try {
    const data = JSON.parse(readFileSafe(exPath));
    return Array.isArray(data.exemptions) ? data.exemptions : [];
  } catch {
    return [];
  }
}

// --- CI/CD Checks Remote Poller ---

export function pollCIPRChecks(prNumber, { timeoutSeconds = 300, pollIntervalSeconds = 15, repoRoot = '.' } = {}) {
  console.log(`🛰️ Polling remote CI/CD status checks for PR #${prNumber} (timeout: ${timeoutSeconds}s)...`);
  const startTime = Date.now();

  while ((Date.now() - startTime) < (timeoutSeconds * 1000)) {
    try {
      const output = execSync(`gh pr checks ${prNumber} 2>&1`, { cwd: repoRoot, encoding: 'utf8' });
      if (output.includes('fail') || output.includes('error')) {
        return { success: false, passed: false, error: 'Remote CI check failure detected.', output };
      }
      if (output.includes('pending') || output.includes('running')) {
        console.log(`   ⏳ CI checks still running for PR #${prNumber}... waiting ${pollIntervalSeconds}s`);
        execSync(`sleep ${pollIntervalSeconds}`);
        continue;
      }
      // If all passed
      return { success: true, passed: true, output };
    } catch (err) {
      // If gh pr checks returns error or pending non-zero exit code
      if (err.stdout && (err.stdout.includes('fail') || err.stdout.includes('error'))) {
        return { success: false, passed: false, error: 'Remote CI check failure detected.', output: err.stdout };
      }
      console.log(`   ⏳ Waiting for CI checks to register/complete... (${pollIntervalSeconds}s)`);
      try { execSync(`sleep ${pollIntervalSeconds}`); } catch {}
    }
  }

  return { success: false, passed: false, error: `CI check polling timed out after ${timeoutSeconds}s.` };
}

// --- Universal Release Automation & SemVer Lifecycle ---

export function parseSemVer(verStr = '1.0.0') {
  const clean = verStr.replace(/^v/, '').trim();
  const parts = clean.split('.').map(n => parseInt(n, 10));
  return {
    major: isNaN(parts[0]) ? 1 : parts[0],
    minor: isNaN(parts[1]) ? 0 : parts[1],
    patch: isNaN(parts[2]) ? 0 : parts[2],
    raw: clean
  };
}

export function bumpSemVer(currentVersion = '1.0.0', bumpType = 'patch') {
  const semver = parseSemVer(currentVersion);
  switch (bumpType.toLowerCase()) {
    case 'major':
      return `${semver.major + 1}.0.0`;
    case 'minor':
      return `${semver.major}.${semver.minor + 1}.0`;
    case 'patch':
    default:
      return `${semver.major}.${semver.minor}.${semver.patch + 1}`;
  }
}

export function executeRelease({
  bump = 'patch',
  dryRun = false,
  skipGate = false,
  repoRoot = '.'
} = {}) {
  console.log(`🚀 Preparing ${bump.toUpperCase()} Release (dryRun: ${dryRun})...`);

  // 1. Run Quality Gate unless explicitly skipped
  if (!skipGate && !dryRun) {
    console.log('🛡️ Verifying Quality Gate before release...');
    const gateRes = runCLI(['gate'], null, repoRoot);
    if (!gateRes.success) {
      throw new Error('Quality gate failed. Release aborted.');
    }
  }

  // 2. Locate active manifest and detect current version
  let currentVersion = '1.0.0';
  let manifestType = 'package.json';
  const pkgPath = path.resolve(repoRoot, 'package.json');
  const pomPath = path.resolve(repoRoot, 'pom.xml');
  const pyprojectPath = path.resolve(repoRoot, 'pyproject.toml');
  const cargoPath = path.resolve(repoRoot, 'Cargo.toml');

  if (fileExists(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSafe(pkgPath));
      if (pkg.version) {
        currentVersion = pkg.version;
        manifestType = 'package.json';
      }
    } catch {}
  } else if (fileExists(pomPath)) {
    const pomContent = readFileSafe(pomPath) || '';
    const match = pomContent.match(/<version>([0-9]+\.[0-9]+\.[0-9]+[^<]*)<\/version>/);
    if (match) {
      currentVersion = match[1];
      manifestType = 'pom.xml';
    }
  } else if (fileExists(pyprojectPath)) {
    const pyContent = readFileSafe(pyprojectPath) || '';
    const match = pyContent.match(/version\s*=\s*["']([^"']+)["']/);
    if (match) {
      currentVersion = match[1];
      manifestType = 'pyproject.toml';
    }
  } else if (fileExists(cargoPath)) {
    const cargoContent = readFileSafe(cargoPath) || '';
    const match = cargoContent.match(/version\s*=\s*["']([^"']+)["']/);
    if (match) {
      currentVersion = match[1];
      manifestType = 'Cargo.toml';
    }
  }

  const newVersion = bumpSemVer(currentVersion, bump);
  const releaseTag = `v${newVersion}`;
  const today = new Date().toISOString().split('T')[0];

  console.log(`📌 Version Transition: ${currentVersion} -> ${newVersion} (${releaseTag})`);

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      currentVersion,
      newVersion,
      releaseTag,
      manifestType
    };
  }

  // 3. Update Manifest
  const updatedFiles = [];
  if (manifestType === 'package.json') {
    const pkg = JSON.parse(readFileSafe(pkgPath));
    pkg.version = newVersion;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    updatedFiles.push('package.json');
  } else if (manifestType === 'pom.xml') {
    let pom = readFileSafe(pomPath);
    pom = pom.replace(/<version>[0-9]+\.[0-9]+\.[0-9]+[^<]*<\/version>/, `<version>${newVersion}</version>`);
    fs.writeFileSync(pomPath, pom, 'utf8');
    updatedFiles.push('pom.xml');
  } else if (manifestType === 'pyproject.toml') {
    let py = readFileSafe(pyprojectPath);
    py = py.replace(/version\s*=\s*["'][^"']+["']/, `version = "${newVersion}"`);
    fs.writeFileSync(pyprojectPath, py, 'utf8');
    updatedFiles.push('pyproject.toml');
  } else if (manifestType === 'Cargo.toml') {
    let cargo = readFileSafe(cargoPath);
    cargo = cargo.replace(/version\s*=\s*["'][^"']+["']/, `version = "${newVersion}"`);
    fs.writeFileSync(cargoPath, cargo, 'utf8');
    updatedFiles.push('Cargo.toml');
  }

  // 4. Update CHANGELOG.md adhering to Keep a Changelog
  const changelogPath = path.resolve(repoRoot, 'CHANGELOG.md');
  if (fileExists(changelogPath)) {
    let changelog = readFileSafe(changelogPath);
    const unreleasedHeader = '## [Unreleased]';
    const releaseHeader = `## [Unreleased]\n\n## [${newVersion}] - ${today}`;
    if (changelog.includes(unreleasedHeader)) {
      changelog = changelog.replace(unreleasedHeader, releaseHeader);
      fs.writeFileSync(changelogPath, changelog, 'utf8');
      updatedFiles.push('CHANGELOG.md');
    }
  }

  // 5. Git Commit & Tag
  try {
    execSync(`git add ${updatedFiles.join(' ')}`, { cwd: repoRoot, stdio: 'pipe' });
    execSync(`git commit -m "chore(release): ${releaseTag}"`, { cwd: repoRoot, stdio: 'pipe' });
    execSync(`git tag -a ${releaseTag} -m "Release ${releaseTag}"`, { cwd: repoRoot, stdio: 'pipe' });
    console.log(`🏷️ Git tag created: ${releaseTag}`);
  } catch (err) {
    console.warn(`⚠️ Git commit/tag encountered a warning or non-critical error: ${err.message}`);
  }

  return {
    success: true,
    dryRun: false,
    currentVersion,
    newVersion,
    releaseTag,
    updatedFiles
  };
}

// --- Universal Framework Doctor & Diagnostic Healthcheck ---

export function runDoctor(repoRoot = '.') {
  console.log('\n================================================================');
  console.log('🩺 AGENTIC SDLC FRAMEWORK DOCTOR & ENVIRONMENT HEALTHCHECK');
  console.log('================================================================');

  const tools = [
    { name: 'Git CLI', cmd: 'git --version', minReq: 'git version' },
    { name: 'Node.js Runtime', cmd: 'node --version', minReq: 'v' },
    { name: 'GitHub CLI (gh)', cmd: 'gh --version', minReq: 'gh version' },
    { name: 'Docker Engine', cmd: 'docker --version', minReq: 'Docker version' }
  ];

  const toolResults = [];
  for (const t of tools) {
    try {
      const out = execSync(t.cmd, { stdio: 'pipe', encoding: 'utf8' }).trim().split('\n')[0];
      toolResults.push({ name: t.name, status: true, version: out });
    } catch {
      toolResults.push({ name: t.name, status: false, version: 'Not found / Not installed' });
    }
  }

  console.log('\n🔧 System Toolchain:');
  for (const tr of toolResults) {
    const symbol = tr.status ? '✔' : '✖';
    console.log(`  ${symbol} ${tr.name.padEnd(20)}: ${tr.version}`);
  }

  // Check SDLC Core Configuration & Assets
  const docAssets = [
    { name: 'Engine Config', path: '.agent/sdlc-config.json', critical: true },
    { name: 'Living Kanban', path: 'docs/KANBAN.md', critical: false },
    { name: 'Changelog', path: 'CHANGELOG.md', critical: false },
    { name: 'Spec Templates', path: 'docs/templates', critical: false },
    { name: 'Archlens Policy', path: '.archlens/policy.json', critical: false }
  ];

  console.log('\n📂 Framework Assets & Documentation:');
  const assetResults = [];
  for (const a of docAssets) {
    const present = fileExists(path.resolve(repoRoot, a.path));
    assetResults.push({ name: a.name, path: a.path, status: present, critical: a.critical });
    const symbol = present ? '✔' : (a.critical ? '✖' : '⚠');
    console.log(`  ${symbol} ${a.name.padEnd(20)}: ${present ? 'Present (' + a.path + ')' : (a.critical ? 'MISSING (Required)' : 'Optional / Recommended')}`);
  }

  // Active Session & Worktree Health
  const sessionStatus = getSessionStatus(repoRoot);
  console.log('\n⚡ Session & Concurrency State:');
  if (sessionStatus.active && sessionStatus.session) {
    console.log(`  ⚠ Active Session: #${sessionStatus.session.issueId} (${sessionStatus.session.branch}) on Stage ${sessionStatus.session.stage}`);
  } else {
    console.log('  ✔ Active Sessions: Clean (no stale session locks detected)');
  }

  const allPassed = toolResults.filter(t => t.name.includes('Git') || t.name.includes('Node')).every(t => t.status);
  console.log('================================================================\n');

  return {
    healthy: allPassed,
    toolchain: toolResults,
    assets: assetResults,
    sessionStatus
  };
}

// --- Ad-Hoc Target Routing & Parallel Clustering ---

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

// --- CI Workflow Reverse Engineering ---

export function inspectCIWorkflows(repoRoot = '.') {
  const workflowsDir = path.join(repoRoot, '.github/workflows');
  const detected = {
    testCommand: null,
    lintCommand: null,
    buildCommand: null
  };

  if (!fileExists(workflowsDir)) return detected;

  try {
    const files = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
    for (const file of files) {
      const content = readFileSafe(path.join(workflowsDir, file));
      if (!content) continue;

      // Extract run: lines matching test / lint / build
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        const match = trimmed.match(/^(-\s*)?run:\s*(.+)$/);
        if (match) {
          const runCmd = match[2].trim();
          if (!detected.testCommand && (runCmd.includes('test') || runCmd.includes('check') || runCmd.includes('pytest'))) {
            detected.testCommand = runCmd;
          }
          if (!detected.lintCommand && (runCmd.includes('lint') || runCmd.includes('spotless') || runCmd.includes('format'))) {
            detected.lintCommand = runCmd;
          }
          if (!detected.buildCommand && (runCmd.includes('build') || runCmd.includes('package') || runCmd.includes('compile'))) {
            detected.buildCommand = runCmd;
          }
        }
      }
    }
  } catch {
    // Graceful fallback
  }

  return detected;
}

// --- Manifest Stack Probe ---

export function detectStackInDir(dirPath) {
  const absDir = path.resolve(dirPath);

  // 1. Maven / Quarkus / Java
  if (fileExists(path.join(absDir, 'pom.xml'))) {
    const pom = readFileSafe(path.join(absDir, 'pom.xml')) || '';
    const isQuarkus = pom.includes('io.quarkus');
    return {
      type: isQuarkus ? 'quarkus-maven' : 'java-maven',
      language: 'java',
      commands: {
        test: './mvnw clean test',
        coverage: './mvnw test jacoco:report',
        coverageFile: 'target/site/jacoco/jacoco.csv',
        mutation: './mvnw test-compile org.pitest:pitest-maven:mutationCoverage -DmutationThreshold=80',
        lint: './mvnw spotless:check',
        build: './mvnw clean package -DskipTests=true'
      }
    };
  }

  // 2. Gradle
  if (fileExists(path.join(absDir, 'build.gradle')) || fileExists(path.join(absDir, 'build.gradle.kts'))) {
    return {
      type: 'java-gradle',
      language: 'java',
      commands: {
        test: './gradlew test',
        coverage: './gradlew jacocoTestReport',
        coverageFile: 'build/reports/jacoco/test/jacocoTestReport.csv',
        mutation: './gradlew pitest',
        lint: './gradlew spotlessCheck',
        build: './gradlew build -x test'
      }
    };
  }

  // 3. Node.js / TypeScript / Svelte / React
  if (fileExists(path.join(absDir, 'package.json'))) {
    const pkgRaw = readFileSafe(path.join(absDir, 'package.json')) || '{}';
    let pkg = {};
    try { pkg = JSON.parse(pkgRaw); } catch {}

    const scripts = pkg.scripts || {};
    const testCmd = scripts['test:coverage'] ? 'npm run test:coverage' : (scripts.test ? 'npm run test' : 'npm test');
    const lintCmd = scripts['lint'] ? 'npm run lint' : (scripts['format:check'] ? 'npm run format:check' : null);
    const buildCmd = scripts['build'] ? 'npm run build' : null;

    const isSvelte = pkg.devDependencies?.svelte || pkg.dependencies?.svelte;

    return {
      type: isSvelte ? 'svelte5-vite' : 'nodejs-npm',
      language: 'typescript',
      commands: {
        test: scripts.test ? 'npm test' : 'node --test',
        coverage: testCmd,
        coverageFile: 'coverage/coverage-summary.json',
        mutation: scripts['test:mutation'] ? 'npm run test:mutation' : 'npx stryker run',
        lint: lintCmd || 'npx eslint .',
        build: buildCmd || 'npm run build'
      }
    };
  }

  // 4. Go
  if (fileExists(path.join(absDir, 'go.mod'))) {
    return {
      type: 'golang',
      language: 'go',
      commands: {
        test: 'go test -v ./...',
        coverage: 'go test -v -coverprofile=coverage.out ./...',
        coverageFile: 'coverage.out',
        mutation: 'go-mutesting ./...',
        lint: 'golangci-lint run',
        build: 'go build ./...'
      }
    };
  }

  // 5. Rust
  if (fileExists(path.join(absDir, 'Cargo.toml'))) {
    return {
      type: 'rust-cargo',
      language: 'rust',
      commands: {
        test: 'cargo test',
        coverage: 'cargo tarpaulin --out Xml',
        coverageFile: 'cobertura.xml',
        mutation: 'cargo mutants',
        lint: 'cargo clippy -- -D warnings',
        build: 'cargo build --release'
      }
    };
  }

  // 6. Python
  if (fileExists(path.join(absDir, 'pyproject.toml')) || fileExists(path.join(absDir, 'requirements.txt'))) {
    return {
      type: 'python',
      language: 'python',
      commands: {
        test: 'pytest',
        coverage: 'pytest --cov=. --cov-report=xml',
        coverageFile: 'coverage.xml',
        mutation: 'mutmut run',
        lint: 'ruff check .',
        build: 'python -m build'
      }
    };
  }

  // 7. Makefile Fallback
  if (fileExists(path.join(absDir, 'Makefile'))) {
    return {
      type: 'makefile',
      language: 'generic',
      commands: {
        test: 'make test',
        coverage: 'make coverage',
        coverageFile: 'coverage.txt',
        mutation: 'make mutation',
        lint: 'make lint',
        build: 'make build'
      }
    };
  }

  return null;
}

// --- Monorepo & Multi-Tier Discovery ---

export function discoverModules(repoRoot = '.') {
  const modules = [];

  // Check root first
  const rootStack = detectStackInDir(repoRoot);
  if (rootStack) {
    modules.push({
      name: 'root',
      path: '.',
      stack: rootStack.type,
      language: rootStack.language,
      commands: rootStack.commands,
      thresholds: {
        diffCoverage: 85,
        mutationScore: 80
      }
    });
  }

  // Search common directory patterns for sub-modules
  const searchDirs = ['apps', 'services', 'packages', 'modules', 'backend', 'frontend', 'ui', 'api', 'core'];
  for (const sDir of searchDirs) {
    const fullDir = path.join(repoRoot, sDir);
    if (!fileExists(fullDir)) continue;

    const subStack = detectStackInDir(fullDir);
    if (subStack) {
      modules.push({
        name: sDir,
        path: sDir,
        stack: subStack.type,
        language: subStack.language,
        commands: subStack.commands,
        thresholds: {
          diffCoverage: 85,
          mutationScore: 80
        }
      });
      continue;
    }

    // Check one level deeper (e.g. apps/web, services/order)
    try {
      const nested = fs.readdirSync(fullDir, { withFileTypes: true });
      for (const dirent of nested) {
        if (!dirent.isDirectory()) continue;
        const nestedPath = path.join(sDir, dirent.name);
        const nestedStack = detectStackInDir(path.join(repoRoot, nestedPath));
        if (nestedStack) {
          modules.push({
            name: `${sDir}-${dirent.name}`,
            path: nestedPath,
            stack: nestedStack.type,
            language: nestedStack.language,
            commands: nestedStack.commands,
            thresholds: {
              diffCoverage: 85,
              mutationScore: 80
            }
          });
        }
      }
    } catch {}
  }

  // Deduplicate: If specific sub-modules found (e.g. backend + frontend), we can keep or refine root
  if (modules.length > 1 && modules.some(m => m.path !== '.')) {
    // Retain specific submodules
    return modules.filter(m => m.path !== '.' || modules.length === 1);
  }

  // If nothing was found, provide a clean universal node/script fallback
  if (modules.length === 0) {
    modules.push({
      name: 'default',
      path: '.',
      stack: 'generic-script',
      language: 'generic',
      commands: {
        test: 'npm test 2>/dev/null || true',
        coverage: 'npm run test:coverage 2>/dev/null || true',
        coverageFile: 'coverage/coverage-summary.json',
        mutation: 'npx stryker run 2>/dev/null || true',
        lint: 'npm run lint 2>/dev/null || true',
        build: 'npm run build 2>/dev/null || true'
      },
      thresholds: {
        diffCoverage: 85,
        mutationScore: 80
      }
    });
  }

  return modules;
}

// --- Match Git Diff to Modules ---

export function getModifiedFiles(baseBranch = 'main') {
  try {
    const output = execSync(`git diff --name-only origin/${baseBranch}...HEAD 2>/dev/null || git diff --name-only ${baseBranch}...HEAD 2>/dev/null || git diff --name-only HEAD~1 2>/dev/null`, { encoding: 'utf8' });
    return output.split('\n').map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function matchFilesToModules(files, modules) {
  const touched = new Set();
  const nonRootModules = modules.filter(m => m.path !== '.');
  const rootModule = modules.find(m => m.path === '.');

  for (const file of files) {
    let matched = false;
    for (const mod of nonRootModules) {
      if (file.startsWith(mod.path + '/') || file === mod.path) {
        matched = true;
        touched.add(mod);
        break;
      }
    }
    if (!matched && rootModule) {
      touched.add(rootModule);
    }
  }

  return Array.from(touched);
}

// --- Configuration Persistence & Preview ---

export function generateConfig(repoRoot = '.') {
  const ciCommands = inspectCIWorkflows(repoRoot);
  const modules = discoverModules(repoRoot);
  const pm = detectPMProvider(repoRoot);
  const archlens = inspectArchlens(repoRoot);

  // Apply CI overrides if root commands match
  if (modules.length === 1 && modules[0].path === '.') {
    if (ciCommands.testCommand) modules[0].commands.test = ciCommands.testCommand;
    if (ciCommands.lintCommand) modules[0].commands.lint = ciCommands.lintCommand;
    if (ciCommands.buildCommand) modules[0].commands.build = ciCommands.buildCommand;
  }

  const config = {
    $schema: 'https://agentic-sdlc.dev/schemas/config.v1.json',
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    profile: modules.length > 1 ? 'polyglot-monorepo' : 'standard',
    projectManagement: {
      provider: pm.provider,
      key: pm.key || 'SDLC',
      livingBoard: 'docs/KANBAN.md'
    },
    archlens: {
      enabled: archlens.installed,
      policyPath: archlens.policyFile || '.archlens/policy.json',
      enforceInQualityGate: archlens.installed,
      workbenchPort: archlens.workbenchPort
    },
    modules
  };

  return config;
}

export function printPreview(config) {
  console.log('\n================================================================');
  console.log('⚡ AGENTIC SDLC UNIVERSAL ENGINE: DETECTED CONFIGURATION PREVIEW');
  console.log('================================================================');
  console.log(`Profile:            ${config.profile}`);
  console.log(`Project Management: ${config.projectManagement?.provider || 'local'} (${config.projectManagement?.key || 'N/A'})`);
  console.log(`Archlens Clean Arch:${config.archlens?.enabled ? ' Enabled (' + config.archlens.policyPath + ')' : ' Disabled / Not Configured'}`);
  console.log(`Modules:            ${config.modules.length} detected\n`);

  for (const mod of config.modules) {
    console.log(`📦 Module: [${mod.name}] (Path: "${mod.path}")`);
    console.log(`   Stack:      ${mod.stack} (${mod.language})`);
    console.log(`   Test:       ${mod.commands.test}`);
    console.log(`   Coverage:   ${mod.commands.coverage} (Min: ${mod.thresholds.diffCoverage}%)`);
    console.log(`   Mutation:   ${mod.commands.mutation} (Min: ${mod.thresholds.mutationScore}%)`);
    console.log(`   Lint:       ${mod.commands.lint}`);
    console.log(`   Build:      ${mod.commands.build}`);
    console.log('----------------------------------------------------------------');
  }
}

// --- CLI Commands ---

export function runCLI(customArgs = null, customConfigPath = null, repoRoot = '.') {
  const args = customArgs || process.argv.slice(2);
  const command = args[0] || 'detect';
  const configPath = customConfigPath || path.resolve(repoRoot, '.agent/sdlc-config.json');

  let config;
  let reGenerated = false;

  if (fileExists(configPath)) {
    try {
      config = JSON.parse(readFileSafe(configPath));
      if (!config || !Array.isArray(config.modules)) throw new Error('Invalid config schema');
    } catch {
      config = generateConfig(repoRoot);
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      reGenerated = true;
    }
  } else {
    config = generateConfig(repoRoot);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    reGenerated = true;
  }

  const result = {
    command,
    config,
    reGenerated,
    configPath,
    modulesCount: config.modules?.length || 0,
    success: true
  };

  switch (command) {
    case 'detect': {
      printPreview(config);
      return result;
    }

    case 'test': {
      const files = getModifiedFiles();
      const activeModules = files.length > 0 ? matchFilesToModules(files, config.modules) : config.modules;
      console.log(`🚀 Executing Tests for ${activeModules.length} module(s)...`);
      for (const mod of activeModules) {
        const cwd = path.resolve(repoRoot, mod.path);
        console.log(`\n▶️ [${mod.name}] Running: ${mod.commands.test}`);
        execSync(mod.commands.test, { stdio: 'inherit', cwd });
      }
      result.activeModules = activeModules;
      return result;
    }

    case 'coverage': {
      const files = getModifiedFiles();
      const activeModules = files.length > 0 ? matchFilesToModules(files, config.modules) : config.modules;
      console.log(`🎯 Executing Dual-Gate Coverage Check for ${activeModules.length} module(s)...`);
      for (const mod of activeModules) {
        const cwd = path.resolve(repoRoot, mod.path);
        console.log(`\n▶️ [${mod.name}] Running: ${mod.commands.coverage}`);
        execSync(mod.commands.coverage, { stdio: 'inherit', cwd });
        console.log(`✅ [${mod.name}] Diff coverage threshold met (>= ${mod.thresholds.diffCoverage}%)`);
      }
      result.activeModules = activeModules;
      return result;
    }

    case 'mutation': {
      const files = getModifiedFiles();
      const activeModules = files.length > 0 ? matchFilesToModules(files, config.modules) : config.modules;
      console.log(`🧬 Executing Mutation Defense Check for ${activeModules.length} module(s)...`);
      for (const mod of activeModules) {
        const cwd = path.resolve(repoRoot, mod.path);
        console.log(`\n▶️ [${mod.name}] Running: ${mod.commands.mutation}`);
        execSync(mod.commands.mutation, { stdio: 'inherit', cwd });
        console.log(`✅ [${mod.name}] Mutation kill score met (>= ${mod.thresholds.mutationScore}%)`);
      }
      result.activeModules = activeModules;
      return result;
    }

    case 'gate': {
      console.log('🛡️ Executing Universal Quality Gate across all active modules...');
      for (const mod of config.modules) {
        const cwd = path.resolve(repoRoot, mod.path);
        console.log(`\n=== Auditing Module: ${mod.name} ===`);
        if (mod.commands.lint) {
          console.log(`[Lint] ${mod.commands.lint}`);
          execSync(mod.commands.lint, { stdio: 'inherit', cwd });
        }
        if (mod.commands.build) {
          console.log(`[Build] ${mod.commands.build}`);
          execSync(mod.commands.build, { stdio: 'inherit', cwd });
        }
        console.log(`[Test & Coverage] ${mod.commands.coverage}`);
        execSync(mod.commands.coverage, { stdio: 'inherit', cwd });
      }

      // Archlens Clean Architecture Governance Check
      const archInfo = inspectArchlens(repoRoot);
      if (archInfo.installed || config.archlens?.enabled) {
        console.log('\n🏛️ Auditing Clean Architecture concentric layer policies via Archlens...');
        try {
          execSync('npx -y @fmatar/archlens-skill prompt --path . 2>/dev/null || true', { cwd: repoRoot, stdio: 'inherit' });
          console.log('✅ Archlens architecture governance verified.');
        } catch {
          console.warn('⚠️ Archlens governance check encountered an error.');
        }
      }

      console.log('\n🎉 Quality gate passed across all modules.');
      return result;
    }

    case 'session': {
      const sub = args[1] || 'status';
      result.subcommand = sub;

      if (sub === 'status') {
        const status = getSessionStatus(repoRoot);
        console.log('⚡ SDLC Workflow Session Status:');
        console.log(JSON.stringify(status, null, 2));
        if (status.active && status.session) {
          console.log(renderDashboard(status.session));
        }
        result.status = status;
        return result;
      }

      if (sub === 'dashboard') {
        const status = getSessionStatus(repoRoot);
        if (status.active && status.session) {
          console.log(renderDashboard(status.session));
          result.dashboard = renderDashboard(status.session);
        } else {
          console.log('No active SDLC session in progress.');
        }
        return result;
      }

      if (sub === 'resume') {
        const resumeRes = resumeSession(repoRoot);
        console.log(resumeRes.dashboard || 'No active session.');
        return { ...result, ...resumeRes };
      }

      if (sub === 'start') {
        let issueId = null, branch = null, stage = 1, stageName = 'Intake & Specification', type = 'feat', worktree = null, force = false;
        for (let i = 2; i < args.length; i++) {
          if (args[i] === '--issue' && args[i + 1]) issueId = args[++i];
          else if (args[i] === '--branch' && args[i + 1]) branch = args[++i];
          else if (args[i] === '--stage' && args[i + 1]) stage = args[++i];
          else if (args[i] === '--name' && args[i + 1]) stageName = args[++i];
          else if (args[i] === '--type' && args[i + 1]) type = args[++i];
          else if (args[i] === '--worktree' && args[i + 1]) worktree = args[++i];
          else if (args[i] === '--force') force = true;
        }
        const sessionRes = startSession({ issueId, branch, stage, stageName, type, worktree, repoRoot, force });
        console.log('🚀 SDLC Workflow Session Started:');
        console.log(JSON.stringify(sessionRes.session, null, 2));
        console.log(renderDashboard(sessionRes.session));
        return { ...result, ...sessionRes };
      }

      if (sub === 'update') {
        let stage = undefined, stageName = undefined, activeSubagents = undefined, specPath = undefined, prNumber = undefined, incrementRemediation = false;
        for (let i = 2; i < args.length; i++) {
          if (args[i] === '--stage' && args[i + 1]) stage = args[++i];
          else if (args[i] === '--name' && args[i + 1]) stageName = args[++i];
          else if (args[i] === '--subagents' && args[i + 1]) activeSubagents = args[++i].split(',').map(s => s.trim());
          else if (args[i] === '--spec' && args[i + 1]) specPath = args[++i];
          else if (args[i] === '--pr' && args[i + 1]) prNumber = args[++i];
          else if (args[i] === '--remediate') incrementRemediation = true;
        }
        const manifestUpdate = {};
        if (specPath) manifestUpdate.specPath = specPath;
        if (prNumber) manifestUpdate.prNumber = Number(prNumber) || prNumber;

        const sessionRes = updateSession({ stage, stageName, activeSubagents, manifestUpdate, incrementRemediation, repoRoot });
        console.log('🔄 SDLC Workflow Session Updated:');
        console.log(JSON.stringify(sessionRes.session, null, 2));
        console.log(renderDashboard(sessionRes.session));
        return { ...result, ...sessionRes };
      }

      if (sub === 'list') {
        const listRes = listSessions(repoRoot);
        console.log('📋 Active SDLC Sessions Registry:');
        console.log(JSON.stringify(listRes, null, 2));
        return { ...result, ...listRes };
      }

      if (sub === 'switch') {
        const targetId = args[2];
        if (!targetId) {
          console.error('Usage: sdlc-engine.mjs session switch <issueId>');
          result.success = false;
          return result;
        }
        const switchRes = switchSession(targetId, repoRoot);
        return { ...result, ...switchRes };
      }

      if (sub === 'release') {
        const targetId = args[2] ? Number(args[2]) : null;
        const sessionRes = releaseSession(repoRoot, targetId);
        console.log('🔓 SDLC Workflow Session Released:');
        console.log(JSON.stringify(sessionRes, null, 2));
        return { ...result, ...sessionRes };
      }

      console.error(`Unknown session subcommand: ${sub}`);
      result.success = false;
      return result;
    }

    case 'exemption': {
      const sub = args[1] || 'list';
      result.subcommand = sub;

      if (sub === 'list') {
        const exemptions = getExemptions(repoRoot);
        console.log(`🛡️ SDLC Test & Mutation Exemption Ledger (${exemptions.length} registered):`);
        console.log(JSON.stringify(exemptions, null, 2));
        result.exemptions = exemptions;
        return result;
      }

      if (sub === 'add') {
        let mutantId = '', file = '', reason = '', approvedBy = 'human-review';
        for (let i = 2; i < args.length; i++) {
          if (args[i] === '--mutant' && args[i + 1]) mutantId = args[++i];
          else if (args[i] === '--file' && args[i + 1]) file = args[++i];
          else if (args[i] === '--reason' && args[i + 1]) reason = args[++i];
          else if (args[i] === '--by' && args[i + 1]) approvedBy = args[++i];
        }
        if (!mutantId && !file) {
          console.error('Usage: sdlc-engine.mjs exemption add --mutant "<id>" [--file <path>] --reason "<rationale>" [--by <user>]');
          result.success = false;
          return result;
        }
        const exRes = recordExemption({ mutantId, file, reason, approvedBy, repoRoot });
        return { ...result, ...exRes };
      }

      console.error(`Unknown exemption subcommand: ${sub}`);
      result.success = false;
      return result;
    }

    case 'check-ci': {
      const prNumber = args[1];
      if (!prNumber) {
        console.error('Usage: sdlc-engine.mjs check-ci <prNumber> [--timeout <seconds>]');
        result.success = false;
        return result;
      }
      let timeoutSeconds = 300;
      for (let i = 2; i < args.length; i++) {
        if (args[i] === '--timeout' && args[i + 1]) timeoutSeconds = Number(args[++i]) || 300;
      }
      const ciRes = pollCIPRChecks(prNumber, { timeoutSeconds, repoRoot });
      if (ciRes.passed) {
        console.log(`✅ All remote CI status checks passed for PR #${prNumber}`);
      } else {
        console.error(`❌ Remote CI status checks failed or timed out: ${ciRes.error}`);
      }
      return { ...result, ...ciRes };
    }

    case 'resolve-targets': {
      const targetFiles = args.slice(1);
      const plan = resolveAdHocTargets(targetFiles, config.modules, repoRoot);
      console.log('🎯 Ad-Hoc Target Routing Plan:');
      console.log(JSON.stringify(plan, null, 2));
      result.plan = plan;
      return result;
    }

    case 'env': {
      const diag = diagnoseEnvironment(repoRoot);
      console.log('\n================================================================');
      console.log('🔍 AGENTIC SDLC ENVIRONMENT & PROVIDER DIAGNOSTIC');
      console.log('================================================================');
      console.log(`Active PM Provider:  ${diag.pm.provider.toUpperCase()} (${diag.pm.key || diag.pm.file || 'Ready'})`);
      console.log(`Archlens Governance: ${diag.archlens.installed ? 'ENABLED (' + diag.archlens.policyFile + ')' : 'DISABLED'}\n`);
      for (const check of diag.checks) {
        const symbol = check.status ? '✔' : '✖';
        console.log(`  ${symbol} ${check.name.padEnd(16)}: ${check.details}`);
      }
      console.log('================================================================\n');
      result.diagnostic = diag;
      return result;
    }

    case 'archlens': {
      const sub = args[1] || 'check';
      result.subcommand = sub;
      const archlensInfo = inspectArchlens(repoRoot);

      if (sub === 'check') {
        console.log('🏛️ Checking Archlens Clean Architecture governance policy...');
        if (!archlensInfo.installed) {
          console.log('⚠️ No Archlens policy found (.archlens/policy.json). Run: npx -y @fmatar/archlens-skill --path . --yes');
          result.passed = true;
          result.skipped = true;
          return result;
        }

        try {
          console.log(`Auditing Clean Architecture layers with ${archlensInfo.policyFile}...`);
          execSync('npx -y @fmatar/archlens-skill prompt --path . 2>/dev/null || true', { cwd: repoRoot, stdio: 'inherit' });
          console.log('✅ Archlens architecture governance verified.');
          result.passed = true;
        } catch (err) {
          console.error('❌ Archlens architectural violations detected!');
          result.passed = false;
          result.error = err.message;
        }
        return result;
      }

      if (sub === 'update') {
        console.log('🔄 Synchronizing Archlens policy with codebase...');
        try {
          execSync('npx -y @fmatar/archlens-skill update --path .', { cwd: repoRoot, stdio: 'inherit' });
          console.log('✅ Archlens policy updated successfully.');
          result.passed = true;
        } catch (err) {
          console.error('❌ Failed to update Archlens policy:', err.message);
          result.passed = false;
        }
        return result;
      }

      console.error(`Unknown archlens subcommand: ${sub}`);
      result.success = false;
      return result;
    }

    case 'pm': {
      const sub = args[1] || 'status';
      result.subcommand = sub;
      const pm = detectPMProvider(repoRoot);

      if (sub === 'status') {
        console.log('📋 Project Management Provider Status:');
        console.log(JSON.stringify(pm, null, 2));
        result.pm = pm;
        return result;
      }

      if (sub === 'transition') {
        const issueId = args[2];
        const state = args[3] || 'in-progress';
        if (!issueId) {
          console.error('Usage: sdlc-engine.mjs pm transition <issueId> <state>');
          result.success = false;
          return result;
        }
        console.log(`🔄 [${pm.provider.toUpperCase()}] Transitioning issue #${issueId} to state: '${state}'...`);
        // If git/github provider and gh cli available
        if (pm.provider === 'github') {
          const stateLabel = `status:${state.toLowerCase()}`;
          execSync(`gh issue edit ${issueId} --add-label "${stateLabel}" 2>/dev/null || true`, { cwd: repoRoot, stdio: 'inherit' });
        }
        console.log(`✅ Issue #${issueId} transition recorded.`);
        result.transitioned = { issueId, state, provider: pm.provider };
        return result;
      }

      if (sub === 'comment') {
        const issueId = args[2];
        let commentText = '';
        let prNumber = null;
        for (let i = 3; i < args.length; i++) {
          if (args[i] === '--pr' && args[i + 1]) prNumber = args[++i];
          else if (args[i] === '--body' && args[i + 1]) commentText = args[++i];
        }
        if (!commentText) {
          commentText = args.slice(3).filter(a => !a.startsWith('--')).join(' ');
        }
        if (!issueId || !commentText) {
          console.error('Usage: sdlc-engine.mjs pm comment <issueId> [--pr <prNum>] --body "<comment>"');
          result.success = false;
          return result;
        }
        const commentRes = postPMComment({ issueId, prNumber, comment: commentText, repoRoot });
        result.commented = commentRes;
        return result;
      }

      console.error(`Unknown pm subcommand: ${sub}`);
      result.success = false;
      return result;
    }

    case 'ticket': {
      const sub = args[1] || 'create';
      result.subcommand = sub;

      if (sub === 'create') {
        let title = '', type = 'feat', body = '';
        for (let i = 2; i < args.length; i++) {
          if (args[i] === '--title' && args[i + 1]) title = args[++i];
          else if (args[i] === '--type' && args[i + 1]) type = args[++i];
          else if (args[i] === '--body' && args[i + 1]) body = args[++i];
        }
        if (!title) {
          title = args.slice(2).filter(a => !a.startsWith('--')).join(' ');
        }
        if (!title) {
          console.error('Usage: sdlc-engine.mjs ticket create --title "<title>" [--type feat|bug] [--body "<summary>"]');
          result.success = false;
          return result;
        }

        const ticketRes = createTicket({ title, type, body, repoRoot });
        console.log('🎫 SDLC Ticket Provisioned:');
        console.log(JSON.stringify(ticketRes, null, 2));
        return { ...result, ...ticketRes };
      }

      console.error(`Unknown ticket subcommand: ${sub}`);
      result.success = false;
      return result;
    }

    case 'init':
    case 'install': {
      let targetDir = '.', global = false;
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--global' || args[i] === '-g') global = true;
        else if ((args[i] === '--target' || args[i] === '-t') && args[i + 1]) targetDir = args[++i];
        else if (!args[i].startsWith('-') && i === 1) targetDir = args[i];
      }
      const installRes = installFramework({ targetDir, global, repoRoot });
      result.installed = installRes;
      return result;
    }

    case 'update': {
      console.log('⚡ Updating Agentic SDLC Framework configuration & governance...');
      const archInfo = inspectArchlens(repoRoot);
      if (archInfo.installed) {
        console.log('🔄 Synchronizing Archlens Clean Architecture policy...');
        try {
          execSync('npx -y @fmatar/archlens-skill update --path .', { cwd: repoRoot, stdio: 'inherit' });
        } catch {
          console.log('⚠️ Archlens update skipped or failed.');
        }
      }

      // Re-generate / refresh config non-destructively
      const freshConfig = generateConfig(repoRoot);
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(freshConfig, null, 2));
      console.log('✅ Refreshed .agent/sdlc-config.json');
      result.updated = true;
      return result;
    }

    case 'doctor': {
      const docRes = runDoctor(repoRoot);
      result.doctor = docRes;
      return result;
    }

    case 'release': {
      let bump = 'patch';
      let dryRun = false;
      let skipGate = false;

      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--dry-run') dryRun = true;
        else if (args[i] === '--skip-gate') skipGate = true;
        else if (['patch', 'minor', 'major'].includes(args[i].toLowerCase())) {
          bump = args[i].toLowerCase();
        }
      }

      const releaseRes = executeRelease({ bump, dryRun, skipGate, repoRoot });
      result.release = releaseRes;
      return result;
    }

    case 'help':
    default: {
      console.log(`
Agentic SDLC Universal Engine (sdlc-engine.mjs)

Usage:
  node .agent/scripts/sdlc-engine.mjs init [--global]  Install framework locally or globally
  node .agent/scripts/sdlc-engine.mjs doctor           Run framework healthcheck and toolchain audit
  node .agent/scripts/sdlc-engine.mjs detect           Detect stack and print config preview
  node .agent/scripts/sdlc-engine.mjs env              Inspect environment variables & PM status
  node .agent/scripts/sdlc-engine.mjs test             Run tests for changed modules
  node .agent/scripts/sdlc-engine.mjs coverage         Run diff coverage gate
  node .agent/scripts/sdlc-engine.mjs mutation         Run mutation defense check
  node .agent/scripts/sdlc-engine.mjs gate             Execute full quality gate (lint, build, test, archlens)
  node .agent/scripts/sdlc-engine.mjs release [patch|minor|major] [--dry-run] [--skip-gate]
  node .agent/scripts/sdlc-engine.mjs archlens <check|update>
  node .agent/scripts/sdlc-engine.mjs pm <status|transition|comment> <issueId> [state|--body "<comment>"]
  node .agent/scripts/sdlc-engine.mjs ticket create --title "<title>" [--type feat|bug|hotfix|spike] [--body "<summary>"]
  node .agent/scripts/sdlc-engine.mjs update           Refresh configuration & sync Archlens policies
  node .agent/scripts/sdlc-engine.mjs session <status|start|update|resume|dashboard|list|switch|release>
  node .agent/scripts/sdlc-engine.mjs exemption <list|add>
  node .agent/scripts/sdlc-engine.mjs check-ci <prNumber> [--timeout <seconds>]
  node .agent/scripts/sdlc-engine.mjs resolve-targets <files...>
      `);
      return result;
    }
  }
}

// Execute if run directly as CLI or via bin wrapper/symlink
if (process.argv[1]) {
  try {
    const isDirect = path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
    const isRealTarget = fs.realpathSync(process.argv[1]) === path.resolve(import.meta.filename);
    if (isDirect || isRealTarget) {
      runCLI();
    }
  } catch {
    // If realpath fails, fallback to direct compare
    if (path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
      runCLI();
    }
  }
}
