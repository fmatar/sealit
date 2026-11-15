function selectWorkspace(ws) {
  activateTabSet(
    ['clearinghouse', 'lineage', 'timemachine', 'kanban', 'trace'],
    ws,
    (name) => document.getElementById('wspanel-' + name),
    (name) => document.getElementById('wstab-' + name)
  );
}

function renderClearinghouse() {
  const arch = STATE.arch || {};
  const audit = STATE.audit || {};
  const ringPolicies = {
    'Domain & Core Rules': 'Inner Core (Zero Outward Deps)',
    'Application & Engine Libs': 'Use-Case Orchestration',
    'Adapters, CLI & Skills': 'Interface & Skill Routers',
    'Specs, ADRs & Verification': 'Constitutional & Test Gate'
  };

  const adEl = document.getElementById('arch-diff-mount');
  if (adEl) {
    adEl.innerHTML = Object.entries(arch.rings || {}).map(([ringName, files]) => {
      const list = Array.isArray(files) ? files : [];
      const fileRows = list.length > 0
        ? list.map(f => '<div class="mono fs-12">' + escapeHtml(f) + '</div>').join('')
        : '<span class="text-muted">In Balance &mdash; Zero uncommitted ring modifications</span>';
      return '<tr>' +
        '<th>' + escapeHtml(ringName) + '</th>' +
        '<td class="text-secondary fs-12">' + escapeHtml(ringPolicies[ringName] || 'Concentric Layer') + '</td>' +
        '<td class="mono fw-700">' + list.length + '</td>' +
        '<td>' + fileRows + '</td>' +
      '</tr>';
    }).join('');
  }

  const maEl = document.getElementById('hashchain-ast-mount');
  if (maEl) {
    const snap = arch.latestSnapshot;
    const rows = [
      '<tr><th>SHA-256 Chain Head</th><td class="mono">' + escapeHtml(audit.chainHead || 'GENESIS_HASH') + '</td><td><span class="seal-badge ' + (audit.valid !== false ? 'pass' : 'fail') + '">' + (audit.valid !== false ? 'Verified' : 'Invalid') + '</span></td></tr>',
      '<tr><th>Ledger Chain Depth</th><td class="mono">' + escapeHtml(String(audit.recordsCount || 0)) + ' signed gate receipt(s)</td><td><span class="seal-badge pass">Immutable</span></td></tr>'
    ];
    if (snap) {
      rows.push(
        '<tr>' +
          '<th>Latest Checkpoint (' + escapeHtml(snap.ticket || 'HEAD') + ')</th>' +
          '<td><div>' + escapeHtml(snap.reason || 'Architectural verification') + '</div>' +
          '<div class="mono fs-11 text-secondary mt-2">Branch: ' + escapeHtml(snap.branch || 'main') + ' &middot; Commit: ' + escapeHtml(snap.commitSha || 'HEAD') + '</div></td>' +
          '<td><span class="seal-badge pass">' + escapeHtml(snap.status || 'PASSED') + '</span></td>' +
        '</tr>'
      );
      for (const d of (snap.diagramChanges || [])) {
        rows.push('<tr><th class="mono">' + escapeHtml(d.diagram) + '</th><td class="mono">' + escapeHtml(d.summary) + '</td><td><span class="seal-badge cobalt">AST Delta</span></td></tr>');
      }
    }
    maEl.innerHTML = rows.join('');
  }
}

function setLineageCategory(cat) {
  activeCategory = cat;
  document.querySelectorAll('[data-cat]').forEach(btn => {
    btn.classList.toggle('primary', btn.getAttribute('data-cat') === cat);
  });
  renderLineageTable();
}

