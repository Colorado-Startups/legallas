// SPDX-License-Identifier: Apache-2.0
// Card P3 (People). The table view and the graph's text twin: name, role, side, organizations, and how many events
// and documents name each party. A name is a button that opens the profile, like a node in the graph.
import { el, shapeMark } from './people-profile.ts';
import { roleText, SIDE_LABELS, type PartyRow } from './people-model.ts';
import type { Side } from './matter-api.ts';

/** The people table's handle: show only some rows and mark the chosen one. */
export interface PeopleTable {
  /** Shows only these rows (by party id) and marks the chosen one. */
  update(visible: Set<string>, chosen: string | null): void;
}

const COLUMNS: Array<{ label: string; num?: boolean }> = [
  { label: 'Name' }, { label: 'Role' }, { label: 'Side' }, { label: 'Organizations' },
  { label: 'Events', num: true }, { label: 'Documents', num: true },
];

/** Draws the people table into the host and returns its handle. */
export function renderTable(host: HTMLElement, rows: PartyRow[]): PeopleTable {
  host.replaceChildren();
  const wrap = el('div', { class: 'c-table-wrap' }, host);
  const table = el('table', { class: 'c-table people-table' }, wrap);
  el('caption', { class: 'u-vh' }, table, 'People and organizations by side');
  const headRow = el('tr', {}, el('thead', {}, table));
  for (const col of COLUMNS) el('th', { scope: 'col', class: col.num ? 'c-table__num' : undefined }, headRow, col.label);
  const body = el('tbody', {}, table);
  const trs = new Map<string, HTMLTableRowElement>();
  for (const row of rows) {
    const { party } = row;
    const tr = el('tr', { 'data-side': party.side }, body);
    const name = el('th', { scope: 'row' }, tr);
    const button = el('button', { type: 'button', class: 'people-link', 'data-people-select': party.id }, name);
    shapeMark(party.side, button);
    el('span', {}, button, party.name);
    el('td', {}, tr, roleText(party.role, party.title));
    el('td', {}, tr, SIDE_LABELS[party.side as Side]);
    el('td', {}, tr, row.orgNames);
    el('td', { class: 'c-table__num' }, tr, String(row.events));
    el('td', { class: 'c-table__num' }, tr, String(row.documents));
    trs.set(party.id, tr);
  }
  return {
    update(visible, chosen) {
      for (const [id, tr] of trs) {
        tr.hidden = !visible.has(id);
        if (id === chosen) tr.setAttribute('aria-selected', 'true'); else tr.removeAttribute('aria-selected');
      }
    },
  };
}
