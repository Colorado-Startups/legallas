// SPDX-License-Identifier: Apache-2.0
// The Documents table's DOM (card P5a): table rows, the data-room index, the phone folder select, the facet boxes
// and folder guides. Built once and updated in place, so focus survives every filter change. No inline style:
// everything is classes and data attributes (CSP).
import type { DocRow, FacetCounts, FacetGroup, IndexFolder } from './documents-table-data.ts';
import { flattenIndex } from './documents-table-data.ts';
import { docHref, FETCH_TIMEOUT_MS, fileUrl } from './files-api.ts';
import { MARK_LABEL, UNMARKED_LABEL } from './mark-words.ts';

const SVG = 'http://www.w3.org/2000/svg';

/** Creates an element with an optional class name and text. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The Key target badge (DESIGN.md: target rings), 16px, single ink. */
export function targetBadge(className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [r, fill] of [['10', 'none'], ['6', 'none'], ['2.5', 'currentColor']] as const) {
    const circle = document.createElementNS(SVG, 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '12');
    circle.setAttribute('r', r);
    circle.setAttribute('fill', fill);
    if (fill === 'none') {
      circle.setAttribute('stroke', 'currentColor');
      circle.setAttribute('stroke-width', '1.5');
    }
    svg.append(circle);
  }
  return svg;
}

/**
 * One table row. Cells carry their column name for the phone card layout. A company room hides the control number
 * (documents-table-company.ts), so its summary is the row's link instead.
 */
export function buildRow(row: DocRow, company = false): HTMLTableRowElement {
  const tr = el('tr', 'docs-row');
  tr.dataset.id = row.id;
  tr.tabIndex = -1;
  const cell = (column: string, className = '') => {
    const td = el('td', `docs-cell docs-cell--${column}${className ? ` ${className}` : ''}`);
    tr.append(td);
    return td;
  };

  const link = el('a', 'docs-open', row.control || 'Not numbered');
  link.href = docHref(row.id);
  if (!row.control) link.dataset.unnumbered = '';
  link.append(el('span', 'u-vh', `, ${row.name}`));
  cell('control', 'c-table__num').append(link);
  cell('date', 'c-table__num').textContent = row.date;
  const type = el('span', 'docs-clip docs-clip--type', row.type);
  type.title = row.type;
  cell('type').append(type);
  const parties = el('span', 'docs-clip', row.parties);
  parties.title = row.parties;
  cell('parties').append(parties);
  const pages = cell('pages', 'c-table__num');
  pages.textContent = row.pages === null ? '' : String(row.pages);
  pages.dataset.pages = row.pages === null ? '' : `${row.pages} ${row.pages === 1 ? 'p.' : 'pp.'}`;

  const privilege = cell('privilege');
  if (row.privileged) privilege.append(el('span', 'c-chip c-chip--privileged', MARK_LABEL));
  else privilege.append(el('span', 'docs-none', 'None'));

  const key = cell('key');
  key.dataset.needs = 'flag'; // a member who may not mark Key loses the whole column (header.css)
  key.append(keyButton(row));

  const summary = el('span', 'docs-summary-line');
  const text = company ? el('a', 'docs-summary docs-open', row.summary) : el('span', 'docs-summary', row.summary);
  if (text instanceof HTMLAnchorElement) text.href = docHref(row.id);
  text.title = row.summary === row.name ? row.name : `${row.summary} (${row.name})`;
  summary.append(text);
  // Added or changed since the member's last visit (D17); a state, not decoration. Always built, so the room's
  // visit can move it after the table is drawn (setFresh).
  const fresh = el('span', 'c-chip', 'New');
  fresh.dataset.docsNew = '';
  fresh.hidden = !row.fresh;
  summary.append(fresh);
  if (row.counsel) summary.append(el('span', 'c-chip c-chip--counsel', 'From counsel'));
  if (row.discussion) summary.append(el('span', 'c-chip', 'Discussion'));
  cell('summary').append(summary);

  cell('bates', 'c-table__num');
  return tr;
}

