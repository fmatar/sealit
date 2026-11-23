import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTempGitRepo, git } from '../helpers/test-harness.mjs';
import { isDocsOnlyDiff, readChangeSet, resolveRange } from '../../.agent/scripts/lib/git.mjs';
import { formatMutantIdentity } from '../../.agent/scripts/lib/config.mjs';
import { checkSpecDrift, createADR } from '../../.agent/scripts/lib/drift.mjs';
import { runGate } from '../../.agent/scripts/lib/measure.mjs';
import { beginSession, buildReviewPlan, verifyPushGuard } from '../../.agent/scripts/lib/guard.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const HOSTILE_MATRIX = [
  { label: 'default', cfg: null, env: null },
  { label: 'diff.noprefix', cfg: ['diff.noprefix', 'true'], env: null },
  { label: 'diff.mnemonicPrefix', cfg: ['diff.mnemonicPrefix', 'true'], env: null },
  { label: 'diff.external=echo', cfg: ['diff.external', 'echo'], env: null },
  { label: 'diff.renames=copies', cfg: ['diff.renames', 'copies'], env: null },
  { label: 'diff.srcPrefix=X/', cfg: ['diff.srcPrefix', 'X/'], env: null },
  { label: 'diff.context=10', cfg: ['diff.context', '10'], env: null },
  { label: 'GIT_EXTERNAL_DIFF=echo', cfg: null, env: ['GIT_EXTERNAL_DIFF', 'echo'] },
  { label: 'GIT_LITERAL_PATHSPECS=1', cfg: null, env: ['GIT_LITERAL_PATHSPECS', '1'] }
];

const FAKE_SECRET = ['AKIA', '9999888877776666'].join('');

let baselineCacheDir = null;
process.once('exit', () => {
  if (baselineCacheDir) {
    try { fs.rmSync(baselineCacheDir, { recursive: true, force: true }); } catch {}
  }
});

function getOrBuildCorpusTemplate() {
  if (baselineCacheDir && fs.existsSync(path.join(baselineCacheDir, '.git', 'HEAD'))) return baselineCacheDir;
  const { dir } = createTempGitRepo();
  fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.archlens'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs/specs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs/adr'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });

  fs.writeFileSync(
    path.join(dir, '.agent/sealit-config.json'),
    JSON.stringify({
      version: '0.1.0',
      archlens: { enabled: false, policyPath: '.archlens/policy.json' },
      modules: [{ name: 'root', path: '.', commands: {}, thresholds: { diffCoverage: null, mutationScore: null } }]
    }, null, 2) + '\n',
    'utf8'
  );
  fs.writeFileSync(path.join(dir, '.archlens/policy.json'), '{"src":"src","order":["core"],"levels":[["src/**"]]}\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'PRODUCT.md'), '# Product Constitution\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'docs/specs/x.md'), '# Spec X\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'docs/AUDIT_CHAIN.jsonl'), '', 'utf8');
  fs.writeFileSync(
    path.join(dir, 'docs/adr/ADR-001-base.md'),
    '---\nid: ADR-001\ntitle: Base Decision\nstatus: accepted\nscope: technical\nticket: "1"\n---\n\n# ADR-001\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(dir, 'docs/adr/ADR-002-old.md'),
    '---\nid: ADR-002\ntitle: Superseded Decision\nstatus: superseded\nscope: technical\nticket: "1"\n---\n\n# ADR-002\n',
    'utf8'
  );
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'victim', version: '0.1.0', dependencies: {} }, null, 2) + '\n', 'utf8');
  const twentyLines = Array.from({ length: 20 }, (_, i) => `export const c${i} = ${i};`).join('\n') + '\n';
  fs.writeFileSync(path.join(dir, 'src/core.js'), twentyLines, 'utf8');

  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'chore: baseline fixture');
  git(dir, 'branch', '-f', 'main', 'HEAD');
  beginSession({ issueId: '77', title: 'Corpus Case', checkout: true, repoRoot: dir });
  baselineCacheDir = dir;
  return dir;
}

