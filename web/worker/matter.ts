// SPDX-License-Identifier: Apache-2.0
// Validates the matter manifest (worker/matter-types.ts) before the room serves it, and before `npm run matter`
// (card F4) publishes it. Strict, like parseManifest in worker/visuals.ts: unknown fields are dropped and anything
// malformed throws MatterError naming the field, never the value. The exclusions the owner set are enforced here:
// no deadline events, nothing dated after the build, and no money taken only from work product or analysis.
// The document facts and the parties they name are parsed by the core's worker/doc-facts.ts, which this file calls
// in the same place and order, so the core reads them the same way without the litigation pack.
import { FACT_LEN, FACT_MAX, manifestRoot, parseBuiltAt, parseDocs, parseParties } from './doc-facts.ts';
import * as f from './matter-fields.ts';
import { MatterError, optionalPastDate, pastDate, refs, uniqueIds } from './matter-fields.ts';
import {
  CLAIM_TYPES, COUNT_KINDS, EVENT_TYPES, FIGURE_UNITS, MATTER_VERSION, MONEY_KINDS, PROOF_STRENGTHS,
  STATEMENT_BASES, TRACK_KINDS, type CastEntry, type ClaimElement, type DatedItem, type DefinedTerm, type DocFacts, type DraftLink,
  type Hurdle, type KeyExhibit, type Matter, type MatterClaim, type MatterEvent, type TrackBrief, type TrackCount,
  type ContrastSide, type LinkStatement, type MatterLink, type MatterMeta, type MatterTrack, type MatterViolation,
  type MoneyFact, type PriorCase, type ProofItem, type TrackPoint, type ViolationFigure, type ViolationStep,
} from './matter-types.ts';
import { extraClaimTypes } from './room-settings.ts';
import type { ClaimType } from './matter-types.ts';

export { MatterError } from './matter-fields.ts';

// The orgs, people and docs limits, cites and the name, type and summary lengths are the document facts' (doc-facts.ts).
const MAX = {
  ...FACT_MAX,
  terms: 200, events: 5000, links: 5000, claims: 50, elements: 40, proof: 200,
  money: 5000, count: 999, statements: 20,
  tracks: 20, violations: 26, steps: 40, moves: 20, figures: 20, points: 60,
  // A track's brief and counts: one screen each.
  cast: 40, hurdles: 12, dates: 20, exhibits: 20, drafts: 10, counts: 20, countElements: 20,
} as const;
const LEN = {
  ...FACT_LEN,
  title: 300, term: 120, means: 400, authority: 400, note: 400,
  // Tracks and violations are read at a glance: short headlines, one-sentence summaries, one-line steps.
  headline: 90, sentence: 200, line: 80,
  // A contrast side: a short heading and a verbatim quote.
  sideHeading: 40, quote: 300,
  // Brief and count lines, step notes and figure groups: one short line each.
  short: 120, group: 40,
} as const;
/** A violation's mark: one capital letter. */
const MARK = /^[A-Z]$/;

/** DocFacts.type words that mark work product or analysis rather than a record of what happened. */
const WORK_PRODUCT = /\b(?:work product|wp|analys[ie]s|analytics?|analytical|models?|modell?ing|valuations?|projections?|forecasts?)\b/i;

/** True when a document type names work product, analysis, a model or a valuation ("Claim_Chart__WP" counts). */
export function isWorkProductType(type: string | null): boolean {
  return type !== null && WORK_PRODUCT.test(type.replace(/[_.\-]+/g, ' '));
}

export interface ParseOptions {
  /** The Worker's clock: a build stamped later than this (beyond small skew) is refused. */
  now: Date;
}

/** Ids already declared, so references can be checked. */
interface Known {
  parties: Set<string>;
  orgs: Set<string>;
  claims: Set<string>;
}

/** What violations may name: parties, orgs, events and money. */
interface KnownRecord {
  parties: Set<string>;
  orgs: Set<string>;
  events: Set<string>;
  money: Set<string>;
}

