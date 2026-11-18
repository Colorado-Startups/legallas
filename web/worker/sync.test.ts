// SPDX-License-Identifier: Apache-2.0
// The room's sync endpoints behind their token check, on real SQLite and the real migrations (sync-fixtures.ts).
// sync-gate.test.ts covers the token check itself, through room.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { SyncPlan } from '../scripts/diff.ts';
import { syncSql } from '../scripts/sqlplan.ts';
import { kindOf, splitPath } from './doc-kinds.ts';
import { handleSync } from './routes/sync.ts';
import { acquireLease, isSyncKey, LEASE_TTL_MS, MAX_RECORD_OPS, parseSyncRecord, purgeRetired, RETAIN_DAYS, SYNC_PART_BYTES, validSyncPath, type SyncRecord } from './sync.ts';
import './digest-fixtures.ts';
import { syncRoom, CLIENT, NOW, ORIGIN, OWNER, type SyncRoom } from './sync-fixtures.ts';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

interface Call {
  method?: string;
  lease?: string | null;
  body?: BodyInit;
  json?: unknown;
  headers?: Record<string, string>;
  client?: string | null;
}

async function call(room: SyncRoom, path: string, options: Call = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  if (options.lease) headers.set('X-Sync-Lease', options.lease);
  let body = options.body;
  if (options.json !== undefined) {
    body = JSON.stringify(options.json);
    headers.set('Content-Type', 'application/json');
  }
  if (body !== undefined && !headers.has('Content-Length')) headers.set('Content-Length', String(new Blob([body as string]).size));
  const url = `${ORIGIN}${path}`;
  const request = new Request(url, { method: options.method ?? 'GET', headers, ...(body !== undefined ? { body, duplex: 'half' } : {}) } as RequestInit);
  return handleSync(request, room.env, new URL(url), options.client === undefined ? CLIENT : options.client);
}

async function lease(room: SyncRoom, device = 'laptop one'): Promise<string> {
  const response = await call(room, '/api/sync/lease', { method: 'POST', json: { device } });
  assert.equal(response.status, 201);
  return ((await response.json()) as { lease: string }).lease;
}

async function putFile(room: SyncRoom, held: string, text: string, key: string = randomUUID()): Promise<{ key: string; size: number; sha256: string }> {
  const bytes = new TextEncoder().encode(text);
  const response = await call(room, `/api/sync/files/${key}`, {
    method: 'PUT',
    lease: held,
    body: bytes,
    headers: { 'Content-Type': 'application/pdf', 'X-Sync-Sha256': sha(bytes) },
  });
  assert.equal(response.status, 201);
  return { key, size: bytes.byteLength, sha256: sha(bytes) };
}

function record(parts: Partial<SyncRecord> = {}): SyncRecord {
  return { run: new Date().toISOString(), removals: [], renames: [], changes: [], adds: [], pages: {}, ...parts };
}

const docs = (room: SyncRoom) =>
  room.sqlite.prepare('SELECT id, path, folder, name, kind, content_type, size, sha256, pages, r2_key, source, removed_at, control_seq FROM documents ORDER BY path').all().map((row) => ({ ...row })) as Record<string, unknown>[];

async function addDoc(room: SyncRoom, held: string, path: string, text = `text of ${path}`) {
  const file = await putFile(room, held, text);
  const id = randomUUID();
  const response = await call(room, '/api/sync/record', { method: 'POST', lease: held, json: record({ adds: [{ id, path, size: file.size, sha256: file.sha256, r2_key: file.key }] }) });
  assert.equal(response.status, 200);
  return { id, ...file };
}

// --- Who gets in ------------------------------------------------------------------------------------------------

test('no verified token, a token nobody registered, a revoked one, and one not the owner\'s are all refused', async () => {
  const room = syncRoom();
  assert.equal((await call(room, '/api/sync/state', { client: null })).status, 403);
  assert.equal((await call(room, '/api/sync/state', { client: 'stranger.access' })).status, 403);
  room.sqlite.exec("INSERT INTO sync_tokens (client_id, owner_email) VALUES ('counsel.access', 'counsel@example.test')");
  assert.equal((await call(room, '/api/sync/state', { client: 'counsel.access' })).status, 403);
  room.sqlite.exec("INSERT INTO sync_tokens (client_id, owner_email, revoked_at) VALUES ('old.access', 'founder@example.test', '2026-10-01T00:00:00.000Z')");
  assert.equal((await call(room, '/api/sync/state', { client: 'old.access' })).status, 403);
  assert.equal((await call(room, '/api/sync/state')).status, 200);
  room.sqlite.exec(`UPDATE members SET role = 'counsel' WHERE email = '${OWNER}'`);
  assert.equal((await call(room, '/api/sync/state')).status, 403, 'the moment its owner is no longer the owner');
});

test('a request a browser sent is refused even with a good token', async () => {
  const room = syncRoom();
  assert.equal((await call(room, '/api/sync/state', { headers: { 'Sec-Fetch-Site': 'same-origin' } })).status, 403);
  assert.equal((await call(room, '/api/sync/state', { headers: { Origin: ORIGIN } })).status, 403);
});

test('every write needs the lease, and state does not', async () => {
  const room = syncRoom();
  assert.equal((await call(room, '/api/sync/state')).status, 200);
  const key = randomUUID();
  const writes: [string, string][] = [
    ['PUT', '/api/sync/lease'],
    ['DELETE', '/api/sync/lease'],
    ['PUT', `/api/sync/files/${key}`],
    ['DELETE', `/api/sync/files/${key}`],
    ['POST', `/api/sync/files/${key}/uploads`],
    ['PUT', `/api/sync/files/${key}/uploads/u/parts/1`],
    ['POST', `/api/sync/files/${key}/uploads/u/complete`],
    ['DELETE', `/api/sync/files/${key}/uploads/u`],
    ['POST', '/api/sync/record'],
    ['PUT', `/api/sync/index/${key}/1`],
    ['DELETE', `/api/sync/index/${key}/1`],
    ['PUT', '/api/sync/side/x.txt'],
    ['DELETE', '/api/sync/side/x.txt'],
    ['POST', '/api/sync/reindex'],
    ['GET', `/api/sync/pulls/${key}`],
    ['POST', '/api/sync/pulls'],
  ];
  for (const [method, path] of writes) {
    const none = await call(room, path, { method });
    assert.equal(none.status, 409, `${method} ${path}`);
    assert.deepEqual(await none.json(), { error: 'lease_lost' });
    assert.equal((await call(room, path, { method, lease: 'not-the-lease' })).status, 409, `${method} ${path}`);
  }
});

// --- One uploader at a time -------------------------------------------------------------------------------------

test('a second device is told who holds the lease, then takes over and fences the first one out', async () => {
  const room = syncRoom();
  const first = await lease(room, 'laptop one');
  const refused = await call(room, '/api/sync/lease', { method: 'POST', json: { device: 'laptop two' } });
  assert.equal(refused.status, 409);
  const body = (await refused.json()) as { error: string; device: string };
  assert.equal(body.error, 'lease_held');
  assert.equal(body.device, 'laptop one');

  const taken = await call(room, '/api/sync/lease', { method: 'POST', json: { device: 'laptop two', takeover: true } });
  assert.equal(taken.status, 201);
  const second = ((await taken.json()) as { lease: string }).lease;
  assert.notEqual(second, first);

  assert.equal((await call(room, '/api/sync/reindex', { method: 'POST', lease: first })).status, 409);
  assert.equal((await call(room, '/api/sync/lease', { method: 'PUT', lease: first })).status, 409);
  assert.equal((await call(room, '/api/sync/reindex', { method: 'POST', lease: second })).status, 200);
});

