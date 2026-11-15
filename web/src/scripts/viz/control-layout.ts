// SPDX-License-Identifier: Apache-2.0
// Track pages, the control panels' pure half (viz/control.ts draws them). A violation's story is drawn as one
// fixed picture for every step: people on top, the orgs that hold or act in the second row, the violation's
// entities below in tiers (parents before children, then name). Only the ties between them change from step to
// step, and each tie's state at a step comes from its dated statements (MatterLink.statements): in the record,
// claimed later, alleged, or denied. No DOM, so control-layout.test.ts runs it under node --test. The geometry is in
// control-geometry.ts and control-labels.ts, re-exported at the foot.

import type { Cite, LinkStatement, Side, StatementBasis } from '../../../worker/matter-types.ts';
import { formatPartialDate } from '../matter-api.ts';

/** What the panels read from a person or org. */
export interface ControlParty {
  id: string;
  name: string;
  side: Side;
  kind: 'person' | 'org';
  /** Orgs only: the org that owns or manages this one. */
  parent: string | null;
  /** Orgs only: when the org was formed, as the record dates it. */
  formed: string | null;
  /** Orgs only: where the record has the org, for a "part of" line drawn from its parent. */
  cites?: readonly Cite[];
}

/** What the panels read from a link. Only links with statements are drawn, plus the "part of" lines below. */
export interface ControlLink<C extends Cite = Cite> {
  from: string;
  to: string;
  label: string;
  statements: LinkStatement<C>[];
  /** A "part of" line from an org to its parent in the record (MatterOrg.parent), with the org's own cites. */
  structural?: boolean;
  cites?: C[];
}

/** What the panels read from a story step. */
export interface ControlStep {
  date: string;
  label: string;
  entities: readonly string[];
  moves: readonly { from: string; to: string; label: string }[];
}

/** What the panels read from a violation. */
export interface ControlViolation {
  actors: readonly string[];
  entities: readonly string[];
  steps: readonly ControlStep[];
}

// ---------------------------------------------------------------------------------------------------------------
// Partial dates, compared by the period each one covers ("2025" covers the whole year).

const DATE = /^(\d{4})(?:-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?)?$/;

/** A partial ISO date the panels can place, else null ("2025-13", "", "soon" are unplaceable). */
export function placeable(date: string | null | undefined): string | null {
  return typeof date === 'string' && DATE.test(date) ? date : null;
}

/** The first day a partial date covers, as a full ISO date. */
export function startOf(d: string): string {
  return d.length === 4 ? `${d}-01-01` : d.length === 7 ? `${d}-01` : d;
}

/** The last day a partial date covers ("31" for every month is enough to compare ISO strings). */
export function endOf(d: string): string {
  return d.length === 4 ? `${d}-12-31` : d.length === 7 ? `${d}-31` : d;
}

/**
 * Orders partial dates by the day each one starts ("2024" starts on 2024-01-01). On the same start the more
 * precise date leads, so "2024-01-01" sits before "2024": a year alone does not say it came first.
 */
export function compareDates(a: string, b: string): number {
  const sa = startOf(a);
  const sb = startOf(b);
  if (sa !== sb) return sa < sb ? -1 : 1;
  return b.length - a.length;
}

/** `a` could have happened by `d`: its period starts no later than `d`'s ends ("2024-01" is by "2024-01-01"). */
export function byDate(a: string, d: string): boolean {
  return startOf(a) <= endOf(d);
}

/** A tie that ends on `until` still holds during `d` (an end on `d` itself does not). */
function heldThrough(until: string | null, d: string): boolean {
  return until === null || endOf(until) > startOf(d);
}

// ---------------------------------------------------------------------------------------------------------------
// A tie's state at a date.

/** Sources that put a tie in the record. Pleadings and accounts allege it; an inference is never drawn alone. */
const RECORD_BASES: ReadonlySet<StatementBasis> = new Set(['filing', 'document', 'mediation', 'settlement']);
const ALLEGED_BASES: ReadonlySet<StatementBasis> = new Set(['pleadingOurs', 'pleadingTheirs', 'account']);

/** Each source kind in words, for labels and tables. */
export const BASIS_WORDS: Record<StatementBasis, string> = {
  filing: 'filing',
  document: 'document',
  mediation: 'mediation exhibit',
  settlement: 'settlement communication',
  pleadingOurs: 'our pleading',
  pleadingTheirs: 'their pleading',
  account: 'client account',
  inference: 'inference',
};

