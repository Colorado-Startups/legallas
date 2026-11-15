// SPDX-License-Identifier: Apache-2.0
// Card F10: the comments feed (GET /api/comments) through the real gate on real SQLite and migrations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalInstant, excerpt, EXCERPT_LENGTH, FEED_MAX, parseFeedFilter } from './comments.ts';
import type { Env } from './env.ts';
import { handle } from './room.ts';
import { testDb } from './sqlite-d1.ts';

const HOST = 'http://localhost:8789';
const OWNER = 'founder@example.test';
const COUNSEL = 'ada@firm.example';

interface Row {
  id: string;
  document_id: string;
  parent_id: string | null;
  page: number | null;
  document_name: string;
  control_seq: number | null;
  author_name: string;
  created_at: string;
  resolved_at: string | null;
  last_activity_at: string;
  reply_count: number;
  excerpt: string;
}

function room(signedInAs = OWNER) {
  const { db, sqlite } = testDb();
  sqlite.exec(`
    INSERT INTO members (email, role, name) VALUES ('${OWNER}', 'owner', 'Founder'), ('${COUNSEL}', 'counsel', NULL);
    INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at, removed_at) VALUES
      ('d1', 'Folder/DOE-one.pdf', 'Folder', 'DOE-one.pdf', 'pdf', 'application/pdf', 1, 'k1', 'mirror', '2026-01-01', NULL),
      ('d2', 'Folder/gone.pdf', 'Folder', 'gone.pdf', 'pdf', 'application/pdf', 1, 'k2', 'mirror', '2026-01-01', '2026-02-01'),
      ('d3', 'Visuals/legallas-visuals.json', 'Visuals', 'legallas-visuals.json', 'file', 'application/json', 1, 'k3', 'mirror', '2026-01-01', NULL),
      ('d4', 'Folder/Legallas-notes.json', 'Folder', 'Legallas-notes.json', 'file', 'application/json', 1, 'k4', 'mirror', '2026-01-01', NULL);
    INSERT INTO comments (id, document_id, author_email, body, created_at, resolved_at, resolved_by) VALUES
      ('c1', 'd1', '${OWNER}', 'Oldest note.', '2026-09-01T10:00:00.000Z', '2026-09-02T10:00:00.000Z', '${OWNER}'),
      ('c2', 'd1', '${COUNSEL}', 'See   page' || char(10, 10) || '4' || char(9) || 'please.', '2026-09-03T10:00:00.000Z', NULL, NULL),
      ('c3', 'd2', '${OWNER}', 'On a removed file.', '2026-09-04T10:00:00.000Z', NULL, NULL),
      ('c4', 'd3', '${OWNER}', 'On the binder manifest.', '2026-09-05T10:00:00.000Z', NULL, NULL),
      ('c5', 'd4', 'gone@firm.example', 'Upper-case name is a real document.', '2026-09-06T10:00:00.000Z', NULL, NULL);
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
  const feed = async (query = '') => {
    const res = await call('GET', `/api/comments${query}`);
    assert.equal(res.status, 200, query);
    return ((await res.json()) as { comments: Row[] }).comments;
  };
  return { sqlite, call, feed };
}

test('the feed lists comments on live documents, newest first, without removed files or legallas-*.json', async () => {
  const { feed } = room();
  const rows = await feed();
  assert.deepEqual(rows.map((r) => r.id), ['c5', 'c2', 'c1'], 'GLOB is case-sensitive, like the manifest rule');
  assert.deepEqual(rows[1], {
    id: 'c2',
    document_id: 'd1',
    parent_id: null,
    page: null,
    document_name: 'DOE-one.pdf',
    control_seq: null,
    author_name: COUNSEL,
    created_at: '2026-09-03T10:00:00.000Z',
    resolved_at: null,
    last_activity_at: '2026-09-03T10:00:00.000Z',
    reply_count: 0,
    excerpt: 'See page 4 please.',
  });
  assert.equal(rows[2]!.author_name, 'Founder', 'members are shown by name');
  assert.equal(rows[0]!.author_name, 'gone@firm.example', 'a removed member is shown by email');
  assert.equal(rows[2]!.resolved_at, '2026-09-02T10:00:00.000Z');
});

test('open=1 keeps unresolved comments; since keeps those created strictly after it', async () => {
  const { feed } = room();
  assert.deepEqual((await feed('?open=1')).map((r) => r.id), ['c5', 'c2']);
  assert.deepEqual((await feed('?open=0')).map((r) => r.id), ['c5', 'c2', 'c1']);
  assert.deepEqual((await feed('?since=2026-09-03T10:00:00Z')).map((r) => r.id), ['c5'], 'strictly after');
  assert.deepEqual((await feed('?since=2026-09-03T09:59:59.999Z')).map((r) => r.id), ['c5', 'c2']);
  assert.deepEqual((await feed('?since=2026-09-03T05:00:00-05:00')).map((r) => r.id), ['c5'], 'offsets are honored');
  assert.deepEqual((await feed('?since=2026-09-02')).map((r) => r.id), ['c5', 'c2'], 'a bare date is midnight UTC');
  assert.deepEqual((await feed('?open=1&since=2026-08-01T00:00:00Z&limit=1')).map((r) => r.id), ['c5']);
});

test('limit defaults to 50 and stops at 200', async () => {
  const { sqlite, feed } = room();
  const insert = sqlite.prepare("INSERT INTO comments (id, document_id, author_email, body, created_at) VALUES (?, 'd1', ?, 'x', ?)");
  for (let i = 0; i < 250; i++) insert.run(`n${String(i).padStart(3, '0')}`, OWNER, `2026-09-10T00:00:00.${String(i).padStart(3, '0')}Z`);
  const page = await feed();
  assert.equal(page.length, 50);
  assert.equal(page[0]!.id, 'n249');
  assert.equal((await feed(`?limit=${FEED_MAX}`)).length, FEED_MAX);
  assert.equal((await feed('?limit=3')).length, 3);
});

test('comments with the same created_at come newest-inserted first, whatever their ids', async () => {
  const { sqlite, feed } = room();
  sqlite.exec(`
    INSERT INTO comments (id, document_id, author_email, body, created_at) VALUES
      ('t-zzzz', 'd1', '${OWNER}', 'Posted first.', '2026-09-20T10:00:00.000Z'),
      ('t-aaaa', 'd1', '${OWNER}', 'Posted second.', '2026-09-20T10:00:00.000Z');
  `);
  assert.deepEqual((await feed('?limit=2')).map((r) => r.id), ['t-aaaa', 't-zzzz']);
});

test('bad parameters are a 400 naming the parameter', async () => {
  const { call } = room();
  for (const [query, field] of [
    ['?open=yes', 'open'],
    ['?open=2', 'open'],
    ['?since=yesterday', 'since'],
    ['?since=2026-09-03T10:00:00', 'since'],
    ['?since=2026-02-30', 'since'],
    ['?limit=0', 'limit'],
    ['?limit=201', 'limit'],
    ['?limit=1.5', 'limit'],
  ] as const) {
    const res = await call('GET', `/api/comments${query}`);
    assert.equal(res.status, 400, query);
    assert.deepEqual(await res.json(), { error: 'invalid_filter', field }, query);
  }
});

test('control_seq comes from the document, null until sync has numbered it', async () => {
  const { sqlite, feed } = room();
  sqlite.exec("UPDATE documents SET control_seq = 7 WHERE id = 'd1'");
  const rows = await feed();
  assert.equal(rows.find((r) => r.id === 'c2')!.control_seq, 7);
  assert.equal(rows.find((r) => r.id === 'c5')!.control_seq, null, 'not yet numbered');
});

test('counsel may read the feed, and reading it writes nothing to the audit log', async () => {
  const { sqlite, call } = room(COUNSEL);
  const res = await call('GET', '/api/comments');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Type') ?? '', /^application\/json/);
  assert.equal((sqlite.prepare('SELECT count(*) AS n FROM audit_log').get() as { n: number }).n, 0);
});

test('a comment posted in the room leads the feed; its audit row never holds the body', async () => {
  const { sqlite, call, feed } = room();
  const body = `Long privileged note ${'word '.repeat(60)}`;
  assert.equal((await call('POST', '/api/documents/d1/comments', { body })).status, 201);
  const [first] = await feed('?open=1');
  assert.equal(first!.document_id, 'd1');
  assert.equal(first!.author_name, 'Founder');
  assert.equal(first!.excerpt, body.trim().slice(0, EXCERPT_LENGTH));
  assert.doesNotMatch(JSON.stringify(sqlite.prepare('SELECT * FROM audit_log').all()), /privileged note/);
});

test('excerpt collapses whitespace and keeps whole characters up to the limit', () => {
  assert.equal(excerpt('  a \n\n b\t c  '), 'a b c');
  assert.equal(excerpt('x'.repeat(500)), 'x'.repeat(EXCERPT_LENGTH));
  const scrolls = excerpt('\u{1F4DC}'.repeat(200));
  assert.equal([...scrolls].length, EXCERPT_LENGTH);
  assert.doesNotMatch(scrolls, /\p{Cs}/u, 'no half surrogate pair');
});

test('canonicalInstant and parseFeedFilter', () => {
  assert.equal(canonicalInstant('2026-09-03T10:00Z'), '2026-09-03T10:00:00.000Z');
  assert.equal(canonicalInstant('2026-09-03T12:00:00.5+02:00'), '2026-09-03T10:00:00.500Z');
  assert.equal(canonicalInstant('2026-13-01'), null);
  assert.deepEqual(parseFeedFilter(new URLSearchParams('')), { open: false, since: null, limit: 50 });
  assert.deepEqual(parseFeedFilter(new URLSearchParams('open=1&since=2026-09-01&limit=10')), {
    open: true,
    since: '2026-09-01T00:00:00.000Z',
    limit: 10,
  });
});
