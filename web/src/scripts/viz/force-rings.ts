// SPDX-License-Identifier: Apache-2.0
// Card F5b (Charts viz), density pass. The rings of the people graph's layout (force-layout.ts runs them): a party
// tied only to one hub sits in a half ring around it, facing its side, so a restaurant group with thirty kitchens reads as one
// compact cluster instead of thirty names scattered through the graph. Tested in force.test.ts.
import type { SimulationNodeDatum } from 'd3-force';
import { SIDES, type Side } from '../../../worker/matter-types.ts';
import type { Graph, Point } from './force-layout.ts';

/** A node in the force simulation, with its id, side and collision radius. */
export interface SimNode extends SimulationNodeDatum {
  id: string;
  side: Side;
  /** Collision radius among the named nodes (satellites only ever collide as bare marks). */
  r: number;
  pull: number;
  charge: number;
  /** A satellite's hub, its ring's radius and its turn off the cluster's middle, in radians. */
  hub: SimNode | null;
  ring: number;
  turn: number;
  /** A hub's satellites face this point: the mean of their sides' anchors. */
  face: Point | null;
}

/**
 * Nodes whose only tie is one node that has other ties (a kitchen under its group, a clerk under the court): each
 * of the hub's most common side (the first in SIDES on a tie; the rest lay out as usual, by their own side) settles
 * in a tidy half ring around that hub instead of taking label-sized room of its own (their names show on
 * hover, focus, zoom or in the table).
 */
export function satellites(graph: Graph): Map<string, string> {
  const near = new Map(graph.nodes.map((n) => [n.id, new Set<string>()]));
  for (const e of graph.edges) {
    near.get(e.source)?.add(e.target);
    near.get(e.target)?.add(e.source);
  }
  const side = new Map(graph.nodes.map((n) => [n.id, n.side]));
  const candidates = new Map<string, string[]>();
  for (const [id, set] of near) {
    const [hub] = set;
    if (set.size === 1 && (near.get(hub)?.size ?? 0) >= 2) candidates.set(hub, [...(candidates.get(hub) ?? []), id]);
  }
  const out = new Map<string, string>();
  for (const [hub, ids] of candidates) {
    const count = (s: Side) => ids.filter((id) => side.get(id) === s).length;
    const ringSide = [...SIDES].sort((a, b) => count(b) - count(a))[0];
    for (const id of ids) if (side.get(id) === ringSide) out.set(id, hub);
  }
  return out;
}

/** Room for a named node's bare mark, in layout units: no other mark comes closer than this plus its own room. */
export const MARK_R = 17;

/** Room for a satellite's smaller mark: ring places sit twice this apart. */
export const RING_MARK_R = 13;

/** The first ring's radius: room for the hub's own mark and the satellites' spokes. */
export const RING_START = 44;

/**
 * Rings of up to this many name their members at rest, where the names fit; a larger ring reads as one cluster
 * and names its members on hover, focus or selection, or once the zoom reaches QUIET_ZOOM.
 */
export const RING_NAMED = 4;

/** The zoom at which a large ring's members are named too (the People fit is about 0.7 on a wide screen). */
export const QUIET_ZOOM = 1;

/** How far round the hub a cluster's rings reach: half a turn, facing the satellites' side. */
const RING_SPREAD = Math.PI;

/**
 * Ring places for `count` satellites, inside out: each ring holds as many as fit `2 * RING_MARK_R` apart across half a
 * turn, centred on the cluster's middle (turn 0), so a short last ring sits in the middle rather than at one end.
 */
export function ringSlots(count: number): Array<{ ring: number; turn: number }> {
  const out: Array<{ ring: number; turn: number }> = [];
  const gap = RING_MARK_R * 2;
  for (let ring = RING_START; out.length < count; ring += gap) {
    const step = gap / ring;
    const fits = Math.floor(RING_SPREAD / step) + 1;
    const here = Math.min(fits, count - out.length);
    for (let j = 0; j < here; j += 1) out.push({ ring, turn: (j - (here - 1) / 2) * step });
  }
  return out;
}

/**
 * Holds each satellite at its ring place around its hub, the cluster turned to face its `face` point (or away from
 * the middle, when the hub already sits on it). Not scaled by alpha: the rings stay put while the rest settles.
 */
export function ringForce(nodes: SimNode[], strength: number) {
  return () => {
    for (const n of nodes) {
      const hub = n.hub;
      const face = hub?.face;
      if (!hub || !face) continue;
      const hx = hub.x ?? 0;
      const hy = hub.y ?? 0;
      let dx = face.x - hx;
      let dy = face.y - hy;
      if (Math.hypot(dx, dy) < RING_START) { dx = hx; dy = hy; }
      const angle = (Math.hypot(dx, dy) < 1 ? Math.PI / 2 : Math.atan2(dy, dx)) + n.turn;
      n.vx = (n.vx ?? 0) + (hx + n.ring * Math.cos(angle) - (n.x ?? 0)) * strength;
      n.vy = (n.vy ?? 0) + (hy + n.ring * Math.sin(angle) - (n.y ?? 0)) * strength;
    }
  };
}

/** A d3 force run over `subset` only (the named nodes' label-sized collisions). */
export function only<F extends { (alpha: number): void; initialize?: (nodes: SimNode[], random: () => number) => void }>(force: F, subset: SimNode[]) {
  const run = (alpha: number) => force(alpha);
  run.initialize = (_nodes: SimNode[], random: () => number) => force.initialize?.(subset, random);
  return run;
}

/**
 * Gives each satellite its hub, ring and turn: a hub's satellites go round it by side, then name, so a cluster
 * reads in order; the hub faces them toward the mean of their sides' anchors.
 */
export function placeSatellites(graph: Graph, nodes: SimNode[], sat: Map<string, string>, anchor: Record<Side, Point>): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const names = new Map(graph.nodes.map((n) => [n.id, n.name]));
  const groups = new Map<string, SimNode[]>();
  for (const n of nodes) {
    const hub = sat.get(n.id);
    if (hub) groups.set(hub, [...(groups.get(hub) ?? []), n]);
  }
  for (const [hubId, group] of groups) {
    const hub = byId.get(hubId);
    if (!hub) continue;
    group.sort((a, b) => a.side.localeCompare(b.side) || (names.get(a.id) ?? '').localeCompare(names.get(b.id) ?? '') || (a.id < b.id ? -1 : 1));
    const slots = ringSlots(group.length);
    group.forEach((n, i) => Object.assign(n, { hub, ring: slots[i].ring, turn: slots[i].turn }));
    hub.r = Math.max(hub.r, slots[slots.length - 1].ring + MARK_R);
    hub.face = {
      x: group.reduce((sum, n) => sum + anchor[n.side].x, 0) / group.length,
      y: group.reduce((sum, n) => sum + anchor[n.side].y, 0) / group.length,
    };
  }
}
