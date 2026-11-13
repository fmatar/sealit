import fs from 'node:fs';
import path from 'node:path';
import { fileExists, normalizeTicketId, parseTicketId, readFileSafe, resolveInsideRepo, writeFileAtomic } from './core.mjs';
import { parseProductMarkdown } from './product-dag.mjs';
import { listADRs } from './adr-drift.mjs';

export function extractExportSignatures(fileContent = '') {
  const exports = [];
  const lines = String(fileContent || '').split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(
      /^export\s+(?:async\s+)?(?:function|class|const|let|interface|type)\s+([A-Za-z0-9_]+)/
    );
    if (match) {
      exports.push(match[1]);
    }
  }
  return exports;
}

export function generateTicketDossier({
  issueId,
  capabilityId = null,
  targetFiles = [],
  repoRoot = '.'
} = {}) {
  const dossierDir = path.resolve(repoRoot, '.agent/dossiers');
  fs.mkdirSync(dossierDir, { recursive: true });

  const product = parseProductMarkdown(repoRoot);
  const allAdrs = listADRs(repoRoot);

  const normCapId = capabilityId ? String(capabilityId).trim().toUpperCase() : null;
  const matchedCap =
    (normCapId
      ? product.capabilities.find((c) => String(c.id).toUpperCase() === normCapId)
      : product.capabilities[0]) || null;

  let specExcerpt = '';
  if (matchedCap && matchedCap.spec) {
    try {
      const specPath = resolveInsideRepo(repoRoot, matchedCap.spec);
      if (fileExists(specPath)) {
        specExcerpt = (readFileSafe(specPath) || '').slice(0, 1200);
      }
    } catch {}
  }

  const normQueryIssue = normalizeTicketId(issueId);
  const activeADRs = allAdrs
    .filter((a) => {
      if (a.status !== 'accepted') return false;
      if (!normCapId && !normQueryIssue) return true;
      if (normCapId && (a.supersedes || []).some((s) => String(s).trim().toUpperCase() === normCapId)) return true;
      if (normQueryIssue && normalizeTicketId(a.ticketId) === normQueryIssue) return true;
      return false;
    })
    .map((a) => ({
      id: a.id,
      title: a.title,
      scope: a.scope,
      supersedes: a.supersedes,
      file: a.file
    }));

  const fileSignatures = [];
  for (const relFile of targetFiles) {
    let full;
    try {
      full = resolveInsideRepo(repoRoot, relFile);
    } catch {
      continue;
    }
    if (fileExists(full)) {
      const content = readFileSafe(full) || '';
      const exports = extractExportSignatures(content);
      fileSignatures.push({
        file: relFile,
        linesCount: content.split('\n').length,
        exports
      });
    }
  }

  const resolvedIssueId = parseTicketId(issueId) ?? issueId;
  const safeIssueSlug = String(normQueryIssue ?? issueId ?? 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');

  const dossier = {
    generatedAt: new Date().toISOString(),
    issueId: resolvedIssueId,
    capability: matchedCap,
    invariants: product.invariants || [],
    activeADRs,
    specExcerpt,
    fileSignatures
  };

  const jsonPath = path.join(dossierDir, `issue-${safeIssueSlug}.json`);
  const markdownPath = path.join(dossierDir, `issue-${safeIssueSlug}.md`);

  writeFileAtomic(jsonPath, JSON.stringify(dossier, null, 2));

  const md = `# 📦 Context-Compressed Subagent Dossier: Ticket #${resolvedIssueId}

- **Capability**: \`${matchedCap ? matchedCap.id + ' - ' + matchedCap.title : 'N/A'}\`
- **Spec Contract**: \`${matchedCap?.spec || 'N/A'}\`
- **Active ADRs**: ${activeADRs.map((a) => `\`${a.id}\` (${a.title})`).join(', ') || 'None'}

## 🛡️ Hard Invariants
${(product.invariants || []).map((inv) => `- **${inv.id}**: ${inv.text}`).join('\n') || '- Standard SDLC Dual-Gate Invariants'}

## 📋 Capability Spec & IEEE 29148 SRS Excerpt
${specExcerpt ? specExcerpt.trim() : '_No capability spec excerpt found._'}

## 📄 Target File Export Signatures
${fileSignatures.map((f) => `- \`${f.file}\` (${f.linesCount} lines): exports \`[${f.exports.join(', ')}]\``).join('\n') || '- No target files pre-scanned'}
`;

  writeFileAtomic(markdownPath, md);

  return {
    success: true,
    dossier,
    jsonPath,
    markdownPath
  };
}
