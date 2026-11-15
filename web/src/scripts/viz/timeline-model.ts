// SPDX-License-Identifier: Apache-2.0
// Card F5a (timeline viz). Turns matter events into timeline items: their date spans, the lane each sits in (by
// side, by lead actor, by event type or by violation), the mark it wears, and the filters a page applies. Pure: no
// DOM. An event in several violations sits in each violation's lane, so the violation mode can hold more items
// than events: the first copy's id is the event id, each further copy's is "<event id>~<lane key>".
import type { EventType, MatterEvent, MatterOrg, MatterPerson, Side } from '../../../worker/matter-types.ts';
import { compareSpans, overlaps, parsePartialDate, proseDate, type DateSpan } from './timeline-dates.ts';

/** How the timeline groups events into lanes. */
export type LaneMode = 'side' | 'actor' | 'type' | 'violation';

/**
 * What the timeline reads of a violation (the manifest's `violations[]`): its letter mark, its title, the events
 * it covers and the period it spans. Events carry no violations field; membership comes from these lists.
 */
export interface TimelineViolation {
  id: string;
  mark: string;
  title: string;
  events: string[];
  period?: { from: string; to: string | null };
}

/** The mark an event wears (web/DESIGN.md section 3): its lead actor's side, or the filing outline. */
export type MarkSide = Side | 'filing';

/** The data a timeline draws: its events, people and orgs. */
export interface TimelineData {
  events: MatterEvent[];
  people: MatterPerson[];
  orgs: MatterOrg[];
  /** Absent in manifests built before violations existed. */
  violations?: TimelineViolation[];
}

/** One lane of the timeline, with its key and label. */
export interface Lane {
  key: string;
  label: string;
  /** The side whose shape keys the lane label, when the lane has one. */
  side: MarkSide | null;
  /** The violation's letter, for a violation lane. */
  letter?: string;
}

/** One event placed on the timeline, with its date span. */
export interface TimelineItem {
  id: string;
  event: MatterEvent;
  span: DateSpan;
  lane: string;
  mark: MarkSide;
  /** Display names of the actors, in the event's order. */
  actors: string[];
  /** The violations the event belongs to, in letter order: ids for filters, letters for words. */
  violations: string[];
  letters: string[];
}

/** What a page narrows the chronology to. Empty or missing lists mean "no filter on that facet". */
export interface TimelineFilters {
  people?: string[];
  claims?: string[];
  /** Violation ids; an event is kept when a listed violation covers it. */
  violations?: string[];
  types?: EventType[];
  /** Kinds to drop (the Chronology's kind toggles and its Litigation chip). */
  hideTypes?: EventType[];
  /** Partial ISO dates; an event is kept when its span overlaps [from, to]. */
  from?: string | null;
  to?: string | null;
}

/** The order the sides are listed in. */
export const SIDE_ORDER: readonly Side[] = ['client', 'defendant', 'nominal', 'court', 'third'];

/** The label shown for each side. */
export const SIDE_LABELS: Record<MarkSide, string> = {
  client: 'Client',
  defendant: 'Defendants',
  nominal: 'Company',
  court: 'Court',
  third: 'Third parties',
  filing: 'Filings and orders',
};

/** The order the event types are listed in. */
export const TYPE_ORDER: readonly EventType[] = [
  'pleading', 'filing', 'order', 'service', 'discovery', 'communication', 'meeting', 'milestone', 'custom',
];

/** The label shown for each event type. */
export const TYPE_LABELS: Record<EventType, string> = {
  filing: 'Filings',
  service: 'Service',
  pleading: 'Pleadings',
  discovery: 'Discovery',
  meeting: 'Meetings',
  communication: 'Communications',
  milestone: 'Milestones',
  order: 'Orders',
  custom: 'Other events',
};

/** The kinds the Litigation chip holds back: the case's own court papers, not the conduct it is about. */
export const LITIGATION_TYPES: readonly EventType[] = ['pleading', 'filing', 'order', 'service'];

const UNATTRIBUTED = '_none';
const OTHERS = '_others';
/** The violation mode's lane for events no violation covers. */
export const OTHER_LANE = '_other';
/** Joins an event id and a lane key into a further copy's item id. */
export const COPY_SEP = '~';

/** The violations, sorted by letter, keeping only well-formed ones (a manifest can predate them). */
export function violationList(data: Pick<TimelineData, 'violations'>): TimelineViolation[] {
  const list = Array.isArray(data.violations) ? data.violations : [];
  return list
    .filter((v) => v && typeof v.id === 'string' && typeof v.mark === 'string' && Array.isArray(v.events))
    .sort((a, b) => a.mark.localeCompare(b.mark) || a.id.localeCompare(b.id));
}

/** Event id to the violations covering it, in letter order. */
export function violationIndex(data: Pick<TimelineData, 'violations'>): Map<string, TimelineViolation[]> {
  const index = new Map<string, TimelineViolation[]>();
  for (const violation of violationList(data)) {
    for (const id of new Set(violation.events)) index.set(id, [...(index.get(id) ?? []), violation]);
  }
  return index;
}

