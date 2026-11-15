// SPDX-License-Identifier: Apache-2.0
// A govinfo Statute Compilation to sections. Invented text in the file's real shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCompilation } from './compilation.ts';

const NUM = (value: string) => `<num value="${value}">(${value}) </num>`;
const HEAD = `<statuteCompilation xmlns="http://schemas.gpo.gov/xml/uslm"><meta><dc:title>FICTIONAL ACT OF 2099</dc:title><currentThroughPublicLaw>119–99</currentThroughPublicLaw></meta><main>`;
const FOOT = `</main></statuteCompilation>`;
const FICTION =
  HEAD +
  `<title identifier="/us/sComp/1/1/tI">
  <section identifier="/us/sComp/1/1/tI/s1"><heading>short title </heading><num value="1">Sec. 1. </num><editorialNote role="uscRef"><b>[</b>99a<b>]</b> </editorialNote><content>This Act may be called the Fictional Act.</content></section>
  <section identifier="/us/sComp/1/1/tI/s2"><heading>definitions </heading><num value="2">Sec. 2. </num><editorialNote role="uscRef">[99b–1] </editorialNote><subsection class="inline" identifier="/us/sComp/1/1/tI/s2/a">${NUM('a')}<heading>Widget.—</heading><chapeau>A widget<ref class="footnoteRef" idref="x">1</ref> means—</chapeau>
    <paragraph identifier="/us/sComp/1/1/tI/s2/a/1">${NUM('1')}<content>a cog; or</content></paragraph>
    <paragraph identifier="/us/sComp/1/1/tI/s2/a/2">${NUM('2')}<content>a sprocket.</content></paragraph></subsection>
    <subsection identifier="/us/sComp/1/1/tI/s2/b">${NUM('b')}<paragraph identifier="/us/sComp/1/1/tI/s2/b/1">${NUM('1')}<content>Nested under a bare label.</content></paragraph></subsection>
    <footnote id="x"><sup>1</sup><p>An editor's note that is not the Act's words.</p></footnote>
  </section>
  <section identifier="/us/sComp/1/1/tI/s3"><num value="3">Sec. 3. </num><editorialNote style="legis-comment"><b>[</b>Section 3 amended another Act.<b>]</b> </editorialNote></section>
  <section role="undesignated-level"><heading>penalties</heading></section>
  <section identifier="/us/sComp/1/1/tI/s4"><num value="4">SEC. 4. </num><editorialNote role="uscRef">[15 U.S.C. 99d] </editorialNote><editorialNote role="uscRef">[15 U.S.C. 99d note] </editorialNote><content class="block">A fine of one dollar.</content></section>
  <section identifier="/us/sComp/1/1/tI/s5"><heading>fees </heading><num value="5">Sec. 5. </num><editorialNote role="uscRef">[99e] </editorialNote><content>A fee.</content><quotedContent><section role="undesignated-level"><content>“Quoted words stay in the section that quotes them.”</content></section></quotedContent>
    <heading><editorialNote role="uscRef"><b>[</b>99f<b>]</b> </editorialNote>schedule a </heading><paragraph class="inline" identifier="/us/sComp/1/1/tI/s5/1">${NUM('1')}<content>The name of the widget.</content></paragraph></section>
  <section identifier="/us/sComp/1/1/tI/s6"><heading>uncoded </heading><num value="6">Sec. 6. </num><content>Words with no note.</content></section>
  </title>` +
  FOOT;

const UNCODED = { '6': '99g' };

test('each section is numbered by its U.S. Code note and keeps the act\'s own number', () => {
  const compiled = parseCompilation(FICTION, 15, UNCODED);
  assert.equal(compiled.title, 'FICTIONAL ACT OF 2099');
  assert.equal(compiled.through, 'P.L. 119-99');
  assert.deepEqual(
    compiled.sections.map((section) => [section.number, section.actSection]),
    [['99a', '1'], ['99b-1', '2'], ['99d', '4'], ['99e', '5'], ['99f', ''], ['99g', '6']],
  );
  assert.equal(compiled.sections[0]?.heading, 'Short title');
  assert.equal(compiled.sections[0]?.uscTitle, 15);
});

