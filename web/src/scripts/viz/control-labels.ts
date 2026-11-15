// SPDX-License-Identifier: Apache-2.0
// Track pages, the control panels: where each tie's words sit (control-geometry.ts places the nodes and lines, then
// calls placeLabels). A box of words never covers a node, nor another box drawn at the same step. The search, where
// the first clear place wins:
// 1. on the line, from the middle out;
// 2. nudged clear of what is in the way at each of those places, joined to its line by a leader;
// 3. further out around the line, nearest first, with a leader;
// 4. the same three for the short words (the tie and its state; the full words stay in the tooltip and the table);
// 5. the clear place nearest the line anywhere on the canvas, else below the picture, with a leader.
// Within each stage a place clear of every box (at every step) beats one clear only of the boxes drawn with it, so
// the places stay put from step to step where there is room. No DOM, so control-labels.test.ts runs it under node.

import type { TieAt } from './control-layout.ts';
import { fitLabel, textWidth } from './core.ts';

/** A rectangle by x, y, width and height. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A point as an x and y pair. */
export type Point = [number, number];

/** A size as width and height. */
export interface Size {
  w: number;
  h: number;
}

/** Two boxes closer than `pad` px count as touching. */
export function overlaps(a: Rect, b: Rect, pad = 4): boolean {
  return a.x - pad < b.x + b.w && b.x - pad < a.x + a.w && a.y - pad < b.y + b.h && b.y - pad < a.y + a.h;
}

const FONT_PX = 12;
const LINE_H = 15;
/** Padding and border across a box, both sides together. */
const PAD_X = 12;
/** The widest a full tie label may be, in pixels. */
export const LABEL_MAX_W = 220;
const SHORT_MAX_W = 150;
/**
 * Lines of words a full label may take: five for the tie and its state, five more for a later claim beside a
 * denial (two over the old three, so a claim reads whole; track-control.css clamps at the same counts, and print
 * never does).
 */
export const FULL_LINES: [number, number] = [5, 5];
/** The short form: two lines for the tie and its state, one for "Claimed later". */
const SHORT_LINES: [number, number] = [2, 1];

/** How many lines `text` takes wrapped by words at `maxW` px (a word wider than the line takes more than one). */
export function wrapLines(text: string, maxW: number): number {
  const space = textWidth(' ', FONT_PX);
  let lines = 0;
  let used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const w = textWidth(word, FONT_PX);
    if (lines > 0 && used + space + w <= maxW) {
      used += space + w;
      continue;
    }
    lines += Math.max(1, Math.ceil(w / maxW));
    used = w > maxW ? w % maxW : w;
  }
  return lines;
}

const WIDEN_STEP = 16;

/** Whether every step's words fit `w` px wide within `most` lines (words, later claim). */
function fitsWithin(texts: readonly (readonly [string, string])[], w: number, most: [number, number]): boolean {
  return texts.every(([words, later]) => wrapLines(words, w - PAD_X) <= most[0] && wrapLines(later, w - PAD_X) <= most[1]);
}

/** One box for the words a tie takes across the steps: [words, later claim] per step, '' where none. */
function boxFor(texts: readonly (readonly [string, string])[], maxW: number, half: boolean, most: [number, number]): Size {
  const longest = Math.max(0, ...texts.flat().map((t) => textWidth(t, FONT_PX)));
  // The full words wrap onto about two lines; the short words keep to one where they can.
  let w = Math.min(maxW, Math.max(56, Math.ceil(half ? longest / 2 : longest) + PAD_X + 8));
  // Full words are never cut: a box whose words need more lines than it may take widens until they fit (or it
  // reaches `maxW`, where the clamp and the tooltip take over on screen; print shows them whole).
  if (half) while (w < maxW && !fitsWithin(texts, w, most)) w = Math.min(maxW, w + WIDEN_STEP);
  const lines = Math.max(1, ...texts.map(([words, later]) =>
    Math.min(wrapLines(words, w - PAD_X), most[0]) + Math.min(wrapLines(later, w - PAD_X), most[1])));
  return { w, h: lines * LINE_H + 6 };
}

