// SPDX-License-Identifier: Apache-2.0
// The checklist page (src/pages/checklist.astro): each item's status, where its documents live, its guidance and sources;
// matching a document by hand; saying an item doesn't apply. What a person typed is shown with textContent only (dom-el.ts).
import type { ChecklistStatus, ServedItem, ServedMatch, SignedState } from '../../worker/checklist.ts';
import type { CompanyView, ServedChecklist } from '../../worker/company-settings.ts';
import { companyLine, dateRow, formingLine, monthName, SIGNED_LABELS, stageRow, STATUS_LABELS } from './checklist-parts.ts';
import { groupingOf, GROUPINGS, groupItems, STATUS_MEANINGS } from './checklist-groups.ts';
import { controlPrefix, formatControl } from './doc-facts.ts';
import { el } from './dom-el.ts';
import { ROOM_FETCH_HEADERS, showSessionEnded } from './session-ended.ts';
import { pageHref as templateHref } from './template-page-model.ts';

const part = (name: string) => document.querySelector<HTMLElement>(`[data-checklist-${name}]`)!; // safe: checklist.astro renders every part
const status = part('status');
const prefix = controlPrefix();
const SAVE_FAILED = 'That did not save. Reload the page and try again.';
const CHECK_DATES = "A date can't be right, and a date filed can't be in the future. Check it and save again.";

const FILTERS: readonly ('all' | ChecklistStatus)[] = ['all', 'missing', 'check', 'in_place', 'if_applies', 'not_applicable', 'not_yet'];
const shown = new URLSearchParams(location.search).get('show');
const filter = FILTERS.find((each) => each === shown) ?? 'all';
const grouping = groupingOf(new URLSearchParams(location.search).get('group'));

/** The page's address with the filter and the grouping a person chose; the stage view and "all" are the page's own address. */
function pageHref(show: string, group: string): string {
  const query = new URLSearchParams();
  if (show !== 'all') query.set('show', show);
  if (group !== 'stage') query.set('group', group);
  return query.size ? `/checklist/?${query}` : '/checklist/';
}
/** The items open now, kept across a reload of the list so saving doesn't close what someone is reading. */
const openItems = new Set<string>();
/** A template's readable page (src/pages/template.astro) from its file's href, /templates/<path>. */
function templatePageHref(href: string): string {
  return href.startsWith('/templates/') ? templateHref(href.slice('/templates/'.length)) : href;
}

/** The template lines the list carries (docs/legal/product-notices.md, A5), set when it loads. */
const notices = { list: '', card: '', licence: '' };

async function send(path: string, method: string, body?: unknown): Promise<Response | null> {
  try {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { ...ROOM_FETCH_HEADERS, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 401) showSessionEnded();
    return response;
  } catch {
    return null;
  }
}

/** Sends a change, then reloads the list; a failure is said on `line`, with `control` usable again. */
function change(control: HTMLButtonElement, line: HTMLElement, path: string, method: string, body?: unknown): void {
  control.disabled = true;
  void send(path, method, body).then(async (response) => {
    if (response?.ok) return load();
    control.disabled = false;
    line.textContent = response?.status === 400 ? CHECK_DATES : SAVE_FAILED;
  });
}

let documents: Promise<[folder: string, files: { id: string; name: string }[]][] | null> | null = null;

/** Every document this member can see by folder, fetched once, the first time someone opens a form. */
function loadDocuments(): NonNullable<typeof documents> {
  interface Folder {
    path: string;
    files?: { id: string; name: string }[];
    folders?: Folder[];
  }
  const flatten = (folder: Folder): [string, { id: string; name: string }[]][] => [
    ...(folder.files?.length ? [[folder.path, folder.files] as [string, { id: string; name: string }[]]] : []),
    ...(folder.folders ?? []).flatMap(flatten),
  ];
  documents ??= fetch('/api/documents', { credentials: 'same-origin', headers: ROOM_FETCH_HEADERS })
    .then((response) => (response.ok ? (response.json() as Promise<{ root: Folder }>) : null))
    .then((body) => (body ? flatten(body.root) : null))
    .catch(() => null);
  return documents;
}

function factLine(item: ServedItem, match: ServedMatch): string {
  return [
    match.signed ? SIGNED_LABELS[match.signed] : 'Not known if signed',
    match.date && `${item.dateLabel}: ${match.date}`,
    match.parties && `Parties: ${match.parties}`,
    match.amount && `Amount: ${match.amount}`,
    match.nextDate && `Next date: ${match.nextDate}`,
  ].filter(Boolean).join(' · ');
}