test('the text keeps one line per subdivision and drops footnotes and editorial notes', () => {
  const lines = parseCompilation(FICTION, 15, UNCODED).sections[1]?.lines;
  assert.deepEqual(lines, ['(a) Widget.—A widget means—', '(1) a cog; or', '(2) a sprocket.', '(b) (1) Nested under a bare label.']);
});

test('a heading printed as an empty section above goes with the section it comes before, and quoted words stay put', () => {
  const { sections } = parseCompilation(FICTION, 15, UNCODED);
  assert.equal(sections.find((s) => s.number === '99d')?.heading, 'Penalties');
  assert.deepEqual(sections.find((s) => s.number === '99e')?.lines, ['A fee.', '“Quoted words stay in the section that quotes them.”']);
});

test('a second U.S. Code note inside a section starts a section of its own, under its own heading', () => {
  const schedule = parseCompilation(FICTION, 15, UNCODED).sections.find((s) => s.number === '99f');
  assert.equal(schedule?.heading, 'Schedule A');
  assert.deepEqual(schedule?.lines, ['(1) The name of the widget.']);
});

test('a section with only an editorial note is reported as empty, not built', () => {
  assert.deepEqual(parseCompilation(FICTION, 15, UNCODED).empty, ['3']);
});

test('a section with text and no U.S. Code note fails until someone checks its number', () => {
  assert.throws(() => parseCompilation(FICTION, 15), /section 6 of FICTIONAL ACT OF 2099 has text and no U\.S\. Code note/);
});

test('text outside any section it can read fails, between sections or after the last', () => {
  const section = '<section identifier="/us/s1"><heading>one </heading><num>Sec. 1. </num><editorialNote role="uscRef">[99a] </editorialNote><content>Words.</content></section>';
  for (const stray of [
    '<section role="undesignated-level"><heading>fines</heading><content>A fine of a dollar.</content></section>',
    '<section identifier="/us/s3.1"><num>Sec. 3.1. </num><content>An odd number.</content></section>',
    '<appendix><content>An appendix.</content></appendix>',
  ]) {
    assert.throws(() => parseCompilation(`${HEAD}${section}${stray}${FOOT}`, 15), /has text outside any section it can read/, stray);
    assert.throws(() => parseCompilation(`${HEAD}${stray}${section}${FOOT}`, 15), /has text outside any section it can read/, stray);
  }
  // Title headings, the long title and the enacting words are structure.
  const framed = `${HEAD}<longTitle>AN ACT to do a thing.</longTitle><enactingFormula>Be it enacted.</enactingFormula><title identifier="/us/t1"><num>TITLE I—</num><heading>WIDGETS</heading>${section}</title>${FOOT}`;
  assert.equal(parseCompilation(framed, 15).sections.length, 1);
});

test('a subsection heading just before a later note stays in its own section', () => {
  const xml = `${HEAD}<section identifier="/us/s1"><heading>one </heading><num>Sec. 1. </num><editorialNote role="uscRef">[99a] </editorialNote><subsection>${NUM('b')}<heading>Foo.—</heading><content>Short.</content></subsection><editorialNote role="uscRef">[99b] </editorialNote><content>The other piece.</content></section>${FOOT}`;
  const { sections } = parseCompilation(xml, 15);
  assert.deepEqual(sections[0]?.lines, ['(b) Foo.—Short.']);
  assert.deepEqual(sections[1]?.lines, ['The other piece.']);
});

test('a file cut short or laid out differently fails loudly', () => {
  assert.throws(() => parseCompilation(FICTION.slice(0, -30), 15, UNCODED), /cut short/);
  assert.throws(() => parseCompilation(`${HEAD}<title></title>${FOOT}`, 15), /no sections/);
  assert.throws(() => parseCompilation(`<statuteCompilation><main></main></statuteCompilation>`, 15), /does not say its title/);
  assert.throws(
    () => parseCompilation(`${HEAD}<section identifier="/us/s1"><num>Sec. 1.</num><editorialNote role="uscRef">[see elsewhere] </editorialNote><content>Words.</content></section>${FOOT}`, 15),
    /U\.S\. Code note reads "\[see elsewhere\]"/,
  );
  // A section that opens and never closes, inside a file whose last tag is intact.
  assert.throws(() => parseCompilation(`${HEAD}<section identifier="/us/s1"><content>Words.</content>${FOOT}`, 15), /never closes/);
});