test('an expired lease goes to whoever asks, and the same device fences out its own crashed run', async () => {
  const room = syncRoom();
  const start = new Date(NOW);
  const first = await acquireLease(room.db, 'laptop one', false, start);
  assert.equal(first.ok, true);
  const early = await acquireLease(room.db, 'laptop two', false, new Date(start.getTime() + LEASE_TTL_MS - 1));
  assert.equal(early.ok, false);
  const same = await acquireLease(room.db, 'laptop one', false, new Date(start.getTime() + 1));
  assert.ok(same.ok && first.ok && same.lease !== first.lease);
  const late = await acquireLease(room.db, 'laptop two', false, new Date(start.getTime() + 1 + LEASE_TTL_MS));
  assert.equal(late.ok, true);
});

// --- Originals --------------------------------------------------------------------------------------------------

test('a small original goes up at a new key, once, checked against its sha256', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const file = await putFile(room, held, 'hello');
  assert.equal(new TextDecoder().decode(room.files.objects.get(file.key)?.bytes), 'hello');
  assert.equal(room.files.objects.get(file.key)?.contentType, 'application/pdf');

  // The same bytes after a lost response are done already.
  const again = await call(room, `/api/sync/files/${file.key}`, { method: 'PUT', lease: held, body: 'hello', headers: { 'Content-Type': 'application/pdf', 'X-Sync-Sha256': file.sha256 } });
  assert.equal(again.status, 200);
  // Different bytes never overwrite.
  const other = await call(room, `/api/sync/files/${file.key}`, { method: 'PUT', lease: held, body: 'other', headers: { 'Content-Type': 'application/pdf', 'X-Sync-Sha256': sha('other') } });
  assert.equal(other.status, 409);
  assert.equal(new TextDecoder().decode(room.files.objects.get(file.key)?.bytes), 'hello');
});

test('a large file goes up in parts, and a retry or a lost response is harmless', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const key = randomUUID();
  const started = await call(room, `/api/sync/files/${key}/uploads`, { method: 'POST', lease: held, json: { contentType: 'application/pdf' } });
  assert.equal(started.status, 201);
  const { upload, part_bytes: partBytes } = (await started.json()) as { upload: string; part_bytes: number };
  assert.equal(partBytes, SYNC_PART_BYTES);

  const base = `/api/sync/files/${key}/uploads/${encodeURIComponent(upload)}`;
  const first = new Uint8Array(6 * 1024 * 1024).fill(1);
  const second = new Uint8Array(1024).fill(2);
  const parts = [];
  for (const [n, bytes] of [[1, first], [1, first], [2, second]] as const) {
    const response = await call(room, `${base}/parts/${n}`, { method: 'PUT', lease: held, body: bytes });
    assert.equal(response.status, 200);
    if (parts.length < n) parts.push(await response.json());
  }
  const size = first.byteLength + second.byteLength;
  const done = await call(room, `${base}/complete`, { method: 'POST', lease: held, json: { size, parts } });
  assert.equal(done.status, 200);
  const stored = room.files.objects.get(key);
  assert.equal(stored?.bytes.byteLength, size);
  assert.equal(stored?.contentType, 'application/pdf');
  assert.equal(stored?.bytes[0], 1);
  assert.equal(stored?.bytes[size - 1], 2);

  // The response was lost: asked again, the finished object answers.
  assert.equal((await call(room, `${base}/complete`, { method: 'POST', lease: held, json: { size, parts } })).status, 200);
  // A key already holding an object can't start another upload.
  assert.equal((await call(room, `/api/sync/files/${key}/uploads`, { method: 'POST', lease: held, json: { contentType: 'application/pdf' } })).status, 409);
});

test('two single puts racing past the check can\'t both write: R2 itself refuses the second', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const key = randomUUID();
  await room.files.put(key, 'first');
  // As if this request had read the bucket before the other's write arrived.
  const head = room.files.head.bind(room.files);
  room.files.head = (async () => null) as never;
  const raced = await call(room, `/api/sync/files/${key}`, { method: 'PUT', lease: held, body: 'second', headers: { 'Content-Type': 'application/pdf', 'X-Sync-Sha256': sha('second') } });
  room.files.head = head;
  assert.equal(raced.status, 409);
  assert.equal(new TextDecoder().decode(room.files.objects.get(key)?.bytes), 'first');
});

test('a put that fails leaves what another request wrote at that key', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const key = randomUUID();
  await room.files.put(key, 'the winner');
  const head = room.files.head.bind(room.files);
  room.files.head = (async () => null) as never;
  const put = room.files.put.bind(room.files);
  room.files.put = (async () => {
    throw new Error('BadDigest');
  }) as never;
  const failed = await call(room, `/api/sync/files/${key}`, { method: 'PUT', lease: held, body: 'loser', headers: { 'Content-Type': 'application/pdf', 'X-Sync-Sha256': sha('not this') } });
  room.files.head = head;
  room.files.put = put;
  assert.equal(failed.status, 400);
  assert.equal(new TextDecoder().decode(room.files.objects.get(key)?.bytes), 'the winner');
  assert.deepEqual(room.files.deleted, []);
});

test('finishing an upload never replaces or deletes an original a document points at', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const key = randomUUID();
  const start = async () => {
    const started = await call(room, `/api/sync/files/${key}/uploads`, { method: 'POST', lease: held, json: { contentType: 'application/pdf' } });
    return `/api/sync/files/${key}/uploads/${encodeURIComponent(((await started.json()) as { upload: string }).upload)}`;
  };
  const part = async (base: string, text: string) => [await (await call(room, `${base}/parts/1`, { method: 'PUT', lease: held, body: text })).json()];
  const complete = (base: string, size: number, parts: unknown[]) => call(room, `${base}/complete`, { method: 'POST', lease: held, json: { size, parts } });

  const first = await start();
  // A second upload on the key, made straight on R2: the room now refuses to start one (#280), but one made before
  // that rule, or by a racing start, must still never complete over the original.
  const stray = await room.files.createMultipartUpload(key, { httpMetadata: { contentType: 'application/pdf' } });
  const second = `/api/sync/files/${key}/uploads/${encodeURIComponent(stray.uploadId)}`;
  const firstParts = await part(first, 'the original');
  const secondParts = await part(second, 'another text');
  assert.equal((await complete(first, 12, firstParts)).status, 200);
  const recorded = record({ adds: [{ id: randomUUID(), path: 'a.zip', size: 12, sha256: sha('the original'), r2_key: key }] });
  assert.equal((await call(room, '/api/sync/record', { method: 'POST', lease: held, json: recorded })).status, 200);

  const untouched = () => assert.equal(new TextDecoder().decode(room.files.objects.get(key)?.bytes), 'the original');
  assert.equal((await complete(second, 12, secondParts)).status, 200, 'the same size again answers as a lost response');
  untouched();
  assert.equal((await complete(second, 99, secondParts)).status, 409);
  untouched();
  assert.equal((await call(room, `/api/sync/files/${key}/uploads`, { method: 'POST', lease: held, json: { contentType: 'application/pdf' } })).status, 409);

  // A document's key with no object left, as after the keep period: still not completed over.
  await room.files.delete(key);
  assert.equal((await complete(second, 12, secondParts)).status, 409);
  assert.equal(room.files.objects.has(key), false);
});

