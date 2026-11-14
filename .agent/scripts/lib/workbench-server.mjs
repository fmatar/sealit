import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileExists, readFileSafe, getModifiedFiles, writeFileAtomic, readSessionStatus } from './core.mjs';
import { buildDecisionGraph } from './decision-graph.mjs';
import { parseProductMarkdown, planProductDAG, controlProductDAG } from './product-dag.mjs';
import { listADRs, decideADR } from './adr-drift.mjs';
import { verifyAuditChain } from './audit-chain.mjs';
import { checkArchDiff } from './arch-trace.mjs';

const ASSETS_DIR = path.resolve(import.meta.dirname, '../workbench-assets');
const assetCache = new Map();

function loadWorkbenchAsset(filename) {
  if (!assetCache.has(filename)) {
    const absPath = path.join(ASSETS_DIR, filename);
    assetCache.set(filename, fs.readFileSync(absPath, 'utf8'));
  }
  return assetCache.get(filename);
}

function applyTemplate(template, replacements) {
  return String(template).replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(replacements, key) ? String(replacements[key]) : match
  );
}

function escapeHtml(value = '') {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJsonScriptPayload(payload) {
  return JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function readJsonBody(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      if (rejected) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      totalBytes += buf.length;
      if (totalBytes > maxBytes) {
        rejected = true;
        chunks.length = 0;
        req.pause();
        const err = new Error(`Request body exceeds ${maxBytes} bytes limit.`);
        err.statusCode = 413;
        reject(err);
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      if (rejected) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', (err) => {
      if (!rejected) reject(err);
    });
  });
}

