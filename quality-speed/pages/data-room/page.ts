// SPDX-License-Identifier: Apache-2.0
// The Data room page: rings per room type, a 4 by 4 heatmap for each, a drill-down per cell, Road to 100, and one company's
// life as an infographic. Everything is worked out from the scored metrics, so it can't disagree with the score.
import type { Metric } from '../../contract/format.ts';
import type { PageContext, PageOutput } from '../../core/build.ts';
import { dataTable, esc, filmstrip, fmtValue, heatLegend, heatmap, icon, metricTile, pictogram, ring, roadTo100, scoreBand, tileRow, type FilmFrame, type HeatCell, type RoadFixProps, type SketchKind } from '../../core/charts/index.ts';
import { provenance, sr } from '../../core/charts/svg.ts';
import type { GroupScore, Reading } from '../../core/score.ts';
import { EXCLUDED, GOALS, LINKED_PAGES, metricsOfCell, ROOMS, ROWS, USERS, WORK, type Evidence, type Goal, type Room, type WorkKey } from './list.ts';

const ISSUES = 'https://github.com/Colorado-Startups/legallas/issues';
const ROOM_LABEL: Record<Room, string> = { forming: 'Forming', vc: 'VCs', angel: 'Angels', dispute: 'Dispute' };
const USER_AXIS = [
  { id: 'founder', label: 'Founder' },
  { id: 'counsel', label: 'Counsel' },
  { id: 'investor', label: 'Investor' },
  { id: 'ai', label: 'Connected AI', short: 'AI' },
];
const GOAL_AXIS = [
  { id: 'find', label: 'Find it fast', short: 'Find' },
  { id: 'trust', label: 'Answers you can trust', short: 'Trust' },
  { id: 'leak', label: 'Nothing leaks', short: 'Leaks' },
  { id: 'complete', label: 'Complete and in order', short: 'Order' },
  { id: 'cost', label: 'Runner minutes', short: 'Cost' },
];
const SKETCH: Record<Goal, SketchKind> = { find: 'search', trust: 'answer', leak: 'blocked', complete: 'checklist', cost: 'log' };

const labelOf = (axis: readonly { id: string; label: string }[], id: string) => axis.find((item) => item.id === id)?.label ?? id;
const LINKED_LABEL: Record<keyof typeof LINKED_PAGES, string> = { ai: 'AI connectors', sync: 'Sync', templates: 'Templates', launch: 'Launch readiness' };
const ROW = new Map(ROWS.map((row) => [row.id, row]));

/** A metric with what the scorer made of its reading. */
type Scored = Metric & { score: number; reading: Reading };

function scored({ metrics, score }: PageContext): Map<string, Scored> {
  const reads = new Map(score.metrics.map((m) => [m.id, m]));
  return new Map(metrics.map((m) => {
    const s = reads.get(m.id);
    return [m.id, { ...m, score: s?.score ?? 0, reading: s?.reading ?? 'missing' }];
  }));
}

/** A cell's score: its metrics' weighted average, or null when none has a reading. */
export function cellScore(ids: readonly string[], metrics: ReadonlyMap<string, Pick<Scored, 'weight' | 'score'> & { reading: string }>): number | null {
  const rows = ids.flatMap((id) => metrics.get(id) ?? []);
  if (rows.length === 0 || rows.every((r) => r.reading === 'missing')) return null;
  const weight = rows.reduce((sum, r) => sum + r.weight, 0);
  return Math.floor(rows.reduce((sum, r) => sum + r.weight * r.score, 0) / weight);
}

/** Connected AI's cell, from the AI page's rings. */
export function aiCell(goal: Goal, ai: Pick<GroupScore, 'quality' | 'speed' | 'consumption'>): number {
  if (goal === 'find') return ai.speed;
  if (goal === 'cost') return ai.consumption;
  return ai.quality;
}

/** Which fix a row is waiting for: the last issue it names, the live room, or nothing but being below goal today. */
export function fixOf(evidence: Evidence): WorkKey {
  if ('after' in evidence) return evidence.after.at(-1) ?? 'now';
  return 'answers' in evidence ? 'live' : 'now';
}

const issueLink = (key: WorkKey) => {
  const work: { label: string; issue?: number } = WORK[key];
  return work.issue ? { ref: `#${work.issue}`, href: `${ISSUES}/${work.issue}` } : {};
};