test('an upload of the wrong size stays out of the record', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const key = randomUUID();
  const started = await call(room, `/api/sync/files/${key}/uploads`, { method: 'POST', lease: held, json: { contentType: 'application/pdf' } });
  const base = `/api/sync/files/${key}/uploads/${encodeURIComponent(((await started.json()) as { upload: string }).upload)}`;
  const part = await (await call(room, `${base}/parts/1`, { method: 'PUT', lease: held, body: new Uint8Array(10) })).json();
  assert.equal((await call(room, `${base}/complete`, { method: 'POST', lease: held, json: { size: 11, parts: [part] } })).status, 409);
  const body = record({ adds: [{ id: randomUUID(), path: 'a.zip', size: 11, sha256: sha('x'), r2_key: key }] });
  assert.equal((await call(room, '/api/sync/record', { method: 'POST', lease: held, json: body })).status, 409);
});

test('a large upload goes into the record only with the sha256 of its own bytes, which the room computes', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const key = randomUUID();
  const bytes = new TextEncoder().encode('the altered draft of the fixture agreement');
  const started = await call(room, `/api/sync/files/${key}/uploads`, { method: 'POST', lease: held, json: { contentType: 'application/pdf' } });
  const base = `/api/sync/files/${key}/uploads/${encodeURIComponent(((await started.json()) as { upload: string }).upload)}`;
  const part = await (await call(room, `${base}/parts/1`, { method: 'PUT', lease: held, body: bytes })).json();
  assert.equal((await call(room, `${base}/complete`, { method: 'POST', lease: held, json: { size: bytes.byteLength, parts: [part] } })).status, 200);
  const id = randomUUID();
  const add = (sha256: string) => record({ adds: [{ id, path: 'Agreements/supply.pdf', size: bytes.byteLength, sha256, r2_key: key }] });
  // Another file's hash, claimed for these bytes, is refused and records nothing.
  assert.equal((await call(room, '/api/sync/record', { method: 'POST', lease: held, json: add(sha('the signed fixture agreement')) })).status, 409);
  assert.equal(docs(room).length, 0);
  assert.equal((await call(room, '/api/sync/record', { method: 'POST', lease: held, json: add(sha(bytes)) })).status, 200);
  assert.equal(docs(room)[0]?.sha256, sha(bytes));
});

test('only a stopped run\'s own upload can be deleted', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const orphan = await putFile(room, held, 'never recorded');
  assert.equal((await call(room, `/api/sync/files/${orphan.key}`, { method: 'DELETE', lease: held })).status, 200);
  assert.equal(room.files.objects.has(orphan.key), false);

  const doc = await addDoc(room, held, 'a.pdf');
  assert.equal((await call(room, `/api/sync/files/${doc.key}`, { method: 'DELETE', lease: held })).status, 409);
  assert.equal(room.files.objects.has(doc.key), true);
});

// --- The record -------------------------------------------------------------------------------------------------

test('a change keeps the old original, and sending it twice keeps it once', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const doc = await addDoc(room, held, 'a.pdf', 'first');
  const next = await putFile(room, held, 'second');
  const body = record({ changes: [{ id: doc.id, path: 'a.pdf', size: next.size, sha256: next.sha256, r2_key: next.key }], pages: { [doc.id]: 3 } });
  assert.equal((await call(room, '/api/sync/record', { method: 'POST', lease: held, json: body })).status, 200);
  assert.equal((await call(room, '/api/sync/record', { method: 'POST', lease: held, json: body })).status, 200);
  const [row] = docs(room);
  assert.equal(row!.r2_key, next.key);
  assert.equal(row!.pages, 3);
  assert.equal(room.files.objects.has(doc.key), true);
  assert.deepEqual(
    room.sqlite.prepare('SELECT r2_key, document_id FROM sync_retired').all().map((r) => ({ ...r })),
    [{ r2_key: doc.key, document_id: doc.id }],
  );
  // The kept original is out of a token's reach.
  assert.equal((await call(room, `/api/sync/files/${doc.key}`, { method: 'DELETE', lease: held })).status, 409);
  const put = await call(room, `/api/sync/files/${doc.key}`, { method: 'PUT', lease: held, body: 'x', headers: { 'Content-Type': 'application/pdf', 'X-Sync-Sha256': sha('x') } });
  assert.equal(put.status, 409);
});

test('a rename keeps the id and number, and a removal keeps the row and the bytes', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const a = await addDoc(room, held, 'old/a.pdf');
  const b = await addDoc(room, held, 'b.pdf');
  const response = await call(room, '/api/sync/record', { method: 'POST', lease: held, json: record({ renames: [{ id: a.id, path: 'new/a copy.md' }], removals: [b.id] }) });
  assert.equal(response.status, 200);
  const rows = docs(room);
  const renamed = rows.find((row) => row.id === a.id)!;
  assert.equal(renamed.path, 'new/a copy.md');
  assert.equal(renamed.folder, 'new');
  assert.equal(renamed.name, 'a copy.md');
  assert.equal(renamed.kind, 'markdown');
  assert.equal(renamed.control_seq, 1);
  const removed = rows.find((row) => row.id === b.id)!;
  assert.ok(removed.removed_at);
  assert.equal(room.files.objects.has(b.key), true);
  assert.equal(room.sqlite.prepare('SELECT count(*) AS n FROM sync_retired WHERE r2_key = ?').get(b.key)!.n, 1);
  // Not in the state a run reads any more.
  const state = (await (await call(room, '/api/sync/state')).json()) as { rows: { id: string }[] };
  assert.deepEqual(state.rows.map((row) => row.id), [a.id]);
});

test('counsel\'s rows can\'t be changed, renamed, removed or re-paged through the record', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const id = randomUUID();
  room.sqlite.exec(
    `INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at, control_seq) ` +
      `VALUES ('${id}', 'from-counsel/${id}/memo.pdf', 'from-counsel/${id}', 'memo.pdf', 'pdf', 'application/pdf', 5, '${randomUUID()}', 'counsel', '${NOW}', 1)`,
  );
  const before = docs(room);
  const file = await putFile(room, held, 'forged');
  const body = record({
    removals: [id],
    renames: [{ id, path: 'moved.pdf' }],
    changes: [{ id, path: `elsewhere.pdf`, size: file.size, sha256: file.sha256, r2_key: file.key }],
    pages: { [id]: 9 },
  });
  assert.equal((await call(room, '/api/sync/record', { method: 'POST', lease: held, json: body })).status, 200);
  assert.deepEqual(docs(room), before);
  assert.equal(room.sqlite.prepare('SELECT count(*) AS n FROM sync_retired').get()!.n, 0);
  assert.equal(room.sqlite.prepare('SELECT count(*) AS n FROM audit_log').get()!.n, 0);
});

