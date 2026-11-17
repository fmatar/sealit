import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createTempGitRepo, git, withoutReceiptEnv } from '../helpers/test-harness.mjs';
import { runCLI, formatCLIResult, cliExitCode } from '../../.agent/scripts/sdlc-engine.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

describe('Ring 3: sdlc-engine.mjs CLI registry', () => {
  it('supports position-independent global flags, =-containing flag values, zero-arg help, and exitCode:2 on unknown commands/flags', async () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    const zeroArg = await runCLI([], null, dir, { isTTY: false });
    assert.equal(zeroArg.success, true);
    assert.equal(zeroArg.command, 'help');
    assert.equal(cliExitCode(zeroArg), 0);

    const leadJson = await runCLI(['--json', 'status'], null, dir);
    const trailJson = await runCLI(['status', '--json'], null, dir);
    assert.equal(leadJson.success, true);
    assert.equal(trailJson.success, true);
    assert.equal(leadJson.status.branch, trailJson.status.branch);

    const begun = await runCLI(['begin', '--issue=99', '--title=fix: a=b=c', '--checkout'], null, dir);
    assert.equal(begun.success, true);
    assert.equal(begun.begin.session.title, 'fix: a=b=c');

    const badCmd = await runCLI(['banana'], null, dir);
    assert.equal(badCmd.success, false);
    assert.equal(cliExitCode(badCmd), 2);

    const badFlag = await runCLI(['gate', '--unknown-flag'], null, dir);
    assert.equal(badFlag.success, false);
    assert.equal(cliExitCode(badFlag), 2);

    assert.equal(cliExitCode(await runCLI(['session', 'banana'], null, dir)), 2);
    assert.equal(cliExitCode(await runCLI(['audit', 'banana'], null, dir)), 2);
  });

  it('drives complete begin -> drift -> adr -> test -> coverage -> exemption -> gate (--strict compat) -> review -> verify -> end flow', async () => {
    const { dir, cleanup } = createTempGitRepo();
    cleanups.push(cleanup);

    await withoutReceiptEnv(async () => {
      fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'tests/app.test.mjs'),
        "import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport { val } from '../app.mjs';\nassert.equal(val, 7);\nfs.mkdirSync('coverage', { recursive: true });\nfs.writeFileSync('coverage/lcov.info', 'SF:app.mjs\\nDA:1,1\\nLF:1\\nLH:1\\nend_of_record\\n', 'utf8');\n",
        'utf8'
      );
      fs.writeFileSync(path.join(dir, 'app.mjs'), 'export const val = 7;\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, '.agent/sdlc-config.json'),
        JSON.stringify({
          version: '0.1.0',
          archlens: { enabled: false },
          modules: [
            {
              name: 'root',
              path: '.',
              commands: {
                test: `${process.execPath} tests/app.test.mjs`,
                coverage: `${process.execPath} tests/app.test.mjs`,
                coverageFile: 'coverage/lcov.info'
              },
              thresholds: { diffCoverage: 85, mutationScore: null }
            }
          ]
        }),
        'utf8'
      );
      git(dir, 'add', '.agent/sdlc-config.json', 'app.mjs', 'tests/app.test.mjs');
      git(dir, 'commit', '-q', '-m', 'chore: base setup');
      git(dir, 'branch', '-f', 'main', 'HEAD');

      // 1. Begin session via stage begin alias
      const s = await runCLI(['stage', 'begin', '--issue', '101', '--title', 'Kernel Flow', '--checkout'], null, dir);
      assert.equal(s.success, true);

      // 2. Introduce PRODUCT.md drift -> drift fails -> create & approve ADR -> drift passes
      fs.writeFileSync(path.join(dir, 'PRODUCT.md'), '# Product Constitution\n', 'utf8');
      const driftFail = await runCLI(['drift', 'check'], null, dir);
      assert.equal(driftFail.success, false);

      const adrCreated = await runCLI(['adr', 'create', '--title', 'Init Product', '--scope', 'product', '--ticket', '101'], null, dir);
      assert.equal(adrCreated.success, true);
      const adrApproved = await runCLI(
        ['adr', 'decide', '--id', adrCreated.adr.id, '--status', 'approve', '--reviewer', '@lead', '--reason', 'Aligned'],
        null,
        dir
      );
      assert.equal(adrApproved.success, true);

      git(dir, 'add', 'PRODUCT.md', adrCreated.adr.file, 'docs/AUDIT_CHAIN.jsonl');
      git(dir, 'commit', '-q', '-m', 'docs: add PRODUCT.md and ADR-001');

      const driftPass = await runCLI(['drift'], null, dir);
      assert.equal(driftPass.success, true);

      // 3. Test, coverage, exemption, and gate with deprecated --strict --allow-offline flags
      const testRes = await runCLI(['test'], null, dir);
      assert.equal(testRes.success, true);

      const covRes = await runCLI(['coverage', '--no-cache'], null, dir);
      assert.equal(covRes.success, true);

      const exAdd = await runCLI(['exemption', 'add', '--mutant', 'M-9', '--file', 'app.mjs', '--reason', 'Equivalent guard'], null, dir);
      assert.equal(exAdd.success, true);
      git(dir, 'add', '.agent/sdlc-config.json');
      git(dir, 'commit', '-q', '-m', 'chore: record exemption');

      const exList = await runCLI(['exemption', 'list'], null, dir);
      assert.equal(exList.exemptions.length, 1);

      const cliProgress = [];
      const gateRes = await runCLI(['gate', '--strict', '--allow-offline', '--no-cache'], null, dir, { onProgress: (m) => cliProgress.push(m) });
      assert.equal(gateRes.success, true);
      assert.ok(cliProgress.some((m) => /coverage/i.test(m)));
      assert.ok(gateRes.warnings.length >= 1);
      assert.match(formatCLIResult('gate', gateRes), /Gate PASSED/i);
      const failedFmt = formatCLIResult('gate', {
        gate: {
          passed: false,
          mode: 'code',
          headSha: 'abcdef123456',
          drift: { passed: false, message: 'Unapproved PRODUCT.md change' },
          modules: [{ module: 'root', passed: false, failedStep: 'mutation', error: 'Mutation score 42.9% is below threshold 52%.' }]
        }
      });
      assert.match(failedFmt, /Gate FAILED \[mode=code, head=abcdef12\]/);
      assert.match(failedFmt, /drift: Unapproved PRODUCT\.md change/);
      assert.match(failedFmt, /root \(mutation\): Mutation score 42\.9% is below threshold 52%\./);

      // 4. Review plan + record approve -> signs receipt -> verify passes -> end closes session
      const planRes = await runCLI(['review', 'plan'], null, dir);
      assert.equal(planRes.success, true);

      const recRes = await runCLI(
        ['review', 'record', '--verdict', 'approve', '--reviewer', '@sdlc-gate', '--peer-review', 'LGTM'],
        null,
        dir
      );
      assert.equal(recRes.success, true);
      assert.ok(recRes.review.receipt?.receiptId);

      git(dir, 'add', 'docs/AUDIT_CHAIN.jsonl');
      git(dir, 'commit', '-q', '-m', 'chore: record gate receipt');

      const verRes = await runCLI(['verify'], null, dir);
      assert.equal(verRes.success, true);

      const guardVerAlias = await runCLI(['guard', 'verify'], null, dir);
      assert.equal(guardVerAlias.success, true);

      const hooksRes = await runCLI(['hooks', 'install'], null, dir);
      assert.equal(hooksRes.success, true);
      const wfRes = await runCLI(['ci-workflow', 'install', '--force'], null, dir);
      assert.equal(wfRes.success, true);

      // Human formatters produce clear, non-empty output across commands
      assert.match(formatCLIResult('doctor', await runCLI(['doctor'], null, dir)), /SDLC Doctor:/);
      assert.match(formatCLIResult('status', await runCLI(['status'], null, dir)), /Branch:/);
      assert.match(formatCLIResult('drift', driftPass), /Spec drift verified.*ADR-001/i);
      assert.match(formatCLIResult('adr', await runCLI(['adr', 'list'], null, dir)), /ADRs/);
      assert.match(formatCLIResult('coverage', covRes), /root:/);
      assert.match(formatCLIResult('verify', verRes), /Verified Stage 7 receipt/);
      assert.match(formatCLIResult('begin', s), /Session started/);

      const ended = await runCLI(['end'], null, dir);
      assert.equal(ended.success, true);
      assert.match(formatCLIResult('end', ended), /closed/);
    });
  });
});
