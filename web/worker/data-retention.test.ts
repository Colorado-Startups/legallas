// SPDX-License-Identifier: Apache-2.0
// The retention schedule (worker/data-retention.ts, migration 0022) on a real SQLite database with every migration applied.
// Fictional rows only: example.test addresses, no case.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chainLines, verifyCopy, type AuditCopyRow } from './audit-chain-core.ts';
import {
  AUDIT_COPY_PREFIX,
  chainStart,
  parseDays,
  purgeAuditBatch,
  purgeSignIns,
  retentionSettings,
  sweepRetention,
} from './data-retention.ts';
import { testDb } from './sqlite-d1.ts';
import { PURGEABLE_SQL } from './sync-rules.ts';

const DAY = 86_400_000;
const NOW = new Date('2026-11-05T12:00:00.000Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const FIELDS = 'id, ts, email, action, document_id, ip, user_agent, via, room_id';

/** A files bucket that keeps what is put, or answers with the wrong size when `short`. */
function fakeFiles(short = false) {
  const objects = new Map<string, string>();
  return {
    objects,
    bucket: {
      async put(key: string, body: Uint8Array) {
        objects.set(key, new TextDecoder().decode(body));
        return { size: short ? body.byteLength - 1 : body.byteLength };
      },
    } as unknown as Pick<R2Bucket, 'put'>,
  };
}

function room() {
  const { db, sqlite } = testDb();
  const audit = (count: number) => {
    for (let i = 0; i < count; i++) sqlite.prepare("INSERT INTO audit_log (email, action, ip, user_agent) VALUES ('counsel@example.test', 'view', '192.0.2.7', 'Example/1.0')").run();
  };
  const hold = () => sqlite.prepare("INSERT INTO legal_holds (started_at, started_by) VALUES ('2026-11-01T00:00:00.000Z', 'founder@example.test')").run();
  const close = (at: string) => sqlite.prepare("INSERT INTO matter_close (id, closed_at, closed_by) VALUES (1, ?, 'close-out')").run(at);
  const count = (table: string) => Number((sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
  const trigger = () => (sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'audit_log_no_delete'").get() as { sql: string } | undefined)?.sql;
  const rows = () => sqlite.prepare(`SELECT ${FIELDS} FROM audit_log ORDER BY id`).all() as AuditCopyRow[];
  return { db, sqlite, audit, hold, close, count, trigger, rows };
}

test('a setting is off unless it is a whole number of days; sign-ins never go below the 30-day familiar check', () => {
  assert.deepEqual(parseDays(undefined, 30), { on: false, invalid: false });
  assert.deepEqual(parseDays('', 30), { on: false, invalid: false });
  assert.deepEqual(parseDays('0', 30), { on: false, invalid: false });
  assert.deepEqual(parseDays('90', 30), { on: true, days: 90 });
  assert.deepEqual(parseDays(' 7 ', 30), { on: true, days: 30 });
  assert.deepEqual(parseDays('99999', 1), { on: true, days: 3650 });
  for (const bad of ['-5', '30d', '1.5', 'thirty', '1e3']) assert.deepEqual(parseDays(bad, 30), { on: false, invalid: true }, bad);
  assert.deepEqual(retentionSettings({}), { signIns: { on: false, invalid: false }, auditAfterClose: { on: false, invalid: false } });
});

test('off by default: the sweep reads nothing and removes nothing', async () => {
  const untouched = { prepare: () => assert.fail('the sweep read the database'), batch: () => assert.fail('the sweep wrote') } as unknown as D1Database;
  assert.deepEqual(await sweepRetention({ DB: untouched, FILES: fakeFiles().bucket }, NOW), { held: false, signIns: null, audit: null });
  assert.deepEqual(await sweepRetention({ DB: untouched, FILES: fakeFiles().bucket, RETAIN_SIGNINS_DAYS: 'soon' }, NOW), { held: false, signIns: null, audit: null });
});

test('sign-in records older than the setting go; newer ones stay', async () => {
  const r = room();
  const signIn = r.sqlite.prepare("INSERT INTO sign_ins (email, sub, iat, ip, user_agent, created_at) VALUES ('counsel@example.test', ?, ?, '192.0.2.7', 'Example/1.0', ?)");
  signIn.run('a', 1, ago(120));
  signIn.run('b', 2, ago(61));
  signIn.run('c', 3, ago(59));
  const result = await sweepRetention({ DB: r.db, FILES: fakeFiles().bucket, RETAIN_SIGNINS_DAYS: '60' }, NOW);
  assert.equal(result.signIns, 2);
  assert.deepEqual(r.sqlite.prepare('SELECT sub FROM sign_ins').all().map((row) => (row as { sub: string }).sub), ['c']);
});

test('a legal hold blocks the sign-in purge, in the sweep and in the SQL itself', async () => {
  const r = room();
  r.sqlite.prepare("INSERT INTO sign_ins (email, iat, created_at) VALUES ('counsel@example.test', 1, ?)").run(ago(400));
  r.hold();
  assert.deepEqual(await sweepRetention({ DB: r.db, FILES: fakeFiles().bucket, RETAIN_SIGNINS_DAYS: '30' }, NOW), { held: true, signIns: null, audit: null });
  assert.equal(await purgeSignIns(r.db, NOW, 30), 0);
  assert.equal(r.count('sign_ins'), 1);
});

test('the audit log stays until the matter has been closed for the setting, then goes with a copy saved first', async () => {
  const r = room();
  r.audit(3);
  const before = await chainLines(r.rows());
  const files = fakeFiles();
  const env = { DB: r.db, FILES: files.bucket, RETAIN_AUDIT_DAYS_AFTER_CLOSE: '30' };
  assert.equal((await sweepRetention(env, NOW)).audit, null, 'open matter');
  r.close(ago(29));
  assert.equal((await sweepRetention(env, NOW)).audit, null, 'closed 29 days ago');
  r.sqlite.prepare('DELETE FROM matter_close').run();
  r.close(ago(31));
  const trigger = r.trigger();
  const { audit } = await sweepRetention(env, NOW);
  assert.equal(audit?.rows, 3);
  assert.equal(audit?.throughId, 3);
  assert.equal(audit?.chain, before.last);
  assert.equal(audit?.copyKey, `${AUDIT_COPY_PREFIX}000000000001-000000000003.jsonl`);
  assert.equal(r.count('audit_log'), 0);
  // The copy is the room's own export of those rows, byte for byte, and verifies.
  assert.equal(files.objects.get(audit!.copyKey), before.lines.map((line) => `${line}\n`).join(''));
  assert.deepEqual(await verifyCopy(files.objects.get(audit!.copyKey)!), { ok: true, rows: 3 });
  assert.deepEqual(r.sqlite.prepare('SELECT through_id, rows, chain, copy_key FROM audit_purges').all().map((row) => ({ ...row })), [{ through_id: 3, rows: 3, chain: before.last, copy_key: audit!.copyKey }]);
  assert.equal(r.trigger(), trigger, 'the append-only trigger is back, word for word');
});

test('after a purge, live rows are still append-only and every copy carries on one chain', async () => {
  const r = room();
  const files = fakeFiles();
  const env = { DB: r.db, FILES: files.bucket };
  r.audit(2);
  const one = await purgeAuditBatch(env, NOW);
  r.audit(3);
  // The room's own export now starts from the purge's chain, so copy + export is one chain from the first row.
  const start = await chainStart(r.db);
  assert.equal(start, one?.chain);
  const live = await chainLines(r.rows(), start);
  const copyOne = files.objects.get(one!.copyKey)!;
  assert.deepEqual(await verifyCopy(copyOne + live.lines.map((line) => `${line}\n`).join('')), { ok: true, rows: 5 });
  assert.deepEqual(await verifyCopy(live.lines.join('\n'), undefined, start), { ok: true, rows: 3 });
  assert.equal((await verifyCopy(live.lines.join('\n'))).ok, false, 'a later copy needs its start');
  assert.throws(() => r.sqlite.prepare('DELETE FROM audit_log').run(), /append-only/);
  assert.throws(() => r.sqlite.prepare("UPDATE audit_log SET email = 'x@example.test'").run(), /append-only/);
  // The next purge's copy is exactly those lines: both copies together verify from the first row.
  const two = await purgeAuditBatch(env, NOW);
  assert.equal(two?.throughId, 5);
  assert.equal(files.objects.get(two!.copyKey), live.lines.map((line) => `${line}\n`).join(''));
  assert.deepEqual(await verifyCopy(copyOne + files.objects.get(two!.copyKey)!), { ok: true, rows: 5 });
  assert.equal(await purgeAuditBatch(env, NOW), null, 'nothing left');
});

test('a hold stops a purge in the database: nothing is removed and the trigger stays', async () => {
  const r = room();
  r.audit(2);
  r.close(ago(400));
  r.hold();
  const trigger = r.trigger();
  await assert.rejects(purgeAuditBatch({ DB: r.db, FILES: fakeFiles().bucket }, NOW), /legal hold/);
  assert.equal(r.count('audit_log'), 2);
  assert.equal(r.count('audit_purges'), 0);
  assert.equal(r.trigger(), trigger);
  assert.equal((await sweepRetention({ DB: r.db, FILES: fakeFiles().bucket, RETAIN_AUDIT_DAYS_AFTER_CLOSE: '1' }, NOW)).held, true);
});

test('a copy not saved whole removes nothing', async () => {
  const r = room();
  r.audit(2);
  await assert.rejects(purgeAuditBatch({ DB: r.db, FILES: fakeFiles(true).bucket }, NOW), { name: 'retention_copy_not_saved' });
  assert.equal(r.count('audit_log'), 2);
  assert.equal(r.count('audit_purges'), 0);
});

test('audit_purges is append-only, only moves forward, and must count exactly the rows it removes', () => {
  const r = room();
  r.audit(4);
  const insert = r.sqlite.prepare("INSERT INTO audit_purges (ts, through_id, rows, chain, copy_key) VALUES ('2026-11-05T00:00:00.000Z', ?, ?, ?, 'retention/audit-log/x.jsonl')");
  const chain = 'a'.repeat(64);
  assert.throws(() => insert.run(2, 3, chain), /exactly/);
  insert.run(2, 2, chain);
  assert.throws(() => insert.run(1, 1, chain), /exactly/);
  assert.throws(() => r.sqlite.prepare('UPDATE audit_purges SET rows = 9').run(), /append-only/);
  assert.throws(() => r.sqlite.prepare('DELETE FROM audit_purges').run(), /append-only/);
  assert.throws(() => r.sqlite.prepare("INSERT INTO audit_purges (ts, through_id, rows, chain, copy_key) VALUES ('2026-11-05T00:00:00.000Z', 4, 4, 'x', 'retention/audit-log/y.jsonl')").run(), /CHECK/);
  r.close(ago(1));
  assert.throws(() => r.sqlite.prepare("UPDATE matter_close SET closed_at = '2020-01-01T00:00:00.000Z'").run(), /fixed/);
});

test('a hold stops the replaced-original purge too', () => {
  const r = room();
  r.sqlite.prepare("INSERT INTO sync_retired (r2_key, document_id, retired_at) VALUES ('k1', 'd1', '2020-01-01T00:00:00.000Z')").run();
  const purgeable = () => r.sqlite.prepare(PURGEABLE_SQL).all(NOW.toISOString(), 10).length;
  assert.equal(purgeable(), 1);
  r.hold();
  assert.equal(purgeable(), 0);
});
