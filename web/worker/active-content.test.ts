// SPDX-License-Identifier: Apache-2.0
// The active-content reader on tiny files built here, never real documents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeContentGuard, entryRule, scanBytes, scanKindOf, scanStream, MAX_OBJSTM_BYTES, type ActiveRule } from './active-content.ts';

const bytes = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

async function deflate(text: string, format: 'deflate' | 'deflate-raw' = 'deflate'): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A small PDF: a catalog with a benign /OpenAction, the given objects, a trailer. */
function pdf(...objects: (string | Uint8Array)[]): Uint8Array {
  return join(
    bytes('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OpenAction [3 0 R /Fit] >>\nendobj\n'),
    ...objects.map((o) => (typeof o === 'string' ? bytes(o) : o)),
    bytes('trailer\n<< /Root 1 0 R /Size 9 >>\n%%EOF\n'),
  );
}

/** An object stream holding `objects`, with `filter` and its data (compressed by the caller), ended by `eol`. */
function objStm(data: Uint8Array, filter = '/Filter /FlateDecode', eol = '\r\n'): Uint8Array {
  return join(bytes(`5 0 obj\n<< /Type /ObjStm /N 1 /First 4 ${filter} /Length ${data.length} >>\nstream\r\n`), data, bytes(`${eol}endstream\nendobj\n`));
}

/** Feeds `file` one byte at a time: every token crosses a chunk boundary somewhere. */
const byteByByte = (file: Uint8Array) => scanStream(scanKindOf(file)!, Array.from(file, (b) => Uint8Array.of(b)));

async function both(file: Uint8Array): Promise<ActiveRule | null> {
  const whole = await scanBytes(file);
  assert.equal(await byteByByte(file), whole, 'one byte at a time reads the same');
  return whole;
}

const JS_ACTION = '3 0 obj\n<< /Type /Action /S /JavaScript /JS (app.alert\\(1\\)) >>\nendobj\n';

test('a plain PDF with a /Fit open action passes', async () => {
  assert.equal(await both(pdf('2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n')), null);
});

test('PDF JavaScript and Launch actions are refused, #-escaped names too', async () => {
  assert.equal(await both(pdf(JS_ACTION)), 'pdf-javascript');
  assert.equal(await both(pdf('3 0 obj\n<< /S /J#61vaScript /J#53 (x) >>\nendobj\n')), 'pdf-javascript');
  assert.equal(await both(pdf('3 0 obj\n<< /AA << /O << /J#53 (x) >> >> >>\nendobj\n')), 'pdf-javascript', '/JS alone');
  assert.equal(await both(pdf('3 0 obj\n<< /S /Launch /F (calc.exe) >>\nendobj\n')), 'pdf-launch');
  assert.equal(await both(pdf('3 0 obj\n<< /S /L#61unch >>\nendobj\n')), 'pdf-launch');
  assert.equal(await both(pdf('2 0 obj\n<< /Names << /JavaScript 4 0 R >> >>\nendobj\n')), 'pdf-javascript', 'the name tree');
});

test('lookalike names and words in text pass', async () => {
  assert.equal(await both(pdf('3 0 obj\n<< /JSX 1 /JavaScripts 2 /Launcher 3 /js 4 >>\nendobj\n')), null);
  assert.equal(await both(pdf('3 0 obj\n<< /Title (On /JS and other abbreviations) >>\nendobj\n')), null, '/JS inside a string is text');
});

test('stream data is read for /JavaScript and /Launch, not for the short /JS', async () => {
  const stream = (body: string) => `4 0 obj\n<< /Length ${body.length} >>\nstream\n${body}\nendstream\nendobj\n`;
  assert.equal(await both(pdf(stream('\x01\x02/JS \x03\x04'))), null, 'four bytes in image data are noise');
  assert.equal(await both(pdf(stream('\x01/JavaScript \x02'))), 'pdf-javascript');
  assert.equal(await both(pdf(stream('q /Launch Q'))), 'pdf-launch');
});

