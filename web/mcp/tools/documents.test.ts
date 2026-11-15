// SPDX-License-Identifier: Apache-2.0
// legallas_list_documents and legallas_get_document against the real schema (testDb): live, non-hidden rows only,
// the room's order and folders, keyset paging, `since`, designations from the fictional manifest, the compact
// profile, and no storage fields in any result.
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPACT_LIMITS, LIST_PAGE_SIZE, MAX_CHARS_PER_READ } from '../contract.ts';
import { fitItems, itemChars, resultChars } from '../format.ts';
import { AS_OF_LAG_MS, getDocumentTool, listDocumentsTool, resetDocumentsCache, sinceInstant } from './documents.ts';
import { body, catalogDb, toolCtx, type DocSeed } from './doc-fixtures.ts';
import { DOC_IDS, MATTER, matterFiles, textChars, withProfile } from './profile-fixtures.ts';
import { FENCE, PLANTED_AI } from './untrusted-fixtures.ts';
import { UNTRUSTED_REMINDER } from '../../worker/prompt.ts';

beforeEach(() => resetDocumentsCache());

const SEEDS: DocSeed[] = [
  { id: 'd-b', path: '08-Court-Pleadings/Complaint.pdf', controlSeq: 2, keyAt: '2026-09-01T00:00:00Z' },
  { id: 'd-a', path: '04-Letters/Doe letter.pdf', controlSeq: 1 },
  { id: 'd-gone', path: '04-Letters/Old.pdf', controlSeq: 3, removedAt: '2026-09-02T00:00:00Z' },
  { id: 'd-hidden', path: '10-Lawyer-Analysis/legallas-visuals.json', kind: 'file', pages: null, controlSeq: 4 },
  { id: 'd-up', path: 'from-counsel/d-up/Roe reply.pdf', source: 'counsel', controlSeq: 5 },
];

const LEAKS = /R2-LEAK|SHA-LEAK|ETAG-LEAK|r2_key|sha256|etag/;

test('lists live, non-hidden documents in path order with the room fields only', async () => {
  const { ctx, audits } = toolCtx(catalogDb(SEEDS).db);
  const result = await listDocumentsTool.handler({}, ctx);
  assert.deepEqual(audits, [{ action: 'ai_read', documentId: null }]);
  const out = body(result);
  assert.equal(out.total, 3);
  assert.deepEqual(out.documents.map((d: { id: string }) => d.id), ['d-a', 'd-b', 'd-up']);
  assert.deepEqual(out.documents[1], {
    id: 'd-b',
    control: 'DOE-000002',
    title: 'Complaint.pdf',
    folder: '08-Court-Pleadings',
    type: 'pdf',
    pages: 3,
    key: true,
    updated: '2026-09-30',
    link: 'https://room.example.com/doc/?id=d-b',
    privileged: false,
  });
  assert.equal(out.documents[2].folder, 'from-counsel');
  assert.equal(out.next_cursor, undefined);
  assert.doesNotMatch(JSON.stringify(result), LEAKS);
});

test('the folder filter matches the folder the room shows, counsel uploads included', async () => {
  const { ctx } = toolCtx(catalogDb(SEEDS).db);
  const letters = body(await listDocumentsTool.handler({ folder: '04-Letters' }, ctx));
  assert.deepEqual(letters.documents.map((d: { id: string }) => d.id), ['d-a']);
  const counsel = body(await listDocumentsTool.handler({ folder: 'from-counsel' }, ctx));
  assert.deepEqual(counsel.documents.map((d: { id: string }) => d.id), ['d-up']);
  const none = body(await listDocumentsTool.handler({ folder: 'from-counsel/d-up' }, ctx));
  assert.equal(none.total, 0);
  assert.match(none.note, /No documents in that folder/);
});

