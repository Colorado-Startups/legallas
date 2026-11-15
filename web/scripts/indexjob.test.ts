// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSync, kindOf, type DocumentRow } from './diff.ts';
import { EXTRACTOR_VERSION, PLAIN_TEXT_VERSION, RENDER_VERSION } from './extract.ts';
import { indexWork, withRoomRecord, isDraft, syncIndex, type BuiltIndex, type IndexManifest } from './indexjob.ts';
import { fallbackPartCount } from './indexparts.ts';
import type { SnapshotFile } from './snapshot.ts';
import type { Wrangler } from './wrangler.ts';

// Synthetic documents only: invented names and hashes, no case text.
const DOCS = [
  { id: 'doc-pdf', rel: 'a/scan.pdf', sha: 'a' },
  { id: 'doc-png', rel: 'a/photo.png', sha: 'b' },
  { id: 'doc-md', rel: 'a/notes.md', sha: 'c' },
];

function file(rel: string, sha: string): SnapshotFile {
  return { rel, abs: `/src/${rel}`, size: 1000, mtimeMs: 0, dev: 1, ino: 1, snapshot: `/snap/${rel}`, sha256: sha.repeat(64) };
}

function row(id: string, rel: string, sha: string): DocumentRow {
  return { id, path: rel, sha256: sha.repeat(64), size: 1000, kind: kindOf(rel).kind, pages: null, r2_key: `key-${id}`, source: 'mirror' };
}

/** D1 holds DOCS; on disk, the PDF's content is `pdfSha` (its D1 sha when unchanged). */
function plan(pdfSha = 'a') {
  return diffSync(
    DOCS.map((doc) => file(doc.rel, doc.id === 'doc-pdf' ? pdfSha : doc.sha)),
    DOCS.map((doc) => row(doc.id, doc.rel, doc.sha)),
  );
}

/** Two parts indexed per document; PDFs and images at `extractor` (none: written before versions), Markdown at today's reader. */
function manifestAt(extractor?: number): IndexManifest {
  const manifest: IndexManifest = {};
  for (const doc of DOCS) {
    const stamp = doc.id === 'doc-md' ? { text: PLAIN_TEXT_VERSION } : extractor === undefined ? {} : { extractor };
    manifest[doc.id] = { sha256: doc.sha.repeat(64), parts: 2, ...stamp };
  }
  return manifest;
}

function fakeWrangler(calls: string[]): Wrangler {
  return {
    target: 'remote',
    async d1Query() {
      return [];
    },
    async d1File() {},
    async r2Put(bucket, key) {
      calls.push(`put ${bucket}/${key}`);
    },
    async r2Get() {},
    async r2Delete(bucket, key) {
      calls.push(`delete ${bucket}/${key}`);
    },
    async aiSearchJobsAvailable() {
      return false;
    },
    async aiSearchJobCreate() {},
  };
}

/** Nothing could be built this run (for example the extractor is unavailable). */
const NOTHING_BUILT: BuiltIndex = { parts: new Map(), jobs: new Map(), pages: new Map(), skipped: 0 };

test('an indexed agent instruction file loses its parts and stays a mirrored document', () => {
  const rel = 'a/CLAUDE.md';
  const p = diffSync([...DOCS.map((doc) => file(doc.rel, doc.sha)), file(rel, 'd')], [...DOCS.map((doc) => row(doc.id, doc.rel, doc.sha)), row('doc-agent', rel, 'd')]);
  assert.deepEqual(p.unchanged.map((doc) => doc.id).sort(), ['doc-agent', 'doc-md', 'doc-pdf', 'doc-png'], 'the file itself is untouched');
  const work = indexWork(p, { ...manifestAt(EXTRACTOR_VERSION), 'doc-agent': { sha256: 'd'.repeat(64), parts: 3 } });
  assert.deepEqual(work.drops, [{ id: 'doc-agent', parts: 3 }]);
  assert.deepEqual(work.jobs, []);
});

