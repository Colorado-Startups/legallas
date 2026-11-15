// SPDX-License-Identifier: Apache-2.0
// The iWork reader on real files the apps saved from invented text (web/fixtures/iwork/README.md), then on hostile
// ones built here. No npm package and no macOS tool, so it runs with no install, on any platform.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { checkIndex, formatIndexCheck } from './checkindex.ts';
import { directTextPages } from './extract.ts';
import type { IndexJob } from './indexjob.ts';
import { iwaBytes, IworkFailure, MAX_PART_BYTES, zipEntries } from './iwa.ts';
import { iworkCarriedText, iworkPages, type IworkFormat, type ReadLimits } from './iwork.ts';
import { dateText, decimal128 } from './iwork-table.ts';
import { formatPiiReport, piiGate, piiRefusal, scanForPii } from './pii-scan.ts';

const FIXTURES = path.resolve(import.meta.dirname, '..', 'fixtures', 'iwork');
const read = (name: string) => iworkPages(path.join(FIXTURES, name), name.split('.').pop() as IworkFormat);

// A protobuf and archive builder, for the files the apps would never save.
function varint(value: number): Buffer {
  const bytes: number[] = [];
  let rest = value;
  while (rest >= 128) {
    bytes.push((rest % 128) | 128);
    rest = Math.floor(rest / 128);
  }
  bytes.push(rest);
  return Buffer.from(bytes);
}
const key = (n: number, wire: number) => varint(n * 8 + wire);
const num = (n: number, value: number) => Buffer.concat([key(n, 0), varint(value)]);
const bytes = (n: number, value: Buffer | string) => {
  const body = typeof value === 'string' ? Buffer.from(value) : value;
  return Buffer.concat([key(n, 2), varint(body.length), body]);
};
const msg = (...fields: Buffer[]) => Buffer.concat(fields);
const ref = (n: number, id: number) => bytes(n, num(1, id));

/** A Snappy block holding `data` as one literal. */
function snappyLiteral(data: Buffer): Buffer {
  const length = data.length - 1;
  const head = length < 60 ? Buffer.from([length << 2]) : Buffer.from([62 << 2, length & 0xff, (length >> 8) & 0xff, (length >> 16) & 0xff]);
  return Buffer.concat([varint(data.length), head, data]);
}
const chunk = (block: Buffer) => Buffer.concat([Buffer.from([0, block.length & 0xff, (block.length >> 8) & 0xff, (block.length >> 16) & 0xff]), block]);

/** An .iwa part holding objects as [id, type, message]. */
function iwaPart(objects: [number, number, Buffer][]): Buffer {
  const stream = objects.map(([id, type, message]) => {
    const info = msg(num(1, id), bytes(2, msg(num(1, type), num(3, message.length))));
    return Buffer.concat([varint(info.length), info, message]);
  });
  return chunk(snappyLiteral(Buffer.concat(stream)));
}

interface ZipItem {
  name: string;
  data: Buffer;
  method?: number;
  /** Claimed in the directory, whatever the data really is. */
  declared?: number;
  /** The Unix mode, stored as an archive's link would be. */
  mode?: number;
}

