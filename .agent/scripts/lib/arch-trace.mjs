import fs from 'node:fs';
import path from 'node:path';
import {
  fileExists,
  readFileSafe,
  inspectArchlens,
  getModifiedFiles,
  gitOutput,
  getUnifiedDiffByFile,
  resolveDefaultBaseBranch,
  resolveInsideRepo,
  parseTicketId,
  readSessionStatus
} from './core.mjs';

const DEFAULT_OMIT_DIRS = new Set([
  'node_modules',
  '.git',
  '.stryker-tmp',
  'coverage',
  'reports',
  'dist',
  'build',
  'target',
  'tests',
  '__tests__'
]);

const SOURCE_FILE_EXT_RE = /\.(mjs|cjs|js|jsx|ts|tsx|java)$/i;
const TEST_FILE_NAME_RE = /\.(test|spec)\.[cm]?[jt]sx?$/i;

function parsePolicyConfiguration(repoRoot) {
  const policyPath = path.resolve(repoRoot, '.archlens/policy.json');
  let rawPolicy = {};
  let policyLayers = [];
  if (fileExists(policyPath)) {
    try {
      rawPolicy = JSON.parse(readFileSafe(policyPath) || '{}');
      if (Array.isArray(rawPolicy.layers)) {
        policyLayers = rawPolicy.layers.map((l, idx) => ({
          name: l.name || `Layer-${idx}`,
          index: idx,
          paths: (l.paths || [l.name]).filter(Boolean).map((p) => String(p).toLowerCase()),
          allowedDependencies: Array.isArray(l.allowedDependencies)
            ? l.allowedDependencies.map((d) => String(d).toLowerCase())
            : null
        }));
      } else if (Array.isArray(rawPolicy.order)) {
        const levelsRaw = rawPolicy.levels;
        policyLayers = rawPolicy.order.map((layerName, idx) => {
          const levelEntry = Array.isArray(levelsRaw)
            ? levelsRaw[idx]
            : levelsRaw && typeof levelsRaw === 'object'
              ? levelsRaw[layerName]
              : null;
          const rawPaths = Array.isArray(levelEntry)
            ? levelEntry
            : Array.isArray(levelEntry?.paths)
              ? levelEntry.paths
              : [layerName];
          return {
            name: String(layerName),
            index: idx,
            paths: rawPaths.filter(Boolean).map((p) => String(p).toLowerCase()),
            allowedDependencies: rawPolicy.order.slice(0, idx).map((d) => String(d).toLowerCase())
          };
        });
      }
    } catch {}
  }
  const omitDirs = new Set(DEFAULT_OMIT_DIRS);
  if (Array.isArray(rawPolicy.omit)) {
    for (const dir of rawPolicy.omit) {
      if (dir) omitDirs.add(String(dir).replace(/^\/+|\/+$/g, '').toLowerCase());
    }
  }
  return { rawPolicy, policyLayers, omitDirs };
}

function stripSourceComments(code, { stripTemplates = false } = {}) {
  const pattern = stripTemplates
    ? /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g
    : /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
  return String(code || '').replace(pattern, (token) => {
    if (token.startsWith('/*') || token.startsWith('//')) return ' ';
    if (stripTemplates && token.startsWith('`')) return '``';
    return token;
  });
}

function extractImportSpecifiers(code, options = {}) {
  const cleaned = stripSourceComments(code, options);
  const found = [];
  const patterns = [
    /(?:^|[;\n}])\s*(?:import|export)\s+(?:type\s+)?(?:[*\w${}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /(?:^|[;\n}])\s*import\s+(?:static\s+)?([a-zA-Z_][a-zA-Z0-9_.]*)\s*;/g
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(cleaned)) !== null) {
      const imported = m[1];
      if (!imported) continue;
      found.push({
        imported,
        line: m[0].trim().replace(/\s+/g, ' ')
      });
    }
  }
  return found;
}

