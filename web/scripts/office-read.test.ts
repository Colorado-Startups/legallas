// SPDX-License-Identifier: Apache-2.0
// Word, RTF and OpenDocument text with no outside tool (office-read.ts), and PowerPoint and Excel through this process's
// own zip reader (office.ts, everywhere but macOS). Every fixture is made here from invented text, so this runs on every
// computer: a Linux runner, a Windows runner and a Mac.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { zipEntry, zipNames } from './law/docx.ts';
import { officeTextInChild, type OfficeFormat, type ReadLimits } from './office.ts';
import { cfbStreams, docText, docxText, MAX_PART_BYTES, odtText, rtfText, TooLarge, wordMarks, zipText } from './office-read.ts';
import { docProperties, scanForPii } from './pii-scan.ts';
import { decodeText } from './text-file.ts';

/** A zip archive of the given entries, deflated as Office writes them. */
function zip(entries: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content);
    const packed = deflateRawSync(data);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WORD_XML = (body: string) => `<?xml version="1.0"?><w:document xmlns:w="${WORD_NS}"><w:body>${body}</w:body></w:document>`;
const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const WORD_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const types = (parts: Record<string, string>) =>
  `<Types>${Object.entries(parts).map(([name, type]) => `<Override PartName="/${name}" ContentType="${WORD_TYPE}.${type}+xml"/>`).join('')}</Types>`;
/** A .docx as Word writes one: the main part named by its content type. */
const docx = (body: string, part = 'word/document.xml') => zip({ '[Content_Types].xml': types({ [part]: 'document.main' }), [part]: WORD_XML(body) });
const SSN = '123-45-6789';
const ODT_NS = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
const odt = (body: string) => zip({ 'content.xml': `<office:document-content xmlns:text="${ODT_NS}"><office:body><office:text>${body}</office:text></office:body></office:document-content>` });

test('a .docx reads its paragraphs and table cells, one to a line, with entities decoded and its footnotes after', () => {
  const body =
    para('Stock Purchase Agreement') +
    '<w:p/>' +
    '<w:tbl><w:tr><w:tc>' + para('Harbor Labs &amp; Co.') + '</w:tc><w:tc>' + para('100,000 shares') + '</w:tc></w:tr></w:tbl>' +
    '<w:p><w:r><w:t xml:space="preserve">Signed </w:t><w:tab/><w:t>Jane</w:t><w:br/><w:t>Doe</w:t></w:r></w:p>';
  const file = zip({
    '[Content_Types].xml': types({ 'word/document.xml': 'document.main', 'word/footnotes.xml': 'footnotes' }),
    'word/document.xml': WORD_XML(body),
    'word/footnotes.xml': WORD_XML(para('See Exhibit A.')),
  });
  assert.equal(docxText(file), 'Stock Purchase Agreement\n\nHarbor Labs & Co.\n100,000 shares\nSigned Jane Doe\nSee Exhibit A.');
});

test('text a tracked change deleted is not read', () => {
  assert.equal(docxText(docx('<w:p><w:r><w:t>Kept</w:t></w:r><w:del><w:r><w:delText>Struck</w:delText></w:r></w:del></w:p>')), 'Kept');
  assert.equal(odtText(odt('<text:tracked-changes><text:changed-region><text:deletion><text:p>Struck</text:p></text:deletion></text:changed-region></text:tracked-changes><text:p>Kept</text:p>')), 'Kept');
});

// What these find is what the SSN guard reads, so text they miss goes past it.
test('a main part under another name, or another namespace prefix, is still read', () => {
  assert.equal(docxText(docx(para(SSN), 'word/main.xml')), SSN);
  const prefixed = WORD_XML(para(SSN)).replaceAll('w:', 'ns0:').replace('xmlns:w=', 'xmlns:ns0=');
  assert.equal(docxText(zip({ '[Content_Types].xml': types({ 'word/document.xml': 'document.main' }), 'word/document.xml': prefixed })), SSN);
  const bare = `<document xmlns="${WORD_NS}"><body><p><r><t>${SSN}</t></r></p></body></document>`;
  assert.equal(docxText(zip({ '[Content_Types].xml': types({ 'word/document.xml': 'document.main' }), 'word/document.xml': bare })), SSN);
  const odtPrefixed = zip({ 'content.xml': `<x xmlns:t="${ODT_NS}"><t:p>${SSN}</t:p></x>` });
  assert.equal(odtText(odtPrefixed), SSN);
  // A paragraph nested in another doesn't lose what follows it.
  assert.equal(docxText(docx('<w:p><w:r><w:t>Before</w:t></w:r>' + para('Boxed') + `<w:r><w:t>${SSN}</w:t></w:r></w:p>`)), `Boxed\nBefore${SSN}`);
});

