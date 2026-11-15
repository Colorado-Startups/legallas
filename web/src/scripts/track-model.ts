// SPDX-License-Identifier: Apache-2.0
// Track pages (/complaint/ and /regulator/), the pure half: which tracks a page shows, each violation's points,
// the proof meter, step keys, the figures and the cap chart, and the parties the control panels draw (the guide has its
// own model, track-guide-model.ts). No DOM, so track-model.test.ts runs it under node --test. Everything
// matter-specific arrives from GET /api/matter; nothing here names a party.
import type {
  ProofStrength, RoomTrack, RoomTrackPoint, RoomViolation, RoomViolationFigure, RoomViolationStep, ServedCite, ServedMatter, TrackKind,
} from './matter-api.ts';
import { strongestProof } from './overview-case-model.ts';
import type { ControlLink, ControlParty } from './viz/control-layout.ts';

type Id = string;

export type { TrackKind };

/** A track of the served matter. */
export type Track = RoomTrack;
/** One point of a track. */
export type TrackPoint = RoomTrackPoint;
/** A violation of the served matter. */
export type TrackViolation = RoomViolation;
/** One step in a violation's story. */
export type TrackStep = RoomViolationStep;
/** One figure of a violation. */
export type TrackFigure = RoomViolationFigure;
/** The served matter, as the track views take it. */
export type TrackMatter = ServedMatter;

/** The tracks of one kind, in manifest order. A manifest built before tracks serves an empty list. */
export function tracksOfKind(matter: TrackMatter, kind: TrackKind): Track[] {
  return (matter.tracks ?? []).filter((track) => track.kind === kind);
}

/** The track a ?track=<id> link names, else the first. Null when there are none. */
export function pickTrack(tracks: readonly Track[], requested: string | null): Track | null {
  return tracks.find((track) => track.id === requested) ?? tracks[0] ?? null;
}

/** The track's violations, in the track's order; ids the matter does not hold are skipped. */
export function violationsOf(track: Track, matter: TrackMatter): TrackViolation[] {
  const byId = new Map((matter.violations ?? []).map((v) => [v.id, v]));
  return track.violations.flatMap((id) => byId.get(id) ?? []);
}

/** The points to prove for one violation, in the track's order. */
export function pointsFor(track: Track, violation: Id): TrackPoint[] {
  return track.points.filter((point) => point.violation === violation);
}

/** Direct or corroborating proof secures a point; circumstantial alone does not, and a gap never does. */
export function isSecured(strength: ProofStrength): boolean {
  return strength === 'direct' || strength === 'corroborating';
}

/** The secured count and total of a track's points, with one pip per point. */
export interface Meter {
  secured: number;
  total: number;
  /** One pip per point, in order: the strongest proof each point has. */
  pips: ProofStrength[];
}

/** The proof meter for a set of points: how many are secured, never a score or a color scale. */
export function proofMeter(points: readonly Pick<TrackPoint, 'proof'>[]): Meter {
  const pips = points.map((point) => strongestProof(point).strength);
  return { secured: pips.filter(isSecured).length, total: pips.length, pips };
}

/** "Proof secured 2 of 3"; "No points listed yet." for an empty meter. */
export function meterLabel(meter: Pick<Meter, 'secured' | 'total'>): string {
  if (meter.total === 0) return 'No points listed yet.';
  return `Proof secured ${meter.secured} of ${meter.total}`;
}

/** The step a key moves to in a horizontal stepper: arrows step and stop at the ends, Home and End jump. */
export function stepKey(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return Math.min(index + 1, count - 1);
    case 'ArrowLeft':
    case 'ArrowUp':
      return Math.max(index - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** A step in ISO form for the stepper ("2024-01-01", "2025-06", "2024"); dates are partial ISO already. */
export function stepDate(step: Pick<TrackStep, 'date'>): string {
  return /^\d{4}(-\d{2}(-\d{2})?)?$/.test(step.date) ? step.date : '';
}

/** One row of a cap chart: its id, label and value. */
export interface CapRow {
  id: Id;
  label: string;
  value: number;
  limit: number;
  cite: ServedCite | null;
}

/** A cap chart: its unit, its rows and the limits drawn as rules. */
export interface CapChart {
  unit: TrackFigure['unit'];
  rows: CapRow[];
  /** The limits drawn as rules, each once, smallest first. */
  limits: number[];
  /** The axis end: the largest value or limit, rounded up to a round number. */
  max: number;
}

/** 64 -> 70, 100 -> 100, 101 -> 120, 1234 -> 1400: the next round step at or above `n`. */
export function niceCeil(n: number): number {
  if (!(n > 0)) return 1;
  const step = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 1.2, 1.4, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10]) {
    const value = m * step;
    if (value >= n - 1e-9) return Math.round(value * 1e6) / 1e6;
  }
  return 10 * step;
}

/**
 * Figures that carry a limit, each against its own limit. One chart per unit (the first unit that has limits);
 * values are drawn side by side and never added together. Null when no figure has a limit.
 */
export function capChart(figures: readonly TrackFigure[]): CapChart | null {
  const limited = figures.filter((f) => f.limit !== null && Number.isFinite(f.limit) && f.limit > 0 && Number.isFinite(f.value));
  if (limited.length === 0) return null;
  const unit = limited[0].unit;
  const rows = limited
    .filter((f) => f.unit === unit)
    .map((f) => ({ id: f.id, label: f.label, value: Math.max(0, f.value), limit: f.limit as number, cite: f.cites[0] ?? null }));
  const limits = [...new Set(rows.map((r) => r.limit))].sort((a, b) => a - b);
  const max = niceCeil(Math.max(...rows.map((r) => r.value), ...limits));
  return { unit, rows, limits, max };
}

/** Where a value sits along a plot `width` wide, for an axis from 0 to `max`. */
export function capX(value: number, max: number, width: number): number {
  if (!(max > 0) || !(width > 0)) return 0;
  return Math.round((Math.min(Math.max(value, 0), max) / max) * width * 100) / 100;
}

/**
 * The parties and dated ties the control panels read (viz/control-layout.ts): every person and org with its side,
 * and every link with its statements (none for a link without them, which the panels leave out).
 */
export function controlInputs(matter: TrackMatter): { parties: Map<Id, ControlParty>; links: ControlLink<ServedCite>[] } {
  const parties = new Map<Id, ControlParty>();
  for (const p of matter.people) parties.set(p.id, { id: p.id, name: p.name, side: p.side, kind: 'person', parent: null, formed: null });
  for (const o of matter.orgs) {
    parties.set(o.id, { id: o.id, name: o.name, side: o.side, kind: 'org', parent: o.parent, formed: o.formed ?? null, cites: o.cites });
  }
  const links = matter.links.map((l) => ({ from: l.from, to: l.to, label: l.label, statements: l.statements ?? [] }));
  return { parties, links };
}
