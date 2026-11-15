// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCoverageArgs } from './coverage.ts';
import { formatCounts, renderMarkdown, summarize, type SummaryExtras } from './coverage-report.ts';
import { buildCoverage, indexability, parseIndexKeys, textGroups, textStats, type CoverageInputs, type DocRow, type RoomFile, type TextStats } from './coverage-table.ts';
import { EXTRACTOR_VERSION } from './extract.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha = (c: string) => c.repeat(64);
const doc = (n: number, docPath: string, fileSha: string | null, extra: Partial<DocRow> = {}): DocRow => ({
  id: id(n), path: docPath, name: docPath.split('/').pop()!, sha256: fileSha, size: 10, kind: 'pdf', pages: 1, r2_key: `key-${n}`,
  source: 'mirror', control_seq: n, removed_at: null, ...extra,
});
const stats = (hash: string | null, pages = 1, ocr = 0): TextStats => ({ version: EXTRACTOR_VERSION, pages, blankPages: hash ? 0 : pages, ocrPages: ocr, chars: Array(pages).fill(hash ? 500 : 0), textHash: hash });
const file = (rel: string, c: string): RoomFile => ({ rel, size: 10, sha256: sha(c), md5: `md5-${c}` });

function fixture(): { inputs: CoverageInputs; extras: SummaryExtras } {
  const room = [
    file('A/ok.pdf', 'a'), file('A/new.pdf', 'b'), file('A/changed.pdf', 'c'), file('B/lost.md', 'd'), file('B/bundle.zip', 'e'),
    file('B/CLAUDE.md', 'f'), file('B/legallas-visuals.json', '1'), file('C/copy1.pdf', '2'), file('C/copy2.pdf', '3'), file('A/scan.pdf', '4'),
  ];
  const rows = [
    doc(1, 'A/ok.pdf', sha('a')), doc(3, 'A/changed.pdf', sha('9')), doc(4, 'B/lost.md', sha('d'), { kind: 'markdown' }),
    doc(5, 'B/bundle.zip', sha('e'), { kind: 'file' }), doc(6, 'B/CLAUDE.md', sha('f'), { kind: 'markdown' }), doc(7, 'B/legallas-visuals.json', sha('1'), { kind: 'text' }),
    doc(8, 'C/copy1.pdf', sha('2')), doc(9, 'C/copy2.pdf', sha('3')), doc(10, 'A/scan.pdf', sha('4')), doc(11, 'gone.pdf', sha('5')),
    doc(12, 'from-counsel/x/up.pdf', null, { source: 'counsel' }), doc(13, 'old.pdf', sha('6'), { removed_at: '2026-01-01T00:00:00Z' }),
  ];
  const indexed = [1, 3, 4, 8, 9, 10];
  const indexKeys = [...indexed.map((n) => `text/${id(n)}.p1.md`), `text/${id(13)}.p1.md`, `text/${id(13)}.p2.md`, 'catalog.json'];
  const aiItems = new Map(indexKeys.filter((key) => !key.includes(id(4))).map((key) => [key, { status: 'completed', chunks: 3 }]));
  const manifest = Object.fromEntries([
    [id(1), { sha256: sha('a'), parts: 1, extractor: EXTRACTOR_VERSION }],
    [id(3), { sha256: sha('9'), parts: 1, extractor: EXTRACTOR_VERSION }],
    [id(4), { sha256: sha('d'), parts: 1 }],
    [id(8), { sha256: sha('2'), parts: 1, extractor: EXTRACTOR_VERSION }],
    [id(9), { sha256: sha('3'), parts: 1, extractor: EXTRACTOR_VERSION - 1 }],
    [id(10), { sha256: sha('4'), parts: 1, extractor: EXTRACTOR_VERSION }],
    [id(13), { sha256: sha('6'), parts: 2, extractor: EXTRACTOR_VERSION }],
  ]);
  const text = new Map([
    ['A/ok.pdf', stats('h1')], ['A/changed.pdf', stats('h3')], ['B/lost.md', stats('h4')], ['C/copy1.pdf', stats('same')], ['C/copy2.pdf', stats('same')], ['A/scan.pdf', stats(null, 2, 2)],
  ]);
  const catalog = new Map(room.filter((f) => f.rel !== 'A/new.pdf').map((f) => [f.rel, { md5: f.rel === 'A/changed.pdf' ? 'old' : f.md5, size: 10, privileged: f.rel.startsWith('C/'), summary: 'A summary.' }]));
  const inputs: CoverageInputs = {
    prefix: 'DOE', room, outside: [{ rel: 'loose.pdf', sha256: sha('a') }, { rel: 'other.pdf', sha256: sha('7') }, { rel: 'CLAUDE.md', sha256: sha('8') }],
    privateShas: new Set([sha('3')]), rows, filesKeys: new Set([...rows.filter((r) => r.id !== id(4)).map((r) => r.r2_key), 'meta/matter.json']), indexKeys, aiItems, manifest, text, catalog,
    audit: new Map([[id(1), { view: 4, download: 1 }]]), cites: new Map([[id(1), 2]]), retrieved: new Map([[id(8), 3]]),
  };
  const extras: SummaryExtras = { rows, filesKeys: inputs.filesKeys, indexKeys, aiItems, manifest, privateFiles: 5, foldersNotRead: 2, retrievalFiles: 1 };
  return { inputs, extras };
}

