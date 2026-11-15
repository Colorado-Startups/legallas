// SPDX-License-Identifier: Apache-2.0
// Version history and a deal room's past contents, through the sync endpoints and the gate on real SQLite (every
// migration applied). The Data room page (quality-speed/pages/data-room/list.ts) reads these tests by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { roomSql } from '../scripts/room.ts';
import { syncSql } from '../scripts/sqlplan.ts';
import { handle } from './index.ts';
import { handleSync } from './routes/sync.ts';
import { invite } from './rooms-fixtures.ts';
import { CLIENT, OWNER, syncRoom, type SyncRoom } from './sync-fixtures.ts';
import { purgeRetired, RETAIN_DAYS, type SyncRecord } from './sync.ts';
import type { Env } from './env.ts';

const HOST = 'http://localhost:8789';
const COUNSEL = 'counsel@example.test';
const INVESTOR = 'ivy@fund.example';
const SEED = 'aaaaaaaa-0000-4000-8000-00000000000a';
const BRIDGE = 'bbbbbbbb-0000-4000-8000-00000000000b';
const DAY = 86_400_000;
const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const iso = (ms: number) => new Date(ms).toISOString();

/** A deal room made `daysAgo` days ago, with its folders added then. */
function addRoom(room: SyncRoom, id: string, folders: string[], madeAt: string): void {
  room.sqlite.prepare("INSERT INTO rooms (id, kind, name, created_by, created_at) VALUES (?1, 'deal', 'Harbor Labs seed', 'owner-cli', ?2)").run(id, madeAt);
  for (const folder of folders) {
    room.sqlite.prepare("INSERT INTO room_folders (id, room_id, folder, added_by, added_at) VALUES (?1, ?2, ?3, 'owner-cli', ?4)").run(`${id}:${folder}`, id, folder, madeAt);
  }
}

async function sync(room: SyncRoom, path: string, init: { method?: string; lease?: string; json?: unknown; body?: string; sha?: string } = {}): Promise<Response> {
  const headers = new Headers();
  if (init.lease) headers.set('X-Sync-Lease', init.lease);
  let body = init.body;
  if (init.json !== undefined) {
    body = JSON.stringify(init.json);
    headers.set('Content-Type', 'application/json');
  } else if (body !== undefined) {
    headers.set('Content-Type', 'application/pdf');
    headers.set('X-Sync-Sha256', init.sha!);
  }
  if (body !== undefined) headers.set('Content-Length', String(new TextEncoder().encode(body).byteLength));
  const url = `https://room.example.test${path}`;
  return handleSync(new Request(url, { method: init.method ?? 'GET', headers, body } as RequestInit), room.env, new URL(url), CLIENT);
}

/** The laptop's sync: a lease, then one run per call that uploads `text` and records it. */
async function laptop(room: SyncRoom) {
  const res = await sync(room, '/api/sync/lease', { method: 'POST', json: { device: 'laptop one' } });
  const lease = ((await res.json()) as { lease: string }).lease;
  const upload = async (text: string) => {
    const key = randomUUID();
    assert.equal((await sync(room, `/api/sync/files/${key}`, { method: 'PUT', lease, body: text, sha: sha(text) })).status, 201);
    return { key, size: new TextEncoder().encode(text).byteLength, sha256: sha(text) };
  };
  const record = async (run: string, parts: Partial<SyncRecord>) => {
    const body: SyncRecord = { run, removals: [], renames: [], changes: [], adds: [], pages: {}, ...parts };
    assert.equal((await sync(room, '/api/sync/record', { method: 'POST', lease, json: body })).status, 200);
  };
  return {
    async add(run: string, path: string, text: string) {
      const id = randomUUID();
      const file = await upload(text);
      await record(run, { adds: [{ id, path, size: file.size, sha256: file.sha256, r2_key: file.key }] });
      return { id, ...file };
    },
    async change(run: string, id: string, path: string, text: string) {
      const file = await upload(text);
      await record(run, { changes: [{ id, path, size: file.size, sha256: file.sha256, r2_key: file.key }] });
      return file;
    },
    rename: (run: string, id: string, path: string) => record(run, { renames: [{ id, path }] }),
    remove: (run: string, id: string) => record(run, { removals: [id] }),
  };
}

