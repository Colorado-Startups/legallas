// SPDX-License-Identifier: Apache-2.0
// Card F5a (timeline viz). The full timeline's toolbar: Zoom out, Zoom in, Show all and (unless the page has its
// own switch) Table. Quiet buttons; a limit sets aria-disabled, which keeps the button focusable.
import { html } from './timeline-svg.ts';
import { MIN_SPAN, type Domain } from './timeline-zoom.ts';

/** The actions of the timeline toolbar. */
export type ToolAction = 'zoom-out' | 'zoom-in' | 'reset' | 'table';

/** Builds the timeline toolbar into the parent and calls act for each button pressed. */
export function buildToolbar(parent: HTMLElement, table: { show: boolean; pressed: boolean }, act: (action: ToolAction) => void): HTMLElement {
  const bar = html('div', { class: 'tl-toolbar', role: 'toolbar', 'aria-label': 'Timeline view' }, parent);
  const tool = (action: ToolAction, text: string, extra: Record<string, string> = {}) =>
    html('button', { type: 'button', class: 'c-button c-button--quiet tl-tool', 'data-tl-action': action, ...extra }, bar, text);
  tool('zoom-out', 'Zoom out', { 'aria-keyshortcuts': '-' });
  tool('zoom-in', 'Zoom in', { 'aria-keyshortcuts': '+' });
  tool('reset', 'Show all');
  if (table.show) tool('table', 'Table', { 'aria-pressed': String(table.pressed) });
  bar.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest<HTMLElement>('[data-tl-action]');
    if (button && button.getAttribute('aria-disabled') !== 'true') act(button.dataset.tlAction as ToolAction);
  });
  return bar;
}

/** Zoom in stops at the narrowest window; zoom out and Show all stop at the whole record. */
export function updateToolbar(bar: HTMLElement, domain: Domain, extent: Domain): void {
  const span = domain.end - domain.start;
  const full = extent.end - extent.start;
  const whole = span >= full - 1;
  const limits: Record<string, boolean> = { 'zoom-in': span <= Math.min(MIN_SPAN, full) + 1, 'zoom-out': whole, reset: whole };
  for (const [action, off] of Object.entries(limits)) {
    bar.querySelector(`[data-tl-action="${action}"]`)?.setAttribute('aria-disabled', String(off));
  }
}

/** Zooming means nothing in the Table view: its zoom tools hide there (the Table tool stays). */
export function showZoomTools(bar: HTMLElement, show: boolean): void {
  for (const tool of bar.querySelectorAll<HTMLElement>('[data-tl-action]:not([data-tl-action="table"])')) tool.hidden = !show;
}
