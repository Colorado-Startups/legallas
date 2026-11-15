// SPDX-License-Identifier: Apache-2.0
// Units to index parts (T21): small parts that open with their own citation line and pinpoint. Fictional text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { casePin, chunkUnit, excerptLines, footnotePin, leadingLabels, lineParagraphs, linePages, MAX_CHARS, pageSpan, paragraphPin, pinOf, splitLong, subsectionPath } from './chunk.ts';
import type { LawUnit, UnitOpinion } from './types.ts';

function unit(lines: string[], extra: Partial<LawUnit> = {}): LawUnit {
  return {
    id: 'crs-9-80-102',
    cite: 'C.R.S. § 9-80-102',
    title: 'Duties of fictional managers',
    url: 'https://content.leg.colorado.gov/x.pdf',
    retrieved: '2026-10-03',
    track: 'civil',
    kind: 'statute',
    source: 'Fixture',
    scheme: 'crs',
    lines,
    ...extra,
  };
}

test('subsection labels follow each scheme\'s outline', () => {
  assert.deepEqual(leadingLabels('(11) (a)  "Agreement" means'), ['11', 'a']);
  let path: string[] = [];
  for (const line of ['(1) One', '(a) Letter', '(II) Roman', '(A) Capital', '(2) Two']) path = subsectionPath(path, line, 'crs');
  assert.deepEqual(path, ['2']);
  path = subsectionPath(subsectionPath(subsectionPath([], '(1) One', 'crs'), '(b) Bee', 'crs'), '(III) Three', 'crs');
  assert.deepEqual(path, ['1', 'b', 'III']);
  path = subsectionPath(subsectionPath([], '(b) Conditions (1) not leading', 'cfr'), '(2) Specific', 'cfr');
  assert.deepEqual(path, ['b', '2']);
  path = subsectionPath(path, '(ii) Nature', 'cfr');
  assert.deepEqual(path, ['b', '2', 'ii'], 'a lowercase roman under a numbered paragraph is level 3');
  assert.deepEqual(subsectionPath(['b', '2', 'ii'], '(c) Next', 'cfr'), ['c']);
  assert.deepEqual(subsectionPath(['b', '2', 'iv'], '(v) Fifth', 'cfr'), ['b', '2', 'v'], '(v) after (iv) is roman');
  assert.deepEqual(subsectionPath(['u', '2'], '(v) Next letter', 'cfr'), ['v'], '(v) after (u)(2) is the next letter');
  assert.deepEqual(subsectionPath(['h', '3'], '(i) Next letter', 'cfr'), ['i'], '(i) after (h)(3) is the next letter');
  assert.deepEqual(subsectionPath(['c', '1'], '(i) First', 'cfr'), ['c', '1', 'i']);
  assert.equal(pinOf(['1', 'b', 'III']), '(1)(b)');
  assert.equal(pinOf([]), '');
});

test('a short unit is one part, cited as the whole section, whose text opens with the citation line', () => {
  const [only, ...rest] = chunkUnit(unit(['(1)  A manager shall:', '(a)  Account.', '(2)  A member may:', '(3)  Nothing else.']));
  assert.equal(rest.length, 0);
  assert.equal(only!.id, 'crs-9-80-102');
  assert.equal(only!.cite, 'C.R.S. § 9-80-102', 'a part holding (1) to (3) is not cited as (1)');
  assert.ok(only!.text.startsWith('C.R.S. § 9-80-102. Duties of fictional managers\n\n(1)  A manager shall:'));
  assert.equal('lines' in only!, false);
  assert.equal('scheme' in only!, false);
});

test('a long unit splits into numbered parts under the size limit; later parts carry their span', () => {
  const filler = 'Fictional words fill this subsection to make it long. '.repeat(14);
  const short = 'A short subsection.';
  const parts = chunkUnit(unit(['(1)  ' + filler, '(a)  ' + filler, '(2)  ' + filler, '(3)  ' + short, '(4)  ' + short]));
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map((p) => p.id), ['crs-9-80-102~1', 'crs-9-80-102~2']);
  for (const part of parts) assert.ok(part.text.length <= MAX_CHARS, `${part.id} is ${part.text.length}`);
  assert.equal(parts[0]!.cite, 'C.R.S. § 9-80-102', 'the first part starts at the beginning of the section');
  assert.equal(parts[1]!.cite, 'C.R.S. § 9-80-102(2)-(4)');
  assert.match(parts[0]!.text, /\(part 1 of \d\)\n/);
});

