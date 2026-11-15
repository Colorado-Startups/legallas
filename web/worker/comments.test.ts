// SPDX-License-Identifier: Apache-2.0
// Comment threads through the real gate (room.ts) on real SQLite with the real migrations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_COMMENT, parseCommentBody } from './comments.ts';
import type { Env, RequestContext, Role } from './env.ts';
import { handle } from './room.ts';
import { routes } from './routes/comments.ts';
import { testDb } from './sqlite-d1.ts';

const HOST = 'http://localhost:8789';
const OWNER = 'founder@example.test';
const COUNSEL = 'ada@firm.example';

function room(signedInAs = OWNER) {
  const { db, sqlite } = testDb();
  sqlite.exec(`
    INSERT INTO members (email, role, name) VALUES ('${OWNER}', 'owner', 'Founder'), ('${COUNSEL}', 'counsel', NULL);
    INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at, removed_at) VALUES
      ('d1', 'Folder/one.pdf', 'Folder', 'one.pdf', 'pdf', 'application/pdf', 1, 'k1', 'mirror', '2026-01-01', NULL),
      ('d2', 'Folder/gone.pdf', 'Folder', 'gone.pdf', 'pdf', 'application/pdf', 1, 'k2', 'mirror', '2026-01-01', '2026-02-01');
  `);
  const env = {
    ASSETS: { fetch: async () => new Response('shell') },
    DB: db,
    TEAM_DOMAIN: '',
    ACCESS_AUD: '',
    ALLOW_DEV_IDENTITY: '1',
    DEV_IDENTITY_EMAIL: signedInAs,
  } as unknown as Env;
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    handle(
      new Request(`${HOST}${path}`, {
        method,
        headers: {
          ...(method === 'GET' ? {} : { Origin: HOST, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }),
          'User-Agent': 'test-agent',
          ...headers,
        },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      }),
      env,
      {} as ExecutionContext,
    );
  return { env, sqlite, call };
}

type Thread = { comments: { id: string; body: string; author_name: string | null; resolved_by: string | null; resolved_at: string | null }[] };

test('a member posts a comment and reads the thread back, oldest first, with author names', async () => {
  const { call } = room();
  const first = await call('POST', '/api/documents/d1/comments', { body: '  First note.\r\nSecond line.  ' });
  assert.equal(first.status, 201);
  const created = ((await first.json()) as { comment: { body: string; author_email: string } }).comment;
  assert.equal(created.body, 'First note.\nSecond line.', 'outer whitespace trimmed, line endings normalized');
  assert.equal(created.author_email, OWNER);
  await call('POST', '/api/documents/d1/comments', { body: 'A reply.' });

  const res = await call('GET', '/api/documents/d1/comments');
  assert.equal(res.status, 200);
  const thread = (await res.json()) as Thread & { can: Record<string, boolean> };
  assert.deepEqual(thread.comments.map((c) => c.body), ['First note.\nSecond line.', 'A reply.']);
  assert.equal(thread.comments[0]!.author_name, 'Founder');
  assert.deepEqual(thread.can, { comment: true, resolve: true });
});

test('comments posted in the same millisecond keep the order they were posted in', async () => {
  const { call, sqlite } = room();
  // Ids sort opposite to insertion order, so a tiebreak on the (random UUID) id would flip them.
  sqlite.exec(`
    INSERT INTO comments (id, document_id, author_email, body, created_at) VALUES
      ('zzzz', 'd1', '${OWNER}', 'Posted first.', '2026-09-01T10:00:00.000Z'),
      ('aaaa', 'd1', '${OWNER}', 'Posted second.', '2026-09-01T10:00:00.000Z');
  `);
  const thread = (await (await call('GET', '/api/documents/d1/comments')).json()) as Thread;
  assert.deepEqual(thread.comments.map((c) => c.body), ['Posted first.', 'Posted second.']);
});

test('the comment audit row names who, what and which document, never the text', async () => {
  const { call, sqlite } = room(COUNSEL);
  await call('POST', '/api/documents/d1/comments', { body: 'Privileged thought about the case.' });
  const rows = sqlite.prepare('SELECT * FROM audit_log').all() as Record<string, unknown>[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.email, COUNSEL);
  assert.equal(rows[0]!.action, 'comment');
  assert.equal(rows[0]!.document_id, 'd1');
  assert.equal(rows[0]!.user_agent, 'test-agent');
  assert.doesNotMatch(JSON.stringify(rows), /Privileged thought/);
});

test('body limits: 1 to 10000 characters, counted as characters, plain strings only', async () => {
  const { call } = room();
  const post = (body: unknown) => call('POST', '/api/documents/d1/comments', { body });
  const error = async (res: Response) => ((await res.json()) as { error: string }).error;

  assert.equal(await error(await post('')), 'empty_comment');
  assert.equal(await error(await post(' \n\t ')), 'empty_comment');
  assert.equal(await error(await post(42)), 'invalid_comment');
  assert.equal(await error(await post(['x'])), 'invalid_comment');
  assert.equal(await error(await post('bell \u0007')), 'invalid_comment');
  assert.equal(await error(await post('lone \ud800 surrogate')), 'invalid_comment');

  // Astral characters are two UTF-16 units each; the limit counts characters, like SQLite's length().
  assert.equal((await post('\u{1F4DC}'.repeat(MAX_COMMENT))).status, 201);
  assert.equal(await error(await post('x'.repeat(MAX_COMMENT + 1))), 'comment_too_long');
  assert.equal((await post('x'.repeat(MAX_COMMENT))).status, 201);

  assert.equal((await call('POST', '/api/documents/d1/comments', '{"body": "x"')).status, 400, 'bad JSON');
  assert.equal((await call('POST', '/api/documents/d1/comments', `{"body":"${'y'.repeat(70_000)}"}`)).status, 413);
  const form = await call('POST', '/api/documents/d1/comments', 'body=x', { 'Content-Type': 'application/x-www-form-urlencoded' });
  assert.equal(form.status, 415, 'only JSON, so a plain HTML form cannot post');
});

