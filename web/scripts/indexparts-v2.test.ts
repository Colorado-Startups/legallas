// SPDX-License-Identifier: Apache-2.0
// Index format v2 (scripts/indexparts-v2.ts) on fictional documents only (DOE control numbers, Roe parties).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docIdFromKey, pageSegments } from '../worker/passages.ts';
import { marker, partKey } from './indexparts.ts';
import {
  buildPageParts,
  headerLine,
  MAX_PART_CHARS,
  nameDate,
  neutralizeText,
  nineDigitScan,
  pagePieces,
  partMetadata,
  sourceClass,
  splitLine,
  ssnShaped,
  tabOf,
  V2_METADATA_SCHEMA,
  type DocFacts,
  type SourceClass,
} from './indexparts-v2.ts';
import { isPosition, sourceKind } from '../worker/source-kind.ts';

const DOC = '11111111-2222-4333-8444-555555555555';
const facts = (over: Partial<DocFacts> = {}): DocFacts => ({
  id: DOC,
  control: 'DOE-000412',
  name: 'Motion-to-Strike__20130226__Tally-Payroll.pdf',
  folder: '08-Pleadings/motions',
  kind: 'pdf',
  ...over,
});
const sentence = (n: number) => `Sentence number ${n} of the fictional record says nothing at all about anyone. `;

test('the name date: compact, month, year, ISO and range segments; none without one', () => {
  assert.equal(nameDate('Motion-to-Strike__20130226__Tally-Payroll.pdf'), '2013-02-26');
  assert.equal(nameDate('Bank-Statement__201109__Moe.pdf'), '2011-09');
  assert.equal(nameDate('Transactions__2011__Moe.csv'), '2011');
  assert.equal(nameDate('Repair-Log__2012-09-07__Tally-Payroll__Run-2.xml'), '2012-09-07');
  assert.equal(nameDate('Ledger__20110301-20111130__Moe.xlsx'), '2011-03-01');
  assert.equal(nameDate('Roe notes.md'), null);
  assert.equal(nameDate('Memo__Dee__Site-Plan.pdf'), null, 'a party segment is not a date');
});

test('source classes come from generic folder words and the DocType, never from names', () => {
  assert.equal(sourceClass(facts()), 'pleading');
  assert.equal(sourceClass(facts({ name: 'Order-Compel__20130924__Court.pdf' })), 'order');
  assert.equal(sourceClass(facts({ folder: '08-Pleadings/drafts', name: 'Complaint__20130228__Tally-Payroll.docx' })), 'draft');
  assert.equal(sourceClass(facts({ folder: '04-Letters/with-adjuster', name: 'EML__20120522__Acme-Mutual.pdf' })), 'correspondence');
  assert.equal(sourceClass(facts({ folder: '03-Daily-Records', name: 'Note__20120529__Moe.eml' })), 'correspondence');
  assert.equal(sourceClass(facts({ folder: '05-Site-Visit/public-records', name: 'Fire-Report__20110614__City.pdf' })), 'public-record');
  assert.equal(sourceClass(facts({ folder: '03-Daily-Records', name: 'Articles__20110722__Tally-Payroll.pdf' })), 'public-record');
  assert.equal(sourceClass(facts({ folder: '07-Lawyer-Notes-PRIVILEGED', name: 'Chronology__2011__Moe.csv' })), 'analysis');
  assert.equal(sourceClass(facts({ folder: '01-Agreements', name: 'Letter-Side-B__20111012__Tally-Payroll.pdf' })), 'evidence');
  assert.equal(tabOf('08-Pleadings/motions'), '08-Pleadings');
  assert.equal(tabOf(''), '');
});

