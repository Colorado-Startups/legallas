// SPDX-License-Identifier: Apache-2.0
// /documents/, the table half (card P5a): the data-room index, facets, the `/` filter and a dense, sortable table
// of every live document. One /api/documents call, joined with /api/matter docs facts (tolerating not_built) and
// the open discussions. The hash is the selected folder (#from-counsel is the counsel uploads). The intake half
// (card P5b) drives the table with `docs:filter` events on [data-docs-table]; see onIntakeFilter. Rows added or
// changed since the member's last visit (POST /api/seen, the Overview's visit) carry New and the Marked box ?mark=new.
// A company room (no matter) reads its dates and parties from /api/checklist and the file names, and leaves out the case
// room's columns and empty ones (documents-table-company.ts).
import { checklistFacts, hiddenColumns, type ChecklistDocs, type KeyFacts } from './documents-table-company.ts';
import {
  buildIndex, emptyFilter, facetCounts, filterRows, findFolder, joinRows, marksFromSearch, remarkFresh, sortFromSearch, sortRows,
  type DocRow, type IndexFolder, type ListedTree, type MarkValue, type PrivilegeValue, type SortDir, type SortKey,
  type TableFilter,
} from './documents-table-data.ts';
import { bindKeys } from './documents-table-keys.ts';
import {
  buildFacets, buildFolderSelect, buildIndexList, buildRow, guideBlock, markFolder, setFresh, setKeyPressed, updateFacets,
} from './documents-table-view.ts';
import { getJson, setKey, type KeyState } from './files-api.ts';
import { guideSend } from './guide-bus.ts';
import { localVisit, roomVisit } from './overview-news-seen.ts';
import { newsCutoff } from './overview-news-visit.ts';
import { meCan } from './room-me.ts';
import { plural } from './files-format.ts';
import { controlPrefix, pageMatter, type ServedMatter } from './doc-facts.ts';
import { settle, type LoadState } from './page-load.ts';
import { isCompanyRoom } from './room-shape.ts';

const page = document.querySelector<HTMLElement>('[data-docs]');
const FILTER_DELAY_MS = 80;
/** A room with no matter (worker/room-shape.ts): no control numbers, privilege calls or Bates numbers. */
const company = isCompanyRoom();
const COMPANY_FILTER = 'Filter by name or party';

interface Ui {
  table: HTMLElement;
  /** The work area where the single-key shortcuts listen (R80). */
  region: HTMLElement;
  tally: HTMLElement;
  index: HTMLElement;
  select: HTMLSelectElement;
  facets: HTMLElement;
  filter: HTMLInputElement;
  scope: HTMLElement;
  scopeName: HTMLElement;
  guide: HTMLElement;
  body: HTMLTableSectionElement;
  status: HTMLElement;
  nomatch: HTMLElement;
}

interface State {
  rows: DocRow[];
  trs: Map<string, HTMLTableRowElement>;
  index: IndexFolder[];
  filter: TableFilter;
  sort: { key: SortKey; dir: SortDir };
  visible: DocRow[];
  /** The instant this visit's "new" is measured from. */
  since: string;
}

function q<T extends HTMLElement>(root: HTMLElement, hook: string): T {
  return root.querySelector<T>(`[${hook}]`)!;
}

interface Loaded {
  root: ListedTree;
  matter: ServedMatter | null;
  discussed: Set<string>;
  /** The checklist's key facts by document id; empty outside a company room, or with the checklist off (404). */
  checklist: Map<string, KeyFacts>;
}

async function load(): Promise<Loaded | null> {
  const [tree, matter, feed, listed] = await Promise.all([
    getJson<{ root: ListedTree }>('/api/documents'),
    // No matter yet (not_built) or a bad one: the table still lists every document, without facts.
    pageMatter().catch(() => null),
    // A member who may not read comments skips the feed rather than collect a 403.
    meCan('readComments').then((can) =>
      can ? getJson<{ comments: { document_id: string }[] }>('/api/comments?open=1&limit=200') : ({ ok: false, status: 403 } as const),
    ),
    // Only a company room asks: a case room's dates and parties are the matter's. Off or failed: the file names alone.
    company ? getJson<ChecklistDocs>('/api/checklist') : ({ ok: false, status: 0 } as const),
  ]);
  if (!tree.ok) return null;
  const discussed = new Set(feed.ok ? feed.value.comments.map((c) => c.document_id) : []);
  return { root: tree.value.root, matter, discussed, checklist: checklistFacts(listed.ok ? listed.value : null) };
}

