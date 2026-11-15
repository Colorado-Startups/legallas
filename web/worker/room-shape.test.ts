// SPDX-License-Identifier: Apache-2.0
// What would hurt a live room: a room with a matter, or with the setting off, must keep getting its pages as built. The
// shaping itself runs on HTMLRewriter, which only exists in the Workers runtime: run fixture-room.yml with fixture=company.
// Its words are checked on every build: scripts/dist-company.ts shapes the built pages the same way in plain Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { servePage } from './room-shape.ts';

const PAGE = '<html><p data-case-only>Attorney Eyes Only.</p></html>';

function room(head: () => Promise<unknown>, enabled = true) {
  let lookups = 0;
  const env = {
    ...(enabled ? { COMPANY_ROOM_ENABLED: '1' } : {}),
    FILES: { head: () => ((lookups += 1), head()) } as unknown as R2Bucket,
    ASSETS: { fetch: async () => new Response(PAGE, { headers: { 'Content-Type': 'text/html' } }) } as unknown as Fetcher,
  };
  return { env, lookups: () => lookups };
}

const load = (env: Parameters<typeof servePage>[1], path: string) => {
  const url = new URL(path, 'https://room.example.test');
  return servePage(new Request(url, { headers: { Accept: 'text/html' } }), env, url);
};

test('with the setting off, every page is as built and the room makes no lookup', async () => {
  const { env, lookups } = room(async () => null, false);
  for (const path of ['/', '/chronology/']) assert.equal(await (await load(env, path)).text(), PAGE, path);
  assert.equal(lookups(), 0);
});

test('with a matter published, every page is as built: its counsel notice nothing', async () => {
  const { env } = room(async () => ({ key: 'meta/matter.json' }));
  for (const path of ['/', '/chronology/']) assert.equal(await (await load(env, path)).text(), PAGE, path);
});

test('a failed lookup keeps the room as built', async (t) => {
  t.mock.method(console, 'error', () => undefined);
  const { env } = room(async () => { throw new TypeError('away'); });
  assert.equal(await (await load(env, '/chronology/')).text(), PAGE);
});

test('with no matter, the case pages go to the Overview, temporarily', async () => {
  const { env } = room(async () => null);
  for (const path of ['/complaint/', '/regulator/', '/chronology', '/people/', '/claims/', '/binder/', '/visual/']) {
    const res = await load(env, path);
    assert.equal(res.status, 302, path);
    assert.equal(res.headers.get('Location'), 'https://room.example.test/', path);
  }
});

test('the setting on with no FILES binding keeps the case room, and says so in the log (#220)', async (t) => {
  const logged = t.mock.method(console, 'error', () => undefined);
  const { isCompanyRoom } = await import('./room-shape.ts');
  assert.equal(await isCompanyRoom({ COMPANY_ROOM_ENABLED: '1' }), false);
  assert.deepEqual(logged.mock.calls.map((c) => c.arguments[0]), ['room_shape_no_files']);
  assert.equal(await isCompanyRoom({}), false);
  assert.equal(logged.mock.callCount(), 1, 'the setting off is not a misconfiguration');
});
