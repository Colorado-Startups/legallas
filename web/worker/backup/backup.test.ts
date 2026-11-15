// SPDX-License-Identifier: Apache-2.0
// The room backup end to end on the fictional room (testkit.ts): a backup, a second backup, the drill, a real restore
// into empty targets, and every refusal that keeps a run away from the room's own data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runBackup, runDrill, runRestore, parseParams, pruneRuns, type BackupOutput } from './flow.ts';
import { blobKey, BackupError, MAX_WRITES_PER_RUN, runIdAt, runStarted, SHA_META, summaryKey } from './layout.ts';
import { copyPage } from './r2.ts';
import { decodeValue, encodeValue, readSchema } from './d1.ts';
import { FakeBucket, fakeD1, nodeHash, room, SECRETS, steps, tools, type Room } from './testkit.ts';

const RUN = '20261105T070000Z-abc12345';
const LATER = '20261106T070000Z-def67890';

function assertSafe(output: unknown): void {
  const text = JSON.stringify(output);
  for (const word of SECRETS) assert.equal(text.includes(word), false, `the output holds ${word}`);
}

function readOnlyRoom(r: Room): void {
  r.files.readOnly = true;
  r.index.readOnly = true;
  r.law.readOnly = true;
}

const counts = (db: DatabaseSync, table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

test('a backup copies every object and every row into the backup bucket, and writes nothing to the room', async () => {
  const r = room();
  readOnlyRoom(r);
  const output = await runBackup(r.env, steps(), RUN, tools());
  assert.equal(output.ok, true);
  assert.deepEqual([output.sources.files.objects, output.sources.index.objects, output.sources.law.objects], [8, 4, 1]);
  assert.deepEqual([output.sources.files.copied, output.sources.files.pages], [8, 3]);
  for (const [key, stored] of r.files.objects) {
    const copy = r.backup.objects.get(blobKey('files', stored.etag, key));
    assert.ok(copy, 'every object has a copy');
    assert.deepEqual(copy.bytes, stored.bytes);
    assert.equal(copy.httpMetadata?.contentType, stored.httpMetadata?.contentType);
    assert.equal(copy.customMetadata?.origin, 'fixture');
    assert.match(copy.customMetadata?.[SHA_META] ?? '', /^[0-9a-f]{64}$/);
  }
  assert.ok(r.backup.objects.has(summaryKey(RUN)));
  assert.equal(output.d1.derived, 2, 'page_fts and page_fts_docs are rebuilt, not copied');
  const copied = (await readSchema(r.env.DB)).tables.filter((table) => !table.derived);
  assert.equal(output.d1.tables, copied.length);
  assert.equal(output.d1.rows, copied.reduce((sum, table) => sum + counts(r.db, table.name), 0));
  assertSafe(output);
});

test('a second backup copies only what changed', async () => {
  const r = room();
  await runBackup(r.env, steps(), RUN, tools());
  const copies = () => [...r.backup.objects.keys()].filter((key) => key.startsWith('objects/')).length;
  const before = copies();
  const again = await runBackup(r.env, steps(), LATER, tools());
  assert.equal(again.sources.files.copied + again.sources.index.copied + again.sources.law.copied, 0);
  assert.equal(copies(), before);
  r.files.seed('0b5c8d2e-0000-4000-8000-000000000008', 'DOE-000008 Harbor Labs exhibit 8, fictional');
  const third = await runBackup(r.env, steps(), '20261107T070000Z-aaa11111', tools());
  assert.deepEqual([third.sources.files.copied, third.sources.files.objects], [1, 9]);
});

test('the drill restores the newest run into the scratch copies, matches every count and hash, and empties them', async () => {
  const r = room();
  await runBackup(r.env, steps(), RUN, tools());
  readOnlyRoom(r);
  const before = counts(r.db, 'audit_log');
  const output = await runDrill(r.env, steps(), undefined, tools());
  assert.equal(output.ok, true, JSON.stringify(output));
  assert.equal(output.run, RUN);
  assert.equal(output.cleanedUp, true);
  assert.equal(r.scratch.objects.size, 0);
  const left = r.scratchDb.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view', 'index', 'trigger')").all() as { name: string }[];
  assert.deepEqual(left.map((row) => row.name).filter((name) => !name.startsWith('sqlite_')), [], "only SQLite's own sqlite_sequence may stay");
  for (const source of ['files', 'index', 'law'] as const) {
    const s = output.sources[source]!;
    assert.deepEqual([s.restored.objects, s.restored.bytes, s.restored.hash, s.failed], [s.expected.objects, s.expected.bytes, s.expected.hash, 0]);
  }
  assert.equal(output.d1!.mismatched.length, 0);
  assert.equal(output.d1!.restoredRows, output.d1!.expectedRows);
  assert.ok(output.seconds.restore > 0 && output.seconds.total >= output.seconds.restore);
  assert.equal(counts(r.db, 'audit_log'), before, 'the room database is untouched');
  const records = [...r.backup.objects.keys()].filter((key) => key.startsWith('drills/'));
  assert.equal(records.length, 1, 'one dated record per drill');
  assert.match(records[0]!, /^drills\/\d{8}T\d{6}Z\.json$/);
  const record = JSON.parse(new TextDecoder().decode(r.backup.objects.get(records[0]!)!.bytes));
  assert.equal(record.ok, true);
  assert.match(record.finished, /^2026-11-05T/);
  assertSafe(record);
  assertSafe(output);
  await runBackup(r.env, steps(), LATER, tools());
});

test('the drill fails when a backup copy has changed', async () => {
  const r = room();
  await runBackup(r.env, steps(), RUN, tools());
  const [key, stored] = [...r.files.objects][2]!;
  r.backup.corrupt(blobKey('files', stored.etag, key));
  const output = await runDrill(r.env, steps(), undefined, tools());
  assert.equal(output.ok, false);
  assert.equal(output.sources.files!.failed, 1);
  assert.equal(output.cleanedUp, true);
});

test('the drill fails when a copied table page has changed', async () => {
  const r = room();
  await runBackup(r.env, steps(), RUN, tools());
  const page = [...r.backup.objects.keys()].find((key) => key.includes('/d1/audit_log/'))!;
  const text = new TextDecoder().decode(r.backup.objects.get(page)!.bytes);
  r.backup.objects.get(page)!.bytes = new TextEncoder().encode(text.replace('"view"', '"download"'));
  const output = await runDrill(r.env, steps(), undefined, tools());
  assert.equal(output.ok, false);
  assert.deepEqual(output.d1!.mismatched, ['audit_log']);
});

test('the drill refuses a scratch bucket or database that holds anything a drill did not write', async () => {
  const r = room();
  await runBackup(r.env, steps(), RUN, tools());
  // A scratch binding pointed at the room's own bucket by mistake.
  const pointedAtFiles = { ...r.env, SCRATCH: r.env.FILES };
  await assert.rejects(runDrill(pointedAtFiles, steps(), undefined, tools()), /scratch-bucket-not-ours/);
  assert.equal(r.files.objects.size, 8);
  // A scratch database binding pointed at the room's own database by mistake.
  const pointedAtDb = { ...r.env, SCRATCH_DB: r.env.DB };
  await assert.rejects(runDrill(pointedAtDb, steps(), undefined, tools()), /scratch-database-not-ours/);
  assert.ok(counts(r.db, 'members') > 0);
});

test('the drill clears what a stopped drill left behind', async () => {
  const r = room();
  await runBackup(r.env, steps(), RUN, tools());
  r.scratch.seed('drill/files/left-behind', 'fictional');
  r.scratchDb.exec('CREATE TABLE legallas_scratch (run TEXT NOT NULL); CREATE TABLE members (email TEXT)');
  const output = await runDrill(r.env, steps(), undefined, tools());
  assert.equal(output.ok, true, JSON.stringify(output));
  assert.equal(r.scratch.objects.size, 0);
});

test('a backup refuses a backup bucket that holds anything it did not write', async () => {
  const r = room();
  r.backup.seed('0b5c1d2e-0000-4000-8000-000000000001', 'a room object');
  await assert.rejects(runBackup(r.env, steps(), RUN, tools()), /backup-bucket-not-ours/);
  assert.equal(r.backup.objects.size, 1);
});

test('a page that would pass the storage or write budget stops before it writes', async () => {
  const r = room();
  await assert.rejects(copyPage(r.env.FILES, r.env.BACKUP, 'files', RUN, 0, undefined, nodeHash, { bytes: 10, writes: MAX_WRITES_PER_RUN }), /storage-cap/);
  await assert.rejects(copyPage(r.env.FILES, r.env.BACKUP, 'files', RUN, 0, undefined, nodeHash, { bytes: 1e9, writes: 2 }), /write-cap/);
  assert.equal(r.backup.objects.size, 0);
});

test('a restore fills empty buckets and an empty database, and refuses any that are not empty', async () => {
  const r = room();
  await runBackup(r.env, steps(), RUN, tools());
  const files = new FakeBucket(3);
  const db = new DatabaseSync(':memory:');
  const env = { ...r.env, FILES: files.bucket, DB: fakeD1(db) };
  const output = await runRestore(env, steps(), RUN, ['files', 'd1'], tools());
  assert.equal(output.ok, true, JSON.stringify(output));
  assert.equal(output.sources.index, undefined, 'only the parts asked for');
  for (const [key, stored] of r.files.objects) {
    const back = files.objects.get(key)!;
    assert.deepEqual(back.bytes, stored.bytes);
    assert.equal(back.httpMetadata?.contentType, stored.httpMetadata?.contentType);
    assert.deepEqual(back.customMetadata, { origin: 'fixture' });
  }
  for (const table of ['members', 'documents', 'document_history', 'comments', 'audit_log']) assert.equal(counts(db, table), counts(r.db, table), table);
  assert.equal(counts(db, 'page_fts'), 0, 'the indexer rebuilds page text');
  const triggers = (d: DatabaseSync) => d.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all();
  assert.deepEqual(triggers(db), triggers(r.db));
  await assert.rejects(runRestore(r.env, steps(), RUN, ['files'], tools()), /target-not-empty/);
  await assert.rejects(runRestore(r.env, steps(), RUN, ['d1'], tools()), /target-not-empty/);
  assertSafe(output);
});

test('pruning keeps the newest finished runs and anything younger than 35 days', async () => {
  const backup = new FakeBucket(3);
  const ids = ['20260801T070000Z', '20260802T070000Z', '20260803T070000Z', '20260804T070000Z', '20261020T070000Z', '20261105T070000Z'];
  for (const id of ids) {
    backup.seed(`runs/${id}/objects/files/0000.jsonl`, '');
    if (id !== '20260804T070000Z') backup.seed(`runs/${id}/summary.json`, '{}');
  }
  const pruned = await pruneRuns(backup.bucket, '20261105T070000Z');
  const left = new Set([...backup.objects.keys()].map((key) => key.split('/')[1]));
  assert.equal(pruned, 3);
  assert.deepEqual([...left].sort(), ['20260803T070000Z', '20261020T070000Z', '20261105T070000Z']);
});

test('the database schema: page text is derived, shadow tables stay out, parents come before children', async () => {
  const r = room();
  const schema = await readSchema(r.env.DB);
  const names = schema.tables.map((table) => table.name);
  assert.deepEqual(schema.tables.filter((table) => table.derived).map((table) => table.name).sort(), ['page_fts', 'page_fts_docs']);
  assert.equal(schema.entries.some((entry) => entry.name.startsWith('page_fts_') && entry.name !== 'page_fts_docs'), false);
  assert.ok(names.indexOf('documents') < names.indexOf('comments'));
  assert.equal(schema.tables.find((table) => table.name === 'audit_log')!.rowidAlias, 'id');
  assert.equal(schema.tables.find((table) => table.name === 'members')!.rowidAlias, null);
  const other = new DatabaseSync(':memory:');
  other.exec('CREATE VIRTUAL TABLE notes_fts USING fts5(text)');
  await assert.rejects(readSchema(fakeD1(other)), /unknown-virtual-table/);
});

test('a blob column round-trips', () => {
  const bytes = Uint8Array.from([0, 1, 254, 255]);
  assert.deepEqual(decodeValue(JSON.parse(JSON.stringify(encodeValue(bytes)))), bytes);
  assert.equal(encodeValue('text'), 'text');
  assert.equal(encodeValue(null), null);
});

test('params: a scheduled run is a backup; anything unexpected is refused', () => {
  assert.deepEqual(parseParams(undefined), { action: 'backup' });
  assert.deepEqual(parseParams({ action: 'drill' }), { action: 'drill' });
  assert.deepEqual(parseParams({ action: 'restore', run: RUN, only: ['files', 'd1', 'files'] }), { action: 'restore', run: RUN, only: ['files', 'd1'] });
  for (const bad of [{ action: 'wipe' }, { action: 'restore', run: RUN }, { action: 'restore', run: RUN, only: ['everything'] }, { action: 'drill', run: '../x' }, { action: 'backup', extra: 1 }, []]) {
    assert.throws(() => parseParams(bad), BackupError);
  }
});

test('run ids and backup keys', () => {
  assert.equal(runIdAt(new Date('2026-11-05T07:22:33.456Z'), 'A1b2-C3d4-e5f6'), '20261105T072233Z-a1b2c3d4');
  assert.equal(runStarted('20261105T072233Z-a1b2c3d4').toISOString(), '2026-11-05T07:22:33.000Z');
  assert.throws(() => blobKey('files', 'not/an/etag', 'k'), /bad-etag/);
  assert.throws(() => blobKey('files', 'abc', 'k'.repeat(1100)), /key-too-long/);
});

test('a backup output carries counts and hashes only', async () => {
  const r = room();
  const output: BackupOutput = await runBackup(r.env, steps(), RUN, tools());
  const hashes = [output.d1.hash, ...Object.values(output.sources).map((s) => s.hash)];
  for (const hash of hashes) assert.match(hash, /^[0-9a-f]{64}$/);
  assertSafe(output);
});
