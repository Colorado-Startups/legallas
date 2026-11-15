// SPDX-License-Identifier: Apache-2.0
// Card P3 (People). The pure half of the Entities & People page: one list of parties (people and organizations),
// the profile drawn for a chosen party (its unit card counts, the violations and prior counts it is named in,
// connections, events and documents), the table rows, the side filter and the ?p=, ?view= and ?v= deep links.
// people.ts draws it; tested in people-model.test.ts.
import type { RoomEvent, RoomLink, RoomOrg, RoomPerson, ServedCite, ServedMatter, Side } from './matter-api.ts';
import { parentsOf } from './viz/tree-layout.ts';

/** The order the sides are listed in. */
export const SIDE_ORDER: readonly Side[] = ['client', 'defendant', 'nominal', 'court', 'third'];

/** Chip and table words for each side (DESIGN.md section 3; the client is named by the page). */
export const SIDE_LABELS: Record<Side, string> = {
  client: 'Client side',
  defendant: 'Defendants',
  nominal: 'Company and nominal parties',
  court: 'Court',
  third: 'Third parties',
};

const ROLE_WORDS: Record<RoomPerson['role'], string> = {
  plaintiff: 'Plaintiff', defendant: 'Defendant', plaintiffCounsel: 'Counsel for plaintiff',
  defenseCounsel: 'Counsel for defendants', expert: 'Expert', witness: 'Witness', courtStaff: 'Court staff',
  vendor: 'Vendor', other: 'Other',
};

const ORG_WORDS: Record<RoomOrg['kind'], string> = {
  company: 'Company', fund: 'Fund', firm: 'Firm', court: 'Court', agency: 'Agency', other: 'Organization',
};

/** A person or an organization, as the page lists it. */
export interface Party {
  id: string;
  name: string;
  kind: 'person' | 'org';
  side: Side;
  /** Role (people) or kind (orgs) as words. */
  role: string;
  title: string | null;
  /** A person's orgs; an org's parent. */
  orgs: string[];
  cites: ServedCite[];
}

/** Lists every person and org of the matter as a party. */
export function partiesOf(matter: Pick<ServedMatter, 'people' | 'orgs'>): Party[] {
  const people: Party[] = matter.people.map((p) => ({
    id: p.id, name: p.name, kind: 'person', side: p.side, role: ROLE_WORDS[p.role] ?? 'Other', title: p.title,
    orgs: [...p.orgs], cites: p.cites,
  }));
  const orgs: Party[] = matter.orgs.map((o) => ({
    id: o.id, name: o.name, kind: 'org', side: o.side, role: ORG_WORDS[o.kind] ?? 'Organization', title: null,
    orgs: o.parent ? [o.parent] : [], cites: o.cites,
  }));
  return [...people, ...orgs].sort(byName);
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
}

/** One tie from the chosen party to another: a record link, membership in an org, or an org's parent. */
export interface Connection {
  other: Party;
  /** The link label as the record states it ("manages"). */
  label: string;
  /** `out`: the chosen party is the subject ("Roe manages the Company"); `in`: the other party is. */
  direction: 'out' | 'in';
  /** The whole tie as a sentence, for the accessible name and the title. */
  sentence: string;
  cites: ServedCite[];
}

/** A document in a party's profile, with its control number and date. */
export interface DocEntry {
  id: string;
  control: number | null;
  date: string | null;
  type: string | null;
  summary: string | null;
  privileged: boolean;
  /** The chosen party wrote it, received it, or both. */
  role: 'from' | 'to' | 'both';
}

/** A violation the party is named in, as the manifest marks it ("A") and titles it. */
export interface ViolationRef {
  id: string;
  mark: string;
  title: string;
}

/** The unit card's counts, all from the manifest. */
export interface UnitCounts {
  /** Entities under an org at any depth; for a person, the entities they manage, own or control and those under them. */
  controlled: number;
  violations: number;
  /** Distinct documents this profile cites: sources, ties, events, and documents to or from the party. */
  documents: number;
}

/** A party's profile: the party, its orgs and the violations that name it. */
export interface Profile {
  party: Party;
  orgs: Party[];
  /** Violations naming this party as an actor or an entity, by mark. */
  violations: ViolationRef[];
  /** Counts pleaded against this party in the prior case, by number. */
  counts: number[];
  unit: UnitCounts;
  connections: Connection[];
  events: RoomEvent[];
  documents: DocEntry[];
}

function sentence(from: Party, label: string, to: Party): string {
  return `${from.name} ${label} ${to.name}`;
}