test('a string cannot fake the start of stream data to hide a later /JS', async () => {
  assert.equal(await both(pdf('3 0 obj\n<< /T (>> stream\n) /S /Next >>\nendobj\n6 0 obj\n<< /JS (x) >>\nendobj\n')), 'pdf-javascript');
});

test('JavaScript inside a compressed object stream is found, with or without the zlib header and end of line', async () => {
  const hidden = '6 0 << /Type /Action /S /JavaScript /JS (app.alert\\(1\\)) >>';
  assert.equal(await both(pdf(objStm(await deflate(hidden)))), 'pdf-javascript');
  assert.equal(await both(pdf(objStm(await deflate(hidden), '/Filter /FlateDecode', ''))), 'pdf-javascript', 'no end of line');
  assert.equal(await both(pdf(objStm(await deflate(hidden, 'deflate-raw')))), 'pdf-javascript', 'raw deflate');
  assert.equal(await both(pdf(objStm(await deflate('6 0 << /AA << /O << /J#53 (x) >> >> >>')))), 'pdf-javascript', 'only /JS');
  assert.equal(await both(pdf(objStm(await deflate('6 0 << /S /Launch /F (a.exe) >>')))), 'pdf-launch');
  assert.equal(await both(pdf(objStm(bytes(hidden), ''))), 'pdf-javascript', 'stored with no filter');
});

test('a clean compressed object stream passes', async () => {
  assert.equal(await both(pdf(objStm(await deflate('6 0 << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>')))), null);
});

test('object streams this reader cannot undo are unchecked, except in an encrypted file', async () => {
  assert.equal(await both(pdf(objStm(bytes('3C3C3E3E>'), '/Filter /ASCIIHexDecode'))), 'unchecked');
  assert.equal(await both(pdf(objStm(await deflate('6 0 << >>'), '/Filter /FlateDecode /DecodeParms << /Predictor 12 >>'))), 'unchecked');
  const garbage = Uint8Array.from({ length: 64 }, (_, i) => (i * 97 + 13) & 0xff);
  assert.equal(await both(pdf(objStm(join(bytes('\x78\x9c'), garbage)))), 'unchecked');
  const encrypted = join(pdf(objStm(join(bytes('\x78\x9c'), garbage))), bytes('trailer\n<< /Encrypt 9 0 R >>\n'));
  assert.equal(await both(encrypted), null, "an encrypted file's object streams are a known limit");
});

test('an object stream larger than the cap is unchecked without being held whole', async () => {
  const big = new Uint8Array(MAX_OBJSTM_BYTES + 1).fill(0x41);
  assert.equal(await scanBytes(pdf(objStm(big))), 'unchecked');
});

test('scanKindOf picks the reader from the first bytes, a PDF header up to 1 KB in', () => {
  assert.equal(scanKindOf(bytes('%PDF-1.4')), 'pdf');
  assert.equal(scanKindOf(join(new Uint8Array(1000), bytes('%PDF-1.4'))), 'pdf');
  assert.equal(scanKindOf(join(new Uint8Array(1100), bytes('%PDF-1.4'))), null);
  assert.equal(scanKindOf(Uint8Array.of(0x50, 0x4b, 0x03, 0x04)), 'zip');
  assert.equal(scanKindOf(Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)), 'ole');
  assert.equal(scanKindOf(bytes('plain text')), null);
  assert.equal(scanKindOf(Uint8Array.of(0x89, 0x50, 0x4e, 0x47)), null, 'a PNG has no reader');
});

/** A stored zip with these names in its local headers, and `central` (default: the same) in its central directory. */
function zip(names: string[], central = names): Uint8Array {
  const u16 = (n: number) => [n & 0xff, n >> 8];
  const name = (text: string) => new TextEncoder().encode(text);
  const locals = names.map((n) => join(Uint8Array.of(0x50, 0x4b, 3, 4, 20, 0, ...new Array(20).fill(0), ...u16(name(n).length), 0, 0), name(n)));
  const centrals = central.map((n) => join(Uint8Array.of(0x50, 0x4b, 1, 2, ...new Array(24).fill(0), ...u16(name(n).length), ...new Array(16).fill(0)), name(n)));
  return join(...locals, ...centrals, Uint8Array.of(0x50, 0x4b, 5, 6, ...new Array(18).fill(0)));
}

