// SPDX-License-Identifier: Apache-2.0
// Card P2, Q3 polish (R59). The "In view" table under the Chronology chart: while the reader is zoomed in, every
// event the window shows, in date order, with its title as text (dense areas of the chart keep labels in the
// tooltip) and its sources. At the whole record, or in the Table view, it hides: the Table view already lists all.
import '../styles/chronology-inview.css';
import type { Cite } from '../../worker/matter-types.ts';
import { inViewLine } from './chronology-model.ts';
import type { Domain } from './viz/timeline.ts';

/** An event as the in-view strip shows it, with its id, date and title. */
export interface InViewEvent {
  id: string;
  date: string;
  title: string;
  cites: Cite[];
}

/** The page elements the in-view strip draws into. */
export interface InViewParts {
  root: HTMLElement;
  range: HTMLElement;
  rows: HTMLElement;
}

/** Options for the in-view strip: the selected event, and how to draw an event's citations. */
export interface InViewOptions {
  selectedId: string | null;
  renderCites: (cell: HTMLElement, event: InViewEvent) => void;
}

function row(event: InViewEvent, options: InViewOptions): HTMLTableRowElement {
  const tr = document.createElement('tr');
  if (options.selectedId === event.id) tr.setAttribute('aria-selected', 'true');
  const date = tr.insertCell();
  date.className = 'c-table__num';
  date.textContent = event.date;
  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'chron-inview__pick';
  pick.dataset.chronInviewPick = event.id;
  pick.textContent = event.title;
  tr.insertCell().append(pick);
  const cites = tr.insertCell();
  cites.className = 'chron-inview__cites';
  options.renderCites(cites, event);
  return tr;
}

/** Show the window's events, or hide the block when `show` is false (whole record, Table view, nothing in view). */
export function renderInView(parts: InViewParts, show: boolean, domain: Domain | null, events: readonly InViewEvent[], options: InViewOptions): void {
  parts.root.hidden = !show || !domain || events.length === 0;
  if (parts.root.hidden || !domain) {
    parts.rows.replaceChildren();
    return;
  }
  parts.range.textContent = inViewLine(domain, events.length);
  parts.rows.replaceChildren(...events.map((event) => row(event, options)));
}