function keyButton(row: DocRow): HTMLButtonElement {
  const button = el('button', 'c-button c-button--quiet docs-key');
  button.type = 'button';
  button.dataset.docsKey = row.id;
  button.setAttribute('aria-pressed', String(row.key));
  button.setAttribute('aria-label', `Key: ${row.control || row.name}`);
  button.title = 'Key';
  button.append(targetBadge('docs-key__badge'));
  return button;
}

/** Shows or hides a row's New chip. */
export function setFresh(tr: HTMLTableRowElement, fresh: boolean): void {
  const chip = tr.querySelector<HTMLElement>('[data-docs-new]');
  if (chip) chip.hidden = !fresh;
}

/** Sets a toggle button's aria-pressed to match its on or off state. */
export function setKeyPressed(button: HTMLButtonElement, on: boolean): void {
  button.setAttribute('aria-pressed', String(on));
}

/** The index as nested lists of links to #<folder path>, with "All documents" first. */
export function buildIndexList(list: HTMLElement, index: readonly IndexFolder[], total: number): void {
  const item = (path: string, number: string, label: string, count: number) => {
    const li = el('li', 'docs-index__item');
    const a = el('a', 'docs-index__link');
    a.href = `#${encodeURIComponent(path)}`;
    a.dataset.folder = path;
    a.append(el('span', 'docs-index__num', number));
    a.append(el('span', 'docs-index__label', label), el('span', 'docs-index__count', count.toLocaleString('en-US')));
    li.append(a);
    return li;
  };
  const branch = (folders: readonly IndexFolder[], into: HTMLElement) => {
    for (const folder of folders) {
      const li = item(folder.path, folder.number, folder.label, folder.count);
      if (folder.children.length) {
        const sub = el('ul', 'docs-index__list docs-index__list--sub');
        branch(folder.children, sub);
        li.append(sub);
      }
      into.append(li);
    }
  };
  list.replaceChildren(item('', '', 'All documents', total));
  branch(index, list);
}

/** The phone's folder select: the same index, flat, indented by depth. */
export function buildFolderSelect(select: HTMLSelectElement, index: readonly IndexFolder[], total: number): void {
  const option = (value: string, text: string) => {
    const node = el('option', undefined, text);
    node.value = value;
    return node;
  };
  select.replaceChildren(option('', `All documents, ${total.toLocaleString('en-US')}`));
  for (const { folder, depth } of flattenIndex(index)) {
    const indent = ' '.repeat(depth);
    select.append(option(folder.path, `${indent}${folder.number ? `${folder.number} ` : ''}${folder.label}, ${folder.count}`));
  }
}

/** Marks the selected folder in the index and the select. */
export function markFolder(list: HTMLElement, select: HTMLSelectElement, path: string): void {
  for (const link of list.querySelectorAll<HTMLAnchorElement>('a[data-folder]')) {
    if (link.dataset.folder === path) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  }
  select.value = path;
}

/** One facet choice in the filter: its group, value and label. */
export interface FacetOption {
  group: FacetGroup;
  value: string;
  label: string;
}

const TYPE_LIMIT = 6;

/** The facet boxes: Type (most common first), Privilege (a case room's only), Marked. Counts are filled by updateFacets. */
export function buildFacets(holder: HTMLElement, types: readonly string[], company = false): void {
  const groups: { group: FacetGroup; legend: string; options: FacetOption[] }[] = [
    { group: 'type', legend: 'Type', options: types.map((t) => ({ group: 'type', value: t, label: t })) },
    {
      group: 'privilege',
      legend: 'Privilege',
      options: [
        { group: 'privilege', value: 'none', label: UNMARKED_LABEL },
        { group: 'privilege', value: 'privileged', label: MARK_LABEL },
      ],
    },
    {
      group: 'marks',
      legend: 'Marked',
      options: [
        { group: 'marks', value: 'key', label: 'Key' },
        { group: 'marks', value: 'discussion', label: 'Open discussion' },
        { group: 'marks', value: 'new', label: 'New since last visit' },
      ],
    },
  ];
  holder.replaceChildren(
    ...groups.filter(({ group }) => !(company && group === 'privilege')).map(({ group, legend, options }) => {
      const wrap = el('div', 'docs-facet-group');
      wrap.append(facetGroup(group, legend, options));
      return wrap;
    }),
  );
}