function collectPolicySourceFiles(repoRoot, rawPolicy, policyLayers, omitDirs) {
  const absRoot = path.resolve(repoRoot);
  const collected = new Set();

  const walk = (absTarget) => {
    if (!fs.existsSync(absTarget)) return;
    let stat;
    try {
      stat = fs.statSync(absTarget);
    } catch {
      return;
    }
    const rel = path.relative(absRoot, absTarget).replace(/\\/g, '/');
    if (stat.isFile()) {
      if (SOURCE_FILE_EXT_RE.test(rel) && !TEST_FILE_NAME_RE.test(path.basename(rel))) {
        collected.add(rel);
      }
      return;
    }
    if (!stat.isDirectory()) return;
    if (rel) {
      const baseLower = path.basename(rel).toLowerCase();
      if (omitDirs.has(baseLower)) return;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(absTarget, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.agent') continue;
      if (entry.isDirectory() && omitDirs.has(entry.name.toLowerCase())) continue;
      walk(path.join(absTarget, entry.name));
    }
  };

  const scanRoots = new Set();
  if (rawPolicy?.src && String(rawPolicy.src).trim() !== '.' && String(rawPolicy.src).trim() !== '') {
    const srcCandidate = resolveInsideRepo(repoRoot, String(rawPolicy.src));
    if (fs.existsSync(srcCandidate)) scanRoots.add(srcCandidate);
  }
  for (const layer of policyLayers) {
    for (const rawPath of layer.paths) {
      const p = String(rawPath || '').replace(/^\/+|\/+$/g, '');
      if (!p) continue;
      try {
        const resolved = resolveInsideRepo(repoRoot, p);
        if (fs.existsSync(resolved)) scanRoots.add(resolved);
      } catch {}
    }
  }

  for (const r of scanRoots) walk(r);
  return Array.from(collected).sort();
}

function resolveGraphImportTarget(fromRel, spec, knownFilesSet) {
  if (!spec) return null;
  let candidateBase = null;
  if (spec.startsWith('.')) {
    const fromDir = path.posix.dirname(fromRel);
    candidateBase = path.posix.normalize(path.posix.join(fromDir, spec));
  } else if (knownFilesSet.has(spec)) {
    return spec;
  } else {
    candidateBase = String(spec).replace(/^\/+/, '');
  }
  const exts = ['', '.mjs', '.cjs', '.js', '.jsx', '.ts', '.tsx', '/index.mjs', '/index.js', '/index.ts'];
  for (const ext of exts) {
    const probe = `${candidateBase}${ext}`;
    if (knownFilesSet.has(probe)) return probe;
  }
  return null;
}

function detectDependencyCycles(repoRoot, rawPolicy, policyLayers, omitDirs) {
  const files = collectPolicySourceFiles(repoRoot, rawPolicy, policyLayers, omitDirs);
  if (files.length === 0) return [];
  const knownFilesSet = new Set(files);
  const absRoot = path.resolve(repoRoot);
  const graph = new Map();

  for (const rel of files) {
    const absPath = path.join(absRoot, rel);
    const raw = readFileSafe(absPath) || '';
    const imports = extractImportSpecifiers(raw, { stripTemplates: true });
    const targets = new Set();
    for (const { imported } of imports) {
      const resolved = resolveGraphImportTarget(rel, imported, knownFilesSet);
      if (resolved) targets.add(resolved);
    }
    graph.set(rel, Array.from(targets).sort());
  }

  // Tarjan strongly connected components to isolate every cyclic cluster in O(V + E)
  let indexCounter = 0;
  const indices = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];

  const strongConnect = (v) => {
    indices.set(v, indexCounter);
    lowlink.set(v, indexCounter);
    indexCounter++;
    stack.push(v);
    onStack.add(v);

    for (const w of graph.get(v) || []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v), indices.get(w)));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      sccs.push(comp);
    }
  };

  for (const node of files) {
    if (!indices.has(node)) strongConnect(node);
  }

  const cycles = [];
  for (const comp of sccs) {
    if (comp.length === 1) {
      const single = comp[0];
      if ((graph.get(single) || []).includes(single)) {
        cycles.push([single, single]);
      }
      continue;
    }
    const compSet = new Set(comp);
    const start = comp.slice().sort()[0];
    // BFS within the SCC from start back to start to surface a concrete shortest cycle trace
    const queue = [[start]];
    const seen = new Set();
    let foundPath = null;
    while (queue.length > 0 && !foundPath) {
      const currPath = queue.shift();
      const tail = currPath[currPath.length - 1];
      for (const nxt of graph.get(tail) || []) {
        if (!compSet.has(nxt)) continue;
        if (nxt === start) {
          foundPath = [...currPath, start];
          break;
        }
        if (!seen.has(nxt)) {
          seen.add(nxt);
          queue.push([...currPath, nxt]);
        }
      }
    }
    cycles.push(foundPath || [...comp.slice().sort(), start]);
  }
  return cycles;
}

