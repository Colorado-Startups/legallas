// SPDX-License-Identifier: Apache-2.0
// Raw official text to units (T21): operative text kept verbatim (dashes included, written \u2014 here), notes
// and head matter dropped. Fictional text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { buildCrs, crsCommonName } from './build.ts';
import { docxParagraphs, readDocx, zipEntry } from './docx.ts';
import type { LawPack } from './pack.ts';
import { capOpinions, capParties, crsArticle, ecfrSection, splitCrsHeading, uscodePage, uscSection } from './parse.ts';
import type { CrsSource } from './sources.ts';

const TITLE = [
  'ARTICLE 79',
  '9-79-101.  Other article. Text that must not appear.',
  'ARTICLE 80',
  'Fictional Companies',
  'Cross references: For something, see elsewhere.',
  'PART 1',
  'GENERAL',
  '9-80-101.  Short title. This article is the "Fictional Company Act".',
  'Source: L. 90: Entire article added.',
  "Editor's note: A note that is not law.",
  '(2) A note paragraph that looks like a subsection.',
  '9-80-102.  Duties of fictional managers. (1)  A manager shall:',
  '(a)  Account for property; and',
  '(b)  Refrain from competing.',
  'Source: L. 94: Entire section amended.',
  'Law reviews: For article, see somewhere.',
  '9-80-103.  Repealed.',
  'Source: L. 2003.',
  'ARTICLE 81',
  '9-81-101.  Next article. Not included.',
];

test('a C.R.S. article keeps each section\'s text up to its Source line and nothing after', () => {
  const sections = crsArticle(TITLE, '80');
  assert.deepEqual(sections.map((s) => [s.number, s.heading]), [
    ['9-80-101', 'Short title'],
    ['9-80-102', 'Duties of fictional managers'],
    ['9-80-103', 'Repealed'],
  ]);
  assert.deepEqual(sections[0]!.lines, ['This article is the "Fictional Company Act".']);
  assert.deepEqual(sections[1]!.lines, ['(1)  A manager shall:', '(a)  Account for property; and', '(b)  Refrain from competing.']);
  assert.throws(() => crsArticle(TITLE, '99'), /no ARTICLE 99/);
});

test('C.R.S. headings split from the text that follows them', () => {
  assert.deepEqual(splitCrsHeading('Derivative proceeding - demand. (1)  No member shall'), { heading: 'Derivative proceeding - demand', text: '(1)  No member shall' });
  assert.deepEqual(splitCrsHeading('Short title.'), { heading: 'Short title', text: '' });
  assert.deepEqual(splitCrsHeading('Repealed.'), { heading: 'Repealed', text: '' });
});

test('an eCFR section keeps its paragraphs and drops authority and source notes', () => {
  const xml = `<?xml version="1.0"?><DIV8 N="230.999" TYPE="SECTION"><HEAD>§ 230.999 Fictional exemption.</HEAD>
<P>(a) <I>General.</I> A caterer may rely on this section.</P><P>(b) <I>Conditions</I>\u2014(1) The first condition.</P>
<FP>flush text.</FP><SECAUTH TYPE="N">(Sec. 1; 1 Stat. 1)</SECAUTH><CITA TYPE="N">[1 FR 1, Jan. 1, 2000]</CITA></DIV8>`;
  const section = ecfrSection(xml);
  assert.equal(section.number, '230.999');
  assert.equal(section.heading, 'Fictional exemption');
  assert.deepEqual(section.lines, ['(a) General. A caterer may rely on this section.', '(b) Conditions\u2014(1) The first condition.', 'flush text.']);
});

test('a U.S. Code section ends at its source credit; editorial notes are dropped', () => {
  const html = `<html><head><title>x</title></head><body><h3>&sect;99z&ndash;1. Fictional prohibition</h3>
<p>It shall be unlawful for any fictional caterer&mdash;</p><p>(1) to do the first thing;</p>
<p>(Aug. 1, 1990, ch. 1, 1 Stat. 1.)</p><h4>Editorial Notes</h4><p>Amendment text.</p></body></html>`;
  const section = uscSection(html, '99z-1');
  assert.equal(section.heading, 'Fictional prohibition');
  assert.deepEqual(section.lines, ['It shall be unlawful for any fictional caterer\u2014', '(1) to do the first thing;']);
});