test('a row can\'t point at an object that is missing or of another size', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const missing = record({ adds: [{ id: randomUUID(), path: 'a.pdf', size: 1, sha256: sha('x'), r2_key: randomUUID() }] });
  assert.equal((await call(room, '/api/sync/record', { method: 'POST', lease: held, json: missing })).status, 409);
  const file = await putFile(room, held, 'abc');
  const wrongSize = record({ adds: [{ id: randomUUID(), path: 'a.pdf', size: 99, sha256: file.sha256, r2_key: file.key }] });
  assert.equal((await call(room, '/api/sync/record', { method: 'POST', lease: held, json: wrongSize })).status, 409);
  const wrongHash = record({ adds: [{ id: randomUUID(), path: 'a.pdf', size: file.size, sha256: sha('other'), r2_key: file.key }] });
  assert.equal((await call(room, '/api/sync/record', { method: 'POST', lease: held, json: wrongHash })).status, 409);
  assert.equal(docs(room).length, 0);
});

test('a record can\'t point a row at another document\'s original or a kept one', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const a = await addDoc(room, held, 'a.pdf', 'same text');
  const b = await addDoc(room, held, 'b.pdf', 'other text');
  const before = docs(room);
  const send = (json: SyncRecord) => call(room, '/api/sync/record', { method: 'POST', lease: held, json });

  const theirs = { size: a.size, sha256: a.sha256, r2_key: a.key };
  const added = await send(record({ adds: [{ id: randomUUID(), path: 'c.pdf', ...theirs }] }));
  assert.equal(added.status, 409);
  assert.deepEqual(await added.json(), { error: 'key_taken' });
  assert.equal((await send(record({ changes: [{ id: b.id, path: 'b.pdf', ...theirs }] }))).status, 409);
  assert.deepEqual(docs(room), before);

  // Replaced, so kept for a time: still no row may take it.
  const next = await putFile(room, held, 'newer text');
  assert.equal((await send(record({ changes: [{ id: a.id, path: 'a.pdf', size: next.size, sha256: next.sha256, r2_key: next.key }] }))).status, 200);
  assert.equal((await send(record({ changes: [{ id: b.id, path: 'b.pdf', ...theirs }] }))).status, 409);
  assert.equal((await send(record({ changes: [{ id: a.id, path: 'a.pdf', ...theirs }] }))).status, 409);
  assert.equal(docs(room).find((row) => row.id === a.id)!.r2_key, next.key);
});

test('the keep period runs on the room\'s clock, whatever time the run says it is', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const a = await addDoc(room, held, 'a.pdf', 'first');
  const b = await addDoc(room, held, 'b.pdf', 'second');
  const next = await putFile(room, held, 'third');
  const backdated = new Date(Date.now() - 6 * 86_400_000).toISOString();
  const started = new Date().toISOString();
  const response = await call(room, '/api/sync/record', {
    method: 'POST',
    lease: held,
    json: record({ run: backdated, removals: [b.id], changes: [{ id: a.id, path: 'a.pdf', size: next.size, sha256: next.sha256, r2_key: next.key }] }),
  });
  assert.equal(response.status, 200);
  const kept = room.sqlite.prepare('SELECT retired_at FROM sync_retired').all().map((row) => String(row.retired_at));
  assert.equal(kept.length, 2);
  for (const at of kept) assert.ok(at >= started, at);
});

// --- The refusals that are the security claims ---------------------------------------------------------------------

test('a privileged document can\'t be moved out of its privileged path, and can move within or into one', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const memo = await addDoc(room, held, 'Privileged/memo.pdf');
  const plain = await addDoc(room, held, 'Deals/plain.pdf');
  const send = (id: string, path: string) => call(room, '/api/sync/record', { method: 'POST', lease: held, json: record({ renames: [{ id, path }] }) });

  const refused = await send(memo.id, 'Deals/memo.pdf');
  assert.equal(refused.status, 409);
  assert.deepEqual(await refused.json(), { error: 'privileged_move' });
  assert.equal(docs(room).find((row) => row.id === memo.id)!.path, 'Privileged/memo.pdf');

  assert.equal((await send(memo.id, 'PRIVILEGED notes/memo.pdf')).status, 200);
  assert.equal((await send(plain.id, 'Privileged/plain.pdf')).status, 200);
  assert.deepEqual(docs(room).map((row) => row.path), ['PRIVILEGED notes/memo.pdf', 'Privileged/plain.pdf']);
});

const usedIngest = (room: SyncRoom) => (room.sqlite.prepare("SELECT used FROM spend_counters WHERE meter = 'search_ingest_tokens'").get() as { used: number }).used;

test('new text counts against the month where no client can skip it, a full month writes nothing, and a failed write gives it back', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const doc = await addDoc(room, held, 'a.pdf');
  const put = () => call(room, `/api/sync/index/${doc.id}/1`, { method: 'PUT', lease: held, body: 'x'.repeat(3000) });
  assert.equal((await put()).status, 201);
  assert.equal(usedIngest(room), 1000);

  const write = room.index.put.bind(room.index);
  room.index.put = (async () => {
    throw new Error('R2 failed');
  }) as never;
  assert.equal((await put()).status, 400);
  assert.equal(usedIngest(room), 1000, 'a retry does not spend the month');
  room.index.put = write;

  room.index.objects.clear();
  room.sqlite.prepare("UPDATE spend_counters SET used = ? WHERE meter = 'search_ingest_tokens'").run(Number.MAX_SAFE_INTEGER - 1);
  const refused = await put();
  assert.equal(refused.status, 429);
  assert.deepEqual(await refused.json(), { error: 'ingest_budget' });
  assert.equal(room.index.objects.size, 0);
});

test('a month\'s uploads stop at the cap, for one put and for a part', async () => {
  const room = syncRoom({ SYNC_MONTHLY_GB: '1' });
  const held = await lease(room);
  await putFile(room, held, 'fits');
  room.sqlite.prepare('UPDATE sync_upload_bytes SET used = ?').run(1024 ** 3 - 1);

  const key = randomUUID();
  const put = await call(room, `/api/sync/files/${key}`, { method: 'PUT', lease: held, body: 'too much', headers: { 'Content-Type': 'application/pdf', 'X-Sync-Sha256': sha('too much') } });
  assert.equal(put.status, 429);
  assert.deepEqual(await put.json(), { error: 'upload_budget' });
  assert.equal(room.files.objects.has(key), false);

  const started = await call(room, `/api/sync/files/${key}/uploads`, { method: 'POST', lease: held, json: { contentType: 'application/pdf' } });
  const base = `/api/sync/files/${key}/uploads/${encodeURIComponent(((await started.json()) as { upload: string }).upload)}`;
  assert.equal((await call(room, `${base}/parts/1`, { method: 'PUT', lease: held, body: 'too much' })).status, 429);
});

test('the first upload of a month stops at the cap too', async () => {
  const room = syncRoom({ SYNC_MONTHLY_GB: '0.000000001' });
  const held = await lease(room);
  const put = await call(room, `/api/sync/files/${randomUUID()}`, { method: 'PUT', lease: held, body: 'too much', headers: { 'Content-Type': 'application/pdf', 'X-Sync-Sha256': sha('too much') } });
  assert.equal(put.status, 429);
});