function renderLineageTable() {
  const nodes = STATE.graph?.nodes || [];
  const query = (document.getElementById('lineage-search')?.value || '').toLowerCase().trim();
  const filtered = nodes.filter(n => {
    if (activeCategory !== 'ALL' && String(n.category || '').toUpperCase() !== activeCategory) return false;
    if (!query) return true;
    return (
      String(n.id || '').toLowerCase().includes(query) ||
      String(n.label || '').toLowerCase().includes(query) ||
      String(n.status || '').toLowerCase().includes(query)
    );
  });

  const countEl = document.getElementById('lineage-visible-count');
  if (countEl) countEl.textContent = filtered.length + ' of ' + nodes.length + ' nodes shown';

  const dgEl = document.getElementById('decision-graph-mount');
  if (dgEl) {
    if (filtered.length === 0) {
      dgEl.innerHTML = '<tr><th colspan="4" class="text-muted">No causal nodes match the current filter.</th></tr>';
    } else {
      dgEl.innerHTML = filtered.map(n => {
        const isSel = selectedNodeId === n.id;
        const statusStr = String(n.status || 'ACTIVE');
        const badgeClass = statusStr.toLowerCase().includes('reject')
          ? 'fail'
          : statusStr.toLowerCase().includes('pending')
            ? 'warn'
            : 'pass';
        return '<tr class="' + (isSel ? 'selected ' : '') + 'clickable-row" data-node-id="' + escapeHtml(n.id) + '">' +
          '<th class="mono">' + escapeHtml(n.id) + '</th>' +
          '<td class="mono fs-12">' + escapeHtml(n.category) + '</td>' +
          '<td>' + escapeHtml(n.label) + '</td>' +
          '<td><span class="seal-badge ' + badgeClass + '">' + escapeHtml(statusStr) + '</span></td>' +
        '</tr>';
      }).join('');
    }
    bindDelegatedNodeClicks(dgEl, selectLineageNode);
  }

  const adrSelect = document.getElementById('adr-select');
  if (adrSelect) {
    const prevValue = adrSelect.value;
    const adrNodes = nodes.filter(n => String(n.id || '').startsWith('ADR-'));
    adrSelect.innerHTML = adrNodes.map(a =>
      '<option value="' + escapeHtml(a.id) + '">' + escapeHtml(a.id + ' (' + (a.status || 'proposed') + ')') + '</option>'
    ).join('');
    if (prevValue) adrSelect.value = prevValue;
  }

  if (!selectedNodeId && filtered.length > 0) {
    selectLineageNode(filtered[0].id, false);
  }
}

function selectLineageNode(nodeId, rerender = true) {
  selectedNodeId = nodeId;
  if (rerender) renderLineageTable();
  const nodes = STATE.graph?.nodes || [];
  const edges = STATE.graph?.edges || [];
  const node = nodes.find(n => n.id === nodeId);
  const badge = document.getElementById('selected-node-badge');
  const body = document.getElementById('lineage-inspector-body');
  if (!node || !body) return;

  if (badge) badge.textContent = node.id + ' (' + node.category + ')';
  if (String(node.id).startsWith('ADR-')) {
    const sel = document.getElementById('adr-select');
    if (sel) sel.value = node.id;
  }

  const inbound = edges.filter(e => e.to === node.id);
  const outbound = edges.filter(e => e.from === node.id);
  const renderHopList = (list, dir) => {
    if (!list.length) return '<div class="text-muted fs-12">None recorded</div>';
    return '<div class="hop-list">' +
      list.map(e => {
        const targetId = dir === 'in' ? e.from : e.to;
        return '<button type="button" class="action-btn mono" data-node-id="' + escapeHtml(targetId) + '">' +
          escapeHtml(e.from + ' [' + e.relation + '] -> ' + e.to) +
        '</button>';
      }).join('') +
    '</div>';
  };

  body.innerHTML =
    '<div class="inspector-title">' + escapeHtml(node.id + ': ' + node.label) + '</div>' +
    '<div class="mt-6 fs-12 text-secondary">Category: <code class="mono">' + escapeHtml(node.category) + '</code> &middot; Status: <code class="mono">' + escapeHtml(node.status || 'ACTIVE') + '</code></div>' +
    '<div class="mt-14"><div class="fw-700 fs-12 text-secondary">Upstream Dependencies / Supersedes:</div>' + renderHopList(outbound, 'out') + '</div>' +
    '<div class="mt-12"><div class="fw-700 fs-12 text-secondary">Downstream Dependents / Governed By:</div>' + renderHopList(inbound, 'in') + '</div>';
  bindDelegatedNodeClicks(body, selectLineageNode);
}

