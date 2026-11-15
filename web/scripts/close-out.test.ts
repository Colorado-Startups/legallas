// SPDX-License-Identifier: Apache-2.0
// `npm run close-out` (scripts/close-out.ts) against a fictional room: every migration applied to an in-memory SQLite
// database, fake buckets, a fake OAuth namespace and a fake AI Search instance. Fictional rows only: example.test
// addresses and invented documents.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { chainLines, verifyCopy, FIELDS, type AuditCopyRow } from '../worker/audit-chain-core.ts';
import {
  AUDIT_COPY_PREFIX,
  closeOut,
  deleteRoom,
  exportedTables,
  exportRoom,
  oauthKeys,
  parseCloseOutArgs,
  Refused,
  revoke,
  roomBuckets,
  roomResources,
  type CloseOutHost,
  type Io,
} from './close-out.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const NOW = new Date('2026-11-05T12:00:00.000Z');
const OWNER = 'founder@example.test';
const COUNSEL = 'counsel@example.test';
const WEB = {
  name: 'legallas',
  d1_databases: [{ binding: 'DB', database_name: 'legallas', database_id: '00000000-0000-4000-8000-000000000000' }],
  r2_buckets: [
    { binding: 'FILES', bucket_name: 'legallas-files' },
    { binding: 'INDEX', bucket_name: 'legallas-index' },
    { binding: 'LAW', bucket_name: 'legallas-law' },
  ],
  ai_search: [
    { binding: 'SEARCH', instance_name: 'legallas' },
    { binding: 'LAW_SEARCH', instance_name: 'legallas-law' },
  ],
};
const MCP = { name: 'legallas-mcp', kv_namespaces: [{ binding: 'OAUTH_KV', id: 'kv0' }] };
const BACKUP = {
  name: 'legallas-backup',
  d1_databases: [
    { binding: 'DB', database_name: 'legallas', database_id: '00000000-0000-4000-8000-000000000000' },
    { binding: 'SCRATCH_DB', database_name: 'legallas-scratch', database_id: '11111111-0000-4000-8000-000000000000' },
  ],
  r2_buckets: [...WEB.r2_buckets, { binding: 'BACKUP', bucket_name: 'legallas-backup' }, { binding: 'SCRATCH', bucket_name: 'legallas-scratch' }],
};
const ROOM = roomResources(WEB, MCP, BACKUP);

/** An in-memory database with every migration applied and the fictional rows in it. */
function seededDatabase(): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(path.join(MIGRATIONS, file), 'utf8'));
  sqlite.exec(`
    INSERT INTO members (email, role, name) VALUES ('${OWNER}', 'owner', 'Jane Doe'), ('${COUNSEL}', 'counsel', 'Sam Roe');
    INSERT INTO rooms (id, name, created_by) VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'Series A', '${OWNER}');
    INSERT INTO room_members (id, room_id, email, role, invited_by, invited_at, accept_by, expires_at)
      VALUES ('g1', 'aaaaaaaa-0000-4000-8000-000000000001', 'investor@example.test', 'investor', '${OWNER}',
              '2026-10-01T00:00:00.000Z', '2026-10-15T00:00:00.000Z', '2027-10-01T00:00:00.000Z');
    INSERT INTO sync_tokens (client_id, owner_email) VALUES ('laptop.access', '${OWNER}');
    INSERT INTO documents (id, path, folder, name, kind, content_type, size, sha256, r2_key, source, updated_at)
      VALUES ('d1', 'Harbor Labs/term-sheet.pdf', 'Harbor Labs', 'term-sheet.pdf', 'pdf', 'application/pdf', 10, '${'1'.repeat(64)}', 'k1', 'mirror', '2026-10-01T00:00:00.000Z'),
             ('d2', 'Harbor Labs/notes.md', 'Harbor Labs', 'notes.md', 'markdown', 'text/markdown', 5, '${'2'.repeat(64)}', 'k2', 'mirror', '2026-10-01T00:00:00.000Z');
    INSERT INTO comments (id, document_id, author_email, body) VALUES ('c1', 'd1', '${COUNSEL}', 'Fictional note on the term sheet.');
    INSERT INTO sign_ins (email, iat, ip, user_agent) VALUES ('${COUNSEL}', 1, '198.51.100.9', 'SignInOnly/9.9');
    INSERT INTO audit_log (email, action, document_id, ip, user_agent) VALUES ('${COUNSEL}', 'view', 'd1', '192.0.2.7', 'Example/1.0'),
      ('${COUNSEL}', 'download', 'd2', '192.0.2.7', 'Example/1.0'), ('${OWNER}', 'upload', 'd2', '192.0.2.8', 'Example/1.0');
  `);
  return sqlite;
}

