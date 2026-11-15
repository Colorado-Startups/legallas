// SPDX-License-Identifier: Apache-2.0
// Privileged folders (worker/privilege.ts): the rule in both its forms, then every room route that lists or opens a
// document, through the real gate in room.ts on real SQLite, as owner and counsel. The read-only family role that
// privilege once filtered for is retired: the gate refuses a leftover family row as it refuses a stranger, and each
// route refuses the role again on its own, so no privileged document is ever one filter away from it.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resetDocFactsCache } from './doc-facts-serve.ts';
import type { Env, Role } from './env.ts';
import type { FolderNode } from './files-catalog.ts';
import { handle } from './room.ts';
import { addLeftoverFamily, pastTheGate as dispatch } from './gate-fixtures.ts';
import { MATTER_KEY } from './matter-types.ts';
import { canSeeDocument, isPrivilegedPath, privilegeFilter } from './privilege.ts';
import { testDb } from './sqlite-d1.ts';

const HOST = 'http://localhost:8789';
const PEOPLE: Record<Role, string> = { owner: 'founder@example.test', counsel: 'ada@firm.example' };
const ROLES = Object.keys(PEOPLE) as Role[];
const RETIRED = 'family' as Role;
const KIN = 'kin@mail.example';

beforeEach(() => resetDocFactsCache());

test('a path is privileged when any folder or the file name says so, in any case', () => {
  for (const path of [
    '07-Lawyer-Notes-PRIVILEGED/witness-call.pdf',
    '04-Letters/with-Lawyer-PRIVILEGED/advice.eml',
    '04-Letters/with-lawyer-privileged/sub/advice.eml',
    'a/Privileged/b.pdf',
    '08-Court-Pleadings/memo-Privileged.pdf',
    'a/Non-Privileged/b.pdf',
  ]) assert.equal(isPrivilegedPath(path), true, path);
  for (const path of ['08-Court-Pleadings/complaint.pdf', 'a/PRIVILEGE/b.pdf', 'a/privilged/b.pdf', 'from-counsel/u1/notes.pdf', '']) {
    assert.equal(isPrivilegedPath(path), false, path);
  }
  assert.equal(canSeeDocument(RETIRED, 'a/PRIVILEGED/b.pdf'), false, 'the retired family role never sees privileged documents');
  assert.equal(canSeeDocument(RETIRED, 'a/b.pdf'), true);
  assert.equal(canSeeDocument('counsel', 'a/PRIVILEGED/b.pdf'), true);
  assert.equal(canSeeDocument('owner', 'a/PRIVILEGED/b.pdf'), true);
  assert.equal(canSeeDocument('intruder' as Role, 'a/b.pdf'), true, 'privilege only narrows; membership is checked elsewhere');
  assert.equal(canSeeDocument('intruder' as Role, 'a/PRIVILEGED/b.pdf'), false, 'an unknown role never sees privileged documents');
});

test('privilegeFilter leaves owner and counsel SQL untouched and agrees with isPrivilegedPath on real SQLite', () => {
  assert.equal(privilegeFilter('owner'), '');
  assert.equal(privilegeFilter('counsel', 'd.path'), '');
  assert.equal(privilegeFilter(RETIRED, 'd.path'), " AND d.path NOT LIKE '%privileged%'");
  assert.equal(privilegeFilter('intruder' as Role), " AND path NOT LIKE '%privileged%'", 'an unknown role is filtered');
  const { sqlite } = testDb();
  sqlite.exec('CREATE TABLE p (path TEXT NOT NULL)');
  const paths = [
    'x/PRIVILEGED/a.pdf', 'x/privileged/a.pdf', 'x/PrIvIlEgEd-notes/a.pdf', 'x/a-PRIVILEGED.pdf', 'x/a.pdf', 'PRIVILEGED',
    'x/PRIVILEGE/a.pdf', 'x/P_RIVILEGED/a.pdf', 'x/PRİVILEGED/a.pdf', 'x/ＰＲＩＶＩＬＥＧＥＤ/a.pdf', 'x/privileged%/a.pdf', '',
  ];
  for (const path of paths) sqlite.prepare('INSERT INTO p (path) VALUES (?)').run(path);
  const kept = (sqlite.prepare(`SELECT path FROM p WHERE 1${privilegeFilter(RETIRED)}`).all() as { path: string }[]).map((r) => r.path);
  assert.deepEqual(kept.sort(), paths.filter((path) => canSeeDocument(RETIRED, path)).sort());
  assert.equal(kept.length, 6, 'the six non-privileged spellings, including look-alikes neither form folds');
});

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
const PRIVILEGED_IDS = ['call', 'mail', 'named', 'guide', 'up-priv'];

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