test('a file that isn\'t what its name says fails, and never reads as empty text', () => {
  const plain = zip({ 'readme.txt': 'hello' });
  assert.throws(() => docxText(plain), /not a Word file/);
  assert.throws(() => odtText(plain), /not an OpenDocument/);
  assert.throws(() => docxText(zip({ '[Content_Types].xml': types({ 'word/gone.xml': 'document.main' }) })), /not a Word file/);
  assert.throws(() => docxText(zip({ '[Content_Types].xml': types({ 'word/document.xml': 'document.main' }), 'word/document.xml': `<w:document xmlns:w="other">${para(SSN)}</w:document>` })), /not a Word part/);
  assert.equal(docxText(docx('<w:p/>')), '', 'a blank document that opens is blank');
});

test('a part with tags left open fails in one pass', () => {
  const started = Date.now();
  const open = `<w:document xmlns:w="${WORD_NS}">${'<w:p '.repeat(400_000)}`;
  assert.throws(() => docxText(zip({ '[Content_Types].xml': types({ 'word/document.xml': 'document.main' }), 'word/document.xml': open })), /not closed/);
  assert.ok(Date.now() - started < 5000, 'quadratic would take minutes');
});

test('a > in an attribute value, which XML allows, doesn\'t end its tag', () => {
  assert.equal(docxText(docx(WORD_XML(`<w:p w:a="x>y"/><w:p w:b='x>y'><w:r w:c="1>0"><w:t>Kept</w:t></w:r></w:p>`))), '\nKept');
});

test('an entry too large to read fails as too large, and a smaller limit is what stops it', () => {
  const file = zip({ 'word/document.xml': 'x'.repeat(5000) });
  assert.throws(() => zipEntry(file, 'word/document.xml', 100), (error: NodeJS.ErrnoException) => error.code === 'ERR_BUFFER_TOO_LARGE');
  assert.equal(zipEntry(file, 'word/document.xml', 5000)?.length, 5000);
  assert.equal(zipText(file, 'no/such/part.xml'), '');
  assert.deepEqual(zipNames(file), ['word/document.xml']);
  assert.ok(MAX_PART_BYTES > 5000);
  const bomb = zip({ 'word/document.xml': Buffer.alloc(MAX_PART_BYTES + 1) });
  assert.throws(() => zipText(bomb, 'word/document.xml'), TooLarge);
});

test('an OpenDocument text file reads paragraphs, headings, tabs and breaks', () => {
  const body =
    '<text:h text:outline-level="1">Offer Letter</text:h>' +
    '<text:p text:style-name="P1">Dear <text:span>Jane</text:span> &amp; team</text:p>' +
    '<text:p/>' +
    '<text:p>One<text:tab/>two<text:s/>three<text:line-break/>four</text:p>';
  assert.deepEqual(odtText(odt(body)).split('\n').filter((line) => line !== ''), ['Offer Letter', 'Dear Jane & team', 'One\ttwo three', 'four']);
});

test('RTF reads its text, its code page and its Unicode, and leaves out tables of fonts and the like', () => {
  const rtf =
    '{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Times New Roman;}}{\\colortbl;\\red0\\green0\\blue0;}' +
    '{\\info{\\author Someone}}{\\*\\generator Word;}' +
    '\\f0\\fs24 Investor R\\\'e9sum\\\'e9\\par Second \\b bold\\b0  line\\line next\\tab tabbed\\par ' +
    'Curly \\u8217? and \\uc2\\u8211 xy done\\uc1\\par {\\pict\\pngblip 89504e47}' +
    'Braces \\{ and \\} and \\\\ slash\\~here\\par}';
  assert.equal(rtfText(Buffer.from(rtf, 'latin1')), 'Investor Résumé\nSecond bold line\nnext\ttabbed\nCurly ’ and – done\nBraces { and } and \\ slash here\n');
});