/** The room's database, as the host runs SQL against it. */
function databaseHost(sqlite: DatabaseSync): Pick<CloseOutHost, 'query' | 'execute'> {
  return {
    async query(sql) {
      return sqlite.prepare(sql).all().map((row) => ({ ...row }));
    },
    async execute(statements) {
      for (const statement of statements) sqlite.exec(statement);
    },
  };
}

/** The buckets: objects listed, read and deleted, a bucket's lock rules, and the bucket itself. */
function bucketHost(
  buckets: Map<string, Map<string, string>>,
  locks: Map<string, number>,
  calls: string[],
): Pick<CloseOutHost, 'listObjects' | 'readObject' | 'deleteObject' | 'lockRules' | 'clearLockRules' | 'deleteBucket'> {
  return {
    async listObjects(bucket, prefix = '') {
      const objects = buckets.get(bucket);
      if (!objects) return null;
      return [...objects].filter(([key]) => key.startsWith(prefix)).map(([key, body]) => ({ key, size: body.length }));
    },
    async readObject(bucket, key) {
      return buckets.get(bucket)!.get(key)!;
    },
    async deleteObject(bucket, key) {
      if ((locks.get(bucket) ?? 0) > 0) throw new Error('ObjectLockedByBucketPolicy');
      buckets.get(bucket)!.delete(key);
    },
    async lockRules(bucket) {
      return locks.get(bucket) ?? 0;
    },
    async clearLockRules(bucket) {
      locks.set(bucket, 0);
      calls.push(`lock ${bucket}`);
    },
    async deleteBucket(bucket) {
      assert.equal(buckets.get(bucket)?.size, 0, 'a bucket is empty before it goes');
      buckets.delete(bucket);
      calls.push(`bucket ${bucket}`);
    },
  };
}

/** The OAuth key-value namespace. */
function namespaceHost(kv: Map<string, Set<string>>, calls: string[]): Pick<CloseOutHost, 'listKeys' | 'deleteKeys' | 'deleteNamespace'> {
  return {
    async listKeys(namespace) {
      const keys = kv.get(namespace);
      return keys ? [...keys] : null;
    },
    async deleteKeys(namespace, keys) {
      for (const key of keys) kv.get(namespace)!.delete(key);
    },
    async deleteNamespace(namespace) {
      kv.delete(namespace);
      calls.push('namespace');
    },
  };
}

/** The AI Search instance and the database, which exist until the host deletes them. */
function serviceHost(state: { search: boolean; database: boolean }, calls: string[]): Pick<CloseOutHost, 'searchExists' | 'deleteSearch' | 'deleteDatabase'> {
  return {
    async searchExists() {
      return state.search;
    },
    async deleteSearch() {
      state.search = false;
      calls.push('search');
    },
    async deleteDatabase(id) {
      state.database = false;
      calls.push(`database ${id.slice(0, 8)}`);
    },
  };
}