function connectionsOf(id: string, links: RoomLink[], parties: Map<string, Party>): Connection[] {
  const self = parties.get(id);
  if (!self) return [];
  const out: Connection[] = [];
  const tied = new Set<string>();
  for (const link of links) {
    const outgoing = link.from === id;
    if (!outgoing && link.to !== id) continue;
    const other = parties.get(outgoing ? link.to : link.from);
    if (!other || other.id === id) continue;
    tied.add(other.id);
    out.push({
      other, label: link.label, direction: outgoing ? 'out' : 'in', cites: link.cites,
      sentence: outgoing ? sentence(self, link.label, other) : sentence(other, link.label, self),
    });
  }
  // Membership the record states on the person or org itself, unless a link already ties the two.
  for (const orgId of self.orgs) {
    const org = parties.get(orgId);
    if (!org || tied.has(orgId)) continue;
    const label = self.kind === 'person' ? 'member of' : 'part of';
    out.push({ other: org, label, direction: 'out', cites: self.cites, sentence: sentence(self, label, org) });
  }
  for (const member of parties.values()) {
    if (member.id === id || !member.orgs.includes(id) || tied.has(member.id)) continue;
    const label = member.kind === 'person' ? 'member of' : 'part of';
    out.push({ other: member, label, direction: 'in', cites: member.cites, sentence: sentence(member, label, self) });
  }
  return out;
}

function compareDates(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/** Documents whose DocFacts name the party as a sender or a recipient, oldest first. */
export function documentsOf(id: string, docs: ServedMatter['docs']): DocEntry[] {
  const out: DocEntry[] = [];
  for (const [docId, facts] of Object.entries(docs)) {
    const from = facts.from.includes(id);
    const to = facts.to.includes(id);
    if (!from && !to) continue;
    out.push({
      id: docId, control: facts.control, date: facts.date, type: facts.type, summary: facts.summary,
      privileged: facts.privileged, role: from && to ? 'both' : from ? 'from' : 'to',
    });
  }
  return out.sort((a, b) => compareDates(a.date, b.date) || (a.control ?? Infinity) - (b.control ?? Infinity));
}

/** Events with the party among the actors, oldest first. */
export function eventsOf(id: string, events: RoomEvent[]): RoomEvent[] {
  return events.filter((e) => e.actors.includes(id)).sort((a, b) => compareDates(a.date, b.date));
}

/** The manifest's violations naming `id` among their actors or entities, by mark. A manifest served before
 * violations existed has none. */
export function violationsOf(matter: Pick<ServedMatter, 'violations'>, id: string): ViolationRef[] {
  return (matter.violations ?? [])
    .filter((v) => v.actors.includes(id) || v.entities.includes(id))
    .map((v) => ({ id: v.id, mark: v.mark, title: v.title }))
    .sort((a, b) => a.mark.localeCompare(b.mark) || a.title.localeCompare(b.title));
}

/** Link labels that state control: managing, owning, directing, acting as general partner or trustee. */
const CONTROL = /\b(manag|own|control|direct|general partner|trustee)/i;

/** Entities an org has under it, or a person controls (and those under them), from the structure and the links. */
export function controlledBy(id: string, matter: Pick<ServedMatter, 'orgs' | 'links'>): number {
  const parent = parentsOf(matter.orgs);
  const kids = new Map<string, string[]>();
  for (const [child, p] of parent) if (p) kids.set(p, [...(kids.get(p) ?? []), child]);
  const orgIds = new Set(matter.orgs.map((o) => o.id));
  const heads = orgIds.has(id) ? [id]
    : matter.links.filter((l) => l.from === id && orgIds.has(l.to) && CONTROL.test(l.label)).map((l) => l.to);
  const seen = new Set<string>();
  const walk = (at: string): void => { for (const k of kids.get(at) ?? []) if (!seen.has(k)) { seen.add(k); walk(k); } };
  for (const h of heads) {
    if (h !== id) seen.add(h);
    walk(h);
  }
  seen.delete(id);
  return seen.size;
}

/** Builds the profile of the party with the given id, or null when there is none. */
export function profileOf(matter: ServedMatter, parties: Party[], id: string): Profile | null {
  const byId = new Map(parties.map((p) => [p.id, p]));
  const party = byId.get(id);
  if (!party) return null;
  const violations = violationsOf(matter, id);
  const connections = connectionsOf(id, matter.links, byId);
  const events = eventsOf(id, matter.events);
  const documents = documentsOf(id, matter.docs);
  const cited = new Set([
    ...party.cites, ...connections.flatMap((c) => c.cites), ...events.flatMap((e) => e.cites),
  ].map((c) => c.doc));
  for (const d of documents) cited.add(d.id);
  return {
    party,
    orgs: party.orgs.map((o) => byId.get(o)).filter((o): o is Party => Boolean(o)),
    violations,
    counts: [...new Set(matter.claims.filter((c) => c.against.includes(id)).map((c) => c.count))].sort((a, b) => a - b),
    unit: { controlled: controlledBy(id, matter), violations: violations.length, documents: cited.size },
    connections,
    events,
    documents,
  };
}

const ROMAN: Array<[number, string]> = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'],
  [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

/** Counts are numbered as the pleading numbers them: 3 is "III". */
export function roman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n);
  let rest = n;
  let out = '';
  for (const [value, letters] of ROMAN) {
    while (rest >= value) { out += letters; rest -= value; }
  }
  return out;
}

