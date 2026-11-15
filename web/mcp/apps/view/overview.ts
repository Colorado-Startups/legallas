// SPDX-License-Identifier: Apache-2.0
// The view on legallas_case_overview (ui://legallas/overview): one HTML, three faces, picked by the result's section.
//
// | Section                                   | Face     | Copies Anthropic's | Shows                                  |
// |-------------------------------------------|----------|--------------------|----------------------------------------|
// | summary                                   | Summary  | (dashboard tiles)  | the case header, a tile per section    |
// | checklist, tracks, violations, claims, …  | Board    | Matter board       | columns by status: next step, due, cites |
// | events, money, docs                       | Timeline | Chronology         | the room's own timeline (viz/timeline.ts) |
//
// In the AI, the tabs and tiles call legallas_case_overview again through the host for another section, and "More"
// pages on with the result's cursor. In the binder the view shows the one result it was saved with.
import { createTimeline, type TimelineHandle } from '../../../src/scripts/viz/timeline.ts';
import type { MatterEvent } from '../../../worker/matter-types.ts';
import { connect, type Host, type ToolResult } from './bridge.ts';
import { board, DATED_SECTIONS, datedRows, isObj, plain, resultData, resultError, shown, words, type Card, type Cite, type Obj } from './model.ts';
import { caseText, citeChip, html, reader, retrieved, shell, type Reader } from './ui.ts';
import './views.css';

const app = document.getElementById('app')!;
let host: Host;

/** What the view holds: the section on screen, its rows so far, the cursor for more, the counts from the summary. */
const state: { section: string; entries: unknown[]; cursor: string | null; counts: Obj | null; data: Obj | null } = {
  section: 'summary', entries: [], cursor: null, counts: null, data: null,
};

/** The board's section: the company checklist when the room has one, else the tracks counsel is preparing. */
const boardSection = () => {
  const listed = state.counts?.checklist;
  return typeof listed === 'number' && listed > 0 ? 'checklist' : 'tracks';
};
const face = (section: string) => (section === 'summary' ? 'summary' : DATED_SECTIONS.has(section) ? 'timeline' : 'board');

function show(result: ToolResult, args: Obj | null): void {
  const data = resultData(result);
  if (!data) {
    const s = shell(app, 'Case overview', host);
    s.status(resultError(result) ?? 'This result has nothing to show.', 'error');
    return;
  }
  const asked = args?.section;
  const section = typeof data.section === 'string' ? data.section : typeof asked === 'string' ? asked : 'summary';
  if (isObj(data.counts)) state.counts = data.counts;
  const more = section === state.section && args?.cursor !== undefined && state.data !== null;
  state.section = section;
  state.data = data;
  state.entries = more ? [...state.entries, ...(Array.isArray(data.entries) ? data.entries : [])] : Array.isArray(data.entries) ? data.entries : [];
  state.cursor = typeof data.nextCursor === 'string' ? data.nextCursor : null;
  draw();
}

async function load(args: Obj, s: { status(text: string, kind?: 'error' | 'busy' | ''): void }): Promise<void> {
  s.status('Loading…', 'busy');
  try {
    const result = await host.callTool(host.config.tools.overview, args);
    const error = resultError(result);
    if (error) return s.status(error, 'error');
    show(result, args);
  } catch (error) {
    s.status(error instanceof Error ? error.message : 'The room did not answer.', 'error');
  }
}

function draw(): void {
  const data = state.data!;
  const s = shell(app, 'Case overview', host);
  const read = reader(s.slot, host);
  const current = face(state.section);
  if (host.mode === 'host') {
    const tabs = html('div', { class: 'v-tabs', role: 'tablist', 'aria-label': 'Views' }, s.tools);
    const tab = (label: string, which: string, section: string) => {
      const button = html('button', { type: 'button', role: 'tab', class: 'v-tab', 'aria-selected': String(current === which) }, tabs, label);
      button.addEventListener('click', () => void load({ section }, s));
    };
    tab('Summary', 'summary', 'summary');
    tab('Board', 'board', boardSection());
    tab('Timeline', 'timeline', 'events');
  }
  if (data.published === false) {
    html('p', { class: 'v-empty' }, s.body, 'No case picture is published yet. The documents are in the room.');
  } else if (current === 'summary') {
    drawSummary(s.body, data, s);
  } else if (current === 'timeline') {
    drawTimeline(s.body, read);
  } else {
    drawBoard(s.body, read);
  }
  if (state.cursor && host.mode === 'host') {
    const more = html('button', { type: 'button', class: 'v-button' }, s.foot, 'More');
    more.addEventListener('click', () => void load({ section: state.section, cursor: state.cursor }, s));
  }
  retrieved(s.foot, data);
}