test('a uscode.house.gov page gives its section up to the source credit and how current the Code is (#336)', () => {
  const page = (credit: string, through: string) => `<html><body><div>The United States Code Online is ${through}.</div><h3>&sect;99z&ndash;1. Fictional prohibition</h3>
<p>It shall be unlawful for any fictional caterer&mdash;</p>${credit}<h4>Editorial Notes</h4><p>Amendment text.</p></body></html>`;
  const ok = uscodePage(page('<p class="source-credit">(Aug. 1, 1990, ch. 1, 1 Stat. 1.)</p>', 'current through Public Law 119-136 (October 22, 2026)'), '99z-1', '99 U.S.C. 99z-1');
  assert.equal(ok.through, 'Public Law 119-136 (October 22, 2026)');
  assert.deepEqual(ok.section.lines, ['It shall be unlawful for any fictional caterer\u2014']);
  assert.throws(() => uscodePage(page('', 'current through Public Law 119-136 (October 22, 2026)'), '99z-1', 'x'), /no source credit/);
  assert.throws(() => uscodePage(page('<p class="source-credit">(1990.)</p>', 'up to date'), '99z-1', 'x'), /how current/);
});

test('CAP opinions keep the opinion text with star pages and drop the head matter', () => {
  const html = `<section class="casebody"><section class="head-matter"><p class="parties">A. PARTY v. B. PARTY</p><p class="attorneys"><a id="p11" class="page-label">*11</a>Counsel names</p></section>
<article class="opinion" data-type="majority"><p class="author">Judge FICTION.</p><p>We affirm the fictional judgment.</p>
<p>The rule is stated <a id="p12" href="#p12" data-label="12" class="page-label">*12</a> on this page.</p></article>
<article class="opinion" data-type="dissent"><p class="author">Judge OTHER, dissenting.</p><p>I would reverse.</p></article></section>`;
  const opinions = capOpinions(html);
  assert.deepEqual(opinions.map((o) => [o.type, o.author, o.startPage]), [['majority', 'Judge FICTION.', '11'], ['dissent', 'Judge OTHER, dissenting.', '12']]);
  assert.deepEqual(opinions[0]!.lines, ['We affirm the fictional judgment.', 'The rule is stated [*12] on this page.']);
  assert.doesNotMatch(JSON.stringify(opinions), /Counsel names|PARTY v/);
  assert.equal(capParties(html), 'A. PARTY v. B. PARTY');
  assert.equal(capParties('<h4 class="parties" id="b1">C. ONE v. D. TWO</h4><p class="parties">and E. THREE</p>'), 'C. ONE v. D. TWO and E. THREE');
});

test('each CAP writing says which it is; a dissent left inside the majority\'s article is split off at its heading', () => {
  const html = `<section class="head-matter"><p class="parties">A. PARTY v. B. PARTY</p><a class="page-label">*11</a></section>
<article class="opinion" data-type="majority"><p class="author">JUSTICE FABLE delivered the Opinion of the Court.</p>
<p>We affirm.<a class="footnotemark" href="#footnote_1_1" id="ref_footnote_1_1">1</a></p>
<p>The rule <a class="page-label">*12</a> continues here.</p>
<p>JUSTICE OTHER dissents.</p>
<p>JUSTICE OTHER, dissenting.</p>
<p>I would reverse.<a class="footnotemark" href="#footnote_1_2" id="ref_footnote_1_2">2</a></p>
<aside data-label="1" class="footnote" id="footnote_1_1"><a href="#ref_footnote_1_1">1</a><p>. A majority note.</p></aside>
<aside data-label="2" class="footnote" id="footnote_1_2"><a href="#ref_footnote_1_2">2</a><p>A dissent note that runs <a class="page-label">*13</a> onward.</p></aside>
</article>
<article class="opinion" data-type="concurrence"><p class="author">THIRD, Justice,</p><p>concurring in part and dissenting in part:</p><p>I join part one.</p></article>`;
  const opinions = capOpinions(html);
  assert.deepEqual(opinions.map((o) => [o.opinion, o.judge, o.role, o.startPage]), [
    ['majority', 'Fable, J.', 'opinion of the court', '11'],
    ['dissent', 'Other, J.', 'dissenting', '12'],
    ['concurrence-dissent', 'Third, J.', 'concurring in part and dissenting in part', '12'],
  ]);
  assert.deepEqual(opinions[0]!.lines, ['We affirm.1', 'The rule [*12] continues here.', 'JUSTICE OTHER dissents.']);
  assert.deepEqual(opinions[0]!.notes, ['[*11] Footnote 1: A majority note.'], 'a footnote sits on the page of its mark, with its writing');
  assert.deepEqual(opinions[1]!.lines, ['I would reverse.2'], 'the heading opens the dissent and is not its text');
  assert.deepEqual(opinions[1]!.notes, ['[*12] Footnote 2: A dissent note that runs [*13] onward.']);
  assert.deepEqual(opinions[2]!.lines, ['I join part one.'], 'the role paragraph under the author line is said by the part marker instead');
  assert.equal(opinions[2]!.type, 'concurrence', 'CAP\'s type is kept as read; the writing\'s words set its kind');
});

