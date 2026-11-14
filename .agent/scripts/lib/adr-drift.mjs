import fs from 'node:fs';
import path from 'node:path';
import {
  fileExists,
  readFileSafe,
  getModifiedFiles,
  gitOutput,
  gitDiffForFile,
  resolveDefaultBaseBranch,
  normalizeTicketId,
  parseTicketId,
  writeFileAtomic
} from './core.mjs';
import {
  DECISION_GRAPH_FILE,
  appendDecisionEvent,
  listADRs,
  syncDecisionMapMarkdown
} from './decision-graph.mjs';
import { appendAuditRecord } from './audit-chain.mjs';

export { listADRs };

function formatTicketRef(val) {
  const norm = parseTicketId(val);
  if (norm === null) return 'N/A';
  return typeof norm === 'number' ? `#${norm}` : String(norm);
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function patchProductMdWithADR(repoRoot, adr) {
  const productPath = path.resolve(repoRoot, 'PRODUCT.md');
  if (!fileExists(productPath)) return false;

  let content = readFileSafe(productPath) || '';
  const safeTitle = String(adr.title || '').replace(/\|/g, '/');
  const row = `| ${adr.id} | ${safeTitle} | \`${adr.scope}\` | \`${adr.status}\` | ${formatTicketRef(adr.ticketId)} | ${(adr.supersedes || []).join(', ') || 'None'} |`;

  // Update existing row if ADR ID already listed
  const rowRegex = new RegExp(`^\\|\\s*${escapeRegex(adr.id)}\\s*\\|.*$`, 'm');
  if (rowRegex.test(content)) {
    content = content.replace(rowRegex, () => row);
  } else if (content.includes('<!-- ADR_INDEX_END -->')) {
    content = content.replace('<!-- ADR_INDEX_END -->', () => `${row}\n<!-- ADR_INDEX_END -->`);
  } else {
    content += `\n${row}\n`;
  }

  // If ADR is accepted and supersedes any CAP-XX, annotate the capability status in PRODUCT.md
  if (adr.status === 'accepted' && Array.isArray(adr.supersedes)) {
    for (const supId of adr.supersedes) {
      if (supId.startsWith('CAP-')) {
        const capRegex = new RegExp(`^(\\|\\s*${escapeRegex(supId)}\\s*\\|[^|]+\\|[^|]+\\|[^|]+\\|)\\s*([^|]+)\\|`, 'm');
        if (capRegex.test(content)) {
          content = content.replace(capRegex, (_, prefix) => `${prefix} \`AMENDED (${adr.id})\` |`);
        }
      }
    }
  }

  writeFileAtomic(productPath, content);
  return true;
}

function getMaxExistingAdrNumber(repoRoot, existingAdrs = []) {
  let maxNum = 0;
  for (const adr of existingAdrs) {
    const m = String(adr.id || '').match(/^ADR-(\d+)$/i);
    if (m) maxNum = Math.max(maxNum, Number(m[1]));
  }
  const srsPath = path.resolve(repoRoot, 'docs/SRS.md');
  if (fileExists(srsPath)) {
    const srsRaw = readFileSafe(srsPath) || '';
    const rowRegex = /^\|\s*`?ADR-(\d+)`?\s*\|/gm;
    let rm;
    while ((rm = rowRegex.exec(srsRaw)) !== null) {
      maxNum = Math.max(maxNum, Number(rm[1]));
    }
  }
  return maxNum;
}

export function createADR({
  title,
  scope = 'technical',
  ticketId = null,
  supersedes = [],
  context = 'Implementation revealed new technical or product constraints.',
  decision = 'Updated architectural approach.',
  consequences = 'Downstream specs and tickets updated accordingly.',
  autoAccept = false,
  repoRoot = '.'
} = {}) {
  const adrDir = path.resolve(repoRoot, 'docs/adr');
  fs.mkdirSync(adrDir, { recursive: true });

  const existing = listADRs(repoRoot);
  let nextNum = getMaxExistingAdrNumber(repoRoot, existing) + 1;
  const slug = String(title || 'decision')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

  const normScope = String(scope).toLowerCase() === 'product' || String(scope).toLowerCase() === 'contract' ? 'product' : 'technical';
  const shouldAccept = Boolean(autoAccept);
  const status = shouldAccept ? 'accepted' : 'pending_approval';
  const normTicket = parseTicketId(ticketId);
  const ticketRef = formatTicketRef(normTicket);
  const createdAt = new Date().toISOString();
  const supList = Array.isArray(supersedes) ? supersedes : String(supersedes || '').split(',').map((s) => s.trim()).filter(Boolean);

  let adrId = '';
  let fileName = '';
  let filePath = '';
  let relativePath = '';

  for (let attempt = 0; attempt < 20; attempt++) {
    adrId = `ADR-${String(nextNum).padStart(3, '0')}`;
    fileName = `${adrId}-${slug}.md`;
    filePath = path.join(adrDir, fileName);
    relativePath = `docs/adr/${fileName}`;

    const markdown = `---
id: ${adrId}
title: ${title}
status: ${status}
scope: ${normScope}
ticket: ${ticketRef}
supersedes: ${supList.join(', ')}
createdAt: ${createdAt}
---

# ${adrId}: ${title}

- **Status**: \`${status}\`
- **Blast Radius / Scope**: \`${normScope}\`
- **Triggered By Ticket**: ${ticketRef}
- **Supersedes / Amends**: ${supList.join(', ') || 'None'}

## 1. Context & Spec Drift Trigger
${context}

## 2. Decision
${decision}

## 3. Consequences & Downstream Impact
${consequences}
`;
    try {
      fs.writeFileSync(filePath, markdown, { encoding: 'utf8', flag: 'wx' });
      break;
    } catch (err) {
      if (err && err.code === 'EEXIST' && attempt < 19) {
        nextNum++;
        continue;
      }
      throw err;
    }
  }

  const adrObj = {
    id: adrId,
    title,
    status,
    scope: normScope,
    ticketId: normTicket,
    supersedes: supList,
    createdAt,
    file: relativePath
  };

  patchProductMdWithADR(repoRoot, adrObj);

  appendDecisionEvent({
    type: 'ADR_CREATED',
    id: adrId,
    label: `${adrId}: ${title}`,
    category: 'ADR',
    status,
    ticketId: normTicket,
    linksTo: [...supList, ...(normTicket !== null ? [ticketRef] : [])],
    metadata: { scope: normScope, file: relativePath, decision },
    repoRoot
  });

  appendAuditRecord({
    event: 'ADR_MINTED',
    metadata: adrObj,
    repoRoot
  });

  syncDecisionMapMarkdown(repoRoot);

  return {
    success: true,
    adr: adrObj,
    filePath,
    relativePath
  };
}

export function decideADR({
  adrId,
  action = 'approve',
  reviewer = '@human-operator',
  reason = 'Reviewed via SDLC Governance Gate',
  repoRoot = '.'
} = {}) {
  const all = listADRs(repoRoot);
  const target = all.find((a) => a.id.toLowerCase() === String(adrId).toLowerCase());
  if (!target) {
    throw new Error(`ADR '${adrId}' not found in docs/adr/.`);
  }

  const normAction = String(action || '').trim().toLowerCase();
  let newStatus;
  if (/^(approve|approved|accept|accepted)$/.test(normAction)) {
    newStatus = 'accepted';
  } else if (/^(reject|rejected)$/.test(normAction)) {
    newStatus = 'rejected';
  } else {
    throw new Error(`Invalid ADR decision action '${action}'. Expected 'approve'/'accept' or 'reject'.`);
  }

  let updatedContent = target.content
    .replace(/^status:\s*.+$/m, `status: ${newStatus}`)
    .replace(/^- \*\*Status\*\*:\s*`.+`$/m, `- **Status**: \`${newStatus}\``)
    .replace(/\n## 4\. Governance Review Decision[\s\S]*$/m, '');

  updatedContent =
    updatedContent.trimEnd() +
    `\n\n## 4. Governance Review Decision\n- **Decision**: \`${newStatus.toUpperCase()}\`\n- **Reviewer**: ${reviewer}\n- **Rationale**: ${reason}\n- **Decided At**: ${new Date().toISOString()}\n`;

  writeFileAtomic(target.fullPath, updatedContent);

  const updatedAdr = { ...target, status: newStatus };
  patchProductMdWithADR(repoRoot, updatedAdr);

  appendDecisionEvent({
    type: 'ADR_DECIDED',
    id: target.id,
    label: `${target.id}: ${target.title}`,
    category: 'ADR',
    status: newStatus,
    ticketId: target.ticketId,
    linksTo: target.supersedes,
    metadata: { reviewer, reason, action },
    repoRoot
  });

  appendAuditRecord({
    event: 'ADR_GOVERNANCE_DECISION',
    metadata: { adrId: target.id, status: newStatus, reviewer, reason },
    repoRoot
  });

  syncDecisionMapMarkdown(repoRoot);

  return {
    success: true,
    adr: updatedAdr
  };
}

function extractDecisionSummary(adr) {
  const raw = String(adr?.content || '');
  const sectionMatch = raw.match(/##\s*(?:2\.\s*)?Decision\s*\n+([\s\S]*?)(?=\n##\s|$)/i);
  if (sectionMatch && sectionMatch[1]) {
    const firstLine = sectionMatch[1]
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean);
    if (firstLine) {
      return firstLine.replace(/\|/g, '/');
    }
  }
  return String(adr?.title || '').replace(/\|/g, '/');
}

/**
 * First-Class ADR Lifecycle Compaction (`adr compact` & Release Compaction):
 * Consolidates accepted in-flight `docs/adr/ADR-*.md` files into `docs/SRS.md`
 * (`## Compacted Architectural Decisions`), resets the ADR index in `PRODUCT.md`,
 * deletes the individual ADR files, prunes `.agent/decision-graph.jsonl`, and
 * records an immutable `ADR_BATCH_COMPACTED` event in `docs/AUDIT_CHAIN.jsonl`.
 */
export function compactADRs({ releaseVersion = 'baseline', dryRun = false, repoRoot = '.' } = {}) {
  const adrs = listADRs(repoRoot);
  if (adrs.length === 0) {
    return {
      success: true,
      dryRun: Boolean(dryRun),
      releaseVersion,
      compactedCount: 0,
      compactedAdrIds: [],
      srsPath: 'docs/SRS.md',
      message: 'No ADRs present in docs/adr/ to compact.'
    };
  }

  const pending = adrs.filter((a) => a.status === 'pending_approval');
  if (pending.length > 0) {
    throw new Error(
      `Cannot compact ADRs while pending_approval exists: ${pending.map((a) => a.id).join(', ')}. Approve or reject pending ADRs first.`
    );
  }

  const acceptedAdrs = adrs.filter((a) => a.status === 'accepted');
  const compactedAdrIds = adrs.map((a) => a.id);
  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      releaseVersion,
      compactedCount: adrs.length,
      acceptedCount: acceptedAdrs.length,
      compactedAdrIds,
      srsPath: 'docs/SRS.md'
    };
  }

  // 1. Append or update ## Compacted Architectural Decisions table in docs/SRS.md (creating SRS.md if absent)
  const srsPath = path.resolve(repoRoot, 'docs/SRS.md');
  if (acceptedAdrs.length > 0) {
    let srsContent = fileExists(srsPath) ? readFileSafe(srsPath) || '' : '# Software Requirements Specification (SRS)\n';
    const rows = acceptedAdrs.map((a) => {
      const summary = extractDecisionSummary(a);
      const ticketCell = formatTicketRef(a.ticketId);
      const supCell = (a.supersedes || []).join(', ') || 'None';
      return `| \`${a.id}\` | ${a.title.replace(/\|/g, '/')} | \`${a.scope}\` | ${ticketCell} | ${supCell} | \`${releaseVersion}\` | ${summary} |`;
    });

    if (srsContent.includes('## Compacted Architectural Decisions')) {
      const escRel = String(releaseVersion).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (const row of rows) {
        const idMatch = row.match(/^\|\s*`(ADR-\d+)`/);
        const existingRowRegex = idMatch
          ? new RegExp(`^\\|\\s*\`?${idMatch[1]}\`?\\s*\\|(?:[^|\\n]*\\|){4}\\s*\`?${escRel}\`?\\s*\\|.*$`, 'm')
          : null;
        if (existingRowRegex && existingRowRegex.test(srsContent)) {
          srsContent = srsContent.replace(existingRowRegex, () => row);
        } else {
          srsContent = `${srsContent.trimEnd()}\n${row}\n`;
        }
      }
    } else {
      const section = [
        '',
        '## Compacted Architectural Decisions',
        '',
        '| ID | Title | Scope | Ticket | Supersedes | Compacted In Release | Decision |',
        '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
        ...rows,
        ''
      ].join('\n');
      srsContent = `${srsContent.trimEnd()}\n${section}`;
    }
    writeFileAtomic(srsPath, srsContent);
    if (!fileExists(srsPath)) {
      throw new Error(`Refusing to delete ADR files: failed to write ${srsPath}.`);
    }
  }

  // 2. Reset <!-- ADR_INDEX_START -->...<!-- ADR_INDEX_END --> in PRODUCT.md
  const productPath = path.resolve(repoRoot, 'PRODUCT.md');
  if (fileExists(productPath)) {
    let productContent = readFileSafe(productPath) || '';
    const resetBlock = [
      '<!-- ADR_INDEX_START -->',
      '| ADR ID | Title | Scope | Status | Ticket | Supersedes |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      `| *None* | *Compacted into SRS.md (${releaseVersion})* | - | - | - | - |`,
      '<!-- ADR_INDEX_END -->'
    ].join('\n');
    if (/<!-- ADR_INDEX_START -->[\s\S]*?<!-- ADR_INDEX_END -->/.test(productContent)) {
      productContent = productContent.replace(/<!-- ADR_INDEX_START -->[\s\S]*?<!-- ADR_INDEX_END -->/, () => resetBlock);
      writeFileAtomic(productPath, productContent);
    }
  }

  // 3. Delete compacted docs/adr/ADR-*.md files from disk (preserving docs/adr/.gitkeep)
  const adrDir = path.resolve(repoRoot, 'docs/adr');
  for (const adr of adrs) {
    try {
      if (fileExists(adr.fullPath)) {
        fs.unlinkSync(adr.fullPath);
      }
    } catch {}
  }
  if (fileExists(adrDir)) {
    try {
      fs.writeFileSync(path.join(adrDir, '.gitkeep'), '', 'utf8');
    } catch {}
  }

  // 4. Prune compacted ADR_CREATED and ADR_DECIDED events from .agent/decision-graph.jsonl
  const graphPath = path.resolve(repoRoot, DECISION_GRAPH_FILE);
  if (fileExists(graphPath)) {
    const compactedSet = new Set(compactedAdrIds);
    const lines = (readFileSafe(graphPath) || '').split('\n').filter(Boolean);
    const kept = lines.filter((line) => {
      try {
        const evt = JSON.parse(line);
        if ((evt.type === 'ADR_CREATED' || evt.type === 'ADR_DECIDED') && compactedSet.has(evt.id)) {
          return false;
        }
      } catch {}
      return true;
    });
    writeFileAtomic(graphPath, kept.length > 0 ? kept.join('\n') + '\n' : '');
  }

  // 5. Append single ADR_BATCH_COMPACTED event to decision graph & audit chain
  const supLinks = Array.from(new Set(adrs.flatMap((a) => a.supersedes || [])));
  appendDecisionEvent({
    type: 'ADR_BATCH_COMPACTED',
    id: `ADR-COMPACT-${String(releaseVersion).replace(/[^A-Za-z0-9_.-]/g, '-')}`,
    label: `Compacted ${adrs.length} ADR(s) into SRS.md (${releaseVersion})`,
    category: 'ARCH',
    status: 'compacted',
    ticketId: null,
    linksTo: supLinks,
    metadata: {
      releaseVersion,
      compactedAdrIds,
      compactedCount: adrs.length,
      srsPath: 'docs/SRS.md'
    },
    repoRoot
  });

  appendAuditRecord({
    event: 'ADR_BATCH_COMPACTED',
    metadata: {
      releaseVersion,
      compactedAdrIds,
      compactedCount: adrs.length,
      srsPath: 'docs/SRS.md'
    },
    repoRoot
  });

  syncDecisionMapMarkdown(repoRoot);

  return {
    success: true,
    dryRun: false,
    releaseVersion,
    compactedCount: adrs.length,
    compactedAdrIds,
    srsPath: 'docs/SRS.md'
  };
}

