// SPDX-License-Identifier: Apache-2.0
// Card P2 (Chronology page). The page's pure logic: filter state to timeline filters, the person and violation
// options, the filtered order the selected-event panel steps through, deep links, the j and k keys and the Ask
// question. No DOM, so it runs under node --test. The order comes from the timeline's own model, so the panel's
// "17 of 41" and Previous and Next always match what the chart and the table show. Event to violation membership
// comes from each violation's `events` list (events carry no violations field).
import type { EventType, RoomClaim, RoomEvent, ServedMatter, Side } from './matter-api.ts';
import { formatPartialDate } from './matter-api.ts';
import { isoLabel, parsePartialDate } from './viz/timeline-dates.ts';
import {
  applyFilters, buildItems, buildLanes, LITIGATION_TYPES, SIDE_ORDER, TYPE_ORDER, violationIndex, violationList,
  type LaneMode, type TimelineData, type TimelineFilters, type TimelineViolation,
} from './viz/timeline-model.ts';

/** What the page reads of the matter: the timeline's data, violations included when the manifest has them. */
export type ChronMatter = Pick<ServedMatter, 'events' | 'people' | 'orgs'> & Pick<TimelineData, 'violations'>;

/** The events and the violations (absent in a manifest built before them). */
type WithViolations = Pick<ServedMatter, 'events'> & Pick<TimelineData, 'violations'>;

/** What the filter row and the violation chips hold. Empty strings and an empty kind list mean "no filter". */
export interface FilterState {
  person: string;
  /** One violation id, or '' for All. */
  violation: string;
  /** Kinds turned off. Every kind is on until the reader turns one off. */
  hiddenKinds: EventType[];
  /** The Litigation chip: the case's own filings, pleadings, orders and service. Off until the reader asks. */
  litigation: boolean;
  from: string;
  to: string;
}

/** The filter state with nothing filtered. */
export const EMPTY_FILTERS: FilterState = { person: '', violation: '', hiddenKinds: [], litigation: false, from: '', to: '' };

/** The ways to split the chronology into lanes, with the label shown for each. */
export const LANE_MODES: readonly { mode: LaneMode; label: string }[] = [
  { mode: 'side', label: 'Side' },
  { mode: 'actor', label: 'Person' },
  { mode: 'type', label: 'Kind' },
  { mode: 'violation', label: 'Violation' },
];

/** True for the kinds the Litigation chip holds back. */
export function isLitigation(event: Pick<RoomEvent, 'type'>): boolean {
  return LITIGATION_TYPES.includes(event.type);
}

/** How many events the Litigation chip holds back while it is off. */
export function litigationCount(events: readonly Pick<RoomEvent, 'type'>[]): number {
  return events.filter(isLitigation).length;
}

/** A violation chip: its letter, its title. */
export interface ViolationOption {
  id: string;
  mark: string;
  title: string;
}

/** The violation chips, in letter order (none for a manifest built before violations existed). */
export function violationOptions(matter: WithViolations): ViolationOption[] {
  return violationList(matter).map(({ id, mark, title }) => ({ id, mark, title }));
}

/** The violations covering one event, in letter order: the selected-event panel's list. */
export function violationsOf(matter: WithViolations, eventId: string): TimelineViolation[] {
  return violationIndex(matter).get(eventId) ?? [];
}

/** The violation a deep link names (?v=<id>), when the matter has it. */
export function violationFromSearch(search: string, options: readonly Pick<ViolationOption, 'id'>[]): string | null {
  const id = new URLSearchParams(search).get('v');
  return id && options.some((option) => option.id === id) ? id : null;
}

/** A partial ISO date the filter accepts ("2012", "2012-04", "2012-04-01"), or '' for none. */
export function validFilterDate(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === '' || parsePartialDate(trimmed) !== null;
}

/** The kinds present in the matter, in the timeline's order. */
export function kindsPresent(events: readonly RoomEvent[]): EventType[] {
  const present = new Set(events.map((event) => event.type));
  return TYPE_ORDER.filter((type) => present.has(type));
}

/** The Kind toggles: the kinds present less the litigation kinds, which the Litigation chip shows or hides together. */
export function toggleKinds(events: readonly RoomEvent[]): EventType[] {
  return kindsPresent(events).filter((kind) => !LITIGATION_TYPES.includes(kind));
}

/** Filter state as the timeline's filters. Invalid dates are ignored (the input shows them as invalid). */
export function toTimelineFilters(state: FilterState): TimelineFilters {
  const date = (value: string) => (value.trim() && validFilterDate(value) ? value.trim() : null);
  const hidden = new Set<EventType>([...state.hiddenKinds, ...(state.litigation ? [] : LITIGATION_TYPES)]);
  return {
    people: state.person ? [state.person] : [],
    violations: state.violation ? [state.violation] : [],
    hideTypes: TYPE_ORDER.filter((type) => hidden.has(type)),
    from: date(state.from),
    to: date(state.to),
  };
}

