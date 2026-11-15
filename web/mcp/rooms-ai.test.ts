// SPDX-License-Identifier: Apache-2.0
// Deal rooms and connected AIs (docs/design/rooms-and-grants.md, row R13), on the fixture room (Doe v. Harbor Labs,
// control prefix DOE; worker/rooms-fixtures.ts). An investor with an active invitation connects their own AI app; every
// tool call re-reads the invitation and sees only that guest's rooms, never a privileged document; the daily sweep
// revokes the grant once the invitation ends. Members' tool listing is the same whatever ROOMS_ENABLED says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOM_READER } from '../worker/auth.ts';
import { resetDocFactsCache } from '../worker/doc-facts-serve.ts';
import { NOTICE_VERSION } from '../worker/full-notice.ts';
import { privilegeFilter, withGuestScope } from '../worker/privilege.ts';
import { addRoom, BEA, DOC, fakeFiles, invite, IVY, OTTO, OWNER, ROOM_A, ROOM_A_PATHS, roomsDb, STRANGER } from '../worker/rooms-fixtures.ts';
import { testDb } from '../worker/sqlite-d1.ts';
import { handleAuthorize } from './authorize.ts';
import type { AiAuditEntry } from './audit.ts';
import { TOOL_NAMES, type McpEnv, type Props, type ToolDefinition } from './contract.ts';
import { CIMD_CLIENT, CLAUDE_REDIRECT, COUNSEL, fakeEnv, fakeOAuth, getKey, signedRequest } from './oauth-fakes.ts';
import { GUEST_TOOLS, INSTRUCTIONS, listsPropose, runTool, serveMcp } from './server.ts';
import { sweepOrphanGrants } from './sweep.ts';
import { fakeIndex, partsFor } from './tools/doc-fixtures.ts';
import { listedTools } from './tools/index.ts';
import { overviewTool } from './tools/overview.ts';
import { proposeDraftTool } from './tools/propose.ts';
import { searchLawTool } from './tools/search-law.ts';
import { viewVisualTool } from './tools/visuals.ts';

const FAR = '2099-01-01T00:00:00.000Z';
const NOW = new Date('2026-11-06T12:00:00.000Z');
const ALL = Object.values(DOC);
/** What a guest of room A sees: ROOM_A_PATHS, by id. */
const ROOM_A_IDS = ALL.filter((doc) => (ROOM_A_PATHS as readonly string[]).includes(doc.path)).map((doc) => doc.id);
const canary = (id: string) => `CANARY-${id}`;

/** Invites `email` to a fresh room A through the env's own database, unused, with its accept window still open. */
async function inviteThrough(db: D1Database, email: string, fields: { expiresAt?: string; revokedAt?: string; kind?: string; role?: string } = {}): Promise<void> {
  await db.prepare("INSERT INTO rooms (id, kind, name, created_by) VALUES (?1, ?2, 'Harbor Labs seed', 'owner-cli')").bind(ROOM_A, fields.kind ?? 'deal').run();
  await db.prepare("INSERT INTO room_folders (id, room_id, folder, added_by) VALUES ('f1', ?1, 'Deals/Harbor Seed', 'owner-cli')").bind(ROOM_A).run();
  await db
    .prepare(
      'INSERT INTO room_members (id, room_id, email, role, invited_by, invited_at, accept_by, joined_at, expires_at, revoked_at) ' +
        "VALUES ('g1', ?1, ?2, ?3, 'owner-cli', '2026-01-01T00:00:00.000Z', ?4, NULL, ?5, ?6)",
    )
    .bind(ROOM_A, email, fields.role ?? 'investor', FAR, fields.expiresAt ?? FAR, fields.revokedAt ?? null)
    .run();
}

function authorizeUrl(): string {
  return `/authorize?${new URLSearchParams({ response_type: 'code', client_id: CIMD_CLIENT, redirect_uri: CLAUDE_REDIRECT, state: 's1' })}`;
}