/** solid, long dash, short dash and dotted lines; each also says its state in words on the line. */
export type TieState = 'record' | 'claimed' | 'alleged' | 'denied';

/** What a tie's line reads as at one step. */
export interface TieAt<C extends Cite = Cite> {
  state: TieState;
  /** The words on the line ("owner of, 40%"; "bank for, denied Mar. 1, 2012"). */
  words: string;
  /** When denied and a source later claims the tie for this date: that claim, in words. */
  later: string | null;
  /** The statements that decide the state, latest first. */
  basis: LinkStatement<C>[];
}

/** "60%", or "50 to 75%" for a range in a filing. */
export function shareWords(share: LinkStatement['share']): string {
  if (!share) return '';
  return share.min === share.max ? `${share.min}%` : `${share.min} to ${share.max}%`;
}

const latestFirst = <C extends Cite>(a: LinkStatement<C>, b: LinkStatement<C>) => compareDates(b.asOf, a.asOf);

/** A short source name for a line: the statement's own note when it is short ("Account statement"), else its kind. */
function sourceName(st: LinkStatement): string {
  return st.note && st.note.length <= 24 ? st.note : BASIS_WORDS[st.basis];
}

function claimWords(label: string, st: LinkStatement): string {
  return `Claimed ${formatPartialDate(st.asOf)} (${sourceName(st)}): ${label}, since ${formatPartialDate(st.since)}`;
}

/**
 * A tie's state at `date`, or null when nothing in the record speaks to it by then (the line is not drawn).
 * - record: a held statement from a record source, made by `date`, whose period covers `date`;
 * - denied: a denial made by `date` with no record statement as late or later;
 * - claimed: a record source that speaks only after `date` but dates the tie from `date` or earlier;
 * - alleged: only pleadings or accounts cover `date`.
 */
export function tieAt<C extends Cite>(link: ControlLink<C>, date: string): TieAt<C> | null {
  const sts = link.statements;
  const covers = (st: LinkStatement<C>) => (st.since === null || byDate(st.since, date)) && heldThrough(st.until, date);
  const records = sts.filter((st) => st.held && RECORD_BASES.has(st.basis) && byDate(st.asOf, date) && covers(st)).sort(latestFirst);
  const denials = sts.filter((st) => !st.held && byDate(st.asOf, date)).sort(latestFirst);
  const claims = sts
    .filter((st) => st.held && RECORD_BASES.has(st.basis) && st.since !== null && !byDate(st.asOf, date) && covers(st))
    .sort((a, b) => compareDates(a.asOf, b.asOf));
  const denial = denials[0];
  if (records.length > 0 && (!denial || compareDates(records[0]!.asOf, denial.asOf) >= 0 || startOf(records[0]!.asOf) === startOf(denial.asOf))) {
    const share = shareWords(records.find((st) => st.share)?.share ?? null);
    return { state: 'record', words: share ? `${link.label}, ${share}` : link.label, later: null, basis: records };
  }
  if (denial) {
    const later = claims[0] ? claimWords(link.label, claims[0]) : null;
    return { state: 'denied', words: `${link.label}, denied ${formatPartialDate(denial.asOf)}`, later, basis: denials };
  }
  if (claims[0]) return { state: 'claimed', words: claimWords(link.label, claims[0]), later: null, basis: claims };
  const alleged = sts
    .filter((st) => st.held && ALLEGED_BASES.has(st.basis) && (st.since === null ? byDate(st.asOf, date) : byDate(st.since, date)) && heldThrough(st.until, date))
    .sort(latestFirst);
  if (alleged.length > 0) return { state: 'alleged', words: `${link.label}, alleged`, later: null, basis: alleged };
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Which parties and ties a violation draws, and in which rows.

/** What the control picture draws: its parties, and its rows of people, holders and entities. */
export interface ControlModel<C extends Cite = Cite> {
  parties: Map<string, ControlParty>;
  /** Rows top to bottom: people, holding and acting orgs, then the entities tier by tier. Empty rows are left out. */
  rows: { kind: 'people' | 'holders' | 'entities'; ids: string[] }[];
  links: ControlLink<C>[];
  /** Per step, per link (same order as `links`): the tie's state, or null when it is not drawn. */
  ties: (TieAt<C> | null)[][];
}

/** Entities a step brings forward: the ones it names and the ones its moves start or end at. */
export function stepFocus(step: ControlStep | undefined): Set<string> {
  const focus = new Set(step?.entities ?? []);
  for (const move of step?.moves ?? []) {
    focus.add(move.from);
    focus.add(move.to);
  }
  return focus;
}

/** How many of an org's ancestors (by `parent`) are among `ids`. */
function depthAmong(id: string, ids: ReadonlySet<string>, parties: ReadonlyMap<string, ControlParty>): number {
  const seen = new Set([id]);
  let depth = 0;
  for (let at = parties.get(id)?.parent ?? null; at !== null && !seen.has(at); at = parties.get(at)?.parent ?? null) {
    seen.add(at);
    if (ids.has(at)) depth += 1;
  }
  return depth;
}

const byName = (parties: ReadonlyMap<string, ControlParty>) => (a: string, b: string) =>
  parties.get(a)!.name.localeCompare(parties.get(b)!.name, 'en', { sensitivity: 'base' }); // safe: ids come from parties

/**
 * "Part of" lines: an org that no dated tie from another org reaches hangs from its parent in the record, up the
 * chain until an org already drawn or the top, so a violation with few or no dated ties still shows its structure.
 * An org a dated tie reaches keeps only its dated ties: the parent field never speaks over the sources.
 * Adds the parents it climbs to `ids`.
 */
function partOfLines<C extends Cite>(
  ids: Set<string>, parties: ReadonlyMap<string, ControlParty>, dated: readonly ControlLink<C>[],
): ControlLink<C>[] {
  const reached = (id: string) => dated.some((l) => l.to === id && ids.has(l.from) && parties.get(l.from)?.kind === 'org');
  const lines: ControlLink<C>[] = [];
  const done = new Set<string>();
  const queue = [...ids].filter((id) => parties.get(id)?.kind === 'org');
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    const parent = parties.get(id)?.parent ?? null;
    if (done.has(id) || parent === null || parent === id || !parties.has(parent) || reached(id)) continue;
    done.add(id);
    lines.push({ from: id, to: parent, label: 'part of', statements: [], structural: true, cites: [...(parties.get(id)?.cites ?? [])] as C[] });
    if (!ids.has(parent)) {
      ids.add(parent);
      queue.push(parent);
    }
  }
  // A parent climbed to may bring dated ties of its own that reach an org above; those ties win.
  return lines.filter((l) => !reached(l.from));
}