/** The box for a tie's full words, at most `maxW` wide (parallel ties pass less so they sit side by side). */
export function fullSize(texts: readonly (readonly [string, string])[], maxW = LABEL_MAX_W): Size {
  return boxFor(texts, maxW, true, FULL_LINES);
}

/** The box for a tie's short words. */
export function shortSize(texts: readonly (readonly [string, string])[], maxW = SHORT_MAX_W): Size {
  return boxFor(texts, Math.min(maxW, SHORT_MAX_W), false, SHORT_LINES);
}

/**
 * A tie's words in short form, for a box that has no room for the full words: the tie and its state ("owner of,
 * denied"), then "Claimed later" under a denial a later source answers, so the denial still reads first. Record and
 * alleged words are short already.
 */
export function shortWords(label: string, tie: Pick<TieAt, 'state' | 'words' | 'later'>): [string, string] {
  const fit = (t: string) => fitLabel(t, (SHORT_MAX_W - PAD_X) * SHORT_LINES[0], FONT_PX);
  if (tie.state === 'claimed') return [fit(`${label}, claimed later`), ''];
  if (tie.state === 'denied') return [fit(`${label}, denied`), tie.later ? 'Claimed later' : ''];
  return [fit(tie.words), ''];
}

/**
 * A node's name as drawn: a series name ("X, a series of Y") keeps the series ("X") so it fits the box; the full
 * name stays in the node's tooltip, its accessible name and the table twin.
 */
export function shortName(name: string): string {
  const at = name.indexOf(', a series of ');
  return at > 0 ? name.slice(0, at) : name;
}

/** What placeLabels needs to know about one tie. */
export interface LabelSpec {
  /** The point on the tie's line at `t`: 0 at its start, 1 at its end. */
  at(t: number): Point;
  full: Size;
  short: Size;
  /** Per step, whether the tie is drawn. Two boxes clash only when a step draws both. */
  shown: readonly boolean[];
}

/** A thin line from the point on the tie's line (`x`, `y`) to the nearest edge of its box. */
export interface Leader {
  d: string;
  x: number;
  y: number;
}

/** A placed tie label: its box, and whether the box holds the short words. */
export interface PlacedLabel {
  box: Rect;
  /** The box holds the short words. */
  short: boolean;
  leader: Leader | null;
}

/** Places along the line, from the middle out: the first seven are the places the panels have always tried. */
const ALONG = [0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8, 0.44, 0.56, 0.33, 0.67, 0.24, 0.76, 0.14, 0.86];
/** Where the search further out starts from, and how far it goes. */
const AROUND = [0.5, 0.35, 0.65, 0.2, 0.8];
const RING_STEP = 12;
const RING_MAX = 240;
const ANGLES = 16;
const SCAN_STEP = 8;
/** Space kept between a nudged box and what it moved clear of. */
const GAP = 6;

interface Candidate {
  box: Rect;
  anchor: Point;
}

const centered = (p: Point, size: Size): Rect => ({ x: p[0] - size.w / 2, y: p[1] - size.h / 2, w: size.w, h: size.h });

function* onLine(spec: LabelSpec, size: Size): Generator<Candidate> {
  for (const t of ALONG) yield { box: centered(spec.at(t), size), anchor: spec.at(t) };
}

/** Each place along the line, moved just clear of each box in its way: left, right, above or below it. */
function* nudged(spec: LabelSpec, size: Size, inWay: (box: Rect) => Rect[]): Generator<Candidate> {
  for (const t of ALONG) {
    const anchor = spec.at(t);
    const box = centered(anchor, size);
    const moves = inWay(box).flatMap((o): Point[] => [
      [o.x - GAP - (box.x + box.w), 0], [o.x + o.w + GAP - box.x, 0], [0, o.y - GAP - (box.y + box.h)], [0, o.y + o.h + GAP - box.y],
    ]);
    moves.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
    for (const [dx, dy] of moves) yield { box: { ...box, x: box.x + dx, y: box.y + dy }, anchor };
  }
}

