// SPDX-License-Identifier: Apache-2.0
// Delaware Code Online's pages to sections. Invented text in the site's real markup: no Delaware text is committed here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { delawareChapterUrl, delawareSections, delawareSubchapters } from './delaware.ts';

const PAGE = (list: string[], body: string) =>
  `<html><body><ul class="chaptersections">${list.map((n) => `<li><a href="#${n}">§ ${n}</a></li>`).join('')}</ul><div id="TitleHead"><h1>TITLE 99</h1></div><div id="CodeBody">${body}</div><footer><a href="/help">Help text that is not law</a></footer></body><script>x</script></html>\n`;
const SECTION = (id: string, heading: string, paragraphs: string, history = '99 Del. C. 1953, § 1; <a href="https://legis.delaware.gov/x">84 Del. Laws, c. 1, § 1</a>; ') =>
  `<div class="Section"><div class="SectionHead" id="${id}">\n §\n ${id}. ${heading}</div>${paragraphs}${history}</div><br>`;

test('a page gives every section, with its paragraphs in order and no history', () => {
  const page = delawareSections(PAGE(['99-101', '99-102'], SECTION('99-101', 'Short title; purpose.', '<p class="subsection">(a) This chapter is fictional.</p><p class="indent-2">(1) It concerns widgets.</p>') + SECTION('99-102', 'Fees.', '<p>A plain paragraph.</p>')), 'chapter 99');
  assert.deepEqual(page.sections, [
    { number: '99-101', heading: 'Short title; purpose', lines: ['(a) This chapter is fictional.', '(1) It concerns widgets.'] },
    { number: '99-102', heading: 'Fees', lines: ['A plain paragraph.'] },
  ]);
  assert.equal(page.lawsVolume, 84);
  assert.deepEqual(page.empty, []);
});

test('a stray space in a section\'s anchor is not part of its number', () => {
  const page = delawareSections(PAGE(['1 '], SECTION('1 ', 'Words.', '<p>Text.</p>')), 'chapter 99');
  assert.deepEqual(page.sections.map((s) => s.number), ['1']);
});

test('a section with no paragraphs is reported as empty, not built', () => {
  const page = delawareSections(PAGE(['1', '2'], SECTION('1', '[Reserved.]', '', '') + SECTION('2', 'Words.', '<p>Text.</p>')), 'chapter 99');
  assert.deepEqual(page.empty, ['1']);
  assert.deepEqual(page.sections.map((s) => s.number), ['2']);
});

