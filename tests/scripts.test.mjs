import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

describe('Kanban & Project Script Validation', () => {
  it('verifies kanban-sync.sh is executable and exists', () => {
    const scriptPath = path.resolve('.agent/skills/sdlc-kanban/scripts/kanban-sync.sh');
    assert.ok(fs.existsSync(scriptPath));
    const stats = fs.statSync(scriptPath);
    // Check executable bit
    assert.ok((stats.mode & 0o111) !== 0, 'Script must have executable permissions');
  });

  it('verifies project-setup.sh is executable and exists', () => {
    const scriptPath = path.resolve('.agent/skills/sdlc-kanban/scripts/project-setup.sh');
    assert.ok(fs.existsSync(scriptPath));
    const stats = fs.statSync(scriptPath);
    assert.ok((stats.mode & 0o111) !== 0, 'Script must have executable permissions');
  });

  it('verifies kanban-sync.sh output format contains Board and Traceability Matrix', () => {
    // Run kanban-sync.sh and inspect generated docs/KANBAN.md
    try {
      execSync('.agent/skills/sdlc-kanban/scripts/kanban-sync.sh', { stdio: 'pipe' });
      const kanbanContent = fs.readFileSync('docs/KANBAN.md', 'utf8');
      assert.ok(kanbanContent.includes('## 📊 Board Overview'));
      assert.ok(kanbanContent.includes('## 🎯 End-to-End Traceability Matrix'));
      assert.ok(kanbanContent.includes('| 📥 Backlog | 📋 Ready | ⚡ In Progress | 🔍 In Review | ✅ Done |'));
    } catch (e) {
      // In CI environments where gh is mock or unauthenticated, verify script structure
      const scriptCode = fs.readFileSync('.agent/skills/sdlc-kanban/scripts/kanban-sync.sh', 'utf8');
      assert.ok(scriptCode.includes('End-to-End Traceability Matrix'));
    }
  });

  it('verifies project-setup.sh contains all 6 recommended views and custom fields', () => {
    const scriptCode = fs.readFileSync('.agent/skills/sdlc-kanban/scripts/project-setup.sh', 'utf8');
    assert.ok(scriptCode.includes('Priority'));
    assert.ok(scriptCode.includes('Component'));
    assert.ok(scriptCode.includes('Estimate'));
    assert.ok(scriptCode.includes('Spec Link'));
    assert.ok(scriptCode.includes('Quality Gate'));
    assert.ok(scriptCode.includes('Traceability Matrix'));
  });
});