function optionalRef(value: unknown, where: string, known: Set<string>): string | null {
  const ref = f.optionalId(value, where);
  if (ref !== null && !known.has(ref)) throw new MatterError(`${where} names an unknown id`);
  return ref;
}

function parseTerm(raw: unknown, i: number): DefinedTerm {
  const r = f.record(raw, `meta.definedTerms[${i}]`);
  const term = { term: f.text(r.term, `meta.definedTerms[${i}].term`, LEN.term), means: f.text(r.means, `meta.definedTerms[${i}].means`, LEN.means) };
  return r.cite === undefined || r.cite === null ? term : { ...term, cite: f.cite(r.cite, `meta.definedTerms[${i}].cite`) };
}

/** Caption, court, number, division, judge, filing date and pleading: the fields a case header and a prior case share. */
function parseCase(r: Record<string, unknown>, where: string, buildDay: string): PriorCase {
  const pleading = r.operativePleading === undefined || r.operativePleading === null ? null : f.record(r.operativePleading, `${where}.operativePleading`);
  return {
    caption: f.text(r.caption, `${where}.caption`, LEN.title),
    court: f.text(r.court, `${where}.court`, LEN.title),
    caseNumber: f.optionalText(r.caseNumber, `${where}.caseNumber`, LEN.name),
    division: f.optionalText(r.division, `${where}.division`, LEN.name),
    judge: f.optionalText(r.judge, `${where}.judge`, LEN.name),
    filed: r.filed === undefined || r.filed === null ? null : pastDate(r.filed, `${where}.filed`, buildDay),
    operativePleading: pleading && {
      title: f.text(pleading.title, `${where}.operativePleading.title`, LEN.title),
      cite: f.cite(pleading.cite, `${where}.operativePleading.cite`),
    },
  };
}

function parseMeta(raw: unknown, now: Date): MatterMeta {
  const r = f.record(raw, 'meta');
  const builtAt = parseBuiltAt(r, now);
  const buildDay = builtAt.slice(0, 10);
  const definedTerms = f.list(r.definedTerms ?? [], 'meta.definedTerms', MAX.terms).map(parseTerm);
  const termSet = new Set(definedTerms.map((t) => t.term.toLowerCase()));
  if (termSet.size !== definedTerms.length) throw new MatterError('meta.definedTerms repeats a term');
  // Left out when absent, so a manifest from before prior cases keeps its bytes.
  const prior = r.priorCase === undefined || r.priorCase === null
    ? {}
    : { priorCase: parseCase(f.record(r.priorCase, 'meta.priorCase'), 'meta.priorCase', buildDay) };
  return { ...parseCase(r, 'meta', buildDay), ...prior, definedTerms, builtAt };
}

/** `{ [key]: value }`, or nothing when the value is null, so an absent optional field keeps the old bytes. */
function optionalField<K extends string, V>(key: K, value: V | null): { [P in K]?: V } {
  return (value === null ? {} : { [key]: value }) as { [P in K]?: V };
}

function parseProof(raw: unknown, where: string): ProofItem {
  const r = f.record(raw, where);
  return {
    cite: f.cite(r.cite, `${where}.cite`),
    strength: f.oneOf(r.strength, PROOF_STRENGTHS, `${where}.strength`),
    note: f.optionalText(r.note, `${where}.note`, LEN.note),
  };
}

function parseElement(raw: unknown, where: string): ClaimElement {
  const r = f.record(raw, where);
  return {
    id: f.id(r.id, `${where}.id`),
    text: f.text(r.text, `${where}.text`, LEN.summary),
    authority: f.text(r.authority, `${where}.authority`, LEN.authority),
    proof: f.list(r.proof ?? [], `${where}.proof`, MAX.proof).map((p, j) => parseProof(p, `${where}.proof[${j}]`)),
  };
}

