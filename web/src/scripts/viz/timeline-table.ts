// SPDX-License-Identifier: Apache-2.0
// Card F5a (timeline viz). The table twin of the timeline: every event the chart shows, in date order, with the
// same facts. It is the accessible equivalent and the print form. Built from the c-table component (DESIGN.md).
// Rows come in one tbody per year, headed by the year; on phones the header shows and each row stacks (R59). An
// event in several violation lanes is one row whose Lane cell names each lane.
import './timeline-table.css';
import type { MatterEvent } from '../../../worker/matter-types.ts';
import { isoLabel } from './timeline-dates.ts';
import { laneName, SIDE_LABELS, TYPE_NAMES, uniqueItems, type Lane, type TimelineItem } from './timeline-model.ts';
import { clear, html, shapeIcon } from './timeline-svg.ts';

/** Options for the timeline table: its accessible label and a callback for a chosen event. */
export interface TableOptions {
  /** Accessible caption, for example "Chronology". */
  label: string;
  onSelect?: (event: MatterEvent) => void;
  /** Fill the Sources cell (a page puts cite chips here). Without it the cell shows the count. */
  renderCites?: (cell: HTMLElement, event: MatterEvent) => void;
  selectedId: string | null;
}

const COLUMNS = ['Date', 'Event', 'Type', 'Parties', 'Lane', 'Sources'];

function row(body: HTMLElement, item: TimelineItem, lanes: string[], options: TableOptions): void {
  const tr = html('tr', {
    'data-event-id': item.id,
    'aria-selected': options.selectedId === item.event.id ? 'true' : null,
  }, body);
  html('td', { class: 'c-table__num tl-table__date' }, tr, isoLabel(item.span.start, item.span.precision));
  const title = html('span', { class: 'tl-table__title' }, html('td', { class: 'tl-table__event' }, tr));
  shapeIcon(item.mark, 12, title);
  html('span', { class: 'u-vh' }, title, `${SIDE_LABELS[item.mark]}: `);
  if (options.onSelect) {
    html('button', { type: 'button', class: 'tl-table__open', 'data-event-id': item.id }, title, item.event.title);
  } else {
    html('span', {}, title, item.event.title);
  }
  html('td', { class: 'tl-table__type' }, tr, TYPE_NAMES[item.event.type]);
  html('td', { class: 'tl-table__parties' }, tr, item.actors.join(', '));
  html('td', { class: 'tl-table__lane' }, tr, lanes.join('; '));
  const cites = html('td', { class: 'tl-table__cites' }, tr);
  if (options.renderCites) options.renderCites(cites, item.event);
  else cites.textContent = String(item.event.cites.length);
}

/** Render (or re-render) the table into `host`. Returns the click handler's teardown. */
export function renderTable(host: HTMLElement, all: TimelineItem[], lanes: Lane[], options: TableOptions): () => void {
  clear(host);
  const items = uniqueItems(all);
  const laneNames = new Map(lanes.map((lane) => [lane.key, laneName(lane)]));
  const lanesOf = new Map<string, string[]>();
  for (const item of all) {
    const name = laneNames.get(item.lane);
    if (name) lanesOf.set(item.event.id, [...(lanesOf.get(item.event.id) ?? []), name]);
  }
  const wrap = html('div', { class: 'c-table-wrap' }, host);
  const table = html('table', { class: 'c-table tl-table' }, wrap);
  html('caption', { class: 'u-vh' }, table, `${options.label}, ${items.length} ${items.length === 1 ? 'event' : 'events'}`);
  const headRow = html('tr', {}, html('thead', {}, table));
  for (const name of COLUMNS) html('th', { scope: 'col' }, headRow, name);
  let body: HTMLElement | null = null;
  let year = '';
  for (const item of items) {
    const itemYear = isoLabel(item.span.start, 'year');
    if (!body || itemYear !== year) {
      year = itemYear;
      body = html('tbody', {}, table);
      html('th', { scope: 'rowgroup', colspan: COLUMNS.length }, html('tr', { class: 'tl-table__year' }, body), year);
    }
    row(body, item, lanesOf.get(item.event.id) ?? [], options);
  }
  if (items.length === 0) {
    const empty = html('td', { colspan: COLUMNS.length, class: 'tl-table__empty' }, html('tr', {}, html('tbody', {}, table)));
    empty.textContent = 'No events match these filters.';
  }
  const byId = new Map(items.map((item) => [item.id, item.event]));
  const onClick = (event: MouseEvent) => {
    const button = (event.target as Element | null)?.closest<HTMLElement>('button[data-event-id]');
    const picked = button?.dataset.eventId ? byId.get(button.dataset.eventId) : undefined;
    if (picked) options.onSelect?.(picked);
  };
  host.addEventListener('click', onClick);
  return () => host.removeEventListener('click', onClick);
}
