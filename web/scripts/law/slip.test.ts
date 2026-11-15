// SPDX-License-Identifier: Apache-2.0
// Colorado slip opinions from their PDF text runs (W4c): paragraphs, headings, footnote marks and footnotes, page
// numbers and head matter. Fictional text laid out the way the Court of Appeals sets its opinions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PdfItem } from './pdf.ts';
import { footnoteStart, isClosing, joinRuns, joinWrapped, slipOpinion } from './slip.ts';

type Spec = string | { text: string; size?: number; gap?: number; raise?: number };

/** Runs set left to right from `x` on one baseline, a word space apart unless a spec says otherwise. */
function row(page: number, y: number, x: number, ...specs: Spec[]): PdfItem[] {
  const out: PdfItem[] = [];
  let at = x;
  for (const raw of specs) {
    const spec = typeof raw === 'string' ? { text: raw } : raw;
    if (out.length) at += spec.gap ?? 4;
    const size = spec.size ?? 14;
    const width = spec.text.length * size * 0.45;
    out.push({ page, str: spec.text, x: at, y: y + (spec.raise ?? 0), width, size });
    at += width;
  }
  return out;
}

const MARGIN = 72;
const pageNumber = (page: number, n: number) => row(page, 38.8, 302, { text: String(n), size: 12 });
const paragraph = (page: number, y: number, n: number, ...specs: Spec[]) => [...row(page, y, 57.6, { text: `¶ ${n}`, size: 12 }), ...row(page, y, 108, ...specs)];

function caption(panel: string): PdfItem[] {
  return [
    ...row(1, 700, MARGIN, 'SUMMARY'),
    ...row(1, 660, MARGIN, 'The summaries of the Colorado Court of Appeals published opinions constitute no part of the opinion.'),
    ...row(2, 694, MARGIN, { text: 'COLORADO COURT OF APPEALS', size: 12 }, { text: '2099COA1', size: 12, gap: 220 }),
    ...row(2, 579, MARGIN, { text: 'Fable Corp.,', size: 12 }),
    ...row(2, 550, MARGIN, { text: 'Plaintiff-Appellee,', size: 12 }),
    ...row(2, 522, MARGIN, { text: 'v.', size: 12 }),
    ...row(2, 494, MARGIN, { text: 'George Fiction,', size: 12 }),
    ...row(2, 366, 219, { text: 'Opinion by JUDGE FABLE', size: 12 }),
    ...row(2, 352, 221, { text: panel, size: 12 }),
    ...row(2, 324, 224, { text: 'Announced January 1, 2099', size: 12 }),
    ...row(2, 280, MARGIN, { text: 'Counsel for the fictional parties', size: 12 }),
  ];
}

/** Two pages of opinion: a raised mark and an inline one, a heading, a footnote that runs onto the next page. */
function opinionPages(third: PdfItem[], closing: string | null = 'JUDGE OTHER and JUDGE THIRD concur.'): PdfItem[] {
  return [
    ...paragraph(3, 700, 1, 'The fictional company appeals the judgment.'),
    ...row(3, 667, MARGIN, 'It contends the court erred.', { text: '1', size: 9, gap: 0.5, raise: 3.5 }, 'We disagree and'),
    ...row(3, 634, MARGIN, 'affirm.'),
    ...row(3, 601, 246, 'I.', { text: 'Background', gap: 20 }),
    ...paragraph(3, 568, 2, 'The trial court granted the motion,2 finding the fictional claims barred under section'),
    ...row(3, 535, MARGIN, '38-'),
    ...row(3, 502, MARGIN, '12-105, C.R.S. 2099, and C.A.R. 39.1 for fees.'),
    ...row(3, 111.6, MARGIN, { text: '1 ', size: 9 }),
    ...row(3, 108.1, 82.1, 'A fictional note that runs on'),
    ...row(3, 91.7, MARGIN, 'to the next'),
    ...pageNumber(3, 1),
    ...third,
    ...(closing ? row(4, 600, 108, closing) : []),
    ...row(4, 120, MARGIN, 'page and ends here.'),
    ...row(4, 103.6, MARGIN, { text: '2', size: 9 }),
    ...row(4, 100.1, 82.1, 'The second fictional note.'),
    ...pageNumber(4, 2),
  ];
}

test('a slip opinion keeps its numbered paragraphs, headings and footnotes, and drops the head matter', () => {
  const items = [...caption('Other and Third, JJ., concur'), ...opinionPages(paragraph(4, 700, 3, 'The judgment is affirmed.'))];
  const slip = slipOpinion(items);
  assert.match(slip.caption, /2099COA1 Fable Corp\., Plaintiff-Appellee, v\. George Fiction,/);
  assert.equal(slip.writings.length, 1);
  const [court] = slip.writings;
  assert.deepEqual([court!.opinion, court!.judge, court!.role], ['majority', 'Fable, J.', 'opinion of the court']);
  assert.deepEqual(court!.lines, [
    '¶ 1 The fictional company appeals the judgment. It contends the court erred. We disagree and affirm.',
    'I. Background',
    '¶ 2 The trial court granted the motion, finding the fictional claims barred under section 38-12-105, C.R.S. 2099, and C.A.R. 39.1 for fees.',
    '¶ 3 The judgment is affirmed.',
  ]);
  assert.deepEqual(court!.notes, ['Footnote 1 (¶ 1): A fictional note that runs on to the next page and ends here.', 'Footnote 2 (¶ 2): The second fictional note.']);
  assert.ok(!court!.lines.some((line) => /SUMMARY|summaries|Counsel|JUDGE OTHER/.test(line)), 'summary, caption, counsel and the closing line are dropped');
});

