// SPDX-License-Identifier: Apache-2.0
// The Complaint guide (/complaint/) and Filing guide (each /regulator/ tab), the pure half: one track laid out in
// complaint order so counsel can draft from it. Caption, parties, the entities, numbered facts in date order,
// points to prove, key exhibits and what the record still lacks, every line carrying its cites. Built only from
// GET /api/matter, so nothing here names a party; no DOM, so track-guide-model.test.ts runs it under node --test.
import { pleadedRole } from './brief/model.ts';
import { docTypeWords } from './doc-type.ts';
import { formatPartialDate, type ProofStrength, type ServedCite, type Side } from './matter-api.ts';
import { plural, strongestProof } from './overview-case-model.ts';
import {
  isSecured, stepDate, violationsOf, type Track, type TrackKind, type TrackMatter, type TrackViolation,
} from './track-model.ts';

type Id = string;
type Person = TrackMatter['people'][number];
type Org = TrackMatter['orgs'][number];

/** An entity a party controls: through a link in the record ("manages"), an org the person sits in, or a child org. */
export interface GuideControl {
  id: Id;
  name: string;
  /** The link's own words, or null when the record lists the tie without one. */
  relation: string | null;
  cites: ServedCite[];
}

/** A party in a track guide, with its side. */
export interface GuideParty {
  id: Id;
  name: string;
  side: Side;
  /** The person's title ("Owner and manager, 2011 to 2014"), or null. */
  role: string | null;
  controls: GuideControl[];
  /** The party's own cites; each control carries its link's. */
  cites: ServedCite[];
}

/** An entity in a track guide, with its formation date. */
export interface GuideEntity {
  id: Id;
  name: string;
  /** ISO, or '' when the record does not date the formation. */
  formed: string;
  parent: { id: Id; name: string } | null;
  cites: ServedCite[];
}

/** One numbered fact, a draft allegation: a step and the event that records it read as one line. */
export interface GuideFact {
  n: number;
  /** ISO, or '' when undated. */
  date: string;
  text: string;
  /** The event's summary when it has one. */
  detail: string | null;
  /** Violation marks the fact belongs to, in track order. */
  marks: string[];
  cites: ServedCite[];
}

/** A point in a track guide, tied to a violation by its mark. */
export interface GuidePoint {
  id: Id;
  violation: Id;
  mark: string;
  text: string;
  authority: string | null;
  strength: ProofStrength;
}

/** An exhibit in a track guide: a document, its control number and a whole-document cite. */
export interface GuideExhibit {
  doc: Id;
  control: number | null;
  /** A whole-document cite, for the chip that opens the exhibit pane. */
  cite: ServedCite;
  /** The pages the track cites, ascending; empty when it cites only the whole file. */
  pages: number[];
  date: string;
  /** The document type in words (doc-type.ts), or empty when the matter has none. */
  type: string;
  summary: string;
}

/** A gap in a track guide: a point with no proof yet. */
export interface GuideGap {
  id: Id;
  mark: string;
  text: string;
  /** What the record does not show, in the proof note's words. */
  note: string | null;
}

/** A track guide: its kind, caption and forum, the parties on each side, and its entities, facts, points, exhibits and gaps. */
export interface TrackGuide {
  kind: TrackKind;
  caption: string;
  forum: string;
  against: GuideParty[];
  clientSide: GuideParty[];
  entities: GuideEntity[];
  facts: GuideFact[];
  points: GuidePoint[];
  exhibits: GuideExhibit[];
  gaps: GuideGap[];
}

/** Roles that speak for a side rather than stand on it: counsel, experts, court staff and vendors are not parties. */
const NOT_PARTIES = new Set<Person['role']>(['plaintiffCounsel', 'defenseCounsel', 'expert', 'courtStaff', 'vendor']);

/**
 * A link that only says who acts for whom ("counsel for", "represents", "represented by"): it ties a lawyer or a
 * law firm to a client, not a party to the matter's entities, so a party's holdings leave it out.
 */
export function isCounselLink(label: string | null): boolean {
  return label !== null && /\b(?:counsel|represents|represented|attorneys?|lawyers?)\b/i.test(label);
}

