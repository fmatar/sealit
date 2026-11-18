import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  EMPTY_TREE_SHA,
  computeAlignmentHashes,
  fileExists,
  listTree,
  normalizeTicketId,
  parseFrontmatter,
  readBlobs,
  readChangeSet,
  readFileSafe,
  resolveEffectiveDiffBase,
  resolveInsideRepo,
  resolveRange,
  writeFileAtomic
} from './git.mjs';
import { appendAuditRecord } from './receipt.mjs';

export { computeAlignmentHashes };

const STRUCTURAL_PKG_KEYS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
  'overrides',
  'workspaces'
];

const SOURCE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.cjs', '.js'];

function parseListField(raw) {
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  const str = String(raw ?? '')
    .trim()
    .replace(/^\[/, '')
    .replace(/\]$/, '');
  if (!str) return [];
  return str
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter((item) => item && !/^(?:none|n\/a|null)$/i.test(item));
}

function slugifyTitle(title) {
  return (
    String(title || 'decision')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'decision'
  );
}

function parseAdrRecord(relFile, raw) {
  const { frontmatter } = parseFrontmatter(raw);
  const name = path.posix.basename(relFile);
  const idMatch = name.match(/^(ADR-\d+)/i);
  const id = (frontmatter.id || (idMatch ? idMatch[1] : name.replace(/\.md$/i, ''))).toUpperCase();
  return {
    id,
    title: frontmatter.title || id,
    scope: (frontmatter.scope || 'technical').toLowerCase(),
    status: (frontmatter.status || 'pending_approval').toLowerCase(),
    ticket: normalizeTicketId(frontmatter.ticket ?? frontmatter.ticketId),
    supersedes: parseListField(frontmatter.supersedes ?? frontmatter.affects),
    decidedBy: frontmatter.decidedBy || null,
    decidedAt: frontmatter.decidedAt || null,
    file: relFile,
    sha256: crypto.createHash('sha256').update(raw.replace(/\r\n/g, '\n')).digest('hex')
  };
}

export function listADRs(repoRoot = '.', { sha = null } = {}) {
  if (sha) {
    const files = listTree(sha, 'docs/adr', repoRoot).filter((f) => /^docs\/adr\/ADR-\d+[^/]*\.md$/i.test(f));
    const blobs = readBlobs(files.map((f) => `${sha}:${f}`), repoRoot);
    const out = [];
    for (const f of files) {
      const raw = blobs.get(`${sha}:${f}`);
      if (raw !== null && raw !== undefined) out.push(parseAdrRecord(f, raw));
    }
    return out;
  }
  const adrDir = path.resolve(repoRoot, 'docs/adr');
  if (!fileExists(adrDir)) return [];
  const entries = fs.readdirSync(adrDir).filter((name) => /^ADR-\d+.*\.md$/i.test(name)).sort();
  const out = [];
  for (const name of entries) {
    const raw = readFileSafe(path.join(adrDir, name));
    if (raw !== null) out.push(parseAdrRecord(`docs/adr/${name}`, raw));
  }
  return out;
}

function resolveNextAdrId(repoRoot = '.') {
  let maxNum = 0;
  const bump = (text) => {
    if (!text) return;
    for (const m of String(text).matchAll(/\bADR-(\d+)\b/gi)) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n > maxNum) maxNum = n;
    }
  };
  for (const adr of listADRs(repoRoot)) bump(adr.id);
  const effBase = resolveEffectiveDiffBase(null, repoRoot);
  for (const ref of [`origin/${effBase}`, effBase]) {
    const treeFiles = listTree(ref, 'docs/adr', repoRoot).filter((f) => /^docs\/adr\/ADR-\d+[^/]*\.md$/i.test(f));
    for (const f of treeFiles) bump(f);
    if (treeFiles.length > 0) {
      const blobs = readBlobs(treeFiles.map((f) => `${ref}:${f}`), repoRoot);
      for (const raw of blobs.values()) if (raw) bump(parseFrontmatter(raw).frontmatter?.id);
    }
  }
  bump(readFileSafe(path.resolve(repoRoot, 'docs/SRS.md')));
  bump(readFileSafe(path.resolve(repoRoot, 'PRODUCT.md')));
  return `ADR-${String(maxNum + 1).padStart(3, '0')}`;
}