test('R13: an investor with an active invitation connects their own AI: consent, a read-only grant, and the invitation used', async () => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth, { ROOMS_ENABLED: '1' } as Partial<McpEnv>);
  await inviteThrough(env.DB, IVY);
  const shown = await handleAuthorize(await signedRequest(authorizeUrl(), IVY), env, { getKey });
  assert.equal(shown.status, 200);
  assert.doesNotMatch(await shown.text(), /type="checkbox"/, 'a guest is never offered proposals');
  const posted = await handleAuthorize(await signedRequest('/authorize', IVY, { method: 'POST', body: new URLSearchParams({ handle: 'h1', decision: 'approve' }) }), env, { getKey });
  assert.equal(posted.status, 302);
  const complete = oauth.calls.find((call) => call.name === 'completeAuthorization')?.args[0] as { userId: string; props: Props };
  assert.equal(complete.userId, IVY);
  assert.deepEqual(complete.props, { email: IVY, role: ROOM_READER, clientId: CIMD_CLIENT, clientName: 'claude.ai' });
  const grant = await env.DB.prepare("SELECT joined_at FROM room_members WHERE id = 'g1'").first<{ joined_at: string | null }>();
  assert.ok(grant?.joined_at, 'connecting is the invitation\'s first use, so its accept window stops mattering');
  const events = await env.DB.prepare("SELECT action FROM access_events WHERE grant_id = 'g1'").all<{ action: string }>();
  assert.deepEqual(events.results.map((row) => row.action), ['invite_accepted']);
});

test('R13: /authorize refuses a guest who may not connect, on GET and POST, before any OAuth step', async () => {
  const cases: [string, Partial<McpEnv>, Parameters<typeof inviteThrough>[2] | null][] = [
    ['rooms off', {}, {}],
    ['expired', { ROOMS_ENABLED: '1' } as Partial<McpEnv>, { expiresAt: '2026-02-01T00:00:00.000Z' }],
    ['revoked', { ROOMS_ENABLED: '1' } as Partial<McpEnv>, { revokedAt: '2026-02-01T00:00:00.000Z' }],
    ['matter-room counsel', { ROOMS_ENABLED: '1' } as Partial<McpEnv>, { kind: 'matter', role: 'counsel' }],
    ['no invitation', { ROOMS_ENABLED: '1' } as Partial<McpEnv>, null],
  ];
  for (const [name, extra, fields] of cases) {
    const oauth = fakeOAuth();
    const env = fakeEnv(oauth, extra);
    if (fields) await inviteThrough(env.DB, IVY, fields);
    const shown = await handleAuthorize(await signedRequest(authorizeUrl(), IVY), env, { getKey });
    assert.equal(shown.status, 403, name);
    assert.match(await shown.text(), /not a member/, name);
    const posted = await handleAuthorize(await signedRequest('/authorize', IVY, { method: 'POST', body: new URLSearchParams({ handle: 'h1', decision: 'approve' }) }), env, { getKey });
    assert.equal(posted.status, 403, name);
    assert.deepEqual(oauth.names(), [], name);
  }
});

/** The fixture room for tool calls: every document has a page of text and a search chunk holding its canary. */
function aiRoom(options: { enabled?: boolean; manifest?: string | null } = {}) {
  const { db, sqlite } = roomsDb();
  sqlite.prepare('INSERT OR IGNORE INTO notice_acks (email, version) VALUES (?1, ?2)').run(OWNER, NOTICE_VERSION);
  const parts = new Map(ALL.flatMap((doc) => [...partsFor(doc.id, [{ n: 1, text: `Harbor page ${canary(doc.id)}` }])]));
  const search = {
    async search() {
      return { search_query: '', chunks: ALL.map((doc, i) => ({ id: `c${i}`, type: 'text', score: 0.9, text: `[[doc:${doc.id} p:1]]\nHarbor ${canary(doc.id)}`, item: { key: `text/${doc.id}.p1.md` } })) };
    },
  };
  const env = {
    DB: db,
    FILES: fakeFiles(options.manifest),
    INDEX: fakeIndex(parts).bucket,
    SEARCH: search,
    CONTROL_PREFIX: 'DOE',
    TEAM_DOMAIN: '',
    ACCESS_AUD: '',
    ...(options.enabled === false ? {} : { ROOMS_ENABLED: '1' }),
  } as unknown as McpEnv;
  return { env, sqlite };
}