async function submitAdrDecision(action) {
  const adrId = document.getElementById('adr-select')?.value;
  const reason = document.getElementById('adr-reason')?.value || 'Adjudicated in Mission Control Clearinghouse';
  const toast = document.getElementById('adr-toast');
  if (!adrId) return;
  try {
    const resp = await authFetch('/api/adr/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adrId, action, reviewer: '@mission-control', reason })
    });
    const res = await resp.json();
    if (!resp.ok || res.success === false) {
      throw new Error(res.error || 'HTTP ' + resp.status);
    }
    if (toast) {
      toast.hidden = false;
      toast.textContent = res.adr
        ? 'Recorded: ' + res.adr.id + ' is now ' + res.adr.status.toUpperCase()
        : (res.error || 'Updated ADR status');
    }
    await bootWorkbench();
  } catch (err) {
    if (toast) {
      toast.hidden = false;
      toast.textContent = 'Error updating ADR: ' + err.message;
    }
  }
}

function renderTimeMachineAndDag() {
  const snaps = STATE.arch?.snapshots || STATE.graph?.archSnapshots || [];
  const slider = document.getElementById('tm-slider');
  const posLabel = document.getElementById('tm-position-label');
  const mount = document.getElementById('tm-snapshot-mount');

  const showSnap = (idx) => {
    const s = snaps[idx];
    if (!s) {
      if (posLabel) posLabel.textContent = '0 / 0 Snapshots';
      if (mount) mount.innerHTML = '<p class="m-0 text-muted">No architectural snapshots recorded yet.</p>';
      return;
    }
    if (posLabel) posLabel.textContent = 'Checkpoint ' + (idx + 1) + ' of ' + snaps.length;
    const diagRows = (s.diagramChanges || []).map(d =>
      '<tr><th class="mono">' + escapeHtml(d.diagram) + '</th><td class="mono">' + escapeHtml(d.summary) + '</td></tr>'
    ).join('');
    if (mount) {
      mount.innerHTML =
        '<div class="tm-snap-head">' +
          '<div><strong>Ticket:</strong> <code class="mono">' + escapeHtml(s.ticket || 'N/A') + '</code> &middot; <strong>Branch:</strong> <code class="mono">' + escapeHtml(s.branch || 'main') + '</code></div>' +
          '<div><strong>Commit:</strong> <code class="mono">' + escapeHtml(s.commitSha || 'HEAD') + '</code> &middot; <span class="mono">' + escapeHtml((s.timestamp || '').slice(0, 19).replace('T', ' ')) + '</span></div>' +
        '</div>' +
        '<p class="my-10 text-ink"><strong>Checkpoint Reason:</strong> ' + escapeHtml(s.reason || 'Architectural verification') + '</p>' +
        (diagRows
          ? '<table class="ledger-table"><thead><tr><th>Diagram</th><th>AST Diff Summary</th></tr></thead><tbody>' + diagRows + '</tbody></table>'
          : '<div class="mono fs-12 text-secondary">Modified Files in Checkpoint: ' + ((s.modifiedFiles || []).length) + '</div>');
    }
  };

  if (slider) {
    slider.max = String(Math.max(0, snaps.length - 1));
    slider.value = String(Math.max(0, snaps.length - 1));
    slider.oninput = () => showSnap(Number(slider.value));
  }
  showSnap(Math.max(0, snaps.length - 1));

  const pdEl = document.getElementById('product-dag-mount');
  const waves = STATE.dag?.waves || [];
  if (pdEl) {
    if (waves.length === 0) {
      pdEl.innerHTML = '<tr><th colspan="3" class="text-muted">No capability waves parsed from PRODUCT.md.</th></tr>';
    } else {
      pdEl.innerHTML = waves.map(w => {
        const itemsHtml = (w.items || []).map(it =>
          '<div class="mb-6">' +
            '<span class="mono fw-700 text-cobalt">' + escapeHtml(it.id) + '</span> ' +
            '<strong>' + escapeHtml(it.title) + '</strong> ' +
            '<span class="seal-badge pass seal-badge-sm">' + escapeHtml(it.status || 'ACTIVE') + '</span>' +
            (it.specPath ? '<div class="mono fs-11 text-secondary">Spec: ' + escapeHtml(it.specPath) + '</div>' : '') +
          '</div>'
        ).join('');
        return '<tr>' +
          '<th class="mono">Wave ' + escapeHtml(String(w.wave)) + '</th>' +
          '<td><span class="seal-badge ' + (w.parallelizable ? 'cobalt' : 'warn') + '">' + (w.parallelizable ? 'Parallel Fork-Join' : 'Sequential Gate') + '</span></td>' +
          '<td>' + itemsHtml + '</td>' +
        '</tr>';
      }).join('');
    }
  }
}

