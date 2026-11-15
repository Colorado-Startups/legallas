// SPDX-License-Identifier: Apache-2.0
// The SEC staff's interpretations page, the Form ADV instructions and Form D. Invented text in each file's real shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formAdvParts, formD, secInterpretations, secUserAgent } from './sec.ts';

const PAGE = `<html><main><h2>Last Update: October 15, 2099</h2><p>An introduction that is not an interpretation.</p>
<h2>QUESTIONS AND ANSWERS OF GENERAL APPLICABILITY</h2>
<div class="rule"><h3 class="rule-title">Sections 101 to 109. Rules 100 to 133 [Reserved]</h3><div class="cdi">&nbsp;</div></div>
<div class="rule"><h3 class="rule-title">Section 110. Rule 134 — Widget Notices</h3><div class="cdi"><h4><a class="ck-anchor" id="110-01"></a>Question 110.01</h4><p><strong>Question:</strong> May a widget?</p><p><strong>Answer:</strong> Yes.</p><ul><li>A listed point.</li></ul></div></div>
<div class="rule"><h3>Section 148. Rule 152</h3><div class="cdi"><h4>Question 148.01</h4><p>Words.</p></div></div>
<div class="rule"><h3 class="rule-title">Section 149. Rule 505 — Repealed</h3><div class="cdi"><p>[withdrawn, Sept. 20, 2099]</p></div></div>
<h2>INTERPRETIVE RESPONSES REGARDING PARTICULAR SITUATIONS</h2>
<div class="rule-IR"><h3 class="rule-IR-title">Section 510. Rule 134 — Widget Notices</h3><div class="cdi-IR"><p><strong>510.01 </strong>A tombstone may name a widget. [Jan. 26, 2099]</p></div><div class="cdi-IR"><p><strong>510.02*</strong> A second response.</p><p>Its second paragraph.</p></div></div>
</main><div class="date-modified usa-prose"><p>Last Reviewed or Updated: Oct. 15, 2099</p></div><footer><p>Footer words.</p></footer></html>
`;

test('every interpretation comes back with its number, rule and words, and says which form it is', () => {
  const { updated, items } = secInterpretations(PAGE);
  assert.equal(updated, 'October 15, 2099');
  assert.deepEqual(items.map((item) => [item.number, item.form]), [['110.01', 'Question'], ['148.01', 'Question'], ['510.01', 'Interpretive Response'], ['510.02', 'Interpretive Response']]);
  assert.deepEqual(items[0], { number: '110.01', heading: 'Rule 134 — Widget Notices', lines: ['Question: May a widget?', 'Answer: Yes.', 'A listed point.'], form: 'Question', anchor: '110-01' });
  assert.deepEqual(items[3]?.lines, ['A second response.', 'Its second paragraph.']);
  assert.equal(items[1]?.heading, 'Rule 152');
});

test('nothing outside the two parts counts', () => {
  const words = secInterpretations(PAGE).items.flatMap((item) => item.lines).join(' ');
  assert.ok(!words.includes('introduction') && !words.includes('Footer') && !words.includes('Last Reviewed') && !words.includes('withdrawn'));
});

