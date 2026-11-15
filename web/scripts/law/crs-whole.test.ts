// SPDX-License-Identifier: Apache-2.0
// A whole C.R.S. article from a title download. Invented text in the download's real order: no Colorado text is committed here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crsWholeArticle, ollsDocxUrl, ollsPdfUrl } from './crs-whole.ts';

const ARTICLE = [
  'TITLE 99',
  'Art. 80. Fictional Companies, 99-80-101 to 99-80-104.',
  'ARTICLE 79',
  'Other Things',
  '99-79-101. Another article. Words that must not appear.',
  'Source: L. 90: Entire article added.',
  'ARTICLE 80',
  'Fictional Companies',
  'PART 1 GENERAL',
  '99-80-101. Short title.',
  '99-80-102. Duties of managers.',
  'PART 2 MEMBERS',
  '99-80-103. Old section. (Repealed)',
  '99-80-104. Fees.',
  'PART 1 GENERAL',
  '99-80-101. Short title. This article is the Fictional Company Act.',
  'Source: L. 90: Entire article added.',
  "Editor's note: A note that is not law.",
  '(2) A note paragraph that looks like a subsection.',
  '99-80-102. Duties of managers. (1) A manager shall:',
  '(a) Account for cogs; and',
  '(b) Refrain from competing.',
  'Source: L. 94: Entire section amended.',
  'ANNOTATION',
  'Annotator\'s note. A case note that only the state may publish.',
  'Law reviews. See Fictional Rev. 1 (2090).',
  'PART 2 MEMBERS',
  '99-80-103. Old section. (Repealed)',
  'Source: L. 90: Entire article added. L. 95: Entire section repealed.',
  '99-80-104. Fees. A fee is one dollar.',
  'Source: L. 90: Entire article added.',
  'ARTICLE 81',
  '99-81-101. Next article. Words that must not appear.',
];

test('an article comes back whole, without its list, part headings, source notes or annotations', () => {
  const article = crsWholeArticle(ARTICLE, 99, '80');
  assert.deepEqual(article.sections, [
    { number: '99-80-101', heading: 'Short title', lines: ['This article is the Fictional Company Act.'] },
    { number: '99-80-102', heading: 'Duties of managers', lines: ['(1) A manager shall:', '(a) Account for cogs; and', '(b) Refrain from competing.'] },
    { number: '99-80-104', heading: 'Fees', lines: ['A fee is one dollar.'] },
  ]);
  assert.deepEqual(article.empty, ['99-80-103']);
});

test('no annotation text gets through', () => {
  const text = crsWholeArticle(ARTICLE, 99, '80').sections.flatMap((section) => section.lines).join('\n');
  for (const word of ['case note', 'Law reviews', 'Editor', 'Source:', 'looks like a subsection', 'must not appear']) assert.ok(!text.includes(word), word);
});