export function checkArchDiff(repoRoot = '.') {
  console.log('🏛️ Auditing Git Diff for Architectural Ring Layer Inversions...');
  const archInfo = inspectArchlens(repoRoot);
  const baseRef = resolveDefaultBaseBranch(repoRoot);
  const diffFiles = getModifiedFiles(baseRef, repoRoot);

  if (!archInfo.installed) {
    return {
      enabled: false,
      passed: true,
      violationsCount: 0,
      cyclesCount: 0,
      cycles: [],
      message: 'Archlens policy not installed (.archlens/policy.json missing).',
      violations: []
    };
  }

  const { rawPolicy, policyLayers, omitDirs } = parsePolicyConfiguration(repoRoot);

  const workspaceRoots = new Set(
    policyLayers
      .flatMap((l) => l.paths)
      .map((p) => String(p || '').replace(/^\/+/, '').split('/')[0].toLowerCase())
      .filter(Boolean)
  );

  const matchPolicyLayer = (targetStr, fromFile = null) => {
    let normalized = String(targetStr || '').replace(/\\/g, '/');
    const isDottedPkg = fromFile !== null && /^[a-z0-9_]+(\.[a-z0-9_]+)+$/i.test(normalized) && !normalized.includes('/');
    if (fromFile && normalized.startsWith('.')) {
      const fromDir = path.posix.dirname(String(fromFile).replace(/\\/g, '/'));
      normalized = path.posix.normalize(path.posix.join(fromDir, normalized));
    } else if (fromFile && !normalized.startsWith('/') && !isDottedPkg) {
      const firstSeg = normalized.toLowerCase().split('/')[0];
      if (!workspaceRoots.has(firstSeg)) return null;
    }
    const lower = normalized.toLowerCase();
    const dotSegs = isDottedPkg ? new Set(lower.split('.')) : null;
    for (const layer of policyLayers) {
      if (
        layer.paths.some((raw) => {
          const p = String(raw || '').toLowerCase().replace(/^\/+|\/+$/g, '');
          if (!p) return false;
          if (dotSegs) {
            return lower === p || lower.startsWith(`${p}.`) || dotSegs.has(p);
          }
          return (
            lower === p ||
            lower.startsWith(`${p}/`) ||
            lower.endsWith(`/${p}`) ||
            lower.includes(`/${p}/`)
          );
        })
      ) {
        return layer;
      }
    }
    return null;
  };

  const violations = [];
  const diffsByFile = getUnifiedDiffByFile(baseRef, repoRoot, diffFiles);

  for (const file of diffFiles) {
    try {
      const diffOutput = diffsByFile.get(file) || '';
      if (!diffOutput) continue;

      const sourceLayer = matchPolicyLayer(file);
      const addedCode = diffOutput
        .split('\n')
        .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
        .map((line) => line.slice(1))
        .join('\n');
      if (!addedCode.trim()) continue;

      const extracted = extractImportSpecifiers(addedCode, { stripTemplates: true });
      for (const { imported: importedPath, line: lineText } of extracted) {
        const targetLayer = matchPolicyLayer(importedPath, file);

        let policyViolated = false;
        if (sourceLayer && targetLayer && sourceLayer.name.toLowerCase() !== targetLayer.name.toLowerCase()) {
          if (Array.isArray(sourceLayer.allowedDependencies)) {
            policyViolated = !sourceLayer.allowedDependencies.includes(targetLayer.name.toLowerCase());
          } else {
            policyViolated = targetLayer.index > sourceLayer.index;
          }
        }

        const isDomainFile =
          file.toLowerCase().includes('domain') ||
          file.toLowerCase().includes('entity') ||
          file.toLowerCase().includes('entities');
        const importsOuter =
          importedPath.toLowerCase().includes('controller') ||
          importedPath.toLowerCase().includes('resource') ||
          importedPath.toLowerCase().includes('infra') ||
          importedPath.toLowerCase().includes('database') ||
          importedPath.toLowerCase().includes('web');

        if (policyViolated) {
          violations.push({
            type: 'LAYER_INVERSION',
            file,
            line: lineText,
            imported: importedPath,
            sourceLayer: sourceLayer.name,
            targetLayer: targetLayer.name,
            rule: `Concentric Layer Inversion (${sourceLayer.name} -> ${targetLayer.name}): Inner ring '${sourceLayer.name}' cannot import '${targetLayer.name}' per .archlens/policy.json`
          });
        } else if (policyLayers.length === 0 && isDomainFile && importsOuter) {
          violations.push({
            type: 'LAYER_INVERSION',
            file,
            line: lineText,
            imported: importedPath,
            rule: 'Concentric Layer Inversion: Core Domain entity directly importing outer ring layer'
          });
        }
      }
    } catch {}
  }

  const cycles = detectDependencyCycles(repoRoot, rawPolicy, policyLayers, omitDirs);
  for (const cycle of cycles) {
    violations.push({
      type: 'CYCLE',
      file: cycle[0],
      imported: cycle[1] || cycle[0],
      cycle,
      rule: `Circular dependency cycle: ${cycle.join(' -> ')}`
    });
  }

  const passed = violations.length === 0;
  if (passed) {
    console.log('✅ Archlens Diff Check: Zero architectural layer inversions or dependency cycles.');
  } else {
    console.warn(`⚠️ Archlens Diff Check: ${violations.length} architectural violation(s) (${cycles.length} cycle(s)) detected!`);
    for (const v of violations) {
      console.warn(`   • [${v.file}] ${v.rule} -> "${v.imported}"`);
    }
  }

  return {
    enabled: true,
    passed,
    violationsCount: violations.length,
    cyclesCount: cycles.length,
    cycles,
    violations
  };
}