/** A "part of" line holds at a step when both orgs are formed by then. */
function partOfAt<C extends Cite>(link: ControlLink<C>, parties: ReadonlyMap<string, ControlParty>, date: string): TieAt<C> | null {
  if (notFormedYet(parties.get(link.from), date) || notFormedYet(parties.get(link.to), date)) return null;
  return { state: 'record', words: link.label, later: null, basis: [] };
}

/**
 * The picture for one violation, fixed for all its steps. Nodes: the actors, the entities, every step entity and
 * move end, plus the far end of every link with statements that touches one of them, plus the parents that "part
 * of" lines climb to; a link is drawn when both ends are nodes. Unknown ids are skipped.
 */
export function controlModel<C extends Cite>(
  violation: ControlViolation, parties: ReadonlyMap<string, ControlParty>, links: readonly ControlLink<C>[],
): ControlModel<C> {
  const base = new Set([...violation.actors, ...violation.entities, ...violation.steps.flatMap((s) => [...stepFocus(s)])]);
  const dated = links.filter((l) => l.statements.length > 0 && parties.has(l.from) && parties.has(l.to) && l.from !== l.to);
  const ids = new Set([...base].filter((id) => parties.has(id)));
  for (const l of dated) {
    if (base.has(l.from) || base.has(l.to)) {
      ids.add(l.from);
      ids.add(l.to);
    }
  }
  const partOf = partOfLines(ids, parties, dated);
  const drawn = dated.filter((l) => ids.has(l.from) && ids.has(l.to));
  const kept = new Map([...ids].map((id) => [id, parties.get(id)!])); // safe: ids are filtered to parties

  const entities = new Set(violation.entities.filter((id) => kept.get(id)?.kind === 'org'));
  const actors = new Set(violation.actors);
  const ownedByOrg = new Set([...drawn.filter((l) => kept.get(l.from)?.kind === 'org').map((l) => l.to), ...partOf.map((l) => l.from)]);
  const people = [...ids].filter((id) => kept.get(id)!.kind === 'person');
  const orgs = [...ids].filter((id) => kept.get(id)!.kind === 'org');
  const holders = orgs.filter((id) => !entities.has(id) && (actors.has(id) || !ownedByOrg.has(id)));
  const rest = new Set(orgs.filter((id) => !holders.includes(id)));
  const order = byName(kept);
  const actorFirst = (a: string, b: string) => Number(actors.has(b)) - Number(actors.has(a)) || order(a, b);

  const tiers = new Map<number, string[]>();
  for (const id of rest) {
    const depth = depthAmong(id, rest, kept);
    tiers.set(depth, [...(tiers.get(depth) ?? []), id]);
  }
  const rows: ControlModel<C>['rows'] = [
    { kind: 'people' as const, ids: people.sort(actorFirst) },
    { kind: 'holders' as const, ids: holders.sort(actorFirst) },
    ...[...tiers.keys()].sort((a, b) => a - b).map((depth) => ({ kind: 'entities' as const, ids: tiers.get(depth)!.sort(order) })),
  ].filter((row) => row.ids.length > 0);

  const all = [...drawn, ...partOf];
  const ties = violation.steps.map((step) => all.map((link) => {
    if (!placeable(step.date)) return null;
    return link.structural ? partOfAt(link, kept, step.date) : tieAt(link, step.date);
  }));
  return { parties: kept, rows, links: all, ties };
}

