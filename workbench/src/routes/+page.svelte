<script>
  // Svelte 5 Runes: Bidirectional Mission Control & Causal Decision Lineage Workbench
  let activeTab = $state('lineage');
  let statusData = $state({ active: false, session: null, audit: { valid: true, recordsCount: 0 } });
  let graphData = $state({ nodes: [], edges: [], driftPivots: [], timeline: [], archSnapshots: [], stats: {} });
  let productData = $state({ product: { title: 'Loading...', capabilities: [], invariants: [] }, dag: { waves: [], state: { status: 'idle' } } });
  let selectedNode = $state(null);
  let sliderIdx = $state(0);
  let selectedCategory = $state('ALL');
  let actionFeedback = $state('');

  let filteredNodes = $derived(
    selectedCategory === 'ALL'
      ? graphData.nodes
      : graphData.nodes.filter((n) => n.category === selectedCategory)
  );

  let currentArchSnapshot = $derived(
    graphData.archSnapshots && graphData.archSnapshots.length > 0
      ? graphData.archSnapshots[Math.min(sliderIdx, graphData.archSnapshots.length - 1)]
      : null
  );

  let pendingAdrs = $derived(
    (graphData.driftPivots || []).filter((a) => a.status === 'pending_approval')
  );

  async function refreshAll() {
    try {
      const [stRes, grRes, prRes] = await Promise.all([
        fetch('/api/status').then((r) => r.json()),
        fetch('/api/decision-graph').then((r) => r.json()),
        fetch('/api/product').then((r) => r.json())
      ]);
      statusData = stRes;
      graphData = grRes;
      productData = prRes;
      if (grRes.archSnapshots?.length > 0 && sliderIdx === 0) {
        sliderIdx = grRes.archSnapshots.length - 1;
      }
    } catch (e) {
      console.error('Workbench fetch error:', e);
    }
  }

  async function decideAdrAction(adrId, action) {
    const res = await fetch('/api/adr/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adrId,
        action,
        reviewer: '@sveltekit-operator',
        reason: `Operator ${action}d via SvelteKit 5 Mission Control`
      })
    }).then((r) => r.json());
    actionFeedback = `ADR ${adrId} -> ${res.adr?.status || action}`;
    await refreshAll();
  }

  async function controlDagAction(action) {
    const res = await fetch('/api/dag/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reason: `Triggered '${action}' from SvelteKit Workbench` })
    }).then((r) => r.json());
    actionFeedback = `DAG Status -> ${res.state?.status}`;
    await refreshAll();
  }

  $effect(() => {
    refreshAll();
    const es = new EventSource('/api/events');
    es.addEventListener('adr-updated', () => refreshAll());
    es.addEventListener('dag-updated', () => refreshAll());
    return () => es.close();
  });
</script>

