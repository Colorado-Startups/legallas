// SPDX-License-Identifier: Apache-2.0
// GET /api/activity through the real gate on real SQLite: owner only, filters, keyset pagination.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Env } from './env.ts';
import { handle } from './room.ts';
import { testDb } from './sqlite-d1.ts';

const HOST = 'http://localhost:8789';
const OWNER = 'founder@example.test';
const COUNSEL = 'ada@firm.example';

interface Page {
  rows: { ts: string; email: string; action: string; document_id: string | null; document_name: string | null; control_seq: number | null; country: string | null; via?: string | null }[];
  next: string | null;
  people: { email: string; name: string | null }[];
}

function room(vars: Record<string, string> = {}) {
  const { db, sqlite } = testDb();
  sqlite.exec(`
    INSERT INTO members (email, role, name) VALUES ('${OWNER}', 'owner', 'Founder'), ('${COUNSEL}', 'counsel', 'Ada');
    INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at, control_seq) VALUES
      ('d1', 'Folder/one.pdf', 'Folder', 'one.pdf', 'pdf', 'application/pdf', 1, 'k1', 'mirror', '2026-01-01', 412);
    -- Ten audit rows a day apart, alternating people, and three sign-ins, one sharing a timestamp.
    INSERT INTO audit_log (ts, email, action, document_id) VALUES
      ('2026-09-01T10:00:00.000Z', '${OWNER}', 'view', 'd1'),
      ('2026-09-02T10:00:00.000Z', '${COUNSEL}', 'download', 'd1'),
      ('2026-09-03T10:00:00.000Z', '${OWNER}', 'comment', 'd1'),
      ('2026-09-04T10:00:00.000Z', '${COUNSEL}', 'resolve', 'd1'),
      ('2026-09-05T10:00:00.000Z', '${OWNER}', 'reopen', 'd1'),
      ('2026-09-06T10:00:00.000Z', '${COUNSEL}', 'ai_question', NULL),
      ('2026-09-07T10:00:00.000Z', '${OWNER}', 'view', 'd1'),
      ('2026-09-08T10:00:00.000Z', '${COUNSEL}', 'view', 'd1'),
      ('2026-09-11T10:00:00.000Z', '${OWNER}', 'upload', 'd1'),
      ('2026-09-12T10:00:00.000Z', '${COUNSEL}', 'view', 'd1');
    INSERT INTO sign_ins (email, sub, iat, country, created_at) VALUES
      ('${COUNSEL}', 's-ada', 1, 'US', '2026-09-02T09:00:00.000Z'),
      ('${OWNER}', 's-founder', 2, 'US', '2026-09-07T10:00:00.000Z'),
      ('${OWNER}', 's-founder', 3, 'CA', '2026-09-12T23:59:59.999Z');
  `);
  const env = (who: string) =>
    ({
      ASSETS: { fetch: async () => new Response('shell') },
      DB: db,
      TEAM_DOMAIN: '',
      ACCESS_AUD: '',
      ALLOW_DEV_IDENTITY: '1',
      DEV_IDENTITY_EMAIL: who,
      ...vars,
    }) as unknown as Env;
  const get = (path: string, who = OWNER) => handle(new Request(`${HOST}${path}`), env(who), {} as ExecutionContext);
  const post = (path: string, body: unknown, who = OWNER) =>
    handle(
      new Request(`${HOST}${path}`, {
        method: 'POST',
        headers: { Origin: HOST, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env(who),
      {} as ExecutionContext,
    );
  return { get, post, sqlite };
}

test('counsel gets 403 from /api/activity; the owner gets rows, newest first, with document names', async () => {
  const { get } = room();
  const denied = await get('/api/activity', COUNSEL);
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: 'forbidden' });

  const res = await get('/api/activity');
  assert.equal(res.status, 200);
  const page = (await res.json()) as Page;
  assert.equal(page.rows.length, 13);
  assert.equal(page.next, null);
  assert.deepEqual(page.rows.slice(0, 2).map((r) => [r.action, r.country]), [['sign_in', 'CA'], ['view', null]]);
  assert.equal(page.rows[1]!.document_name, 'one.pdf');
  assert.deepEqual(page.rows.slice(0, 2).map((r) => r.control_seq), [null, 412], 'control numbers for documents, none for sign-ins');
  assert.deepEqual(page.people.map((p) => p.email), [COUNSEL, OWNER]);
  const order = page.rows.map((r) => r.ts);
  assert.deepEqual(order, [...order].sort().reverse());
});

test('pages follow the cursor without gaps or repeats, even across equal timestamps', async () => {
  const { get } = room();
  const seen: string[] = [];
  let next: string | null = null;
  const sizes: number[] = [];
  do {
    const page: Page = await (await get(`/api/activity?limit=4${next ? `&before=${next}` : ''}`)).json();
    sizes.push(page.rows.length);
    seen.push(...page.rows.map((r) => `${r.ts} ${r.action} ${r.email}`));
    next = page.next;
  } while (next);
  assert.deepEqual(sizes, [4, 4, 4, 1]);
  assert.equal(new Set(seen).size, 13);
  // 2026-09-07T10:00 has both a view and a sign-in: both appear exactly once.
  assert.equal(seen.filter((s) => s.startsWith('2026-09-07T10:00:00.000Z')).length, 2);
});

test('filters: person, action (sign-ins included) and an inclusive UTC date range', async () => {
  const { get } = room();
  const rows = async (query: string) => ((await (await get(`/api/activity?${query}`)).json()) as Page).rows;

  const ada = await rows(`email=${encodeURIComponent(' ADA@Firm.example ')}`);
  assert.equal(ada.length, 6);
  assert.ok(ada.every((r) => r.email === COUNSEL));

  assert.deepEqual((await rows('action=sign_in')).map((r) => r.country), ['CA', 'US', 'US']);
  assert.equal((await rows('action=view')).length, 4);

  const range = await rows('from=2026-09-11&to=2026-09-12');
  assert.deepEqual(range.map((r) => r.action), ['sign_in', 'view', 'upload'], 'to is inclusive up to 23:59:59.999');

  assert.deepEqual((await rows(`email=${OWNER}&action=sign_in&to=2026-09-08`)).map((r) => r.country), ['US']);
});

test('bad filters are 400 with the field name, never a SQL error', async () => {
  const { get } = room();
  for (const [query, field] of [
    ['email=not-an-email', 'email'],
    ['action=delete', 'action'],
    ['from=2026-02-30', 'from'],
    ['to=yesterday', 'to'],
    ['limit=0', 'limit'],
    ['limit=500', 'limit'],
    ['before=bm90IGEgY3Vyc29y', 'before'],
  ]) {
    const res = await get(`/api/activity?${query}`);
    assert.equal(res.status, 400, query);
    const body = (await res.json()) as { field: string };
    assert.equal(body.field, field === 'before' ? 'cursor' : field, query);
  }
});

test('Key and unkey appear in the feed with the document name, and filter by action', async () => {
  const { get, post } = room();
  assert.equal((await post('/api/documents/d1/key', { key: true }, COUNSEL)).status, 200);
  assert.equal((await post('/api/documents/d1/key', { key: false })).status, 200);
  const rows = async (query: string) => ((await (await get(`/api/activity?${query}`)).json()) as Page).rows;

  const keyed = await rows('action=key');
  assert.deepEqual(keyed.map((r) => [r.email, r.document_id, r.document_name]), [[COUNSEL, 'd1', 'one.pdf']]);
  const unkeyed = await rows('action=unkey');
  assert.deepEqual(unkeyed.map((r) => [r.email, r.document_id, r.document_name]), [[OWNER, 'd1', 'one.pdf']]);
  const latest = await rows('limit=2');
  assert.deepEqual(latest.map((r) => r.action), ['unkey', 'key'], 'newest first, alongside every other action');
});

test('proposals on: proposing, approving and rejecting appear as events, with no text; off, the feed is as before', async () => {
  const steps = `
    INSERT INTO proposals (id, kind, title, why, body, proposed_by, via, client_kind, created_at, expires_at, status, decided_by, decided_at, decision_id, reject_reason) VALUES
      ('p1', 'draft_document', 'Doe advisor amendment', 'Ends in March.', 'SECRET-DRAFT-TEXT', '${COUNSEL}', 'Claude', 'claude', '2026-09-13T10:00:00.000Z', '2026-10-13T10:00:00.000Z', 'approved', '${COUNSEL}', '2026-09-14T10:00:00.000Z', 'd-1', NULL),
      ('p2', 'draft_document', 'Harbor Labs note', 'Not needed.', 'SECRET-DRAFT-TEXT', '${OWNER}', 'Claude', 'claude', '2026-09-13T11:00:00.000Z', '2026-10-13T11:00:00.000Z', 'rejected', '${OWNER}', '2026-09-15T10:00:00.000Z', 'd-2', 'not_needed');
    INSERT INTO proposal_events (ts, proposal_id, action, actor_email, via, detail_code) VALUES
      ('2026-09-13T10:00:00.000Z', 'p1', 'proposed', '${COUNSEL}', 'Claude', 'draft_document'),
      ('2026-09-13T11:00:00.000Z', 'p2', 'proposed', '${OWNER}', 'Claude', 'draft_document'),
      ('2026-09-14T10:00:00.000Z', 'p1', 'approved', '${COUNSEL}', NULL, NULL),
      ('2026-09-14T11:00:00.000Z', 'p1', 'downloaded', '${COUNSEL}', NULL, NULL),
      ('2026-09-15T10:00:00.000Z', 'p2', 'rejected', '${OWNER}', NULL, 'not_needed');`;
  const on = room({ PROPOSALS_ENABLED: '1' });
  on.sqlite.exec(steps);
  const res = await on.get('/api/activity?limit=4');
  const text = await res.text();
  assert.doesNotMatch(text, /SECRET-DRAFT-TEXT|Doe advisor amendment/, 'no proposal text or title');
  const rows = (JSON.parse(text) as Page).rows;
  assert.deepEqual(rows.map((r) => [r.action, r.email, r.via]), [
    ['proposal_rejected', OWNER, null],
    ['proposal_approved', COUNSEL, null],
    ['proposal_proposed', OWNER, 'Claude'],
    ['proposal_proposed', COUNSEL, 'Claude'],
  ]);
  const next = (await (await on.get('/api/activity?limit=4')).json()) as Page;
  const after = (await (await on.get(`/api/activity?limit=4&before=${next.next}`)).json()) as Page;
  assert.equal(after.rows[0]!.action, 'sign_in', 'the cursor carries on past the proposal steps');
  assert.ok(!((await (await on.get('/api/activity?action=sign_in')).json()) as Page).rows.some((r) => r.action.startsWith('proposal_')));

  const off = room();
  off.sqlite.exec(steps);
  const plain = (await (await off.get('/api/activity')).json()) as Page;
  assert.equal(plain.rows.length, 13, 'off: audit rows and sign-ins only');
});
