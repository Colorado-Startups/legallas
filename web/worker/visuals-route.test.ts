// SPDX-License-Identifier: Apache-2.0
// GET /api/visuals (routes/visuals.ts, pro) through the real gate in room.ts, with fake D1 and R2
// (files-fixtures.ts). index.ts adds the route to the room.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Env } from './env.ts';
import { fakeEnv, HOST } from './files-fixtures.ts';
import { handle } from './index.ts';

const MANIFEST = JSON.stringify({
  version: 1,
  sections: [{ slug: 'start', label: 'Start', title: 'Overview' }],
  visuals: [
    { slug: 'start', section: 'start', file: 'start.html', title: 'Start here', overview: true },
    { slug: 'gone', section: 'start', file: 'gone.html', title: 'Not synced yet' },
  ],
});

const get = (env: Env, path: string, headers?: HeadersInit) =>
  handle(new Request(`${HOST}${path}`, { headers }), env, {} as ExecutionContext);

test('/api/visuals joins the manifest to live visuals and leaves unsynced ones out', async () => {
  const { env } = fakeEnv({ 'k-manifest': MANIFEST });
  const res = await get(env, '/api/visuals');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { sections: { visuals: string[] }[]; visuals: { slug: string; id: string }[] };
  assert.deepEqual(body.visuals.map((v) => [v.slug, v.id]), [['start', 'v1']]);
  assert.deepEqual(body.sections[0]!.visuals, ['start']);
  assert.match(res.headers.get('Content-Security-Policy') ?? '', /default-src 'none'/);
});

test('/api/visuals is an empty binder when there is no manifest yet', async () => {
  const { env } = fakeEnv({});
  const body = await (await get(env, '/api/visuals')).json();
  assert.deepEqual(body, { sections: [], visuals: [] });
});

test('a broken manifest is a 500 with the reason for the owner only', async () => {
  const owner = await get(fakeEnv({ 'k-manifest': '{"version": 9}' }).env, '/api/visuals');
  assert.equal(owner.status, 500);
  assert.match(((await owner.json()) as { detail?: string }).detail ?? '', /version/);

  const counsel = await get(fakeEnv({ 'k-manifest': 'not json' }, 'counsel').env, '/api/visuals');
  assert.deepEqual(await counsel.json(), { error: 'bad_manifest' });
});
