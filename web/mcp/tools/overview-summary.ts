// SPDX-License-Identifier: Apache-2.0
// legallas_case_overview's summary (owner: session 2a): the case header, the counts per section and the defined
// terms, and the day it was read. The first page holds the header and as many terms as the profile allows (MAX_DEFINED_TERMS standard;
// compact, what fits in its 9,000 characters); a `nextCursor` then pages through the rest of the terms. Untrusted text
// is marked and noted as in the sections (mcp/untrusted.ts), with room left for the note.
import type { ServedCite, ServedMatter } from '../../worker/matter-types.ts';
import { compactChars } from '../format.ts';
import { COMPACT_PAGE_CHARS, COMPACT_PAGE_ENTRIES, fitPage, shrink, type Fit } from './overview-page.ts';
import { compactView } from './output.ts';
import { citeRenderer, prose, type Render } from './overview-text.ts';
import { markUntrusted, noteChars, noted, untrustedIn } from '../untrusted.ts';
import { priorStatus } from '../../worker/room-settings.ts';

/** Defined terms a standard summary page lists at most. */
export const MAX_DEFINED_TERMS = 50;
/** A placeholder as long as any cursor, so a compact page is sized with its cursor in it. */
const CURSOR_ROOM = 'x'.repeat(64);

function pleadingEntry(pleading: ServedMatter['meta']['operativePleading'], cite: Render) {
  return pleading ? { title: prose(pleading.title), cite: cite(pleading.cite) } : null;
}

/** The closed case, labeled so a reader never takes it for the case counsel is preparing. */
function priorCaseEntry(prior: NonNullable<ServedMatter['meta']['priorCase']>, cite: Render): Record<string, unknown> {
  return {
    status: priorStatus,
    note: 'History only. The matter has moved on to the tracks; this case and its pleading are not being pursued.',
    caption: prose(prior.caption),
    court: prior.court,
    caseNumber: prior.caseNumber,
    division: prior.division,
    judge: prior.judge,
    filed: prior.filed,
    operativePleading: pleadingEntry(prior.operativePleading, cite),
  };
}

/**
 * The first page: the header, the terms (filled in later), their total and the counts. Which section to call next is
 * the tool's description, and whose claims they are is priorCase's own status, so the page carries no sentence on it.
 */
function headPage(served: ServedMatter, cite: Render, counts: Record<string, number>, retrieved: string): Record<string, unknown> {
  const { meta } = served;
  return {
    retrieved,
    section: 'summary',
    caption: prose(meta.caption),
    court: meta.court,
    caseNumber: meta.caseNumber,
    division: meta.division,
    judge: meta.judge,
    filed: meta.filed,
    builtAt: meta.builtAt,
    operativePleading: pleadingEntry(meta.operativePleading, cite),
    priorCase: meta.priorCase ? priorCaseEntry(meta.priorCase, cite) : null,
    definedTerms: [],
    definedTermsTotal: meta.definedTerms.length,
    counts,
  };
}

/** Room for what the page gains once terms are on it, and for the note's escapes as sent. */
const TERMS_ROOM = 60;

/**
 * How many terms a page takes: standard as always; compact, what fits beside the rest of the page as sent, its view
 * included (format.ts compactChars), and `note` characters. Terms stay out of the view, so each costs its text alone.
 */
function termsFit(page: Record<string, unknown>, fit: Fit, note = 0): Fit {
  if (fit.profile === 'standard') return { ...fit, entries: MAX_DEFINED_TERMS, pageChars: Infinity, itemChars: Infinity };
  const full = { ...page, nextCursor: CURSOR_ROOM };
  const room = COMPACT_PAGE_CHARS - compactChars(full, compactView(full)) - note - TERMS_ROOM;
  return { ...fit, entries: COMPACT_PAGE_ENTRIES, pageChars: room, itemChars: room };
}

/**
 * The summary from term `start`: the whole first page at 0, else the next terms alone. `cursorAt` makes the cursor
 * for a term offset. The first page names a `nextCursor` only when terms remain; later pages always do (null at the end).
 */
export function summaryPage(
  served: ServedMatter, prefix: string | undefined, counts: Record<string, number>, start: number, fit: Fit, cursorAt: (offset: number) => string,
  retrieved: string,
): Record<string, unknown> {
  const cite = citeRenderer(prefix);
  const terms = markUntrusted(served.meta.definedTerms.map((t) => ({ term: t.term, means: prose(t.means), cite: t.cite ? cite(t.cite as ServedCite) : null })));
  let page: Record<string, unknown> = markUntrusted(start === 0
    ? headPage(served, cite, counts, retrieved)
    : { retrieved, section: 'summary', definedTermsTotal: terms.length, offset: start, definedTerms: [] });
  // Room for the note the header and every term would bring, so the noted page still fits.
  const note = noteChars(untrustedIn([page, terms]));
  // A header too long for a compact page (very long captions) is cut so the terms still fit, and flagged.
  if (fit.profile === 'compact' && termsFit(page, fit, note).pageChars < COMPACT_PAGE_CHARS / 4) page = { ...(shrink(page, 400, 20) as object), truncated: true };
  const { items, next } = fitPage(terms, { offset: start, part: 0 }, termsFit(page, fit, note), false);
  const nextCursor = next === null ? null : cursorAt(next.offset);
  return noted({ ...page, definedTerms: items, ...(start > 0 || nextCursor ? { nextCursor } : {}) });
}
