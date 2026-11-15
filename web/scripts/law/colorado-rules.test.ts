// SPDX-License-Identifier: Apache-2.0
// 3 CCR 704-1's lines to rules. The layout is the real one (ruleVersionId 12350); the words are invented, so no rule text
// is committed here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coloradoRules } from './colorado-rules.ts';

const FILE = [
  '1', '',
  'DEPARTMENT OF FICTION', '',
  '3 CCR 704-1', '',
  '[Editor’s Notes follow the text of the Rules at the end of this CCR Document.]', '',
  '__________', '',
  'CHAPTER 1 (Reserved for future use)', '',
  'CHAPTER 2 DEFINITIONS', '',
  '51-2.1 The following words mean what they say in these rules, unless the context', 'requires otherwise:', '',
  'A. A widget is a cog.', '',
  '51-2.2 Amendments Coordinated', '',
  'Widgets are coordinated.', '',
  'CHAPTER 3 REGISTRATION AND EXEMPTIONS', '',
  '51-3.1 Registration of Widgets.', '',
  'A widget is registered under the conditions of', 'Rule 51-2.1 and of', '51-2.2, and no others.', '',
  '2', '',
  '51-3.2 A Title That Wraps Across Two Lines', 'of the Printed Page', '',
  'This paragraph runs to the foot of the page and', '',
  '3', '',
  'carries on at the top of the next.', '',
  '51-3.5 (Repealed)', '',
  '51-3.20. Crowdfunding of Widgets', '',
  'Words of the rule.', '',
  'Rule 3.33. Printed Without Its Fifty-One', '',
  'More words.', '',
  '51-3.34. A Heading Whose Rule Was Repealed', '',
  '51-3.34 (Repealed)', '',
  '51-3.36. (Repealed)', '',
  'CHAPTER 4 LICENSING', '',
  '51-4.1 Broker Applications', '',
  'Broker words.', '',
  '51-4.8 Broker Security', '',
  'Security words.', '',
  'CHAPTER 4 (IA) ADVISERS OF', 'FICTIONAL WIDGETS', '',
  '51-4.1(IA) General Provisions', '',
  'Adviser words.', '',
  '51-4.4.1(IA) Continuing Education', '',
  'Education words.', '',
  '51-4.11(IA). Exempt Advisers', '',
  'Exempt words.', '',
  'CHAPTER 6 HEARINGS', '',
  '51-6.0 Definitions.', '',
  'Hearing words.', '',
  '51-6.10 Representation', '',
  'Counsel words.', '',
  '51-6.1 Hearings on Orders', '',
  'Order words.', '',
  'Editor’s Notes', '',
  '3 CCR 704-1 has been divided into smaller sections.', '',
  'Rule 51-9.9 eff. 01/01/2099.', '',
];

test('every rule comes back in the document\'s order, though the numbers don\'t ascend', () => {
  assert.deepEqual(coloradoRules(FILE).sections.map((s) => s.number), [
    '51-2.1', '51-2.2', '51-3.1', '51-3.2', '51-3.20', '51-3.33', '51-4.1', '51-4.8', '51-4.1(IA)', '51-4.4.1(IA)', '51-4.11(IA)', '51-6.0', '51-6.10', '51-6.1',
  ]);
});

test('a rule restarting its numbering is a rule of its own, not text of the one before', () => {
  const { sections } = coloradoRules(FILE);
  assert.deepEqual(sections.find((s) => s.number === '51-4.8')?.lines, ['Security words.']);
  assert.deepEqual(sections.find((s) => s.number === '51-4.1(IA)'), { number: '51-4.1(IA)', heading: 'General Provisions', lines: ['Adviser words.'] });
  assert.deepEqual(sections.find((s) => s.number === '51-6.10')?.lines, ['Counsel words.']);
});

test('a cross-reference inside a paragraph stays in it', () => {
  assert.deepEqual(coloradoRules(FILE).sections.find((s) => s.number === '51-3.1')?.lines, ['A widget is registered under the conditions of Rule 51-2.1 and of 51-2.2, and no others.']);
});

test('a rule that opens on its text has no title to lose, and its first paragraph stays text', () => {
  assert.deepEqual(coloradoRules(FILE).sections[0], { number: '51-2.1', heading: 'Rule 51-2.1', lines: ['The following words mean what they say in these rules, unless the context requires otherwise:', 'A. A widget is a cog.'] });
});

test('a title wrapped across lines is one title, and a paragraph a page cuts is rejoined without the page number', () => {
  const rule = coloradoRules(FILE).sections.find((s) => s.number === '51-3.2');
  assert.equal(rule?.heading, 'A Title That Wraps Across Two Lines of the Printed Page');
  assert.deepEqual(rule?.lines, ['This paragraph runs to the foot of the page and carries on at the top of the next.']);
});