test('the header class agrees with the allegation guard (worker/source-kind.ts) on every shape', () => {
  const shapes: [Pick<DocFacts, 'name' | 'folder'>, SourceClass][] = [
    [{ folder: '08-Pleadings/court-procedural', name: 'Register-of-Actions__20131112__Court.pdf' }, 'court-record'],
    [{ folder: '08-Pleadings', name: 'Summons__20130521__Tally-Payroll.pdf' }, 'court-record'],
    [{ folder: '08-Pleadings', name: 'Proposed-Order__20130626__Acme-Mutual.pdf' }, 'pleading'],
    [{ folder: '08-Pleadings/exhibits', name: 'Exhibit-A__20120419__Tally-Payroll.pdf' }, 'evidence'],
    [{ folder: '08-Pleadings/drafts', name: 'Cover-Letter__20121114__Acme-Mutual.docx' }, 'draft'],
    [{ folder: '06-Photos/media', name: 'Article__20120511__Harbor-Tribune.pdf' }, 'press'],
    [{ folder: '03-Daily-Records', name: 'Press-Release__20120613__Tally-Payroll.pdf' }, 'press'],
    [{ folder: '09-Orientation', name: 'Start-Here__2011__Moe.md' }, 'analysis'],
    [{ folder: '08-Pleadings/orders', name: 'Ruling__20130905__Court.pdf' }, 'order'],
    [{ folder: '04-Letters', name: 'Ltr__20120618__Tally-Payroll.pdf' }, 'correspondence'],
    [{ folder: '01-Agreements', name: 'Service-Contract__20110809__Tally-Payroll.pdf' }, 'evidence'],
  ];
  const positionClasses = new Set<SourceClass>(['pleading', 'correspondence', 'press', 'draft']);
  for (const [shape, expected] of shapes) {
    const cls = sourceClass(shape);
    assert.equal(cls, expected, shape.name);
    const kind = sourceKind(shape);
    assert.equal(positionClasses.has(cls), isPosition(kind), `${shape.name}: ${cls} vs ${kind}`);
    assert.equal(cls === 'analysis', kind === 'summary', shape.name);
  }
});

test('the header names the document: control, title, date, type, class and tab, with no marker or brackets', () => {
  const line = headerLine(facts());
  assert.equal(line, 'DOE-000412 | Motion to strike, Tally Payroll | 2013-02-26 | motion to strike | pleading | 08-Pleadings');
  assert.equal(headerLine(facts({ control: null, name: 'notes [doc:x p:1].md', folder: '', kind: 'markdown' })).includes('['), false);
  assert.match(headerLine(facts({ control: null, name: 'notes.md', folder: '', kind: 'markdown' })), /^Not numbered \| notes \| undated \| markdown \| evidence \| root$/);
  const long = headerLine(facts({ name: `${'Very-Long-Title-'.repeat(40)}__2011__Moe.pdf` }));
  assert.ok(long.length <= 6 * 120 + 15);
  assert.equal(long.split(' | ').length, 6, 'a cut keeps every field in place');
});

