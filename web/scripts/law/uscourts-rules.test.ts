// SPDX-License-Identifier: Apache-2.0
// The federal rules prints on uscourts.gov. Invented text in the prints' real shape, as pdf.ts pdfLines reads them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courtRules } from './uscourts-rules.ts';

const CIVIL = [
  'TABLE OF CONTENTS',
  'Rule 1. Widgets ........................................ 1',
  '',
  'Effective September 16, 1938, as amended to December 1, 2099',
  '',
  'TITLE I. SCOPE OF RULES; FORM OF',
  'ACTION',
  '',
  'Rule 1. Scope of Widget Rules',
  '',
  'These rules govern every widget pro-',
  'ceeding. Rule 2. They apply as stated in',
  'Rule 3.',
  '(As amended Apr. 1, 2090, eff. Dec. 1, 2090.)',
  '',
  'Rule 2. Widget Notices\u2014Who Gives Them, and Certi-',
  'fications',
  '',
  '(a) IN GENERAL. A notice must state:',
  '(1) the widget’s name;',
  'and',
  '',
  '2Rule 2 FEDERAL RULES OF CIVIL PROCEDURE',
  '1 Now editorially reclassified 99 U.S.C. 1.',
  '(2) its ‘‘serial number’’ under 99 U.S.C. § 1,',
  '1 ',
  'as the court directs\u2014whichever comes first.',
  '(b) DEFENSES. A party must state:',
  '',
  '• accord and satisfaction;',
  '',
  '• waiver.',
  '(c) TIMING. A question-',
  'and-answer form may be used at-',
  'torney-client meetings.',
  '(As added Apr. 2, 2091, eff. Dec. 1, 2091.)',
  '',
  'Rule 3. [Abrogated (Apr. 3, 2092, eff. Dec. 1, 2092).]',
  'Rule 4. Title',
  '',
  'Any attorney may cite these rules as the Widget Rules.',
  '(As amended Apr. 4, 2093, eff. Dec. 1, 2093.)',
  '',
  '(105)',
  '',
  'APPENDIX OF FORMS',
  '',
  'Rule 1. Admiralty Widgets',
];

test('the civil rules come back one per rule, with page furniture gone and wrapped words rejoined', () => {
  const { asOf, rules, abrogated } = courtRules(CIVIL, 'civil');
  assert.equal(asOf, 'December 1, 2099');
  assert.deepEqual(abrogated, ['3']);
  assert.deepEqual(
    rules.map((rule) => [rule.number, rule.heading]),
    [
      ['1', 'Scope of Widget Rules'],
      ['2', 'Widget Notices\u2014Who Gives Them, and Certifications'],
      ['4', 'Title'],
    ],
  );
  assert.deepEqual(rules[0]!.lines, ['These rules govern every widget proceeding. Rule 2. They apply as stated in Rule 3.', '(As amended Apr. 1, 2090, eff. Dec. 1, 2090.)']);
  assert.deepEqual(rules[1]!.lines, [
    '(a) IN GENERAL. A notice must state:',
    '(1) the widget’s name; and',
    '(2) its “serial number” under 99 U.S.C. § 1, as the court directs\u2014whichever comes first.',
    '(b) DEFENSES. A party must state:',
    '• accord and satisfaction;',
    '• waiver.',
    '(c) TIMING. A question-and-answer form may be used attorney-client meetings.',
    '(As added Apr. 2, 2091, eff. Dec. 1, 2091.)',
  ]);
});

test('the evidence rules count up within each article', () => {
  const lines = [
    'Effective July 1, 1975, as amended to December 1, 2099',
    '',
    'ARTICLE I. GENERAL PROVISIONS',
    '',
    'Rule 101. Scope',
    '',
    'These rules apply to widget proceedings.',
    '(As amended Apr. 1, 2090, eff. Dec. 1, 2090.)',
    '',
    '2Rule 201 FEDERAL RULES OF EVIDENCE',
    'ARTICLE II. JUDICIAL',
    'NOTICE',
    '',
    'Rule 201. Notice of Widgets',
    '',
    'A court may notice a widget.',
    '(As amended Apr. 2, 2091, eff. Dec. 1, 2091.)',
    '',
    'Æ',
  ];
  const { rules } = courtRules(lines, 'evidence');
  assert.deepEqual(
    rules.map((rule) => rule.number),
    ['101', '201'],
  );
  assert.throws(() => courtRules(lines.map((line) => line.replace('201', '202')), 'evidence'), /skip Rule 201/);
  assert.throws(() => courtRules(lines.map((line) => line.replace(/201/g, '301')).map((line) => line.replace('ARTICLE II.', 'ARTICLE III.')), 'evidence'), /skip an article/);
});

test('a print in some other shape fails loudly instead of storing part of a rule', () => {
  const without = (text: string) => CIVIL.filter((line) => line !== text);
  assert.throws(() => courtRules(without('Effective September 16, 1938, as amended to December 1, 2099'), 'civil'), /never says what it is amended to/);
  assert.throws(() => courtRules(without('APPENDIX OF FORMS'), 'civil'), /no end after its last rule/);
  assert.throws(() => courtRules(without('(As amended Apr. 4, 2093, eff. Dec. 1, 2093.)'), 'civil'), /Rule 4 .*no history line/);
  assert.throws(() => courtRules(without('Rule 3. [Abrogated (Apr. 3, 2092, eff. Dec. 1, 2092).]'), 'civil'), /skip Rule 3/);
  assert.throws(() => courtRules(CIVIL.map((line) => line.replace('Rule 4. Title', 'Rule 2.1. Title')), 'civil'), /Rule 2\.1 after Rule 3/);
  assert.throws(() => courtRules(CIVIL.map((line) => line.replace('Rule 1. Scope', 'Rule 5. Scope')), 'civil'), /starts at Rule 5/);
  assert.throws(() => courtRules(CIVIL.map((line) => (line === 'ACTION' ? 'Some words' : line)), 'civil'), /text in a title heading/);
  assert.throws(() => courtRules(['Effective September 16, 1938, as amended to December 1, 2099', '', 'Stray words.', '', 'APPENDIX OF FORMS'], 'civil'), /outside any rule/);
});