function treeIds(node: FolderNode): { ids: string[]; folders: string[] } {
  const ids = [...node.files.map((f) => f.id), ...(node.guide ? [node.guide.id] : [])];
  const folders = [node.path];
  for (const child of node.folders) {
    const below = treeIds(child);
    ids.push(...below.ids);
    folders.push(...below.folders);
  }
  return { ids, folders };
}

test('/api/documents: owner and counsel see the whole room, privileged folders, files and uploads included', async () => {
  for (const role of ROLES) {
    const res = await room(role).get('/api/documents');
    assert.equal(res.status, 200, role);
    const { root } = (await res.json()) as { root: FolderNode };
    const { ids, folders } = treeIds(root);
    assert.deepEqual(ids.sort(), ROOM.map((d) => d.id).sort(), role);
    assert.ok(folders.some((f) => /privileged/i.test(f)), role);
    assert.equal(root.count, ROOM.length, role);
  }
});

test('/api/doc/:id and /files/:id still serve owner and counsel every privileged document', async () => {
  for (const role of ['owner', 'counsel'] as const) {
    const r = room(role);
    for (const id of PRIVILEGED_IDS) {
      const meta = await r.get(`/api/doc/${id}`);
      assert.equal(meta.status, 200, `${role} /api/doc/${id}`);
      assert.equal(((await meta.json()) as { id: string }).id, id);
      const file = await r.get(`/files/${id}`, { 'Sec-Fetch-Dest': 'empty' });
      assert.equal(file.status, 200, `${role} /files/${id}`);
      assert.equal(await file.text(), `%PDFk-${id}`);
      assert.equal((await r.get(`/files/${id}?download`)).status, 200);
    }
  }
});

test('/api/uploads lists a privileged counsel upload for owner and counsel', async () => {
  for (const role of ROLES) {
    const res = await room(role).get('/api/uploads');
    const ids = ((await res.json()) as { uploads: { id: string }[] }).uploads.map((u) => u.id).sort();
    assert.deepEqual(ids, ['up-open', 'up-priv'], role);
  }
});

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const MATTER = readFileSync(join(FIXTURES, 'matter.example.json'), 'utf8');
// Every route above that lists, opens or cites a document, for the retired role.
const DOCUMENT_PATHS = [
  '/api/documents', '/api/doc/open', '/api/doc/call', '/files/open', '/files/call', '/files/call?download',
  '/api/uploads',
];

test('the gate refuses a family row left from before migration 0010 on every route, exactly as it refuses a stranger', async () => {
  const r = room('owner');
  addLeftoverFamily(r.sqlite, KIN);
  for (const path of ['/', '/api/me', ...DOCUMENT_PATHS]) {
    const stranger = await r.getAs('stranger@example.test', path);
    const family = await r.getAs(KIN, path);
    assert.equal(stranger.status, 403, path);
    assert.equal(family.status, 403, path);
    assert.equal(await family.text(), await stranger.text(), path);
  }
  assert.deepEqual(r.audited(), []);
});

test('past the gate, each document route refuses the retired role itself; a privileged file answers as a missing one', async () => {
  resetDocFactsCache();
  const r = room('owner', ROOM, { [MATTER_KEY]: MATTER });
  const read = { 'Sec-Fetch-Dest': 'empty' };
  const missing = await (await r.pastTheGate('/files/no-such-id', read)).text();
  for (const path of DOCUMENT_PATHS) {
    const res = await r.pastTheGate(path, read);
    if (path.startsWith('/files/call')) {
      // /files/:id filters privileged documents before its permission check (routes/files.ts serveFile).
      assert.equal(res.status, 404, path);
      assert.equal(await res.text(), missing, path);
    } else {
      assert.equal(res.status, 403, path);
      assert.deepEqual(await res.json(), { error: 'forbidden' }, path);
    }
  }
  assert.deepEqual(r.audited(), []);
});
