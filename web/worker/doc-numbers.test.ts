// SPDX-License-Identifier: Apache-2.0
// Card F3: document numbers (control_seq), the Key flag and the hidden room data files, on real SQLite
// with the real migrations, through the real gate in room.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Env } from './env.ts';
import './digest-fixtures.ts';
import { handle } from './room.ts';
import { liveDocuments } from './retrieval.ts';
import { testDb } from './sqlite-d1.ts';

const HOST = 'http://localhost:8789';
const OWNER = 'founder@example.test';
const COUNSEL = 'ada@firm.example';
const SAME_ORIGIN = { Origin: HOST, 'Sec-Fetch-Site': 'same-origin' };

// Workers' FixedLengthStream, as the upload route uses it: passes bytes through unchanged.
(globalThis as Record<string, unknown>).FixedLengthStream = class {
  constructor() {
    return new TransformStream<Uint8Array, Uint8Array>();
  }
};

function room(who = COUNSEL) {
  const { db, sqlite } = testDb();
  sqlite.exec(`
    INSERT INTO members (email, role, name) VALUES ('${OWNER}', 'owner', 'Founder'), ('${COUNSEL}', 'counsel', 'Ada');
    INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at, removed_at, control_seq) VALUES
      ('d1', 'A/one.pdf', 'A', 'one.pdf', 'pdf', 'application/pdf', 1, 'k1', 'mirror', '2026-01-01', NULL, 1),
      ('d2', 'A/gone.pdf', 'A', 'gone.pdf', 'pdf', 'application/pdf', 1, 'k2', 'mirror', '2026-01-01', '2026-02-01', 2),
      ('vm', 'Visuals/legallas-visuals.json', 'Visuals', 'legallas-visuals.json', 'file', 'application/json', 1, 'k3', 'mirror', '2026-01-01', NULL, 3),
      ('d4', 'A/two.pdf', 'A', 'two.pdf', 'pdf', 'application/pdf', 1, 'k4', 'mirror', '2026-01-01', NULL, 4);
  `);
  const objects = new Map<string, Uint8Array>();
  const files = {
    async put(key: string, body: ReadableStream<Uint8Array>) {
      objects.set(key, new Uint8Array(await new Response(body).arrayBuffer()));
      return { etag: `etag-${objects.size}` };
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
  const env = (as: string) =>
    ({
      ASSETS: { fetch: async () => new Response('shell') },
      DB: db,
      FILES: files,
      TEAM_DOMAIN: '',
      ACCESS_AUD: '',
      ALLOW_DEV_IDENTITY: '1',
      DEV_IDENTITY_EMAIL: as,
    }) as unknown as Env;
  const call = (path: string, init: RequestInit = {}, as = who) => handle(new Request(`${HOST}${path}`, init), env(as), {} as ExecutionContext);
  const key = (id: string, body: unknown, as = who, headers: Record<string, string> = {}) =>
    call(
      `/api/documents/${id}/key`,
      {
        method: 'POST',
        headers: { ...SAME_ORIGIN, 'Content-Type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      },
      as,
    );
  const audits = (action: string) =>
    sqlite.prepare('SELECT email, document_id FROM audit_log WHERE action = ? ORDER BY id').all(action).map((r) => ({ ...r }));
  return { db, sqlite, call, key, audits };
}

type Listed = { id: string; name: string; control_seq: number | null; key_at: string | null; key_by: string | null };
type Tree = { files: Listed[]; folders: Tree[]; name: string };

function allFiles(node: Tree): Listed[] {
  return [...node.files, ...node.folders.flatMap(allFiles)];
}

// Migration 0003 on a database that already holds rows, as production does.

test('migration 0003 numbers every row (removed ones too) in path order and keeps the audit history', () => {
  const dir = join(import.meta.dirname, '..', 'migrations');
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(join(dir, '0001_init.sql'), 'utf8'));
  sqlite.exec(readFileSync(join(dir, '0002_sign_ins.sql'), 'utf8'));
  sqlite.exec(`
    INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at, removed_at) VALUES
      ('z', 'B/x.pdf', 'B', 'x.pdf', 'pdf', 'application/pdf', 1, 'k1', 'mirror', '2026-01-02', NULL),
      ('a', 'A/y.pdf', 'A', 'y.pdf', 'pdf', 'application/pdf', 1, 'k2', 'mirror', '2026-01-01', '2026-02-01'),
      ('m', 'A/y.pdf', 'A', 'y.pdf', 'pdf', 'application/pdf', 1, 'k3', 'mirror', '2026-01-03', NULL);
    INSERT INTO audit_log (ts, email, action, document_id) VALUES ('2026-01-01T00:00:00.000Z', 'p@x.test', 'view', 'z'), ('2026-01-02T00:00:00.000Z', 'p@x.test', 'download', 'm');
  `);
  sqlite.exec(readFileSync(join(dir, '0003_doc_numbers.sql'), 'utf8'));
  const rows = (sql: string) => sqlite.prepare(sql).all().map((r) => ({ ...r }));

  assert.deepEqual(rows('SELECT id, control_seq, key_at, key_by FROM documents ORDER BY control_seq'), [
    { id: 'a', control_seq: 1, key_at: null, key_by: null },
    { id: 'm', control_seq: 2, key_at: null, key_by: null },
    { id: 'z', control_seq: 3, key_at: null, key_by: null },
  ]);
  assert.deepEqual(rows('SELECT id, ts, action, document_id FROM audit_log ORDER BY id'), [
    { id: 1, ts: '2026-01-01T00:00:00.000Z', action: 'view', document_id: 'z' },
    { id: 2, ts: '2026-01-02T00:00:00.000Z', action: 'download', document_id: 'm' },
  ]);
  assert.deepEqual(
    rows("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'audit_log' ORDER BY name"),
    [
      { name: 'audit_log_email_ts', sql: 'CREATE INDEX audit_log_email_ts ON audit_log (email, ts)' },
      { name: 'audit_log_ts', sql: 'CREATE INDEX audit_log_ts ON audit_log (ts)' },
    ],
  );
  sqlite.exec("INSERT INTO audit_log (email, action, document_id) VALUES ('p@x.test', 'key', 'm'), ('p@x.test', 'unkey', 'm')");
  assert.deepEqual(rows('SELECT id FROM audit_log ORDER BY id').map((r) => r.id), [1, 2, 3, 4], 'ids continue after the copy');
  assert.throws(() => sqlite.exec("INSERT INTO audit_log (email, action) VALUES ('p@x.test', 'flag')"), /CHECK constraint failed/);
  assert.equal(rows("SELECT name FROM sqlite_master WHERE name = 'audit_log_new'").length, 0);
});

// The catalog and the document read.

test('/api/documents carries control_seq and Key, and never lists legallas-*.json', async () => {
  const { call, key } = room();
  await key('d4', { key: true });
  const { root } = (await (await call('/api/documents')).json()) as { root: Tree };
  const files = allFiles(root);
  assert.deepEqual(
    files.map((f) => [f.id, f.control_seq, f.key_at !== null, f.key_by]),
    [
      ['d1', 1, false, null],
      ['d4', 4, true, COUNSEL],
    ],
  );
  assert.ok(!root.folders.some((f) => f.name === 'Visuals'), 'a folder holding only the manifest does not appear');
});

test('/api/doc/:id carries control_seq and the Key fields', async () => {
  const { call, key } = room();
  const before = (await (await call('/api/doc/d1')).json()) as Listed;
  assert.deepEqual([before.control_seq, before.key_at, before.key_by], [1, null, null]);
  await key('d1', { key: true });
  const after = (await (await call('/api/doc/d1')).json()) as Listed;
  assert.equal(after.key_by, COUNSEL);
  assert.match(after.key_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
});

test('Ask never cites a legallas-*.json row, but the row stays for the binder', async () => {
  const { db, sqlite } = room();
  const live = await liveDocuments(db, ['d1', 'vm', 'd2'], 'counsel');
  assert.deepEqual([...live.keys()], ['d1']);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM documents WHERE id = 'vm' AND removed_at IS NULL").get()?.n, 1);
});

// The Key flag.

test('any member marks and clears Key; only real changes are audited, and the first mark is kept', async () => {
  const { key, audits } = room();
  const on = await key('d1', { key: true });
  assert.equal(on.status, 200);
  const first = (await on.json()) as { id: string; key: boolean; key_at: string; key_by: string };
  assert.deepEqual([first.id, first.key, first.key_by], ['d1', true, COUNSEL]);

  const again = (await (await key('d1', { key: true }, OWNER)).json()) as typeof first;
  assert.deepEqual([again.key_by, again.key_at], [COUNSEL, first.key_at], 'a second mark changes nothing');
  assert.deepEqual(audits('key'), [{ email: COUNSEL, document_id: 'd1' }]);

  const off = (await (await key('d1', { key: false }, OWNER)).json()) as typeof first;
  assert.deepEqual([off.key, off.key_at, off.key_by], [false, null, null]);
  await key('d1', { key: false }, OWNER);
  assert.deepEqual(audits('unkey'), [{ email: OWNER, document_id: 'd1' }]);
});

test('Key refuses bad bodies with 400 and changes nothing', async () => {
  const { key, audits, sqlite } = room();
  const cases: [unknown, Record<string, string>?][] = [
    [{ key: 'yes' }],
    [{ key: 1 }],
    [{}],
    [null],
    [[true]],
    ['{not json'],
    [{ key: true }, { 'Content-Type': 'text/plain' }],
    [JSON.stringify({ key: true, pad: 'x'.repeat(2000) })],
  ];
  for (const [body, headers] of cases) {
    const res = await key('d1', body, COUNSEL, headers);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 40));
  }
  assert.equal(sqlite.prepare("SELECT key_at FROM documents WHERE id = 'd1'").get()?.key_at, null);
  assert.deepEqual(audits('key'), []);
});

test('Key on a missing, removed or hidden document is 404 and writes nothing', async () => {
  const { key, audits, sqlite } = room();
  for (const id of ['nope', 'd2', 'vm']) {
    const res = await key(id, { key: true });
    assert.equal(res.status, 404, id);
  }
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM documents WHERE key_at IS NOT NULL').get()?.n, 0);
  assert.deepEqual(audits('key'), []);
});

test('Key is a POST from the room itself: other origins and methods are refused', async () => {
  const { call, audits } = room();
  const cross = await call('/api/documents/d1/key', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' },
    body: '{"key":true}',
  });
  assert.equal(cross.status, 403);
  const del = await call('/api/documents/d1/key', { method: 'DELETE', headers: SAME_ORIGIN });
  assert.equal(del.status, 405);
  assert.deepEqual(audits('key'), []);
});

// Upload numbering.

test('a counsel upload is numbered after the highest number, removed rows included', async () => {
  const { call, sqlite } = room();
  sqlite.exec("UPDATE documents SET control_seq = 9 WHERE id = 'd2'");
  const bytes = new TextEncoder().encode('%PDF-1.7 test');
  const res = await call('/api/uploads', {
    method: 'PUT',
    body: bytes,
    headers: { ...SAME_ORIGIN, 'X-Upload-Name': 'memo.pdf', 'Content-Length': String(bytes.byteLength) },
  });
  assert.equal(res.status, 201);
  const { id } = (await res.json()) as { id: string };
  assert.equal(sqlite.prepare('SELECT control_seq FROM documents WHERE id = ?').get(id)?.control_seq, 10);
  const doc = (await (await call(`/api/doc/${id}`)).json()) as Listed;
  assert.equal(doc.control_seq, 10);
});