test('a separate writing under its heading is split off, with its author and role', () => {
  const third = [
    ...paragraph(4, 700, 3, 'The judgment is affirmed.'),
    ...row(4, 667, 108, 'JUDGE THIRD concurs.'),
    ...row(4, 634, 220, 'JUDGE OTHER, dissenting.'),
    ...paragraph(4, 601, 4, 'I would reverse the fictional judgment.'),
  ];
  const items = [...caption('Third, J., concurs; Other, J., dissents'), ...opinionPages(third, null)];
  const slip = slipOpinion(items);
  assert.deepEqual(slip.writings.map((w) => [w.opinion, w.judge, w.role]), [['majority', 'Fable, J.', 'opinion of the court'], ['dissent', 'Other, J.', 'dissenting']]);
  assert.deepEqual(slip.writings[1]!.lines, ['¶ 4 I would reverse the fictional judgment.']);
  assert.equal(slip.writings[0]!.lines.at(-1), '¶ 3 The judgment is affirmed.');
});

test('a slip opinion that skips a paragraph, loses a footnote or hides a separate writing is refused', () => {
  const base = [...caption('Other and Third, JJ., concur'), ...opinionPages(paragraph(4, 700, 3, 'The judgment is affirmed.'))];
  const skipped = base.map((item) => (item.str === '¶ 3' ? { ...item, str: '¶ 4' } : item));
  assert.throws(() => slipOpinion(skipped), /¶ 4 follows ¶ 2/);
  const unmarked = base.map((item) => (item.str.startsWith('The trial court granted the motion,2') ? { ...item, str: item.str.replace(',2', ',') } : item));
  assert.throws(() => slipOpinion(unmarked), /footnote marks and 2 footnotes do not pair up|footnote 2 follows/);
  const hidden = [...caption('Other, J., dissents'), ...opinionPages(paragraph(4, 700, 3, 'The judgment is affirmed.'))];
  assert.throws(() => slipOpinion(hidden), /panel line .* disagree/);
  assert.throws(() => slipOpinion(base.filter((item) => item.str !== 'Opinion by JUDGE FABLE')), /no "Opinion by" line/);
});

test('runs join with a space only where they do not touch; a line ending "38-" runs on', () => {
  assert.equal(joinRuns(row(1, 100, 72, 'Fiction v. Fable', { text: ', 2099 COA 1', gap: 0.2 }, 'held')), 'Fiction v. Fable, 2099 COA 1 held');
  assert.equal(joinWrapped('section 38-', '12-105'), 'section 38-12-105');
  assert.equal(joinWrapped('the fictional', 'claim'), 'the fictional claim');
});

test('footnotes start at the single spaced run under the widest gap at the foot of a page, and only there', () => {
  assert.equal(footnoteStart([{ y: 700 }, { y: 667 }, { y: 634 }, { y: 111.6 }, { y: 95.2 }]), 3);
  assert.equal(footnoteStart([{ y: 700 }, { y: 667 }, { y: 634 }]), 3, 'no footnotes');
  assert.equal(footnoteStart([{ y: 700 }, { y: 667 }, { y: 650.6 }, { y: 634.2 }]), 4, 'a block quotation at the foot is text');
});

test('a closing line names judges and ends in concurring or dissenting', () => {
  for (const line of [
    'JUDGE OTHER and JUDGE THIRD concur.',
    'JUDGE THIRD concurs.',
    'JUDGE THIRD specially concurs.',
    'CHIEF JUDGE OTHER dissents',
    'JUSTICE O’BRIEN-SMITH, JUSTICE THIRD, and CHIEF JUSTICE FOURTH concur.',
    'and JUDGE THIRD concurs.',
    'JUDGE THIRD, concurs.',
  ]) assert.equal(isClosing(line), true, line);
  for (const line of [
    'concurs.',
    'JUDGE concurs.',
    'The JUDGE OTHER concurs.',
    'JUDGE OTHER and THIRD concur.',
    'JUDGE Other concurs.',
    'JUDGE OTHER concurs in part.',
    'JUDGE OTHER, dissenting.',
  ]) assert.equal(isClosing(line), false, line);
});

test('a long run of capitals answers at once', () => {
  assert.equal(isClosing(`${'JUDGE X '.repeat(4000)}!`), false);
  assert.equal(isClosing(`${'JUDGE X '.repeat(4000)}concurs.`), true);
});
