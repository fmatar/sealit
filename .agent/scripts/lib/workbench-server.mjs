import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileExists, readFileSafe, getModifiedFiles } from './core.mjs';
import { getSessionStatus } from './session.mjs';
import { buildDecisionGraph } from './decision-graph.mjs';
import { parseProductMarkdown, planProductDAG, controlProductDAG } from './product-dag.mjs';
import { listADRs, decideADR } from './adr-drift.mjs';
import { verifyAuditChain } from './audit-chain.mjs';
import { checkArchDiff } from './arch-trace.mjs';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

export function buildArchDiffPayload(repoRoot = '.') {
  const archDiff = checkArchDiff(repoRoot);
  const modifiedFiles = getModifiedFiles('main', repoRoot);

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
      lower.includes('PRODUCT.md'.toLowerCase())
    ) {
      rings['Domain & Core Rules'].push(file);
    } else if (lower.includes('.agent/scripts/lib/')) {
      rings['Application & Engine Libs'].push(file);
    } else if (
      lower.includes('.agent/skills/') ||
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
        snapshots.push(JSON.parse(line));
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

export function generateArchitectureWidget({ outputPath = null, repoRoot = '.' } = {}) {
  const sessionStatus = getSessionStatus(repoRoot);
  const rawGraph = buildDecisionGraph(repoRoot);
  const compactGraph = {
    nodes: (rawGraph.nodes || []).map((n) => ({
      ...n,
      metadata: n.metadata
        ? {
            ...n.metadata,
            content: typeof n.metadata.content === 'string' ? n.metadata.content.slice(0, 280) : undefined
          }
        : {}
    })),
    edges: rawGraph.edges || [],
    driftPivots: rawGraph.driftPivots || [],
    stats: rawGraph.stats || {}
  };
  const product = parseProductMarkdown(repoRoot);
  const dag = planProductDAG({ repoRoot, autoProvision: false });
  const rawArchPayload = buildArchDiffPayload(repoRoot);
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
  const audit = verifyAuditChain(repoRoot);

  const embeddedState = JSON.stringify({
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
  }).replace(/</g, '\\u003c');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agentic SDLC Architecture Diff & Decision Lineage</title>
  <script src="https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js"></script>
</head>
<body class="bg-transparent text-[var(--foreground)] antialiased p-3">
  <div class="bg-[var(--card)] text-[var(--foreground)] border border-[var(--border)] rounded-xl p-4 shadow-sm">
    <!-- Header -->
    <div class="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--border)]">
      <div>
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold text-[var(--foreground)]">⚡ SDLC Architecture Diff & Decision Workbench</span>
          <span id="session-pill" class="text-xs px-2 py-0.5 rounded-full bg-[var(--secondary)] text-[var(--secondary-foreground)] font-medium"></span>
        </div>
        <p class="text-xs text-[var(--muted-foreground)] mt-0.5">
          Concentric Ring Boundaries • Mermaid AST Diffs • Causal Decision Lineage • Live Server: <code>http://localhost:4120</code>
        </p>
      </div>
      <div class="flex items-center gap-1.5">
        <span id="ring-badge" class="text-xs px-2.5 py-1 rounded-md font-medium border border-[var(--border)]"></span>
        <span id="merkle-badge" class="text-xs px-2.5 py-1 rounded-md font-medium border border-[var(--border)]"></span>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div class="flex flex-wrap gap-1.5 my-3">
      <button onclick="switchTab('rings')" id="tab-rings" class="text-xs px-3 py-1.5 rounded-lg font-medium border border-[var(--border)] transition">
        🏛️ Ring & AST Diff
      </button>
      <button onclick="switchTab('lineage')" id="tab-lineage" class="text-xs px-3 py-1.5 rounded-lg font-medium border border-[var(--border)] transition">
        🧬 Decision Lineage (CAP → ADR)
      </button>
      <button onclick="switchTab('timemachine')" id="tab-timemachine" class="text-xs px-3 py-1.5 rounded-lg font-medium border border-[var(--border)] transition">
        ⏱️ Time-Machine Slider
      </button>
      <button onclick="switchTab('waves')" id="tab-waves" class="text-xs px-3 py-1.5 rounded-lg font-medium border border-[var(--border)] transition">
        🌊 DAG Waves & Specs
      </button>
    </div>

    <!-- Tab 1: Ring & AST Diff -->
    <div id="view-rings" class="space-y-3">
      <div id="rings-grid" class="grid grid-cols-1 sm:grid-cols-2 gap-2.5"></div>
      <div id="mermaid-diff-box" class="bg-[var(--background)] border border-[var(--border)] rounded-lg p-2.5 text-xs"></div>
    </div>

    <!-- Tab 2: Causal Decision Lineage -->
    <div id="view-lineage" class="hidden space-y-2.5">
      <div id="nodes-grid" class="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-1"></div>
      <div id="node-inspector" class="bg-[var(--background)] border border-[var(--border)] rounded-lg p-2.5 text-xs text-[var(--muted-foreground)]">
        Click any capability, spec, ticket, or ADR node above to inspect its lineage and governance status.
      </div>
    </div>

    <!-- Tab 3: Time-Machine Slider -->
    <div id="view-timemachine" class="hidden space-y-2.5">
      <div class="flex items-center justify-between text-xs">
        <span class="font-medium">Scrub Architectural Evolution Snapshots:</span>
        <span id="slider-label" class="text-[var(--muted-foreground)]"></span>
      </div>
      <input id="time-slider" type="range" min="0" max="0" value="0" oninput="renderSnapshot(this.value)" class="w-full accent-sky-500 cursor-pointer" />
      <div id="snapshot-detail" class="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3 text-xs space-y-1.5"></div>
    </div>

    <!-- Tab 4: DAG Waves -->
    <div id="view-waves" class="hidden space-y-2 max-h-64 overflow-y-auto pr-1" id="waves-list"></div>
  </div>

  <script>
    const STATE = ${embeddedState};

    function switchTab(tab) {
      for (const t of ['rings', 'lineage', 'timemachine', 'waves']) {
        const view = document.getElementById('view-' + t);
        const btn = document.getElementById('tab-' + t);
        if (t === tab) {
          view.classList.remove('hidden');
          btn.className = 'text-xs px-3 py-1.5 rounded-lg font-semibold bg-[var(--primary)] text-[var(--primary-foreground)] border border-[var(--primary)] transition';
        } else {
          view.classList.add('hidden');
          btn.className = 'text-xs px-3 py-1.5 rounded-lg font-medium bg-[var(--background)] text-[var(--muted-foreground)] border border-[var(--border)] transition';
        }
      }
    }

    function renderSnapshot(idxStr) {
      const snaps = STATE.arch.snapshots || [];
      const idx = Math.max(0, Math.min(snaps.length - 1, Number(idxStr) || 0));
      const snap = snaps[idx];
      const label = document.getElementById('slider-label');
      const box = document.getElementById('snapshot-detail');
      if (!snap) {
        label.textContent = '0 / 0';
        box.innerHTML = '<p class="text-[var(--muted-foreground)]">No snapshots recorded yet.</p>';
        return;
      }
      label.textContent = 'Snapshot ' + (idx + 1) + ' of ' + snaps.length + ' (' + (snap.timestamp || '').slice(0, 16).replace('T', ' ') + ')';
      const diagList = (snap.diagramChanges || []).map(d => '<li class="font-mono">' + d.diagram + ' — ' + d.summary + '</li>').join('');
      box.innerHTML =
        '<div class="flex flex-wrap justify-between gap-2 font-medium">' +
          '<span>Ticket: <code>' + (snap.ticket || 'N/A') + '</code> • Branch: <code>' + (snap.branch || 'main') + '</code></span>' +
          '<span>Commit: <code>' + (snap.commitSha || 'HEAD') + '</code> • Status: <strong>' + (snap.status || 'PASSED') + '</strong></span>' +
        '</div>' +
        '<p class="text-[var(--muted-foreground)]"><strong>Reason:</strong> ' + (snap.reason || 'Architectural checkpoint') + '</p>' +
        (diagList ? '<ul class="list-disc pl-4 space-y-0.5">' + diagList + '</ul>' : '<p class="text-[var(--muted-foreground)]">Modified Files: ' + ((snap.modifiedFiles || []).length) + '</p>');
    }

    function inspectNode(nodeId) {
      const node = (STATE.graph.nodes || []).find(n => n.id === nodeId);
      const el = document.getElementById('node-inspector');
      if (!node || !el) return;
      const connected = (STATE.graph.edges || [])
        .filter(e => e.from === node.id || e.to === node.id)
        .map(e => e.from + ' —[' + e.relation + ']→ ' + e.to);
      el.innerHTML =
        '<div class="font-semibold text-[var(--foreground)]">' + node.id + ': ' + node.label + '</div>' +
        '<div class="mt-1">Category: <code>' + node.category + '</code> • Status: <code>' + (node.status || 'ACTIVE') + '</code></div>' +
        (connected.length ? '<div class="mt-1 font-mono">' + connected.join(' | ') + '</div>' : '');
    }

    function init() {
      const sess = STATE.session;
      document.getElementById('session-pill').textContent = sess
        ? '#' + sess.issueId + ' • Stage ' + sess.stage + '/8 (' + sess.branch + ')'
        : 'Idle / Ready';

      const archPass = STATE.arch.archDiff?.passed !== false;
      const ringBadge = document.getElementById('ring-badge');
      ringBadge.textContent = archPass
        ? '✅ Rings: 0 Violations (' + (STATE.arch.modifiedFiles?.length || 0) + ' files)'
        : '⚠️ Rings: ' + STATE.arch.archDiff.violationsCount + ' Violation(s)';

      const merkleBadge = document.getElementById('merkle-badge');
      merkleBadge.textContent = STATE.audit?.valid
        ? '⛓️ Merkle: Verified (' + (STATE.audit.recordsCount || 0) + ')'
        : '⚠️ Merkle: Check Failed';

      // Render Rings
      const ringsGrid = document.getElementById('rings-grid');
      const ringEntries = Object.entries(STATE.arch.rings || {});
      ringsGrid.innerHTML = ringEntries.map(([ringName, files]) => {
        const preview = files.slice(0, 4).map(f => '<div class="font-mono truncate">• ' + f + '</div>').join('');
        const more = files.length > 4 ? '<div class="text-[var(--muted-foreground)]">+' + (files.length - 4) + ' more…</div>' : '';
        return '<div class="bg-[var(--background)] border border-[var(--border)] rounded-lg p-2.5 text-xs">' +
          '<div class="flex justify-between font-semibold mb-1"><span>' + ringName + '</span><span>' + files.length + ' file(s)</span></div>' +
          (files.length > 0 ? preview + more : '<div class="text-[var(--muted-foreground)]">Unchanged</div>') +
        '</div>';
      }).join('');

      const latest = STATE.arch.latestSnapshot;
      const diffBox = document.getElementById('mermaid-diff-box');
      if (latest && (latest.diagramChanges || []).length > 0) {
        diffBox.innerHTML = '<div class="font-semibold mb-1">📐 Latest Mermaid AST Graph Diff (' + latest.ticket + '):</div>' +
          latest.diagramChanges.map(d => '<div class="font-mono">• ' + d.diagram + ': ' + d.summary + '</div>').join('');
      } else {
        diffBox.innerHTML = '<div class="font-semibold">📐 Latest Architectural Trace:</div>' +
          '<div class="text-[var(--muted-foreground)] mt-0.5">' + (latest ? (latest.reason + ' (' + latest.ticket + ' on ' + latest.branch + ')') : 'Zero breaking diagram mutations.') + '</div>';
      }

      // Render Lineage Nodes
      const nodesGrid = document.getElementById('nodes-grid');
      nodesGrid.innerHTML = (STATE.graph.nodes || []).map(n =>
        '<button onclick="inspectNode(\\'' + n.id.replace(/'/g, '') + '\\')" class="text-left bg-[var(--background)] hover:opacity-90 border border-[var(--border)] rounded-lg p-2 text-xs transition">' +
          '<div class="flex justify-between text-[var(--muted-foreground)]"><span>' + n.category + '</span><span>' + (n.status || '') + '</span></div>' +
          '<div class="font-semibold truncate mt-0.5">' + n.id + '</div>' +
          '<div class="text-[var(--muted-foreground)] truncate">' + n.label + '</div>' +
        '</button>'
      ).join('');

      // Render Slider
      const snaps = STATE.arch.snapshots || [];
      const slider = document.getElementById('time-slider');
      slider.max = String(Math.max(0, snaps.length - 1));
      slider.value = String(Math.max(0, snaps.length - 1));
      renderSnapshot(slider.value);

      // Render DAG Waves
      const wavesEl = document.getElementById('view-waves');
      wavesEl.innerHTML = (STATE.dag?.waves || []).map(w =>
        '<div class="bg-[var(--background)] border border-[var(--border)] rounded-lg p-2.5 text-xs">' +
          '<div class="font-semibold mb-1">Wave ' + w.wave + ' ' + (w.parallelizable ? '⚡ (Parallelizable)' : '(Sequential)') + '</div>' +
          (w.items || []).map(it => '<div class="font-mono">• <strong>' + it.id + '</strong>: ' + it.title + ' (' + it.status + ')</div>').join('') +
        '</div>'
      ).join('');

      switchTab('rings');
    }

    init();
  </script>
