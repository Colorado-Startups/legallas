// SPDX-License-Identifier: Apache-2.0
// Track pages, the control panels' geometry (the model is in control-layout.ts, which re-exports this module's
// API; the words' places are in control-labels.ts). Fixed for every step: node places depend on the width only,
// and label places on the longest words a tie takes across all steps. No DOM.

import type { Cite } from '../../../worker/matter-types.ts';
import type { ControlModel } from './control-layout.ts';
import { fullSize, LABEL_MAX_W, placeLabels, shortSize, shortWords, type LabelSpec, type Leader, type Point, type Rect } from './control-labels.ts';

/** The height of a party node in the control picture, in pixels. */
export const NODE_H = 56;
const ROW_GAP = 96;
const MIN_GAP = 24;
/** Below this width the picture becomes a list: each node with its ties under it. */
export const LIST_BELOW = 600;

/** One tie line of the control picture: the index of its link and its SVG path. */
export interface ControlEdge {
  /** Index into model.links. */
  link: number;
  /** SVG path data for the line, from `from` to `to`. */
  d: string;
  /** The arrowhead at the `to` end, as SVG path data. */
  head: string;
  /** Where the words sit: the box they wrap in. */
  label: Rect;
  /** The box holds the short words (shortWords); the full words go in the tooltip and the table. */
  short: boolean;
  /** A line from the tie's line to a box that sits off it, or null when the box sits on its line. */
  leader: Leader | null;
}

/** The control picture's computed geometry: its size and the rectangle of each node. */
export interface ControlGeometry {
  width: number;
  height: number;
  nodes: Map<string, Rect>;
  edges: ControlEdge[];
}

function nodeWidth(width: number): number {
  return width >= 900 ? 168 : 144;
}

/**
 * The rows as drawn: a node alone on the last row moves up to the end of the row above when that row has room on
 * one line and none of the node's ties joins it to that row, so a lone leaf leaves no empty band under the picture.
 */
export function drawnRows<C extends Cite>(model: ControlModel<C>, width: number): ControlModel['rows'] {
  const perLine = Math.max(1, Math.floor((width + MIN_GAP) / (nodeWidth(width) + MIN_GAP)));
  const rows = model.rows.map((row) => ({ ...row, ids: [...row.ids] }));
  for (;;) {
    const last = rows.at(-1);
    const above = rows.at(-2);
    if (!last || !above || last.ids.length !== 1 || above.ids.length + 1 > perLine) break;
    const id = last.ids[0]!; // safe: one id
    const tied = model.links.some((l) => (l.from === id && above.ids.includes(l.to)) || (l.to === id && above.ids.includes(l.from)));
    if (tied) break;
    above.ids.push(id);
    rows.pop();
  }
  return rows;
}

/** Node places from `top` down: each row centered, wrapping onto more lines when it does not fit the width. */
function placeNodes(rows: ControlModel['rows'], width: number, top: number): { nodes: Map<string, Rect>; height: number } {
  const w = nodeWidth(width);
  const perLine = Math.max(1, Math.floor((width + MIN_GAP) / (w + MIN_GAP)));
  const nodes = new Map<string, Rect>();
  let y = top;
  for (const row of rows) {
    for (let start = 0; start < row.ids.length; start += perLine) {
      const line = row.ids.slice(start, start + perLine);
      const cell = Math.min(width / line.length, w + 120);
      const x0 = (width - cell * line.length) / 2;
      line.forEach((id, i) => nodes.set(id, { x: Math.round(x0 + cell * (i + 0.5) - w / 2), y, w, h: NODE_H }));
      y += NODE_H + ROW_GAP;
    }
  }
  return { nodes, height: Math.max(y - ROW_GAP, top) };
}