<div class="workbench-shell">
  <header class="topbar">
    <div>
      <h1>⚡ Agentic SDLC Framework: SvelteKit 5 Decision & Architecture Workbench</h1>
      <p class="subtitle">Causal Decision Lineage • Spec-Drift ADR Governance • 4-Layer Merkle Verification</p>
    </div>
    <div class="badges">
      <span class="badge accent">
        {statusData.session ? `Active Session #${statusData.session.issueId} (Stage ${statusData.session.stage}/8)` : 'Idle / Ready'}
      </span>
      <span class="badge {statusData.audit?.valid ? 'ok' : 'err'}">
        ⛓️ Merkle Chain: {statusData.audit?.valid ? `Verified (${statusData.audit.recordsCount})` : 'Tampered'}
      </span>
    </div>
  </header>

  {#if actionFeedback}
    <div class="toast">{actionFeedback}</div>
  {/if}

  <nav class="tabs">
    <button class:active={activeTab === 'lineage'} onclick={() => (activeTab = 'lineage')}>
      🧬 Causal Decision Lineage ({graphData.nodes?.length || 0})
    </button>
    <button class:active={activeTab === 'timemachine'} onclick={() => (activeTab = 'timemachine')}>
      ⏱️ Architecture Time-Machine ({graphData.archSnapshots?.length || 0})
    </button>
    <button class:active={activeTab === 'product'} onclick={() => (activeTab = 'product')}>
      📜 PRODUCT.md & DAG Waves ({productData.product?.capabilities?.length || 0})
    </button>
    <button class:active={activeTab === 'adr'} onclick={() => (activeTab = 'adr')}>
      ⚡ ADR Drift Queue ({pendingAdrs.length} Pending)
    </button>
  </nav>

  {#if activeTab === 'lineage'}
    <section class="panel-grid">
      <div class="card wide">
        <div class="card-header">
          <h2>Causal Decision Graph (CAP → SPEC → Ticket → ADR Pivot → Architecture)</h2>
          <div class="filter-pills">
            {#each ['ALL', 'CAPABILITY', 'INVARIANT', 'SPEC', 'ADR', 'TICKET', 'ARCH'] as cat}
              <button class:pill-active={selectedCategory === cat} onclick={() => (selectedCategory = cat)}>
                {cat}
              </button>
            {/each}
          </div>
        </div>

        <div class="node-grid">
          {#each filteredNodes as node (node.id)}
            <button class="node-card cat-{node.category?.toLowerCase()}" onclick={() => (selectedNode = node)}>
              <div class="node-top">
                <span class="node-cat">{node.category}</span>
                <span class="node-status">{node.status}</span>
              </div>
              <div class="node-id">{node.id}</div>
              <div class="node-label">{node.label}</div>
            </button>
          {/each}
        </div>

        <h3>Causal Edges ({graphData.edges?.length || 0})</h3>
        <div class="edges-list">
          {#each graphData.edges || [] as edge}
            <div class="edge-chip">
              <strong>{edge.from}</strong>
              <span class="arrow">—[{edge.relation}]→</span>
              <strong>{edge.to}</strong>
            </div>
          {/each}
        </div>
      </div>

      <aside class="card inspector">
        <h2>🔍 Node & Merkle Proof Inspector</h2>
        {#if selectedNode}
          <div class="inspector-body">
            <h3>{selectedNode.label}</h3>
            <p><strong>ID:</strong> <code>{selectedNode.id}</code></p>
            <p><strong>Category:</strong> <code>{selectedNode.category}</code></p>
            <p><strong>Status:</strong> <code>{selectedNode.status}</code></p>
            {#if selectedNode.ticketId}
              <p><strong>Origin Ticket:</strong> <code>#{selectedNode.ticketId}</code></p>
            {/if}
            <pre>{JSON.stringify(selectedNode.metadata || {}, null, 2)}</pre>
          </div>
        {:else}
          <p class="muted">Click any node in the Causal Decision Graph to inspect its specification, ADR rationale, and Merkle audit lineage.</p>
        {/if}
      </aside>
    </section>
  {/if}

  {#if activeTab === 'timemachine'}
    <section class="card">
      <h2>⏱️ Architecture Evolution Time-Slider</h2>
      {#if (graphData.archSnapshots || []).length > 0}
        <input
          type="range"
          min="0"
          max={Math.max(0, graphData.archSnapshots.length - 1)}
          bind:value={sliderIdx}
          class="slider"
        />
        {#if currentArchSnapshot}
          <div class="snapshot-box">
            <p>
              <strong>Snapshot {sliderIdx + 1} / {graphData.archSnapshots.length}</strong> •
              Ticket <code>{currentArchSnapshot.ticket}</code> •
              Branch <code>{currentArchSnapshot.branch}</code> •
              Commit <code>{currentArchSnapshot.commitSha}</code>
            </p>
            <p><strong>Reason:</strong> {currentArchSnapshot.reason}</p>
            <pre>{JSON.stringify(currentArchSnapshot.diagramChanges || [], null, 2)}</pre>
          </div>
        {/if}
      {:else}
        <p class="muted">No architectural snapshots recorded yet. Run <code>sdlc-engine arch trace</code> to capture checkpoints.</p>
      {/if}
    </section>
  {/if}

  {#if activeTab === 'product'}
    <section class="card">
      <div class="card-header">
        <h2>📜 {productData.product?.title || 'PRODUCT.md Constitution'}</h2>
        <div class="dag-controls">
          <span class="badge">DAG State: {productData.dag?.state?.status || 'idle'}</span>
          <button onclick={() => controlDagAction('resume')}>▶️ Resume DAG</button>
          <button onclick={() => controlDagAction('pause')}>⏸️ Pause DAG</button>
          <button onclick={() => controlDagAction('trigger-wave')}>⚡ Advance Wave</button>
        </div>
      </div>

      <h3>Topological Execution Waves</h3>
      <div class="waves-list">
        {#each productData.dag?.waves || [] as wave}
          <div class="wave-box">
            <h4>Wave {wave.wave} {wave.parallelizable ? '⚡ (Parallel Worktree Wave)' : '(Sequential)'}</h4>
            {#each wave.items as item}
              <div class="cap-item">
                <strong>{item.id}</strong>: {item.title}
                <small>({item.status}) • Spec: <code>{item.spec}</code></small>
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if activeTab === 'adr'}
    <section class="card">
      <h2>⚡ Spec-Drift & ADR Governance Queue</h2>
      {#each graphData.driftPivots || [] as adr (adr.id)}
        <div class="adr-row">
          <div>
            <strong>{adr.id}: {adr.title}</strong>
            <p>
              Scope: <code>{adr.scope}</code> • Status: <code>{adr.status}</code> •
              Ticket: <code>#{adr.ticketId || 'N/A'}</code> •
              Supersedes: <code>{(adr.supersedes || []).join(', ') || 'None'}</code>
            </p>
          </div>
          {#if adr.status === 'pending_approval'}
            <div class="adr-actions">
              <button class="btn-approve" onclick={() => decideAdrAction(adr.id, 'approve')}>
                ✅ Approve & Patch PRODUCT.md
              </button>
              <button class="btn-reject" onclick={() => decideAdrAction(adr.id, 'reject')}>
                ❌ Reject Drift
              </button>
            </div>
          {/if}
        </div>
      {/each}
    </section>
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
    background: #0b1120;
    color: #f8fafc;
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', monospace;
  }
  .workbench-shell { padding: 24px; max-width: 1440px; margin: 0 auto; }
  .topbar { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #1e293b; padding-bottom: 16px; margin-bottom: 20px; }
  h1 { margin: 0; font-size: 20px; color: #38bdf8; }
  .subtitle { margin: 4px 0 0; font-size: 12px; color: #94a3b8; }
  .badges { display: flex; gap: 10px; }
  .badge { padding: 6px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; background: #1e293b; border: 1px solid #334155; }
  .badge.accent { background: #0284c7; border-color: #38bdf8; }
  .badge.ok { background: #14532d; border-color: #22c55e; }
  .badge.err { background: #7f1d1d; border-color: #ef4444; }
  .tabs { display: flex; gap: 8px; margin-bottom: 20px; }
  .tabs button { background: #1e293b; color: #cbd5e1; border: 1px solid #334155; padding: 10px 16px; border-radius: 8px; cursor: pointer; font-weight: 600; }
  .tabs button.active { background: #0284c7; color: white; border-color: #38bdf8; }
  .panel-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; }
  .card { background: #111827; border: 1px solid #1f2937; border-radius: 10px; padding: 18px; }
  .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px; }
  .node-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .node-card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 12px; text-align: left; color: #f8fafc; cursor: pointer; }
  .node-card.cat-adr { border-left: 4px solid #f59e0b; }
  .node-card.cat-capability { border-left: 4px solid #38bdf8; }
  .node-card.cat-invariant { border-left: 4px solid #a855f7; }
  .node-card.cat-arch { border-left: 4px solid #22c55e; }
  .node-top { display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; margin-bottom: 6px; }
  .node-id { font-weight: 700; color: #38bdf8; font-size: 13px; }
  .node-label { font-size: 12px; margin-top: 4px; color: #e2e8f0; }
  .edges-list { display: flex; flex-wrap: wrap; gap: 8px; }
  .edge-chip { background: #0f172a; border: 1px solid #334155; padding: 6px 10px; border-radius: 6px; font-size: 12px; }
  .arrow { color: #38bdf8; margin: 0 6px; }
  .adr-row { display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #1e293b; }
  .btn-approve { background: #15803d; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; margin-right: 8px; }
  .btn-reject { background: #b91c1c; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; }
  .slider { width: 100%; margin: 16px 0; }
  .toast { background: #0369a1; padding: 10px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 13px; }
  pre { background: #090d16; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 12px; border: 1px solid #1e293b; }
</style>
