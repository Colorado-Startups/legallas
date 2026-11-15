// SPDX-License-Identifier: Apache-2.0
// Save-back (#65) through the room's real sync endpoints, on real SQLite and the real migrations, into a company folder
// of invented files: each approved agreement lands as one new file, and every other file stays byte for byte the same,
// with the same modified time, nowhere renamed, moved or deleted. Runs on Linux and on Windows (ci.yml sync-windows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handleSync } from './routes/sync.ts';
import { CLIENT, ORIGIN, OWNER, syncRoom, type SyncRoom } from './sync-fixtures.ts';
import type { Env } from './env.ts';
import { diffSync, type DocumentRow } from '../scripts/diff.ts';
import { guardWalk } from '../scripts/guard.ts';
import { DRAFTS_FOLDER, formatSaveBack, roomDrafts, saveBack, type Draft, type DraftSource } from '../scripts/saveback.ts';

const COUNSEL = 'counsel@example.test';
const SINCE = '2026-10-01T00:00:00Z';
const ON = { PROPOSALS_ENABLED: '1', SAVE_BACK_SINCE: SINCE };
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** The room's endpoints as the laptop's client calls them: the token's client id, the lease, no browser headers. */
function requester(room: SyncRoom, lease: string | null) {
  return async (method: string, route: string, body?: unknown): Promise<Response> => {
    const headers = new Headers(lease ? { 'X-Sync-Lease': lease } : {});
    const text = body === undefined ? undefined : JSON.stringify(body);
    if (text !== undefined) headers.set('Content-Type', 'application/json');
    const url = `${ORIGIN}${route}`;
    return handleSync(new Request(url, { method, headers, body: text }), room.env, new URL(url), CLIENT);
  };
}

async function state(room: SyncRoom): Promise<{ rows: unknown[]; drafts?: Draft[] }> {
  return (await (await requester(room, null)('GET', '/api/sync/state')).json()) as { rows: unknown[]; drafts?: Draft[] };
}

async function lease(room: SyncRoom): Promise<string> {
  const response = await requester(room, null)('POST', '/api/sync/lease', { device: 'laptop one' });
  assert.equal(response.status, 201);
  return ((await response.json()) as { lease: string }).lease;
}

/** A sync run's save-back step: take the lease, read the drafts waiting, save them back, give the lease back. */
async function syncWithSaveBack(room: SyncRoom, folder: string, wrap: (source: DraftSource) => DraftSource = (source) => source) {
  const held = await lease(room);
  const drafts = (await state(room)).drafts ?? [];
  const result = await saveBack(drafts, wrap(roomDrafts(requester(room, held))), folder, () => undefined);
  await requester(room, held)('DELETE', '/api/sync/lease');
  return result;
}

function propose(room: SyncRoom, id: string, title: string, by: string, status: 'pending' | 'approved' | 'rejected', decidedAt = '2026-10-30T10:00:00.000Z') {
  const decided = status === 'pending' ? [null, null, null] : [by, decidedAt, `decision-${id}`];
  room.sqlite
    .prepare(
      'INSERT INTO proposals (id, kind, status, title, why, body, proposed_by, via, client_kind, created_at, expires_at, decided_by, decided_at, decision_id, reject_reason) ' +
        "VALUES (?, 'draft_document', ?, ?, 'Invented for a test.', ?, ?, 'Claude', 'claude', '2026-09-14T09:00:00.000Z', '2026-12-28T09:00:00.000Z', ?, ?, ?, ?)",
    )
    .run(id, status, title, `The invented text of ${title}.`, by, ...decided, status === 'rejected' ? 'not_needed' : null);
}

const APPROVED = '11111111-1111-4111-8111-111111111111';
const PENDING = '22222222-2222-4222-8222-222222222222';
const REJECTED = '33333333-3333-4333-8333-333333333333';
const COUNSELS = '44444444-4444-4444-8444-444444444444';
const EARLY = '55555555-5555-4555-8555-555555555555';
const EVICTED = '66666666-6666-4666-8666-666666666666';
const PRIVATE = '77777777-7777-4777-8777-777777777777';
const LOCK = '88888888-8888-4888-8888-888888888888';