function syncProductAdrIndex(repoRoot = '.') {
  const prodPath = path.resolve(repoRoot, 'PRODUCT.md');
  if (!fileExists(prodPath)) return;
  const raw = readFileSafe(prodPath);
  if (!raw || !raw.includes('<!-- ADR_INDEX_START -->') || !raw.includes('<!-- ADR_INDEX_END -->')) return;

  const adrs = listADRs(repoRoot);
  const header = [
    '<!-- ADR_INDEX_START -->',
    '| ADR ID | Title | Scope | Status | Ticket | Supersedes |',
    '| :--- | :--- | :--- | :--- | :--- | :--- |'
  ];
  const rows = adrs.map(
    (a) =>
      `| ${a.id} | ${a.title.replace(/\|/g, '\\|')} | \`${a.scope}\` | \`${a.status}\` | ${a.ticket || 'N/A'} | ${a.supersedes.length > 0 ? a.supersedes.join(', ') : 'None'} |`
  );
  const block = [...header, ...rows, '<!-- ADR_INDEX_END -->'].join('\n');
  const updated = raw.replace(/<!-- ADR_INDEX_START -->[\s\S]*?<!-- ADR_INDEX_END -->/, block);
  if (updated !== raw) {
    writeFileAtomic(prodPath, updated);
  }
}

export function createADR({
  title,
  scope = 'technical',
  ticket = null,
  supersedes = [],
  context = 'Describe the spec, dependency, contract, or architecture change.',
  decision = 'Document the chosen design and constraints.',
  consequences = 'Document trade-offs and reversal criteria.',
  repoRoot = '.'
} = {}) {
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) throw new Error('ADR requires a non-empty --title.');
  const validScopes = new Set(['technical', 'architectural', 'product', 'contract']);
  const normScope = String(scope || 'technical').toLowerCase().trim();
  if (!validScopes.has(normScope)) {
    throw new Error(`Invalid ADR scope '${scope}'. Expected one of: technical, architectural, product, contract.`);
  }

  const normTicket = normalizeTicketId(ticket) || 'N/A';
  const supList = parseListField(supersedes);
  // Raw frontmatter values: reject anything that could inject extra YAML lines (e.g. a second `status:`).
  if (normTicket !== 'N/A' && !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(normTicket)) throw new Error(`Invalid ADR ticket '${ticket}'.`);
  const badSup = supList.find((s) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s));
  if (badSup !== undefined) throw new Error(`Invalid ADR supersedes entry '${badSup}'.`);
  const id = resolveNextAdrId(repoRoot);
  const slug = slugifyTitle(cleanTitle);
  const relFile = `docs/adr/${id}-${slug}.md`;
  const absFile = resolveInsideRepo(repoRoot, relFile);
  const now = new Date().toISOString();

  const md = [
    '---',
    `id: ${id}`,
    `title: ${JSON.stringify(cleanTitle)}`,
    `scope: ${normScope}`,
    'status: pending_approval',
    `ticket: ${normTicket}`,
    `supersedes: [${supList.join(', ')}]`,
    `createdAt: ${now}`,
    '---',
    '',
    `# ${id}: ${cleanTitle}`,
    '',
    `- **Scope**: \`${normScope}\``,
    '- **Status**: `pending_approval`',
    `- **Linked Ticket**: \`${normTicket}\``,
    `- **Supersedes / Modifies**: \`${supList.length > 0 ? supList.join(', ') : 'None'}\``,
    '',
    '## 1. Context & Spec Drift Trigger',
    String(context || '').trim(),
    '',
    '## 2. Decision',
    String(decision || '').trim(),
    '',
    '## 3. Consequences & Reversal Criteria',
    String(consequences || '').trim(),
    ''
  ].join('\n');

  writeFileAtomic(absFile, md);
  syncProductAdrIndex(repoRoot);
  appendAuditRecord({
    event: 'ADR_CREATED',
    metadata: { id, title: cleanTitle, scope: normScope, status: 'pending_approval', ticket: normTicket, file: relFile },
    repoRoot
  });

  return { success: true, id, title: cleanTitle, scope: normScope, status: 'pending_approval', ticket: normTicket, file: relFile };
}

