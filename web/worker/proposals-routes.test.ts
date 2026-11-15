// SPDX-License-Identifier: Apache-2.0
// The proposals routes (worker/routes/proposals.ts) through the real gate (room.ts) on real SQLite: off by default and
// then indistinguishable from paths that do not exist, and with the setting on, decisions only as same-origin writes by
// the member whose AI made the proposal. The fixture is invented (Doe v. Harbor Labs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Env, Member } from './env.ts';
import { createDraftProposal } from './proposals.ts';
import { handle } from './room.ts';
import { testDb } from './sqlite-d1.ts';
import { readWranglerConfig } from './wrangler-config.ts';

const HOST = 'http://localhost:8789';
const OWNER = 'founder@example.test';
const COUNSEL = 'ada@firm.example';
const COUNSEL_MEMBER: Member = { email: COUNSEL, role: 'counsel', name: null };

/** `enabled` is PROPOSALS_ENABLED, or null to leave it unset. */
function room(signedInAs = OWNER, enabled: string | null = '1') {
  const { db, sqlite } = testDb();
  sqlite.exec(`
    INSERT INTO members (email, role, name) VALUES ('${OWNER}', 'owner', 'Founder'), ('${COUNSEL}', 'counsel', NULL);
    INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at, removed_at) VALUES
      ('doe-1', 'Agreements/Doe advisor agreement.pdf', 'Agreements', 'Doe advisor agreement.pdf', 'pdf', 'application/pdf', 1, 'k1', 'mirror', '2026-03-01T00:00:00.000Z', NULL);
  `);
  const objects = new Map<string, Uint8Array>();
  const FILES = {
    put: async (key: string, value: Uint8Array) => void objects.set(key, value),
    delete: async (key: string) => void objects.delete(key),
  };
  const env = {
    ASSETS: { fetch: async () => new Response('shell') },
    DB: db,
    FILES,
    TEAM_DOMAIN: '',
    ACCESS_AUD: '',
    ALLOW_DEV_IDENTITY: '1',
    DEV_IDENTITY_EMAIL: signedInAs,
    ...(enabled === null ? {} : { PROPOSALS_ENABLED: enabled }),
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
  const propose = async (title = 'Advisor agreement amendment') => {
    const result = await createDraftProposal(
      db,
      { member: COUNSEL_MEMBER, via: 'Claude', clientKind: 'claude' },
      { title, why: 'The term ends in March.', body: '<script>alert(1)</script> Extend the term.', sources: [{ documentId: 'doe-1', page: null }] },
      new Date(),
    );
    assert.ok(result.ok);
    return result.id;
  };
  const status = (id: string) => (sqlite.prepare('SELECT status FROM proposals WHERE id = ?').get(id) as { status: string }).status;
  return { env, sqlite, call, propose, status, objects };
}

async function snapshot(response: Response) {
  return { status: response.status, body: await response.text(), type: response.headers.get('Content-Type'), allow: response.headers.get('Allow') };
}

test('off by default: every proposals path answers exactly like a path that does not exist, and /api/me is unchanged', async () => {
  for (const enabled of [null, '0', 'true']) {
    const { call } = room(OWNER, enabled);
    const paths: [string, string][] = [
      ['GET', '/api/proposals'],
      ['GET', '/api/proposals/abc'],
      ['GET', '/api/proposals/abc/draft'],
      ['GET', '/api/proposals/abc/visual'],
      ['POST', '/api/proposals/abc/approve'],
      ['POST', '/api/proposals/abc/reject'],
      ['DELETE', '/api/proposals/abc'],
    ];
    for (const [method, path] of paths) {
      const got = await snapshot(await call(method, path, method === 'POST' ? {} : undefined));
      const unknown = await snapshot(await call(method, path.replace('proposals', 'no-such-thing'), method === 'POST' ? {} : undefined));
      assert.deepEqual(got, unknown, `${enabled} ${method} ${path}`);
      assert.equal(got.status, 404, `${method} ${path}`);
    }
    assert.deepEqual(await (await call('GET', '/api/me')).json(), {
      email: OWNER,
      role: 'owner',
      name: 'Founder',
      can: { readComments: true, comment: true, upload: true, flag: true, connect: true, viewActivity: true },
    });
  }
});

test('on: /api/me offers the Proposals page to owner and counsel, both of whom decide their own AI\'s proposals', async () => {
  for (const who of [OWNER, COUNSEL]) {
    const me = (await (await room(who).call('GET', '/api/me')).json()) as Record<string, unknown>;
    assert.deepEqual(me.proposals, { approve: true }, who);
  }
});

test('the member lists and reads their AI\'s proposal, with its sources, what approving changes, and the text as plain JSON', async () => {
  const { call, propose } = room(COUNSEL);
  const id = await propose();
  const list = (await (await call('GET', '/api/proposals')).json()) as { proposals: { id: string; status: string; via: string }[]; can: { approve: boolean } };
  assert.deepEqual(list.proposals.map((p) => [p.id, p.status, p.via]), [[id, 'pending', 'Claude']]);
  assert.equal(list.can.approve, true);
  assert.equal((await call('GET', '/api/proposals?view=bogus')).status, 400);

  const res = await call('GET', `/api/proposals/${id}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Type') ?? '', /application\/json/);
  assert.match(res.headers.get('Content-Security-Policy') ?? '', /default-src 'none'/);
  const { proposal } = (await res.json()) as { proposal: { body: string; changes: string[]; source_list: { name: string }[]; events: { action: string }[] } };
  assert.equal(proposal.body, '<script>alert(1)</script> Extend the term.', 'stored and returned as text; the page shows it with textContent');
  assert.equal(proposal.source_list[0]?.name, 'Doe advisor agreement.pdf');
  assert.ok(proposal.changes.some((line) => /Changes no document, person, access, setting or AI connection/.test(line)));
  assert.deepEqual(proposal.events.map((e) => e.action), ['proposed']);
  assert.equal((await call('GET', '/api/proposals/no-such-id')).status, 404);
  assert.equal((await call('GET', '/api/proposals/bad%20id')).status, 404);
});

test('abuse: a write from another site never reaches the decision, and the proposal stays pending', async () => {
  const { call, propose, status, sqlite } = room(COUNSEL);
  const id = await propose();
  for (const headers of [
    { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
    { Origin: 'https://other.room.example.com', 'Sec-Fetch-Site': 'same-site' },
    { Origin: HOST, 'Sec-Fetch-Site': 'cross-site' },
    { Origin: '', 'Sec-Fetch-Site': 'same-origin' },
  ]) {
    const res = await call('POST', `/api/proposals/${id}/approve`, {}, headers);
    assert.equal(res.status, 403, JSON.stringify(headers));
  }
  assert.equal(status(id), 'pending');
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM proposal_events').get() as { n: number }).n, 1);
});

test('abuse: the owner sees counsel\'s AI proposals but cannot approve or reject them, and nothing is written', async () => {
  const { call, propose, status, sqlite } = room(OWNER);
  const id = await propose();
  const read = await call('GET', `/api/proposals/${id}`);
  assert.equal(read.status, 200);
  assert.equal(((await read.json()) as { can: { approve: boolean } }).can.approve, false, 'no decision controls');
  assert.deepEqual(((await (await call('GET', '/api/proposals?view=all')).json()) as { proposals: { id: string }[] }).proposals.map((p) => p.id), [id]);
  for (const res of [await call('POST', `/api/proposals/${id}/approve`, {}), await call('POST', `/api/proposals/${id}/approve`, { body: 'Owner text.' })]) {
    assert.deepEqual({ status: res.status, body: await res.json() }, { status: 403, body: { error: 'not_yours' } });
  }
  assert.equal((await call('POST', `/api/proposals/${id}/reject`, { reason: 'other' })).status, 403);
  assert.equal((await call('GET', `/api/proposals/${id}/draft`)).status, 404, 'a pending draft does not download');
  assert.equal(status(id), 'pending');
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM proposal_events').get() as { n: number }).n, 1, 'only the proposed event');
});

test('counsel decides their own AI\'s proposal: can.approve is true for them', async () => {
  const { call, propose } = room(COUNSEL);
  const id = await propose();
  assert.equal(((await (await call('GET', `/api/proposals/${id}`)).json()) as { can: { approve: boolean } }).can.approve, true);
});

test('the member approves with edits, then the draft downloads as a Markdown attachment', async () => {
  const { call, propose, status } = room(COUNSEL);
  const id = await propose();
  assert.equal((await call('POST', `/api/proposals/${id}/approve`, 'not json')).status, 400);
  assert.equal((await call('POST', `/api/proposals/${id}/approve`, {}, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await call('POST', `/api/proposals/${id}/approve`, [])).status, 400);
  assert.equal((await call('POST', `/api/proposals/${id}/approve`, { title: '' })).status, 400);
  assert.equal((await call('POST', `/api/proposals/${id}/approve`, { body: 'x'.repeat(60_001) })).status, 400);
  assert.equal(status(id), 'pending');

  const res = await call('POST', `/api/proposals/${id}/approve`, { title: 'Amendment No. 1', body: 'Edited by counsel.' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'approved', edited: true });
  assert.equal((await call('POST', `/api/proposals/${id}/approve`, {})).status, 409, 'a second decision is refused');
  assert.equal((await call('POST', `/api/proposals/${id}/reject`, { reason: 'other' })).status, 409);

  assert.equal((await call('GET', `/api/proposals/${id}/draft`, undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403, 'no download from another site');
  const file = await call('GET', `/api/proposals/${id}/draft`, undefined, { 'Sec-Fetch-Site': 'same-origin' });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('Content-Type'), 'text/markdown; charset=utf-8');
  assert.equal(file.headers.get('Content-Disposition'), `attachment; filename="draft-${id.slice(0, 8)}.md"`);
  assert.equal(file.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(await file.text(), /\n# Amendment No\. 1\n\nEdited by counsel\.\n$/);
});

test('counsel\'s approved draft lands under From counsel as a document Ask never indexes (card 6.2)', async () => {
  const { call, propose, sqlite, objects } = room(COUNSEL);
  const id = await propose();
  assert.equal((await call('POST', `/api/proposals/${id}/approve`, { title: 'Amendment No. 1' })).status, 200);
  const docs = sqlite.prepare("SELECT name, kind, source, uploaded_by, r2_key FROM documents WHERE source = 'counsel'").all() as { name: string; kind: string; source: string; uploaded_by: string; r2_key: string }[];
  assert.deepEqual(docs.map(({ name, kind, uploaded_by }) => [name, kind, uploaded_by]), [['Amendment No. 1 (draft).md', 'markdown', COUNSEL]]);
  assert.match(new TextDecoder().decode(objects.get(docs[0]!.r2_key)), /^> Draft proposed through Claude[\s\S]*\n# Amendment No\. 1\n/);
});

test('the member rejects with a reason code only; a pending draft does not download', async () => {
  const { call, propose, status } = room(COUNSEL);
  const id = await propose();
  assert.equal((await call('GET', `/api/proposals/${id}/draft`)).status, 404);
  assert.equal((await call('POST', `/api/proposals/${id}/reject`, { reason: 'I just do not like it' })).status, 400);
  assert.equal((await call('POST', `/api/proposals/${id}/reject`, { reason: 'constructor' })).status, 400);
  const res = await call('POST', `/api/proposals/${id}/reject`, { reason: 'incorrect' });
  assert.deepEqual(await res.json(), { status: 'rejected', edited: false });
  assert.equal(status(id), 'rejected');
  assert.equal((await call('GET', `/api/proposals/${id}/draft`)).status, 404);
  const decided = (await (await call('GET', '/api/proposals?view=decided')).json()) as { proposals: { status: string }[] };
  assert.deepEqual(decided.proposals.map((p) => p.status), ['rejected']);
});

test('a visual: previewed and served only in a frame under the visual CSP, approved into the binder with its cites', async () => {
  const { call, env, sqlite, objects } = room(COUNSEL);
  sqlite.exec("UPDATE documents SET control_seq = 412 WHERE id = 'doe-1'");
  Object.assign(env, { CONTROL_PREFIX: 'DOE' });
  const made = await createDraftProposal(
    env.DB,
    { member: COUNSEL_MEMBER, via: 'Claude', clientKind: 'claude' },
    {
      title: 'Chronology',
      why: 'Built with the chronology kit.',
      body: `<body><a href="${HOST}/doc/?id=doe-1#page=2">DOE-000412 at 2</a><a href="https://example.org/">web</a></body>`,
      sources: [{ documentId: 'doe-1', page: 2 }],
      visual: { privileged: true },
    },
    new Date(),
  );
  assert.ok(made.ok);
  const { id } = made;
  const frame = { 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Site': 'same-origin' };

  const refused: Record<string, string>[] = [{}, { 'Sec-Fetch-Dest': 'document' }, { ...frame, 'Sec-Fetch-Site': 'cross-site' }];
  for (const headers of refused) {
    assert.equal((await call('GET', `/api/proposals/${id}/visual`, undefined, headers)).status, 404, JSON.stringify(headers));
  }
  const preview = await call('GET', `/api/proposals/${id}/visual`, undefined, frame);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.match(preview.headers.get('Content-Security-Policy') ?? '', /^sandbox allow-scripts; default-src 'none'/);
  assert.match(await preview.text(), /href="#legallas-cite=DOE-000412@2"/);
  const { proposal } = (await (await call('GET', `/api/proposals/${id}`)).json()) as { proposal: { visual: boolean; privileged: boolean; preview: string } };
  assert.deepEqual([proposal.visual, proposal.privileged, proposal.preview], [true, true, `/api/proposals/${id}/visual`]);

  assert.deepEqual(await (await call('POST', `/api/proposals/${id}/approve`, {})).json(), { status: 'approved', edited: false });
  const stored = (sqlite.prepare('SELECT page FROM proposal_visuals WHERE proposal_id = ?').get(id) as { page: string }).page;
  assert.match(stored, /href="#legallas-cite=DOE-000412@2"/);
  assert.match(stored, /href="#legallas-out=https%3A%2F%2Fexample\.org%2F"/);
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM documents').get() as { n: number }).n, 1, "counsel's visual never lands under From counsel");
  assert.equal(objects.size, 0);

  // The binder serves it to every member it shows it to: here the owner, whose AI did not make it.
  Object.assign(env, { DEV_IDENTITY_EMAIL: OWNER });
  const landed = await call('GET', `/api/proposals/${id}/visual`, undefined, frame);
  assert.equal(landed.status, 200);
  assert.equal(await landed.text(), stored);
});

test('both examples ship with proposals off, so a new room starts without them', () => {
  for (const base of ['wrangler', 'wrangler.mcp'] as const) {
    assert.equal(readWranglerConfig(base, true).config.vars.PROPOSALS_ENABLED, '0', base);
  }
});