/** A request through the gate as `email` (the localhost dev identity). */
function as(room: SyncRoom, email: string, path: string): Promise<Response> {
  const env = { ...room.env, TEAM_DOMAIN: '', ACCESS_AUD: '', ALLOW_DEV_IDENTITY: '1', DEV_IDENTITY_EMAIL: email, ALERTS_ENABLED: '0', ROOMS_ENABLED: '1' } as unknown as Env;
  return handle(new Request(`${HOST}${path}`, { headers: { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Dest': 'empty' } }), env, ctx);
}

test('a replaced file shows its date and keeps the old version for the owner', async () => {
  const room = syncRoom();
  const now = Date.now();
  addRoom(room, SEED, ['Deals/Harbor Seed'], iso(now - 6 * DAY));
  addRoom(room, BRIDGE, ['Deals/Harbor Bridge'], iso(now - 6 * DAY));
  room.sqlite.exec(roomSql({ kind: 'versions', roomId: SEED, on: true }, new Date(now)));
  invite(room.sqlite, { room: SEED, email: INVESTOR });
  const events = room.sqlite.prepare("SELECT room_id, detail_code FROM access_events WHERE action = 'room_settings_changed'").all().map((e) => ({ ...e }));
  assert.deepEqual(events, [{ room_id: SEED, detail_code: 'version_history_on' }], 'the owner turned it on, once');

  const sync = await laptop(room);
  const [t1, t2] = [iso(now - 5 * DAY), iso(now - 4 * DAY)];
  const term = await sync.add(t1, 'Deals/Harbor Seed/Term sheet.pdf', 'DOE-000010 term sheet, version 1');
  const v2 = await sync.change(t2, term.id, 'Deals/Harbor Seed/Term sheet.pdf', 'DOE-000010 term sheet, version 2');
  const bridge = await sync.add(t1, 'Deals/Harbor Bridge/Note.pdf', 'DOE-000011 note, version 1');
  await sync.change(t2, bridge.id, 'Deals/Harbor Bridge/Note.pdf', 'DOE-000011 note, version 2');

  // Past the keep period, the room with version history keeps version 1; the other room's old version goes.
  assert.equal(await purgeRetired(room.env, new Date(now + (RETAIN_DAYS + 1) * DAY)), 1);
  assert.deepEqual(room.files.deleted, [bridge.key]);
  assert.equal(room.files.objects.has(term.key), true);

  // The guest sees the replaced file with its date.
  const guest = (await (await as(room, INVESTOR, `/api/rooms/${SEED}/documents`)).json()) as { documents: { id: string; updated_at: string }[] };
  assert.deepEqual(guest.documents.map((d) => [d.id, d.updated_at]), [[term.id, t2]]);

  // The owner sees both versions, each with its date and hash, and gets version 1 back byte for byte.
  const listed = await as(room, OWNER, `/api/documents/${term.id}/versions`);
  assert.equal(listed.status, 200);
  assert.deepEqual(((await listed.json()) as { versions: unknown[] }).versions, [
    { n: 1, sha256: term.sha256, size: term.size, date: t1, replaced_at: t2, current: false, stored: true },
    { n: 2, sha256: v2.sha256, size: v2.size, date: t2, replaced_at: null, current: true, stored: true },
  ]);
  const v1 = await as(room, OWNER, `/files/${term.id}/versions/1`);
  assert.equal(v1.status, 200);
  assert.equal(await v1.text(), 'DOE-000010 term sheet, version 1');
  assert.match(v1.headers.get('Content-Disposition') ?? '', /^attachment; filename="Term sheet.pdf"/);
  assert.equal((await as(room, COUNSEL, `/api/documents/${term.id}/versions`)).status, 403, 'for the owner');
  assert.equal((await as(room, COUNSEL, `/files/${term.id}/versions/1`)).status, 403);

  // Never longer than the room: archived, the old version goes at the next purge.
  room.sqlite.exec(roomSql({ kind: 'archive', roomId: SEED }, new Date(now)));
  assert.equal(await purgeRetired(room.env, new Date(now + (RETAIN_DAYS + 1) * DAY)), 1);
  assert.deepEqual(room.files.deleted, [bridge.key, term.key]);
  const after = (await (await as(room, OWNER, `/api/documents/${term.id}/versions`)).json()) as { versions: { stored: boolean }[] };
  assert.deepEqual(after.versions.map((v) => v.stored), [false, true]);
});

test('after a replacement, the guest sees the latest with its date', async () => {
  const room = syncRoom();
  const now = Date.now();
  addRoom(room, SEED, ['Deals/Harbor Seed'], iso(now - 6 * DAY));
  invite(room.sqlite, { room: SEED, email: INVESTOR });
  const sync = await laptop(room);
  const [t1, t2] = [iso(now - 5 * DAY), iso(now - 4 * DAY)];
  const term = await sync.add(t1, 'Deals/Harbor Seed/Term sheet.pdf', 'DOE-000010 term sheet, version 1');
  const v2 = await sync.change(t2, term.id, 'Deals/Harbor Seed/Term sheet.pdf', 'DOE-000010 term sheet, version 2');

  // One row, with the replacement's date, whether or not the owner keeps old versions.
  const listed = (await (await as(room, INVESTOR, `/api/rooms/${SEED}/documents`)).json()) as { documents: { id: string; updated_at: string }[] };
  assert.deepEqual(listed.documents.map((d) => [d.id, d.updated_at]), [[term.id, t2]]);
  // The viewer gets version 2's bytes, never version 1's.
  const served = await as(room, INVESTOR, `/api/rooms/${SEED}/files/${term.id}`);
  assert.equal(served.status, 200);
  const text = await served.text();
  assert.equal(text, 'DOE-000010 term sheet, version 2');
  assert.equal(sha(text), v2.sha256);
  // A guest has no way to an earlier version.
  assert.equal((await as(room, INVESTOR, `/api/documents/${term.id}/versions`)).status, 404);
  assert.equal((await as(room, INVESTOR, `/files/${term.id}/versions/1`)).status, 404);
});

test('npm run sync keeps an original only where version history keeps it', () => {
  const room = syncRoom();
  const now = Date.now();
  addRoom(room, SEED, ['Deals/Harbor Seed'], iso(now - 6 * DAY));
  room.sqlite.exec(roomSql({ kind: 'versions', roomId: SEED, on: true }, new Date(now)));
  const row = (id: string, path: string) =>
    room.sqlite
      .prepare("INSERT INTO documents (id, path, folder, name, kind, content_type, size, sha256, r2_key, source, updated_at, control_seq) VALUES (?1, ?2, '', ?2, 'pdf', 'application/pdf', 1, ?3, ?4, 'mirror', ?5, ?6)")
      .run(id, path, sha(id), `old-${id}`, iso(now - DAY), id === 'd1' ? 1 : 2);
  row('d1', 'Deals/Harbor Seed/Cap table.pdf');
  row('d2', 'Deals/Elsewhere/Cap table.pdf');
  const change = (id: string, path: string) => ({ id, path, folder: '', name: path, kind: 'pdf', contentType: 'application/pdf', size: 2, sha256: sha(`${id}2`), r2Key: `new-${id}`, oldR2Key: `old-${id}` });
  const plan = { adds: [], removals: [], renames: [], changes: [change('d1', 'Deals/Harbor Seed/Cap table.pdf'), change('d2', 'Deals/Elsewhere/Cap table.pdf')] };
  const sql = syncSql(plan as unknown as Parameters<typeof syncSql>[0], iso(now));
  room.sqlite.exec(sql);
  room.sqlite.exec(sql);
  assert.deepEqual(room.sqlite.prepare('SELECT r2_key, document_id FROM sync_retired').all().map((r) => ({ ...r })), [{ r2_key: 'old-d1', document_id: 'd1' }]);
});

test('the owner can ask what the room showed on any past date', async () => {
  const room = syncRoom();
  const now = Date.now();
  const days = (n: number) => iso(now - n * DAY);
  addRoom(room, SEED, ['Deals/Harbor Seed'], days(6.5));
  const sync = await laptop(room);
  const term = await sync.add(days(6), 'Deals/Harbor Seed/Term sheet.pdf', 'DOE-000010 term sheet, version 1');
  const cap = await sync.add(days(6), 'Deals/Harbor Seed/Cap table.pdf', 'DOE-000012 cap table');
  const deck = await sync.add(days(6), 'Deals/Harbor Seed/Deck.pdf', 'DOE-000013 deck');
  await sync.add(days(6), 'Deals/Harbor Seed/Counsel privileged/Memo.pdf', 'DOE-000014 memo');
  const v2 = await sync.change(days(4), term.id, 'Deals/Harbor Seed/Term sheet.pdf', 'DOE-000010 term sheet, version 2');
  await sync.rename(days(4), cap.id, 'Deals/Board/Cap table.pdf');
  await sync.remove(days(2), deck.id);

  const shown = async (at: string) => {
    const res = await as(room, OWNER, `/api/rooms/${SEED}/as-of?at=${encodeURIComponent(at)}`);
    assert.equal(res.status, 200, at);
    const { documents } = (await res.json()) as { documents: { id: string; name: string; sha256: string }[] };
    return documents.map((d) => [d.name, d.sha256]);
  };
  assert.deepEqual(await shown(days(7)), [], 'before the room existed');
  assert.deepEqual(await shown(days(5)), [['Cap table.pdf', cap.sha256], ['Deck.pdf', deck.sha256], ['Term sheet.pdf', term.sha256]]);
  assert.deepEqual(await shown(days(3)), [['Deck.pdf', deck.sha256], ['Term sheet.pdf', v2.sha256]], 'version 2, the cap table moved out');
  assert.deepEqual(await shown(days(1)), [['Term sheet.pdf', v2.sha256]], 'the deck removed');
  assert.deepEqual(await shown(days(5).slice(0, 10)), await shown(`${days(5).slice(0, 10)}T23:59:59.999Z`), 'a plain date is its end');

  assert.equal((await as(room, OWNER, `/api/rooms/${SEED}/as-of?at=yesterday`)).status, 400);
  assert.equal((await as(room, OWNER, `/api/rooms/${BRIDGE}/as-of?at=${days(1)}`)).status, 404);
  assert.equal((await as(room, COUNSEL, `/api/rooms/${SEED}/as-of?at=${days(1)}`)).status, 403, 'for the owner');
});
