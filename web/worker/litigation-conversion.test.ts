// SPDX-License-Identifier: Apache-2.0
// npm run litigation -- convert (scripts/litigation.ts, migration 0018) on the fictional Harbor Labs record, real SQLite:
// a manifest before, the conversion, a manifest after, compared. The Data room page
// (quality-speed/pages/data-room/list.ts) reads these tests by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { handleAuthorize } from '../mcp/authorize.ts';
import type { McpEnv, Props } from '../mcp/contract.ts';
import { CIMD_CLIENT, CLAUDE_REDIRECT, fakeEnv, fakeOAuth, getKey, signedRequest } from '../mcp/oauth-fakes.ts';
import { runTool } from '../mcp/server.ts';
import { sweepOrphanGrants } from '../mcp/sweep.ts';
import { listedTools } from '../mcp/tools/index.ts';
import type { AiAuditEntry } from '../mcp/audit.ts';
import type { SyncPlan } from '../scripts/diff.ts';
import { conversionSql, conversionStatements, litigationSql, manifestHash, MANIFEST_SQL, STATE_SQL, type ConversionState, type ManifestRow } from '../scripts/litigation.ts';
import { syncSql } from '../scripts/sqlplan.ts';
import { NUMBER_UNNUMBERED_SQL } from './files-catalog.ts';
import { handle } from './index.ts';
import { roomRoutes } from './room.ts';
import { BEA, COUNSEL, DOC, HOST, IVY, OTTO, OWNER, ROOM_A, ROOM_B, roomsDb, roomsEnv, SAME_ORIGIN } from './rooms-fixtures.ts';
import { GUEST_ROUTES } from './routes/rooms.ts';
import type { Route } from './router.ts';

const NOW = new Date('2026-06-01T09:00:00.000Z');
const LATER = new Date('2026-06-01T09:05:00.000Z');
const RUN = 'eeeeeeee-0000-4000-8000-00000000000e';
const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;
const INVESTORS = [IVY, OTTO, BEA];

const rows = (sqlite: DatabaseSync, sql: string) => sqlite.prepare(sql).all().map((r) => ({ ...r }));
const one = (sqlite: DatabaseSync, sql: string) => ({ ...(sqlite.prepare(sql).get() as Record<string, unknown>) });

/** The fixture, numbered and hashed as a sync leaves it, with a guest's comment and a member's. */
function record() {
  const t = roomsDb();
  const { sqlite } = t;
  sqlite.exec(NUMBER_UNNUMBERED_SQL);
  for (const doc of Object.values(DOC)) {
    sqlite.prepare('UPDATE documents SET sha256 = ?2 WHERE id = ?1').run(doc.id, createHash('sha256').update(doc.path).digest('hex'));
  }
  sqlite.prepare("INSERT INTO comments (id, document_id, author_email, body, room_id) VALUES ('c1', ?1, ?2, 'Question on the term sheet', ?3)").run(DOC.term.id, IVY, ROOM_A);
  sqlite.prepare("INSERT INTO comments (id, document_id, author_email, body) VALUES ('c2', ?1, ?2, 'Member note')").run(DOC.term.id, OWNER);
  sqlite.prepare("INSERT INTO audit_log (email, action, document_id, room_id) VALUES (?1, 'view', ?2, ?3)").run(IVY, DOC.term.id, ROOM_A);
  return t;
}

function stateOf(sqlite: DatabaseSync): ConversionState {
  const row = one(sqlite, STATE_SQL);
  return { openId: (row.open_id as string | null) ?? null, finishedAt: (row.finished_at as string | null) ?? null, unresolved: (row.unresolved as string | null) ?? null };
}

const manifest = (sqlite: DatabaseSync) => rows(sqlite, MANIFEST_SQL) as unknown as ManifestRow[];

/** What npm run litigation -- convert does: read the state and the manifest, then run the SQL. */
function convert(sqlite: DatabaseSync, now = NOW): void {
  sqlite.exec(conversionSql(stateOf(sqlite), manifest(sqlite), now, RUN));
}

