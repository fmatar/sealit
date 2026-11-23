#!/usr/bin/env node
import { runCLI, cliExitCode, formatCLIResult } from '../.agent/scripts/sealit-engine.mjs';

const jsonMode = process.argv.includes('--json');
const onProgress = jsonMode ? null : (msg) => process.stderr.write(`${msg}\n`);

runCLI(null, null, '.', { onProgress })
  .then((res) => {
    const code = cliExitCode(res);
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    } else {
      for (const w of res.warnings || []) process.stderr.write(`Warning: ${w}\n`);
      const text = formatCLIResult(res.command, res);
      if (code === 0) process.stdout.write(`${text}\n`);
      else process.stderr.write(`${text}\n`);
    }
    process.exit(code);
  })
  .catch((err) => {
    if (jsonMode) process.stdout.write(`${JSON.stringify({ success: false, error: err.message }, null, 2)}\n`);
    else process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  });