/** Every tool the full product lists: the core's, pro's overview and visuals (mcp/pro.ts adds them) and the law library's. */
const TOOLS: readonly ToolDefinition<any>[] = [...new Set([...listedTools(), overviewTool, viewVisualTool, searchLawTool])];
const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

/** One tool call through runTool's gate, as `email`'s connection, with arguments parsed as the SDK would. */
async function call(env: McpEnv, email: string, name: string, args: Record<string, unknown> = {}) {
  resetDocFactsCache();
  const props: Props = { email, role: ROOM_READER, clientId: 'client-1', clientName: 'Claude' };
  // Claude's standard profile, so a page holds the owner's whole list.
  const out = await runTool(tool(name), tool(name).inputSchema.parse(args), env, props, undefined, NOW, 'claude');
  return { out, text: JSON.stringify(out) };
}

/** Every fixture id that appears anywhere in a result. */
const idsIn = (text: string) => ALL.map((doc) => doc.id).filter((id) => text.includes(id));

test('R13, R3, R4, R5: a guest\'s AI lists, opens, reads and searches only its rooms\' documents, never a privileged one', async () => {
  const { env } = aiRoom();
  const listed = await call(env, OTTO, 'legallas_list_documents');
  assert.equal(listed.out.isError, undefined, listed.text);
  assert.deepEqual(idsIn(listed.text).sort(), [...ROOM_A_IDS].sort());
  for (const doc of ALL) {
    const shown = ROOM_A_IDS.includes(doc.id);
    const got = await call(env, OTTO, 'legallas_get_document', { id: doc.id });
    assert.equal(got.out.isError === true, !shown, `get ${doc.path}`);
    const read = await call(env, OTTO, 'legallas_read_pages', { id: doc.id, from: 1, to: 1 });
    assert.equal(read.text.includes(canary(doc.id)), shown, `read ${doc.path}`);
  }
  const found = await call(env, OTTO, 'legallas_search', { query: 'harbor' });
  assert.equal(found.out.isError, undefined, found.text);
  assert.ok(found.text.includes(canary(DOC.term.id)), 'search still finds the room\'s documents');
  for (const doc of ALL.filter((d) => !ROOM_A_IDS.includes(d.id))) assert.equal(found.text.includes(canary(doc.id)), false, `search ${doc.path}`);
  for (const doc of [DOC.privilegedPath, DOC.privilegedMark, DOC.record]) {
    const visual = await call(env, OTTO, 'legallas_view_visual', { id: doc.id });
    assert.equal(visual.out.isError, true, `visual ${doc.path}`);
  }
  // Another room's guest sees only theirs: room B's exact folder, not its LIKE look-alike.
  assert.deepEqual(idsIn((await call(env, BEA, 'legallas_list_documents')).text), [DOC.wildcard.id]);
  // The owner's connection is untouched: the whole record, privileged documents included.
  const owner = await call(env, OWNER, 'legallas_list_documents');
  for (const doc of [DOC.record, DOC.privilegedPath, DOC.privilegedMark]) assert.ok(owner.text.includes(doc.id), doc.path);
  // Comments are members' threads: a guest's AI does not even get their count.
  const keys = async (email: string) => Object.keys((await call(env, email, 'legallas_get_document', { id: DOC.term.id })).out.structuredContent ?? {});
  assert.equal((await keys(OTTO)).includes('comments'), false);
  assert.equal((await keys(OWNER)).includes('comments'), true);
});

