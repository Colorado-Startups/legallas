// SPDX-License-Identifier: Apache-2.0
// GET /api/matter through the real gate (index.ts) on real SQLite with the real migrations, and a fake R2 that
// honours conditional gets so the per-isolate etag cache is exercised.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Env } from './env.ts';
import { handle } from './index.ts';
import { MATTER_KEY, type ServedMatter } from './matter-types.ts';
import { resetMatterCache } from './routes/matter.ts';
import { testDb } from './sqlite-d1.ts';

const HOST = 'http://localhost:8789';
const OWNER = 'founder@example.test';
const COUNSEL = 'ada@firm.example';
const GUEST = 'guest@example.test';
const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const MATTER = readFileSync(join(FIXTURES, 'matter.example.json'), 'utf8');
const IDS = JSON.parse(readFileSync(join(FIXTURES, 'doc-ids.json'), 'utf8')) as Record<string, string>;
const REMOVED_PATH = Object.keys(IDS).find((p) => p.includes('Vesting-terms'))!;

beforeEach(() => resetMatterCache());

/** A fake legallas-files bucket holding at most the matter file; counts full downloads. */
function bucket(body: string | null) {
  const state = { body, etag: 'e1', downloads: 0 };
  const files = {
    async get(key: string, options?: R2GetOptions) {
      if (key !== MATTER_KEY || state.body === null) return null;
      const unchanged = (options?.onlyIf as R2Conditional | undefined)?.etagDoesNotMatch === state.etag;
      if (unchanged) return { key, etag: state.etag };
      state.downloads++;
      const text = state.body;
      return { key, etag: state.etag, body: new Response(text).body, text: async () => text };
    },
  };
  return { files, state };
}

function room(matter: string | null, signedInAs = OWNER) {
  const { db, sqlite } = testDb();
  sqlite.exec(`INSERT INTO members (email, role, name) VALUES ('${OWNER}', 'owner', 'Founder'), ('${COUNSEL}', 'counsel', NULL)`);
  sqlite.exec('PRAGMA ignore_check_constraints = ON');
  sqlite.exec(`INSERT INTO members (email, role) VALUES ('${GUEST}', 'guest')`);
  sqlite.exec('PRAGMA ignore_check_constraints = OFF');
  const insert = sqlite.prepare(
    "INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at, removed_at) VALUES (?1, ?2, '', ?2, 'pdf', 'application/pdf', 1, ?3, 'mirror', '2026-01-01', ?4)",
  );
  for (const [path, id] of Object.entries(IDS)) insert.run(id, path, `k-${id}`, path === REMOVED_PATH ? '2026-02-01' : null);

  const queries: string[] = [];
  const counted = { prepare: (sql: string) => (queries.push(sql), db.prepare(sql)) } as unknown as D1Database;
  const { files, state } = bucket(matter);
  const env = {
    ASSETS: { fetch: async () => new Response('shell') },
    DB: counted,
    FILES: files,
    TEAM_DOMAIN: '',
    ACCESS_AUD: '',
    ALLOW_DEV_IDENTITY: '1',
    DEV_IDENTITY_EMAIL: signedInAs,
  } as unknown as Env;
  const get = () => handle(new Request(`${HOST}/api/matter`), env, {} as ExecutionContext);
  const documentQueries = () => queries.filter((q) => q.includes('FROM documents'));
  return { sqlite, state, get, documentQueries };
}

/** The schema before migration 0003 (card F3): no control_seq column. The route must still serve. */
function withoutControlNumbers(sqlite: ReturnType<typeof testDb>['sqlite']) {
  sqlite.exec('DROP INDEX documents_control_seq; ALTER TABLE documents DROP COLUMN control_seq');
}

/** What 0003's backfill does: number the rows in path order. */
function numberDocuments(sqlite: ReturnType<typeof testDb>['sqlite']) {
  sqlite.exec('UPDATE documents SET control_seq = (SELECT COUNT(*) FROM documents d2 WHERE d2.path <= documents.path)');
}

