// SPDX-License-Identifier: Apache-2.0
// Card F5b (Charts viz), Q3 polish (R81, R88). Pure geometry for fitting the force graph to its frame: the view
// that frames every node plus what is drawn around them (labels, group boxes and captions) with even padding (on
// phones, the height only), the People frame's height from the drawing's shape, and the collision pass for money
// amounts on a chosen node's edges. force.ts measures and draws; this file only computes. Tested in force-fit.test.ts.
import { ZOOM_MIN, type View } from './force-layout.ts';

/** A box by the coordinates of its top-left and bottom-right corners. */
export interface Box { x0: number; y0: number; x1: number; y1: number }

/** Pixels drawn beyond the outermost node centers on each side (labels, group boxes, captions), at any zoom. */
export interface Margins { left: number; right: number; top: number; bottom: number }

/** The fit never zooms past this, so a small graph is not blown up. */
export const FIT_MAX = 1.5;

/** Frames narrower than this (phones) fit the drawing's height and pan sideways: a sideways drag pans the graph, an up or down swipe scrolls the page. */
export const NARROW = 600;

/** A NARROW fit zooms out no further than this to fit the width (names stay legible); the rest pans sideways. */
export const NARROW_ZOOM = 0.5;

/**
 * The view that puts the world box `world` (node centers) and its screen-space `margins` inside width by height
 * with `pad` px left over on every side, centred. Margins are in pixels because labels and boxes do not scale.
 * A NARROW frame fits the width only down to NARROW_ZOOM, so names stay legible and the sides run past its edges.
 */
export function fitContent(world: Box, margins: Margins, width: number, height: number, pad = 24): View {
  const ww = Math.max(world.x1 - world.x0, 1);
  const wh = Math.max(world.y1 - world.y0, 1);
  const across = (width - 2 * pad - margins.left - margins.right) / ww;
  const down = (height - 2 * pad - margins.top - margins.bottom) / wh;
  const k = Math.max(ZOOM_MIN, Math.min(FIT_MAX, down, width < NARROW ? Math.max(across, NARROW_ZOOM) : across));
  const contentW = k * ww + margins.left + margins.right;
  const contentH = k * wh + margins.top + margins.bottom;
  return {
    k,
    x: (width - contentW) / 2 + margins.left - k * world.x0,
    y: (height - contentH) / 2 + margins.top - k * world.y0,
  };
}

/** How far `drawn` (everything on screen) reaches past `centers` (the node centers on screen), never negative. */
export function marginsOf(centers: Box, drawn: Box): Margins {
  return {
    left: Math.max(0, centers.x0 - drawn.x0),
    right: Math.max(0, drawn.x1 - centers.x1),
    top: Math.max(0, centers.y0 - drawn.y0),
    bottom: Math.max(0, drawn.y1 - centers.y1),
  };
}

/**
 * The People frame (R88): as tall as the drawing's shape asks at this width, between 360px and 78% of the viewport
 * (820px at most). A NARROW frame is as tall as the drawing (`worldHeight` layout units, plus room for padding and
 * names) at the zoom it will get, between 360px and 70% of the viewport (640px at most).
 */
export function frameHeight(width: number, drawingAspect: number, viewportHeight: number, worldHeight = 0): number {
  if (width < NARROW) {
    const drawn = Math.max(width * drawingAspect, worldHeight * NARROW_ZOOM) + NARROW_ROOM;
    return Math.round(Math.max(360, Math.min(drawn, viewportHeight * 0.7, 640)));
  }
  const top = Math.max(360, Math.min(viewportHeight * 0.78, 820));
  return Math.round(Math.min(Math.max(width * drawingAspect, 360), top));
}

/** Pixels a NARROW frame adds to its drawing's height: the fit's padding and a line of names above and below. */
const NARROW_ROOM = 96;

/** A rectangle by x, y, width and height. */
export interface Rect { x: number; y: number; w: number; h: number }

/** A label box on screen; higher `priority` keeps its place when two collide. */
export interface EdgeLabel extends Rect { id: string; priority: number }

const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * The money amounts on a chosen node's edges (R81): each starts centred on its edge's midpoint; for a few rounds,
 * a label that overlaps a fixed `obstacle` (a node's name or mark) or a higher-priority label is pushed vertically
 * clear of it, toward the side it already leans to. Labels that still overlap anything are dropped (the profile
 * and the table carry every amount). Returns the kept labels at their final positions, highest priority first.
 */
export function separateLabels(labels: readonly EdgeLabel[], obstacles: readonly Rect[] = [], rounds = 6, gap = 2): EdgeLabel[] {
  const order = [...labels].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1)).map((l) => ({ ...l }));
  const clear = (b: EdgeLabel, a: Rect) => {
    b.y = b.y + b.h / 2 >= a.y + a.h / 2 ? a.y + a.h + gap : a.y - b.h - gap;
  };
  for (let round = 0; round < rounds; round += 1) {
    let moved = false;
    order.forEach((b, j) => {
      const blocker = obstacles.find((o) => hit(b, o)) ?? order.slice(0, j).find((a) => hit(a, b));
      if (!blocker) return;
      clear(b, blocker);
      moved = true;
    });
    if (!moved) break;
  }
  const kept: EdgeLabel[] = [];
  for (const label of order) if (!obstacles.some((o) => hit(label, o)) && !kept.some((other) => hit(label, other))) kept.push(label);
  return kept;
}