/** An org formed after the step's date: drawn dashed, "Not formed yet". */
export function notFormedYet(party: ControlParty | undefined, date: string): boolean {
  const formed = placeable(party?.formed);
  const now = placeable(date);
  return party?.kind === 'org' && formed !== null && now !== null && !byDate(formed, now);
}

/**
 * The people who ran the step's entities at its date, per the record: a person with a record tie to one of them,
 * directly or through one org (a person to an org, that org tied to the entity, or the entity part of that org up
 * the "part of" chain, all in the record). Row order.
 */
export function controllersFor<C extends Cite>(model: ControlModel<C>, stepIndex: number, step: ControlStep): string[] {
  const focus = stepFocus(step);
  const ties = model.ties[stepIndex] ?? [];
  const record = model.links.filter((_, i) => ties[i]?.state === 'record');
  // The entities and every org they are part of, up the "part of" chain: an org reaches what is part of it.
  const within = new Set(focus);
  for (let grew = true; grew;) {
    grew = false;
    for (const l of record) {
      if (l.structural && within.has(l.from) && !within.has(l.to)) {
        within.add(l.to);
        grew = true;
      }
    }
  }
  const reaches = (org: string) => within.has(org) || record.some((l) => !l.structural && l.from === org && focus.has(l.to));
  const found = new Set<string>();
  for (const l of record) {
    if (model.parties.get(l.from)?.kind !== 'person') continue;
    const via = model.parties.get(l.to);
    if (focus.has(l.to) || (via?.kind === 'org' && reaches(l.to))) found.add(l.from);
  }
  return model.rows.flatMap((row) => row.ids).filter((id) => found.has(id));
}

/** What changed since the step before, in words: ties that appear, change state or go, then the step's moves. */
export function changesAt<C extends Cite>(model: ControlModel<C>, stepIndex: number, step: ControlStep): string[] {
  const name = (id: string) => model.parties.get(id)?.name ?? id;
  const out: string[] = [];
  if (stepIndex > 0) {
    const before = model.ties[stepIndex - 1] ?? [];
    const now = model.ties[stepIndex] ?? [];
    model.links.forEach((link, i) => {
      const was = before[i];
      const is = now[i];
      if ((was?.words ?? null) === (is?.words ?? null) && was?.state === is?.state) return;
      const pair = `${name(link.from)} to ${name(link.to)}`;
      out.push(is ? `${pair}: ${is.words}.` : `${pair}: no longer shown (${was!.words}).`); // safe: one of the two is set
    });
  }
  for (const move of step.moves) out.push(`${name(move.from)} to ${name(move.to)}: ${move.label}.`);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry: the node places and lines are in control-geometry.ts, the words' places in control-labels.ts. Both are
// re-exported here so the panels' callers keep one import.

export { layoutControl, LIST_BELOW, NODE_H, type ControlEdge, type ControlGeometry } from './control-geometry.ts';
export type { Rect } from './control-labels.ts';