test('RTF skips binary data by its stated length, and reads another code page', () => {
  assert.equal(rtfText(Buffer.from('{\\rtf1 before\\bin4 }{\\ after}', 'latin1')), 'beforeafter');
  assert.equal(rtfText(Buffer.from("{\\rtf1\\ansi\\ansicpg1251 \\'cf\\'f0\\'e8}", 'latin1')), 'При');
  assert.throws(() => rtfText(Buffer.from('plain text, not rtf')), /not rtf/);
  assert.equal(rtfText(Buffer.from('{\\rtf1 \\bin-8 x}', 'latin1')), 'x', 'a negative length is no way back into the file');
});

// --- A .doc, built here: a compound file holding a WordDocument stream and a table stream -------------------------------

const SECTOR = 512;
const END = 0xfffffffe;
const FREE = 0xffffffff;
const FAT_SECTOR = 0xfffffffd;
const MINI_CUTOFF = 4096;

function dirEntry(name: string, type: number, start: number, size: number): Buffer {
  const entry = Buffer.alloc(128);
  const nameBytes = Buffer.from(`${name}\0`, 'utf16le');
  nameBytes.copy(entry, 0);
  entry.writeUInt16LE(nameBytes.length, 64);
  entry[66] = type;
  entry.writeUInt32LE(FREE, 68);
  entry.writeUInt32LE(FREE, 72);
  entry.writeUInt32LE(FREE, 76);
  entry.writeUInt32LE(start, 116);
  entry.writeUInt32LE(size, 120);
  return entry;
}

/** A compound file. A stream under the cutoff goes in the mini stream, as Word puts a small table stream. */
function compound(streams: Record<string, Buffer>): Buffer {
  const pad = (data: Buffer, size: number) => Buffer.concat([data, Buffer.alloc((size - (data.length % size)) % size)]);
  const regular: Buffer[] = [];
  const chains: number[] = [];
  const nextSector = () => regular.reduce((sum, data) => sum + data.length / SECTOR, 0);
  const put = (data: Buffer): number => {
    const padded = pad(data, SECTOR);
    const start = nextSector();
    const count = padded.length / SECTOR;
    for (let i = 0; i < count; i += 1) chains[start + i] = i === count - 1 ? END : start + i + 1;
    regular.push(padded);
    return start;
  };
  const miniParts: Buffer[] = [];
  const miniChains: number[] = [];
  const entries: Buffer[] = [];
  for (const [name, data] of Object.entries(streams)) {
    if (data.length >= MINI_CUTOFF) {
      entries.push(dirEntry(name, 2, put(data), data.length));
      continue;
    }
    const start = miniParts.reduce((sum, part) => sum + part.length / 64, 0);
    const padded = pad(data, 64);
    const count = padded.length / 64;
    for (let i = 0; i < count; i += 1) miniChains[start + i] = i === count - 1 ? END : start + i + 1;
    miniParts.push(padded);
    entries.push(dirEntry(name, 2, start, data.length));
  }
  const mini = Buffer.concat(miniParts);
  const miniStart = mini.length > 0 ? put(mini) : END;
  const miniFatBytes = Buffer.alloc(miniChains.length * 4);
  miniChains.forEach((value, i) => miniFatBytes.writeUInt32LE(value, i * 4));
  const miniFatStart = miniChains.length > 0 ? put(miniFatBytes) : END;
  const directory = Buffer.concat([dirEntry('Root Entry', 5, miniStart, mini.length), ...entries]);
  const directoryStart = put(directory);
  const fatStart = nextSector();
  const fatCount = Math.ceil((fatStart + 2) / (SECTOR / 4));
  for (let i = 0; i < fatCount; i += 1) chains[fatStart + i] = FAT_SECTOR;
  const fat = Buffer.alloc(fatCount * SECTOR, 0xff);
  chains.forEach((value, i) => fat.writeUInt32LE(value, i * 4));
  const header = Buffer.alloc(SECTOR, 0);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header);
  header.writeUInt16LE(9, 30);
  header.writeUInt16LE(6, 32);
  header.writeUInt32LE(fatCount, 44);
  header.writeUInt32LE(directoryStart, 48);
  header.writeUInt32LE(MINI_CUTOFF, 56);
  header.writeUInt32LE(miniFatStart, 60);
  header.writeUInt32LE(miniChains.length > 0 ? 1 : 0, 64);
  header.writeUInt32LE(END, 68);
  for (let i = 0; i < 109; i += 1) header.writeUInt32LE(i < fatCount ? fatStart + i : FREE, 76 + i * 4);
  return Buffer.concat([header, ...regular, fat]);
}