test('R13: two guests\' calls at once each see only their own rooms', async () => {
  const { env } = aiRoom();
  const [otto, bea] = await Promise.all([call(env, OTTO, 'legallas_list_documents'), call(env, BEA, 'legallas_list_documents')]);
  assert.deepEqual(idsIn(otto.text).sort(), [...ROOM_A_IDS].sort());
  assert.deepEqual(idsIn(bea.text), [DOC.wildcard.id]);
});

test('R13: a guest\'s AI never reaches the case overview, comments, files or a proposal, and those calls cost nothing', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { env, sqlite } = aiRoom();
  const refused: string[] = TOOLS.filter((def) => !GUEST_TOOLS.has(def.name)).map((def) => def.name);
  for (const name of ['legallas_case_overview', 'legallas_get_comments', 'legallas_get_file']) assert.ok(refused.includes(name), name);
  for (const name of refused) {
    const props: Props = { email: OTTO, role: ROOM_READER, clientId: 'client-1', clientName: 'Claude' };
    const out = await runTool(tool(name), {}, env, props, undefined, NOW);
    assert.match(String((out.content[0] as { text: string }).text), /^forbidden:/, name);
  }
  assert.equal((sqlite.prepare('SELECT count(*) AS n FROM usage').get() as { n: number }).n, 0);
});

test('a guest\'s AI cannot propose, a visual for the binder included, even with proposals on and the consent claimed', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { env, sqlite } = aiRoom();
  Object.assign(env, { PROPOSALS_ENABLED: '1' });
  const props: Props = { email: OTTO, role: ROOM_READER, clientId: 'client-1', clientName: 'Claude', propose: true };
  assert.equal(listsPropose(env, props), false, 'never listed');
  const args = proposeDraftTool.inputSchema.parse({ title: 'Chronology', body: '<body>Harbor</body>', why: 'The chronology kit.', visual: true });
  const out = await runTool(proposeDraftTool, args, env, props, undefined, NOW);
  assert.match(String((out.content[0] as { text: string }).text), /^forbidden:/);
  assert.equal((sqlite.prepare('SELECT count(*) AS n FROM proposals').get() as { n: number }).n, 0);
});

test('R4: a manifest that cannot be read shows a guest\'s AI nothing; the owner\'s AI is unaffected', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { env } = aiRoom({ manifest: '{not json' });
  const guest = await call(env, OTTO, 'legallas_list_documents');
  assert.match(guest.text, /marks_unavailable/);
  assert.deepEqual(idsIn(guest.text), []);
  assert.equal((await call(env, OWNER, 'legallas_list_documents')).out.isError, undefined);
});

test('R9, R10, R12, R13: a revoke, an expiry, an archived room or rooms turned off end a guest\'s AI at its next call', async () => {
  const ends: [string, (sqlite: ReturnType<typeof roomsDb>['sqlite']) => void, boolean?][] = [
    ['revoked', (s) => s.prepare("UPDATE room_members SET revoked_at = '2026-11-01T00:00:00.000Z' WHERE email = ?1").run(OTTO)],
    ['expired', (s) => s.prepare("UPDATE room_members SET expires_at = '2026-11-01T00:00:00.000Z' WHERE email = ?1").run(OTTO)],
    ['archived', (s) => s.prepare("UPDATE rooms SET archived_at = '2026-11-01T00:00:00.000Z' WHERE id = ?1").run(ROOM_A)],
    ['rooms off', () => {}, false],
  ];
  for (const [name, end, enabled] of ends) {
    const { env, sqlite } = aiRoom({ enabled: enabled ?? true });
    end(sqlite);
    const after = await call(env, OTTO, 'legallas_list_documents');
    assert.match(after.text, /not_a_member/, name);
    assert.deepEqual(idsIn(after.text), [], name);
  }
});

