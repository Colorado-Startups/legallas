// SPDX-License-Identifier: Apache-2.0
// The view on legallas_list_documents (ui://legallas/grid), after Anthropic's tabular review: a row per document, a
// column per fact the room holds (control number, date, type, parties, folder, pages, Key, privileged), sortable and
// filterable. Every cell is cited: it belongs to its row's document, and choosing it reads that document's first page
// through legallas_read_pages (in the AI) or opens the exhibit (in the binder). Arrow keys move between cells the way
// the claims matrix does (src/scripts/viz/matrix.ts nextCell). "More" pages on with the result's cursor.
import { nextCell } from '../../../src/scripts/viz/matrix.ts';
import { connect, type Host, type ToolResult } from './bridge.ts';
import { cellText, citesOf, filterRows, gridColumns, resultData, resultError, shown, sortRows, type GridColumn, type Obj } from './model.ts';
import { caseText, html, openCite, reader, retrieved, shell, type Reader } from './ui.ts';
import './views.css';

const app = document.getElementById('app')!;
let host: Host;

const state: { rows: Obj[]; total: number | null; cursor: string | null; data: Obj | null; sort: { key: string; dir: 1 | -1 } | null; query: string } = {
  rows: [], total: null, cursor: null, data: null, sort: null, query: '',
};

function show(result: ToolResult, args: Obj | null): void {
  const data = resultData(result);
  if (!data) {
    shell(app, 'Documents', host).status(resultError(result) ?? 'This result has nothing to show.', 'error');
    return;
  }
  const rows = Array.isArray(data.documents) ? data.documents.filter((row): row is Obj => !!row && typeof row === 'object') : [];
  state.rows = args?.cursor !== undefined && state.data ? [...state.rows, ...rows] : rows;
  state.total = typeof data.total === 'number' ? data.total : null;
  state.cursor = typeof data.next_cursor === 'string' ? data.next_cursor : null;
  state.data = data;
  draw();
}

function draw(): void {
  const s = shell(app, 'Documents', host);
  const read = reader(s.slot, host);
  const columns = gridColumns(state.rows);
  const filter = html('input', { type: 'search', class: 'v-filter', placeholder: 'Filter', 'aria-label': 'Filter the documents' }, s.tools);
  filter.value = state.query;
  const count = html('span', { class: 'v-muted' }, s.tools);
  const wrap = html('div', { class: 'v-grid' }, s.body);
  const paint = () => {
    const rows = filterRows(state.rows, columns, state.query);
    const col = state.sort ? columns.find((c) => c.key === state.sort!.key) : undefined;
    const sorted = col ? sortRows(rows, col, state.sort!.dir) : rows;
    count.textContent = `${sorted.length} of ${state.total ?? state.rows.length}`;
    table(wrap, columns, sorted, read, paint);
  };
  filter.addEventListener('input', () => {
    state.query = filter.value;
    paint();
  });
  paint();
  if (state.cursor && host.mode === 'host') {
    const more = html('button', { type: 'button', class: 'v-button' }, s.foot, 'More');
    more.addEventListener('click', async () => {
      s.status('Loading…', 'busy');
      try {
        const result = await host.callTool(host.config.tools.list, { cursor: state.cursor });
        const error = resultError(result);
        if (error) return s.status(error, 'error');
        show(result, { cursor: state.cursor });
      } catch (error) {
        s.status(error instanceof Error ? error.message : 'The room did not answer.', 'error');
      }
    });
  }
  if (state.data) retrieved(s.foot, state.data);
}

function table(wrap: HTMLElement, columns: GridColumn[], rows: Obj[], read: Reader, repaint: () => void): void {
  wrap.replaceChildren();
  const grid = html('table', { class: 'v-table', role: 'grid', 'aria-rowcount': String(rows.length + 1) }, wrap);
  const head = html('tr', {}, html('thead', {}, grid));
  for (const col of columns) {
    const sorted = state.sort?.key === col.key ? (state.sort.dir === 1 ? 'ascending' : 'descending') : 'none';
    const th = html('th', { scope: 'col', 'aria-sort': sorted, 'data-kind': col.kind }, head);
    const button = html('button', { type: 'button', class: 'v-sort' }, th, col.label);
    button.addEventListener('click', () => {
      const ascending = state.sort !== null && state.sort.key === col.key && state.sort.dir === 1;
      state.sort = { key: col.key, dir: ascending ? -1 : 1 };
      repaint();
    });
  }
  const body = html('tbody', {}, grid);
  const cells: { row: number; col: number; el: HTMLElement }[] = [];
  rows.forEach((row, r) => {
    const tr = html('tr', { ...(row.privileged === true ? { 'data-privileged': '' } : {}) }, body);
    const cite = citesOf(row)[0] ?? null;
    columns.forEach((col, c) => {
      const td = html('td', { 'data-kind': col.kind }, tr);
      const cell = html('button', { type: 'button', class: col.kind === 'cite' ? 'v-cite' : 'v-cell', tabindex: '-1', ...(col.kind === 'cite' ? { 'data-cite': '' } : {}) }, td);
      if (col.key === 'title') caseText(cell, shown(row.title));
      else cell.textContent = cellText(row, col) || (col.kind === 'cite' ? 'Open' : '');
      cell.title = cite ? `${cite.control ?? 'Document'}: read page 1` : '';
      cell.addEventListener('click', () => cite && openCite({ ...cite, page: cite.page ?? 1 }, host, read));
      cells.push({ row: r, col: c, el: cell });
    });
  });
  if (rows.length === 0) {
    html('td', { colspan: String(columns.length), class: 'v-empty' }, html('tr', {}, body), 'No documents match.');
    return;
  }
  // One tab stop for the whole grid; arrows move within it.
  cells[0]!.el.tabIndex = 0;
  grid.addEventListener('keydown', (event) => {
    const from = cells.findIndex((cell) => cell.el === document.activeElement);
    if (from < 0) return;
    const to = nextCell(cells, from, event.key);
    if (to < 0) return;
    event.preventDefault();
    cells[from]!.el.tabIndex = -1;
    cells[to]!.el.tabIndex = 0;
    cells[to]!.el.focus();
  });
}

host = connect(show);
