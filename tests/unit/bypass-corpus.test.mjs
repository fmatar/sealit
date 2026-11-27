import { describe, it, afterEach } from 'node:test';
import { HOSTILE_MATRIX, buildBypassCases, createSeedBaselineRepo, runBypassCase } from '../helpers/bypass-corpus-cases.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const CASES = buildBypassCases(createSeedBaselineRepo(cleanups));

describe('Adversarial Gate Bypass Corpus (default baseline, ADR-020 / ADR-021 / ADR-028)', () => {
  for (const tc of CASES) {
    it(tc.id, () => runBypassCase(tc, [HOSTILE_MATRIX[0]]));
  }
});
