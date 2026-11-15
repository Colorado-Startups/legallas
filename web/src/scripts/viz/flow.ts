// SPDX-License-Identifier: Apache-2.0
// Card F5b (Charts viz). Money flows in the record: payers on the left, payees on the right, one ribbon per
// payer and payee pair, its thickness the sum of the cited amounts. Ribbons are d3-shape horizontal links drawn as
// thick strokes in the payer's side color; nodes carry their side's color and shape. `aggregateFlows` and
// `layoutFlow` are pure (flow.test.ts). Amounts are whole cents until the label. One chart is one money series
// (R43): promises and movements are never summed together, and a set that mixes them is refused. Entries with no
// kind, or no payer or payee, are listed in the table and never charted.

import { linkHorizontal } from 'd3-shape';
import type { MoneyFact } from '../../../worker/matter-types.ts';
import { assertOneSeries, SERIES_SUM, SERIES_WORDS, seriesOf, unchartedReason, type MoneySeries } from './money.ts';
import {
  assertCents, createFrame, fillTable, fitLabel, formatCount, formatUsd, formatUsdCompact, hideTip, linearNext,
  observeWidth, rovingFocus, shapeSvg, showTip, svg, SERIES_ORDER, type ChartHandle, type Frame, type MarkSide,
} from './core.ts';

/** A party in the money flow: its name and side. */
export interface FlowParty { name: string; side: MarkSide }

/** One money flow from one party to another, in cents. */
export interface FlowEdge {
  from: string;
  to: string;
  cents: number;
  /** MoneyFact ids, in input order. */
  facts: string[];
}

/**
 * Sums one series' entries by payer and payee. Throws on a set that holds the other series, and on an amount that
 * is not whole cents. Entries with no kind, or a null payer or payee, are skipped (they belong in the table).
 */
export function aggregateFlows(money: MoneyFact[], series: MoneySeries): FlowEdge[] {
  assertOneSeries(money, series, 'aggregateFlows');
  const byPair = new Map<string, FlowEdge>();
  for (const fact of money) {
    assertCents(fact.amountCents, fact.id);
    if (fact.amountCents <= 0 || unchartedReason(fact) || seriesOf(fact.kind) !== series) continue;
    const from = fact.from as string; // safe: unchartedReason refuses a null payer
    const to = fact.to as string; // safe: and a null payee
    const key = `${from}\u0000${to}`;
    const edge = byPair.get(key) ?? { from, to, cents: 0, facts: [] };
    edge.cents += fact.amountCents;
    edge.facts.push(fact.id);
    byPair.set(key, edge);
  }
  return [...byPair.values()];
}

/** A node of the flow chart: its column, amount in cents and vertical extent. */
export interface FlowNode { id: string; column: 0 | 1; cents: number; y0: number; y1: number }
/** A ribbon of the flow chart: its edge, width, end positions and path. */
export interface FlowLink { edge: FlowEdge; width: number; sy: number; ty: number; d: string }
/** The computed flow layout: its size, its nodes and its ribbons. */
export interface FlowLayout { width: number; height: number; nodeW: number; nodes: FlowNode[]; links: FlowLink[] }

/** The width of a flow node, in pixels. */
export const NODE_W = 8;
const NODE_PAD = 14;
const MIN_RIBBON = 2;
const ROW_PER_NODE = 30;

const SIDE_RANK = new Map<MarkSide, number>([...SERIES_ORDER, 'filing', 'none'].map((s, i) => [s as MarkSide, i]));

function columnNodes(edges: FlowEdge[], column: 0 | 1, sideOf: (id: string) => MarkSide): FlowNode[] {
  const totals = new Map<string, number>();
  for (const e of edges) {
    const id = column === 0 ? e.from : e.to;
    totals.set(id, (totals.get(id) ?? 0) + e.cents);
  }
  return [...totals].map(([id, cents]) => ({ id, column, cents, y0: 0, y1: 0 }))
    .sort((a, b) => (SIDE_RANK.get(sideOf(a.id)) ?? 9) - (SIDE_RANK.get(sideOf(b.id)) ?? 9) || b.cents - a.cents || a.id.localeCompare(b.id));
}

/**
 * Places payers and payees in two columns ordered by side, then amount. Ribbon thickness is proportional to the
 * amount with a 2px floor, so a small payment stays visible; the table carries exact figures.
 */
