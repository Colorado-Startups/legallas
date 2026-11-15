// SPDX-License-Identifier: Apache-2.0
// Invented board data only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Manifest, MetricRecord } from '../../contract/format.ts';
import { joinMetrics } from '../../contract/validate.ts';
import { frameWords } from '../../core/build.ts';
import { isDetail } from '../../core/detail.ts';
import { countWords, MAX_WORDS } from '../../core/guard.ts';
import { scorePage } from '../../core/score.ts';
import { cards, opensVisual, parseReadOut, proseWords, readings, stageDetail, VIEW_SPECS, views } from './board.ts';
import { records } from './collect.ts';
import { render, roadFixes } from './page.ts';

const manifest = JSON.parse(readFileSync(new URL('manifest.json', import.meta.url), 'utf8')) as Manifest;
const NOW = Date.parse('2030-03-01T12:00:00Z');
const RUN = 'https://github.com/Colorado-Startups/legallas/actions/runs/1001';
/** An invented laneRecord() for this lane, which collect.ts passes in for lane_minutes. */
const LANE: MetricRecord = { id: 'lane_minutes', page: 'projects', value: 3, status: 'ok', stage: 'lab', measured_at: '2030-03-01T12:00:00Z', source_url: RUN, sample_size: 1 };
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString();

const VISUAL = '| Goal | Customer | Files | Done when |\n|---|---|---|---|\n| Faster sign-in | Counsel | `web/` | One tap |';
const pr = (merged: boolean) => ({ mergedAt: merged ? at(1) : null });
const issue = (body: string, ...prs: unknown[]) => ({ __typename: 'Issue', body, state: 'OPEN', closedByPullRequestsReferences: { pageInfo: { hasNextPage: false }, nodes: prs } });
const closed = (body: string, ...prs: unknown[]) => ({ ...issue(body, ...prs), state: 'CLOSED' });
const draft = (body: string) => ({ __typename: 'DraftIssue', body });
const READY = { order: { number: 1 }, codebase: { name: 'legallas' } };
const node = (column: string | null, movedHoursAgo: number, content: unknown, fields: Record<string, unknown> = {}) => ({
  status: column === null ? null : { name: column, updatedAt: at(movedHoursAgo) },
  order: null,
  stage: null,
  codebase: null,
  pr: null,
  ...fields,
  content,
});

/** The saved views as GitHub answers them: VIEW_SPECS, unless a test passes others. */
const VIEWS = VIEW_SPECS.map((v) => ({
  name: v.name,
  layout: v.layout,
  filter: v.filter,
  sortByFields: { nodes: v.sort.map((s) => ({ direction: s.split(' ')[1], field: { name: s.split(' ')[0] } })) },
  groupByFields: { nodes: v.group.map((name) => ({ name })) },
  verticalGroupByFields: { nodes: v.columns.map((name) => ({ name })) },
  fields: { nodes: v.fields.map((name) => ({ name })) },
}));

function readOut(nodes: unknown[], over: { status?: number; date?: string; hasNextPage?: boolean; errors?: unknown; views?: unknown[] } = {}): string {
  const saved = over.views ?? VIEWS;
  const project = { items: { pageInfo: { hasNextPage: over.hasNextPage ?? false }, nodes }, views: { totalCount: saved.length, nodes: saved } };
  const body = { data: { organization: { projectV2: project } }, ...(over.errors ? { errors: over.errors } : {}) };
  return `HTTP/2.0 ${over.status ?? 200} OK\r\nDate: ${over.date ?? new Date(NOW - 3_600_000).toUTCString()}\r\n\r\n${JSON.stringify(body)}`;
}
const read = (nodes: unknown[]) => cards(parseReadOut(readOut(nodes)), NOW);

const BOARD = [
  node('In progress', 5, issue(VISUAL, pr(false)), READY),
  node('In review', 80, draft(VISUAL), { order: { number: 2 }, stage: { name: 'Form' } }),
  node('Backlog', 50, issue('Words only, no table.'), READY),
  node('Ready', 10, draft(VISUAL)),
  node('Done', 2, closed(VISUAL, pr(true), pr(false))),
  node('Done', 30, { __typename: 'PullRequest', body: '', mergedAt: at(31), state: 'MERGED' }),
  node('Done', 3, draft(VISUAL), { pr: { number: 812 } }),
  node('Done', 3, draft(VISUAL)),
  node(null, 0, null),
];

test('readings from an invented board: in progress or review, done with a PR, ready cards, the oldest started card', () => {
  const v = readings(read(BOARD), NOW);
  // The card with no Status is left out of every sample.
  assert.deepEqual(v.get('in_progress'), { value: 2, sample: 8 });
  // A merged pull request, the card being one, or its PR field: three of four.
  assert.deepEqual(v.get('done_with_pr'), { value: 75, sample: 4 });
  // Of four open cards, Backlog has no table first and Ready has no Order.
  assert.deepEqual(v.get('cards_ready'), { value: 50, sample: 4 });
  assert.deepEqual(v.get('oldest_active_hours'), { value: 80, sample: 8 });
  // Views only count with a read of them.
  assert.equal(v.get('views_correct')?.value, null);
  // Four cards have an issue or pull request; all agree with their Status.
  assert.deepEqual(v.get('status_matches_state'), { value: 100, sample: 4 });
});

