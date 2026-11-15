// SPDX-License-Identifier: Apache-2.0
// Card F5b (Charts viz). The People-page layers of the force graph (R46, P3's spec), drawn by force.ts when asked:
// money edges (heavy, bent right of their direction, one per pair per series; movements by default, promises
// dashed when asked for; in the payer's side color with a midpoint arrowhead), money amounts on the chosen node's
// edges only (R81: the profile's Connections list carries the relationship words), and a dashed rounded box around
// each org with at least two members, captioned "<org> group". A box shows only while no other party sits inside it,
// and its caption only while the org's own name is hidden and the caption touches no name, mark or other caption.
// Geometry is in force-layout.ts; this file only draws and places. The money legend is built here too.

import type { MoneyFact } from '../../../worker/matter-types.ts';
import { formatCount, formatUsd, formatUsdCompact, html, svg, textWidth, type MarkSide } from './core.ts';
import { separateLabels, type EdgeLabel, type Rect } from './force-fit.ts';
import { bendControl, groupBox, membersByOrg, moneyEdges, moneyWidth, type Graph, type MoneyEdge, type Point } from './force-layout.ts';
import { SERIES_WORDS, type MoneySeries } from './money.ts';

/** Options for the force graph's extra layers: the money to draw and which money series. */
export interface ExtrasOptions {
  money?: MoneyFact[];
  /** Which money series to draw: movements by default (R43); never summed together either way. */
  moneySeries?: MoneySeries | 'both';
  edgeLabels?: 'selection';
  groups?: boolean;
}

/** One line about a node's money, for its tooltip and the table: "Paid $5,462.75 (2 entries) to" Harbor Labs. */
export interface MoneyLine { label: string; other: string }

/** The force graph's extra layers, which are repositioned when nodes move or visibility changes. */
export interface Extras {
  /**
   * Repositions every extra layer after nodes move or visibility changes; money amounts and group captions keep
   * clear of `taken`, and a group whose org is in `named` needs no caption.
   */
  place(at: Map<string, Point>, isOn: (id: string) => boolean, taken?: readonly Rect[], named?: ReadonlySet<string>): void;
  /** The chosen node changed: marks its money edges and redraws edge labels on the next place. */
  choose(id: string | null): void;
  moneyLines(id: string): MoneyLine[];
  hasMoney: boolean;
  /** The series drawn, for the legend. */
  series: MoneySeries[];
}

const BEND: Record<MoneySeries, number> = { movements: 0.14, promises: 0.28 };
const GROUP_PAD = 24;
const GROUP_MIN = 2;
/** An edge label's box height at 12px. */
const LABEL_H = 14;

interface DrawnMoney { edge: MoneyEdge; g: SVGGElement; path: SVGPathElement; head: SVGPathElement; width: number }
interface DrawnGroup { org: string; ids: string[]; inside: Set<string>; box: SVGRectElement; caption: SVGTextElement }

