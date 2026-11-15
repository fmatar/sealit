function switchTab(tab) {
  activateTabSet(
    ['rings', 'lineage', 'timemachine', 'waves'],
    tab,
    (t) => document.getElementById('view-' + t),
    (t) => document.getElementById('tab-' + t)
  );
}

function renderSnapshot(idxStr) {
  const snaps = STATE.arch.snapshots || [];
  const idx = Math.max(0, Math.min(snaps.length - 1, Number(idxStr) || 0));
  const snap = snaps[idx];
  const label = document.getElementById('slider-label');
  const box = document.getElementById('snapshot-detail');
  if (!snap) {
    label.textContent = '0 / 0';
    box.innerHTML = '<p class="m-0 text-secondary">No architectural snapshots recorded yet.</p>';
    return;
  }
  label.textContent = 'Entry ' + (idx + 1) + ' of ' + snaps.length + ' (' + (snap.timestamp || '').slice(0, 16).replace('T', ' ') + ')';
  const diagList = (snap.diagramChanges || []).map(d => '<li class="mono">' + escapeHtml(d.diagram) + ' &mdash; ' + escapeHtml(d.summary) + '</li>').join('');
  box.innerHTML =
    '<div class="flex-between-bar">' +
      '<span>Ticket: <code class="mono">' + escapeHtml(snap.ticket || 'N/A') + '</code> &middot; Branch: <code class="mono">' + escapeHtml(snap.branch || 'main') + '</code></span>' +
      '<span>Commit: <code class="mono">' + escapeHtml(snap.commitSha || 'HEAD') + '</code> &middot; Seal: <strong>' + escapeHtml(snap.status || 'PASSED') + '</strong></span>' +
    '</div>' +
    '<p class="m-0 mb-8 text-secondary"><strong>Checkpoint Rationale:</strong> ' + escapeHtml(snap.reason || 'Architectural verification checkpoint') + '</p>' +
    (diagList ? '<ul class="list-plain">' + diagList + '</ul>' : '<p class="m-0 text-secondary mono">Modified Files: ' + escapeHtml((snap.modifiedFiles || []).length) + '</p>');
}

function inspectNode(nodeId) {
  const node = (STATE.graph.nodes || []).find(n => n.id === nodeId);
  const el = document.getElementById('node-inspector');
  if (!node || !el) return;
  const connected = (STATE.graph.edges || [])
    .filter(e => e.from === node.id || e.to === node.id)
    .map(e => e.from + ' [' + e.relation + '] -> ' + e.to);
  el.innerHTML =
    '<div class="fw-700 text-ink">' + escapeHtml(node.id) + ' &mdash; ' + escapeHtml(node.label) + '</div>' +
    '<div class="mt-4 text-secondary">Category: <code class="mono">' + escapeHtml(node.category) + '</code> &middot; Governance Status: <code class="mono">' + escapeHtml(node.status || 'ACTIVE') + '</code></div>' +
    (connected.length ? '<div class="mt-6 text-cobalt mono">' + connected.map(c => escapeHtml(c)).join(' | ') + '</div>' : '<div class="mt-6 text-muted">Standalone constitutional node.</div>');
}

