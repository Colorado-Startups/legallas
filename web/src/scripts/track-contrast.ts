// SPDX-License-Identifier: Apache-2.0
// Track pages: the told vs filed pair at the top of a violation's story. Two cards side by side (stacked on a
// phone), each with its heading, the date in prose, who said it, the quote in serif and the cites that open the
// exhibit pane. The violation title above them states the conclusion; the pair shows the words it rests on.
import { formatPartialDate } from './matter-api.ts';
import { citeRow, el, partyChip } from './track-dom.ts';
import type { TrackMatter, TrackViolation } from './track-model.ts';

type Side = NonNullable<TrackViolation['contrast']>[number];

/** The level of each card's heading: h4 under a track page's story h3, h3 straight under a violation's h2. */
export type ContrastHeading = 'h3' | 'h4';

function speakerOf(matter: TrackMatter, id: string | null) {
  if (id === null) return null;
  return matter.people.find((p) => p.id === id) ?? matter.orgs.find((o) => o.id === id) ?? null;
}

function sideCard(side: Side, matter: TrackMatter, parent: Element, heading: ContrastHeading): void {
  const card = el('article', { class: 'track-contrast__side' }, parent);
  const head = el('header', { class: 'track-contrast__head' }, card);
  el(heading, { class: 'track-contrast__heading' }, head, side.heading);
  el('p', { class: 'track-contrast__date' }, head, formatPartialDate(side.date));
  const speaker = speakerOf(matter, side.speaker);
  if (speaker) partyChip(speaker.name, speaker.side, el('p', { class: 'track-contrast__speaker' }, card));
  el('blockquote', { class: 'track-contrast__quote' }, card, side.quote);
  citeRow(side.cites, card, `Sources for ${side.heading}`);
}

/** The pair, when the violation has one; nothing otherwise. `heading` sets the cards' heading level (h4). */
export function renderContrast(parent: Element, v: TrackViolation, matter: TrackMatter, heading: ContrastHeading = 'h4'): void {
  if (!v.contrast) return;
  const pair = el('div', { class: 'track-contrast', role: 'group', 'aria-label': `${v.contrast[0].heading} against ${v.contrast[1].heading}` }, parent);
  for (const side of v.contrast) sideCard(side, matter, pair, heading);
}