test('a room data file (legallas-*.json, R6) loses its parts and stays a mirrored document', () => {
  const rel = 'Visuals/legallas-visuals.json';
  const p = diffSync([...DOCS.map((doc) => file(doc.rel, doc.sha)), file(rel, 'e')], [...DOCS.map((doc) => row(doc.id, doc.rel, doc.sha)), row('doc-room', rel, 'e')]);
  assert.ok(p.unchanged.some((doc) => doc.id === 'doc-room'), 'the file itself is untouched');
  const work = indexWork(p, { ...manifestAt(EXTRACTOR_VERSION), 'doc-room': { sha256: 'e'.repeat(64), parts: 2 } });
  assert.deepEqual(work.drops, [{ id: 'doc-room', parts: 2 }]);
  assert.deepEqual(work.jobs, []);
  const fresh = diffSync([file(rel, 'e')], []);
  assert.deepEqual(indexWork(fresh, {}).jobs, [], 'a new one is never indexed');
});

test('a saved draft is never indexed, so Ask never cites it as evidence; one already indexed loses its text', () => {
  const rel = 'Drafts/Harbor Labs side letter (draft).md';
  const fresh = diffSync([file(rel, 'f')], []);
  assert.deepEqual(indexWork(fresh, {}).jobs, [], 'a new draft is not indexed');
  const p = diffSync([...DOCS.map((doc) => file(doc.rel, doc.sha)), file(rel, 'f')], [...DOCS.map((doc) => row(doc.id, doc.rel, doc.sha)), row('doc-draft', rel, 'f')]);
  const work = indexWork(p, { ...manifestAt(EXTRACTOR_VERSION), 'doc-draft': { sha256: 'f'.repeat(64), parts: 2 } });
  assert.deepEqual(work.drops, [{ id: 'doc-draft', parts: 2 }]);
  assert.deepEqual([isDraft('drafts/a.md'), isDraft('a/Drafts/b.md'), isDraft('Drafts-old/c.md')], [true, false, false], 'only the top folder');
});

test('the room\'s record fills what this computer lacks and marks deleted text; this computer\'s own record stands otherwise', () => {
  const local: IndexManifest = { kept: { sha256: 'a'.repeat(64), parts: 2, text: 1 }, failed: { sha256: '', parts: 3 }, gone: { sha256: 'c'.repeat(64), parts: 1, text: 1 } };
  const room: IndexManifest = { kept: { sha256: 'a'.repeat(64), parts: 1, text: 1 }, failed: { sha256: 'b'.repeat(64), parts: 3, text: 1 }, gone: { sha256: '', parts: 0, text: 1 }, fresh: { sha256: 'd'.repeat(64), parts: 4, text: 1 } };
  assert.deepEqual(withRoomRecord(local, room), { kept: local.kept, failed: local.failed, gone: room.gone, fresh: room.fresh });
  // An empty cache and an unchanged folder: no job, so no text uploaded and none of the month spent (card 8.1).
  const p = diffSync(DOCS.map((doc) => file(doc.rel, doc.sha)), DOCS.map((doc) => row(doc.id, doc.rel, doc.sha)));
  assert.deepEqual(indexWork(p, withRoomRecord({}, manifestAt(EXTRACTOR_VERSION))).jobs, []);
});

/** Older invented iWork files, synced before any record: 1 GB each, so size alone implies hundreds of parts (#232). */
const BIG = 1_000_000_000;
function olderIwork() {
  const deck = { ...row('doc-deck', 'a/pitch.key', 'd'), size: BIG };
  const sheet = { ...row('doc-sheet', 'a/budget.numbers', 'e'), size: BIG };
  return diffSync([{ ...file('a/pitch.key', 'f'), size: BIG }], [deck, sheet]);
}