</body>
</html>`;

  const defaultWidgetPath = path.resolve(repoRoot, '.agent/workbench/index.html');
  fs.mkdirSync(path.dirname(defaultWidgetPath), { recursive: true });
  fs.writeFileSync(defaultWidgetPath, html, 'utf8');

  let writtenPath = defaultWidgetPath;
  if (outputPath) {
    const absOut = path.resolve(repoRoot, outputPath);
    fs.mkdirSync(path.dirname(absOut), { recursive: true });
    fs.writeFileSync(absOut, html, 'utf8');
    writtenPath = absOut;
  }

  return {
    success: true,
    widgetPath: writtenPath,
    defaultWidgetPath,
    nodesCount: compactGraph.nodes?.length || 0,
    modifiedFilesCount: archPayload.modifiedFiles.length,
    ringViolationsCount: archPayload.archDiff.violationsCount
  };
}

export function renderWorkbenchHTML(repoRoot = '.', getSessionStatusFn = getSessionStatus) {
  const sessionStatus = typeof getSessionStatusFn === 'function' ? getSessionStatusFn(repoRoot) : { active: false, session: null };
  const activeSess = sessionStatus.session;
  const kanbanPath = path.resolve(repoRoot, 'docs/KANBAN.md');
  const kanbanRaw = fileExists(kanbanPath) ? readFileSafe(kanbanPath) : 'No KANBAN.md file found.';
  const archTracePath = path.resolve(repoRoot, 'docs/ARCH_TRACE.md');
  const archTraceRaw = fileExists(archTracePath) ? readFileSafe(archTracePath) : 'No ARCH_TRACE.md recorded yet.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Agentic SDLC Framework: Workbench & Live Mission Control</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      --bg: #0f172a; --panel: #1e293b; --border: #334155; --text: #f8fafc;
      --accent: #38bdf8; --success: #22c55e; --warning: #f59e0b; --danger: #ef4444;
    }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; background: var(--bg); color: var(--text); padding: 20px; }
    header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 20px; }
    h1 { margin: 0; font-size: 20px; color: var(--accent); }
    .status-badge { background: #0284c7; color: white; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: bold; }
    .tabs { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
    .tabs button { background: var(--panel); color: var(--text); border: 1px solid var(--border); padding: 8px 14px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px; }
    .tabs button.active { background: #0284c7; border-color: var(--accent); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 20px; }
    .card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
    .card h2 { margin-top: 0; font-size: 16px; border-bottom: 1px solid var(--border); padding-bottom: 8px; display: flex; justify-content: space-between; }
    pre { background: #090d16; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 12px; border: 1px solid var(--border); }
    .stage-bar { display: flex; gap: 4px; margin: 15px 0; }
    .stage-step { flex: 1; padding: 8px 4px; text-align: center; font-size: 11px; background: #334155; border-radius: 4px; }
    .stage-step.active { background: #0284c7; font-weight: bold; }
    .stage-step.done { background: #15803d; }
    .node-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
    .node-chip { background: #090d16; border: 1px solid var(--border); border-left: 3px solid var(--accent); padding: 10px; border-radius: 6px; font-size: 12px; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>⚡ Agentic SDLC Framework: Mission Control</h1>
      <small>Clean Architecture Ring Diff • Causal Decision Lineage • Time-Machine Slider</small>
    </div>
    <div>
      <span class="status-badge">${activeSess ? 'Active Session #' + activeSess.issueId : 'No Active Session'}</span>
    </div>
  </header>

  <div class="card" style="margin-bottom: 20px;">
    <h2>📊 8-Stage Lifecycle Progress ${activeSess ? '(' + activeSess.branch + ')' : ''}</h2>
    <div class="stage-bar">
      <div class="stage-step ${activeSess?.stage >= 1 ? (activeSess?.stage === 1 ? 'active' : 'done') : ''}">1. Intake</div>
      <div class="stage-step ${activeSess?.stage >= 2 ? (activeSess?.stage === 2 ? 'active' : 'done') : ''}">2. Branch</div>
      <div class="stage-step ${activeSess?.stage >= 3 ? (activeSess?.stage === 3 ? 'active' : 'done') : ''}">3. TDD</div>
      <div class="stage-step ${activeSess?.stage >= 4 ? (activeSess?.stage === 4 ? 'active' : 'done') : ''}">4. Dual-Gate</div>
      <div class="stage-step ${activeSess?.stage >= 5 ? (activeSess?.stage === 5 ? 'active' : 'done') : ''}">5. Docs</div>
      <div class="stage-step ${activeSess?.stage >= 6 ? (activeSess?.stage === 6 ? 'active' : 'done') : ''}">6. PR</div>
      <div class="stage-step ${activeSess?.stage >= 7 ? (activeSess?.stage === 7 ? 'active' : 'done') : ''}">7. Review</div>
      <div class="stage-step ${activeSess?.stage >= 8 ? (activeSess?.stage === 8 ? 'active' : 'done') : ''}">8. Done</div>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h2>🏛️ Clean Architecture Ring Diff & AST Inspector</h2>
      <div id="arch-diff-mount">Loading ring boundaries & Mermaid AST diffs from <code>/api/arch-diff</code>...</div>
    </div>
    <div class="card">
      <h2>🧬 Causal Decision Lineage & ADR Governance</h2>
      <div id="decision-graph-mount">Loading causal decision graph from <code>/api/decision-graph</code>...</div>
    </div>
    <div class="card">
      <h2>⏱️ Architecture Time-Machine & PRODUCT.md DAG</h2>
      <input id="tm-slider" type="range" min="0" max="0" value="0" style="width:100%;margin-bottom:10px;" />
      <div id="product-dag-mount">Loading PRODUCT.md & DAG state from <code>/api/product</code>...</div>
    </div>
    <div class="card">
      <h2>📋 Living Kanban Dashboard</h2>
      <pre>${kanbanRaw.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
    </div>
    <div class="card">
      <h2>🏛️ Architectural Trace Ledger</h2>
      <pre>${archTraceRaw.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
    </div>
  </div>
  <script>
    let cachedSnapshots = [];
    async function bootWorkbench() {
      try {
        const [arch, graph, prod] = await Promise.all([
          fetch('/api/arch-diff').then(r => r.json()),
          fetch('/api/decision-graph').then(r => r.json()),
          fetch('/api/product').then(r => r.json())
        ]);
        const adEl = document.getElementById('arch-diff-mount');
        if (adEl) {
          adEl.innerHTML = '<pre>' + JSON.stringify({
            archDiffPassed: arch.archDiff?.passed,
            violations: arch.archDiff?.violations,
            rings: arch.rings,
            latestSnapshot: arch.latestSnapshot
          }, null, 2) + '</pre>';
        }
        const dgEl = document.getElementById('decision-graph-mount');
        if (dgEl) {
          dgEl.innerHTML = '<div class="node-grid">' + (graph.nodes || []).map(n =>
            '<div class="node-chip"><strong>' + n.id + '</strong> (' + n.category + ')<br/>' + n.label + '</div>'
          ).join('') + '</div>';
        }
        cachedSnapshots = arch.snapshots || graph.archSnapshots || [];
        const slider = document.getElementById('tm-slider');
        const pdEl = document.getElementById('product-dag-mount');
        if (slider && cachedSnapshots.length > 0) {
          slider.max = String(cachedSnapshots.length - 1);
          slider.value = String(cachedSnapshots.length - 1);
          slider.oninput = () => {
            const s = cachedSnapshots[Number(slider.value)];
            if (pdEl) pdEl.innerHTML = '<pre>' + JSON.stringify({ selectedSnapshot: s, dagWaves: prod.dag?.waves }, null, 2) + '</pre>';
          };
        }
        if (pdEl) {
          const latest = cachedSnapshots[cachedSnapshots.length - 1] || null;
          pdEl.innerHTML = '<pre>' + JSON.stringify({ selectedSnapshot: latest, product: prod.product, dag: prod.dag }, null, 2) + '</pre>';
        }
      } catch (e) {}
    }
    bootWorkbench();
    const es = new EventSource('/api/events');
    es.addEventListener('adr-updated', bootWorkbench);
    es.addEventListener('dag-updated', bootWorkbench);
    es.addEventListener('arch-updated', bootWorkbench);
  </script>
</body>
</html>`;
}

