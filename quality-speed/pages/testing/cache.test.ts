// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { contextKey, mutantKey, readOutcomes, toKeep, writeOutcomes, type Ran } from './cache.ts';

test('a mutant keeps its key until its text, a file its tests load, or the salt changes', () => {
  const files = new Map([['web/worker/a.ts', 'export const a = 1;'], ['web/worker/a.test.ts', 'test()']]);
  const key = mutantKey('v24', contextKey(files), 'mutated');
  assert.equal(mutantKey('v24', contextKey(new Map([...files].reverse())), 'mutated'), key, 'the order files load in is not part of it');
  assert.notEqual(mutantKey('v24', contextKey(new Map([...files, ['web/worker/a.test.ts', 'test(); test()']])), 'mutated'), key, 'a test changed');
  assert.notEqual(mutantKey('v24', contextKey(new Map([...files, ['web/worker/b.test.ts', '']])), 'mutated'), key, 'a new test loads the file');
  assert.notEqual(mutantKey('v24', contextKey(files), 'mutated again'), key);
  assert.notEqual(mutantKey('v25', contextKey(files), 'mutated'), key);
});

test('outcomes round-trip; a missing, broken or foreign cache reads as empty', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'qs-cache-'));
  try {
    const file = path.join(dir, 'sub', 'outcomes.json');
    assert.equal(readOutcomes(file).size, 0);
    const outcomes = new Map<string, Ran>([['k1', 'failed'], ['k2', 'survived'], ['k3', 'timeout']]);
    writeOutcomes(file, outcomes);
    assert.deepEqual(readOutcomes(file), outcomes);
    writeFileSync(file, '{"k1": "killed", "k2": "survived"}');
    assert.deepEqual([...readOutcomes(file)], [['k2', 'survived']], 'an outcome this lab never writes is dropped');
    writeFileSync(file, 'not json');
    assert.equal(readOutcomes(file).size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a run keeps only its own outcomes, unless a risk stopped before its mutants had keys', () => {
  const before = new Map<string, Ran>([['old', 'survived'], ['same', 'failed']]);
  const now = new Map<string, Ran>([['same', 'failed'], ['new', 'timeout']]);
  assert.deepEqual([...toKeep(before, now, false).keys()], ['same', 'new']);
  assert.deepEqual([...toKeep(before, now, true).keys()], ['old', 'same', 'new']);
});
