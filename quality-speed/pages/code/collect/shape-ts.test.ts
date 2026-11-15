// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tsShape } from './shape-ts.ts';
import { needsTs, ts } from './test-support.ts';

test('functions span their code lines; comments, regexes and templates never confuse the count', { skip: needsTs }, () => {
  const src = [
    'export function grade(n: number): string {', // 1
    '  // a comment line', // 2
    '  /* and a block', // 3
    '     comment */', // 4
    '  const re = /"[}]/;', // 5
    '  const t = `a ${n}', // 6
    '  b`;', // 7
    '  return re.test(t) ? "x" : "y";', // 8
    '}', // 9
    'const f = () => 1;', // 10
  ].join('\n');
  const shape = tsShape(ts!, 'a.ts', src);
  assert.deepEqual(shape.functions.map((f) => [f.name, f.line, f.codeLines]), [['grade', 1, 6], ['f', 10, 1]]);
  assert.equal(shape.codeLines, 7);
});

test('type escapes: any, suppressions in comments (not strings), double and non-null assertions', { skip: needsTs }, () => {
  const src = [
    'const a: any = 1;',
    '// @ts-ignore next',
    'const b = "@ts-ignore is only text here";',
    'const c = a as unknown as string;',
    'const d = (a as any) as number;',
    'const e = maybe!.value;',
    'const f = a as string;',
  ].join('\n');
  assert.deepEqual(tsShape(ts!, 'a.ts', src).escapes, { explicitAny: 2, suppressions: 1, doubleAssertions: 1, nonNullAssertions: 1 });
});