function initWidget() {
  const sess = STATE.session;
  document.getElementById('session-pill').textContent = sess
    ? 'Ticket #' + sess.issueId + ' (Stage ' + sess.stage + '/8)'
    : 'Mainline Standing By';

  const archPass = STATE.arch.archDiff?.passed !== false;
  const ringBadge = document.getElementById('ring-badge');
  ringBadge.className = 'seal-pill ' + (archPass ? 'pass' : 'fail');
  ringBadge.textContent = archPass
    ? 'Rings Balanced: 0 Violations'
    : 'Ring Violations: ' + STATE.arch.archDiff.violationsCount;

  const hashchainBadge = document.getElementById('hashchain-badge');
  hashchainBadge.className = 'seal-pill ' + (STATE.audit?.valid ? 'pass' : 'fail');
  hashchainBadge.textContent = STATE.audit?.valid
    ? 'Hash-Chain Verified (' + (STATE.audit.recordsCount || 0) + ' entries)'
    : 'Hash-Chain Check Failed';

  document.getElementById('rings-count-label').textContent = (STATE.arch.modifiedFiles?.length || 0) + ' modified';
  const chainHead = STATE.audit?.chainHead;
  document.getElementById('hashchain-head-short').textContent = chainHead
    ? 'Head ' + String(chainHead).slice(0, 12) + '...'
    : 'Genesis Head';

  document.getElementById('rings-grid').innerHTML = Object.entries(STATE.arch.rings || {}).map(([ringName, files]) => {
    const preview = files.slice(0, 4).map(f => '<div class="mono">' + escapeHtml(f) + '</div>').join('');
    const more = files.length > 4 ? '<div class="text-muted">+' + (files.length - 4) + ' additional file(s)</div>' : '';
    return '<tr>' +
      '<td class="fw-600">' + escapeHtml(ringName) + '</td>' +
      '<td class="mono">' + escapeHtml(files.length) + '</td>' +
      '<td>' + (files.length > 0 ? preview + more : '<span class="text-muted">In Balance (Unchanged)</span>') + '</td>' +
    '</tr>';
  }).join('');

  const latest = STATE.arch.latestSnapshot;
  const diffBox = document.getElementById('mermaid-diff-box');
  const rootHash = STATE.audit?.chainHead || '0000000000000000';
  if (latest && (latest.diagramChanges || []).length > 0) {
    diffBox.innerHTML =
      '<div class="mb-8"><strong>SHA-256 Chain Head:</strong> <code class="mono">' + escapeHtml(rootHash.slice(0, 24)) + '...</code></div>' +
      '<div class="fw-600 mb-4">Latest Mermaid AST Graph Diff (' + escapeHtml(latest.ticket) + '):</div>' +
      latest.diagramChanges.map(d => '<div class="mono">&bull; ' + escapeHtml(d.diagram) + ': ' + escapeHtml(d.summary) + '</div>').join('');
  } else {
    diffBox.innerHTML =
      '<div class="mb-8"><strong>SHA-256 Chain Head:</strong> <code class="mono">' + escapeHtml(rootHash.slice(0, 24)) + '...</code></div>' +
      '<div class="fw-600">Latest Architectural Checkpoint:</div>' +
      '<div class="text-secondary mt-4">' + (latest ? (escapeHtml(latest.reason) + ' (' + escapeHtml(latest.ticket) + ' on ' + escapeHtml(latest.branch) + ')') : 'Zero breaking diagram mutations recorded.') + '</div>';
  }

  const nodesGrid = document.getElementById('nodes-grid');
  nodesGrid.innerHTML = (STATE.graph.nodes || []).map(n =>
    '<button type="button" data-node-id="' + escapeHtml(n.id) + '" class="node-item">' +
      '<div class="node-item-head"><span>' + escapeHtml(n.id) + '</span><span>' + escapeHtml(n.status || n.category) + '</span></div>' +
      '<div class="node-item-title">' + escapeHtml(n.label) + '</div>' +
    '</button>'
  ).join('');
  bindDelegatedNodeClicks(nodesGrid, inspectNode);

  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
  });

  const snaps = STATE.arch.snapshots || [];
  const slider = document.getElementById('time-slider');
  slider.max = String(Math.max(0, snaps.length - 1));
  slider.value = String(Math.max(0, snaps.length - 1));
  slider.addEventListener('input', () => renderSnapshot(slider.value));
  renderSnapshot(slider.value);

  document.getElementById('waves-tbody').innerHTML = (STATE.dag?.waves || []).map(w =>
    '<tr>' +
      '<td class="mono fw-600">Wave ' + escapeHtml(w.wave) + '</td>' +
      '<td>' + (w.parallelizable ? 'Parallelizable Fork-Join' : 'Sequential Gate') + '</td>' +
      '<td>' + (w.items || []).map(it => '<div class="mono"><strong>' + escapeHtml(it.id) + '</strong>: ' + escapeHtml(it.title) + ' (' + escapeHtml(it.status) + ')</div>').join('') + '</td>' +
    '</tr>'
  ).join('');

  switchTab('rings');
}

initWidget();