/** The points each fix adds to the page's rings, from what its rows are still short of. */
export function roadFixes(metrics: readonly Scored[], groups: readonly Pick<GroupScore, 'id' | 'weight'>[]): (RoadFixProps & { c: number })[] {
  const share = new Map(groups.map((g) => [g.id, g.weight]));
  const lensWeight = (group: string | undefined, lens: string) => metrics.filter((m) => m.group === group && m.lens === lens).reduce((sum, m) => sum + m.weight, 0);
  const short = metrics.filter((m) => m.score < 100);
  return (Object.keys(WORK) as WorkKey[]).flatMap((key) => {
    const rows = short.filter((m) => fixOf(ROW.get(m.id)!.evidence) === key); // safe: every metric is on the list
    if (rows.length === 0) return [];
    const gain = (lens: string) =>
      rows.filter((m) => m.lens === lens).reduce((sum, m) => sum + (((share.get(m.group ?? '') ?? 0) / 100) * m.weight * (100 - m.score)) / lensWeight(m.group, lens), 0);
    const fix = {
      id: key,
      label: WORK[key].label,
      q: Math.round(gain('quality') * 100) / 100,
      s: Math.round(gain('speed') * 100) / 100,
      c: Math.round(gain('consumption') * 100) / 100,
      ...issueLink(key),
    };
    return [fix];
  });
}

const rowLabel = (m: Scored) => m.id.split('.')[3]!.replaceAll('_', ' ').replace(/ p\d\d$/, ''); // safe: ids have four parts

/** A timed row. Sketches, not screenshots: nothing reaches the site that its guard can't read as text. */
function frame(m: Scored): FilmFrame {
  const sketch = SKETCH[m.id.split('.')[2] as Goal];
  if (m.reading !== 'measured') return { label: rowLabel(m), sketch, state: 'stop', ...issueLink(fixOf(ROW.get(m.id)!.evidence)) }; // safe: every metric is on the list
  return { label: rowLabel(m), sketch, ms: m.value, budgetMs: m.goal };
}

/** A row with no time: its reading, red until it reaches its goal. With no reading, it links to the fix it's waiting for. The date is on the panel. */
function tile(m: Scored): string {
  if (m.reading === 'measured' && m.score < 100) {
    // safe: a measured row has a value and a run link
    return `<a class="qs-tile is-missing" href="${esc(m.source_url!)}"><span class="qs-tile-label">${esc(rowLabel(m))}</span><span class="qs-tile-empty">${icon('alert')}<span>${esc(fmtValue(m.value!, m.unit))}</span></span></a>`;
  }
  const link = m.reading === 'measured' ? m.source_url : issueLink(fixOf(ROW.get(m.id)!.evidence)).href; // safe: every metric is on the list
  return metricTile({ ...m, measured_at: null, source_url: link ?? null }, rowLabel(m), { reading: m.reading });
}

/** A cell's drill-down: its timed rows as a filmstrip, the rest as tiles. */
function panel(id: string, title: string, score: number | null, rows: readonly Scored[]): string {
  const stage = rows.some((r) => r.stage === 'live') ? 'live' : 'lab';
  const time = rows.flatMap((r) => (r.measured_at ? [r.measured_at.slice(0, 10)] : [])).sort().at(-1);
  const timed = rows.filter((m) => m.unit === 'ms');
  const tiles = tileRow(rows.filter((m) => m.unit !== 'ms').map(tile));
  if (timed.length > 0) return `${filmstrip({ id, title, score, frames: timed.map(frame), stage, open: true, ...(time ? { time } : {}) })}${timed.length < rows.length ? tiles : ''}`;
  const chip = score === null ? `<span class="qs-heat-step qs-h0">${icon('alert')}${sr('Missing')}</span>` : `<span class="qs-heat-step qs-h${scoreBand(score)}">${score}</span>`;
  return `<section class="qs-film is-open" id="${esc(id)}" aria-label="${esc(title)}"><header class="qs-film-head">${chip}<h3>${esc(title)}</h3>${provenance(time, stage)}</header>${tiles}</section>`;
}

const panelId = (cell: string) => `j-${cell.replaceAll('.', '-')}`;

function roomBlock(room: Room, share: number, metrics: ReadonlyMap<string, Scored>, others: PageContext['others']): { map: string; panels: Record<string, string> } {
  const panels: Record<string, string> = {};
  const ai = others?.[LINKED_PAGES.ai];
  const cells: HeatCell[] = USERS.flatMap((user) =>
    GOALS.map((goal): HeatCell => {
      const key = `${room}.${user}.${goal}`;
      if (user === 'ai') return { row: user, col: goal, score: ai ? aiCell(goal, ai) : null, href: `../${LINKED_PAGES.ai}/` };
      if (key in EXCLUDED) return { row: user, col: goal, score: null, excluded: true };
      const ids = metricsOfCell(key);
      const score = cellScore(ids, metrics);
      const title = `${ROOM_LABEL[room]}: ${labelOf(USER_AXIS, user)}, ${labelOf(GOAL_AXIS, goal)}`;
      panels[panelId(key)] = `<nav><a href="./#room-${room}">Data room</a></nav><main>${panel(panelId(key), title, score, ids.flatMap((id) => metrics.get(id) ?? []))}</main>`;
      return { row: user, col: goal, score, href: `${panelId(key)}.html` };
    }),
  );
  const measuredLive = [...metrics.values()].some((m) => m.group === room && m.stage === 'live' && m.reading === 'measured');
  return {
    map: `<div id="room-${room}">${heatmap({ title: ROOM_LABEL[room], note: `${share}% ${measuredLive ? 'live' : 'lab'}`, rows: USER_AXIS, cols: GOAL_AXIS, cells })}</div>`,
    panels,
  };
}