const byPath = (inputs: CoverageInputs) => new Map(buildCoverage(inputs).map((row) => [`${row.zone}:${row.path}`, row]));

test('a document in every place is OK, with its control number, audit, cites and retrievals', () => {
  const row = byPath(fixture().inputs).get('room:A/ok.pdf')!;
  assert.equal(row.status, 'OK');
  assert.equal(row.control, 'DOE-000001');
  assert.deepEqual([row.inD1, row.inFiles, row.shaMatch, row.indexable, row.indexParts], [true, true, true, true, 1]);
  assert.deepEqual(row.manifest, { parts: 1, version: EXTRACTOR_VERSION, fresh: true });
  assert.deepEqual(row.ai, { items: 1, completed: 1, chunks: 3 });
  assert.deepEqual([row.catalog, row.cited, row.audit.view], ['fresh', 2, 4]);
});

test('each missing place is a gap with its reason', () => {
  const rows = byPath(fixture().inputs);
  assert.deepEqual(rows.get('room:A/new.pdf')!.reasons, ['not in D1']);
  assert.deepEqual(rows.get('room:A/changed.pdf')!.reasons, ['D1 sha differs (sync pending)', 'index manifest stale']);
  assert.deepEqual(rows.get('room:B/lost.md')!.reasons, ['missing from legallas-files', 'not in AI Search']);
  assert.deepEqual(rows.get('room:B/bundle.zip')!.reasons, ['.zip not indexable']);
  assert.deepEqual(rows.get('room:C/copy2.pdf')!.reasons, ['indexed by an older extractor']);
  assert.deepEqual(rows.get('room:A/scan.pdf')!.reasons, ['no text']);
  assert.deepEqual(rows.get('d1-only:gone.pdf')!.reasons, ['not on disk (sync removes it)']);
  assert.ok(rows.get('room:A/changed.pdf')!.notes.includes('catalog md5 stale'));
  assert.ok(rows.get('room:A/new.pdf')!.notes.includes('no catalog row'));
});

test('agent files, room data files and counsel uploads are left out of the index by design', () => {
  const rows = byPath(fixture().inputs);
  assert.equal(rows.get('room:B/CLAUDE.md')!.status, 'OK');
  assert.equal(rows.get('room:B/CLAUDE.md')!.indexable, 'agent file');
  assert.equal(rows.get('room:B/legallas-visuals.json')!.indexable, 'room data file');
  const upload = rows.get('counsel:from-counsel/x/up.pdf')!;
  assert.deepEqual([upload.status, upload.indexable, upload.control], ['OK', 'counsel upload', 'DOE-000012']);
});

test('identical text, private copies and privilege are notes, not gaps', () => {
  const rows = byPath(fixture().inputs);
  const one = rows.get('room:C/copy1.pdf')!;
  const two = rows.get('room:C/copy2.pdf')!;
  assert.deepEqual([one.textGroup, two.textGroup], ['T1', 'T1']);
  assert.equal(one.status, 'OK');
  assert.ok(two.notes.includes('private copy exists'));
  assert.ok(one.notes.includes('privileged'));
  assert.equal(one.retrieved, 3);
});

test('case-root files are matched to room copies by sha256 only', () => {
  const rows = byPath(fixture().inputs);
  assert.deepEqual(rows.get('case-root:loose.pdf')!.copies, ['DOE-000001']);
  assert.equal(rows.get('case-root:loose.pdf')!.status, 'OK');
  assert.deepEqual(rows.get('case-root:other.pdf')!.reasons, ['no room copy']);
  assert.equal(rows.get('case-root:CLAUDE.md')!.status, 'OK');
});

test('an unfindable probe result makes an indexed document a gap', () => {
  const { inputs } = fixture();
  const hit = { query: 'q', rank: 14, docRank: 5, twinRank: null, top: [] };
  const probe = new Map([[id(1), { summary: hit, passage: hit, unfindable: true, reason: 'buried' }]]);
  const row = byPath({ ...inputs, probe }).get('room:A/ok.pdf')!;
  assert.deepEqual([row.status, row.reasons], ['GAP', ['unfindable']]);
});

