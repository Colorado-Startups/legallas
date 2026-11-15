// SPDX-License-Identifier: Apache-2.0
// Plan D14: every comment query keeps privilegeFilter for the caller's role. No role lacks viewPrivileged since the
// read-only family role was retired, and the gate refuses that role before any query runs, so these tests call the
// queries directly as it to prove the second wall holds on its own, then check through the real gate that owner and
// counsel still see every thread.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findComment, findLiveDocument, listFeed, listThread, liveDocument, parseFeedFilter } from './comments.ts';
import type { Env, Role } from './env.ts';
import { handle } from './room.ts';
import { addLeftoverFamily } from './gate-fixtures.ts';
import { testDb } from './sqlite-d1.ts';

const HOST = 'http://localhost:8789';
const OWNER = 'founder@example.test';
const COUNSEL = 'ada@firm.example';
const FAMILY = 'kin@mail.example';
const RETIRED = 'family' as Role;

function room(signedInAs = COUNSEL) {
  const { db, sqlite } = testDb();
  sqlite.exec(`
    INSERT INTO members (email, role, name) VALUES ('${OWNER}', 'owner', 'Founder'), ('${COUNSEL}', 'counsel', 'Ada');
    INSERT INTO documents (id, path, folder, name, kind, content_type, size, pages, r2_key, source, updated_at) VALUES
      ('open', '08-Court-Papers/DOE-complaint.pdf', '08-Court-Papers', 'DOE-complaint.pdf', 'pdf', 'application/pdf', 1, 4, 'k1', 'mirror', '2026-01-01'),
      ('med', '07-Lawyer-Notes-PRIVILEGED/Strategy.pdf', '07-Lawyer-Notes-PRIVILEGED', 'Strategy.pdf', 'pdf', 'application/pdf', 1, 4, 'k2', 'mirror', '2026-01-01'),
      ('memo', '03-Kitchen-Records/memo-Privileged.pdf', '03-Kitchen-Records', 'memo-Privileged.pdf', 'pdf', 'application/pdf', 1, 4, 'k3', 'mirror', '2026-01-01');
    INSERT INTO comments (id, document_id, author_email, body, created_at) VALUES
      ('c-open', 'open', '${OWNER}', 'Note on the complaint.', '2026-09-01T10:00:00.000Z'),
      ('c-med', 'med', '${COUNSEL}', 'Privileged note.', '2026-09-02T10:00:00.000Z'),
      ('c-memo', 'memo', '${OWNER}', 'Privileged file name.', '2026-09-03T10:00:00.000Z');
    INSERT INTO comments (id, document_id, author_email, body, created_at, parent_id) VALUES
      ('r-med', 'med', '${OWNER}', 'Privileged reply.', '2026-09-04T10:00:00.000Z', 'c-med');
  `);
  addLeftoverFamily(sqlite, FAMILY, 'Kin'); // a row from before migration 0010
  const env = {
    ASSETS: { fetch: async () => new Response('shell') },
    DB: db,
    TEAM_DOMAIN: '',
    ACCESS_AUD: '',
    ALLOW_DEV_IDENTITY: '1',
    DEV_IDENTITY_EMAIL: signedInAs,
  } as unknown as Env;
  const get = async (path: string) => {
    const res = await handle(new Request(`${HOST}${path}`, { headers: { 'User-Agent': 'test-agent' } }), env, {} as ExecutionContext);
    const json = res.headers.get('Content-Type')?.includes('application/json');
    return { status: res.status, body: (json ? await res.json() : { comments: [] }) as { comments: { id: string }[] } };
  };
  return { db, get };
}

const PRIVILEGED_DOCS = ['med', 'memo'];
const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

test('a role that may not see privileged documents, such as the retired family role, gets no thread, comment or page count for one', async () => {
  const { db } = room();
  for (const doc of PRIVILEGED_DOCS) {
    assert.deepEqual(await listThread(db, doc, RETIRED), [], doc);
    assert.equal(await liveDocument(db, doc, RETIRED), false, doc);
    assert.equal(await findLiveDocument(db, doc, RETIRED), null, doc);
  }
  for (const id of ['c-med', 'r-med', 'c-memo']) assert.equal(await findComment(db, id, RETIRED), null, id);
  // The rule only narrows: the open document's thread is the same for every role.
  assert.deepEqual(ids(await listThread(db, 'open', RETIRED)), ['c-open']);
  assert.equal((await findComment(db, 'c-open', RETIRED))?.body, 'Note on the complaint.');
  assert.deepEqual(await findLiveDocument(db, 'open', RETIRED), { pages: 4 });
});

test('any other unknown role is treated the same: privileged threads stay hidden', async () => {
  const { db } = room();
  assert.deepEqual(await listThread(db, 'med', 'intruder' as Role), []);
  assert.equal(await findComment(db, 'c-med', 'intruder' as Role), null);
});

test('owner and counsel see every thread, replies included, exactly as before', async () => {
  const { db } = room();
  for (const role of ['owner', 'counsel'] as const) {
    assert.deepEqual((await listThread(db, 'med', role)).map((c) => [c.id, c.parent_id]), [['c-med', null], ['r-med', 'c-med']], role);
    assert.equal((await findComment(db, 'r-med', role))?.resolved_at, null, role);
    assert.equal(await liveDocument(db, 'memo', role), true, role);
  }
});

test('the comments feed leaves out privileged documents for a role that may not see them, the retired one included', async () => {
  const { db } = room();
  const all = parseFeedFilter(new URLSearchParams());
  const open = parseFeedFilter(new URLSearchParams('open=1'));
  assert.deepEqual(ids(await listFeed(db, all, RETIRED)), ['c-open']);
  assert.deepEqual(ids(await listFeed(db, open, RETIRED)), ['c-open']);
  assert.deepEqual(ids(await listFeed(db, all, 'counsel')), ['c-med', 'c-memo', 'c-open', 'r-med']);
  assert.deepEqual(ids(await listFeed(db, open, 'owner')), ['c-med', 'c-memo', 'c-open']);
});

test('through the gate: counsel read privileged threads and the feed; a leftover family row is refused at the gate', async () => {
  const counsel = room(COUNSEL);
  const thread = await counsel.get('/api/documents/med/comments');
  assert.equal(thread.status, 200);
  assert.deepEqual(ids(thread.body.comments), ['c-med', 'r-med']);
  assert.deepEqual(ids((await counsel.get('/api/comments')).body.comments), ['c-med', 'c-memo', 'c-open', 'r-med']);
  assert.equal((await counsel.get('/api/documents/nope/comments')).status, 404);
  const family = room(FAMILY);
  for (const path of ['/api/documents/med/comments', '/api/documents/open/comments', '/api/comments']) {
    assert.equal((await family.get(path)).status, 403, path);
  }
});
