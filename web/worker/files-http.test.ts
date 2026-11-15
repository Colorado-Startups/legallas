// SPDX-License-Identifier: Apache-2.0
// Range parsing, Content-Disposition with hostile names, and the inline vs attachment rule for /files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachment, cleanFilename, contentRange, deliveryFor, inlineContentType, parseRange } from './files-http.ts';

test('a single closed range is partial', () => {
  assert.deepEqual(parseRange('bytes=0-99', 1000), { kind: 'partial', offset: 0, length: 100 });
  assert.deepEqual(parseRange('bytes=500-500', 1000), { kind: 'partial', offset: 500, length: 1 });
  assert.deepEqual(parseRange('BYTES=10-19', 1000), { kind: 'partial', offset: 10, length: 10 });
});

test('an end past the file is clamped to the last byte', () => {
  assert.deepEqual(parseRange('bytes=900-5000', 1000), { kind: 'partial', offset: 900, length: 100 });
});

test('an open-ended range runs to the end of the file', () => {
  assert.deepEqual(parseRange('bytes=250-', 1000), { kind: 'partial', offset: 250, length: 750 });
});

test('a suffix range is the last N bytes, capped at the file size', () => {
  assert.deepEqual(parseRange('bytes=-100', 1000), { kind: 'partial', offset: 900, length: 100 });
  assert.deepEqual(parseRange('bytes=-5000', 1000), { kind: 'partial', offset: 0, length: 1000 });
});

test('a range starting at or beyond the end is unsatisfiable (416)', () => {
  assert.deepEqual(parseRange('bytes=1000-', 1000), { kind: 'unsatisfiable' });
  assert.deepEqual(parseRange('bytes=1000-1200', 1000), { kind: 'unsatisfiable' });
  assert.deepEqual(parseRange('bytes=5000-', 1000), { kind: 'unsatisfiable' });
  assert.deepEqual(parseRange('bytes=-0', 1000), { kind: 'unsatisfiable' });
  assert.deepEqual(parseRange('bytes=0-', 0), { kind: 'unsatisfiable' });
});

test('missing, malformed and multi-range headers are ignored (the whole file)', () => {
  for (const header of [null, '', 'bytes=', 'bytes=-', 'bytes=abc-def', 'items=0-10', 'bytes=0-1,5-9', 'bytes=10-5', 'bytes = 0-1', 'bytes=0x10-']) {
    assert.deepEqual(parseRange(header, 1000), { kind: 'full' }, String(header));
  }
});

test('Content-Range names the inclusive byte span and the total', () => {
  assert.equal(contentRange(0, 100, 1000), 'bytes 0-99/1000');
  assert.equal(contentRange(999, 1, 1000), 'bytes 999-999/1000');
});

test('Content-Disposition survives hostile filenames', () => {
  const hostile = [
    'evil"; filename="x.exe',
    'line\r\nSet-Cookie: a=b.pdf',
    'nul\u0000byte.pdf',
    'invoice\u202Efdp.exe',
    "Smith's (final) *draft*.pdf",
    '../../etc/passwd',
    'C:\\Windows\\win.ini',
    'zero\u200Bwidth.pdf',
    '100% done.pdf',
  ];
  for (const name of hostile) {
    const value = attachment(name);
    assert.doesNotMatch(value, /[\r\n\u0000\u202E\u200B]/, name);
    const [, plain, star] = /^attachment; filename="([^"]*)"; filename\*=UTF-8''([A-Za-z0-9%._~#$&+^`|-]*)$/.exec(value) ?? [];
    assert.ok(plain !== undefined && star !== undefined, `${name} -> ${value}`);
    assert.doesNotMatch(plain!, /[\\/%]/, name);
  }
  assert.match(attachment("Smith's (final).pdf"), /filename\*=UTF-8''Smith%27s%20%28final%29\.pdf$/);
  assert.equal(cleanFilename('invoice\u202Efdp.exe'), 'invoicefdp.exe');
  assert.equal(cleanFilename('../../etc/passwd'), '_.._etc_passwd');
});

test('an empty or invisible-only name still downloads under a neutral name', () => {
  assert.equal(cleanFilename(''), 'download');
  assert.equal(cleanFilename('\u202E\u0000\n'), 'download');
  assert.match(attachment('...'), /^attachment; filename="download";/);
});

test('long names are capped by characters, not by UTF-16 units', () => {
  const name = cleanFilename('\u{1F4DC}'.repeat(300));
  assert.equal(Array.from(name).length, 200);
  assert.ok(name.endsWith('\u{1F4DC}'));
});

const pdf = { kind: 'pdf', source: 'mirror' };
const visual = { kind: 'visual', source: 'mirror' };

test('a top-level open of a document is a download', () => {
  assert.deepEqual(deliveryFor(pdf, 'document', false), { mode: 'attachment', action: 'download', audit: 'download' });
  for (const dest of ['iframe', 'frame', 'embed', 'object', 'DOCUMENT']) {
    assert.equal(deliveryFor(pdf, dest, false).mode, 'attachment', dest);
  }
});

test('the room viewers read inline, and every read is audited as a view', () => {
  for (const dest of [null, '', 'empty', 'image']) {
    assert.deepEqual(deliveryFor(pdf, dest, false), { mode: 'inline', action: 'view', audit: 'view' }, String(dest));
  }
});

test('?download is always an attachment with one download row', () => {
  assert.deepEqual(deliveryFor(pdf, 'empty', true), { mode: 'attachment', action: 'download', audit: 'download' });
  assert.deepEqual(deliveryFor(visual, 'iframe', true), { mode: 'attachment', action: 'download', audit: 'download' });
});

test('mirrored visuals run only when the room frames them; any other open is a download', () => {
  assert.deepEqual(deliveryFor(visual, 'iframe', false), { mode: 'visual', action: 'view', audit: 'view' });
  assert.deepEqual(deliveryFor(visual, 'IFRAME', false), { mode: 'visual', action: 'view', audit: 'view' });
  for (const dest of ['document', null, '', 'empty', 'frame', 'embed', 'object']) {
    assert.deepEqual(deliveryFor(visual, dest, false), { mode: 'attachment', action: 'download', audit: 'download' }, String(dest));
  }
});

test('counsel HTML never runs or renders inline, whoever asks', () => {
  for (const dest of ['iframe', 'document', 'empty', null]) {
    assert.equal(deliveryFor({ kind: 'visual', source: 'counsel' }, dest, false).mode, 'attachment');
  }
});

test('inline reads of text-like kinds are plain text; images and PDFs keep their type', () => {
  assert.equal(inlineContentType('pdf', 'application/pdf'), 'application/pdf');
  assert.equal(inlineContentType('image', 'image/svg+xml'), 'image/svg+xml');
  assert.equal(inlineContentType('markdown', 'text/markdown; charset=utf-8'), 'text/plain; charset=utf-8');
  assert.equal(inlineContentType('text', 'application/xml; charset=utf-8'), 'text/plain; charset=utf-8');
  assert.equal(inlineContentType('file', 'application/zip'), 'application/octet-stream');
});
