// SPDX-License-Identifier: Apache-2.0
// The second dev fixture (`npm run dev:seed -- --fixture company`): the same invented company as Doe v. Harbor Labs, Inc.,
// with no matter, for a room that is about the company. Its documents keep the case fixture's paths, so it adds no new
// names; the folders and files that belong to the dispute are left out, and each page is written without the caption.
import { FORM_D_FIXTURE_NAME, FORM_D_FIXTURE_XML } from '../src/scripts/formd.test-data.ts';
import type { FixtureFile } from './dev-fixture.ts';
import { pdfBytes } from './dev-pdf.ts';
import { parseFilename } from './matter/catalog.ts';

export const COMPANY_NAME = 'Harbor Labs, Inc.';

/** The company's documents: a subset of web/fixtures/doc-ids.json. */
export const COMPANY_DOCUMENTS: readonly string[] = [
  '01-Corporate-Records/Bylaws__20110609__Harbor-Labs.pdf',
  '01-Corporate-Records/Card-Policy__20110711__Harbor-Labs.pdf',
  '01-Corporate-Records/Conversion-Schedule__20110602__Harbor-Labs.pdf',
  '01-Corporate-Records/Stock-Agreement__20110607__Harbor-Labs.pdf',
  '03-Investor-Agreements/Investor-Rights-Agreement__20110621__Alder-Peak.pdf',
  '03-Investor-Agreements/Voting-Agreement__20110621__Alder-Peak.pdf',
  '06-Cap-Table/Cap-Table__20111231__Ledger-and-Co.pdf',
  '06-Cap-Table/Wire__20110613__Acme-Bank.pdf',
];

const PAGE_LINES = [
  'This page is part of a dummy document generated for local development.',
  'The company is fictional, and so is every fact on this page.',
  'Section 1. Definitions. Capitalized terms have the meanings given in the agreement.',
  'Section 2. Records. The corporate secretary keeps the company records at the company office.',
  'Section 3. Meetings. Directors meet on the days the notice sets.',
  'Section 4. Notices. Notices are given in writing to the addresses on file.',
];

/** The root folder guide (sync keeps each folder's CLAUDE.md; the index leaves it out). */
export const COMPANY_FOLDER_GUIDE = `# ${COMPANY_NAME}: company folder

A dummy company for local development. Every name and fact is fictional.

- 01-Corporate-Records: the bylaws, the stock agreement, the conversion schedule, the card policy and a sample Form D
- 03-Investor-Agreements: the investor rights and voting agreements
- 06-Cap-Table: a cap table and a wire
`;

/** The paragraphs of each page of a dummy company PDF. */
export function companyPages(docPath: string): string[][] {
  const { type, date } = parseFilename(docPath);
  const heading = [type ?? 'Document', date].filter(Boolean).join(', ');
  const total = 2;
  return Array.from({ length: total }, (_, index) => [COMPANY_NAME.toUpperCase(), heading, `Page ${index + 1} of ${total}`, '', ...PAGE_LINES]);
}

/** Every file of the company fixture, in path order. Pure and deterministic. */
export function companyFixtureFiles(): FixtureFile[] {
  const text = (rel: string, body: string): FixtureFile => ({ rel, bytes: Buffer.from(body, 'utf8') });
  const files: FixtureFile[] = [
    ...COMPANY_DOCUMENTS.map((rel) => ({ rel, bytes: pdfBytes(companyPages(rel)) })),
    text('CLAUDE.md', COMPANY_FOLDER_GUIDE),
    text(`01-Corporate-Records/${FORM_D_FIXTURE_NAME}`, FORM_D_FIXTURE_XML),
  ];
  return files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}