test('the running head each page prints is in no rule, and a paragraph it cuts is rejoined', () => {
  const lines = ['3 CCR 704-1', '', '51-1.1 Scope', '', 'A rule that runs to the foot of the page and', '', 'CODE OF COLORADO REGULATIONS 3 CCR 704-1', 'Division of Securities', '', '1', '', 'carries on, naming the', 'Division of Securities', 'on a line of its own.', '', '51-1.2 (Repealed)', '', 'CODE OF COLORADO REGULATIONS 3 CCR 704-1', 'Division of Securities', '', '2', '', '51-1.3 Next', '', 'More.', ''];
  const { sections, empty } = coloradoRules(lines);
  assert.deepEqual(sections[0]?.lines, ['A rule that runs to the foot of the page and carries on, naming the Division of Securities on a line of its own.']);
  assert.deepEqual(empty, ['51-1.2']);
  assert.deepEqual(sections[1], { number: '51-1.3', heading: 'Next', lines: ['More.'] });
});

test('page numbers, chapter headings and decoration are in no rule', () => {
  const text = coloradoRules(FILE).sections.flatMap((s) => s.lines).join('\n');
  for (const word of ['CHAPTER', 'FICTIONAL WIDGETS', '____', 'DEPARTMENT']) assert.ok(!text.includes(word), word);
  assert.ok(!coloradoRules(FILE).sections.some((s) => s.lines.some((line) => /^\d+$/.test(line))));
});

test('a rule printed without its 51 is numbered like the rest, and repealed rules are reported, not built', () => {
  const { sections, empty } = coloradoRules(FILE);
  assert.equal(sections.find((s) => s.number === '51-3.33')?.heading, 'Printed Without Its Fifty-One');
  assert.deepEqual(empty, ['51-3.5', '51-3.34', '51-3.36']);
});

test('nothing after the editor\'s notes counts', () => {
  const { sections } = coloradoRules(FILE);
  assert.ok(!sections.some((s) => s.number === '51-9.9' || s.lines.join(' ').includes('smaller sections')));
});

test('a number with text already, opening a paragraph again, is that rule being mentioned', () => {
  const again = coloradoRules(['3 CCR 704-1', '', '51-1.1 Scope', '', 'Words.', '', '51-1.1 Applies To Widgets, as above.', '']);
  assert.deepEqual(again.sections, [{ number: '51-1.1', heading: 'Scope', lines: ['Words.', '51-1.1 Applies To Widgets, as above.'] }]);
});

test('a numbered list item is not a rule: only "51-" or "Rule" opens one', () => {
  const list = coloradoRules(['3 CCR 704-1', '', '51-1.1 Scope', '', '3.5 Percent Is The Rate.', '']);
  assert.deepEqual(list.sections[0]?.lines, ['3.5 Percent Is The Rate.']);
});

test('a rule whose number stands alone keeps its text', () => {
  const rule = coloradoRules(['3 CCR 704-1', '', '51-1.1 Scope', '', 'Words.', '', '51-1.3', '', 'Its own words.', '']).sections[1];
  assert.deepEqual(rule, { number: '51-1.3', heading: 'Rule 51-1.3', lines: ['Its own words.'] });
});

test('text after a repealed rule, a title with no text and a stray page number each fail rather than vanish', () => {
  assert.throws(() => coloradoRules(['3 CCR 704-1', '', '51-1.1 Scope', '', 'Words.', '', '51-1.2 (Repealed)', '', 'Operative words.', '']), /rule 51-1\.2 is marked repealed and has text after it/);
  assert.throws(() => coloradoRules(['3 CCR 704-1', '', '51-1.1 Scope', '', 'Words.', '', '51-1.2 The fee is five dollars.', '', '51-1.3 Next', '', 'More.', '']), /rule 51-1\.2 has a heading and no text/);
  assert.throws(() => coloradoRules(['3 CCR 704-1', '', '51-1.1 Scope', '', 'Words.', '', '2', '']), /a page number was left in the text/);
});

test('another file, or a layout it can\'t read, fails loudly', () => {
  assert.throws(() => coloradoRules(['Some other document', '', '51-1.1 Scope', '', 'Words.']), /does not say it is 3 CCR 704-1/);
  assert.throws(() => coloradoRules(['3 CCR 704-1', '', 'No rule headings on any line.', '']), /no rules in this file/);
  assert.throws(() => coloradoRules(['3 CCR 704-1', '', '51-1.1 (Repealed)', '']), /no rules in this file/);
});