function quadPoint(a: Point, c: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

/** An arrowhead at the curve's midpoint, pointing along it, sized to the stroke. */
function headPath(a: Point, c: Point, b: Point, width: number): string {
  const m = quadPoint(a, c, b, 0.5);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const s = 3 + width;
  const p = (x: number, y: number) => `${(m.x + x).toFixed(1)} ${(m.y + y).toFixed(1)}`;
  return `M${p(ux * s, uy * s)}L${p(-ux * s - uy * s * 0.8, -uy * s + ux * s * 0.8)}L${p(-ux * s + uy * s * 0.8, -uy * s - ux * s * 0.8)}Z`;
}

function entries(n: number): string {
  return `${formatCount(n)} ${n === 1 ? 'entry' : 'entries'}`;
}

function offWhen(el: Element, off: boolean): void {
  if (off) el.setAttribute('data-off', 'true'); else el.removeAttribute('data-off');
}

/** Builds the extra layers inside `root`, beneath and above the existing edge and node layers. */
export function createExtras(
  root: SVGSVGElement, edgeLayer: SVGGElement, nodeLayer: SVGGElement, graph: Graph, opts: ExtrasOptions,
  sideOf: (id: string) => MarkSide, nameOf: (id: string) => string,
): Extras {
  const groupLayer = svg('g', { class: 'viz-force__groups', 'aria-hidden': 'true' });
  root.insertBefore(groupLayer, edgeLayer);
  const moneyLayer = svg('g', { class: 'viz-force__money', 'aria-hidden': 'true' });
  root.insertBefore(moneyLayer, nodeLayer);
  const labelLayer = svg('g', { class: 'viz-force__edge-labels', 'aria-hidden': 'true' }, root);
  const series: MoneySeries[] = opts.moneySeries === 'both' ? ['movements', 'promises'] : [opts.moneySeries ?? 'movements'];
  const edges = opts.money ? moneyEdges(opts.money, new Set(graph.nodes.map((n) => n.id))).filter((e) => series.includes(e.series)) : [];
  const money = edges.map((edge) => drawMoney(moneyLayer, edge, moneyWidth(edge, edges), sideOf(edge.from)));
  const groups = opts.groups ? drawGroups(groupLayer, graph, sideOf, nameOf) : [];
  let chosen: string | null = null;

  const place = (at: Map<string, Point>, isOn: (id: string) => boolean, taken: readonly Rect[] = [], named: ReadonlySet<string> = new Set()) => {
    for (const m of money) placeMoney(m, at, isOn);
    const captions: Rect[] = [];
    for (const d of groups) placeGroup(d, at, isOn, { taken, captions, named });
    labelLayer.replaceChildren();
    if (opts.edgeLabels === 'selection' && chosen && isOn(chosen)) drawLabels(labelLayer, chosen, money, at, isOn, taken);
  };
  const choose = (id: string | null) => {
    chosen = id;
    for (const m of money) offNear(m.g, Boolean(id && (m.edge.from === id || m.edge.to === id)));
  };
  const moneyLines = (id: string): MoneyLine[] => edges.flatMap((e) => {
    const amount = `${formatUsd(e.cents)} (${entries(e.facts.length)})`;
    const promise = e.series === 'promises';
    if (e.from === id) return [{ label: `${promise ? 'Promised' : 'Paid'} ${amount} to`, other: e.to }];
    if (e.to === id) return [{ label: `${promise ? 'Was promised' : 'Received'} ${amount} from`, other: e.from }];
    return [];
  });
  return { place, choose, moneyLines, hasMoney: money.length > 0, series };
}

function offNear(el: Element, near: boolean): void {
  if (near) el.setAttribute('data-near', 'true'); else el.removeAttribute('data-near');
}

function drawMoney(layer: SVGGElement, edge: MoneyEdge, width: number, side: MarkSide): DrawnMoney {
  const g = svg('g', { class: 'viz-force__money-edge', 'data-series': edge.series }, layer);
  const path = svg('path', { class: 'viz-flow__link viz-force__money-line', 'data-side': side, 'data-kind': 'money', 'stroke-width': width }, g);
  const head = svg('path', { class: 'viz-mark viz-force__money-head', 'data-side': side }, g);
  return { edge, g, path, head, width };
}

/** Every org's members and theirs in turn: who may sit inside its box. */
function within(members: Map<string, string[]>, org: string): Set<string> {
  const out = new Set([org]);
  const queue = [org];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const m of members.get(id) ?? []) if (!out.has(m)) { out.add(m); queue.push(m); }
  }
  return out;
}

/** Larger groups first, so their captions are placed before smaller ones. */
function drawGroups(layer: SVGGElement, graph: Graph, sideOf: (id: string) => MarkSide, nameOf: (id: string) => string): DrawnGroup[] {
  const members = membersByOrg(graph);
  return [...members].filter(([, ids]) => ids.length >= GROUP_MIN)
    .sort(([a, x], [b, y]) => y.length - x.length || (a < b ? -1 : 1))
    .map(([org, ids]) => {
      const g = svg('g', { class: 'viz-force__group', 'data-side': sideOf(org) }, layer);
      const box = svg('rect', { class: 'viz-force__group-box', rx: 8 }, g);
      const caption = svg('text', { class: 'viz-force__group-caption' }, g);
      caption.textContent = `${nameOf(org)} group`;
      return { org, ids, inside: within(members, org), box, caption };
    });
}

function placeMoney(m: DrawnMoney, at: Map<string, Point>, isOn: (id: string) => boolean): void {
  const a = at.get(m.edge.from);
  const b = at.get(m.edge.to);
  const on = Boolean(a && b && isOn(m.edge.from) && isOn(m.edge.to));
  offWhen(m.g, !on);
  if (!a || !b || !on) return;
  const c = bendControl(a, b, BEND[m.edge.series]);
  m.path.setAttribute('d', `M${a.x.toFixed(1)} ${a.y.toFixed(1)}Q${c.x.toFixed(1)} ${c.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`);
  m.head.setAttribute('d', headPath(a, c, b, m.width));
}

