// SPDX-License-Identifier: Apache-2.0
// Privileged folders on pro's document routes, /api/visuals and /api/matter (index.ts adds them to the room), through
// the real gate in room.ts on real SQLite, as owner and counsel; the retired family role is refused at the gate and
// again by each route. The core's routes: privilege.test.ts.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Env, Role } from './env.ts';
import { addLeftoverFamily, pastTheGate as dispatch } from './gate-fixtures.ts';
import { handle } from './index.ts';
import { MATTER_KEY } from './matter-types.ts';
import { resetMatterCache } from './routes/matter.ts';
import { testDb } from './sqlite-d1.ts';

// The same room as privilege.test.ts's, served with pro's routes (index.ts).
const HOST = 'http://localhost:8789';
const PEOPLE: Record<Role, string> = { owner: 'founder@example.test', counsel: 'ada@firm.example' };
const ROLES = Object.keys(PEOPLE) as Role[];
const RETIRED = 'family' as Role;
const KIN = 'kin@mail.example';

type Seed = { id: string; path: string; kind?: string; source?: 'mirror' | 'counsel' };

const ROOM: Seed[] = [
  { id: 'open', path: '08-Court-Pleadings/complaint.pdf' },
  { id: 'call', path: '07-Lawyer-Notes-PRIVILEGED/witness-call.pdf' },
  { id: 'mail', path: '04-Letters/with-Lawyer-PRIVILEGED/advice.pdf' },
  { id: 'named', path: '08-Court-Pleadings/memo-privileged.pdf' },
  { id: 'guide', path: '07-Lawyer-Notes-PRIVILEGED/CLAUDE.md', kind: 'markdown' },
  { id: 'up-open', path: 'from-counsel/up-open/notes.pdf', source: 'counsel' },
  { id: 'up-priv', path: 'from-counsel/up-priv/Privileged draft.pdf', source: 'counsel' },
];

/** Real SQLite with the two members and `docs`, a legallas-files fake holding each file's bytes, and GET helpers. */
function room(as: Role, docs: Seed[] = ROOM, files: Record<string, string> = {}) {
  const { db, sqlite } = testDb();
  for (const role of ROLES) sqlite.prepare('INSERT INTO members (email, role, name) VALUES (?1, ?2, NULL)').run(PEOPLE[role], role);
  const insert = sqlite.prepare(
    'INSERT INTO documents (id, path, folder, name, kind, content_type, size, pages, r2_key, source, uploaded_by, updated_at, control_seq) ' +
      "VALUES (?1, ?2, ?3, ?4, ?5, 'application/pdf', 4, 1, ?6, ?7, ?8, '2026-10-01T00:00:00.000Z', ?9)",
  );
  docs.forEach((d, i) => {
    const slash = d.path.lastIndexOf('/');
    const source = d.source ?? 'mirror';
    insert.run(d.id, d.path, d.path.slice(0, Math.max(slash, 0)), d.path.slice(slash + 1), d.kind ?? 'pdf', `k-${d.id}`, source, source === 'counsel' ? PEOPLE.counsel : null, i + 1);
  });
  const bucket = {
    async get(key: string) {
      const text = Object.hasOwn(files, key) ? files[key]! : key.startsWith('k-') ? `%PDF${key}` : null;
      if (text === null) return null;
      return { key, etag: 'e1', size: text.length, body: new Response(text).body, text: async () => text };
    },
  };
  const env = {
    ASSETS: { fetch: async () => new Response('shell') }, DB: db, FILES: bucket,
    TEAM_DOMAIN: '', ACCESS_AUD: '', ALLOW_DEV_IDENTITY: '1', DEV_IDENTITY_EMAIL: PEOPLE[as],
  } as unknown as Env;
  const get = (path: string, headers: Record<string, string> = {}) => handle(new Request(`${HOST}${path}`, { headers }), env, {} as ExecutionContext);
  /** Through the gate as any email; and past it, as room.ts would dispatch for `member` if findMember let it in. */
  const getAs = (email: string, path: string) => handle(new Request(`${HOST}${path}`), { ...env, DEV_IDENTITY_EMAIL: email } as Env, {} as ExecutionContext);
  const pastTheGate = (path: string, headers: Record<string, string> = {}) =>
    dispatch(new Request(`${HOST}${path}`, { headers }), env, { email: KIN, role: RETIRED, name: null });
  const audited = () => (sqlite.prepare('SELECT document_id FROM audit_log WHERE document_id IS NOT NULL').all() as { document_id: string }[]).map((r) => r.document_id);
  return { get, getAs, pastTheGate, audited, sqlite };
}