function* around(spec: LabelSpec, size: Size): Generator<Candidate> {
  for (let r = RING_STEP; r <= RING_MAX; r += RING_STEP) {
    for (const t of AROUND) {
      const anchor = spec.at(t);
      for (let k = 0; k < ANGLES; k += 1) {
        const a = (k / ANGLES) * 2 * Math.PI;
        yield { box: centered([anchor[0] + r * Math.cos(a), anchor[1] + r * Math.sin(a)], size), anchor };
      }
    }
  }
}

function leaderTo(anchor: Point, box: Rect): Leader | null {
  const near: Point = [Math.min(Math.max(anchor[0], box.x), box.x + box.w), Math.min(Math.max(anchor[1], box.y), box.y + box.h)];
  if (Math.hypot(near[0] - anchor[0], near[1] - anchor[1]) < 2) return null;
  const r = (n: number) => Math.round(n * 10) / 10;
  return { d: `M${r(anchor[0])} ${r(anchor[1])}L${r(near[0])} ${r(near[1])}`, x: r(anchor[0]), y: r(anchor[1]) };
}

/**
 * Places every tie's words, in order: each box clears every node, stays inside `width` and `height`, and clears
 * every box placed before it that a step draws with it. Returns the boxes and the canvas height, which grows only
 * when a box has nowhere to go but below the picture.
 */
export function placeLabels(specs: readonly LabelSpec[], nodes: readonly Rect[], width: number, height: number): { labels: PlacedLabel[]; height: number } {
  const placed: { box: Rect; shown: readonly boolean[] }[] = [];
  let bottom = height;
  const labels = specs.map((spec): PlacedLabel => {
    const together = (shown: readonly boolean[]) => shown.some((on, i) => on && spec.shown[i]);
    const fit = (box: Rect): Rect => ({
      ...box,
      x: Math.round(Math.min(Math.max(box.x, 0), Math.max(width - box.w, 0))),
      y: Math.round(Math.min(Math.max(box.y, 0), Math.max(height - box.h, 0))),
    });
    const inWay = (box: Rect) => [...nodes, ...placed.map((p) => p.box)].filter((o) => overlaps(box, o));
    /** 2: clear of every box, 1: clear of the boxes drawn with it, 0: not clear. */
    const clearance = (box: Rect): number => {
      if (nodes.some((n) => overlaps(box, n))) return 0;
      const clash = placed.filter((p) => overlaps(box, p.box));
      return clash.length === 0 ? 2 : clash.some((p) => together(p.shown)) ? 0 : 1;
    };
    const done = (c: Candidate, short: boolean): PlacedLabel => {
      placed.push({ box: c.box, shown: spec.shown });
      return { box: c.box, short, leader: leaderTo(c.anchor, c.box) };
    };
    for (const short of [false, true]) {
      const size = short ? spec.short : spec.full;
      for (const stage of [onLine(spec, size), nudged(spec, size, inWay), around(spec, size)]) {
        let fallback: Candidate | null = null;
        for (const c of stage) {
          const box = fit(c.box);
          const clear = clearance(box);
          if (clear === 2) return done({ box, anchor: c.anchor }, short);
          if (clear === 1) fallback ??= { box, anchor: c.anchor };
        }
        if (fallback) return done(fallback, short);
      }
    }
    // 5: the clear place nearest the line's middle anywhere on the canvas, else a new strip below the picture.
    const anchor = spec.at(0.5);
    const size = spec.short;
    let best: Candidate | null = null;
    let bestDist = Infinity;
    for (let y = 0; y + size.h <= height; y += SCAN_STEP) {
      for (let x = 0; x + size.w <= width; x += SCAN_STEP) {
        const box = { x, y, w: size.w, h: size.h };
        const dist = Math.hypot(Math.min(Math.max(anchor[0], x), x + size.w) - anchor[0], Math.min(Math.max(anchor[1], y), y + size.h) - anchor[1]);
        if (dist < bestDist && clearance(box) > 0) [best, bestDist] = [{ box, anchor }, dist];
      }
    }
    if (best) return done(best, true);
    const box = { x: Math.round(Math.min(Math.max(anchor[0] - size.w / 2, 0), Math.max(width - size.w, 0))), y: bottom + GAP, w: size.w, h: size.h };
    bottom = box.y + box.h;
    return done({ box, anchor }, true);
  });
  return { labels, height: bottom };
}
