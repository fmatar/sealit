import fs from 'node:fs';
import path from 'node:path';
import { fileExists, normalizeTicketId, parseTicketId, readFileSafe, writeFileAtomic } from './core.mjs';

export const DECISION_GRAPH_FILE = '.agent/decision-graph.jsonl';
export const DECISION_MAP_MD = 'docs/DECISION_MAP.md';

export function parseProductMarkdown(repoRoot = '.') {
  const productPath = path.resolve(repoRoot, 'PRODUCT.md');
  if (!fileExists(productPath)) {
    return {
      exists: false,
      title: null,
      vision: '',
      capabilities: [],
      invariants: [],
      adrs: []
    };
  }

  const raw = readFileSafe(productPath) || '';
  const titleMatch = raw.match(/^#\s+(?:🏛️\s*Product Constitution:\s*)?(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : 'Product';
  const visionMatch = raw.match(/##\s*1\.\s*Product Vision\s*\n+([^\n#]+)/i);
  const vision = visionMatch ? visionMatch[1].trim() : '';

  const capabilities = [];
  const invariants = [];
  const adrs = [];

  for (const line of raw.split('\n')) {
    const capMatch = line.match(/^\|\s*(CAP-\d+)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/);
    if (capMatch) {
      const dependsRaw = capMatch[4].trim();
      const dependsOn =
        dependsRaw === 'None' || dependsRaw === '-'
          ? []
          : dependsRaw.split(',').map((s) => s.trim()).filter(Boolean);
      capabilities.push({
        id: capMatch[1].trim(),
        title: capMatch[2].trim(),
        spec: capMatch[3].trim().replace(/`/g, ''),
        dependsOn,
        status: capMatch[5].trim().replace(/`/g, '')
      });
      continue;
    }

    const invMatch = line.match(/^-\s*\*\*(INV-\d+)\*\*:\s*(.+)$/);
    if (invMatch) {
      invariants.push({
        id: invMatch[1].trim(),
        text: invMatch[2].trim()
      });
      continue;
    }

    const adrMatch = line.match(/^\|\s*(ADR-\d+)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/);
    if (adrMatch) {
      adrs.push({
        id: adrMatch[1].trim(),
        title: adrMatch[2].trim(),
        scope: adrMatch[3].trim().replace(/`/g, ''),
        status: adrMatch[4].trim().replace(/`/g, ''),
        ticket: adrMatch[5].trim(),
        supersedes: adrMatch[6].trim()
      });
    }
  }

  return {
    exists: true,
    productPath,
    title,
    vision,
    capabilities,
    invariants,
    adrs
  };
}

export function listADRs(repoRoot = '.') {
  const adrDir = path.resolve(repoRoot, 'docs/adr');
  if (!fileExists(adrDir)) return [];

  const files = fs
    .readdirSync(adrDir)
    .filter((f) => f.startsWith('ADR-') && f.endsWith('.md'))
    .sort();

  const adrs = [];
  for (const file of files) {
    const full = path.join(adrDir, file);
    const raw = readFileSafe(full) || '';
    const idMatch = file.match(/^(ADR-\d+)/);
    const id = idMatch ? idMatch[1] : file.replace(/\.md$/, '');
    const title = (raw.match(/^title:[ \t]*(.+)$/m) || raw.match(/^#[ \t]+(.+)$/m) || [null, id])[1].trim();
    const status = (raw.match(/^status:[ \t]*(.+)$/m) || [null, 'accepted'])[1].trim();
    const scope = (raw.match(/^scope:[ \t]*(.+)$/m) || [null, 'technical'])[1].trim();
    const ticketMatch = raw.match(/^ticket:[ \t]*(.+)$/m);
    const supersedesRaw = (raw.match(/^supersedes:[ \t]*(.+)$/m) || [null, ''])[1].trim();
    const supersedes = supersedesRaw ? supersedesRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const createdAt = (raw.match(/^createdAt:[ \t]*(.+)$/m) || [null, ''])[1].trim();

    adrs.push({
      id,
      title,
      status,
      scope,
      ticketId: ticketMatch ? parseTicketId(ticketMatch[1]) : null,
      supersedes,
      createdAt,
      file: `docs/adr/${file}`,
      fullPath: full,
      content: raw
    });
  }

  return adrs;
}

export function appendDecisionEvent({
  type = 'DECISION_NODE',
  id,
  label = '',
  category = 'ARCH',
  status = 'active',
  ticketId = null,
  linksTo = [],
  metadata = {},
  repoRoot = '.'
} = {}) {
  const graphPath = path.resolve(repoRoot, DECISION_GRAPH_FILE);
  fs.mkdirSync(path.dirname(graphPath), { recursive: true });

  const event = {
    eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    type,
    id: id || `NODE-${Date.now()}`,
    label: label || id,
    category,
    status,
    ticketId: parseTicketId(ticketId),
    linksTo: Array.isArray(linksTo) ? linksTo : [],
    metadata
  };

  fs.appendFileSync(graphPath, JSON.stringify(event) + '\n', 'utf8');
  return { success: true, event, graphPath };
}

export function buildDecisionGraph(repoRoot = '.') {
  const nodesMap = new Map();
  const edges = [];
  const edgeKeys = new Set();
  const timeline = [];
  const driftPivots = [];

  const ensureNode = (id, defaults = {}) => {
    if (!id) return null;
    if (!nodesMap.has(id)) {
      let category = defaults.category || 'GENERIC';
      if (id.startsWith('CAP-')) category = 'CAPABILITY';
      else if (id.startsWith('INV-')) category = 'INVARIANT';
      else if (id.startsWith('SPEC-')) category = 'SPEC';
      else if (id.startsWith('ADR-')) category = 'ADR';
      else if (id.startsWith('ARCH-')) category = 'ARCH';
      else if (id.startsWith('#') || id.startsWith('TICKET-') || /^L-\d+$/i.test(id)) category = 'TICKET';

      nodesMap.set(id, {
        id,
        label: defaults.label || id,
        category,
        status: defaults.status || 'active',
        ticketId: defaults.ticketId ?? null,
        timestamp: defaults.timestamp || null,
        metadata: defaults.metadata || {}
      });
    } else if (defaults.label || defaults.status || defaults.metadata) {
      const existing = nodesMap.get(id);
      if (defaults.label && defaults.label !== id) existing.label = defaults.label;
      if (defaults.status) existing.status = defaults.status;
      if (defaults.metadata) existing.metadata = { ...existing.metadata, ...defaults.metadata };
    }
    return nodesMap.get(id);
  };

  const addEdge = (from, to, relation = 'leads_to') => {
    if (!from || !to || from === to) return;
    ensureNode(from);
    ensureNode(to);
    const key = `${from}|${to}|${relation}`;
    if (!edgeKeys.has(key)) {
      edgeKeys.add(key);
      edges.push({ from, to, relation });
    }
  };

  // 1. Hydrate from shared Ring 0 PRODUCT.md parser
  const product = parseProductMarkdown(repoRoot);
  if (product.exists) {
    for (const cap of product.capabilities) {
      ensureNode(cap.id, {
        label: `${cap.id}: ${cap.title}`,
        category: 'CAPABILITY',
        status: cap.status
      });
      if (cap.spec && cap.spec !== 'N/A' && cap.spec !== '-') {
        const specId = `SPEC-${cap.id.split('-')[1]}`;
        ensureNode(specId, {
          label: `${specId} (${cap.spec})`,
          category: 'SPEC',
          metadata: { path: cap.spec }
        });
        addEdge(cap.id, specId, 'specified_by');
      }
      for (const dep of cap.dependsOn || []) {
        addEdge(cap.id, dep, 'depends_on');
      }
    }
    for (const inv of product.invariants) {
      ensureNode(inv.id, {
        label: `${inv.id}: ${inv.text}`,
        category: 'INVARIANT',
        status: 'enforced'
      });
    }
  }

  // 2. Hydrate from shared Ring 0 docs/adr/*.md parser
  const adrs = listADRs(repoRoot);
  for (const adr of adrs) {
    ensureNode(adr.id, {
      label: `${adr.id}: ${adr.title}`,
      category: 'ADR',
      status: adr.status,
      ticketId: adr.ticketId,
      timestamp: adr.createdAt || null,
      metadata: { file: adr.file, scope: adr.scope, supersedes: adr.supersedes, content: adr.content }
    });

    driftPivots.push({
      id: adr.id,
      title: adr.title,
      scope: adr.scope,
      status: adr.status,
      ticketId: adr.ticketId,
      supersedes: adr.supersedes,
      file: adr.file
    });

    if (adr.ticketId !== null && adr.ticketId !== undefined) {
      const tNodeId = typeof adr.ticketId === 'number' ? `#${adr.ticketId}` : String(adr.ticketId);
      ensureNode(tNodeId, { label: `Ticket ${tNodeId}`, category: 'TICKET', ticketId: adr.ticketId });
      addEdge(tNodeId, adr.id, 'triggered_drift_adr');
    }

    for (const sup of adr.supersedes || []) {
      addEdge(sup, adr.id, 'amended_by_adr');
    }
  }

  // 2b. Hydrate compacted ADRs from docs/SRS.md if any exist
  const srsPath = path.resolve(repoRoot, 'docs/SRS.md');
  if (fileExists(srsPath)) {
    const srsRaw = readFileSafe(srsPath) || '';
    const secIdx = srsRaw.indexOf('## Compacted Architectural Decisions');
    if (secIdx !== -1) {
      const section = srsRaw.slice(secIdx);
      const seenAdrIds = new Set(driftPivots.map((d) => d.id));
      for (const line of section.split('\n')) {
        const m = line.match(/^\|\s*`?(ADR-\d+)`?\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/);
        if (m) {
          const id = m[1].trim();
          if (seenAdrIds.has(id)) continue;
          seenAdrIds.add(id);
          const title = m[2].trim();
          const scope = m[3].trim().replace(/`/g, '');
          const ticketId = parseTicketId(m[4].trim());
          const supRaw = m[5].trim();
          const supersedes = supRaw && supRaw !== 'None' && supRaw !== '-' ? supRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
          driftPivots.push({
            id,
            title,
            scope,
            status: 'compacted',
            ticketId,
            supersedes,
            file: 'docs/SRS.md'
          });
        }
      }
    }
  }

  // 3. Hydrate from .agent/decision-graph.jsonl
  const graphPath = path.resolve(repoRoot, DECISION_GRAPH_FILE);
  if (fileExists(graphPath)) {
    const lines = (readFileSafe(graphPath) || '').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const evt = JSON.parse(line);
        timeline.push(evt);
        ensureNode(evt.id, {
          label: evt.label || evt.id,
          category: evt.category || (evt.id.startsWith('ARCH-') ? 'ARCH' : 'GENERIC'),
          status: evt.status || 'active',
          ticketId: evt.ticketId,
          timestamp: evt.timestamp,
          metadata: evt.metadata || {}
        });

        for (const target of evt.linksTo || []) {
          if (evt.type === 'CAPABILITY_SPEC_SCAFFOLDED' || evt.type === 'CAPABILITY_REGISTERED') {
            addEdge(evt.id, target, 'depends_on');
          } else if (evt.type === 'ADR_CREATED' || evt.type === 'ADR_DECIDED') {
            const strTarget = String(target);
            const normTarget = normalizeTicketId(strTarget);
            const normEvtTicket = normalizeTicketId(evt.ticketId);
            if (
              strTarget.startsWith('#') ||
              (normEvtTicket && normTarget === normEvtTicket) ||
              /^(L-\d+|[A-Z]+-\d+|\d+)$/i.test(strTarget)
            ) {
              continue;
            }
            addEdge(target, evt.id, 'amended_by_adr');
          } else {
            addEdge(target, evt.id, 'realized_by');
          }
        }
      } catch {}
    }
  }

  // 4. Hydrate from .agent/arch-trace.jsonl for Architecture Time-Machine
  const archTracePath = path.resolve(repoRoot, '.agent/arch-trace.jsonl');
  const archSnapshots = [];
  if (fileExists(archTracePath)) {
    const lines = (readFileSafe(archTracePath) || '').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        archSnapshots.push(entry);
        if (entry.ticket && entry.ticket !== '#N/A') {
          ensureNode(entry.ticket, {
            label: `Ticket ${entry.ticket} (${entry.branch})`,
            category: 'TICKET',
            status: entry.status
          });
        }
      } catch {}
    }
  }

  const nodes = Array.from(nodesMap.values());
  return {
    nodes,
    edges,
    driftPivots,
    timeline,
    archSnapshots,
    stats: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      capabilitiesCount: nodes.filter((n) => n.category === 'CAPABILITY').length,
      adrsCount: driftPivots.length,
      pendingAdrsCount: driftPivots.filter((a) => a.status === 'pending_approval').length
    }
  };
}

export function syncDecisionMapMarkdown(repoRoot = '.') {
  const graph = buildDecisionGraph(repoRoot);
  const mapPath = path.resolve(repoRoot, DECISION_MAP_MD);

  const sanitizeId = (id) => String(id).replace(/[^a-zA-Z0-9_]/g, '_');
  const mermaidLines = ['flowchart TD'];

  for (const node of graph.nodes) {
    const safeId = sanitizeId(node.id);
    const cleanLabel = String(node.label || node.id).replace(/"/g, "'");
    mermaidLines.push(`  ${safeId}["${cleanLabel}"]`);
  }

  for (const edge of graph.edges) {
    const fromId = sanitizeId(edge.from);
    const toId = sanitizeId(edge.to);
    const arrow = edge.relation === 'amended_by_adr' ? '-.->|ADR Drift|' : `-->|${edge.relation}|`;
    mermaidLines.push(`  ${fromId} ${arrow} ${toId}`);
  }

  const escPipe = (s) => String(s || '').replace(/\|/g, '/');
  const adrRows =
    graph.driftPivots.length > 0
      ? graph.driftPivots
          .map((a) => {
            const tRef = a.ticketId === null || a.ticketId === undefined ? 'N/A' : typeof a.ticketId === 'number' ? `#${a.ticketId}` : String(a.ticketId);
            return `| **${a.id}** | ${escPipe(a.title)} | \`${a.scope}\` | \`${a.status}\` | ${tRef} | ${(a.supersedes || []).join(', ') || 'None'} |`;
          })
          .join('\n')
      : '| *None* | No architectural drift ADRs recorded yet | - | - | - | - |';

  const capNodes = graph.nodes.filter((n) => n.category === 'CAPABILITY');
  const capRows =
    capNodes.length > 0
      ? capNodes.map((c) => `| **${c.id}** | ${escPipe(c.label.replace(/^CAP-\d+:\s*/, ''))} | \`${c.status}\` |`).join('\n')
      : '| *None* | Run `sdlc-engine product init` to initialize `PRODUCT.md` | - |';

  const markdown = `# 🗺️ Causal Decision Graph & Architecture Lineage (\`DECISION_MAP.md\`)

> **Auto-Generated by Agentic SDLC Engine**: Tracks how product capabilities (\`PRODUCT.md\`), specifications, tickets, and Spec-Drift ADRs evolved into the current system state.

---

## 🧬 Causal Decision Lineage Graph

\`\`\`mermaid
${mermaidLines.join('\n')}
\`\`\`

---

## ⚡ Spec Drift & ADR Pivot Ledger

| ADR ID | Decision Title | Scope | Status | Triggered By | Supersedes / Amends |
| :--- | :--- | :--- | :--- | :--- | :--- |
${adrRows}

---

## 🎯 Product Capability Realization Matrix

| Capability ID | Description | Current Status |
| :--- | :--- | :--- |
${capRows}
`;

  writeFileAtomic(mapPath, markdown);

  return {
    success: true,
    path: mapPath,
    relativePath: DECISION_MAP_MD,
    graph
  };
}