const STRUCTURAL_PACKAGE_JSON_KEYS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
  'bundledDependencies',
  'bundleDependencies',
  'overrides',
  'resolutions',
  'workspaces',
  'engines',
  'type',
  'exports',
  'main',
  'module',
  'bin'
];

function canonicalizeJsonValue(val) {
  if (Array.isArray(val)) return val.map(canonicalizeJsonValue);
  if (val && typeof val === 'object') {
    const out = {};
    for (const k of Object.keys(val).sort()) {
      out[k] = canonicalizeJsonValue(val[k]);
    }
    return out;
  }
  return val;
}

function hasStructuralPackageJsonMutation(relFile, baseBranch = null, repoRoot = '.') {
  const resolvedBase = baseBranch || resolveDefaultBaseBranch(repoRoot);
  const rel = String(relFile).replace(/\\/g, '/');
  const fullPath = path.resolve(repoRoot, rel);
  if (!fileExists(fullPath)) return true;

  let currentPkg;
  try {
    currentPkg = JSON.parse(readFileSafe(fullPath) || '');
  } catch {
    return true;
  }
  if (!currentPkg || typeof currentPkg !== 'object') return true;

  let baseRaw =
    gitOutput(['show', `origin/${resolvedBase}:${rel}`], repoRoot) ??
    gitOutput(['show', `${resolvedBase}:${rel}`], repoRoot) ??
    gitOutput(['show', `HEAD~1:${rel}`], repoRoot);

  if (baseRaw === null) {
    const porcelain = (gitOutput(['status', '--porcelain', '--', rel], repoRoot) || '').trim();
    if (porcelain && !porcelain.startsWith('??') && !porcelain.startsWith('A')) {
      baseRaw = gitOutput(['show', `HEAD:${rel}`], repoRoot);
    }
  }

  if (!baseRaw) return true;

  let basePkg;
  try {
    basePkg = JSON.parse(baseRaw);
  } catch {
    return true;
  }
  if (!basePkg || typeof basePkg !== 'object') return true;

  return STRUCTURAL_PACKAGE_JSON_KEYS.some(
    (key) => JSON.stringify(canonicalizeJsonValue(basePkg[key])) !== JSON.stringify(canonicalizeJsonValue(currentPkg[key]))
  );
}

