// SPDX-License-Identifier: Apache-2.0
// Upload rules: names, the extension allowlist, magic bytes, Content-Length and the stream peek.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkContentLength,
  MAX_UPLOAD_BYTES,
  matchesMagic,
  peekStream,
  sanitizeUploadName,
  uploadTypeOf,
  UPLOAD_TYPES,
} from './files-upload.ts';

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);

test('the allowlist takes exactly the agreed extensions, case-insensitively', () => {
  assert.deepEqual(Object.keys(UPLOAD_TYPES).sort(), ['csv', 'docx', 'jpeg', 'jpg', 'md', 'pdf', 'png', 'pptx', 'txt', 'xlsx', 'zip']);
  assert.equal(uploadTypeOf('Brief.PDF')?.kind, 'pdf');
  assert.equal(uploadTypeOf('photo.JPEG')?.contentType, 'image/jpeg');
});

test('HTML, SVG, scripts, archives we do not read, and extensionless names are refused', () => {
  for (const name of ['page.html', 'page.htm', 'logo.svg', 'x.xhtml', 'run.js', 'a.exe', 'notes', 'a.pdf.html', 'x.constructor', 'x.__proto__', '.pdf']) {
    assert.equal(uploadTypeOf(name), null, name);
  }
});

test('upload names lose control, bidi and path characters but keep their extension', () => {
  assert.equal(sanitizeUploadName('../../secret/plan.pdf'), '_.._secret_plan.pdf');
  assert.equal(sanitizeUploadName('memo\u202Etxt.pdf'), 'memotxt.pdf');
  assert.equal(sanitizeUploadName('a\r\nb\u0000c.txt'), 'abc.txt');
  assert.equal(sanitizeUploadName('  ..hidden.md '), 'hidden.md');
  assert.equal(sanitizeUploadName('C:\\Users\\x.docx'), 'C__Users_x.docx');
  assert.equal(sanitizeUploadName('cafe\u0301.pdf'), 'caf\u00e9.pdf');
  assert.equal(sanitizeUploadName(''), null);
  assert.equal(sanitizeUploadName('\u200B\u202E'), null);
  assert.equal(sanitizeUploadName(null), null);
  const long = sanitizeUploadName(`${'a'.repeat(400)}.xlsx`)!;
  assert.equal(long.length, 180);
  assert.ok(long.endsWith('.xlsx'));
});

test('Content-Length is required, numeric, non-zero and at most 95 MB', () => {
  assert.deepEqual(checkContentLength(null), { ok: false, status: 411, error: 'length_required' });
  assert.deepEqual(checkContentLength('abc'), { ok: false, status: 400, error: 'bad_length' });
  assert.deepEqual(checkContentLength('-1'), { ok: false, status: 400, error: 'bad_length' });
  assert.deepEqual(checkContentLength('0'), { ok: false, status: 400, error: 'empty_file' });
  assert.deepEqual(checkContentLength(String(MAX_UPLOAD_BYTES)), { ok: true, size: MAX_UPLOAD_BYTES });
  assert.deepEqual(checkContentLength(String(MAX_UPLOAD_BYTES + 1)), { ok: false, status: 413, error: 'too_large' });
  assert.equal(MAX_UPLOAD_BYTES, 95 * 1024 * 1024);
});

test('magic bytes must match the extension', () => {
  const type = (name: string) => uploadTypeOf(name)!;
  assert.ok(matchesMagic(type('a.pdf'), ascii('%PDF-1.7\n')));
  assert.ok(!matchesMagic(type('a.pdf'), ascii('<html><script>')));
  assert.ok(!matchesMagic(type('a.pdf'), ascii('%PD')));
  assert.ok(matchesMagic(type('a.png'), bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)));
  assert.ok(!matchesMagic(type('a.png'), bytes(0xff, 0xd8, 0xff, 0xe0)));
  assert.ok(matchesMagic(type('a.jpg'), bytes(0xff, 0xd8, 0xff, 0xe0)));
  for (const name of ['a.docx', 'a.xlsx', 'a.pptx', 'a.zip']) assert.ok(matchesMagic(type(name), bytes(0x50, 0x4b, 0x03, 0x04, 0x14)), name);
  assert.ok(matchesMagic(type('a.zip'), bytes(0x50, 0x4b, 0x05, 0x06)));
  assert.ok(!matchesMagic(type('a.docx'), bytes(0x50, 0x4b, 0x05, 0x06)));
  assert.ok(!matchesMagic(type('a.docx'), ascii('%PDF-1.4')));
});

test('text uploads must be UTF-8 without NUL bytes', () => {
  const txt = uploadTypeOf('a.txt')!;
  assert.ok(matchesMagic(txt, ascii('Plain notes, caf\u00e9.')));
  assert.ok(matchesMagic(uploadTypeOf('a.csv')!, ascii('a,b\n1,2\n')));
  assert.ok(!matchesMagic(txt, bytes(0x50, 0x4b, 0x03, 0x04, 0x00)));
  assert.ok(!matchesMagic(txt, bytes(0xff, 0xfe, 0x41, 0x00)));
  assert.ok(!matchesMagic(txt, bytes(0xc3, 0x28)));
  // A multi-byte character cut at the end of the peeked head is not a reason to refuse.
  assert.ok(matchesMagic(txt, bytes(0x61, 0xe2, 0x82)));
});

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<number[]> {
  return Array.from(new Uint8Array(await new Response(stream).arrayBuffer()));
}

test('peekStream returns the head and replays every byte, across chunk boundaries', async () => {
  const { head, stream } = await peekStream(streamOf([bytes(1, 2), bytes(3, 4, 5), bytes(6)]), 4);
  assert.deepEqual(Array.from(head), [1, 2, 3, 4]);
  assert.deepEqual(await drain(stream), [1, 2, 3, 4, 5, 6]);
});

test('peekStream handles a body shorter than the head', async () => {
  const { head, stream } = await peekStream(streamOf([bytes(9, 8)]), 4096);
  assert.deepEqual(Array.from(head), [9, 8]);
  assert.deepEqual(await drain(stream), [9, 8]);
});
