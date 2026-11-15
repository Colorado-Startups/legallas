// SPDX-License-Identifier: Apache-2.0
// Card F5a (timeline viz). Axis tick choice: the finest calendar interval whose ISO labels ("2023-10-17",
// "2023-10", "2023") still fit side by side at the plot's width. Pure: no DOM.
import { utcDay, utcMonday, utcMonth, utcYear, type CountableTimeInterval, type TimeInterval } from 'd3-time';
import { DAY_MS, isoLabel, type Precision } from './timeline-dates.ts';

interface Candidate {
  name: string;
  interval: TimeInterval;
  /** Typical length in milliseconds, for the fit estimate. */
  ms: number;
  precision: Precision;
}

function every(interval: CountableTimeInterval, step: number): TimeInterval {
  return interval.every(step) ?? interval;
}

const CANDIDATES: Candidate[] = [
  { name: 'day', interval: utcDay, ms: DAY_MS, precision: 'day' },
  { name: 'week', interval: utcMonday, ms: 7 * DAY_MS, precision: 'day' },
  { name: 'month', interval: utcMonth, ms: 30.44 * DAY_MS, precision: 'month' },
  { name: 'quarter', interval: every(utcMonth, 3), ms: 91.3 * DAY_MS, precision: 'month' },
  { name: 'half', interval: every(utcMonth, 6), ms: 182.6 * DAY_MS, precision: 'month' },
  { name: 'year', interval: utcYear, ms: 365.25 * DAY_MS, precision: 'year' },
  { name: '2 years', interval: every(utcYear, 2), ms: 730.5 * DAY_MS, precision: 'year' },
  { name: '5 years', interval: every(utcYear, 5), ms: 1826.25 * DAY_MS, precision: 'year' },
  { name: '10 years', interval: every(utcYear, 10), ms: 3652.5 * DAY_MS, precision: 'year' },
  { name: '25 years', interval: every(utcYear, 25), ms: 9131.25 * DAY_MS, precision: 'year' },
];

/** Mono 12px is about 7.2px a character. */
export const TICK_CHAR = 7.2;
/** Tick labels sit this far right of their tick. */
export const TICK_OFFSET = 4;

/** True when a label starting at a tick at `x` ends inside `width`; a label that would clip is dropped, tick kept. */
export function tickLabelFits(x: number, label: string, width: number): boolean {
  return x + TICK_OFFSET + label.length * TICK_CHAR <= width;
}

/** Room one tick label needs, by precision, plus breathing space. */
export const LABEL_ROOM: Record<Precision, number> = { day: 92, month: 72, year: 48 };

/** A timeline tick: its value and label. */
export interface Tick {
  value: number;
  label: string;
}

/** A chosen tick scale: its name, its precision and its ticks. */
export interface TickChoice {
  name: string;
  precision: Precision;
  ticks: Tick[];
}

/** The finest interval whose labels fit; falls back to the coarsest when even that is crowded. */
export function chooseTicks(start: number, end: number, width: number): TickChoice {
  const span = Math.max(1, end - start);
  const pick =
    CANDIDATES.find((candidate) => (span / candidate.ms) * LABEL_ROOM[candidate.precision] <= width) ??
    CANDIDATES[CANDIDATES.length - 1];
  const values = pick.interval.range(new Date(start), new Date(end + 1)).map((date) => date.getTime());
  return {
    name: pick.name,
    precision: pick.precision,
    ticks: values.map((value) => ({ value, label: isoLabel(value, pick.precision) })),
  };
}