function stripEmoji(text = '') {
  return String(text)
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMarkdownLink(cell = '') {
  const cleaned = stripEmoji(cell);
  const match = cleaned.match(/\[([^\]]+)\]\(([^)]+)\)/);
  if (match) {
    const label = match[1].trim();
    const rawUrl = match[2].trim();
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : null;
    const idMatch = label.match(/^(#[A-Za-z0-9_-]+)\s*(.*)$/);
    return {
      id: idMatch ? idMatch[1] : label,
      title: idMatch && idMatch[2] ? idMatch[2] : label,
      url,
      raw: cleaned
    };
  }
  return { id: cleaned, title: cleaned, url: null, raw: cleaned };
}

export function parseKanbanMarkdown(raw = '') {
  const columns = [
    { key: 'backlog', label: 'Backlog', items: [] },
    { key: 'ready', label: 'Ready', items: [] },
    { key: 'in_progress', label: 'In Progress', items: [] },
    { key: 'in_review', label: 'In Review', items: [] },
    { key: 'done', label: 'Done', items: [] }
  ];
  const matrix = [];
  let repo = '';
  let lastSynced = '';

  const lines = String(raw || '').split('\n');
  let mode = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const repoMatch = trimmed.match(/\*\*Repository\*\*:\s*`([^`]+)`/);
    if (repoMatch) repo = repoMatch[1];
    const syncMatch = trimmed.match(/\*\*Last Synced\*\*:\s*`([^`]+)`/);
    if (syncMatch) lastSynced = syncMatch[1];

    if (trimmed.includes('Board Overview')) {
      mode = 'board';
      continue;
    }
    if (trimmed.includes('End-to-End Traceability Matrix')) {
      mode = 'matrix';
      continue;
    }
    if (trimmed.startsWith('### ') || trimmed.startsWith('## ')) {
      if (!trimmed.includes('Board Overview') && !trimmed.includes('Traceability Matrix')) {
        mode = null;
      }
    }

    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;
    const cells = trimmed
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;

    if (mode === 'board' && cells.length >= 5) {
      if (cells[0].toLowerCase().includes('backlog')) continue;
      for (let i = 0; i < 5; i++) {
        if (cells[i]) {
          const parsed = parseMarkdownLink(cells[i]);
          if (parsed.raw) columns[i].items.push(parsed);
        }
      }
    } else if (mode === 'matrix' && cells.length >= 5) {
      if (cells[0].toLowerCase().includes('issue')) continue;
      const nonEmpty = cells.filter(Boolean);
      if (nonEmpty.length === 1 && cells[3]) {
        const parsed = parseMarkdownLink(cells[3]);
        matrix.push({
          issue: parsed,
          status: 'status:in-review',
          priority: 'P2 - Medium',
          component: 'General',
          milestone: '—',
          spec: '—'
        });
      } else if (cells[0]) {
        const parsed = parseMarkdownLink(cells[0]);
        matrix.push({
          issue: parsed,
          status: cells[1]?.replace(/`/g, '') || 'status:done',
          priority: cells[2] || '—',
          component: cells[3] || 'General',
          milestone: cells[4] || '—',
          spec: cells[5] || '—'
        });
      }
    }
  }

  return { repo, lastSynced, columns, matrix };
}

export function parseArchTraceMarkdown(raw = '') {
  const entries = [];
  const lines = String(raw || '').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;
    const cells = trimmed
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());
    if (cells.length < 7) continue;
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    if (cells[0].toLowerCase().includes('timestamp')) continue;

    const ticket = parseMarkdownLink(cells[1]);
    const changesList = cells[5]
      .split(/<br\s*\/?>/i)
      .map((s) => stripEmoji(s.replace(/`/g, '')))
      .filter(Boolean);
    const statusText = stripEmoji(cells[6]) || 'PASSED';

    entries.push({
      timestamp: cells[0],
      ticket,
      branch: cells[2].replace(/`/g, ''),
      commit: cells[3].replace(/`/g, ''),
      reason: stripEmoji(cells[4]),
      changes: changesList,
      status: statusText
    });
  }
  return entries.reverse();
}

export function buildArchDiffPayload(repoRoot = '.') {
  const archDiff = checkArchDiff(repoRoot);
  const modifiedFiles = getModifiedFiles(null, repoRoot);

  const rings = {
    'Domain & Core Rules': [],
    'Application & Engine Libs': [],
    'Adapters, CLI & Skills': [],
    'Specs, ADRs & Verification': []
  };

  for (const file of modifiedFiles) {
    const lower = file.toLowerCase();
    if (
      lower.includes('domain') ||
      lower.includes('core.mjs') ||
      lower.includes('audit-chain.mjs') ||
      lower.includes('adr-drift.mjs') ||
      lower.includes('product-dag.mjs') ||
      path.basename(lower) === 'product.md'
    ) {
      rings['Domain & Core Rules'].push(file);
    } else if (lower.includes('.agent/scripts/lib/')) {
      rings['Application & Engine Libs'].push(file);
    } else if (
      lower.includes('.agent/skills/') ||
      lower.includes('.claude/skills/') ||
      lower.includes('.claude/commands/') ||
      lower.includes('.claude/cowork/') ||
      lower.includes('.claude-plugin/') ||
      lower.includes('sdlc-engine.mjs') ||
      lower.includes('workbench') ||
      lower.endsWith('.sh')
    ) {
      rings['Adapters, CLI & Skills'].push(file);
    } else {
      rings['Specs, ADRs & Verification'].push(file);
    }
  }

  const traceJsonlPath = path.resolve(repoRoot, '.agent/arch-trace.jsonl');
  const snapshots = [];
  if (fileExists(traceJsonlPath)) {
    const lines = (readFileSafe(traceJsonlPath) || '').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.reason) parsed.reason = stripEmoji(parsed.reason);
        if (Array.isArray(parsed.diagramChanges)) {
          parsed.diagramChanges = parsed.diagramChanges.map((dc) => ({
            ...dc,
            summary: stripEmoji(dc.summary || ''),
            diff: dc.diff
              ? {
                  ...dc.diff,
                  addedNodes: (dc.diff.addedNodes || []).map((n) => ({ ...n, label: stripEmoji(n.label || '') })),
                  removedNodes: (dc.diff.removedNodes || []).map((n) => ({ ...n, label: stripEmoji(n.label || '') }))
                }
              : undefined
          }));
        }
        snapshots.push(parsed);
      } catch {}
    }
  }

  const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  return {
    archDiff,
    modifiedFiles,
    rings,
    snapshotsCount: snapshots.length,
    latestSnapshot,
    snapshots: snapshots.slice(-15)
  };
}

