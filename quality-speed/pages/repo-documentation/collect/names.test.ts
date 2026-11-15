// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { repo } from './fixture.ts';
import { commandNames, deadNames, loadContext, looksLikePath } from './names.ts';

test('what counts as a path', () => {
  assert.equal(looksLikePath('web/worker/auth.ts'), true);
  assert.equal(looksLikePath('docs/'), true);
  assert.equal(looksLikePath('CONTRIBUTING.md'), true);
  assert.equal(looksLikePath('text/plain'), false);
  assert.equal(looksLikePath('www.sec.gov/robots.txt'), false);
  assert.equal(looksLikePath('~/code/x'), false);
  assert.equal(looksLikePath('punycode.js'), false);
  assert.equal(looksLikePath('web/<name>.ts'), false);
  assert.equal(looksLikePath('.html'), false);
});

test('commands: npm scripts and node files', () => {
  assert.deepEqual(commandNames('cd web && npm run dev:seed -- --x'), [{ kind: 'npm script', name: 'dev:seed' }]);
  assert.deepEqual(commandNames('node --test worker/a.test.ts'), [{ kind: 'path', name: 'worker/a.test.ts' }]);
  assert.deepEqual(commandNames('node --import ./scripts/pre.ts scripts/run.ts'), [
    { kind: 'path', name: './scripts/pre.ts' },
    { kind: 'path', name: 'scripts/run.ts' },
  ]);
});

function setup() {
  return repo(
    {
      '.gitignore': 'web/settings.jsonc\n',
      'web/package.json': JSON.stringify({ scripts: { 'dev:seed': 'node x' } }),
      'web/worker/auth.ts': "export const FLAG = env.ROOM_FLAG; const tool = 'legallas_search';\n",
      'web/src/styles/components/terms.css': '',
      'web/migrations/0001_init.sql': '',
      'README.md': [
        '# R',
        '`web/worker/auth.ts` `worker/auth.ts` `web/worker/gone.ts` `web/settings.jsonc` `other.json`',
        '`ROOM_FLAG` `NO_SUCH_FLAG` `EXTERNAL_FLAG` `legallas_search` `legallas_nothing`',
        '`components/terms.css` `migrations/0001` `npm run dev:seed` `npm run missing`',
        '',
        '```bash',
        'npm run nope',
        'node scripts/absent.ts',
        '```',
      ].join('\n'),
      '.github/workflows/ci.yml': '# Lint here and in review_old.sh (see `README.md`).\non: push\n',
    },
    { notInTree: [{ name: 'other.json', reason: 'a run output' }, { name: 'EXTERNAL_FLAG', reason: 'another tool' }] },
  );
}

test('dead names: paths, scripts, flags, tools and bare files in comments', () => {
  const r = setup();
  try {
    const c = r.corpus();
    const found = deadNames(c, loadContext(c, join(r.config, 'not-in-tree.json'))).map((d) => `${d.kind}:${d.name}`);
    assert.deepEqual(found.sort(), [
      'MCP tool:legallas_nothing',
      'name:NO_SUCH_FLAG',
      'npm script:npm run missing',
      'npm script:npm run nope',
      'path:review_old.sh',
      'path:scripts/absent.ts',
      'path:web/worker/gone.ts',
    ]);
  } finally {
    r.done();
  }
});