interface CaptionRoom { taken: readonly Rect[]; captions: Rect[]; named: ReadonlySet<string> }

/**
 * A group shows while its org and at least two of its members do and no other shown party sits inside its box
 * (members' own members may); the box hugs whoever is shown. Its caption shows only while the org's name does not
 * and it overlaps no name, mark or caption already placed.
 */
function placeGroup(d: DrawnGroup, at: Map<string, Point>, isOn: (id: string) => boolean, room: CaptionRoom): void {
  const shown = d.ids.filter(isOn);
  const fits = isOn(d.org) && shown.length >= GROUP_MIN;
  const box = fits ? groupBox([d.org, ...shown].flatMap((id) => (at.has(id) ? [at.get(id) as Point] : [])), GROUP_PAD) : null;
  const crowded = box && [...at].some(([id, p]) => !d.inside.has(id) && isOn(id)
    && p.x > box.x && p.x < box.x + box.w && p.y > box.y && p.y < box.y + box.h);
  offWhen(d.box.parentElement as Element, !box || Boolean(crowded));
  if (!box || crowded) return;
  const r = (n: number) => n.toFixed(1);
  for (const [k, v] of [['x', box.x], ['y', box.y], ['width', box.w], ['height', box.h]] as const) d.box.setAttribute(k, r(v));
  d.caption.setAttribute('x', r(box.x + 2));
  d.caption.setAttribute('y', r(box.y - 6));
  const text = { x: box.x + 2, y: box.y - 6 - LABEL_H + 3, w: textWidth(d.caption.textContent ?? ''), h: LABEL_H };
  const clear = !room.named.has(d.org) && ![...room.taken, ...room.captions].some((o) => overlaps(text, o));
  offWhen(d.caption, !clear);
  if (clear) room.captions.push(text);
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * The chosen node's money amounts (R81), each centred on its edge's midpoint, pushed apart where they collide and
 * dropped where they still would (the profile and the table carry every amount). Larger amounts keep their place.
 */
function drawLabels(
  layer: SVGGElement, id: string, money: DrawnMoney[], at: Map<string, Point>, isOn: (id: string) => boolean, taken: readonly Rect[],
): void {
  const text = new Map<string, string>();
  const boxes: EdgeLabel[] = [];
  money.forEach((m, i) => {
    const { from, to, series, cents } = m.edge;
    if ((from !== id && to !== id) || !isOn(from) || !isOn(to)) return;
    const a = at.get(from);
    const b = at.get(to);
    if (!a || !b) return;
    const words = series === 'promises' ? `Promised ${formatUsdCompact(cents)}` : formatUsdCompact(cents);
    const mid = quadPoint(a, bendControl(a, b, BEND[series]), b, 0.5);
    const w = textWidth(words) + 4;
    text.set(String(i), words);
    boxes.push({ id: String(i), x: mid.x - w / 2, y: mid.y - LABEL_H - 3, w, h: LABEL_H, priority: cents });
  });
  for (const box of separateLabels(boxes, taken)) {
    const t = svg('text', { class: 'viz-force__edge-label', x: (box.x + box.w / 2).toFixed(1), y: (box.y + LABEL_H - 3).toFixed(1), 'text-anchor': 'middle' }, layer);
    t.textContent = text.get(box.id) ?? '';
  }
}

/** Words for the money legend. */
export const MONEY_LEGEND: Record<MoneySeries, string> = {
  movements: `${SERIES_WORDS.movements}: sum of cited payments`,
  promises: `${SERIES_WORDS.promises}: sum of cited commitments and calls`,
};

/** The money legend above the plot: one line per series drawn. */
export function moneyLegend(series: MoneySeries[]): HTMLElement {
  const list = html('ul', { class: 'viz-legend', 'aria-label': 'Money lines' });
  for (const sr of series) {
    const li = html('li', { class: 'viz-legend__item' }, list);
    html('span', { class: 'viz-legend__line', 'data-series': sr, 'aria-hidden': 'true' }, li);
    html('span', {}, li, MONEY_LEGEND[sr]);
  }
  return list;
}
