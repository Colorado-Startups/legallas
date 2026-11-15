// SPDX-License-Identifier: Apache-2.0
// The Projects page: the board's cards, from the admin job's read-out, as numbers only. The built-in token can't read an
// organization's project, so the admin job reads it with BOARD_QUERY and saves the raw `gh api --include` answer. Until
// that file exists, or when it is old, refused, cut short or malformed, every reading is unmeasured, never good news.
import { wordsIn } from '../../contract/words.ts';
import type { Detail, Reading as DetailReading } from '../../core/detail.ts';

/** The read-out the admin job writes, under `$KEY_JOB_OUTPUT_DIR/admin-read/`. */
export const READ_OUT = 'projects-board.txt';
/** The org's Legallas board, as the orchestrator named it (draft 117's `backlog_board`). */
export const ORG = 'Colorado-Startups';
export const BOARD_NUMBER = 1;
/** One night's read-out, plus room for a late run. */
export const MAX_AGE_HOURS = 30;
/** Clock drift allowed for a Date header ahead of this run's clock. */
const DRIFT_MS = 5 * 60_000;
/** The board's Status columns, in flow order. A board with none of them has a renamed field or columns, so nothing on it can be read. */
export const STAGES = ['backlog', 'ready', 'in progress', 'in review', 'done'] as const;
export type Stage = (typeof STAGES)[number];
/** Started and not finished: what the work-in-progress limit and the age count. */
const ACTIVE: readonly Stage[] = ['in progress', 'in review'];
/** A card's words outside tables, code blocks and `<details>`: past this it isn't a visual card. */
export const MAX_CARD_WORDS = 30;
const HOUR = 3_600_000;

/**
 * What the admin job sends: `gh api graphql --paginate --include -f query=<BOARD_QUERY> -F org=<ORG> -F number=<BOARD_NUMBER>`.
 * The board holds more than 100 cards, so gh walks every page and prints each one's status, headers and JSON in turn.
 */
export const BOARD_QUERY = `query($org: String!, $number: Int!, $endCursor: String) {
  organization(login: $org) {
    projectV2(number: $number) {
      items(first: 100, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name updatedAt } }
          order: fieldValueByName(name: "Order") { ... on ProjectV2ItemFieldNumberValue { number } }
          stage: fieldValueByName(name: "Stage") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          codebase: fieldValueByName(name: "Codebase") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          pr: fieldValueByName(name: "PR") { ... on ProjectV2ItemFieldNumberValue { number } }
          content {
            __typename
            ... on DraftIssue { body }
            ... on PullRequest { body mergedAt state }
            ... on Issue { body state closedByPullRequestsReferences(first: 10, includeClosedPrs: true) { pageInfo { hasNextPage } nodes { mergedAt } } }
          }
        }
      }
      views(first: 20) {
        totalCount
        nodes {
          name layout filter
          sortByFields(first: 10) { nodes { direction field { ... on ProjectV2FieldCommon { name } } } }
          groupByFields(first: 10) { nodes { ... on ProjectV2FieldCommon { name } } }
          verticalGroupByFields(first: 10) { nodes { ... on ProjectV2FieldCommon { name } } }
          fields(first: 50) { nodes { ... on ProjectV2FieldCommon { name } } }
        }
      }
    }
  }
}`;

export interface ReadOut {
  status: number | null;
  /** When GitHub answered, from its own header. */
  date: string | null;
  body: unknown;
}

/** A raw `gh api --paginate --include` read-out: one page per status line, each with headers, a blank line and its JSON. */
export function parseReadOut(text: string): ReadOut[] {
  return text.replace(/\r\n/g, '\n').split(/^(?=HTTP\/)/m).filter((page) => page.trim() !== '').map(parsePage);
}

/** One page: a status line, headers, a blank line and the JSON. Anything else has no body. */
function parsePage(normal: string): ReadOut {
  const split = normal.indexOf('\n\n');
  const head = split < 0 ? normal : normal.slice(0, split);
  const status = /^HTTP\/[\d.]+ (\d{3})/.exec(head)?.[1];
  let body: unknown = null;
  if (split >= 0) {
    try {
      body = JSON.parse(normal.slice(split + 2));
    } catch {
      body = null;
    }
  }
  return { status: status ? Number(status) : null, date: /^date:\s*(.+)$/im.exec(head)?.[1]?.trim() ?? null, body };
}