/** The fictional room: two members, an invitation, a sync token, two documents, audit rows, one AI connection. */
function fixtureRoom() {
  const sqlite = seededDatabase();
  const buckets = new Map<string, Map<string, string>>([
    ['legallas-files', new Map([['k1', 'x'.repeat(10)], ['k2', 'y'.repeat(5)], ['meta/matter.json', '{}']])],
    ['legallas-index', new Map([['text/d1.p1.md', 'page text']])],
    ['legallas-scratch', new Map<string, string>()],
    ['legallas-backup', new Map([['objects/k1', 'x'.repeat(10)], ['runs/2026-11-05/d1.sql', 'rows']])],
  ]);
  // Room backup locks its objects for 30 days (web/README.md, "Backup and restore"): R2 refuses a delete while a rule is set.
  const locks = new Map([['legallas-backup', 1]]);
  const kv = new Map<string, Set<string>>([['kv0', new Set([`grant:${COUNSEL}:g1`, `token:${COUNSEL}:g1:t1`, 'client:c1'])]]);
  const state = { search: true, database: true };
  const calls: string[] = [];
  const host: CloseOutHost = { ...databaseHost(sqlite), ...bucketHost(buckets, locks, calls), ...namespaceHost(kv, calls), ...serviceHost(state, calls) };
  const out: string[] = [];
  const answers: string[] = [];
  const io: Io = { out: (line) => out.push(line), ask: async () => answers.shift() ?? '', now: () => NOW };
  const count = (sql: string) => Number((sqlite.prepare(sql).get() as { n: number }).n);
  const hold = () => sqlite.exec(`INSERT INTO legal_holds (started_at, started_by) VALUES ('2026-11-01T00:00:00.000Z', '${OWNER}')`);
  return { sqlite, host, io, out, answers, buckets, kv, state, calls, count, hold };
}

/** Nothing printed names a person, an email or a document. */
function assertNoNames(out: readonly string[]): void {
  const text = out.join('\n');
  for (const word of ['@', 'Jane', 'Sam', 'Harbor', 'term-sheet', 'Series A', '192.0.2']) assert.equal(text.includes(word), false, word);
}

test('arguments: a dry run by default; --delete always exports first', () => {
  assert.deepEqual(parseCloseOutArgs([]), { revoke: false, exportDir: null, delete: false });
  assert.deepEqual(parseCloseOutArgs(['--revoke', '--export', 'out', '--delete']), { revoke: true, exportDir: 'out', delete: true });
  assert.throws(() => parseCloseOutArgs(['--delete']), /--export/);
  assert.throws(() => parseCloseOutArgs(['--export']), /usage/);
  assert.throws(() => parseCloseOutArgs(['--yes']), /usage/);
});

test('the room comes from its own Wrangler configs; the law library is kept', () => {
  assert.deepEqual(ROOM, {
    database: 'legallas',
    databaseId: '00000000-0000-4000-8000-000000000000',
    filesBucket: 'legallas-files',
    indexBucket: 'legallas-index',
    searchInstance: 'legallas',
    oauthKv: 'kv0',
    backupBucket: 'legallas-backup',
    scratchBucket: 'legallas-scratch',
    scratchDatabase: { name: 'legallas-scratch', id: '11111111-0000-4000-8000-000000000000' },
    kept: ['legallas-law', 'legallas-law'],
    workers: ['legallas', 'legallas-mcp', 'legallas-backup'],
  });
  const noBackup = roomResources(WEB, MCP);
  assert.deepEqual([noBackup.backupBucket, noBackup.scratchBucket, noBackup.scratchDatabase, noBackup.workers], [null, null, null, ['legallas', 'legallas-mcp']]);
  assert.deepEqual(roomBuckets(noBackup), ['legallas-index', 'legallas-files']);
  assert.deepEqual(roomBuckets(ROOM), ['legallas-index', 'legallas-files', 'legallas-scratch', 'legallas-backup']);
  assert.throws(() => roomResources({}, null), /DB, FILES/);
  // A backup config naming the room's own bucket or database as backup or scratch is refused, so --delete can't be pointed twice at one store.
  assert.throws(() => roomResources(WEB, MCP, { ...BACKUP, r2_buckets: [{ binding: 'BACKUP', bucket_name: 'legallas-files' }] }), /own buckets/);
  assert.throws(() => roomResources(WEB, MCP, { ...BACKUP, d1_databases: [{ binding: 'SCRATCH_DB', database_name: 'x', database_id: '00000000-0000-4000-8000-000000000000' }] }), /own buckets/);
  assert.deepEqual(oauthKeys(['grant:a@example.test:g', 'token:a@example.test:g:t', 'client:c', 'other']), { grants: [{ key: 'grant:a@example.test:g', user: 'a@example.test' }], tokens: ['token:a@example.test:g:t'], clients: 1 });
});