function facetGroup(group: FacetGroup, legend: string, options: readonly FacetOption[]): HTMLFieldSetElement {
  const fieldset = el('fieldset', 'docs-facet');
  fieldset.dataset.facetGroup = group;
  fieldset.append(el('legend', 't-label docs-facet__legend', legend));
  const list = el('ul', 'docs-facet__list');
  options.forEach((option) => {
    const li = el('li', 'docs-facet__item');
    li.dataset.facetItem = '';
    if (option.value === 'discussion') li.dataset.needs = 'readComments';
    const label = el('label', 'docs-facet__label');
    const box = el('input', 'docs-facet__box');
    box.type = 'checkbox';
    box.dataset.facet = group;
    box.value = option.value;
    const name = el('span', 'docs-facet__name', option.label);
    if (option.value === 'key') name.prepend(targetBadge('docs-facet__badge'));
    const count = el('span', 'docs-facet__count');
    count.dataset.facetCount = '';
    label.append(box, name, count);
    li.append(label);
    list.append(li);
  });
  fieldset.append(list);
  if (group === 'type' && options.length > TYPE_LIMIT) {
    const more = el('button', 'c-button c-button--quiet docs-facet__more', `Show all ${options.length} types`);
    more.type = 'button';
    more.dataset.facetMore = '';
    more.setAttribute('aria-expanded', 'false');
    fieldset.append(more);
  }
  return fieldset;
}

/**
 * Writes the counts. An option with none in scope is hidden unless it is checked; Type shows its first six
 * options in scope until "Show all" is pressed; a group with nothing to offer is hidden whole.
 */
export function updateFacets(holder: HTMLElement, counts: FacetCounts): void {
  for (const fieldset of holder.querySelectorAll<HTMLFieldSetElement>('fieldset[data-facet-group]')) {
    let shown = 0;
    for (const box of fieldset.querySelectorAll<HTMLInputElement>('input[data-facet]')) {
      const map = counts[box.dataset.facet as FacetGroup] as Map<string, number>;
      const count = map.get(box.value) ?? 0;
      const item = box.closest<HTMLElement>('[data-facet-item]')!;
      item.querySelector('[data-facet-count]')!.textContent = count.toLocaleString('en-US');
      item.hidden = count === 0 && !box.checked;
      if (item.hidden) continue;
      shown += 1;
      item.toggleAttribute('data-overflow', fieldset.dataset.facetGroup === 'type' && shown > TYPE_LIMIT);
    }
    const more = fieldset.querySelector<HTMLButtonElement>('[data-facet-more]');
    if (more) {
      more.hidden = shown <= TYPE_LIMIT;
      if (more.getAttribute('aria-expanded') !== 'true') more.textContent = `Show all ${shown} types`;
    }
    fieldset.parentElement!.hidden = shown === 0;
  }
}

/** The folder's CLAUDE.md as a closed "Folder guide"; rendered as Markdown the first time it opens. */
export function guideBlock(guideId: string): HTMLDetailsElement {
  const details = el('details', 'docs-guide');
  // Under the Documents h1, so the guide's headings start at h2 like any file shown in the room (R83, R89).
  const body = el('div', 'docs-guide__body markdown-body markdown-body--shifted', 'Loading the guide.');
  details.append(el('summary', 'docs-guide__summary', 'Folder guide'), body);
  let loaded = false;
  details.addEventListener('toggle', async () => {
    if (!details.open || loaded) return;
    loaded = true;
    try {
      const [{ renderUnderPageTitle }, { sanitizeInto }, response] = await Promise.all([
        import('./markdown.ts'),
        import('./safe-html.ts'),
        // A guide that stalls says it did not load rather than "Loading the guide." for ever.
        fetch(fileUrl(guideId), { credentials: 'same-origin', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
      ]);
      if (!response.ok) throw new Error(String(response.status));
      sanitizeInto(body, renderUnderPageTitle(await response.text()));
    } catch {
      loaded = false;
      body.textContent = 'The guide did not load; close it and try again.';
    }
  });
  return details;
}