function seedBaselineRepo(extraSetup = null) {
  const tpl = getOrBuildCorpusTemplate();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-corpus-'));
  fs.cpSync(tpl, dir, { recursive: true });
  cleanups.push(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });
  if (extraSetup) {
    git(dir, 'checkout', '-q', 'develop');
    extraSetup(dir);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'chore: extra baseline');
    git(dir, 'branch', '-f', 'main', 'HEAD');
    git(dir, 'checkout', '-q', '-B', 'feat/issue-77-corpus-case', 'develop');
  }
  return dir;
}

const CASES = [
  {
    id: '1: git mv docs/specs/x.md docs/archive/x.md -> drift fails SPEC_DELETED',
    setup() {
      const dir = seedBaselineRepo();
      fs.mkdirSync(path.join(dir, 'docs/archive'), { recursive: true });
      git(dir, 'mv', 'docs/specs/x.md', 'docs/archive/x.md');
      git(dir, 'commit', '-q', '-m', 'attack 1');
      return dir;
    },
    expect: {
      gate: false,
      prepush: false,
      docsOnly: false,
      driftCheck: (d) => d.passed === false && d.triggers.some((t) => t.type === 'SPEC_DELETED' && t.file === 'docs/specs/x.md')
    }
  },
  {
    id: '2: git mv PRODUCT.md docs/PRODUCT-v1.md -> drift fails',
    setup() {
      const dir = seedBaselineRepo();
      git(dir, 'mv', 'PRODUCT.md', 'docs/PRODUCT-v1.md');
      git(dir, 'commit', '-q', '-m', 'attack 2');
      return dir;
    },
    expect: { gate: false, prepush: false, docsOnly: false, drift: false }
  },
  {
    id: '3: case-only git mv docs/AUDIT_CHAIN.jsonl docs/audit_chain.jsonl -> drift fails ("cannot be deleted")',
    setup() {
      const dir = seedBaselineRepo();
      git(dir, 'mv', '-f', 'docs/AUDIT_CHAIN.jsonl', 'docs/audit_chain.tmp.jsonl');
      git(dir, 'mv', '-f', 'docs/audit_chain.tmp.jsonl', 'docs/audit_chain.jsonl');
      git(dir, 'commit', '-q', '-m', 'attack 3');
      return dir;
    },
    expect: {
      gate: false,
      prepush: false,
      docsOnly: false,
      driftCheck: (d) => d.passed === false && /cannot be deleted/i.test(d.message)
    }
  },
  {
    id: '4: git mv src/core.js docs/core.md -> docsOnly false',
    setup() {
      const dir = seedBaselineRepo();
      git(dir, 'mv', 'src/core.js', 'docs/core.md');
      git(dir, 'commit', '-q', '-m', 'attack 4');
      return dir;
    },
    expect: { docsOnly: false }
  },
  {
    id: '5: delete .archlens/policy.json -> drift fails',
    setup() {
      const dir = seedBaselineRepo();
      git(dir, 'rm', '-q', '.archlens/policy.json');
      git(dir, 'commit', '-q', '-m', 'attack 5');
      return dir;
    },
    expect: { gate: false, prepush: false, docsOnly: false, drift: false }
  },
  {
    id: '6: edit an ADR accepted at base, plus a dependency -> drift fails',
    setup() {
      const dir = seedBaselineRepo();
      fs.appendFileSync(path.join(dir, 'docs/adr/ADR-001-base.md'), '\nAmended sneaky note\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'victim', version: '0.1.0', dependencies: { chalk: '^5.0.0' } }, null, 2) + '\n', 'utf8');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'attack 6');
      return dir;
    },
    expect: { gate: false, prepush: false, drift: false }
  },
  {
    id: '7: rename an ADR accepted at base, plus a dependency -> drift fails',
    setup() {
      const dir = seedBaselineRepo();
      git(dir, 'mv', 'docs/adr/ADR-001-base.md', 'docs/adr/ADR-001-renamed.md');
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'victim', version: '0.1.0', dependencies: { chalk: '^5.0.0' } }, null, 2) + '\n', 'utf8');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'attack 7');
      return dir;
    },
    expect: { gate: false, prepush: false, drift: false }
  },
  {
    id: '8: flip an ADR superseded at base back to accepted -> drift fails',
    setup() {
      const dir = seedBaselineRepo();
      const p = path.join(dir, 'docs/adr/ADR-002-old.md');
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('status: superseded', 'status: accepted'), 'utf8');
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'victim', version: '0.1.0', dependencies: { chalk: '^5.0.0' } }, null, 2) + '\n', 'utf8');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'attack 8');
      return dir;
    },
    expect: { gate: false, prepush: false, drift: false }
  },
  {
    id: '9: new ADR reusing a base id -> drift fails ADR_ID_COLLISION',
    setup() {
      const dir = seedBaselineRepo();
      fs.writeFileSync(
        path.join(dir, 'docs/adr/ADR-001-duplicate.md'),
        '---\nid: ADR-001\ntitle: Reused ID\nstatus: accepted\nscope: technical\nticket: "77"\n---\n\n# ADR-001\n',
        'utf8'
      );
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'victim', version: '0.1.0', dependencies: { chalk: '^5.0.0' } }, null, 2) + '\n', 'utf8');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'attack 9');
      return dir;
    },
    expect: {
      gate: false,
      prepush: false,
      driftCheck: (d) => d.passed === false && d.triggers.some((t) => t.type === 'ADR_ID_COLLISION') && /ADR_ID_COLLISION/.test(d.message)
    }
  },
  {
    id: '10: secret committed, then reverted only in the working tree -> pre-push and gate fail',
    setup() {
      const dir = seedBaselineRepo();
      fs.writeFileSync(path.join(dir, 'src/leak.mjs'), `export const k = "${FAKE_SECRET}";\n`, 'utf8');
      git(dir, 'add', 'src/leak.mjs');
      git(dir, 'commit', '-q', '-m', 'attack 10');
      fs.unlinkSync(path.join(dir, 'src/leak.mjs'));
      return dir;
    },
    expect: { gate: false, prepush: false }
  },
  {
    id: '11: secret next to a :!src/leak.mjs file -> gate and pre-push fail',
    setup() {
      const dir = seedBaselineRepo();
      fs.mkdirSync(path.join(dir, ':!src'), { recursive: true });
      fs.writeFileSync(path.join(dir, ':!src/leak.mjs'), '// decoy\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'src/leak.mjs'), `export const k = "${FAKE_SECRET}";\n`, 'utf8');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'attack 11');
      return dir;
    },
    expect: { gate: false, prepush: false }
  },
  {
    id: '12: secret in a CRLF / NUL-padded / .gitattributes binary text file -> gate and pre-push fail',
    setup() {
      const dir = seedBaselineRepo();
      fs.writeFileSync(path.join(dir, '.gitattributes'), '*.mjs binary\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'src/bin-text.mjs'), Buffer.from(`\x00export const k = "${FAKE_SECRET}";\r\n\x00`, 'latin1'));
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'attack 12');
      return dir;
    },
    expect: { gate: false, prepush: false }
  },
  {
    id: '13: secret in a moved file (-M pairing) -> gate and pre-push fail',
    setup() {
      const dir = seedBaselineRepo();
      git(dir, 'mv', 'src/core.js', 'src/moved.js');
      fs.appendFileSync(path.join(dir, 'src/moved.js'), `export const k = "${FAKE_SECRET}";\n`, 'utf8');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'attack 13');
      return dir;
    },
    expect: { gate: false, prepush: false }
  },
  {
    id: '14: mode-only change (chmod +x) on a governance file -> no crash; not docs-only',
    setup() {
      const dir = seedBaselineRepo();
      git(dir, 'update-index', '--chmod=+x', 'PRODUCT.md');
      git(dir, 'commit', '-q', '-m', 'attack 14');
      return dir;
    },
    expect: { docsOnly: false }
  },
  {
    id: '15: a gitlink (submodule) or symlink entry under docs/ -> not docs-only',
    setup() {
      const dir = seedBaselineRepo();
      fs.symlinkSync('../README.md', path.join(dir, 'docs/sym.md'));
      const baseSha = git(dir, 'rev-parse', 'develop').stdout.trim();
      git(dir, 'add', 'docs/sym.md');
      git(dir, 'update-index', '--add', '--cacheinfo', `160000,${baseSha},docs/gitlink.md`);
      git(dir, 'commit', '-q', '-m', 'attack 15');
      return dir;
    },
    expect: { docsOnly: false }
  },
  {
    id: '16: in-repo symlink PRODUCT.md -> docs/PRODUCT.md, unchanged -> no false SPEC_DELETED',
    setup() {
      const dir = seedBaselineRepo((d) => {
        fs.unlinkSync(path.join(d, 'PRODUCT.md'));
        fs.writeFileSync(path.join(d, 'docs/PRODUCT.md'), '# Linked Constitution\n', 'utf8');
        fs.symlinkSync('docs/PRODUCT.md', path.join(d, 'PRODUCT.md'));
      });
      fs.writeFileSync(path.join(dir, 'src/feature.js'), 'export const ok = true;\n', 'utf8');
      git(dir, 'add', 'src/feature.js');
      git(dir, 'commit', '-q', '-m', 'case 16: clean feature commit');
      return dir;
    },
    expect: { gate: true, prepush: true, drift: true, docsOnly: false }
  },
  {
    id: '17: uncommitted status: accepted edit to an ADR -> gate/commit drift unaffected (reads the commit)',
    setup() {
      const dir = seedBaselineRepo();
      fs.writeFileSync(path.join(dir, 'PRODUCT.md'), '# Updated Constitution\n', 'utf8');
      const created = createADR({ title: 'Uncommitted Approval Trick', scope: 'product', ticket: '77', repoRoot: dir });
      git(dir, 'add', 'PRODUCT.md', created.file, 'docs/AUDIT_CHAIN.jsonl');
      git(dir, 'commit', '-q', '-m', 'attack 17');
      // Mutate status to accepted ONLY on disk without committing
      const absAdr = path.join(dir, created.file);
      fs.writeFileSync(absAdr, fs.readFileSync(absAdr, 'utf8').replace('status: pending_approval', 'status: accepted'), 'utf8');
      return dir;
    },
    expect: { gate: false, prepush: false, drift: false }
  },
  {
    id: '18: lowering diffCoverage in the PR does not lower the gate floor',
    setup() {
      const dir = seedBaselineRepo((d) => {
        fs.mkdirSync(path.join(d, 'tests'), { recursive: true });
        fs.writeFileSync(
          path.join(d, 'tests/cov50.mjs'),
          "import fs from 'node:fs'; fs.mkdirSync('coverage', { recursive: true }); fs.writeFileSync('coverage/lcov.info', 'SF:src/low.mjs\\nDA:1,1\\nDA:2,0\\nLF:2\\nLH:1\\nend_of_record\\n');\n",
          'utf8'
        );
        fs.writeFileSync(
          path.join(d, '.agent/sealit-config.json'),
          JSON.stringify({
            version: '0.1.0',
            archlens: { enabled: false, policyPath: '.archlens/policy.json' },
            modules: [{ name: 'root', path: '.', commands: { coverage: `${process.execPath} tests/cov50.mjs` }, thresholds: { diffCoverage: 85, mutationScore: null } }]
          }, null, 2) + '\n',
          'utf8'
        );
      });
      fs.writeFileSync(path.join(dir, 'src/low.mjs'), 'export const a = 1;\nexport const b = 2;\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, '.agent/sealit-config.json'),
        JSON.stringify({
          version: '0.1.0',
          archlens: { enabled: false, policyPath: '.archlens/policy.json' },
          modules: [{ name: 'root', path: '.', commands: { coverage: `${process.execPath} tests/cov50.mjs` }, thresholds: { diffCoverage: 10, mutationScore: null } }]
        }, null, 2) + '\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(dir, 'docs/adr/ADR-003-lower-cov.md'),
        '---\nid: ADR-003\ntitle: Lower Coverage\nstatus: accepted\nscope: architectural\nticket: "77"\n---\n\n# ADR-003\n',
        'utf8'
      );
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'attack 18');
      return dir;
    },
    expect: {
      gate: false,
      gateCheck: (g) => g.passed === false && /below threshold 85%/i.test(g.modules?.[0]?.error || '')
    }
  },
  {
    id: '19: archlens.enabled:false in the PR still checks rings',
    setup() {
      const dir = seedBaselineRepo((d) => {
        fs.writeFileSync(
          path.join(d, '.archlens/policy.json'),
          JSON.stringify({ src: 'src', order: ['core', 'adapters'], levels: [['src/core/**'], ['src/adapters/**']] }) + '\n',
          'utf8'
        );
        fs.writeFileSync(
          path.join(d, '.agent/sealit-config.json'),
          JSON.stringify({
            version: '0.1.0',
            archlens: { enabled: true, policyPath: '.archlens/policy.json' },
            modules: [{ name: 'root', path: '.', commands: {}, thresholds: { diffCoverage: null, mutationScore: null } }]
          }, null, 2) + '\n',
          'utf8'
        );
      });
      fs.mkdirSync(path.join(dir, 'src/core'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'src/adapters'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src/adapters/out.mjs'), 'export const out = 1;\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'src/core/bad.mjs'), "import { out } from '../adapters/out.mjs';\nexport const x = out;\n", 'utf8');
      fs.writeFileSync(
        path.join(dir, '.agent/sealit-config.json'),
        JSON.stringify({
          version: '0.1.0',
          archlens: { enabled: false, policyPath: '.archlens/policy.json' },
          modules: [{ name: 'root', path: '.', commands: {}, thresholds: { diffCoverage: null, mutationScore: null } }]
        }, null, 2) + '\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(dir, 'docs/adr/ADR-003-disable-arch.md'),
        '---\nid: ADR-003\ntitle: Disable Arch\nstatus: accepted\nscope: architectural\nticket: "77"\n---\n\n# ADR-003\n',
        'utf8'
      );
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'attack 19');
      return dir;
    },
    expect: {
      gate: false,
      gateCheck: (g) => g.passed === false && g.arch?.passed === false
    }
  },
  {
    id: '20: narrowing stryker mutate keeps the base scope',
    setup() {
      const dir = seedBaselineRepo((d) => {
        fs.mkdirSync(path.join(d, 'tests/helpers'), { recursive: true });
        fs.writeFileSync(
          path.join(d, 'tests/helpers/mock-stryker.mjs'),
          `import fs from 'node:fs';
           const mIdx = process.argv.indexOf('-m');
           const targets = mIdx >= 0 ? process.argv[mIdx + 1] : '';
           const sneaky = targets.includes('src/sneaky.mjs');
           fs.mkdirSync('reports/mutation', { recursive: true });
           fs.writeFileSync('reports/mutation/mutation.json', JSON.stringify({
             files: {
               'src/sneaky.mjs': {
                 mutants: [{ id: '1', mutatorName: 'BooleanLiteral', replacement: 'false', status: sneaky ? 'Survived' : 'Killed', location: { start: { line: 1, column: 0 } } }]
               }
             }
           }));\n`,
          'utf8'
        );
        fs.writeFileSync(path.join(d, 'stryker.config.json'), JSON.stringify({ mutate: ['src/**/*.mjs'] }) + '\n', 'utf8');
        fs.writeFileSync(
          path.join(d, '.agent/sealit-config.json'),
          JSON.stringify({
            version: '0.1.0',
            archlens: { enabled: false, policyPath: '.archlens/policy.json' },
            modules: [{ name: 'root', path: '.', commands: { mutation: `${process.execPath} tests/helpers/mock-stryker.mjs run` }, thresholds: { diffCoverage: null, mutationScore: 80 } }]
          }, null, 2) + '\n',
          'utf8'
        );
      });
      fs.writeFileSync(path.join(dir, 'src/sneaky.mjs'), 'export const ok = true;\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'stryker.config.json'), JSON.stringify({ mutate: ['src/core.mjs', '!src/sneaky.mjs'] }) + '\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, 'docs/adr/ADR-003-narrow-mutate.md'),
        '---\nid: ADR-003\ntitle: Narrow Mutate\nstatus: accepted\nscope: architectural\nticket: "77"\n---\n\n# ADR-003\n',
        'utf8'
      );
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'attack 20');
      return dir;
    },
    expect: { gate: false }
  },
  {
    id: '21: exemption added in the PR is pending, not applied, and forces the security reviewer',
    setup() {
      const survivor = {
        id: '1',
        mutatorName: 'ConditionalExpression',
        replacement: 'false',
        status: 'Survived',
        location: { start: { line: 1, column: 13 } }
      };
      const stableId = formatMutantIdentity(survivor);
      const dir = seedBaselineRepo((d) => {
        fs.mkdirSync(path.join(d, 'tests/helpers'), { recursive: true });
        fs.writeFileSync(
          path.join(d, 'tests/helpers/survive-stryker.mjs'),
          `import fs from 'node:fs';
           fs.mkdirSync('reports/mutation', { recursive: true });
           fs.writeFileSync('reports/mutation/mutation.json', JSON.stringify({ files: { 'src/app.mjs': { mutants: [${JSON.stringify(survivor)}] } } }));\n`,
          'utf8'
        );
        fs.writeFileSync(path.join(d, 'stryker.config.json'), JSON.stringify({ mutate: ['src/**/*.mjs'] }) + '\n', 'utf8');
        fs.writeFileSync(
          path.join(d, '.agent/sealit-config.json'),
          JSON.stringify({
            version: '0.1.0',
            archlens: { enabled: false, policyPath: '.archlens/policy.json' },
            modules: [{ name: 'root', path: '.', commands: { mutation: `${process.execPath} tests/helpers/survive-stryker.mjs run` }, thresholds: { diffCoverage: null, mutationScore: 80 } }],
            exemptions: []
          }, null, 2) + '\n',
          'utf8'
        );
      });
      fs.writeFileSync(path.join(dir, 'src/app.mjs'), 'export const v = true ? 1 : 0;\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, '.agent/sealit-config.json'),
        JSON.stringify({
          version: '0.1.0',
          archlens: { enabled: false, policyPath: '.archlens/policy.json' },
          modules: [{ name: 'root', path: '.', commands: { mutation: `${process.execPath} tests/helpers/survive-stryker.mjs run` }, thresholds: { diffCoverage: null, mutationScore: 80 } }],
          exemptions: [{ id: stableId, file: 'src/app.mjs', reason: 'Self-waived in same PR', addedAt: '2026-11-18T00:00:00Z' }]
        }, null, 2) + '\n',
        'utf8'
      );
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'attack 21');
      return dir;
    },
    expect: {
      drift: true,
      gate: false,
      gateCheck: (g, dir) => {
        const plan = buildReviewPlan(dir, { baseBranch: 'develop' });
        return (
          g.pendingExemptions?.length === 1 &&
          g.modules?.[0]?.mutation?.exempted === 0 &&
          plan.pendingExemptions?.length === 1 &&
          plan.reviewers.some((r) => r.role === 'Architecture & Security Reviewer')
        );
      }
    }
  },
  {
    id: '22: changing a command or editing the vendored engine raises GATE_POLICY_DRIFT',
    setup() {
      const dir = seedBaselineRepo((d) => {
        fs.mkdirSync(path.join(d, '.agent/scripts'), { recursive: true });
        fs.writeFileSync(path.join(d, '.agent/scripts/sealit-engine.mjs'), '// vendored engine\n', 'utf8');
        fs.writeFileSync(
          path.join(d, '.agent/sealit-config.json'),
          JSON.stringify({
            version: '0.1.0',
            archlens: { enabled: false, policyPath: '.archlens/policy.json' },
            modules: [{ name: 'root', path: '.', commands: { test: `${process.execPath} -e "process.exit(0)"` }, thresholds: { diffCoverage: null, mutationScore: null } }]
          }, null, 2) + '\n',
          'utf8'
        );
      });
      // Attempt to weaken commands.test, tamper with vendored engine, AND spoof package.json name to sealit!
      fs.writeFileSync(path.join(dir, '.agent/scripts/sealit-engine.mjs'), '// tampered engine\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'sealit', version: '0.0.1', dependencies: {} }, null, 2) + '\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, '.agent/sealit-config.json'),
        JSON.stringify({
          version: '0.1.0',
          archlens: { enabled: false, policyPath: '.archlens/policy.json' },
          modules: [{ name: 'root', path: '.', commands: { test: `${process.execPath} -e "process.exit(0)" --no-warnings` }, thresholds: { diffCoverage: null, mutationScore: null } }]
        }, null, 2) + '\n',
        'utf8'
      );
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'attack 22');
      return dir;
    },
    expect: {
      gate: false,
      prepush: false,
      driftCheck: (d) =>
        d.passed === false &&
        d.triggers.some((t) => t.type === 'GATE_POLICY_DRIFT' && t.file === '.agent/sealit-config.json') &&
        d.triggers.some((t) => t.type === 'GATE_POLICY_DRIFT' && t.file === '.agent/scripts/sealit-engine.mjs')
    }
  }
];

