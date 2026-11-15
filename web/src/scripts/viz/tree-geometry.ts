// SPDX-License-Identifier: Apache-2.0
// Workstream S2 (Structure). Pure geometry for the structure tree (tree.ts): name wrapping, the hex tile, the
// selection brackets and a move's routed arrow (above the names, up the gutters between tiles). Tested in tree.test.ts.

import { fitLabel, textWidth } from './core.ts';

/** Splits a name into at most two lines of `maxPx`; the second ends in an ellipsis when it still runs over. */
export function wrapName(name: string, maxPx: number, px = 12): string[] {
  if (textWidth(name, px) <= maxPx) return [name];
  const words = name.split(/\s+/).filter(Boolean);
  let first = '';
  let i = 0;
  while (i < words.length) {
    const next = first ? `${first} ${words[i]}` : words[i];
    if (textWidth(next, px) > maxPx) break;
    first = next;
    i += 1;
  }
  if (!first) return [fitLabel(name, maxPx, px)];
  const rest = words.slice(i).join(' ');
  return rest ? [first, fitLabel(rest, maxPx, px)] : [first];
}

/** A pointy-top hexagon of radius `r` centred on (cx, cy): the company shape of DESIGN.md section 3. */
export function hexPath(cx: number, cy: number, r: number): string {
  const pts = [-90, -30, 30, 90, 150, 210].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
  });
  return `M${pts.join(' L')}Z`;
}

/** Corner brackets around a box: the selection mark (brass). */
export function bracketPath(x: number, y: number, w: number, h: number, arm = 10): string {
  const r = x + w;
  const b = y + h;
  return [`M${x} ${y + arm}V${y}H${x + arm}`, `M${r - arm} ${y}H${r}V${y + arm}`,
    `M${r} ${b - arm}V${b}H${r - arm}`, `M${x + arm} ${b}H${x}V${b - arm}`].join('');
}

type Point = { x: number; y: number };

/**
 * Where a move's vertical run may go: an x outside every blocked span (the tiles, names and dates of the levels it
 * passes), keeping `margin` from each. Gaps between tiles come first, then the room beside the outermost ones; of
 * those, the one that adds the least sideways travel from `from` to `to`, then the one nearest `from`. Kept within
 * `bounds`.
 */
export function gutterX(blocked: ReadonlyArray<readonly [number, number]>, from: number, to: number,
  bounds: readonly [number, number], margin = 6): number {
  const spans = blocked.map(([l, r]) => [Math.min(l, r), Math.max(l, r)] as [number, number]).sort((p, q) => p[0] - q[0]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span[0] < last[1] + margin * 2) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  const clamp = (x: number) => Math.min(Math.max(x, bounds[0]), bounds[1]);
  if (merged.length === 0) return clamp((from + to) / 2);
  const candidates = [merged[0][0] - margin, merged[merged.length - 1][1] + margin];
  for (let i = 1; i < merged.length; i += 1) candidates.push((merged[i - 1][1] + merged[i][0]) / 2);
  const cost = (x: number) => Math.abs(from - x) + Math.abs(x - to);
  return clamp(candidates.reduce((best, x) => {
    const d = cost(x) - cost(best);
    return d < -0.01 || (Math.abs(d) <= 0.01 && Math.abs(x - from) < Math.abs(best - from)) ? x : best;
  }));
}

/**
 * A move in the top-down tree. It never crosses a name: it leaves the source hex upward into the clear band above
 * the source's level (`rise` above the hex top), runs to the gutter `gx` between tiles, climbs or drops there to the
 * band above the target's level, runs over to the target and comes down into the hex top, arrowhead pointing down.
 * On one level there is no gutter to take (`gx` is ignored). The label sits on the last run, over the target.
 */
export function moveRoute(a: Point, b: Point, r: number, gx: number, rise = 10):
  { d: string; head: string; label: Point } {
  const f = (n: number) => Math.round(n * 10) / 10;
  const startY = a.y - r - 3;
  const endY = b.y - r - 3;
  const bandA = a.y - r - rise;
  const bandB = b.y - r - rise;
  const level = Math.abs(a.y - b.y) < 1;
  const runFrom = level ? a.x : gx;
  const d = level
    ? `M${f(a.x)} ${f(startY)}V${f(bandA)}H${f(b.x)}V${f(endY)}`
    : `M${f(a.x)} ${f(startY)}V${f(bandA)}H${f(gx)}V${f(bandB)}H${f(b.x)}V${f(endY)}`;
  return {
    d,
    head: `M${f(b.x)} ${f(endY)}L${f(b.x - 4.5)} ${f(endY - 9)}L${f(b.x + 4.5)} ${f(endY - 9)}Z`,
    label: { x: f((runFrom + b.x) / 2), y: f(bandB - 5) },
  };
}

/** A drawn tile: its hex centre and radius. */
export interface RouteTile {
  x: number;
  y: number;
  r: number;
}

/** The top-down tree's measures: column width, hex height, the words' block under the hex and the drawing width. */
export interface RouteFrame {
  col: number;
  hex: number;
  block: number;
  width: number;
  /** The move's index on this drawing: a second move runs a little higher, so the two never share a line. */
  lane?: number;
}

/** A tile's footprint, hex top to its last line of words: what a move must not cross. */
export function tileSpan(t: RouteTile, frame: Pick<RouteFrame, 'col' | 'hex' | 'block'>): { x: [number, number]; y: [number, number] } {
  const half = frame.col / 2 - 6;
  const top = t.y - t.r - 6;
  return { x: [t.x - half, t.x + half], y: [top, top + frame.hex + frame.block] };
}

/** A move from tile `a` to tile `b` among `tiles`, its vertical run in the gutter between the tiles it passes. */
export function routeMove(tiles: readonly RouteTile[], a: RouteTile, b: RouteTile, frame: RouteFrame): ReturnType<typeof moveRoute> {
  const rise = 10 + (frame.lane ?? 0) * 4;
  const lo = Math.min(a.y, b.y) - a.r - rise;
  const hi = Math.max(a.y, b.y) - a.r - rise;
  const blocked = tiles
    .map((t) => tileSpan(t, frame))
    .filter((t) => t.y[1] > lo && t.y[0] < hi)
    .map((t) => t.x);
  return moveRoute(a, b, a.r, gutterX(blocked, a.x, b.x, [4, frame.width - 4]), rise);
}

/**
 * A move in the indented list: out of the source tile's left side into a gutter, along it, and into the target
 * tile's left side with an arrowhead pointing right. `lane` is the gutter's x, so moves never cross the tiles.
 */
export function moveElbow(a: { x: number; y: number }, b: { x: number; y: number }, ra: number, rb: number, lane: number):
  { d: string; head: string } {
  const end = b.x - rb;
  return {
    d: `M${a.x - ra} ${a.y}H${lane}V${b.y}H${end}`,
    head: `M${end} ${b.y}L${end - 9} ${b.y - 4.5}L${end - 9} ${b.y + 4.5}Z`,
  };
}