test('the dry run counts tables, buckets and access, changes nothing and names no one', async () => {
  const room = fixtureRoom();
  await closeOut(parseCloseOutArgs([]), room.host, ROOM, room.io);
  const text = room.out.join('\n');
  assert.match(text, /\| members \| 2 \|/);
  assert.match(text, /\| audit_log \| 3 \|/);
  assert.match(text, /\| legallas-files \| 3 \| 17 \| 0 \|/);
  assert.match(text, /\| legallas-backup \| 2 \| 14 \| 1 \|/);
  assert.match(text, /Scratch database legallas-scratch/);
  assert.match(text, /\| AI connections \| 1 grants, 1 tokens, 1 app registrations \|/);
  assert.match(text, /\| Legal hold \| off \|/);
  assert.match(text, /Kept by every step: legallas-law/);
  assertNoNames(room.out);
  assert.equal(room.count('SELECT COUNT(*) AS n FROM members'), 2);
});

test('--revoke refuses without the typed phrase, and changes nothing', async () => {
  const room = fixtureRoom();
  room.answers.push('yes');
  await assert.rejects(revoke(room.host, ROOM, room.io), Refused);
  assert.equal(room.count('SELECT COUNT(*) AS n FROM members'), 2);
  assert.equal(room.kv.get('kv0')!.size, 3);
});

test('--revoke refuses while a legal hold is on, records the refusal, and never asks', async () => {
  const room = fixtureRoom();
  room.hold();
  room.answers.push('revoke legallas');
  await assert.rejects(revoke(room.host, ROOM, room.io), /legal hold is on since 2026-11-01/);
  assert.equal(room.answers.length, 1, 'no prompt');
  assert.equal(room.count("SELECT COUNT(*) AS n FROM hold_events WHERE action = 'removal_refused' AND detail_code = 'close_out_revoke' AND actor = 'close-out'"), 1);
  assert.equal(room.count('SELECT COUNT(*) AS n FROM members'), 2);
  assert.equal(room.count('SELECT COUNT(*) AS n FROM matter_close'), 0);
});