/** Small rings: the page ring above carries the Quality and Speed key, so each room's would only repeat it. */
function roomRings({ score }: PageContext): string {
  return `<div class="qs-ring-row">${score.groups.map((g) => ring({ id: g.id, q: g.quality, s: g.speed, total: g.total, size: 'sm', label: ROOM_LABEL[g.id as Room], note: `${g.weight}%`, href: `#room-${g.id}` })).join('')}</div>`;
}

function linkedRings(others: PageContext['others']): string {
  return `<div class="qs-ring-row">${Object.entries(LINKED_PAGES).map(([key, page]) => {
    const s = others?.[page];
    return ring({ id: key, q: s?.quality ?? null, s: s?.speed ?? null, total: s?.total ?? null, size: 'sm', label: LINKED_LABEL[key as keyof typeof LINKED_PAGES], href: `../${page}/` });
  }).join('')}</div>`;
}

/** One company's life: the agreements it forms, the folders it raises with, the record it would fight with. */
function oneCompany(metrics: ReadonlyMap<string, Scored>): string {
  const share = (id: string, total: number) => {
    const m = metrics.get(id);
    return m?.reading === 'measured' && m.value !== null ? Math.round((m.value / 100) * total) : 0;
  };
  const dispute = [...metrics.values()].filter((m) => m.group === 'dispute' && m.id.includes('.complete.'));
  return `<div class="qs-grid qs-grid-3">${[
    pictogram({ label: 'Form', total: 36, filled: share('forming.founder.complete.checklist_items_guided', 36), glyph: 'doc' }),
    pictogram({ label: 'Raise', total: 10, filled: share('vc.member.complete.investor_folders_present', 10), glyph: 'check' }),
    pictogram({ label: 'Dispute', total: dispute.length, filled: dispute.filter((m) => m.score === 100).length, glyph: 'lock' }),
  ].join('')}</div>`;
}

export function render(context: PageContext): PageOutput {
  const metrics = scored(context);
  const blocks = ROOMS.map((room) => roomBlock(room, context.score.groups.find((g) => g.id === room)?.weight ?? 0, metrics, context.others));
  const first = context.history[0];
  // `c` reaches the road once core's roadTo100 takes it (#449); until then it is an extra key on a variable, which TypeScript allows.
  const now = { q: context.score.exact_quality, s: context.score.exact_speed, c: context.score.exact_consumption, total: context.score.total };
  const fixes = roadFixes([...metrics.values()], context.score.groups);
  const road = roadTo100({
    baseline: first ? { q: first.quality, s: first.speed, total: first.total } : now,
    now,
    fixes,
  });
  const table = dataTable({
    caption: 'Every metric',
    columns: [
      { key: 'metric', label: 'Metric' },
      { key: 'value', label: 'Now', type: 'num' },
      { key: 'goal', label: 'Goal', type: 'num' },
      { key: 'score', label: 'Score', type: 'score' },
      { key: 'stage', label: 'Stage' },
      { key: 'state', label: 'State' },
    ],
    rows: [...metrics.values()].map((m) => ({ metric: m.id, value: m.value, goal: m.goal, score: Math.floor(m.score), stage: m.stage, state: m.reading })),
  });
  return {
    body: `${roomRings(context)}<section><h2>Every journey</h2>${heatLegend()}<div class="qs-grid qs-grid-2">${blocks.map((b) => b.map).join('')}</div></section>${road}<p><a href="company.html">One company</a> · <a href="metrics.html">Every metric</a> · <a href="linked.html">Linked pages</a></p>`,
    pages: {
      metrics: `<nav><a href="./">Data room</a></nav><main>${table}</main>`,
      // The pages this one leans on, a click away: their rings would push the first view past its byte budget.
      linked: `<nav><a href="./">Data room</a></nav><main>${linkedRings(context.others)}</main>`,
      // Its own page, so its icons stay out of the first view's byte budget.
      company: `<nav><a href="./">Data room</a></nav><main><section><h2>One company</h2>${oneCompany(metrics)}</section></main>`, ...Object.assign({}, ...blocks.map((b) => b.panels)) },
  };
}
