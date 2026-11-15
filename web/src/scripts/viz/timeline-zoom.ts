// SPDX-License-Identifier: Apache-2.0
// Card F5a (timeline viz). The visible time window: zoom about a point, pan, keep an item in view, and map the
// minimap brush between pixels and time. Every result stays inside the full extent. Pure: no DOM.
import { DAY_MS } from './timeline-dates.ts';

/** A time window in epoch milliseconds, start < end. */
export interface Domain {
  start: number;
  end: number;
}

/** The narrowest window zoom allows: one week. */
export const MIN_SPAN = 7 * DAY_MS;
/** The factor by which one zoom step scales the window. */
export const ZOOM_STEP = 2;

/** The window that shows every span, padded 3% each side (and at least a month wide). */
export function fullExtent(spans: { start: number; end: number }[]): Domain | null {
  if (spans.length === 0) return null;
  let start = Infinity;
  let end = -Infinity;
  for (const span of spans) {
    start = Math.min(start, span.start);
    end = Math.max(end, span.end);
  }
  const pad = Math.max((end - start) * 0.03, Math.max(0, 30 * DAY_MS - (end - start)) / 2);
  return { start: start - pad, end: end + pad };
}

/** Fit a window inside the extent: no narrower than MIN_SPAN (or the extent), no wider than the extent. */
export function clampDomain(domain: Domain, extent: Domain): Domain {
  const full = extent.end - extent.start;
  const span = Math.min(full, Math.max(Math.min(MIN_SPAN, full), domain.end - domain.start));
  let start = domain.start + (domain.end - domain.start - span) / 2;
  start = Math.min(Math.max(start, extent.start), extent.end - span);
  return { start, end: start + span };
}

/** Zoom by `factor` (2 is in, 0.5 is out) keeping the instant `at` where it is on screen. */
export function zoomDomain(domain: Domain, factor: number, at: number, extent: Domain): Domain {
  const span = domain.end - domain.start;
  const full = extent.end - extent.start;
  const next = Math.min(full, Math.max(Math.min(MIN_SPAN, full), span / factor));
  const ratio = span > 0 ? (at - domain.start) / span : 0.5;
  const start = at - next * ratio;
  return clampDomain({ start, end: start + next }, extent);
}

/** Shifts the window by a delta, kept inside the extent. */
export function panDomain(domain: Domain, delta: number, extent: Domain): Domain {
  return clampDomain({ start: domain.start + delta, end: domain.end + delta }, extent);
}

/** The smallest pan that brings [start, end) into the window with `pad` of the window spare on each side. */
export function ensureVisible(domain: Domain, span: { start: number; end: number }, extent: Domain, pad = 0.08): Domain {
  const width = domain.end - domain.start;
  const margin = width * pad;
  if (span.start >= domain.start + margin && span.end <= domain.end - margin) return domain;
  const shift =
    span.start < domain.start + margin ? span.start - margin - domain.start : span.end + margin - domain.end;
  return panDomain(domain, shift, extent);
}

/** Maps a time in milliseconds to a pixel position across the window. */
export function msToPx(ms: number, domain: Domain, x0: number, x1: number): number {
  return x0 + ((ms - domain.start) / (domain.end - domain.start)) * (x1 - x0);
}

/** Maps a pixel position across the window to a time in milliseconds. */
export function pxToMs(px: number, domain: Domain, x0: number, x1: number): number {
  return domain.start + ((px - x0) / (x1 - x0)) * (domain.end - domain.start);
}

/** What a pointer press on the brush grabs: an edge to resize, the window to move, or empty track to draw anew. */
export type BrushGrip = 'start' | 'end' | 'move' | 'new';

/**
 * The grip under a press. When the window already shows everything (`whole`), there is nothing to move, so a
 * press inside it draws a new window instead.
 */
export function brushGrip(px: number, windowPx: { x0: number; x1: number }, whole = false, edge = 8): BrushGrip {
  if (Math.abs(px - windowPx.x0) <= edge) return 'start';
  if (Math.abs(px - windowPx.x1) <= edge) return 'end';
  if (px > windowPx.x0 && px < windowPx.x1 && !whole) return 'move';
  return 'new';
}

/** The window after dragging a grip from `fromMs` to `toMs` (both in the extent's time), clamped. */
export function dragBrush(grip: BrushGrip, start: Domain, fromMs: number, toMs: number, extent: Domain): Domain {
  if (grip === 'move') return panDomain(start, toMs - fromMs, extent);
  if (grip === 'start') return clampDomain({ start: Math.min(toMs, start.end - 1), end: start.end }, extent);
  if (grip === 'end') return clampDomain({ start: start.start, end: Math.max(toMs, start.start + 1) }, extent);
  return clampDomain({ start: Math.min(fromMs, toMs), end: Math.max(fromMs, toMs) }, extent);
}
