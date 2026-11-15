// SPDX-License-Identifier: Apache-2.0
// A production volume (production.ts) on the fictional room (Doe v. Harbor Labs, prefix DOE), read back by parsers
// written here from the load-file conventions and by pdf.js. Each test name is a Data room row's rule
// (quality-speed/pages/data-room/list.ts, dispute.counsel.complete.*).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ftsSearch } from '../fts.ts';
import { addDoc, index } from '../fts-fixtures.ts';
import { testDb } from '../sqlite-d1.ts';
import { buildProduction, DAT_FIELDS, type ProductionItem } from './production.ts';

const CANARY = 'HX-CANARY-55B1';
const ADVICE = `Counsel advised that the ${CANARY} repurchase could be challenged`;
const MINUTES_P2 = `Moe moved to remove Doe as chief executive. ${ADVICE}. The vote was 2 to 1, Doe voting no.`;

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

// DOE-000001 to DOE-000005, as the room holds them. 3 is withheld, so it is in the room's search but not produced.
const ROOM: { seq: number; path: string; pages: string[] }[] = [
  { seq: 1, path: '01-Corporate-Records/Stock-Agreement.pdf', pages: ['Founders stock agreement among Harbor Labs, Jane Doe and Richard Roe.', 'Vesting over four years with a one year cliff.'] },
  { seq: 2, path: '02-Board-Minutes/Minutes.pdf', pages: ['Special meeting of the board of Harbor Labs, notice sent two days before.', MINUTES_P2] },
  { seq: 3, path: '07-Lawyer-Notes/Memo.pdf', pages: ['Notes on the bridge note conversion and the repurchase.'] },
  { seq: 4, path: '04-Letters/Letter.pdf', pages: ['Richard, I do not agree to the repurchase of my shares. Jane Doe'] },
  { seq: 5, path: '05-Finance/Bridge-Note.pdf', pages: ['Convertible bridge note issued to Alder Peak Ventures.', 'Amended to add a discount on conversion.', 'Signature page.'] },
];

const at = (page: string, words: string) => ({ start: page.indexOf(words), end: page.indexOf(words) + words.length });

const ITEMS: ProductionItem[] = ROOM.filter((d) => d.seq !== 3).map((d) => ({
  seq: d.seq,
  pages: d.pages,
  redactions: d.seq === 2 ? [{ page: 2, ...at(MINUTES_P2, ADVICE), basis: 'attorney_client' as const }] : [],
  custodian: d.seq === 4 ? '' : 'Jane Doe',
  // The redacted words are in the minutes' file name too, as a careless export would leave them.
  fileName: d.seq === 2 ? `Minutes ${CANARY} draft.pdf` : d.path.split('/').pop()!,
  date: d.seq === 5 ? '' : `2012-0${d.seq}-1${d.seq}`,
  sha256: sha(d.path),
}));

function volume(items = ITEMS) {
  const result = buildProduction('DOE001', 'DOE', items);
  assert.ok(result.ok, JSON.stringify(result));
  return result.files;
}

/** UTF-8, a leading byte order mark dropped. */
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** A Concordance .dat read from its conventions: BOM, CRLF lines, þ around each value, DC4 between. */
function parseDat(bytes: Uint8Array): Record<string, string>[] {
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'a UTF-8 byte order mark');
  const body = text(bytes);
  assert.ok(body.endsWith('\r\n'));
  const lines = body.slice(0, -2).split('\r\n');
  const rows = lines.map((line) => {
    assert.ok(line.startsWith('þ') && line.endsWith('þ'), 'every value is quoted');
    return line.slice(1, -1).split('þ\u0014þ');
  });
  const [header, ...data] = rows;
  assert.ok(data.every((row) => row.length === header!.length), 'the same column count on every row');
  return data.map((row) => Object.fromEntries(header!.map((name, i) => [name, row[i]!])));
}

/** An Opticon .opt: seven comma-separated fields a line. */
function parseOpt(bytes: Uint8Array): string[][] {
  const lines = text(bytes).replace(/\r\n$/, '').split('\r\n');
  const rows = lines.map((line) => line.split(','));
  assert.ok(rows.every((row) => row.length === 7), 'seven fields a line');
  return rows;
}