export function layoutFlow(edges: FlowEdge[], width: number, sideOf: (id: string) => MarkSide): FlowLayout {
  const left = columnNodes(edges, 0, sideOf);
  const right = columnNodes(edges, 1, sideOf);
  const total = edges.reduce((a, e) => a + e.cents, 0);
  const rows = Math.max(left.length, right.length, 1);
  const avail = Math.max(rows * ROW_PER_NODE - (rows - 1) * NODE_PAD, 40);
  const k = total > 0 ? avail / total : 0;
  const thick = (e: FlowEdge) => Math.max(MIN_RIBBON, e.cents * k);
  const stackColumn = (nodes: FlowNode[], pick: (e: FlowEdge) => string) => {
    let y = 0;
    for (const n of nodes) {
      const h = edges.filter((e) => pick(e) === n.id).reduce((a, e) => a + thick(e), 0);
      n.y0 = y;
      n.y1 = y + h;
      y += h + NODE_PAD;
    }
    return y - NODE_PAD;
  };
  const height = Math.max(stackColumn(left, (e) => e.from), stackColumn(right, (e) => e.to), 0);
  const leftAt = new Map(left.map((n) => [n.id, n]));
  const rightAt = new Map(right.map((n) => [n.id, n]));
  const sAt = (e: FlowEdge) => leftAt.get(e.from)?.y0 ?? 0;
  const tAt = (e: FlowEdge) => rightAt.get(e.to)?.y0 ?? 0;
  const sOff = new Map<string, number>();
  const tOff = new Map<string, number>();
  const bySource = [...edges].sort((a, b) => sAt(a) - sAt(b) || tAt(a) - tAt(b));
  const byTarget = [...edges].sort((a, b) => tAt(a) - tAt(b) || sAt(a) - sAt(b));
  const sy = new Map<FlowEdge, number>();
  const ty = new Map<FlowEdge, number>();
  for (const e of bySource) {
    const at = sOff.get(e.from) ?? leftAt.get(e.from)?.y0 ?? 0;
    sy.set(e, at + thick(e) / 2);
    sOff.set(e.from, at + thick(e));
  }
  for (const e of byTarget) {
    const at = tOff.get(e.to) ?? rightAt.get(e.to)?.y0 ?? 0;
    ty.set(e, at + thick(e) / 2);
    tOff.set(e.to, at + thick(e));
  }
  const link = linkHorizontal<{ s: [number, number]; t: [number, number] }, [number, number]>().source((l) => l.s).target((l) => l.t);
  const links = bySource.map((e) => {
    const s: [number, number] = [NODE_W, sy.get(e) ?? 0];
    const t: [number, number] = [width - NODE_W, ty.get(e) ?? 0];
    return { edge: e, width: thick(e), sy: s[1], ty: t[1], d: link({ s, t }) ?? '' };
  });
  return { width, height, nodeW: NODE_W, nodes: [...left, ...right], links };
}

/** A chosen flow: its two parties, its amount in cents and its facts. */
export interface FlowSelection { from: string; to: string; cents: number; facts: string[] }

/** Options for drawing a money flow chart: its title and the one money series it shows. */
export interface FlowOptions {
  title: string;
  /** The one money series this chart shows (R43). */
  series: MoneySeries;
  /** Defaults to what the ribbons add up: "Sum of cited payments." or "Sum of cited commitments and calls." */
  caption?: string;
  /** Names and sides by person or org id. Unknown ids show as "Not stated". */
  parties: Record<string, FlowParty>;
  onSelect?: (selection: FlowSelection) => void;
}

const PAD_Y = 8;

/** Draws the flow chart. `money` is the matter's money facts (or a filtered slice). */
export function renderFlow(container: HTMLElement, money: MoneyFact[], opts: FlowOptions): ChartHandle {
  const edges = aggregateFlows(money, opts.series);
  const frame = createFrame(container, { title: opts.title, caption: opts.caption ?? SERIES_SUM[opts.series] });
  const party = (id: string | null): FlowParty => (id && opts.parties[id]) || { name: 'Not stated', side: 'none' };
  const sideOf = (id: string) => party(id).side;
  flowTable(frame, `${opts.title} (${SERIES_WORDS[opts.series].toLowerCase()})`, edges, money.filter((f) => unchartedReason(f)), party);
  const draw = (width: number) => {
    const layout = layoutFlow(edges, width, sideOf);
    const h = layout.height + PAD_Y * 2;
    const root = svg('svg', { class: 'viz-svg viz-flow', width, height: h, viewBox: `0 ${-PAD_Y} ${width} ${h}`, role: 'group', 'aria-label': opts.title });
    const marks = layout.links.map((l) => drawLink(root, frame, l, party, opts));
    for (const n of layout.nodes) drawNode(root, n, layout, party(n.id));
    rovingFocus(marks, linearNext(marks.length), () => {});
    frame.plot.replaceChildren(root);
  };
  const stop = observeWidth(frame.plot, draw);
  return { frame, destroy: () => { stop(); frame.destroy(); } };
}

