// SPDX-License-Identifier: Apache-2.0
// A room with no matter shows no case-room words (#218): the shaping is worker/room-shape.ts's, read in plain Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CASE_ROOM_WORDS, checkCompanyPage, companyText } from './dist-company.ts';

const page = (body: string) => `<!doctype html><html lang="en"><head><title>Overview</title></head><body>${body}</body></html>`;

test('an unmarked "counsel room" on a page a founder opens fails, naming the file and the words', () => {
  const findings = checkCompanyPage('index.html', '/', page('<footer><p>Legallas counsel room. Private.</p></footer>'));
  assert.deepEqual(findings.map((f) => f.file), ['index.html']);
  assert.match(findings[0]!.problem, /"Legallas counsel room\. Private\."/);
});

test('a data-case-only part, and everything inside it, is removed as the Worker removes it', () => {
  const html = page('<footer data-case-only><p>Legallas <b>counsel</b> room.</p><p>Counsel room <img alt="counsel room"></p></footer><p>Legallas.</p>');
  assert.deepEqual(companyText(html), ['Overview', 'Legallas.']);
  assert.deepEqual(checkCompanyPage('index.html', '/', html), []);
});

test('a case page is skipped: a room with no matter redirects it to the Overview', () => {
  for (const route of ['/chronology/', '/complaint/', '/people/', '/claims/', '/binder/', '/visual/', '/regulator/']) {
    assert.deepEqual(checkCompanyPage('x/index.html', route, page('<p>the counsel room</p>')), [], route);
  }
  assert.equal(checkCompanyPage('documents/index.html', '/documents/', page('<p>the counsel room</p>')).length, 1);
});

test('the words a reader announces count: a title, a label, an alt text, a hint, a meta description', () => {
  for (const attr of ['title', 'aria-label', 'alt', 'placeholder']) {
    assert.equal(checkCompanyPage('index.html', '/', page(`<span ${attr}="Search the counsel room"></span>`)).length, 1, attr);
  }
  assert.equal(checkCompanyPage('index.html', '/', '<meta name="description" content="The counsel room">').length, 1);
  assert.deepEqual(checkCompanyPage('index.html', '/', page('<a href="/counsel-room/" class="counsel room">Home</a>')), [], 'not read aloud');
});

test('a script, a style and a comment are code, not page text', () => {
  const html = page('<script type="application/json">{"a":"<p>counsel room</p>"}</script><style>.x::after{content:"counsel room"}</style><!-- counsel room -->');
  assert.deepEqual(companyText(html), ['Overview']);
});

test('a data-case-only part may nest the same tag, and void tags never open a part', () => {
  const html = page('<div data-case-only><div><br><input value="x"><div>counsel room</div></div>counsel room</div><div>after</div>');
  assert.deepEqual(companyText(html), ['Overview', 'after']);
});

test('a phrase runs on through inline tags and comments, and stops at a block', () => {
  for (const body of ['<p>Legallas <b>counsel</b> room</p>', '<p>the <a href="/">counsel</a> <!-- x --> room</p>', '<p>counsel <span>room</span></p>']) {
    assert.equal(checkCompanyPage('index.html', '/', page(body)).length, 1, body);
  }
  assert.deepEqual(companyText('<li>counsel</li><li>room</li>'), ['counsel', 'room']);
});

test('code is skipped to its own closing tag, whatever it holds, and the page after it is still read', () => {
  const html = page('<script>if(a<b)x("</p>")</script><script type="application/json">{"q":"a<b"}</script><p>the counsel room</p>');
  assert.deepEqual(companyText(html), ['Overview', 'the counsel room']);
});

test('a button value and an option label are read too', () => {
  assert.equal(checkCompanyPage('index.html', '/', page('<input type="submit" value="Open the counsel room">')).length, 1);
  assert.equal(checkCompanyPage('index.html', '/', page('<select><option label="Counsel room"></option></select>')).length, 1);
});

test('entities and spacing are read as a browser shows them', () => {
  assert.deepEqual(companyText('<p>counsel&ensp;room</p>'), ['counsel room']);
  assert.deepEqual(companyText('<p>Counsel&nbsp;room &amp; more</p>'), ['Counsel room & more']);
  assert.match('Counsel\nroom', CASE_ROOM_WORDS, 'a line break inside the phrase still counts');
  assert.equal(checkCompanyPage('a.html', '/a.html', '<p>Counsel\n  room</p>').length, 1);
});
