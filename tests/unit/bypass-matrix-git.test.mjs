import { describe, it, afterEach } from 'node:test';
import { HOSTILE_MATRIX, buildBypassCases, createSeedBaselineRepo, runBypassCase } from '../helpers/bypass-corpus-cases.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const CASES = buildBypassCases(createSeedBaselineRepo(cleanups)).slice(0, 11);
const HOSTILE_OVERRIDES = HOSTILE_MATRIX.slice(1);

describe('Adversarial Gate Bypass Matrix — Git & Secret Cases 1–11 (hostile configs)', () => {
  for (const tc of CASES) {
    it(tc.id, () => runBypassCase(tc, HOSTILE_OVERRIDES));
  }
});
