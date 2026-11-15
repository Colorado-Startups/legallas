// SPDX-License-Identifier: Apache-2.0
// The Complaint guide and Filing guide (track pages), the DOM half: the model from track-guide-model.ts drawn in
// complaint order, seven numbered parts, every line with its cite chips (they open the exhibit pane). Loaded lazily
// by track.ts, and printed whole by "Print guide". Text only: matter strings never reach innerHTML; no style=.
import { formatPartialDate } from './matter-api.ts';
import { PROOF_WORDS } from './proof-list-model.ts';
import { citeChip, citeRow, el, markBadge, slug } from './track-dom.ts';
import {
  againstLabel, guideHeadings, partySentence, trackGuide, uniqueCites, type GuideFact, type GuideParty, type GuidePoint, type TrackGuide,
} from './track-guide-model.ts';
import type { Track, TrackMatter } from './track-model.ts';

/** One numbered part: a kicker ("2. Parties") over a heading that states what the part shows. */
function part(parent: Element, n: number, kicker: string, heading: string): HTMLElement {
  const id = `track-guide-${n}`;
  const section = el('section', { class: 'track-guide__part', 'aria-labelledby': id }, parent);
  const h = el('h3', { class: 't-h3 track-guide__title', id }, section);
  el('span', { class: 'track-guide__kicker t-label' }, h, `${n}. ${kicker}`);
  el('span', { class: 'track-guide__heading' }, h, heading);
  return section;
}

/** A sentence ends in a period, unless it already ends in punctuation. */
function sentence(text: string): string {
  return /[.?!:;)"]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
}

/** Each party as a sentence: the name in bold, the role, what the party holds or runs, then every cite behind it. */
function partyList(parent: Element, label: string, parties: readonly GuideParty[]): void {
  if (parties.length === 0) return;
  el('h4', { class: 'track-guide__label t-label' }, parent, label);
  const list = el('ul', { class: 'track-guide__list' }, parent);
  for (const party of parties) {
    const item = el('li', { class: 'track-guide__party' }, list);
    const line = el('p', { class: 'track-guide__sentence' }, item);
    const { lead, text } = partySentence(party);
    el('strong', { class: 'track-guide__name' }, line, lead);
    line.append(text);
    citeRow(uniqueCites(party.cites, ...party.controls.map((control) => control.cites)), line, `Sources for ${party.name}`);
  }
}

function factItem(list: Element, fact: GuideFact): void {
  const item = el('li', { class: 'track-guide__fact', value: String(fact.n) }, list);
  const marks = el('span', { class: 'track-guide__marks' }, item);
  for (const mark of fact.marks) markBadge(mark, marks);
  el('span', { class: 'u-vh' }, marks, `Violation ${fact.marks.join(', ')}. `);
  const body = el('p', { class: 'track-guide__line' }, item);
  const when = formatPartialDate(fact.date);
  if (when) el('span', { class: 'track-guide__when' }, body, `${when}. `);
  body.append(sentence(fact.text));
  citeRow(fact.cites, body, `Sources for fact ${fact.n}`);
  if (fact.detail) el('p', { class: 'track-guide__detail t-small' }, item, fact.detail);
}

function pointsPart(parent: Element, points: readonly GuidePoint[]): void {
  const groups = new Map<string, GuidePoint[]>();
  for (const point of points) groups.set(point.violation, [...(groups.get(point.violation) ?? []), point]);
  for (const [violation, group] of groups) {
    const head = el('p', { class: 'track-guide__group' }, parent);
    markBadge(group[0].mark, head);
    // The track page links each group to its checklist; the brief's printed outline has none to link to.
    const anchor = `track-v-${slug(violation)}`;
    if (document.getElementById(anchor)) el('a', { href: `#${anchor}` }, head, `Checklist for ${group[0].mark}, with the proof cites`);
    else el('span', {}, head, `Violation ${group[0].mark}`);
    const list = el('ul', { class: 'track-guide__list' }, parent);
    for (const point of group) {
      const item = el('li', { class: 'track-guide__point', 'data-strength': point.strength }, list);
      el('span', { class: 'track-guide__strength t-small' }, item, PROOF_WORDS[point.strength]);
      const body = el('span', { class: 'track-guide__point-text' }, item, point.text);
      if (point.authority) el('span', { class: 'track-guide__authority t-small' }, body, point.authority);
    }
  }
}

function exhibitsPart(parent: Element, guide: TrackGuide): void {
  const list = el('ul', { class: 'track-guide__list track-guide__exhibits' }, parent);
  for (const exhibit of guide.exhibits) {
    const item = el('li', { class: 'track-guide__exhibit' }, list);
    citeChip(exhibit.cite, el('span', { class: 'track-guide__control' }, item), exhibit.summary || null);
    el('span', { class: 'track-guide__date t-mono' }, item, exhibit.date);
    const what = el('span', { class: 'track-guide__what' }, item);
    if (exhibit.type) el('span', { class: 'track-guide__type' }, what, exhibit.type);
    if (exhibit.summary) el('span', { class: 'track-guide__summary' }, what, exhibit.summary);
    if (exhibit.pages.length > 0) el('span', { class: 'track-guide__pages t-small' }, what, `Cited at ${exhibit.pages.join(', ')}`);
  }
}

/** Draws the whole guide for `track` into `body`. */
export function renderTrackGuide(body: HTMLElement, track: Track, matter: TrackMatter): void {
  const guide = trackGuide(track, matter);
  const headings = guideHeadings(guide);
  body.replaceChildren();
  el('p', { class: 'track-guide__intro t-small' }, body, 'From the record, in the order a draft takes. Every line carries its cite.');

  const caption = part(body, 1, 'Caption', guide.caption);
  el('p', { class: 'track-guide__forum' }, caption, guide.forum);

  const parties = part(body, 2, 'Parties', headings.parties);
  partyList(parties, againstLabel(guide.kind), guide.against);
  partyList(parties, 'Client side', guide.clientSide);

  const entities = part(body, 3, 'The entities', headings.entities);
  const entityList = el('ul', { class: 'track-guide__list' }, entities);
  for (const entity of guide.entities) {
    const item = el('li', { class: 'track-guide__entity' }, entityList);
    const line = el('p', { class: 'track-guide__line' }, item);
    el('span', { class: 'track-guide__name' }, line, entity.name);
    citeRow(entity.cites, line, `Sources for ${entity.name}`);
    const meta = el('p', { class: 'track-guide__detail t-small' }, item);
    if (entity.formed) {
      meta.append('Formed ');
      el('span', { class: 't-mono' }, meta, entity.formed);
    } else {
      meta.append('Formation date not in the record');
    }
    if (entity.parent) meta.append(`; under ${entity.parent.name}`);
  }

  const facts = part(body, 4, 'Facts', headings.facts);
  const factList = el('ol', { class: 'track-guide__facts' }, facts);
  for (const fact of guide.facts) factItem(factList, fact);

  pointsPart(part(body, 5, 'Points to prove', headings.points), guide.points);
  exhibitsPart(part(body, 6, 'Key exhibits', headings.exhibits), guide);

  const gaps = part(body, 7, 'What the record still lacks', headings.gaps);
  if (guide.gaps.length > 0) {
    const list = el('ul', { class: 'track-guide__list' }, gaps);
    for (const gap of guide.gaps) {
      const item = el('li', { class: 'track-guide__gap' }, list);
      const line = el('p', { class: 'track-guide__line' }, item);
      markBadge(gap.mark, line);
      line.append(gap.text);
      if (gap.note) el('p', { class: 'track-guide__detail t-small' }, item, gap.note);
    }
  }
}