/**
 * How many filters in the folding row are set, for the phone's "Filters 2" button. The violation chips and the
 * Litigation chip stay in view on phones, so they are not counted.
 */
export function activeFilterCount(state: FilterState): number {
  const dates = state.from.trim() || state.to.trim() ? 1 : 0;
  return (state.person ? 1 : 0) + (state.hiddenKinds.length ? 1 : 0) + dates;
}

/** What j and k ask for: the next (+1) or previous (-1) event. Only inside the work area, never while typing (R80). */
export function stepKey(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>, typing: boolean, inRegion: boolean,
): 1 | -1 | null {
  if (!inRegion || typing || event.metaKey || event.ctrlKey || event.altKey) return null;
  return event.key === 'j' ? 1 : event.key === 'k' ? -1 : null;
}

/**
 * Where a key moves the choice in a radio group of `count` (the violation chips, WAI-ARIA radio group): Right and
 * Down forward and Left and Up back, wrapping at the ends; Home and End to the first and last. Null for any other
 * key, a key with a modifier (browser shortcuts stay the browser's), or an empty group.
 */
export function radioStep(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>, from: number, count: number,
): number | null {
  if (count < 1 || from < 0 || from >= count || event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') return (from + 1) % count;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') return (from - 1 + count) % count;
  if (event.key === 'Home') return 0;
  if (event.key === 'End') return count - 1;
  return null;
}

/** Where j or k goes with nothing selected yet: j to the first event, k to the last. */
export function firstStep(ordered: readonly Pick<RoomEvent, 'id'>[], direction: 1 | -1): string | null {
  return (direction > 0 ? ordered[0] : ordered[ordered.length - 1])?.id ?? null;
}

