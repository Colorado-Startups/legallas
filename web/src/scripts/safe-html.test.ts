// SPDX-License-Identifier: Apache-2.0
// The sanitizer's link rule. The rest of it needs a DOM, so the screenshots cover it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hrefVerdict } from './safe-html.ts';

test('links inside the room stay, and web links are marked as leaving it', () => {
  for (const href of ['#top', '/docs/a', './a', '../a', 'a/b', '']) assert.equal(hrefVerdict(href), 'keep', href);
  for (const href of ['https://example.com/a', 'HTTP://example.com']) assert.equal(hrefVerdict(href), 'leaves', href);
  assert.equal(hrefVerdict('mailto:someone@example.com'), 'keep');
});

test('other schemes lose their link', () => {
  for (const href of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', 'file:///etc/hosts']) assert.equal(hrefVerdict(href), 'drop', href);
});

test('a link that reaches another host without a scheme loses its link', () => {
  for (const href of ['//example.com', '/\\\\example.com', '\\\\example.com', ' //example.com']) assert.equal(hrefVerdict(href), 'drop', JSON.stringify(href));
});

test('what a browser drops before reading a link can not hide one', () => {
  for (const href of ['/\t/example.com', '/\n/example.com', '/\r/example.com', '\u0001//example.com', '\t//example.com', 'java\tscript:alert(1)', '\u0001javascript:alert(1)']) {
    assert.equal(hrefVerdict(href), 'drop', JSON.stringify(href));
  }
  assert.equal(hrefVerdict('ht\ttps://example.com'), 'leaves', 'read as a web link, so it is marked as leaving');
});
