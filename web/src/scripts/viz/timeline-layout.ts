// SPDX-License-Identifier: Apache-2.0
// Card F5a (timeline viz). Geometry for one render: lane bands, packed mark rows, which labels fit, and the axis
// ticks, for a given width and time window. The DOM layer only paints what this returns. Pure: no DOM.
import { isSpan, midpoint } from './timeline-dates.ts';
import type { Lane, MarkSide, PeriodSpan, TimelineItem } from './timeline-model.ts';
import { packLane, PACK_GAP, truncate, type Extent } from './timeline-pack.ts';
import { chooseTicks, tickLabelFits, type Tick } from './timeline-ticks.ts';
import { scaleUtc } from 'd3-scale';
import type { Domain } from './timeline-zoom.ts';

/** How the timeline is drawn: the full chart or the compact ribbon. */
export type TimelineMode = 'full' | 'ribbon';

interface Metrics {
  rowH: number;
  mark: number;
  lanePad: number;
  labelCol: number;
  laneHead: number;
  axisH: number;
  maxRows: number;
  /** Below this width lane labels leave the side column (full: a strip over each lane; ribbon: the legend). */
  narrow: number;
}

/** The sizes the timeline uses in each mode. */
export const METRICS: Record<TimelineMode, Metrics> = {
  full: { rowH: 28, mark: 16, lanePad: 6, labelCol: 168, laneHead: 22, axisH: 28, maxRows: 4, narrow: 640 },
  ribbon: { rowH: 20, mark: 12, lanePad: 2, labelCol: 136, laneHead: 0, axisH: 24, maxRows: 1, narrow: 480 },
};

/** Inter at 13px averages about 6.9px a character; the estimate errs wide so a label never runs into a mark. */
export const LABEL_CHAR = 7;
const PLOT_END_PAD = 8;
/** A partial-date band shows only when it is this much wider than the mark. */
export const MIN_BAND_SPARE = 8;

/** One lane of the timeline layout: its key, label and side. */
export interface LaneBox {
  key: string;
  label: string;
  side: MarkSide | null;
  /** A violation lane's letter. */
  letter?: string;
  y: number;
  height: number;
  rows: number;
}

/** One mark of the timeline layout: its item and its lane. */
export interface MarkBox {
  id: string;
  item: TimelineItem;
  lane: number;
  cx: number;
  cy: number;
  size: number;
  /** The partial-date band, when the date is a month or a year; clipped to the plot. */
  band: { x0: number; x1: number } | null;
  label: string;
  labelX: number;
}

/** The computed timeline layout: its size and its plot area. */
export interface TimelineLayout {
  width: number;
  height: number;
  plotX0: number;
  plotX1: number;
  /** Where lanes begin and end vertically. */
  top: number;
  bottom: number;
  /** The axis baseline: above the lanes in full mode, below them in the ribbon. */
  axisY: number;
  sideLabels: boolean;
  lanes: LaneBox[];
  marks: MarkBox[];
  /** Axis ticks inside the window, with their x. */
  ticks: (Tick & { x: number })[];
  /** Violation periods behind the plot, clipped to it; `edge` is false when the period began before the window. */
  periods: PeriodBox[];
  /**
   * The top of the strip that holds the period tags, just above the lanes (under the axis in full mode); equals
   * `top` with no periods.
   */
  periodTop: number;
}

/** One period band of the timeline: its key and letter. */
export interface PeriodBox {
  key: string;
  letter: string;
  x0: number;
  x1: number;
  edge: boolean;
  /** Where the letter tag's left side sits, nudged right so tags never overlap. */
  tagX: number;
}

/** A period's letter tag is this wide; the next tag starts at least this far plus a gap along. */
export const PERIOD_TAG = 18;
/** With periods, a strip this tall above the lanes holds their tags, so a tag never sits on a mark. */
export const PERIOD_STRIP = 22;
const PERIOD_TAG_GAP = 4;

/** The periods inside the window as x ranges, tags placed left to right without overlapping. Pure. */
export function placePeriods(periods: readonly PeriodSpan[], domain: Domain, x: (ms: number) => number, x0: number, x1: number): PeriodBox[] {
  const boxes: PeriodBox[] = [];
  let nextTag = -Infinity;
  const inWindow = periods
    .filter((period) => period.start < domain.end && (period.end === null || period.end > domain.start))
    .sort((a, b) => a.start - b.start || a.letter.localeCompare(b.letter));
  for (const period of inWindow) {
    const edge = period.start >= domain.start;
    const left = edge ? x(period.start) : x0;
    const right = period.end === null || period.end >= domain.end ? x1 : x(period.end);
    const tagX = Math.min(Math.max(left, nextTag), x1 - PERIOD_TAG);
    nextTag = tagX + PERIOD_TAG + PERIOD_TAG_GAP;
    boxes.push({ key: period.key, letter: period.letter, x0: left, x1: Math.max(left, right), edge, tagX });
  }
  return boxes;
}