function parseClaim(raw: unknown, i: number, parties: Set<string>): MatterClaim {
  const where = `claims[${i}]`;
  const r = f.record(raw, where);
  return {
    id: f.id(r.id, `${where}.id`),
    count: f.positiveInt(r.count, `${where}.count`, MAX.count),
    type: f.oneOf(r.type, [...CLAIM_TYPES, ...extraClaimTypes], `${where}.type`) as ClaimType,
    label: f.text(r.label, `${where}.label`, LEN.title),
    against: refs(r.against, `${where}.against`, parties),
    elements: f.list(r.elements, `${where}.elements`, MAX.elements).map((e, j) => parseElement(e, `${where}.elements[${j}]`)),
    cites: f.cites(r.cites, `${where}.cites`, MAX.cites),
  };
}

function parseEvent(raw: unknown, i: number, known: Known, buildDay: string): MatterEvent {
  const where = `events[${i}]`;
  const r = f.record(raw, where);
  if (r.type === 'deadline') throw new MatterError(`${where}.type is deadline; the room shows record facts, not deadlines`);
  return {
    id: f.id(r.id, `${where}.id`),
    date: pastDate(r.date, `${where}.date`, buildDay),
    title: f.text(r.title, `${where}.title`, LEN.title),
    summary: f.optionalText(r.summary, `${where}.summary`, LEN.summary),
    type: f.oneOf(r.type, EVENT_TYPES, `${where}.type`),
    actors: refs(r.actors, `${where}.actors`, known.parties),
    claims: refs(r.claims, `${where}.claims`, known.claims),
    cites: f.cites(r.cites, `${where}.cites`, MAX.cites),
  };
}

/** A share in percent, exact ({min: 65, max: 65}) or a range ({min: 55, max: 70}); null when not stated. */
function parseShare(raw: unknown, where: string): LinkStatement['share'] {
  if (raw === undefined || raw === null) return null;
  const r = f.record(raw, where);
  const pct = (value: unknown, at: string) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) throw new MatterError(`${at} must be a percent from 0 to 100`);
    return value;
  };
  const min = pct(r.min, `${where}.min`);
  const max = pct(r.max ?? r.min, `${where}.max`);
  if (max < min) throw new MatterError(`${where}.max is below ${where}.min`);
  return { min, max };
}

function parseStatement(raw: unknown, where: string, buildDay: string): LinkStatement {
  const r = f.record(raw, where);
  const since = optionalPastDate(r.since, `${where}.since`, buildDay);
  const until = optionalPastDate(r.until, `${where}.until`, buildDay);
  if (since !== null && until !== null && f.earliestDay(until) < f.earliestDay(since)) throw new MatterError(`${where}.until is before ${where}.since`);
  return {
    held: f.bool(r.held ?? true, `${where}.held`),
    since,
    until,
    asOf: pastDate(r.asOf, `${where}.asOf`, buildDay),
    basis: f.oneOf(r.basis, STATEMENT_BASES, `${where}.basis`),
    share: parseShare(r.share, `${where}.share`),
    direct: r.direct === undefined || r.direct === null ? null : f.bool(r.direct, `${where}.direct`),
    note: f.optionalText(r.note, `${where}.note`, LEN.note),
    cites: f.cites(r.cites, `${where}.cites`, MAX.cites),
  };
}

function parseLink(raw: unknown, i: number, parties: Set<string>, buildDay: string): MatterLink {
  const where = `links[${i}]`;
  const r = f.record(raw, where);
  const from = optionalRef(r.from, `${where}.from`, parties);
  const to = optionalRef(r.to, `${where}.to`, parties);
  if (from === null || to === null) throw new MatterError(`${where} must name both ends`);
  if (from === to) throw new MatterError(`${where} links an id to itself`);
  const statements = f.list(r.statements ?? [], `${where}.statements`, MAX.statements)
    .map((s, k) => parseStatement(s, `${where}.statements[${k}]`, buildDay));
  return {
    from, to, label: f.text(r.label, `${where}.label`, LEN.name), cites: f.cites(r.cites, `${where}.cites`, MAX.cites),
    // Left out when there are none, so a manifest from before statements keeps its bytes.
    ...(statements.length ? { statements } : {}),
  };
}

