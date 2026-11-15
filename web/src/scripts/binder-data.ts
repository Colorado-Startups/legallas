// SPDX-License-Identifier: Apache-2.0

/** The room's stored name as a literal (worker/stored-name.ts): the minified key stays one, and a stored key can be read. */
declare const ROOM_STORED_NAME: string | undefined;
// Shared by the binder home and the visual viewer (card P8): the /api/visuals shape, a fetch, the copy
// helpers (counts, progress, kickers), the sprite icon and the per-browser "pages read" marks. All text
// goes in with textContent; nothing here uses innerHTML. The el() builder is core (dom-el.ts), re-exported here.

export { el } from './dom-el.ts';

/** One visual page of the room binder, with its slug, id and section. */
export interface RoomVisual {
  slug: string;
  id: string;
  section: string;
  title: string;
  summary: string | null;
  overview: boolean;
  /** Set for a visual a member's AI saved: where its frame loads (worker/proposal-visual.ts). */
  src?: string;
  privileged?: boolean;
}

/** One section of the room binder, with its label, title and visuals. */
export interface RoomSection {
  slug: string;
  label: string;
  title: string;
  summary: string | null;
  accent: string;
  icon: string;
  visuals: string[];
}

/** The room binder as served: its sections and every visual. */
export interface RoomBinder {
  sections: RoomSection[];
  visuals: RoomVisual[];
}

/** The outcome of loading the binder: the binder, or the HTTP status that failed. */
export type BinderResult = { ok: true; binder: RoomBinder } | { ok: false; status: number };

/** Fetches the binder from /api/visuals and returns it, or the failing status. */
export async function loadBinder(): Promise<BinderResult> {
  try {
    const response = await fetch('/api/visuals', { credentials: 'same-origin' });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, binder: (await response.json()) as RoomBinder };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** The page link that opens one visual by its slug. */
export function visualHref(slug: string): string {
  return `/visual/?v=${encodeURIComponent(slug)}`;
}

/** The label a page carries in its tab: "Overview" for the hub, then 1, 2, 3 for the parts. */
export function partLabel(section: RoomSection, visuals: ReadonlyMap<string, RoomVisual>, slug: string): string {
  const hasOverview = visuals.get(section.visuals[0] ?? '')?.overview === true;
  const index = section.visuals.indexOf(slug);
  if (hasOverview && index === 0) return 'Overview';
  return String(hasOverview ? index : index + 1);
}

/** Counts a noun, so that 1 page reads "1 page" and 2 read "2 pages". */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** The header line, for example "13 tabs, 74 pages". */
export function binderCount(binder: RoomBinder): string {
  return `${plural(binder.sections.length, 'tab')}, ${plural(binder.visuals.length, 'page')}`;
}

/** How much of a section the reader has finished: the counts and the label to show. */
export interface ReadProgress {
  done: number;
  total: number;
  /** "6 pages", or "2 of 6 pages read" once any is read. */
  label: string;
}

/** Counts how many of a section's visuals the reader has read, with the label to show. */
export function readProgress(section: RoomSection, read: ReadonlySet<string>): ReadProgress {
  const total = section.visuals.length;
  const done = section.visuals.filter((slug) => read.has(slug)).length;
  return { done, total, label: done ? `${done} of ${plural(total, 'page')} read` : plural(total, 'page') };
}

/** The viewer's kicker: "Tab 03, overview" or "Tab 03, page 2 of 8" (the overview is not counted). */
export function pageKicker(section: RoomSection, visuals: ReadonlyMap<string, RoomVisual>, slug: string): string {
  const label = partLabel(section, visuals, slug);
  if (label === 'Overview') return `${section.label}, overview`;
  const hasOverview = visuals.get(section.visuals[0] ?? '')?.overview === true;
  return `${section.label}, page ${label} of ${section.visuals.length - (hasOverview ? 1 : 0)}`;
}

const SVG = 'http://www.w3.org/2000/svg';
const ICON_NAME = /^[a-z-]{1,24}$/;

/** A sprite icon from VisualIcons.astro (20px line icons). */
export function icon(name: string, className = 'binder-icon'): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('class', className);
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#vi-${ICON_NAME.test(name) ? name : 'scroll'}`);
  svg.append(use);
  return svg;
}

// "Pages read" marks live only in this browser (a convenience, not a record). Storage can be missing or
// blocked in private windows, so every access is guarded and the page works the same without it.
const READ_KEY = `${typeof ROOM_STORED_NAME === 'string' ? ROOM_STORED_NAME : 'legallas'}.visuals.read.v1`;

/** The slugs of visuals this browser has marked read, from local storage. */
export function readSlugs(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(READ_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Records in local storage that this browser has read a visual. */
export function markRead(slug: string): void {
  try {
    const slugs = readSlugs();
    slugs.add(slug);
    localStorage.setItem(READ_KEY, JSON.stringify([...slugs]));
  } catch {
    // Storage unavailable: the marks are optional.
  }
}