export function parseMermaidDiagram(content) {
  if (!content || typeof content !== 'string') return { nodes: [], edges: [], subgraphs: [] };

  const nodes = new Map();
  const edges = [];
  const subgraphs = [];

  const lines = content.split('\n');
  let currentSubgraph = null;

  const parseNodeToken = (rawToken) => {
    const token = String(rawToken || '').trim().replace(/;$/, '');
    const m = token.match(
      /^([A-Za-z0-9_\-\.]+)\s*(?:\(\["?([^"\]]+)"?\]\)|\[\("?([^")]+)"?\)\]|\[\["?([^"\]]+)"?\]\]|\{\{"?([^"}]+)"?\}\}|\["?([^"\]]+)"?\]|\("?([^")]+)"?\)|\{"?([^"}]+)"?\})?/
    );
    if (!m) return null;
    const id = m[1];
    const label = (m[2] || m[3] || m[4] || m[5] || m[6] || m[7] || m[8] || id).trim();
    return { id, label };
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('%%') || line.startsWith('flowchart') || line.startsWith('graph')) {
      continue;
    }

    const subMatch = line.match(/^subgraph\s+([A-Za-z0-9_]+)(\s*\["?([^"\]]+)"?\])?/i);
    if (subMatch) {
      currentSubgraph = { id: subMatch[1], label: subMatch[3] || subMatch[1] };
      subgraphs.push(currentSubgraph);
      continue;
    }
    if (line === 'end') {
      currentSubgraph = null;
      continue;
    }

    if (/-->|-.->|==>/.test(line)) {
      const parts = line.split(/\s*(-->|-.->|==>)(?:\|([^|]+)\|)?\s*/);
      let prevNode = parseNodeToken(parts[0]);
      if (prevNode && !nodes.has(prevNode.id)) {
        nodes.set(prevNode.id, { id: prevNode.id, label: prevNode.label, subgraph: currentSubgraph?.id || null });
      }
      for (let i = 1; i + 2 < parts.length; i += 3) {
        const arrow = parts[i];
        const edgeLabel = parts[i + 1] ? parts[i + 1].trim() : '';
        const nextNode = parseNodeToken(parts[i + 2]);
        if (prevNode && nextNode) {
          if (!nodes.has(nextNode.id)) {
            nodes.set(nextNode.id, { id: nextNode.id, label: nextNode.label, subgraph: currentSubgraph?.id || null });
          }
          edges.push({
            from: prevNode.id,
            to: nextNode.id,
            type: arrow,
            label: edgeLabel
          });
          prevNode = nextNode;
        }
      }
      continue;
    }

    const single = parseNodeToken(line);
    if (single && !nodes.has(single.id) && (line.includes('[') || line.includes('(') || line.includes('{'))) {
      nodes.set(single.id, { id: single.id, label: single.label, subgraph: currentSubgraph?.id || null });
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    edges,
    subgraphs
  };
}

