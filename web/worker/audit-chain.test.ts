// SPDX-License-Identifier: Apache-2.0
// The append-only audit log (migration 0019) and its chained copy (worker/audit-chain.ts), on real SQLite through
// the real gate in room.ts. Test names are the Data room row's rule (dispute.counsel.complete.audit_tamper_evident).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Env } from './env.ts';
import { AUDIT_COPY_PATH, chainLines, verifyCopy, type AuditCopyRow } from './audit-chain.ts';
import { handle } from './room.ts';
import { testDb } from './sqlite-d1.ts';

const HOST = 'http://localhost:8789';
const OWNER = 'founder@example.test';
const COUNSEL = 'ada@firm.example';

function room() {
  const { db, sqlite } = testDb();
  sqlite.exec(`
    INSERT INTO members (email, role, name) VALUES ('${OWNER}', 'owner', 'Jane Doe'), ('${COUNSEL}', 'counsel', 'Ada Quill');
    INSERT INTO audit_log (ts, email, action, document_id, ip, user_agent) VALUES
      ('2026-03-02T15:04:05.000Z', '${COUNSEL}', 'view', 'd1', '192.0.2.10', 'UA one'),
      ('2026-03-02T15:09:00.000Z', '${COUNSEL}', 'download', 'd1', '192.0.2.10', 'UA one'),
      ('2026-03-03T09:00:00.000Z', '${OWNER}', 'comment', 'd2', NULL, NULL),
      ('2026-03-04T10:30:00.000Z', '${COUNSEL}', 'key', 'd2', NULL, NULL);
  `);
  const env = (as: string) =>
    ({ ASSETS: { fetch: async () => new Response('shell') }, DB: db, TEAM_DOMAIN: '', ACCESS_AUD: '', ALLOW_DEV_IDENTITY: '1', DEV_IDENTITY_EMAIL: as }) as unknown as Env;
  const copy = (as = OWNER, headers: Record<string, string> = { 'Sec-Fetch-Site': 'same-origin' }) =>
    handle(new Request(`${HOST}${AUDIT_COPY_PATH}`, { headers }), env(as), {} as ExecutionContext);
  const count = () => Number(sqlite.prepare('SELECT count(*) AS n FROM audit_log').get()?.n);
  return { sqlite, copy, count };
}

const parse = (text: string) => text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as AuditCopyRow & { chain: string });
const unparse = (rows: readonly object[]) => rows.map((row) => `${JSON.stringify(row)}\n`).join('');

test('no role can edit a log row', async () => {
  const { sqlite, count } = room();
  const before = sqlite.prepare('SELECT * FROM audit_log ORDER BY id').all();
  const refused = [
    "UPDATE audit_log SET email = 'someone@example.test' WHERE id = 1",
    "UPDATE audit_log SET ts = '2026-01-01T00:00:00.000Z'",
    'UPDATE audit_log SET document_id = NULL WHERE id = 2',
    'DELETE FROM audit_log WHERE id = 3',
    'DELETE FROM audit_log',
    `INSERT OR REPLACE INTO audit_log (id, email, action) VALUES (4, '${OWNER}', 'view')`,
    `REPLACE INTO audit_log (id, email, action) VALUES (1, '${OWNER}', 'view')`,
    `INSERT INTO audit_log (id, email, action) VALUES (2, '${OWNER}', 'view') ON CONFLICT (id) DO UPDATE SET action = 'view'`,
  ];
  for (const sql of refused) assert.throws(() => sqlite.exec(sql), /audit_log is append-only/, sql);
  assert.deepEqual(sqlite.prepare('SELECT * FROM audit_log ORDER BY id').all(), before, 'every row as it was');
  sqlite.exec(`INSERT INTO audit_log (email, action, document_id) VALUES ('${OWNER}', 'view', 'd1')`);
  assert.equal(count(), 5, 'new rows still land');

  // Every role reaches the log through the same database, and no product code tries to change a row. The one exception
  // is the retention purge (worker/data-retention.ts): a closed matter's rows, after their chained copy is saved, in the
  // same transaction as the audit_purges record that names them. Exactly that statement, once, in that file.
  const change = /\b(?:UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+audit_log\b/i;
  const purge = "'DELETE FROM audit_log WHERE id <= ?1'";
  const root = join(import.meta.dirname, '..');
  for (const dir of ['worker', 'mcp', 'scripts', 'src']) {
    for (const file of readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })) {
      if (!/\.(?:ts|astro)$/.test(file) || file.endsWith('.test.ts')) continue;
      let text = readFileSync(join(root, dir, file), 'utf8');
      if (dir === 'worker' && file === 'data-retention.ts') {
        assert.equal(text.split(purge).length - 1, 1, 'the retention purge, once');
        text = text.replace(purge, '');
      }
      assert.doesNotMatch(text, change, `${dir}/${file}`);
    }
  }
});

test('altering a copy fails verification at that row', async () => {
  const { copy, count } = room();
  const res = await copy();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Type') ?? '', /^application\/x-ndjson/);
  assert.match(res.headers.get('Content-Disposition') ?? '', /attachment; filename="audit-log-\d{4}-\d{2}-\d{2}\.jsonl"/);
  const original = await res.text();
  const rows = parse(original);
  assert.deepEqual(rows.map((r) => r.id), [1, 2, 3, 4, 5], 'every row, oldest first, the export itself last');
  assert.deepEqual([rows[4]!.email, rows[4]!.action, rows[4]!.via, rows[4]!.document_id], [OWNER, 'download', 'audit-log', null]);
  assert.ok(rows.every((r) => /^[0-9a-f]{64}$/.test(r.chain)));
  assert.deepEqual(await verifyCopy(original), { ok: true, rows: 5 }, 'the original passes');

  const fresh = await (await copy()).text();
  assert.ok(fresh.startsWith(original), 'the room gives the same chain again: no row changed');
  assert.deepEqual(await verifyCopy(original, fresh), { ok: true, rows: 5 });

  const edited = rows.map((r) => (r.id === 3 ? { ...r, email: COUNSEL } : r));
  assert.deepEqual(await verifyCopy(unparse(edited)), { ok: false, line: 3, id: 3 }, 'a changed field');
  assert.deepEqual(await verifyCopy(unparse(rows.map((r) => (r.id === 2 ? { ...r, ts: '2026-03-02T15:09:01.000Z' } : r)))), { ok: false, line: 2, id: 2 });
  assert.deepEqual(await verifyCopy(unparse(rows.filter((r) => r.id !== 2))), { ok: false, line: 2, id: 3 }, 'a removed row fails at the next');
  assert.deepEqual(await verifyCopy(unparse([rows[1], rows[0], ...rows.slice(2)])), { ok: false, line: 1, id: 2 }, 'rows out of order');

  // Rebuilding every chain after the change makes the copy agree with itself, but not with the room.
  const { lines } = await chainLines(edited.map(({ chain: _chain, ...row }) => row));
  const rebuilt = lines.map((line) => `${line}\n`).join('');
  assert.deepEqual(await verifyCopy(rebuilt), { ok: true, rows: 5 });
  assert.deepEqual(await verifyCopy(rebuilt, fresh), { ok: false, line: 3, id: 3 }, 'against the room it fails at that row');
  assert.deepEqual(await verifyCopy(`${original}{"id":9}\n`), { ok: false, line: 6, id: null }, 'a malformed line');

  const before = count();
  assert.equal((await copy(COUNSEL)).status, 403, 'the owner only');
  assert.equal((await copy(OWNER, { 'Sec-Fetch-Site': 'cross-site' })).status, 403, 'not from another site');
  assert.equal(count(), before, 'a refused export writes no row');
});
