import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  fileExists,
  readFileSafe,
  parseFrontmatter,
  detectPMProvider,
  hasGitHubRemote,
  gitOutput,
  resolveDefaultBaseBranch,
  resolveQualityThresholds,
  sameShaPrefix,
  readSessionFileState,
  patchActiveSessionManifest,
  writeFileAtomic
} from './core.mjs';

const localTicketHighWater = new Map();

function allocateNextLocalTicketId(repoRoot = '.') {
  const resolvedRoot = path.resolve(repoRoot);
  let maxId = localTicketHighWater.get(resolvedRoot) || 0;

  const kanbanPath = path.resolve(resolvedRoot, 'docs/KANBAN.md');
  if (fileExists(kanbanPath)) {
    const content = readFileSafe(kanbanPath) || '';
    for (const m of content.matchAll(/#(\d+):|\|\s*\*\*#?(\d+)\*\*\s*\|/g)) {
      const num = Number(m[1] || m[2]);
      if (Number.isInteger(num) && num > maxId) maxId = num;
    }
  }

  const state = readSessionFileState(resolvedRoot);
  for (const key of Object.keys(state.sessions || {})) {
    const parsed = Number(String(key).replace(/^#/, ''));
    if (Number.isInteger(parsed) && parsed > maxId) maxId = parsed;
  }

  const nextId = maxId + 1;
  localTicketHighWater.set(resolvedRoot, nextId);
  return nextId;
}

function sanitizeCurlHeaderVal(val) {
  return String(val ?? '')
    .replace(/[\r\n]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function curlJsonRequest({ url, method = 'POST', headers = {}, body = null, cwd = '.', execFn = execFileSync }) {
  const configLines = Object.entries(headers)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `header = "${sanitizeCurlHeaderVal(`${k}: ${v}`)}"`);
  const args = ['-sS', '-K', '-', '-w', '\n%{http_code}', '-X', method, url];
  if (body !== null && body !== undefined) {
    args.push('-d', typeof body === 'string' ? body : JSON.stringify(body));
  }
  const raw = execFn('curl', args, {
    cwd,
    stdio: 'pipe',
    encoding: 'utf8',
    input: configLines.join('\n') + (configLines.length > 0 ? '\n' : '')
  });
  const lines = String(raw || '').replace(/\r?\n$/, '').split(/\r?\n/);
  let bodyText = String(raw || '').trim();
  if (lines.length >= 2 && /^[1-5]\d{2}$/.test(lines[lines.length - 1].trim())) {
    const statusCode = Number(lines.pop().trim());
    bodyText = lines.join('\n').trim();
    if (statusCode >= 400) {
      throw new Error(`HTTP ${statusCode} from ${url}: ${bodyText.slice(0, 200)}`);
    }
  }
  const parsed = bodyText ? JSON.parse(bodyText) : {};
  if (Array.isArray(parsed?.errors) && parsed.errors.length > 0) {
    const msg = parsed.errors.map((e) => e?.message || JSON.stringify(e)).join('; ');
    throw new Error(`GraphQL error from ${url}: ${msg}`);
  }
  if (Array.isArray(parsed?.errorMessages) && parsed.errorMessages.length > 0) {
    throw new Error(`API error from ${url}: ${parsed.errorMessages.join('; ')}`);
  }
  return parsed;
}

function resolveConfiguredQualityBars(repoRoot = '.') {
  return resolveQualityThresholds(repoRoot);
}

export const CANONICAL_ISSUE_TEMPLATES = {
  '.github/ISSUE_TEMPLATE/feature_request.md': `---
name: Feature Request (CAP-XX / SPEC-XX)
about: Propose a constitutional product capability or feature governed by Red-Green-Refactor TDD
title: "feat: "
labels: feature, status:ready
---

### 🎯 Problem Statement & User Value
A clear and concise description of what the problem is.

### 🚀 Solution & Acceptance Criteria
A clear and concise description of what you want to happen.

### 📐 Linked Specification & Architecture
- **Capability ID**: \`CAP-XX\`
- **Specification**: \`docs/specs/cap-XX.md\`
- **Ring Impact**: \`Domain Core -> UseCase -> Adapter\`

### 🛡️ Clean Code & Dual-Gate Guarantees
- [ ] Failing Red test written before production code (\`/sdlc-tdd\`)
- [ ] Diff line coverage \`>= 85%\` and configured mutation score (\`.agent/sdlc-config.json\`)
- [ ] Zero concentric ring violations (\`.archlens/policy.json\`)
`,
  '.github/ISSUE_TEMPLATE/bug_report.md': `---
name: Bug Report (Red-First Reproduction)
about: Report a defect with deterministic reproduction steps for /sdlc reproduce
title: "fix: "
labels: bug, status:ready
---

### 🐛 Bug Description
A clear and concise description of what the bug is.

### 🔄 Steps to Reproduce
Steps to reproduce the behavior:
1. Execute command or endpoint
2. Observe failure or stack trace

### 🎯 Expected Behavior (Red-Green-Refactor TDD)
A clear and concise description of what you expected to happen.

### 💻 Environment
- OS: [e.g. macOS / Linux]
- Runtime: [e.g. Node.js 22 / Java 21 / Python 3.12]
`,
  '.github/ISSUE_TEMPLATE/hotfix_incident.md': `---
name: Production Hotfix Incident (P0)
about: Critical production incident isolated in a dedicated git worktree
title: "hotfix: "
labels: hotfix, status:ready, priority:critical
---

### 🚨 Incident Summary & Blast Radius
A clear and concise description of what the bug is.

### 🔄 Reproduction & Stack Trace
Steps to reproduce the behavior:
1. Capture failing production payload or stack trace
2. Scaffold failing Red test via \`/sdlc reproduce\`

### 🎯 Remediation & Rollback Plan
A clear and concise description of what you expected to happen.

### 💻 Environment
- OS: Production
- Canary Health Endpoint: \`/health\`
`,
  '.github/ISSUE_TEMPLATE/architecture_spike.md': `---
name: Architecture Spike & ADR Exploration
about: Time-boxed architectural investigation producing an ADR in docs/adr/
title: "spike: "
labels: spike, status:ready
---

### 🏛️ Architectural Context & Problem
A clear and concise description of what the problem is.

### ⚖️ Candidate Options & Exit Criteria
A clear and concise description of what you want to happen.

### 📋 Deliverables
- [ ] Mint ADR via \`/sdlc-adr\` (\`docs/adr/ADR-00X.md\`)
- [ ] Update \`PRODUCT.md\` and \`docs/DECISION_MAP.md\`
`,
  '.github/pull_request_template.md': `## 📋 Summary & Constitutional Traceability
- **Closes Ticket**: #
- **Linked Capability / Spec**: \`CAP-XX\` (\`docs/specs/cap-XX.md\`)
- **Superseding ADR (if applicable)**: \`ADR-00X\`

## 🛡️ Dual-Gate & Architectural Verification
| Gate Pillar | Requirement | Status |
| :--- | :--- | :--- |
| **Red-Green-Refactor TDD** | Red -> Green -> Refactor | ✅ Verified |
| **Diff Test Coverage** | \`>= 85%\` | ✅ Verified |
| **Mutation Score** | Per \`.agent/sdlc-config.json\` | ✅ Verified |
| **Archlens Ring Audit** | Zero Inner -> Outer Ring Imports | ✅ Verified |
| **Spec-Drift Sentinel** | \`sdlc-engine drift check\` | ✅ Verified |
| **Stage 7 Gate Receipt** | Signed in \`docs/AUDIT_CHAIN.jsonl\` | ✅ Verified |
`
};

export function scaffoldIssueTemplates({ repoRoot = '.', force = false } = {}) {
  const created = [];
  const skipped = [];

  for (const [relPath, content] of Object.entries(CANONICAL_ISSUE_TEMPLATES)) {
    const absPath = path.resolve(repoRoot, relPath);
    if (fs.existsSync(absPath) && !force) {
      skipped.push(relPath);
      continue;
    }
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf8');
    created.push(relPath);
  }

  return {
    success: true,
    created,
    skipped
  };
}

export function loadIssueTemplate(typeOrOpts = 'feat', maybeRepoRoot = '.') {
  const isObj = typeOrOpts && typeof typeOrOpts === 'object';
  const type = isObj ? typeOrOpts.type || 'feat' : typeOrOpts || 'feat';
  const repoRoot = isObj ? typeOrOpts.repoRoot || '.' : maybeRepoRoot || '.';
  const normType = String(type).toLowerCase();
  const templateDir = path.resolve(repoRoot, '.github/ISSUE_TEMPLATE');

  if (fs.existsSync(templateDir)) {
    try {
      const files = fs.readdirSync(templateDir);
      const isTemplateFile = (f) => f.endsWith('.md') || f.endsWith('.yml') || f.endsWith('.yaml');
      let matchFile = null;
      if (normType === 'hotfix') {
        matchFile =
          files.find((f) => /hotfix|incident/i.test(f) && isTemplateFile(f)) ||
          files.find((f) => /bug/i.test(f) && isTemplateFile(f));
      } else if (normType === 'bug' || normType === 'fix') {
        matchFile = files.find((f) => (/bug/i.test(f) || (/fix/i.test(f) && !/hotfix/i.test(f))) && isTemplateFile(f));
      } else if (normType === 'spike' || normType === 'research') {
        matchFile =
          files.find((f) => /spike|adr|arch/i.test(f) && isTemplateFile(f)) ||
          files.find((f) => /feat|feature|enhancement/i.test(f) && isTemplateFile(f));
      } else {
        matchFile = files.find((f) => /feat|feature|enhancement/i.test(f) && isTemplateFile(f));
      }

      if (matchFile) {
        const fullPath = path.join(templateDir, matchFile);
        const raw = readFileSafe(fullPath);
        if (raw) {
          const { frontmatter, body } = parseFrontmatter(raw);
          return {
            source: 'github',
            file: path.relative(repoRoot, fullPath),
            frontmatter,
            rawTemplate: body || raw,
            name: frontmatter.name || matchFile,
            labels: frontmatter.labels ? frontmatter.labels.split(',').map((s) => s.trim()).filter(Boolean) : []
          };
        }
      }
    } catch {}
  }

  return {
    source: 'standard',
    file: null,
    frontmatter: {},
    rawTemplate: null,
    name: normType === 'bug' || normType === 'fix' || normType === 'hotfix' ? 'Standard Bug Report' : 'Standard Feature Request',
    labels: []
  };
}

export function formatTemplatedIssue({
  title = '',
  type = 'feat',
  body = '',
  problem = '',
  solution = '',
  acceptanceCriteria = '',
  reproduce = '',
  expected = '',
  environment = '',
  repoRoot = '.'
} = {}) {
  const template = loadIssueTemplate({ type, repoRoot });
  const normType = (type || 'feat').toLowerCase();
  const isBug = normType === 'bug' || normType === 'fix' || normType === 'hotfix';
  const { minCov, minMut } = resolveConfiguredQualityBars(repoRoot);
  const mutClause = minMut !== null ? `, >= ${minMut}% mutation` : '';

  let renderedBody = '';

  if (template.rawTemplate) {
    let t = template.rawTemplate;
    if (isBug) {
      const bugDesc = problem || body || title;
      const reproSteps = reproduce || '1. Observe behavior\n2. Run automated test suite\n3. Note failure';
      const expBehavior = expected || solution || 'All automated assertions pass with zero regressions.';
      const envInfo = environment || '- OS: mac / linux\n- Runtime: node.js';

      t = t.replace(/A clear and concise description of what the bug is\./i, bugDesc);
      t = t.replace(/Steps to reproduce the behavior:[\s\S]*?(?=\*\*Expected|\n\n(?:\*\*|### )|$)/i, `Steps to reproduce the behavior:\n${reproSteps}\n`);
      t = t.replace(/A clear and concise description of what you expected to happen\.[^\n]*/i, expBehavior);
      t = t.replace(/- OS: \[e\.g\. [^\]]+\][\s\S]*?(?=$|\n\n)/i, envInfo);
    } else {
      const probDesc = problem || body || `Enhancement required for ${title}.`;
      const solDesc = solution || acceptanceCriteria || body || 'Deliver complete end-to-end functionality adhering to Concentric Clean Architecture and TDD.';

      t = t.replace(/A clear and concise description of what the problem is\.[^\n]*/i, probDesc);
      t = t.replace(/A clear and concise description of what you want to happen\.[^\n]*/i, solDesc);
    }
    const mutPhrase =
      minMut !== null
        ? `and \`>= ${minMut}%\` mutation score (\`.agent/sdlc-config.json\`)`
        : '(mutation testing disabled per `.agent/sdlc-config.json`)';
    t = t
      .replace(
        /Diff line coverage `>= 85%` and configured mutation score \(`\.agent\/sdlc-config\.json`\)/gi,
        `Diff line coverage \`>= ${minCov}%\` ${mutPhrase}`
      )
      .replace(/`>= 85%`/g, `\`>= ${minCov}%\``);
    renderedBody = t;
  } else {
    if (isBug) {
      renderedBody =
        `### 🐛 Bug Description\n${problem || body || title}\n\n` +
        `### 🔄 Steps to Reproduce\n${reproduce || '1. Execute test suite\n2. Observe red failure'}\n\n` +
        `### 🎯 Expected Behavior (Red-Green-Refactor TDD)\n${expected || solution || 'Failing red test must be made green with minimal implementation.'}\n\n` +
        `### 💻 Environment\n${environment || '- OS: ' + (process.platform || 'mac')}\n`;
    } else {
      renderedBody =
        `### 🎯 Problem Statement & User Value\n${problem || body || title}\n\n` +
        `### 🚀 Solution & Acceptance Criteria\n${solution || acceptanceCriteria || body || 'Complete implementation with Dual-Gate test and mutation coverage.'}\n\n` +
        `### 🛡️ Clean Code Guarantees\n- 100% test pass rate with Red-Green-Refactor TDD\n- >= ${minCov}% diff test coverage${mutClause}\n- Zero direct pushes to protected branches\n`;
    }
  }

  const baseLabel = isBug ? (normType === 'hotfix' ? 'hotfix,status:ready,priority:critical' : 'bug,status:ready') : 'feature,status:ready';
  const templateLabels = template.labels || [];
  const mergedLabelsList = Array.from(new Set([...baseLabel.split(','), ...templateLabels])).filter(Boolean);

  return {
    template,
    title,
    body: renderedBody.trim(),
    labels: mergedLabelsList.join(',')
  };
}

export function updateLocalKanbanState(repoRoot, targetId, normalizedState) {
  const kanbanPath = path.resolve(repoRoot, 'docs/KANBAN.md');
  if (!fs.existsSync(kanbanPath)) return false;
  try {
    const content = fs.readFileSync(kanbanPath, 'utf8');
    const cleanId = String(targetId).replace(/^#/, '');
    const escapedId = cleanId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isAlphaKey = /^[A-Z]+-\d+$/i.test(cleanId);
    const ticketRe = isAlphaKey
      ? new RegExp(`(?<![A-Za-z0-9-])#?${escapedId}(?![A-Za-z0-9-])`)
      : new RegExp(`(?:^|[^\\w#])#${escapedId}(?!\\d)|(?:^|\\s)${escapedId}:`);
    const ticketMarker = isAlphaKey ? cleanId : `#${cleanId}`;
    if (!ticketRe.test(content)) return false;

    const lines = content.split('\n');
    const updatedLines = [];
    for (const line of lines) {
      if (ticketRe.test(line) && line.startsWith('|')) {
        const cells = line.split('|').map((c) => c.trim());
        if (cells.length === 7) {
          const itemContent =
            cells.slice(1, 6).find((c) => ticketRe.test(c)) || ticketMarker;
          let c1 = '',
            c2 = '',
            c3 = '',
            c4 = '',
            c5 = '';
          if (normalizedState === 'backlog' || normalizedState === 'todo') c1 = itemContent;
          else if (normalizedState === 'ready') c2 = itemContent;
          else if (normalizedState === 'in-progress' || normalizedState === 'inprogress' || normalizedState === 'in progress')
            c3 = itemContent;
          else if (normalizedState === 'in-review' || normalizedState === 'inreview' || normalizedState === 'review')
            c4 = itemContent;
          else if (normalizedState === 'done' || normalizedState === 'closed') c5 = itemContent;
          updatedLines.push(`| ${c1} | ${c2} | ${c3} | ${c4} | ${c5} |`);
          continue;
        } else if (cells.length === 8 && ticketRe.test(cells[1])) {
          updatedLines.push(
            `| ${cells[1]} | \`status:${normalizedState}\` | ${cells[3]} | ${cells[4]} | ${cells[5]} | ${cells[6]} |`
          );
          continue;
        }
      }
      updatedLines.push(line);
    }
    writeFileAtomic(kanbanPath, updatedLines.join('\n'));
    return true;
  } catch {
    return false;
  }
}

function mirrorTicketToKanban(repoRoot, { issueId, prefix, fullTitle }) {
  const kanbanPath = path.resolve(repoRoot, 'docs/KANBAN.md');
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  let content = readFileSafe(kanbanPath);

  if (!content) {
    fs.mkdirSync(path.dirname(kanbanPath), { recursive: true });
    content = `# 📋 Project Kanban Board & Traceability Matrix\n\n> **Living Project State & Audit Trail**\n> **Last Synced**: \`${now}\`\n\n---\n\n## 📊 Board Overview\n\n| 📥 Backlog | 📋 Ready | ⚡ In Progress | 🔍 In Review | ✅ Done |\n| :--- | :--- | :--- | :--- | :--- |\n\n---\n\n## 🎯 End-to-End Traceability Matrix\n\n| Issue / Spec | Status | Priority | Component | Milestone | Spec / Contract |\n| :--- | :--- | :--- | :--- | :--- |\n`;
  }

  const displayId = String(issueId).startsWith('#') || /^[A-Z]+-\d+$/.test(String(issueId)) ? String(issueId) : `#${issueId}`;
  const ticketRef = `${displayId}: [${prefix.toUpperCase()}] ${fullTitle}`;
  if (!content.includes(`${displayId}:`)) {
    const tableMarker = '| :--- | :--- | :--- | :--- | :--- |\n';
    const tableIdx = content.indexOf(tableMarker);
    if (tableIdx !== -1) {
      const insertPos = tableIdx + tableMarker.length;
      content = content.slice(0, insertPos) + `| | ${ticketRef} | | | |\n` + content.slice(insertPos);
    }

    const matrixMarker =
      '## 🎯 End-to-End Traceability Matrix\n\n| Issue / Spec | Status | Priority | Component | Milestone | Spec / Contract |\n| :--- | :--- | :--- | :--- | :--- |\n';
    const matrixIdx = content.indexOf(matrixMarker);
    if (matrixIdx !== -1) {
      const insertPos = matrixIdx + matrixMarker.length;
      const priority = prefix === 'hotfix' ? '`P0 - Blocker`' : prefix === 'fix' || prefix === 'bug' ? '`P1 - High`' : '`P2 - Medium`';
      content =
        content.slice(0, insertPos) +
        `| **${displayId}** | \`status:ready\` | ${priority} | Core | Current | ${fullTitle} |\n` +
        content.slice(insertPos);
    }
    writeFileAtomic(kanbanPath, content);
  }
  return kanbanPath;
}

export function transitionPMState({ issueId, state = 'in-progress', repoRoot = '.', execFn = execFileSync } = {}) {
  const pm = detectPMProvider(repoRoot);
  const targetId = Number(issueId) || issueId;
  const normalizedState = String(state).toLowerCase().trim();

  let statusDisplayName = 'In progress';
  if (normalizedState === 'backlog' || normalizedState === 'todo') {
    statusDisplayName = 'Todo';
  } else if (normalizedState === 'ready') {
    statusDisplayName = 'Ready';
  } else if (normalizedState === 'in-progress' || normalizedState === 'inprogress' || normalizedState === 'in progress') {
    statusDisplayName = 'In progress';
  } else if (normalizedState === 'in-review' || normalizedState === 'inreview' || normalizedState === 'review') {
    statusDisplayName = 'In review';
  } else if (normalizedState === 'done' || normalizedState === 'closed') {
    statusDisplayName = 'Done';
  }

  let projectUpdated = false;
  let labelUpdated = false;
  let projectDetails = null;

  updateLocalKanbanState(repoRoot, targetId, normalizedState);

  if (pm.provider === 'github') {
    try {
      const stateLabel = `status:${normalizedState}`;
      const statusLabels = ['status:backlog', 'status:ready', 'status:in-progress', 'status:in-review', 'status:done'];
      const toRemove = statusLabels.filter((l) => l !== stateLabel).join(',');
      try {
        execFn('gh', ['issue', 'edit', String(targetId), '--remove-label', toRemove], { cwd: repoRoot, stdio: 'pipe' });
      } catch {}
      execFn('gh', ['issue', 'edit', String(targetId), '--add-label', stateLabel], { cwd: repoRoot, stdio: 'pipe' });
      labelUpdated = true;
    } catch {}

    try {
      const repoView = execFn('gh', ['repo', 'view', '--json', 'nameWithOwner,owner,name'], {
        cwd: repoRoot,
        stdio: 'pipe',
        encoding: 'utf8'
      }).trim();
      if (repoView) {
        const repoObj = JSON.parse(repoView);
        const owner = repoObj.owner?.login || repoObj.nameWithOwner?.split('/')[0];
        const repoName = repoObj.name || repoObj.nameWithOwner?.split('/')[1];

        const gqlQuery = `query($owner: String!, $repo: String!) {
          repository(owner: $owner, name: $repo) {
            projectsV2(first: 5) {
              nodes {
                id
                number
                title
                fields(first: 20) {
                  nodes {
                    ... on ProjectV2SingleSelectField {
                      id
                      name
                      options {
                        id
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        }`;

        const gqlOutput = execFn(
          'gh',
          ['api', 'graphql', '-f', `query=${gqlQuery}`, '-F', `owner=${owner}`, '-F', `repo=${repoName}`],
          { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' }
        ).trim();

        if (gqlOutput) {
          const gqlData = JSON.parse(gqlOutput);
          const projects = gqlData.data?.repository?.projectsV2?.nodes || [];

          for (const prj of projects) {
            const statusField = prj.fields?.nodes?.find((f) => f && f.name && f.name.toLowerCase() === 'status');
            if (statusField && statusField.options && statusField.options.length > 0) {
              let matchedOption = statusField.options.find((opt) => opt.name.toLowerCase() === statusDisplayName.toLowerCase());
              if (!matchedOption) {
                matchedOption = statusField.options.find(
                  (opt) =>
                    opt.name.toLowerCase().includes(statusDisplayName.toLowerCase()) ||
                    statusDisplayName.toLowerCase().includes(opt.name.toLowerCase())
                );
              }
              if (!matchedOption) {
                if (statusDisplayName === 'Ready' || statusDisplayName === 'Backlog') {
                  matchedOption = statusField.options.find((opt) => opt.name.toLowerCase() === 'todo');
                } else if (statusDisplayName === 'In review') {
                  matchedOption = statusField.options.find((opt) => opt.name.toLowerCase().includes('progress'));
                }
              }

              if (matchedOption) {
                let itemId = null;
                const issueUrl = `https://github.com/${owner}/${repoName}/issues/${targetId}`;
                try {
                  const addItemOut = execFn(
                    'gh',
                    ['project', 'item-add', String(prj.number), '--owner', owner, '--url', issueUrl, '--format', 'json'],
                    { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' }
                  ).trim();
                  if (addItemOut) {
                    const itemObj = JSON.parse(addItemOut);
                    itemId = itemObj.id;
                  }
                } catch {}

                if (!itemId) {
                  try {
                    const listItemsOut = execFn(
                      'gh',
                      ['project', 'item-list', String(prj.number), '--owner', owner, '--format', 'json'],
                      { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' }
                    ).trim();
                    if (listItemsOut) {
                      const listData = JSON.parse(listItemsOut);
                      const found = (listData.items || []).find((it) => it.content?.number === Number(targetId));
                      if (found) itemId = found.id;
                    }
                  } catch {}
                }

                if (itemId) {
                  execFn(
                    'gh',
                    [
                      'project',
                      'item-edit',
                      '--id',
                      String(itemId),
                      '--project-id',
                      String(prj.id),
                      '--field-id',
                      String(statusField.id),
                      '--single-select-option-id',
                      String(matchedOption.id)
                    ],
                    { cwd: repoRoot, stdio: 'pipe' }
                  );
                  projectUpdated = true;
                  projectDetails = {
                    projectNumber: prj.number,
                    projectTitle: prj.title,
                    statusField: statusField.name,
                    statusValue: matchedOption.name
                  };
                  break;
                }
              }
            }
          }
        }
      }
    } catch {}

    return {
      success: true,
      provider: 'github',
      issueId: targetId,
      state: normalizedState,
      statusDisplayName,
      labelUpdated,
      projectUpdated,
      projectDetails
    };
  }

  if (pm.provider === 'linear') {
    try {
      const apiKey = process.env.LINEAR_API_KEY || '';
      const linearHeaders = {
        Authorization: apiKey,
        'Content-Type': 'application/json'
      };
      const statesQuery = JSON.stringify({
        query: `query WorkflowStates { workflowStates(first: 50) { nodes { id name type } } }`
      });
      const parsedStates = curlJsonRequest({
        url: 'https://api.linear.app/graphql',
        method: 'POST',
        headers: linearHeaders,
        body: statesQuery,
        cwd: repoRoot,
        execFn
      });
      const stateNodes = parsedStates?.data?.workflowStates?.nodes || [];
      let matchedState = stateNodes.find((s) => s.name?.toLowerCase() === statusDisplayName.toLowerCase());
      if (!matchedState) {
        matchedState = stateNodes.find(
          (s) =>
            s.name?.toLowerCase().includes(statusDisplayName.toLowerCase()) ||
            (normalizedState === 'done' && s.type === 'completed') ||
            (normalizedState === 'in-progress' && s.type === 'started') ||
            ((normalizedState === 'ready' || normalizedState === 'todo') && s.type === 'unstarted') ||
            (normalizedState === 'backlog' && s.type === 'backlog')
        );
      }

      if (matchedState?.id) {
        const updatePayload = JSON.stringify({
          query: `mutation IssueUpdate($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }`,
          variables: { id: String(targetId), stateId: String(matchedState.id) }
        });
        curlJsonRequest({
          url: 'https://api.linear.app/graphql',
          method: 'POST',
          headers: linearHeaders,
          body: updatePayload,
          cwd: repoRoot,
          execFn
        });
        return {
          success: true,
          provider: 'linear',
          issueId: targetId,
          state: normalizedState,
          statusDisplayName: matchedState.name || statusDisplayName,
          stateId: matchedState.id
        };
      }
      return {
        success: false,
        provider: 'linear',
        issueId: targetId,
        state: normalizedState,
        statusDisplayName,
        error: `No matching Linear workflow state found for '${statusDisplayName}'.`
      };
    } catch (err) {
      return {
        success: false,
        provider: 'linear',
        issueId: targetId,
        state: normalizedState,
        statusDisplayName,
        error: err?.message || String(err)
      };
    }
  }

  if (pm.provider === 'jira') {
    try {
      const baseUrl = (process.env.JIRA_BASE_URL || 'https://jira.example.com').replace(/\/$/, '');
      const auth = Buffer.from(`${process.env.JIRA_EMAIL || 'bot'}:${process.env.JIRA_API_TOKEN || ''}`).toString('base64');
      const encodedId = encodeURIComponent(String(targetId));
      const transitionsUrl = `${baseUrl}/rest/api/3/issue/${encodedId}/transitions`;
      const transitionsData = curlJsonRequest({
        url: transitionsUrl,
        method: 'GET',
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json'
        },
        cwd: repoRoot,
        execFn
      });
      const transitions = transitionsData.transitions || [];
      const matchedTransition = transitions.find(
        (t) =>
          t.name?.toLowerCase() === statusDisplayName.toLowerCase() ||
          t.to?.name?.toLowerCase() === statusDisplayName.toLowerCase() ||
          t.name?.toLowerCase().includes(statusDisplayName.toLowerCase())
      );
      if (matchedTransition?.id) {
        const postBody = JSON.stringify({ transition: { id: String(matchedTransition.id) } });
        curlJsonRequest({
          url: transitionsUrl,
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json'
          },
          body: postBody,
          cwd: repoRoot,
          execFn
        });
        return {
          success: true,
          provider: 'jira',
          issueId: targetId,
          state: normalizedState,
          statusDisplayName: matchedTransition.name || statusDisplayName,
          transitionId: matchedTransition.id
        };
      }
      return {
        success: false,
        provider: 'jira',
        issueId: targetId,
        state: normalizedState,
        statusDisplayName,
        error: `No matching Jira workflow transition found for '${statusDisplayName}'.`
      };
    } catch (err) {
      return {
        success: false,
        provider: 'jira',
        issueId: targetId,
        state: normalizedState,
        statusDisplayName,
        error: err?.message || String(err)
      };
    }
  }

  return {
    success: true,
    provider: pm.provider,
    issueId: targetId,
    state: normalizedState,
    statusDisplayName
  };
}

export function createTicket({
  title,
  type = 'feat',
  body = '',
  problem = '',
  solution = '',
  acceptanceCriteria = '',
  reproduce = '',
  expected = '',
  environment = '',
  repoRoot = '.',
  execFn = execFileSync
} = {}) {
  const pm = detectPMProvider(repoRoot);
  const normalizedType = type.toLowerCase();
  let prefix = 'feat';

  if (normalizedType === 'bug' || normalizedType === 'fix') {
    prefix = 'fix';
  } else if (normalizedType === 'hotfix') {
    prefix = 'hotfix';
  } else if (normalizedType === 'spike' || normalizedType === 'research') {
    prefix = 'spike';
  }

  const fullTitle = title.startsWith(`${prefix}:`) || title.startsWith(`${prefix}(`) ? title : `${prefix}: ${title}`;

  const templated = formatTemplatedIssue({
    title: fullTitle,
    type: prefix,
    body,
    problem,
    solution,
    acceptanceCriteria,
    reproduce,
    expected,
    environment,
    repoRoot
  });

  const issueBody = templated.body;
  const labelsToApply = templated.labels;

  if (pm.provider === 'github') {
    try {
      let output = '';
      try {
        output = execFn(
          'gh',
          ['issue', 'create', '--title', fullTitle, '--body', issueBody, '--label', labelsToApply],
          { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' }
        );
      } catch {
        output = execFn(
          'gh',
          ['issue', 'create', '--title', fullTitle, '--body', issueBody],
          { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' }
        );
      }
      const url = output.trim();
      const match = url.match(/\/issues\/(\d+)/);
      const issueId = match ? Number(match[1]) : null;

      if (issueId) {
        mirrorTicketToKanban(repoRoot, { issueId, prefix, fullTitle });
        try {
          transitionPMState({ issueId, state: 'ready', repoRoot, execFn });
        } catch {}
      }

      return { success: true, provider: 'github', issueId, url, title: fullTitle, type: prefix, template: templated.template.name };
    } catch {
      console.warn('⚠️ GitHub issue creation failed or CLI not authenticated. Falling back to local docs/KANBAN.md.');
    }
  }

  if (pm.provider === 'linear') {
    try {
      const apiKey = process.env.LINEAR_API_KEY || '';
      const linearHeaders = {
        Authorization: apiKey,
        'Content-Type': 'application/json'
      };
      const teamKey = process.env.LINEAR_TEAM_KEY || '';
      const teamsQuery = JSON.stringify({
        query: `query Teams { teams(first: 10) { nodes { id key name } } }`
      });
      const teamsData = curlJsonRequest({
        url: 'https://api.linear.app/graphql',
        method: 'POST',
        headers: linearHeaders,
        body: teamsQuery,
        cwd: repoRoot,
        execFn
      });
      const teams = teamsData?.data?.teams?.nodes || [];
      const matchedTeam = (teamKey && teams.find((t) => t.key?.toLowerCase() === teamKey.toLowerCase())) || teams[0];
      const teamId = matchedTeam?.id || 'TEAM-DEFAULT';
      const priority = prefix === 'hotfix' ? 1 : prefix === 'fix' ? 2 : 3;

      const createMutation = JSON.stringify({
        query: `mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url title } } }`,
        variables: {
          input: {
            teamId,
            title: fullTitle,
            description: issueBody,
            priority
          }
        }
      });

      const created = curlJsonRequest({
        url: 'https://api.linear.app/graphql',
        method: 'POST',
        headers: linearHeaders,
        body: createMutation,
        cwd: repoRoot,
        execFn
      });
      const issueNode = created?.data?.issueCreate?.issue;
      if (issueNode && (issueNode.identifier || issueNode.id)) {
        const issueId = issueNode.identifier || issueNode.id;
        const url = issueNode.url || `https://linear.app/issue/${issueId}`;
        mirrorTicketToKanban(repoRoot, { issueId, prefix, fullTitle });
        return {
          success: true,
          provider: 'linear',
          issueId,
          url,
          title: fullTitle,
          type: prefix,
          template: templated.template.name
        };
      }
    } catch {
      console.warn('⚠️ Linear issue creation failed. Falling back to local docs/KANBAN.md.');
    }
  }

  if (pm.provider === 'jira') {
    try {
      const baseUrl = (process.env.JIRA_BASE_URL || 'https://jira.example.com').replace(/\/$/, '');
      const projectKey = process.env.JIRA_PROJECT_KEY || 'SDLC';
      const auth = Buffer.from(`${process.env.JIRA_EMAIL || 'bot'}:${process.env.JIRA_API_TOKEN || ''}`).toString('base64');
      const issueTypeName =
        prefix === 'fix' || prefix === 'hotfix' ? 'Bug' : prefix === 'spike' ? 'Task' : 'Story';

      const payload = JSON.stringify({
        fields: {
          project: { key: projectKey },
          summary: fullTitle,
          issuetype: { name: issueTypeName },
          labels: labelsToApply
            .split(',')
            .map((l) => l.trim().replace(/\s+/g, '-'))
            .filter(Boolean),
          description: {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: issueBody }]
              }
            ]
          }
        }
      });

      const created = curlJsonRequest({
        url: `${baseUrl}/rest/api/3/issue`,
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        body: payload,
        cwd: repoRoot,
        execFn
      });
      if (created.key || created.id) {
        const issueId = created.key || created.id;
        const url = `${baseUrl}/browse/${issueId}`;
        mirrorTicketToKanban(repoRoot, { issueId, prefix, fullTitle });
        return {
          success: true,
          provider: 'jira',
          issueId,
          url,
          title: fullTitle,
          type: prefix,
          template: templated.template.name
        };
      }
    } catch {
      console.warn('⚠️ Jira issue creation failed. Falling back to local docs/KANBAN.md.');
    }
  }

  const issueId = allocateNextLocalTicketId(repoRoot);
  mirrorTicketToKanban(repoRoot, { issueId, prefix, fullTitle });
  return {
    success: true,
    provider: 'local',
    issueId,
    url: `docs/KANBAN.md#${issueId}`,
    title: fullTitle,
    type: prefix,
    template: templated.template.name
  };
}

export function resolveOpenPRNumber({ prNumber = null, branch = null, repoRoot = '.', execFn = execFileSync } = {}) {
  if (prNumber !== null && prNumber !== undefined && String(prNumber).trim() !== '') {
    const cleaned = String(prNumber).trim().replace(/^#/, '');
    return Number(cleaned) || cleaned;
  }

  const activeSess = readSessionFileState(repoRoot).session;
  const manifestPr = activeSess?.manifest?.prNumber;
  if (manifestPr !== null && manifestPr !== undefined && String(manifestPr).trim() !== '') {
    const cleaned = String(manifestPr).trim().replace(/^#/, '');
    return Number(cleaned) || cleaned;
  }

  const pm = detectPMProvider(repoRoot);
  if (pm.provider === 'github' && (hasGitHubRemote(repoRoot) || execFn !== execFileSync)) {
    const targetBranch = branch || activeSess?.branch || null;
    try {
      const out = execFn(
        'gh',
        ['pr', 'view', ...(targetBranch ? [targetBranch] : []), '--json', 'number,url'],
        { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' }
      );
      const parsed = out ? JSON.parse(String(out).trim()) : null;
      if (parsed && parsed.number) {
        const num = Number(parsed.number) || parsed.number;
        patchActiveSessionManifest(repoRoot, { prNumber: num, ...(parsed.url ? { prUrl: parsed.url } : {}) });
        return num;
      }
    } catch {}
  }

  return null;
}

export function ensurePullRequest({
  issueId = null,
  branch = null,
  title = null,
  body = '',
  baseBranch = null,
  repoRoot = '.',
  execFn = execFileSync
} = {}) {
  const activeSess = readSessionFileState(repoRoot).session;
  const targetBaseBranch = baseBranch || resolveDefaultBaseBranch(repoRoot);
  const targetBranch =
    branch ||
    activeSess?.branch ||
    (gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot) || '').trim() ||
    null;
  const targetIssueId = issueId || activeSess?.issueId || null;

  const existingPr = resolveOpenPRNumber({ branch: targetBranch, repoRoot, execFn });
  if (existingPr) {
    const refreshedSess = readSessionFileState(repoRoot).session;
    return {
      success: true,
      created: false,
      prNumber: existingPr,
      prUrl: refreshedSess?.manifest?.prUrl || null,
      branch: targetBranch
    };
  }

  const pm = detectPMProvider(repoRoot);
  if (pm.provider !== 'github' || (!hasGitHubRemote(repoRoot) && execFn === execFileSync)) {
    return {
      success: false,
      skipped: true,
      created: false,
      prNumber: null,
      branch: targetBranch,
      reason: 'No GitHub remote configured.'
    };
  }

  if (targetBranch && targetBranch !== 'main' && targetBranch !== 'develop') {
    try {
      execFn('git', ['push', '-u', 'origin', targetBranch], { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' });
    } catch {}
  }

  const prTitle =
    title ||
    (targetIssueId
      ? `${activeSess?.type || 'feat'}(#${targetIssueId}): ${targetBranch || 'SDLC Delivery'}`
      : `feat: ${targetBranch || 'SDLC Delivery'}`);
  const prBody = body || (targetIssueId ? `Closes #${targetIssueId}` : 'Automated SDLC Pull Request');

  try {
    const createOut = execFn(
      'gh',
      [
        'pr',
        'create',
        '--title',
        prTitle,
        '--body',
        prBody,
        '--base',
        targetBaseBranch,
        ...(targetBranch ? ['--head', targetBranch] : [])
      ],
      { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' }
    );
    const prUrl = String(createOut || '')
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .pop() || '';
    const match = prUrl.match(/\/pull\/(\d+)/);
    const createdPrNumber = match ? Number(match[1]) : resolveOpenPRNumber({ branch: targetBranch, repoRoot, execFn });
    if (createdPrNumber) {
      patchActiveSessionManifest(repoRoot, { prNumber: createdPrNumber, ...(prUrl ? { prUrl } : {}) });
      return {
        success: true,
        created: true,
        prNumber: createdPrNumber,
        prUrl: prUrl || null,
        branch: targetBranch
      };
    }
  } catch (err) {
    const fallbackPr = resolveOpenPRNumber({ branch: targetBranch, repoRoot, execFn });
    if (fallbackPr) {
      const refreshedSess = readSessionFileState(repoRoot).session;
      return {
        success: true,
        created: false,
        prNumber: fallbackPr,
        prUrl: refreshedSess?.manifest?.prUrl || null,
        branch: targetBranch
      };
    }
    return {
      success: false,
      created: false,
      prNumber: null,
      branch: targetBranch,
      error: err.message
    };
  }

  return {
    success: false,
    created: false,
    prNumber: null,
    branch: targetBranch,
    error: 'Unable to resolve PR number from gh pr create output.'
  };
}

function formatPillarFlag(val, isStale = false) {
  if (val === true) return '✅ PASSED';
  if (val === false) return '❌ FAILED';
  if (val === 'na') return '⚪ N/A';
  return isStale ? '⏳ STALE (re-run gate)' : '⏳ NOT VERIFIED';
}

function formatMetricPillar(rawVal, explicitPass, minThreshold, notConfiguredLabel = null, isStale = false) {
  if (rawVal === null || rawVal === undefined || rawVal === '') {
    return notConfiguredLabel || '⏳ NOT MEASURED';
  }
  const str = String(rawVal).includes('%') ? String(rawVal) : `${rawVal}%`;
  const num = Number.parseFloat(str.replace('%', ''));
  let passed = explicitPass;
  if (isStale && passed !== false) {
    return `⏳ STALE (${str} from prior commit)`;
  }
  if (passed !== true && passed !== false && Number.isFinite(num)) {
    passed = minThreshold === null ? true : num >= minThreshold;
  }
  if (passed === false) {
    const suffix = minThreshold !== null && Number.isFinite(num) && num < minThreshold ? ` (< ${minThreshold}%)` : '';
    return `❌ ${str}${suffix}`;
  }
  if (passed === true) return `✅ ${str}`;
  return `⏳ ${str}`;
}

export function formatConsolidatedReviewComment({
  issueId = null,
  prNumber = null,
  branch = null,
  headSha = null,
  verdict = 'approve',
  reviewer = '@sdlc-gate',
  peerReviewSummary = '',
  archSecuritySummary = '',
  body = '',
  coveragePct = null,
  mutationPct = null,
  coveragePassed = undefined,
  mutationPassed = undefined,
  testsPassed = undefined,
  archPassed = undefined,
  driftPassed = undefined,
  contractPassed = undefined,
  securityPassed = undefined,
  flakePassed = undefined,
  wikiPassed = undefined,
  gatePillars = null,
  receiptId = null,
  repoRoot = '.'
} = {}) {
  const activeSess = readSessionFileState(repoRoot).session;
  const resolvedIssue = issueId ?? activeSess?.issueId ?? 'N/A';
  const resolvedPr = prNumber ?? activeSess?.manifest?.prNumber ?? null;
  const resolvedBranch = branch || activeSess?.branch || 'current-branch';
  const resolvedSha =
    headSha ||
    (gitOutput(['rev-parse', 'HEAD'], repoRoot) || '').trim() ||
    'HEAD';
  const shortSha = resolvedSha.length >= 8 ? resolvedSha.slice(0, 8) : resolvedSha;
  const isApproved = String(verdict || 'approve').toLowerCase() === 'approve';
  const verdictBadge = isApproved ? '✅ APPROVED' : '❌ CHANGES REQUESTED';

  const { minCov, minMut } = resolveConfiguredQualityBars(repoRoot);
  const mutReqLabel = minMut === null ? 'N/A (not configured)' : `\`>= ${minMut}%\``;

  const recordedPillars = gatePillars || activeSess?.manifest?.gatePillars || null;
  const pillarsStale = Boolean(
    recordedPillars && recordedPillars.headSha && resolvedSha !== 'HEAD' && !sameShaPrefix(recordedPillars.headSha, resolvedSha)
  );
  const pickPillar = (explicitVal, key) => {
    if (explicitVal !== undefined) return explicitVal;
    if (!pillarsStale && recordedPillars && Object.prototype.hasOwnProperty.call(recordedPillars, key)) {
      return recordedPillars[key];
    }
    return null;
  };

  const explicitCovProvided = coveragePct !== null && coveragePct !== undefined;
  const explicitMutProvided = mutationPct !== null && mutationPct !== undefined;
  const rawCov = explicitCovProvided ? coveragePct : activeSess?.manifest?.coverageReport ?? null;
  const rawMut = explicitMutProvided ? mutationPct : activeSess?.manifest?.mutationScore ?? null;
  const covSha = activeSess?.manifest?.coverageHeadSha || recordedPillars?.headSha || null;
  const mutSha = activeSess?.manifest?.mutationHeadSha || recordedPillars?.headSha || null;
  const covStale = !explicitCovProvided && Boolean(rawCov && resolvedSha !== 'HEAD' && (pillarsStale || (covSha && !sameShaPrefix(covSha, resolvedSha))));
  const mutStale = !explicitMutProvided && Boolean(rawMut && resolvedSha !== 'HEAD' && (pillarsStale || (mutSha && !sameShaPrefix(mutSha, resolvedSha))));
  const covStatus = formatMetricPillar(rawCov, pickPillar(coveragePassed, 'coveragePassed'), minCov, null, covStale);
  const mutStatus = formatMetricPillar(
    rawMut,
    pickPillar(mutationPassed, 'mutationPassed'),
    minMut,
    minMut === null ? '⚪ N/A (not configured)' : null,
    mutStale
  );

  const effectiveDrift =
    pickPillar(driftPassed, 'driftPassed') === false || pickPillar(wikiPassed, 'wikiPassed') === false
      ? false
      : pickPillar(driftPassed, 'driftPassed');

  const subagent1Text =
    peerReviewSummary ||
    body ||
    'Verified Red-Green-Refactor TDD discipline, F.I.R.S.T. test isolation, zero assertion-free or mock-heavy test smells, and Dual-Gate coverage/mutation thresholds.';

  const subagent2Text =
    archSecuritySummary ||
    'Verified `.archlens/policy.json` Concentric Clean Architecture ring boundaries (`Core -> UseCase -> Adapter`), zero API contract drift, and zero leaked secrets or high-severity CVEs.';

  const resolvedReceiptId = receiptId || 'PENDING (not yet signed)';

  return [
    `## 🛡️ Agentic SDLC Peer Review & Quality Gate Verdict`,
    ``,
    `| Field | Value |`,
    `| :--- | :--- |`,
    `| **Verdict** | **${verdictBadge}** |`,
    `| **Reviewer** | \`${reviewer}\` |`,
    `| **Ticket / PR** | #${resolvedIssue}${resolvedPr ? ` / PR #${resolvedPr}` : ''} |`,
    `| **Branch / Commit** | \`${resolvedBranch}\` (\`${shortSha}\`) |`,
    ``,
    `---`,
    ``,
    `### 1. 🧪 Subagent 1: PR Peer Reviewer (TDD & Clean Code)`,
    `${subagent1Text}`,
    ``,
    `---`,
    ``,
    `### 2. 🏛️ Subagent 2: Architecture & Security Gatekeeper`,
    `${subagent2Text}`,
    ``,
    `---`,
    ``,
    `### 3. 📊 Strict 9-Pillar Quality Gate & Stage 7 Cryptographic Receipt`,
    `| # | Quality Gate Pillar | Requirement | Measured / Status |`,
    `| :--- | :--- | :--- | :--- |`,
    `| 1 | **Unit & Integration Tests** | 100% Pass (F.I.R.S.T.) | ${formatPillarFlag(pickPillar(testsPassed, 'unitTestsPassed'), pillarsStale)} |`,
    `| 2 | **Diff Test Coverage** | \`>= ${minCov}%\` | ${covStatus} |`,
    `| 3 | **Mutation Kill Score** | ${mutReqLabel} | ${mutStatus} |`,
    `| 4 | **Archlens Concentric Rings** | Zero Inner -> Outer Imports | ${formatPillarFlag(pickPillar(archPassed, 'archPassed'), pillarsStale)} |`,
    `| 5 | **Spec-Drift Sentinel** | \`PRODUCT.md\` / \`docs/adr/\` Sync | ${formatPillarFlag(effectiveDrift, pillarsStale)} |`,
    `| 6 | **API Contract Drift** | Zero Breaking Schema Changes | ${formatPillarFlag(pickPillar(contractPassed, 'contractPassed'), pillarsStale)} |`,
    `| 7 | **Security & CVE Audit** | Zero Secrets / High CVEs | ${formatPillarFlag(pickPillar(securityPassed, 'securityPassed'), pillarsStale)} |`,
    `| 8 | **Flake Resistance** | Deterministic Multi-Run | ${formatPillarFlag(pickPillar(flakePassed, 'flakePassed'), pillarsStale)} |`,
    `| 9 | **Stage 7 HMAC Receipt** | HMAC-SHA256 Signed in \`docs/AUDIT_CHAIN.jsonl\` | \`${resolvedReceiptId}\` |`
  ].join('\n');
}

export function postPMComment({
  issueId,
  prNumber = null,
  comment = '',
  allowLocalFallback = false,
  repoRoot = '.',
  execFn = execFileSync
} = {}) {
  const pm = detectPMProvider(repoRoot);
  const activeSess = readSessionFileState(repoRoot).session;
  const resolvedIssueId = issueId || activeSess?.issueId || null;
  const resolvedPrNumber = resolveOpenPRNumber({ prNumber, branch: activeSess?.branch, repoRoot, execFn });
  const targetId = resolvedIssueId || resolvedPrNumber;
  if (!targetId || !comment) {
    throw new Error('Both issueId/prNumber and comment are required to post a review comment.');
  }

  if (pm.provider === 'github') {
    const errors = [];
    const isStrictGitHub = hasGitHubRemote(repoRoot) || execFn !== execFileSync;

    if (resolvedPrNumber) {
      try {
        execFn('gh', ['pr', 'comment', String(resolvedPrNumber), '--body', comment], { cwd: repoRoot, stdio: 'pipe' });
        console.log(`💬 [GITHUB] Review comment posted to PR #${resolvedPrNumber} (ticket #${targetId})`);
        return {
          success: true,
          provider: 'github',
          targetId,
          prNumber: Number(resolvedPrNumber) || resolvedPrNumber,
          comment
        };
      } catch (err) {
        errors.push(`gh pr comment #${resolvedPrNumber}: ${err.message}`);
      }
    } else {
      try {
        execFn('gh', ['issue', 'comment', String(targetId), '--body', comment], { cwd: repoRoot, stdio: 'pipe' });
        console.log(`💬 [GITHUB] Review comment posted to Issue #${targetId}`);
        return {
          success: true,
          provider: 'github',
          targetId,
          prNumber: null,
          comment
        };
      } catch (err) {
        errors.push(`gh issue comment #${targetId}: ${err.message}`);
      }
    }

    if (isStrictGitHub && !allowLocalFallback) {
      const errMsg = errors.join('; ');
      console.error(
        `🛑 GitHub review comment failed (${errMsg}). Re-run outside the sandbox (BypassSandbox: true) or verify 'gh auth status'.`
      );
      return {
        success: false,
        provider: 'github',
        targetId,
        prNumber: resolvedPrNumber ? Number(resolvedPrNumber) || resolvedPrNumber : null,
        error: errMsg,
        comment
      };
    }

    console.warn(`⚠️ GitHub comment failed (${errors.join('; ')}). Falling back to local KANBAN.md.`);
  }

  if (pm.provider === 'jira') {
    try {
      const commentIssueId = resolvedIssueId || targetId;
      const auth = Buffer.from(`${process.env.JIRA_EMAIL || 'bot'}:${process.env.JIRA_API_TOKEN || ''}`).toString('base64');
      const url = `${(process.env.JIRA_BASE_URL || 'https://jira.example.com').replace(/\/$/, '')}/rest/api/3/issue/${encodeURIComponent(String(commentIssueId))}/comment`;
      const bodyPayload = JSON.stringify({
        body: {
          type: 'doc',
          version: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text: comment }] }]
        }
      });
      curlJsonRequest({
        url,
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        body: bodyPayload,
        cwd: repoRoot,
        execFn
      });
      console.log(`💬 [JIRA] Review comment posted to Jira issue ${commentIssueId}`);
      return { success: true, provider: 'jira', targetId: commentIssueId, comment };
    } catch (err) {
      console.warn(`⚠️ Jira comment failed: ${err.message}. Falling back to local KANBAN.md.`);
    }
  }

  if (pm.provider === 'linear') {
    try {
      const commentIssueId = resolvedIssueId || targetId;
      const gql = JSON.stringify({
        query: `mutation CreateComment($issueId: String!, $body: String!) { commentCreate(input: { issueId: $issueId, body: $body }) { success } }`,
        variables: { issueId: String(commentIssueId), body: comment }
      });
      curlJsonRequest({
        url: 'https://api.linear.app/graphql',
        method: 'POST',
        headers: {
          Authorization: process.env.LINEAR_API_KEY || '',
          'Content-Type': 'application/json'
        },
        body: gql,
        cwd: repoRoot,
        execFn
      });
      console.log(`💬 [LINEAR] Review comment posted to Linear issue ${commentIssueId}`);
      return { success: true, provider: 'linear', targetId: commentIssueId, comment };
    } catch (err) {
      console.warn(`⚠️ Linear comment failed: ${err.message}. Falling back to local KANBAN.md.`);
    }
  }

  const kanbanPath = path.resolve(repoRoot, 'docs/KANBAN.md');
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  let content = readFileSafe(kanbanPath);

  if (!content) {
    fs.mkdirSync(path.dirname(kanbanPath), { recursive: true });
    content = `# 📋 Project Kanban Board & Traceability Matrix\n\n> **Living Project State & Audit Trail**\n> **Last Synced**: \`${now}\`\n\n---\n\n## 📊 Board Overview\n\n| 📥 Backlog | 📋 Ready | ⚡ In Progress | 🔍 In Review | ✅ Done |\n| :--- | :--- | :--- | :--- | :--- |\n`;
  }

  const commentSectionHeader = '## 💬 Review Audit Comments & Feedback\n\n';
  const commentBlock = `### [${now}] Audit for #${targetId}\n\n${comment}\n\n---\n\n`;

  if (content.includes(commentSectionHeader)) {
    content = content.replace(commentSectionHeader, commentSectionHeader + commentBlock);
  } else {
    content = content + `\n\n${commentSectionHeader}${commentBlock}`;
  }

  writeFileAtomic(kanbanPath, content);
  console.log(`💬 [LOCAL KANBAN] Review comment recorded in docs/KANBAN.md for #${targetId}`);
  return { success: true, provider: 'local', targetId, comment, file: 'docs/KANBAN.md' };
}

export const createPMIssue = createTicket;

export function syncKanbanBoard(repoRoot = '.') {
  const pm = detectPMProvider(repoRoot);
  const kanbanPath = path.resolve(repoRoot, 'docs/KANBAN.md');
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  if (fileExists(kanbanPath)) {
    try {
      let content = fs.readFileSync(kanbanPath, 'utf8');
      content = content.replace(/> \*\*Last Synced\*\*: `[^`]+`/, `> **Last Synced**: \`${now}\``);
      writeFileAtomic(kanbanPath, content);
    } catch {}
  }
  return { success: true, provider: pm.provider, kanbanPath, syncedAt: now };
}

export function pollCIPRChecks(
  prNumber,
  { timeoutSeconds = 300, pollIntervalSeconds = 15, repoRoot = '.', execFn = execFileSync } = {}
) {
  console.log(`🛰️ Polling remote CI/CD status checks for PR #${prNumber} (timeout: ${timeoutSeconds}s)...`);
  const startTime = Date.now();
  const sleepMs = Math.max(50, Math.min(60000, Math.round((Number(pollIntervalSeconds) || 15) * 1000)));
  const sleepBuf = new Int32Array(new SharedArrayBuffer(4));

  const evaluateChecks = (checks) => {
    if (!Array.isArray(checks)) return null;
    const failed = checks.filter(
      (c) =>
        ['fail', 'cancel'].includes(String(c?.bucket || '').toLowerCase()) ||
        ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(
          String(c?.state || '').toUpperCase()
        )
    );
    if (failed.length > 0) {
      return {
        status: 'failed',
        failedNames: failed.map((c) => c.name || 'unknown'),
        checks
      };
    }
    const pending = checks.filter(
      (c) =>
        String(c?.bucket || '').toLowerCase() === 'pending' ||
        ['PENDING', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED'].includes(String(c?.state || '').toUpperCase())
    );
    if (pending.length > 0) {
      return { status: 'pending', checks };
    }
    return { status: 'passed', checks };
  };

  while (Date.now() - startTime < timeoutSeconds * 1000) {
    try {
      const output = execFn('gh', ['pr', 'checks', String(prNumber), '--json', 'name,state,bucket'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe'
      });
      const checks = JSON.parse(String(output || '[]').trim() || '[]');
      const verdict = evaluateChecks(checks);
      if (verdict?.status === 'failed') {
        return {
          success: false,
          passed: false,
          error: `Remote CI check failure detected: ${verdict.failedNames.join(', ')}`,
          checks: verdict.checks,
          output
        };
      }
      if (verdict?.status === 'pending') {
        Atomics.wait(sleepBuf, 0, 0, sleepMs);
        continue;
      }
      return { success: true, passed: true, checks: verdict?.checks || [], output };
    } catch (err) {
      const rawErrOut = String(err?.stdout || '').trim();
      if (rawErrOut.startsWith('[')) {
        try {
          const checks = JSON.parse(rawErrOut);
          const verdict = evaluateChecks(checks);
          if (verdict?.status === 'failed') {
            return {
              success: false,
              passed: false,
              error: `Remote CI check failure detected: ${verdict.failedNames.join(', ')}`,
              checks: verdict.checks,
              output: rawErrOut
            };
          }
        } catch {}
      }
      Atomics.wait(sleepBuf, 0, 0, sleepMs);
    }
  }

  return { success: false, passed: false, error: `CI check polling timed out after ${timeoutSeconds}s.` };
}

export function parseSemVer(verStr = '1.0.0') {
  const clean = verStr.replace(/^v/, '').trim();
  const parts = clean.split('.').map((n) => parseInt(n, 10));
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