export function diffMermaidGraphs(oldGraph, newGraph) {
  const oldNodeIds = new Set(oldGraph.nodes.map((n) => n.id));
  const newNodeIds = new Set(newGraph.nodes.map((n) => n.id));

  const addedNodes = newGraph.nodes.filter((n) => !oldNodeIds.has(n.id));
  const removedNodes = oldGraph.nodes.filter((n) => !newNodeIds.has(n.id));

  const edgeKey = (e) => `${e.from}->${e.to}${e.label ? `[${e.label}]` : ''}`;
  const oldEdgeKeys = new Set(oldGraph.edges.map(edgeKey));
  const newEdgeKeys = new Set(newGraph.edges.map(edgeKey));

  const addedEdges = newGraph.edges.filter((e) => !oldEdgeKeys.has(edgeKey(e)));
  const removedEdges = oldGraph.edges.filter((e) => !newEdgeKeys.has(edgeKey(e)));

  return {
    hasChanges:
      addedNodes.length > 0 || removedNodes.length > 0 || addedEdges.length > 0 || removedEdges.length > 0,
    addedNodes,
    removedNodes,
    addedEdges,
    removedEdges
  };
}

export function recordArchTrace({
  reason = 'Architectural refinement',
  ticket = null,
  diagramPath = null,
  repoRoot = '.'
} = {}) {
  const current = readSessionStatus(repoRoot);
  const activeSess = current.session;
  const issueId = ticket || activeSess?.issueId || 'N/A';
  let branch = activeSess?.branch;
  if (!branch) {
    branch = (gitOutput(['branch', '--show-current'], repoRoot) || '').trim() || 'develop';
  }

  if (branch === 'develop' || branch === 'main') {
    console.warn(`⚠️ Warning: Recording architectural changes on protected branch '${branch}'!`);
  }

  const commitSha = (gitOutput(['rev-parse', '--short', 'HEAD'], repoRoot) || '').trim() || 'UNCOMMITTED';

  const extractMermaidFromContent = (diagFile, text) => {
    if (!text || typeof text !== 'string') return { nodes: [], edges: [], subgraphs: [] };
    const isMarkdown = diagFile.endsWith('.md') || diagFile.endsWith('.markdown');
    if (!isMarkdown) return parseMermaidDiagram(text);
    const fencedRe = /```mermaid\s*\r?\n([\s\S]*?)```/g;
    const mergedNodes = new Map();
    const mergedEdges = [];
    const mergedSubgraphs = [];
    let match;
    while ((match = fencedRe.exec(text)) !== null) {
      const g = parseMermaidDiagram(match[1]);
      for (const n of g.nodes) mergedNodes.set(n.id, n);
      mergedEdges.push(...g.edges);
      mergedSubgraphs.push(...g.subgraphs);
    }
    return { nodes: Array.from(mergedNodes.values()), edges: mergedEdges, subgraphs: mergedSubgraphs };
  };

  const candidateDiagrams = diagramPath
    ? [resolveInsideRepo(repoRoot, diagramPath)].filter((f) => fs.existsSync(f))
    : [
        path.resolve(repoRoot, 'docs/architecture/system.mmd'),
        path.resolve(repoRoot, 'docs/specs/architecture.mmd'),
        path.resolve(repoRoot, 'wiki/Architecture.md'),
        path.resolve(repoRoot, 'wiki/Codebase-Map.md'),
        path.resolve(repoRoot, '.agent/skills/sdlc-flow/SKILL.md'),
        path.resolve(repoRoot, 'README.md')
      ].filter((f) => fs.existsSync(f));

  const timestamp = new Date().toISOString();
  const traceEntries = [];

  for (const diag of candidateDiagrams) {
    const relDiagPath = path.relative(path.resolve(repoRoot), diag);
    const content = fs.readFileSync(diag, 'utf8');

    let prevContent = '';
    try {
      prevContent = gitOutput(['show', `HEAD~1:${relDiagPath}`], repoRoot) || '';
    } catch {
      prevContent = '';
    }

    const currentGraph = extractMermaidFromContent(diag, content);
    const prevGraph = extractMermaidFromContent(diag, prevContent);
    const diff = diffMermaidGraphs(prevGraph, currentGraph);

    if (diff.hasChanges || !prevContent) {
      traceEntries.push({
        diagram: relDiagPath,
        diff,
        summary: `Nodes: +${diff.addedNodes.length}/-${diff.removedNodes.length}, Edges: +${diff.addedEdges.length}/-${diff.removedEdges.length}`
      });
    }
  }

  const modifiedFiles = getModifiedFiles(null, repoRoot);
  const archDiff = checkArchDiff(repoRoot);
  const normalizedTicket = parseTicketId(issueId);
  const ticketLabel =
    normalizedTicket === null
      ? 'N/A'
      : typeof normalizedTicket === 'number'
        ? `#${normalizedTicket}`
        : String(normalizedTicket);

  const entry = {
    id: `trace-${Date.now()}`,
    timestamp,
    ticket: ticketLabel,
    branch,
    commitSha,
    reason,
    diagramChanges: traceEntries,
    modifiedFiles,
    archlensViolations: archDiff.violationsCount,
    status: archDiff.passed ? 'PASSED' : 'VIOLATION'
  };

  const jsonlDir = path.resolve(repoRoot, '.agent');
  fs.mkdirSync(jsonlDir, { recursive: true });
  const jsonlPath = path.resolve(jsonlDir, 'arch-trace.jsonl');
  fs.appendFileSync(jsonlPath, JSON.stringify(entry) + '\n', 'utf8');

  const docsDir = path.resolve(repoRoot, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const traceMdPath = path.resolve(docsDir, 'ARCH_TRACE.md');

  if (!fs.existsSync(traceMdPath)) {
    const header = `# 🏛️ Architectural Traceability & Mutation Ledger

This document maintains an immutable audit log of all architectural transformations, Mermaid component evolutions, and Clean Architecture layer boundary shifts.

> **Hard Framework Invariant**: Direct pushes to \`develop\` or \`main\` are forbidden. All architectural modifications must occur on isolated branches (\`feature/*\` or \`arch/*\`) and be recorded here before Pull Request merge.

| Timestamp | Ticket | Branch | Commit | Reason | Diagrams / Components Changed | Archlens Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
    fs.writeFileSync(traceMdPath, header, 'utf8');
  }

  const diagSummary =
    traceEntries.length > 0
      ? traceEntries.map((t) => `\`${t.diagram}\` (${t.summary})`).join('<br/>')
      : `Files modified (${modifiedFiles.length})`;

  const statusBadge = entry.status === 'PASSED' ? '✅ PASSED' : `⚠️ ${entry.archlensViolations} VIOLATIONS`;
  const mdRow = `| ${entry.timestamp.split('T')[0]} ${entry.timestamp.split('T')[1].slice(0, 5)} | \`${entry.ticket}\` | \`${entry.branch}\` | \`${entry.commitSha}\` | ${reason.replace(/\|/g, '/')} | ${diagSummary} | ${statusBadge} |\n`;

  fs.appendFileSync(traceMdPath, mdRow, 'utf8');
  console.log(`📝 Appended architectural trace entry to ${traceMdPath} and ${jsonlPath}`);

  return {
    success: true,
    entry,
    markdownPath: traceMdPath,
    jsonlPath
  };
}

export function scaffoldArchlensPolicy(repoRoot = '.') {
  console.log('🏛️ Auto-Scaffolding Native Archlens Clean Architecture Policy...');
  const archDir = path.resolve(repoRoot, '.archlens');
  fs.mkdirSync(archDir, { recursive: true });

  const policyPath = path.resolve(archDir, 'policy.json');
  if (fileExists(policyPath)) {
    console.log(`ℹ️ Archlens policy already exists at ${policyPath}`);
    return { success: true, created: false, path: policyPath };
  }

  const order = ['Domain', 'Application', 'Infrastructure', 'Web'];
  const levels = [
    ['src/domain', 'domain', 'lib/domain', 'core/domain', 'entities'],
    ['src/application', 'application', 'usecases', 'services'],
    ['src/infrastructure', 'infrastructure', 'db', 'persistence', 'adapters'],
    ['src/web', 'web', 'controllers', 'routes', 'ui', 'frontend']
  ];

  const resolvedRoot = path.resolve(repoRoot);
  const srcRoot = fileExists(path.resolve(resolvedRoot, 'src')) ? 'src' : '.';
  const lang = fileExists(path.resolve(resolvedRoot, 'tsconfig.json'))
    ? 'typescript'
    : fileExists(path.resolve(resolvedRoot, 'pom.xml')) || fileExists(path.resolve(resolvedRoot, 'build.gradle'))
      ? 'java'
      : 'javascript';

  const policy = {
    title: path.basename(resolvedRoot) || 'archlens-project',
    src: srcRoot,
    prefix: '',
    hierarchical: true,
    order,
    levels,
    foreign: ['node:', '@types/'],
    omit: ['target', 'build', '.git', 'node_modules', 'coverage', 'reports', '.stryker-tmp'],
    lang
  };

  fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2) + '\n', 'utf8');
  console.log(`✅ Archlens Clean Architecture policy scaffolded at ${policyPath}`);

  return {
    success: true,
    created: true,
    path: policyPath,
    layersCount: order.length
  };
}
