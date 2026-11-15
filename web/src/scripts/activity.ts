// SPDX-License-Identifier: Apache-2.0
// The owner's activity page: reads the filters from the URL, loads /api/activity a page at a time and
// renders rows with textContent only. Counsel see a one-sentence no-access state: /api/me says they
// cannot view activity, so the page never asks (the API would answer 403); an older Worker's 403 shows the same.
import { el } from './dom-el.ts';
import { controlPrefix, formatControl } from './doc-facts.ts';
import { actionLabel, dailyCounts, formatWhen, SPARK_DAYS, sparkSummary, sparkValues } from './activity-model.ts';
import { meCan } from './room-me.ts';
import { renderSpark } from './viz/spark.ts';
import { summarizeUserAgent } from '../../worker/user-agent.ts';

interface Row {
  ts: string;
  email: string;
  action: string;
  document_id: string | null;
  document_name: string | null;
  /** documents.control_seq; null for sign-ins and documents not numbered yet. */
  control_seq?: number | null;
  /** The AI client that acted ("Harvey"), or how a room row was made ("index-csv", the Documents index export). */
  via?: string | null;
  ip: string | null;
  user_agent: string | null;
  country: string | null;
}

interface Page {
  rows: Row[];
  next: string | null;
  people: { email: string; name: string | null }[];
}

const FILTERS = ['email', 'action', 'from', 'to'] as const;
const SPARK_W = 300;
const SPARK_H = 32;

const part = <T extends Element = HTMLElement>(name: string) => document.querySelector<T>(`[data-activity-${name}]`)!; // safe: activity.astro renders every part
const panel = part('panel');
const form = part<HTMLFormElement>('filters');
const people = part<HTMLDataListElement>('people');
const status = part('status');
const results = part('results');
const rows = part<HTMLTableSectionElement>('rows');
const more = part<HTMLButtonElement>('more');
const empty = part('empty');
const denied = part('denied');
const spark = part('spark');
const sparkChart = part('spark-chart');
const sparkTitle = part('spark-title');
const sparkText = part('spark-summary');

const params = new URLSearchParams(location.search);
const prefix = controlPrefix();
const names = new Map<string, string>();
const loaded: string[] = [];
let next: string | null = null;

function documentCell(entry: Row): HTMLTableCellElement {
  if (!entry.document_id) return el('td', { class: 'act-doc' });
  const control = formatControl(prefix, entry.control_seq);
  const number = control ? el('span', { class: 'c-table__num act-doc__control' }, control) : null;
  if (entry.document_name === null) {
    return el('td', { class: 'act-doc' }, number, el('span', { class: 'act-doc__gone' }, 'Removed document'));
  }
  const href = `/doc/?id=${encodeURIComponent(entry.document_id)}`;
  return el('td', { class: 'act-doc' }, el('a', { href, class: 'act-doc__link' }, number, el('span', { class: 'act-doc__name', title: entry.document_name }, entry.document_name)));
}

/**
 * The via chip's words: the Documents index export and the audit log copy (downloads with no document) read as words;
 * an AI app's name (legallas-mcp rows, always about a document) shows as it is, so an app cannot pose as the export.
 */
const ROOM_VIA: Record<string, string> = { 'index-csv': 'Documents index (CSV)', 'audit-log': 'Audit log copy' };

function viaLabel(entry: Row): string | null {
  if (!entry.via) return null;
  const room = Object.hasOwn(ROOM_VIA, entry.via) && entry.action === 'download' && entry.document_id === null;
  return room ? ROOM_VIA[entry.via]! : entry.via;
}

function row(entry: Row): HTMLTableRowElement {
  const when = el('time', { datetime: entry.ts, title: `${entry.ts.replace('T', ' ').slice(0, 19)} UTC` });
  when.textContent = formatWhen(new Date(entry.ts));
  const who = names.get(entry.email);
  const browser = el('td', entry.user_agent ? { title: entry.user_agent } : {}, summarizeUserAgent(entry.user_agent));
  const via = viaLabel(entry);
  return el(
    'tr',
    { 'data-action': entry.action },
    el('td', { class: 'c-table__num' }, when),
    el('td', { class: 'act-who' }, who ? el('span', { title: entry.email }, who) : entry.email),
    el('td', { class: 'act-what' }, el('span', {}, actionLabel(entry.action)), via ? el('span', { class: 'act-via' }, via) : null),
    documentCell(entry),
    el(
      'td',
      { class: 'act-from' },
      entry.country ? el('span', {}, entry.country) : null,
      entry.ip ? el('span', { class: 'u-mono act-ip' }, entry.ip) : null,
    ),
    browser,
  );
}

// The sparkline counts the rows already loaded for this view; days the next page could still reach are left out of the line.
function drawSpark(): void {
  const today = new Date().toISOString().slice(0, 10);
  const days = dailyCounts(loaded, today, next !== null);
  const signIns = params.get('action') === 'sign_in';
  const summary = sparkSummary(days, signIns ? 'sign-ins' : 'entries');
  const title = signIns ? 'Sign-ins per day' : 'Activity per day';
  const first = days.find((d) => d.complete)?.day;
  const last = days[SPARK_DAYS - 1]!.day; // safe: dailyCounts always returns SPARK_DAYS days
  sparkChart.replaceChildren();
  renderSpark(sparkChart, sparkValues(days), { width: SPARK_W, height: SPARK_H, label: title, from: first, to: last });
  sparkTitle.textContent = title;
  sparkText.textContent = summary;
  spark.hidden = false;
}

function showError(text: string): void {
  status.textContent = text;
  more.disabled = false;
}

function showDenied(): void {
  panel.hidden = true;
  denied.hidden = false;
}

async function load(cursor: string | null): Promise<void> {
  const query = new URLSearchParams();
  for (const name of FILTERS) {
    const value = params.get(name)?.trim();
    if (value) query.set(name, value);
  }
  if (cursor) query.set('before', cursor);
  more.disabled = true;
  status.textContent = 'Loading activity.';

  let response: Response;
  try {
    response = await fetch(`/api/activity?${query}`, { credentials: 'same-origin' });
  } catch {
    return showError('The room did not answer; reload the page to try again.');
  }
  if (response.status === 403) return showDenied();
  panel.hidden = false;
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { field?: string };
    const field = body.field === 'cursor' ? 'page' : body.field;
    return showError(field ? `That ${field} filter is not valid; clear the filters to start again.` : 'The activity log did not load; reload the page to try again.');
  }

  const page = (await response.json()) as Page;
  if (!cursor) {
    for (const person of page.people) {
      if (person.name) names.set(person.email, person.name);
      people.append(el('option', { value: person.email }, person.name ?? person.email));
    }
  }
  rows.append(...page.rows.map(row));
  loaded.push(...page.rows.map((entry) => entry.ts));
  next = page.next;
  const shown = rows.childElementCount;
  results.hidden = shown === 0;
  empty.hidden = shown > 0;
  more.hidden = next === null;
  more.disabled = false;
  status.textContent = shown === 0 ? '' : `Showing ${shown} ${shown === 1 ? 'entry' : 'entries'}${next ? '' : ', the full record'}.`;
  if (shown > 0) drawSpark();
  else spark.hidden = true;
}

// Put the current filters back into the form.
for (const name of FILTERS) {
  const field = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
  if (field) field.value = params.get(name) ?? '';
}
more.addEventListener('click', () => void load(next));

/** The ledger is the owner's: ask /api/me first (shared with the header), and request /api/activity only if allowed. */
async function start(): Promise<void> {
  if (!(await meCan('viewActivity'))) return showDenied();
  await load(null);
}
void start();

export {};