test('404 not_built before the first publish', async () => {
  const res = await room(null).get();
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'not_built' });
});

test('serves the live matter, dropping the removed document, with null numbers before migration 0003', async () => {
  const { get, sqlite, documentQueries } = room(MATTER);
  withoutControlNumbers(sqlite);
  const res = await get();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Security-Policy') ?? '', /default-src 'none'/);
  const body = (await res.json()) as ServedMatter;
  assert.equal(body.meta.caption, 'Doe v. Harbor Labs, Inc.');
  assert.equal(body.docs[IDS[REMOVED_PATH]!], undefined);
  assert.equal(body.events.length, 49);
  assert.ok(body.events.every((e) => e.cites.every((c) => c.control === null)));
  assert.equal(documentQueries().length, 2, 'the control_seq query fails over once to the pre-0003 query');
});

test('joins control numbers in one query once migration 0003 has numbered the rows', async () => {
  const { get, sqlite, documentQueries } = room(MATTER);
  numberDocuments(sqlite);
  const body = (await (await get()).json()) as ServedMatter;
  const cite = body.events[0]!.cites[0]!;
  const seq = sqlite.prepare('SELECT control_seq FROM documents WHERE id = ?1').get(cite.doc) as { control_seq: number };
  assert.equal(cite.control, seq.control_seq);
  assert.equal(body.docs[cite.doc]!.control, seq.control_seq);
  assert.deepEqual(documentQueries(), ["SELECT id, control_seq FROM documents WHERE removed_at IS NULL AND name NOT GLOB 'legallas-*.json'"]);
});

test('a cite to a room data file (legallas-*.json) is dropped like a removed document', async () => {
  const { get, sqlite } = room(MATTER);
  numberDocuments(sqlite);
  const before = (await (await get()).json()) as ServedMatter;
  const hidden = before.events.flatMap((e) => e.cites.map((c) => c.doc))[0]!;
  sqlite.prepare("UPDATE documents SET name = 'legallas-visuals.json' WHERE id = ?1").run(hidden);
  resetMatterCache();
  const body = (await (await get()).json()) as ServedMatter;
  assert.equal(body.docs[hidden], undefined);
  assert.ok(body.events.every((e) => e.cites.every((c) => c.doc !== hidden)));
});

test('the parsed file is cached by etag; the live documents are read on every request', async () => {
  const { get, sqlite, state } = room(MATTER);
  await get();
  sqlite.exec(`UPDATE documents SET removed_at = '2026-03-01' WHERE path LIKE '%Acceleration-questions%'`);
  const second = (await (await get()).json()) as ServedMatter;
  assert.equal(state.downloads, 1, 'unchanged etag: no second download');
  assert.equal(second.events.length, 48, 'a document removed since the last request is gone at once');

  const next = JSON.parse(MATTER);
  next.meta.caption = 'Doe v. Harbor Labs, Inc., et al.';
  state.body = JSON.stringify(next);
  state.etag = 'e2';
  const third = (await (await get()).json()) as ServedMatter;
  assert.equal(state.downloads, 2);
  assert.equal(third.meta.caption, 'Doe v. Harbor Labs, Inc., et al.');

  state.body = null;
  assert.equal((await get()).status, 404, 'an unpublished file is not served from the cache');
});

test('a bad file is a 500 with the reason for the owner only', async () => {
  const future = JSON.parse(MATTER);
  future.events[0].type = 'deadline';
  const owner = await room(JSON.stringify(future)).get();
  assert.equal(owner.status, 500);
  assert.match(((await owner.json()) as { detail?: string }).detail ?? '', /events\[0\]\.type is deadline/);

  resetMatterCache();
  const counsel = await room('not json', COUNSEL).get();
  assert.equal(counsel.status, 500);
  assert.deepEqual(await counsel.json(), { error: 'bad_matter' });
});

test('counsel may read the matter; a role without view may not', async () => {
  assert.equal((await room(MATTER, COUNSEL).get()).status, 200);
  resetMatterCache();
  assert.equal((await room(MATTER, GUEST).get()).status, 403);
});