describe('Adversarial Gate Bypass Corpus (ADR-020 & ADR-021)', () => {
  for (const tc of CASES) {
    it(tc.id, () => {
      const dir = tc.setup();
      for (const setting of HOSTILE_MATRIX) {
        const savedEnv = {};
        const setTmpEnv = (k, v) => {
          savedEnv[k] = Object.prototype.hasOwnProperty.call(process.env, k) ? process.env[k] : undefined;
          process.env[k] = v;
        };
        if (setting.cfg) {
          setTmpEnv('GIT_CONFIG_COUNT', '1');
          setTmpEnv('GIT_CONFIG_KEY_0', setting.cfg[0]);
          setTmpEnv('GIT_CONFIG_VALUE_0', setting.cfg[1]);
        }
        if (setting.env) setTmpEnv(setting.env[0], setting.env[1]);
        try {
          const ctx = `${tc.id} [${setting.label}]`;
          const range = resolveRange({ baseBranch: 'develop', repoRoot: dir });
          const cs = readChangeSet({ ...range, source: 'commit', repoRoot: dir });

          if (tc.expect.docsOnly !== undefined) {
            assert.equal(isDocsOnlyDiff(cs), tc.expect.docsOnly, `${ctx}: isDocsOnlyDiff`);
          }
          if (tc.expect.drift !== undefined || tc.expect.driftCheck) {
            const d = checkSpecDrift({ ticketId: '77', baseBranch: 'develop', changeSet: cs, repoRoot: dir });
            if (tc.expect.drift !== undefined) assert.equal(d.passed, tc.expect.drift, `${ctx}: checkSpecDrift (${d.message})`);
            if (tc.expect.driftCheck) assert.equal(tc.expect.driftCheck(d), true, `${ctx}: driftCheck (${JSON.stringify(d)})`);
          }
          if (tc.expect.prepush !== undefined) {
            const p = verifyPushGuard({ repoRoot: dir });
            assert.equal(p.allowed, tc.expect.prepush, `${ctx}: verifyPushGuard (${p.message || 'PASSED'})`);
          }
          if (tc.expect.gate !== undefined || tc.expect.gateCheck) {
            const g = runGate(dir, { noCache: true });
            if (tc.expect.gate !== undefined) assert.equal(g.passed, tc.expect.gate, `${ctx}: runGate (${g.reason || 'completed'})`);
            if (tc.expect.gateCheck) assert.equal(tc.expect.gateCheck(g, dir), true, `${ctx}: gateCheck (${JSON.stringify(g)})`);
          }
        } finally {
          for (const [k, v] of Object.entries(savedEnv)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
          }
        }
      }
    });
  }
});