function parseMoney(raw: unknown, i: number, parties: Set<string>, buildDay: string, docs: Record<string, DocFacts>): MoneyFact {
  const where = `money[${i}]`;
  const r = f.record(raw, where);
  const cites = f.cites(r.cites, `${where}.cites`, MAX.cites);
  if (cites.every((c) => isWorkProductType(docs[c.doc]?.type ?? null))) {
    throw new MatterError(`${where} cites only work product or analysis; money must come from the record`);
  }
  const kind = r.kind === undefined || r.kind === null ? undefined : f.oneOf(r.kind, MONEY_KINDS, `${where}.kind`);
  return {
    id: f.id(r.id, `${where}.id`),
    date: pastDate(r.date, `${where}.date`, buildDay),
    amountCents: f.cents(r.amountCents, `${where}.amountCents`),
    ...(kind ? { kind } : {}),
    from: optionalRef(r.from, `${where}.from`, parties),
    to: optionalRef(r.to, `${where}.to`, parties),
    label: f.text(r.label, `${where}.label`, LEN.title),
    cites,
  };
}

function parseStep(raw: unknown, where: string, known: KnownRecord, buildDay: string): ViolationStep {
  const r = f.record(raw, where);
  const moves = f.list(r.moves ?? [], `${where}.moves`, MAX.moves).map((m, k) => {
    const at = `${where}.moves[${k}]`;
    const move = f.record(m, at);
    const from = optionalRef(move.from, `${at}.from`, known.orgs);
    const to = optionalRef(move.to, `${at}.to`, known.orgs);
    if (from === null || to === null) throw new MatterError(`${at} must name both orgs`);
    if (from === to) throw new MatterError(`${at} moves an org under itself`);
    return { from, to, label: f.text(move.label, `${at}.label`, LEN.line) };
  });
  return {
    id: f.id(r.id, `${where}.id`),
    date: pastDate(r.date, `${where}.date`, buildDay),
    label: f.text(r.label, `${where}.label`, LEN.line),
    entities: refs(r.entities, `${where}.entities`, known.orgs),
    moves,
    cites: f.cites(r.cites, `${where}.cites`, MAX.cites),
    // Left out when absent, so a manifest from before step notes keeps its bytes.
    ...optionalField('note', f.optionalText(r.note, `${where}.note`, LEN.short)),
  };
}

/** A figure's value or limit in its unit: whole cents for usd, a whole count otherwise. */
function amount(value: unknown, where: string, unit: ViolationFigure['unit']): number {
  if (unit === 'usd') return f.cents(value, where);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new MatterError(`${where} must be a whole count, zero or more`);
  return value;
}

function parseFigure(raw: unknown, where: string): ViolationFigure {
  const r = f.record(raw, where);
  const unit = f.oneOf(r.unit, FIGURE_UNITS, `${where}.unit`);
  return {
    id: f.id(r.id, `${where}.id`),
    label: f.text(r.label, `${where}.label`, LEN.line),
    value: amount(r.value, `${where}.value`, unit),
    unit,
    limit: r.limit === undefined || r.limit === null ? null : amount(r.limit, `${where}.limit`, unit),
    note: f.optionalText(r.note, `${where}.note`, LEN.sentence),
    cites: f.cites(r.cites, `${where}.cites`, MAX.cites),
    // Left out when absent, so a manifest from before figure groups keeps its bytes.
    ...optionalField('group', f.optionalText(r.group, `${where}.group`, LEN.group)),
  };
}

function parsePeriod(raw: unknown, where: string, buildDay: string): MatterViolation['period'] {
  const r = f.record(raw, where);
  const from = pastDate(r.from, `${where}.from`, buildDay);
  const to = optionalPastDate(r.to, `${where}.to`, buildDay);
  if (to !== null && f.earliestDay(to) < f.earliestDay(from)) throw new MatterError(`${where}.to is before ${where}.from`);
  return { from, to };
}

function parseSide(raw: unknown, where: string, parties: Set<string>, buildDay: string): ContrastSide {
  const r = f.record(raw, where);
  return {
    heading: f.text(r.heading, `${where}.heading`, LEN.sideHeading),
    date: pastDate(r.date, `${where}.date`, buildDay),
    speaker: optionalRef(r.speaker, `${where}.speaker`, parties),
    quote: f.text(r.quote, `${where}.quote`, LEN.quote),
    cites: f.cites(r.cites, `${where}.cites`, MAX.cites),
  };
}

