---
name: sdlc-status
description: Displays active SDLC session, 8-stage lifecycle progress, spec-drift check, living KANBAN.md board state, engineering ROI telemetry, and live Architecture Diff UI in one unified view.
allowed-tools: Read, Write, Edit, Bash
---

# 📊 Live Session Status, Drift & Architecture Inspector (`sdlc-status`)

## 1. Unified Status Inspection Sequence

Execute the following commands to assemble a complete real-time snapshot of the repository's active SDLC state:

```bash
# 1. Active session & 8-stage ASCII dashboard
node .agent/scripts/sdlc-engine.mjs session status
node .agent/scripts/sdlc-engine.mjs session dashboard

# 2. Check for undeclared spec/contract/architecture drift against PRODUCT.md & docs/adr/
node .agent/scripts/sdlc-engine.mjs drift check
node .agent/scripts/sdlc-engine.mjs arch diff

# 3. Engineering velocity, ROI & hash-chained audit ledger status
node .agent/scripts/sdlc-engine.mjs stats
node .agent/scripts/sdlc-engine.mjs audit verify

# 4. Refresh and launch the live Architecture Diff & Decision Lineage UI (http://localhost:4120)
node .agent/scripts/sdlc-engine.mjs ui-snapshot
```

## 2. Inline Architecture UI Presentation
Regenerate `.agent/workbench/index.html` with `node .agent/scripts/sdlc-engine.mjs ui-snapshot`. Claude Code cannot embed HTML inline: tell the user the path of `.agent/workbench/index.html` so they can open it in a browser.