test('document text cannot forge a marker or a cite', () => {
  const text = neutralizeText('see [[doc:abc p:3]], [doc:abc p:3], 【doc:abc p:3】 and [law:crs-7-80-714]');
  assert.equal(text.includes('[['), false);
  assert.doesNotMatch(text, /[[【]doc:/);
  assert.doesNotMatch(text, /\[law:/);
});

test('every part opens with the header, then its page marker, and stays one chunk long', () => {
  const pages = [
    { n: 1, text: 'Short first page.' },
    { n: 2, text: Array.from({ length: 60 }, (_, i) => sentence(i)).join('\n') },
    { n: 3, text: '   ' },
    { n: 4, text: 'Last page.', ocr: true },
  ];
  const parts = buildPageParts(facts(), pages);
  assert.ok(parts.length >= 4, `expected page 2 to split, got ${parts.length} parts`);
  const header = headerLine(facts());
  for (const [i, part] of parts.entries()) {
    assert.equal(part.key, partKey(DOC, i + 1));
    assert.equal(docIdFromKey(part.key), DOC, 'the Worker maps every v2 key to its document');
    assert.ok(part.body.length <= MAX_PART_CHARS, `part ${i + 1} is ${part.body.length} characters`);
    const [first, second] = part.body.split('\n');
    assert.equal(first, header);
    assert.match(second!, /^\[\[doc:[0-9a-f-]{36} p:[124]\]\]$/);
  }
  assert.equal(parts.filter((p) => p.body.includes(marker(DOC, 3))).length, 0, 'a blank page makes no part');
  assert.equal(parts.at(-1)!.metadata.ocr, 'true');
  assert.equal(parts[0]!.metadata.ocr, 'false');
});

test('quotes come from the page text, never the header', () => {
  const [part] = buildPageParts(facts(), [{ n: 1, text: 'The compressor was replaced by the repair crew on the first of the month.' }]);
  const segments = pageSegments([{ docId: DOC, text: part!.body }], DOC, 1);
  assert.equal(segments.length, 1);
  assert.equal(segments[0]!.includes('DOE-000412'), false);
  assert.match(segments[0]!, /replaced by the repair crew/);
});

test('a table repeats its column names in every piece; long lines split at sentences', () => {
  const rows = ['date,amount,memo', ...Array.from({ length: 200 }, (_, i) => `2012-07-${String((i % 28) + 1).padStart(2, '0')},${i}00.00,delivery ${i}`)];
  const pieces = pagePieces(rows.join('\n'), 600, true);
  assert.ok(pieces.length > 3);
  assert.ok(pieces.every((piece) => piece.startsWith('date,amount,memo\n') || piece === pieces[0]));
  assert.ok(pieces.every((piece) => piece.length <= 600));
  const long = Array.from({ length: 30 }, (_, i) => sentence(i)).join('');
  assert.ok(splitLine(long, 400).every((piece) => piece.length <= 400 && piece.trimEnd().endsWith('.')));
});

test('metadata fits the schema: five fields at most, values under 64 bytes', () => {
  assert.ok(V2_METADATA_SCHEMA.length <= 5);
  const meta = partMetadata(facts(), false);
  assert.deepEqual(meta, { doc_kind: 'motion to strike', side: 'pleading', ocr: 'false', doc_date: '2013-02-26T00:00:00Z', control: '412' });
  const names = new Set(V2_METADATA_SCHEMA.map((f) => f.field_name));
  assert.ok(Object.keys(meta).every((k) => names.has(k as never)));
  assert.ok(Object.values(meta).every((v) => new TextEncoder().encode(v).length <= 64));
  assert.equal('control' in partMetadata(facts({ control: null }), true), false);
});

// Fictional numbers, joined at run time so no Social Security shaped literal sits in the source.
const dashed = (...parts: string[]) => parts.join('-');

test('a number in Social Security form is caught; never-issued placeholders and EINs are not', () => {
  assert.equal(ssnShaped(`Taxpayer ${dashed('123', '45', '6789')} on the form.`), 1);
  assert.equal(ssnShaped(`Two: ${dashed('234', '56', '7890')} and ${dashed('987', '65', '4321')}.`), 2, 'area 900 to 999 counts too (ITIN)');
  for (const placeholder of [dashed('000', '12', '3456'), dashed('666', '12', '3456'), dashed('123', '00', '4567'), dashed('123', '45', '0000')]) {
    assert.equal(ssnShaped(`masked ${placeholder}`), 0, placeholder);
  }
  assert.equal(ssnShaped(`EIN ${dashed('12', '3456789')}, filed ${dashed('2012', '11', '22')}, ticket ${dashed('0004410072', '12', '000031')}`), 0);
  const forms = [dashed('123', '45', '6789'), ['123', '45', '6789'].join(' '), ['123', '45', '6789'].join(''), ['123', '45', '6789', '0'].join('')];
  assert.deepEqual(nineDigitScan(forms.join(' / ')), { dashed: 1, spaced: 1, plain: 1 });
});
