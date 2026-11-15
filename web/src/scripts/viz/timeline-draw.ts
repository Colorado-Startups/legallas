// SPDX-License-Identifier: Apache-2.0
// Card F5a (timeline viz). Paints a TimelineLayout into an SVG: the static drawing (grid, axis, lane rules and
// labels) as one role="img" group with a text summary, then each event as a focusable mark in a sibling group.
// role="img" hides its children from assistive tech, so the events cannot live inside it.
import { LABEL_CHAR, METRICS, PERIOD_TAG, type MarkBox, type TimelineLayout } from './timeline-layout.ts';
import { describeEvent, SIDE_LABELS } from './timeline-model.ts';
import { truncate } from './timeline-pack.ts';
import { clear, crisp, shape, svg } from './timeline-svg.ts';
import { TICK_OFFSET } from './timeline-ticks.ts';

/** Hit targets are at least this square (web/DESIGN.md --target-min). */
const HIT = 24;
const AXIS_TEXT_GAP = 8;

/** The focused and selected marks while the timeline draws. */
export interface DrawState {
  focusedId: string | null;
  selectedId: string | null;
}

function drawGrid(g: SVGGElement, layout: TimelineLayout): void {
  for (const tick of layout.ticks) {
    const x = crisp(tick.x);
    svg('line', { class: 'tl-grid', x1: x, x2: x, y1: layout.periodTop, y2: layout.bottom }, g);
  }
}

function drawAxis(g: SVGGElement, layout: TimelineLayout, ribbon: boolean): void {
  const y = crisp(layout.axisY);
  svg('line', { class: 'tl-axis', x1: layout.plotX0, x2: layout.plotX1, y1: y, y2: y }, g);
  const textY = ribbon ? layout.axisY + AXIS_TEXT_GAP + 8 : layout.axisY - AXIS_TEXT_GAP;
  for (const tick of layout.ticks) {
    const x = tick.x;
    svg('line', { class: 'tl-axis', x1: crisp(x), x2: crisp(x), y1: y, y2: ribbon ? y + 4 : y - 4 }, g);
    if (!tick.label) continue;
    const text = svg('text', { class: 'tl-tick', x: x + TICK_OFFSET, y: textY }, g);
    text.textContent = tick.label;
  }
}

/**
 * The violation mark's outline as polygon points in a unit square (DESIGN.md section 3, the c-mark clip-paths):
 * A a shield, B an octagon, C a pennant, any other letter a tab. `dx`/`dy` nudge the letter into the shape.
 */
export const MARK_SHAPES: Record<string, { points: [number, number][]; dx: number; dy: number }> = {
  A: { points: [[0, 0], [1, 0], [1, 0.6], [0.5, 1], [0, 0.6]], dx: 0, dy: -0.09 },
  B: { points: [[0.3, 0], [0.7, 0], [1, 0.3], [1, 0.7], [0.7, 1], [0.3, 1], [0, 0.7], [0, 0.3]], dx: 0, dy: 0 },
  C: { points: [[0, 0], [1, 0], [0.76, 0.5], [1, 1], [0, 1]], dx: -0.07, dy: 0 },
  other: { points: [[0.25, 0], [1, 0], [1, 1], [0, 1], [0, 0.25]], dx: 0, dy: 0 },
};

/** A violation's mark in SVG: the lane label's key and each period band's tag, `PERIOD_TAG` square. */
function letterTag(letter: string, x: number, cy: number, g: SVGGElement, kind: 'lane' | 'period'): void {
  const size = PERIOD_TAG;
  const shape = MARK_SHAPES[letter] ?? MARK_SHAPES.other;
  const y = cy - size / 2;
  const tag = svg('g', { class: `tl-letter tl-letter--${kind}`, 'data-mark': letter }, g);
  const points = shape.points.map(([px, py]) => `${x + px * size},${y + py * size}`).join(' ');
  svg('polygon', { points }, tag);
  const text = svg('text', {
    x: x + size * (0.5 + shape.dx), y: cy + size * shape.dy, 'text-anchor': 'middle', 'dominant-baseline': 'central',
  }, tag);
  text.textContent = letter;
}

/**
 * The violation periods behind the lanes: a light field, a rule where the period begins, and its letter in the
 * strip above the lanes. Fields overlap where periods do, so the overlap reads a shade darker.
 */
function drawPeriods(g: SVGGElement, layout: TimelineLayout): void {
  const y0 = layout.periodTop;
  const tagY = (layout.periodTop + layout.top) / 2;
  // Fields first, then rules, then marks, so a later field never covers an earlier period's mark.
  for (const period of layout.periods) {
    svg('rect', {
      class: 'tl-period', 'data-mark': period.letter, x: period.x0, y: y0, width: period.x1 - period.x0, height: layout.bottom - y0,
    }, g);
  }
  for (const period of layout.periods.filter((candidate) => candidate.edge)) {
    const x = crisp(period.x0);
    svg('line', { class: 'tl-period-edge', x1: x, x2: x, y1: y0, y2: layout.bottom }, g);
  }
  for (const period of layout.periods) letterTag(period.letter, period.tagX, tagY, g, 'period');
}