function roomWithDrafts(overrides: Record<string, string> = ON): SyncRoom {
  const room = syncRoom(overrides as Partial<Env>);
  propose(room, APPROVED, 'Founder Stock Purchase Agreement', OWNER, 'approved');
  propose(room, PENDING, 'Advisor Agreement', OWNER, 'pending');
  propose(room, REJECTED, 'Consulting Agreement', OWNER, 'rejected');
  propose(room, COUNSELS, 'Counsel Memo', COUNSEL, 'approved');
  propose(room, EARLY, 'Approved Before Save-back', OWNER, 'approved', '2026-09-15T10:00:00.000Z');
  propose(room, EVICTED, 'Board Consent', OWNER, 'approved');
  propose(room, PRIVATE, 'Series_Private Placement', OWNER, 'approved');
  propose(room, LOCK, '~$Term Sheet', OWNER, 'approved');
  return room;
}

/**
 * A company folder of invented files, all dated in the past: a draft of the same name already in Drafts/, and one
 * that iCloud holds only in the cloud, which shows on disk as its placeholder.
 */
async function companyFolder(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'legallas-saveback-'));
  const files: Record<string, string> = {
    'Formation/Certificate of Incorporation.pdf': '%PDF-1.4 invented',
    'Formation/Bylaws.docx': 'PK invented bylaws',
    'Equity/Cap table.csv': 'holder,shares\nFounder A,4000000\n',
    'Drafts/Founder Stock Purchase Agreement.md': '# My own draft, not from the room\n',
    'Drafts/.Board Consent.md.icloud': 'invented placeholder',
    'Notes.txt': 'invented notes',
  };
  const past = new Date('2026-01-15T08:00:00Z');
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), text);
    await utimes(path.join(root, rel), past, past);
  }
  return root;
}

interface Entry {
  sha256: string;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
}

/** Every file under `root`: its bytes' hash, size, modified and changed times, and inode. */
async function manifest(root: string): Promise<Map<string, Entry>> {
  const out = new Map<string, Entry>();
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    const stat = await lstat(file);
    out.set(path.relative(root, file).split(path.sep).join('/'), { sha256: sha(await readFile(file)), size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino });
  }
  return out;
}

/** What the next sync reads: the guard's walk (which throws on anything it refuses), hashed. */
async function walk(root: string) {
  const { files } = await guardWalk(root, async () => null);
  return Promise.all(files.map(async (file) => ({ rel: file.rel, size: file.size, sha256: sha(await readFile(file.abs)) })));
}

const SAVED = ['Founder Stock Purchase Agreement (2).md', 'Board Consent (2).md', 'Series Private Placement.md', 'Term Sheet.md'].map((name) => `${DRAFTS_FOLDER}/${name}`);