/** A ZIP with no help from a tool, so a test can lie in it. */
function zip(items: ZipItem[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { name, data, method = 0, declared, mode } of items) {
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(declared ?? data.length, 20);
    entry.writeUInt32LE(declared ?? data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    if (mode !== undefined) entry.writeUInt32LE(mode * 65536, 38);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(items.length, 8);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const document = (objects: [number, number, Buffer][]) => zip([{ name: 'Index/Document.iwa', data: iwaPart(objects) }]);

async function inTemp<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'legallas-iwork-'));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The code a file fails with, written under `name`; the secret name proves no message carries a file name. */
async function codeOf(data: Buffer, format: IworkFormat, limits?: ReadLimits): Promise<string> {
  return inTemp(async (dir) => {
    const file = path.join(dir, `Secret Name.${format}`);
    await writeFile(file, data);
    const error = await iworkPages(file, format, limits).then(() => assert.fail('expected a failure'), (caught: unknown) => caught);
    assert.ok(error instanceof IworkFailure, String(error));
    assert.doesNotMatch(error.message, /Secret/);
    assert.equal(error.message, `iwork text failed: ${error.code}`);
    return error.code;
  });
}

/** The pages of a crafted file, written under `name`. */
const pagesOf = (name: string, data: Buffer, format: IworkFormat) => inTemp(async (dir) => {
  const file = path.join(dir, name);
  await writeFile(file, data);
  return iworkPages(file, format);
});

const STORAGE = 2001;
const GROUP = 3008;
/** A Pages document whose body is `storage`, plus any other objects. */
const pagesFile = (storage: Buffer, others: [number, number, Buffer][] = []) => document([[1, 10000, ref(4, 2)], [2, STORAGE, storage], ...others]);

test('Pages: tables in place, footnotes, headers and footers read; a tracked deletion and a comment are not', async () => {
  const [page, ...rest] = await read('agreement.pages');
  assert.deepEqual(rest, []);
  assert.equal(page?.n, 1);
  assert.equal(page?.text, [
    'DOETITLE Invented Agreement',
    'DOEFOOTREF sentence with a note[1] after it.',
    'DOECOMMENTED words here',
    // The emoji and the astral letter are two code units each: the deleted range must still land exactly.
    'DOEKEPT \u{1F600}\u{1D49C} stays DOEINSERTED',
    '',
    'DOETABLEA | DOETABLEB',
    '',
    'DOEPAGEONE end of the first page. Every word of this sample is made up and refers to nothing real at all.',
    '',
    'DOEPAGETWO start of the second page. Every word of this sample is made up and refers to nothing real at all.',
    '',
    'DOEPAGETHREE start of the third page. Every word of this sample is made up and refers to nothing real at all.',
    '',
    'Footnotes:',
    '[1] DOEFOOTNOTE invented note text',
    '',
    'Headers and footers:',
    'DOEHEADER invented header',
    'DOEFOOTER invented footer',
  ].join('\n'));
});

test('Pages: only headers and footers a page prints are read, and only a body it shows (#228)', async () => {
  // Masters 23 (first page), 24 (even pages) and 25 (every page) hold headers (1) and footers (2), as Pages saves them.
  const words = ['DOEFIRSTHEAD', 'DOEFIRSTFOOT', 'DOEEVENHEAD', 'DOEEVENFOOT', 'DOEHEAD', 'DOEFOOT'];
  const others: [number, number, Buffer][] = [
    [4, 10143, msg(ref(1, 10), ref(2, 11))],
    [5, 10143, msg(ref(1, 12), ref(2, 13))],
    [6, 10143, msg(ref(1, 14), ref(2, 15))],
    ...words.map((word, i): [number, number, Buffer] => [10 + i, STORAGE, bytes(3, word)]),
  ];
  const file = (section: Buffer, settings: Buffer) => document([
    [1, 10000, msg(ref(4, 2), ref(7, 9))],
    [2, STORAGE, msg(bytes(3, 'DOEBODY words'), bytes(17, bytes(1, ref(2, 3))))],
    [3, 10011, msg(section, ref(23, 4), ref(24, 5), ref(25, 6))],
    [9, 10012, settings],
    ...others,
  ]);
  const shown = async (section: Buffer, settings = msg()) => (await pagesOf('Doc.pages', file(section, settings), 'pages'))[0]?.text;
  const read = (...lines: string[]) => lines.join('\n');
  // A template's first-page header, with "Different first page" off, prints nowhere.
  assert.equal(await shown(msg()), read('DOEBODY words', '', 'Headers and footers:', 'DOEHEAD', 'DOEFOOT'));
  assert.equal(await shown(msg(num(18, 1), num(19, 1))), read('DOEBODY words', '', 'Headers and footers:', ...words));
  assert.equal(await shown(msg(num(18, 1), num(28, 1))), read('DOEBODY words', '', 'Headers and footers:', 'DOEHEAD', 'DOEFOOT'));
  // Document settings: headers (2) off, then footers (3) and the body (1) off as well, as a page layout document has it.
  assert.equal(await shown(msg(), msg(num(2, 0))), read('DOEBODY words', '', 'Headers and footers:', 'DOEFOOT'));
  assert.equal(await shown(msg(), msg(num(1, 0), num(2, 0), num(3, 0))), '');
  // What no page prints stays out of "Other text:", and the SSN guard still reads all of it.
  await inTemp(async (dir) => {
    const hidden = path.join(dir, 'Hidden.pages');
    await writeFile(hidden, file(msg(), msg(num(1, 0), num(2, 0), num(3, 0))));
    const carried = await iworkCarriedText(hidden);
    for (const word of ['DOEBODY', ...words]) assert.match(carried, new RegExp(word));
  });
});

test('Pages: a text box and a table that float on the page follow the body', async () => {
  assert.deepEqual(await read('notes.pages'), [{
    n: 1,
    text: 'DOEBODYONE an invented first paragraph.\nDOEBODYTWO an invented second paragraph.\n\nDOETEXTBOX floating note\n\nDOECELLA | DOECELLB\n1234.5',
  }]);
});

test('Numbers: a page per sheet, with money, percents, dates, formula results, booleans and empty cells kept apart', async () => {
  assert.deepEqual(await read('ledger.numbers'), [
    {
      n: 1,
      text: [
        'Sheet 1: DOESHEETONE',
        '',
        'Table: DOETABLEONE',
        'Label | Amount',
        'DOESTRING | USD 1234.50 | DOEMERGED',
        'DOEPERCENT | 25%',
        'DOEDATE | 2026-03-03',
        'DOEFORMULA | USD 2469.00',
        'DOECHECK | TRUE',
        'DOEPLAIN | 42',
        'DOEFARCELL',
        '',
        'Table: DOETABLETWO',
        'DOESECONDTABLE',
      ].join('\n'),
    },
    { n: 2, text: 'Sheet 2: DOESHEETTWO\n\nTable: Table 1\nDOESECONDSHEET' },
  ]);
});

test('Numbers: rows stay in order across the 256-row tiles a long table is stored in', async () => {
  const [page] = await read('rows.numbers');
  const rows = (page?.text ?? '').split('\n').filter((line) => line.includes(' | DOEROW'));
  assert.equal(rows.length, 300);
  for (const [index, row] of rows.entries()) assert.equal(row, `${index + 1} | DOEROW${index + 1} | ${(index + 1) * 1.5}`);
});

test('Keynote: visible slides in show order with notes; a skipped slide is marked, unnumbered; the theme is not read', async () => {
  assert.deepEqual(await read('deck.key'), [
    { n: 1, text: 'Slide 1\nDOESLIDEFIRST title' },
    // Saved third, moved to second: the show's order, not the file's.
    { n: 2, text: 'Slide 2\nDOESLIDETHIRD title\nDOESLIDETABLE\nDOESLIDETEXTBOX' },
    {
      n: 3,
      text: 'Slide 3\nDOESLIDESECOND title\nDOEBULLET one\nDOEBULLET two\nNotes:\nDOENOTES invented speaker note\n\nSkipped slide\nDOESLIDESKIPPED title',
    },
  ]);
});

test('the fixtures hold no path, and none of the parts the reader leaves out', async () => {
  for (const name of ['agreement.pages', 'notes.pages', 'ledger.numbers', 'rows.numbers', 'deck.key']) {
    const handle = await open(path.join(FIXTURES, name), 'r');
    try {
      for (const entry of (await zipEntries(handle)).values()) {
        assert.match(entry.name, /^Index\/.*\.iwa$/, `${name}: ${entry.name}`);
        assert.doesNotMatch(entry.name, /Stylesheet|TemplateSlide|Metadata|ViewState/, `${name}: ${entry.name}`);
        const raw = Buffer.alloc(entry.compressed);
        await handle.read(raw, 0, entry.compressed, entry.offset + 30 + entry.name.length);
        // A table imported from a CSV keeps that file's full path inside the document, so this is checked for real.
        assert.doesNotMatch(iwaBytes(raw).toString('latin1'), /\/(?:Users|private|var|tmp|home)\//, `${name}: ${entry.name}`);
      }
    } finally {
      await handle.close();
    }
  }
});

test('amounts keep their sign, and a very long number is still a number', () => {
  assert.equal(decimal128(Buffer.from('39300000000000000000000000003eb0', 'hex')), -1234.5);
  assert.ok(Number.isFinite(decimal128(Buffer.from('ffffffffffffffffffffffffff004030', 'hex'))));
});

test('a date whose format hides the year prints no year: behind a pivot table\'s month is a year nobody chose', () => {
  assert.equal(dateText(0, 'M/d/yy h:mm a'), '2001-01-01');
  assert.equal(dateText(0, 'LLLL'), 'January');
  assert.equal(dateText(3_600, 'h:mm a'), '01:00');
});

test('a file that is not an iWork file fails as not-iwork, a private key named .key among them', async () => {
  assert.equal(await codeOf(Buffer.from('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n'), 'key'), 'not-iwork');
  assert.equal(await codeOf(Buffer.alloc(0), 'key'), 'not-iwork');
  assert.equal(await codeOf(zip([{ name: 'readme.txt', data: Buffer.from('a plain archive') }]), 'pages'), 'not-iwork');
  // The real thing under the wrong name: a Pages document is not read as Keynote or Numbers.
  const pages = await readFile(path.join(FIXTURES, 'notes.pages'));
  assert.equal(await codeOf(pages, 'key'), 'not-iwork');
  assert.equal(await codeOf(pages, 'numbers'), 'not-iwork');
  assert.equal(await codeOf(await readFile(path.join(FIXTURES, 'deck.key')), 'pages'), 'not-iwork');
});

test('a locked document fails as password; iWork \'09 fails as old-format', async () => {
  // Password marks at the top of a real document's parts, as the apps write them.
  const locked = [{ name: 'Index/Document.iwa', data: Buffer.from('encrypted bytes') }];
  assert.equal(await codeOf(zip([...locked, { name: '.iwph', data: Buffer.from('hint') }]), 'pages'), 'password');
  assert.equal(await codeOf(zip([...locked, { name: '.iwpv2', data: Buffer.from('verifier') }]), 'numbers'), 'password');
  assert.equal(await codeOf(zip([{ name: 'index.xml', data: Buffer.from('<sl:document/>') }]), 'pages'), 'old-format');
  assert.equal(await codeOf(zip([{ name: 'index.apxl', data: Buffer.from('<key:presentation/>') }]), 'key'), 'old-format');
});

test('an archive that claims or expands past the limit fails as too-large, without reading it all', async () => {
  assert.equal(await codeOf(zip([{ name: 'Index/Document.iwa', data: Buffer.alloc(16), declared: MAX_PART_BYTES + 1 }]), 'pages'), 'too-large');
  const bomb = deflateRawSync(Buffer.alloc(MAX_PART_BYTES + 1));
  assert.equal(await codeOf(zip([{ name: 'Index/Document.iwa', data: bomb, method: 8, declared: bomb.length }]), 'pages'), 'too-large');
  // A Snappy block that claims more than a part may hold.
  const claim = chunk(Buffer.concat([varint(MAX_PART_BYTES + 1), Buffer.from([0, 0x41])]));
  assert.equal(await codeOf(zip([{ name: 'Index/Document.iwa', data: claim }]), 'pages'), 'too-large');
});

test('all the parts together past the limit fail as too-large, for the index and the SSN guard (#229)', async () => {
  const file = path.join(FIXTURES, 'notes.pages');
  assert.ok((await iworkPages(file, 'pages', { totalBytes: 10_000_000 })).length > 0, 'room to spare reads');
  await assert.rejects(iworkPages(file, 'pages', { totalBytes: 1_000 }), { code: 'too-large' });
  await assert.rejects(iworkCarriedText(file, { totalBytes: 1_000 }), { code: 'too-large' });
});

test('a link stored in the archive is read as bytes and never followed', async () => {
  await inTemp(async (dir) => {
    const outside = path.join(dir, 'outside.txt');
    await writeFile(outside, 'DOESECRET outside the archive');
    const link = zip([{ name: 'Index/Document.iwa', data: Buffer.from(outside), mode: 0o120777 }]);
    const code = await codeOf(link, 'pages');
    assert.equal(code, 'unreadable');
  });
});

test('damaged files fail as unreadable, and never hang or crash the sync', async () => {
  const damaged: Record<string, Buffer> = {
    'a chunk that is not type 0': Buffer.from([1, 1, 0, 0, 0]),
    'a copy from before the start': chunk(Buffer.from([4, 0x01, 0x09])),
    'a block shorter than it claims': chunk(Buffer.concat([varint(9), Buffer.from([0, 0x41])])),
    'a field past the message': iwaPart([[1, 10000, Buffer.from([0x22, 0x7f])]]),
  };
  for (const [what, data] of Object.entries(damaged)) {
    assert.equal(await codeOf(zip([{ name: 'Index/Document.iwa', data }]), 'pages'), 'unreadable', what);
  }
  const whole = await readFile(path.join(FIXTURES, 'notes.pages'));
  assert.equal(await codeOf(whole.subarray(0, whole.length - 200), 'pages'), 'unreadable', 'cut short, as a file still downloading can be');
});

/** A Numbers document with one table of one tile row; the store's lists are not needed for these cells. */
const tableFile = (row: Buffer) => document([
  [1, 1, ref(1, 2)],
  [2, 2, msg(bytes(1, 'Sheet'), ref(2, 3))],
  [3, 6000, ref(2, 4)],
  [4, 6001, bytes(4, bytes(3, msg(bytes(1, msg(num(1, 0), ref(2, 5))), num(2, 256))))],
  [5, 6002, bytes(5, row)],
]);
/** A cell in storage version `version` holding a double, flag 0x2, of type 2 (a number). */
function numberCell(value: number, version = 5): Buffer {
  const cell = Buffer.alloc(20);
  cell[0] = version;
  cell[1] = 2;
  cell.writeUInt32LE(0x2, 8);
  cell.writeDoubleLE(value, 12);
  return cell;
}
const offsets = (...values: number[]) => {
  const out = Buffer.alloc(values.length * 2);
  for (const [index, value] of values.entries()) out.writeUInt16LE(value, index * 2);
  return out;
};

test('a row that cannot be read fails visibly, never as an empty table', async () => {
  const row = (cells: Buffer, list: Buffer) => msg(num(1, 0), bytes(6, cells), bytes(7, list));
  const two = Buffer.concat([numberCell(1.5), numberCell(2.5)]);
  assert.deepEqual(await pagesOf('Gap.numbers', tableFile(row(two, offsets(0, 0xffff, 20))), 'numbers'), [{ n: 1, text: 'Sheet 1: Sheet\n\n1.5 |  | 2.5' }], 'an empty cell between values stays');
  assert.equal(await codeOf(tableFile(row(numberCell(1), offsets(0, 900))), 'numbers'), 'unreadable', 'an offset past the row');
  assert.equal(await codeOf(tableFile(row(numberCell(1, 4), offsets(0))), 'numbers'), 'old-format', 'an older cell version');
  assert.equal(await codeOf(tableFile(msg(num(1, 0), bytes(3, numberCell(1, 4)), bytes(4, offsets(0)))), 'numbers'), 'old-format', 'cells only where a much older Numbers kept them');
});

test('a row whose offsets count in fours reads its cells: the apps save these even for small rows', async () => {
  const cells = Buffer.concat([numberCell(1.5), Buffer.alloc(4), numberCell(2.5)]);
  const row = msg(num(1, 0), bytes(6, cells), bytes(7, offsets(0, 6)), num(8, 1));
  assert.deepEqual(await pagesOf('Wide.numbers', tableFile(row), 'numbers'), [{ n: 1, text: 'Sheet 1: Sheet\n\n1.5 | 2.5' }]);
});

test('a table name shows only when the table says so: a name with no switch is one the app hides (#227)', async () => {
  const named = (name: string, shown?: number) => document([
    [1, 1, ref(1, 2)],
    [2, 2, msg(bytes(1, 'Sheet'), ref(2, 3))],
    [3, 6000, ref(2, 4)],
    [4, 6001, msg(bytes(8, name), ...(shown === undefined ? [] : [num(9, shown)]), bytes(4, bytes(3, msg(bytes(1, msg(num(1, 0), ref(2, 5))), num(2, 256)))))],
    [5, 6002, bytes(5, msg(num(1, 0), bytes(6, numberCell(1.5)), bytes(7, offsets(0))))],
  ]);
  const text = async (file: Buffer) => (await pagesOf('Named.numbers', file, 'numbers'))[0]?.text;
  assert.equal(await text(named('DOETABLE', 1)), 'Sheet 1: Sheet\n\nTable: DOETABLE\n1.5');
  assert.equal(await text(named('DOETABLE', 0)), 'Sheet 1: Sheet\n\n1.5');
  assert.equal(await text(named('DOETABLE')), 'Sheet 1: Sheet\n\n1.5', 'unset reads as off, as protobuf defaults a bool');
});

// This aborts a process on purpose, so it runs in CI and not on a Mac, where crash reports land on someone's desktop.
test('a file that would exhaust the heap fails cleanly: a crash no catch can stop, so a process dies alone', { skip: process.platform === 'darwin' && 'aborts a process' }, async () => {
  // One 8 MB string named by 8 cells in a row: one allocation, past the limit all at once.
  const cell = Buffer.alloc(16);
  cell[0] = 5;
  cell[1] = 3;
  cell.writeUInt32LE(0x8, 8);
  cell.writeUInt32LE(1, 12);
  const store = msg(bytes(3, msg(bytes(1, msg(num(1, 0), ref(2, 5))), num(2, 256))), ref(4, 6));
  const file = document([
    [1, 1, ref(1, 2)], [2, 2, msg(bytes(1, 'Sheet'), ref(2, 3))], [3, 6000, ref(2, 4)], [4, 6001, bytes(4, store)],
    [5, 6002, bytes(5, msg(num(1, 0), bytes(6, Buffer.concat(Array<Buffer>(8).fill(cell))), bytes(7, offsets(0, 16, 32, 48, 64, 80, 96, 112))))],
    [6, 6005, bytes(3, msg(num(1, 1), bytes(3, Buffer.alloc(8 * 1024 * 1024, 'x'))))],
  ]);
  assert.equal(await codeOf(file, 'numbers', { heapMb: 32 }), 'too-large');
});

test('a footnote in a rich text cell stays with its cell', async () => {
  const cell = Buffer.alloc(16);
  cell[0] = 5;
  cell[1] = 9;
  cell.writeUInt32LE(0x10, 8);
  cell.writeUInt32LE(1, 12);
  const store = msg(bytes(3, msg(bytes(1, msg(num(1, 0), ref(2, 5))), num(2, 256))), ref(17, 6));
  const file = document([
    [1, 1, ref(1, 2)], [2, 2, msg(bytes(1, 'Sheet'), ref(2, 3))], [3, 6000, ref(2, 4)], [4, 6001, bytes(4, store)],
    [5, 6002, bytes(5, msg(num(1, 0), bytes(6, cell), bytes(7, offsets(0))))],
    [6, 6005, bytes(3, msg(num(1, 1), ref(9, 7)))], [7, 6218, ref(1, 8)],
    [8, STORAGE, msg(bytes(3, 'DOECELL\u000E'), bytes(16, bytes(1, msg(num(1, 7), ref(2, 9)))))],
    [9, 2008, ref(2, 10)], [10, STORAGE, bytes(3, 'DOENOTE')],
  ]);
  assert.deepEqual(await pagesOf('Rich.numbers', file, 'numbers'), [{ n: 1, text: 'Sheet 1: Sheet\n\nDOECELL[1] [1] DOENOTE' }]);
});

test('text and tables the walk cannot reach are read anyway, under their own heading', async () => {
  const stray = bytes(3, 'DOESTRAY text in a structure no walk knows');
  const file = pagesFile(bytes(3, 'DOEBODY words'), [[3, STORAGE, stray], [4, 6001, bytes(4, bytes(3, msg(bytes(1, msg(num(1, 0), ref(2, 5))), num(2, 256))))], [5, 6002, bytes(5, msg(num(1, 0), bytes(6, numberCell(7)), bytes(7, offsets(0))))]]);
  assert.deepEqual(await pagesOf('Stray.pages', file, 'pages'), [{ n: 1, text: 'DOEBODY words\n\nOther text:\nDOESTRAY text in a structure no walk knows\n7' }]);
});

test('a tracked deletion takes the footnote and the text box it covers with it', async () => {
  const body = msg(
    bytes(3, 'DOEKEPT \u000E\uFFFC end'),
    bytes(9, bytes(1, msg(num(1, 9), ref(2, 5)))),
    bytes(16, bytes(1, msg(num(1, 8), ref(2, 3)))),
    bytes(22, msg(bytes(1, num(1, 0)), bytes(1, msg(num(1, 8), ref(2, 9))), bytes(1, num(1, 10)))),
  );
  const file = pagesFile(body, [[3, 2008, ref(2, 4)], [4, STORAGE, bytes(3, 'DOEGONE note')], [5, 2003, ref(1, 6)], [6, 2011, ref(2, 7)], [7, STORAGE, bytes(3, 'DOEGONE box')], [9, 2060, num(1, 2)]]);
  assert.deepEqual(await pagesOf('Deleted.pages', file, 'pages'), [{ n: 1, text: 'DOEKEPT  end' }]);
});

test('a skipped first slide stays with the first visible slide, which is still slide 1', async () => {
  const slides = (first: number): [number, number, Buffer][] => [[1, 1, ref(2, 2)], [2, 2, bytes(3, msg(ref(2, 3), ref(2, 4)))], [3, 4, msg(ref(2, 5), num(4, first))], [4, 4, ref(2, 6)], [5, 5, Buffer.alloc(0)], [6, 5, Buffer.alloc(0)]];
  assert.deepEqual(await pagesOf('Skipped.key', document(slides(1)), 'key'), [{ n: 1, text: 'Slide 1\n\nSkipped slide' }]);
  assert.deepEqual(await pagesOf('Plain.key', document(slides(0)), 'key'), [{ n: 1, text: 'Slide 1' }, { n: 2, text: 'Slide 2' }]);
});

test('parts with nothing a person wrote are not read, so a theme\'s placeholder words never reach search', async () => {
  const file = zip([
    { name: 'Index/Document.iwa', data: iwaPart([[1, 10000, ref(4, 2)], [2, STORAGE, bytes(3, 'DOEBODY')]]) },
    { name: 'Index/TemplateSlide-1.iwa', data: iwaPart([[3, STORAGE, bytes(3, 'Body Level One')]]) },
  ]);
  assert.deepEqual(await pagesOf('Theme.pages', file, 'pages'), [{ n: 1, text: 'DOEBODY' }]);
});

test('a group that fans out without end is stopped at the deadline, fast', async () => {
  const fan = msg(...Array.from({ length: 300 }, () => ref(2, 3)));
  const file = document([[1, 1, ref(1, 2)], [2, 2, msg(bytes(1, 'Sheet'), ref(2, 3))], [3, GROUP, fan]]);
  const started = Date.now();
  assert.equal(await codeOf(file, 'numbers', { timeoutMs: 100 }), 'timeout');
  assert.ok(Date.now() - started < 5000, 'stopped by the deadline, not by the fan running out');
});

test('--check-index counts these files, and files it cannot read by code, without stopping', async () => {
  const job = (id: string, name: string, file: string): IndexJob => ({ id, kind: 'file', sha256: 'a'.repeat(64), file, name, staleParts: 0 });
  await inTemp(async (dir) => {
    const locked = path.join(dir, 'locked.pages');
    await writeFile(locked, zip([{ name: 'Index/Document.iwa', data: Buffer.from('encrypted') }, { name: '.iwph', data: Buffer.from('hint') }]));
    const check = await checkIndex(
      [job('d1', 'Deck.key', path.join(FIXTURES, 'deck.key')), job('d2', 'Plan.pages', locked), job('d3', 'Model.numbers', path.join(FIXTURES, 'ledger.numbers'))],
      { extractPdf: () => assert.fail('no PDF here'), readText: (file, name) => directTextPages(file, name) },
    );
    assert.equal(check.iworkDocs, 2);
    assert.deepEqual(check.failed, { password: 1 });
    assert.match(formatIndexCheck(check), /Pages, Numbers and Keynote documents read as text: 2/);
    assert.match(formatIndexCheck(check), /Failed: password 1/);
  });
});

test('what a file holds but does not show is read for the SSN guard and never for the index', async () => {
  const file = path.join(FIXTURES, 'agreement.pages');
  const shown = (await iworkPages(file, 'pages')).map((page) => page.text).join('\n');
  for (const word of ['DOEDELETED', 'DOECOMMENTTEXT']) assert.doesNotMatch(shown, new RegExp(word));
  const carried = await iworkCarriedText(file);
  for (const word of ['DOEDELETED', 'DOECOMMENTTEXT', 'DOEINSERTED', 'DOEFOOTNOTE']) assert.match(carried, new RegExp(word));
  await inTemp(async (dir) => {
    // A template slide's table is left out of the index, and leaves with the file all the same.
    const theme = path.join(dir, 'Theme.key');
    await writeFile(theme, zip([
      { name: 'Index/Document.iwa', data: iwaPart([[1, 1, Buffer.alloc(0)]]) },
      { name: 'Index/TemplateSlide-1.iwa', data: iwaPart([[3, 6005, msg(bytes(4, msg(bytes(3, 'DOETEMPLATE'))))]]) },
    ]));
    assert.match(await iworkCarriedText(theme), /DOETEMPLATE/);
    // An SSN only in a tracked deletion is flagged, because the room serves the whole file.
    const deletion = msg(bytes(3, 'DOEKEPT 123-45-6789'), bytes(22, msg(bytes(1, num(1, 0)), bytes(1, msg(num(1, 8), ref(2, 3))))));
    const held = path.join(dir, 'Held.pages');
    await writeFile(held, pagesFile(deletion, [[3, 2060, num(1, 2)]]));
    assert.equal((await iworkPages(held, 'pages'))[0]?.text, 'DOEKEPT');
    const scan = await scanForPii([{ id: 'a', rel: 'Held.pages', sha256: 'a'.repeat(64), file: held, kind: 'file' }], {
      extractPdf: () => assert.fail('no PDF here'),
      readText: (name, shownName) => directTextPages(name, shownName),
      known: null,
    });
    assert.deepEqual(scan.flagged.map((doc) => doc.hits.map((hit) => hit.page)), [[null]]);
    // A 50-byte string's length is the character "2", so its bytes as they are would read as a longer number.
    const hidden = path.join(dir, 'Hidden.pages');
    await writeFile(hidden, pagesFile(bytes(3, 'DOEKEPT'), [[3, 6005, bytes(1, '123-45-6789'.padEnd(50, ' x'))]]));
    const found = await scanForPii([{ id: 'b', rel: 'Hidden.pages', sha256: 'b'.repeat(64), file: hidden, kind: 'file' }], {
      extractPdf: () => assert.fail('no PDF here'),
      readText: (name, shownName) => directTextPages(name, shownName),
      known: null,
    });
    assert.equal(found.flagged.length, 1, 'a number at the start of an unreferenced string');
  });
});

test('the SSN guard finds what a crafted file tucks away, and fails on what it cannot read', async () => {
  const carried = (data: Buffer) => inTemp(async (dir) => {
    const file = path.join(dir, 'Crafted.pages');
    await writeFile(file, data);
    return iworkCarriedText(file);
  });
  const stray = (...others: [number, number, Buffer][]) => pagesFile(bytes(3, 'DOEKEPT'), others);
  const deep = Array.from({ length: 20 }).reduce<Buffer>((inner) => bytes(1, inner), bytes(1, 'DOEDEEP'));
  assert.match(await carried(stray([3, 6005, deep])), /DOEDEEP/, 'any depth');
  assert.match(await carried(stray([3, 6005, bytes(1, 'DOEFIRST')], [3, 6005, bytes(1, 'DOESECOND')])), /DOEFIRST/, 'an ID used twice');
  const first = bytes(1, 'DOEFIRST');
  const second = bytes(1, 'DOEVERSIONNOTE');
  const info = msg(num(1, 3), bytes(2, msg(num(1, 6005), num(3, first.length))), bytes(2, msg(num(1, 6005), num(3, second.length))));
  const twoMessages = zip([
    { name: 'Index/Document.iwa', data: iwaPart([[1, 10000, ref(4, 2)], [2, STORAGE, bytes(3, 'DOEKEPT')]]) },
    { name: 'Index/Other.iwa', data: chunk(snappyLiteral(Buffer.concat([varint(info.length), info, first, second]))) },
  ]);
  assert.match(await carried(twoMessages), /DOEVERSIONNOTE/, 'an archive\'s second message');
  assert.match(await carried(pagesFile(msg(bytes(3, 'DOE 123-4'), bytes(3, '5-6789')))), /123-45-6789/, 'a number across the pieces of a text');
  await assert.rejects(carried(stray([3, 6005, Buffer.from([0x0a, 0x7f])])), (error: unknown) => error instanceof IworkFailure && error.code === 'unreadable', 'an object that does not parse');
  // Past the stack's depth the whole file is unread, never part of it read and called clean.
  const fifty = '123-45-6789'.padEnd(50, ' x');
  const tower = Array.from({ length: 5000 }).reduce<Buffer>((inner) => bytes(1, inner), bytes(1, fifty));
  const outcome = await carried(stray([3, 6005, tower])).then((text) => text.split('\n').includes(fifty), (error: unknown) => error instanceof IworkFailure && error.code === 'unreadable');
  assert.equal(outcome, true, 'a number nested past the stack');
  assert.match(await carried(stray([3, 6005, bytes(1, '123\x0045\x006789')])), /^123\n45\n6789$/m, 'binary is not a number with spaces in it');
  // JSON writes a control byte as six characters, which took a real table of 20,000 rows past the reply's limit.
  assert.doesNotMatch(await iworkCarriedText(path.join(FIXTURES, 'ledger.numbers')), /[\x00-\x09\x0b-\x1f]/);
});

test('a .key that is not Keynote is read as what it is, once, and a private key is flagged with the fix', async () => {
  await inTemp(async (dir) => {
    const write = async (name: string, data: string | Buffer) => {
      const file = path.join(dir, name);
      await writeFile(file, data);
      return { id: name, rel: `a/${name}`, sha256: name[0]!.repeat(64), file, kind: 'file' as const }; // safe: the names here aren't empty
    };
    const targets = [
      await write('der.key', Buffer.from([0x30, 0x82, 0, 1, 2])),
      await write('licence.key', 'DOELICENCE for 123-45-6789\n'),
      await write('server.key', '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n'),
    ];
    for (const target of targets) assert.deepEqual(await directTextPages(target.file, target.id), [], 'nothing to index, so no job next run');
    const scan = await scanForPii(targets, { extractPdf: () => assert.fail('no PDF here'), readText: (file, name) => directTextPages(file, name), known: null });
    assert.deepEqual(scan.flagged.map((doc) => [doc.path, doc.hits.map((hit) => hit.rule)]), [['a/licence.key', ['ssn-form']], ['a/server.key', ['private-key']]]);
    assert.deepEqual(scan.unscanned.map((skip) => [skip.path, skip.reason]), [['a/der.key', 'key']], 'listed as a binary it cannot read, not as a broken Keynote');
    const lines = formatPiiReport(scan, piiGate(scan, []), null, false, null).join('\n');
    assert.match(lines, /take it out of the shared folder/);
    assert.doesNotMatch(lines, /Could not read/);
  });
});

test('one the SSN guard cannot read stops --apply and is listed with what to do, its path masked', async () => {
  await inTemp(async (dir) => {
    const clean = path.join(dir, 'a.pages');
    const held = path.join(dir, 'b.pages');
    const locked = path.join(dir, 'c.pages');
    await writeFile(clean, await readFile(path.join(FIXTURES, 'notes.pages')));
    await writeFile(held, pagesFile(bytes(3, 'DOEBODY with 123-45-6789 in it')));
    await writeFile(locked, zip([{ name: '.iwpv2', data: Buffer.from('verifier') }]));
    const target = (rel: string, file: string, id: string) => ({ id, rel, sha256: id.repeat(64), file, kind: 'file' as const });
    const scan = await scanForPii([target('Folder/Clean.pages', clean, 'a'), target('Folder/Held.pages', held, 'b'), target('Folder/123-45-6789 Locked.pages', locked, 'c')], {
      extractPdf: () => assert.fail('no PDF here'),
      readText: (file, name) => directTextPages(file, name),
      known: null,
    });
    assert.equal(scan.scanned, 2);
    assert.deepEqual(scan.unscanned.map((skip) => skip.reason), ['failed: password']);
    const gate = piiGate(scan, []);
    assert.match(piiRefusal(gate) ?? '', /1 could not be read/);
    const lines = formatPiiReport(scan, gate, null, false, null).join('\n');
    assert.match(lines, /Locked\.pages {2}\(locked with a password\. Remove it in the app, or export a PDF, then sync again\)/);
    assert.doesNotMatch(lines, /123-45-6789/);
    assert.doesNotMatch(formatPiiReport(scan, gate, null, true, null).join('\n'), /Locked\.pages/, '--summary keeps to counts');
  });
});