test('a Word file with only document parts passes', async () => {
  assert.equal(await both(zip(['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/media/image1.png'])), null);
});

test('macros, ActiveX and runnable entries are refused in a zip, by any of its names', async () => {
  assert.equal(await both(zip(['[Content_Types].xml', 'word/vbaProject.bin'])), 'office-macros');
  assert.equal(await both(zip(['xl/VBAPROJECT.BIN'])), 'office-macros');
  assert.equal(await both(zip(['xl/activeX/activeX1.xml'])), 'office-activex');
  assert.equal(await both(zip(['exhibits/Budget.XLSM'])), 'office-macros');
  assert.equal(await both(zip(['tools\\setup.exe'])), 'runnable');
  assert.equal(await both(zip(['a/run.js', 'b.lnk'])), 'runnable');
  assert.equal(await both(zip(['Viewer.app/Contents/MacOS/Viewer'])), 'runnable');
  assert.equal(await both(zip(['word/document.xml'], ['word/vbaProject.bin'])), 'office-macros', 'the central directory is read too');
});

test('entryRule reads names alone, case-insensitively', () => {
  for (const name of ['notes.docx', 'scan.pdf', 'app.config', 'README', 'activex.txt', 'apps/list.csv']) assert.equal(entryRule(name), null, name);
  assert.equal(entryRule('Q3.XLSM'), 'office-macros');
  assert.equal(entryRule('installer.PKG'), 'runnable');
  assert.equal(entryRule('ppt/activeX/activeX2.bin'), 'office-activex');
});

test('entryRule ignores trailing dots and spaces, as Windows does', () => {
  for (const name of ['payload.exe.', 'payload.exe ', 'payload.exe. . ', 'tools\\setup.EXE..']) assert.equal(entryRule(name), 'runnable', name);
  assert.equal(entryRule('Q3.xlsm. '), 'office-macros');
  assert.equal(entryRule('xl/vbaProject.bin.'), 'office-macros');
  assert.equal(entryRule('Viewer.app./Contents/MacOS/Viewer'), 'runnable');
  assert.equal(entryRule('xl/activeX /activeX1.xml'), 'office-activex');
  for (const name of ['notes.docx.', 'notes. ', '...', ' ']) assert.equal(entryRule(name), null, name);
});

test('a Word or Excel 97-2003 file with a VBA project is refused', async () => {
  const ole = (...parts: Uint8Array[]) => join(Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1), new Uint8Array(500), ...parts);
  const utf16 = (text: string) => Uint8Array.from([...text].flatMap((c) => [c.charCodeAt(0), 0]));
  assert.equal(await both(ole(utf16('Root Entry'), utf16('WordDocument'))), null);
  assert.equal(await both(ole(utf16('Macros'), utf16('_VBA_PROJECT'))), 'office-macros');
});

test('the guard passes a clean file through unchanged', async () => {
  const file = pdf('2 0 obj\n<< /Type /Pages >>\nendobj\n');
  const guard = activeContentGuard('pdf');
  const out = new Uint8Array(await new Response(new Blob([file]).stream().pipeThrough(guard.stream)).arrayBuffer());
  assert.deepEqual(out, file);
  assert.equal(guard.finding(), null);
});

test('the guard errors the stream on a finding, so nothing reading it completes', async () => {
  const guard = activeContentGuard('pdf');
  await assert.rejects(new Response(new Blob([pdf(JS_ACTION)]).stream().pipeThrough(guard.stream)).arrayBuffer(), /active content: pdf-javascript/);
  assert.equal(guard.finding(), 'pdf-javascript');
});

test('with no reader for the kind, the guard only passes bytes through', async () => {
  const guard = activeContentGuard(null);
  const text = await new Response(new Blob(['/JavaScript']).stream().pipeThrough(guard.stream)).text();
  assert.equal(text, '/JavaScript');
  assert.equal(guard.finding(), null);
});
