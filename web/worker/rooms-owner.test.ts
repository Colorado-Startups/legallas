// SPDX-License-Identifier: Apache-2.0
// What the owner sees of a deal room's guests, through the gate on real SQLite. Data room rows point at these names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetDocFactsCache } from './doc-facts-serve.ts';
import { handle } from './index.ts';
import { COUNSEL, DOC, HOST, IVY, OTTO, OWNER, ROOM_A, roomsDb, roomsEnv } from './rooms-fixtures.ts';

const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;
const VIEWER = { 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Site': 'same-origin' };

function client(db: D1Database) {
  const as = async (email: string, path: string, init: RequestInit = {}) => {
    resetDocFactsCache();
    return handle(new Request(`${HOST}${path}`, init), roomsEnv(db, email).env, ctx);
  };
  return { as };
}

test('the owner sees which investor opened which document and when', async () => {
  const { db } = roomsDb();
  const { as } = client(db);
  assert.equal((await as(IVY, `/api/rooms/${ROOM_A}/files/${DOC.term.id}`, { headers: VIEWER })).status, 200);
  assert.equal((await as(OTTO, `/api/rooms/${ROOM_A}/files/${DOC.cap.id}`, { headers: VIEWER })).status, 200);
  const res = await as(OWNER, '/api/activity?action=view');
  assert.equal(res.status, 200);
  const { rows } = (await res.json()) as { rows: Record<string, unknown>[] };
  const list = rows.map((r) => [r.email, r.document_name, typeof r.ts === 'string' && !Number.isNaN(Date.parse(r.ts))]);
  assert.deepEqual(list.sort(), [[IVY, 'Term sheet.pdf', true], [OTTO, 'Cap table.csv', true]].sort());
  assert.equal((await as(COUNSEL, '/api/activity')).status, 403, 'only the owner reads it');
});