/** The two sides of a violation's contrast, or nothing when the violation has none. */
function parseContrast(raw: unknown, where: string, parties: Set<string>, buildDay: string): Pick<MatterViolation, 'contrast'> {
  if (raw === undefined || raw === null) return {};
  const sides = f.list(raw, where, 2);
  if (sides.length !== 2) throw new MatterError(`${where} must have exactly two sides`);
  return { contrast: [parseSide(sides[0], `${where}[0]`, parties, buildDay), parseSide(sides[1], `${where}[1]`, parties, buildDay)] };
}

function parseViolation(raw: unknown, i: number, known: KnownRecord, buildDay: string): MatterViolation {
  const where = `violations[${i}]`;
  const r = f.record(raw, where);
  if (typeof r.mark !== 'string' || !MARK.test(r.mark)) throw new MatterError(`${where}.mark must be one capital letter`);
  return {
    id: f.id(r.id, `${where}.id`),
    mark: r.mark,
    title: f.text(r.title, `${where}.title`, LEN.headline),
    summary: f.text(r.summary, `${where}.summary`, LEN.sentence),
    period: parsePeriod(r.period, `${where}.period`, buildDay),
    actors: refs(r.actors, `${where}.actors`, known.parties),
    entities: refs(r.entities, `${where}.entities`, known.orgs),
    events: refs(r.events, `${where}.events`, known.events),
    money: refs(r.money, `${where}.money`, known.money),
    steps: f.list(r.steps ?? [], `${where}.steps`, MAX.steps).map((s, j) => parseStep(s, `${where}.steps[${j}]`, known, buildDay)),
    figures: f.list(r.figures ?? [], `${where}.figures`, MAX.figures).map((x, j) => parseFigure(x, `${where}.figures[${j}]`)),
    cites: f.cites(r.cites, `${where}.cites`, MAX.cites),
    // Left out when absent, so a manifest from before contrasts keeps its bytes.
    ...parseContrast(r.contrast, `${where}.contrast`, known.parties, buildDay),
  };
}

/** Violation ids, with unique marks and step and figure ids unique across all violations. */
function checkViolations(violations: MatterViolation[]): Set<string> {
  const marks = new Set<string>();
  const steps = new Set<string>();
  const figures = new Set<string>();
  violations.forEach((v, i) => {
    if (marks.has(v.mark)) throw new MatterError(`violations[${i}].mark repeats an earlier mark`);
    marks.add(v.mark);
    uniqueIds(v.steps, `violations[${i}].steps`, steps);
    uniqueIds(v.figures, `violations[${i}].figures`, figures);
  });
  return uniqueIds(violations, 'violations');
}

function parsePoint(raw: unknown, where: string, violations: ReadonlySet<string>): TrackPoint {
  const r = f.record(raw, where);
  const violation = f.id(r.violation, `${where}.violation`);
  if (!violations.has(violation)) throw new MatterError(`${where}.violation must name one of its track's violations`);
  return {
    id: f.id(r.id, `${where}.id`),
    violation,
    text: f.text(r.text, `${where}.text`, LEN.sentence),
    authority: f.optionalText(r.authority, `${where}.authority`, LEN.authority),
    proof: f.list(r.proof ?? [], `${where}.proof`, MAX.proof).map((p, j) => parseProof(p, `${where}.proof[${j}]`)),
  };
}

function parseCast(raw: unknown, where: string, parties: Set<string>, orgs: Set<string>): CastEntry {
  const r = f.record(raw, where);
  const id = optionalRef(r.id, `${where}.id`, parties);
  if (id === null) throw new MatterError(`${where}.id must name a person or org`);
  return { id, role: f.text(r.role, `${where}.role`, LEN.line), via: optionalRef(r.via, `${where}.via`, orgs) };
}