test('indexability follows the sync rules', () => {
  assert.equal(indexability('a/b.pdf', 'pdf'), true);
  assert.equal(indexability('a/b.svg', 'image'), '.svg not indexable');
  assert.equal(indexability('a/CLAUDE.md', 'markdown'), 'agent file');
  assert.equal(indexability('a/legallas-binder.json', 'text'), 'room data file');
  // Decision D8: a visual is indexed from its rendered text.
  assert.equal(indexability('a/b.html', 'visual'), true);
  assert.equal(indexability('a/b.docx', 'file'), true);
  assert.equal(indexability('07-Lawyer-Notes-PRIVILEGED/b.docx', 'file'), 'privileged office file');
  assert.equal(indexability('Drafts/consent.md', 'file'), 'saved draft');
  assert.equal(indexability('07-Lawyer-Notes-PRIVILEGED/b.pdf', 'pdf'), true);
  assert.equal(indexability('a/b.zip', 'file'), '.zip not indexable');
  for (const name of ['a/b.key', 'a/b.pages', 'a/b.numbers']) assert.equal(indexability(name, 'file'), true, name);
  assert.equal(indexability('07-Lawyer-Notes-PRIVILEGED/b.pages', 'file'), 'privileged office file');
});

test('text statistics count blank and OCR pages and fingerprint the normalized text', () => {
  const a = textStats([{ n: 1, text: 'Hello   world', ocr: false }, { n: 2, text: '  ', ocr: true }], 2);
  const b = textStats([{ n: 1, text: 'Hello world', ocr: true }, { n: 2, text: '', ocr: false }], 2);
  assert.deepEqual([a.pages, a.blankPages, a.ocrPages, a.chars], [2, 1, 1, [11, 0]]);
  assert.equal(a.textHash, b.textHash);
  assert.equal(textStats([{ n: 1, text: ' ', ocr: false }], null).textHash, null);
  const groups = textGroups([file('x', '1'), file('y', '2'), file('z', '3')], new Map([['x', a], ['y', b], ['z', stats('solo')]]));
  assert.deepEqual([...groups.values()], ['T1']);
});

test('index keys are parsed per document; anything else is counted apart', () => {
  const { parts, other } = parseIndexKeys([`text/${id(1)}.p1.md`, `text/${id(1)}.p2.md`, 'catalog.json', 'text/nope.md']);
  assert.deepEqual([parts.get(id(1)), other], [[1, 2], 2]);
});

test('the summary counts every place, the orphans and the gaps', () => {
  const { inputs, extras } = fixture();
  const s = summarize(buildCoverage(inputs), extras);
  assert.deepEqual(s.status.room, { OK: 4, GAP: 6 });
  assert.deepEqual([s.status['d1-only'].GAP, s.status.counsel.OK, s.status['case-root'].GAP], [1, 1, 1]);
  assert.deepEqual([s.room.files, s.room.inD1, s.room.inIndex, s.room.byDesign, s.room.notIndexable], [10, 9, 6, 2, 1]);
  assert.deepEqual(s.indexBucket, { keys: 9, docs: 7, live: 6, removed: 1, unknown: 0, orphanParts: 2, other: 1 });
  assert.deepEqual(s.d1, { live: 11, mirror: 10, counsel: 1, removed: 1 });
  assert.deepEqual(s.filesBucket, { keys: 12, live: 10, removedOnly: 1, unknown: 0, casePicture: 1, visualText: 0, visualTextOrphans: 0 });
  assert.equal(s.manifest.notLive, 1);
  assert.deepEqual(s.textGroups, { groups: 1, docs: 2 });
  assert.equal(s.reasons['not in D1'], 1);
});

test('the terminal counts never carry a path; the report does, with its sections', () => {
  const { inputs, extras } = fixture();
  const rows = buildCoverage(inputs);
  const s = summarize(rows, extras);
  const counts = formatCounts(s);
  for (const row of rows) assert.ok(!counts.includes(row.path), row.path);
  assert.ok(!counts.includes('DOE-0'));
  const report = renderMarkdown(rows, s, '2026-01-01T00:00:00.000Z');
  for (const heading of ['## Counts', '## Gaps', '## Identical text', '## Case-folder root', '## All rows']) assert.ok(report.includes(heading), heading);
  assert.ok(report.includes('A/new.pdf'));
});

test('coverage arguments', () => {
  assert.deepEqual(parseCoverageArgs([]).probe, false);
  const options = parseCoverageArgs(['--probe', '--rate', '2']);
  assert.deepEqual([options.probe, options.rate], [true, 2]);
  assert.throws(() => parseCoverageArgs(['--rate', '50']), /usage/);
  assert.throws(() => parseCoverageArgs(['--apply']), /usage/);
});
