import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { HOSTILE_MATRIX, buildBypassCases, createSeedBaselineRepo, runBypassCase } from '../helpers/bypass-corpus-cases.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const ALL_CASES = buildBypassCases(createSeedBaselineRepo(cleanups));
const CASES = ALL_CASES.slice(19);
const HOSTILE_OVERRIDES = HOSTILE_MATRIX.slice(1);

describe('Adversarial Gate Bypass Matrix — Config & ADR Cases 20–23 (hostile configs)', () => {
  it('matrix covers all 23 adversarial cases across all 8 hostile overrides', () => {
    assert.equal(ALL_CASES.length, 23);
    assert.equal(HOSTILE_OVERRIDES.length, 8);
  });

  for (const tc of CASES) {
    it(tc.id, () => runBypassCase(tc, HOSTILE_OVERRIDES));
  }
});