async function submitDagControl(action) {
  const reason = document.getElementById('dag-reason')?.value || 'Operator action from Mission Control';
  const toast = document.getElementById('dag-toast');
  const badge = document.getElementById('dag-status-badge');
  try {
    const resp = await authFetch('/api/dag/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reason })
    });
    const res = await resp.json();
    if (!resp.ok || res.success === false) {
      throw new Error(res.error || 'HTTP ' + resp.status);
    }
    const newStatus = res.state?.status || action;
    if (badge) {
      badge.textContent = 'DAG ' + String(newStatus).toUpperCase();
      badge.className = 'seal-badge ' + (newStatus === 'paused' ? 'warn' : 'pass');
    }
    if (toast) {
      toast.hidden = false;
      toast.textContent = 'DAG state updated to ' + String(newStatus).toUpperCase();
    }
  } catch (err) {
    if (toast) {
      toast.hidden = false;
      toast.textContent = 'Failed to update DAG: ' + err.message;
    }
  }
}

function renderKanbanWorkspace() {
  const kb = STATE.kanban || { columns: [], matrix: [] };
  const query = (document.getElementById('kanban-search')?.value || '').toLowerCase().trim();
  const metaEl = document.getElementById('kanban-meta-line');
  if (metaEl) {
    metaEl.textContent = (kb.repo ? 'Repository: ' + kb.repo + ' · ' : '') +
      (kb.lastSynced ? 'Last Synced: ' + kb.lastSynced : 'Synchronized with docs/KANBAN.md');
  }

  const colMount = document.getElementById('kanban-columns-mount');
  if (colMount) {
    colMount.innerHTML = (kb.columns || []).map(col => {
      const items = (col.items || []).filter(it =>
        !query || String(it.id || '').toLowerCase().includes(query) || String(it.title || '').toLowerCase().includes(query)
      );
      const cardsHtml = items.length > 0
        ? items.map(it =>
            '<article class="ticket-entry">' +
              '<div class="ticket-entry-top">' +
                (it.url
                  ? '<a href="' + escapeHtml(it.url) + '" target="_blank" rel="noopener noreferrer" class="ticket-id">' + escapeHtml(it.id) + '</a>'
                  : '<span class="ticket-id">' + escapeHtml(it.id) + '</span>') +
              '</div>' +
              '<div class="ticket-title">' + escapeHtml(it.title) + '</div>' +
            '</article>'
          ).join('')
        : '<div class="empty-col-note">No tickets in column</div>';
      return '<div class="board-column">' +
        '<div class="board-column-header"><span>' + escapeHtml(col.label) + '</span><span class="ws-count">' + items.length + '</span></div>' +
        '<div class="board-column-list">' + cardsHtml + '</div>' +
      '</div>';
    }).join('');
  }

  const matrix = (kb.matrix || []).filter(row =>
    !query ||
    String(row.issue?.id || '').toLowerCase().includes(query) ||
    String(row.issue?.title || '').toLowerCase().includes(query) ||
    String(row.status || '').toLowerCase().includes(query)
  );
  const countEl = document.getElementById('kanban-matrix-count');
  if (countEl) countEl.textContent = matrix.length + ' tracked ticket(s)';

  const matMount = document.getElementById('kanban-matrix-mount');
  if (matMount) {
    if (matrix.length === 0) {
      matMount.innerHTML = '<tr><th colspan="5" class="text-muted">No traceability matrix rows match filter.</th></tr>';
    } else {
      matMount.innerHTML = matrix.map(r => {
        const linkHtml = r.issue?.url
          ? '<a href="' + escapeHtml(r.issue.url) + '" target="_blank" rel="noopener noreferrer" class="mono">' + escapeHtml(r.issue.id) + '</a>'
          : '<span class="mono">' + escapeHtml(r.issue?.id || '—') + '</span>';
        return '<tr><th>' + linkHtml + '</th><td>' + escapeHtml(r.issue?.title || '—') + '</td><td><span class="seal-badge pass">' + escapeHtml(r.status) + '</span></td><td class="mono">' + escapeHtml(r.priority) + '</td><td>' + escapeHtml(r.component) + '</td></tr>';
      }).join('');
    }
  }
}

