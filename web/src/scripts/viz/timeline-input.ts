// SPDX-License-Identifier: Apache-2.0
// Card F5a (timeline viz). Pointer, keyboard and focus on the plot's events, delegated from the SVG root. Events
// use a roving tabindex: one is in the tab order; arrows, Home and End move among them (timeline-nav.ts).
import type { MarkBox } from './timeline-layout.ts';
import type { TimelineItem } from './timeline-model.ts';
import { moveFocus, NAV_KEYS, type NavKey, type NavPoint } from './timeline-nav.ts';
import type { Tooltip } from './timeline-tooltip.ts';

/** What the input layer needs from the timeline. */
export interface InputHost {
  readonly tooltip: Tooltip;
  mark(id: string): MarkBox | undefined;
  navPoints(): NavPoint[];
  focusedId(): string | null;
  setFocused(id: string): void;
  focusEvent(id: string): void;
  choose(id: string): void;
  zoomIn(): void;
  zoomOut(): void;
}

function eventOf(target: EventTarget | null): SVGGElement | null {
  return (target as Element | null)?.closest<SVGGElement>('.tl-event') ?? null;
}

function showFor(host: InputHost, mark: MarkBox | undefined): void {
  if (mark) host.tooltip.show(mark.item as TimelineItem, mark.cx, mark.cy - mark.size / 2);
  else host.tooltip.hide();
}

function onKeyDown(host: InputHost, event: KeyboardEvent): void {
  const id = eventOf(event.target)?.dataset.eventId;
  if (!id) return;
  if (NAV_KEYS.has(event.key)) {
    const next = moveFocus(host.navPoints(), id, event.key as NavKey);
    if (next) host.focusEvent(next);
  } else if (event.key === '+' || event.key === '=') {
    host.zoomIn();
  } else if (event.key === '-' || event.key === '_') {
    host.zoomOut();
  } else if (event.key === 'Enter' || event.key === ' ') {
    host.choose(id);
  } else if (event.key === 'Escape') {
    host.tooltip.hide();
  } else {
    return;
  }
  event.preventDefault();
}

function onFocusIn(host: InputHost, plot: SVGSVGElement, event: FocusEvent): void {
  const target = eventOf(event.target);
  const mark = target?.dataset.eventId ? host.mark(target.dataset.eventId) : undefined;
  if (!target || !mark) return;
  host.setFocused(mark.id);
  for (const el of plot.querySelectorAll<SVGGElement>('.tl-event')) el.setAttribute('tabindex', el === target ? '0' : '-1');
  showFor(host, mark);
}

/** Wire the plot. Returns the teardown. */
export function bindInput(plot: SVGSVGElement, host: InputHost): () => void {
  const focusedMark = () => {
    const id = host.focusedId();
    return plot.contains(document.activeElement) && id ? host.mark(id) : undefined;
  };
  const handlers: [string, (event: Event) => void][] = [
    ['keydown', (event) => onKeyDown(host, event as KeyboardEvent)],
    ['click', (event) => {
      const id = eventOf(event.target)?.dataset.eventId;
      if (id) host.choose(id);
    }],
    ['pointerover', (event) => {
      const id = eventOf(event.target)?.dataset.eventId;
      if (id) showFor(host, host.mark(id));
    }],
    ['pointerleave', () => showFor(host, focusedMark())],
    ['focusin', (event) => onFocusIn(host, plot, event as FocusEvent)],
    ['focusout', (event) => {
      if (!plot.contains((event as FocusEvent).relatedTarget as Node | null)) host.tooltip.hide();
    }],
  ];
  for (const [type, handler] of handlers) plot.addEventListener(type, handler);
  return () => {
    for (const [type, handler] of handlers) plot.removeEventListener(type, handler);
  };
}
