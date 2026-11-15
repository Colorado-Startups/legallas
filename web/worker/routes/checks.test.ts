// SPDX-License-Identifier: Apache-2.0
// The approval routes (worker/routes/checks.ts) through the real gate in room.ts on real SQLite: a member sees and
// decides only their own request, the page is told exactly which sites the name would go to, a write needs the room's
// own origin, and a room with the check off answers as if there were no such request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Env } from '../env.ts';
import { requestCheck } from '../public-records.ts';
import { handle } from '../room.ts';
import { testDb } from '../sqlite-d1.ts';

/** requestCheck where the member is under the cap, so a request always comes back. */
async function mustRequest(...args: Parameters<typeof requestCheck>) {
  const request = await requestCheck(...args);
  assert.ok(request, 'under the cap, a request is stored');
  return request;
}


const HOST = 'http://localhost:8789';
const ME = 'counsel@example.test';
const OTHER = 'owner@example.test';
const SAME_ORIGIN = { Origin: HOST, 'Sec-Fetch-Site': 'same-origin', 'content-type': 'application/json' };

async function room(settings: Partial<Env> = { PUBLIC_RECORDS: '1' }) {
  const { db, sqlite } = testDb();
  sqlite.prepare("INSERT INTO members (email, role, name) VALUES (?, 'counsel', NULL)").run(ME);
  sqlite.prepare("INSERT INTO members (email, role, name) VALUES (?, 'owner', NULL)").run(OTHER);
  const request = await mustRequest(db, { email: ME, name: 'Harbor Labs, Inc.', kind: 'company', sources: ['sec_edgar', 'co_open_data'], via: 'Claude', now: new Date() });
  const call = (as: string, method: 'GET' | 'POST', body?: unknown, headers: Record<string, string> = SAME_ORIGIN, id = request.id) => {
    const env = {
      ASSETS: { fetch: async () => new Response('shell') },
      DB: db,
      TEAM_DOMAIN: '',
      ACCESS_AUD: '',
      ALLOW_DEV_IDENTITY: '1',
      DEV_IDENTITY_EMAIL: as,
      ...settings,
    } as unknown as Env;
    const init: RequestInit = { method, headers: method === 'GET' ? {} : headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
    return handle(new Request(`${HOST}/api/checks/${id}`, init), env, {} as ExecutionContext);
  };
  return { db, sqlite, request, call };
}

test('GET: the member sees their own request, with the sites the name would go to and those searched by hand', async () => {
  const r = await room();
  const response = await r.call(ME, 'GET');
  assert.equal(response.status, 200);
  const view = (await response.json()) as Record<string, any>;
  assert.equal(view.name, 'Harbor Labs, Inc.');
  assert.equal(view.kind, 'company');
  assert.equal(view.state, 'pending');
  assert.equal(view.via, 'Claude');
  assert.deepEqual(view.sendsTo.map((s: { host: string }) => s.host), ['efts.sec.gov', 'data.colorado.gov']);
  assert.deepEqual(view.byHand.map((s: { source: string }) => s.source), [
    'SEC Investment Adviser Public Disclosure',
    'FINRA BrokerCheck',
    'Colorado Secretary of State business search',
    'Delaware Division of Corporations entity search',
    'CourtListener dockets',
  ]);
  assert.match(view.notices.consumerReport, /Not a consumer report/);
});

test('someone else\'s request, a malformed id, or a room with the check off: not found', async () => {
  const r = await room();
  assert.equal((await r.call(OTHER, 'GET')).status, 404);
  assert.equal((await r.call(OTHER, 'POST', { decision: 'approve' })).status, 404);
  assert.equal((await r.call(ME, 'GET', undefined, SAME_ORIGIN, 'short')).status, 404);
  const off = await room({ PUBLIC_RECORDS: '0' });
  assert.equal((await off.call(ME, 'GET')).status, 404);
  assert.equal((await off.call(ME, 'POST', { decision: 'approve' })).status, 404);
  assert.equal(off.sqlite.prepare("SELECT state FROM record_checks").get()!.state, 'pending');
});

test('POST: approve once; a second decision is refused; a bad body or another origin changes nothing', async () => {
  const r = await room();
  assert.equal((await r.call(ME, 'POST', { decision: 'maybe' })).status, 400);
  assert.equal((await r.call(ME, 'POST', 'not json')).status, 400);
  const crossSite = await r.call(ME, 'POST', { decision: 'approve' }, { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site', 'content-type': 'application/json' });
  assert.equal(crossSite.status, 403);
  assert.equal(r.sqlite.prepare('SELECT state FROM record_checks').get()!.state, 'pending');
  const approved = await r.call(ME, 'POST', { decision: 'approve' });
  assert.equal(approved.status, 200);
  assert.equal(((await approved.json()) as { state: string }).state, 'approved');
  assert.equal((await r.call(ME, 'POST', { decision: 'decline' })).status, 409);
  assert.equal(r.sqlite.prepare('SELECT state FROM record_checks').get()!.state, 'approved');
});

test('using the approval page deletes lapsed requests, anyone\'s', async () => {
  const r = await room();
  r.sqlite.prepare("INSERT INTO record_checks (id, email, name, name_key, kind, sources, state, via, created_at, decided_at, expires_at) VALUES ('LapsedRequest0000000001', ?, 'Jane Doe', 'jane doe', 'person', 'sec_edgar', 'approved', 'Ask', '2026-01-01T00:00:00.000Z', '2026-01-01T00:01:00.000Z', '2026-01-01T01:01:00.000Z')").run(OTHER);
  assert.equal((await r.call(ME, 'GET')).status, 200);
  assert.deepEqual(r.sqlite.prepare('SELECT id FROM record_checks').all().map((row) => row.id), [r.request.id]);
});

test('POST: decline', async () => {
  const r = await room();
  const declined = await r.call(ME, 'POST', { decision: 'decline' });
  assert.equal(declined.status, 200);
  assert.equal(((await declined.json()) as { state: string }).state, 'declined');
});
