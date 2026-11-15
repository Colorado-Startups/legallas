// SPDX-License-Identifier: Apache-2.0
// Sources to units: downloads (through RawCache) and parses each source a law pack names (pack.ts). Pure apart from the cache.
import { caseIdFor, unitIdFor } from '../../worker/law-cite.ts';
import { commonName } from './common-name.ts';
import { readDocx } from './docx.ts';
import type { RawCache } from './fetch.ts';
import { excerptLines } from './chunk.ts';
import { capOpinions, capParties, crsArticle, ecfrSection, uscodePage } from './parse.ts';
import type { CaseSource } from './case-source.ts';
import { courtListenerCites, courtListenerOpinions, courtListenerParties } from './courtlistener.ts';
import type { LawPack, LawPackSources } from './pack.ts';
import { sha256 } from './plan.ts';
import { pdfItems } from './pdf.ts';
import { slipOpinion } from './slip.ts';
import {
  CRS_EDITIONS,
  crsDocxUrl,
  crsPdfUrl,
  ECFR_TITLES_URL,
  ecfrReadUrl,
  ecfrXmlUrl,
  uscUrl,
  type CrsCommonName,
  type CrsSource,
} from './sources.ts';
import type { LawUnit } from './types.ts';

export { commonName };

// Words that name no party in particular: entity suffixes, connectors, the state.
const GENERIC_WORDS = new Set(['inc', 'corp', 'corporation', 'company', 'llc', 'ltd', 'llp', 'professional', 'the', 'and', 'ex', 'rel', 'colorado', 'people', 'state', 'association', 'ass']);

/**
 * True when a CAP head matter names both sides of the case: each side of "A v. B" has a distinctive word (three
 * letters or more) in the parties line. A reporter page can start two opinions, so a file number can be wrong.
 */