/** Collects common session, architecture, graph, product, and audit state shared by `/` and `/widget`. */
function collectWorkbenchState(repoRoot = '.', getSessionStatusFn = readSessionStatus) {
  const sessionStatus =
    typeof getSessionStatusFn === 'function' ? getSessionStatusFn(repoRoot) : { active: false, session: null };
  return {
    sessionStatus,
    graph: buildDecisionGraph(repoRoot),
    product: parseProductMarkdown(repoRoot),
    dag: planProductDAG({ repoRoot, autoProvision: false }),
    arch: buildArchDiffPayload(repoRoot),
    audit: verifyAuditChain(repoRoot)
  };
}

function buildStageStepsHtml(activeStage) {
  const stageNames = [
    { num: 1, name: '1. Intake', role: 'Scope & Spec' },
    { num: 2, name: '2. Branch', role: 'Isolation' },
    { num: 3, name: '3. TDD', role: 'Red-Green' },
    { num: 4, name: '4. Dual-Gate', role: 'Cov & Mut' },
    { num: 5, name: '5. Docs', role: 'Sync & ADR' },
    { num: 6, name: '6. PR', role: 'Dossier' },
    { num: 7, name: '7. Review', role: 'Merkle Receipt' },
    { num: 8, name: '8. Done', role: 'Merged' }
  ];
  const curStage = Number(activeStage || 0);
  return stageNames
    .map((s) => {
      const stateClass = curStage > s.num ? 'done' : curStage === s.num ? 'active' : 'pending';
      const stateText = curStage > s.num ? 'Cleared' : curStage === s.num ? 'Active' : 'Queued';
      return `<li class="stage-step ${escapeHtml(stateClass)}">
        <div class="stage-step-top">
          <span class="stage-step-name">${escapeHtml(s.name)}</span>
          <span class="stage-step-state">${escapeHtml(stateText)}</span>
        </div>
        <div class="stage-step-role">${escapeHtml(s.role)}</div>
      </li>`;
    })
    .join('');
}

export function generateArchitectureWidget({
  outputPath = null,
  repoRoot = '.',
  writeDefault = true,
  cspNonce = null
} = {}) {
  const { sessionStatus, graph: rawGraph, product, dag, arch: rawArchPayload, audit } = collectWorkbenchState(repoRoot);
  const compactGraph = {
    nodes: (rawGraph.nodes || []).map((n) => ({
      ...n,
      label: stripEmoji(n.label || ''),
      metadata: n.metadata
        ? {
            ...n.metadata,
            content: typeof n.metadata.content === 'string' ? stripEmoji(n.metadata.content.slice(0, 280)) : undefined
          }
        : {}
    })),
    edges: rawGraph.edges || [],
    driftPivots: rawGraph.driftPivots || [],
    stats: rawGraph.stats || {}
  };
  const compactSnapshot = (s) =>
    s
      ? {
          ...s,
          diagramChanges: (s.diagramChanges || []).map((dc) => ({
            diagram: dc.diagram,
            summary: dc.summary,
            diff: dc.diff
              ? {
                  hasChanges: dc.diff.hasChanges,
                  addedNodes: (dc.diff.addedNodes || []).slice(0, 6),
                  removedNodes: (dc.diff.removedNodes || []).slice(0, 6)
                }
              : undefined
          }))
        }
      : null;
  const archPayload = {
    ...rawArchPayload,
    latestSnapshot: compactSnapshot(rawArchPayload.latestSnapshot),
    snapshots: (rawArchPayload.snapshots || []).map(compactSnapshot)
  };

  const embeddedState = safeJsonScriptPayload({
    session: sessionStatus.session,
    audit: {
      valid: audit.valid,
      recordsCount: audit.recordsCount,
      merkleRoot: audit.merkleRoot,
      message: audit.message
    },
    graph: compactGraph,
    product,
    dag,
    arch: archPayload
  });

  const nonceAttr = cspNonce ? ` nonce="${escapeHtml(cspNonce)}"` : '';
  const html = applyTemplate(loadWorkbenchAsset('widget.html'), {
    CSP_NONCE_ATTR: nonceAttr,
    WORKBENCH_CSS: loadWorkbenchAsset('workbench.css'),
    EMBEDDED_STATE: embeddedState,
    SHARED_CLIENT_JS: loadWorkbenchAsset('shared-client.js'),
    WIDGET_JS: loadWorkbenchAsset('widget.js')
  });

  const defaultWidgetPath = path.resolve(repoRoot, '.agent/workbench/index.html');
  let writtenPath = defaultWidgetPath;
  if (writeDefault) {
    fs.mkdirSync(path.dirname(defaultWidgetPath), { recursive: true });
    writeFileAtomic(defaultWidgetPath, html);
  }

  if (outputPath) {
    const absOut = path.resolve(repoRoot, outputPath);
    fs.mkdirSync(path.dirname(absOut), { recursive: true });
    writeFileAtomic(absOut, html);
    writtenPath = absOut;
  }

  return {
    success: true,
    html,
    widgetPath: writeDefault || outputPath ? writtenPath : null,
    defaultWidgetPath,
    nodesCount: compactGraph.nodes?.length || 0,
    modifiedFilesCount: archPayload.modifiedFiles.length,
    ringViolationsCount: archPayload.archDiff.violationsCount
  };
}

