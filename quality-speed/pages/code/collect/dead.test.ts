// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { astroImports, globTargets, unusedExports } from './dead.ts';
import { needsTs, ts } from './test-support.ts';

test('Astro imports: named, default, side effect and glob, a type argument with => included', () => {
  const text = "---\nimport Card, { a, type B as C } from './x.ts';\nimport './y.ts';\nconst g = import.meta.glob<() => any>(['./s/*.ts', './t.ts']);\n---";
  assert.deepEqual(astroImports(text), [
    { spec: './s/*.ts', names: ['*'], glob: true },
    { spec: './t.ts', names: ['*'], glob: true },
    { spec: './x.ts', names: ['a', 'B', 'default'] },
    { spec: './y.ts', names: ['*'] },
  ]);
});

test('glob patterns resolve against the importing file', () => {
  const files = ['web/src/s/a.ts', 'web/src/s/deep/b.ts', 'web/src/t.mjs'];
  assert.deepEqual(globTargets('web/src/c.astro', './s/*.ts', files), ['web/src/s/a.ts']);
  assert.deepEqual(globTargets('web/src/c.astro', './s/**/*.ts', files), ['web/src/s/deep/b.ts']);
  assert.deepEqual(globTargets('web/src/c.astro', '@brand/*.ts', files), []);
});

test('an export nothing imports and its own file never uses is dead; a test import keeps one alive', { skip: needsTs }, () => {
  const files: Record<string, string> = {
    'web/a.ts': 'export const used = 1;\nexport const dead = 2;\nexport const local = 3;\nexport const viaTest = 4;\nconsole.log(local);',
    'web/b.ts': "import { used } from './a.ts';\nconsole.log(used);",
    'web/a.test.ts': "import { viaTest } from './a.ts';",
  };
  const names = Object.keys(files);
  const found = unusedExports(ts!, names, [], new Set(['web/b.ts']), (p) => files[p] ?? '', (p) => p in files, names);
  assert.deepEqual(found.map((f) => [f.file, f.name]), [['web/a.ts', 'dead']]);
});