export function partiesMatch(name: string, parties: string): boolean {
  const text = parties.toLowerCase();
  return name.split(/\s+v\.\s+/).every((side) => {
    const words = (side.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((word) => !GENERIC_WORDS.has(word));
    return words.some((word) => new RegExp(`\\b${word}\\b`).test(text));
  });
}

/**
 * The names practitioners use for some C.R.S. sections ("statute of limitations", "Uniform Declaratory Judgments Law"),
 * added to the heading like commonName, since the official headings ("General limitation of actions - two years") never
 * use them. These are the general ones; a room's packs add their own (sources.crsCommonNames), which come first.
 */
export function crsCommonName(section: string, packNames: readonly CrsCommonName[] = []): string | null {
  const fromPack = packNames.find((entry) => entry.section.test(section));
  if (fromPack) return fromPack.name;
  if (/^13-80-\d/.test(section)) return 'statute of limitations';
  if (/^13-22-3\d\d$/.test(section)) return 'Colorado Dispute Resolution Act';
  if (/^13-51-\d/.test(section)) return 'Uniform Declaratory Judgments Law';
  return null;
}

function withCommonName(heading: string, cite: string, packNames: readonly CrsCommonName[] = []): string {
  const name = commonName(cite) ?? crsCommonName(/^C\.R\.S\. § (.+)$/.exec(cite)?.[1] ?? '', packNames);
  return name ? `${heading} (${name})` : heading;
}

/** A source's units, or an error when it yielded none: a site layout change must not ship an empty part. */
export function nonEmpty<T>(units: T[], what: string): T[] {
  if (units.length === 0) throw new Error(`${what} yielded no units; check the source's layout`);
  return units;
}

/** Options for a law library build: whether to refresh, and whether to log a line per source. */
export interface BuildOptions {
  refresh?: boolean;
  /** Log a line per source (counts and names only). */
  log?: (line: string) => void;
  /** The room's law packs (pack.ts loadLawPacks), built after the core statutes and rules, before the opinions. */
  packs?: readonly LawPack[];
  /** Only these units of a pack that names its units (the default pack), to prove a small fetch. Never for an upload. */
  only?: ReadonlySet<string>;
}

/** One kind of source across a room's packs, in the order packs.json lists them. */
function fromPacks<K extends 'crs' | 'crsCommonNames' | 'ecfr' | 'usc' | 'cases'>(options: BuildOptions, kind: K): NonNullable<LawPackSources[K]>[number][] {
  return (options.packs ?? []).flatMap((pack) => [...(pack.sources?.[kind] ?? [])]);
}

/** One C.R.S. article: the newest edition OLLS serves, one unit per section (repealed sections left out). */
export async function buildCrs(cache: RawCache, source: CrsSource, options: BuildOptions = {}): Promise<LawUnit[]> {
  const packNames = fromPacks(options, 'crsCommonNames');
  for (const edition of CRS_EDITIONS) {
    const fetched = await cache.get(crsDocxUrl(edition, source.title), { refresh: options.refresh });
    if (!fetched) continue;
    const sections = crsArticle(readDocx(fetched.body), source.article);
    for (const wanted of source.sections ?? []) {
      if (!sections.some((s) => s.number === wanted)) throw new Error(`C.R.S. § ${wanted} is not in the title download; check its layout`);
    }
    const units: LawUnit[] = [];
    for (const section of sections) {
      if (source.sections && !source.sections.includes(section.number)) continue;
      if (section.heading === 'Repealed' || section.lines.length === 0) continue;
      const cite = `C.R.S. § ${section.number}`;
      units.push({
        id: unitIdFor(cite)!, // safe: section numbers match CRS_SECTION, which unitIdFor reads
        cite,
        title: withCommonName(section.heading, cite, packNames),
        url: crsPdfUrl(edition, source.title),
        retrieved: fetched.retrieved,
        track: source.regulatorOnly?.test(section.number) ? 'regulator' : source.track,
        kind: 'statute',
        source: `Colorado Office of Legislative Legal Services, C.R.S. ${edition} (uncertified printout)`,
        scheme: 'crs',
        lines: section.lines,
      });
    }
    options.log?.(`C.R.S. title ${source.title} article ${source.article}: ${units.length} sections (edition ${edition})`);
    return nonEmpty(units, `C.R.S. title ${source.title} article ${source.article}`);
  }
  throw new Error(`no C.R.S. edition of title ${source.title} could be downloaded`);
}

/** The eCFR sections, read at each title's latest issue date. */
export async function buildEcfr(cache: RawCache, options: BuildOptions = {}): Promise<LawUnit[]> {
  const sources = fromPacks(options, 'ecfr');
  if (sources.length === 0) return [];
  const titles = await cache.get(ECFR_TITLES_URL, { refresh: options.refresh });
  if (!titles) throw new Error('eCFR titles list unavailable');
  const list = JSON.parse(titles.body.toString('utf8')) as { titles: { number: number; latest_issue_date: string }[] };
  const units: LawUnit[] = [];
  for (const source of sources) {
    const date = list.titles.find((t) => t.number === source.title)?.latest_issue_date;
    if (!date) throw new Error(`eCFR has no issue date for title ${source.title}`);
    const fetched = await cache.get(ecfrXmlUrl(date, source.title, source.section), { refresh: options.refresh });
    if (!fetched) throw new Error(`eCFR section ${source.section} not found`);
    const section = ecfrSection(fetched.body.toString('utf8'));
    nonEmpty(section.lines, `eCFR ${source.section}`);
    const cite = `${source.title} C.F.R. § ${section.number}`;
    units.push({
      id: unitIdFor(cite)!, // safe: eCFR section numbers are part.section
      cite,
      title: withCommonName(section.heading, cite),
      url: ecfrReadUrl(source.title, source.section),
      retrieved: fetched.retrieved,
      track: source.track,
      kind: 'regulation',
      source: `eCFR (Office of the Federal Register), current as of ${date}`,
      scheme: 'cfr',
      lines: section.lines,
    });
  }
  options.log?.(`eCFR: ${units.length} sections`);
  return units;
}

/** The U.S. Code sections from uscode.house.gov, the current Code. */
export async function buildUsc(cache: RawCache, options: BuildOptions = {}): Promise<LawUnit[]> {
  const units: LawUnit[] = [];
  for (const source of fromPacks(options, 'usc')) {
    const fetched = await cache.get(uscUrl(source.title, source.section), { refresh: options.refresh });
    if (!fetched) throw new Error(`uscode.house.gov has no ${source.title} U.S.C. ${source.section}`);
    const { section, through } = uscodePage(fetched.body.toString('utf8'), source.section, `${source.title} U.S.C. ${source.section}`);
    const lines = source.keep ? excerptLines(section.lines, source.keep, 'usc') : section.lines;
    nonEmpty(lines, `${source.title} U.S.C. ${source.section}`);
    const base = `${source.title} U.S.C. § ${source.section}`;
    const pins = (source.keep ?? []).map((k) => k.split('/').map((label) => `(${label})`).join(''));
    // One kept subsection is the unit's own pinpoint; several are named in the title and pinned part by part.
    const cite = pins.length === 1 ? `${base}${pins[0]}` : base;
    const heading = withCommonName(section.heading, base);
    units.push({
      id: unitIdFor(cite)!, // safe: title and section are fixed in sources.ts
      cite,
      title: pins.length > 1 ? `${heading}; excerpt: ${pins.join(', ')}` : heading,
      url: fetched.finalUrl,
      retrieved: fetched.retrieved,
      track: source.track,
      kind: 'statute',
      source: `Office of the Law Revision Counsel (U.S. House of Representatives), United States Code, current through ${through}`,
      scheme: 'usc',
      lines,
      ...(source.keep ? { excerpt: true } : {}),
    });
  }
  options.log?.(`U.S. Code: ${units.length} sections`);
  return units;
}

/**
 * One case as a unit: each writing (the court's opinion, then any concurrence or dissent) kept apart, so a part is
 * one writing and says which (chunk.ts), with star pages and footnotes kept. The court's opinion must come first.
 */
export async function buildCase(cache: RawCache, source: CaseSource, options: BuildOptions = {}): Promise<LawUnit> {
  if (source.slip) return buildSlipCase(cache, source, options);
  if (source.supplied) return buildSuppliedCase(cache, source, options);
  const fetched = await cache.get(source.text, { refresh: options.refresh });
  if (!fetched) throw new Error(`no opinion text for ${source.cite}`);
  const html = fetched.body.toString('utf8');
  if (!partiesMatch(source.name, capParties(html))) throw new Error(`the CAP file for ${source.cite} names other parties than ${source.name}`);
  const opinions = capOpinions(html);
  if (opinions.length === 0 || opinions.every((o) => o.lines.length === 0)) throw new Error(`no opinion in the text for ${source.cite}`);
  if (opinions[0]!.opinion !== 'majority') throw new Error(`the first writing in ${source.cite} is not the opinion of the court`);
  const lines = opinions.flatMap((o) => [...o.lines, ...o.notes]);
  return {
    id: caseIdFor(source.cite)!, // safe: cases.test.ts checks every cite reads
    cite: source.cite,
    title: caseTitle(source),
    url: source.url,
    retrieved: fetched.retrieved,
    track: source.track,
    kind: 'case',
    source: 'Caselaw Access Project (Harvard Law School Library), public domain; read on CourtListener',
    scheme: 'case',
    lines,
    ...(opinions[0]!.startPage ? { startPage: opinions[0]!.startPage } : {}),
    opinions: opinions.map(({ opinion, judge, role, lines: body, notes, startPage }) => ({ opinion, judge, role, lines: body, notes, startPage })),
  };
}

function caseTitle(source: CaseSource): string {
  const also = source.neutral ?? source.parallel;
  return `${source.name}${also ? `, ${also}` : ''} (${source.court} ${source.year})`;
}

/**
 * One case from CourtListener's opinion HTML supplied into the raw cache (courtlistener.ts): never downloaded, its
 * hash pinned in its law pack, split writing by writing with star pages like a CAP case.
 */
async function buildSuppliedCase(cache: RawCache, source: CaseSource, options: BuildOptions): Promise<LawUnit> {
  const supplied = source.supplied!; // safe: buildCase calls this only for a supplied source
  if (!(options.packs ?? []).some((pack) => pack.sources?.suppliedTexts?.has(source.text))) throw new Error(`${source.cite} is not one of the texts the build may take as supplied`);
  if (options.refresh) options.log?.(`${source.name}: cache-only, not downloaded again (${supplied.why})`);
  const fetched = await cache.get(source.text, { cacheOnly: supplied.why });
  if (!fetched) throw new Error(`no supplied text for ${source.cite}`);
  if (sha256(fetched.body) !== supplied.sha256) throw new Error(`the supplied text for ${source.cite} is not the one its law pack pins`);
  const html = fetched.body.toString('utf8');
  if (!courtListenerCites(html).includes(source.cite)) throw new Error(`the supplied text for ${source.cite} carries another cite`);
  if (!partiesMatch(source.name, courtListenerParties(html))) throw new Error(`the supplied text for ${source.cite} names other parties than ${source.name}`);
  const opinions = courtListenerOpinions(html);
  if (opinions[0]?.opinion !== 'majority') throw new Error(`the first writing in ${source.cite} is not the opinion of the court`);
  return {
    id: caseIdFor(source.cite)!, // safe: a law pack's tests check that every cite reads
    cite: source.cite,
    title: caseTitle(source),
    url: source.url,
    retrieved: fetched.retrieved,
    track: source.track,
    kind: 'case',
    source: `Opinion text, public domain; ${supplied.via}`,
    scheme: 'case',
    lines: opinions.flatMap((o) => [...o.lines, ...o.notes]),
    ...(opinions[0].startPage ? { startPage: opinions[0].startPage } : {}),
    opinions: opinions.map(({ opinion, judge, role, lines, notes, startPage }) => ({ opinion, judge, role, lines, notes, startPage })),
  };
}

/**
 * One case from the Court of Appeals' slip opinion (slip.ts), for an opinion CAP has no copy of: writing by writing
 * like a CAP case, each part pinpointed by the numbered paragraphs it covers. The PDF must be the opinion named:
 * its caption carries the neutral cite and names both sides.
 */
async function buildSlipCase(cache: RawCache, source: CaseSource, options: BuildOptions): Promise<LawUnit> {
  if (!(options.packs ?? []).some((pack) => pack.sources?.slipCases?.has(source.cite))) throw new Error(`${source.cite} is not one of the slip opinions the build may read`);
  const fetched = await cache.get(source.text, { refresh: options.refresh });
  if (!fetched || fetched.body.subarray(0, 4).toString() !== '%PDF') throw new Error(`no slip opinion PDF for ${source.cite}`);
  const slip = slipOpinion(await pdfItems(fetched.body));
  // The caption prints the cite without spaces ("2019COA42").
  if (!new RegExp(String.raw`(?<!\d)${source.cite.replace(/\s+/g, '')}(?!\d)`).test(slip.caption.replace(/\s+/g, ''))) {
    throw new Error(`the slip opinion PDF for ${source.cite} carries another cite`);
  }
  if (!partiesMatch(source.name, slip.caption)) throw new Error(`the slip opinion for ${source.cite} names other parties than ${source.name}`);
  if (slip.writings[0]?.opinion !== 'majority') throw new Error(`the first writing in ${source.cite} is not the opinion of the court`);
  return {
    id: caseIdFor(source.cite)!, // safe: a law pack's tests check that every cite reads
    cite: source.cite,
    title: caseTitle(source),
    url: source.url,
    retrieved: fetched.retrieved,
    track: source.track,
    kind: 'case',
    source: 'Colorado Court of Appeals slip opinion as announced, public domain; PDF from CourtListener (Free Law Project)',
    scheme: 'case',
    pinpoint: 'paragraph',
    lines: slip.writings.flatMap((o) => [...o.lines, ...o.notes]),
    opinions: slip.writings,
  };
}

/** Every unit in the manifest, in a stable order. */
export async function buildAll(cache: RawCache, options: BuildOptions = {}): Promise<LawUnit[]> {
  const units: LawUnit[] = [];
  for (const source of fromPacks(options, 'crs')) units.push(...(await buildCrs(cache, source, options)));
  units.push(...(await buildEcfr(cache, options)));
  units.push(...(await buildUsc(cache, options)));
  for (const pack of options.packs ?? []) units.push(...(await pack.build(cache, options)));
  const cases = fromPacks(options, 'cases');
  for (const source of cases) units.push(await buildCase(cache, source, options));
  options.log?.(`Cases: ${cases.length} opinions`);
  const ids = new Set<string>();
  for (const unit of units) {
    if (ids.has(unit.id)) throw new Error(`duplicate law unit ${unit.id}`);
    ids.add(unit.id);
  }
  return units;
}