test('--revoke closes the matter and ends every way in, recording each', async () => {
  const room = fixtureRoom();
  room.answers.push('revoke legallas');
  await revoke(room.host, ROOM, room.io);
  assert.equal(room.count('SELECT COUNT(*) AS n FROM members'), 0);
  assert.equal(room.count('SELECT COUNT(*) AS n FROM room_members WHERE revoked_at IS NULL'), 0);
  assert.equal(room.count('SELECT COUNT(*) AS n FROM sync_tokens WHERE revoked_at IS NULL'), 0);
  assert.equal(room.count(`SELECT COUNT(*) AS n FROM matter_close WHERE closed_at = '${NOW.toISOString()}'`), 1);
  assert.equal(room.count("SELECT COUNT(*) AS n FROM access_events WHERE action = 'grant_revoked' AND actor = 'close-out'"), 1);
  assert.equal(room.count(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ai_disconnect' AND via = 'close-out' AND email = '${COUNSEL}'`), 1);
  assert.deepEqual([...room.kv.get('kv0')!], ['client:c1']);
  assertNoNames(room.out);
  // Re-runnable: a second run finds nothing left and keeps the first close date.
  room.answers.push('revoke legallas');
  await revoke(room.host, ROOM, room.io);
  assert.equal(room.count('SELECT COUNT(*) AS n FROM matter_close'), 1);
});

test('--export writes every table but sign-ins and the audit log from its first row, purged copies included, each hashed', async () => {
  const room = fixtureRoom();
  // A sweep purged the first two rows: their copy is in the files bucket, the room's log carries on from its chain.
  const purged = (room.sqlite.prepare(`SELECT ${FIELDS.join(', ')} FROM audit_log WHERE id <= 2 ORDER BY id`).all() as AuditCopyRow[]).map((row) => ({ ...row }));
  const copy = await chainLines(purged);
  room.buckets.get('legallas-files')!.set(`${AUDIT_COPY_PREFIX}000000000001-000000000002.jsonl`, copy.lines.map((line) => `${line}\n`).join(''));
  const trigger = (room.sqlite.prepare("SELECT sql FROM sqlite_master WHERE name = 'audit_log_no_delete'").get() as { sql: string }).sql;
  room.sqlite.exec(`BEGIN; INSERT INTO audit_purges (ts, through_id, rows, chain, copy_key) VALUES ('${NOW.toISOString()}', 2, 2, '${copy.last}', '${AUDIT_COPY_PREFIX}000000000001-000000000002.jsonl');
    DROP TRIGGER audit_log_no_delete; DELETE FROM audit_log WHERE id <= 2; ${trigger}; COMMIT;`);
  const dir = await mkdtemp(path.join(tmpdir(), 'close-out-test-'));
  try {
    const manifest = await exportRoom(room.host, ROOM, room.io, dir);
    const audit = await readFile(path.join(dir, 'audit-log.jsonl'), 'utf8');
    assert.deepEqual(await verifyCopy(audit), { ok: true, rows: 3 });
    const live = await chainLines((room.sqlite.prepare(`SELECT ${FIELDS.join(', ')} FROM audit_log ORDER BY id`).all() as AuditCopyRow[]).map((row) => ({ ...row })), copy.last);
    assert.deepEqual(manifest.audit, { rows: 3, purgedRows: 2, firstId: 3, lastId: 3, chain: live.last });
    for (const [name, file] of Object.entries(manifest.files)) {
      const text = await readFile(path.join(dir, name), 'utf8');
      assert.equal(file.bytes, Buffer.byteLength(text), name);
      assert.match(file.sha256, /^[0-9a-f]{64}$/);
      assert.match(room.out.join('\n'), new RegExp(file.sha256));
    }
    // Every table but sign-ins, each in full and hashed: comments, members, holds and the rest survive --delete.
    const all = (room.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((row) => row.name);
    const fts5Storage = ['page_fts_data', 'page_fts_idx', 'page_fts_content', 'page_fts_docsize', 'page_fts_config'];
    const expected = all.filter((name) => name !== 'sign_ins' && !fts5Storage.includes(name));
    assert.deepEqual(await exportedTables(room.host), expected);
    assert.ok(expected.includes('page_fts') && expected.includes('page_fts_docs') && expected.includes('hold_events') && expected.includes('comments'));
    assert.deepEqual(Object.keys(manifest.files).filter((name) => name.startsWith('tables/')).sort(), expected.map((name) => `tables/${name}.jsonl`).sort());
    for (const name of expected) {
      const lines = (await readFile(path.join(dir, 'tables', `${name}.jsonl`), 'utf8')).split('\n').filter(Boolean);
      assert.equal(lines.length, manifest.tables[name], name);
    }
    assert.deepEqual(JSON.parse((await readFile(path.join(dir, 'tables', 'comments.jsonl'), 'utf8')).trim()).body, 'Fictional note on the term sheet.');
    assert.equal(manifest.tables.sign_ins, 1, 'counted');
    assert.equal(manifest.files['tables/sign_ins.jsonl'], undefined, 'never exported');
    for (const name of Object.keys(manifest.files)) assert.equal((await readFile(path.join(dir, name), 'utf8')).includes('SignInOnly/9.9'), false, name);
    const documents = (await readFile(path.join(dir, 'documents.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(Object.keys(documents[0]), ['id', 'kind', 'source', 'size', 'sha256', 'r2_key', 'updated_at', 'removed_at'], 'no names or paths');
    assert.equal((await readFile(path.join(dir, 'objects.jsonl'), 'utf8')).trim().split('\n').length, 5);
    assert.deepEqual(manifest.buckets, { 'legallas-files': { objects: 4, bytes: 17 + Buffer.byteLength(room.buckets.get('legallas-files')!.get(`${AUDIT_COPY_PREFIX}000000000001-000000000002.jsonl`)!) }, 'legallas-index': { objects: 1, bytes: 9 } });
    assertNoNames(room.out);
    // A copy missing from the bucket breaks the chain: the export refuses.
    room.buckets.get('legallas-files')!.delete(`${AUDIT_COPY_PREFIX}000000000001-000000000002.jsonl`);
    await assert.rejects(exportRoom(room.host, ROOM, room.io, dir), /doesn't verify/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('--delete refuses before --revoke, under a hold, without the phrase, and when any table changed after the export', async () => {
  const room = fixtureRoom();
  const dir = await mkdtemp(path.join(tmpdir(), 'close-out-test-'));
  try {
    const early = await exportRoom(room.host, ROOM, room.io, dir);
    await assert.rejects(deleteRoom(room.host, ROOM, room.io, early), /--revoke first/);
    room.answers.push('revoke legallas');
    await revoke(room.host, ROOM, room.io);
    const manifest = await exportRoom(room.host, ROOM, room.io, dir);
    room.answers.push('delete');
    await assert.rejects(deleteRoom(room.host, ROOM, room.io, manifest), /did not match/);
    room.sqlite.exec(`INSERT INTO comments (id, document_id, author_email, body) VALUES ('c2', 'd1', '${OWNER}', 'A late fictional note.')`);
    room.answers.push('delete legallas');
    await assert.rejects(deleteRoom(room.host, ROOM, room.io, manifest), /changed after the export \(comments\)/);
    room.sqlite.exec(`INSERT INTO audit_log (email, action) VALUES ('${OWNER}', 'view')`);
    room.answers.push('delete legallas');
    await assert.rejects(deleteRoom(room.host, ROOM, room.io, manifest), /audit log changed after the export/);
    room.hold();
    await assert.rejects(deleteRoom(room.host, ROOM, room.io, manifest), /legal hold/);
    assert.equal(room.count("SELECT COUNT(*) AS n FROM hold_events WHERE detail_code = 'close_out_delete'"), 1);
    assert.deepEqual(room.calls, [], 'nothing deleted');
    assert.equal(room.state.search && room.state.database, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('--revoke --export --delete ends the room: search, objects, buckets, the backup after its lock, OAuth and databases, in that order', async () => {
  const room = fixtureRoom();
  const dir = await mkdtemp(path.join(tmpdir(), 'close-out-test-'));
  try {
    room.answers.push('revoke legallas', 'delete legallas');
    await closeOut(parseCloseOutArgs(['--revoke', '--export', dir, '--delete']), room.host, ROOM, room.io);
    assert.deepEqual(room.calls, ['search', 'bucket legallas-index', 'bucket legallas-files', 'bucket legallas-scratch', 'lock legallas-backup', 'bucket legallas-backup', 'namespace', 'database 11111111', 'database 00000000']);
    assert.equal(room.buckets.size, 0);
    assert.equal(room.kv.size, 0);
    // The export saw the revoke's own rows: the ai_disconnect row is the copy's last line.
    const audit = (await readFile(path.join(dir, 'audit-log.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(JSON.parse(audit.at(-1)!).action, 'ai_disconnect');
    assert.deepEqual(await verifyCopy(audit.join('\n')), { ok: true, rows: 4 });
    assertNoNames(room.out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a database without migration 0022 is refused before anything runs', async () => {
  const room = fixtureRoom();
  room.sqlite.exec('DROP TABLE audit_purges');
  await assert.rejects(closeOut(parseCloseOutArgs([]), room.host, ROOM, room.io), /migration 0022/);
  room.answers.push('revoke legallas');
  await assert.rejects(closeOut(parseCloseOutArgs(['--revoke']), room.host, ROOM, room.io), /migration 0022/);
  assert.equal(room.count('SELECT COUNT(*) AS n FROM members'), 2);
});
