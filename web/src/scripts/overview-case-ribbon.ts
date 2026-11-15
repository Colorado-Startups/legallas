// SPDX-License-Identifier: Apache-2.0
// The Overview's violations over time: each violation's period as a band on one year scale (its mark, title and
// dates in words, so the bands are their own legend and table), then card F5a's timeline in 'ribbon' mode with
// every event a violation names. Choosing an event opens it on the Chronology page. The timeline module loads
// only when the block nears the viewport (R20).
import type { ServedMatter } from './matter-api.ts';
import { block, el, emptyState, tableToggle, whenNear } from './overview-case-dom.ts';
import { eventsSummary } from './overview-case-model.ts';
import { buildLanes } from './viz/timeline-model.ts';
import { phaseBands, scaleYears, violationEventIds, yearScale, type PhaseBand, type YearScale } from './overview-map-model.ts';

/** The chronology link that opens one event. */
export function eventHref(id: string): string {
  return `/chronology/?event=${encodeURIComponent(id)}`;
}

/** "2011-03 to 2012-06", or "2012-01-01 onward" for a violation the record shows still running. */
function periodText(band: Pick<PhaseBand, 'from' | 'to'>): string {
  return band.to === null ? `${band.from} onward` : `${band.from} to ${band.to}`;
}

function axis(scale: YearScale): HTMLElement {
  const years = scaleYears(scale);
  const row = el('div', { class: 'ov-phases__axis', 'aria-hidden': 'true' }, ...years.map((year) => el('span', { class: 'ov-phases__year u-mono' }, String(year))));
  row.style.setProperty('--ov-years', String(years.length));
  return row;
}

function phaseRow(band: PhaseBand): HTMLElement {
  const fill = el('span', { class: 'ov-phase__band', 'data-mark': band.mark });
  fill.style.setProperty('--ov-from', `${(band.start * 100).toFixed(2)}%`);
  fill.style.setProperty('--ov-to', `${(band.end * 100).toFixed(2)}%`);
  return el('li', { class: 'ov-phase' },
    el('span', { class: 'c-mark', 'data-mark': band.mark }, band.mark),
    el('span', { class: 'ov-phase__title' }, band.title),
    el('span', { class: 'ov-phase__track', 'aria-hidden': 'true' }, fill),
    el('span', { class: 'ov-phase__dates u-mono' }, periodText(band)));
}

function phases(bands: PhaseBand[], scale: YearScale): HTMLElement {
  const list = el('ol', { class: 'ov-phases__list', 'aria-label': 'Violation periods' }, ...bands.map(phaseRow));
  const frame = el('div', { class: 'ov-phases' }, axis(scale), list);
  frame.style.setProperty('--ov-years', String(scale.last - scale.first + 1));
  return frame;
}

/** Builds the overview's case ribbon from the matter's violations and the events they cite. */
export function ribbonBlock(matter: ServedMatter | null, now = new Date()): HTMLElement {
  const violations = matter?.violations ?? [];
  const ids = violationEventIds(violations);
  const events = (matter?.events ?? []).filter((e) => ids.has(e.id));
  const scale = yearScale(violations, events.map((e) => e.date), now);
  const { section, body, tools } = block({
    key: 'ribbon',
    title: scale ? `${scale.first} to ${scale.last}` : 'Over time',
    count: matter && events.length ? eventsSummary(events) : '',
    open: { href: '/chronology/', label: 'Open Chronology' },
    wide: true,
  });
  if (!matter) {
    body.append(emptyState('The chronology has not been built yet.'));
    return section;
  }
  if (!scale) {
    body.append(emptyState('No violations are in the record yet.'));
    return section;
  }
  body.append(phases(phaseBands(violations, scale), scale));
  if (!events.length) {
    body.append(emptyState('The violations name no events yet.'));
    return section;
  }
  const data = { events, people: matter.people, orgs: matter.orgs };
  const host = el('div', { class: 'ov-ribbon' });
  // The host holds the drawn height before the timeline loads (CLS): one row per side lane, plus the axis; on a
  // phone the side legend above the lanes too, three sides to a line.
  const lanes = buildLanes(data, 'side').length;
  host.style.setProperty('--ov-ribbon-lanes', String(lanes));
  host.style.setProperty('--ov-ribbon-legend', String(Math.ceil(lanes / 3)));
  body.append(host);
  // Observed after the section is in the document, so the ribbon measures its real width on the first frame.
  queueMicrotask(() => whenNear(section, host, async () => {
    const { createTimeline } = await import('./viz/timeline.ts');
    const timeline = createTimeline(host, {
      data,
      mode: 'ribbon',
      label: 'Events in the violations',
      onSelect: (event) => window.location.assign(eventHref(event.id)),
    });
    tableToggle(tools, 'the events', (table) => timeline.setView(table ? 'table' : 'chart'));
  }));
  return section;
}
