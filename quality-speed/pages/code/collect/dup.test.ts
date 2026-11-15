// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { duplication } from './dup.ts';

const block = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i};`);
const asInput = (file: string, lines: string[]) => ({ file, lines: lines.map((text, i) => ({ line: i + 1, text })) });

test('a block of 10 lines copied into another file marks both copies, re-indented or not', () => {
  const shared = block('x = ', 10);
  const r = duplication([
    asInput('a.ts', ['import { y } from "./y";', ...shared, 'only a;']),
    asInput('b.ts', [...shared.map((l) => `    ${l}`), 'only b;']),
  ]);
  assert.equal(r.duplicatedLines, 20);
  assert.equal(r.codeLines, 22);
  assert.deepEqual(r.byFile.map((f) => f.file), ['a.ts', 'b.ts']);
});

test('nine shared lines are not a block, and imports never match', () => {
  const imports = Array.from({ length: 12 }, (_, i) => `import { m${i} } from "./m${i}.ts";`);
  const r = duplication([asInput('a.ts', [...block('y = ', 9), ...imports]), asInput('b.ts', [...block('y = ', 9), ...imports])]);
  assert.equal(r.duplicatedLines, 0);
});

test('a run of identical lines in one file is one block, not a copy of itself', () => {
  const r = duplication([asInput('a.ts', Array.from({ length: 15 }, () => 'pad();'))]);
  assert.equal(r.duplicatedLines, 0);
});

test('the same block twice in one file, apart, counts', () => {
  const shared = block('z = ', 10);
  const r = duplication([asInput('a.ts', [...shared, 'gap();', ...shared])]);
  assert.equal(r.duplicatedLines, 20);
});