/** The case header and one tile per section with its count; a tile opens its section. */
function drawSummary(body: HTMLElement, data: Obj, s: { status(text: string, kind?: 'error' | 'busy' | ''): void }): void {
  const caption = shown(data.caption);
  if (caption) {
    const head = html('section', { class: 'v-case' }, body);
    caseText(html('h2', { class: 'v-case__caption' }, head), caption);
    const facts = [plain(data.court), plain(data.caseNumber), plain(data.judge) && `Judge ${plain(data.judge)}`, plain(data.filed) && `Filed ${plain(data.filed)}`];
    html('p', { class: 'v-muted' }, head, facts.filter(Boolean).join(' · '));
  }
  const counts = isObj(data.counts) ? Object.entries(data.counts).filter(([, n]) => typeof n === 'number') : [];
  const tiles = html('div', { class: 'v-tiles' }, body);
  for (const [section, n] of counts) {
    const tile = html(host.mode === 'host' ? 'button' : 'div', { class: 'v-tile', ...(host.mode === 'host' ? { type: 'button' } : {}) }, tiles);
    html('span', { class: 'v-tile__n' }, tile, String(n));
    html('span', { class: 'v-tile__label' }, tile, words(section));
    if (host.mode === 'host' && (n as number) > 0) tile.addEventListener('click', () => void load({ section }, s));
  }
}

function cardView(parent: Element, card: Card, read: Reader): void {
  const item = html('li', { class: 'v-card', ...(card.untrusted ? { 'data-untrusted': '' } : {}) }, parent);
  const title = html('h3', { class: 'v-card__title' }, item);
  if (card.link) {
    const open = html('button', { type: 'button', class: 'v-link' }, title);
    caseText(open, card.title);
    open.addEventListener('click', () => host.openLink(card.link!));
  } else {
    caseText(title, card.title);
  }
  if (card.meta.length) html('p', { class: 'v-card__meta' }, item, card.meta.join(' · '));
  if (card.due) {
    const due = html('p', { class: 'v-due', 'data-state': card.due.state ?? 'upcoming' }, item);
    html('span', { class: 'v-due__date' }, due, card.due.date);
    if (card.due.state) html('span', { class: 'v-due__state' }, due, words(card.due.state));
  }
  if (card.next) caseText(html('p', { class: 'v-card__next' }, item), card.next);
  if (card.cites.length) {
    const cites = html('p', { class: 'v-cites' }, item);
    for (const cite of card.cites.slice(0, 4)) citeChip(cites, cite, host, read);
    if (card.cites.length > 4) html('span', { class: 'v-muted' }, cites, `+${card.cites.length - 4}`);
  }
}

/** Columns by status (checklist), kind (tracks) or the like, each card with its next step, next date and cites. */
function drawBoard(body: HTMLElement, read: Reader): void {
  const columns = board(state.entries);
  if (columns.length === 0) {
    html('p', { class: 'v-empty' }, body, `Nothing in ${words(state.section).toLowerCase()} yet.`);
    return;
  }
  html('h2', { class: 'v-sub' }, body, words(state.section));
  const grid = html('div', { class: 'v-board' }, body);
  for (const column of columns) {
    const col = html('section', { class: 'v-col', 'data-key': column.key }, grid);
    const head = html('h3', { class: 'v-col__head' }, col);
    html('span', {}, head, column.label);
    html('span', { class: 'v-col__count' }, head, String(column.cards.length));
    const list = html('ol', { class: 'v-col__cards' }, col);
    for (const card of column.cards) cardView(list, card, read);
  }
}

let timeline: TimelineHandle | null = null;

/** The room's own timeline over the section's dated rows, lanes by event type, with the picked event's cites below. */
function drawTimeline(body: HTMLElement, read: Reader): void {
  timeline?.destroy();
  timeline = null;
  const rows = datedRows(state.section, state.entries);
  if (rows.length === 0) {
    html('p', { class: 'v-empty' }, body, 'No dated entries here.');
    return;
  }
  html('h2', { class: 'v-sub' }, body, words(state.section));
  const cites = new Map<string, Cite[]>(rows.map((row) => [row.id, row.cites]));
  const events: MatterEvent[] = rows.map((row) => ({
    id: row.id, date: row.date, title: row.untrusted ? `⚠ ${row.title}` : row.title, summary: row.summary, type: row.type,
    actors: [], claims: [], cites: row.cites.map((c) => ({ doc: c.doc ?? '', page: c.page })),
  }));
  const chart = html('div', { class: 'v-timeline' }, body);
  const detail = html('section', { class: 'v-detail', 'aria-live': 'polite' }, body);
  const pick = (event: MatterEvent) => {
    detail.replaceChildren();
    html('p', { class: 'v-muted' }, detail, `${event.date} · ${words(event.type)}`);
    html('h3', { class: 'v-card__title' }, detail, event.title);
    if (event.summary) html('p', {}, detail, event.summary);
    const chips = html('p', { class: 'v-cites' }, detail);
    for (const cite of cites.get(event.id) ?? []) citeChip(chips, cite, host, read);
  };
  timeline = createTimeline(chart, {
    data: { events, people: [], orgs: [] },
    laneMode: 'type',
    label: words(state.section),
    onSelect: pick,
    renderCites: (cell, event) => {
      for (const cite of cites.get(event.id) ?? []) citeChip(cell, cite, host, read);
    },
  });
  pick(events[0]!);
}

host = connect(show);
