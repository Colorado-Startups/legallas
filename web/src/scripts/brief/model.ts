// SPDX-License-Identifier: Apache-2.0
// The complaint brief (/complaint/), the pure half: what each section of the one-page brief shows, built only
// from GET /api/matter (the track's `brief` and `counts`, its violations' steps, contrast and figures). Every
// section is optional: a track without a brief, counts, steps or figures leaves that section out, and the page
// falls back to what the track does have. No DOM, so model.test.ts runs it under node --test; nothing here names
// a party.
import { docTypeWords } from '../doc-type.ts';
import { formatPartialDate, type ProofStrength, type ServedCite, type Side } from '../matter-api.ts';
import { strongestProof } from '../overview-case-model.ts';
import { isSecured, niceCeil, stepDate, type Track, type TrackFigure, type TrackMatter, type TrackViolation } from '../track-model.ts';
import { SIDE_WORDS } from '../viz/core.ts';

/** The room's document type rule (doc-type.ts), kept here so the brief's imports stay put. */
export { docTypeWords };

type Id = string;
type Brief = NonNullable<Track['brief']>;

/** A person or org by id, with its side for the shape beside the name. */
export interface BriefParty {
  id: Id;
  name: string;
  side: Side;
  kind: 'person' | 'org';
}

/** Looks up a person or org by id in the matter and returns it as a brief party, or null. */
export function partyOf(matter: Pick<TrackMatter, 'people' | 'orgs'>, id: Id | null): BriefParty | null {
  if (id === null) return null;
  const person = matter.people.find((p) => p.id === id);
  if (person) return { id, name: person.name, side: person.side, kind: 'person' };
  const org = matter.orgs.find((o) => o.id === id);
  return org ? { id, name: org.name, side: org.side, kind: 'org' } : null;
}

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

/** "Six", "12": a count that opens a heading. */
export function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

// ---------------------------------------------------------------------------------------------------------------
// Who's who

/** A party in the brief's cast, with its plain role and the org it acts through. */
export interface CastCard extends BriefParty {
  /** The plain role, as the brief words it. */
  role: string;
  /** The org the party acts through, when the record names one. */
  via: BriefParty | null;
}

/** The order the cast is grouped in when no role is pleaded: the client, the defendants, the companies, the rest. */
export const SIDE_ORDER: readonly Side[] = ['client', 'defendant', 'nominal', 'third', 'court'];

/** The brief's cast with names and sides; an id the matter does not hold is left out. */
export function castCards(brief: Pick<Brief, 'cast'>, matter: Pick<TrackMatter, 'people' | 'orgs'>): CastCard[] {
  return brief.cast.flatMap((entry) => {
    const party = partyOf(matter, entry.id);
    if (!party) return [];
    const via = entry.via === entry.id ? null : partyOf(matter, entry.via);
    return [{ ...party, role: entry.role.trim(), via }];
  });
}

/** The cast in side order (client, defendants, companies, third parties, court), the brief's order within a side. */
export function castBySide(cards: readonly CastCard[]): { side: Side; cards: CastCard[] }[] {
  return SIDE_ORDER
    .map((side) => ({ side, cards: cards.filter((card) => card.side === side) }))
    .filter((group) => group.cards.length > 0);
}

/** Where a party stands in the pleading, read from the words its cast role opens with. */
export type PleadedRole = 'plaintiff' | 'defendant' | 'relief' | 'nominal' | 'other';

/** The cast's group headings when roles are pleaded, in the order the groups run. */
export const PLEADED_ROLE_WORDS: Record<PleadedRole, string> = {
  plaintiff: 'Plaintiff side',
  defendant: 'Defendants',
  relief: 'Relief defendants',
  nominal: 'Nominal defendants',
  other: 'Others named',
};

const PLEADED_ORDER = Object.keys(PLEADED_ROLE_WORDS) as PleadedRole[];