test('views_correct: each saved view against its spec; a missing or changed view fails, an extra field does not', () => {
  const score = (saved: unknown[]) => {
    const r = parseReadOut(readOut(BOARD, { views: saved }));
    return readings(cards(r, NOW), NOW, views(r, NOW)).get('views_correct');
  };
  assert.deepEqual(score(VIEWS), { value: 100, sample: 3 });
  const [board, backlog, done] = VIEWS as [(typeof VIEWS)[number], (typeof VIEWS)[number], (typeof VIEWS)[number]];
  assert.equal(score([board, { ...backlog, filter: 'status:Backlog' }, done])?.value, 66.67);
  assert.equal(score([board, backlog, { ...done, fields: { nodes: [...done.fields.nodes, { name: 'Labels' }] } }])?.value, 100);
  assert.equal(score([{ ...board, sortByFields: { nodes: [] } }, backlog])?.value, 33.33);
  // Cut short or malformed: unmeasured, never 0 or good news.
  const r = parseReadOut(readOut(BOARD).replace('"totalCount":3', '"totalCount":4'));
  assert.equal(views(r, NOW), null);
  assert.equal(views(parseReadOut(readOut(BOARD, { views: [{ ...board, fields: null }] })), NOW), null);
  assert.equal(views(parseReadOut(readOut(BOARD, { status: 403 })), NOW), null);
});

test('status_matches_state: Done when closed or merged, not Done while open; drafts are left out', () => {
  const v = readings(read([
    node('Done', 1, issue(VISUAL)),
    node('Backlog', 1, closed(VISUAL)),
    node('In review', 1, { __typename: 'PullRequest', body: '', mergedAt: null, state: 'OPEN' }),
    node('Done', 1, { __typename: 'PullRequest', body: '', mergedAt: null, state: 'CLOSED' }),
    node('Done', 1, draft(VISUAL)),
  ]), NOW);
  assert.deepEqual(v.get('status_matches_state'), { value: 50, sample: 4 });
  assert.equal(readings(read([node('Backlog', 1, draft(VISUAL))]), NOW).get('status_matches_state')?.value, null);
  assert.equal(read([node('Done', 1, { ...issue(VISUAL), state: 'LOST' })]), null);
});

test('a visual card opens with a table or a mermaid block', () => {
  for (const body of [VISUAL, `\r\n\n${VISUAL.replace(/\n/g, '\r\n')}`, '| A |\n| :-: |', '```mermaid\nflowchart LR\n  A --> B\n```']) assert.ok(opensVisual(body), body);
  for (const body of ['', '## Goal\n' + VISUAL, '| not a table', 'Text first.\n\n' + VISUAL, '```ts\nx\n```']) assert.ok(!opensVisual(body), body);
});

test('prose words leave out tables, code, details, comments and link addresses', () => {
  const body = [VISUAL, 'Two words.', '```ts\nconst hidden = words;\n```', '<details><summary>More</summary>many hidden words</details>', '<!-- a note -->', 'See https://example.com/a/b'].join('\n');
  assert.equal(proseWords(body), 3);
  const words = (n: number) => `${VISUAL}\n${'word '.repeat(n)}`;
  assert.equal(readings(read([node('Ready', 1, draft(words(30)), READY)]), NOW).get('cards_ready')?.value, 100);
  assert.equal(readings(read([node('Ready', 1, draft(words(31)), READY)]), NOW).get('cards_ready')?.value, 0);
});

test('gh --paginate pages join into one board', () => {
  const two = `${readOut(BOARD.slice(0, 3), { hasNextPage: true })}\n${readOut(BOARD.slice(3))}`;
  assert.equal(cards(parseReadOut(two), NOW)?.length, BOARD.length);
  assert.deepEqual(readings(cards(parseReadOut(two), NOW), NOW), readings(read(BOARD), NOW));
});

test('a read-out that cannot prove the whole board is unmeasured, never good news', () => {
  const bad = [
    readOut(BOARD, { status: 403 }),
    readOut(BOARD, { date: new Date(NOW - 31 * 3_600_000).toUTCString() }),
    readOut(BOARD, { hasNextPage: true }),
    readOut(BOARD, { errors: [{ message: 'x' }] }),
    readOut([node('Done', 1, issue(VISUAL, { mergedAt: 'soon' }))]),
    readOut([node('Done', 1, { __typename: 'Issue', body: VISUAL })]),
    readOut([node('Done', 1, { ...issue(VISUAL), state: undefined })]),
    readOut([node('Done', 1, { __typename: 'DraftIssue', body: null })]),
    'HTTP/2.0 200 OK\r\n\r\nnot json',
    readOut(BOARD, { date: new Date(NOW + 3_600_000).toUTCString() }),
    readOut([node('Done', 1, { __typename: 'Issue', body: '', state: 'CLOSED', closedByPullRequestsReferences: { pageInfo: { hasNextPage: true }, nodes: [] } })]),
    `${readOut(BOARD)}\n${readOut(BOARD)}`,
    `${readOut(BOARD, { hasNextPage: true })}\n${readOut(BOARD, { status: 502 })}`,
    '',
  ];
  for (const text of bad) assert.equal(cards(parseReadOut(text), NOW), null, text.slice(0, 40));
  for (const [, r] of readings(null, NOW)) assert.equal(r.value, null);
  const recs = records(readings(null, NOW), manifest, RUN, NOW);
  assert.ok(recs.every((r) => r.status === 'missing' && r.value === null));
});