export function renderWorkbenchHTML(
  repoRoot = '.',
  getSessionStatusFn = readSessionStatus,
  { cspNonce = null } = {}
) {
  const { sessionStatus, graph: initialGraph, product: initialProduct, dag: initialDag, arch: initialArch, audit: initialAudit } =
    collectWorkbenchState(repoRoot, getSessionStatusFn);
  const activeSess = sessionStatus.session;
  const kanbanPath = path.resolve(repoRoot, 'docs/KANBAN.md');
  const kanbanRaw = fileExists(kanbanPath) ? readFileSafe(kanbanPath) : 'No KANBAN.md file found.';
  const archTracePath = path.resolve(repoRoot, 'docs/ARCH_TRACE.md');
  const archTraceRaw = fileExists(archTracePath) ? readFileSafe(archTracePath) : 'No ARCH_TRACE.md recorded yet.';

  const parsedKanban = parseKanbanMarkdown(kanbanRaw);
  const parsedTrace = parseArchTraceMarkdown(archTraceRaw);
  const initialAdrs = listADRs(repoRoot);

  const initialBootstrap = safeJsonScriptPayload({
    session: activeSess,
    audit: initialAudit,
    arch: initialArch,
    graph: initialGraph,
    product: initialProduct,
    dag: initialDag,
    adrs: initialAdrs,
    kanban: parsedKanban,
    trace: parsedTrace
  });

  const archPassed = initialArch.archDiff?.passed !== false;
  const nonceAttr = cspNonce ? ` nonce="${escapeHtml(cspNonce)}"` : '';

  return applyTemplate(loadWorkbenchAsset('mission-control.html'), {
    CSP_NONCE_ATTR: nonceAttr,
    WORKBENCH_CSS: loadWorkbenchAsset('workbench.css'),
    SESSION_SEAL_TEXT: activeSess ? `Active Session #${escapeHtml(activeSess.issueId)}` : 'Mainline Standing By',
    RING_SEAL_CLASS: archPassed ? 'pass' : 'fail',
    RING_SEAL_TEXT: archPassed ? 'Rings Balanced: 0 Violations' : `Ring Violations: ${escapeHtml(initialArch.archDiff.violationsCount)}`,
    MERKLE_SEAL_CLASS: initialAudit.valid ? 'pass' : 'fail',
    MERKLE_SEAL_TEXT: initialAudit.valid
      ? `Merkle Chain Verified (${escapeHtml(initialAudit.recordsCount || 0)})`
      : 'Merkle Verification Failed',
    LIFECYCLE_BRANCH_SUFFIX: activeSess ? `(${escapeHtml(activeSess.branch)})` : '',
    LIFECYCLE_META_HTML: activeSess
      ? `Active Ticket #${escapeHtml(activeSess.issueId)} &middot; Stage ${escapeHtml(activeSess.stage)} of 8 &middot; Branch: <span class="mono">${escapeHtml(activeSess.branch)}</span>`
      : 'Zero active feature branches locked &middot; Ready for <span class="mono">/sdlc begin &lt;issue&gt;</span>',
    STAGE_STEPS_HTML: buildStageStepsHtml(activeSess?.stage),
    MODIFIED_COUNT: String(initialArch.modifiedFiles.length),
    NODES_COUNT: String((initialGraph.nodes || []).length),
    WAVES_COUNT: String((initialDag.waves || []).length),
    KANBAN_COUNT: String(parsedKanban.matrix.length),
    TRACE_COUNT: String(parsedTrace.length),
    RING_FOLIO_STATUS: archPassed ? 'Inward Dependency Law: Verified' : 'Boundary Violation Detected',
    MERKLE_FOLIO_STATUS: initialAudit.valid ? 'SHA-256 Chain Intact' : 'Chain Integrity Alert',
    MERKLE_ROOT_SHORT: escapeHtml((initialAudit.merkleRoot || 'GENESIS').slice(0, 16)),
    INITIAL_BOOTSTRAP: initialBootstrap,
    SHARED_CLIENT_JS: loadWorkbenchAsset('shared-client.js'),
    MISSION_CONTROL_JS: loadWorkbenchAsset('mission-control.js')
  });
}