function parseHurdle(raw: unknown, where: string): Hurdle {
  const r = f.record(raw, where);
  return {
    id: f.id(r.id, `${where}.id`),
    title: f.text(r.title, `${where}.title`, LEN.line),
    text: f.text(r.text, `${where}.text`, LEN.sentence),
    cites: f.cites(r.cites, `${where}.cites`, MAX.cites),
  };
}

function parseDated(raw: unknown, where: string, buildDay: string): DatedItem {
  const r = f.record(raw, where);
  return {
    date: pastDate(r.date, `${where}.date`, buildDay),
    text: f.text(r.text, `${where}.text`, LEN.short),
    cites: f.cites(r.cites, `${where}.cites`, MAX.cites),
  };
}

function parseExhibit(raw: unknown, where: string): KeyExhibit {
  const r = f.record(raw, where);
  return { cite: f.cite(r.cite, `${where}.cite`), proves: f.text(r.proves, `${where}.proves`, LEN.short) };
}

function parseDraft(raw: unknown, where: string): DraftLink {
  const r = f.record(raw, where);
  return { label: f.text(r.label, `${where}.label`, LEN.line), doc: f.docId(r.doc, `${where}.doc`) };
}

/** A list of entries, each parsed at "<where>[i]". A missing list reads as none. */
function entries<T>(raw: unknown, where: string, max: number, parse: (entry: unknown, at: string) => T): T[] {
  return f.list(raw ?? [], where, max).map((entry, i) => parse(entry, `${where}[${i}]`));
}

/** A track's brief, or nothing when the track has none. */
function parseBrief(raw: unknown, where: string, known: KnownRecord, buildDay: string): Pick<MatterTrack, 'brief'> {
  if (raw === undefined || raw === null) return {};
  const r = f.record(raw, where);
  const brief: TrackBrief = {
    line: f.text(r.line, `${where}.line`, LEN.sentence),
    cast: entries(r.cast, `${where}.cast`, MAX.cast, (c, at) => parseCast(c, at, known.parties, known.orgs)),
    hurdles: entries(r.hurdles, `${where}.hurdles`, MAX.hurdles, parseHurdle),
    dates: entries(r.dates, `${where}.dates`, MAX.dates, (d, at) => parseDated(d, at, buildDay)),
    exhibits: entries(r.exhibits, `${where}.exhibits`, MAX.exhibits, parseExhibit),
    drafts: entries(r.drafts, `${where}.drafts`, MAX.drafts, parseDraft),
  };
  if (new Set(brief.cast.map((c) => c.id)).size !== brief.cast.length) throw new MatterError(`${where}.cast names a party twice`);
  uniqueIds(brief.hurdles, `${where}.hurdles`);
  if (new Set(brief.drafts.map((d) => d.doc)).size !== brief.drafts.length) throw new MatterError(`${where}.drafts names a document twice`);
  return { brief };
}

function parseCount(raw: unknown, where: string, parties: Set<string>, points: ReadonlySet<string>): TrackCount {
  const r = f.record(raw, where);
  const elements = entries(r.elements, `${where}.elements`, MAX.countElements, (e, at) => {
    const el = f.record(e, at);
    const ids = f.ids(el.points, `${at}.points`, MAX.points);
    ids.forEach((id, k) => {
      if (!points.has(id)) throw new MatterError(`${at}.points[${k}] must name a point of its own track`);
    });
    return { id: f.id(el.id, `${at}.id`), text: f.text(el.text, `${at}.text`, LEN.short), points: ids };
  });
  return {
    id: f.id(r.id, `${where}.id`),
    title: f.text(r.title, `${where}.title`, LEN.headline),
    against: refs(r.against, `${where}.against`, parties),
    basis: f.text(r.basis, `${where}.basis`, LEN.short),
    kind: f.oneOf(r.kind, COUNT_KINDS, `${where}.kind`),
    elements,
  };
}

/** A track's counts, or nothing when the track has none. */
function parseCounts(raw: unknown, where: string, parties: Set<string>, points: ReadonlySet<string>): Pick<MatterTrack, 'counts'> {
  if (raw === undefined || raw === null) return {};
  return { counts: entries(raw, where, MAX.counts, (c, at) => parseCount(c, at, parties, points)) };
}