export function decideADR({ adrId, status, action, reviewer = '@reviewer', reason = '', repoRoot = '.' } = {}) {
  const targetId = String(adrId || '').trim().toUpperCase();
  if (!targetId) return { success: false, error: 'Missing --id for ADR decision.' };

  const rawStatus = String(status || action || '').toLowerCase().trim();
  let nextStatus = null;
  if (rawStatus === 'approve' || rawStatus === 'accept' || rawStatus === 'accepted') nextStatus = 'accepted';
  else if (rawStatus === 'reject' || rawStatus === 'rejected') nextStatus = 'rejected';
  else if (rawStatus === 'supersede' || rawStatus === 'superseded') nextStatus = 'superseded';
  if (!nextStatus) {
    return { success: false, error: `Invalid ADR decision '${rawStatus}'. Expected 'approve' or 'reject'.` };
  }

  const found = listADRs(repoRoot).find((a) => a.id === targetId);
  if (!found) {
    return { success: false, error: `ADR '${targetId}' not found in docs/adr/.` };
  }

  const absFile = resolveInsideRepo(repoRoot, found.file);
  const raw = fs.readFileSync(absFile, 'utf8').replace(/\r\n/g, '\n');
  const now = new Date().toISOString();
  const cleanReviewer = String(reviewer || '@reviewer').trim();
  const cleanReason = String(reason || 'Reviewed and decided').trim();

  let updated = raw
    .replace(/^(?:decidedBy|decidedAt|decisionReason):\s*.*\n/gm, '')
    .replace(/^status:\s*.*$/m, `status: ${nextStatus}`);
  if (/^---\n[\s\S]*?\n---/.test(updated)) {
    updated = updated.replace(/\n---/, `\ndecidedBy: ${JSON.stringify(cleanReviewer)}\ndecidedAt: ${now}\ndecisionReason: ${JSON.stringify(cleanReason)}\n---`);
  }
  updated = updated.replace(/^- \*\*Status\*\*:\s*`[^`]+`/m, `- **Status**: \`${nextStatus}\``);

  writeFileAtomic(absFile, updated);
  syncProductAdrIndex(repoRoot);
  appendAuditRecord({
    event: nextStatus === 'accepted' ? 'ADR_APPROVED' : 'ADR_DECIDED',
    metadata: { id: targetId, status: nextStatus, reviewer: cleanReviewer, reason: cleanReason, file: found.file },
    repoRoot
  });

  const refreshed = listADRs(repoRoot).find((a) => a.id === targetId);
  return { success: true, adr: refreshed };
}

function hasPackageJsonStructuralDiff(curRaw, baseRaw) {
  if (curRaw === null || curRaw === undefined) return false;
  let curPkg;
  try {
    curPkg = JSON.parse(curRaw);
  } catch {
    return true;
  }
  if (baseRaw === null || baseRaw === undefined) {
    return STRUCTURAL_PKG_KEYS.some((k) => {
      const val = curPkg[k];
      if (!val) return false;
      if (Array.isArray(val)) return val.length > 0;
      if (typeof val === 'object') return Object.keys(val).length > 0;
      return true;
    });
  }
  let basePkg;
  try {
    basePkg = JSON.parse(baseRaw);
  } catch {
    return true;
  }
  return STRUCTURAL_PKG_KEYS.some((k) => JSON.stringify(curPkg[k] ?? null) !== JSON.stringify(basePkg[k] ?? null));
}

function validateOpenApiContract(raw, relFile) {
  if (raw === null || raw === undefined) return `Unable to read contract file '${relFile}'.`;
  if (/\.json$/i.test(relFile)) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return `Invalid JSON in API contract '${relFile}': ${err.message}`;
    }
    const ver = parsed?.openapi ?? parsed?.swagger;
    if (!parsed || typeof parsed !== 'object' || typeof ver !== 'string' || !ver.trim()) {
      return `Contract '${relFile}' is missing non-empty string 'openapi' or 'swagger' version.`;
    }
    if (!parsed.info || typeof parsed.info !== 'object' || (!parsed.paths && !parsed.webhooks && !parsed.components)) {
      return `Contract '${relFile}' must define 'info' and at least one of 'paths', 'webhooks', or 'components'.`;
    }
    return null;
  }

  const normalized = raw.replace(/\r\n/g, '\n');
  if (!/^(?:openapi|swagger)\s*:\s*['"]?\d+\.\d+/m.test(normalized)) {
    return `YAML contract '${relFile}' is missing valid 'openapi:' or 'swagger:' version declaration.`;
  }
  if (!/^info\s*:/m.test(normalized) || !/^(?:paths|webhooks|components)\s*:/m.test(normalized)) {
    return `YAML contract '${relFile}' must define 'info:' and 'paths:', 'webhooks:', or 'components:'.`;
  }
  if (/^\t+/m.test(normalized)) {
    return `YAML contract '${relFile}' contains invalid tab indentation.`;
  }
  const stack = [];
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '\\' && inDouble) {
      i++;
      continue;
    }
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === '#') {
        const nl = normalized.indexOf('\n', i);
        if (nl === -1) break;
        i = nl;
        continue;
      }
      if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
      else if (ch === '}' || ch === ']') {
        if (stack.pop() !== ch) return `Malformed YAML flow brackets in '${relFile}'.`;
      }
    }
  }
  if (inSingle || inDouble || stack.length !== 0) {
    return `Unbalanced quotes or brackets in YAML contract '${relFile}'.`;
  }
  return null;
}