test('text with no interpretation to belong to, a page cut short or a changed layout fails loudly', () => {
  assert.throws(() => secInterpretations(PAGE.replace('[withdrawn, Sept. 20, 2099]', 'Real words under no question.')), /outside any interpretation: "Real words/);
  assert.throws(() => secInterpretations(PAGE.slice(0, 400)), /cut short/);
  assert.throws(() => secInterpretations(PAGE.replace('Last Update:', 'Updated:')), /does not say when/);
  assert.throws(() => secInterpretations(PAGE.replace('INTERPRETIVE RESPONSES REGARDING PARTICULAR SITUATIONS', 'OTHER')), /lost its two parts/);
  assert.throws(() => secInterpretations(PAGE.replace('Question 148.01', 'Query 148.01')), /a heading it can't read: "Query 148\.01"/);
  assert.throws(() => secInterpretations(PAGE.replace('<p>Words.</p>', '')), /148\.01 has no text/);
});

test('the contact must be a company name and an email', () => {
  assert.equal(secUserAgent('Example Company legal@example.com'), 'Example Company legal@example.com');
  assert.equal(secUserAgent('  Example Company legal@example.com\n'), 'Example Company legal@example.com');
  for (const bad of [undefined, '', 'legal@example.com', 'Example Company', 'Example Company legal@example']) assert.equal(secUserAgent(bad), null, String(bad));
});

const ADV = [
  '1', 'SEC 1707 (07-24) File 1 of 5', '',
  'FORM ADV (Paper Version)', '',
  'Cover words AND', 'Form ADV: General Instructions', '',
  'Read these fictional instructions.', '',
  '1. Where do I file? Somewhere.', '',
  '2', 'SEC 1707 (07-24) File 1 of 5', '',
  'The last words of the general part.', 'Form ADV: Instructions for Part 1A', '',
  'Answer every item.', '',
  'GLOSSARY OF TERMS', '',
  '1. Widget: A cog.', '',
];

test('the Form ADV instructions split at their three headings, with page furniture gone', () => {
  assert.deepEqual(formAdvParts(ADV), [
    { name: 'General Instructions', lines: ['Read these fictional instructions.', '1. Where do I file? Somewhere.', 'The last words of the general part.'] },
    { name: 'Instructions for Part 1A', lines: ['Answer every item.'] },
    { name: 'Glossary of Terms', lines: ['1. Widget: A cog.'] },
  ]);
});

test('Form ADV instructions missing a heading, or with an empty part, fail loudly', () => {
  assert.throws(() => formAdvParts(ADV.filter((line) => line !== 'GLOSSARY OF TERMS')), /no "Glossary of Terms"/);
  assert.throws(() => formAdvParts(['Form ADV: General Instructions', '', 'GLOSSARY OF TERMS', '']), /no "Instructions for Part 1A"/);
  assert.throws(() => formAdvParts(['Form ADV: General Instructions', '', 'Form ADV: Instructions for Part 1A', '', 'GLOSSARY OF TERMS', '', 'Words.', '']), /"General Instructions" holds no text/);
});

const PAGE_HEAD = ['FORM D', '', 'U.S. Securities and Exchange Commission', 'Washington, DC 20549', ''];
const ITEMS = Array.from({ length: 16 }, (_, i) => i + 1).flatMap((n) => [
  ...(n === 3 ? ['Item 3. Widget Persons. Name each:', '• Each widget maker; and', '• Each crank', 'turner.', 'If needed, add a note.'] : [`Item ${n}. Widget Field ${n}. Fill in field ${n}.`]),
  ...(n === 8 ? ['', 'Form D 10', '', 'FORM D', 'Item-by-Item Instructions (Continued)'] : []),
]);
// Form D's pages in pdfLines' shape: the cover's OMB box, the signature page with its terms and footnote, three columns of
// general instructions that break mid-sentence, then the items. The words between the form's own labels are invented.
const FORM_D = [
  'FORM D', '', 'OMB APPROVAL', 'OMB Number:', '3235-0076', 'Expires:', 'March 1, 2099', '', 'SEC1972 (1/99)', '', 'Form D 1', '',
  ...PAGE_HEAD,
  'Signature and Submission', 'Please review the Terms of Submission below.', '',
  'Terms of Submission. In Submitting this notice, each issuer named above is:',
  'Notifying the SEC of a widget offering. ∗',
  'Irrevocably appointing a fictional agent',
  'for widget matters.',
  'Certifying that, the widget is round.',
  'Each issuer identified above has read this notice and had it signed by the undersigned duly authorized person.',
  'Issuer(s)', '', 'Name of Signer', '',
  'This undertaking does not affect a fictional widget limit, apart from the', 'anti-fraud authority.', '', '∗', '', 'Form D 6', '',
  ...PAGE_HEAD,
  'Instructions for Submitting a Form D Notice', '',
  'General Instructions',
  'Who must file: Each widget', 'maker files.',
  'When to file:',
  'o A widget maker files within', 'nine days, as the Instruction to', 'Item 7. For this purpose, the', 'clock starts at the first', '',
  'turn of the crank.',
  'o An amendment may be filed:',
  '- to fix a non-', 'round widget;',
  '- yearly.',
  'When amendment is not', 'required: A widget that stops.', '', 'Form D 7', '',
  ...PAGE_HEAD,
  'How to file: Online at www.', 'example.gov.', '',
  'FORM D', 'Item-by-Item Instructions',
  ...ITEMS,
  'Signature and Submission. Sign the widget notice.', '', 'Form D 12', '',
  ...PAGE_HEAD,
  'Items 1 and 2 Continuation Page', '', 'Item 1 and 2. Field words (Continued)', '',
];

test('Form D comes back as its terms, its general instructions and each item, in order, with page furniture gone', () => {
  const { expires, edition, parts } = formD(FORM_D);
  assert.equal(expires, 'March 1, 2099');
  assert.equal(edition, 'SEC 1972 (1/99)');
  assert.deepEqual(parts.map((part) => part.name), ['Terms of Submission', 'General Instructions', ...Array.from({ length: 16 }, (_, i) => `Item ${i + 1}`), 'Signature and Submission']);
  assert.deepEqual(parts[0]?.lines, [
    'In Submitting this notice, each issuer named above is:',
    'Notifying the SEC of a widget offering. ∗',
    'Irrevocably appointing a fictional agent for widget matters.',
    'Certifying that, the widget is round.',
    'Each issuer identified above has read this notice and had it signed by the undersigned duly authorized person.',
    '∗ This undertaking does not affect a fictional widget limit, apart from the anti-fraud authority.',
  ]);
  assert.deepEqual(parts[1]?.lines, [
    'Who must file: Each widget maker files.',
    'When to file:',
    'o A widget maker files within nine days, as the Instruction to Item 7. For this purpose, the clock starts at the first turn of the crank.',
    'o An amendment may be filed:',
    '- to fix a non-round widget;',
    '- yearly.',
    'When amendment is not required: A widget that stops.',
    'How to file: Online at www.example.gov.',
  ]);
  assert.deepEqual(parts[4], { name: 'Item 3', heading: 'Item 3. Widget Persons', lines: ['Name each:', '• Each widget maker; and', '• Each crank turner.', 'If needed, add a note.'] });
  assert.deepEqual(parts[10], { name: 'Item 9', heading: 'Item 9. Widget Field 9', lines: ['Fill in field 9.'] });
  assert.deepEqual(parts[18], { name: 'Signature and Submission', heading: 'Signature and Submission', lines: ['Sign the widget notice.'] });
  const words = parts.flatMap((part) => part.lines).join(' ');
  assert.ok(!/Form D \d|Continued|Washington|Issuer\(s\)|Continuation/.test(words));
});

test('a file that is not Form D, or has lost a part, an item or the order of its items, fails loudly', () => {
  const swap = (from: string, to: string) => FORM_D.map((line) => (line === from ? to : line));
  assert.throws(() => formD(swap('3235-0076', '3235-9999')), /not Form D/);
  assert.throws(() => formD(swap('March 1, 2099', 'soon')), /expires/);
  assert.throws(() => formD(FORM_D.filter((line) => line !== 'Item 9. Widget Field 9. Fill in field 9.')), /Item 10 where Item 9 should be/);
  assert.throws(() => formD(swap('Item-by-Item Instructions', 'Item-by-Item Instructions Stray words.')), /text before any item: "Stray words\."/);
  assert.throws(() => formD(swap('Signature and Submission. Sign the widget notice.', '')), /no Signature and Submission instruction/);
  assert.throws(() => formD(swap('This undertaking does not affect a fictional widget limit, apart from the', '')), /footnote/);
  assert.throws(() => formD(swap('General Instructions', 'Other Instructions')), /no "General Instructions"/);
  assert.throws(() => formD(swap('Item 16. Widget Field 16. Fill in field 16.', 'Item 16. Widget Field 16.')), /Item 16 holds no text/);
});