/** A .doc whose pieces are these runs of text: Latin ones held one byte a character, the rest two. */
function doc(pieces: { text: string; wide?: boolean }[], flags = 0, pieceShift = 0): Buffer {
  const SHORTS = 14;
  const LONGS = 22;
  const PAIRS = 34 + SHORTS * 2 + 2 + LONGS * 4 + 2;
  const fib = Buffer.alloc(0x400);
  fib.writeUInt16LE(flags | 0x0200, 0x0a);
  fib.writeUInt16LE(SHORTS, 32);
  fib.writeUInt16LE(LONGS, 34 + SHORTS * 2);
  const texts: Buffer[] = [];
  let at = fib.length;
  const offsets: number[] = [];
  for (const piece of pieces) {
    const bytes = Buffer.from(piece.text, piece.wide ? 'utf16le' : 'latin1');
    offsets.push(piece.wide ? at + pieceShift : ((at + pieceShift) * 2) | 0x40000000);
    texts.push(bytes);
    at += bytes.length;
  }
  const cps = [0];
  for (const piece of pieces) cps.push(cps.at(-1)! + piece.text.length);
  const plc = Buffer.alloc((pieces.length + 1) * 4 + pieces.length * 8);
  cps.forEach((cp, i) => plc.writeUInt32LE(cp, i * 4));
  offsets.forEach((fc, i) => plc.writeUInt32LE(fc, (pieces.length + 1) * 4 + i * 8 + 2));
  const pcdt = Buffer.alloc(5);
  pcdt[0] = 2;
  pcdt.writeUInt32LE(plc.length, 1);
  // One property group before the piece table, as Word often writes.
  const clx = Buffer.concat([Buffer.from([1, 2, 0, 9, 9]), pcdt, plc]);
  const table = Buffer.concat([Buffer.alloc(16, 7), clx]);
  fib.writeUInt32LE(16, PAIRS + 33 * 8);
  fib.writeUInt32LE(clx.length, PAIRS + 33 * 8 + 4);
  const word = Buffer.concat([fib, ...texts, Buffer.alloc(MINI_CUTOFF)]);
  return compound({ WordDocument: word, '1Table': table });
}

test('a .doc reads its pieces, one byte or two a character, with Word\'s marks as a person reads them', () => {
  const file = doc([
    { text: 'Convertible Note\rBetween Harbor Labs\x07and Investor\r' },
    { text: 'Raté ’ Ж\r', wide: true },
    { text: 'See \x13 HYPERLINK "https://x.example" \x14the note\x15.\x0bNext\r' },
  ]);
  assert.equal(docText(file), 'Convertible Note\nBetween Harbor Labs\tand Investor\nRaté ’ Ж\nSee the note.\nNext\n');
});

test('the SSN guard reads a .doc with this reader, so it sees every story whatever reads the file for the index', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'legallas-doc-guard-'));
  try {
    const footnote = path.join(dir, 'footnote.doc');
    await writeFile(footnote, doc([{ text: 'Body.\r' }, { text: `Footnote ${['123', '45', '6789'].join('-')}\r` }]));
    const encrypted = path.join(dir, 'encrypted.doc');
    await writeFile(encrypted, doc([{ text: 'Body.\r' }], 0x0100));
    const target = (rel: string, file: string) => ({ id: rel, rel, sha256: rel, file, kind: 'file' as const });
    // As textutil reads one on a Mac: the body alone.
    const scan = await scanForPii([target('footnote.doc', footnote), target('encrypted.doc', encrypted)], { extractPdf: async () => [], readText: async () => [{ n: 1, text: 'Body.', ocr: false }], known: null });
    assert.deepEqual(scan.flagged.map((flagged) => flagged.path), ['footnote.doc']);
    assert.deepEqual(scan.unscanned.map((skip) => [skip.path, skip.reason]), [['encrypted.doc', 'failed: unreadable']], 'a .doc it cannot read is refused');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an encrypted .doc, or a file that is not one, fails rather than reads as nothing', () => {
  assert.throws(() => docText(doc([{ text: 'secret' }], 0x0100)), /encrypted/);
  assert.throws(() => docText(Buffer.from('not a compound file at all'.repeat(40))), /not a compound file/);
  assert.throws(() => docText(compound({ Other: Buffer.alloc(5000) })), /not a Word file/);
});

