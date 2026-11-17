// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify, importersOf, relativeLoads, type RepoView } from './classify.ts';
import { needsTs, ts } from './test-support.ts';

// An invented repository: one Worker, one CLI, one Astro page, tests, a fixture and a forgotten file.
const FILES: Record<string, string> = {
  'web/wrangler.example.jsonc': '{ "main": "./worker/main.ts" }',
  'web/package.json': JSON.stringify({ scripts: { tool: 'node --import ./scripts/preload.ts scripts/tool.ts' } }),
  'web/worker/main.ts': "import { gate } from './gate.ts';\nexport default { fetch: gate };",
  'web/worker/gate.ts': "export function gate() { return 1; }\nexport const UNUSED = 2;",
  'web/worker/gate.test.ts': "import { gate } from './gate.ts';\nimport { fake } from './fake.ts';",
  'web/worker/fake.ts': 'export const fake = 1;',
  'web/worker/forgotten.ts': 'export const old = 1;',
  'web/scripts/preload.ts': '',
  'web/scripts/tool.ts': "import { load } from './lib.ts';",
  'web/scripts/lib.ts': "export const load = () => import('./lazy.ts');",
  'web/scripts/lazy.ts': '',
  'web/scripts/job.ts': 'if (import.meta.main) {}',
  'web/src/pages/index.astro': "---\nimport Card from '../components/Card.astro';\n---\n<script>import '../scripts/page.ts';</script>",
  'web/src/components/Card.astro': "---\nconst m = import.meta.glob<() => any>('../scripts/slot-*.ts', { eager: true });\n---",
  'web/src/scripts/page.ts': '',
  'web/src/scripts/slot-a.ts': '',
  'web/types.d.ts': 'declare const x: number;',
  // A second Worker, a file read by URL, and views a build script bundles by path.
  'web/wrangler.jobs.example.jsonc': '{ "main": "./worker/jobs.ts" }',
  'web/worker/jobs.ts': "const asset = new URL('../assets/viewer.js', import.meta.url);",
  'web/assets/viewer.js': '',
  'web/scripts/build.ts': "const HERE = import.meta.dirname;\nconst a = join(HERE, 'view', 'a.ts');\nconst b = join(OTHER, 'view', 'b.ts');",
  'web/scripts/view/a.ts': '',
  'web/scripts/view/b.ts': '',
};
const view: RepoView = { files: Object.keys(FILES).sort(), read: (p) => FILES[p] ?? '' };

test('every web file gets one class from entry points derived from configuration', { skip: needsTs }, () => {
  const c = classify(ts!, view);
  const of = (f: string) => c.classes.get(f);
  for (const f of ['web/worker/main.ts', 'web/worker/gate.ts', 'web/scripts/tool.ts', 'web/scripts/preload.ts', 'web/scripts/lazy.ts', 'web/scripts/job.ts', 'web/src/scripts/page.ts', 'web/src/scripts/slot-a.ts']) {
    assert.equal(of(f), 'production', f);
  }
  assert.equal(of('web/worker/gate.test.ts'), 'test');
  assert.equal(of('web/worker/fake.ts'), 'helper');
  assert.equal(of('web/worker/forgotten.ts'), 'orphan');
  assert.equal(of('web/types.d.ts'), undefined);
  const why = Object.fromEntries(c.entries.map((e) => [e.file, e.why]));
  assert.match(why['web/worker/main.ts'] ?? '', /main in web\/wrangler\.example\.jsonc/);
  assert.match(why['web/scripts/job.ts'] ?? '', /import\.meta\.main/);
  assert.match(why['web/worker/jobs.ts'] ?? '', /main in web\/wrangler\.jobs\.example\.jsonc/);
});

test('a file loaded by a path relative to its loader is production; an unknown base is not followed', { skip: needsTs }, () => {
  const c = classify(ts!, view);
  assert.equal(c.classes.get('web/assets/viewer.js'), 'production');
  assert.deepEqual(relativeLoads('web/scripts/build.ts', FILES['web/scripts/build.ts'] ?? ''), ['web/scripts/view/a.ts']);
});

test('importers are found directly and up to a depth', { skip: needsTs }, () => {
  const c = classify(ts!, view);
  const isTest = (f: string) => f.endsWith('.test.ts');
  assert.deepEqual(importersOf(c.imports, 'web/worker/gate.ts', isTest, 2), { direct: ['web/worker/gate.test.ts'], wider: [] });
  assert.deepEqual(importersOf(c.imports, 'web/worker/gate.ts', (f) => f.endsWith('main.ts')), { direct: ['web/worker/main.ts'], wider: [] });
});