/**
 * Returns the command to start the workbench manually (detached background auto-spawn
 * would hide its ephemeral access token and outlive the CLI session).
 */
export function ensureWorkbenchRunning({ port = 4120, repoRoot = '.', spawn: shouldSpawn = false, spawnFn = spawn } = {}) {
  const base = { port, url: `http://127.0.0.1:${port}`, command: `node .agent/scripts/sdlc-engine.mjs serve --port ${port}`, stdio: 'ignore', unrefed: true };
  const scriptPath = path.resolve(repoRoot, '.agent/scripts/sdlc-engine.mjs');
  if (shouldSpawn && fileExists(scriptPath)) {
    try {
      const child = spawnFn(process.execPath, [scriptPath, 'serve', '--port', String(port)], { cwd: repoRoot, detached: true, stdio: 'ignore' });
      if (child && typeof child.unref === 'function') child.unref();
      return { started: true, ...base };
    } catch (err) {
      return { started: false, ...base, reason: err?.message || 'spawn-failed' };
    }
  }
  return { started: false, ...base, reason: 'auto-spawn-disabled' };
}

export function createWorkbenchServer({ port = 4120, host = '127.0.0.1', token = null, repoRoot = '.', getSessionStatusFn = readSessionStatus } = {}) {
  const sseClients = new Set();
  const accessToken = token || crypto.randomBytes(24).toString('hex');
  const tokenBuf = Buffer.from(accessToken, 'utf8');

  const broadcast = (eventType, payload) => {
    const msg = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of sseClients) {
      try { res.write(msg); } catch { sseClients.delete(res); }
    }
  };

  const tokenMatches = (candidate) => {
    if (typeof candidate !== 'string' || candidate.length === 0) return false;
    const buf = Buffer.from(candidate, 'utf8');
    return buf.length === tokenBuf.length && crypto.timingSafeEqual(buf, tokenBuf);
  };

  const send = (res, status, contentType, body, extraHeaders = {}) => {
    res.writeHead(status, { 'Content-Type': contentType, ...extraHeaders });
    res.end(body);
  };
  const sendJson = (res, status, data, extraHeaders = {}) => send(res, status, 'application/json', JSON.stringify(data), extraHeaders);

  const jsonRoutes = {
    '/api/status': () => ({ ...(typeof getSessionStatusFn === 'function' ? getSessionStatusFn(repoRoot) : { active: false }), audit: verifyAuditChain(repoRoot) }),
    '/api/arch-diff': () => buildArchDiffPayload(repoRoot),
    '/api/decision-graph': () => buildDecisionGraph(repoRoot),
    '/api/product': () => ({ product: parseProductMarkdown(repoRoot), dag: planProductDAG({ repoRoot, autoProvision: false }) })
  };

  const server = http.createServer(async (req, res) => {
    try {
      const actualPort = server.address()?.port || port;
      const allowedOrigins = new Set([`http://127.0.0.1:${actualPort}`, `http://localhost:${actualPort}`]);
      const allowedHosts = new Set([`127.0.0.1:${actualPort}`, `localhost:${actualPort}`]);
      const cspNonce = crypto.randomBytes(16).toString('base64url');

      res.setHeader('Vary', 'Origin');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader(
        'Content-Security-Policy',
        `default-src 'self'; script-src 'nonce-${cspNonce}'; style-src 'nonce-${cspNonce}'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`
      );

      const origin = req.headers.origin;
      if (!allowedHosts.has(String(req.headers.host || '')) || (origin && !allowedOrigins.has(origin))) {
        return send(res, 403, 'text/plain', 'Forbidden: workbench only accepts same-origin requests on loopback.');
      }
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-SDLC-Token');
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

      const urlObj = new URL(req.url || '/', 'http://127.0.0.1');
      if (!tokenMatches(req.headers['x-sdlc-token']) && !tokenMatches(urlObj.searchParams.get('token'))) {
        return send(res, 401, 'text/plain', 'Unauthorized: open the URL printed by `sdlc-engine serve` (it carries ?token=...).');
      }

      const { pathname } = urlObj;
      if (pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
        sseClients.add(res);
        return req.on('close', () => sseClients.delete(res));
      }
      if (jsonRoutes[pathname]) return sendJson(res, 200, jsonRoutes[pathname]());
      if (pathname === '/api/adr' && req.method === 'GET') return sendJson(res, 200, { adrs: listADRs(repoRoot) });

      const postJson = async (eventName, fn) => {
        try {
          const out = fn(await readJsonBody(req));
          broadcast(eventName, out);
          return sendJson(res, 200, out);
        } catch (err) {
          if (!err.statusCode) err.statusCode = 400;
          throw err;
        }
      };
      if (pathname === '/api/adr/decide' && req.method === 'POST') {
        return await postJson('adr-updated', (body) =>
          decideADR({
            adrId: body.adrId,
            action: body.action || 'approve',
            reviewer: body.reviewer || '@workbench-operator',
            reason: body.reason || 'Decided in SDLC Workbench',
            repoRoot
          })
        );
      }
      if (pathname === '/api/dag/control' && req.method === 'POST') {
        return await postJson('dag-updated', (body) =>
          controlProductDAG({ action: body.action || 'status', reason: body.reason || '', wave: body.wave || null, repoRoot })
        );
      }

      if (pathname === '/widget') return send(res, 200, 'text/html; charset=utf-8', generateArchitectureWidget({ repoRoot, writeDefault: false, cspNonce }).html || '');
      if (pathname === '/' || pathname === '/index.html') return send(res, 200, 'text/html; charset=utf-8', renderWorkbenchHTML(repoRoot, getSessionStatusFn, { cspNonce }));
      return send(res, 404, 'text/plain', 'Not Found');
    } catch (err) {
      const code = Number(err?.statusCode) || 500;
      if (!res.headersSent) return sendJson(res, code, { success: false, error: err?.message || 'Internal Server Error' }, code === 413 ? { Connection: 'close' } : {});
      try { res.end(); } catch {}
    }
  });

  const listen = () => new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      console.log(`Agentic SDLC Workbench (loopback only) live at: http://127.0.0.1:${server.address()?.port || port}/?token=${accessToken}`);
      resolve(server);
    });
    server.on('error', reject);
  });
  const close = () => {
    for (const c of sseClients) { try { c.end(); } catch {} }
    sseClients.clear();
    return new Promise((resolve) => server.close(resolve));
  };
  return { server, port, host, token: accessToken, broadcast, url: () => `http://127.0.0.1:${server.address()?.port || port}/?token=${accessToken}`, listen, close };
}