test('an excerpt keeps the chosen subsections and their lead-in, and every part carries its pinpoint', () => {
  const lines = [
    '(a) Fictional definitions',
    'When used in this fictional title:',
    '(50) "Other term" means something else.',
    '(51)(A) "Wanted term" means:',
    '(i) the first kind;',
    '(B) The agency may adopt rules.',
    '(52) "Next term" means a third thing.',
    '(c) Fictional exclusions',
    'None of the following is a fictional caterer:',
    '(1) A stand with a single cook.',
    '(10)(A) A charity, which is not kept.',
  ];
  assert.deepEqual(excerptLines(lines, ['a/51'], 'usc'), [lines[0], lines[1], lines[3], lines[4], lines[5]]);
  assert.deepEqual(excerptLines(lines, ['c/1'], 'usc'), [lines[7], lines[8], lines[9]], '(c)(10) is not (c)(1)');
  assert.throws(() => excerptLines(lines, ['c/7'], 'usc'), /no subsection c\/7/);
  const filler = 'Fictional words fill this paragraph to make it long. '.repeat(14);
  const excerpt = unit(['(c) Exclusions', `(1) ${filler}`, `(7)(A) ${filler}`, `(E) ${filler}`], { id: 'usc-99-80z-3', cite: '99 U.S.C. § 80z-3', scheme: 'usc', excerpt: true });
  const parts = chunkUnit(excerpt);
  assert.ok(parts.length > 1);
  assert.equal(parts[0]!.cite, '99 U.S.C. § 80z-3(c)', 'the first part of an excerpt is pinned too');
  assert.ok(parts.slice(1).every((p) => /^99 U\.S\.C\. § 80z-3\(c\)\(\d\)/.test(p.cite)), parts.map((p) => p.cite).join(' | '));
  assert.equal('excerpt' in parts[0]!, false, 'the flag stays out of the catalog');
  const single = chunkUnit(unit(['(a) Defs', '(51) Term.'], { id: 'usc-99-80z-2', cite: '99 U.S.C. § 80z-2(a)(51)', scheme: 'usc', excerpt: true }));
  assert.equal(single[0]!.cite, '99 U.S.C. § 80z-2(a)(51)', 'a unit cited at its subsection keeps that cite');
});

test('one very long line is cut at sentence ends', () => {
  const pieces = splitLong('First sentence here. '.repeat(200).trim(), 500);
  assert.ok(pieces.length > 1);
  for (const piece of pieces) assert.ok(piece.length <= 500);
  assert.ok(pieces[0]!.endsWith('.'));
});

test('opinion parts carry the star page they start on', () => {
  const para = (n: number) => `Fictional reasoning paragraph ${n}. `.repeat(30);
  const parts = chunkUnit(unit([para(1), `${para(2)} [*395]`, para(3), `${para(4)} [*396]`, para(5)], { id: 'case-107-p3d-393', cite: '107 P.3d 393', title: 'Fiction v. Fable (Colo. App. 2005)', scheme: 'case', kind: 'case' }));
  assert.equal(parts[0]!.cite, '107 P.3d 393');
  assert.ok(parts.slice(1).some((p) => /^107 P\.3d 393, 39[56]$/.test(p.cite)));
  const opening = chunkUnit(unit(['Fictional text. '.repeat(100), '[*394] Next page opens this run. ' + 'More. '.repeat(200)], { id: 'case-107-p3d-393', cite: '107 P.3d 393', title: 'Fiction v. Fable (Colo. App. 2005)', scheme: 'case', kind: 'case' }));
  assert.equal(opening[1]!.cite, '107 P.3d 393, 394', 'a run that opens on a star page starts on that page');
  assert.equal(casePin('107 P.3d 393', '393'), '107 P.3d 393');
  assert.equal(casePin('107 P.3d 393', '397'), '107 P.3d 393, 397');
});

