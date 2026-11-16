import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  fileExists,
  getModifiedFiles,
  gitOutput,
  normalizeTicketId,
  parseFrontmatter,
  readFileSafe,
  resolveDiffComparisonState,
  resolveEffectiveDiffBase,
  resolveInsideRepo,
  writeFileAtomic
} from './git.mjs';
import { appendAuditRecord } from './receipt.mjs';

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

export function listADRs(repoRoot = '.') {
  const adrDir = path.resolve(repoRoot, 'docs/adr');
  if (!fileExists(adrDir)) return [];
  const entries = fs
    .readdirSync(adrDir)
    .filter((name) => /^ADR-\d+.*\.md$/i.test(name))
    .sort();

  const out = [];
  for (const name of entries) {
    const abs = path.join(adrDir, name);
    const raw = readFileSafe(abs);
    if (raw === null) continue;
    const { frontmatter } = parseFrontmatter(raw);
    const idMatch = name.match(/^(ADR-\d+)/i);
    const id = (frontmatter.id || (idMatch ? idMatch[1] : name.replace(/\.md$/i, ''))).toUpperCase();
    out.push({
      id,
      title: frontmatter.title || id,
      scope: (frontmatter.scope || 'technical').toLowerCase(),
      status: (frontmatter.status || 'pending_approval').toLowerCase(),
      ticket: normalizeTicketId(frontmatter.ticket ?? frontmatter.ticketId),
      supersedes: parseListField(frontmatter.supersedes ?? frontmatter.affects),
      decidedBy: frontmatter.decidedBy || null,
      decidedAt: frontmatter.decidedAt || null,
      file: `docs/adr/${name}`,
      sha256: crypto.createHash('sha256').update(raw.replace(/\r\n/g, '\n')).digest('hex')
    });
  }
  return out;
}

function resolveNextAdrId(repoRoot = '.') {
  let maxNum = 0;
  const bump = (text) => {
    if (!text) return;
    for (const m of text.matchAll(/\bADR-(\d+)\b/gi)) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n > maxNum) maxNum = n;
    }
  };
  for (const adr of listADRs(repoRoot)) bump(adr.id);
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

  const id = resolveNextAdrId(repoRoot);
  const normTicket = normalizeTicketId(ticket) || 'N/A';
  const supList = parseListField(supersedes);
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

  let updated = raw.replace(/^status:\s*.*$/m, `status: ${nextStatus}`);
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

export function computeAlignmentHashes(repoRoot = '.') {
  const specHasher = crypto.createHash('sha256');
  const specFiles = ['PRODUCT.md', 'docs/PRD.md', 'docs/SRS.md', '.archlens/policy.json'];
  const specsDir = path.resolve(repoRoot, 'docs/specs');
  if (fileExists(specsDir)) {
    const entries = fs
      .readdirSync(specsDir)
      .filter((f) => f.endsWith('.md'))
      .sort();
    for (const e of entries) specFiles.push(`docs/specs/${e}`);
  }
  for (const rel of specFiles) {
    const abs = path.resolve(repoRoot, rel);
    if (fileExists(abs)) {
      const norm = (readFileSafe(abs) || '').replace(/\r\n/g, '\n');
      specHasher.update(`file:${rel}:${norm}\n`);
    }
  }

  const adrHasher = crypto.createHash('sha256');
  const acceptedAdrs = listADRs(repoRoot).filter((a) => a.status === 'accepted');
  for (const adr of acceptedAdrs) {
    adrHasher.update(`${adr.id}:${adr.sha256}\n`);
  }

  return {
    specHash: specHasher.digest('hex'),
    adrHashes: adrHasher.digest('hex')
  };
}

function readFileAtMergeBase(relFile, mergeBase, repoRoot) {
  if (!mergeBase) return null;
  return gitOutput(['show', `${mergeBase}:${relFile}`], repoRoot);
}

function hasPackageJsonStructuralDiff(relFile, mergeBase, repoRoot) {
  const absCur = path.resolve(repoRoot, relFile);
  if (!fileExists(absCur)) return false;
  let curPkg;
  try {
    curPkg = JSON.parse(fs.readFileSync(absCur, 'utf8'));
  } catch {
    return true;
  }
  const baseRaw = readFileAtMergeBase(relFile, mergeBase, repoRoot);
  if (baseRaw === null) {
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

function validateOpenApiContract(absPath, relFile) {
  const raw = readFileSafe(absPath);
  if (raw === null) return `Unable to read contract file '${relFile}'.`;
  if (/\.json$/i.test(relFile)) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return `Invalid JSON in API contract '${relFile}': ${err.message}`;
    }
    if (!parsed || typeof parsed !== 'object' || (!parsed.openapi && !parsed.swagger)) {
      return `Contract '${relFile}' is missing root 'openapi' or 'swagger' field.`;
    }
    return null;
  }

  const normalized = raw.replace(/\r\n/g, '\n');
  if (!/^(?:openapi|swagger)\s*:/m.test(normalized)) {
    return `YAML contract '${relFile}' is missing root 'openapi:' or 'swagger:' declaration.`;
  }
  let braces = 0;
  let brackets = 0;
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
      if (ch === '{') braces++;
      else if (ch === '}') braces--;
      else if (ch === '[') brackets++;
      else if (ch === ']') brackets--;
      if (braces < 0 || brackets < 0) {
        return `Malformed YAML flow brackets in '${relFile}'.`;
      }
    }
  }
  if (inSingle || inDouble || braces !== 0 || brackets !== 0) {
    return `Unbalanced quotes or brackets in YAML contract '${relFile}'.`;
  }
  return null;
}