test('R13: a reader role sees documents only during its own call: never bare, never after the call ends', async () => {
  assert.equal(privilegeFilter(ROOM_READER), ' AND 0');
  assert.equal(privilegeFilter(ROOM_READER, 'd.path'), ' AND 0');
  let kept = ROOM_READER;
  await withGuestScope({ rooms: [ROOM_A], folders: ['Deals/Harbor Seed'], marks: new Set() }, async (role) => {
    kept = role;
    assert.match(privilegeFilter(role), /IN \('aaaaaaaa-0000-4000-8000-00000000000a'\)/);
  });
  assert.notEqual(kept, ROOM_READER);
  assert.equal(privilegeFilter(kept), ' AND 0');
});

test('R13: the daily sweep keeps an active investor\'s AI grant and revokes it once the invitation ends, or rooms are off', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  for (const enabled of [true, false]) {
    const { db, sqlite } = testDb();
    sqlite.prepare("INSERT INTO members (email, role) VALUES (?1, 'owner')").run(OWNER);
    addRoom(sqlite, ROOM_A, 'Harbor Labs seed', ['Deals/Harbor Seed']);
    invite(sqlite, { room: ROOM_A, email: IVY });
    invite(sqlite, { room: ROOM_A, email: OTTO, expiresAt: '2026-11-01T00:00:00.000Z' });
    invite(sqlite, { room: ROOM_A, email: BEA, revokedAt: '2026-11-01T00:00:00.000Z' });
    const store = new Map<string, string>(
      [OWNER, IVY, OTTO, BEA, STRANGER].map((email, i) => [`grant:${email}:g${i}`, JSON.stringify({ metadata: { clientName: 'Claude' } })]),
    );
    const kv = {
      async list() {
        return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true };
      },
      async get(key: string) {
        const value = store.get(key);
        return value === undefined ? null : JSON.parse(value);
      },
      async put() {},
      async delete() {},
    } as unknown as KVNamespace;
    const revoked: string[] = [];
    const env = {
      DB: db,
      OAUTH_KV: kv,
      OAUTH_PROVIDER: { revokeGrant: async (_grantId: string, userId: string) => void revoked.push(userId) },
      ...(enabled ? { ROOMS_ENABLED: '1' } : {}),
    } as unknown as McpEnv;
    const audits: AiAuditEntry[] = [];
    await sweepOrphanGrants(env, async (_env, entry) => void audits.push(entry), NOW);
    const expected = enabled ? [OTTO, BEA, STRANGER] : [IVY, OTTO, BEA, STRANGER];
    assert.deepEqual(revoked, expected, `rooms ${enabled ? 'on' : 'off'}`);
    assert.deepEqual(audits.map((a) => [a.email, a.action]), expected.map((email) => [email, 'ai_disconnect']));
  }
});

async function rpc(env: McpEnv, method: string) {
  const props: Props = { email: COUNSEL, role: 'counsel', clientId: 'client-1', clientName: 'Claude' };
  const request = new Request('https://mcp.example.test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: method === 'initialize' ? { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } } : {} }),
  });
  const text = await (await serveMcp(request, env, props)).text();
  return JSON.parse(text.split('\n').find((line) => line.startsWith('data: '))!.slice('data: '.length));
}

test('R12: the tool listing and the instructions are the same with ROOMS_ENABLED on, off or unset', async () => {
  const { db, sqlite } = testDb();
  sqlite.prepare("INSERT INTO members (email, role) VALUES (?1, 'counsel')").run(COUNSEL);
  const base = { DB: db, TEAM_DOMAIN: '', ACCESS_AUD: '' };
  const lists = [];
  for (const flag of [undefined, '0', '1']) {
    const env = { ...base, ...(flag === undefined ? {} : { ROOMS_ENABLED: flag }) } as unknown as McpEnv;
    lists.push({ tools: (await rpc(env, 'tools/list')).result.tools, instructions: (await rpc(env, 'initialize')).result.instructions });
  }
  assert.deepEqual(lists[1], lists[0]);
  assert.deepEqual(lists[2], lists[0]);
  assert.equal(lists[0]!.instructions, INSTRUCTIONS);
  const names = (lists[0]!.tools as { name: string }[]).map((tool) => tool.name);
  assert.deepEqual(names, TOOL_NAMES.filter((name) => names.includes(name)));
});
