// SPDX-License-Identifier: Apache-2.0
// A whole C.F.R. part from the eCFR bulk title file. Invented text in the file's real shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ecfrBulkUrl, ecfrPart } from './ecfr-bulk.ts';

const TITLE = (parts: string) => `<?xml version="1.0"?><DLPSTEXTCLASS><TEXT><BODY><ECFRBRWS><AMDDATE>Oct. 19, 2099 (fm)</AMDDATE><DIV1 N="1" TYPE="TITLE">${parts}</DIV1></ECFRBRWS></BODY></TEXT></DLPSTEXTCLASS>\n`;
const PART = `<DIV5 N="900" NODE="99:1" TYPE="PART"><HEAD>PART 900—FICTIONAL RULES</HEAD><AUTH><HED>Authority:</HED><PSPACE>Not the rule's words.</PSPACE></AUTH>
<DIV8 N="§ 900.1" TYPE="SECTION"><HEAD>§ 900.1   Scope.</HEAD><P>(a) <I>General.</I> This part covers widgets<SU>1</SU><FTREF/>.</P><P>(b) It covers cogs.</P><CITA TYPE="N">[99 FR 1, Jan. 1, 2099]</CITA><SECAUTH>Not the rule's words either.</SECAUTH></DIV8>
<DIV8 N="§ 900.2" TYPE="SECTION"><HEAD>§ 900.2   [Reserved]</HEAD></DIV8>
<DIV8 N="§§ 900.3-900.5" TYPE="SECTION"><HEAD>§§ 900.3-900.5   [Reserved]</HEAD></DIV8>
<EXTRACT><HD1>ATTENTION ELECTRONIC FILERS</HD1><FP>A filing notice that repeats through the part.</FP></EXTRACT>
<NOTE><HED>Preliminary Notes:</HED><P>1. A note printed between sections.</P></NOTE>
<DIV8 N="§ 900.6A." TYPE="SECTION"><HEAD>§ 900.6A   Rates.</HEAD><P>The rates are:</P><TABLE><TR><TH>Widget</TH><TH>Rate</TH></TR><TR><TD>Cog</TD><TD>$1</TD></TR></TABLE><P>The formula is <MATH><img src="x.png"/></MATH>.</P></DIV8>
<DIV8 N="§ 900.206(4)-2" TYPE="SECTION"><HEAD>§ 900.206(4)-2   Custody.</HEAD><P>(a) Keep the cogs safe.</P></DIV8>
<NOTE><P>A note after the last section.</P></NOTE></DIV5>`;

test('a part comes back whole, section by section, with what the rule says and no notes about it', () => {
  const part = ecfrPart(TITLE(PART), 900);
  assert.equal(part.amended, 'Oct. 19, 2099');
  assert.deepEqual(part.sections.map((s) => s.number), ['900.1', '900.6A', '900.206(4)-2']);
  assert.deepEqual(part.sections[0], { number: '900.1', heading: 'Scope', lines: ['(a) General. This part covers widgets .', '(b) It covers cogs.'] });
});

test('reserved sections and spans of numbers are reported, not built', () => {
  assert.deepEqual(ecfrPart(TITLE(PART), 900).reserved, ['900.2', '900.3-900.5']);
});

test('tables keep their rows, and a formula printed as an image says so instead of closing up', () => {
  const rates = ecfrPart(TITLE(PART), 900).sections[1];
  assert.equal(rates?.heading, 'Rates');
  assert.ok(rates?.lines.includes('Widget | Rate') && rates.lines.includes('Cog | $1'));
  assert.ok(rates?.lines.some((line) => line.includes('[formula printed as an image; see the official text]')));
});

test('notes between sections go with the next section, marked as such, and the filing notice is dropped', () => {
  const { sections } = ecfrPart(TITLE(PART), 900);
  assert.equal(sections[1]?.lines[1], 'Note printed before this section: 1. A note printed between sections.');
  assert.ok(sections[1]?.lines.every((line) => !line.includes('ATTENTION') && !line.includes('filing notice')));
  assert.equal(sections.at(-1)?.lines.at(-1), 'Note printed before this section: A note after the last section.');
});