test('with the room\'s record, an older iWork file neither record knows deletes nothing (#232)', () => {
  const p = olderIwork();
  assert.deepEqual([p.changes.map((op) => op.id), p.removals.map((r) => r.id)], [['doc-deck'], ['doc-sheet']]);
  const work = indexWork(p, {}, {});
  assert.deepEqual(work.jobs.map((job) => [job.id, job.staleParts]), [['doc-deck', 0]], 'the changed deck has no old text to delete');
  assert.deepEqual(work.drops, [], 'the removed sheet has none either');
});

test('with the room\'s record, parts either record knows still delete (#232)', () => {
  const room: IndexManifest = { 'doc-deck': { sha256: 'd'.repeat(64), parts: 3 }, 'doc-sheet': { sha256: 'e'.repeat(64), parts: 2 } };
  const work = indexWork(olderIwork(), withRoomRecord({}, room), room);
  assert.deepEqual(work.jobs.map((job) => [job.id, job.staleParts]), [['doc-deck', 3]]);
  assert.deepEqual(work.drops, [{ id: 'doc-sheet', parts: 2 }]);
  const local: IndexManifest = { 'doc-sheet': { sha256: 'e'.repeat(64), parts: 4 } };
  assert.deepEqual(indexWork(olderIwork(), withRoomRecord(local, {}), {}).drops, [{ id: 'doc-sheet', parts: 4 }], 'this computer\'s record alone');
});

test('without the room\'s record, size still estimates an older iWork file\'s parts (#232)', () => {
  const work = indexWork(olderIwork(), {});
  assert.ok(fallbackPartCount(BIG) > 100);
  assert.deepEqual(work.jobs.map((job) => [job.id, job.staleParts]), [['doc-deck', fallbackPartCount(BIG)]]);
  assert.deepEqual(work.drops, [{ id: 'doc-sheet', parts: fallbackPartCount(BIG) }]);
});

test('an older extractor makes refresh jobs; a changed file does not', () => {
  const refresh = indexWork(plan(), manifestAt(EXTRACTOR_VERSION - 1)).jobs;
  assert.deepEqual(refresh.map((job) => [job.id, job.refresh]).sort(), [['doc-pdf', true], ['doc-png', true]]);
  const changed = indexWork(plan('f'), manifestAt(EXTRACTOR_VERSION)).jobs;
  assert.deepEqual(changed.map((job) => [job.id, job.refresh]), [['doc-pdf', undefined]]);
});

test('text is stale when this computer\'s record says the file changed, and not when it simply has no record', () => {
  const staleOf = (work: ReturnType<typeof indexWork>) => Object.fromEntries(work.jobs.map((job) => [job.id, job.stale]));
  // A new laptop: every document is a job, and the room's text is still good.
  assert.ok(Object.values(staleOf(indexWork(plan(), {}))).every((stale) => stale === undefined));
  assert.equal(staleOf(indexWork(plan('f'), {}))['doc-pdf'], true, 'changed in this very plan');
  assert.equal(staleOf(indexWork(plan('f'), manifestAt(EXTRACTOR_VERSION)))['doc-pdf'], true);
  // The record took a change, then the run stopped before saving this computer's record: the room matches, the record doesn't.
  const behind = { ...manifestAt(EXTRACTOR_VERSION), 'doc-pdf': { sha256: 'z'.repeat(64), parts: 2, extractor: EXTRACTOR_VERSION } };
  assert.deepEqual(staleOf(indexWork(plan(), behind)), { 'doc-pdf': true });
  const failedBefore = { ...manifestAt(EXTRACTOR_VERSION), 'doc-pdf': { sha256: '', parts: 2 } };
  assert.deepEqual(staleOf(indexWork(plan(), failedBefore)), { 'doc-pdf': true });
  // Same file, older extractor: the text still matches.
  assert.ok(Object.values(staleOf(indexWork(plan(), manifestAt(EXTRACTOR_VERSION - 1)))).every((stale) => stale === undefined));
});

