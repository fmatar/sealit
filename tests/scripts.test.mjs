import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { auditSkills } from '../.agent/scripts/sdlc-engine.mjs';

describe('Kanban Scripts & 10 Canonical SDLC Skills Schema Validation', () => {
  it('verifies kanban-sync.sh is executable and exists in .agent/scripts/', () => {
    const scriptPath = path.resolve('.agent/scripts/kanban-sync.sh');
    assert.ok(fs.existsSync(scriptPath), 'kanban-sync.sh should exist in .agent/scripts/');
    const stats = fs.statSync(scriptPath);
    assert.ok((stats.mode & 0o111) !== 0, 'Script must have executable permissions');
  });

  it('verifies project-setup.sh is executable and exists in .agent/scripts/', () => {
    const scriptPath = path.resolve('.agent/scripts/project-setup.sh');
    assert.ok(fs.existsSync(scriptPath), 'project-setup.sh should exist in .agent/scripts/');
    const stats = fs.statSync(scriptPath);
    assert.ok((stats.mode & 0o111) !== 0, 'Script must have executable permissions');
  });

  it('verifies kanban-sync.sh output format contains Board and Traceability Matrix', () => {
    // Hermetic: run in a temp dir with a stub `gh` so the test never calls the
    // live GitHub API or rewrites this repository's tracked docs/KANBAN.md.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-sync-'));
    try {
      const bin = path.join(tmp, 'bin');
      fs.mkdirSync(bin);
      fs.mkdirSync(path.join(tmp, 'docs'));
      fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      execFileSync(path.resolve('.agent/scripts/kanban-sync.sh'), [], {
        cwd: tmp,
        stdio: 'pipe',
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` }
      });
      const kanbanContent = fs.readFileSync(path.join(tmp, 'docs/KANBAN.md'), 'utf8');
      assert.ok(kanbanContent.includes('## 📊 Board Overview'));
      assert.ok(kanbanContent.includes('## 🎯 End-to-End Traceability Matrix'));
      assert.ok(kanbanContent.includes('| 📥 Backlog | 📋 Ready | ⚡ In Progress | 🔍 In Review | ✅ Done |'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('verifies project-setup.sh contains all 6 recommended views and custom fields', () => {
    const scriptCode = fs.readFileSync('.agent/scripts/project-setup.sh', 'utf8');
    assert.ok(scriptCode.includes('Priority'));
    assert.ok(scriptCode.includes('Component'));
    assert.ok(scriptCode.includes('Estimate'));
    assert.ok(scriptCode.includes('Spec Link'));
    assert.ok(scriptCode.includes('Quality Gate'));
    assert.ok(scriptCode.includes('Traceability Matrix'));
  });

  it('verifies 1 Router + 9 Verb Skills (10 canonical skills) exist in .agent/skills/ with valid tool schemas (ADR-010)', () => {
    const expectedSkills = [
      'sdlc',
      'sdlc-adr',
      'sdlc-doctor',
      'sdlc-flow',
      'sdlc-gate',
      'sdlc-product',
      'sdlc-release',
      'sdlc-status',
      'sdlc-tdd',
      'sdlc-wiki'
    ];
    const skillsDir = path.resolve('.agent/skills');
    const actualSkills = fs
      .readdirSync(skillsDir)
      .filter((f) => f.startsWith('sdlc') && fs.statSync(path.join(skillsDir, f)).isDirectory())
      .sort();

    assert.deepEqual(actualSkills, expectedSkills);
    assert.equal(fs.existsSync(path.resolve('.agents/skills')), false, '.agents/skills duplicate folder must not exist');

    for (const skillName of expectedSkills) {
      const skillFile = path.join(skillsDir, skillName, 'SKILL.md');
      assert.ok(fs.existsSync(skillFile), `${skillName}/SKILL.md must exist`);
      const content = fs.readFileSync(skillFile, 'utf8');

      assert.ok(content.includes(`name: ${skillName}`), `${skillName} must declare matching name`);
      assert.ok(content.includes('description:'), `${skillName} must declare description`);
      const descLine = content.split('\n').find((line) => line.startsWith('description:')) || '';
      assert.ok(!descLine.includes(' #'), `${skillName} description must not contain unquoted YAML # comment character`);
      assert.ok(content.includes('read_file'), `${skillName} must declare read_file tool`);
      if (skillName === 'sdlc-status') {
        assert.ok(!content.includes('write_file'), 'sdlc-status must remain read-only without write_file');
        assert.ok(!content.includes('edit_file'), 'sdlc-status must remain read-only without edit_file');
      } else {
        assert.ok(content.includes('write_file'), `${skillName} must declare write_file tool`);
        assert.ok(content.includes('edit_file'), `${skillName} must declare edit_file tool`);
      }
      assert.ok(!content.includes('view_file'), `${skillName} must not contain legacy view_file tool`);
      assert.ok(!content.includes('write_to_file'), `${skillName} must not contain legacy write_to_file tool`);
      assert.ok(!content.includes('replace_file_content'), `${skillName} must not contain legacy replace_file_content tool`);
    }

    const auditRes = auditSkills(process.cwd());
    assert.equal(auditRes.success, true, 'All 10 canonical skills must pass SkillSpector static rules (RP1, AS3, FM1/FM2)');
    assert.equal(auditRes.totalFindings, 0);
    assert.equal(auditRes.maxScore, 0);
  });

  it('verifies ADR-003: legacy install.sh and install.java are removed and package.json exposes npx bin entrypoints', () => {
    assert.equal(fs.existsSync(path.resolve('install.sh')), false, 'install.sh must be removed per ADR-003');
    assert.equal(fs.existsSync(path.resolve('install.java')), false, 'install.java must be removed per ADR-003');
    const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    assert.equal(pkg.bin['agentic-sdlc-framework'], './.agent/scripts/sdlc-engine.mjs');
    assert.equal(pkg.bin['agentic-sdlc'], './.agent/scripts/sdlc-engine.mjs');
    assert.equal(pkg.bin['sdlc'], './.agent/scripts/sdlc-engine.mjs');
    assert.equal(pkg.files.includes('install.sh'), false);
  });
});
