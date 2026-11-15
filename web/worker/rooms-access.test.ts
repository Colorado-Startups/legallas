// SPDX-License-Identifier: Apache-2.0
// Deal rooms, end to end through the gate (index.ts, so pro's routes are registered too) on real SQLite: every way
// someone could reach a room they were not invited to, see what the room does not show, or keep access after removal.
// Each test names its row in docs/design/rooms-and-grants.md ("Ways in, and the test for each"). The AI connector's
// rows are in mcp/rooms-ai.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetDocFactsCache } from './doc-facts-serve.ts';
import { handle } from './index.ts';
import { roomRoutes } from './room.ts';
import { BEA, COUNSEL, DOC, HOST, invite, IVY, NO_ROOM, OTTO, OWNER, ROOM_A, ROOM_A_PATHS, ROOM_B, ROOM_C, roomsDb, roomsEnv, SAME_ORIGIN, STRANGER, type RoomsEnvOptions } from './rooms-fixtures.ts';
import { revokeSql } from '../scripts/room.ts';

const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;
const VIEWER = { 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Site': 'same-origin' };

/** One request as `email` against a shared database. */
function client(db: D1Database, options: RoomsEnvOptions = {}) {
  const assets: string[] = [];
  const as = async (email: string, path: string, init: RequestInit = {}) => {
    resetDocFactsCache();
    const made = roomsEnv(db, email, options);
    const response = await handle(new Request(`${HOST}${path}`, init), made.env, ctx);
    assets.push(...made.assets);
    return response;
  };
  return { as, assets };
}

const documentsOf = async (response: Response) => ((await response.json()) as { documents: { id: string; name: string; folder: string }[] }).documents;
const pathOf = (doc: { name: string; folder: string }) => `${doc.folder}/${doc.name}`;
const post = (body: unknown) => ({ method: 'POST', headers: SAME_ORIGIN, body: JSON.stringify(body) });
const DENIED = /This room is private\./;

test('R1: someone with an Access session but no invitation is refused on every path, and the room\'s assets are never served', async () => {
  const { db } = roomsDb();
  const { as, assets } = client(db);
  for (const path of ['/', '/api/rooms', `/api/rooms/${ROOM_A}/documents`, `/api/rooms/${ROOM_A}/files/${DOC.term.id}`, '/documents/', '/_astro/app.js', '/api/me']) {
    const res = await as(STRANGER, path);
    assert.equal(res.status, 403, path);
    assert.match(await res.text(), DENIED, path);
  }
  assert.deepEqual(assets, []);
});

test('R2: a guest asking for a room they are not in gets exactly what a missing room gets, on every guest route', async () => {
  const { db } = roomsDb();
  const { as } = client(db);
  const paths = (room: string) => [
    [`/api/rooms/${room}/documents`, {}],
    [`/api/rooms/${room}/files/${DOC.term.id}`, { headers: VIEWER }],
    [`/api/rooms/${room}/documents/${DOC.term.id}/comments`, {}],
    [`/api/rooms/${room}/documents/${DOC.term.id}/comments`, post({ body: 'Hello' })],
  ] as const;
  for (const [email, other] of [[BEA, ROOM_A], [OTTO, ROOM_B], [OTTO, ROOM_C]] as const) {
    for (const [[path, init], [missingPath, missingInit]] of paths(other).map((p, i) => [p, paths(NO_ROOM)[i]!] as const)) {
      const res = await as(email, path, init);
      const missing = await as(email, missingPath, missingInit);
      assert.equal(res.status, 404, `${email} ${path}`);
      assert.deepEqual(await res.json(), await missing.json(), `${email} ${path}`);
    }
  }
  const rooms = (await (await as(BEA, '/api/rooms')).json()) as { rooms: { id: string }[] };
  assert.deepEqual(rooms.rooms.map((r) => r.id), [ROOM_B], 'a guest is told only of their own rooms');
});

test('R3, R4, R5: a room lists only live, mirrored, unprivileged documents under its folders, compared exactly', async () => {
  const { db } = roomsDb();
  const { as } = client(db);
  const a = await documentsOf(await as(IVY, `/api/rooms/${ROOM_A}/documents`));
  assert.deepEqual(a.map(pathOf), ROOM_A_PATHS);
  // The underscore in Doe_Labs is a LIKE wildcard that would also match DoeXLabs: the rule compares exactly.
  const b = await documentsOf(await as(BEA, `/api/rooms/${ROOM_B}/documents`));
  assert.deepEqual(b.map(pathOf), [DOC.wildcard.path]);
  for (const doc of [...a, ...b]) assert.deepEqual(Object.keys(doc).sort(), ['folder', 'id', 'kind', 'name', 'pages', 'size', 'updated_at'], 'never an r2 key or an uploader');
});

test('R3, R4, R5: every document outside what the room shows answers like a missing one, by file and by comments', async () => {
  const { db } = roomsDb();
  const { as } = client(db);
  const outside = [DOC.privilegedPath, DOC.privilegedMark, DOC.sibling, DOC.otherCase, DOC.dataFile, DOC.removed, DOC.record, DOC.upload, DOC.lookalike, DOC.adjacent, DOC.wildcard];
  const missing = await (await as(IVY, `/api/rooms/${ROOM_A}/files/00000000-0000-4000-8000-999999999999`, { headers: VIEWER })).json();
  for (const doc of outside) {
    for (const [path, init] of [
      [`/api/rooms/${ROOM_A}/files/${doc.id}`, { headers: VIEWER }],
      [`/api/rooms/${ROOM_A}/documents/${doc.id}/comments`, {}],
      [`/api/rooms/${ROOM_A}/documents/${doc.id}/comments`, post({ body: 'Is this current?' })],
    ] as const) {
      const res = await as(IVY, path, init);
      assert.equal(res.status, 404, `${doc.path} ${init === undefined ? '' : (init as RequestInit).method ?? 'GET'} ${path}`);
      assert.deepEqual(await res.json(), missing, doc.path);
    }
  }
});

test('R4: a manifest that exists but cannot be read shows a guest nothing at all; members are unaffected', async () => {
  const { db } = roomsDb();
  const { as } = client(db, { manifest: '{"version": 99}' });
  for (const path of [`/api/rooms/${ROOM_A}/documents`, `/api/rooms/${ROOM_A}/files/${DOC.term.id}`, `/api/rooms/${ROOM_A}/documents/${DOC.term.id}/comments`]) {
    const res = await as(IVY, path, { headers: VIEWER });
    assert.equal(res.status, 503, path);
    assert.deepEqual(await res.json(), { error: 'unavailable' });
  }
  const page = await as(IVY, '/');
  assert.equal(page.status, 200);
  assert.doesNotMatch(await page.text(), /Term sheet/);
  assert.equal((await as(OWNER, '/api/documents')).status, 200);
  // No manifest at all marks nothing: the path rule still hides the privileged folder.
  const none = client(db, { manifest: null });
  assert.deepEqual((await documentsOf(await none.as(IVY, `/api/rooms/${ROOM_A}/documents`))).map(pathOf), [DOC.privilegedMark.path, ...ROOM_A_PATHS].sort());
});

test('R6: a guest reaches no member route (pro\'s Ask, research and matter included) and no static page, so no member link works', async () => {
  const { db } = roomsDb();
  const { as, assets } = client(db);
  const memberRoutes = roomRoutes();
  assert.ok(memberRoutes.some((r) => r.path === '/api/ask'), 'pro routes are registered in this test');
  for (const route of memberRoutes) {
    const path = route.path.replace(/:(\w+)/g, (_m, name: string) => (name === 'id' ? DOC.term.id : 'x'));
    const res = await as(IVY, path, { method: route.method, headers: SAME_ORIGIN, body: route.method === 'GET' || route.method === 'HEAD' ? undefined : '{}' });
    assert.ok(res.status === 404 || res.status === 405, `${route.method} ${route.path}: ${res.status}`);
    assert.doesNotMatch(await res.text(), /Term sheet|Complaint|APP-SHELL/, `${route.method} ${route.path}`);
  }
  for (const path of ['/documents/', '/doc/', '/ask/', '/activity/', '/binder/', '/_astro/app.js', '/favicon.svg', `/doc/?id=${DOC.term.id}`, `/files/${DOC.term.id}`]) {
    const res = await as(IVY, path, { headers: VIEWER });
    assert.equal(res.status, 404, path);
  }
  assert.deepEqual(assets, [], 'the static build carries the room\'s settings: a guest never gets it');
});

test('R7: bytes leave only inline to a viewer, audited with the room; downloads, top-level opens, frames, visuals and cross-site reads are refused', async () => {
  const { db, sqlite } = roomsDb();
  const { as } = client(db);
  const ok = await as(IVY, `/api/rooms/${ROOM_A}/files/${DOC.term.id}`, { headers: VIEWER });
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '0123456789');
  assert.match(ok.headers.get('Content-Security-Policy') ?? '', /^sandbox;/);
  assert.equal(ok.headers.get('Content-Disposition'), null);
  const ranged = await as(IVY, `/api/rooms/${ROOM_A}/files/${DOC.term.id}`, { headers: { ...VIEWER, Range: 'bytes=2-4' } });
  assert.equal(ranged.status, 206);
  assert.equal(await ranged.text(), '234');
  assert.deepEqual(
    sqlite.prepare("SELECT email, action, document_id, room_id FROM audit_log WHERE email = ?").all(IVY).map((r) => ({ ...r })),
    [{ email: IVY, action: 'view', document_id: DOC.term.id, room_id: ROOM_A }],
    'one view row with its room, deduplicated across ranges',
  );
  const refused: [string, Record<string, string>][] = [
    [`?download`, VIEWER],
    ['', { 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Site': 'none' }],
    ['', { 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Site': 'same-origin' }],
    ['', { 'Sec-Fetch-Dest': 'embed', 'Sec-Fetch-Site': 'same-origin' }],
    ['', { 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Site': 'cross-site' }],
    ['', { 'Sec-Fetch-Dest': 'image', 'Sec-Fetch-Site': 'same-site' }],
  ];
  for (const [query, headers] of refused) {
    const res = await as(IVY, `/api/rooms/${ROOM_A}/files/${DOC.term.id}${query}`, { headers });
    assert.equal(res.status, 403, `${query} ${JSON.stringify(headers)}`);
  }
  for (const dest of ['iframe', 'empty', 'document']) {
    assert.equal((await as(IVY, `/api/rooms/${ROOM_A}/files/${DOC.visual.id}`, { headers: { 'Sec-Fetch-Dest': dest, 'Sec-Fetch-Site': 'same-origin' } })).status, 403, `visual ${dest}`);
  }
});

test('R8: a guest reads only their own threads in that room: never counsel\'s comments, another investor\'s, or another room\'s', async () => {
  const { db, sqlite } = roomsDb();
  const { as } = client(db);
  const addComment = (cid: string, email: string, room: string | null, parent: string | null = null) =>
    sqlite.prepare('INSERT INTO comments (id, document_id, author_email, body, parent_id, room_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').run(cid, DOC.term.id, email, `body of ${cid}`, parent, room);
  addComment('counsel-advice', COUNSEL, null);
  addComment('otto-question', OTTO, ROOM_A);
  addComment('ivy-in-c', IVY, ROOM_C);
  addComment('ivy-legacy', IVY, null);
  // A member reply under Ivy's room-A thread stays out of her view too: only replies written in the room show.
  const own = await as(IVY, `/api/documents/${DOC.term.id}/comments`, post({ body: 'x' }));
  assert.equal(own.status, 404, 'the member comment route is not a guest route');

  const created = await as(IVY, `/api/rooms/${ROOM_A}/documents/${DOC.term.id}/comments`, post({ body: 'Is the option pool post-money?', page: 2 }));
  assert.equal(created.status, 201);
  const { comment } = (await created.json()) as { comment: { id: string } };
  addComment('counsel-reply', COUNSEL, null, comment.id);
  const reply = await as(IVY, `/api/rooms/${ROOM_A}/documents/${DOC.term.id}/comments`, post({ body: 'And the refresh?', parentId: comment.id }));
  assert.equal(reply.status, 201);

  const listed = (await (await as(IVY, `/api/rooms/${ROOM_A}/documents/${DOC.term.id}/comments`)).json()) as { comments: Record<string, unknown>[] };
  assert.deepEqual(listed.comments.map((c) => c.body), ['Is the option pool post-money?', 'And the refresh?']);
  for (const c of listed.comments) {
    assert.deepEqual(Object.keys(c).sort(), ['body', 'created_at', 'id', 'mine', 'page', 'parent_id', 'resolved'], 'never an author email or name');
    assert.equal(c.mine, true);
  }
  const inC = (await (await as(IVY, `/api/rooms/${ROOM_C}/documents/${DOC.term.id}/comments`)).json()) as { comments: { id: string }[] };
  assert.deepEqual(inC.comments.map((c) => c.id), ['ivy-in-c'], 'each room keeps its own threads');
  const otto = (await (await as(OTTO, `/api/rooms/${ROOM_A}/documents/${DOC.term.id}/comments`)).json()) as { comments: { id: string }[] };
  assert.deepEqual(otto.comments.map((c) => c.id), ['otto-question'], 'investors in one room never see each other');

  for (const parentId of ['counsel-advice', 'otto-question', 'ivy-in-c', 'ivy-legacy', 'counsel-reply']) {
    const res = await as(IVY, `/api/rooms/${ROOM_A}/documents/${DOC.term.id}/comments`, post({ body: 'reply', parentId }));
    assert.equal(res.status, 400, parentId);
    assert.deepEqual(await res.json(), { error: 'invalid_parent' }, parentId);
  }
  const stored = sqlite.prepare("SELECT room_id, author_email FROM comments WHERE author_email = ?1 AND room_id = ?2").all(IVY, ROOM_A);
  assert.equal(stored.length, 2);
  const audits = sqlite.prepare("SELECT action, room_id FROM audit_log WHERE email = ?1 AND action = 'comment'").all(IVY).map((r) => ({ ...r }));
  assert.deepEqual(audits, [{ action: 'comment', room_id: ROOM_A }, { action: 'comment', room_id: ROOM_A }]);
  // The owner sees the investor's questions in the usual thread.
  const ownerView = (await (await as(OWNER, `/api/documents/${DOC.term.id}/comments`)).json()) as { comments: { id: string }[] };
  assert.ok(ownerView.comments.some((c) => c.id === comment.id));
});

test('R8: guest writes need the exact origin; a guest cannot resolve, upload, flag or ask', async () => {
  const { db } = roomsDb();
  const { as } = client(db);
  const path = `/api/rooms/${ROOM_A}/documents/${DOC.term.id}/comments`;
  for (const headers of [{ 'Content-Type': 'application/json' }, { ...SAME_ORIGIN, Origin: 'https://evil.example' }, { ...SAME_ORIGIN, 'Sec-Fetch-Site': 'same-site' }]) {
    const res = await as(IVY, path, { method: 'POST', headers, body: '{"body":"x"}' });
    assert.equal(res.status, 403, JSON.stringify(headers));
  }
  for (const [method, target] of [['PATCH', '/api/comments/x'], ['PUT', '/api/uploads'], ['POST', `/api/documents/${DOC.term.id}/key`], ['POST', '/api/ask']]) {
    const res = await as(IVY, target, { method, headers: SAME_ORIGIN, body: '{}' });
    assert.equal(res.status, 404, `${method} ${target}`);
  }
});

test('R9: a revoke takes effect at the next request; a guest with another room keeps only that one', async () => {
  const { db, sqlite } = roomsDb();
  const { as } = client(db);
  assert.equal((await as(OTTO, `/api/rooms/${ROOM_A}/documents`)).status, 200);
  sqlite.exec(revokeSql(OTTO, new Date(), ROOM_A));
  for (const path of ['/', `/api/rooms/${ROOM_A}/documents`, `/api/rooms/${ROOM_A}/files/${DOC.term.id}`]) {
    const res = await as(OTTO, path, { headers: VIEWER });
    assert.equal(res.status, 403, path);
    assert.match(await res.text(), DENIED);
  }
  sqlite.exec(revokeSql(IVY, new Date(), ROOM_C));
  assert.equal((await as(IVY, `/api/rooms/${ROOM_C}/documents`)).status, 404);
  assert.equal((await as(IVY, `/api/rooms/${ROOM_A}/documents`)).status, 200);
  const events = sqlite.prepare("SELECT action, room_id, subject_email FROM access_events WHERE action = 'grant_revoked' ORDER BY id").all().map((r) => ({ ...r }));
  assert.deepEqual(events, [
    { action: 'grant_revoked', room_id: ROOM_A, subject_email: OTTO },
    { action: 'grant_revoked', room_id: ROOM_C, subject_email: IVY },
  ]);
  assert.throws(() => sqlite.exec('DELETE FROM access_events'), /append-only/);
  assert.throws(() => sqlite.exec("UPDATE access_events SET actor = 'x'"), /append-only/);
});

test('R10: an expired invitation, an unused one past its accept window, an archived room and a removed folder all end access', async () => {
  const { db, sqlite } = roomsDb();
  const { as } = client(db);
  const people = ['exp@fund.example', 'lapsed@fund.example', 'fresh@fund.example', 'late@fund.example'];
  invite(sqlite, { room: ROOM_B, email: people[0]!, invitedAt: '2020-01-01T00:00:00.000Z', acceptBy: '2020-01-15T00:00:00.000Z', expiresAt: '2020-02-01T00:00:00.000Z' });
  invite(sqlite, { room: ROOM_B, email: people[1]!, invitedAt: '2020-01-01T00:00:00.000Z', acceptBy: '2020-01-15T00:00:00.000Z', joinedAt: null });
  invite(sqlite, { room: ROOM_B, email: people[2]!, acceptBy: '2099-01-01T00:00:00.000Z', joinedAt: null });
  invite(sqlite, { room: ROOM_B, email: people[3]!, invitedAt: '2020-01-01T00:00:00.000Z', acceptBy: '2020-01-15T00:00:00.000Z', joinedAt: '2020-01-10T00:00:00.000Z' });
  assert.equal((await as(people[0]!, '/')).status, 403, 'expired');
  assert.equal((await as(people[1]!, '/')).status, 403, 'never used within its accept window');
  assert.equal((await as(people[3]!, '/')).status, 200, 'used in time, so the window no longer applies');

  assert.equal((await as(people[2]!, '/api/rooms')).status, 200, 'inside the accept window');
  const joined = sqlite.prepare('SELECT joined_at FROM room_members WHERE email = ?1').get(people[2]!) as { joined_at: string | null };
  assert.ok(joined.joined_at, 'the first request uses the invitation');
  await as(people[2]!, '/api/rooms');
  const accepted = sqlite.prepare("SELECT count(*) AS n FROM access_events WHERE action = 'invite_accepted' AND subject_email = ?1").get(people[2]!) as { n: number };
  assert.equal(accepted.n, 1, 'accepted once');

  sqlite.prepare("UPDATE room_folders SET removed_at = '2026-06-01T00:00:00.000Z' WHERE room_id = ?1").run(ROOM_A);
  assert.deepEqual(await documentsOf(await as(IVY, `/api/rooms/${ROOM_A}/documents`)), []);
  assert.equal((await as(IVY, `/api/rooms/${ROOM_A}/files/${DOC.term.id}`, { headers: VIEWER })).status, 404);
  assert.equal((await as(IVY, `/api/rooms/${ROOM_C}/files/${DOC.term.id}`, { headers: VIEWER })).status, 200, 'room C still shows the folder');

  sqlite.prepare("UPDATE rooms SET archived_at = '2026-06-01T00:00:00.000Z' WHERE id = ?1").run(ROOM_B);
  for (const email of [BEA, people[2]!, people[3]!]) assert.equal((await as(email, '/')).status, 403, `${email}: archived`);
});

test('R11: a role the code does not serve is no access, and a member of the install keeps the member view', async () => {
  const { db, sqlite } = roomsDb();
  const { as } = client(db);
  invite(sqlite, { room: ROOM_A, email: 'cy@firm.example', role: 'counsel' });
  invite(sqlite, { room: ROOM_A, email: 'vi@fund.example', role: 'viewer' });
  for (const email of ['cy@firm.example', 'vi@fund.example']) assert.equal((await as(email, '/')).status, 403, email);
  invite(sqlite, { room: ROOM_A, email: COUNSEL });
  const counsel = await as(COUNSEL, '/api/documents');
  assert.equal(counsel.status, 200, 'the members row decides first, exactly as today');
  assert.equal((await as(COUNSEL, `/api/rooms/${ROOM_A}/documents`)).status, 404, 'members never use the guest routes');
});

test('R12: with ROOMS_ENABLED off, a guest is a stranger and every member sees exactly what they saw before', async () => {
  const { db } = roomsDb();
  const off = client(db, { enabled: false });
  const on = client(db);
  for (const path of ['/', '/api/rooms', `/api/rooms/${ROOM_A}/documents`]) {
    const guest = await off.as(IVY, path);
    const stranger = await off.as(STRANGER, path);
    assert.equal(guest.status, 403, path);
    assert.equal(await guest.text(), await stranger.text(), path);
  }
  for (const email of [OWNER, COUNSEL]) {
    for (const [path, headers] of [['/', {}], ['/api/me', {}], ['/api/documents', {}], ['/api/comments', {}], [`/api/doc/${DOC.term.id}`, VIEWER], [`/files/${DOC.term.id}`, VIEWER], ['/documents/', {}]] as const) {
      const [before, after] = [await off.as(email, path, { headers }), await on.as(email, path, { headers })];
      assert.equal(after.status, before.status, `${email} ${path}`);
      assert.equal(await after.text(), await before.text(), `${email} ${path}`);
    }
  }
});

test('R14: removing a member ends their room invitations in the same step, so nothing is left open', async () => {
  const { db, sqlite } = roomsDb();
  const { as } = client(db);
  invite(sqlite, { room: ROOM_A, email: COUNSEL });
  sqlite.exec(`DELETE FROM members WHERE email = '${COUNSEL}'`);
  assert.equal((await as(COUNSEL, `/api/rooms/${ROOM_A}/documents`)).status, 200, 'without the second step the invitation would still open the room');
  sqlite.exec(revokeSql(COUNSEL, new Date(), null));
  assert.equal((await as(COUNSEL, '/')).status, 403);
});

test('R15: the Access email\'s case and spacing do not matter; the guest is greeted by their normalized address', async () => {
  const { db } = roomsDb();
  const { as } = client(db);
  const res = await as(' Ivy@Fund.Example ', '/api/rooms');
  assert.equal(res.status, 200);
  const me = (await res.json()) as { email: string; rooms: { id: string; role: string; can: Record<string, boolean> }[] };
  assert.equal(me.email, IVY);
  assert.deepEqual(me.rooms.map((r) => [r.id, r.role]), [[ROOM_C, 'investor'], [ROOM_A, 'investor']]);
  assert.deepEqual(me.rooms[0]!.can, { view: true, readComments: true, comment: true, connect: true });
});

test('R16: the guest page escapes room and document names, runs no script and names no privileged document', async () => {
  const { db, sqlite } = roomsDb();
  const { as } = client(db);
  sqlite.prepare('UPDATE rooms SET name = ?1 WHERE id = ?2').run('<script>alert(1)</script> & "co"', ROOM_A);
  sqlite.prepare('UPDATE documents SET name = ?1 WHERE id = ?2').run('<img src=x onerror=alert(1)>.pdf', DOC.cap.id);
  const res = await as(IVY, '/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.doesNotMatch(html, /<script|<img/i);
  assert.match(html, /&#60;script&#62;alert\(1\)&#60;\/script&#62; &#38; &#34;co&#34;/);
  assert.match(html, /Term sheet\.pdf/);
  assert.doesNotMatch(html, /Memo\.pdf|Board minutes|Complaint|Pitch\.pdf|Reply\.pdf/);
  assert.match(res.headers.get('Content-Security-Policy') ?? '', /script-src 'self'/);
});

test('R17: a folder guide reads like a missing document for a guest: not listed, not on the home page, not served', async () => {
  const { db, sqlite } = roomsDb();
  const { as } = client(db);
  const guides = [
    ['00000000-0000-4000-8000-000000000100', 'Deals/Harbor Seed/CLAUDE.md'],
    ['00000000-0000-4000-8000-000000000101', 'Deals/Harbor Seed/Financials/agents.md'],
    ['00000000-0000-4000-8000-000000000102', 'Deals/Harbor Seed/.claude/notes.md'],
    // #257: every AI's own name for the file, not only Claude's.
    ['00000000-0000-4000-8000-000000000103', 'Deals/Harbor Seed/CLAUDE.local.md'],
    ['00000000-0000-4000-8000-000000000104', 'Deals/Harbor Seed/GEMINI.md'],
    ['00000000-0000-4000-8000-000000000105', 'Deals/Harbor Seed/Financials/AGENTS.override.md'],
    ['00000000-0000-4000-8000-000000000106', 'Deals/Harbor Seed/copilot-instructions.md'],
    // The rest: Copilot's path-specific files, Cursor, Windsurf, a .gemini folder.
    ['00000000-0000-4000-8000-000000000107', 'Deals/Harbor Seed/.github/instructions/memos.instructions.md'],
    ['00000000-0000-4000-8000-000000000108', 'Deals/Harbor Seed/.cursorrules'],
    ['00000000-0000-4000-8000-000000000109', 'Deals/Harbor Seed/.cursor/rules/style.mdc'],
    ['00000000-0000-4000-8000-000000000110', 'Deals/Harbor Seed/Financials/.windsurfrules'],
    ['00000000-0000-4000-8000-000000000111', 'Deals/Harbor Seed/.windsurf/rules/style.md'],
    ['00000000-0000-4000-8000-000000000112', 'Deals/Harbor Seed/.gemini/styleguide.md'],
    // The follow-up: other tools' files and folders, and a name with a trailing space.
    ['00000000-0000-4000-8000-000000000113', 'Deals/Harbor Seed/Financials/.cursorrules'],
    ['00000000-0000-4000-8000-000000000114', 'Deals/Harbor Seed/.cursor/rules/terms.mdc'],
    ['00000000-0000-4000-8000-000000000115', 'Deals/Harbor Seed/.windsurfrules'],
    ['00000000-0000-4000-8000-000000000116', 'Deals/Harbor Seed/.clinerules'],
    ['00000000-0000-4000-8000-000000000117', 'Deals/Harbor Seed/.github/instructions/deck.instructions.md'],
    ['00000000-0000-4000-8000-000000000118', 'Deals/Harbor Seed/Financials/.gemini/styleguide.md'],
    ['00000000-0000-4000-8000-000000000119', 'Deals/Harbor Seed/.junie/guidelines.md'],
    ['00000000-0000-4000-8000-000000000120', 'Deals/Harbor Seed/CONVENTIONS.md'],
    ['00000000-0000-4000-8000-000000000121', 'Deals/Harbor Seed/Financials/CLAUDE.md '],
    // The union of the two rules: the whole .cursor and .github/instructions folders, and Cline's folder form.
    ['00000000-0000-4000-8000-000000000122', 'Deals/Harbor Seed/.cursor/mcp.json'],
    ['00000000-0000-4000-8000-000000000123', 'Deals/Harbor Seed/.github/instructions/notes.md'],
    ['00000000-0000-4000-8000-000000000124', 'Deals/Harbor Seed/Financials/.clinerules/terms.md'],
  ] as const;
  for (const [id, path] of guides) {
    const slash = path.lastIndexOf('/');
    sqlite
      .prepare(
        "INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at) VALUES (?1, ?2, ?3, ?4, 'markdown', 'text/markdown', 10, ?5, 'mirror', '2026-02-01T00:00:00.000Z')",
      )
      .run(id, path, path.slice(0, slash), path.slice(slash + 1), `r2-${id}`);
  }
  const listed = await documentsOf(await as(IVY, `/api/rooms/${ROOM_A}/documents`));
  assert.deepEqual(listed.map((doc) => `${doc.folder}/${doc.name}`), ROOM_A_PATHS);
  const home = await (await as(IVY, '/')).text();
  assert.equal(/claude\.md|claude\.local\.md|agents\.md|agents\.override\.md|gemini\.md|copilot-instructions|\.instructions\.md|cursorrules|\.cursor|windsurf|\.gemini|styleguide|terms\.mdc|windsurfrules|clinerules|instructions\.md|guidelines\.md|conventions\.md|mcp\.json|notes\.md|terms\.md/i.test(home), false);
  const missing = await (await as(IVY, `/api/rooms/${ROOM_A}/files/00000000-0000-4000-8000-999999999999`, { headers: VIEWER })).json();
  for (const [id, path] of guides) {
    for (const [route, init] of [
      [`/api/rooms/${ROOM_A}/files/${id}`, { headers: VIEWER }],
      [`/api/rooms/${ROOM_A}/documents/${id}/comments`, {}],
      [`/api/rooms/${ROOM_A}/documents/${id}/comments`, post({ body: 'Is this current?' })],
    ] as const) {
      const res = await as(IVY, route, init);
      assert.equal(res.status, 404, `${path} ${route}`);
      assert.deepEqual(await res.json(), missing, path);
    }
  }
});

test('R18: a read leaves one audit row per room: the same document read in two rooms shows in both', async () => {
  const { db, sqlite } = roomsDb();
  const { as } = client(db);
  for (const room of [ROOM_A, ROOM_A, ROOM_C, ROOM_C]) {
    assert.equal((await as(IVY, `/api/rooms/${room}/files/${DOC.term.id}`, { headers: VIEWER })).status, 200);
  }
  const rows = sqlite.prepare("SELECT room_id FROM audit_log WHERE email = ?1 AND action = 'view' ORDER BY id").all(IVY).map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ room_id: ROOM_A }, { room_id: ROOM_C }]);
});

test('an investor\'s question and the owner\'s answer reach only that investor', async () => {
  const { db, sqlite } = roomsDb();
  const { as } = client(db);
  const path = `/api/rooms/${ROOM_A}/documents/${DOC.term.id}/comments`;
  const asked = await as(IVY, path, post({ body: 'What is the pre-money valuation?' }));
  const question = ((await asked.json()) as { comment: { id: string } }).comment.id;
  const otto = await as(OTTO, path, post({ body: 'Who leads the round?' }));
  assert.equal(otto.status, 201);

  const answer = await as(OWNER, `/api/documents/${DOC.term.id}/comments`, post({ body: 'Eight million, per the term sheet.', parentId: question }));
  assert.equal(answer.status, 201);
  const advice = await as(COUNSEL, `/api/documents/${DOC.term.id}/comments`, post({ body: 'Privileged: check the cap first.', parentId: question }));
  assert.equal(advice.status, 201);

  const ivy = (await (await as(IVY, path)).json()) as { comments: { body: string; mine: boolean }[] };
  assert.deepEqual(ivy.comments.map((c) => [c.body, c.mine]), [['What is the pre-money valuation?', true], ['Eight million, per the term sheet.', false]], 'the answer, never counsel\'s advice');
  const others = (await (await as(OTTO, path)).json()) as { comments: { body: string }[] };
  assert.deepEqual(others.comments.map((c) => c.body), ['Who leads the round?'], 'another investor in the room sees neither');
  const inC = (await (await as(IVY, `/api/rooms/${ROOM_C}/documents/${DOC.term.id}/comments`)).json()) as { comments: unknown[] };
  assert.deepEqual(inC.comments, [], 'nor does the same investor in another room');
  assert.deepEqual(sqlite.prepare('SELECT room_id FROM comments WHERE parent_id = ?1 ORDER BY author_email DESC').all(question).map((r) => ({ ...r })), [{ room_id: ROOM_A }, { room_id: null }]);
});
