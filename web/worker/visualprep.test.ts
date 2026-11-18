// SPDX-License-Identifier: Apache-2.0
// prepareVisual's script and style stretches: only their bodies are left as written, so a link after them is rewritten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareVisual } from './visualprep.ts';

const PAGE = { artifact: 'art1', path: 'index.html' };
const OUT = `href="#room-out=${encodeURIComponent('https://example.org/x')}"`;

test('an end tag with attributes or whitespace closes a script or style stretch', () => {
  for (const close of ['</script foo>', '</script\t\n bar>', '</script/>', '</SCRIPT >']) {
    const html = `<script>var a = 1;${close}<a href="https://example.org/x">x</a><script>var b = 2;</script>`;
    const { html: out } = prepareVisual(html, PAGE, () => null, 'room');
    assert.ok(out.includes(OUT), `link after ${JSON.stringify(close)} is rewritten`);
    assert.ok(!out.includes('href="https://example.org/x"'));
  }
  const styled = prepareVisual('<style>a{}</style foo><a href="https://example.org/x">x</a><style>b{}</style>', PAGE, () => null, 'room');
  assert.ok(styled.html.includes(OUT));
});

test('a script body is still left as written', () => {
  const html = '<script>var u = "<a href=\\"https://example.org/x\\">";</script>';
  assert.ok(prepareVisual(html, PAGE, () => null, 'room').html.includes('<a href=\\"https://example.org/x\\">'));
});