test('pages through the catalog with an opaque cursor, no row twice or missed', async () => {
  const seeds: DocSeed[] = Array.from({ length: LIST_PAGE_SIZE + 5 }, (_, i) => ({
    id: `doc-${String(i).padStart(3, '0')}`,
    path: `Box/File ${String(i).padStart(3, '0')}.pdf`,
    controlSeq: i + 1,
  }));
  const { ctx } = toolCtx(catalogDb(seeds).db);
  const first = body(await listDocumentsTool.handler({}, ctx));
  assert.equal(first.documents.length, LIST_PAGE_SIZE);
  assert.equal(first.total, LIST_PAGE_SIZE + 5);
  assert.ok(typeof first.next_cursor === 'string' && first.next_cursor.length <= 64);
  assert.doesNotMatch(first.next_cursor, /doc-/, 'the cursor is not the raw id');
  const second = body(await listDocumentsTool.handler({ cursor: first.next_cursor }, ctx));
  assert.equal(second.documents.length, 5);
  assert.equal(second.next_cursor, undefined);
  const ids = [...first.documents, ...second.documents].map((d: { id: string }) => d.id);
  assert.deepEqual(ids, seeds.map((s) => s.id));
});

test('a cursor that does not decode to a known row is a bad_cursor error', async () => {
  const { ctx } = toolCtx(catalogDb(SEEDS).db);
  for (const cursor of ['%%%', 'bm8tc3VjaC1kb2M', '']) {
    const result = await listDocumentsTool.handler({ cursor }, ctx);
    assert.equal(result.isError, true);
    assert.match((result.content[0] as { text: string }).text, /^bad_cursor:/);
  }
});

test('get returns one document with its comment count and audits the read', async () => {
  const { db, sqlite } = catalogDb(SEEDS);
  sqlite.prepare("INSERT INTO comments (id, document_id, author_email, body) VALUES ('c1', 'd-b', 'a@example.test', 'x'), ('c2', 'd-b', 'a@example.test', 'y')").run();
  const { ctx, audits } = toolCtx(db);
  const result = await getDocumentTool.handler({ id: 'd-b' }, ctx);
  const out = body(result);
  assert.equal(out.control, 'DOE-000002');
  assert.equal(out.comments, 2);
  assert.equal(out.key, true);
  assert.deepEqual(audits, [{ action: 'ai_read', documentId: 'd-b' }]);
  assert.doesNotMatch(JSON.stringify(result), LEAKS);
});

test('get refuses removed, hidden and unknown documents as not_found, without an audit', async () => {
  const { ctx, audits } = toolCtx(catalogDb(SEEDS).db);
  for (const id of ['d-gone', 'd-hidden', 'nope']) {
    const result = await getDocumentTool.handler({ id }, ctx);
    assert.equal(result.isError, true);
    assert.match((result.content[0] as { text: string }).text, /^not_found: Use legallas_search or legallas_list_documents/);
  }
  assert.deepEqual(audits, []);
});

test('authorization uses the role re-read from D1, not the role frozen in the grant', async () => {
  // props.role is 'owner' in toolCtx; the member row now carries a role the matrix does not know.
  const { ctx } = toolCtx(catalogDb(SEEDS).db, undefined, 'former' as never);
  for (const result of [await listDocumentsTool.handler({}, ctx), await getDocumentTool.handler({ id: 'd-a' }, ctx)]) {
    assert.equal(result.isError, true);
    assert.match((result.content[0] as { text: string }).text, /^forbidden:/);
  }
});

/** A catalog with updated_at set per id, for `since`. */
function dated(seeds: DocSeed[], updated: Record<string, string>) {
  const { db, sqlite } = catalogDb(seeds);
  for (const [id, at] of Object.entries(updated)) sqlite.prepare('UPDATE documents SET updated_at = ?1 WHERE id = ?2').run(at, id);
  return db;
}

const UPDATED = {
  'd-a': '2026-09-01T08:00:00Z',
  'd-b': '2026-10-01T09:30:00.250Z',
  'd-up': '2026-10-06T00:00:00.000Z',
};

const listIds = (out: Record<string, any>) => out.documents.map((d: { id: string }) => d.id);

