// SPDX-License-Identifier: Apache-2.0
// The owner's guest preview (routes/rooms.ts OWNER_ROOM_ROUTES), through the gate on real SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetDocFactsCache } from './doc-facts-serve.ts';
import { handle } from './index.ts';
import { BEA, COUNSEL, HOST, IVY, OWNER, ROOM_A, ROOM_B, roomsDb, roomsEnv } from './rooms-fixtures.ts';

const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;
const as = async (db: D1Database, email: string, path: string, enabled = true, manifest?: string) => {
  resetDocFactsCache();
  return handle(new Request(`${HOST}${path}`), roomsEnv(db, email, { enabled, ...(manifest === undefined ? {} : { manifest }) }).env, ctx);
};
const documents = async (res: Response) => ((await res.json()) as { documents: unknown[] }).documents;

test('the owner\'s guest preview lists exactly what a guest gets', async () => {
  const { db } = roomsDb();
  for (const [room, guest] of [[ROOM_A, IVY], [ROOM_B, BEA]] as const) {
    const preview = await as(db, OWNER, `/api/rooms/${room}/preview`);
    assert.equal(preview.status, 200, room);
    const guestSees = await documents(await as(db, guest, `/api/rooms/${room}/documents`));
    assert.ok(guestSees.length > 0, room);
    assert.deepEqual(await documents(preview), guestSees, room);
  }
  assert.equal((await as(db, COUNSEL, `/api/rooms/${ROOM_A}/preview`)).status, 403, 'owner only');
  assert.equal((await as(db, IVY, `/api/rooms/${ROOM_A}/preview`)).status, 404, 'never a guest route');
  assert.equal((await as(db, OWNER, '/api/rooms/00000000-0000-4000-8000-999999999999/preview')).status, 404);
  assert.equal((await as(db, OWNER, `/api/rooms/${ROOM_A}/preview`, false)).status, 404, 'off with ROOMS_ENABLED');
});

test('the owner\'s preview, like the guest list, shows nothing as a 503 when the privilege marks cannot be read', async () => {
  const { db } = roomsDb();
  const broken = '{"version": 99}';
  const preview = await as(db, OWNER, `/api/rooms/${ROOM_A}/preview`, true, broken);
  assert.equal(preview.status, 503);
  assert.deepEqual(await preview.json(), { error: 'unavailable' });
  assert.equal((await as(db, IVY, `/api/rooms/${ROOM_A}/documents`, true, broken)).status, 503, 'the same as a guest');
});