interface Placed {
  item: TimelineItem;
  cx: number;
  band: { x0: number; x1: number } | null;
  extent: Extent;
}

type XScale = (ms: number) => number;

function place(item: TimelineItem, x: XScale, x0: number, x1: number, size: number, labels: boolean): Placed {
  const half = size / 2;
  let band: Placed['band'] = null;
  let cx: number;
  if (isSpan(item.span)) {
    const b0 = Math.max(x0, x(item.span.start));
    const b1 = Math.min(x1, x(item.span.end));
    cx = (b0 + b1) / 2;
    // A band no wider than its mark says nothing; the tooltip and aria-label still give the precision.
    if (b1 - b0 >= size + MIN_BAND_SPARE) band = { x0: b0, x1: b1 };
  } else {
    cx = x(midpoint(item.span));
  }
  const left = Math.min(cx - half, band ? band.x0 : Infinity);
  const right = Math.max(cx + half, band ? band.x1 : -Infinity);
  const label = labels ? item.event.title.length * LABEL_CHAR : 0;
  return { item, cx, band, extent: { x0: left, x1: right, label } };
}

function visible(item: TimelineItem, domain: Domain): boolean {
  return item.span.end > domain.start && item.span.start < domain.end;
}

/**
 * Lay out the visible items. `items` are already filtered; lanes keep their order even when empty. `periods` are
 * the violation bands drawn behind the lanes.
 */
export function layoutTimeline(
  lanes: Lane[], items: TimelineItem[], domain: Domain, width: number, mode: TimelineMode, periods: readonly PeriodSpan[] = [],
): TimelineLayout {
  const m = METRICS[mode];
  const sideLabels = width >= m.narrow;
  const plotX0 = (sideLabels ? m.labelCol : 0) + m.mark / 2;
  const plotX1 = Math.max(plotX0 + 1, width - m.mark / 2);
  const laneHead = sideLabels ? 0 : m.laneHead;
  const labels = mode === 'full';
  const scale = scaleUtc().domain([domain.start, domain.end]).range([plotX0, plotX1]);
  const x: XScale = (ms) => scale(ms);
  const strip = periods.length ? PERIOD_STRIP : 0;
  const periodTop = mode === 'full' ? m.axisH : 0;
  const top = periodTop + strip;
  let y = top;
  const laneBoxes: LaneBox[] = [];
  const marks: MarkBox[] = [];
  lanes.forEach((lane, laneIndex) => {
    const placed = items
      .filter((item) => item.lane === lane.key && visible(item, domain))
      .map((item) => place(item, x, plotX0, plotX1, m.mark, labels));
    const packed =
      m.maxRows > 1
        ? packLane(placed.map((p) => p.extent), plotX1 + m.mark / 2 - PLOT_END_PAD, m.maxRows)
        : { rows: placed.map(() => 0), rowCount: placed.length ? 1 : 0, labels: placed.map(() => 0) };
    const rows = Math.max(1, packed.rowCount);
    const height = laneHead + m.lanePad * 2 + rows * m.rowH;
    placed.forEach((p, index) => {
      const cy = y + laneHead + m.lanePad + packed.rows[index] * m.rowH + m.rowH / 2;
      const label = packed.labels[index] > 0 ? truncate(p.item.event.title, packed.labels[index], LABEL_CHAR) : '';
      marks.push({
        id: p.item.id, item: p.item, lane: laneIndex, cx: p.cx, cy, size: m.mark, band: p.band,
        label, labelX: p.extent.x1 + PACK_GAP,
      });
    });
    laneBoxes.push({ key: lane.key, label: lane.label, side: lane.side, letter: lane.letter, y, height, rows });
    y += height;
  });
  const bottom = y;
  const height = mode === 'full' ? bottom + 4 : bottom + m.axisH;
  const ticks = chooseTicks(domain.start, domain.end, plotX1 - plotX0)
    .ticks.filter((tick) => tick.value >= domain.start && tick.value <= domain.end)
    .map((tick) => ({ ...tick, x: x(tick.value) }))
    .map((tick) => (tickLabelFits(tick.x, tick.label, width) ? tick : { ...tick, label: '' }));
  return {
    width, height, plotX0, plotX1, top, bottom, axisY: mode === 'full' ? periodTop : bottom, sideLabels,
    lanes: laneBoxes, marks, ticks, periods: placePeriods(periods, domain, x, plotX0, plotX1), periodTop,
  };
}