test('since lists documents added or changed at or after the instant, whatever the stored ISO form', async () => {
  const { ctx } = toolCtx(dated(SEEDS, UPDATED));
  const cases: [string, string[]][] = [
    ['2026-10-01', ['d-b', 'd-up']],
    ['2026-10-01T09:30:00.250Z', ['d-b', 'd-up']],
    ['2026-10-01T09:30:01Z', ['d-up']],
    ['2026-10-01T11:00:00+02:00', ['d-b', 'd-up']],
    ['2026-10-01T09:31', ['d-up']],
    ['2026-10-07', []],
    ['2020-01-01', ['d-a', 'd-b', 'd-up']],
  ];
  for (const [since, want] of cases) {
    const out = body(await listDocumentsTool.handler({ since }, ctx));
    assert.deepEqual(listIds(out), want, since);
    assert.equal(out.total, want.length, since);
  }
  const out = body(await listDocumentsTool.handler({ since: '2026-10-01', folder: '08-Court-Pleadings' }, ctx));
  assert.deepEqual(listIds(out), ['d-b'], 'since and folder together');
  assert.equal(out.as_of, new Date(Date.parse('2026-10-01T12:00:00Z') - AS_OF_LAG_MS).toISOString(), 'as_of runs a day behind the listing, for the next since');
});

test('as_of passed back as since still finds a document a running sync stamped before the listing', async () => {
  // The sync started at 11:00 and writes D1 after the listing at 12:00, stamping updated_at with its start time.
  const { db, sqlite } = catalogDb(SEEDS);
  sqlite.prepare("UPDATE documents SET updated_at = '2026-09-01T00:00:00Z'").run();
  const { ctx } = toolCtx(db);
  const listed = body(await listDocumentsTool.handler({}, ctx));
  sqlite.prepare("UPDATE documents SET updated_at = '2026-10-01T11:00:00.000Z' WHERE id = 'd-b'").run();
  const next = body(await listDocumentsTool.handler({ since: listed.as_of }, ctx));
  assert.deepEqual(listIds(next), ['d-b']);
});

test('since that is not an ISO date or date and time is a bad_since error, before any read is audited', async () => {
  const { ctx, audits } = toolCtx(dated(SEEDS, UPDATED));
  for (const since of ['yesterday', '10/01/2026', '2026-13-45', '2026-10-01 09:00', '', '2026-02-30', '2026-04-31T09:00:00Z', '2025-02-29', '2026-10-01T25:00Z']) {
    const result = await listDocumentsTool.handler({ since }, ctx);
    assert.equal(result.isError, true, since);
    assert.match((result.content[0] as { text: string }).text, /^bad_since:/);
  }
  assert.deepEqual(audits, []);
  assert.equal(sinceInstant('2026-10-01T09:00:00'), '2026-10-01T09:00:00.000Z', 'no zone means UTC');
  assert.equal(sinceInstant('2028-02-29'), '2028-02-29T00:00:00.000Z', 'a leap day is a real date');
  assert.equal(sinceInstant('2026-03-01T00:30:00+02:00'), '2026-02-28T22:30:00.000Z', 'the zone moves the instant, not the check');
});

test('since pages with the cursor like the full list, no row twice or missed', async () => {
  const seeds: DocSeed[] = Array.from({ length: 2 * LIST_PAGE_SIZE + 20 }, (_, i) => ({ id: `doc-${String(i).padStart(3, '0')}`, path: `Box/File ${String(i).padStart(3, '0')}.pdf` }));
  const recent = Object.fromEntries(seeds.filter((_, i) => i % 2 === 0).map((s) => [s.id, '2026-10-05T00:00:00Z']));
  const { ctx } = toolCtx(dated(seeds, recent));
  const first = body(await listDocumentsTool.handler({ since: '2026-10-04' }, ctx));
  assert.equal(first.total, Object.keys(recent).length);
  assert.equal(first.documents.length, LIST_PAGE_SIZE);
  const second = body(await listDocumentsTool.handler({ since: '2026-10-04', cursor: first.next_cursor }, ctx));
  assert.equal(second.next_cursor, undefined);
  assert.deepEqual([...listIds(first), ...listIds(second)], Object.keys(recent));
});

/** The fixture catalog (every document in fixtures/doc-ids.json, all live) with the fixture manifest published. */
function room(options: { removed?: string[]; matter?: string | null } = {}) {
  const seeds = Object.entries(DOC_IDS).map(([path, id], i) => ({ id, path, controlSeq: i + 1, removedAt: options.removed?.includes(id) ? '2026-09-02T00:00:00Z' : null }));
  const { ctx, audits } = toolCtx(catalogDb(seeds).db);
  const files = matterFiles(options.matter === undefined ? MATTER : options.matter);
  (ctx.env as { FILES: unknown }).FILES = files.bucket;
  return { ctx, audits, files };
}

