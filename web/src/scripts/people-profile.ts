// SPDX-License-Identifier: Apache-2.0
// Card P3 (People). The profile drawer for one party: name with its side mark and title, then the unit card (its
// shape, role, side and three counts from the manifest), the violations and prior counts it is named in, its
// organizations and source, then connections, events and documents, each with its cite chips. Text only (names
// and titles are matter data, never markup). people.ts owns the open and close behavior.
import { formatCite, type RoomEvent, type ServedCite } from './matter-api.ts';
import { countsPhrase, SIDE_LABELS, type Connection, type DocEntry, type Party, type Profile } from './people-model.ts';
import { MARK_LABEL } from './mark-words.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The canonical side shapes (web/DESIGN.md section 3), on a 16 by 16 viewBox. */
const SHAPES: Record<Party['side'], [string, Record<string, string>]> = {
  client: ['circle', { cx: '8', cy: '8', r: '6' }],
  defendant: ['path', { d: 'M8 1.5 14.5 8 8 14.5 1.5 8Z' }],
  nominal: ['path', { d: 'M8 1.5 13.6 4.75v6.5L8 14.5 2.4 11.25v-6.5Z' }],
  court: ['rect', { x: '2.5', y: '2.5', width: '11', height: '11' }],
  third: ['path', { d: 'M8 2 14.5 13.5h-13Z' }],
};

type Attrs = Record<string, string | undefined>;

/** Creates an element with attributes and optional text, appended to a parent when one is given. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Attrs = {}, parent?: Element, text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) if (value !== undefined) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  parent?.append(node);
  return node;
}

/** A decorative side mark, `size` px. The words beside it carry the meaning. */
export function shapeMark(side: Party['side'], parent?: Element, size = 12): SVGSVGElement {
  const box = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ class: 'c-shape', 'data-side': side, viewBox: '0 0 16 16', width: String(size), height: String(size), 'aria-hidden': 'true', focusable: 'false' })) box.setAttribute(k, v);
  const [tag, attrs] = SHAPES[side];
  const shape = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, v);
  box.append(shape);
  parent?.append(box);
  return box;
}

/** A cite chip, "DOE-000412 at 3", linking to the page. A plain click opens the exhibit pane (initExhibitLinks). */
export function citeChip(prefix: string, cite: Pick<ServedCite, 'doc' | 'page' | 'control' | 'note'>, parent?: Element): HTMLAnchorElement {
  const page = cite.page ?? 1;
  const text = formatCite(prefix, cite) || (cite.page === null ? 'Document' : `Document at ${cite.page}`);
  const a = el('a', {
    class: 'c-cite', href: `/doc/?id=${encodeURIComponent(cite.doc)}#page=${page}`,
    'data-exhibit': '', title: cite.note || undefined,
  }, parent, text);
  return a;
}

function cites(prefix: string, list: ServedCite[], parent: Element): void {
  if (list.length === 0) return;
  const row = el('span', { class: 'people-cites' }, parent);
  for (const c of list) citeChip(prefix, c, row);
}

function section(parent: Element, label: string): HTMLElement {
  const s = el('section', { class: 'people-profile__section' }, parent);
  el('h3', { class: 't-label people-profile__label' }, s, label);
  return s;
}

/** A name that selects its party when pressed. */
function partyButton(party: Party, parent: Element): HTMLButtonElement {
  const b = el('button', { type: 'button', class: 'people-link', 'data-people-select': party.id }, parent);
  shapeMark(party.side, b);
  el('span', {}, b, party.name);
  return b;
}

function head(profile: Profile, parent: HTMLElement): void {
  const { party } = profile;
  const top = el('div', { class: 'people-profile__top' }, parent);
  el('p', { class: 't-label people-profile__label' }, top, 'Profile');
  el('button', { type: 'button', class: 'c-button people-profile__close', 'data-people-close': '', 'aria-label': 'Close profile' }, top, '×');
  const name = el('h2', { class: 't-h3 people-profile__name', id: 'people-profile-name', tabindex: '-1' }, parent);
  shapeMark(party.side, name, 20);
  el('span', {}, name, party.name);
  if (party.title) el('p', { class: 'people-profile__title' }, parent, party.title);
  unitCard(profile, parent);
}

/** An entity's glyph: the hex tile of the structure picture with its side's shape inside. */
function hexGlyph(side: Party['side'], parent: Element): void {
  const box = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ class: 'people-unit__hex', viewBox: '0 0 28 28', width: '28', height: '28', 'aria-hidden': 'true', focusable: 'false' })) box.setAttribute(k, v);
  const hex = document.createElementNS(SVG_NS, 'path');
  hex.setAttribute('d', 'M14 1.5 24.8 7.75v12.5L14 26.5 3.2 20.25V7.75Z');
  box.append(hex);
  const mark = shapeMark(side, undefined, 12);
  for (const [k, v] of Object.entries({ x: '8', y: '8' })) mark.setAttribute(k, v);
  box.append(mark);
  parent.append(box);
}