export function checkSpecDrift({ ticketId = null, baseBranch = null, changeSet = null, repoRoot = '.' } = {}) {
  const resolvedBase = resolveEffectiveDiffBase(baseBranch, repoRoot);
  const range = changeSet ? null : resolveRange({ baseBranch: resolvedBase, head: 'HEAD', repoRoot });
  const cs = changeSet || readChangeSet({ ...range, source: 'worktree', repoRoot });
  const mergeBase = cs.baseSha && cs.baseSha !== EMPTY_TREE_SHA ? cs.baseSha : null;
  const fromCommit = cs.source === 'commit' && Boolean(cs.headSha);

  const triggers = [];
  const contractErrors = [];
  const DELETED_GOVERNANCE_RE =
    /^(?:PRODUCT\.md|docs\/PRD\.md|docs\/SRS\.md|docs\/specs\/.+\.md|docs\/adr\/ADR-\d+.*\.md|docs\/AUDIT_CHAIN\.jsonl|\.archlens\/policy\.json)$|(?:^|\/)(?:package\.json|Cargo\.toml|pyproject\.toml|requirements[^/]*\.txt|go\.mod|pom\.xml|build\.gradle(?:\.kts)?|prisma\/schema\.prisma)$|\.(?:sql|graphql|proto)$|(?:openapi|swagger).*\.(?:json|ya?ml)$/i;

  const nonDeletedEntries = cs.entries.filter((e) => e.status !== 'D');
  const headSpecs = fromCommit ? nonDeletedEntries.map((e) => `${cs.headSha}:${e.path}`) : [];
  const baseAdrPaths = mergeBase ? listTree(mergeBase, 'docs/adr', repoRoot).filter((f) => /^docs\/adr\/ADR-\d+.*\.md$/i.test(f)) : [];
  const baseSpecs = mergeBase
    ? [
        ...nonDeletedEntries.filter((e) => e.path === 'PRODUCT.md' || /(?:^|\/)package\.json$/.test(e.path)).map((e) => `${mergeBase}:${e.path}`),
        ...baseAdrPaths.map((f) => `${mergeBase}:${f}`)
      ]
    : [];
  const blobCache = readBlobs([...headSpecs, ...baseSpecs], repoRoot);
  const readCur = (rel) => (fromCommit ? blobCache.get(`${cs.headSha}:${rel}`) ?? null : readFileSafe(path.resolve(repoRoot, rel)));
  const readBase = (rel) => (mergeBase ? blobCache.get(`${mergeBase}:${rel}`) ?? null : null);

  for (const entry of cs.entries) {
    const rel = entry.path;
    if (entry.status === 'D') {
      if (DELETED_GOVERNANCE_RE.test(rel)) {
        triggers.push({ file: rel, type: 'SPEC_DELETED', scope: 'architectural' });
        if (rel === 'docs/AUDIT_CHAIN.jsonl') contractErrors.push("Audit ledger 'docs/AUDIT_CHAIN.jsonl' cannot be deleted.");
      }
      continue;
    }

    if (rel === 'PRODUCT.md' || rel === 'docs/PRD.md' || rel === 'docs/SRS.md' || /^docs\/specs\/.+\.md$/.test(rel)) {
      if (rel === 'PRODUCT.md' && mergeBase) {
        const baseProd = readBase('PRODUCT.md');
        const curProd = readCur('PRODUCT.md') || '';
        const stripIndex = (s) => String(s || '').replace(/\r\n/g, '\n').replace(/<!-- ADR_INDEX_START -->[\s\S]*?<!-- ADR_INDEX_END -->/, '').trim();
        if (baseProd !== null && stripIndex(baseProd) === stripIndex(curProd)) continue;
      }
      triggers.push({ file: rel, type: 'CONSTITUTION_OR_SPEC_DRIFT', scope: 'product' });
      continue;
    }

    if (rel === '.archlens/policy.json') {
      triggers.push({ file: rel, type: 'ARCHITECTURE_POLICY_DRIFT', scope: 'architectural' });
      continue;
    }

    if (/(?:^|\/)package\.json$/.test(rel)) {
      if (hasPackageJsonStructuralDiff(readCur(rel), readBase(rel))) {
        triggers.push({ file: rel, type: 'DEPENDENCY_DRIFT', scope: 'technical' });
      }
      continue;
    }

    if (/(?:^|\/)(?:Cargo\.toml|pyproject\.toml|requirements[^/]*\.txt|go\.mod|pom\.xml|build\.gradle(?:\.kts)?)$/.test(rel)) {
      triggers.push({ file: rel, type: 'DEPENDENCY_DRIFT', scope: 'technical' });
      continue;
    }

    if (/\.(?:sql|graphql|proto)$/i.test(rel) || /(?:^|\/)prisma\/schema\.prisma$/.test(rel)) {
      triggers.push({ file: rel, type: 'SCHEMA_OR_CONTRACT_DRIFT', scope: 'contract' });
      continue;
    }

    if (/(?:openapi|swagger).*\.(?:json|ya?ml)$/i.test(rel)) {
      const parseErr = validateOpenApiContract(readCur(rel), rel);
      if (parseErr) {
        contractErrors.push(parseErr);
        triggers.push({ file: rel, type: 'CONTRACT_PARSE_ERROR', scope: 'contract', error: parseErr });
      } else {
        triggers.push({ file: rel, type: 'API_CONTRACT_DRIFT', scope: 'contract' });
      }
    }
  }

  const allAdrs = listADRs(repoRoot, { sha: fromCommit ? cs.headSha : null });
  const normTicket = normalizeTicketId(ticketId);
  const diffAdrFiles = new Set(cs.paths.filter((f) => /^docs\/adr\/ADR-\d+.*\.md$/i.test(f)));
  const deletedPaths = new Set(cs.entries.filter((e) => e.status === 'D').map((e) => e.path));
  const baseExactPaths = new Set(baseAdrPaths);
  const baseAdrFileById = new Map();
  const baseNonGovernablePaths = new Set();
  const baseNonGovernableIds = new Set();
  for (const relBase of baseAdrPaths) {
    const baseRaw = readBase(relBase);
    if (baseRaw === null) continue;
    const fm = parseFrontmatter(baseRaw).frontmatter || {};
    const idMatch = path.posix.basename(relBase).match(/^(ADR-\d+)/i);
    const normId = String(fm.id || (idMatch ? idMatch[1] : '')).trim().toUpperCase();
    if (normId && !baseAdrFileById.has(normId)) baseAdrFileById.set(normId, relBase);
    const baseStatus = String(fm.status || '').toLowerCase();
    if (baseStatus === 'accepted' || baseStatus === 'superseded') {
      baseNonGovernablePaths.add(relBase.toLowerCase());
      if (normId) baseNonGovernableIds.add(normId);
    }
  }

  const invalidAdrFiles = new Set();
  const collisionMessages = [];
  for (const a of allAdrs) {
    if (!diffAdrFiles.has(a.file)) continue;
    if (!baseExactPaths.has(a.file) && baseAdrFileById.has(a.id) && !deletedPaths.has(baseAdrFileById.get(a.id))) {
      const conflictsWith = baseAdrFileById.get(a.id);
      invalidAdrFiles.add(a.file);
      triggers.push({ file: a.file, type: 'ADR_ID_COLLISION', scope: 'architectural', conflictsWith });
      collisionMessages.push(`ADR_ID_COLLISION: ${a.id} already exists on ${resolvedBase} as ${conflictsWith}; renumber this ADR`);
    } else if (baseNonGovernablePaths.has(a.file.toLowerCase()) || baseNonGovernableIds.has(a.id)) {
      invalidAdrFiles.add(a.file);
      triggers.push({ file: a.file, type: 'ADR_MUTATION', scope: 'architectural' });
    }
  }

  const relevantAdrs = allAdrs.filter((a) => {
    if (invalidAdrFiles.has(a.file)) return a.status === 'pending_approval' || a.status === 'rejected';
    if (diffAdrFiles.has(a.file)) return true;
    if (triggers.length === 0 && normTicket && a.ticket === normTicket) return true;
    return false;
  });

  const blockingAdrs = relevantAdrs.filter((a) => a.status === 'pending_approval' || a.status === 'rejected');
  const acceptedAdrs = relevantAdrs.filter((a) => a.status === 'accepted');

  if (contractErrors.length > 0) {
    return {
      passed: false,
      triggers,
      linkedADRs: acceptedAdrs.map((a) => a.id),
      blockingADRs: blockingAdrs.map((a) => a.id),
      remediationCommand: 'Fix malformed API contract syntax before running sdlc drift.',
      message: `CONTRACT_PARSE_ERROR: ${contractErrors.join('; ')}`
    };
  }

  if (collisionMessages.length > 0) {
    return {
      passed: false,
      triggers,
      linkedADRs: acceptedAdrs.map((a) => a.id),
      blockingADRs: blockingAdrs.map((a) => a.id),
      remediationCommand: 'Renumber colliding ADR files using sdlc adr create.',
      message: collisionMessages.join('; ')
    };
  }

  if (triggers.length === 0) {
    if (blockingAdrs.length > 0) {
      return {
        passed: false,
        triggers: [],
        linkedADRs: [],
        blockingADRs: blockingAdrs.map((a) => a.id),
        remediationCommand: `node .agent/scripts/sdlc-engine.mjs adr decide --id ${blockingAdrs[0].id} --status approve --by "@reviewer" --reason "<rationale>"`,
        message: `UNAPPROVED_ADR_DRIFT: ADR(s) ${blockingAdrs.map((a) => `${a.id} (${a.status})`).join(', ')} require approval.`
      };
    }
    return {
      passed: true,
      triggers: [],
      linkedADRs: acceptedAdrs.map((a) => a.id),
      blockingADRs: [],
      remediationCommand: '',
      message: 'Zero undeclared spec, dependency, schema, or contract drift detected.'
    };
  }

  const passed = blockingAdrs.length === 0 && acceptedAdrs.length > 0;
  return {
    passed,
    triggers,
    linkedADRs: acceptedAdrs.map((a) => a.id),
    blockingADRs: blockingAdrs.map((a) => a.id),
    remediationCommand:
      blockingAdrs.length > 0
        ? `node .agent/scripts/sdlc-engine.mjs adr decide --id ${blockingAdrs[0].id} --status approve --by "@reviewer" --reason "<rationale>"`
        : `node .agent/scripts/sdlc-engine.mjs adr create --title "<decision>" --scope ${triggers[0].scope || 'technical'} --ticket ${normTicket || '<id>'}`,
    message: passed
      ? `Spec drift verified and governed by ${acceptedAdrs.map((a) => a.id).join(', ')}.`
      : blockingAdrs.length > 0
        ? `UNAPPROVED_ADR_DRIFT: ADR(s) ${blockingAdrs.map((a) => `${a.id} (${a.status})`).join(', ')} require explicit approval.`
        : `UNDECLARED_SPEC_DRIFT: ${triggers.length} structural change(s) (${triggers.map((t) => t.file).join(', ')}) require an accepted ADR in docs/adr/.`
  };
}