function folderFromHash(index: readonly IndexFolder[]): string {
  let path = '';
  try {
    path = decodeURIComponent(location.hash.slice(1));
  } catch {
    return '';
  }
  return path && findFolder(index, path) ? path : '';
}

function folderName(index: readonly IndexFolder[], path: string): string {
  const folder = findFolder(index, path);
  return folder ? `${folder.number ? `${folder.number} ` : ''}${folder.label}` : '';
}

function statusLine(state: State, total: number): string {
  const { filter, visible } = state;
  const where = filter.folder ? ` in ${folderName(state.index, filter.folder)}` : '';
  const narrowed = filter.query || filter.month || filter.counsel || filter.types.size || filter.privilege.size || filter.marks.size;
  if (!narrowed) return `${plural(visible.length, 'document')}${where}`;
  const scope = filter.folder ? filterRows(state.rows, emptyFilter(filter.folder)).length : total;
  return `${visible.length.toLocaleString('en-US')} of ${plural(scope, 'document')}${where}`;
}

function render(ui: Ui, state: State): void {
  state.visible = sortRows(filterRows(state.rows, state.filter), state.sort.key, state.sort.dir);
  const fragment = document.createDocumentFragment();
  for (const row of state.visible) fragment.append(state.trs.get(row.id)!);
  ui.body.replaceChildren(fragment);
  updateFacets(ui.facets, facetCounts(state.rows, state.filter));
  ui.status.textContent = statusLine(state, state.rows.length);
  ui.nomatch.hidden = state.visible.length > 0;
  ui.table.dispatchEvent(new CustomEvent('docs:filtered', { detail: { count: state.visible.length } }));
}

function showFolder(ui: Ui, state: State, path: string): void {
  state.filter = { ...state.filter, folder: path };
  markFolder(ui.index, ui.select, path);
  ui.scope.hidden = !path;
  ui.scopeName.textContent = path ? `Folder ${folderName(state.index, path)}` : '';
  const guide = findFolder(state.index, path)?.guide;
  ui.guide.replaceChildren(...(guide ? [guideBlock(guide.id)] : []));
  render(ui, state);
}