function drawLanes(g: SVGGElement, layout: TimelineLayout, ribbon: boolean): void {
  // Beside the plot a label has the side column; above a lane (narrow) it has the full width.
  const room = layout.sideLabels ? METRICS[ribbon ? 'ribbon' : 'full'].labelCol - 8 : layout.width;
  layout.lanes.forEach((lane, index) => {
    if (index > 0) {
      const y = crisp(lane.y);
      svg('line', { class: 'tl-lane-rule', x1: 0, x2: layout.width, y1: y, y2: y }, g);
    }
    const labelY = layout.sideLabels ? lane.y + lane.height / 2 : lane.y + 13;
    let x = 0;
    if (lane.side) {
      shape(lane.side, 12, 6, labelY, g);
      x = 18;
    } else if (lane.letter) {
      letterTag(lane.letter, 0, labelY, g, 'lane');
      x = PERIOD_TAG + 6;
    }
    const text = svg('text', { class: 'tl-lane-label', x, y: labelY, 'dominant-baseline': 'central' }, g);
    // Violation titles run long; other lane labels (names, kinds, sides) keep their full text as before.
    text.textContent = lane.letter ? truncate(lane.label, room - x, LABEL_CHAR) : lane.label;
  });
}

/**
 * The filing outline's key, in the lane-label column on the axis row (empty otherwise), so side lanes and
 * filings read as one legend (R59).
 */
function drawFilingKey(g: SVGGElement, layout: TimelineLayout, ribbon: boolean): void {
  const y = ribbon ? layout.axisY + AXIS_TEXT_GAP + 4 : layout.axisY - AXIS_TEXT_GAP - 4;
  shape('filing', 12, 6, y, g);
  const text = svg('text', { class: 'tl-lane-label tl-lane-label--key', x: 18, y, 'dominant-baseline': 'central' }, g);
  text.textContent = SIDE_LABELS.filing;
}

/**
 * The static drawing. `summary` is its accessible name. `labels` false leaves lane labels to an HTML legend
 * (the narrow ribbon); `filingKey` adds the filing outline's key under the lane labels.
 */
export function drawFrame(
  root: SVGSVGElement, layout: TimelineLayout, summary: string, ribbon: boolean, labels: boolean, filingKey = false,
): SVGGElement {
  clear(root);
  root.setAttribute('width', String(layout.width));
  root.setAttribute('height', String(Math.ceil(layout.height)));
  root.setAttribute('viewBox', `0 0 ${layout.width} ${Math.ceil(layout.height)}`);
  const art = svg('g', { role: 'img', 'aria-label': summary, class: 'tl-art' }, root);
  drawPeriods(art, layout);
  drawGrid(art, layout);
  drawAxis(art, layout, ribbon);
  if (labels) drawLanes(art, layout, ribbon);
  if (labels && filingKey) drawFilingKey(art, layout, ribbon);
  return svg('g', { class: 'tl-events', role: 'group' }, root);
}

function hitBox(mark: MarkBox): { x: number; width: number } {
  const x0 = Math.min(mark.cx - HIT / 2, mark.band ? mark.band.x0 : Infinity);
  const x1 = Math.max(mark.cx + HIT / 2, mark.band ? mark.band.x1 : -Infinity);
  return { x: x0, width: x1 - x0 };
}

function drawBand(g: SVGGElement, mark: MarkBox): void {
  if (!mark.band) return;
  const side = mark.item.mark;
  const { x0, x1 } = mark.band;
  const y = mark.cy;
  svg('line', { class: 'tl-band', 'data-side': side, x1: x0, x2: x1, y1: y, y2: y }, g);
  for (const x of [x0, x1]) {
    svg('line', { class: 'tl-band-cap', 'data-side': side, x1: x, x2: x, y1: y - 5, y2: y + 5 }, g);
  }
}

/** One event: hit area, partial-date band, selection and focus rings, the shape, and its title when it fits. */
export function drawEvent(parent: SVGGElement, mark: MarkBox, state: DrawState, tabbable: boolean): SVGGElement {
  // Every copy of an event (violation lanes) shows selected; selectedId is the event's id.
  const selected = state.selectedId === mark.item.event.id;
  const g = svg('g', {
    class: 'tl-event',
    'data-event-id': mark.id,
    'data-side': mark.item.mark,
    role: 'button',
    tabindex: tabbable ? 0 : -1,
    'aria-label': describeEvent(mark.item),
    'aria-current': selected ? 'true' : null,
  }, parent);
  const hit = hitBox(mark);
  svg('rect', { class: 'tl-hit', x: hit.x, y: mark.cy - HIT / 2, width: hit.width, height: HIT }, g);
  drawBand(g, mark);
  const ring = mark.size / 2 + 4;
  svg('rect', {
    class: 'tl-focus', x: mark.cx - ring, y: mark.cy - ring, width: ring * 2, height: ring * 2, rx: 4,
  }, g);
  if (selected) svg('circle', { class: 'tl-selected', cx: mark.cx, cy: mark.cy, r: mark.size / 2 + 3 }, g);
  shape(mark.item.mark, mark.size, mark.cx, mark.cy, g);
  if (mark.label) {
    const text = svg('text', { class: 'tl-label', x: mark.labelX, y: mark.cy, 'dominant-baseline': 'central' }, g);
    text.textContent = mark.label;
  }
  return g;
}