test('an eCFR rule named for a statute subsection keeps its whole number out of the heading', () => {
  const xml = '<DIV8 N="275.999(z)-1" TYPE="SECTION"><HEAD>§ 275.999(z)-1 Fictional kitchen defined.</HEAD><P>(a) A fictional text.</P></DIV8>';
  const section = ecfrSection(xml);
  assert.equal(section.number, '275.999(z)-1');
  assert.equal(section.heading, 'Fictional kitchen defined');
});

test('U.S. Code footnote markers are not statute text', () => {
  const html = `<html><body><h3>&sect;99z&ndash;3. Fictional registration</h3>
<p>(m) An exemption for any fictional caterer, if each of&#160;<sup><a href="#99z-3_4_target" name="99z-3_4">4</a></sup> such caterer acts alone.</p>
<p>(Aug. 1, 1990, ch. 1, 1 Stat. 1.)</p></body></html>`;
  assert.deepEqual(uscSection(html, '99z-3').lines, ['(m) An exemption for any fictional caterer, if each of such caterer acts alone.']);
});

/** A one-entry zip archive (deflated), as a .docx holds word/document.xml. */
function zipOf(name: string, text: string): Buffer {
  const data = deflateRawSync(Buffer.from(text));
  const nameBytes = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  const centralAt = local.length + nameBytes.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12);
  end.writeUInt32LE(centralAt, 16);
  return Buffer.concat([local, nameBytes, data, central, nameBytes, end]);
}

test('a .docx yields one line per paragraph, entities decoded', () => {
  const xml = '<w:document><w:body><w:p><w:r><w:t>ARTICLE 80</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">A &amp; B</w:t></w:r><w:r><w:tab/><w:t>&#167; 1</w:t></w:r></w:p><w:p/></w:body></w:document>';
  assert.deepEqual(docxParagraphs(xml), ['ARTICLE 80', 'A & B § 1', '']);
  const zip = zipOf('word/document.xml', xml);
  assert.equal(zipEntry(zip, 'word/document.xml')?.toString(), xml);
  assert.equal(zipEntry(zip, 'missing.xml'), null);
  assert.deepEqual(readDocx(zip).slice(0, 2), ['ARTICLE 80', 'A & B § 1']);
  assert.throws(() => zipEntry(Buffer.from('not a zip at all, just some text bytes'), 'x'), /not a zip/);
});

test('C.R.S. common names: the general ones are the core\'s, and a section gets a pack\'s name only with the pack', async () => {
  assert.equal(crsCommonName('13-80-102'), 'statute of limitations');
  assert.equal(crsCommonName('13-22-301'), 'Colorado Dispute Resolution Act');
  assert.equal(crsCommonName('13-51-101'), 'Uniform Declaratory Judgments Law');
  const pack: LawPack = {
    name: 'Demo',
    hosts: [],
    urls: () => [],
    sources: { crsCommonNames: [{ section: /^38-12-103$/, name: 'deposit statute' }] },
    build: async () => [],
  };
  assert.equal(crsCommonName('38-12-103'), null);
  assert.equal(crsCommonName('38-12-103', pack.sources?.crsCommonNames), 'deposit statute');
  const lines = ['ARTICLE 12', '38-12-103.  Security deposit - return. (1) A landlord returns the deposit.', '38-12-104.  Normal wear. (1) Ordinary wear stays with the landlord.'];
  const xml = lines.map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join('');
  const body = zipOf('word/document.xml', `<w:document><w:body>${xml}</w:body></w:document>`);
  const cache = { get: async () => ({ body, retrieved: '2026-10-31' }) } as never;
  const source: CrsSource = { kind: 'crs', title: 38, article: '12', track: 'civil' };
  assert.deepEqual((await buildCrs(cache, source)).map((unit) => unit.title), ['Security deposit - return', 'Normal wear']);
  assert.deepEqual((await buildCrs(cache, source, { packs: [pack] })).map((unit) => unit.title), ['Security deposit - return (deposit statute)', 'Normal wear']);
});