function renderTraceWorkspace() {
  const entries = STATE.trace || [];
  const query = (document.getElementById('trace-search')?.value || '').toLowerCase().trim();
  const filtered = entries.filter(e =>
    !query ||
    String(e.ticket?.id || '').toLowerCase().includes(query) ||
    String(e.branch || '').toLowerCase().includes(query) ||
    String(e.commit || '').toLowerCase().includes(query) ||
    String(e.reason || '').toLowerCase().includes(query)
  );

  const mount = document.getElementById('trace-ledger-mount');
  if (!mount) return;
  if (filtered.length === 0) {
    mount.innerHTML = '<tr><th colspan="6" class="text-muted">No architectural trace records match the current filter.</th></tr>';
    return;
  }
  mount.innerHTML = filtered.map(e => {
    const ticketHtml = e.ticket?.url
      ? '<a href="' + escapeHtml(e.ticket.url) + '" target="_blank" rel="noopener noreferrer" class="mono">' + escapeHtml(e.ticket.id) + '</a>'
      : '<span class="mono">' + escapeHtml(e.ticket?.id || '—') + '</span>';
    const changesHtml = (e.changes || []).map(c => '<div class="mono fs-11">' + escapeHtml(c) + '</div>').join('');
    return '<tr>' +
      '<th>' + ticketHtml + '</th>' +
      '<td class="mono nowrap">' + escapeHtml(e.timestamp) + '</td>' +
      '<td class="mono"><div>' + escapeHtml(e.branch) + '</div><div class="fs-11 text-secondary">SHA: ' + escapeHtml(e.commit) + '</div></td>' +
      '<td>' + escapeHtml(e.reason) + '</td>' +
      '<td>' + changesHtml + '</td>' +
      '<td><span class="seal-badge pass">' + escapeHtml(e.status || 'PASSED') + '</span></td>' +
    '</tr>';
  }).join('');
}

function renderAllWorkspaces() {
  renderClearinghouse();
  renderLineageTable();
  renderTimeMachineAndDag();
  renderKanbanWorkspace();
  renderTraceWorkspace();
}

async function bootWorkbench() {
  try {
    const [arch, graph, prod, statusRes] = await Promise.all([
      authFetch('/api/arch-diff').then(r => r.json()),
      authFetch('/api/decision-graph').then(r => r.json()),
      authFetch('/api/product').then(r => r.json()),
      authFetch('/api/status').then(r => r.json())
    ]);
    STATE.arch = arch;
    STATE.graph = graph;
    STATE.product = prod.product;
    STATE.dag = prod.dag;
    if (statusRes.audit) STATE.audit = statusRes.audit;
  } catch (err) {
    const el = document.getElementById('sse-indicator');
    if (el) el.textContent = 'Sync Degraded: ' + (err?.message || 'offline');
  }
  renderAllWorkspaces();
}

function bindMissionControlEvents() {
  document.getElementById('sync-ledger-btn')?.addEventListener('click', bootWorkbench);
  document.querySelectorAll('[data-ws]').forEach(btn => {
    btn.addEventListener('click', () => selectWorkspace(btn.getAttribute('data-ws')));
  });
  document.querySelectorAll('[data-cat]').forEach(btn => {
    btn.addEventListener('click', () => setLineageCategory(btn.getAttribute('data-cat')));
  });
  document.querySelectorAll('[data-adr-action]').forEach(btn => {
    btn.addEventListener('click', () => submitAdrDecision(btn.getAttribute('data-adr-action')));
  });
  document.querySelectorAll('[data-dag-action]').forEach(btn => {
    btn.addEventListener('click', () => submitDagControl(btn.getAttribute('data-dag-action')));
  });
  document.getElementById('lineage-search')?.addEventListener('input', renderLineageTable);
  document.getElementById('kanban-search')?.addEventListener('input', renderKanbanWorkspace);
  document.getElementById('trace-search')?.addEventListener('input', renderTraceWorkspace);
}

bindMissionControlEvents();
renderAllWorkspaces();
bootWorkbench();
try {
  const es = new EventSource('/api/events?token=' + encodeURIComponent(SDLC_TOKEN));
  es.addEventListener('connected', () => {
    const el = document.getElementById('sse-indicator');
    if (el) el.textContent = 'SSE Stream Connected';
  });
  es.addEventListener('adr-updated', bootWorkbench);
  es.addEventListener('dag-updated', bootWorkbench);
  es.addEventListener('arch-updated', bootWorkbench);
} catch {}
