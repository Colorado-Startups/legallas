// SPDX-License-Identifier: Apache-2.0
// aiAudit on real SQLite: one row per call with via, ip and user agent; ai_read deduped per member, document and
// app; a failed write logs only a code and throws AuditError, which runTool turns into internal_error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb } from '../worker/sqlite-d1.ts';
import { aiAudit, AuditError, auditVia, MAX_VIA_CHARS } from './audit.ts';
import type { McpEnv, Props, ToolDefinition } from './contract.ts';
import { runTool } from './server.ts';

const EMAIL = 'ada@firm.example';

function setup() {
  const { db, sqlite } = testDb();
  const env = { DB: db };
  const audits = () =>
    sqlite
      .prepare('SELECT email, action, document_id, ip, user_agent, via FROM audit_log ORDER BY id')
      .all()
      .map((r) => ({ ...r }));
  return { env, sqlite, audits };
}

test('writes one row with via, and ip and user agent from the request', async () => {
  const { env, audits } = setup();
  const request = new Request('https://mcp.example.test/mcp', { headers: { 'CF-Connecting-IP': '192.0.2.7', 'User-Agent': 'Claude-User' } });
  await aiAudit(env, { email: EMAIL, action: 'ai_search', documentId: null, via: 'Claude', request });
  await aiAudit(env, { email: EMAIL, action: 'ai_connect', documentId: null, via: 'Harvey' });
  assert.deepEqual(audits(), [
    { email: EMAIL, action: 'ai_search', document_id: null, ip: '192.0.2.7', user_agent: 'Claude-User', via: 'Claude' },
    { email: EMAIL, action: 'ai_connect', document_id: null, ip: null, user_agent: null, via: 'Harvey' },
  ]);
});

test('searches are never deduped: each call is a row', async () => {
  const { env, audits } = setup();
  for (let i = 0; i < 3; i++) await aiAudit(env, { email: EMAIL, action: 'ai_search', documentId: null, via: 'Claude' });
  assert.equal(audits().length, 3);
});

test('ai_read is one row per member, document and app within the dedupe window', async () => {
  const { env, sqlite, audits } = setup();
  const read = (documentId: string, via: string, email = EMAIL) => aiAudit(env, { email, action: 'ai_read', documentId, via });
  await read('d1', 'Claude');
  await read('d1', 'Claude');
  await read('d2', 'Claude');
  await read('d1', 'Harvey');
  await read('d1', 'Claude', 'bo@firm.example');
  assert.deepEqual(
    audits().map((r) => [r.email, r.document_id, r.via]),
    [
      [EMAIL, 'd1', 'Claude'],
      [EMAIL, 'd2', 'Claude'],
      [EMAIL, 'd1', 'Harvey'],
      ['bo@firm.example', 'd1', 'Claude'],
    ],
  );

  // Once the earlier read is older than the window, the next read is a new row. The test plays the clock: rows are
  // append-only (migration 0019), so it lifts that trigger to age them.
  sqlite.exec('DROP TRIGGER audit_log_no_update');
  sqlite.exec("UPDATE audit_log SET ts = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-11 minutes')");
  await read('d1', 'Claude');
  assert.equal(audits().length, 5);
});

test('a room view of the same document does not swallow an AI read', async () => {
  const { env, sqlite, audits } = setup();
  sqlite.exec(`INSERT INTO audit_log (email, action, document_id) VALUES ('${EMAIL}', 'view', 'd1')`);
  await aiAudit(env, { email: EMAIL, action: 'ai_read', documentId: 'd1', via: 'Claude' });
  assert.deepEqual(audits().map((r) => r.action), ['view', 'ai_read']);
});

test('via is cleaned and bounded to what the CHECK allows', async () => {
  assert.equal(auditVia('  Claude \n Desktop\u0007 '), 'Claude Desktop');
  assert.equal(auditVia(' \t '), null);
  assert.equal(auditVia('x'.repeat(200)), 'x'.repeat(MAX_VIA_CHARS));
  // 80 astral characters, then one more: cut on code points, never mid surrogate pair.
  const long = '\u{1F4C4}'.repeat(81);
  assert.equal(Array.from(auditVia(long) ?? '').length, MAX_VIA_CHARS);
  assert.equal(auditVia(long), '\u{1F4C4}'.repeat(MAX_VIA_CHARS));

  const { env, audits } = setup();
  await aiAudit(env, { email: EMAIL, action: 'ai_search', documentId: null, via: long });
  await aiAudit(env, { email: EMAIL, action: 'ai_search', documentId: null, via: '' });
  assert.deepEqual(audits().map((r) => r.via), ['\u{1F4C4}'.repeat(MAX_VIA_CHARS), null]);
});

const brokenDb = {
  prepare() {
    throw new Error('D1_ERROR: secret document name.pdf');
  },
} as unknown as D1Database;

test('a failed write fails closed: logs codes only and throws AuditError without the D1 text', async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => logged.push(args));
  await assert.rejects(aiAudit({ DB: brokenDb }, { email: EMAIL, action: 'ai_read', documentId: 'd1', via: 'Claude' }), (error) => {
    assert.ok(error instanceof AuditError);
    assert.equal(error.message, 'mcp_audit_failed');
    return true;
  });
  assert.deepEqual(logged, [['mcp_audit_failed', 'ai_read', 'Error']]);
});

test('through runTool, a failed audit withholds the text and returns internal_error', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { env } = setup();
  await env.DB.prepare("INSERT INTO members (email, role, name) VALUES (?1, 'counsel', 'Ada')").bind(EMAIL).run();
  // Tool calls count on the real usage table; only the audit insert fails.
  const db = new Proxy(env.DB, {
    get: (target, key) =>
      key === 'prepare' ? (sql: string) => (sql.startsWith('INSERT INTO audit_log') ? brokenDb.prepare(sql) : target.prepare(sql)) : Reflect.get(target, key),
  });
  const props: Props = { email: EMAIL, role: 'counsel', clientId: 'c1', clientName: 'Claude' };
  const tool = {
    name: 'legallas_read_pages',
    async handler(_args: unknown, ctx: { audit(action: 'ai_read', id: string): Promise<void> }) {
      await ctx.audit('ai_read', 'd1');
      return { content: [{ type: 'text', text: 'page text that must not go out' }] };
    },
  } as unknown as ToolDefinition;
  const result = await runTool(tool, {}, { DB: db } as unknown as McpEnv, props, undefined, new Date());
  assert.equal(result.isError, true);
  assert.doesNotMatch(JSON.stringify(result), /page text/);
  assert.match(JSON.stringify(result), /internal_error/);
});