test('no done card leaves done_with_pr unmeasured, no open card cards_ready; nothing started is 0 in progress and 0 hours old', () => {
  const backlog = readings(read([node('Backlog', 1, issue(VISUAL), READY)]), NOW);
  assert.deepEqual(backlog.get('in_progress'), { value: 0, sample: 1 });
  assert.deepEqual(backlog.get('oldest_active_hours'), { value: 0, sample: 1 });
  assert.equal(backlog.get('done_with_pr')?.value, null);
  assert.equal(readings(read([node('Done', 1, closed(VISUAL, pr(true)))]), NOW).get('cards_ready')?.value, null);
});

test('renamed columns, the old Todo column, or a missing Status field read missing, never 0 in progress', () => {
  for (const column of ['Doing', 'Todo', null]) {
    for (const [, r] of readings(read(Array.from({ length: 20 }, () => node(column, 1, issue(VISUAL)))), NOW)) assert.equal(r.value, null, String(column));
  }
});

test('the stage strip: each stage\'s count and how many pass each check, counts only', () => {
  const d = stageDetail(read(BOARD) ?? [], NOW, 72);
  assert.ok(isDetail(d));
  assert.deepEqual(
    Object.fromEntries(Object.entries(d.readings).map(([id, r]) => [id, `${r.value}/${r.n}`])),
    {
      backlog: '1/1', backlog_order: '1/1', backlog_tag: '1/1', backlog_visual: '0/1', backlog_short: '1/1',
      ready: '1/1', ready_order: '0/1', ready_tag: '0/1', ready_visual: '1/1', ready_short: '1/1',
      in_progress: '1/1', in_progress_order: '1/1', in_progress_tag: '1/1', in_progress_visual: '1/1', in_progress_short: '1/1', in_progress_age: '1/1',
      in_review: '1/1', in_review_order: '1/1', in_review_tag: '1/1', in_review_visual: '1/1', in_review_short: '1/1', in_review_age: '0/1',
      done: '4/4', done_pr: '3/4',
    },
  );
});

const full = () => {
  const r = parseReadOut(readOut(BOARD));
  return readings(cards(r, NOW), NOW, views(r, NOW));
};

test('records: a run link proves a reading; without one every record is missing', () => {
  const v = full();
  assert.ok(records(v, manifest, RUN, NOW, LANE).every((r) => r.status === 'ok' && r.source_url === RUN));
  assert.deepEqual(records(v, manifest, RUN, NOW, LANE).at(-1), LANE);
  for (const run of [null, 'https://github.com/Colorado-Startups/legallas/issues/1']) {
    assert.ok(records(v, manifest, run, NOW, LANE).every((r) => r.status === 'missing'));
  }
});

test('the page: within the word budget with or without a read, a road that sums to the points short, and no fixes at goal', () => {
  const recs = records(full(), manifest, RUN, NOW, LANE);
  const score = scorePage('projects', manifest, recs, new Date(NOW));
  const metrics = joinMetrics(manifest, recs);
  for (const detail of [stageDetail(read(BOARD) ?? [], NOW, 72), null]) {
    const { body } = render({ score, metrics, history: [], others: {}, detail });
    assert.ok(countWords(body) <= MAX_WORDS - frameWords('projects'), `visible words: ${countWords(body)}`);
  }
  const missing = records(readings(null, NOW), manifest, null, NOW);
  assert.ok(countWords(render({ score: scorePage('projects', manifest, missing, new Date(NOW)), metrics: joinMetrics(manifest, missing), history: [], others: {}, detail: null }).body) <= MAX_WORDS - frameWords('projects'));
  const fixes = roadFixes(metrics, score.metrics);
  assert.ok(Math.abs(fixes.reduce((a, f) => a + f.q, 0) - (100 - score.exact_quality)) < 1e-9);
  const goal = manifest.metrics.map((d) => ({ id: d.id, page: 'projects' as const, value: d.goal, status: 'ok' as const, stage: 'live' as const, measured_at: '2030-03-01T12:00:00Z', source_url: RUN, sample_size: d.min_samples }));
  const atGoal = scorePage('projects', manifest, goal, new Date(NOW));
  assert.equal(atGoal.total, 100);
  assert.equal(atGoal.consumption, 100, 'lane_minutes at goal too');
  assert.deepEqual(roadFixes(joinMetrics(manifest, goal), atGoal.metrics), []);
});