test('a part whose text crosses a star page is cited to the range it covers, never to its first page alone', () => {
  assert.deepEqual(linePages('Text on one page [*152] text on the next.', '151'), { pages: ['151', '152'], after: '152' });
  assert.deepEqual(linePages('[*152] E.', '151'), { pages: ['152'], after: '152' }, 'a line that opens on a star page starts there');
  assert.deepEqual(linePages('The last words of a page. [*152]', '151'), { pages: ['151'], after: '152' }, 'a marker with nothing after it puts no text on its page');
  assert.deepEqual(linePages('Statute text.', null), { pages: [], after: null });
  assert.equal(pageSpan('151', '152'), '151-52');
  assert.equal(pageSpan('1018', '1019'), '1018-19');
  assert.equal(pageSpan('845', '853'), '845-53');
  assert.equal(pageSpan('99', '101'), '99-101');
  assert.equal(casePin('331 P.3d 140', '151', '152'), '331 P.3d 140, 151-52');
  assert.equal(casePin('331 P.3d 140', '140', '141'), '331 P.3d 140, 140-41');
  assert.equal(casePin('331 P.3d 140', '151', '151'), '331 P.3d 140, 151');
  const para = (n: number) => `Fictional reasoning paragraph ${n}. `.repeat(20);
  const parts = chunkUnit(unit([para(1), `${para(2)} [*151] ${para(3)}`, para(4)], { id: 'case-331-p3d-140', cite: '331 P.3d 140', title: 'Fiction v. Fable (Colo. App. 2003)', scheme: 'case', kind: 'case', startPage: '150' }));
  assert.ok(parts.some((p) => p.cite === '331 P.3d 140, 150-51' && /\[\*151\] Fictional/.test(p.text)), parts.map((p) => p.cite).join(' | '));
});

const OPINIONS: UnitOpinion[] = [
  {
    opinion: 'majority',
    judge: 'Fable, J.',
    role: 'opinion of the court',
    startPage: '394',
    lines: ['We hold the fictional rule applies. '.repeat(30), '[*395] The court left the other question open. '.repeat(20)],
    notes: ['[*394] Footnote 1: A note on the first page.', '[*395] Footnote 2: A note on the second.'],
  },
  {
    opinion: 'dissent',
    judge: 'Other, J.',
    role: 'dissenting',
    startPage: '395',
    lines: ['I would decide the other question the other way. '.repeat(30), 'And reverse. [*396] '.repeat(20)],
    notes: [],
  },
];