test('a .doc whose tables point at themselves fails, and doesn\'t fill memory', () => {
  const file = Buffer.alloc(1024);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(file);
  file.writeUInt16LE(9, 30);
  file.writeUInt16LE(6, 32);
  file.writeUInt32LE(0xfffffffe, 60);
  file.writeUInt32LE(0, 68);
  for (let i = 0; i < 109; i += 1) file.writeUInt32LE(0xffffffff, 76 + i * 4);
  assert.throws(() => docText(file), /no end/);
  // Its directory chain is a loop too.
  const looped = Buffer.from(file);
  looped.writeUInt32LE(0xfffffffe, 68);
  looped.writeUInt32LE(0, 76);
  assert.throws(() => docText(looped));
});

test('a compound file gives each stream back whole, from the regular and the mini stream', () => {
  const large = Buffer.alloc(9000, 3);
  const small = Buffer.from('small stream');
  const streams = cfbStreams(compound({ Large: large, Small: small }), ['Large', 'Small', 'Missing']);
  assert.ok(streams.get('Large')!.equals(large));
  assert.ok(streams.get('Small')!.equals(small));
  assert.equal(streams.has('Missing'), false);
});

test('a field\'s code goes and its result stays, however deep', () => {
  assert.equal(wordMarks('a\x13 PAGE \x151'), 'a1');
  assert.equal(wordMarks('a\x13 IF \x13 X \x14y\x15 \x14z\x15b'), 'azb');
  assert.equal(wordMarks('no\u001ebreak space\x01\x08'), 'no-break space');
});

// --- In the child process, where a founder on Windows reads them -------------------------------------------------------

async function inTemp(work: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'legallas-office-read-'));
  try {
    await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const read = async (dir: string, format: OfficeFormat, bytes: Buffer, limits?: ReadLimits) => {
  const file = path.join(dir, `000001.${format}`);
  await writeFile(file, bytes);
  return officeTextInChild(file, format, limits);
};

test('every office format reads in the child, with no outside tool', async () => {
  await inTemp(async (dir) => {
    assert.equal(await read(dir, 'docx', docx(para('From Word'))), 'From Word');
    assert.equal(await read(dir, 'odt', odt('<text:p>From Writer</text:p>')), 'From Writer');
    assert.equal(await read(dir, 'rtf', Buffer.from('{\\rtf1 From RTF\\par}', 'latin1')), 'From RTF');
    assert.equal(await read(dir, 'doc', doc([{ text: 'From Word 97\r' }])), 'From Word 97');
    const slide = (text: string) => `<p:sld><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`;
    assert.equal(await read(dir, 'pptx', zip({ 'ppt/slides/slide1.xml': slide('First'), 'ppt/slides/slide2.xml': slide('Second') })), 'Slide 1\nFirst\n\nSlide 2\nSecond');
    const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>12</v></c></row></sheetData></worksheet>';
    assert.equal(await read(dir, 'xlsx', zip({ 'xl/worksheets/sheet1.xml': sheet, 'xl/sharedStrings.xml': '<sst><si><t>Shares</t></si></sst>' })), 'Sheet 1\nShares | 12');
  });
});

test('a file that can\'t be read fails with a short code and nothing of the file', async () => {
  await inTemp(async (dir) => {
    const plainZip = zip({ 'readme.txt': 'a secret word' });
    for (const format of ['docx', 'odt', 'pptx', 'xlsx'] as const) await assert.rejects(read(dir, format, plainZip), { message: 'office text failed: unreadable' });
    for (const format of ['docx', 'odt', 'rtf', 'doc', 'pptx', 'xlsx'] as const) {
      await assert.rejects(read(dir, format, Buffer.from('garbage with a secret word')), { message: 'office text failed: unreadable' });
    }
    await assert.rejects(read(dir, 'docx', zip({ '[Content_Types].xml': types({ 'word/document.xml': 'document.main' }), 'word/document.xml': Buffer.alloc(MAX_PART_BYTES + 1) })), { message: 'office text failed: too-large' });
  });
});

test('a document that doesn\'t close fails, and never reads as clean text', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'office-'));
  try {
    const wordRoot = `<w:document xmlns:w="${WORD_NS}"><w:body>`;
    const cases: [OfficeFormat, Buffer][] = [
      ['docx', docx(`${wordRoot}<w:p><w:r><w:t>${SSN}`)],
      ['docx', docx(`${wordRoot}${'<w:p '.repeat(40_000)}${SSN}`)],
      ['docx', docx(WORD_XML(`<w:p><w:r><w:t>${SSN}</w:p></w:t></w:r>`))],
      ['odt', zip({ 'content.xml': `<office:document-content xmlns:text="${ODT_NS}"><text:p>${SSN}` })],
      ['rtf', Buffer.from(`{\\rtf1 before \\bin99999999 ${SSN}}`)],
      ['rtf', Buffer.from(`{\\rtf1 {\\fonttbl{\\f0 Arial;} ${SSN}`)],
      ['doc', doc([{ text: SSN }], 0, 1_000_000)],
    ];
    for (const [format, bytes] of cases) await assert.rejects(read(dir, format, bytes), { message: 'office text failed: unreadable' }, format);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a reader that runs past its deadline, or out of memory, is a failure and not empty text', async () => {
  await inTemp(async (dir) => {
    await assert.rejects(read(dir, 'docx', docx(para('Never read')), { timeoutMs: 1 }), { message: /office text failed: (timeout|unreadable)/ });
    const big = docx(para('x'.repeat(30 * 1024 * 1024)));
    await assert.rejects(read(dir, 'docx', big, { heapMb: 4 }), { message: /office text failed: (too-large|unreadable)/ });
  });
});