export function ensureWorkbenchRunning({ port = 4120, repoRoot = '.' } = {}) {
  // Never spawn background daemons inside automated unit tests
  if (process.env.NODE_TEST_CONTEXT || repoRoot !== '.') {
    return { started: false, port, url: `http://localhost:${port}`, reason: 'test-or-isolated-repo' };
  }
  try {
    const engineScript = path.resolve(repoRoot, '.agent/scripts/sdlc-engine.mjs');
    if (fileExists(engineScript)) {
      const child = spawn(process.execPath, [engineScript, 'serve', '--port', String(port)], {
        cwd: path.resolve(repoRoot),
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      return { started: true, port, url: `http://localhost:${port}` };
    }
  } catch {}
  return { started: false, port, url: `http://localhost:${port}` };
}

export function createWorkbenchServer({ port = 4120, repoRoot = '.', getSessionStatusFn = getSessionStatus } = {}) {
  const sseClients = new Set();

  const broadcast = (eventType, payload) => {
    const msg = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of sseClients) {
      try {
        res.write(msg);
      } catch {
        sseClients.delete(res);
      }
    }
  };

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const urlObj = new URL(req.url || '/', 'http://localhost');
    const pathname = urlObj.pathname;

    // 1. Live Server-Sent Events (SSE) Stream
    if (pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });
      res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // 2. Session & Audit Status API
    if (pathname === '/api/status') {
      const status = typeof getSessionStatusFn === 'function' ? getSessionStatusFn(repoRoot) : { active: false };
      const audit = verifyAuditChain(repoRoot);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...status, audit }));
      return;
    }

    // 3. Architecture Ring Diff & Mermaid AST Snapshot API
    if (pathname === '/api/arch-diff') {
      const archPayload = buildArchDiffPayload(repoRoot);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(archPayload));
      return;
    }

    // 4. Causal Decision Graph & Architecture Time-Slider API
    if (pathname === '/api/decision-graph') {
      const graph = buildDecisionGraph(repoRoot);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(graph));
      return;
    }

    // 5. PRODUCT.md & Topological DAG API
    if (pathname === '/api/product') {
      const product = parseProductMarkdown(repoRoot);
      const dag = planProductDAG({ repoRoot, autoProvision: false });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ product, dag }));
      return;
    }

    // 6. ADR List API
    if (pathname === '/api/adr' && req.method === 'GET') {
      const adrs = listADRs(repoRoot);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ adrs }));
      return;
    }

    // 7. Bidirectional Action: Approve / Reject Pending Product ADR
    if (pathname === '/api/adr/decide' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const decided = decideADR({
          adrId: body.adrId,
          action: body.action || 'approve',
          reviewer: body.reviewer || '@workbench-operator',
          reason: body.reason || 'Decided in SvelteKit Workbench',
          repoRoot
        });
        broadcast('adr-updated', decided);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(decided));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }

    // 8. Bidirectional Action: Pause / Resume / Advance Product DAG
    if (pathname === '/api/dag/control' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const ctl = controlProductDAG({
        action: body.action || 'status',
        reason: body.reason || '',
        wave: body.wave || null,
        repoRoot
      });
      broadcast('dag-updated', ctl);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ctl));
      return;
    }

    // 9. Interactive Generative UI Widget Endpoint (/widget)
    if (pathname === '/widget') {
      const generated = generateArchitectureWidget({ repoRoot });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(readFileSafe(generated.defaultWidgetPath) || '');
      return;
    }

    // 10. Root HTML (Mission Control Workbench)
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderWorkbenchHTML(repoRoot, getSessionStatusFn));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  return {
    server,
    port,
    broadcast,
    listen: () => {
      return new Promise((resolve, reject) => {
        server.listen(port, () => {
          const actualPort = server.address()?.port || port;
          console.log(`🌐 Agentic SDLC SvelteKit Workbench live at: http://localhost:${actualPort}`);
          resolve(server);
        });
        server.on('error', reject);
      });
    },
    close: () => {
      for (const client of sseClients) {
        try {
          client.end();
        } catch {}
      }
      sseClients.clear();
      return new Promise((resolve) => server.close(resolve));
    }
  };
}