/**
 * Dual-Enforced Spec-Drift Sentinel:
 * Inspects git diff for structural changes (manifest dependencies, API contracts,
 * DB schema migrations, PRODUCT.md / capability specs, or Mermaid C4 architecture diagrams).
 * If mutated without an accompanying accepted ADR linked to the active ticket, blocks the gate.
 */
export function checkSpecDrift({
  diffFiles = [],
  baseBranch = null,
  ticketId = null,
  repoRoot = '.'
} = {}) {
  const resolvedBase = baseBranch || resolveDefaultBaseBranch(repoRoot);
  const files = diffFiles.length > 0 ? diffFiles : getModifiedFiles(resolvedBase, repoRoot);
  const triggers = [];

  for (const file of files) {
    const lower = file.replace(/\\/g, '/').toLowerCase();
    if (lower === 'package.json' || lower.endsWith('/package.json')) {
      if (hasStructuralPackageJsonMutation(file, resolvedBase, repoRoot)) {
        triggers.push({ file, category: 'DEPENDENCY_MANIFEST_MUTATION', reason: 'Package manifest structural or dependency field modified' });
      }
    } else if (
      lower.endsWith('pom.xml') ||
      lower.endsWith('cargo.toml') ||
      lower.endsWith('pyproject.toml') ||
      lower.endsWith('go.mod') ||
      lower.endsWith('requirements.txt') ||
      lower.endsWith('build.gradle') ||
      lower.endsWith('build.gradle.kts')
    ) {
      triggers.push({ file, category: 'DEPENDENCY_MANIFEST_MUTATION', reason: 'Stack manifest or dependency modified' });
    } else if (
      lower.endsWith('openapi.json') ||
      lower.endsWith('openapi.yaml') ||
      lower.endsWith('openapi.yml') ||
      lower.endsWith('swagger.json') ||
      lower.endsWith('.graphql') ||
      lower.endsWith('.gql')
    ) {
      triggers.push({ file, category: 'API_CONTRACT_MUTATION', reason: 'Public API schema or contract modified' });
    } else if (/(^|\/)(migrations?|flyway|alembic|prisma\/migrations)\//.test(lower) || lower.endsWith('.sql')) {
      triggers.push({ file, category: 'DB_SCHEMA_MIGRATION', reason: 'Database DDL migration introduced or altered' });
    } else if (lower.endsWith('.mmd') || lower.includes('docs/architecture/') || lower.includes('.archlens/policy.json')) {
      triggers.push({ file, category: 'C4_ARCHITECTURE_BOUNDARY_SHIFT', reason: 'Architecture diagram or concentric layer policy modified' });
    } else if (lower === 'docs/prd.md' || lower.endsWith('/docs/prd.md') || lower === 'docs/srs.md' || lower.endsWith('/docs/srs.md')) {
      triggers.push({ file, category: 'PRD_SRS_CONTRACT_MUTATION', reason: 'Macro PRD or IEEE 29148 SRS specification modified' });
    } else if (
      lower === 'product.md' ||
      lower.endsWith('/product.md') ||
      ((lower.startsWith('docs/specs/') || lower.includes('/docs/specs/')) && lower.endsWith('.md'))
    ) {
      triggers.push({ file, category: 'PRODUCT_SPEC_MUTATION', reason: 'Product constitution (PRODUCT.md) or capability specification modified' });
    }
  }

  if (triggers.length === 0) {
    return {
      passed: true,
      hasUndeclaredDrift: false,
      triggers: [],
      linkedADRs: [],
      message: 'No structural spec drift triggers detected in diff.'
    };
  }

  // Check if an accepted ADR is present in the diff or registered in docs/adr/ for this ticketId,
  // while failing closed if any ADR in the diff or matching ticketId is not accepted.
  const normDiffSet = new Set(
    files.map((f) =>
      String(f || '')
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
    )
  );
  const allAdrs = listADRs(repoRoot);
  const normQueryTicket = normalizeTicketId(ticketId);
  const blockingAdrs = allAdrs.filter((a) => {
    const adrInDiff = normDiffSet.has(a.file);
    const normAdrTicket = normalizeTicketId(a.ticketId);
    const matchesTicket = normQueryTicket !== null && normAdrTicket !== null && normAdrTicket === normQueryTicket;
    return (adrInDiff || matchesTicket) && a.status !== 'accepted';
  });

  const matchingAdrs =
    blockingAdrs.length > 0
      ? []
      : allAdrs.filter((a) => {
          if (a.status !== 'accepted') return false;
          const adrInDiff = normDiffSet.has(a.file);
          const normAdrTicket = normalizeTicketId(a.ticketId);
          if (normQueryTicket !== null) {
            const matchesTicket = normAdrTicket !== null && normAdrTicket === normQueryTicket;
            const unconflictingInDiff = adrInDiff && (normAdrTicket === null || normAdrTicket === normQueryTicket);
            return matchesTicket || unconflictingInDiff;
          }
          return adrInDiff;
        });

  // Also allow ADR Compaction diffs (where docs/adr/ADR-*.md files were compacted into docs/SRS.md and recorded in AUDIT_CHAIN.jsonl)
  let isAdrCompaction = false;
  const compactionOnlyTriggers =
    triggers.length > 0 && triggers.every((t) => t.file === 'PRODUCT.md' || t.file === 'docs/SRS.md');
  if (blockingAdrs.length === 0 && matchingAdrs.length === 0 && allAdrs.length === 0 && compactionOnlyTriggers) {
    const auditChainPath = path.resolve(repoRoot, 'docs/AUDIT_CHAIN.jsonl');
    const auditRaw = fileExists(auditChainPath) ? readFileSafe(auditChainPath) || '' : '';
    const hasCompactedAuditRecord = auditRaw.includes('"event":"ADR_BATCH_COMPACTED"');
    const diffDeletesAdr = files.some(
      (f) => f.includes('docs/adr/ADR-') && f.endsWith('.md') && !fileExists(path.resolve(repoRoot, f))
    );
    const srsPath = path.resolve(repoRoot, 'docs/SRS.md');
    const srsHasCompactedTable = fileExists(srsPath) && (readFileSafe(srsPath) || '').includes('## Compacted Architectural Decisions');
    const auditDiff = gitDiffForFile('docs/AUDIT_CHAIN.jsonl', repoRoot, resolvedBase) || '';
    const diffAddsCompactionEvent = auditDiff
      .split('\n')
      .some((line) => line.startsWith('+') && !line.startsWith('+++') && line.includes('"event":"ADR_BATCH_COMPACTED"'));
    if (
      hasCompactedAuditRecord &&
      srsHasCompactedTable &&
      (diffDeletesAdr || (normDiffSet.has('docs/SRS.md') && diffAddsCompactionEvent))
    ) {
      isAdrCompaction = true;
    }
  }

  const passed = blockingAdrs.length === 0 && (matchingAdrs.length > 0 || isAdrCompaction);
  const linkedIds = matchingAdrs.length > 0 ? matchingAdrs.map((a) => a.id) : isAdrCompaction ? ['ADR_BATCH_COMPACTED'] : [];
  const blockingSummary = blockingAdrs.map((a) => `${a.id} (${a.status})`).join(', ');

  return {
    passed,
    hasUndeclaredDrift: !passed,
    triggers,
    linkedADRs: linkedIds,
    blockingADRs: blockingAdrs.map((a) => a.id),
    remediationCommand:
      blockingAdrs.length > 0
        ? `node .agent/scripts/sdlc-engine.mjs adr decide --id ${blockingAdrs[0].id} --status approve --by "@reviewer" --reason "<rationale>"`
        : `node .agent/scripts/sdlc-engine.mjs adr create --title "<decision>" --scope <technical|product> --ticket ${ticketId || '<id>'} --supersedes CAP-01`,
    message: passed
      ? `Spec drift verified and governed by ${linkedIds.join(', ')}.`
      : blockingAdrs.length > 0
        ? `UNAPPROVED_ADR_DRIFT: ADR(s) ${blockingSummary} require explicit approval via 'adr decide --status approve' before drift check passes.`
        : `UNDECLARED_SPEC_DRIFT: ${triggers.length} structural mutation(s) detected without a linked accepted ADR in docs/adr/.`
  };
}