test('hidden and struck text stays out of the reader, and in the SSN guard (#278)', async () => {
  const hiddenRun = '<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>HIDDENWORD</w:t></w:r><w:r><w:rPr><w:vanish w:val="0"/></w:rPr><w:t>shown</w:t></w:r></w:p>';
  assert.equal(docxText(docx(hiddenRun)), 'shown');
  assert.equal(docxText(docx('<w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr><w:r><w:t>mark only</w:t></w:r></w:p>')), 'mark only', 'a hidden paragraph mark hides no text');
  const rtf = Buffer.from('{\\rtf1\\ansi {\\v HIDDENWORD}shown \\deleted STRUCK\\deleted0 kept\\par}', 'latin1');
  assert.equal(rtfText(rtf), 'shown kept\n');
  const dir = await mkdtemp(path.join(tmpdir(), 'legallas-hidden-'));
  try {
    const file = path.join(dir, 'hidden.docx');
    await writeFile(file, docx(`<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>${SSN}</w:t></w:r></w:p><w:p><w:r><w:t>Body</w:t></w:r></w:p>`));
    const scan = await scanForPii([{ id: 'h', rel: 'hidden.docx', file, sha256: 'a'.repeat(64), kind: 'file' }], { known: null, extractPdf: async () => [], readText: async () => [] });
    assert.deepEqual(scan.flagged.map((doc) => doc.path), ['hidden.docx']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// #275: what the SSN guard missed in rarer files.
test('a .doc title, in single-byte or UTF-16 properties, reaches the SSN guard', () => {
  const props = (text: Buffer) => Buffer.concat([Buffer.alloc(48, 0), Buffer.from([0x1e, 0, 0, 0]), text, Buffer.alloc(4, 0)]);
  const narrow = docProperties(compound({ '\u0005SummaryInformation': props(Buffer.from(`Founder ${SSN}`, 'latin1')) }));
  assert.ok(narrow.some((text) => text.includes(SSN)));
  const wide = docProperties(compound({ '\u0005DocumentSummaryInformation': props(Buffer.from(`Founder ${SSN}`, 'utf16le')) }));
  assert.ok(wide.some((text) => text.includes(SSN)));
  assert.deepEqual(docProperties(compound({ WordDocument: Buffer.alloc(64) })), []);
});

test('UTF-16 with no byte order mark reads, even when it is mostly another script', () => {
  const cyrillic = 'Учредитель Доу, номер записи в реестре компании Харбор Лабс. '.repeat(20);
  for (const encoding of ['utf-16le', 'utf-16be'] as const) {
    const le = Buffer.from(`${cyrillic}${SSN}`, 'utf16le');
    const bytes = encoding === 'utf-16le' ? le : Buffer.from(le).swap16();
    assert.ok(decodeText(bytes).endsWith(SSN), encoding);
  }
  assert.equal(decodeText(Buffer.from(`plain ${SSN}`)), `plain ${SSN}`, 'UTF-8 stays UTF-8');
});