test('a section the article lists and does not hold fails, so an act can never come back partial', () => {
  const missing = ARTICLE.filter((line) => !line.startsWith('99-80-104. Fees. A fee'));
  assert.throws(() => crsWholeArticle(missing, 99, '80'), /article 80 of title 99 lists 99-80-104 and doesn't hold them/);
});

test('a section marked repealed in the list needs no body', () => {
  const article = crsWholeArticle(ARTICLE.filter((line) => !line.startsWith('99-80-103. Old section. (Repealed)') || line === ARTICLE[12]), 99, '80');
  assert.ok(article.empty.includes('99-80-103'));
});

test('two versions of one section, printed while an amendment waits for its date, both stay', () => {
  const lines = [...ARTICLE.slice(0, 31)];
  lines.splice(31, 0, '99-80-104. Fees. (Effective July 1, 2099) A fee is two dollars.', 'Source: L. 98: Entire section amended.');
  const fees = crsWholeArticle(lines, 99, '80').sections.find((section) => section.number === '99-80-104');
  assert.equal(fees?.lines[0], 'A fee is one dollar.');
  assert.match(fees?.lines[1] ?? '', /^\[Another version of this section follows\.\]/);
  assert.equal(fees?.lines.at(-1), '(Effective July 1, 2099) A fee is two dollars.');
});

test('a section number from another article in a note starts nothing', () => {
  const lines = [...ARTICLE];
  lines.splice(17, 0, '98-1-101. Cited in a note. Words that must not appear.');
  const article = crsWholeArticle(lines, 99, '80');
  assert.deepEqual(article.sections.map((section) => section.number), ['99-80-101', '99-80-102', '99-80-104']);
  assert.ok(!article.sections[0]?.lines.join(' ').includes('must not appear'));
});

test('an article with no list of its own starts straight on its text', () => {
  const article = crsWholeArticle(['ARTICLE 5', '99-5-101. Only one. The only words.', 'Source: L. 90.'], 99, '5');
  assert.deepEqual(article.sections.map((section) => section.number), ['99-5-101']);
});

test('subpart headings and a span split over two lines in the list change nothing', () => {
  const lines = ['ARTICLE 80', 'Companies', '', 'PART 1 GENERAL', '99-80-101. Short.', 'SUBPART 1 STOPPING', '99-80-102. Long.', '99-80-103 to', '99-80-104. (Repealed)', '', 'PART 1', 'GENERAL', '99-80-101. Short.', 'The words.', 'Source: L. 90.', '99-80-102. Long.', 'More words.', 'Source: L. 90.', '99-80-103 to 99-80-104. (Repealed)', 'Source: L. 90.'];
  const article = crsWholeArticle(lines, 99, '80');
  assert.deepEqual(article.sections, [
    { number: '99-80-101', heading: 'Short', lines: ['The words.'] },
    { number: '99-80-102', heading: 'Long', lines: ['More words.'] },
  ]);
  assert.deepEqual(article.empty, ['99-80-104']);
});

test('a list whose first section is left out of the text still proves the rest', () => {
  const lines = ['ARTICLE 80', '99-80-101. Old. (Repealed)', '99-80-102. Duties.', '99-80-103. Fees.', '99-80-102. Duties. Do them.', 'Source: L. 90.'];
  assert.throws(() => crsWholeArticle(lines, 99, '80'), /lists 99-80-103 and doesn't hold them/);
  const whole = crsWholeArticle([...lines, '99-80-103. Fees. Pay them.', 'Source: L. 90.'], 99, '80');
  assert.deepEqual(whole.sections.map((section) => section.number), ['99-80-102', '99-80-103']);
  assert.equal(whole.sections[0]?.lines.length, 1);
  assert.deepEqual(whole.empty, ['99-80-101']);
});

test('a live section with no text fails, and only a repeal makes one empty', () => {
  const lines = ['ARTICLE 80', '99-80-101. Short.', '99-80-102. Duties.', '99-80-101. Short. Words.', 'Source: L. 90.', '99-80-102. Duties.', 'Source: L. 90.'];
  assert.throws(() => crsWholeArticle(lines, 99, '80'), /§ 99-80-102 has a heading and no text/);
});

test('a heading that starts with the word Repealed, or a title running into a quotation, keeps its text', () => {
  const live = crsWholeArticle(['ARTICLE 80', '99-80-105. Repealed statutes not revived. (1) They stay gone.', 'Source: L. 90.'], 99, '80');
  assert.deepEqual(live.sections[0], { number: '99-80-105', heading: 'Repealed statutes not revived', lines: ['(1) They stay gone.'] });
  const quoted = crsWholeArticle(['ARTICLE 80', '99-80-101. Definitions. “Widget” means a cog.', 'Source: L. 90.'], 99, '80');
  assert.deepEqual(quoted.sections[0], { number: '99-80-101', heading: 'Definitions', lines: ['“Widget” means a cog.'] });
});

test('a repealed first version doesn\'t take the live one with it', () => {
  const lines = ['ARTICLE 80', '99-80-103. Repealed.', 'Source: L. 90.', '99-80-104. Fees. A fee.', 'Source: L. 90.', '99-80-103. Rates. (Effective 2099) A rate.', 'Source: L. 98.'];
  const article = crsWholeArticle(lines, 99, '80');
  assert.deepEqual(article.sections.find((section) => section.number === '99-80-103'), { number: '99-80-103', heading: 'Rates', lines: ['(Effective 2099) A rate.'] });
  assert.deepEqual(article.empty, []);
});

test('a note opening with this article\'s own number stays a note', () => {
  const lines = [...ARTICLE];
  lines.splice(24, 0, '99-80-101. Applied in A v. B.', 'A case note that must not appear.', '99-80-102. Cited in C v. D.');
  const article = crsWholeArticle(lines, 99, '80');
  assert.ok(!article.sections.flatMap((section) => section.lines).join(' ').includes('case note'));
  assert.deepEqual(article.sections.map((section) => section.number), ['99-80-101', '99-80-102', '99-80-104']);
});

test('only a line that is just ARTICLE and a number ends the article', () => {
  const lines = ['ARTICLE 80', '99-80-101. Scope. Article 7 applies.', 'Article 7 of this title applies too.', '(2) A later subsection.', 'Source: L. 90.'];
  assert.deepEqual(crsWholeArticle(lines, 99, '80').sections[0]?.lines, ['Article 7 applies.', 'Article 7 of this title applies too.', '(2) A later subsection.']);
});

test('with no list, two versions of the first section both stay', () => {
  const lines = ['ARTICLE 5', '99-5-101. Only. First version words.', 'Source: L. 90.', '99-5-101. Only. (Effective 2099) Second version words.', 'Source: L. 98.'];
  const words = crsWholeArticle(lines, 99, '5').sections[0]?.lines.join(' ');
  assert.ok(words?.includes('First version') && words.includes('Second version'), words);
});

test('a missing article, or one with no live text, fails loudly', () => {
  assert.throws(() => crsWholeArticle(ARTICLE, 99, '82'), /no ARTICLE 82 in title 99/);
  assert.throws(() => crsWholeArticle(['ARTICLE 6', '99-6-101. Gone. (Repealed)', 'Source: L. 90.', 'ARTICLE 7'], 99, '6'), /yielded no sections/);
  assert.throws(() => crsWholeArticle(['ARTICLE 6', 'Words with no section.'], 99, '6'), /yielded no sections/);
});

test('the download and reading addresses', () => {
  assert.equal(ollsDocxUrl(2099, 7), 'https://olls.info/crs/crs2099-title-07.docx');
  assert.equal(ollsPdfUrl(2099, 11), 'https://olls.info/crs/crs2099-title-11.pdf');
});
