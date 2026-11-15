// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { numberingProblems, SHARED_NUMBERS } from '../../quality-speed/pages/build/migration-numbers.ts';

const MIGRATIONS = path.resolve(import.meta.dirname, '..', 'migrations');
const real = () => readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));

test('web/migrations is numbered in order, each number once but the two known pairs', () => {
  assert.deepEqual(numberingProblems(real()), []);
});

test('each known pair is still in web/migrations, so the exception list cannot outlive its files', () => {
  const names = new Set(real());
  for (const files of Object.values(SHARED_NUMBERS)) for (const f of files) assert.ok(names.has(f), f);
});

test('a new shared number, a gap, a third file on a known number and a bad name are refused', () => {
  const ok = ['0001_a.sql', '0002_b.sql'];
  assert.deepEqual(numberingProblems(ok), []);
  assert.match(numberingProblems([...ok, '0002_c.sql']).join(), /share 0002/);
  assert.match(numberingProblems(['0001_a.sql', '0003_c.sql']).join(), /0002 is missing/);
  assert.match(numberingProblems([...real(), '0016_third.sql']).join(), /share 0016/);
  assert.match(numberingProblems([...ok, '3_c.sql']).join(), /not NNNN_name/);
});
