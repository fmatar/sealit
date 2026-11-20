import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTempGitRepo, git } from '../helpers/test-harness.mjs';
import { installFramework } from '../../.agent/scripts/lib/install.mjs';
import { runCLI } from '../../.agent/scripts/sdlc-engine.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

describe('End-to-End First Adoption Flow', () => {
  it('fresh JS repo: init -> begin -> ADR-001 -> commit -> gate -> review record -> verify passes', async () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    const hadEnv = Object.prototype.hasOwnProperty.call(process.env, 'SDLC_RECEIPT_KEY');
    const prevEnv = process.env.SDLC_RECEIPT_KEY;
    delete process.env.SDLC_RECEIPT_KEY;

    try {
      // Seed a realistic fresh JS repo with bare .gitignore (no pre-populated SDLC entries)
      fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0', type: 'module' }, null, 2) + '\n', 'utf8');
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src/add.mjs'), 'export const add = (a, b) => a + b;\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, 'tests/add.test.mjs'),
        "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/add.mjs';\ntest('add', () => assert.equal(add(2, 3), 5));\n",
        'utf8'
      );
      git(dir, 'add', '-A');
      git(dir, 'commit', '-qm', 'chore: initial app');

      const init = await installFramework({ targetDir: dir, sourceRoot: REPO_ROOT, agents: ['claude'], yes: true });
      assert.equal(init.success, true);
      assert.equal(init.receiptKeyCreated, true);
      assert.equal(fs.existsSync(path.join(dir, '.agent/.receipt-key')), true);

      const doc = await runCLI(['doctor'], null, dir);
      assert.equal(doc.success, true);
      assert.ok(doc.doctor.receiptKey.ciSecretHint?.includes('gh secret set SDLC_RECEIPT_KEY'));

      const begun = await runCLI(['begin', '--title', 'adopt', '--type', 'chore', '--checkout'], null, dir);
      assert.equal(begun.success, true);
      const issueId = begun.begin.session.issueId;

      const adrCreated = await runCLI(
        [
          'adr', 'create',
          '--title', 'Adopt agentic-sdlc',
          '--scope', 'architectural',
          '--ticket', issueId,
          '--context', 'Onboard Alignment and Proof Kernel',
          '--decision', 'Adopt .archlens/policy.json and single-path gate',
          '--consequences', 'All PRs verify diff coverage, rings, and Stage 7 receipts'
        ],
        null,
        dir
      );
      assert.equal(adrCreated.success, true);
      const adrDecided = await runCLI(
        ['adr', 'decide', '--id', 'ADR-001', '--status', 'approve', '--by', '@lead', '--reason', 'Approved initial adoption'],
        null,
        dir
      );
      assert.equal(adrDecided.success, true);

      git(dir, 'add', '-A');
      assert.equal(git(dir, 'commit', '-qm', 'chore: adopt agentic-sdlc').status, 0);

      const gate = await runCLI(['gate', '--no-cache'], null, dir);
      assert.equal(gate.success, true, JSON.stringify(gate.gate));

      const rev = await runCLI(['review', 'record', '--verdict', 'approve', '--reviewer', '@lead', '--notes', 'Verified onboarding'], null, dir);
      assert.equal(rev.success, true, rev.error || '');

      git(dir, 'add', 'docs/AUDIT_CHAIN.jsonl');
      assert.equal(git(dir, 'commit', '-qm', 'chore(audit): record Stage 7 receipt').status, 0);

      const ver = await runCLI(['verify'], null, dir);
      assert.equal(ver.success, true, ver.error || '');
    } finally {
      if (hadEnv) process.env.SDLC_RECEIPT_KEY = prevEnv;
      else delete process.env.SDLC_RECEIPT_KEY;
    }
  });
});
