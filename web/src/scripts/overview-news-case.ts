// SPDX-License-Identifier: Apache-2.0
// Card P1a: the Overview's case header, filled from GET /api/matter: the new case's caption (the page's h1), the
// line naming the deliverables above it (caseHeading; the closed pleading's court line when there are no tracks),
// the defined terms behind a Glossary disclosure, each with its cite, and the campaign map (overview-map.ts).
import type { ServedMatter } from './matter-api.ts';
import { caseHeading, partyIndex } from './overview-case-model.ts';
import { renderMap } from './overview-map.ts';
import { citeChip, el } from './overview-news-dom.ts';
import { pageTitle } from './room-names.ts';

/** The room's stored name as a literal (worker/stored-name.ts): the minified key stays one, and a stored key can be read. */
declare const ROOM_STORED_NAME: string | undefined;

type ServedTerm = ServedMatter['meta']['definedTerms'][number];

function slot(root: ParentNode, name: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-ov-${name}]`);
}

/** Court, "Case No. CV-2013-00001", division, judge: whichever the matter has, in the caption's order. */
function courtLine(meta: ServedMatter['meta']): string[] {
  const caseNumber = meta.caseNumber?.trim() ? `Case No. ${meta.caseNumber.trim()}` : null;
  return [meta.court, caseNumber, meta.division, meta.judge].filter((part): part is string => Boolean(part && part.trim()));
}

/** A term's own pinpoint cite, or the pleading that defines it as a whole-file cite (R49): the prior case's, if any. */
function termCite(term: ServedTerm, matter: ServedMatter): HTMLAnchorElement | null {
  if (term.cite) return citeChip(term.cite);
  const pleading = (matter.meta.operativePleading ?? matter.meta.priorCase?.operativePleading)?.cite;
  return pleading ? citeChip({ ...pleading, page: null }) : null;
}

function termsList(matter: ServedMatter): HTMLElement[] {
  return matter.meta.definedTerms.map((term) => {
    const chip = termCite(term, matter);
    return el('div', 'ov-term', [
      el('dt', 'ov-term__name', [`“${term.term}”`]),
      el('dd', 'ov-term__means', [term.means, ...(chip ? [' ', chip] : [])]),
    ]);
  });
}

/** Fills the case header. The h1 keeps its static "Overview" text when there is no matter. */
export function renderCase(root: ParentNode, matter: ServedMatter): void {
  const court = slot(root, 'court');
  const caption = slot(root, 'caption');
  const glossary = slot(root, 'glossary');
  const terms = slot(root, 'terms');
  const map = slot(root, 'map');
  const heading = caseHeading(matter, courtLine(matter.meta));
  if (caption) caption.textContent = heading.caption;
  if (court) {
    court.replaceChildren(...heading.line.map((part) => el('span', 'ov-case__part', [part])));
    court.hidden = heading.line.length === 0;
  }
  const items = termsList(matter);
  if (glossary && terms && items.length) {
    terms.replaceChildren(...items);
    glossary.hidden = false;
  }
  if (map) renderMap(map, matter, partyIndex(matter));
  const doc = root.ownerDocument ?? document;
  doc.title = pageTitle(heading.caption);
}

/** One sentence in place of the header's details: no matter yet, or it failed to load. */
export function renderCaseMissing(root: ParentNode, sentence: string): void {
  const note = slot(root, 'case-note');
  if (!note) return;
  note.textContent = sentence;
  note.hidden = false;
}

/*
  Layout shift (R89): the header starts as a bare "Overview" and grows when the matter arrives, which moved the
  whole page down. While aria-busy, overview-news-reserve.css reserves a filled header's height (a default per width);
  this browser also remembers the last filled height per width band, so later visits reserve exactly that.
*/
const HEIGHT_KEY = `${typeof ROOM_STORED_NAME === 'string' ? ROOM_STORED_NAME : 'legallas'}:overview-case-height`;
const band = () => String(Math.round(window.innerWidth / 100) * 100);

function savedHeights(): Record<string, number> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(HEIGHT_KEY) ?? '{}');
    return value && typeof value === 'object' ? (value as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Reserves the header's last filled height at this width, if this browser has seen one. */
export function reserveCaseHeight(header: HTMLElement): void {
  const height = savedHeights()[band()];
  if (typeof height === 'number' && height > 0 && height < 2000) header.style.setProperty('--ov-case-reserve', `${height}px`);
}

/** Ends the reservation once the header is filled (or says why it is not), and remembers its height. */
export function releaseCaseHeight(header: HTMLElement): void {
  header.setAttribute('aria-busy', 'false');
  try {
    localStorage.setItem(HEIGHT_KEY, JSON.stringify({ ...savedHeights(), [band()]: Math.round(header.getBoundingClientRect().height) }));
  } catch {
    // Private windows and blocked storage: the default reservation still applies on the next visit.
  }
}