async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join('\n'));
  }
  await task.destroy();
  return pages;
}

const file = (files: Map<string, Uint8Array>, windowsPath: string) => files.get(windowsPath.replace(/\\/g, '/'));

test('an independent parser loads every load-file row with real metadata', async () => {
  const files = volume();
  const rows = parseDat(files.get('DATA/DOE001.dat')!);
  assert.deepEqual(Object.keys(rows[0]!), [...DAT_FIELDS]);
  assert.deepEqual(rows.map((r) => r.BEGBATES), ['DOE-000001', 'DOE-000002', 'DOE-000004', 'DOE-000005']);
  const opt = parseOpt(files.get('DATA/DOE001.opt')!);
  for (const row of rows) {
    assert.match(row.BEGBATES!, /^[A-Z0-9]+(-[A-Z0-9]+){0,2}$/, 'a number both agencies accept');
    assert.equal(row.ENDBATES, row.BEGBATES);
    assert.match(row.SHA256!, /^[0-9a-f]{64}$/);
    assert.ok(row.CUSTODIAN && row.FILENAME, 'custodian and file name');
    assert.match(row.DATE!, /^(\d{2}\/\d{2}\/\d{4})?$/);
    assert.match(row.REDACTED!, /^[YN]$/);
    const textFile = file(files, row.TEXTPATH!);
    const imageFile = file(files, row.IMAGEPATH!);
    assert.ok(textFile && imageFile, `${row.TEXTPATH} and ${row.IMAGEPATH} are in the volume`);
    const pages = await pdfPages(imageFile);
    assert.equal(Number(row.PAGECOUNT), pages.length);
    assert.ok(pages.every((page) => page.includes(row.BEGBATES!)), 'the number is on every page');
    const lines = opt.filter((line) => line[2] === row.IMAGEPATH);
    assert.equal(lines.length, pages.length, 'one image line a page');
    assert.deepEqual([lines[0]![0], lines[0]![1], lines[0]![3], lines[0]![6]], [row.BEGBATES, 'DOE001', 'Y', row.PAGECOUNT]);
  }
  const bySeq = new Map(rows.map((r) => [r.BEGBATES, r]));
  assert.deepEqual([bySeq.get('DOE-000001')!.DATE, bySeq.get('DOE-000005')!.DATE], ['01/11/2012', ''], 'mm/dd/yyyy, blank when undated');
  assert.equal(bySeq.get('DOE-000004')!.CUSTODIAN, 'Unknown', 'an unknown custodian says so');
  assert.equal(bySeq.get('DOE-000001')!.SHA256, ITEMS[0]!.sha256);

  const awkward = volume([{ ...ITEMS[0]!, fileName: 'Stockþagreement\r\nfinal\u0014.pdf' }]);
  assert.equal(parseDat(awkward.get('DATA/DOE001.dat')!)[0]!.FILENAME, 'Stock agreement final .pdf', 'no quote, separator or line break inside a value');

  const refused = [
    buildProduction('doe 001', 'DOE', ITEMS),
    buildProduction('DOE001', 'DOE', [...ITEMS, ITEMS[0]!]),
    buildProduction('DOE001', 'DOE', [{ ...ITEMS[0]!, sha256: 'abc' }]),
    buildProduction('DOE001', 'DOE', [{ ...ITEMS[0]!, date: 'June 2011' }]),
  ];
  assert.deepEqual(refused.map((r) => (r.ok ? 'ok' : r.problems[0]!.problem)), ['bad_volume', 'twice', 'bad_metadata', 'bad_metadata']);
});