beforeEach(() => resetMatterCache());

const BINDER = JSON.stringify({
  version: 1,
  sections: [{ slug: 'start', label: 'Start', title: 'Overview' }],
  visuals: [{ slug: 'start', section: 'start', file: 'start.html', title: 'Start here', overview: true }],
});

test('/api/visuals: a binder kept in a privileged folder is whole for owner and counsel', async () => {
  const docs: Seed[] = [
    { id: 'manifest', path: 'Work-PRIVILEGED/Visuals/legallas-visuals.json', kind: 'file' },
    { id: 'start', path: 'Work-PRIVILEGED/Visuals/start.html', kind: 'visual' },
  ];
  const files = { 'k-manifest': BINDER };
  for (const role of ROLES) {
    const served = (await (await room(role, docs, files).get('/api/visuals')).json()) as { visuals: { id: string }[] };
    assert.deepEqual(served.visuals.map((v) => v.id), ['start'], role);
  }
});

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const MATTER = readFileSync(join(FIXTURES, 'matter.example.json'), 'utf8');
const IDS = JSON.parse(readFileSync(join(FIXTURES, 'doc-ids.json'), 'utf8')) as Record<string, string>;
// A document the fixture cites from events, people and orgs; here it sits in a privileged folder.
const MOVED = IDS['01-Corporate-Records/Stock-Agreement__20110607__Harbor-Labs.pdf']!;

test('/api/matter: owner and counsel keep every cite to a privileged document and its facts', async () => {
  const docs = Object.entries(IDS).map(([path, id]) => ({ id, path: id === MOVED ? `07-Lawyer-Notes-PRIVILEGED/${path.split('/').pop()}` : path }));
  assert.ok(MATTER.includes(MOVED), 'the fixture cites the moved document');
  const served: Record<string, string> = {};
  for (const role of ROLES) {
    resetMatterCache();
    const res = await room(role, docs, { [MATTER_KEY]: MATTER }).get('/api/matter');
    assert.equal(res.status, 200, role);
    served[role] = await res.text();
  }
  assert.ok(served.counsel!.includes(MOVED) && served.owner!.includes(MOVED), 'counsel and owner see the cites');
  const counsel = JSON.parse(served.counsel!) as { events: unknown[]; docs: Record<string, unknown> };
  assert.ok(counsel.events.length > 0);
  assert.ok(Object.hasOwn(counsel.docs, MOVED), 'the moved document keeps its doc facts');
  assert.equal(served.owner, served.counsel, 'owner and counsel are served the same case picture');
});

const PRO_PATHS = ['/api/visuals', '/api/matter'];

test('the gate refuses a family row left from before migration 0010 on pro\'s routes, exactly as it refuses a stranger', async () => {
  const r = room('owner');
  addLeftoverFamily(r.sqlite, KIN);
  for (const path of PRO_PATHS) {
    const stranger = await r.getAs('stranger@example.test', path);
    const family = await r.getAs(KIN, path);
    assert.equal(stranger.status, 403, path);
    assert.equal(family.status, 403, path);
    assert.equal(await family.text(), await stranger.text(), path);
  }
  assert.deepEqual(r.audited(), []);
});

test('past the gate, pro\'s document routes refuse the retired role themselves', async () => {
  const r = room('owner', ROOM, { [MATTER_KEY]: MATTER });
  for (const path of PRO_PATHS) {
    const res = await r.pastTheGate(path, { 'Sec-Fetch-Dest': 'empty' });
    assert.equal(res.status, 403, path);
    assert.deepEqual(await res.json(), { error: 'forbidden' }, path);
  }
  assert.deepEqual(r.audited(), []);
});