function patternMatchesPath(pattern, relPath) {
  const normPat = String(pattern || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const normRel = String(relPath || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (normPat === normRel) return true;
  if (!normPat.includes('*')) {
    return normRel.startsWith(normPat.endsWith('/') ? normPat : `${normPat}/`);
  }
  const regexStr =
    '^' +
    normPat
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '__GLOBSTAR__')
      .replace(/\*/g, '[^/]*')
      .replace(/__GLOBSTAR__/g, '.*') +
    '$';
  return new RegExp(regexStr).test(normRel);
}

function stripJsComments(source) {
  const s = String(source || '');
  let out = '';
  let i = 0;
  let mode = 'code';
  while (i < s.length) {
    const ch = s[i];
    const next = s[i + 1];
    if (mode === 'code') {
      if (ch === '/' && next === '/') {
        mode = 'line';
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        mode = 'block';
        i += 2;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        mode = ch;
      }
      out += ch;
      i++;
    } else if (mode === 'line') {
      if (ch === '\n') {
        mode = 'code';
        out += '\n';
      }
      i++;
    } else if (mode === 'block') {
      if (ch === '*' && next === '/') {
        mode = 'code';
        out += ' ';
        i += 2;
        continue;
      }
      if (ch === '\n') out += '\n';
      i++;
    } else {
      if (ch === '\\') {
        out += ch + (next || '');
        i += 2;
        continue;
      }
      if (ch === mode) mode = 'code';
      out += ch;
      i++;
    }
  }
  return out;
}

function extractRelativeSpecifiers(source) {
  const cleaned = stripJsComments(source);
  const specs = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"](\.\.?\/[^'"]+)['"]/g,
    /\b(?:import|require)\s*\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g
  ];
  for (const re of patterns) {
    for (const m of cleaned.matchAll(re)) {
      if (m[1]) specs.add(m[1]);
    }
  }
  return [...specs];
}