export function checkSpecDrift({ ticketId = null, baseBranch = null, repoRoot = '.' } = {}) {
  const resolvedBase = resolveEffectiveDiffBase(baseBranch, repoRoot);
  const { mergeBase } = resolveDiffComparisonState(resolvedBase, repoRoot);
  const modifiedFiles = getModifiedFiles(resolvedBase, repoRoot);

  const triggers = [];
  const contractErrors = [];

  for (const rel of modifiedFiles) {
    const abs = path.resolve(repoRoot, rel);
    if (!fileExists(abs)) {
      if (/^(?:PRODUCT\.md|docs\/PRD\.md|docs\/SRS\.md|docs\/specs\/.+\.md|\.archlens\/policy\.json)$/.test(rel)) {
        triggers.push({ file: rel, type: 'SPEC_DELETED', scope: 'architectural' });
      }
      continue;
    }

    if (rel === 'PRODUCT.md' || rel === 'docs/PRD.md' || rel === 'docs/SRS.md' || /^docs\/specs\/.+\.md$/.test(rel)) {
      if (rel === 'PRODUCT.md' && mergeBase) {
        const baseProd = readFileAtMergeBase('PRODUCT.md', mergeBase, repoRoot);
        const curProd = readFileSafe(abs) || '';
        const stripIndex = (s) => String(s || '').replace(/\r\n/g, '\n').replace(/<!-- ADR_INDEX_START -->[\s\S]*?<!-- ADR_INDEX_END -->/, '').trim();
        if (baseProd !== null && stripIndex(baseProd) === stripIndex(curProd)) {
          continue;
        }
      }
      triggers.push({ file: rel, type: 'CONSTITUTION_OR_SPEC_DRIFT', scope: 'product' });
      continue;
    }

    if (rel === '.archlens/policy.json') {
      triggers.push({ file: rel, type: 'ARCHITECTURE_POLICY_DRIFT', scope: 'architectural' });
      continue;
    }

    if (/(?:^|\/)package\.json$/.test(rel)) {
      if (hasPackageJsonStructuralDiff(rel, mergeBase, repoRoot)) {
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
      const parseErr = validateOpenApiContract(abs, rel);
      if (parseErr) {
        contractErrors.push(parseErr);
        triggers.push({ file: rel, type: 'CONTRACT_PARSE_ERROR', scope: 'contract', error: parseErr });
      } else {
        triggers.push({ file: rel, type: 'API_CONTRACT_DRIFT', scope: 'contract' });
      }
    }
  }

  const allAdrs = listADRs(repoRoot);
  const normTicket = normalizeTicketId(ticketId);
  const diffAdrFiles = new Set(modifiedFiles.filter((f) => /^docs\/adr\/ADR-\d+.*\.md$/i.test(f)));

  const relevantAdrs = allAdrs.filter((a) => {
    if (normTicket && a.ticket === normTicket) return true;
    if (diffAdrFiles.has(a.file)) return true;
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
  return String(source || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
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

export function checkArchRings({ repoRoot = '.', policyPath = '.archlens/policy.json' } = {}) {
  const absRoot = path.resolve(repoRoot);
  const absPolicy = resolveInsideRepo(absRoot, policyPath);
  if (!fileExists(absPolicy)) {
    return { passed: true, violations: [], message: 'No .archlens/policy.json configured; skipping ring check.' };
  }

  let policy;
  try {
    policy = JSON.parse(fs.readFileSync(absPolicy, 'utf8'));
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
  const srcRel = policy.src || '.';
  const absSrc = resolveInsideRepo(absRoot, srcRel);
  if (!fileExists(absSrc)) {
    return { passed: true, violations: [], message: `Source root '${srcRel}' not present.` };
  }

  const resolveRing = (relFile) => {
    for (let i = 0; i < levels.length; i++) {
      const patterns = Array.isArray(levels[i]) ? levels[i] : [];
      if (patterns.some((pat) => patternMatchesPath(pat, relFile))) return i;
    }
    return -1;
  };

  const sourceFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (omitSet.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(absRoot, full).replace(/\\/g, '/');
      if ([...omitSet].some((o) => rel === o || rel.startsWith(`${o}/`))) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && SOURCE_EXTS.includes(path.extname(entry.name).toLowerCase())) {
        sourceFiles.push(rel);
      }
    }
  };
  walk(absSrc);
  sourceFiles.sort();

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
    const raw = readFileSafe(path.join(absRoot, rel)) || '';
    const edges = [];
    for (const spec of extractRelativeSpecifiers(raw)) {
      const targetRel = resolveImportTarget(path.join(absRoot, rel), spec, absRoot);
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
