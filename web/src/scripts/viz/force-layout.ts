// SPDX-License-Identifier: Apache-2.0
// Card F5b (Charts viz). The pure half of the people and organization graph (force.ts draws it): the graph built
// from the matter, a seeded d3-force layout that is the same on every load (parties tied only to one hub sit in a
// half ring around it, so a large cluster stays compact), the fit and zoom transform, and arrow
// navigation between nodes, plus the R46 extras: money edges per pair per series, org membership and padded
// group boxes. Tested in force.test.ts.

import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import type { MatterLink, MatterOrg, MatterPerson, MoneyFact, Side } from '../../../worker/matter-types.ts';
import { assertCents } from './core.ts';
import { seriesOf, unchartedReason, type MoneySeries } from './money.ts';
import { MARK_R, only, placeSatellites, RING_MARK_R, ringForce, satellites, type SimNode } from './force-rings.ts';

/** A person or org in the force graph, with its name and side. */
export interface GraphNode {
  id: string;
  name: string;
  side: Side;
  kind: 'person' | 'org';
  /** Role or kind as words, for labels and the table. */
  detail: string;
  /** The org this node clusters around: a person's first org, an org's parent. */
  cluster: string | null;
}

/** A tie between two nodes of the force graph, with its label. */
export interface GraphEdge {
  source: string;
  target: string;
  label: string;
  kind: 'link' | 'member' | 'parent';
}

/** The force graph: its nodes and its edges. */
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[] }

const ROLE_WORDS: Record<string, string> = {
  plaintiff: 'Plaintiff', defendant: 'Defendant', plaintiffCounsel: 'Counsel for plaintiff',
  defenseCounsel: 'Counsel for defendants', expert: 'Expert', witness: 'Witness', courtStaff: 'Court',
  vendor: 'Vendor', other: 'Other',
};
const ORG_WORDS: Record<string, string> = {
  company: 'Company', fund: 'Fund', firm: 'Firm', court: 'Court', agency: 'Agency', other: 'Organization',
};

/** People, orgs and their ties. Edges to ids that are not in the graph are dropped. */
export function buildGraph(people: MatterPerson[], orgs: MatterOrg[], links: MatterLink[]): Graph {
  const nodes: GraphNode[] = [
    ...orgs.map((o) => ({ id: o.id, name: o.name, side: o.side, kind: 'org' as const, detail: ORG_WORDS[o.kind] ?? 'Organization', cluster: o.parent })),
    ...people.map((p) => ({ id: p.id, name: p.name, side: p.side, kind: 'person' as const, detail: p.title ?? ROLE_WORDS[p.role] ?? '', cluster: p.orgs[0] ?? null })),
  ];
  const known = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const add = (e: GraphEdge) => {
    const key = `${e.kind}\u0000${e.source}\u0000${e.target}\u0000${e.label}`;
    if (e.source === e.target || !known.has(e.source) || !known.has(e.target) || seen.has(key)) return;
    seen.add(key);
    edges.push(e);
  };
  for (const o of orgs) if (o.parent) add({ source: o.id, target: o.parent, label: 'Part of', kind: 'parent' });
  for (const p of people) for (const org of p.orgs) add({ source: p.id, target: org, label: 'Member of', kind: 'member' });
  for (const l of links) add({ source: l.from, target: l.to, label: l.label, kind: 'link' });
  return { nodes, edges };
}

/** mulberry32: a small seeded generator, so the layout never depends on Math.random. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where each side settles: client left, defendants right, the company between, court above, third parties below. */
export const SIDE_ANCHORS: Record<Side, { x: number; y: number }> = {
  client: { x: -420, y: 0 },
  defendant: { x: 420, y: 0 },
  nominal: { x: 0, y: 0 },
  court: { x: 0, y: -200 },
  third: { x: 0, y: 200 },
};

/** A point as x and y. */
export interface Point { x: number; y: number }

/** Room for the mark and most of its label, which runs to the right: names collide less than bare marks would. */
export function collideRadius(node: Pick<GraphNode, 'name' | 'kind'>): number {
  const label = Math.min(node.name.length, 26) * 12 * 0.56;
  return Math.round((node.kind === 'org' ? 12 : 9) + label * 0.42);
}