const PITCH = DOC_IDS['04-Letters/Email__20110518__Richard-Roe__Vesting-terms.pdf']!;
const CHART = DOC_IDS['10-Lawyer-Analysis/Claim-Chart__WP__20130312.xlsx']!;

test('list and get carry designations from the published manifest: date, document type, from, to, privileged', async () => {
  const { ctx, files } = room();
  const out = body(await listDocumentsTool.handler({}, ctx));
  const pitch = out.documents.find((d: { id: string }) => d.id === PITCH);
  assert.deepEqual(
    [pitch.privileged, pitch.date, pitch.doc_type, pitch.from, pitch.to, pitch.key],
    [false, '2011-05-18', 'Email', ['Richard Roe'], ['Jane Doe'], false],
  );
  assert.equal(out.documents.find((d: { id: string }) => d.id === CHART).privileged, true, 'the manifest marks it, whatever its folder');
  const got = body(await getDocumentTool.handler({ id: PITCH }, ctx));
  assert.deepEqual([got.date, got.doc_type, got.from, got.to, got.privileged], ['2011-05-18', 'Email', ['Richard Roe'], ['Jane Doe'], false]);
  assert.match(got.summary, /^<case-record>\n.+\n<\/case-record>$/s, 'the summary is case data');
  await listDocumentsTool.handler({}, ctx);
  assert.equal(files.state.downloads, 1, 'the manifest is cached by etag');
});

test('designations follow the room: a party cited only to a removed document is not named', async () => {
  const roeOnly = JSON.parse(MATTER).people.find((p: { id: string }) => p.id === 'per-roe').cites.map((c: { doc: string }) => c.doc);
  const { ctx } = room({ removed: roeOnly });
  const pitch = body(await getDocumentTool.handler({ id: PITCH }, ctx));
  assert.equal(pitch.from, undefined);
  assert.deepEqual(pitch.to, ['Jane Doe']);
});

test('without a manifest, or with one that does not parse, documents still list with folder privilege only', async () => {
  for (const matter of [null, '{"version": 1, "meta": "broken"}', 'not json']) {
    resetDocumentsCache();
    const { ctx } = room({ matter });
    const out = body(await listDocumentsTool.handler({}, ctx));
    assert.equal(out.total, Object.keys(DOC_IDS).length);
    const pitch = out.documents.find((d: { id: string }) => d.id === PITCH);
    assert.deepEqual(Object.keys(pitch).filter((k) => ['date', 'doc_type', 'from', 'to'].includes(k)), [], String(matter));
    assert.equal(pitch.privileged, false);
  }
  const { ctx } = toolCtx(catalogDb([{ id: 'p1', path: '07-Lawyer-Notes-PRIVILEGED/Note.pdf' }]).db);
  assert.equal(body(await getDocumentTool.handler({ id: 'p1' }, ctx)).privileged, true, 'a privileged folder is privileged');
});

test('compact: at most 25 documents and 9,000 characters per result, and the cursor walks every row once', async () => {
  const seeds: DocSeed[] = Array.from({ length: 70 }, (_, i) => ({
    id: `doc-${String(i).padStart(3, '0')}`,
    path: `04-Letters/Letter from Doe to Roe about the meeting notices, the bridge note terms and the repurchase of her unvested shares, number ${String(i).padStart(3, '0')}.pdf`,
    controlSeq: i + 1,
  }));
  const { ctx } = toolCtx(catalogDb(seeds).db);
  withProfile(ctx, 'compact');
  const seen: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const result = await listDocumentsTool.handler(cursor ? { cursor } : {}, ctx);
    const out = body(result);
    assert.ok(textChars(result) <= COMPACT_LIMITS.maxChars, `page ${pages}: ${textChars(result)} characters`);
    assert.ok(out.documents.length <= COMPACT_LIMITS.maxItems && out.documents.length > 0);
    assert.equal(out.total, seeds.length);
    seen.push(...listIds(out));
    cursor = out.next_cursor;
    pages += 1;
  } while (cursor);
  assert.deepEqual(seen, seeds.map((s) => s.id));
  assert.ok(pages > Math.ceil(seeds.length / COMPACT_LIMITS.maxItems), 'the character budget, not only the item count, shortened pages');
  const standard = body(await listDocumentsTool.handler({}, toolCtx(catalogDb(seeds).db).ctx));
  assert.equal(standard.documents.length, seeds.length, 'standard keeps today\'s 100 per page');
});

