// SPDX-License-Identifier: Apache-2.0
// The escape helpers: each row is an input a one-pass replace gets wrong, and the plain input it must still treat as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeRegExp, escapeTableCell, jsLiteral, stripHtmlComments, stripHtmlTags } from './escape.ts';

test('comments: removed, nested ones included, an unclosed opener left', () => {
  assert.equal(stripHtmlComments('a<!-- b -->c'), 'ac');
  assert.equal(stripHtmlComments('a<!-- x -->b<!--\ny\n-->c'), 'abc');
  assert.equal(stripHtmlComments('<!<!-- x -->-- y -->z'), 'z');
  assert.equal(stripHtmlComments('a <!-- never closed'), 'a <!-- never closed');
  assert.equal(stripHtmlComments('<!-->x'), '<!-->x');
  assert.equal(stripHtmlComments('plain'), 'plain');
});

test('tags: removed as the one-pass pattern removes them, an empty pair and a lone bracket left', () => {
  assert.equal(stripHtmlTags('a <b>bold</b> c'), 'a bold c');
  assert.equal(stripHtmlTags('<scr<script>ipt>x'), 'ipt>x');
  assert.equal(stripHtmlTags('1 < 2 and 3 > 2'), '1  2');
  assert.equal(stripHtmlTags('a < b'), 'a < b');
  assert.equal(stripHtmlTags('a <> b'), 'a <> b');
  assert.equal(stripHtmlTags('no tags'), 'no tags');
});

test('regex text: a symbol matches itself, backslash included', () => {
  for (const symbol of ['$ref', 'a.b', 'back\\slash', 'x(y)', 'plain']) {
    assert.ok(new RegExp(`^${escapeRegExp(symbol)}$`).test(symbol));
  }
  assert.ok(!new RegExp(escapeRegExp('a.b')).test('axb'));
});

test('table cells: backslash, pipe and newline cannot break the row', () => {
  assert.equal(escapeTableCell('a|b'), 'a\\|b');
  assert.equal(escapeTableCell('a\\|b'), 'a\\\\\\|b');
  assert.equal(escapeTableCell('a\nb'), 'a b');
});

test('browser literals: they evaluate to the value and carry no raw angle, slash or line separator', () => {
  for (const value of ['a"b', "it's", '</script><!--', 'a\u2028b\u2029c', 'back\\slash', 'x/y']) {
    const literal = jsLiteral(value);
    assert.equal(eval(literal), value);
    assert.doesNotMatch(literal, /[<>/\u2028\u2029]/);
  }
});