/**
 * A node with at most one tie settles this share of the way to its side's anchor (R81): lone parties sit nearer
 * the middle instead of at the frame's edge. Loose clusters are brought in afterwards by packComponents.
 */
export const OUTLIER_PULL = 0.55;

const LINK_SHAPE: Record<GraphEdge['kind'], { distance: number; strength: number }> = {
  member: { distance: 46, strength: 0.7 },
  parent: { distance: 70, strength: 0.5 },
  link: { distance: 110, strength: 0.15 },
};

/**
 * A deterministic layout: nodes are sorted by id before the run and every random draw comes from `seed`, so the
 * same graph lands the same way on every load, whatever order the matter lists it in.
 */
export function layoutForce(graph: Graph, seed = 7, ticks = 300): Map<string, Point> {
  const ties = degrees(graph);
  const sat = satellites(graph);
  const nodes: SimNode[] = [...graph.nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((n) => ({
    id: n.id, side: n.side, r: collideRadius(n), pull: (ties.get(n.id) ?? 0) <= 1 ? OUTLIER_PULL : 1,
    charge: sat.has(n.id) ? 0 : -140 - 8 * Math.min(ties.get(n.id) ?? 0, 12), hub: null, ring: 0, turn: 0, face: null,
  }));
  placeSatellites(graph, nodes, sat, SIDE_ANCHORS);
  const named = nodes.filter((n) => !n.hub);
  const edges = [...graph.edges]
    .sort((a, b) => `${a.source} ${a.target} ${a.kind}`.localeCompare(`${b.source} ${b.target} ${b.kind}`))
    .map((e) => ({ source: e.source, target: e.target, kind: e.kind, ring: sat.has(e.source) || sat.has(e.target) }));
  const sim = forceSimulation(nodes)
    .randomSource(seededRandom(seed))
    .force('link', forceLink<SimNode, (typeof edges)[number]>(edges).id((d) => d.id)
      .distance((e) => LINK_SHAPE[e.kind].distance).strength((e) => (e.ring ? 0 : LINK_SHAPE[e.kind].strength)))
    .force('charge', forceManyBody<SimNode>().strength((d) => d.charge).distanceMax(600))
    .force('x', forceX<SimNode>((d) => SIDE_ANCHORS[d.side].x * d.pull).strength((d) => (d.hub ? 0 : 0.07)))
    .force('y', forceY<SimNode>((d) => SIDE_ANCHORS[d.side].y * d.pull).strength((d) => (d.hub ? 0 : 0.07)))
    .force('rings', ringForce(nodes, 0.3))
    .force('names', only(forceCollide<SimNode>((d) => d.r).iterations(2), named))
    .force('marks', forceCollide<SimNode>((d) => (d.hub ? RING_MARK_R : MARK_R)))
    .stop();
  sim.tick(ticks);
  const out = new Map<string, Point>();
  for (const n of nodes) out.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
  packComponents(out, graph, new Map(nodes.map((n) => [n.id, n.r])));
  for (const [id, p] of out) out.set(id, { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 });
  return out;
}

/** Space kept between a packed cluster and the rest, in layout units: two group boxes (24px each) at zoom 1 or more. */
export const PACK_GAP = 72;

type Box = { x0: number; y0: number; x1: number; y1: number };

function components(graph: Graph): string[][] {
  const parent = new Map(graph.nodes.map((n) => [n.id, n.id]));
  const find = (id: string): string => { let r = id; while (parent.get(r) !== r) r = parent.get(r) as string; return r; };
  for (const e of graph.edges) parent.set(find(e.source), find(e.target));
  const groups = new Map<string, string[]>();
  for (const n of [...graph.nodes].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const root = find(n.id);
    groups.set(root, [...(groups.get(root) ?? []), n.id]);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));
}

function boxOf(ids: string[], at: Map<string, Point>, r: Map<string, number>): Box {
  const pts = ids.map((id) => ({ p: at.get(id) as Point, r: r.get(id) ?? 0 }));
  return {
    x0: Math.min(...pts.map(({ p, r: rr }) => p.x - rr)), y0: Math.min(...pts.map(({ p, r: rr }) => p.y - rr)),
    x1: Math.max(...pts.map(({ p, r: rr }) => p.x + rr)), y1: Math.max(...pts.map(({ p, r: rr }) => p.y + rr)),
  };
}