const ROMAN: readonly [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

/** Counts are numbered as the pleading numbers them: 3 is "III". '' for anything that is not a positive integer. */
export function roman(n: number): string {
  if (!Number.isInteger(n) || n < 1) return '';
  let rest = n;
  let out = '';
  for (const [value, numeral] of ROMAN) {
    while (rest >= value) {
      out += numeral;
      rest -= value;
    }
  }
  return out;
}

/** "III Breach of contract": a prior count, as the panel lists it after the violations. */
export function countLabel(claim: Pick<RoomClaim, 'count' | 'label'>): string {
  const numeral = roman(claim.count);
  return numeral ? `${numeral} ${claim.label}` : claim.label;
}

/** A party the person filter can pick, with its side. */
export interface PartyOption {
  id: string;
  name: string;
  side: Side;
}

/** Everyone named as an actor in some event, grouped by side (client first) and then by name. */
export function personOptions(matter: Pick<ServedMatter, 'events' | 'people' | 'orgs'>): PartyOption[] {
  const actors = new Set(matter.events.flatMap((event) => event.actors));
  const parties = [...matter.people, ...matter.orgs]
    .filter((party) => actors.has(party.id))
    .map((party) => ({ id: party.id, name: party.name, side: party.side }));
  const rank = (side: Side) => SIDE_ORDER.indexOf(side);
  return parties.sort((a, b) => rank(a.side) - rank(b.side) || a.name.localeCompare(b.name));
}

/** The events the filters keep, in the timeline's chronological order. */
export function orderedEvents(matter: ChronMatter, filters: TimelineFilters): RoomEvent[] {
  const mode: LaneMode = 'side';
  const items = buildItems(matter, buildLanes(matter, mode), mode);
  return applyFilters(items, filters).map((item) => item.event as RoomEvent);
}

/** Where an event sits in the filtered chronology. */
export interface Position {
  /** 1-based place in the filtered order, or 0 when the event is filtered out. */
  index: number;
  total: number;
  previous: string | null;
  next: string | null;
}

/**
 * Where an event sits among the filtered events, and its neighbours for Previous and Next. An event the filters
 * hide still gets neighbours: the nearest kept events before and after it in `all` (the unfiltered order).
 */
export function positionOf(
  ordered: readonly Pick<RoomEvent, 'id'>[],
  id: string,
  all: readonly Pick<RoomEvent, 'id'>[] = ordered,
): Position {
  const at = ordered.findIndex((event) => event.id === id);
  if (at >= 0) {
    return {
      index: at + 1,
      total: ordered.length,
      previous: at > 0 ? ordered[at - 1]!.id : null, // safe: at > 0
      next: at < ordered.length - 1 ? ordered[at + 1]!.id : null, // safe: bounded above
    };
  }
  const rank = new Map(all.map((event, i) => [event.id, i]));
  const here = rank.get(id) ?? -1;
  const before = ordered.filter((event) => (rank.get(event.id) ?? -1) < here);
  const after = ordered.filter((event) => (rank.get(event.id) ?? Infinity) > here);
  return {
    index: 0,
    total: ordered.length,
    previous: here >= 0 ? before[before.length - 1]?.id ?? null : null,
    next: here >= 0 ? after[0]?.id ?? null : null,
  };
}

/** The event a deep link names (?event=<id>), when the matter has it. */
export function eventFromSearch(search: string, events: readonly Pick<RoomEvent, 'id'>[]): string | null {
  const id = new URLSearchParams(search).get('event');
  return id && events.some((event) => event.id === id) ? id : null;
}

/** The page URL with one parameter set (or removed), keeping every other parameter and the hash. */
export function withParam(href: string, name: string, value: string | null): string {
  const url = new URL(href);
  if (value) url.searchParams.set(name, value);
  else url.searchParams.delete(name);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The page URL with ?event= set (or removed). */
export function withEventParam(href: string, id: string | null): string {
  return withParam(href, 'event', id);
}

/** The person or org a cross-link presets (?p=<id>, from the People page), when it is in the Person filter. */
export function personFromSearch(search: string, options: readonly Pick<PartyOption, 'id'>[]): string | null {
  const id = new URLSearchParams(search).get('p');
  return id && options.some((option) => option.id === id) ? id : null;
}

/** The facets the chronology filter has: person, violation, kinds and dates. */
export type FilterFacet = 'person' | 'violation' | 'kinds' | 'dates';

/** Names the active-filter chips need. */
export interface FilterNames {
  person(id: string): string;
  /** "A", the violation's letter. */
  violation(id: string): string;
  kind(kind: EventType): string;
}

/**
 * One removable chip per filter that is set: "Violation A", "Person: Richard Roe", "Without Meeting",
 * "2012 to 2013". They also print, naming what shaped the printed table.
 */
export function activeChips(state: FilterState, names: FilterNames): { facet: FilterFacet; label: string }[] {
  const chips: { facet: FilterFacet; label: string }[] = [];
  if (state.violation) chips.push({ facet: 'violation', label: `Violation ${names.violation(state.violation)}` });
  if (state.person) chips.push({ facet: 'person', label: `Person: ${names.person(state.person)}` });
  if (state.hiddenKinds.length) {
    chips.push({ facet: 'kinds', label: `Without ${state.hiddenKinds.map((kind) => names.kind(kind)).join(', ')}` });
  }
  const from = validFilterDate(state.from) ? state.from.trim() : '';
  const to = validFilterDate(state.to) ? state.to.trim() : '';
  const dates = from && to ? `${from} to ${to}` : from ? `From ${from}` : to ? `To ${to}` : '';
  if (dates) chips.push({ facet: 'dates', label: dates });
  return chips;
}

/** "Ask about this event": the Ask page with the question filled in. */
export function askHref(event: Pick<RoomEvent, 'title' | 'date'>): string {
  const when = formatPartialDate(event.date);
  const question = `What does the record show about this event: ${event.title}${when ? `, ${when}` : ''}?`;
  return `/ask/?q=${encodeURIComponent(question)}`;
}

/**
 * The header line: "40 events, Nov. 1, 2011 to Mar. 1, 2014." or, filtered, "13 of 40 events shown." With the
 * Litigation chip off and litigation events in the record, the filtered line says so: "28 of 40 events shown,
 * litigation hidden."
 */
export function summaryLine(all: readonly Pick<RoomEvent, 'date'>[], shown: number, litigationHidden = false): string {
  const n = all.length;
  const noun = n === 1 ? 'event' : 'events';
  if (shown !== n) return litigationHidden ? `${shown} of ${n} ${noun} shown, litigation hidden.` : `${shown} of ${n} ${noun} shown.`;
  const dated = all.map((event) => event.date).filter((date) => parsePartialDate(date)).sort();
  if (!dated.length) return `${n} ${noun}.`;
  const first = formatPartialDate(dated[0]);
  const last = formatPartialDate(dated[dated.length - 1]);
  return first === last ? `${n} ${noun}, ${first}.` : `${n} ${noun}, ${first} to ${last}.`;
}

/** The one polite line when a reader picks an event: "Selected: Copperline Cafe opens, May 1, 2011." */
export function selectedLine(event: Pick<RoomEvent, 'title' | 'date'>): string {
  const title = event.title.trim().replace(/[.!?]+$/, '');
  const when = formatPartialDate(event.date);
  return `Selected: ${title}${when ? `, ${when}` : ''}.`;
}

/** The In view table's range line (R59): "12 events, 2012-03-01 to 2013-06-30". */
export function inViewLine(domain: { start: number; end: number }, count: number): string {
  return `${count} ${count === 1 ? 'event' : 'events'}, ${isoLabel(domain.start, 'day')} to ${isoLabel(domain.end, 'day')}`;
}