test('an upload that stores nothing gives its bytes back', async () => {
  const room = syncRoom();
  const held = await lease(room);
  await putFile(room, held, 'fits');
  const used = () => (room.sqlite.prepare('SELECT used FROM sync_upload_bytes').get() as { used: number }).used;
  const before = used();

  const short = { method: 'PUT', lease: held, body: 'x', headers: { 'Content-Length': '8' } };
  const put = await call(room, `/api/sync/files/${randomUUID()}`, { ...short, headers: { ...short.headers, 'Content-Type': 'application/pdf', 'X-Sync-Sha256': sha('12345678') } });
  assert.equal(put.status, 400);
  assert.equal(used(), before);

  const key = randomUUID();
  const started = await call(room, `/api/sync/files/${key}/uploads`, { method: 'POST', lease: held, json: { contentType: 'application/pdf' } });
  const upload = encodeURIComponent(((await started.json()) as { upload: string }).upload);
  assert.equal((await call(room, `/api/sync/files/${key}/uploads/${upload}/parts/1`, short)).status, 400);
  assert.equal(used(), before);
});

const usedBytes = (room: SyncRoom) => (room.sqlite.prepare('SELECT COALESCE(SUM(used), 0) AS used FROM sync_upload_bytes').get() as { used: number }).used;

test('a key takes one large upload: a second is refused, so no late complete can replace a recorded original (#280)', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const key = randomUUID();
  const start = () => call(room, `/api/sync/files/${key}/uploads`, { method: 'POST', lease: held, json: { contentType: 'application/pdf' } });
  const first = await start();
  assert.equal(first.status, 201);
  const second = await start();
  assert.equal(second.status, 409);
  assert.deepEqual(await second.json(), { error: 'key_taken' });
  const base = `/api/sync/files/${key}/uploads/${encodeURIComponent('an-upload-the-room-never-gave')}`;
  const complete = await call(room, `${base}/complete`, { method: 'POST', lease: held, json: { size: 1, parts: [{ partNumber: 1, etag: 'x' }] } });
  assert.equal(complete.status, 409, 'only the key\'s own upload completes');
});

test('a part sent again counts once, and an upload given up gives its bytes back (#283)', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const key = randomUUID();
  const started = await call(room, `/api/sync/files/${key}/uploads`, { method: 'POST', lease: held, json: { contentType: 'application/pdf' } });
  const base = `/api/sync/files/${key}/uploads/${encodeURIComponent(((await started.json()) as { upload: string }).upload)}`;
  const before = usedBytes(room);
  for (let attempt = 0; attempt < 3; attempt += 1) assert.equal((await call(room, `${base}/parts/1`, { method: 'PUT', lease: held, body: 'part one' })).status, 200);
  assert.equal(usedBytes(room) - before, 8, 'three tries of one 8-byte part');
  assert.equal((await call(room, `${base}/parts/2`, { method: 'PUT', lease: held, body: 'two' })).status, 200);
  assert.equal(usedBytes(room) - before, 11);
  assert.equal((await call(room, base, { method: 'DELETE', lease: held })).status, 200);
  assert.equal(usedBytes(room), before, 'given up: nothing stays spent');
});

test('a side file counts against the month, and removing what a sync stored gives its bytes back', async () => {
  const room = syncRoom({ SYNC_MONTHLY_GB: '1' });
  const held = await lease(room);
  const name = `${sha('page')}.txt`;
  assert.equal((await call(room, `/api/sync/side/${name}`, { method: 'PUT', lease: held, body: 'rendered text' })).status, 201);
  assert.equal(usedBytes(room), 13);

  room.sqlite.prepare('UPDATE sync_upload_bytes SET used = ?').run(1024 ** 3);
  const full = await call(room, `/api/sync/side/${sha('next')}.txt`, { method: 'PUT', lease: held, body: 'more' });
  assert.equal(full.status, 429);
  assert.equal(room.files.objects.has(`meta/visual-ai/${sha('next')}.txt`), false);

  room.sqlite.prepare('UPDATE sync_upload_bytes SET used = 13').run();
  assert.equal((await call(room, `/api/sync/side/${name}`, { method: 'DELETE', lease: held })).status, 200);
  assert.equal(usedBytes(room), 0);
  const stopped = await putFile(room, held, 'fits');
  assert.equal(usedBytes(room), 4);
  assert.equal((await call(room, `/api/sync/files/${stopped.key}`, { method: 'DELETE', lease: held })).status, 200);
  assert.equal(usedBytes(room), 0);
});

test('a stream error after the write keeps the count, because the bytes are stored', async () => {
  const room = syncRoom();
  const held = await lease(room);
  room.files.put = async (_key, value) => {
    await new Response(value as ReadableStream).arrayBuffer().catch(() => undefined);
    return {} as never;
  };
  const short = { method: 'PUT', lease: held, body: 'x', headers: { 'Content-Length': '8', 'Content-Type': 'application/pdf', 'X-Sync-Sha256': sha('12345678') } };
  assert.equal((await call(room, `/api/sync/files/${randomUUID()}`, short)).status, 400);
  assert.equal(usedBytes(room), 8);
});

test('two deletes of one key at once give its bytes back only once, so a token can\'t race the cap down', async () => {
  const room = syncRoom();
  const held = await lease(room);
  await putFile(room, held, 'kept!');
  const raced = await putFile(room, held, 'raced');
  assert.equal(usedBytes(room), 10);
  const deletes = await Promise.all([1, 2, 3].map(() => call(room, `/api/sync/files/${raced.key}`, { method: 'DELETE', lease: held })));
  assert.deepEqual(deletes.map((response) => response.status), [200, 200, 200]);
  assert.equal(usedBytes(room), 5);
});

test('a counted row lasts its month, and the end of a run clears older ones', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const kept = await putFile(room, held, 'fits');
  room.sqlite.prepare("INSERT INTO sync_counted (r2_key, period, bytes) VALUES ('older', '2020-01', 4)").run();
  assert.equal((await call(room, '/api/sync/lease', { method: 'DELETE', lease: held })).status, 200);
  assert.deepEqual(room.sqlite.prepare('SELECT r2_key FROM sync_counted').all().map((row) => row.r2_key), [kept.key]);
});

test('a delete gives back only bytes that counted: never a side file from before counting, never last month\'s', async () => {
  const room = syncRoom({ SYNC_MONTHLY_GB: '1' });
  const held = await lease(room);
  const name = `${sha('before counting')}.txt`;
  // Stored by an earlier version, which counted nothing.
  await room.files.put(`meta/visual-ai/${name}`, 'stored before counting began');
  room.sqlite.prepare('INSERT INTO sync_upload_bytes (period, used) VALUES (?, 100)').run(new Date().toISOString().slice(0, 7));
  assert.equal((await call(room, `/api/sync/side/${name}`, { method: 'DELETE', lease: held })).status, 200);
  assert.equal(room.files.objects.has(`meta/visual-ai/${name}`), false);
  assert.equal(usedBytes(room), 100);

  const old = await putFile(room, held, 'last month');
  room.sqlite.prepare("UPDATE sync_counted SET period = '2020-01' WHERE r2_key = ?").run(old.key);
  assert.equal((await call(room, `/api/sync/files/${old.key}`, { method: 'DELETE', lease: held })).status, 200);
  assert.equal(usedBytes(room), 110);
});

test('an upload that fails past midnight gives its bytes back to the month it counted in', async (t) => {
  const room = syncRoom();
  const held = await lease(room);
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-31T23:59:59Z') });
  room.files.put = async () => {
    t.mock.timers.setTime(Date.parse('2026-11-01T00:00:01Z'));
    throw new Error('the body ended early');
  };
  const put = await call(room, `/api/sync/files/${randomUUID()}`, { method: 'PUT', lease: held, body: 'x', headers: { 'Content-Type': 'application/pdf', 'X-Sync-Sha256': sha('x') } });
  assert.equal(put.status, 400);
  assert.deepEqual(room.sqlite.prepare('SELECT period, used FROM sync_upload_bytes').all().map((row) => ({ ...row })), [{ period: '2026-10', used: 0 }]);
});

