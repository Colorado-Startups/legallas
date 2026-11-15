// SPDX-License-Identifier: Apache-2.0
// Pure helpers behind the Documents and document pages: formatting, matching, deep links,
// CSV parsing and the Markdown configuration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from './csv.ts';
import { docHref, folderHref, pageFromHash } from './files-api.ts';
import { foldForSearch, formatBytes, formatDate, formatDateTime, matchesQuery, plural, typeLabel } from './files-format.ts';
import { renderMarkdown } from './markdown.ts';

test('dates read as prose (DESIGN.md section 9): "Oct. 6, 2026", never "6 Oct 2026"', () => {
  // Noon UTC stays on the 5th to the 7th in every time zone the reader might be in.
  assert.match(formatDate('2026-10-06T12:00:00.000Z'), /^Oct\. [5-7], 2026$/);
  assert.match(formatDate('2026-05-15T12:00:00.000Z'), /^May 1[456], 2026$/, 'May takes no period');
  assert.match(formatDate('2026-09-15T12:00:00.000Z'), /^Sept\. 1[456], 2026$/);
  assert.match(formatDateTime('2026-10-06T12:00:00.000Z'), /^Oct\. [5-7], 2026, \d{1,2}:\d{2} [AP]M$/);
  for (const bad of ['', 'nope']) {
    assert.equal(formatDate(bad), '', bad);
    assert.equal(formatDateTime(bad), '', bad);
  }
});

test('sizes read plainly', () => {
  assert.equal(formatBytes(0), '0 bytes');
  assert.equal(formatBytes(1), '1 byte');
  assert.equal(formatBytes(999), '999 bytes');
  assert.equal(formatBytes(1500), '1.5 KB');
  assert.equal(formatBytes(14_200), '14 KB');
  assert.equal(formatBytes(3_200_000), '3.2 MB');
  assert.equal(formatBytes(486_000_000), '486 MB');
  assert.equal(formatBytes(2_000_000_000), '2 GB');
});

test('plural and type labels', () => {
  assert.equal(plural(1, 'file'), '1 file');
  assert.equal(plural(843, 'scroll'), '843 scrolls');
  assert.equal(plural(1200, 'page'), '1,200 pages');
  assert.equal(typeLabel('Deck.KEY'), 'Keynote deck');
  assert.equal(typeLabel('a.docx'), 'Word document');
  assert.equal(typeLabel('a.weird'), 'WEIRD file');
  assert.equal(typeLabel('README'), 'File');
  assert.equal(typeLabel('x.constructor'), 'CONSTRUCTOR file');
});

test('the filter ignores case and accents and needs every term', () => {
  const hay = foldForSearch('01-Contracts Résumé of Deliveries.pdf');
  assert.ok(matchesQuery(hay, 'resume'));
  assert.ok(matchesQuery(hay, 'CONTRACTS deliveries'));
  assert.ok(!matchesQuery(hay, 'contracts exhibit'));
  assert.ok(matchesQuery(hay, '   '));
});

test('deep links: #page=N, document and folder hrefs', () => {
  assert.equal(pageFromHash('#page=3'), 3);
  assert.equal(pageFromHash('#zoom=2&page=12'), 12);
  for (const hash of ['', '#page=0', '#page=-1', '#page=x', '#pages=3', '#page=3x', '#page=1234567']) assert.equal(pageFromHash(hash), null, hash);
  assert.equal(docHref('a b'), '/doc/?id=a%20b');
  assert.equal(docHref('id1', 3), '/doc/?id=id1#page=3');
  assert.equal(folderHref('01-Contracts/Drafts & notes'), '/documents/#01-Contracts%2FDrafts%20%26%20notes');
  assert.equal(folderHref('from-counsel'), '/documents/#from-counsel');
});

test('CSV: quotes, doubled quotes, embedded commas and newlines, CRLF, BOM', () => {
  const { rows, more } = parseCsv('﻿name,note\r\n"Smith, J","said ""no""\nthen left"\r\nlast,\n', 10);
  assert.deepEqual(rows, [['name', 'note'], ['Smith, J', 'said "no"\nthen left'], ['last', '']]);
  assert.equal(more, false);
});

test('CSV: stops at the row cap and says there is more', () => {
  const { rows, more } = parseCsv('a\n1\n2\n3\n', 2);
  assert.deepEqual(rows, [['a'], ['1']]);
  assert.equal(more, true);
  assert.equal(parseCsv('a\n1\n', 2).more, false);
  assert.deepEqual(parseCsv('', 5).rows, []);
});

test('Markdown: raw HTML is text, images never load, and bare URLs stay text', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\nSee https://example.com');
  assert.doesNotMatch(html, /<script|<img|<a /);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  // An image is only a link to it: nothing is fetched unless the reader clicks.
  const image = renderMarkdown('![chart <b>](https://example.com/x.png) ![bad](javascript:alert(1))');
  assert.doesNotMatch(image, /<img|<b>|href="javascript/i);
  assert.match(image, /<a href="https:\/\/example.com\/x.png" target="_blank" rel="noopener noreferrer">Image: chart &lt;b&gt;<\/a>/);
});

test('Markdown: links are safe, and table alignment is a class, never a style', () => {
  const html = renderMarkdown('[web](https://example.com) [bad](javascript:alert(1)) [rel](notes.md)\n\n| a | b |\n|:-:|--:|\n| 1 | 2 |');
  assert.match(html, /<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer">web<\/a>/);
  assert.doesNotMatch(html, /href="javascript/i);
  assert.match(html, /<a href="notes.md">rel<\/a>/);
  assert.doesNotMatch(html, /style=/);
  assert.match(html, /<th class="align-center">a<\/th>/);
  assert.match(html, /<td class="align-right">2<\/td>/);
});
