// SPDX-License-Identifier: Apache-2.0
// Card P2 (Chronology page). The selected-event panel and the cite chips: title, date, kind, the people with
// their side shapes, the violations the event belongs to (letter mark and title), then any prior counts, the
// sources as "DOE-000412 at 3" chips, Previous and Next, and Ask about this event. Cite chips open the exhibit pane (F7) beside the page. Everything goes in through textContent and attributes (CSP: no style= attributes, no innerHTML of data).
import type { RoomEvent, ServedCite, ServedMatter } from './matter-api.ts';
import type { Cite } from '../../worker/matter-types.ts';
import { formatCite } from './matter-api.ts';
import { askHref, countLabel, positionOf, violationsOf, type Position } from './chronology-model.ts';
import { TYPE_NAMES } from './viz/timeline-model.ts';
import { clear, html, shapeIcon } from './viz/timeline-svg.ts';

function citeHref(docId: string, page: number | null): string {
  const base = `/doc/?id=${encodeURIComponent(docId)}`;
  return page === null ? base : `${base}#page=${page}`;
}

/**
 * One cite chip. The note (R33) is its title; a cite whose document has no number yet reads "Unnumbered".
 * data-exhibit hands a plain click to the exhibit pane (F7, initExhibitLinks); a modified click opens /doc/.
 */
export function citeChip(prefix: string, cite: ServedCite, parent: Element): HTMLAnchorElement {
  const text = formatCite(prefix, cite) || (cite.page === null ? 'Unnumbered' : `Unnumbered at ${cite.page}`);
  const chip = html('a', {
    class: 'c-cite',
    href: citeHref(cite.doc, cite.page),
    'data-exhibit': '',
    title: cite.note ?? null,
  }, parent, text);
  return chip;
}

/** The panel's fixed parts (in the page) and what it needs to fill them. */
export interface PanelParts {
  root: HTMLElement;
  position: HTMLElement;
  date: HTMLElement;
  kind: HTMLElement;
  title: HTMLElement;
  summary: HTMLElement;
  people: HTMLElement;
  violations: HTMLElement;
  counts: HTMLElement;
  sources: HTMLElement;
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
  ask: HTMLAnchorElement;
  empty: HTMLElement;
  body: HTMLElement;
}

function section(list: HTMLElement, shown: boolean): void {
  const holder = list.closest<HTMLElement>('[data-chron-section]');
  if (holder) holder.hidden = !shown;
}

function fillPeople(parts: PanelParts, matter: ServedMatter, event: RoomEvent): void {
  clear(parts.people);
  const byId = new Map([...matter.people, ...matter.orgs].map((party) => [party.id, party]));
  for (const id of event.actors) {
    const party = byId.get(id);
    if (!party) continue;
    const chip = html('span', { class: 'c-chip' }, html('li', {}, parts.people));
    shapeIcon(party.side, 12, chip);
    html('span', {}, chip, party.name);
  }
  section(parts.people, parts.people.childElementCount > 0);
}

/** The violations covering the event, from each violation's events list, in letter order. */
function fillViolations(parts: PanelParts, matter: ServedMatter, event: RoomEvent): void {
  clear(parts.violations);
  const violations = violationsOf(matter, event.id);
  for (const violation of violations) {
    const chip = html('span', { class: 'chron-vtag' }, html('li', {}, parts.violations));
    html('span', { class: 'c-mark', 'data-mark': violation.mark }, chip, violation.mark);
    html('span', {}, chip, violation.title);
  }
  section(parts.violations, violations.length > 0);
}

function fillCounts(parts: PanelParts, matter: ServedMatter, event: RoomEvent): void {
  clear(parts.counts);
  const byId = new Map(matter.claims.map((claim) => [claim.id, claim]));
  const claims = event.claims.flatMap((id) => byId.get(id) ?? []).sort((a, b) => a.count - b.count);
  for (const claim of claims) html('span', { class: 'c-chip' }, html('li', {}, parts.counts), countLabel(claim));
  section(parts.counts, claims.length > 0);
}

function fillSources(parts: PanelParts, matter: ServedMatter, event: RoomEvent, prefix: string): void {
  clear(parts.sources);
  for (const cite of event.cites) {
    const li = html('li', { class: 'chron-source' }, parts.sources);
    citeChip(prefix, cite, li);
    const facts = matter.docs[cite.doc];
    const what = facts?.type ?? facts?.summary ?? '';
    if (what) html('span', { class: 'chron-source__what' }, li, what);
  }
  section(parts.sources, event.cites.length > 0);
}

/** Show `event` in the panel (or the resting sentence when null). */
export function renderPanel(
  parts: PanelParts,
  matter: ServedMatter,
  event: RoomEvent | null,
  ordered: readonly RoomEvent[],
  all: readonly RoomEvent[],
  prefix: string,
): Position | null {
  parts.body.hidden = !event;
  parts.empty.hidden = !!event;
  parts.position.hidden = !event;
  if (!event) return null;
  const position = positionOf(ordered, event.id, all);
  parts.position.textContent = position.index ? `${position.index} of ${position.total}` : 'Outside the filters';
  parts.date.textContent = event.date;
  parts.kind.textContent = TYPE_NAMES[event.type];
  parts.title.textContent = event.title;
  parts.summary.textContent = event.summary ?? '';
  parts.summary.hidden = !event.summary;
  fillPeople(parts, matter, event);
  fillViolations(parts, matter, event);
  fillCounts(parts, matter, event);
  fillSources(parts, matter, event, prefix);
  parts.previous.disabled = !position.previous;
  parts.next.disabled = !position.next;
  parts.ask.href = askHref(event);
  return position;
}

/** Table rows' Sources cell: the same chips as the panel. The timeline passes back the served events it was given. */
export function tableCites(prefix: string): (cell: HTMLElement, event: { cites: Cite[] }) => void {
  return (cell, event) => {
    for (const cite of event.cites as ServedCite[]) citeChip(prefix, cite, cell);
  };
}