test('a bad upload setting stops a sync at its first request, by name', async () => {
  for (const bad of ['0', '-1', 'Infinity', '1e30', '251', 'many', '']) {
    const refused = await call(syncRoom({ SYNC_MONTHLY_GB: bad }), '/api/sync/state');
    assert.equal(refused.status, 500, bad);
    assert.deepEqual(await refused.json(), { error: 'bad_setting' }, bad);
  }
  for (const good of ['0.5', '250']) assert.equal((await call(syncRoom({ SYNC_MONTHLY_GB: good }), '/api/sync/state')).status, 200, good);
});

test('adds and removals sent twice, after a lost response, change nothing the second time', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const gone = await addDoc(room, held, 'gone.pdf');
  const next = await putFile(room, held, 'new');
  const id = randomUUID();
  const body = record({ removals: [gone.id], adds: [{ id, path: 'new.pdf', size: next.size, sha256: next.sha256, r2_key: next.key }] });
  assert.equal((await call(room, '/api/sync/record', { method: 'POST', lease: held, json: body })).status, 200);
  const once = docs(room);
  const audit = () => room.sqlite.prepare('SELECT action, document_id FROM audit_log ORDER BY action, document_id').all().map((row) => ({ ...row }));
  const audited = audit();
  assert.equal((await call(room, '/api/sync/record', { method: 'POST', lease: held, json: body })).status, 200);
  assert.deepEqual(docs(room), once);
  assert.deepEqual(audit(), audited);
  assert.equal(room.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_retired').get()!.n, 1);
});

test('a lease given back goes to the next device at once, and an old lease can give back nothing', async () => {
  const room = syncRoom();
  const held = await lease(room, 'laptop one');
  assert.equal((await call(room, '/api/sync/lease', { method: 'DELETE', lease: held })).status, 200);
  const next = await lease(room, 'laptop two');
  assert.equal((await call(room, '/api/sync/lease', { method: 'DELETE', lease: held })).status, 409);
  assert.equal((await call(room, '/api/sync/lease', { method: 'PUT', lease: next })).status, 200);
});

test('a bad device name, an unknown path and a wrong method are refused', async () => {
  const room = syncRoom();
  for (const device of ['', 'x'.repeat(81), 'a\nb', 7]) assert.equal((await call(room, '/api/sync/lease', { method: 'POST', json: { device } })).status, 400, String(device));
  assert.equal((await call(room, '/api/sync/nothing-here')).status, 404);
  const wrong = await call(room, '/api/sync/lease', { method: 'PATCH' });
  assert.equal(wrong.status, 405);
  assert.ok(wrong.headers.get('Allow')?.includes('POST'));
});

test('an empty file goes up and into the record', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const doc = await addDoc(room, held, 'empty.txt', '');
  assert.equal(room.files.objects.get(doc.key)?.bytes.length, 0);
  assert.equal(docs(room)[0]!.size, 0);
});

test('a complete refused for a part it doesn\'t have can be sent again with the right ones', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const key = randomUUID();
  const started = await call(room, `/api/sync/files/${key}/uploads`, { method: 'POST', lease: held, json: { contentType: 'application/pdf' } });
  const base = `/api/sync/files/${key}/uploads/${encodeURIComponent(((await started.json()) as { upload: string }).upload)}`;
  const part = await (await call(room, `${base}/parts/1`, { method: 'PUT', lease: held, body: 'whole' })).json() as { partNumber: number; etag: string };
  const refused = await call(room, `${base}/complete`, { method: 'POST', lease: held, json: { size: 5, parts: [{ partNumber: 1, etag: 'wrong' }] } });
  assert.equal(refused.status, 409);
  assert.equal(room.files.objects.has(key), false);
  assert.equal((await call(room, `${base}/complete`, { method: 'POST', lease: held, json: { size: 5, parts: [part] } })).status, 200);
  assert.equal(room.files.objects.get(key)?.bytes.length, 5);
});

test('bytes that do not match their sha256 leave nothing behind', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const key = randomUUID();
  const response = await call(room, `/api/sync/files/${key}`, { method: 'PUT', lease: held, body: 'hello', headers: { 'Content-Type': 'application/pdf', 'X-Sync-Sha256': sha('not hello') } });
  assert.equal(response.status, 400);
  assert.equal(room.files.objects.has(key), false);
});

test('a key or header that is not exactly right is refused', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const headers = { 'Content-Type': 'application/pdf', 'X-Sync-Sha256': sha('x') };
  const put = (key: string, extra: Record<string, string> = {}) => call(room, `/api/sync/files/${key}`, { method: 'PUT', lease: held, body: 'x', headers: { ...headers, ...extra } });
  assert.equal((await put('matter.json')).status, 400);
  assert.equal((await put(encodeURIComponent('meta/visual-ai/x'))).status, 400);
  assert.equal((await put(randomUUID(), { 'X-Sync-Sha256': 'nope' })).status, 400);
  assert.equal((await put(randomUUID(), { 'Content-Type': 'text/html"><script>' })).status, 400);
  assert.equal((await put(randomUUID(), { 'Content-Length': String(96 * 1024 * 1024) })).status, 411);
});

test('a part over the part size, an empty part and a bad part number are refused', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const key = randomUUID();
  const { upload } = (await (await call(room, `/api/sync/files/${key}/uploads`, { method: 'POST', lease: held, json: { contentType: 'application/pdf' } })).json()) as { upload: string };
  const base = `/api/sync/files/${key}/uploads/${encodeURIComponent(upload)}`;
  assert.equal((await call(room, `${base}/parts/1`, { method: 'PUT', lease: held, body: 'x', headers: { 'Content-Length': String(SYNC_PART_BYTES + 1) } })).status, 411);
  assert.equal((await call(room, `${base}/parts/1`, { method: 'PUT', lease: held, headers: { 'Content-Length': '0' } })).status, 411);
  assert.equal((await call(room, `${base}/parts/0`, { method: 'PUT', lease: held, body: 'x' })).status, 400);
  assert.equal((await call(room, `${base}/parts/10001`, { method: 'PUT', lease: held, body: 'x' })).status, 400);
});

test('an expired lease still counts until someone takes it, so a laptop that slept carries on', async () => {
  const room = syncRoom();
  const held = await lease(room);
  room.sqlite.exec("UPDATE sync_lease SET expires_at = '2000-01-01T00:00:00.000Z'");
  assert.equal((await call(room, '/api/sync/lease', { method: 'PUT', lease: held })).status, 200);
  const row = room.sqlite.prepare('SELECT expires_at FROM sync_lease').get() as { expires_at: string };
  assert.ok(row.expires_at > new Date().toISOString());
});

test('nothing a sync replaced is deleted during a run; only the end of one removes what has waited out its time', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const doc = await addDoc(room, held, 'a.pdf', 'first');
  const next = await putFile(room, held, 'second');
  await call(room, '/api/sync/record', { method: 'POST', lease: held, json: record({ changes: [{ id: doc.id, path: 'a.pdf', size: next.size, sha256: next.sha256, r2_key: next.key }] }) });
  const done = await call(room, '/api/sync/lease', { method: 'DELETE', lease: held });
  assert.deepEqual(await done.json(), { ok: true, removed: 0 });
  assert.equal(room.files.objects.has(doc.key), true);
  assert.deepEqual(room.files.deleted, []);
});