/** A card, as numbers and flags: its column, when it moved there, its fields, and what its body looks like. */
export interface Card {
  column: string | null;
  movedAt: string | null;
  /** Order is set. */
  ordered: boolean;
  /** Stage or Codebase is set. */
  tagged: boolean;
  /** Its body opens with a markdown table or a mermaid block. */
  visual: boolean;
  /** Words outside tables, code blocks, `<details>`, comments and links' addresses. */
  words: number;
  /** A merged pull request carries it (the card is one, or one closes its issue), or its PR field is set. */
  linked: boolean;
  /** Its issue or pull request is closed or merged; null for a draft or a hidden card, which has no state. */
  closed: boolean | null;
}

/** Opens with a markdown table (a row, then its `|---|` line) or a mermaid block. */
export function opensVisual(body: string): boolean {
  const [first = '', second = ''] = body.replace(/\r\n/g, '\n').trimStart().split('\n');
  if (/^```mermaid\b/.test(first)) return true;
  return first.startsWith('|') && /^[\s|:-]+$/.test(second) && second.includes('|') && second.includes('-');
}

/** The words a reader meets as prose: tables, code blocks, `<details>`, comments and links' addresses left out. */
export function proseWords(body: string): number {
  const prose = body
    .replace(/\r\n/g, '\n')
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/<details\b[\s\S]*?(<\/details>|$)/gi, ' ')
    .replace(/<!--[\s\S]*?(-->|$)/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('|'))
    .join('\n');
  return wordsIn(prose);
}

const time = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
type Field = { number?: unknown; name?: unknown } | null | undefined;
const numberSet = (f: Field) => typeof f?.number === 'number' && Number.isFinite(f.number);
const nameSet = (f: Field) => typeof f?.name === 'string' && f.name.trim() !== '';

/** One page's cards, or null when it is refused, old or malformed, or its "more pages" flag is not `more`. */
function pageNodes(page: ReadOut, now: number, more: boolean): unknown[] | null {
  const age = page.date ? now - Date.parse(page.date) : Number.NaN;
  if (page.status !== 200 || !(age >= -DRIFT_MS && age <= MAX_AGE_HOURS * HOUR)) return null;
  const body = page.body as { errors?: unknown; data?: { organization?: { projectV2?: { items?: unknown } } } } | null;
  const items = body?.data?.organization?.projectV2?.items as { pageInfo?: { hasNextPage?: unknown }; nodes?: unknown } | undefined;
  if (!body || body.errors !== undefined || !items || items.pageInfo?.hasNextPage !== more || !Array.isArray(items.nodes)) return null;
  return items.nodes;
}

interface Node {
  status?: { name?: unknown; updatedAt?: unknown } | null;
  order?: Field;
  stage?: Field;
  codebase?: Field;
  pr?: Field;
  content?: Record<string, unknown> | null;
}

/**
 * The board's cards, or null when the read-out can't prove the whole board: refused, old, cut short or malformed. Every page
 * but the last says more follow, and the last says none do.
 */
export function cards(readOut: ReadOut[] | null, now: number): Card[] | null {
  if (!readOut?.length) return null;
  const nodes: unknown[] = [];
  for (const [i, page] of readOut.entries()) {
    const some = pageNodes(page, now, i < readOut.length - 1);
    if (some === null) return null;
    nodes.push(...some);
  }
  const out: Card[] = [];
  for (const node of nodes as Node[]) {
    if (typeof node !== 'object' || node === null) return null;
    const status = node.status ?? null;
    if (status !== null && (typeof status.name !== 'string' || !time(status.updatedAt))) return null;
    const content = node.content ?? null;
    const kind = content?.__typename;
    // A card GitHub hides from the token has no content, so no body.
    const body = kind === 'Issue' || kind === 'PullRequest' || kind === 'DraftIssue' ? content?.body : '';
    if (typeof body !== 'string') return null;
    const refs = kind === 'Issue' ? (content?.closedByPullRequestsReferences as { pageInfo?: { hasNextPage?: unknown }; nodes?: unknown } | undefined) : undefined;
    // A second page of linked pull requests could hold the merged one, so the card can't be read whole.
    if (kind === 'Issue' && refs?.pageInfo?.hasNextPage !== false) return null;
    const prs = kind === 'PullRequest' ? [content] : (refs?.nodes ?? []);
    if (!Array.isArray(prs) || !prs.every((pr: { mergedAt?: unknown }) => pr?.mergedAt === null || time(pr?.mergedAt))) return null;
    const state = kind === 'Issue' || kind === 'PullRequest' ? content?.state : null;
    if (state !== null && !['OPEN', 'CLOSED', 'MERGED'].includes(state as string)) return null;
    const prNumber = node.pr?.number;
    out.push({
      column: status ? (status.name as string) : null,
      movedAt: status ? (status.updatedAt as string) : null,
      ordered: numberSet(node.order),
      tagged: nameSet(node.stage) || nameSet(node.codebase),
      visual: opensVisual(body),
      words: proseWords(body),
      linked: prs.some((pr: { mergedAt: string | null }) => pr.mergedAt !== null) || (Number.isInteger(prNumber) && (prNumber as number) > 0),
      closed: state === null ? null : state !== 'OPEN',
    });
  }
  return out;
}

const is = (card: Card, column: string) => card.column?.trim().toLowerCase() === column;
const hoursIn = (card: Card, now: number) => (now - Date.parse(card.movedAt as string)) / HOUR;

/** What each stage's cards must have, by check id: the stage strip's columns. Done cards only need their pull request. */
export function checksFor(stage: Stage, ageGoalHours: number, now: number): Record<string, (c: Card) => boolean> {
  if (stage === 'done') return { pr: (c) => c.linked };
  const open = { order: (c: Card) => c.ordered, tag: (c: Card) => c.tagged, visual: (c: Card) => c.visual, short: (c: Card) => c.words <= MAX_CARD_WORDS };
  return ACTIVE.includes(stage) ? { ...open, age: (c: Card) => hoursIn(c, now) <= ageGoalHours } : open;
}

/** A reading: a value and how many cards it rests on, or null when it can't be measured. */
export interface Reading {
  value: number | null;
  sample: number;
}

export const METRICS = ['in_progress', 'done_with_pr', 'cards_ready', 'oldest_active_hours', 'views_correct', 'status_matches_state'] as const;

/** A saved view, as names only: its layout, filter, sort (`<field> <ASC|DESC>`), table groups, board columns and fields shown. */
export interface View {
  name: string;
  layout: string;
  filter: string;
  sort: string[];
  group: string[];
  columns: string[];
  fields: string[];
}

/** The board's three views, as set up (#846): what each must show. A view may show more fields than these. */
export const VIEW_SPECS: readonly View[] = [
  { name: 'Board', layout: 'BOARD_LAYOUT', filter: '', sort: ['Order ASC'], group: [], columns: ['Status'], fields: ['Title', 'Stage', 'Order', 'Codebase', 'PR'] },
  { name: 'Backlog', layout: 'TABLE_LAYOUT', filter: 'status:Backlog,Ready', sort: ['Order ASC'], group: ['Status'], columns: [], fields: ['Title', 'Status', 'Stage', 'Order', 'Codebase', 'PR'] },
  { name: 'Done', layout: 'TABLE_LAYOUT', filter: 'status:Done', sort: [], group: [], columns: [], fields: ['Title', 'Status', 'Stage', 'Order', 'Codebase', 'PR'] },
];

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** A view matches its spec: same layout, filter, sort and grouping, and every spec field shown. */
export function viewMatches(view: View | undefined, spec: View): boolean {
  if (!view) return false;
  return (
    view.layout === spec.layout && view.filter.trim() === spec.filter && same(view.sort, spec.sort) && same(view.group, spec.group) &&
    same(view.columns, spec.columns) && spec.fields.every((f) => view.fields.includes(f))
  );
}

const names = (conn: unknown): string[] | null => {
  const nodes = (conn as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) return null;
  const out = nodes.map((n: { name?: unknown } | null) => n?.name);
  return out.every((n) => typeof n === 'string') ? (out as string[]) : null;
};

/** The board's saved views, from the first page of a read-out that proves the whole board; null when they can't be read whole. */
export function views(readOut: ReadOut[] | null, now: number): View[] | null {
  if (cards(readOut, now) === null) return null;
  const conn = (readOut?.[0]?.body as { data?: { organization?: { projectV2?: { views?: { totalCount?: unknown; nodes?: unknown } } } } } | null)?.data?.organization?.projectV2?.views;
  if (!conn || !Array.isArray(conn.nodes) || conn.totalCount !== conn.nodes.length) return null;
  const out: View[] = [];
  for (const v of conn.nodes as Record<string, unknown>[]) {
    if (typeof v?.name !== 'string' || typeof v.layout !== 'string' || typeof v.filter !== 'string') return null;
    const sortNodes = (v.sortByFields as { nodes?: unknown } | null)?.nodes;
    if (!Array.isArray(sortNodes)) return null;
    const sort = sortNodes.map((n: { direction?: unknown; field?: { name?: unknown } | null } | null) => `${n?.field?.name} ${n?.direction}`);
    const group = names(v.groupByFields);
    const columns = names(v.verticalGroupByFields);
    const fields = names(v.fields);
    if (group === null || columns === null || fields === null) return null;
    out.push({ name: v.name, layout: v.layout, filter: v.filter, sort, group, columns, fields });
  }
  return out;
}

/**
 * Every metric's reading from the board and its views. No board read, or a board with none of its known columns, is
 * unmeasured; so are views that can't be read whole.
 */
export function readings(board: Card[] | null, now: number, saved: View[] | null = null): Map<string, Reading> {
  const none = { value: null, sample: 0 };
  const placed = (board ?? []).filter((c) => c.column !== null);
  if (board === null || !placed.some((c) => STAGES.some((s) => is(c, s)))) return new Map<string, Reading>(METRICS.map((id) => [id, none]));
  const pct = (part: number, whole: number) => Math.round((10000 * part) / whole) / 100;
  const done = placed.filter((c) => is(c, 'done'));
  const open = placed.filter((c) => !is(c, 'done'));
  const active = placed.filter((c) => ACTIVE.some((s) => is(c, s)));
  const ready = open.filter((c) => c.ordered && c.tagged && c.visual && c.words <= MAX_CARD_WORDS);
  // Work Item Age: the oldest started card, since its Status last changed. None started is 0.
  const oldest = Math.max(0, ...active.map((c) => hoursIn(c, now)));
  // The built-in workflows' job: Done when its issue or pull request is closed or merged, and not Done while it is open.
  const tracked = placed.filter((c) => c.closed !== null);
  const agree = tracked.filter((c) => is(c, 'done') === c.closed);
  const matching = saved === null ? 0 : VIEW_SPECS.filter((spec) => viewMatches(saved.find((v) => v.name === spec.name), spec)).length;
  return new Map<string, Reading>([
    ['in_progress', { value: active.length, sample: placed.length }],
    ['done_with_pr', done.length ? { value: pct(done.filter((c) => c.linked).length, done.length), sample: done.length } : none],
    ['cards_ready', open.length ? { value: pct(ready.length, open.length), sample: open.length } : none],
    ['oldest_active_hours', { value: Math.round(oldest * 100) / 100, sample: placed.length }],
    ['views_correct', saved === null ? none : { value: pct(matching, VIEW_SPECS.length), sample: VIEW_SPECS.length }],
    ['status_matches_state', tracked.length ? { value: pct(agree.length, tracked.length), sample: tracked.length } : none],
  ]);
}

/** A stage's id in detail.json: `in progress` is `in_progress`. */
export const stageId = (stage: Stage) => stage.replace(' ', '_');

/**
 * The stage strip's numbers, for detail.json (core/detail.ts): `<stage>` is its card count, and `<stage>_<check>` how many of
 * them pass that check, out of `n`. Counts only, never a title.
 */
export function stageDetail(board: Card[], now: number, ageGoalHours: number): Detail {
  const readings: Record<string, DetailReading> = {};
  for (const stage of STAGES) {
    const here = board.filter((c) => is(c, stage));
    const n = here.length;
    readings[stageId(stage)] = { value: n, limit: null, n };
    for (const [check, pass] of Object.entries(checksFor(stage, ageGoalHours, now))) {
      readings[`${stageId(stage)}_${check}`] = { value: here.filter(pass).length, limit: null, n };
    }
  }
  return { checks: {}, readings };
}
