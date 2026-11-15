// SPDX-License-Identifier: Apache-2.0
// History through the conversion to a litigation room (scripts/litigation.ts; research J5, J6, J8) on the fictional
// Harbor Labs record, real SQLite: comments, invitations and the event log are the same rows after it, and the owner's
// as-of query (GET /api/litigation/as-of) still shows what each investor could see before it. The Data room page
// (quality-speed/pages/data-room/list.ts) reads this test by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { conversionSql, MANIFEST_SQL, STATE_SQL, type ManifestRow } from '../scripts/litigation.ts';
import { inviteSql, inviteStateSql } from '../scripts/room.ts';
import { resetDocFactsCache } from './doc-facts-serve.ts';
import { handle } from './index.ts';
import { BEA, COUNSEL, DOC, HOST, IVY, OTTO, OWNER, ROOM_A, ROOM_A_PATHS, ROOM_B, ROOM_C, roomsDb, roomsEnv } from './rooms-fixtures.ts';

const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;
const CONVERTED = new Date('2026-06-01T09:00:00.000Z');
const rows = (sqlite: DatabaseSync, sql: string) => sqlite.prepare(sql).all().map((r) => ({ ...r }));

/** Comments, invitations and both logs, every column the conversion must not touch. */
function history(sqlite: DatabaseSync) {
  return {
    comments: rows(sqlite, 'SELECT * FROM comments ORDER BY id'),
    invitations: rows(sqlite, 'SELECT id, room_id, email, role, name, invited_by, invited_at, accept_by, joined_at, expires_at FROM room_members ORDER BY id'),
    access: rows(sqlite, 'SELECT * FROM access_events ORDER BY id'),
    audit: rows(sqlite, 'SELECT * FROM audit_log ORDER BY id'),
  };
}

async function asOf(db: D1Database, email: string, at: string) {
  resetDocFactsCache();
  return handle(new Request(`${HOST}/api/litigation/as-of?at=${at}`), roomsEnv(db, email).env, ctx);
}

test('comments, invitations and the event log survive conversion, and an as-of query shows what each investor could see', async () => {
  const { db, sqlite } = roomsDb();
  // The rooms open in January; the fixture's documents arrive on 2026-02-01.
  sqlite.exec("UPDATE rooms SET created_at = '2026-01-01T00:00:00.000Z'; UPDATE room_folders SET added_at = '2026-01-01T00:00:00.000Z';");
  const invite = { kind: 'invite', roomId: ROOM_B, email: 'cy@group.example', role: 'investor', name: null, days: 30 } as const;
  const row = sqlite.prepare(inviteStateSql(invite)).get() as Record<string, unknown>;
  sqlite.exec(inviteSql(invite, { isMember: row.is_member === 1, roomLive: row.room_live === 1, liveGrant: null }, new Date('2026-02-10T00:00:00.000Z'), 'grant-cy'));
  sqlite.prepare("INSERT INTO comments (id, document_id, author_email, body, room_id, created_at) VALUES ('c1', ?1, ?2, 'When does the note convert?', ?3, '2026-02-12T10:00:00.000Z')").run(DOC.term.id, IVY, ROOM_A);
  sqlite.prepare("INSERT INTO comments (id, document_id, author_email, body, parent_id, created_at) VALUES ('c2', ?1, ?2, 'Reply', 'c1', '2026-02-12T11:00:00.000Z')").run(DOC.term.id, OWNER);
  sqlite.prepare("INSERT INTO audit_log (ts, email, action, document_id, room_id) VALUES ('2026-02-12T09:00:00.000Z', ?1, 'view', ?2, ?3)").run(IVY, DOC.term.id, ROOM_A);
  const before = history(sqlite);
  const state = sqlite.prepare(STATE_SQL).get() as Record<string, string | null>;
  sqlite.exec(conversionSql({ openId: state.open_id ?? null, finishedAt: state.finished_at ?? null, unresolved: state.unresolved ?? null }, rows(sqlite, MANIFEST_SQL) as unknown as ManifestRow[], CONVERTED, 'eeeeeeee-0000-4000-8000-00000000000e'));

  const after = history(sqlite);
  assert.deepEqual(after.comments, before.comments, 'every comment, with its author and time');
  assert.deepEqual(after.invitations, before.invitations, 'every invitation, with who invited whom and when');
  assert.deepEqual(after.access.slice(0, before.access.length), before.access, 'the access log only grows');
  assert.deepEqual(after.audit, before.audit);
  assert.equal(after.access.length - before.access.length, 5, 'one grant_revoked per invitation ended');

  // Before the conversion: each investor, each room, and what it showed them then.
  const res = await asOf(db, OWNER, '2026-02-20');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { at: string; investors: { email: string; roomId: string; documents: { folder: string; name: string }[] }[] };
  const seen = body.investors.map((view) => [view.email, view.roomId, view.documents.map((d) => `${d.folder}/${d.name}`)]);
  assert.deepEqual(seen, [
    [BEA, ROOM_B, [DOC.wildcard.path]],
    ['cy@group.example', ROOM_B, [DOC.wildcard.path]],
    [IVY, ROOM_A, ROOM_A_PATHS],
    [IVY, ROOM_C, ROOM_A_PATHS],
    [OTTO, ROOM_A, ROOM_A_PATHS],
  ]);
  assert.equal(body.at, '2026-02-20T23:59:59.999Z');
  // After it, no investor could see anything; counsel can't ask.
  assert.deepEqual(((await (await asOf(db, OWNER, '2026-07-01')).json()) as { investors: unknown[] }).investors, []);
  assert.equal((await asOf(db, COUNSEL, '2026-03-01')).status, 403);
});