/** People and orgs by id, for names and sides. */
export interface Directory {
  name(id: string): string;
  side(id: string): Side | null;
}

/** Indexes the data's people and orgs by id, with their name and side. */
export function directory(data: TimelineData): Directory {
  const byId = new Map<string, { name: string; side: Side }>();
  for (const org of data.orgs) byId.set(org.id, { name: org.name, side: org.side });
  for (const person of data.people) byId.set(person.id, { name: person.name, side: person.side });
  return {
    name: (id) => byId.get(id)?.name ?? id,
    side: (id) => byId.get(id)?.side ?? null,
  };
}

/** Filings and orders wear the outline square; every other event wears its lead actor's shape. */
export function markFor(event: MatterEvent, dir: Directory): MarkSide {
  if (event.type === 'filing' || event.type === 'order') return 'filing';
  for (const actor of event.actors) {
    const side = dir.side(actor);
    if (side) return side;
  }
  return 'filing';
}

function leadSide(event: MatterEvent, dir: Directory): Side | null {
  for (const actor of event.actors) {
    const side = dir.side(actor);
    if (side) return side;
  }
  return null;
}

/** Actor lanes: the busiest `maxLanes - 1` actors by event count, the rest folded into "Others". */
function actorLanes(events: MatterEvent[], dir: Directory, maxLanes: number): Lane[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    const lead = event.actors[0];
    if (lead) counts.set(lead, (counts.get(lead) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const keep = ranked.length > maxLanes ? ranked.slice(0, Math.max(1, maxLanes - 1)) : ranked;
  const lanes: Lane[] = keep
    .map(([id]) => ({ key: id, label: dir.name(id), side: dir.side(id) as MarkSide | null }))
    .sort((a, b) => sideRank(a.side) - sideRank(b.side) || a.label.localeCompare(b.label));
  if (keep.length < ranked.length) lanes.push({ key: OTHERS, label: 'Others', side: null });
  return lanes;
}

function sideRank(side: MarkSide | null): number {
  const index = side && side !== 'filing' ? SIDE_ORDER.indexOf(side) : -1;
  return index < 0 ? SIDE_ORDER.length : index;
}

function laneKey(event: MatterEvent, mode: Exclude<LaneMode, 'violation'>, dir: Directory, lanes: Set<string>): string {
  if (mode === 'type') return event.type;
  if (mode === 'side') return leadSide(event, dir) ?? UNATTRIBUTED;
  const lead = event.actors[0];
  if (!lead) return UNATTRIBUTED;
  return lanes.has(lead) ? lead : OTHERS;
}

/** Every lane an event sits in: one, except in the violation mode, where it is each covering violation's lane. */
function laneKeys(
  event: MatterEvent, mode: LaneMode, dir: Directory, lanes: Set<string>, index: Map<string, TimelineViolation[]>,
): string[] {
  if (mode !== 'violation') return [laneKey(event, mode, dir, lanes)];
  const keys = (index.get(event.id) ?? []).map((violation) => violation.id).filter((key) => lanes.has(key));
  return keys.length ? keys : [OTHER_LANE];
}

/** One lane per violation that covers any event, in letter order, then "Other" for events none covers. */
function violationLanes(data: TimelineData): Lane[] {
  const ids = new Set(data.events.map((event) => event.id));
  const lanes: Lane[] = violationList(data)
    .filter((violation) => violation.events.some((id) => ids.has(id)))
    .map((violation) => ({ key: violation.id, label: violation.title, side: null, letter: violation.mark }));
  const index = violationIndex(data);
  if (data.events.some((event) => !index.has(event.id))) lanes.push({ key: OTHER_LANE, label: 'Other', side: null });
  return lanes;
}

/** A violation's period as epoch milliseconds; `end` null means it runs on past the record (the plot's end). */
export interface PeriodSpan {
  key: string;
  letter: string;
  title: string;
  /** The period as the manifest gives it, for words: "2023-01" to "2024", or to null (still running). */
  from: string;
  to: string | null;
  start: number;
  end: number | null;
}

/**
 * The violations' periods, in letter order, for the bands behind the plot. With `only` (the page's violation
 * filter) just those. A period whose start does not parse is skipped; an end that does not parse runs open.
 */
export function periodSpans(data: Pick<TimelineData, 'violations'>, only: readonly string[] = []): PeriodSpan[] {
  const spans: PeriodSpan[] = [];
  for (const violation of violationList(data)) {
    if (only.length && !only.includes(violation.id)) continue;
    const period = violation.period;
    const from = period ? parsePartialDate(period.from) : null;
    if (!period || !from) continue;
    const to = period.to ? parsePartialDate(period.to) : null;
    spans.push({
      key: violation.id, letter: violation.mark, title: violation.title,
      from: period.from.trim(), to: to && period.to ? period.to.trim() : null,
      start: from.start, end: to ? to.end : null,
    });
  }
  return spans;
}

/** A lane's name in words: "A Gutter repair ran past the estimate" for a violation lane, else its label. */
export function laneName(lane: Pick<Lane, 'label' | 'letter'>): string {
  return lane.letter ? `${lane.letter} ${lane.label}` : lane.label;
}

/** The lanes for a mode, in a stable order that does not depend on filters (color follows the entity). */
export function buildLanes(data: TimelineData, mode: LaneMode, maxLanes = 10): Lane[] {
  if (mode === 'violation') return violationLanes(data);
  const dir = directory(data);
  let lanes: Lane[];
  if (mode === 'type') {
    const present = new Set(data.events.map((event) => event.type));
    lanes = TYPE_ORDER.filter((type) => present.has(type)).map((type) => ({ key: type, label: TYPE_LABELS[type], side: null }));
  } else if (mode === 'side') {
    const present = new Set(data.events.map((event) => leadSide(event, dir)));
    lanes = SIDE_ORDER.filter((side) => present.has(side)).map((side) => ({ key: side, label: SIDE_LABELS[side], side }));
  } else {
    lanes = actorLanes(data.events, dir, maxLanes);
  }
  const keys = new Set(lanes.map((lane) => lane.key));
  if (data.events.some((event) => laneKey(event, mode, dir, keys) === UNATTRIBUTED)) {
    lanes.push({ key: UNATTRIBUTED, label: 'No party named', side: null });
  }
  return lanes;
}

/**
 * Every event with a valid date, as an item in its lane, in chronological order. Undated events are skipped. In
 * the violation mode an event covered by several violations gives one item per lane (see the header).
 */
export function buildItems(data: TimelineData, lanes: Lane[], mode: LaneMode): TimelineItem[] {
  const dir = directory(data);
  const keys = new Set(lanes.map((lane) => lane.key));
  const index = violationIndex(data);
  const items: TimelineItem[] = [];
  for (const event of data.events) {
    const span = parsePartialDate(event.date);
    if (!span) continue;
    const covering = index.get(event.id) ?? [];
    const base = {
      event,
      span,
      mark: markFor(event, dir),
      actors: event.actors.map((id) => dir.name(id)),
      violations: covering.map((violation) => violation.id),
      letters: covering.map((violation) => violation.mark),
    };
    laneKeys(event, mode, dir, keys, index).forEach((lane, copy) => {
      items.push({ ...base, id: copy ? `${event.id}${COPY_SEP}${lane}` : event.id, lane });
    });
  }
  return items.sort((a, b) => compareSpans(a.span, b.span) || a.id.localeCompare(b.id));
}

/** One item per event (the first copy), for the table twin, counts and the page's window list. */
export function uniqueItems(items: readonly TimelineItem[]): TimelineItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.event.id)) return false;
    seen.add(item.event.id);
    return true;
  });
}