function drawLink(root: SVGSVGElement, frame: Frame, l: FlowLink, party: (id: string) => FlowParty, opts: FlowOptions): SVGPathElement {
  const from = party(l.edge.from);
  const to = party(l.edge.to);
  const n = l.edge.facts.length;
  const label = `${from.name} to ${to.name}: ${formatUsd(l.edge.cents)} in ${formatCount(n)} ${n === 1 ? 'entry' : 'entries'}`;
  const path = svg('path', {
    class: 'viz-flow__link', 'data-side': from.side, d: l.d, 'stroke-width': Math.round(l.width * 100) / 100,
    role: opts.onSelect ? 'button' : 'img', 'aria-label': label,
  }, root);
  const show = () => showTip(frame, path, `${from.name} to ${to.name}`, [{ value: formatUsd(l.edge.cents), label: `${formatCount(n)} ${n === 1 ? 'entry' : 'entries'}`, side: from.side }]);
  path.addEventListener('pointerenter', show);
  path.addEventListener('focus', show);
  path.addEventListener('pointerleave', () => hideTip(frame));
  path.addEventListener('blur', () => hideTip(frame));
  if (opts.onSelect) {
    const select = () => opts.onSelect?.({ from: l.edge.from, to: l.edge.to, cents: l.edge.cents, facts: [...l.edge.facts] });
    path.addEventListener('click', select);
    path.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } });
  }
  return path;
}

function drawNode(root: SVGSVGElement, n: FlowNode, layout: FlowLayout, p: FlowParty): void {
  const left = n.column === 0;
  const x = left ? 0 : layout.width - layout.nodeW;
  svg('rect', { class: 'viz-flow__node viz-mark', 'data-side': p.side, x, y: n.y0, width: layout.nodeW, height: Math.max(n.y1 - n.y0, 1), 'aria-hidden': 'true' }, root);
  const mid = (n.y0 + n.y1) / 2;
  const shapeX = left ? layout.nodeW + 12 : layout.width - layout.nodeW - 12;
  shapeSvg(p.side, 12, root, shapeX, mid);
  const textX = left ? shapeX + 10 : shapeX - 10;
  const room = layout.width / 2 - layout.nodeW - 32;
  const text = svg('text', { class: 'viz-flow__label', x: textX, y: mid + 4, 'text-anchor': left ? 'start' : 'end', 'aria-hidden': 'true' }, root);
  const amount = formatUsdCompact(n.cents);
  svg('tspan', { class: 'viz-flow__name' }, text).textContent = fitLabel(p.name, Math.max(room - amount.length * 7 - 6, 24));
  svg('tspan', { class: 'viz-flow__amount', dx: 6 }, text).textContent = amount;
}

/** The table twin: charted pairs (with a total of this one series), then each listed-only entry and why. */
function flowTable(frame: Frame, title: string, edges: FlowEdge[], listed: MoneyFact[], party: (id: string | null) => FlowParty): void {
  const sorted = [...edges].sort((a, b) => b.cents - a.cents);
  const rows = sorted.map((e) => [party(e.from).name, party(e.to).name, formatCount(e.facts.length), formatUsd(e.cents), '']);
  const total = edges.reduce((a, e) => a + e.cents, 0);
  const count = edges.reduce((a, e) => a + e.facts.length, 0);
  if (rows.length > 1) rows.push(['Total', '', formatCount(count), formatUsd(total), '']);
  for (const f of listed) rows.push([party(f.from).name, party(f.to).name, '1', formatUsd(f.amountCents), `Not charted: ${unchartedReason(f)?.toLowerCase()}`]);
  fillTable(frame.tableWrap, title, [{ label: 'From' }, { label: 'To' }, { label: 'Entries', num: true }, { label: 'Amount', num: true }, { label: 'Note' }], rows);
}
