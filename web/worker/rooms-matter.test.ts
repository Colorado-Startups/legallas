// SPDX-License-Identifier: Apache-2.0
// Matter rooms: outside counsel invited to one matter, end to end through the gate (index.ts, so pro's routes are
// registered too) on real SQLite. Counsel there see only that room, privileged documents in its folders included (the
// owner, 2026-11-05), never a member route or the static build, and may download; an investor in a deal room over the
// same folder still gets 404 for those documents. A role in the other kind of room is no access. The deal-room rows are
// in rooms-access.test.ts; each test here names its row in docs/design/rooms-and-grants.md ("Ways in").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionsOf, canGuest } from './rooms.ts';
import { resetDocFactsCache } from './doc-facts-serve.ts';
import { handle } from './index.ts';
import { addRoom, DOC, HOST, invite, IVY, OWNER, ROOM_A, ROOM_A_PATHS, roomsDb, roomsEnv, SAME_ORIGIN, STRANGER, type RoomsEnvOptions } from './rooms-fixtures.ts';
import { revokeSql } from '../scripts/room.ts';

const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;
const VIEWER = { 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Site': 'same-origin' };
const CLICK = { 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Site': 'same-origin' };
const MATTER = 'eeeeeeee-0000-4000-8000-00000000000e';
const CY = 'cy@firm.example';

/** The fixture plus a matter room over room A's folder, with CY invited to it as counsel. */
function matterDb() {
  const t = roomsDb();
  addRoom(t.sqlite, MATTER, 'Harbor Labs dispute', ['Deals/Harbor Seed'], 'matter');
  invite(t.sqlite, { room: MATTER, email: CY, role: 'counsel' });
  return t;
}

function client(db: D1Database, options: RoomsEnvOptions = {}) {
  const assets: string[] = [];
  const as = async (email: string, path: string, init: RequestInit = {}) => {
    resetDocFactsCache();
    const made = roomsEnv(db, email, options);
    const response = await handle(new Request(`${HOST}${path}`, init), made.env, ctx);
    assets.push(...made.assets);
    return response;
  };
  return { as, assets };
}

test('the matter room matrix: counsel may view, privileged documents included, download and comment there, and nothing else; a role in the other kind of room is nothing', () => {
  const every = ['view', 'viewPrivileged', 'download', 'readComments', 'comment', 'resolve', 'upload', 'ask', 'flag', 'connect', 'viewActivity', 'propose', 'approve', 'setCompany'];
  const allowed = ['view', 'viewPrivileged', 'download', 'readComments', 'comment'];
  for (const action of every) assert.equal(canGuest('matter', 'counsel', action), allowed.includes(action), action);
  for (const [kind, role] of [['deal', 'counsel'], ['matter', 'investor'], ['matter', 'viewer'], ['company', 'counsel'], ['__proto__', 'counsel'], ['matter', 'constructor']]) {
    for (const action of every) assert.equal(canGuest(kind!, role!, action), false, `${kind} ${role} ${action}`);
  }
  assert.equal(canGuest('deal', 'investor', 'download'), false, 'investors still never download');
  assert.equal(canGuest('deal', 'investor', 'viewPrivileged'), false, 'investors never see a privileged document');
  // A guest's AI reads without privileged documents in every room (rooms.ts guestScopeFor): no role may do both.
  for (const [kind, role] of [['deal', 'investor'], ['matter', 'counsel']]) {
    assert.ok(!(actionsOf(kind!, role!).includes('connect') && actionsOf(kind!, role!).includes('viewPrivileged')), `${kind} ${role}`);
  }
});

/** Room A's documents plus both privileged ones, by path: what counsel in the matter room over room A's folder sees. */
const MATTER_PATHS = [DOC.privilegedMark.path, DOC.privilegedPath.path, ...ROOM_A_PATHS].sort();
const pathsOf = async (response: Response) => ((await response.json()) as { documents: { name: string; folder: string }[] }).documents.map((d) => `${d.folder}/${d.name}`);
const post = (body: unknown) => ({ method: 'POST', headers: SAME_ORIGIN, body: JSON.stringify(body) });

test('R3, R4, R6: counsel in a matter room see its live documents, privileged included, and no other room, member route or static page', async () => {
  const { db } = matterDb();
  const { as, assets } = client(db);
  const me = (await (await as(CY, '/api/rooms')).json()) as { rooms: { id: string; role: string; can: Record<string, boolean> }[] };
  assert.deepEqual(me.rooms.map((r) => [r.id, r.role]), [[MATTER, 'counsel']]);
  assert.deepEqual(me.rooms[0]!.can, { view: true, viewPrivileged: true, download: true, readComments: true, comment: true });

  assert.deepEqual(await pathsOf(await as(CY, `/api/rooms/${MATTER}/documents`)), MATTER_PATHS);
  for (const doc of [DOC.record, DOC.upload, DOC.removed, DOC.dataFile, DOC.sibling, DOC.adjacent]) {
    assert.equal((await as(CY, `/api/rooms/${MATTER}/files/${doc.id}?download`, { headers: CLICK })).status, 404, doc.path);
  }
  assert.equal((await as(CY, `/api/rooms/${ROOM_A}/documents`)).status, 404, 'a deal room over the same folder is not theirs');
  for (const path of ['/api/documents', `/files/${DOC.term.id}`, `/api/doc/${DOC.term.id}`, '/documents/', '/_astro/app.js']) {
    assert.equal((await as(CY, path, { headers: VIEWER })).status, 404, path);
  }
  assert.deepEqual(assets, []);
});

test('R7: counsel in a matter room download, audited with the room; visuals and cross-site reads stay refused; investors get no links', async () => {
  const { db, sqlite } = matterDb();
  const { as } = client(db);
  const file = `/api/rooms/${MATTER}/files/${DOC.term.id}`;
  const download = await as(CY, `${file}?download`, { headers: CLICK });
  assert.equal(download.status, 200);
  assert.equal(await download.text(), '0123456789');
  assert.match(download.headers.get('Content-Disposition') ?? '', /^attachment; filename="Term sheet\.pdf"/);
  assert.match(download.headers.get('Content-Security-Policy') ?? '', /^sandbox;/);
  assert.equal((await as(CY, file, { headers: VIEWER })).headers.get('Content-Disposition'), null, 'a viewer read stays inline');
  assert.deepEqual(
    sqlite.prepare('SELECT action, document_id, room_id FROM audit_log WHERE email = ?1 ORDER BY id').all(CY).map((r) => ({ ...r })),
    [{ action: 'download', document_id: DOC.term.id, room_id: MATTER }, { action: 'view', document_id: DOC.term.id, room_id: MATTER }],
  );
  assert.equal((await as(CY, `/api/rooms/${MATTER}/files/${DOC.visual.id}`, { headers: { 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Site': 'same-origin' } })).status, 403);
  assert.equal((await as(CY, file, { headers: { 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Site': 'cross-site' } })).status, 403);

  const page = await (await as(CY, '/')).text();
  assert.match(page, /Invited as counsel until 2099-01-01/);
  for (const doc of [DOC.term, DOC.privilegedPath, DOC.privilegedMark]) {
    const name = doc.path.slice(doc.path.lastIndexOf('/') + 1);
    assert.ok(page.includes(`<a href="/api/rooms/${MATTER}/files/${doc.id}?download">${name}</a>`), name);
  }
  assert.doesNotMatch(page, /Complaint|Reply\.pdf/);
  const investor = await (await as(IVY, '/')).text();
  assert.match(investor, /Invited as an investor until/);
  assert.doesNotMatch(investor, /<a href="\/api\/rooms/, 'an investor never gets a download link');
  assert.doesNotMatch(investor, /Memo\.pdf|Board minutes/, 'nor a privileged document');
});

test('R4, R19: counsel list and open a privileged document on every guest route; an investor over the same folder gets 404 on each', async () => {
  const { db, sqlite } = matterDb();
  const { as } = client(db);
  assert.deepEqual(await pathsOf(await as(IVY, `/api/rooms/${ROOM_A}/documents`)), ROOM_A_PATHS, 'the investor lists neither');
  for (const doc of [DOC.privilegedPath, DOC.privilegedMark]) {
    const routes = (room: string) =>
      [
        [`/api/rooms/${room}/files/${doc.id}`, { headers: VIEWER }],
        [`/api/rooms/${room}/files/${doc.id}?download`, { headers: CLICK }],
        [`/rooms/${room}/view/${doc.id}`, {}],
        [`/api/rooms/${room}/documents/${doc.id}/comments`, {}],
        [`/api/rooms/${room}/documents/${doc.id}/comments`, post({ body: 'Is this the signed copy?' })],
      ] as const;
    for (const [path, init] of routes(MATTER)) {
      const res = await as(CY, path, init);
      assert.equal(res.status, 'method' in init ? 201 : 200, `counsel ${path}`);
    }
    for (const [path, init] of routes(ROOM_A)) {
      const res = await as(IVY, path, init);
      assert.equal(res.status, 404, `investor ${path}`);
      assert.deepEqual(await res.json(), { error: 'not_found' }, `investor ${path}`);
    }
  }
  const audited = sqlite.prepare("SELECT DISTINCT document_id FROM audit_log WHERE email = ?1 AND action = 'download' ORDER BY document_id").all(CY);
  assert.deepEqual(audited.map((r) => r.document_id), [DOC.privilegedPath.id, DOC.privilegedMark.id], 'each privileged download audited with the room');
  const read = sqlite.prepare('SELECT count(*) AS n FROM audit_log WHERE email = ?1 AND document_id IN (?2, ?3)').get(IVY, DOC.privilegedPath.id, DOC.privilegedMark.id);
  assert.equal(read!.n, 0, 'the investor read neither');
});

test('R4: privilege marks that cannot be read stop an investor (503) but not counsel, who see privileged documents anyway', async () => {
  const { db } = matterDb();
  const { as } = client(db, { manifest: '{"version": 99}' });
  assert.deepEqual(await pathsOf(await as(CY, `/api/rooms/${MATTER}/documents`)), MATTER_PATHS);
  assert.equal((await as(CY, `/api/rooms/${MATTER}/files/${DOC.privilegedMark.id}`, { headers: VIEWER })).status, 200);
  assert.equal((await as(IVY, `/api/rooms/${ROOM_A}/documents`)).status, 503);
});

test('the owner\'s preview and as-of read show a matter room as counsel see it, privileged included, and a deal room as investors see it', async () => {
  const { db } = matterDb();
  const { as } = client(db);
  const preview = await as(OWNER, `/api/rooms/${MATTER}/preview`);
  assert.equal(preview.status, 200);
  assert.deepEqual(await pathsOf(preview), await pathsOf(await as(CY, `/api/rooms/${MATTER}/documents`)));
  assert.deepEqual(await pathsOf(await as(OWNER, `/api/rooms/${ROOM_A}/preview`)), ROOM_A_PATHS);

  // The fixture's documents arrive on 2026-02-01 and the rooms open today, so a later instant shows them all.
  const asOf = async (room: string) => {
    const res = await as(OWNER, `/api/rooms/${room}/as-of?at=2099-01-01T00:00:00.000Z`);
    assert.equal(res.status, 200, room);
    return ((await res.json()) as { documents: { id: string }[] }).documents.map((d) => d.id).sort();
  };
  const ids = (paths: readonly string[]) => Object.values(DOC).filter((doc) => paths.includes(doc.path)).map((doc) => doc.id).sort();
  assert.deepEqual(await asOf(MATTER), ids(MATTER_PATHS));
  assert.deepEqual(await asOf(ROOM_A), ids(ROOM_A_PATHS));
});

test('#884: an as-of read before the room took the counsel rule shows the matter room as investors saw it then', async () => {
  const { db, sqlite } = matterDb();
  const { as } = client(db);
  sqlite.prepare("UPDATE rule_changes SET at = '2098-01-01T00:00:00.000Z' WHERE name = 'counsel_sees_privileged'").run();
  const asOf = async (at: string) => {
    const res = await as(OWNER, `/api/rooms/${MATTER}/as-of?at=${at}`);
    assert.equal(res.status, 200, at);
    return ((await res.json()) as { documents: { id: string }[] }).documents.map((d) => d.id).sort();
  };
  const ids = (paths: readonly string[]) => Object.values(DOC).filter((doc) => paths.includes(doc.path)).map((doc) => doc.id).sort();
  assert.deepEqual(await asOf('2097-12-31T23:59:59.999Z'), ids(ROOM_A_PATHS), 'before: no privileged document');
  assert.deepEqual(await asOf('2098-01-01T00:00:00.000Z'), ids(MATTER_PATHS), 'from the instant itself');
  sqlite.prepare("DELETE FROM rule_changes WHERE name = 'counsel_sees_privileged'").run();
  assert.deepEqual(await asOf('2099-01-01T00:00:00.000Z'), ids(ROOM_A_PATHS), 'a rule never taken applies to no instant');
});

test('R9, R11, R12: a role in the other kind of room is no access; a revoke or the setting off ends counsel\'s access at the next request', async () => {
  const { db, sqlite } = matterDb();
  const { as } = client(db);
  invite(sqlite, { room: MATTER, email: 'ian@fund.example' });
  invite(sqlite, { room: ROOM_A, email: 'cyd@firm.example', role: 'counsel' });
  for (const email of ['ian@fund.example', 'cyd@firm.example']) assert.equal((await as(email, '/')).status, 403, email);

  const off = await client(db, { enabled: false }).as(CY, '/');
  const stranger = await client(db, { enabled: false }).as(STRANGER, '/');
  assert.equal(off.status, 403);
  assert.equal(await off.text(), await stranger.text());

  assert.equal((await as(CY, `/api/rooms/${MATTER}/documents`)).status, 200);
  sqlite.exec(revokeSql(CY, new Date(), MATTER));
  assert.equal((await as(CY, `/api/rooms/${MATTER}/documents`)).status, 403);
});