function anyOf(wanted: string[] | undefined, have: string[]): boolean {
  return !wanted || wanted.length === 0 || have.some((value) => wanted.includes(value));
}

/** The items that pass every filter. A partial date passes a range when any part of its span falls inside. */
export function applyFilters(items: TimelineItem[], filters: TimelineFilters): TimelineItem[] {
  const from = filters.from ? parsePartialDate(filters.from) : null;
  const to = filters.to ? parsePartialDate(filters.to) : null;
  const range = { start: from ? from.start : -Infinity, end: to ? to.end : Infinity };
  const hidden = new Set(filters.hideTypes ?? []);
  return items.filter(
    (item) =>
      anyOf(filters.people, item.event.actors) &&
      anyOf(filters.claims, item.event.claims) &&
      anyOf(filters.violations, item.violations) &&
      anyOf(filters.types, [item.event.type]) &&
      !hidden.has(item.event.type) &&
      overlaps(item.span, range),
  );
}

/** One event kind, singular, for tooltips, labels and the table. */
export const TYPE_NAMES: Record<EventType, string> = {
  filing: 'Filing',
  service: 'Service',
  pleading: 'Pleading',
  discovery: 'Discovery',
  meeting: 'Meeting',
  communication: 'Communication',
  milestone: 'Milestone',
  order: 'Order',
  custom: 'Event',
};

function plural(n: number, word: string): string {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}

/**
 * The spoken form of an event, for its aria-label: prose date (with how precise it is), title, kind, parties, the
 * violations covering it and how many sources it cites. Example: "July 9, 2012. Roe inspects the failed cooler.
 * Meeting. Richard Roe, Pat Teller. Violation A. 1 source."
 */
export function describeEvent(item: TimelineItem): string {
  const precision = item.span.precision === 'day' ? '' : ` (date known to the ${item.span.precision})`;
  const parts = [`${proseDate(item.span)}${precision}`, item.event.title, TYPE_NAMES[item.event.type]];
  if (item.actors.length) parts.push(item.actors.join(', '));
  if (item.letters.length) parts.push(`${item.letters.length === 1 ? 'Violation' : 'Violations'} ${item.letters.join(', ')}`);
  parts.push(plural(item.event.cites.length, 'source'));
  return parts.map((part) => part.replace(/[.\s]+$/, '')).join('. ') + '.';
}