const field = (label: string, control: HTMLElement, wide = false) =>
  el('label', { class: `cl-field${wide ? ' cl-field--wide' : ''}` }, el('span', { class: 't-caption' }, label), control);

/** The form for a new match, or with `existing`, for changing the facts of one. */
function matchForm(item: ServedItem, existing?: ServedMatch): HTMLElement {
  const picker = el('select', { class: 'c-input', required: '' }, el('option', { value: '' }, 'Loading the documents.'));
  const signed = el(
    'select',
    { class: 'c-input' },
    el('option', { value: '' }, 'Not known'),
    ...(Object.keys(SIGNED_LABELS) as SignedState[]).map((state) => el('option', { value: state }, SIGNED_LABELS[state])),
  );
  signed.value = existing?.signed ?? '';
  const input = (type: string, value: string | null | undefined, max?: string) => {
    const control = el('input', { class: 'c-input', type, maxlength: max });
    control.value = value ?? '';
    return control;
  };
  const date = input('date', existing?.date);
  const nextDate = input('date', existing?.nextDate);
  const parties = input('text', existing?.parties, '500');
  const amount = input('text', existing?.amount, '100');
  const save = el('button', { type: 'submit', class: 'c-button c-button--primary' }, 'Save');
  const line = el('span', { class: 't-caption', role: 'status' });
  const form = el(
    'form',
    { class: 'cl-form' },
    existing ? null : field('Document', picker, true),
    field('Signed', signed),
    field(item.dateLabel, date),
    field('Parties', parties, true),
    field('Amount', amount),
    field('Next date, such as a renewal or maturity', nextDate),
    el('p', { class: 'cl-actions cl-field--wide' }, save, line),
  );
  if (!existing) {
    void loadDocuments().then((folders) =>
      picker.replaceChildren(
        el('option', { value: '' }, folders === null ? 'The documents did not load. Reload the page to try again.' : folders.length ? 'Choose a document.' : 'No documents in the room yet.'),
        ...(folders ?? []).map(([folder, files]) => el('optgroup', { label: folder || 'Top of the folder' }, ...files.map((file) => el('option', { value: file.id }, file.name)))),
      ),
    );
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const facts = { signed: signed.value, date: date.value, nextDate: nextDate.value, parties: parties.value, amount: amount.value };
    // Changing a match sends every fact, so one can be cleared. A new match sends what was filled in, so picking a document
    // already matched here keeps its facts.
    const sent = existing ? facts : Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== ''));
    change(save, line, '/api/checklist/matches', 'POST', { itemId: item.id, documentId: existing?.documentId ?? picker.value, ...sent });
  });
  return form;
}

function matchBlock(item: ServedItem, match: ServedMatch): HTMLElement {
  const control = formatControl(prefix, match.control);
  const label = `${control ? `${control} ` : ''}${match.where}`;
  const box = el(
    'div',
    { class: 'cl-match' },
    el('p', { class: 't-small cl-match__where' }, match.href ? el('a', { href: match.href }, label) : label),
    el('p', { class: 't-small' }, match.href ? factLine(item, match) : 'This file has left the folder, so it no longer counts.'),
    el('p', { class: 't-caption' }, `Matched by ${match.matchedBy}.`),
  );
  const remove = el('button', { type: 'button', class: 'c-button c-button--quiet' }, 'Remove this match');
  const line = el('span', { class: 't-caption', role: 'status' });
  remove.addEventListener('click', () => change(remove, line, `/api/checklist/matches/${encodeURIComponent(match.id)}`, 'DELETE'));
  box.append(el('p', { class: 'cl-actions' }, remove, line));
  if (match.href) box.append(el('details', { class: 't-small' }, el('summary', {}, 'Change the facts'), matchForm(item, match)));
  return box;
}

/** "Match a document", opened on demand: the form asks for the room's whole document list. */
function newMatch(item: ServedItem): HTMLElement {
  const box = el('details', { class: 'cl-new' }, el('summary', { class: 'c-button' }, 'Match a document'));
  box.addEventListener('toggle', () => {
    if (box.open && box.children.length === 1) box.append(matchForm(item));
  });
  return box;
}