test('parseCommentBody keeps tabs and newlines and NFC-normalizes', () => {
  assert.deepEqual(parseCommentBody('a\tb\nc'), { ok: true, body: 'a\tb\nc' });
  assert.deepEqual(parseCommentBody('Café'), { ok: true, body: 'Café' });
});

test('markup is stored and returned as inert text in a JSON response', async () => {
  const { call } = room();
  const hostile = '<script>alert(1)</script><img src=x onerror=alert(2)> **bold** [link](https://evil.example)';
  await call('POST', '/api/documents/d1/comments', { body: hostile });
  const res = await call('GET', '/api/documents/d1/comments');
  assert.match(res.headers.get('Content-Type') ?? '', /^application\/json/);
  assert.match(res.headers.get('Content-Security-Policy') ?? '', /default-src 'none'/);
  assert.equal(((await res.json()) as Thread).comments[0]!.body, hostile, 'verbatim: no Markdown, no HTML, no rewriting');
});

test('the comment panel script renders text with textContent only, never as HTML', () => {
  const source = readFileSync(join(import.meta.dirname, '..', 'src', 'scripts', 'comments.ts'), 'utf8');
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|DOMParser/);
  assert.match(source, /textContent/);
});

test('counsel can resolve and reopen any comment; repeats change nothing and are audited once', async () => {
  const owner = room();
  const { comment } = (await (await owner.call('POST', '/api/documents/d1/comments', { body: 'Check page 4.' })).json()) as {
    comment: { id: string };
  };
  const env = { ...owner.env, DEV_IDENTITY_EMAIL: COUNSEL } as Env;
  const asCounsel = (method: string, path: string, body?: unknown) =>
    handle(
      new Request(`${HOST}${path}`, {
        method,
        headers: { Origin: HOST, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env,
      {} as ExecutionContext,
    );

  const resolved = (await (await asCounsel('PATCH', `/api/comments/${comment.id}`, { resolved: true })).json()) as {
    comment: Thread['comments'][0];
  };
  assert.equal(resolved.comment.resolved_by, COUNSEL);
  assert.ok(resolved.comment.resolved_at);
  await asCounsel('PATCH', `/api/comments/${comment.id}`, { resolved: true });

  const reopened = (await (await asCounsel('PATCH', `/api/comments/${comment.id}`, { resolved: false })).json()) as {
    comment: Thread['comments'][0];
  };
  assert.equal(reopened.comment.resolved_at, null);
  assert.equal(reopened.comment.resolved_by, null);

  const actions = owner.sqlite.prepare('SELECT action, email, document_id FROM audit_log ORDER BY id').all();
  assert.deepEqual(
    actions.map((r) => ({ ...r })),
    [
      { action: 'comment', email: OWNER, document_id: 'd1' },
      { action: 'resolve', email: COUNSEL, document_id: 'd1' },
      { action: 'reopen', email: COUNSEL, document_id: 'd1' },
    ],
  );
  assert.equal((await asCounsel('PATCH', `/api/comments/${comment.id}`, { resolved: 'yes' })).status, 400);
});

test('unknown and removed documents and comments are 404, and nothing is written', async () => {
  const { call, sqlite } = room();
  assert.equal((await call('GET', '/api/documents/nope/comments')).status, 404);
  assert.equal((await call('GET', '/api/documents/d2/comments')).status, 404, 'removed files hide their thread');
  assert.equal((await call('POST', '/api/documents/d2/comments', { body: 'x' })).status, 404);
  assert.equal((await call('PATCH', '/api/comments/nope', { resolved: true })).status, 404);

  sqlite.exec("INSERT INTO comments (id, document_id, author_email, body) VALUES ('old', 'd2', 'founder@example.test', 'x')");
  assert.equal((await call('PATCH', '/api/comments/old', { resolved: true })).status, 404);
  assert.equal((sqlite.prepare('SELECT count(*) AS n FROM audit_log').get() as { n: number }).n, 0);
});

test('a cross-site write never reaches the comment routes', async () => {
  const { call, sqlite } = room();
  const res = await call('POST', '/api/documents/d1/comments', { body: 'x' }, { Origin: 'https://example.com', 'Sec-Fetch-Site': 'same-site' });
  assert.equal(res.status, 403);
  assert.equal((sqlite.prepare('SELECT count(*) AS n FROM comments').get() as { n: number }).n, 0);
});

test('every route asks canPerform and fails closed for a role the matrix does not know', async () => {
  const { env } = room();
  for (const route of routes) {
    const path = route.path.replace(':id', 'd1');
    const context: RequestContext = {
      request: new Request(`${HOST}${path}`, { method: route.method, headers: { 'Content-Type': 'application/json' }, body: route.method === 'GET' ? undefined : '{"body":"x","resolved":true}' }),
      env,
      ctx: {} as ExecutionContext,
      url: new URL(`${HOST}${path}`),
      member: { email: OWNER, role: 'observer' as Role, name: null },
      params: { id: 'd1' },
    };
    const res = await route.handler(context);
    assert.equal(res.status, 403, `${route.method} ${route.path}`);
  }
});