test('a sync saves each approved agreement back as one new file, and every other file stays exactly as it was', async (t) => {
  const room = roomWithDrafts();
  const folder = await companyFolder();
  t.after(() => rm(folder, { recursive: true, force: true }));
  const before = await manifest(folder);
  const walkedBefore = await walk(folder);

  // The dry run lists them: the owner's own drafts approved since save-back started, and nothing else.
  const offered = (await state(room)).drafts ?? [];
  assert.deepEqual(offered.map((draft) => draft.id), [APPROVED, EVICTED, PRIVATE, LOCK]);
  assert.deepEqual(formatSaveBack(offered).slice(0, 2), ['Save back 4 approved drafts to Drafts/ as new files:', '  save back  Founder Stock Purchase Agreement.md']);
  assert.deepEqual(await manifest(folder), before, 'listing changes nothing');

  assert.deepEqual(await syncWithSaveBack(room, folder), { saved: 4, failed: 0 });
  const after = await manifest(folder);
  for (const [rel, entry] of before) assert.deepEqual(after.get(rel), entry, `${rel} is byte for byte the same, same times, same file`);
  // A taken name, and one iCloud holds in the cloud, get new names; a title the guard would refuse or skip gets a plain one.
  assert.deepEqual([...after.keys()].filter((rel) => !before.has(rel)).sort(), [...SAVED].sort());
  const text = await readFile(path.join(folder, SAVED[0]!), 'utf8');
  assert.match(text, /^> Draft proposed through Claude as founder@example\.test on 2026-09-14, approved by founder@example\.test on 2026-10-30\. A draft\. You aren't receiving legal advice from a licensed lawyer/);
  assert.match(text, /\n# Founder Stock Purchase Agreement\n\nThe invented text of Founder Stock Purchase Agreement\.\n$/);

  // Marked once each, by sync, with a code and no text; then neither offered nor readable again.
  const events = room.sqlite.prepare("SELECT proposal_id, actor_email, detail_code FROM proposal_events WHERE action = 'applied' ORDER BY proposal_id").all();
  assert.deepEqual(events.map((row) => ({ ...row })), [APPROVED, EVICTED, PRIVATE, LOCK].map((id) => ({ proposal_id: id, actor_email: 'sync@local', detail_code: 'saved_to_folder' })));
  assert.deepEqual((await state(room)).drafts, []);
  const held = await lease(room);
  for (const id of [APPROVED, PENDING, REJECTED, COUNSELS, EARLY]) {
    assert.equal((await requester(room, held)('GET', `/api/sync/drafts/${id}`)).status, 404, `${id} is not the token's to read`);
  }

  // A repeated sync writes nothing.
  assert.deepEqual(await syncWithSaveBack(room, folder), { saved: 0, failed: 0 });
  assert.deepEqual(await manifest(folder), after);

  // The next sync's plan, with the room mirroring the folder as it was: the guard takes every new file, and they are
  // exactly the adds, so each flows in once.
  const rows: DocumentRow[] = walkedBefore.map((file, i) => ({ id: `doc-${i}`, path: file.rel, sha256: file.sha256, size: file.size, kind: 'file', pages: null, r2_key: `key-${i}`, source: 'mirror', removed_at: null }));
  const plan = diffSync(await walk(folder), rows);
  assert.deepEqual(plan.adds.map((op) => op.path).sort(), [...SAVED].sort());
  assert.equal(plan.changes.length + plan.renames.length + plan.removals.length, 0);
});

test('a file that appears in Drafts/ during a run is never written over', async (t) => {
  const room = roomWithDrafts();
  const folder = await companyFolder();
  t.after(() => rm(folder, { recursive: true, force: true }));
  const arrived = path.join(folder, DRAFTS_FOLDER, 'Founder Stock Purchase Agreement (2).md');
  // After the run has listed Drafts/, another device's copy of the same name syncs down.
  const late = (source: DraftSource): DraftSource => ({
    ...source,
    read: async (id) => {
      if (id === APPROVED) await writeFile(arrived, 'arrived during the run');
      return source.read(id);
    },
  });
  assert.deepEqual(await syncWithSaveBack(room, folder, late), { saved: 4, failed: 0 });
  assert.equal(await readFile(arrived, 'utf8'), 'arrived during the run');
  assert.match(await readFile(path.join(folder, DRAFTS_FOLDER, 'Founder Stock Purchase Agreement (3).md'), 'utf8'), /# Founder Stock Purchase Agreement/);
});

test('an interrupted save-back never writes a draft twice, and leaves no temporary file', async (t) => {
  const room = roomWithDrafts();
  const folder = await companyFolder();
  t.after(() => rm(folder, { recursive: true, force: true }));
  const before = await manifest(folder);
  const lost = (source: DraftSource): DraftSource => ({ ...source, markSaved: async () => Promise.reject(new Error('connection reset')) });
  await assert.rejects(syncWithSaveBack(room, folder, lost), /connection reset/);
  const written = await manifest(folder);
  assert.equal(written.size, before.size + 4);
  assert.deepEqual([...written.keys()].filter((rel) => path.basename(rel).startsWith('.legallas-save-')), []);

  // The room never heard, so it offers the drafts again; their bytes are already there, so they are marked, not written.
  assert.deepEqual(await syncWithSaveBack(room, folder), { saved: 4, failed: 0 });
  assert.deepEqual(await manifest(folder), written);
  assert.deepEqual((await state(room)).drafts, []);
});

test('until proposals are on and SAVE_BACK_SINCE is set, the room offers no drafts and the folder is untouched', async (t) => {
  const offs: Record<string, string>[] = [{}, { PROPOSALS_ENABLED: '1' }, { SAVE_BACK_SINCE: SINCE }, { PROPOSALS_ENABLED: '1', SAVE_BACK_SINCE: 'soon' }];
  for (const overrides of offs) {
    const room = roomWithDrafts(overrides);
    const folder = await companyFolder();
    t.after(() => rm(folder, { recursive: true, force: true }));
    const before = await manifest(folder);
    assert.equal('drafts' in (await state(room)), false, 'the state is exactly as before');
    const held = await lease(room);
    assert.equal((await requester(room, held)('GET', `/api/sync/drafts/${APPROVED}`)).status, 404);
    assert.equal((await requester(room, held)('POST', '/api/sync/drafts', { ids: [APPROVED] })).status, 404);
    await requester(room, held)('DELETE', '/api/sync/lease');
    assert.deepEqual(await syncWithSaveBack(room, folder), { saved: 0, failed: 0 });
    assert.deepEqual(await manifest(folder), before);
    assert.equal(room.sqlite.prepare("SELECT count(*) AS n FROM proposal_events WHERE action = 'applied'").get()!.n, 0);
  }
});