function lerp(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

interface Route {
  at: (t: number) => Point;
  d: string;
  end: Point;
  dir: Point;
  /** The highest point the line reaches. */
  top: number;
}

/**
 * The line between two nodes: straight between rows, an arc above when both sit on one line. `spread` shifts the
 * start along the node's edge (ties leaving one node fan out); `offset` shifts both ends (parallel ties between the
 * same two nodes sit side by side).
 */
function route(from: Rect, to: Rect, spread: number, offset: number): Route {
  const r = (n: number) => Math.round(n * 10) / 10;
  if (Math.abs(from.y - to.y) < 1) {
    const a: Point = [from.x + from.w / 2 + spread + offset, from.y];
    const b: Point = [to.x + to.w / 2 + offset, to.y];
    const c: Point = [(a[0] + b[0]) / 2, from.y - 48 - Math.abs(offset)];
    const at = (t: number): Point => lerp(lerp(a, c, t), lerp(c, b, t), t);
    return { at, d: `M${r(a[0])} ${r(a[1])}Q${r(c[0])} ${r(c[1])} ${r(b[0])} ${r(b[1])}`, end: b, dir: [b[0] - c[0], b[1] - c[1]], top: at(0.5)[1] };
  }
  const down = from.y < to.y;
  const a: Point = [from.x + from.w / 2 + spread + offset, down ? from.y + from.h : from.y];
  const b: Point = [to.x + to.w / 2 + offset, down ? to.y : to.y + to.h];
  return { at: (t) => lerp(a, b, t), d: `M${r(a[0])} ${r(a[1])}L${r(b[0])} ${r(b[1])}`, end: b, dir: [b[0] - a[0], b[1] - a[1]], top: Math.min(a[1], b[1]) };
}

function arrowHead(end: Point, dir: Point): string {
  const len = Math.hypot(dir[0], dir[1]) || 1;
  const [ux, uy] = [dir[0] / len, dir[1] / len];
  const r = (n: number) => Math.round(n * 10) / 10;
  const base: Point = [end[0] - ux * 8, end[1] - uy * 8];
  const left: Point = [base[0] - uy * 4, base[1] + ux * 4];
  const right: Point = [base[0] + uy * 4, base[1] - ux * 4];
  return `M${r(end[0])} ${r(end[1])}L${r(left[0])} ${r(left[1])}L${r(right[0])} ${r(right[1])}Z`;
}

/** Every tie's line, and the widest its words may be (parallel ties share the narrower node's width). */
function routes<C extends Cite>(model: ControlModel<C>, nodes: ReadonlyMap<string, Rect>): { path: Route; maxW: number }[] {
  const outgoing = new Map<string, number[]>();
  const pairs = new Map<string, number[]>();
  model.links.forEach((l, i) => {
    outgoing.set(l.from, [...(outgoing.get(l.from) ?? []), i]);
    const pair = [l.from, l.to].sort().join('\n');
    pairs.set(pair, [...(pairs.get(pair) ?? []), i]);
  });
  return model.links.map((link, i) => {
    const from = nodes.get(link.from)!; // safe: every drawn link joins two nodes
    const to = nodes.get(link.to)!; // safe: as above
    const siblings = outgoing.get(link.from)!; // safe: set above
    const k = siblings.indexOf(i);
    const parallel = pairs.get([link.from, link.to].sort().join('\n'))!; // safe: set above
    // Parallel ties spread across the narrower node, so their words can sit side by side.
    const across = Math.min(from.w, to.w) - 24;
    const offset = parallel.length > 1 ? (parallel.indexOf(i) / (parallel.length - 1) - 0.5) * across : 0;
    const spread = parallel.length > 1 ? 0 : (k - (siblings.length - 1) / 2) * Math.min(20, from.w / (siblings.length + 1));
    const maxW = parallel.length > 1 ? Math.max(across / (parallel.length - 1) - 8, 72) : LABEL_MAX_W;
    return { path: route(from, to, spread, offset), maxW };
  });
}

/**
 * The whole picture at `width`, or null below LIST_BELOW (the page shows the list instead). Rows move down when an
 * arc on the top line would rise above the canvas. The words go where placeLabels finds room (control-labels.ts).
 */
export function layoutControl<C extends Cite>(model: ControlModel<C>, width: number): ControlGeometry | null {
  if (!(width >= LIST_BELOW)) return null;
  const rows = drawnRows(model, width);
  let { nodes, height } = placeNodes(rows, width, 0);
  let lines = routes(model, nodes);
  const rise = Math.ceil(Math.max(0, ...lines.map((l) => -l.path.top)));
  if (rise > 0) {
    ({ nodes, height } = placeNodes(rows, width, rise + 8));
    lines = routes(model, nodes);
  }
  const specs = model.links.map((link, i): LabelSpec => {
    const at = model.ties.map((step) => step[i] ?? null);
    const maxW = lines[i]!.maxW; // safe: one route per link
    return {
      at: lines[i]!.path.at, // safe: as above
      full: fullSize(at.map((tie): [string, string] => [tie?.words ?? '', tie?.later ?? '']), maxW),
      short: shortSize(at.map((tie): [string, string] => (tie ? shortWords(link.label, tie) : ['', ''])), maxW),
      shown: at.map((tie) => tie !== null),
    };
  });
  const placed = placeLabels(specs, [...nodes.values()], width, height);
  const edges = lines.map(({ path }, i): ControlEdge => {
    const label = placed.labels[i]!; // safe: one label per spec
    return { link: i, d: path.d, head: arrowHead(path.end, path.dir), label: label.box, short: label.short, leader: label.leader };
  });
  return { width, height: placed.height, nodes, edges };
}