/** The dossier card (DESIGN.md section 7): shape, role and side, then entities controlled, violations, documents. */
function unitCard(profile: Profile, parent: HTMLElement): void {
  const { party, unit } = profile;
  const card = el('div', { class: 'c-dossier people-unit' }, parent);
  const head = el('div', { class: 'c-dossier__head' }, card);
  if (party.kind === 'org') hexGlyph(party.side, head); else shapeMark(party.side, head, 20);
  const role = el('p', { class: 'c-dossier__role' }, head);
  const side = SIDE_LABELS[party.side];
  // "Defendants" already says "Defendant": the role is not repeated beside its own side.
  if (!side.toLowerCase().startsWith(party.role.toLowerCase())) el('span', {}, role, `${party.role}, `);
  el('span', { class: 'people-unit__side', 'data-side': party.side }, role, side);
  const dl = el('dl', { class: 'c-dossier__counts' }, card);
  const count = (n: number, label: string) => {
    const cell = el('div', { class: 'c-dossier__count' }, dl);
    el('dt', { class: 'c-dossier__label' }, cell, label);
    el('dd', { class: 'c-dossier__value' }, cell, String(n));
  };
  count(unit.controlled, 'Entities controlled');
  count(unit.violations, unit.violations === 1 ? 'Violation involved' : 'Violations involved');
  count(unit.documents, 'Documents cited');
}

/** "Named in": the violations first, each with its mark, then the prior case's counts. */
function namedIn(profile: Profile, dd: HTMLElement): void {
  const list = el('ul', { class: 'people-named' }, dd);
  for (const v of profile.violations) {
    const li = el('li', { class: 'people-named__item' }, list);
    const a = el('a', { class: 'people-named__link', href: `/chronology/?v=${encodeURIComponent(v.id)}` }, li);
    el('span', { class: 'c-mark', 'data-mark': v.mark, 'aria-hidden': 'true' }, a, v.mark);
    el('span', { class: 'u-vh' }, a, `Violation ${v.mark}: `);
    el('span', {}, a, v.title);
  }
  if (profile.counts.length) {
    const li = el('li', { class: 'people-named__item people-named__item--prior' }, list);
    el('span', { class: 't-label people-named__prior' }, li, 'Prior case');
    el('span', {}, li, countsPhrase(profile.counts));
  }
}

function facts(profile: Profile, prefix: string, parent: HTMLElement): void {
  const dl = el('dl', { class: 'people-profile__facts' }, parent);
  const row = (term: string) => { el('dt', {}, dl, term); return el('dd', {}, dl); };
  if (profile.violations.length || profile.counts.length) namedIn(profile, row('Named in'));
  if (profile.orgs.length) {
    const dd = row(profile.party.kind === 'org' ? 'Part of' : 'Organizations');
    for (const org of profile.orgs) partyButton(org, dd);
  }
  if (profile.party.cites.length) cites(prefix, profile.party.cites, row('Source'));
}

function connections(list: Connection[], prefix: string, parent: HTMLElement): void {
  if (list.length === 0) return;
  const ul = el('ul', { class: 'people-profile__list' }, section(parent, 'Connections'));
  for (const c of list) {
    // Read as a sentence with this party as the unspoken subject or object: "manages Harbor Labs, Inc.",
    // "Mark Moe emailed". The title carries the whole sentence.
    const li = el('li', { class: 'people-tie', title: c.sentence, 'data-direction': c.direction }, ul);
    const line = el('span', { class: 'people-tie__line' }, li);
    el('span', { class: 'u-vh' }, line, `${c.sentence}.`);
    const label = () => el('span', { class: 'people-tie__label', 'aria-hidden': 'true' }, line, c.label);
    if (c.direction === 'out') label();
    partyButton(c.other, line);
    if (c.direction === 'in') label();
    cites(prefix, c.cites, line);
  }
}

function events(list: RoomEvent[], prefix: string, partyId: string, parent: HTMLElement): void {
  if (list.length === 0) return;
  const s = section(parent, 'Events');
  el('a', { class: 'people-profile__more', href: `/chronology/?p=${encodeURIComponent(partyId)}` }, s, 'Open in chronology');
  const ul = el('ul', { class: 'people-profile__list' }, s);
  for (const e of list) {
    const li = el('li', { class: 'people-row' }, ul);
    el('span', { class: 't-mono people-row__date' }, li, e.date);
    const body = el('span', { class: 'people-row__body' }, li);
    el('span', { class: 'people-row__title' }, body, e.title);
    cites(prefix, e.cites, body);
  }
}

const ROLE_WORDS: Record<DocEntry['role'], string> = { from: 'From them', to: 'To them', both: 'From and to them' };

function documents(list: DocEntry[], prefix: string, parent: HTMLElement): void {
  if (list.length === 0) return;
  const ul = el('ul', { class: 'people-profile__list' }, section(parent, 'Documents'));
  for (const d of list) {
    const li = el('li', { class: 'people-row' }, ul);
    el('span', { class: 't-mono people-row__date' }, li, d.date ?? '');
    const body = el('span', { class: 'people-row__body' }, li);
    const line = [d.type, ROLE_WORDS[d.role]].filter(Boolean).join(', ');
    el('span', { class: 'people-row__title' }, body, line);
    if (d.summary) el('span', { class: 'people-row__note' }, body, d.summary);
    const row = el('span', { class: 'people-cites' }, body);
    citeChip(prefix, { doc: d.id, page: 1, control: d.control }, row);
    if (d.privileged) el('span', { class: 'c-chip c-chip--privileged' }, row, MARK_LABEL);
  }
}

/** Fills `host` with the profile. Returns the heading, for focus. */
export function renderProfile(host: HTMLElement, profile: Profile, prefix: string): HTMLElement {
  host.replaceChildren();
  head(profile, host);
  facts(profile, prefix, host);
  connections(profile.connections, prefix, host);
  events(profile.events, prefix, profile.party.id, host);
  documents(profile.documents, prefix, host);
  const ask = el('a', { class: 'c-button people-profile__ask', href: `/ask/?q=${encodeURIComponent(`What does the record show about ${profile.party.name}?`)}` }, host);
  ask.textContent = `Ask about ${profile.party.name}`;
  return host.querySelector('#people-profile-name') as HTMLElement; // safe: head() always writes it
}