/** Selects a folder through the hash, so Back works and the link can be shared. */
function goToFolder(path: string): void {
  const next = path ? `#${encodeURIComponent(path)}` : '';
  if (location.hash === next) return;
  if (next) {
    location.hash = next;
    return;
  }
  history.pushState(null, '', `${location.pathname}${location.search}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** aria-sort on the sorted column only (the column heads show it). */
function showSort(ui: Ui, sort: State['sort']): void {
  for (const th of ui.table.querySelectorAll<HTMLElement>('th[data-sort]')) {
    if (th.dataset.sort === sort.key) th.setAttribute('aria-sort', sort.dir);
    else th.removeAttribute('aria-sort');
  }
}

function bindSort(ui: Ui, state: State): void {
  for (const th of ui.table.querySelectorAll<HTMLElement>('th[data-sort]')) {
    th.querySelector('button')!.addEventListener('click', () => {
      const key = th.dataset.sort as SortKey;
      const dir: SortDir = state.sort.key === key && state.sort.dir === 'ascending' ? 'descending' : 'ascending';
      state.sort = { key, dir };
      showSort(ui, state.sort);
      render(ui, state);
    });
  }
}

function bindFacets(ui: Ui, state: State): void {
  ui.facets.addEventListener('change', (event) => {
    const box = event.target as HTMLInputElement;
    if (!box.dataset.facet) return;
    const checked = (group: string) =>
      [...ui.facets.querySelectorAll<HTMLInputElement>(`input[data-facet="${group}"]:checked`)].map((b) => b.value);
    state.filter = {
      ...state.filter,
      types: new Set(checked('type')),
      privilege: new Set(checked('privilege') as PrivilegeValue[]),
      marks: new Set(checked('marks') as MarkValue[]),
    };
    render(ui, state);
  });
  ui.facets.addEventListener('click', (event) => {
    const more = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-facet-more]');
    if (!more) return;
    const open = more.getAttribute('aria-expanded') !== 'true';
    more.setAttribute('aria-expanded', String(open));
    more.closest('fieldset')!.toggleAttribute('data-expanded', open);
    more.textContent = 'Show fewer types';
    if (!open) updateFacets(ui.facets, facetCounts(state.rows, state.filter));
  });
}

function bindFilter(ui: Ui, state: State): void {
  let pending = 0;
  ui.filter.addEventListener('input', () => {
    clearTimeout(pending);
    pending = window.setTimeout(() => {
      state.filter = { ...state.filter, query: ui.filter.value.trim() };
      render(ui, state);
    }, FILTER_DELAY_MS);
  });
  page!.querySelector('[data-docs-clear-folder]')!.addEventListener('click', () => goToFolder(''));
  page!.querySelector('[data-docs-clear-all]')!.addEventListener('click', () => {
    ui.filter.value = '';
    for (const box of ui.facets.querySelectorAll<HTMLInputElement>('input[data-facet]')) box.checked = false;
    state.filter = { ...emptyFilter(state.filter.folder), counsel: state.filter.counsel };
    render(ui, state);
    // The heatmap (card P5b) hears this too and drops its month; the From counsel list stays as it is.
    ui.table.dispatchEvent(new CustomEvent('docs:filter', { detail: { month: null, counsel: state.filter.counsel } }));
    ui.filter.focus();
  });
  ui.select.addEventListener('change', () => goToFolder(ui.select.value));
  window.addEventListener('hashchange', () => showFolder(ui, state, folderFromHash(state.index)));
}

/** The intake half's heatmap month and From counsel filter: `docs:filter` with {month?, counsel?}. */
function onIntakeFilter(ui: Ui, state: State): void {
  ui.table.addEventListener('docs:filter', (event) => {
    const detail = (event as CustomEvent<{ month?: string | null; counsel?: boolean }>).detail ?? {};
    const month = detail.month === undefined ? state.filter.month : detail.month && /^\d{4}(-\d{2})?$/.test(detail.month) ? detail.month : null;
    const counsel = typeof detail.counsel === 'boolean' ? detail.counsel : state.filter.counsel;
    state.filter = { ...state.filter, month, counsel };
    render(ui, state);
  });
}

/** Marks or clears Key (setKey, decision R35), optimistically; a failure puts it back. */
function bindKey(ui: Ui, state: State): void {
  ui.body.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-docs-key]');
    if (!button || button.disabled) return;
    const row = state.rows.find((r) => r.id === button.dataset.docsKey);
    if (!row) return;
    const on = !row.key;
    showKey(ui, state, row.id, on);
    button.disabled = true;
    const result = await setKey(row.id, on);
    button.disabled = false;
    if (!result.ok) {
      showKey(ui, state, row.id, !on);
      ui.status.textContent = 'Key did not save; try again.';
      return;
    }
    // Tell the rest of the page (the exhibit pane, card F7) the same way it tells us.
    document.dispatchEvent(new CustomEvent<KeyState>('legallas:key', { detail: result.value }));
  });
  // A Key change made elsewhere on the page, such as in the exhibit pane.
  document.addEventListener('legallas:key', (event) => {
    const detail = (event as CustomEvent<Partial<KeyState>>).detail;
    if (detail && typeof detail.id === 'string' && typeof detail.key === 'boolean') showKey(ui, state, detail.id, detail.key);
  });
}

/** Shows a document's Key flag in its row and the Marked counts. */
function showKey(ui: Ui, state: State, id: string, on: boolean): void {
  const row = state.rows.find((r) => r.id === id);
  if (!row) return;
  row.key = on;
  const button = state.trs.get(id)?.querySelector<HTMLButtonElement>('[data-docs-key]');
  if (button) setKeyPressed(button, on);
  updateFacets(ui.facets, facetCounts(state.rows, state.filter));
}

function uiOf(root: HTMLElement): Ui {
  const table = q<HTMLElement>(root, 'data-docs-table');
  return {
    table,
    region: q(table, 'data-docs-keys'),
    tally: q(root, 'data-docs-tally'),
    index: q(table, 'data-docs-index'),
    select: q<HTMLSelectElement>(table, 'data-docs-folder-select'),
    facets: q(table, 'data-docs-facets'),
    filter: q<HTMLInputElement>(table, 'data-docs-filter'),
    scope: q(table, 'data-docs-scope'),
    scopeName: q(table, 'data-docs-scope-name'),
    guide: q(table, 'data-docs-guide'),
    body: q<HTMLTableSectionElement>(table, 'data-docs-rows'),
    status: q(table, 'data-docs-status'),
    nomatch: q(table, 'data-docs-nomatch'),
  };
}

function tallyLine(rows: readonly DocRow[]): string {
  const pages = rows.reduce((sum, row) => sum + (row.pages ?? 0), 0);
  const counts = `${plural(rows.length, 'document')}, ${plural(pages, 'page')}.`;
  return company ? counts : `${counts} Control numbers are permanent; the folder index is for browsing only.`;
}

/** (Re)fills the table from fresh data, keeping the folder, words, facets, month and sort. */
function setData(ui: Ui, state: State, loaded: Loaded): void {
  state.rows = joinRows({ ...loaded, prefix: controlPrefix(), since: state.since });
  state.trs = new Map(state.rows.map((row) => [row.id, buildRow(row, company)]));
  ui.table.dataset.docsHide = hiddenColumns(state.rows, company).join(' ');
  state.index = buildIndex(loaded.root);
  ui.tally.textContent = tallyLine(state.rows);
  buildIndexList(ui.index, state.index, state.rows.length);
  buildFolderSelect(ui.select, state.index, state.rows.length);
  const types = [...facetCounts(state.rows, emptyFilter()).type].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  buildFacets(ui.facets, types.map(([type]) => type), company);
  const checked = { type: state.filter.types, privilege: state.filter.privilege, marks: state.filter.marks } as const;
  for (const box of ui.facets.querySelectorAll<HTMLInputElement>('input[data-facet]')) {
    box.checked = (checked[box.dataset.facet as keyof typeof checked] as ReadonlySet<string>).has(box.value);
  }
  showFolder(ui, state, folderFromHash(state.index));
}

/**
 * The room's visit, once it answers after the table is drawn: only the New marks, the Marked count and the rows a
 * ?mark=new filter shows can move. Every row stays the same element, so focus and selection survive.
 */
function applySince(ui: Ui, state: State, since: string): void {
  if (since === state.since) return;
  state.since = since;
  const changed = remarkFresh(state.rows, since);
  for (const row of changed) {
    const tr = state.trs.get(row.id);
    if (tr) setFresh(tr, row.fresh);
  }
  if (changed.length) render(ui, state);
}

/** Where the page's load ended: the Loading line gives way to the table and its tally, the empty note or the error. */
function showState(root: HTMLElement, state: LoadState): void {
  const set = (hook: string, hidden: boolean) => root.querySelectorAll<HTMLElement>(`[${hook}]`).forEach((node) => (node.hidden = hidden));
  set('data-docs-loading', true);
  set('data-docs-tally', state !== 'ready');
  set('data-docs-ready', state !== 'ready');
  set('data-docs-empty', state !== 'empty');
  set('data-docs-error', state !== 'error');
  // Render owns "No documents match"; a table that failed while drawing takes it away with the rest.
  if (state !== 'ready') set('data-docs-nomatch', true);
}

/** Every step can fail (a fetch, the data, the table while it draws); each one ends on the error line. */
async function start(root: HTMLElement): Promise<void> {
  await settle((state) => showState(root, state), async () => {
    const ui = uiOf(root);
    const now = new Date();
    // The table draws from this browser's copy of the visit; the room's answer (it never fails, see roomVisit) moves
    // the New marks when it arrives, so a slow POST /api/seen never holds the documents back.
    const local = localVisit(now);
    const visiting = roomVisit(local);
    const loaded = await load();
    if (!loaded || !loaded.root.count) {
      // The first upload into an empty room (or one whose list failed): start over with it listed.
      ui.table.addEventListener('docs:uploaded', () => location.reload());
      if (!loaded) throw new Error('documents: the list did not load');
      return 'empty';
    }
    const query = new URLSearchParams(location.search).get('q')?.trim() ?? '';
    const state: State = {
      rows: [],
      trs: new Map(),
      index: [],
      filter: { ...emptyFilter(), query, marks: marksFromSearch(location.search) },
      sort: sortFromSearch(location.search) ?? { key: 'control', dir: 'ascending' },
      visible: [],
      since: newsCutoff(local, now),
    };
    ui.filter.value = query;
    if (company) {
      ui.filter.placeholder = COMPANY_FILTER;
      ui.filter.labels?.[0]?.replaceChildren(COMPANY_FILTER);
    }
    showSort(ui, state.sort);
    bindSort(ui, state);
    bindFacets(ui, state);
    bindFilter(ui, state);
    bindKey(ui, state);
    onIntakeFilter(ui, state);
    bindKeys({ region: ui.region, table: ui.table, body: ui.body, filter: ui.filter, visibleIds: () => state.visible.map((row) => row.id) });
    // On screen before the rows are drawn, as before; a table that throws while drawing still ends on the error line.
    showState(root, 'ready');
    setData(ui, state, loaded);
    void visiting.then((visit) => applySince(ui, state, newsCutoff(visit, now)));
    // A file sent from the intake (card P5b) lands in the list without a page load.
    ui.table.addEventListener('docs:uploaded', async () => {
      const fresh = await load();
      if (fresh) setData(ui, state, fresh);
    });
    return 'ready';
  }, () => guideSend({ type: 'error' }));
}

if (page) void start(page);