function appliesControl(item: ServedItem): HTMLElement {
  const applies = item.status === 'not_applicable';
  const button = el('button', { type: 'button', class: 'c-button c-button--quiet' }, applies ? 'This does apply' : "This doesn't apply");
  const line = el('span', { class: 't-caption', role: 'status' });
  button.addEventListener('click', () => change(button, line, `/api/checklist/items/${encodeURIComponent(item.id)}/applies`, 'PUT', { applies }));
  return el('p', { class: 'cl-actions' }, button, line);
}

function itemRow(item: ServedItem): HTMLLIElement {
  const heading = (text: string) => el('h4', { class: 'cl-subhead t-small' }, text);
  const text = (value: string | null, lead = '') => (value ? el('p', { class: 't-small' }, `${lead}${value}`) : null);
  const live = item.matches.filter((match) => match.href !== null);
  const body = el(
    'div',
    { class: 'cl-body' },
    text(item.why),
    text(item.appliesWhen),
    text(item.deadline, 'Deadline: '),
    item.note ? el('p', { class: 't-small cl-note' }, item.note) : null,
    text(item.repeats, 'Repeats: '),
    item.dates.length ? el('ul', { class: 'cl-dates' }, ...item.dates.map((date) => dateRow(date, { withTitle: false, withBasis: true }))) : null,
    text(item.dateHint),
    heading('Where it lives'),
    item.matches.length ? null : text('Nothing in the room is matched to this.'),
    ...item.matches.map((match) => matchBlock(item, match)),
    newMatch(item),
    live.length ? null : appliesControl(item),
    heading('What a complete copy looks like'),
    text(item.evidence),
    heading('Who usually provides it'),
    text(item.providedBy.join(', ')),
    item.templates.length ? heading('Templates') : null,
    item.templates.length ? text(notices.list) : null,
    ...item.templates.map((template) =>
      el(
        'div',
        { class: 'cl-match' },
        el(
          'p',
          { class: 't-small' },
          el('a', { href: templatePageHref(template.href) }, template.title),
          ' · ',
          el('a', { href: template.href, download: template.href.slice(template.href.lastIndexOf('/') + 1) }, 'Download'),
        ),
        el('p', { class: 't-caption' }, `Source: ${template.source}${template.version ? ` · Version ${template.version}` : ''}`),
        el('p', { class: 't-caption' }, notices.licence),
        el('p', { class: 't-caption' }, `Law checked: ${template.lawChecked}. Written for: ${template.writtenFor.join(', ')}`),
        el('p', { class: 't-caption' }, notices.card),
      ),
    ),
    heading('Sources'),
    el('ul', { class: 'cl-list t-small' }, ...item.sources.map((source) => el('li', {}, el('a', { href: source.url, rel: 'noopener noreferrer', target: '_blank' }, source.title)))),
  );
  const where = live.length
    ? el('span', { class: 't-caption cl-item__where' }, ...live.flatMap((match, i) => [i > 0 ? ' · ' : null, el('a', { href: match.href as string }, match.where)]))
    : null;
  const details = el(
    'details',
    { class: 'cl-item', id: item.id },
    el('summary', {}, el('span', { class: `c-chip cl-status--${item.status}` }, STATUS_LABELS[item.status]), el('span', { class: 'cl-item__title t-small' }, item.title, where)),
    body,
  );
  details.open = openItems.has(item.id);
  details.addEventListener('toggle', () => void (details.open ? openItems.add(item.id) : openItems.delete(item.id)));
  return el('li', {}, details);
}

/**
 * The owner's form for the company's facts (worker/company-settings.ts). Saving reloads the list, so its items and dates
 * follow. A blank choice clears the fact.
 */
function companyForm(company: CompanyView): HTMLFormElement {
  const choose = (blank: string, options: [value: string, label: string][], value: string) => {
    const control = el('select', { class: 'c-input' }, el('option', { value: '' }, blank), ...options.map(([id, label]) => el('option', { value: id }, label)));
    control.value = value;
    return control;
  };
  const entityType = choose('Not set: every item shows', company.entityTypes.map((type): [string, string] => [type.id, type.label]), company.entityType ?? '');
  const formationDate = el('input', { class: 'c-input', type: 'date' });
  formationDate.value = company.formationDate ?? '';
  const months = Array.from({ length: 12 }, (_, i): [string, string] => [String(i + 1), monthName(i + 1)]);
  const reportMonth = choose('Not set', months, company.reportMonth ? String(company.reportMonth) : '');
  const save = el('button', { type: 'submit', class: 'c-button c-button--primary' }, 'Save');
  const line = el('span', { class: 't-caption', role: 'status' });
  const form = el(
    'form',
    { class: 'cl-form' },
    field('Entity type', entityType),
    field('Formation date', formationDate),
    field("Colorado periodic report month, from the state's record", reportMonth, true),
    el('p', { class: 'cl-actions cl-field--wide' }, save, line),
    company.setBy ? el('p', { class: 't-caption cl-field--wide' }, `Last set by ${company.setBy}.`) : null,
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    change(save, line, '/api/checklist/company', 'PUT', { entityType: entityType.value, formationDate: formationDate.value, reportMonth: reportMonth.value });
  });
  return form;
}