// --- API Contract Drift & Schema Guardian (Issue #24) ---

const OPENAPI_HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

function parseYamlOpenApiPaths(raw = '') {
  const paths = {};
  const lines = String(raw || '').split('\n');
  let inPaths = false;
  let pathsIndent = -1;
  let currentRoute = null;
  let routeIndent = -1;

  for (const rawLine of lines) {
    const clean = rawLine.replace(/#.*$/, '').replace(/\r$/, '');
    if (!clean.trim()) continue;
    const indent = clean.search(/\S/);
    const trimmed = clean.trim();

    if (!inPaths) {
      if (/^paths\s*:\s*$/.test(trimmed)) {
        inPaths = true;
        pathsIndent = indent;
      }
      continue;
    }

    if (indent <= pathsIndent) {
      inPaths = false;
      currentRoute = null;
      continue;
    }

    if (/^['"]?(\/[^:'"]*)['"]?\s*:/.test(trimmed)) {
      const m = trimmed.match(/^['"]?(\/[^:'"]*)['"]?\s*:/);
      currentRoute = m[1];
      routeIndent = indent;
      if (!paths[currentRoute]) paths[currentRoute] = {};
      continue;
    }

    if (currentRoute && indent > routeIndent) {
      const keyMatch = trimmed.match(/^['"]?([A-Za-z]+)['"]?\s*:/);
      if (keyMatch) {
        const verb = keyMatch[1].toLowerCase();
        if (OPENAPI_HTTP_METHODS.has(verb) && indent <= routeIndent + 4) {
          paths[currentRoute][verb] = true;
        }
      }
    }
  }
  return { paths };
}

export function auditContractDrift({ diffFiles = [], baseBranch = null, repoRoot = '.' } = {}) {
  const resolvedBase = baseBranch || resolveDefaultBaseBranch(repoRoot);
  const files = diffFiles.length > 0 ? diffFiles : getModifiedFiles(resolvedBase, repoRoot);
  const contractPatterns = ['openapi.json', 'openapi.yaml', 'openapi.yml', 'swagger.json', '.graphql', '.gql'];

  const modifiedContracts = files.filter((f) => {
    const lower = f.toLowerCase();
    return contractPatterns.some((p) => lower.endsWith(p));
  });

  if (modifiedContracts.length === 0) {
    return {
      passed: true,
      hasDrift: false,
      breakingChangesCount: 0,
      breakingChanges: [],
      filesChecked: 0,
      message: 'No API contracts or schema files modified in diff.'
    };
  }

  const breakingChanges = [];

  for (const relPath of modifiedContracts) {
    const fullPath = path.resolve(repoRoot, relPath);
    let oldContent = '';
    try {
      oldContent = (
        gitOutput(['show', `origin/${resolvedBase}:${relPath}`], repoRoot) ??
        gitOutput(['show', `${resolvedBase}:${relPath}`], repoRoot) ??
        gitOutput(['show', `HEAD~1:${relPath}`], repoRoot) ??
        gitOutput(['show', `HEAD:${relPath}`], repoRoot) ??
        ''
      ).trim();
    } catch {}

    const newContent = fileExists(fullPath) ? readFileSafe(fullPath) : '';

    if (!newContent) {
      breakingChanges.push({
        file: relPath,
        type: 'CONTRACT_DELETED',
        severity: 'CRITICAL',
        details: `API contract file was deleted completely: ${relPath}`
      });
      continue;
    }

    const lowerRel = relPath.toLowerCase();
    if (lowerRel.endsWith('.json') || lowerRel.endsWith('.yaml') || lowerRel.endsWith('.yml')) {
      try {
        const oldSpec = oldContent
          ? lowerRel.endsWith('.json')
            ? JSON.parse(oldContent)
            : parseYamlOpenApiPaths(oldContent)
          : null;
        const newSpec = lowerRel.endsWith('.json') ? JSON.parse(newContent) : parseYamlOpenApiPaths(newContent);

        if (oldSpec && oldSpec.paths) {
          for (const [route, methods] of Object.entries(oldSpec.paths)) {
            if (!newSpec.paths || !newSpec.paths[route]) {
              breakingChanges.push({
                file: relPath,
                type: 'ENDPOINT_REMOVED',
                severity: 'CRITICAL',
                details: `Endpoint route removed: ${route}`
              });
            } else if (methods && typeof methods === 'object') {
              const newMethods = newSpec.paths[route];
              for (const method of Object.keys(methods)) {
                const lowerMethod = method.toLowerCase();
                if (!OPENAPI_HTTP_METHODS.has(lowerMethod)) continue;
                const hasMethod = Object.keys(newMethods).some((k) => k.toLowerCase() === lowerMethod);
                if (!hasMethod) {
                  breakingChanges.push({
                    file: relPath,
                    type: 'METHOD_REMOVED',
                    severity: 'CRITICAL',
                    details: `HTTP method ${method.toUpperCase()} removed from route: ${route}`
                  });
                }
              }
            }
          }
        }
      } catch {}
    } else if (lowerRel.endsWith('.graphql') || lowerRel.endsWith('.gql')) {
      if (oldContent) {
        const stripComments = (src) => String(src).replace(/#[^\n]*/g, '');
        const oldTypeMatches = Array.from(stripComments(oldContent).matchAll(/(?:type|input|interface)\s+([A-Za-z0-9_]+)/g)).map(
          (m) => m[1]
        );
        const newTypeMatches = new Set(
          Array.from(stripComments(newContent).matchAll(/(?:type|input|interface)\s+([A-Za-z0-9_]+)/g)).map((m) => m[1])
        );

        for (const t of oldTypeMatches) {
          if (!newTypeMatches.has(t)) {
            breakingChanges.push({
              file: relPath,
              type: 'GRAPHQL_TYPE_REMOVED',
              severity: 'CRITICAL',
              details: `GraphQL type removed: ${t}`
            });
          }
        }
      }
    }
  }

  const passed = breakingChanges.length === 0;

  return {
    passed,
    hasDrift: breakingChanges.length > 0,
    breakingChangesCount: breakingChanges.length,
    breakingChanges,
    filesChecked: modifiedContracts.length,
    message: passed
      ? `API contract check clean (${modifiedContracts.length} contract files verified).`
      : `Detected ${breakingChanges.length} breaking API contract change(s)!`
  };
}
