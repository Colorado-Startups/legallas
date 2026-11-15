// SPDX-License-Identifier: Apache-2.0
// The Overview's campaign map, the pure half: one objective card per track (the parties it is against, a proof
// meter and which mini picture to draw), the violations' period bands on a year scale, and the events and money
// the violations name. No DOM, so overview-map-model.test.ts runs it under node --test.
import type { PartialDate, ProofStrength, ServedMatter } from '../../worker/matter-types.ts';
import { partyIndex, strongestProof, type Party } from './overview-case-model.ts';

type Track = ServedMatter['tracks'][number];
type Violation = ServedMatter['violations'][number];
type Step = Violation['steps'][number];
type Figure = Violation['figures'][number];
type Point = Track['points'][number];

/** Where a track's card goes: the complaint page, or the regulator page on that track's tab. */
export function trackHref(track: Pick<Track, 'id' | 'kind'>): string {
  return track.kind === 'complaint' ? '/complaint/' : `/regulator/?track=${encodeURIComponent(track.id)}`;
}

/** Complaint tracks first, then the regulator tracks, each kind in the manifest's order. */
export function orderedTracks<T extends Pick<Track, 'kind'>>(tracks: readonly T[]): T[] {
  return [...tracks.filter((t) => t.kind === 'complaint'), ...tracks.filter((t) => t.kind !== 'complaint')];
}

/** A track's violations in the track's order; an id the manifest does not define is skipped. */
export function trackViolations(track: Pick<Track, 'violations'>, violations: readonly Violation[]): Violation[] {
  const byId = new Map(violations.map((v) => [v.id, v]));
  return track.violations.map((id) => byId.get(id)).filter((v): v is Violation => v !== undefined);
}

/** Proof that counts as secured on the meter: direct or corroborating, never circumstantial alone. */
const SECURED: ReadonlySet<ProofStrength> = new Set(['direct', 'corroborating']);

/** One pip per point to prove, in the track's order, with the strongest proof each point has. */
export function proofMeter(points: readonly Pick<Point, 'proof'>[]): { pips: ProofStrength[]; secured: number; total: number } {
  const pips = points.map((point) => strongestProof(point).strength);
  return { pips, secured: pips.filter((s) => SECURED.has(s)).length, total: pips.length };
}

/** "Proof secured 9 of 12"; "No points to prove yet" for a track with none. */
export function meterLabel(meter: { secured: number; total: number }): string {
  return meter.total ? `Proof secured ${meter.secured} of ${meter.total}` : 'No points to prove yet';
}

/** The small picture on an objective card: a structure, caps or a move. */
export type MiniPicture =
  | { kind: 'structure'; entities: string[] }
  | { kind: 'caps'; figures: Figure[] }
  | { kind: 'move'; step: Step };

/**
 * The card's small picture, chosen from the data: a complaint shows the structure its violations touch; any other
 * track shows its figures against their limits when it has any, else the first step that moves an org under
 * another, else the structure too.
 */
export function miniPicture(track: Pick<Track, 'kind'>, violations: readonly Violation[]): MiniPicture {
  const entities = [...new Set(violations.flatMap((v) => v.entities))];
  if (track.kind === 'complaint') return { kind: 'structure', entities };
  const figures = violations.flatMap((v) => v.figures).filter((f) => f.limit !== null);
  if (figures.length) return { kind: 'caps', figures };
  const step = violations.flatMap((v) => v.steps).find((s) => s.moves.length > 0);
  return step ? { kind: 'move', step } : { kind: 'structure', entities };
}

/**
 * The orgs a structure thumbnail draws: the named entities and every org above them, so each hangs under its
 * owner; nothing else in the record. In the record's order.
 */
export function structureOrgs<O extends { id: string; parent: string | null }>(orgs: readonly O[], entities: readonly string[]): O[] {
  const byId = new Map(orgs.map((o) => [o.id, o]));
  const keep = new Set<string>();
  for (const id of entities) {
    let org = byId.get(id);
    while (org && !keep.has(org.id)) {
      keep.add(org.id);
      org = org.parent ? byId.get(org.parent) : undefined;
    }
  }
  return orgs.filter((o) => keep.has(o.id));
}

/** A figure against its limit on the figure's own scale (never one scale shared with another figure). */
export function capBar(figure: Pick<Figure, 'value' | 'limit'>): { fill: number; limit: number } {
  const limit = figure.limit ?? 0;
  const top = Math.max(Math.abs(figure.value), limit);
  if (top <= 0) return { fill: 0, limit: 0 };
  return { fill: Math.abs(figure.value) / top, limit: limit / top };
}