test('an opinion\'s parts are one writing each: the court\'s says so, a dissent opens on its marker and cites as one', () => {
  const parts = chunkUnit(unit([], { id: 'case-107-p3d-393', cite: '107 P.3d 393', title: 'Fiction v. Fable (Colo. 2005)', scheme: 'case', kind: 'case', startPage: '394', opinions: OPINIONS }));
  assert.deepEqual(parts.map((p) => p.id), parts.map((_, i) => `case-107-p3d-393~${i + 1}`), 'numbered through the case');
  assert.deepEqual(parts.map((p) => p.opinion), ['majority', 'majority', 'majority', 'dissent', 'dissent']);
  for (const part of parts) assert.ok(part.text.length <= MAX_CHARS, `${part.id} is ${part.text.length}`);
  const [first, , notes, dissent] = parts;
  assert.equal(first!.author, 'Fable, J.');
  assert.match(first!.text, /^107 P\.3d 393, 394\. Fiction v\. Fable \(Colo\. 2005\)\. Opinion of the court, Fable, J\. \(part 1 of 5\)\n\nWe hold/);
  assert.equal(notes!.cite, '107 P.3d 393, 394-95', 'footnotes form their own part, on the pages of their marks');
  assert.match(notes!.text, /\n\n\[\*394\] Footnote 1: /);
  assert.equal(dissent!.cite, '107 P.3d 393, 395 (Other, J., dissenting)');
  assert.equal(dissent!.author, 'Other, J.');
  assert.match(dissent!.text, /^107 P\.3d 393, 395 \(Other, J\., dissenting\)\. Fiction v\. Fable \(Colo\. 2005\) \(part 4 of 5\)\n\n\(Dissent, Other, J\.\)\nI would decide/);
  assert.match(parts[4]!.text, /\n\n\(Dissent, Other, J\.\)\n/, 'every part of a separate writing opens on its marker');
  assert.ok(!parts.slice(0, 3).some((p) => /I would decide|\(Dissent/.test(p.text)), 'no part of the court\'s opinion holds the dissent');
  assert.equal('opinions' in first!, false, 'the writings stay out of the catalog');
});

test('a slip opinion line sits in the paragraph it opens or follows; a heading in none', () => {
  assert.deepEqual(lineParagraphs('¶ 12 We hold the fictional rule applies.', '11'), { pages: ['12'], after: '12' });
  assert.deepEqual(lineParagraphs('(4) whether the fictional members are deadlocked;', '12'), { pages: ['12'], after: '12' });
  assert.deepEqual(lineParagraphs('II. Analysis', '12'), { pages: [], after: '12' });
  assert.deepEqual(lineParagraphs('Footnote 3 (¶ 7): A fictional note.', '12'), { pages: ['7'], after: '7' });
  assert.equal(footnotePin('2099 COA 1', [{ n: '2', p: '7' }]), '2099 COA 1, ¶ 7 n.2');
  assert.equal(footnotePin('2099 COA 1', [{ n: '2', p: '7' }, { n: '5', p: '9' }]), '2099 COA 1, nn.2-5');
  assert.equal(paragraphPin('2099 COA 1', '15'), '2099 COA 1, ¶ 15');
  assert.equal(paragraphPin('2099 COA 1', '15', '17'), '2099 COA 1, ¶¶ 15-17');
  assert.equal(paragraphPin('2099 COA 1', null), '2099 COA 1');
});

test('a slip opinion\'s parts are pinpointed by paragraph, writing by writing, and footnotes by their mark\'s paragraph', () => {
  const para = (n: number) => `¶ ${n} ${`Fictional reasoning in paragraph ${n}. `.repeat(16)}`;
  const writings: UnitOpinion[] = [
    { opinion: 'majority', judge: 'Fable, J.', role: 'opinion of the court', startPage: null, lines: [para(1), 'I. Background', para(2), para(3), para(4)], notes: ['Footnote 1 (¶ 2): A fictional note.'] },
    { opinion: 'dissent', judge: 'Other, J.', role: 'dissenting', startPage: null, lines: [para(5)], notes: [] },
  ];
  const parts = chunkUnit(unit([], { id: 'case-2099-coa-1', cite: '2099 COA 1', title: 'Fiction v. Fable, 2099 COA 1 (Colo. App. 2099)', scheme: 'case', kind: 'case', pinpoint: 'paragraph', opinions: writings }));
  assert.deepEqual(parts.map((p) => p.cite), ['2099 COA 1, ¶¶ 1-2', '2099 COA 1, ¶¶ 3-4', '2099 COA 1, ¶ 2 n.1', '2099 COA 1, ¶ 5 (Other, J., dissenting)']);
  assert.deepEqual(parts.map((p) => p.opinion), ['majority', 'majority', 'majority', 'dissent']);
  assert.deepEqual(parts.map((p) => p.author), ['Fable, J.', 'Fable, J.', 'Fable, J.', 'Other, J.']);
  assert.match(parts[0]!.text, /^2099 COA 1, ¶¶ 1-2\. Fiction v\. Fable, 2099 COA 1 \(Colo\. App\. 2099\)\. Opinion of the court, Fable, J\. \(part 1 of 4\)\n\n¶ 1 Fictional/);
  assert.match(parts[2]!.text, /\n\nFootnote 1 \(¶ 2\): A fictional note\.\n$/);
  assert.match(parts[3]!.text, /\n\n\(Dissent, Other, J\.\)\n¶ 5 /);
  assert.equal('pinpoint' in parts[0]!, false, 'the pinpoint style stays out of the catalog');
});

test('in the outline scheme, a list that starts on a number has the number on top', () => {
  const walk = (lines: string[]) => {
    let path: string[] = [];
    return lines.map((line) => (path = subsectionPath(path, line, 'outline')).join('/'));
  };
  assert.deepEqual(walk(['(1) One.', '(2) Two.', '(3) Three.']), ['1', '2', '3']);
  assert.deepEqual(walk(['(1) One.', '(a) Under it.', '(2) Two.']), ['1', '1/a', '2']);
  assert.deepEqual(walk(['(a) A.', '(1) Under a.', '(i) Under one.', '(A) Under i.', '(b) B.']), ['a', 'a/1', 'a/1/i', 'a/1/i/A', 'b']);
  assert.deepEqual(walk(['(A) One.', '(B) Two.']), ['A', 'A/B']);
});