function resolveImportTarget(fromAbs, specifier, repoRoot) {
  const baseTarget = path.resolve(path.dirname(fromAbs), specifier);
  const candidates = [baseTarget];
  if (/\.[cm]?js$/i.test(baseTarget)) {
    const stem = baseTarget.replace(/\.[cm]?js$/i, '');
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`);
  } else if (!path.extname(baseTarget)) {
    for (const ext of SOURCE_EXTS) candidates.push(`${baseTarget}${ext}`);
    for (const ext of SOURCE_EXTS) candidates.push(path.join(baseTarget, `index${ext}`));
  }
  for (const cand of candidates) {
    if (fileExists(cand) && fs.statSync(cand).isFile()) {
      return path.relative(repoRoot, cand).replace(/\\/g, '/');
    }
  }
  return null;
}

function resolveImportTargetInSet(fromRel, specifier, knownSet) {
  const baseTarget = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), specifier));
  const candidates = [baseTarget];
  if (/\.[cm]?js$/i.test(baseTarget)) {
    const stem = baseTarget.replace(/\.[cm]?js$/i, '');
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`);
  } else if (!path.posix.extname(baseTarget)) {
    for (const ext of SOURCE_EXTS) candidates.push(`${baseTarget}${ext}`);
    for (const ext of SOURCE_EXTS) candidates.push(`${baseTarget}/index${ext}`);
  }
  return candidates.find((c) => knownSet.has(c)) || null;
}

