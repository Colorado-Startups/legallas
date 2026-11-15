// SPDX-License-Identifier: Apache-2.0
// Card F5a (timeline viz). The hover and focus readout: the date leads (ISO, mono), then the title, kind, parties
// and source count. It enhances and never gates: the same facts are in each mark's aria-label and the table.
// Placed with CSS custom properties through CSSOM (CSP forbids style= attributes).
import { isoLabel } from './timeline-dates.ts';
import { TYPE_NAMES, type TimelineItem } from './timeline-model.ts';
import { clear, html, shapeIcon } from './timeline-svg.ts';

const OFFSET = 14;

/** The timeline tooltip's handle: show it at a point, hide it and destroy it. */
export interface Tooltip {
  show(item: TimelineItem, x: number, y: number): void;
  hide(): void;
  destroy(): void;
}

function fill(tip: HTMLElement, item: TimelineItem): void {
  clear(tip);
  const head = html('p', { class: 'tl-tip__date' }, tip);
  shapeIcon(item.mark, 12, head);
  html('span', {}, head, isoLabel(item.span.start, item.span.precision));
  html('p', { class: 'tl-tip__title' }, tip, item.event.title);
  const sources = item.event.cites.length;
  const meta = [TYPE_NAMES[item.event.type], `${sources} ${sources === 1 ? 'source' : 'sources'}`].join(' · ');
  if (item.actors.length) html('p', { class: 'tl-tip__actors' }, tip, item.actors.join(', '));
  html('p', { class: 'tl-tip__meta' }, tip, meta);
}

/** A tooltip inside `stage` (which must be position: relative). x and y are in the stage's own pixels. */
export function createTooltip(stage: HTMLElement): Tooltip {
  const tip = html('div', { class: 'tl-tip', 'aria-hidden': 'true', hidden: '' }, stage);
  return {
    show(item, x, y) {
      fill(tip, item);
      tip.hidden = false;
      const width = tip.offsetWidth;
      const height = tip.offsetHeight;
      const left = x + OFFSET + width > stage.clientWidth ? Math.max(0, x - OFFSET - width) : x + OFFSET;
      const top = y - height - OFFSET < 0 ? y + OFFSET : y - height - OFFSET;
      tip.style.setProperty('--tl-tip-x', `${Math.round(left)}px`);
      tip.style.setProperty('--tl-tip-y', `${Math.round(top)}px`);
    },
    hide() {
      tip.hidden = true;
    },
    destroy() {
      tip.remove();
    },
  };
}