test('anything these pages haven\'t used before fails the section instead of vanishing', () => {
  const page = (body: string) => PAGE(['1'], SECTION('1', 'Words.', body));
  assert.throws(() => delawareSections(page('<table><tr><td>One</td></tr></table>'), 'chapter 99'), /§ 1 holds a table/);
  assert.throws(() => delawareSections(page('<p class="note">A note.</p>'), 'chapter 99'), /a paragraph of a kind these pages haven't used before: "note"/);
  assert.throws(() => delawareSections(page('<p>Main.</p><div>The fee is ten dollars per share.</div>'), 'chapter 99'), /§ 1 has text outside its paragraphs: "The fee is ten dollars/);
  assert.throws(() => delawareSections(page('<p>Main.</p><div>Ten dollars, $250,000.</div>'), 'chapter 99'), /§ 1 has text outside its paragraphs/);
  assert.throws(() => delawareSections(PAGE(['1'], `<p>Before any section.</p>${SECTION('1', 'Words.', '<p>Text.</p>')}`), 'chapter 99'), /text before its first section/);
});

test('the history forms these pages use all pass', () => {
  const history = '8 Del. C. 1953, § 101; 56 Del. Laws, c. 50; 65 Del. Laws, c. 289, §§ 1, 2; 70 Del. Laws, c. 79, §§ 1-3; Code 1915, § 102; 64 Del. Laws, c. 317, §§ 4(a)-(h); 85 Del. Laws, c. 279, § 2A; repealed by 83 Del. Laws, c. 61, § 7, effective Aug. 1, 2021.';
  assert.equal(delawareSections(PAGE(['1'], SECTION('1', 'Words.', '<p>Text.</p>', history)), 'chapter 99').lawsVolume, 85);
});

test('a section anchored one number and printed another fails', () => {
  const page = PAGE(['5'], '<div class="Section"><div class="SectionHead" id="5">§ 6. Words.</div><p>Text.</p></div>');
  assert.throws(() => delawareSections(page, 'chapter 99'), /anchored 5 and printed 6/);
});

test('a section the page lists and does not hold fails, so a chapter can never come back partial', () => {
  assert.throws(() => delawareSections(PAGE(['1', '2'], SECTION('1', 'Words.', '<p>Text.</p>')), 'chapter 99'), /lists 2 and doesn't hold them/);
});

test('a page cut short, laid out differently or empty fails loudly', () => {
  const whole = PAGE(['1'], SECTION('1', 'Words.', '<p>Text.</p>'));
  assert.throws(() => delawareSections(whole.slice(0, 200), 'chapter 99'), /cut short/);
  assert.doesNotThrow(() => delawareSubchapters('<html><script>x</script>\n', 99, '018'));
  assert.throws(() => delawareSections(whole.replace('chaptersections', 'other'), 'chapter 99'), /doesn't list its sections/);
  assert.throws(() => delawareSections(whole.replace('id="CodeBody"', 'id="Other"'), 'chapter 99'), /no CodeBody/);
  assert.throws(() => delawareSections(whole.replace('class="SectionHead"', 'class="Other"'), 'chapter 99'), /no heading/);
  assert.throws(() => delawareSections(PAGE([], SECTION('1', 'Words.', '<p>Text.</p>')), 'chapter 99'), /lists no sections, so nothing proves it whole/);
  assert.throws(() => delawareSections(PAGE(['1'], ''), 'chapter 99'), /lists 1 and doesn't hold them/);
});

test('prose outside the paragraphs is not taken for history', () => {
  const page = PAGE(['1'], SECTION('1', 'Words.', '<p>Text.</p>', 'A long operative sentence that sits outside any paragraph on this page.'));
  assert.throws(() => delawareSections(page, 'chapter 99'), /§ 1 has text outside its paragraphs/);
});

test('a chapter page gives its subchapters and only its own; a chapter with none gives none', () => {
  const html = `<html><a href="../../title99/c018/sc01/index.html">Subchapter I</a><a href="../../title99/c018/sc02/index.html">II</a><a href="../../title99/c019/sc01/index.html">Other chapter</a><a href="../../title98/c018/sc03/index.html">Other title</a></html>`;
  assert.deepEqual(delawareSubchapters(html, 99, '018'), ['https://delcode.delaware.gov/title99/c018/sc01/index.html', 'https://delcode.delaware.gov/title99/c018/sc02/index.html']);
  assert.deepEqual(delawareSubchapters('<html></html>', 99, '018'), []);
  assert.throws(() => delawareSubchapters('<html><a', 99, '018'), /cut short/);
  assert.throws(() => delawareSubchapters('<html><a href="../../title99/c018/sc01/index.html">I</a><div class="Section"></div></html>', 99, '018'), /holds sections and links subchapters/);
  assert.deepEqual(delawareSubchapters('<html><a href="../../title99/c018/sc01/index.html#top">I</a></html>', 99, '018'), ['https://delcode.delaware.gov/title99/c018/sc01/index.html']);
  assert.equal(delawareChapterUrl(99, '018'), 'https://delcode.delaware.gov/title99/c018/index.html');
});

test('one heading over several repealed sections is empty, and one over sections still in force fails', () => {
  const gone = (heading: string) =>
    PAGE(['1910, 1911', '1912'], `<div class="Section"><div class="SectionHead" id="1910, 1911">\n §§\n 1910, 1911. ${heading}</div><p class="subsection">Repealed by 68 Del. Laws, c. 1, § 1.</p></div><br>${SECTION('1912', 'Words.', '<p>Text.</p>')}`);
  const page = delawareSections(gone('Fictional taxes [Repealed].'), 'chapter 99');
  assert.deepEqual(page.empty, ['1910, 1911']);
  assert.deepEqual(page.sections.map((s) => s.number), ['1912']);
  assert.throws(() => delawareSections(gone('Fictional taxes.'), 'chapter 99'), /§§ 1910, 1911 head several sections that still hold law/);
});

test('an anchor that carries its section sign, listed encoded, is still its number, and a quoted notice paragraph is text', () => {
  const html = PAGE([], `<div class="Section"><div class="SectionHead" id="§ 1156">\n §\n § 1156. Fictional limits.</div><p class="subsection">(a) Notices read:</p><p class="indent-">“An invented notice.”</p></div><br>`).replace('<ul class="chaptersections">', '<ul class="chaptersections"><li><a href="#%C2%A7 1156">§ 1156</a></li>');
  assert.deepEqual(delawareSections(html, 'chapter 99').sections, [{ number: '1156', heading: 'Fictional limits', lines: ['(a) Notices read:', '“An invented notice.”'] }]);
});

test('the live § 2735 form: a thin space after the sign, in the anchor and the heading, is still its number (#311)', () => {
  const html = PAGE([], `<div class="Section"><div class="SectionHead" id="§\u20092735">\r\n §\r\n §\u20092735. Remedies.</div><p class="subsection">(a) Invented text.</p></div><br>`).replace('<ul class="chaptersections">', '<ul class="chaptersections"><li><a href="#%C2%A7%E2%80%892735">§ 2735</a></li>');
  assert.deepEqual(delawareSections(html, 'chapter 27').sections, [{ number: '2735', heading: 'Remedies', lines: ['(a) Invented text.'] }]);
});

test('an anchor that carries its heading\'s full stop is still its number', () => {
  const html = PAGE(['99-1201.'], `<div class="Section"><div class="SectionHead" id="99-1201.">\n §\n 99-1201. Fictional definitions.</div><p class="subsection">Invented text.</p></div><br>`);
  assert.deepEqual(delawareSections(html, 'chapter 99').sections, [{ number: '99-1201', heading: 'Fictional definitions', lines: ['Invented text.'] }]);
});