// The opening words, case-insensitive, each a whole phrase: "Defendant; owner and manager" and "Defendant, through"
// match, "Defendants' counsel" and "Defendant's counsel" do not.
const PLEADED_OPENINGS: readonly [RegExp, PleadedRole][] = [
  [/^relief defendant(?![\p{L}'\u2019])/iu, 'relief'],
  [/^nominal defendant(?![\p{L}'\u2019])/iu, 'nominal'],
  [/^not a defendant(?![\p{L}'\u2019])/iu, 'other'],
  [/^defendant(?![\p{L}'\u2019])/iu, 'defendant'],
  [/^plaintiff(?![\p{L}'\u2019])/iu, 'plaintiff'],
];

/** The pleaded role a cast role opens with ("Relief defendant; holds the walk-in freezer"), else null. */
export function pleadedRole(role: string): PleadedRole | null {
  const words = role.trim();
  return PLEADED_OPENINGS.find(([opening]) => opening.test(words))?.[1] ?? null;
}

/** One heading's worth of the cast: its words and its cards in the brief's order. */
export interface CastGroup {
  key: string;
  label: string;
  cards: CastCard[];
}

/**
 * The cast grouped by pleaded role (plaintiff side, defendants, relief defendants, nominal defendants, others named)
 * once any role opens with a defendant's role, including "Not a defendant"; a client-side party whose role opens
 * with none of them stays on the plaintiff side, and any other party is among the others named. A cast that pleads
 * no defendant role falls back to the parties' sides. Within a group, the brief's order.
 */
export function castGroups(cards: readonly CastCard[]): CastGroup[] {
  const pleaded = cards.map((card) => ({ card, role: pleadedRole(card.role) }));
  if (!pleaded.some(({ role }) => role !== null && role !== 'plaintiff')) {
    return castBySide(cards).map((group) => ({ key: group.side, label: SIDE_WORDS[group.side], cards: group.cards }));
  }
  const placed = pleaded.map(({ card, role }) => ({ card, role: role ?? (card.side === 'client' ? 'plaintiff' : 'other') }));
  return PLEADED_ORDER
    .map((role) => ({ key: role, label: PLEADED_ROLE_WORDS[role], cards: placed.filter((p) => p.role === role).map((p) => p.card) }))
    .filter((group) => group.cards.length > 0);
}

// ---------------------------------------------------------------------------------------------------------------
// The dated steps

/** One step of a violation's story: its number, date, label, note and first cite. */
export interface StepItem {
  /** 1-based, in story order. */
  n: number;
  id: Id;
  /** ISO for the mono date ("2012-01-01", "2013-06"); '' when the step is undated. */
  iso: string;
  label: string;
  note: string | null;
  /** The step's first cite: one per step on the brief. */
  cite: ServedCite | null;
}

/** Turns a violation's steps into numbered story items, in story order. */
export function storySteps(v: Pick<TrackViolation, 'steps'>): StepItem[] {
  return v.steps.map((step, i) => ({
    n: i + 1, id: step.id, iso: stepDate(step), label: step.label, note: step.note?.trim() || null, cite: step.cites[0] ?? null,
  }));
}

/** "Six dated steps, Jan. 2012 to June 2013"; "One dated step, Jan. 2012"; no span when none is dated. */
export function stepsHeading(steps: readonly Pick<StepItem, 'iso'>[]): string {
  const count = `${countWord(steps.length)} dated ${steps.length === 1 ? 'step' : 'steps'}`;
  const months = steps.map((s) => s.iso.slice(0, 7)).filter(Boolean).sort();
  if (months.length === 0) return count;
  const first = formatPartialDate(months[0]);
  const last = formatPartialDate(months[months.length - 1]);
  return first === last ? `${count}, ${first}` : `${count}, ${first} to ${last}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Who held what, before and after

/** One choice on the brief's step switch: the story step it shows and the words on the switch. */
export interface PanelChoice {
  /** The story step the control panel shows. */
  index: number;
  /** The switch's words: "Told Doe, Apr. 11, 2012", or "Step 1, Jan. 1, 2012" without a contrast. */
  label: string;
}

/** The last step dated on or before `date` (a partial date covers its whole period), else null. */
export function stepAt(steps: readonly { date: string }[], date: string): number | null {
  const iso = stepDate({ date });
  if (!iso) return null;
  const end = iso.length === 4 ? `${iso}-12-31` : iso.length === 7 ? `${iso}-31` : iso;
  let found: number | null = null;
  steps.forEach((step, i) => {
    const at = stepDate(step);
    if (at && at <= end) found = i;
  });
  return found;
}

function stepWords(steps: TrackViolation['steps'], index: number): string {
  const when = formatPartialDate(steps[index]?.date);
  return when ? `Step ${index + 1}, ${when}` : `Step ${index + 1}`;
}

/**
 * The two moments the ownership picture compares: what the client was told against what was filed (the contrast's
 * two dates, each at the last step on or before it), else the first step against the last. Null under two steps.
 */
export function beforeAfter(v: Pick<TrackViolation, 'steps' | 'contrast'>): [PanelChoice, PanelChoice] | null {
  const last = v.steps.length - 1;
  if (last < 1) return null;
  const [told, filed] = v.contrast ?? [];
  const toldAt = told ? stepAt(v.steps, told.date) : null;
  const filedAt = filed ? stepAt(v.steps, filed.date) : null;
  if (told && filed && toldAt !== null && filedAt !== null && toldAt < filedAt) {
    const words = (side: typeof told) => {
      const when = formatPartialDate(side.date);
      return when ? `${side.heading}, ${when}` : side.heading;
    };
    return [{ index: toldAt, label: words(told) }, { index: filedAt, label: words(filed) }];
  }
  return [{ index: 0, label: stepWords(v.steps, 0) }, { index: last, label: stepWords(v.steps, last) }];
}

// ---------------------------------------------------------------------------------------------------------------
// Money and figures

/** One dollar figure drawn as a bar, in whole cents. */
export interface MoneyBar {
  id: Id;
  label: string;
  /** Whole cents. */
  value: number;
  note: string | null;
  cite: ServedCite | null;
}

/** A labelled group of money bars. */
export interface MoneyGroup {
  /** The figures' group ("Spring invoices"); '' when the figures carry none. */
  label: string;
  bars: MoneyBar[];
}

/** The brief's money chart: the figures in groups, and where the axis ends. */
export interface MoneyView {
  /** Dollar figures in their groups, groups and bars in manifest order. A group is never summed. */
  groups: MoneyGroup[];
  /** The axis end: the largest amount, rounded up. */
  max: number;
  /** Figures that are not dollars (counts), for the stat tiles beside the chart. */
  others: TrackFigure[];
}

/** The violations' figures split into dollar bars (grouped by `group`) and the rest. Null when there are none. */
export function moneyView(figures: readonly TrackFigure[]): MoneyView | null {
  const groups: MoneyGroup[] = [];
  const others: TrackFigure[] = [];
  for (const figure of figures) {
    if (figure.unit !== 'usd') {
      others.push(figure);
      continue;
    }
    if (!Number.isSafeInteger(figure.value) || figure.value < 0) continue;
    const label = figure.group?.trim() ?? '';
    let group = groups.find((g) => g.label === label);
    if (!group) {
      group = { label, bars: [] };
      groups.push(group);
    }
    group.bars.push({ id: figure.id, label: figure.label, value: figure.value, note: figure.note, cite: figure.cites[0] ?? null });
  }
  if (groups.length === 0 && others.length === 0) return null;
  const values = groups.flatMap((g) => g.bars.map((b) => b.value));
  return { groups, max: values.length ? niceCeil(Math.max(...values)) : 0, others };
}

/** Where an amount sits along a plot `width` wide, for an axis from 0 to `max`. */
export function barLength(value: number, max: number, width: number): number {
  if (!(max > 0) || !(width > 0)) return 0;
  return Math.round((Math.min(Math.max(value, 0), max) / max) * width * 100) / 100;
}

// ---------------------------------------------------------------------------------------------------------------
// The claims map: each count's elements against the proof of the points behind them

/** One element cell in a claims-map row, numbered within its count. */
export interface MapCell {
  id: Id;
  /** 1-based within its count. */
  n: number;
  text: string;
  /** The strongest proof among the element's points; `gap` when none of them has any. */
  strength: ProofStrength;
  /** Where the cell opens: the strongest proof's page. Null for a gap. */
  cite: ServedCite | null;
  /** What that proof shows, or for a gap what the record still lacks. */
  note: string | null;
}

/** One count of the claims map, direct or derivative, as a row of element cells. */
export interface MapRow {
  id: Id;
  title: string;
  kind: 'direct' | 'derivative';
  basis: string;
  against: BriefParty[];
  cells: MapCell[];
}

/** The claims map: rows of element cells and the number of elements that are secured. */
export interface ClaimsMap {
  rows: MapRow[];
  /** Elements whose proof is direct or corroborating. */
  secured: number;
  total: number;
  /** The most elements any count has: the grid's column count. */
  columns: number;
  /** One pip per element, in reading order, for the proof meter. */
  pips: ProofStrength[];
}

/** "Direct", "Derivative". */
/** The word shown for each kind of count. */
export const COUNT_KIND_WORDS: Record<MapRow['kind'], string> = { direct: 'Direct', derivative: 'Derivative' };

/** The track's counts as rows of element cells. Null when the track has none. */
export function claimsMap(track: Pick<Track, 'counts' | 'points'>, matter: Pick<TrackMatter, 'people' | 'orgs'>): ClaimsMap | null {
  const counts = track.counts ?? [];
  if (counts.length === 0) return null;
  const points = new Map(track.points.map((p) => [p.id, p]));
  const rows = counts.map((count) => ({
    id: count.id,
    title: count.title,
    kind: count.kind,
    basis: count.basis,
    against: count.against.flatMap((id) => partyOf(matter, id) ?? []),
    cells: count.elements.map((element, i): MapCell => {
      const behind = element.points.flatMap((id) => points.get(id) ?? []);
      const proof = behind.flatMap((point) => point.proof);
      const { strength, proof: best } = strongestProof({ proof });
      const gapNote = proof.find((item) => item.strength === 'gap' && item.note)?.note ?? null;
      return {
        id: element.id,
        n: i + 1,
        text: element.text,
        strength,
        cite: strength === 'gap' ? null : (best?.cite ?? null),
        note: strength === 'gap' ? gapNote : (best?.note ?? best?.cite.note ?? null),
      };
    }),
  }));
  const pips = rows.flatMap((row) => row.cells.map((cell) => cell.strength));
  return {
    rows,
    secured: pips.filter(isSecured).length,
    total: pips.length,
    columns: Math.max(1, ...rows.map((row) => row.cells.length)),
    pips,
  };
}

/** "Proof secured 4 of 7 elements"; "No elements listed yet." for counts without elements. */
export function mapLabel(map: Pick<ClaimsMap, 'secured' | 'total'>): string {
  if (map.total === 0) return 'No elements listed yet.';
  return `Proof secured ${map.secured} of ${map.total} ${map.total === 1 ? 'element' : 'elements'}`;
}

/** Who a count is against, as a line: "Against Richard Roe and Harbor Labs, Inc."; '' when the count names no one. */
export function againstLine(against: readonly Pick<BriefParty, 'name'>[]): string {
  const names = against.map((p) => p.name);
  if (names.length === 0) return '';
  return `Against ${names.length === 1 ? names[0] : `${names.slice(0, -1).join('; ')} and ${names[names.length - 1]}`}`;
}

/** The count's kind and parties in one line, for the table: "Direct; against Richard Roe and Harbor Labs, Inc.". */
export function countLine(row: Pick<MapRow, 'kind' | 'against'>): string {
  const against = againstLine(row.against);
  return against ? `${COUNT_KIND_WORDS[row.kind]}; a${against.slice(1)}` : COUNT_KIND_WORDS[row.kind];
}

// ---------------------------------------------------------------------------------------------------------------
// Dates, key exhibits and drafts

/** One dated line of the brief, with its ISO date, text and cites. */
export interface DateRow {
  iso: string;
  text: string;
  cites: ServedCite[];
}

/** The dates to confirm, oldest first (undated last, which the validator never lets through anyway). */
export function dateRows(brief: Pick<Brief, 'dates'>): DateRow[] {
  return brief.dates
    .map((item, i) => ({ row: { iso: stepDate(item), text: item.text, cites: item.cites }, i }))
    .sort((a, b) => (a.row.iso === '' ? 1 : 0) - (b.row.iso === '' ? 1 : 0) || a.row.iso.localeCompare(b.row.iso) || a.i - b.i)
    .map(({ row }) => row);
}

/** One exhibit in the brief: its cite, what it proves, and its type and date. */
export interface ExhibitCard {
  cite: ServedCite;
  proves: string;
  /** The document's type and ISO date from the record, when the matter has them. */
  type: string;
  date: string;
}

/** The key exhibits in the brief's order, each document page once, with the document's type and date. */
export function exhibitCards(brief: Pick<Brief, 'exhibits'>, docs: TrackMatter['docs']): ExhibitCard[] {
  const seen = new Set<string>();
  return brief.exhibits.flatMap((exhibit) => {
    const key = `${exhibit.cite.doc}#${exhibit.cite.page ?? ''}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const facts = docs[exhibit.cite.doc];
    return [{ cite: exhibit.cite, proves: exhibit.proves, type: docTypeWords(facts?.type ?? ''), date: stepDate({ date: facts?.date ?? '' }) }];
  });
}

/**
 * The defined term a cast party goes by in the brief ("Roe" for Richard Roe), so a reader new to the matter can
 * tie the short name in the text to the card: the term whose definition names the party in full, the earliest
 * mention first. Null when no term names it, or the term is the name itself.
 */
export function castTerm(name: string, terms: readonly { term: string; means: string }[]): string | null {
  const full = name.trim();
  if (!full || terms.some((def) => def.term.trim() === full)) return null;
  const escaped = full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const whole = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u');
  let best: { term: string; at: number } | null = null;
  for (const def of terms) {
    const at = def.means.search(whole);
    if (at >= 0 && (best === null || at < best.at)) best = { term: def.term.trim(), at };
  }
  return best?.term ?? null;
}

/** "Download draft complaint": the button names the draft it fetches. */
export function downloadLabel(label: string): string {
  const words = label.trim();
  const lowered = /^\p{Lu}\p{Ll}/u.test(words) ? `${words.charAt(0).toLowerCase()}${words.slice(1)}` : words;
  return `Download ${lowered}`;
}

/** The parts of the brief that have something to show; the page lays out only these. */
export interface BriefPlan {
  line: string | null;
  cast: CastCard[];
  hurdles: Brief['hurdles'];
  dates: DateRow[];
  exhibits: ExhibitCard[];
  drafts: Brief['drafts'];
  map: ClaimsMap | null;
  money: MoneyView | null;
}

/** Builds the brief's plan from a track, its matter and the violations. */
export function briefPlan(track: Track, matter: TrackMatter, violations: readonly TrackViolation[]): BriefPlan {
  const brief = track.brief;
  return {
    line: brief?.line.trim() || null,
    cast: brief ? castCards(brief, matter) : [],
    hurdles: brief?.hurdles ?? [],
    dates: brief ? dateRows(brief) : [],
    exhibits: brief ? exhibitCards(brief, matter.docs) : [],
    drafts: brief?.drafts ?? [],
    map: claimsMap(track, matter),
    money: moneyView(violations.flatMap((v) => v.figures)),
  };
}