function parseTrack(raw: unknown, i: number, known: KnownRecord, violations: Set<string>, buildDay: string): MatterTrack {
  const where = `tracks[${i}]`;
  const r = f.record(raw, where);
  const own = refs(r.violations, `${where}.violations`, violations);
  const points = f.list(r.points ?? [], `${where}.points`, MAX.points).map((p, j) => parsePoint(p, `${where}.points[${j}]`, new Set(own)));
  return {
    id: f.id(r.id, `${where}.id`),
    kind: f.oneOf(r.kind, TRACK_KINDS, `${where}.kind`),
    title: f.text(r.title, `${where}.title`, LEN.headline),
    forum: f.text(r.forum, `${where}.forum`, LEN.name),
    against: refs(r.against, `${where}.against`, known.parties),
    violations: own,
    points,
    // Left out when absent, so a manifest from before briefs and counts keeps its bytes.
    ...parseBrief(r.brief, `${where}.brief`, known, buildDay),
    ...parseCounts(r.counts, `${where}.counts`, known.parties, new Set(points.map((p) => p.id))),
  };
}

/** Track ids, with point, count and count element ids unique across all tracks. */
function checkTracks(tracks: MatterTrack[]): void {
  const points = new Set<string>();
  const counts = new Set<string>();
  const elements = new Set<string>();
  tracks.forEach((track, i) => {
    uniqueIds(track.points, `tracks[${i}].points`, points);
    uniqueIds(track.counts ?? [], `tracks[${i}].counts`, counts);
    (track.counts ?? []).forEach((count, j) => uniqueIds(count.elements, `tracks[${i}].counts[${j}].elements`, elements));
  });
  uniqueIds(tracks, 'tracks');
}

function checkClaims(claims: MatterClaim[]): Set<string> {
  const counts = new Set<number>();
  const elementIds = new Set<string>();
  claims.forEach((claim, i) => {
    if (counts.has(claim.count)) throw new MatterError(`claims[${i}].count repeats an earlier count`);
    counts.add(claim.count);
    uniqueIds(claim.elements, `claims[${i}].elements`, elementIds);
  });
  return uniqueIds(claims, 'claims');
}

/** Validates a parsed manifest. Unknown fields are dropped; anything malformed or excluded throws MatterError. */
export function parseMatter(raw: unknown, { now }: ParseOptions): Matter {
  const root = manifestRoot(raw);
  const meta = parseMeta(root.meta, now);
  const buildDay = meta.builtAt.slice(0, 10);

  // The document facts' parties, as the core reads them (doc-facts.ts).
  const { orgs, people, orgIds, parties } = parseParties(root, buildDay);

  const claims = f.list(root.claims ?? [], 'claims', MAX.claims).map((c, i) => parseClaim(c, i, parties));
  const known: Known = { parties, orgs: orgIds, claims: checkClaims(claims) };
  const events = f.list(root.events ?? [], 'events', MAX.events).map((e, i) => parseEvent(e, i, known, buildDay));
  const eventIds = uniqueIds(events, 'events');
  const links = f.list(root.links ?? [], 'links', MAX.links).map((l, i) => parseLink(l, i, parties, buildDay));
  const docs = parseDocs(root.docs, parties);
  const money = f.list(root.money ?? [], 'money', MAX.money).map((m, i) => parseMoney(m, i, parties, buildDay, docs));
  const moneyIds = uniqueIds(money, 'money');

  // Tracks and violations came after version 1 shipped: a manifest without them reads as having none.
  const record: KnownRecord = { parties, orgs: orgIds, events: eventIds, money: moneyIds };
  const violations = f.list(root.violations ?? [], 'violations', MAX.violations).map((v, i) => parseViolation(v, i, record, buildDay));
  const violationIds = checkViolations(violations);
  const tracks = f.list(root.tracks ?? [], 'tracks', MAX.tracks).map((t, i) => parseTrack(t, i, record, violationIds, buildDay));
  checkTracks(tracks);

  return { version: MATTER_VERSION, meta, tracks, violations, events, people, orgs, links, claims, money, docs };
}