test('standard: a page of long rows is cut by characters as well as rows, and the cursor still walks every row once', async () => {
  const long = 'Letter between the parties about the board, the meeting notices, the repurchase of her shares and the notice log '.repeat(5);
  const seeds: DocSeed[] = Array.from({ length: 120 }, (_, i) => ({ id: `doc-${String(i).padStart(3, '0')}`, path: `04-Letters/${long}${String(i).padStart(3, '0')}.pdf`, controlSeq: i + 1 }));
  const { ctx } = toolCtx(catalogDb(seeds).db);
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const result = await listDocumentsTool.handler(cursor ? { cursor } : {}, ctx);
    assert.ok(textChars(result) <= MAX_CHARS_PER_READ, `${textChars(result)} characters`);
    const out = body(result);
    assert.ok(out.documents.length < LIST_PAGE_SIZE, 'long rows shorten the page');
    seen.push(...listIds(out));
    cursor = out.next_cursor;
  } while (cursor);
  assert.deepEqual(seen, seeds.map((s) => s.id));
});

test('fitItems: the item list gets exactly what the rest of the result leaves', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, title: `Title "${i}"\nline`.repeat(i % 4 + 1), from: ['A', 'B'].slice(0, i % 3) }));
  const envelope = { total: 30, documents: [], next_cursor: 'x'.repeat(40) };
  for (const n of [1, 2, 7, 30]) {
    const whole = resultChars({ ...envelope, documents: items.slice(0, n) });
    assert.equal(whole, resultChars(envelope) + 2 + items.slice(0, n).reduce((sum, item) => sum + itemChars(item), 0), `${n} items`);
  }
  for (const maxChars of [400, 1_000, 2_500]) {
    const fit = fitItems('compact', items, { maxItems: 30, maxChars }, envelope);
    assert.ok(resultChars({ ...envelope, documents: fit.items }) <= maxChars || fit.items.length === 1, `${maxChars}`);
    assert.ok(fit.next === null || resultChars({ ...envelope, documents: items.slice(0, fit.items.length + 1) }) > maxChars, 'no room left for one more');
  }
});

test('a summary addressed to AI tools is fenced as untrusted, and the document then offers no cite beside it', async () => {
  const matter = JSON.parse(MATTER);
  matter.docs[PITCH].summary = PLANTED_AI;
  const got = body(await getDocumentTool.handler({ id: PITCH }, room({ matter: JSON.stringify(matter) }).ctx));
  assert.equal(Object.keys(got)[0], 'untrusted_note', 'the note comes first');
  assert.equal(got.untrusted_note, UNTRUSTED_REMINDER);
  assert.equal(got.summary, `${FENCE.ai}${PLANTED_AI}\n</case-record>`);
  assert.deepEqual([got.id, got.control, got.link, got.untrusted, got.doc_type], [PITCH, undefined, undefined, 'addressed-to-ai', 'Email']);
  resetDocumentsCache();
  const plain = body(await getDocumentTool.handler({ id: PITCH }, room().ctx));
  assert.deepEqual(['untrusted_note' in plain, 'untrusted' in plain, typeof plain.control], [false, false, 'string']);
});

test('a title that addresses an AI is fenced in the list, and that item offers no cite (#701)', async () => {
  const seeds: DocSeed[] = [...SEEDS, { id: 'd-ai', path: '04-Letters/planted.pdf', name: PLANTED_AI, controlSeq: 6 }];
  const value = body(await listDocumentsTool.handler({}, toolCtx(catalogDb(seeds).db).ctx));
  const planted = value.documents.find((d: any) => d.id === 'd-ai');
  assert.equal(planted.title, `${FENCE.ai}${PLANTED_AI}\n</case-record>`);
  assert.equal(planted.untrusted, 'addressed-to-ai');
  assert.equal('control' in planted || 'link' in planted, false);
  assert.equal(value.untrusted_note, UNTRUSTED_REMINDER);
  const plain = value.documents.find((d: any) => d.id === 'd-a');
  assert.equal(plain.title, 'Doe letter.pdf', 'a trusted title stays plain, so a list stays small');
  assert.ok(plain.control && plain.link);
});
