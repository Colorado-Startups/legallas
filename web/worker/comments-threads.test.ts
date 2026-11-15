// SPDX-License-Identifier: Apache-2.0
// Card F10 (R44): one-level reply threads and page anchors, through the real gate on real SQLite and migrations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Env } from './env.ts';
import { handle } from './room.ts';
import { testDb } from './sqlite-d1.ts';

const HOST = 'http://localhost:8789';
const OWNER = 'founder@example.test';
const COUNSEL = 'ada@firm.example';

interface Row {
  id: string;
  last_activity_at: string;
  reply_count: number;
  document_id: string;
  parent_id: string | null;
  page: number | null;
  body: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolved_by_name: string | null;
}

function room(signedInAs = OWNER) {
  const { db, sqlite } = testDb();
  sqlite.exec(`
    INSERT INTO members (email, role, name) VALUES ('${OWNER}', 'owner', 'Founder'), ('${COUNSEL}', 'counsel', 'Ada');
    INSERT INTO documents (id, path, folder, name, kind, content_type, size, pages, r2_key, source, updated_at) VALUES
      ('d1', 'Folder/DOE-one.pdf', 'Folder', 'DOE-one.pdf', 'pdf', 'application/pdf', 1, 5, 'k1', 'mirror', '2026-01-01'),
      ('d2', 'Folder/notes.md', 'Folder', 'notes.md', 'markdown', 'text/markdown', 1, NULL, 'k2', 'mirror', '2026-01-01');
    INSERT INTO comments (id, document_id, author_email, body, created_at) VALUES
      ('top', 'd1', '${OWNER}', 'Top-level note.', '2026-09-01T10:00:00.000Z'),
      ('other', 'd2', '${OWNER}', 'On another document.', '2026-09-01T10:00:00.000Z');
    INSERT INTO comments (id, document_id, author_email, body, created_at, parent_id) VALUES
      ('reply', 'd1', '${COUNSEL}', 'A reply.', '2026-09-02T10:00:00.000Z', 'top');
  `);
  const env = {
    ASSETS: { fetch: async () => new Response('shell') },
    DB: db,
    TEAM_DOMAIN: '',
    ACCESS_AUD: '',
    ALLOW_DEV_IDENTITY: '1',
    DEV_IDENTITY_EMAIL: signedInAs,
  } as unknown as Env;
  const call = (method: string, path: string, body?: unknown) =>
    handle(
      new Request(`${HOST}${path}`, {
        method,
        headers: {
          ...(method === 'GET' ? {} : { Origin: HOST, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }),
          'User-Agent': 'test-agent',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
      {} as ExecutionContext,
    );
  const thread = async (doc = 'd1') => ((await (await call('GET', `/api/documents/${doc}/comments`)).json()) as { comments: Row[] }).comments;
  const feed = async (query = '') => ((await (await call('GET', `/api/comments${query}`)).json()) as { comments: Row[] }).comments;
  const count = (table: string) => (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  return { sqlite, call, thread, feed, count };
}

test('a reply to a top-level comment is posted with its page, and the thread returns parent_id and page', async () => {
  const { call, thread, sqlite } = room(COUNSEL);
  const res = await call('POST', '/api/documents/d1/comments', { body: 'Agreed, see page 3.', parentId: 'top', page: 3 });
  assert.equal(res.status, 201);
  const { comment } = (await res.json()) as { comment: Row };
  assert.equal(comment.parent_id, 'top');
  assert.equal(comment.page, 3);
  const rows = await thread();
  assert.deepEqual(rows.map((r) => [r.id, r.parent_id, r.page]), [['top', null, null], ['reply', 'top', null], [comment.id, 'top', 3]]);
  const audits = sqlite.prepare('SELECT action, document_id FROM audit_log').all();
  assert.deepEqual(JSON.parse(JSON.stringify(audits)), [{ action: 'comment', document_id: 'd1' }]);
  assert.doesNotMatch(JSON.stringify(sqlite.prepare('SELECT * FROM audit_log').all()), /Agreed/);
});

test('a top-level comment may anchor to a page; null parentId and page mean none', async () => {
  const { call } = room();
  const anchored = await call('POST', '/api/documents/d1/comments', { body: 'Last page.', page: 5 });
  assert.equal(((await anchored.json()) as { comment: Row }).comment.page, 5, 'the last page is allowed');
  const plain = await call('POST', '/api/documents/d1/comments', { body: 'Whole document.', parentId: null, page: null });
  const { comment } = (await plain.json()) as { comment: Row };
  assert.deepEqual([comment.parent_id, comment.page], [null, null]);
  const unknownPages = await call('POST', '/api/documents/d2/comments', { body: 'No page count yet.', page: 999 });
  assert.equal(unknownPages.status, 201, 'any positive page when the page count is unknown');
});

test('parentId must be a top-level comment on the same document', async () => {
  const { call, count } = room();
  for (const parentId of ['missing', 'other', 'reply', '', 7, true, 'x'.repeat(65)]) {
    const res = await call('POST', '/api/documents/d1/comments', { body: 'A reply.', parentId });
    assert.equal(res.status, 400, String(parentId));
    assert.deepEqual(await res.json(), { error: 'invalid_parent' }, String(parentId));
  }
  assert.equal(count('comments'), 3, 'nothing was written');
  assert.equal(count('audit_log'), 0);
});

test('page must be a positive integer, and at most the page count when it is known', async () => {
  const { call, count } = room();
  for (const page of [0, -1, 1.5, '3', 6, Number.MAX_SAFE_INTEGER + 1]) {
    const res = await call('POST', '/api/documents/d1/comments', { body: 'On a page.', page });
    assert.equal(res.status, 400, String(page));
    assert.deepEqual(await res.json(), { error: 'invalid_page' }, String(page));
  }
  assert.equal(count('comments'), 3);
});

test('the database refuses a page below 1 or not an integer', () => {
  const { sqlite } = room();
  const insert = sqlite.prepare("INSERT INTO comments (id, document_id, author_email, body, page) VALUES (?, 'd1', 'x@y.z', 'b', ?)");
  assert.throws(() => insert.run('p0', 0), /CHECK/);
  assert.throws(() => insert.run('ptext', 'two'), /CHECK/);
  assert.throws(() => insert.run('preal', 2.5), /CHECK/);
});

test('resolving the top-level comment covers its replies; replies cannot be resolved alone', async () => {
  const { call, thread, count } = room(COUNSEL);
  const onReply = await call('PATCH', '/api/comments/reply', { resolved: true });
  assert.equal(onReply.status, 400);
  assert.deepEqual(await onReply.json(), { error: 'not_top_level' });
  assert.equal(count('audit_log'), 0);

  assert.equal((await call('PATCH', '/api/comments/top', { resolved: true })).status, 200);
  const [top, reply] = await thread();
  assert.ok(top!.resolved_at);
  assert.deepEqual([reply!.resolved_at, reply!.resolved_by, reply!.resolved_by_name], [top!.resolved_at, COUNSEL, 'Ada']);

  assert.equal((await call('PATCH', '/api/comments/top', { resolved: false })).status, 200);
  assert.deepEqual((await thread()).map((r) => r.resolved_at), [null, null]);
  assert.equal(count('audit_log'), 2, 'one resolve and one reopen');
});

test('the feed carries parent_id and page; open=1 lists open threads by their top-level comment', async () => {
  const { call, feed, sqlite } = room();
  sqlite.exec("UPDATE comments SET page = 2 WHERE id = 'reply'");
  const all = await feed();
  assert.deepEqual(all.map((r) => [r.id, r.parent_id, r.page]), [['reply', 'top', 2], ['other', null, null], ['top', null, null]]);
  assert.deepEqual((await feed('?open=1')).map((r) => r.id), ['top', 'other'], 'replies are not threads; latest activity first');

  await call('PATCH', '/api/comments/top', { resolved: true });
  assert.deepEqual((await feed('?open=1')).map((r) => r.id), ['other']);
  const reply = (await feed()).find((r) => r.id === 'reply')!;
  assert.ok(reply.resolved_at, "a reply's resolved_at is its thread's");
});

test('open=1&since brings back an old thread with a new reply, with last_activity_at and reply_count (R53)', async () => {
  const { sqlite, feed, call } = room();
  sqlite.exec(`
    INSERT INTO comments (id, document_id, author_email, body, created_at, parent_id) VALUES
      ('late', 'd1', '${COUNSEL}', 'A late reply.', '2026-09-10T10:00:00.000Z', 'top');
    INSERT INTO comments (id, document_id, author_email, body, created_at) VALUES
      ('fresh', 'd2', '${OWNER}', 'A new thread.', '2026-09-05T10:00:00.000Z');
  `);
  const open = await feed('?open=1');
  assert.deepEqual(
    open.map((r) => [r.id, r.last_activity_at, r.reply_count]),
    [
      ['top', '2026-09-10T10:00:00.000Z', 2],
      ['fresh', '2026-09-05T10:00:00.000Z', 0],
      ['other', '2026-09-01T10:00:00.000Z', 0],
    ],
    'one row per open thread, by latest activity',
  );
  assert.deepEqual((await feed('?open=1&since=2026-09-04T00:00:00Z')).map((r) => r.id), ['top', 'fresh'], 'the old thread is back');
  assert.deepEqual((await feed('?open=1&since=2026-09-10T10:00:00Z')).map((r) => r.id), [], 'strictly after');
  assert.deepEqual((await feed('?since=2026-09-04T00:00:00Z')).map((r) => r.id), ['late', 'fresh'], 'without open: comments');
  const late = (await feed()).find((r) => r.id === 'late')!;
  assert.deepEqual([late.last_activity_at, late.reply_count], ['2026-09-10T10:00:00.000Z', 2], "a reply carries its thread's");

  await call('PATCH', '/api/comments/top', { resolved: true });
  assert.deepEqual((await feed('?open=1&since=2026-09-04T00:00:00Z')).map((r) => r.id), ['fresh'], 'resolved threads stay out');
  assert.equal((await call('POST', '/api/documents/d1/comments', { body: 'After resolving.', parentId: 'top' })).status, 201);
  assert.deepEqual((await feed('?open=1')).map((r) => r.id), ['fresh', 'other'], 'a reply does not reopen the thread');
});