/** "Count II", "Counts II and III", "Counts I, II and V". */
export function countsPhrase(counts: number[]): string {
  const names = counts.map(roman);
  if (names.length === 0) return '';
  if (names.length === 1) return `Count ${names[0]}`;
  return `Counts ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Role and title, without saying the same thing twice ("Counsel for plaintiff"). */
export function roleText(role: string, title: string | null): string {
  if (!title) return role;
  return title.toLowerCase().includes(role.toLowerCase()) ? title : `${role}; ${title}`;
}

/**
 * The client side's chip: "Doe's side" when the pleading defines a short term for the plaintiff on the client
 * side, else "Client side".
 */
export function clientSideLabel(matter: Pick<ServedMatter, 'people' | 'meta'>): string {
  const plaintiff = matter.people.find((p) => p.side === 'client' && p.role === 'plaintiff');
  if (!plaintiff) return SIDE_LABELS.client;
  const term = matter.meta.definedTerms.find((t) => t.means.includes(plaintiff.name) && /^[A-Z][\w.'-]{0,30}$/.test(t.term));
  return term ? `${term.term}'s side` : SIDE_LABELS.client;
}

/** A table row: name, role, side, orgs, events count, documents count. */
export interface PartyRow {
  party: Party;
  orgNames: string;
  events: number;
  documents: number;
}

/** Builds the people table's rows from the matter's parties. */
export function tableRows(matter: ServedMatter, parties: Party[]): PartyRow[] {
  const names = new Map(parties.map((p) => [p.id, p.name]));
  const events = new Map<string, number>();
  for (const e of matter.events) for (const a of new Set(e.actors)) events.set(a, (events.get(a) ?? 0) + 1);
  const documents = new Map<string, number>();
  for (const facts of Object.values(matter.docs)) {
    for (const id of new Set([...facts.from, ...facts.to])) documents.set(id, (documents.get(id) ?? 0) + 1);
  }
  return [...parties]
    .sort((a, b) => SIDE_ORDER.indexOf(a.side) - SIDE_ORDER.indexOf(b.side) || byName(a, b))
    .map((party) => ({
      party,
      orgNames: party.orgs.map((o) => names.get(o)).filter(Boolean).join('; '),
      events: events.get(party.id) ?? 0,
      documents: documents.get(party.id) ?? 0,
    }));
}

/** "12 people and 6 organizations, placed by side". */
export function summaryLine(parties: Party[]): string {
  const people = parties.filter((p) => p.kind === 'person').length;
  const orgs = parties.length - people;
  const part = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return `${part(people, 'person', 'people')} and ${part(orgs, 'organization', 'organizations')}, placed by side`;
}

/** Parties whose name contains every word of the query, case and accents ignored. Empty query: everyone. */
export function matchParties(parties: Party[], query: string): Party[] {
  const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return parties;
  return parties.filter((p) => {
    const name = fold(p.name);
    return words.every((w) => name.includes(w));
  });
}

/** The page's views: the entity structure (the default), the force graph, the table, and entities by date formed. */
export type PeopleView = 'structure' | 'graph' | 'table' | 'dates';

const VIEW_PARAMS: readonly PeopleView[] = ['graph', 'table', 'dates'];

/**
 * The page state the URL carries: ?p=<id> (the chosen party), ?view=graph, table or dates, and on the By date view
 * ?v=<id> (one violation; absent for All). `violation` is only present on the dates view.
 */
export interface PeopleUrlState {
  party: string | null;
  view: PeopleView;
  violation?: string | null;
}

const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** Reads the chosen party and view from the page's query string. */
export function readUrlState(search: string): PeopleUrlState {
  const params = new URLSearchParams(search);
  const party = params.get('p');
  const asked = params.get('view');
  const view = VIEW_PARAMS.find((v) => v === asked) ?? 'structure';
  const state: PeopleUrlState = { party: party && ID.test(party) ? party : null, view };
  if (view === 'dates') {
    const v = params.get('v');
    state.violation = v && ID.test(v) ? v : null;
  }
  return state;
}

/** The search string for `state`, keeping any other parameters. '' when nothing is set. */
export function writeUrlState(search: string, state: PeopleUrlState): string {
  const params = new URLSearchParams(search);
  if (state.party) params.set('p', state.party); else params.delete('p');
  if (state.view === 'structure') params.delete('view'); else params.set('view', state.view);
  if (state.view === 'dates' && state.violation) params.set('v', state.violation); else params.delete('v');
  const out = params.toString();
  return out ? `?${out}` : '';
}
