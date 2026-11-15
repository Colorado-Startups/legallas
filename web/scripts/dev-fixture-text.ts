// SPDX-License-Identifier: Apache-2.0
// Card F9. The words inside the dev fixture's dummy files. Every page a fixture matter entry cites carries that
// entry's title (events, money, proof notes, people, violation steps and figures), so the pinpoint quote and
// PDFFindController have a real phrase to find on the cited page. Everything here is fictional (Doe v. Harbor Labs, Inc.).
import type { Matter } from '../worker/matter-types.ts';
import { parseFilename } from './matter/catalog.ts';

export const CAPTION = 'DOE v. HARBOR LABS, INC.';
const FILLER_LINES = 9;

/** documents path by fixture document id (the inverse of web/fixtures/doc-ids.json). */
export function pathById(docIds: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(docIds).map(([docPath, id]) => [id, docPath]));
}

/** Sentences to print on each cited page: path -> page -> lines. A whole-file cite (page null) lands on page 1. */
export function citedLines(matter: Matter, paths: ReadonlyMap<string, string>): Map<string, Map<number, string[]>> {
  const out = new Map<string, Map<number, string[]>>();
  const add = (doc: string, page: number | null, line: string | null | undefined) => {
    const docPath = paths.get(doc);
    if (!docPath || !line) return;
    const pages = out.get(docPath) ?? new Map<number, string[]>();
    const lines = pages.get(page ?? 1) ?? [];
    const sentence = /[.!?]$/.test(line) ? line : `${line}.`;
    if (!lines.includes(sentence)) lines.push(sentence);
    pages.set(page ?? 1, lines);
    out.set(docPath, pages);
  };
  for (const pleading of [matter.meta.operativePleading, matter.meta.priorCase?.operativePleading]) if (pleading) add(pleading.cite.doc, pleading.cite.page, pleading.title);
  for (const e of matter.events) for (const c of e.cites) add(c.doc, c.page, e.title);
  for (const m of matter.money) for (const c of m.cites) add(c.doc, c.page, m.label);
  for (const p of matter.people) for (const c of p.cites) add(c.doc, c.page, p.title ? `${p.name}, ${p.title}` : p.name);
  for (const o of matter.orgs) for (const c of o.cites) add(c.doc, c.page, o.name);
  for (const l of matter.links) for (const c of l.cites) add(c.doc, c.page, l.label);
  for (const v of matter.violations) {
    for (const c of v.cites) add(c.doc, c.page, v.title);
    for (const step of v.steps) for (const c of step.cites) add(c.doc, c.page, step.label);
    for (const figure of v.figures) for (const c of figure.cites) add(c.doc, c.page, figure.label);
  }
  for (const track of matter.tracks) for (const point of track.points) for (const p of point.proof) add(p.cite.doc, p.cite.page, p.note);
  for (const claim of matter.claims) {
    for (const c of claim.cites) add(c.doc, c.page, claim.label);
    for (const el of claim.elements) for (const p of el.proof) add(p.cite.doc, p.cite.page, p.note);
  }
  return out;
}

/** How many pages a document needs: its last cited page, at least `min`. */
export function pagesNeeded(cited: ReadonlyMap<number, string[]> | undefined, min = 2): number {
  return Math.max(min, ...(cited ? [...cited.keys()] : [1]));
}

const FILLER: Record<string, readonly string[]> = {
  deposition: [
    'Q. Please state your name for the record.', 'A. As stated in the caption.',
    'Q. Did you review any documents before today?', 'A. I looked at the binder counsel sent.',
    'Q. Who kept the notice log?', 'A. The corporate secretary, with input from the chair.',
    'Q. Were the notices sent to every director?', 'A. I believe so, by email.',
    'Q. Do you recall the date of that meeting?', 'A. Not without looking at my calendar.',
  ],
  email: [
    'Thanks for the call this morning.', 'Attached is the document we discussed.',
    'Please let me know if you have questions.', 'I will follow up once I hear from the board.',
    'Regards,', 'Sent from the fixture mail client.',
  ],
  statement: [
    'Opening balance 18,746.35', 'Wire in, reference SEAT-RENEWALS 3,127.40', 'Transfer out, reference NORTHGATE-INTEREST 9,137.80',
    'Service fee 17.25', 'Interest 0.84', 'Closing balance 12,719.54',
  ],
  order: [
    'THE COURT, having reviewed the motion and the response, and being fully advised,',
    'IT IS ORDERED that the motion is decided as stated below.', 'The parties shall confer in good faith.',
    'SO ORDERED.', 'BY THE COURT:', 'District Court Judge',
  ],
  general: [
    'This page is part of a dummy document generated for local development.',
    'The parties to this matter are fictional, and so is every fact on this page.',
    'Section 1. Definitions. Capitalized terms have the meanings given in the agreement.',
    'Section 2. Records. The corporate secretary keeps the board records at the company office.',
    'Section 3. Meetings. Directors meet on the days the notice sets.',
    'Section 4. Notices. Notices are given in writing to the addresses on file.',
  ],
};