test('the lines of a printed form are read, and a tag this parser doesn\'t know fails the part instead of vanishing', () => {
  const part = (body: string) => TITLE(`<DIV5 N="900" TYPE="PART"><DIV8 N="§ 900.1" TYPE="SECTION"><HEAD>§ 900.1   Form.</HEAD>${body}</DIV8></DIV5>`);
  assert.deepEqual(ecfrPart(part('<P>Lead-in:</P><FP-DASH>Name of filer</FP-DASH><FP-1>First line</FP-1><FP-2>Second line</FP-2><PSPACE>A spaced line</PSPACE><FRP>Signature</FRP>'), 900).sections[0]?.lines, ['Lead-in:', 'Name of filer', 'First line', 'Second line', 'A spaced line', 'Signature']);
  assert.throws(() => ecfrPart(part('<P>Lead-in:</P><NEWTAG>Operative words.</NEWTAG>'), 900), /C\.F\.R\. § 900\.1 has text the parser doesn't read: "Operative words\."/);
  assert.throws(() => ecfrPart(part('<P>Lead-in:</P>Bare words.'), 900), /doesn't read: "Bare words\."/);
});

test('a link to a later amendment isn\'t the rule\'s words', () => {
  const part = TITLE('<DIV5 N="900" TYPE="PART"><DIV8 N="§ 900.1" TYPE="SECTION"><HEAD>§ 900.1   Scope.</HEAD><XREF>Link to an amendment published at 99 FR 1.</XREF><P>Words.</P></DIV8></DIV5>');
  assert.deepEqual(ecfrPart(part, 900).sections[0]?.lines, ['Words.']);
});

test('only a heading that says reserved makes a section reserved', () => {
  const part = (head: string, body = '') => TITLE(`<DIV5 N="900" TYPE="PART"><DIV8 N="§ 900.1" TYPE="SECTION"><HEAD>§ 900.1   Kept.</HEAD><P>Words.</P></DIV8><DIV8 N="§ 900.2" TYPE="SECTION"><HEAD>§ 900.2   ${head}</HEAD>${body}</DIV8></DIV5>`);
  assert.deepEqual(ecfrPart(part('[Reserved]'), 900).reserved, ['900.2']);
  // Everything was read, so this section's heading is its whole text.
  assert.deepEqual(ecfrPart(part('Form W-1, the widget form.'), 900).sections[1], { number: '900.2', heading: 'Form W-1, the widget form', lines: ['Form W-1, the widget form'] });
  assert.throws(() => ecfrPart(TITLE('<DIV5 N="900" TYPE="PART"><DIV8 N="§ 900.1" TYPE="SECTION"><HEAD>§ 900.1   Kept.</HEAD><P>Words.</P></DIV8><DIV8 N="§§ 900.3-900.5" TYPE="SECTION"><HEAD>§§ 900.3-900.5   Powers reserved to the Commission.</HEAD><P>Real text.</P></DIV8></DIV5>'), 900), /no citation can name/);
});

test('an exponent stays and a footnote mark goes', () => {
  const part = TITLE('<DIV5 N="900" TYPE="PART"><DIV8 N="§ 900.1" TYPE="SECTION"><HEAD>§ 900.1   Math.</HEAD><P>Growth is (1 + r)<SU>n</SU> by the rule<SU>1</SU><FTREF/>.</P></DIV8></DIV5>');
  assert.deepEqual(ecfrPart(part, 900).sections[0]?.lines, ['Growth is (1 + r)^n by the rule .']);
});

test('a formula outside a paragraph still says it is missing', () => {
  const part = TITLE('<DIV5 N="900" TYPE="PART"><DIV8 N="§ 900.1" TYPE="SECTION"><HEAD>§ 900.1   Math.</HEAD><P>The formula is:</P><MATH><img src="x"/></MATH><P>where r is the rate.</P></DIV8></DIV5>');
  assert.deepEqual(ecfrPart(part, 900).sections[0]?.lines, ['The formula is:', '[formula printed as an image; see the official text]', 'where r is the rate.']);
});

test('a real note beside the filing notice isn\'t taken with it, and an appendix fails the part', () => {
  const part = TITLE('<DIV5 N="900" TYPE="PART"><EXTRACT><P>A real note.</P></EXTRACT><EXTRACT><HD1>ATTENTION ELECTRONIC FILERS</HD1></EXTRACT><DIV8 N="§ 900.1" TYPE="SECTION"><HEAD>§ 900.1   Scope.</HEAD><P>Words.</P></DIV8></DIV5>');
  assert.deepEqual(ecfrPart(part, 900).sections[0]?.lines, ['Note printed before this section: A real note.', 'Words.']);
  assert.throws(() => ecfrPart(TITLE('<DIV5 N="900" TYPE="PART"><DIV8 N="§ 900.1" TYPE="SECTION"><HEAD>§ 900.1   Scope.</HEAD><P>Words.</P></DIV8><DIV9 N="Appendix A"><P>Text.</P></DIV9></DIV5>'), 900), /has an appendix/);
});

test('a file cut short, a missing part or text no citation can name fails loudly', () => {
  assert.throws(() => ecfrPart(TITLE(PART).slice(0, 400), 900), /cut short/);
  assert.throws(() => ecfrPart(TITLE(PART), 901), /part 901 is not in the title file/);
  assert.throws(() => ecfrPart(TITLE('<DIV5 N="900" TYPE="PART"><HEAD>PART 900</HEAD></DIV5>'), 900), /yielded no sections/);
  assert.throws(() => ecfrPart(TITLE('<DIV5 N="900" TYPE="PART"><DIV8 N="§§ 900.1-900.2" TYPE="SECTION"><HEAD>§§ 900.1-900.2   Words.</HEAD><P>Real text.</P></DIV8></DIV5>'), 900), /no citation can name/);
  assert.throws(() => ecfrPart(`<DLPSTEXTCLASS>${PART}</DLPSTEXTCLASS>`, 900), /last amended/);
});

test('the bulk file is on govinfo, not on the eCFR path the site asks machines to leave alone', () => {
  assert.equal(ecfrBulkUrl(17), 'https://www.govinfo.gov/bulkdata/ECFR/title-17/ECFR-title17.xml');
});