export function checkArchRings({ repoRoot = '.', policyPath = '.archlens/policy.json', sha = null } = {}) {
  const absRoot = path.resolve(repoRoot);
  const normPolicyRel = String(policyPath || '.archlens/policy.json').replace(/\\/g, '/').replace(/^\.\//, '');
  const policyRaw = sha
    ? readBlobs([`${sha}:${normPolicyRel}`], absRoot).get(`${sha}:${normPolicyRel}`)
    : (() => {
        const absPolicy = resolveInsideRepo(absRoot, policyPath);
        return fileExists(absPolicy) ? fs.readFileSync(absPolicy, 'utf8') : null;
      })();
  if (policyRaw === null || policyRaw === undefined) {
    return { passed: true, violations: [], message: 'No .archlens/policy.json configured; skipping ring check.' };
  }

  let policy;
  try {
    policy = JSON.parse(policyRaw);
  } catch (err) {
    return {
      passed: false,
      violations: [{ type: 'POLICY_PARSE_ERROR', message: err.message }],
      message: `Invalid JSON in ${policyPath}: ${err.message}`
    };
  }

  const levels = Array.isArray(policy.levels) ? policy.levels : [];
  const order = Array.isArray(policy.order) ? policy.order : levels.map((_, i) => `ring-${i}`);
  const omitSet = new Set(Array.isArray(policy.omit) ? policy.omit : ['node_modules', '.git', 'coverage', 'reports']);
  const srcRel = String(policy.src || '.').replace(/\\/g, '/').replace(/^\.\//, '');
  const isOmitted = (rel) =>
    rel.split('/').some((seg) => omitSet.has(seg)) || [...omitSet].some((o) => rel === o || rel.startsWith(`${o}/`));

  const sourceFiles = [];
  let sourceBlobs = null;
  if (sha) {
    const allTree = listTree(sha, srcRel === '.' ? '' : srcRel, absRoot);
    if (srcRel !== '.' && allTree.length === 0) {
      return { passed: true, violations: [], message: `Source root '${srcRel}' not present.` };
    }
    for (const rel of allTree) {
      if (!isOmitted(rel) && SOURCE_EXTS.includes(path.posix.extname(rel).toLowerCase())) sourceFiles.push(rel);
    }
    sourceBlobs = readBlobs(sourceFiles.map((f) => `${sha}:${f}`), absRoot);
  } else {
    const absSrc = resolveInsideRepo(absRoot, srcRel);
    if (!fileExists(absSrc)) {
      return { passed: true, violations: [], message: `Source root '${srcRel}' not present.` };
    }
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (omitSet.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        const rel = path.relative(absRoot, full).replace(/\\/g, '/');
        if (isOmitted(rel)) continue;
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && SOURCE_EXTS.includes(path.extname(entry.name).toLowerCase())) sourceFiles.push(rel);
      }
    };
    walk(absSrc);
    sourceFiles.sort();
  }

  const resolveRing = (relFile) => {
    for (let i = 0; i < levels.length; i++) {
      const patterns = Array.isArray(levels[i]) ? levels[i] : [];
      if (patterns.some((pat) => patternMatchesPath(pat, relFile))) return i;
    }
    return -1;
  };

  const knownSourceSet = new Set(sourceFiles);
  const violations = [];
  const graph = new Map();
  const ringByFile = new Map();

  for (const rel of sourceFiles) {
    const ring = resolveRing(rel);
    ringByFile.set(rel, ring);
    if (ring === -1 && levels.length > 0) {
      violations.push({
        type: 'UNMAPPED_MODULE',
        fromFile: rel,
        message: `Module '${rel}' is not assigned to any ring in ${policyPath}.`
      });
    }
    const raw = sha ? sourceBlobs.get(`${sha}:${rel}`) || '' : readFileSafe(path.join(absRoot, rel)) || '';
    const edges = [];
    for (const spec of extractRelativeSpecifiers(raw)) {
      const targetRel = sha
        ? resolveImportTargetInSet(rel, spec, knownSourceSet)
        : resolveImportTarget(path.join(absRoot, rel), spec, absRoot);
      if (targetRel) edges.push(targetRel);
    }
    graph.set(rel, edges);
  }

  for (const [fromFile, targets] of graph.entries()) {
    const fromRing = ringByFile.get(fromFile) ?? -1;
    if (fromRing === -1) continue;
    for (const toFile of targets) {
      const toRing = ringByFile.get(toFile) ?? resolveRing(toFile);
      if (toRing !== -1 && fromRing < toRing) {
        violations.push({
          type: 'LAYER_VIOLATION',
          fromFile,
          toFile,
          fromRing: order[fromRing] || `ring-${fromRing}`,
          toRing: order[toRing] || `ring-${toRing}`,
          message: `Layer inversion: inner ring '${order[fromRing] || fromRing}' (${fromFile}) imports outer ring '${order[toRing] || toRing}' (${toFile}).`
        });
      }
    }
  }

  // DFS cycle detection across the source graph
  const state = new Map();
  const stack = [];
  const seenCycles = new Set();

  const dfs = (node) => {
    state.set(node, 1);
    stack.push(node);
    for (const next of graph.get(node) || []) {
      const st = state.get(next) || 0;
      if (st === 0) {
        dfs(next);
      } else if (st === 1) {
        const idx = stack.indexOf(next);
        const cycle = [...stack.slice(idx), next];
        const sig = [...cycle.slice(0, -1)].sort().join('->');
        if (!seenCycles.has(sig)) {
          seenCycles.add(sig);
          violations.push({
            type: 'CYCLE_VIOLATION',
            fromFile: node,
            toFile: next,
            cycle,
            message: `Circular dependency detected: ${cycle.join(' -> ')}`
          });
        }
      }
    }
    stack.pop();
    state.set(node, 2);
  };

  for (const file of sourceFiles) {
    if (!state.get(file)) dfs(file);
  }

  return {
    passed: violations.length === 0,
    filesChecked: sourceFiles.length,
    violations,
    message:
      violations.length === 0
        ? `Concentric Clean Architecture verified (${sourceFiles.length} modules, 0 ring or cycle violations).`
        : `${violations.length} architectural violation(s) detected in ${policyPath}.`
  };
}