test('index parts go only under a live mirror document, at their own key', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const doc = await addDoc(room, held, 'a.pdf');
  const put = await call(room, `/api/sync/index/${doc.id}/2`, { method: 'PUT', lease: held, body: 'page text' });
  assert.equal(put.status, 201);
  assert.equal(new TextDecoder().decode(room.index.objects.get(`text/${doc.id}.p2.md`)?.bytes), 'page text');
  assert.equal((await call(room, `/api/sync/index/${randomUUID()}/1`, { method: 'PUT', lease: held, body: 'x' })).status, 404);
  assert.equal((await call(room, `/api/sync/index/${doc.id}/0`, { method: 'PUT', lease: held, body: 'x' })).status, 400);
  assert.equal((await call(room, `/api/sync/index/${encodeURIComponent('../x')}/1`, { method: 'PUT', lease: held, body: 'x' })).status, 400);
  assert.equal((await call(room, `/api/sync/index/${doc.id}/1`, { method: 'PUT', lease: held, body: 'x', headers: { 'Content-Length': String(5 * 1024 * 1024) } })).status, 411);
  assert.equal((await call(room, `/api/sync/index/${doc.id}/2`, { method: 'DELETE', lease: held })).status, 200);
  assert.equal(room.index.objects.size, 0);
});

test('the room records each document\'s text, and a part deleted from it shows in the state as text to write again (card 8.1, #279)', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const doc = await addDoc(room, held, 'a.pdf');
  const headers = { 'X-Index-Sha256': 'a'.repeat(64), 'X-Index-Stamp': JSON.stringify({ extractor: 3 }) };
  for (const part of [1, 2, 3]) assert.equal((await call(room, `/api/sync/index/${doc.id}/${part}`, { method: 'PUT', lease: held, body: 'page text', headers })).status, 201);
  const index = async () => ((await (await call(room, '/api/sync/state')).json()) as { index: Record<string, unknown> }).index;
  assert.deepEqual(await index(), { [doc.id]: { sha256: 'a'.repeat(64), parts: 3, extractor: 3 } });
  await call(room, `/api/sync/index/${doc.id}/4`, { method: 'DELETE', lease: held });
  assert.deepEqual(await index(), { [doc.id]: { sha256: 'a'.repeat(64), parts: 3, extractor: 3 } }, 'cleaning up past the end changes nothing');
  await call(room, `/api/sync/index/${doc.id}/1`, { method: 'DELETE', lease: held });
  assert.deepEqual(await index(), { [doc.id]: { sha256: '', parts: 0, extractor: 3 } }, 'text deleted from under the document');
  const odd = { 'X-Index-Sha256': 'b'.repeat(64), 'X-Index-Stamp': '{"x":1}' };
  await call(room, `/api/sync/index/${doc.id}/1`, { method: 'PUT', lease: held, body: 'page text', headers: odd });
  assert.equal(((await index())[doc.id] as { sha256: string }).sha256, '', 'an odd stamp records nothing');
});

test('side files go only at a visual\'s side-file key, within their limits', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const name = `${sha('page')}.txt`;
  assert.equal((await call(room, `/api/sync/side/${name}`, { method: 'PUT', lease: held, body: 'rendered text' })).status, 201);
  assert.equal(room.files.objects.get(`meta/visual-ai/${name}`)?.contentType, 'text/plain; charset=utf-8');
  assert.equal((await call(room, `/api/sync/side/${encodeURIComponent('../matter.json')}`, { method: 'PUT', lease: held, body: 'x' })).status, 400);
  assert.equal((await call(room, '/api/sync/side/nope.txt', { method: 'PUT', lease: held, body: 'x' })).status, 400);
  assert.equal((await call(room, `/api/sync/side/${sha('p')}.png`, { method: 'PUT', lease: held, body: 'x', headers: { 'Content-Length': '75001' } })).status, 411);
  assert.equal((await call(room, `/api/sync/side/${name}`, { method: 'DELETE', lease: held })).status, 200);
  assert.equal(room.files.objects.has(`meta/visual-ai/${name}`), false);
});

test('a record request can\'t carry SQL, a stale run or too many operations', () => {
  const now = new Date(NOW);
  const good = { run: NOW, removals: [], renames: [], changes: [], adds: [], pages: {} };
  const id = randomUUID();
  const op = { id, path: 'a.pdf', size: 1, sha256: sha('x'), r2_key: randomUUID() };
  assert.ok(parseSyncRecord(good, now));
  assert.equal(parseSyncRecord({ ...good, run: '2020-01-01T00:00:00.000Z' }, now), null);
  assert.equal(parseSyncRecord({ ...good, run: 'yesterday' }, now), null);
  assert.equal(parseSyncRecord({ ...good, adds: [{ ...op, id: "x'; DROP TABLE documents;--" }] }, now), null);
  assert.equal(parseSyncRecord({ ...good, adds: [{ ...op, r2_key: 'meta/visual-ai/x.txt' }] }, now), null);
  assert.equal(parseSyncRecord({ ...good, adds: [{ ...op, size: -1 }] }, now), null);
  assert.equal(parseSyncRecord({ ...good, adds: [{ ...op, sha256: 'ABC' }] }, now), null);
  assert.equal(parseSyncRecord({ ...good, adds: [{ ...op, path: 'from-counsel/x/a.pdf' }] }, now), null);
  assert.equal(parseSyncRecord({ ...good, pages: { [id]: -1 } }, now), null);
  assert.equal(parseSyncRecord({ ...good, removals: Array(MAX_RECORD_OPS + 1).fill(id) }, now), null);
  assert.ok(parseSyncRecord({ ...good, removals: Array(MAX_RECORD_OPS).fill(id) }, now));
  assert.equal(parseSyncRecord({ ...good, sql: 'DROP TABLE documents' }, now)?.removals.length, 0);
});

test('a path the guard would never send is refused', () => {
  for (const good of ['a.pdf', 'Deals/Series Seed/term sheet.pdf', 'Résumé.pdf', 'counsel notes/from-counsel.pdf']) assert.equal(validSyncPath(good), true, good);
  const long = `${'a'.repeat(1025)}.pdf`;
  for (const bad of ['', '/a.pdf', 'a//b.pdf', 'a/', '../a.pdf', 'a/../b.pdf', './a.pdf', 'a\\b.pdf', 'a\nb.pdf', long, 'Résume.pdf', 'from-counsel/x.pdf', 'From-Counsel/x/y.pdf', '_private/a.pdf', 'x/Copy of _PRIVATE notes.pdf', 7, null]) {
    assert.equal(validSyncPath(bad), false, String(bad));
  }
  assert.equal(isSyncKey(randomUUID()), true);
  assert.equal(isSyncKey('meta/visual-ai/x.txt'), false);
});

// --- Keeping what a sync replaced ------------------------------------------------------------------------------

