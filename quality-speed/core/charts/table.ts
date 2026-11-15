// SPDX-License-Identifier: Apache-2.0
// The sortable, filterable table. It is complete as plain HTML. The script adds the sort and reveals the filter.

import { clamp, esc, fmtValue, icon, isNum, pct, safeHref, sr } from './svg.ts';
import type { Status } from './svg.ts';

export type Cell = string | number | null | undefined;

export interface Column {
  key: string;
  label: string;
  /** `num` sorts as numbers, `score` also draws a small bar, `status` adds an icon. Defaults to text. */
  type?: 'text' | 'num' | 'score' | 'status';
  unit?: string;
  /** Read each row's unit from this field, for a column of mixed units. */
  unitKey?: string;
}

export interface DataTableProps {
  caption: string;
  columns: Column[];
  rows: Record<string, Cell>[];
  /** A row's first column links to the URL in this field of the row. */
  linkKey?: string;
  /** Which link URLs survive; the default keeps this repository's and relative ones only. */
  safe?: (href: string) => string | null;
  filter?: boolean;
}

const STATUS_WORD: Record<Status, string> = { ok: 'OK', no_events: 'No events', stale: 'Stale', missing: 'Missing', few_samples: 'Too few', no_proof: 'No proof' };

function scoreCell(value: Cell): string {
  if (!isNum(value)) return `<span class="qs-status is-bad">${icon('alert')}${sr('Missing')}</span>`;
  const score = clamp(value, 0, 100);
  return `<svg class="qs-cell-bar" width="56" height="10" aria-hidden="true"><rect class="qs-track-q" width="100%" height="10" rx="2"/><rect class="qs-fill-q" width="${pct(score / 100)}" height="10" rx="2"/></svg><span>${esc(value)}</span>`;
}

function statusCell(value: Cell): string {
  const key = String(value ?? 'missing');
  const good = key === 'ok' || key === 'no_events';
  return `<span class="qs-status${good ? '' : ' is-bad'}">${icon(good ? 'check' : 'alert')}${esc(STATUS_WORD[key as Status] ?? key)}</span>`;
}

function cellOf(column: Column, row: Record<string, Cell>, link: string | null): string {
  const value = row[column.key];
  const blank = value === null || value === undefined;
  const raw = blank ? '' : String(value);
  const numeric = column.type === 'num' || column.type === 'score';
  let inner = esc(raw);
  if (column.type === 'num' && typeof value === 'number') inner = esc(fmtValue(value, column.unitKey ? String(row[column.unitKey] ?? '') : column.unit));
  if (column.type === 'score') inner = scoreCell(value);
  if (column.type === 'status') inner = statusCell(value);
  if (link) inner = `<a href="${esc(link)}">${inner}</a>`;
  // The sort reads data-v, else the cell's text: a plain text cell skips it, so a long table stays under the page guard.
  const sortKey = inner === esc(raw) ? '' : ` data-v="${esc(raw)}"`;
  return `<td${numeric ? ' class="qs-num"' : ''}${sortKey}>${inner}</td>`;
}

/** A table you can sort by any column and filter as you type. */
export function dataTable(props: DataTableProps): string {
  const head = props.columns
    .map((col) => {
      const type = col.type === 'num' || col.type === 'score' ? 'num' : 'text';
      return `<th scope="col"${type === 'num' ? ' class="qs-num"' : ''}><button type="button" data-qs-sort data-type="${type}">${esc(col.label)}<span class="qs-sort-mark" aria-hidden="true"></span></button></th>`;
    })
    .join('');
  const body = props.rows
    .map((row) => {
      const url = props.linkKey ? (props.safe ?? safeHref)(String(row[props.linkKey] ?? '')) : null;
      return `<tr>${props.columns.map((col, i) => cellOf(col, row, i === 0 ? url : null)).join('')}</tr>`;
    })
    .join('');
  const total = props.rows.length;
  const filter = props.filter === false
    ? ''
    : `<div class="qs-filter" hidden><label>${icon('search')}${sr(`Filter: ${props.caption}`)}<input type="search" data-qs-filter autocomplete="off"></label><output data-qs-count>${total}/${total}</output></div>`;
  return `<div class="qs-datatable" data-qs-table>${filter}<div class="qs-scroll" tabindex="0" role="region" aria-label="${esc(props.caption)}"><table class="qs-table"><caption class="qs-sr">${esc(props.caption)}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></div>`;
}