/** One objective card on the overview map. */
export interface ObjectiveCard {
  id: string;
  kind: Track['kind'];
  title: string;
  forum: string;
  href: string;
  /** As the record names them; an id with no person or org is left out. */
  against: Party[];
  meter: { pips: ProofStrength[]; secured: number; total: number };
  picture: MiniPicture;
}

/** One card per track, complaint first. */
export function objectiveCards(matter: Pick<ServedMatter, 'tracks' | 'violations' | 'people' | 'orgs'>): ObjectiveCard[] {
  const parties = partyIndex(matter);
  return orderedTracks(matter.tracks).map((track) => {
    const violations = trackViolations(track, matter.violations);
    return {
      id: track.id,
      kind: track.kind,
      title: track.title,
      forum: track.forum,
      href: trackHref(track),
      against: track.against.map((id) => parties.get(id)).filter((p): p is Party => p !== undefined),
      meter: proofMeter(track.points),
      picture: miniPicture(track, violations),
    };
  });
}

/** Every event any violation names, as a set of ids. */
export function violationEventIds(violations: readonly Pick<Violation, 'events'>[]): Set<string> {
  return new Set(violations.flatMap((v) => v.events));
}

const PARTIAL = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

/** The first or the last instant a partial date covers, in UTC ms; null when malformed. */
export function partialBound(date: PartialDate, edge: 'start' | 'end'): number | null {
  const match = PARTIAL.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] === undefined ? null : Number(match[2]) - 1;
  const day = match[3] === undefined ? null : Number(match[3]);
  if (edge === 'start') return Date.UTC(year, month ?? 0, day ?? 1);
  if (day !== null) return Date.UTC(year, month ?? 0, day + 1) - 1;
  if (month !== null) return Date.UTC(year, month + 1, 1) - 1;
  return Date.UTC(year + 1, 0, 1) - 1;
}

/** Whole calendar years, first to last inclusive. */
export interface YearScale {
  first: number;
  last: number;
}

/**
 * The years the bands are drawn across: from the earliest violation start to the latest end or event, and to
 * `now` when a violation is still running (no end). Null when no violation has a readable start.
 */
export function yearScale(violations: readonly Pick<Violation, 'period'>[], eventDates: readonly PartialDate[], now: Date): YearScale | null {
  const year = (d: PartialDate) => (PARTIAL.test(d) ? Number(d.slice(0, 4)) : null);
  const starts = violations.map((v) => year(v.period.from)).filter((y): y is number => y !== null);
  if (!starts.length) return null;
  const ends = [
    ...starts,
    ...violations.map((v) => (v.period.to === null ? now.getUTCFullYear() : year(v.period.to))),
    ...eventDates.map(year),
  ].filter((y): y is number => y !== null);
  return { first: Math.min(...starts), last: Math.max(...ends) };
}

/** One phase band of the overview map. */
export interface PhaseBand {
  id: string;
  mark: string;
  title: string;
  from: PartialDate;
  to: PartialDate | null;
  /** Fractions of the scale, 0 to 1, start < end. */
  start: number;
  end: number;
}

/** Each violation's period as a band on the scale, in mark order; a period with an unreadable start is left out. */
export function phaseBands(violations: readonly Violation[], scale: YearScale): PhaseBand[] {
  const lo = Date.UTC(scale.first, 0, 1);
  const hi = Date.UTC(scale.last + 1, 0, 1);
  const at = (ms: number) => Math.min(1, Math.max(0, (ms - lo) / (hi - lo)));
  return [...violations]
    .sort((a, b) => a.mark.localeCompare(b.mark))
    .flatMap((v) => {
      const from = partialBound(v.period.from, 'start');
      if (from === null) return [];
      const to = v.period.to === null ? hi : partialBound(v.period.to, 'end') ?? hi;
      const start = at(from);
      return [{ id: v.id, mark: v.mark, title: v.title, from: v.period.from, to: v.period.to, start, end: Math.max(start, at(to)) }];
    });
}

/** The scale's years, for the axis: 2011, 2012, 2013, 2014. */
export function scaleYears(scale: YearScale): number[] {
  return Array.from({ length: scale.last - scale.first + 1 }, (_, i) => scale.first + i);
}