function fillerKind(type: string | null): keyof typeof FILLER {
  const t = (type ?? '').toLowerCase();
  if (t.includes('deposition')) return 'deposition';
  if (t.includes('email') || t.includes('letter')) return 'email';
  if (t.includes('statement') || t.includes('wire') || t.includes('distribution')) return 'statement';
  if (t.includes('order')) return 'order';
  return 'general';
}

/** The paragraphs of each page of a dummy PDF. */
export function documentPages(docPath: string, cited: ReadonlyMap<number, string[]> | undefined, summary: string | null): string[][] {
  const { type, date } = parseFilename(docPath);
  const total = pagesNeeded(cited);
  const bank = FILLER[fillerKind(type)];
  const heading = [type ?? 'Document', date].filter(Boolean).join(', ');
  const pages: string[][] = [];
  for (let page = 1; page <= total; page += 1) {
    const lines = [CAPTION, heading, `Page ${page} of ${total}`, ''];
    if (page === 1 && summary) lines.push(summary, '');
    lines.push(...(cited?.get(page) ?? []));
    for (let i = 0; i < FILLER_LINES; i += 1) lines.push(bank[(page + i) % bank.length]);
    pages.push(lines);
  }
  return pages;
}

/** The root folder guide counsel sees (sync keeps each folder's CLAUDE.md; the index leaves it out). */
export const FOLDER_GUIDE = `# Doe v. Harbor Labs, Inc.: shared folder

A dummy matter for local development. Every name and fact is fictional.

- 00-Orientation: the document catalog, a matter summary and the defined terms
- 01-Corporate-Records: the stock agreement, the bylaws, the conversion schedule, the card policy and a sample Form D
- 02-Board-Minutes: the board packet, the meeting notice, minutes, Doe's objection and the notice log
- 03-Investor-Agreements: the investor rights and voting agreements, the bridge note, its amendment and the conversion notice
- 04-Letters: emails, letters and the repurchase notice
- 05-Expense-Records: the card statement, the expense review and a receipt photo
- 06-Cap-Table: cap tables, the share ledger, the vesting schedule, a wire, a bank statement and a transaction export
- 07-Lawyer-Notes-PRIVILEGED: privileged notes; the room marks these privileged
- 08-Court-Pleadings: complaint, amended complaint, motion, answer and order
- 09-Discovery: written discovery, a deposition and a subpoena
- 10-Lawyer-Analysis: work product (claim chart, damages model, vesting analysis)
- 11-Wage-Claim: the offer letter, the payroll register, the wage claim and the labor department's notice
`;

export const MATTER_SUMMARY = `# Matter summary

**Doe v. Harbor Labs, Inc.** is a fictional matter used to exercise the counsel room locally.

## Parties

- Jane Doe, plaintiff, co-founder and former CEO of Harbor Labs
- Harbor Labs, Inc., defendant, a Colorado-based kitchen scheduling software company
- Richard Roe, defendant, co-founder and CTO
- Mark Moe, defendant, the Alder Peak partner on the board
- Alder Peak Ventures, L.P., defendant, the seed investor

## Each side's account

- Doe says Moe and Roe removed her on two days' notice where the bylaws require ten, that the company bought back her unvested shares at cost despite the acceleration clause, and that a discounted bridge note took Alder Peak from about 20 percent to over 30.
- Harbor Labs and Alder Peak say Doe charged personal expenses to the company card and overstated the sales forecast she gave the board. Harbor Labs counterclaims for reimbursement.

## Where to start

1. The First Amended Complaint in 08-Court-Pleadings.
2. The stock agreement and the bylaws in 01-Corporate-Records.
3. The minutes and the notice log in 02-Board-Minutes.
`;

export const PRIVILEGED_NOTES = `# Call notes (privileged)

Dummy privileged notes for local development. The folder name marks every file in it as privileged.

- Confirm the production schedule with opposing counsel.
- Review the deposition transcript for how the May meeting was called.
`;

export const TRANSACTIONS_CSV = `date,description,amount,balance
2012-05-02,Wire in SEAT-RENEWALS,3127.40,21873.75
2012-05-31,Transfer out NORTHGATE-INTEREST,-9137.80,12735.95
2012-05-31,Service fee,-17.25,12718.70
2012-06-01,Interest,0.84,12719.54
`;

/** The defined terms page: the fixture matter's defined terms as a Markdown table. */
export function definedTermsPage(matter: Matter): string {
  const rows = matter.meta.definedTerms.map((t) => `| ${t.term} | ${t.means} |`).join('\n');
  return `# Defined terms\n\n| Term | Meaning |\n|---|---|\n${rows}\n`;
}

/** The memo in the privileged folder. */
export const PRIVILEGED_MEMO: string[][] = [
  [CAPTION, 'Memo, privileged and confidential', 'Page 1 of 1', '', 'Dummy case notes for local development.', 'Nothing on this page is real.'],
];