/**
 * A person or org who appears only as someone's counsel: a counsel link from it ("counsel for", not the client's
 * own "represented by"), or a law firm on the client side.
 */
function actsAsCounsel(id: Id, matter: TrackMatter, org?: Org): boolean {
  if (org && org.kind === 'firm' && org.side === 'client') return true;
  return matter.links.some((link) => link.from === id && isCounselLink(link.label) && !/\brepresented\b/i.test(link.label));
}

function citeKey(cite: Pick<ServedCite, 'doc' | 'page'>): string {
  return `${cite.doc}#${cite.page ?? ''}`;
}

/** Cites in order, each document page once. */
export function uniqueCites(...lists: readonly (readonly ServedCite[])[]): ServedCite[] {
  const seen = new Set<string>();
  return lists.flat().filter((cite) => {
    const key = citeKey(cite);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function controlsOf(id: Id, matter: TrackMatter, orgs: ReadonlyMap<Id, Org>): GuideControl[] {
  const out = new Map<Id, GuideControl>();
  for (const link of matter.links) {
    const org = link.from === id && !isCounselLink(link.label) ? orgs.get(link.to) : undefined;
    if (!org || actsAsCounsel(org.id, matter, org)) continue;
    const had = out.get(org.id);
    if (had) had.cites = uniqueCites(had.cites, link.cites);
    else out.set(org.id, { id: org.id, name: org.name, relation: link.label, cites: [...link.cites] });
  }
  const person = matter.people.find((p) => p.id === id);
  const tied = person ? person.orgs : matter.orgs.filter((o) => o.parent === id).map((o) => o.id);
  for (const orgId of tied) {
    const org = orgs.get(orgId);
    if (!org || out.has(org.id) || actsAsCounsel(org.id, matter, org)) continue;
    // A child org's parent "owns or manages" it (MatterOrg.parent); a person's orgs carry no words of their own.
    out.set(org.id, { id: org.id, name: org.name, relation: person ? null : 'owns or manages', cites: [] });
  }
  return [...out.values()];
}

function partyOf(id: Id, matter: TrackMatter, orgs: ReadonlyMap<Id, Org>): GuideParty | null {
  const person = matter.people.find((p) => p.id === id);
  const party: Person | Org | undefined = person ?? orgs.get(id);
  if (!party) return null;
  return {
    id, name: party.name, side: party.side, role: person?.title ?? null, controls: controlsOf(id, matter, orgs), cites: [...party.cites],
  };
}

/**
 * The client side: client-side people and orgs who act in the track's violations or in their events, never
 * counsel, experts or staff. A plaintiff by role comes first; otherwise manifest order.
 */
function clientSideOf(
  againstIds: readonly Id[], matter: TrackMatter, violations: readonly TrackViolation[], orgs: ReadonlyMap<Id, Org>,
): GuideParty[] {
  const eventIds = new Set(violations.flatMap((v) => v.events));
  const actors = new Set<Id>([
    ...violations.flatMap((v) => v.actors),
    ...matter.events.filter((e) => eventIds.has(e.id)).flatMap((e) => e.actors),
  ]);
  const against = new Set(againstIds);
  const people = matter.people
    .filter((p) => actors.has(p.id) && !against.has(p.id) && p.side === 'client' && !NOT_PARTIES.has(p.role) && !actsAsCounsel(p.id, matter))
    .sort((a, b) => Number(b.role === 'plaintiff') - Number(a.role === 'plaintiff'));
  const clientOrgs = matter.orgs.filter((o) => actors.has(o.id) && !against.has(o.id) && o.side === 'client' && !actsAsCounsel(o.id, matter, o));
  return [...people, ...clientOrgs].flatMap((p) => partyOf(p.id, matter, orgs) ?? []);
}

function depth(id: Id, orgs: ReadonlyMap<Id, Org>): number {
  let n = 0;
  const seen = new Set<Id>([id]);
  for (let parent = orgs.get(id)?.parent ?? null; parent && !seen.has(parent); parent = orgs.get(parent)?.parent ?? null) {
    seen.add(parent);
    n += 1;
  }
  return n;
}

/** The violations' entities, by date formed (undated last), parents before their children, each with its parent. */
function entitiesOf(violations: readonly TrackViolation[], matter: TrackMatter, orgs: ReadonlyMap<Id, Org>): GuideEntity[] {
  const order = new Map(matter.orgs.map((o, i) => [o.id, i]));
  const ids = [...new Set(violations.flatMap((v) => v.entities))].filter((id) => orgs.has(id));
  return ids
    .map((id) => {
      const org = orgs.get(id) as Org;
      const parent = org.parent ? orgs.get(org.parent) : undefined;
      return {
        id, name: org.name, formed: stepDate({ date: org.formed ?? '' }),
        parent: parent ? { id: parent.id, name: parent.name } : null, cites: [...org.cites],
      };
    })
    .sort((a, b) => (a.formed === '' ? 1 : 0) - (b.formed === '' ? 1 : 0)
      || a.formed.localeCompare(b.formed)
      || depth(a.id, orgs) - depth(b.id, orgs)
      || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

interface Draft {
  date: string;
  text: string;
  detail: string | null;
  marks: string[];
  cites: ServedCite[];
  /** The event already folded into this fact, if any. */
  event: Id | null;
  fromStep: boolean;
}

function addMark(marks: string[], mark: string): void {
  if (!marks.includes(mark)) marks.push(mark);
}

/**
 * The facts in date order, numbered from 1. Each step is a fact; each of the violations' events joins the step it
 * records (same date, a document in common) and lends it its title and summary, the record's own words; an event
 * no step records is a fact of its own. An event two violations share is one fact with both marks.
 */
function factsOf(violations: readonly TrackViolation[], matter: TrackMatter): GuideFact[] {
  const drafts: Draft[] = [];
  for (const v of violations) {
    for (const step of v.steps) {
      const date = stepDate(step);
      const same = drafts.find((d) => d.fromStep && d.date === date && d.text === step.label);
      if (same) {
        addMark(same.marks, v.mark);
        same.cites = uniqueCites(same.cites, step.cites);
      } else {
        drafts.push({ date, text: step.label, detail: null, marks: [v.mark], cites: [...step.cites], event: null, fromStep: true });
      }
    }
  }
  const events = new Map(matter.events.map((e) => [e.id, e]));
  const byEvent = new Map<Id, Draft>();
  for (const v of violations) {
    for (const id of v.events) {
      const event = events.get(id);
      if (!event) continue;
      const known = byEvent.get(id);
      if (known) {
        addMark(known.marks, v.mark);
        continue;
      }
      const date = stepDate(event);
      const docs = new Set(event.cites.map((c) => c.doc));
      const step = drafts.find((d) => d.fromStep && d.event === null && d.date === date && d.cites.some((c) => docs.has(c.doc)));
      if (step) {
        step.event = id;
        step.text = event.title;
        step.detail = event.summary;
        step.cites = uniqueCites(event.cites, step.cites);
        addMark(step.marks, v.mark);
        byEvent.set(id, step);
      } else {
        const draft: Draft = { date, text: event.title, detail: event.summary, marks: [v.mark], cites: [...event.cites], event: id, fromStep: false };
        drafts.push(draft);
        byEvent.set(id, draft);
      }
    }
  }
  const marks = violations.map((v) => v.mark);
  return drafts
    .map((d, i) => ({ d, i }))
    .sort((a, b) => (a.d.date === '' ? 1 : 0) - (b.d.date === '' ? 1 : 0) || a.d.date.localeCompare(b.d.date) || a.i - b.i)
    .map(({ d }, i) => ({
      n: i + 1, date: d.date, text: d.text, detail: d.detail,
      marks: [...d.marks].sort((a, b) => marks.indexOf(a) - marks.indexOf(b)), cites: d.cites,
    }));
}

/** The track's points, in track order, for the violations the track shows. */
function pointsOf(track: Track, violations: readonly TrackViolation[]): GuidePoint[] {
  const mark = new Map(violations.map((v) => [v.id, v.mark]));
  return track.points
    .filter((p) => mark.has(p.violation))
    .map((p) => ({
      id: p.id, violation: p.violation, mark: mark.get(p.violation) as string, text: p.text, authority: p.authority,
      strength: strongestProof(p).strength,
    }));
}

/**
 * Every document the guide cites, once each, by control number (unnumbered last, then by date): the exhibit list.
 * `cites` is every cite the guide shows, in any order.
 */
export function exhibitsOf(cites: readonly ServedCite[], docs: TrackMatter['docs']): GuideExhibit[] {
  const byDoc = new Map<Id, { control: number | null; pages: Set<number> }>();
  for (const cite of cites) {
    const entry = byDoc.get(cite.doc) ?? { control: null, pages: new Set<number>() };
    if (entry.control === null && typeof cite.control === 'number') entry.control = cite.control;
    if (cite.page !== null) entry.pages.add(cite.page);
    byDoc.set(cite.doc, entry);
  }
  return [...byDoc.entries()]
    .map(([doc, entry]) => {
      const facts = docs[doc];
      const control = entry.control ?? facts?.control ?? null;
      return {
        doc, control, cite: { doc, page: null, control },
        pages: [...entry.pages].sort((a, b) => a - b),
        date: facts?.date ?? '', type: docTypeWords(facts?.type ?? ''), summary: facts?.summary ?? '',
      };
    })
    .sort((a, b) => (a.control === null ? 1 : 0) - (b.control === null ? 1 : 0)
      || (a.control ?? 0) - (b.control ?? 0)
      || a.date.localeCompare(b.date)
      || a.doc.localeCompare(b.doc));
}

/** The points with no proof in the record yet, with the proof note that says what is missing. */
function gapsOf(track: Track, points: readonly GuidePoint[]): GuideGap[] {
  const byId = new Map(track.points.map((p) => [p.id, p]));
  return points
    .filter((p) => p.strength === 'gap')
    .map((p) => {
      const note = byId.get(p.id)?.proof.find((item) => item.strength === 'gap' && item.note)?.note ?? null;
      return { id: p.id, mark: p.mark, text: p.text, note };
    });
}

/**
 * "Owner and manager" becomes "owner and manager" inside a sentence. A role that may open with a name keeps its case:
 * "HVAC manager", "Roe's driver", "Head Chef", "Harbor Labs manager" (a capital on the second word).
 */
export function inSentence(role: string): string {
  return /^\p{Lu}\p{Ll}+(?:$|[,;]|\s+[\p{Ll}\d(])/u.test(role) ? `${role.charAt(0).toLowerCase()}${role.slice(1)}` : role;
}

/**
 * A party as the outline reads it, in sentences: the name, then ", <role>." and what the party holds or runs per
 * the record ("Manages Harbor Labs, Inc.; and owner of Roe Commissary, LLC."). `lead` is the name the view sets in
 * bold; `text` follows it.
 */
export function partySentence(party: Pick<GuideParty, 'name' | 'role' | 'controls'>): { lead: string; text: string } {
  const role = party.role?.trim();
  const first = role ? `, ${inSentence(role)}.` : '.';
  const ties = party.controls.map((control) => `${control.relation ?? 'tied to'} ${control.name}`);
  if (ties.length === 0) return { lead: party.name, text: first };
  const list = ties.length === 1 ? ties[0] : `${ties.slice(0, -1).join('; ')}; and ${ties[ties.length - 1]}`;
  return { lead: party.name, text: `${first} ${list.charAt(0).toUpperCase()}${list.slice(1)}.` };
}

/**
 * Who the track is against, in order: for a complaint whose brief pleads defendants, the cast entries whose role
 * opens with "Defendant" (so the outline counts the defendants the brief's Who's who shows); else `track.against`.
 */
export function againstIdsOf(track: Pick<Track, 'kind' | 'against' | 'brief'>): Id[] {
  const cast = track.kind === 'complaint' ? (track.brief?.cast ?? []) : [];
  const pleaded = cast.filter((entry) => pleadedRole(entry.role) === 'defendant').map((entry) => entry.id);
  return pleaded.length > 0 ? [...new Set(pleaded)] : [...track.against];
}

/** "2 of 3 points secured": the points to prove whose proof is direct or corroborating. */
export function pointsLabel(secured: number, total: number): string {
  return `${secured} of ${total} ${total === 1 ? 'point' : 'points'} secured`;
}

/** The whole guide for one track. */
export function trackGuide(track: Track, matter: TrackMatter): TrackGuide {
  const violations = violationsOf(track, matter);
  const orgs = new Map(matter.orgs.map((o) => [o.id, o]));
  const againstIds = againstIdsOf(track);
  const against = againstIds.flatMap((id) => partyOf(id, matter, orgs) ?? []);
  const clientSide = clientSideOf(againstIds, matter, violations, orgs);
  const entities = entitiesOf(violations, matter, orgs);
  const facts = factsOf(violations, matter);
  const points = pointsOf(track, violations);
  const eventIds = new Set(violations.flatMap((v) => v.events));
  const cited = [
    ...[...against, ...clientSide].flatMap((p) => [...p.cites, ...p.controls.flatMap((x) => x.cites)]),
    ...entities.flatMap((e) => e.cites),
    ...facts.flatMap((f) => f.cites),
    ...violations.flatMap((v) => [...v.cites, ...v.steps.flatMap((s) => s.cites), ...v.figures.flatMap((f) => f.cites)]),
    ...matter.events.filter((e) => eventIds.has(e.id)).flatMap((e) => e.cites),
    ...track.points.filter((p) => points.some((q) => q.id === p.id)).flatMap((p) => p.proof.map((item) => item.cite)),
  ];
  return {
    kind: track.kind, caption: track.title, forum: track.forum, against, clientSide, entities, facts, points,
    exhibits: exhibitsOf(cited, matter.docs), gaps: gapsOf(track, points),
  };
}

/** "Complaint guide" or "Filing guide". */
export function guideTitle(kind: TrackKind): string {
  return kind === 'regulator' ? 'Filing guide' : 'Complaint guide';
}

/** The label over the parties the track is against: defendants in a complaint, the record's list in a filing. */
export function againstLabel(kind: TrackKind): string {
  return kind === 'regulator' ? 'Against, per the record' : 'Defendants';
}

function span(dates: readonly string[]): string {
  const sorted = dates.filter(Boolean).sort();
  if (sorted.length === 0) return '';
  const first = formatPartialDate(sorted[0]);
  const last = formatPartialDate(sorted[sorted.length - 1]);
  return first === last ? first : `${first} to ${last}`;
}

/** The headings, each stating what its section shows (DESIGN.md section 9: content headings state conclusions). */
export function guideHeadings(guide: TrackGuide): Record<'parties' | 'entities' | 'facts' | 'points' | 'exhibits' | 'gaps', string> {
  const against = guide.kind === 'regulator'
    ? `${plural(guide.against.length, 'party', 'parties')} named`
    : plural(guide.against.length, 'defendant');
  const client = guide.clientSide.length > 0 ? `; ${guide.clientSide.length} on the client side` : '';
  const formed = guide.entities.map((e) => e.formed);
  const allDated = formed.length > 0 && formed.every(Boolean);
  const when = allDated ? span(formed) : '';
  const entityLine = when === ''
    ? plural(guide.entities.length, 'entity', 'entities')
    : `${plural(guide.entities.length, 'entity', 'entities')}, formed ${when}`;
  const factSpan = span(guide.facts.map((f) => f.date));
  const gaps = guide.gaps.length;
  return {
    parties: `${against}${client}`,
    entities: entityLine,
    facts: factSpan ? `${plural(guide.facts.length, 'fact')}, ${factSpan}` : plural(guide.facts.length, 'fact'),
    points: guide.points.length === 0
      ? 'No points to prove are listed yet'
      : pointsLabel(guide.points.filter((p) => isSecured(p.strength)).length, guide.points.length),
    exhibits: `${plural(guide.exhibits.length, 'document')} cited`,
    gaps: guide.points.length === 0
      ? 'No points to prove are listed yet'
      : gaps === 0
        ? 'Every point to prove has proof in the record'
        : `${plural(gaps, 'point')} not yet in the record`,
  };
}
