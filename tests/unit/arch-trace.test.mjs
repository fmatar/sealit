import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  checkArchDiff,
  parseMermaidDiagram,
  diffMermaidGraphs,
  recordArchTrace,
  scaffoldArchlensPolicy
} from '../../.agent/scripts/lib/arch-trace.mjs';

describe('Unit: arch-trace.mjs', () => {
  let repoDir;
  let unbornSeed;

  function cloneUnborn(prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    fs.cpSync(unbornSeed, dir, { recursive: true });
    return dir;
  }

  before(() => {
    unbornSeed = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-unit-arch-seed-'));
    execFileSync('git', ['init', '-q', '-b', 'develop'], { cwd: unbornSeed, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: unbornSeed, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: unbornSeed, stdio: 'pipe' });

    repoDir = cloneUnborn('sdlc-unit-arch-git-');
    fs.mkdirSync(path.join(repoDir, 'src/domain'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'src/adapters'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'src/domain/entity.mjs'), 'export const E = 1;\n', 'utf8');
    fs.writeFileSync(path.join(repoDir, 'src/adapters/repo.mjs'), 'import { E } from "../domain/entity.mjs";\nexport const R = E;\n', 'utf8');
    fs.mkdirSync(path.join(repoDir, 'wiki'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'wiki/Architecture.md'), '# Arch\n```mermaid\nflowchart LR\n  A["Core"] --> B["App"]\n```\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['checkout', '-q', '-b', 'feature/issue-#12'], { cwd: repoDir, stdio: 'pipe' });
  });

  after(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(unbornSeed, { recursive: true, force: true });
  });

  beforeEach(() => {
    fs.rmSync(path.join(repoDir, '.archlens'), { recursive: true, force: true });
    fs.writeFileSync(path.join(repoDir, 'src/domain/entity.mjs'), 'export const E = 1;\n', 'utf8');
    fs.writeFileSync(path.join(repoDir, 'src/adapters/repo.mjs'), 'import { E } from "../domain/entity.mjs";\nexport const R = E;\n', 'utf8');
    fs.rmSync(path.join(repoDir, 'src/adapters/other.mjs'), { force: true });
    fs.rmSync(path.join(repoDir, 'src/adapters/third.mjs'), { force: true });
    fs.rmSync(path.join(repoDir, 'workbench-assets'), { recursive: true, force: true });
  });

  it('scaffolds native Archlens Clean Architecture policy across layers, levels, and omit dirs', () => {
    const res = scaffoldArchlensPolicy(repoDir);
    assert.equal(res.created, true);
    assert.equal(res.layersCount, 4);
    const policy = JSON.parse(fs.readFileSync(path.join(repoDir, '.archlens/policy.json'), 'utf8'));
    assert.equal(Array.isArray(policy.levels), true);
    assert.equal(policy.levels.length, 4);
    assert.deepEqual(policy.order, ['Domain', 'Application', 'Infrastructure', 'Web']);
    assert.ok(policy.omit.includes('workbench-assets'));
    assert.ok(policy.omit.includes('.stryker-tmp'));
  });

  it('parses Mermaid diagrams and computes exact node/edge diffs', () => {
    assert.deepEqual(parseMermaidDiagram(''), { nodes: [], edges: [], subgraphs: [] });
    const g1 = parseMermaidDiagram(`
flowchart TD
  subgraph Outer ["Ring 2"]
    A["API"] --> B["UseCase"]
    B -.->|uses| C("Domain")
  end
  C ==> D
  D --> E
`);
    assert.equal(g1.subgraphs.length, 1);
    assert.equal(g1.subgraphs[0].id, 'Outer');
    assert.ok(g1.nodes.some((n) => n.id === 'A' && n.label === 'API'));
    assert.ok(g1.edges.some((e) => e.from === 'A' && e.to === 'B' && e.type === '-->'));
    assert.ok(g1.edges.some((e) => e.from === 'B' && e.to === 'C' && e.label === 'uses'));
    assert.ok(g1.edges.some((e) => e.from === 'C' && e.to === 'D' && e.type === '==>'));
    assert.ok(g1.edges.some((e) => e.from === 'D' && e.to === 'E'));

    assert.equal(diffMermaidGraphs(g1, g1).hasChanges, false);
    const g2 = parseMermaidDiagram('flowchart TD\n  A["API"] --> F["NewNode"]\n');
    const diff = diffMermaidGraphs(g1, g2);
    assert.equal(diff.hasChanges, true);
    assert.ok(diff.addedNodes.some((n) => n.id === 'F'));
    assert.ok(diff.removedNodes.some((n) => n.id === 'B'));
    assert.ok(diff.addedEdges.some((e) => e.from === 'A' && e.to === 'F'));
  });

  it('detects layer inversions, dynamic imports, multi-node/self cycles, and respects omit + comments', () => {
    // Missing policy returns clean/unconfigured
    const unconfigured = checkArchDiff(repoDir);
    assert.equal(unconfigured.enabled, false);
    assert.equal(unconfigured.passed, true);

    fs.mkdirSync(path.join(repoDir, '.archlens'), { recursive: true });
    fs.writeFileSync(
      path.join(repoDir, '.archlens/policy.json'),
      JSON.stringify({
        layers: [
          { name: 'Domain', paths: ['src/domain/'], ring: 0 },
          { name: 'Adapters', paths: ['src/adapters/'], ring: 2 }
        ],
        omit: ['workbench-assets']
      }),
      'utf8'
    );

    // Outward -> Inward allowed & comment/template false positives stripped
    fs.writeFileSync(
      path.join(repoDir, 'src/domain/entity.mjs'),
      `// import { R } from '../adapters/repo.mjs';\nexport const msg = \`import { R } from '../adapters/repo.mjs';\`;\nexport const E = 1;\n`,
      'utf8'
    );
    const ok = checkArchDiff(repoDir);
    assert.equal(ok.enabled, true);
    assert.equal(ok.passed, true);
    assert.equal(ok.violationsCount, 0);

    // Dynamic import inversion from Ring 0 -> Ring 2 flagged
    fs.writeFileSync(
      path.join(repoDir, 'src/domain/entity.mjs'),
      `export async function bad() { return await import('../adapters/repo.mjs'); }\n`,
      'utf8'
    );
    const inv = checkArchDiff(repoDir);
    assert.equal(inv.passed, false);
    assert.ok(inv.violations.some((v) => v.type === 'LAYER_INVERSION' && v.sourceLayer === 'Domain' && v.targetLayer === 'Adapters'));

    // Reset inversion and introduce intra-ring 3-node cycle
    fs.writeFileSync(path.join(repoDir, 'src/domain/entity.mjs'), 'export const E = 1;\n', 'utf8');
    fs.writeFileSync(path.join(repoDir, 'src/adapters/repo.mjs'), 'import { O } from "./other.mjs";\nexport const R = O;\n', 'utf8');
    fs.writeFileSync(path.join(repoDir, 'src/adapters/other.mjs'), 'import { T } from "./third.mjs";\nexport const O = T;\n', 'utf8');
    fs.writeFileSync(path.join(repoDir, 'src/adapters/third.mjs'), 'import { R } from "./repo.mjs";\nexport const T = 1;\n', 'utf8');
    const cyclic = checkArchDiff(repoDir);
    assert.equal(cyclic.passed, false);
    assert.equal(cyclic.cyclesCount, 1);
    assert.ok(cyclic.violations.some((v) => v.type === 'CYCLE' && v.cycle.length >= 3));

    // Omitted directories do not report cycles
    fs.mkdirSync(path.join(repoDir, 'workbench-assets'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'workbench-assets/a.mjs'), 'import "./a.mjs";\n', 'utf8');
    fs.writeFileSync(path.join(repoDir, 'src/adapters/third.mjs'), 'export const T = 1;\n', 'utf8');
    const cleanOmitted = checkArchDiff(repoDir);
    assert.equal(cleanOmitted.passed, true);
  });

  it('records architectural traces with Mermaid diffs into docs/ARCH_TRACE.md and .agent/arch-trace.jsonl', () => {
    fs.writeFileSync(
      path.join(repoDir, 'wiki/Architecture.md'),
      '# Arch\n```mermaid\nflowchart LR\n  A["Core"] --> B["App"]\n  B --> C["Ledger"]\n```\n',
      'utf8'
    );
    const traced = recordArchTrace({ reason: 'Add Ledger edge', ticket: '#12', diagramPath: 'wiki/Architecture.md', repoRoot: repoDir });
    assert.equal(traced.success, true);
    assert.equal(traced.entry.ticket, '#12');
    assert.ok(traced.entry.diagramChanges.length === 1);
    assert.match(traced.entry.diagramChanges[0].summary, /Nodes: \+3\/-0, Edges: \+2\/-0/);
    assert.equal(fs.existsSync(path.join(repoDir, 'docs/ARCH_TRACE.md')), true);
    assert.equal(fs.existsSync(path.join(repoDir, '.agent/arch-trace.jsonl')), true);

    // Second trace reads previous MERMAID history & appends second entry
    fs.writeFileSync(
      path.join(repoDir, 'wiki/Architecture.md'),
      '# Arch\n```mermaid\nflowchart LR\n  A["Core"] --> B["App"]\n  B --> C["Ledger"]\n  C --> D["CLI"]\n```\n',
      'utf8'
    );
    const second = recordArchTrace({ reason: 'Add CLI edge', diagramPath: 'wiki/Architecture.md', repoRoot: repoDir });
    assert.equal(second.success, true);
    const lines = fs.readFileSync(path.join(repoDir, '.agent/arch-trace.jsonl'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
  });

  it('parses extended Mermaid syntax, ignores directives/comments, and checks levels-based & CJS/self-cycle inversions', () => {
    const g = parseMermaidDiagram(`
flowchart LR
  %% comment line ignored
  classDef box fill:#fff
  A(("Circle")) <-->|"bi"| B{"Decision"}
  B --- C(["Stadium"])
  C -->|"pipe label"| D[("Store")]
  style A fill:#000
`);
    assert.ok(g.nodes.some((n) => n.id === 'B' && n.label === 'Decision'));
    assert.ok(g.nodes.some((n) => n.id === 'D' && n.label === 'Store'));
    assert.ok(g.edges.some((e) => e.from === 'A' && e.to === 'B' && e.label.includes('bi')));
    assert.ok(g.edges.some((e) => e.from === 'C' && e.to === 'D' && e.label.includes('pipe label')));

    // Levels-based policy + CJS require + self-cycle detection
    fs.mkdirSync(path.join(repoDir, '.archlens'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'src/web'), { recursive: true });
    fs.writeFileSync(
      path.join(repoDir, '.archlens/policy.json'),
      JSON.stringify({
        order: ['Domain', 'Web'],
        levels: [['src/domain'], ['src/web']],
        omit: ['node_modules', 'workbench-assets']
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(repoDir, 'src/web/ctrl.mjs'), 'export const C = 1;\n', 'utf8');
    fs.writeFileSync(
      path.join(repoDir, 'src/domain/entity.mjs'),
      'const c = require("../web/ctrl");\nimport "./entity.mjs";\nexport { c };\n',
      'utf8'
    );
    const res = checkArchDiff(repoDir);
    assert.equal(res.passed, false);
    assert.ok(res.violations.some((v) => v.type === 'LAYER_INVERSION' && v.sourceLayer === 'Domain' && v.targetLayer === 'Web'));
    assert.ok(res.violations.some((v) => v.type === 'CYCLE'));
  });

  it('covers scaffold detection, allowedDependencies, dotted packages, subgraphs, and non-git recordArchTrace', () => {
    const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-unit-arch-extra-'));
    try {
      // TypeScript & Java detection in scaffoldArchlensPolicy + idempotent second call
      fs.writeFileSync(path.join(tmpA, 'tsconfig.json'), '{}', 'utf8');
      const tsScaf = scaffoldArchlensPolicy(tmpA);
      assert.equal(tsScaf.success, true);
      assert.equal(tsScaf.created, true);
      assert.equal(JSON.parse(fs.readFileSync(tsScaf.path, 'utf8')).lang, 'typescript');
      assert.equal(scaffoldArchlensPolicy(tmpA).created, false);

      const tmpJava = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-unit-arch-java-'));
      try {
        fs.writeFileSync(path.join(tmpJava, 'pom.xml'), '<project/>', 'utf8');
        const javaScaf = scaffoldArchlensPolicy(tmpJava);
        assert.equal(JSON.parse(fs.readFileSync(javaScaf.path, 'utf8')).lang, 'java');
      } finally {
        fs.rmSync(tmpJava, { recursive: true, force: true });
      }

      // allowedDependencies whitelist + dotted package imports + stripTemplates + comments
      fs.mkdirSync(path.join(tmpA, '.archlens'), { recursive: true });
      fs.mkdirSync(path.join(tmpA, 'src/domain'), { recursive: true });
      fs.mkdirSync(path.join(tmpA, 'src/application'), { recursive: true });
      fs.mkdirSync(path.join(tmpA, 'src/adapters'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpA, '.archlens/policy.json'),
        JSON.stringify({
          layers: [
            { name: 'Domain', paths: ['src/domain', 'domain'], allowedDependencies: [] },
            { name: 'Application', paths: ['src/application', 'application'], allowedDependencies: ['domain'] },
            { name: 'Adapters', paths: ['src/adapters', 'adapters'], allowedDependencies: ['application', 'domain'] }
          ],
          foreign: ['node:'],
          omit: ['node_modules']
        }),
        'utf8'
      );
      fs.cpSync(path.join(unbornSeed, '.git'), path.join(tmpA, '.git'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpA, 'src/domain/user.mjs'),
        'import fs from "node:fs";\n// import "../adapters/db.mjs";\nconst t = `import "../adapters/fake.mjs";`;\nimport adapters.db;\nexport { fs, t };\n',
        'utf8'
      );
      fs.writeFileSync(path.join(tmpA, 'src/adapters/db.mjs'), 'export const db = 1;\n', 'utf8');
      const archRes = checkArchDiff(tmpA);
      assert.equal(archRes.passed, false);
      assert.equal(archRes.violations.filter((v) => v.type === 'LAYER_INVERSION').length, 1);

      // parseMermaidDiagram with subgraph, hex, subroutine, dotted/thick arrows, and solo node
      const parsed = parseMermaidDiagram(`
flowchart TD
  subgraph Core["Core Layer"]
    D[["Domain"]] -.->|events| A{{"App"}}
  end
  A ==>|calls| I[("Infra")]
  Solo["Standalone"]
`);
      assert.equal(parsed.subgraphs.length, 1);
      assert.equal(parsed.subgraphs[0].label, 'Core Layer');
      assert.ok(parsed.nodes.some((n) => n.id === 'D' && n.label === 'Domain' && n.subgraph === 'Core'));
      assert.ok(parsed.nodes.some((n) => n.id === 'Solo' && n.label === 'Standalone'));
      assert.ok(parsed.edges.some((e) => e.from === 'D' && e.to === 'A' && e.label === 'events'));
      assert.ok(parsed.edges.some((e) => e.from === 'A' && e.to === 'I' && e.label === 'calls'));

      // recordArchTrace auto-discovering docs/architecture/system.mmd (.mmd non-markdown) without git
      fs.mkdirSync(path.join(tmpA, 'docs/architecture'), { recursive: true });
      fs.writeFileSync(path.join(tmpA, 'docs/architecture/system.mmd'), 'flowchart LR\n  X --> Y\n', 'utf8');
      const mmdTrace = recordArchTrace({ reason: 'Initial MMD', repoRoot: tmpA });
      assert.equal(mmdTrace.success, true);
      assert.equal(mmdTrace.entry.commitSha, 'UNCOMMITTED');
      assert.equal(mmdTrace.entry.branch, 'develop');
      assert.equal(mmdTrace.entry.diagramChanges.length, 1);

      // Missing policy passes closed + heuristic domain->infra fallback + scaffolded defaults
      fs.rmSync(path.join(tmpA, '.archlens'), { recursive: true, force: true });
      const noPol = checkArchDiff(tmpA);
      assert.equal(noPol.passed, true);
      assert.match(noPol.message, /Archlens policy not installed/);

      const scafRes = scaffoldArchlensPolicy(tmpA);
      assert.equal(scafRes.layersCount, 4);
      const writtenPol = JSON.parse(fs.readFileSync(scafRes.path, 'utf8'));
      assert.equal(writtenPol.title, path.basename(tmpA));
      assert.equal(writtenPol.hierarchical, true);
      assert.deepEqual(writtenPol.foreign, ['node:', '@types/']);
      assert.ok(writtenPol.omit.includes('node_modules'));

      // Heuristic fallback when layers is empty & domain_model imports database_client
      fs.writeFileSync(path.join(tmpA, '.archlens/policy.json'), JSON.stringify({ layers: [], omit: ['omit_me'] }), 'utf8');
      fs.mkdirSync(path.join(tmpA, 'src/core'), { recursive: true });
      fs.mkdirSync(path.join(tmpA, 'src/infra'), { recursive: true });
      fs.mkdirSync(path.join(tmpA, 'src/omit_me'), { recursive: true });
      fs.writeFileSync(path.join(tmpA, 'src/infra/database_client.mjs'), 'export const db = 1;\n', 'utf8');
      fs.writeFileSync(path.join(tmpA, 'src/core/domain_model.mjs'), 'import "../infra/database_client.mjs";\n', 'utf8');
      fs.writeFileSync(path.join(tmpA, 'src/omit_me/skip.mjs'), 'import "../infra/database_client.mjs";\n', 'utf8');
      const heur = checkArchDiff(tmpA);
      assert.equal(heur.passed, false);
      assert.ok(heur.violations.some((v) => v.targetLayer === 'Infrastructure' || v.type === 'LAYER_INVERSION'));
      assert.equal(heur.violations.some((v) => v.file.includes('omit_me')), false);

      // Base-commit filtering in checkArchDiff skips pre-existing develop imports
      const baseRepo = cloneUnborn('sdlc-unit-arch-base-');
      try {
        fs.mkdirSync(path.join(baseRepo, '.archlens'), { recursive: true });
        fs.mkdirSync(path.join(baseRepo, 'src/domain'), { recursive: true });
        fs.mkdirSync(path.join(baseRepo, 'src/web'), { recursive: true });
        fs.writeFileSync(
          path.join(baseRepo, '.archlens/policy.json'),
          JSON.stringify({ layers: [{ name: 'Domain', paths: ['src/domain'] }, { name: 'Web', paths: ['src/web'] }] }),
          'utf8'
        );
        fs.writeFileSync(path.join(baseRepo, 'src/web/ctrl.mjs'), 'export const C = 1;\n', 'utf8');
        fs.writeFileSync(path.join(baseRepo, 'src/domain/svc.mjs'), 'import "../web/ctrl.mjs";\nexport const S = 1;\n', 'utf8');
        execFileSync('git', ['add', '.'], { cwd: baseRepo, stdio: 'pipe' });
        execFileSync('git', ['commit', '-m', 'base with legacy import'], { cwd: baseRepo, stdio: 'pipe' });
        execFileSync('git', ['checkout', '-b', 'feature/issue-#22'], { cwd: baseRepo, stdio: 'pipe' });
        fs.writeFileSync(path.join(baseRepo, 'src/domain/svc.mjs'), 'import "../web/ctrl.mjs";\nexport const S = 2;\n', 'utf8');
        const noNewViolation = checkArchDiff(baseRepo, 'develop');
        assert.equal(noNewViolation.passed, true);
      } finally {
        fs.rmSync(baseRepo, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(tmpA, { recursive: true, force: true });
    }
  });

  it('covers order/array levels, invalid policy fallback, symlink/test skipping, TS/index import resolution, and Mermaid edge diffs', () => {
    const gRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-unit-arch-graph-'));
    try {
      // 1. Corrupt .archlens/policy.json falls back cleanly without throwing
      fs.mkdirSync(path.join(gRepo, '.archlens'), { recursive: true });
      fs.writeFileSync(path.join(gRepo, '.archlens/policy.json'), '{not-valid-json', 'utf8');
      const corruptRes = checkArchDiff(gRepo);
      assert.equal(corruptRes.enabled, true);
      assert.equal(corruptRes.passed, true);

      // 2. Policy with order + array levels, src: '.', cycle via .js->.ts, query stripping, index.mjs, symlink & test exclusion
      fs.cpSync(path.join(unbornSeed, '.git'), path.join(gRepo, '.git'), { recursive: true });
      fs.mkdirSync(path.join(gRepo, 'src/core'), { recursive: true });
      fs.mkdirSync(path.join(gRepo, 'src/app/sub'), { recursive: true });
      fs.mkdirSync(path.join(gRepo, 'ignored_dir'), { recursive: true });
      fs.mkdirSync(path.join(gRepo, '.agent/hidden'), { recursive: true });
      fs.writeFileSync(
        path.join(gRepo, '.archlens/policy.json'),
        JSON.stringify({
          src: '.',
          order: ['Domain', 'App'],
          levels: [['src/core'], ['src/app']],
          omit: ['ignored_dir']
        }),
        'utf8'
      );
      fs.writeFileSync(path.join(gRepo, 'src/core/a.ts'), 'import { b } from "../app/sub?raw";\nexport const a = b;\n', 'utf8');
      fs.writeFileSync(path.join(gRepo, 'src/app/sub/index.mjs'), 'import { a } from "../../core/a.js";\nexport const b = a;\n', 'utf8');
      fs.writeFileSync(path.join(gRepo, 'ignored_dir/skip.ts'), 'import { a } from "../src/core/a.ts";\n', 'utf8');
      // Test files and hidden .agent files must be ignored when .agent isn't configured in src/layers
      fs.writeFileSync(path.join(gRepo, 'src/core/a.test.ts'), 'import { b } from "../app/sub";\n', 'utf8');
      fs.writeFileSync(path.join(gRepo, '.agent/hidden/bad.mjs'), 'import { b } from "../../src/app/sub/index.mjs";\n', 'utf8');
      try {
        fs.symlinkSync(path.join(gRepo, 'src/core'), path.join(gRepo, 'src/core_link'));
      } catch {}

      const cycleRes = checkArchDiff(gRepo);
      assert.equal(cycleRes.passed, false);
      assert.equal(cycleRes.cyclesCount, 1);
      assert.ok(cycleRes.violations.some((v) => v.type === 'LAYER_INVERSION'));
      const cycleFiles = cycleRes.cycles.flat();
      assert.equal(cycleFiles.some((f) => f.includes('.test.')), false);
      assert.equal(cycleFiles.some((f) => f.includes('.agent/')), false);
      assert.equal(cycleFiles.some((f) => f.includes('ignored_dir')), false);
      assert.equal(cycleRes.violations.some((v) => v.file.includes('.agent/')), false);
      assert.equal(cycleRes.violations.some((v) => v.file.includes('ignored_dir')), false);

      // 3. parseMermaidDiagram edge chains, stadium/round/diamond shapes, comments, invalid inputs
      assert.deepEqual(parseMermaidDiagram(null), { nodes: [], edges: [], subgraphs: [] });
      assert.deepEqual(parseMermaidDiagram(''), { nodes: [], edges: [], subgraphs: [] });

      const rich = parseMermaidDiagram([
        '%% comment line',
        'graph LR',
        '  Start(["Boot"]);',
        '  Start -->|init| Mid("Process") -.->|branch| End{Done};'
      ].join('\n'));
      assert.equal(rich.nodes.length, 3);
      assert.equal(rich.nodes.find((n) => n.id === 'Start').label, 'Boot');
      assert.equal(rich.nodes.find((n) => n.id === 'Mid').label, 'Process');
      assert.equal(rich.nodes.find((n) => n.id === 'End').label, 'Done');
      assert.equal(rich.edges.length, 2);
      assert.equal(rich.edges[0].label, 'init');
      assert.equal(rich.edges[1].type, '-.->');
      assert.equal(rich.edges[1].label, 'branch');

      const identical = diffMermaidGraphs(rich, rich);
      assert.equal(identical.hasChanges, false);
      assert.deepEqual(identical.addedNodes, []);
      assert.deepEqual(identical.removedEdges, []);

      const modGraph = parseMermaidDiagram('flowchart LR\n  Start(["Boot"]) -->|changed| Mid("Process")\n  NewNode["Extra"]\n');
      const delta = diffMermaidGraphs(rich, modGraph);
      assert.equal(delta.hasChanges, true);
      assert.deepEqual(delta.addedNodes.map((n) => n.id), ['NewNode']);
      assert.deepEqual(delta.removedNodes.map((n) => n.id), ['End']);
      assert.equal(delta.addedEdges.length, 1);
      assert.equal(delta.removedEdges.length, 2);
    } finally {
      fs.rmSync(gRepo, { recursive: true, force: true });
    }
  });
});