const near = (a: Box, b: Box, gap: number) => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;

/**
 * Clusters with no tie to the rest (a court and its staff, say) drift to their side's anchor and leave empty bands
 * that the fit then has to frame (R65). Each one, largest first, slides straight toward the middle of what is
 * already placed until it would come within PACK_GAP of it, so it keeps its side and direction but not the gap.
 */
export function packComponents(at: Map<string, Point>, graph: Graph, radius: Map<string, number>): void {
  const [main, ...rest] = components(graph);
  if (!main || rest.length === 0) return;
  const placed = [...main];
  for (const comp of rest) {
    const others = boxOf(placed, at, radius);
    const mine = boxOf(comp, at, radius);
    const dx = (others.x0 + others.x1) / 2 - (mine.x0 + mine.x1) / 2;
    const dy = (others.y0 + others.y1) / 2 - (mine.y0 + mine.y1) / 2;
    let t = 0;
    for (let step = 0.5; step > 0.004; step /= 2) {
      const next = t + step;
      if (next > 1) continue;
      const moved = { x0: mine.x0 + dx * next, y0: mine.y0 + dy * next, x1: mine.x1 + dx * next, y1: mine.y1 + dy * next };
      if (!near(moved, others, PACK_GAP)) t = next;
    }
    for (const id of comp) {
      const p = at.get(id) as Point;
      at.set(id, { x: p.x + dx * t, y: p.y + dy * t });
    }
    placed.push(...comp);
  }
}

/** A pan and zoom view: the scale and the offset. */
export interface View { k: number; x: number; y: number }

/** The smallest zoom scale of the force graph. */
export const ZOOM_MIN = 0.15;
/** The largest zoom scale of the force graph. */
export const ZOOM_MAX = 4;

/**
 * The view that fits every point inside width by height with `pad` px to spare (`padRight` on the right, where
 * labels run), never zoomed past 1.5x.
 */
export function fitView(points: Point[], width: number, height: number, pad = 48, padRight = pad): View {
  if (points.length === 0) return { k: 1, x: width / 2, y: height / 2 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = Math.max(ZOOM_MIN, Math.min(1.5, (width - pad - padRight) / Math.max(x1 - x0, 1), (height - pad * 2) / Math.max(y1 - y0, 1)));
  return { k, x: pad + (width - pad - padRight) / 2 - k * ((x0 + x1) / 2), y: height / 2 - k * ((y0 + y1) / 2) };
}

/** Zooms by `factor` about the screen point (cx, cy), within the zoom limits. */
export function zoomAt(view: View, factor: number, cx: number, cy: number): View {
  const k = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, view.k * factor));
  const f = k / view.k;
  return { k, x: cx - (cx - view.x) * f, y: cy - (cy - view.y) * f };
}

/** Maps a graph point to screen coordinates under a view. */
export function toScreen(view: View, p: Point): Point {
  return { x: view.x + view.k * p.x, y: view.y + view.k * p.y };
}

/**
 * The nearest node in an arrow's direction: within 60 degrees either side of it, closest first, with distance
 * across the arrow weighted double so Right prefers what is level. -1 when nothing lies that way.
 */