/** Everything a conversion could change but the run's own times. */
function outcome(sqlite: DatabaseSync) {
  return {
    manifest: manifest(sqlite),
    conversions: rows(sqlite, 'SELECT id, actor, finished_at IS NOT NULL AS done, manifest_sha256, documents, comments, invitations, events_before, events_after, investors_out FROM conversions'),
    live: rows(sqlite, 'SELECT room_id, email FROM room_members WHERE revoked_at IS NULL ORDER BY 1, 2'),
    // Grant ids differ between fixtures, so each event is matched to its invitation by room and email.
    events: rows(sqlite, 'SELECT e.action, e.room_id, e.subject_email, e.detail_code, g.revoked_at IS NOT NULL AS ended FROM access_events e JOIN room_members g ON g.id = e.grant_id ORDER BY 2, 3, e.id'),
  };
}

test('conversion keeps every document and its SHA-256', () => {
  const { sqlite } = record();
  const before = manifest(sqlite);
  assert.equal(before.length, Object.keys(DOC).length);
  convert(sqlite);
  const after = manifest(sqlite);
  assert.deepEqual(after, before, 'same rows, same SHA-256, zero differences');
  const event = one(sqlite, 'SELECT manifest_sha256, documents FROM conversions');
  assert.equal(event.manifest_sha256, manifestHash(before));
  assert.equal(manifestHash(after), manifestHash(before));
  assert.equal(event.documents, before.length);
});

test('conversion keeps each control number on the same hash, and a new document takes the next', () => {
  const { sqlite } = record();
  const numbers = (list: ManifestRow[]) => list.map((row) => [row.control_seq, row.sha256]);
  const before = manifest(sqlite);
  assert.ok(before.every((row) => Number.isInteger(row.control_seq)));
  convert(sqlite);
  assert.deepEqual(numbers(manifest(sqlite)), numbers(before));
  const sha256 = createHash('sha256').update('Deals/Harbor Seed/Side letter.pdf').digest('hex');
  const plan = {
    adds: [{ id: 'doc-new', r2Key: 'r2-doc-new', path: 'Deals/Harbor Seed/Side letter.pdf', folder: 'Deals/Harbor Seed', name: 'Side letter.pdf', size: 10, sha256, kind: 'pdf', contentType: 'application/pdf', file: { rel: 'Deals/Harbor Seed/Side letter.pdf', size: 10, sha256 } }],
    changes: [], renames: [], removals: [], unchanged: [], held: [],
  } as unknown as SyncPlan;
  sqlite.exec(syncSql(plan, LATER.toISOString()));
  const added = one(sqlite, "SELECT control_seq FROM documents WHERE id = 'doc-new'");
  assert.equal(added.control_seq, Math.max(...before.map((row) => row.control_seq!)) + 1);
});

test('conversion is one recorded event with actor, time and counts, and a killed run finishes cleanly', () => {
  const clean = record().sqlite;
  convert(clean);
  const event = rows(clean, 'SELECT * FROM conversions');
  assert.equal(event.length, 1);
  assert.deepEqual(event[0], {
    id: RUN, actor: 'owner-cli', started_at: NOW.toISOString(), finished_at: NOW.toISOString(), manifest_sha256: manifestHash(manifest(clean)),
    documents: Object.keys(DOC).length, comments: 2, invitations: 4, events_before: 1, events_after: 5, investors_out: 4,
  });
  assert.throws(() => convert(clean, LATER), /Nothing to do/);
  clean.exec(conversionStatements('ffffffff-0000-4000-8000-00000000000f', 'f'.repeat(64), LATER).join('\n'));
  assert.equal(rows(clean, 'SELECT id FROM conversions').length, 1, 'an install converts once, even with the SQL run straight');

  for (let stop = 1; stop < 4; stop++) {
    const killed = record().sqlite;
    killed.exec(conversionStatements(RUN, manifestHash(manifest(killed)), NOW).slice(0, stop).join('\n'));
    assert.equal(one(killed, 'SELECT count(*) AS n FROM conversions WHERE finished_at IS NOT NULL').n, 0, `stopped after ${stop}: not finished`);
    convert(killed, LATER);
    assert.deepEqual(outcome(killed), outcome(clean), `stopped after statement ${stop}, then run again`);
  }
});

