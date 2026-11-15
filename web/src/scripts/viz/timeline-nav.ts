// SPDX-License-Identifier: Apache-2.0
// Card F5a (timeline viz). Keyboard focus among events: Left and Right step through the record in date order,
// Up and Down jump to the nearest event in time in the lane above or below, Home and End go to the first and last.
// Pure: no DOM.

/** A mark the keyboard can move to: its id and its lane. */
export interface NavPoint {
  id: string;
  /** Lane index, top to bottom. */
  lane: number;
  /** The instant the mark sits at, in epoch milliseconds. */
  t: number;
}

/** The keys that move between timeline marks. */
export type NavKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

/** The navigation keys as a set, for lookup. */
export const NAV_KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

function nearestInLane(points: NavPoint[], lane: number, t: number): NavPoint | undefined {
  let best: NavPoint | undefined;
  for (const point of points) {
    if (point.lane !== lane) continue;
    if (!best || Math.abs(point.t - t) < Math.abs(best.t - t)) best = point;
  }
  return best;
}

/** The next lane in a direction that holds any point, or null at the edge. */
function nextLane(points: NavPoint[], from: number, step: 1 | -1): number | null {
  const lanes = [...new Set(points.map((point) => point.lane))].sort((a, b) => a - b);
  const candidates = step > 0 ? lanes.filter((lane) => lane > from) : lanes.filter((lane) => lane < from).reverse();
  return candidates[0] ?? null;
}

/**
 * The id that should take focus after `key`, given points in chronological order. With nothing focused yet, any
 * key starts at the first point (End at the last). Returns the current id at an edge, and null when empty.
 */
export function moveFocus(points: NavPoint[], currentId: string | null, key: NavKey): string | null {
  if (points.length === 0) return null;
  const index = currentId === null ? -1 : points.findIndex((point) => point.id === currentId);
  if (key === 'End') return points[points.length - 1].id;
  if (index < 0 || key === 'Home') return points[0].id;
  const current = points[index];
  if (key === 'ArrowRight') return points[Math.min(points.length - 1, index + 1)].id;
  if (key === 'ArrowLeft') return points[Math.max(0, index - 1)].id;
  const lane = nextLane(points, current.lane, key === 'ArrowDown' ? 1 : -1);
  if (lane === null) return current.id;
  return nearestInLane(points, lane, current.t)?.id ?? current.id;
}
