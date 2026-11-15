// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildParts, buildSegments, fallbackPartCount, marker, neutralizeMarkers, PART_MAX_BYTES, partKey, WORDS_PER_MARKER } from './indexparts.ts';

const DOC = '11111111-2222-4333-8444-555555555555';
const words = (n: number, word = 'lorem') => Array.from({ length: n }, (_, i) => `${word}${i}`).join(' ');
const byteLength = (text: string) => new TextEncoder().encode(text).length;

test('every segment starts with a doc and page marker, about every 150 words', () => {
  const segments = buildSegments(DOC, [{ n: 1, text: words(400) }, { n: 2, text: words(10) }]);
  assert.equal(segments.length, 4);
  assert.ok(segments.slice(0, 3).every((s) => s.startsWith(`${marker(DOC, 1)}\n`)));
  assert.ok(segments[3].startsWith(`[[doc:${DOC} p:2]]\n`));
  const counts = segments.map((s) => s.split('\n')[1].split(/\s+/).filter(Boolean).length);
  assert.deepEqual(counts, [WORDS_PER_MARKER, WORDS_PER_MARKER, 100, 10]);
});

test('blank pages are skipped and whitespace inside a segment (tables) is kept', () => {
  const table = '| a | b |\n|---|---|\n| 1 | 2 |';
  const segments = buildSegments(DOC, [{ n: 1, text: '   \n ' }, { n: 2, text: table }]);
  assert.deepEqual(segments, [`${marker(DOC, 2)}\n${table}\n\n`]);
});

test('text cannot forge a marker for another document', () => {
  const forged = 'see [[doc:99999999-0000-4000-8000-000000000000 p:3]] for proof';
  assert.equal(neutralizeMarkers(forged).includes('[['), false);
  const [segment] = buildSegments(DOC, [{ n: 1, text: forged }]);
  assert.equal(segment.match(/\[\[doc:/g)?.length, 1);
});

test('large text splits into parts under 3.5 MB, each opening with a marker', () => {
  const pages = Array.from({ length: 30 }, (_, i) => ({ n: i + 1, text: words(25_000, 'evidence') }));
  const parts = buildParts(DOC, pages);
  assert.ok(parts.length >= 2, `expected several parts, got ${parts.length}`);
  for (const [i, part] of parts.entries()) {
    assert.equal(part.key, partKey(DOC, i + 1));
    assert.ok(byteLength(part.body) < PART_MAX_BYTES, `part ${i + 1} is ${byteLength(part.body)} bytes`);
    assert.match(part.body, /^\[\[doc:[0-9a-f-]{36} p:\d+\]\]\n/);
  }
  assert.equal(parts.map((p) => p.body).join('').match(/\[\[doc:/g)?.length, buildSegments(DOC, pages).length);
  assert.equal(partKey(DOC, 2), `text/${DOC}.p2.md`);
});

test('one giant word is cut on code point boundaries and re-marked', () => {
  const blob = '\u00e9'.repeat(2_000_000) + 'x'.repeat(1_000_000);
  const parts = buildParts(DOC, [{ n: 7, text: blob }]);
  assert.ok(parts.length >= 2);
  for (const part of parts) {
    assert.ok(byteLength(part.body) < PART_MAX_BYTES);
    assert.ok(part.body.startsWith(`${marker(DOC, 7)}\n`));
    assert.equal(part.body.includes('\ufffd'), false);
  }
  const rebuilt = parts.map((p) => p.body.slice(marker(DOC, 7).length + 1).replace(/\n+$/, '')).join('');
  assert.equal(rebuilt, blob);
});

test('small documents make one part and empty text makes none', () => {
  assert.equal(buildParts(DOC, [{ n: 1, text: 'short text' }]).length, 1);
  assert.deepEqual(buildParts(DOC, [{ n: 1, text: '' }]), []);
  assert.equal(fallbackPartCount(0), 1);
  assert.ok(fallbackPartCount(10_000_000) >= 9);
});