test('conversion cannot finish while a director\'s account is unresolved, and only a lawyer records the decision', () => {
  const { sqlite } = record();
  sqlite.exec(litigationSql({ kind: 'director', email: OTTO }, NOW));
  sqlite.exec(litigationSql({ kind: 'director', email: IVY }, NOW));
  const before = outcome(sqlite);
  assert.throws(() => convert(sqlite), /a lawyer records a decision for each director's account: ivy@fund\.example, otto@angels\.example/);
  // Even run straight, the SQL itself refuses to start: nothing changes.
  sqlite.exec(conversionStatements(RUN, 'a'.repeat(64), NOW).join('\n'));
  assert.deepEqual(outcome(sqlite), before);

  assert.throws(() => sqlite.exec(litigationSql({ kind: 'decide', email: OTTO, decision: 'keep', lawyer: OWNER }, NOW)), /only a lawyer/);
  sqlite.exec(litigationSql({ kind: 'decide', email: OTTO, decision: 'keep', lawyer: COUNSEL }, NOW));
  assert.throws(() => convert(sqlite), /ivy@fund\.example\./, 'one still unresolved');
  // Named after a run started: the run stops and cannot finish until the lawyer decides.
  sqlite.exec(litigationSql({ kind: 'decide', email: IVY, decision: 'remove', lawyer: COUNSEL }, NOW));
  sqlite.exec(conversionStatements(RUN, manifestHash(manifest(sqlite)), NOW).slice(0, 1).join('\n'));
  sqlite.exec(litigationSql({ kind: 'director', email: BEA }, NOW));
  sqlite.exec(conversionStatements(RUN, manifestHash(manifest(sqlite)), NOW).join('\n'));
  assert.equal(one(sqlite, 'SELECT finished_at FROM conversions').finished_at, null);
  sqlite.exec(litigationSql({ kind: 'decide', email: BEA, decision: 'remove', lawyer: COUNSEL }, LATER));
  convert(sqlite, LATER);

  assert.deepEqual(rows(sqlite, 'SELECT email, decision, decided_by, decided_at FROM directors ORDER BY email'), [
    { email: BEA, decision: 'remove', decided_by: COUNSEL, decided_at: LATER.toISOString() },
    { email: IVY, decision: 'remove', decided_by: COUNSEL, decided_at: NOW.toISOString() },
    { email: OTTO, decision: 'keep', decided_by: COUNSEL, decided_at: NOW.toISOString() },
  ]);
  assert.throws(() => sqlite.exec(litigationSql({ kind: 'decide', email: IVY, decision: 'keep', lawyer: COUNSEL }, LATER).replace('AND decision IS NULL', '')), /recorded once/);
  assert.deepEqual(rows(sqlite, 'SELECT email FROM room_members WHERE revoked_at IS NULL'), [{ email: OTTO }], 'the kept director only');
});

const pathOf = (route: Pick<Route, 'path'>, room: string) => route.path.replace(/:(\w+)/g, (_m, name: string) => (name === 'id' ? DOC.term.id : name === 'room' ? room : 'x'));

test('after conversion each investor is refused on view, search, download, API, Ask, connector and old links', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { db, sqlite } = record();
  const as = (email: string, path: string, method = 'GET') =>
    handle(new Request(`${HOST}${path}`, { method, headers: SAME_ORIGIN, body: method === 'GET' || method === 'HEAD' ? undefined : '{}' }), roomsEnv(db, email).env, ctx);
  const oldLinks = [`/rooms/${ROOM_A}/view/${DOC.term.id}`, `/api/rooms/${ROOM_A}/files/${DOC.term.id}`, `/api/rooms/${ROOM_B}/documents`];
  assert.equal((await as(IVY, oldLinks[0]!)).status, 200, 'before: the investor reads the room');
  assert.equal((await as(BEA, oldLinks[2]!)).status, 200);

  convert(sqlite);
  const routes = [...roomRoutes(), ...GUEST_ROUTES];
  for (const path of ['/api/ask', '/api/documents', '/files/:id', '/api/rooms/:room/files/:id']) assert.ok(routes.some((r) => r.path === path), path);
  for (const email of INVESTORS) {
    for (const room of [ROOM_A, ROOM_B]) {
      for (const route of routes) {
        const res = await as(email, pathOf(route, room), route.method);
        assert.equal(res.status, 403, `${email} ${route.method} ${route.path}`);
        assert.match(await res.text(), /This room is private\./);
      }
    }
    for (const path of oldLinks) assert.equal((await as(email, path)).status, 403, `${email} ${path}`);
  }

  // The connector: no new connection, and an old one fails at its next call, for every tool.
  const oauth = fakeOAuth();
  const mcp = { ...fakeEnv(oauth, { ROOMS_ENABLED: '1' } as Partial<McpEnv>), DB: db };
  const q = new URLSearchParams({ response_type: 'code', client_id: CIMD_CLIENT, redirect_uri: CLAUDE_REDIRECT, state: 's1' });
  for (const email of INVESTORS) {
    assert.equal((await handleAuthorize(await signedRequest(`/authorize?${q}`, email), mcp, { getKey })).status, 403, email);
    const props: Props = { email, role: 'counsel', clientId: 'client-1', clientName: 'Claude' };
    for (const tool of listedTools()) {
      const out = await runTool(tool, {}, mcp, props, undefined, NOW);
      assert.match(String((out.content[0] as { text: string }).text), /^not_a_member:/, `${email} ${tool.name}`);
    }
  }
  assert.deepEqual(oauth.names(), []);
});