export function directionalNext(points: Point[], from: number, key: string): number {
  const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[key];
  const here = points[from];
  if (!dir || !here) return -1;
  let best = -1;
  let bestScore = Infinity;
  points.forEach((p, i) => {
    if (i === from) return;
    const dx = p.x - here.x;
    const dy = p.y - here.y;
    const along = dx * dir[0] + dy * dir[1];
    const across = Math.abs(dx * dir[1] - dy * dir[0]);
    if (along <= 0 || across > along * Math.tan(Math.PI / 3)) return;
    const score = along + across * 2;
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}

/** Money between two graph nodes, one edge per ordered pair per series (R43: promises and movements never sum). */
export interface MoneyEdge {
  from: string;
  to: string;
  series: MoneySeries;
  cents: number;
  /** MoneyFact ids, in input order. */
  facts: string[];
}

/**
 * Sums money by payer, payee and series. Entries with no kind, a null end, an id outside the graph or a zero
 * amount are skipped (the money tables list them); an amount that is not whole cents throws.
 */
export function moneyEdges(money: MoneyFact[], known: ReadonlySet<string>): MoneyEdge[] {
  const out = new Map<string, MoneyEdge>();
  for (const f of money) {
    assertCents(f.amountCents, f.id);
    const series = seriesOf(f.kind);
    if (!series || unchartedReason(f) || f.amountCents <= 0) continue;
    const from = f.from as string; // safe: unchartedReason refuses null ends
    const to = f.to as string;
    if (from === to || !known.has(from) || !known.has(to)) continue;
    const key = `${series}\u0000${from}\u0000${to}`;
    const edge = out.get(key) ?? { from, to, series, cents: 0, facts: [] };
    edge.cents += f.amountCents;
    edge.facts.push(f.id);
    out.set(key, edge);
  }
  return [...out.values()];
}

/** Stroke width for a money edge: 2 to 8px by the square root of its share of the largest edge in its series. */
export function moneyWidth(edge: MoneyEdge, edges: MoneyEdge[]): number {
  const max = Math.max(0, ...edges.filter((e) => e.series === edge.series).map((e) => e.cents));
  return max > 0 ? Math.round((2 + 6 * Math.sqrt(edge.cents / max)) * 10) / 10 : 2;
}

/** Each org's members: people who belong to it and orgs whose parent it is. */
export function membersByOrg(graph: Graph): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.kind !== 'member' && e.kind !== 'parent') continue;
    const list = out.get(e.target) ?? [];
    if (!list.includes(e.source)) list.push(e.source);
    out.set(e.target, list);
  }
  return out;
}

/** The box around `points` with `pad` px to spare on every side: an org group's outline. */
export function groupBox(points: Point[], pad: number): { x: number; y: number; w: number; h: number } | null {
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}

/** The control point that bends a link to the right of its direction by `bend` of its length. */
export function bendControl(a: Point, b: Point, bend: number): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return { x: (a.x + b.x) / 2 - dy * bend, y: (a.y + b.y) / 2 + dx * bend };
}

/** The places a label may sit around its mark. */
export type LabelSide = 'right' | 'left' | 'above' | 'below' | 'above-right' | 'below-right';

/** A label's size and priority (higher first), and its box's top-left for each side of its mark, in order of preference. */
export interface LabelBox { id: string; w: number; h: number; priority: number; at: ReadonlyArray<{ side: LabelSide; x: number; y: number }> }

/** A node mark's screen circle: labels never cover another node's mark. */
export interface MarkCircle { id: string; x: number; y: number; r: number }

interface Rect { x: number; y: number; w: number; h: number }

/** A label may graze a mark's rim (its halo keeps both legible) but not cover this share of its radius. */
export const MARK_CORE = 0.6;

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Which labels to draw, and on which side of the mark (R65, R74): highest priority first, each at its first
 * position (right, left, above, below, then the right-hand diagonals) that overlaps no label already placed and no other node's mark; at most
 * `max`. Ties go by id, so the same view always labels the same nodes the same way.
 */
export function labelPlan(labels: readonly LabelBox[], marks: readonly MarkCircle[], max = Infinity): Map<string, LabelSide> {
  const kept: Rect[] = [];
  const out = new Map<string, LabelSide>();
  const order = [...labels].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const free = (id: string, r: Rect) => !kept.some((other) => overlaps(r, other))
    && !marks.some((m) => m.id !== id && overlaps(r, { x: m.x - m.r * MARK_CORE, y: m.y - m.r * MARK_CORE, w: m.r * 2 * MARK_CORE, h: m.r * 2 * MARK_CORE }));
  for (const label of order) {
    if (out.size >= max) break;
    for (const { side, x, y } of label.at) {
      const r = { x, y, w: label.w, h: label.h };
      if (!free(label.id, r)) continue;
      kept.push(r);
      out.set(label.id, side);
      break;
    }
  }
  return out;
}

/** Ties per node, for label priority: the best-connected parties are named first. */
export function degrees(graph: Graph): Map<string, number> {
  const out = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const e of graph.edges) {
    out.set(e.source, (out.get(e.source) ?? 0) + 1);
    out.set(e.target, (out.get(e.target) ?? 0) + 1);
  }
  return out;
}