test('a kept original goes only after its time, and only when no live row uses it', async () => {
  const room = syncRoom();
  const now = new Date(NOW);
  const old = new Date(now.getTime() - (RETAIN_DAYS + 1) * 86_400_000).toISOString();
  const recent = new Date(now.getTime() - (RETAIN_DAYS - 1) * 86_400_000).toISOString();
  const liveKey = randomUUID();
  room.sqlite.exec(
    `INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at, control_seq) ` +
      `VALUES ('${randomUUID()}', 'live.pdf', '', 'live.pdf', 'pdf', 'application/pdf', 1, '${liveKey}', 'mirror', '${NOW}', 1)`,
  );
  const insert = room.sqlite.prepare('INSERT INTO sync_retired (r2_key, document_id, retired_at) VALUES (?, ?, ?)');
  insert.run('old-key', 'd1', old);
  insert.run('recent-key', 'd2', recent);
  insert.run(liveKey, 'd3', old);
  for (const key of ['old-key', 'recent-key', liveKey]) await room.files.put(key, 'x');

  assert.equal(await purgeRetired(room.env, now), 1);
  assert.deepEqual(room.files.deleted, ['old-key']);
  assert.equal(room.files.objects.has('recent-key'), true);
  assert.equal(room.files.objects.has(liveKey), true);
  assert.deepEqual(room.sqlite.prepare('SELECT r2_key FROM sync_retired').all().map((r) => r.r2_key), ['recent-key']);
});

// --- The index, the side files and the budget --------------------------------------------------------------------

// --- Counsel's uploads, coming down -----------------------------------------------------------------------------

test('a token reads a counsel upload once it waits, and never the mirror or one already pulled', async () => {
  const room = syncRoom();
  const held = await lease(room);
  const doc = await addDoc(room, held, 'a.pdf');
  const id = randomUUID();
  const key = randomUUID();
  await room.files.put(key, 'from counsel');
  room.sqlite.exec(
    `INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at, control_seq) ` +
      `VALUES ('${id}', 'from-counsel/${id}/memo.pdf', 'from-counsel/${id}', 'memo.pdf', 'pdf', 'application/pdf', 12, '${key}', 'counsel', '${NOW}', 2)`,
  );
  const state = (await (await call(room, '/api/sync/state')).json()) as { pending: { id: string; name: string }[]; rows: Record<string, unknown>[] };
  assert.deepEqual(state.pending, [{ id, name: 'memo.pdf' }]);
  assert.equal(state.rows.every((row) => !('r2_key' in row)), true);

  const pull = await call(room, `/api/sync/pulls/${id}`, { lease: held });
  assert.equal(pull.status, 200);
  assert.equal(await pull.text(), 'from counsel');
  const audit = room.sqlite.prepare("SELECT email, document_id FROM audit_log WHERE action = 'download'").all();
  assert.deepEqual(audit.map((a) => ({ ...a })), [{ email: 'sync@local', document_id: id }]);

  assert.equal((await call(room, `/api/sync/pulls/${doc.id}`, { lease: held })).status, 404);

  const run = new Date().toISOString();
  assert.equal((await call(room, '/api/sync/pulls', { method: 'POST', lease: held, json: { run, ids: [id] } })).status, 200);
  assert.equal((await call(room, '/api/sync/pulls', { method: 'POST', lease: held, json: { run, ids: [id, doc.id] } })).status, 200);
  const rows = docs(room);
  assert.equal(room.sqlite.prepare('SELECT pulled_at FROM documents WHERE id = ?').get(id)!.pulled_at, run);
  assert.equal(room.sqlite.prepare('SELECT pulled_at FROM documents WHERE id = ?').get(doc.id)!.pulled_at, null);
  assert.equal(rows.length, 2);
  assert.equal((await call(room, `/api/sync/pulls/${id}`, { lease: held })).status, 404);
  assert.equal((await call(room, '/api/sync/pulls', { method: 'POST', lease: held, json: { run: 'x', ids: [] } })).status, 400);
  assert.equal((await call(room, '/api/sync/pulls', { method: 'POST', lease: held, json: { run, ids: ["'; DROP"] } })).status, 400);
});

// --- The same record as the old way ----------------------------------------------------------------------------

test('a plan applied through the endpoints leaves the same documents and audit rows as the SQL file sync writes', async () => {
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const seed = (room: SyncRoom) => {
    for (const [n, path] of [[1, 'keep/changed.pdf'], [2, 'old/renamed.pdf'], [3, 'gone.pdf'], [4, 'pages.pdf']] as const) {
      room.sqlite.exec(
        'INSERT INTO documents (id, path, folder, name, kind, content_type, size, sha256, r2_key, source, updated_at, control_seq) ' +
          `VALUES ('${id(n)}', '${path}', '', '${path}', 'pdf', 'application/pdf', 1, 'old-${n}', 'key-${n}', 'mirror', '${NOW}', ${n})`,
      );
    }
  };
  const run = new Date().toISOString();
  // Each new original holds these bytes (put below), and the room checks a record's sha256 against them.
  const bytes = 'abc';
  const file = (rel: string) => ({ rel, size: bytes.length, sha256: sha(bytes) });
  const target = (rel: string) => {
    const { kind, contentType } = kindOf(rel);
    return { path: rel, ...splitPath(rel), kind, contentType, size: bytes.length, sha256: sha(bytes), file: file(rel) };
  };
  const row = (n: number, path: string) => ({ id: id(n), path, sha256: `old-${n}`, size: 1, kind: 'pdf', pages: null, r2_key: `key-${n}`, source: 'mirror' });
  const keys = { changed: randomUUID(), added: randomUUID() };
  const plan: SyncPlan = {
    removals: [row(3, 'gone.pdf')],
    renames: [{ ...target('new/renamed.md'), id: id(2), fromPath: 'old/renamed.pdf', old: row(2, 'old/renamed.pdf') }],
    changes: [{ ...target('keep/changed.pdf'), id: id(1), r2Key: keys.changed, oldR2Key: 'key-1', old: row(1, 'keep/changed.pdf') }],
    adds: [{ ...target('added/new file.pdf'), id: id(5), r2Key: keys.added }],
    unchanged: [],
    held: [],
  };
  const pages = new Map([[id(1), 7], [id(4), 2], [id(5), 9]]);

  const viaSql = syncRoom();
  seed(viaSql);
  viaSql.sqlite.exec(syncSql(plan, run, pages));

  const viaRoom = syncRoom();
  seed(viaRoom);
  await viaRoom.files.put(keys.changed, bytes);
  await viaRoom.files.put(keys.added, bytes);
  const held = await lease(viaRoom);
  const op = (entry: { id: string; path: string; size: number; sha256: string; r2Key: string }) => ({ id: entry.id, path: entry.path, size: entry.size, sha256: entry.sha256, r2_key: entry.r2Key });
  const response = await call(viaRoom, '/api/sync/record', {
    method: 'POST',
    lease: held,
    json: {
      run,
      removals: plan.removals.map((r) => r.id),
      renames: plan.renames.map((r) => ({ id: r.id, path: r.path })),
      changes: plan.changes.map(op),
      adds: plan.adds.map(op),
      pages: Object.fromEntries(pages),
    },
  });
  assert.equal(response.status, 200);

  assert.deepEqual(docs(viaRoom), docs(viaSql));
  const audit = (room: SyncRoom) => room.sqlite.prepare('SELECT ts, email, action, document_id FROM audit_log ORDER BY action, document_id').all().map((a) => ({ ...a }));
  assert.deepEqual(audit(viaRoom), audit(viaSql));
});
