// SPDX-License-Identifier: Apache-2.0
// Card P5b (Documents, intake). The month heatmap of document counts by document date (card F5b's heatmap.ts).
// A document's date is its matter date (GET /api/matter, docs facts) or, failing that, when the room last saw
// the file. Choosing a month fires `docs:filter` {month} on the table's slot (card P5a, ruling R45); a
// `docs:filter` from anyone else there (the table's Clear) moves the heatmap's choice to match.
import { getJson, type FolderNode } from './files-api.ts';
import { pageMatter } from './doc-facts.ts';
import { monthCounts, renderHeatmap, type HeatmapHandle } from './viz/heatmap.ts';
import './viz/charts.css';
import {
  DOCS_FILTER_EVENT, DOCS_UPLOADED_EVENT, docsTarget, flattenTree, heatDates, type DatedFacts, type DocsFilterDetail,
} from './documents-intake-dates.ts';

/** The room's stored name as a literal (worker/stored-name.ts): the minified key stays one, and a stored key can be read. */
declare const ROOM_STORED_NAME: string | undefined;

const TITLE = 'By document date';
const CAPTION = 'Select a month to filter.';

async function loadDates(): Promise<Array<string | null> | null> {
  const [tree, matter] = await Promise.all([
    getJson<{ root: FolderNode }>('/api/documents'),
    // No published matter yet (or an error) still leaves every document dated by when the room saw it.
    pageMatter().catch(() => null),
  ]);
  if (!tree.ok) return null;
  const facts: Record<string, DatedFacts> | null = matter ? matter.docs : null;
  return heatDates(flattenTree(tree.value.root), facts);
}

function isFilterDetail(detail: unknown): detail is DocsFilterDetail {
  if (typeof detail !== 'object' || detail === null || !('month' in detail)) return false;
  const month = (detail as { month: unknown }).month;
  return month === null || (typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month));
}

/** The month heatmap's control, which reports the month chosen now. */
export interface HeatmapControl {
  /** The month chosen now, for other filters that must keep it (the From counsel toggle). */
  month(): string | null;
}

/*
  Layout shift (R89): the heatmap draws after the table is up, and its height (one row per year) pushed the table
  down. While the slot is aria-busy (from the markup), documents-intake.css holds a drawn heatmap's height: this
  browser's last one, else the fixture's. Released once it is drawn, or says why it is not.
*/
const HEIGHT_KEY = `${typeof ROOM_STORED_NAME === 'string' ? ROOM_STORED_NAME : 'legallas'}:docs-heat-height`;

function reserveHeight(slot: HTMLElement): void {
  try {
    const height = Number(localStorage.getItem(HEIGHT_KEY));
    if (height > 0 && height < 2000) slot.style.setProperty('--docs-heat-reserve', `${height}px`);
  } catch {
    // Storage blocked: the stylesheet's default holds.
  }
}

function releaseHeight(slot: HTMLElement, drawn: boolean): void {
  slot.removeAttribute('aria-busy');
  slot.style.removeProperty('--docs-heat-reserve');
  if (!drawn) return;
  try {
    localStorage.setItem(HEIGHT_KEY, String(Math.round(slot.getBoundingClientRect().height)));
  } catch {
    // Private windows and blocked storage: the default reservation still applies on the next visit.
  }
}

/** Draws the heatmap into `slot` and keeps it in step with the table's month filter and new uploads. */
export function mountHeatmap(slot: HTMLElement, note: HTMLElement, counsel: () => boolean): HeatmapControl {
  const target = docsTarget();
  let handle: HeatmapHandle | null = null;
  let chosen: string | null = null;
  let firing = false;

  const choose = (month: string | null) => {
    chosen = month;
    firing = true;
    const detail: DocsFilterDetail = { month, counsel: counsel() };
    target.dispatchEvent(new CustomEvent<DocsFilterDetail>(DOCS_FILTER_EVENT, { detail, bubbles: true }));
    firing = false;
  };

  const draw = async () => {
    const dates = await loadDates().catch(() => null);
    handle?.destroy();
    handle = null;
    if (!dates) {
      note.textContent = 'The document dates did not load; reload the page to try again.';
      note.hidden = false;
      releaseHeight(slot, false);
      return;
    }
    const counts = monthCounts(dates);
    note.textContent = 'No documents carry a month yet.';
    note.hidden = counts.months.size > 0;
    if (counts.months.size === 0) {
      releaseHeight(slot, false);
      return;
    }
    handle = renderHeatmap(slot, counts, { title: TITLE, caption: CAPTION, onSelect: choose });
    handle.select(chosen);
    if (slot.hasAttribute('aria-busy')) releaseHeight(slot, true);
  };

  target.addEventListener(DOCS_FILTER_EVENT, (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (firing || !isFilterDetail(detail)) return;
    chosen = detail.month;
    handle?.select(chosen);
  });
  target.addEventListener(DOCS_UPLOADED_EVENT, () => void draw());
  if (slot.hasAttribute('aria-busy')) reserveHeight(slot);
  void draw();
  return { month: () => chosen };
}
