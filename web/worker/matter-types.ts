// SPDX-License-Identifier: Apache-2.0
// The matter manifest: what `npm run matter -- build` publishes to R2 (legallas-files, MATTER_KEY) and what
// GET /api/matter serves. The repo holds only this contract; the manifest itself is matter content built from
// the client's maps and catalog, outside the repo. Names and enums follow LegallasCore
// (Sources/LegallasCore/Enums/Enums.swift) so a later Mac-app exporter can write the same file.
// worker/matter.ts (card F2) validates it; scripts/matter/ (card F4) builds it.

export const MATTER_VERSION = 1;

/** The fixed R2 key in the legallas-files bucket. Never in legallas-index, which AI Search reads. */
export const MATTER_KEY = 'meta/matter.json';

/** LegallasCore EventType without `deadline`: the room shows record facts, never a deadline tracker. */
export const EVENT_TYPES = [
  'filing', 'service', 'pleading', 'discovery', 'meeting', 'communication', 'milestone', 'order', 'custom',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** LegallasCore ContactRole. */
export const CONTACT_ROLES = [
  'plaintiff', 'defendant', 'plaintiffCounsel', 'defenseCounsel', 'expert', 'witness', 'courtStaff', 'vendor', 'other',
] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

/** LegallasCore ClaimType. */
export const CLAIM_TYPES = [
  'stateRacketeering', 'civilTheft', 'breachContract', 'breachFiduciaryDuty', 'fraud', 'conversion', 'unjustEnrichment', 'custom',
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

/** Which side a person or organization is on. Drives the chart encoding (web/DESIGN.md). */
export const SIDES = ['client', 'defendant', 'nominal', 'court', 'third'] as const;
export type Side = (typeof SIDES)[number];

/** Target rings: bullseye, two rings, one ring, dashed ring. */
export const PROOF_STRENGTHS = ['direct', 'corroborating', 'circumstantial', 'gap'] as const;
export type ProofStrength = (typeof PROOF_STRENGTHS)[number];

export const ORG_KINDS = ['company', 'fund', 'firm', 'court', 'agency', 'other'] as const;
export type OrgKind = (typeof ORG_KINDS)[number];

/**
 * A partial ISO date: "2023", "2023-10" or "2023-10-17". Never later than the build date: the room shows what
 * happened, not what is due.
 */
export type PartialDate = string;

/** A pinpoint cite. `doc` is a documents.id (stable across renames); `page` is 1-based, or null for the whole file. */
export interface Cite {
  doc: string;
  page: number | null;
  /** A neutral one-line pointer, at most 160 characters, never quoted case text. */
  note?: string;
}

/** Ids are short slugs, unique within their list (for example "ev-0042", "p-smith", "count-3-el-2"). */
type Id = string;

export interface DefinedTerm<C extends Cite = Cite> {
  /** As the operative pleading defines it, for example "Harbor Labs". */
  term: string;
  /** What it stands for, for example "Harbor Labs, Inc., a Delaware corporation". */
  means: string;
  /** Where the pleading defines it (pinpoint page). Optional; a view falls back to the operative pleading. */
  cite?: C;
}

/**
 * A case that closed: its caption, court and pleading, kept as history once the matter moved on to new filings.
 * The prior case's counts are the manifest's `claims` (the room's "Prior case (closed)" page).
 */
export interface PriorCase<C extends Cite = Cite> {
  caption: string;
  court: string;
  caseNumber: string | null;
  division: string | null;
  judge: string | null;
  filed: PartialDate | null;
  operativePleading: { title: string; cite: C } | null;
}

/**
 * The matter's header. Before any new filing it names the case counsel is preparing ("Doe v. Roe", court "Not
 * yet filed") and the closed case moves to `priorCase`; a manifest without `priorCase` describes one live case.
 */
export interface MatterMeta<C extends Cite = Cite> {
  caption: string;
  court: string;
  /** The court's docket number for the case, as the operative pleading prints it. */
  caseNumber: string | null;
  division: string | null;
  judge: string | null;
  filed: PartialDate | null;
  operativePleading: { title: string; cite: C } | null;
  /** The closed case, when the matter has moved on from it. Additive: older manifests leave it out. */
  priorCase?: PriorCase<C> | null;
  definedTerms: DefinedTerm<C>[];
  /** ISO timestamp of the build; future-dated entries are refused against it. */
  builtAt: string;
}

export interface MatterEvent<C extends Cite = Cite> {
  id: Id;
  date: PartialDate;
  title: string;
  summary: string | null;
  type: EventType;
  /** Person or org ids. */
  actors: Id[];
  /** Claim ids this event bears on. */
  claims: Id[];
  cites: C[];
}

export interface MatterPerson<C extends Cite = Cite> {
  id: Id;
  name: string;
  role: ContactRole;
  side: Side;
  /** A short role description, for example "Manager, 2011 to 2013". */
  title: string | null;
  orgs: Id[];
  cites: C[];
}

export interface MatterOrg<C extends Cite = Cite> {
  id: Id;
  name: string;
  kind: OrgKind;
  side: Side;
  /** The org that owns or manages this one, for the structure graph. */
  parent: Id | null;
  /** When the org was formed, as the formation record dates it; null when the record does not say. */
  formed: PartialDate | null;
  cites: C[];
}

/**
 * What kind of source a link statement comes from (after the Beneficial Ownership Data Standard's source types,
 * split for litigation): a public filing, a party's own document, a mediation exhibit, a settlement
 * communication, our pleading or theirs, the owner's account, or an inference drawn from other statements.
 */
export const STATEMENT_BASES = [
  'filing', 'document', 'mediation', 'settlement', 'pleadingOurs', 'pleadingTheirs', 'account', 'inference',
] as const;
export type StatementBasis = (typeof STATEMENT_BASES)[number];

/**
 * One source's statement about a link: whether the tie held, when it held as the source states it, and when the
 * source said so. Sources that disagree about the same tie are separate statements, never merged; the
 * disagreement is the evidence (a letter says one date, a later filing another).
 */
export interface LinkStatement<C extends Cite = Cite> {
  /** False when the source denies the tie ("no such tie"). */
  held: boolean;
  /** When the tie began, as the source states it; null when it does not say. */
  since: PartialDate | null;
  /** When the tie ended, as the source states it; null when it is ongoing or the source does not say. */
  until: PartialDate | null;
  /** When the source speaks: its filing, signing or sending date. */
  asOf: PartialDate;
  basis: StatementBasis;
  /** The interest in percent: exact when min equals max (65), a range when a filing gives a band (50 to 75). */
  share: { min: number; max: number } | null;
  /** True when held directly, false when through another entity (a filing can say); null when not stated. */
  direct: boolean | null;
  /** What the source says, in a line ("tenant since 2011"). */
  note: string | null;
  cites: C[];
}

/** An edge in the people graph: who signed, managed, owned, emailed or paid whom. */
export interface MatterLink<C extends Cite = Cite> {
  from: Id;
  to: Id;
  label: string;
  cites: C[];
  /** Dated statements about this tie, one per source. Left out when there are none, so older links keep their bytes. */
  statements?: LinkStatement<C>[];
}

export interface ProofItem<C extends Cite = Cite> {
  cite: C;
  strength: ProofStrength;
  /** One line on what the document shows for this element. */
  note: string | null;
}

export interface ClaimElement<C extends Cite = Cite> {
  id: Id;
  text: string;
  /** The authority stating the element, as a citation string. */
  authority: string;
  proof: ProofItem<C>[];
}

export interface MatterClaim<C extends Cite = Cite> {
  id: Id;
  /** The count number in the operative pleading. */
  count: number;
  type: ClaimType;
  label: string;
  /** Party ids the count is pleaded against. */
  against: Id[];
  elements: ClaimElement<C>[];
  cites: C[];
}

/**
 * What a money fact records. Promises (commitment, call) and movements (the rest) are separate series:
 * a view never adds one to the other.
 */
export const MONEY_KINDS = ['commitment', 'call', 'contribution', 'distribution', 'fee', 'payment', 'transfer'] as const;
export type MoneyKind = (typeof MONEY_KINDS)[number];

/** Money that appears in the record: a payment, contribution, fee or distribution. Never a model or projection. */
export interface MoneyFact<C extends Cite = Cite> {
  id: Id;
  date: PartialDate;
  /** Whole cents, so sums never drift. */
  amountCents: number;
  /** Optional until every source sets it; a view treats a missing kind as uncharted (table only). */
  kind?: MoneyKind;
  from: Id | null;
  to: Id | null;
  label: string;
  cites: C[];
}

/** One dated step of a violation's story, with the orgs it touches and any org that moved under another. */
export interface ViolationStep<C extends Cite = Cite> {
  id: Id;
  date: PartialDate;
  /** One line, at most 80 characters. */
  label: string;
  /** Org ids to highlight in the structure picture at this step. */
  entities: Id[];
  /** An arrow from the org that moved (`from`) to the org it was put under (`to`). */
  moves: { from: Id; to: Id; label: string }[];
  cites: C[];
  /** Why the step matters, in one line of at most 120 characters. Left out when absent, so older steps keep their bytes. */
  note?: string;
}

export const FIGURE_UNITS = ['usd', 'count'] as const;

/** A figure in the record a violation turns on: an amount or a count, optionally against a limit. */
export interface ViolationFigure<C extends Cite = Cite> {
  id: Id;
  label: string;
  /** Whole cents when `unit` is usd, like MoneyFact.amountCents; a whole count otherwise. */
  value: number;
  unit: (typeof FIGURE_UNITS)[number];
  /** A limit in the same unit (for example a credit limit), drawn as a rule, never added to the value. */
  limit: number | null;
  note: string | null;
  cites: C[];
  /**
   * The group a view sets the figure in, at most 40 characters ("Before suit", "After suit"). Figures in one group
   * sit together; a group is never a sum. Left out when absent, so older figures keep their bytes.
   */
  group?: string;
}

/**
 * One side of a violation's contrast: what a party said, when, and where the record has it (what a letter said to
 * Doe against what a later filing says). The quote is verbatim from the cited page.
 */
export interface ContrastSide<C extends Cite = Cite> {
  /** At most 40 characters, for example "Letter to Doe" or "Filed". */
  heading: string;
  /** When it was said or filed: a record fact, never after the build. */
  date: PartialDate;
  /** The party (person or org id) who said or filed it; null when the record does not name one. */
  speaker: Id | null;
  /** Verbatim, at most 300 characters. */
  quote: string;
  /** At least one. */
  cites: C[];
}

/** One violation the tracks rest on, marked with one capital letter ("A", "B", "C"). */
export interface MatterViolation<C extends Cite = Cite> {
  id: Id;
  /** One capital letter, unique across violations. Views show it beside color, never color alone. */
  mark: string;
  /** A headline, at most 90 characters. */
  title: string;
  /** One sentence, at most 200 characters. */
  summary: string;
  period: { from: PartialDate; to: PartialDate | null };
  /** Person or org ids who acted. */
  actors: Id[];
  /** Org ids to highlight in the structure picture. */
  entities: Id[];
  /** Event ids this violation covers; views derive event to violation from this list. */
  events: Id[];
  /** Money ids this violation covers. */
  money: Id[];
  steps: ViolationStep<C>[];
  figures: ViolationFigure<C>[];
  cites: C[];
  /**
   * The two statements the violation turns on, side by side (what a letter said against what was filed).
   * Left out when absent, so older violations keep their bytes.
   */
  contrast?: [ContrastSide<C>, ContrastSide<C>];
}

/** A factual point a track must prove, with its proof. The authority is optional and left to counsel. */
export interface TrackPoint<C extends Cite = Cite> {
  id: Id;
  /** The violation this point proves; one of its track's violations. */
  violation: Id;
  /** At most 200 characters. */
  text: string;
  authority: string | null;
  proof: ProofItem<C>[];
}

/** Where a track is headed: a current complaint in court, or a filing with a regulator. */
export const TRACK_KINDS = ['complaint', 'regulator'] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];

/** One party in a track's cast: who they are in plain words, and the org they act through, if any. */
export interface CastEntry {
  /** A person or org id. */
  id: Id;
  /**
   * A plain role, at most 80 characters, opening with the pleaded role when there is one ("Defendant; manager
   * of Harbor Labs", "Relief defendant", "Not a defendant"): the brief groups its cast by that opening.
   * Never a raw link label.
   */
  role: string;
  /** The org id the party acts through ("through Harbor Labs"), or null. */
  via: Id | null;
}

/** A threshold issue counsel must get past (an arbitration clause, a notice requirement), with where the record has it. */
export interface Hurdle<C extends Cite = Cite> {
  id: Id;
  /** At most 80 characters. */
  title: string;
  /** At most 200 characters. */
  text: string;
  /** At least one. */
  cites: C[];
}

/** A dated record fact counsel should confirm, in one line. */
export interface DatedItem<C extends Cite = Cite> {
  /** A record fact, never after the build. */
  date: PartialDate;
  /** At most 120 characters. */
  text: string;
  /** At least one. */
  cites: C[];
}

/** A key exhibit: one cite to the page, and what it proves in one line. */
export interface KeyExhibit<C extends Cite = Cite> {
  cite: C;
  /** At most 120 characters. */
  proves: string;
}

/**
 * A draft counsel can download (a complaint, a demand letter, a memo): a document in the room, by documents.id.
 * As served it also carries the document's control number.
 */
export type DraftLink<C extends Cite = Cite> = {
  /** At most 80 characters. */
  label: string;
  /** documents.id; served only while the document is live. */
  doc: string;
} & (C extends ServedCite ? { control: number | null } : unknown);

/** A track's one-scroll brief: the theory in one line, the cast, the hurdles, dates to confirm, key exhibits and drafts. */
export interface TrackBrief<C extends Cite = Cite> {
  /** The theory of the track in one line, at most 200 characters. */
  line: string;
  cast: CastEntry[];
  hurdles: Hurdle<C>[];
  dates: DatedItem<C>[];
  exhibits: KeyExhibit<C>[];
  drafts: DraftLink<C>[];
}

/** Whether a count is brought for the client directly or on behalf of the company (derivatively). */
export const COUNT_KINDS = ['direct', 'derivative'] as const;
export type CountKind = (typeof COUNT_KINDS)[number];

/** One element of a count, met by the track's points that prove it. */
export interface CountElement {
  id: Id;
  /** At most 120 characters. */
  text: string;
  /** TrackPoint ids of the same track. A view takes the element's proof from the strongest proof among them. */
  points: Id[];
}

/** A count the track would plead: who it is against, its legal basis, and its elements tied to the points. */
export interface TrackCount {
  id: Id;
  /** At most 90 characters. */
  title: string;
  /** Person or org ids. */
  against: Id[];
  /** The legal basis in one line, at most 120 characters ("C.R.S. 7-80-404"). */
  basis: string;
  kind: CountKind;
  elements: CountElement[];
}

/** A deliverable counsel is preparing: a forum, the parties it names, the violations it rests on, and the points to prove. */
export interface MatterTrack<C extends Cite = Cite> {
  id: Id;
  kind: TrackKind;
  title: string;
  forum: string;
  /** Person or org ids, as the record names them; counsel decides the respondents. */
  against: Id[];
  violations: Id[];
  points: TrackPoint<C>[];
  /** The track's brief. Left out when absent, so older tracks keep their bytes. */
  brief?: TrackBrief<C>;
  /** The counts the track would plead. Left out when absent, so older tracks keep their bytes. */
  counts?: TrackCount[];
}

/** Facts about one document, keyed by documents.id in Matter.docs. */
export interface DocFacts {
  date: PartialDate | null;
  /** The filename convention's DocType or a plain type, for example "Supply agreement", "Email". */
  type: string | null;
  from: Id[];
  to: Id[];
  summary: string | null;
  privileged: boolean;
}

/**
 * The whole manifest. As stored in R2 it is `Matter` (plain cites). GET /api/matter serves `ServedMatter`: only
 * live documents, with each document's control number joined at read time.
 */
export interface Matter<C extends Cite = Cite, D extends DocFacts = DocFacts> {
  version: typeof MATTER_VERSION;
  meta: MatterMeta<C>;
  /** The deliverables, complaint first. Absent in an older manifest, which parses as []. */
  tracks: MatterTrack<C>[];
  /** Absent in an older manifest, which parses as []. */
  violations: MatterViolation<C>[];
  events: MatterEvent<C>[];
  people: MatterPerson<C>[];
  orgs: MatterOrg<C>[];
  links: MatterLink<C>[];
  /** The counts of the operative pleading (for a closed one, the prior case). */
  claims: MatterClaim<C>[];
  money: MoneyFact<C>[];
  docs: Record<string, D>;
}

/** A cite as GET /api/matter serves it. `control` is documents.control_seq, or null before it is assigned. */
export interface ServedCite extends Cite {
  control: number | null;
}

/** Document facts as served, with the document's control number. */
export interface ServedDocFacts extends DocFacts {
  control: number | null;
}

/** What GET /api/matter returns. Format `control` on the client as <prefix>-000412. */
export type ServedMatter = Matter<ServedCite, ServedDocFacts>;

/**
 * A fragment written by one drafting card to <cacheDir>/matter/fragments/<card>.json. Cites there name files by
 * their path under the mirrored folder; `matter build` resolves paths to documents.id.
 */
export interface FragmentCite {
  path: string;
  page: number | null;
  /** As Cite.note. */
  note?: string;
}

/**
 * A drafting card's fragment: { "card": "M1", plus any of meta, tracks, violations, events, people, orgs, links,
 * claims, money, docs }
 * using the shapes above, except that every Cite is written as a FragmentCite, `docs` is keyed by path, and a
 * brief's DraftLink names its file as `{ label, path }` instead of `{ label, doc }`.
 */
export interface MatterFragment {
  card: string;
  meta?: Partial<Omit<MatterMeta, 'builtAt'>>;
  tracks?: unknown[];
  violations?: unknown[];
  events?: unknown[];
  people?: unknown[];
  orgs?: unknown[];
  links?: unknown[];
  claims?: unknown[];
  money?: unknown[];
  docs?: Record<string, unknown>;
}