function render(view: ServedChecklist): void {
  notices.list = view.templateNotice;
  notices.card = view.templateCardNotice;
  notices.licence = view.templateLicenceNotice;
  part('notice').replaceChildren(el('p', {}, view.notice), el('p', {}, view.status), el('p', {}, `Covers: ${view.scope}.`));
  part('notice').hidden = false;
  part('forming').textContent = formingLine(view.stages);
  part('company').textContent = companyLine(view);
  // Only the room owner may change the facts (auth.ts setCompany); everyone else reads them on the line above.
  part('company-edit').hidden = !view.company.editable;
  if (view.company.editable) part('company-form').replaceChildren(companyForm(view.company));
  part('stages').replaceChildren(...view.stages.map(stageRow));
  const dates = view.dates.filter((date) => date.state !== 'done');
  part('dates').replaceChildren(...dates.map((date) => dateRow(date, { withTitle: true, withBasis: true })));
  part('no-dates').hidden = dates.length > 0;
  part('filters').replaceChildren(
    ...FILTERS.map((each) => {
      const label = `${each === 'all' ? 'All' : STATUS_LABELS[each]} ${each === 'all' ? view.items.length : view.counts[each]}`;
      return el('a', { class: 'c-button c-button--quiet', href: pageHref(each, grouping), 'aria-current': each === filter ? 'page' : undefined }, label);
    }),
  );
  part('grouping').replaceChildren(
    ...GROUPINGS.map((each) => el('a', { class: 'c-button c-button--quiet', href: pageHref(filter, each.id), 'aria-current': each.id === grouping ? 'page' : undefined }, each.label)),
  );
  part('key').replaceChildren(...FILTERS.slice(1).flatMap((each) => [el('dt', {}, STATUS_LABELS[each as ChecklistStatus]), el('dd', {}, STATUS_MEANINGS[each as ChecklistStatus])]));
  const items = filter === 'all' ? view.items : view.items.filter((item) => item.status === filter);
  part('groups').replaceChildren(
    ...groupItems(view, items, grouping).map((group) => {
      const held = group.items;
      const box = el('details', { class: 'cl-group' }, el('summary', {}, el('h3', { class: 't-h2' }, `${group.label} (${held.length})`)), el('ul', { class: 'cl-items' }, ...held.map(itemRow)));
      // A later stage starts closed, unless a filter asked for it or it holds a document someone matched.
      box.open = filter !== 'all' || group.active || held.some((item) => openItems.has(item.id) || item.matches.length > 0);
      return box;
    }),
  );
  part('none').hidden = items.length > 0;
  part('view').hidden = false;
  status.textContent = '';
}

/** Opens the item a link points at, and the group around it. */
function openLinked(): void {
  const id = decodeURIComponent(location.hash.slice(1));
  const target = id ? document.getElementById(id) : null;
  if (!(target instanceof HTMLDetailsElement)) return;
  target.open = true;
  const group = target.closest<HTMLDetailsElement>('.cl-group');
  if (group) group.open = true;
  target.scrollIntoView();
}

async function load(): Promise<void> {
  try {
    const response = await fetch('/api/checklist', { credentials: 'same-origin', headers: ROOM_FETCH_HEADERS });
    if (response.status === 401) showSessionEnded();
    if (response.status === 404) {
      status.textContent = '';
      part('off').hidden = false;
      return;
    }
    if (!response.ok) throw new Error(String(response.status));
    render((await response.json()) as ServedChecklist);
  } catch {
    status.textContent = 'The checklist did not load. Reload the page to try again.';
  }
}

// A date's link on this same page changes only the hash, so the item has to open here too.
addEventListener('hashchange', openLinked);
void load().then(openLinked);