test('a refresh whose text cannot be built keeps its old parts and manifest entry, and retries', async () => {
  for (const older of [EXTRACTOR_VERSION - 1, undefined]) {
    const manifest = manifestAt(older);
    const before = structuredClone(manifest);
    const { jobs } = indexWork(plan(), manifest);
    const calls: string[] = [];
    await syncIndex(fakeWrangler(calls), jobs, NOTHING_BUILT, [], manifest, () => {});
    assert.deepEqual(calls, [], 'no index object is deleted while the old text still matches the file');
    assert.deepEqual(manifest, before);
    assert.equal(indexWork(plan(), manifest).jobs.length, 2, 'retried next run');
  }
});

test('a changed PDF whose text cannot be built still loses its old text', async () => {
  const manifest = manifestAt(EXTRACTOR_VERSION);
  const { jobs } = indexWork(plan('f'), manifest);
  const calls: string[] = [];
  await syncIndex(fakeWrangler(calls), jobs, NOTHING_BUILT, [], manifest, () => {});
  assert.deepEqual(calls.sort(), ['delete legallas-index/text/doc-pdf.p1.md', 'delete legallas-index/text/doc-pdf.p2.md']);
  assert.equal(manifest['doc-pdf'], undefined);
});

test('unchanged XML indexed before its text was rendered is indexed again once; Markdown is not', async () => {
  const rel = 'a/Repair-Log__20120907__Tally-Payroll.xml';
  const files = [...DOCS.map((doc) => file(doc.rel, doc.sha)), file(rel, 'f')];
  const rows = [...DOCS.map((doc) => row(doc.id, doc.rel, doc.sha)), row('doc-xml', rel, 'f')];
  const manifest: IndexManifest = { ...manifestAt(EXTRACTOR_VERSION), 'doc-xml': { sha256: 'f'.repeat(64), parts: 1 } };
  const { jobs } = indexWork(diffSync(files, rows), manifest);
  assert.deepEqual(jobs.map((job) => [job.id, job.name, job.refresh]), [['doc-xml', 'Repair-Log__20120907__Tally-Payroll.xml', true]]);
  const built: BuiltIndex = { parts: new Map([['doc-xml', ['/work/doc-xml.p1.md']]]), jobs: new Map([['doc-xml', jobs[0]!]]), pages: new Map(), skipped: 0 };
  const calls: string[] = [];
  await syncIndex(fakeWrangler(calls), jobs, built, [], manifest, () => {});
  assert.deepEqual(calls, ['put legallas-index/text/doc-xml.p1.md']);
  assert.deepEqual(manifest['doc-xml'], { sha256: 'f'.repeat(64), parts: 1, render: RENDER_VERSION });
  assert.equal(manifest['doc-md']?.render, undefined, 'Markdown records no render version');
  assert.deepEqual(indexWork(diffSync(files, rows), manifest).jobs, [], 'nothing left to do next run');
  manifest['doc-xml'] = { ...manifest['doc-xml']!, render: RENDER_VERSION - 1 };
  assert.deepEqual(indexWork(diffSync(files, rows), manifest).jobs.map((job) => job.id), ['doc-xml'], 'an older rendering is redone');
});

test('text indexed as it is goes again once when its reader changes, so a UTF-16 file in the room is put right', async () => {
  const manifest = manifestAt(EXTRACTOR_VERSION);
  delete manifest['doc-md']!.text;
  const { jobs } = indexWork(plan(), manifest);
  assert.deepEqual(jobs.map((job) => [job.id, job.refresh]), [['doc-md', true]]);
  const built: BuiltIndex = { parts: new Map([['doc-md', ['/work/doc-md.p1.md', '/work/doc-md.p2.md']]]), jobs: new Map([['doc-md', jobs[0]!]]), pages: new Map(), skipped: 0 };
  await syncIndex(fakeWrangler([]), jobs, built, [], manifest, () => {});
  assert.equal(manifest['doc-md']?.text, PLAIN_TEXT_VERSION);
  assert.deepEqual(indexWork(plan(), manifest).jobs, [], 'once');
});