test('after conversion the sweep revokes a departing account\'s AI tokens', async (t) => {
  t.mock.method(console, 'log', () => {});
  const { db, sqlite } = record();
  convert(sqlite);
  const departing = rows(sqlite, "SELECT DISTINCT subject_email AS email FROM access_events WHERE detail_code = 'litigation_conversion' ORDER BY 1").map((r) => r.email as string);
  assert.deepEqual(departing, [BEA, IVY, OTTO]);
  // Each departing account holds a connection from an earlier time as a member; the owner and counsel keep theirs.
  const store = new Map<string, string>([[`grant:${OWNER}:o1`, '{}'], [`grant:${COUNSEL}:c1`, '{}'], ...departing.map((email, i): [string, string] => [`grant:${email}:d${i}`, JSON.stringify({ metadata: { clientName: 'Claude' } })])]);
  const kv = {
    list: async () => ({ keys: [...store.keys()].map((name) => ({ name })), list_complete: true }),
    get: async (key: string) => (store.has(key) ? JSON.parse(store.get(key)!) : null),
    put: async () => {},
    delete: async () => {},
  } as unknown as KVNamespace;
  const revoked: string[] = [];
  const env = { DB: db, OAUTH_KV: kv, OAUTH_PROVIDER: { revokeGrant: async (grantId: string, userId: string) => void revoked.push(`${userId}:${grantId}`) } } as unknown as McpEnv;
  const audits: AiAuditEntry[] = [];
  const result = await sweepOrphanGrants(env, async (_env, entry) => void audits.push(entry));
  assert.deepEqual(revoked.sort(), departing.map((email, i) => `${email}:d${i}`).sort());
  assert.equal(result.complete, true);
  assert.deepEqual(audits.map((a) => a.action), ['ai_disconnect', 'ai_disconnect', 'ai_disconnect']);
});