test('ten known strings find the same documents in the room and the production', async () => {
  const t = testDb();
  for (const doc of ROOM) {
    addDoc(t, `doc-${doc.seq}`, doc.path);
    index(t, `doc-${doc.seq}`, doc.pages);
  }
  const files = volume();
  const produced = parseDat(files.get('DATA/DOE001.dat')!);
  const words = (value: string) => ` ${value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  const texts = await Promise.all(
    produced.map(async (row) => ({ control: row.BEGBATES!, text: words(text(file(files, row.TEXTPATH!)!)), image: words((await pdfPages(file(files, row.IMAGEPATH!)!)).join(' ')) })),
  );
  const strings = ['Harbor Labs', 'Jane Doe', 'Richard Roe', 'vesting', 'four years', 'special meeting', 'the vote was 2 to 1', 'do not agree', 'bridge note', 'discount on conversion'];
  for (const phrase of strings) {
    const inRoom = (await ftsSearch(t.db, `"${phrase}"`, 'counsel', 50)).map((chunk) => Number(chunk.docId.slice(4)));
    const roomProduced = [...new Set(inRoom)].filter((seq) => seq !== 3).sort().map((seq) => `DOE-${String(seq).padStart(6, '0')}`);
    const inText = texts.filter((d) => d.text.includes(words(phrase))).map((d) => d.control);
    const inImage = texts.filter((d) => d.image.includes(words(phrase))).map((d) => d.control);
    assert.ok(roomProduced.length > 0, phrase);
    assert.deepEqual(inText, roomProduced, `text files: ${phrase}`);
    assert.deepEqual(inImage, roomProduced, `images: ${phrase}`);
  }
  // Words a redaction covers are found in the room, and in the production only where they were not redacted.
  const redacted = texts.filter((d) => d.text.includes(words('repurchase'))).map((d) => d.control);
  assert.deepEqual(redacted, ['DOE-000004']);
  assert.ok((await ftsSearch(t.db, '"repurchase"', 'counsel', 50)).some((chunk) => chunk.docId === 'doc-2'));
});

test('a redacted canary has zero hits in image text, text file, load file and metadata', async () => {
  const files = volume();
  const hits = (haystack: string) => haystack.toLowerCase().split(CANARY.toLowerCase()).length - 1;
  for (const [path, bytes] of files) assert.equal(hits(new TextDecoder('latin1').decode(bytes)) + hits(text(bytes)), 0, `bytes of ${path}`);
  const image = await pdfPages(files.get('IMAGES/DOE-000002.pdf')!);
  assert.equal(hits(image.join('\n')), 0, 'image text');
  const minutes = text(files.get('TEXT/DOE-000002.txt')!);
  assert.equal(hits(minutes), 0, 'text file');
  const row = parseDat(files.get('DATA/DOE001.dat')!).find((r) => r.BEGBATES === 'DOE-000002')!;
  assert.equal(Object.values(row).map(hits).reduce((a, b) => a + b), 0, 'load file and metadata');

  assert.equal(row.REDACTED, 'Y');
  assert.equal(row.FILENAME, 'Minutes [REDACTED: Attorney-client privilege] draft.pdf');
  assert.ok(minutes.includes('Moe moved to remove Doe as chief executive. [REDACTED: Attorney-client privilege]. The vote was 2 to 1'), 'the rest of the page stays');
  assert.ok(image.join(' ').includes('[REDACTED: Attorney-client privilege]'), 'the label is on the image');

  const bad = [
    { page: 3, start: 0, end: 4 },
    { page: 2, start: 10, end: 5 },
    { page: 2, start: 0, end: MINUTES_P2.length + 1 },
  ];
  for (const span of bad) {
    const result = buildProduction('DOE001', 'DOE', [{ ...ITEMS[1]!, redactions: [{ ...span, basis: 'attorney_client' }] }]);
    assert.deepEqual(result, { ok: false, problems: [{ problem: 'bad_redaction', seq: 2 }] }, JSON.stringify(span));
  }
  const overlap = [{ page: 2, start: 0, end: 20, basis: 'work_product' as const }, { page: 2, start: 10, end: 30, basis: 'work_product' as const }];
  assert.equal(buildProduction('DOE001', 'DOE', [{ ...ITEMS[1]!, redactions: overlap }]).ok, false, 'overlapping spans');
  assert.equal(buildProduction('DOE001', 'DOE', [{ ...ITEMS[1]!, redactions: [{ page: 2, start: 0, end: 4, basis: 'relevance' as never }] }]).ok, false, 'relevance is not a basis');
});
