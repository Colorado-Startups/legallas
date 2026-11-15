// SPDX-License-Identifier: Apache-2.0
// The default law pack: what a room builds when it has no packs.json (pack.ts), so every install can search the law
// its documents rest on. The repository ships the list and where each unit comes from (default-pack-units.ts), never
// the text: each install downloads it into its owner's own account, following each site's robots file at that moment.
//
// A unit is built whole or not at all. Each source says it reached its end, and each unit must bring back its named
// sections and a minimum count. A unit that fails is reported with every other failure, and the run then stops before
// anything is written, so the plan can never read a failed act as units to delete. A unit waiting for a person isn't a
// failure: if a person's copy is lost from the raw cache, the plan names its rules as deletions for someone to catch.
import { isLawId, isOfficialLink, unitIdFor } from '../../worker/law-cite.ts';
import type { BuildOptions } from './build.ts';
import { cfrAnnualPdf, cfrAnnualSection, cfrAnnualUrl } from './cfr-annual.ts';
import { commonName } from './common-name.ts';
import { parseCompilation } from './compilation.ts';
import { coloradoRules } from './colorado-rules.ts';
import { crsWholeArticle, OLLS_EDITIONS, ollsDocxUrl, ollsPdfUrl } from './crs-whole.ts';
import { DEFAULT_PACK_UNITS, type PackUnit, type WholeCheck, uscodeUrl, withNextUnits } from './default-pack-units.ts';
import { delawareChapterUrl, delawareSections, delawareSubchapters } from './delaware.ts';
import { readDocx } from './docx.ts';
import { ecfrBulkUrl, ecfrPart } from './ecfr-bulk.ts';
import type { Fetched, RawCache } from './fetch.ts';
import type { LawPack } from './pack.ts';
import { uscodePage, type Section } from './parse.ts';
import { robotsAllows } from './robots.ts';
import { FORM_ADV_URL, FORM_D_URL, formAdvParts, formD, SEC_INTERPRETATIONS_URL, secInterpretations, secUserAgent } from './sec.ts';
import { ecfrReadUrl } from './sources.ts';
import type { LawUnit } from './types.ts';
import { courtRules, USCOURTS_RULES_URLS } from './uscourts-rules.ts';

const STORED_HOSTS = ['www.govinfo.gov', 'delcode.delaware.gov', 'olls.info', 'www.coloradosos.gov', 'regulations.delaware.gov', 'www.sec.gov', 'uscode.house.gov', 'www.uscourts.gov'] as const;

/** What the default pack's run learned about one unit, for the report. */
export interface UnitResult {
  sections: number;
  /** "as amended through P.L. 119-27". */
  asOf: string;
  fetched: string;
  /** Section numbers that hold no text: reserved, or a section that only amended another act. */
  empty: readonly string[];
}

/** A unit's text that waits for a person: what the report says to do, and that the run didn't build it. */
export interface UnitWaiting {
  waiting: string;
}

function compilationUrl(pkg: string): string {
  return `https://www.govinfo.gov/content/pkg/${pkg}/uslm/${pkg}.xml`;
}

/** The address each unit's text is downloaded from. */
export function sourceUrls(unit: PackUnit): string[] {
  switch (unit.source.kind) {
    case 'compilation':
      return [compilationUrl(unit.source.pkg)];
    case 'ecfr-parts':
      return [ecfrBulkUrl(unit.source.title)];
    case 'delaware':
      return [delawareChapterUrl(unit.source.title, unit.source.chapter)];
    case 'crs': {
      const { title } = unit.source;
      return OLLS_EDITIONS.map((edition) => ollsDocxUrl(edition, title));
    }
    case 'uscode': {
      const { title, sections } = unit.source;
      return sections.map((section) => uscodeUrl(title, section));
    }
    case 'cfr-sections': {
      const { title, sections } = unit.source;
      return sections.map((section) => cfrAnnualUrl(title, section));
    }
    case 'sec-interpretations':
      return [SEC_INTERPRETATIONS_URL];
    case 'form-adv':
      return [ecfrBulkUrl(17), FORM_ADV_URL];
    case 'form-d':
      return [FORM_D_URL];
    case 'uscourts-rules':
      return [USCOURTS_RULES_URLS[unit.source.set]];
    case 'person':
    case 'cited':
      return [];
  }
}

/** The Worker's catalog check drops what fails it without a word (law.ts validEntry), so a build stops on it instead. */
export function assertCitable(unit: Pick<LawUnit, 'id' | 'cite' | 'title' | 'url' | 'source'>): void {
  if (!isLawId(unit.id)) throw new Error(`${unit.cite} makes the id ${unit.id}, which the library can't cite`);
  if (!isOfficialLink(unit.url)) throw new Error(`${unit.cite} links to ${unit.url}, which isn't on the library's list of official hosts`);
  for (const field of [unit.cite, unit.title, unit.source]) {
    if (field.length > 400) throw new Error(`${unit.cite} has a field over the catalog's 400 characters`);
  }
}

/** Throws unless a built unit holds what a whole act must. */
export function assertWhole(unit: Pick<PackUnit, 'id' | 'title'>, whole: WholeCheck, numbers: readonly string[]): void {
  const found = new Set(numbers);
  const missing = whole.sections.filter((section) => !found.has(section));
  if (missing.length > 0) throw new Error(`${unit.id} (${unit.title}) came back without ${missing.join(', ')}; refusing a partial act`);
  if (numbers.length < whole.minSections) throw new Error(`${unit.id} (${unit.title}) came back with ${numbers.length} sections and a whole one has at least ${whole.minSections}; refusing a partial act`);
}

const MAX_HEADING = 340;

/**
 * A unit's title and text. A form's "heading" can run to a long sentence, past what the catalog holds for a title, so
 * then the title is its start and the whole sentence opens the text: no words are lost either way.
 */
export function titled(heading: string, name: string, lines: readonly string[]): { title: string; lines: string[] } {
  if (heading.length <= MAX_HEADING) return { title: `${heading} (${name})`, lines: [...lines] };
  const cut = heading.lastIndexOf(' ', MAX_HEADING);
  return { title: `${heading.slice(0, cut > 0 ? cut : MAX_HEADING)}... (${name})`, lines: [heading, ...lines] };
}

interface Built {
  units: LawUnit[];
  result: UnitResult;
  numbers: string[];
}

/** How a unit's builder reads a source: `get` when it must exist, `maybe` when a newer edition may not yet. */
interface Reader {
  get(url: string): Promise<Fetched>;
  maybe(url: string): Promise<Fetched | null>;
  /** A title download's paragraphs, read once however many units use the title. */
  paragraphs(fetched: Fetched): string[];
}

/** The setup field that names who is asking on this install's behalf. Each install declares its own; none ships. */
export const CONTACT_FIELD = 'LEGALLAS_LAW_CONTACT';

function needsContact(unit: PackUnit): boolean {
  return unit.source.kind === 'sec-interpretations' || unit.source.kind === 'form-adv' || unit.source.kind === 'form-d';
}

/**
 * An entity no parser decoded means the text isn't what the source says, and it must not pass for law. Tags aren't checked:
 * the parsers strip real ones, and a rule can name a tag in its words (Regulation S-T does).
 */
export function assertClean(unit: Pick<LawUnit, 'cite' | 'lines'>): void {
  const line = unit.lines.find((text) => /&(?:[a-zA-Z]{2,8}|#\d{1,6});/.test(text));
  if (line) throw new Error(`${unit.cite} still holds an undecoded entity: "${line.slice(0, 80)}"`);
}

/** Builds the default law pack from the given units and environment. */
export function createDefaultPack(units: readonly PackUnit[] = DEFAULT_PACK_UNITS, env: NodeJS.ProcessEnv = process.env): LawPack {
  const results = new Map<string, UnitResult>();
  const actOfLawUnit = new Map<string, string>();
  const secAgent = secUserAgent(env[CONTACT_FIELD]);

  /** One download per run, however many units read the file, after its site's robots file says yes. */
  function reader(cache: RawCache, options: BuildOptions): Reader {
    const robots = new Map<string, Promise<string>>();
    const files = new Map<string, Promise<Fetched | null>>();
    const parsed = new Map<string, string[]>();
    // Only sec.gov hears who is asking, and only because it refuses a client that doesn't say.
    const headersFor = (host: string): Record<string, string> => (host === 'www.sec.gov' && secAgent ? { 'User-Agent': secAgent } : {});
    const robotsOf = (host: string) => {
      let text = robots.get(host);
      if (!text) {
        // Always read fresh: a site can change its rules between two runs. No robots file means no rules.
        text = cache.get(`https://${host}/robots.txt`, { refresh: true, headers: headersFor(host) }).then((fetched) => fetched?.body.toString('utf8') ?? '');
        robots.set(host, text);
      }
      return text;
    };
    const download = async (url: string): Promise<Fetched | null> => {
      const target = new URL(url);
      if (options.refresh || !(await cache.peek(url))) {
        if (!robotsAllows(await robotsOf(target.hostname), `${target.pathname}${target.search}`)) throw new Error(`${target.hostname}'s robots file disallows ${target.pathname}`);
      }
      return cache.get(url, { refresh: options.refresh, headers: headersFor(target.hostname) });
    };
    const maybe = (url: string) => {
      let file = files.get(url);
      if (!file) {
        file = download(url);
        files.set(url, file);
      }
      return file;
    };
    return {
      maybe,
      async get(url) {
        const fetched = await maybe(url);
        if (!fetched) throw new Error(`${url} answered "not found"`);
        return fetched;
      },
      paragraphs(fetched) {
        let lines = parsed.get(fetched.url);
        if (!lines) {
          lines = readDocx(fetched.body);
          parsed.set(fetched.url, lines);
        }
        return lines;
      },
    };
  }

  async function buildCompilation(unit: PackUnit, read: Reader): Promise<Built> {
    if (unit.source.kind !== 'compilation') throw new Error('not a compilation');
    const { pkg, act, uscTitle, uncoded } = unit.source;
    const url = compilationUrl(pkg);
    const fetched = await read.get(url);
    const compiled = parseCompilation(fetched.body.toString('utf8'), uscTitle, uncoded);
    const asOf = `as amended through ${compiled.through}`;
    const out = compiled.sections.map((section) => {
      const cite = `${section.uscTitle} U.S.C. § ${section.number}`;
      const id = unitIdFor(cite);
      if (!id) throw new Error(`${unit.id}: cannot read the citation ${cite}`);
      return {
        id,
        cite,
        // Lawyers cite these acts by their own section numbers ("Section 5"), so the title names both.
        ...titled(section.heading, section.actSection ? `${act} § ${section.actSection}` : act, section.lines),
        url: unit.link,
        retrieved: fetched.retrieved,
        track: unit.track,
        kind: unit.kind,
        source: `House Office of the Legislative Counsel compilation on govinfo (U.S. Government Publishing Office), not the official text, ${asOf}`,
        scheme: 'outline',
      } satisfies LawUnit;
    });
    return { units: out, numbers: compiled.sections.map((section) => section.number), result: { sections: out.length, asOf, fetched: fetched.retrieved, empty: compiled.empty } };
  }

  async function buildEcfrParts(unit: PackUnit, read: Reader): Promise<Built> {
    if (unit.source.kind !== 'ecfr-parts') throw new Error('not eCFR parts');
    const { title, parts, rule } = unit.source;
    const fetched = await read.get(ecfrBulkUrl(title));
    const xml = fetched.body.toString('utf8');
    const sections: Section[] = [];
    const empty: string[] = [];
    let amended = '';
    for (const number of parts) {
      const part = ecfrPart(xml, number);
      amended = part.amended;
      sections.push(...part.sections);
      empty.push(...part.reserved);
    }
    const asOf = `amended through ${amended}`;
    const out = sections.map((section) => {
      const cite = `${title} C.F.R. § ${section.number}`;
      const id = unitIdFor(cite);
      if (!id) throw new Error(`${unit.id}: cannot read the citation ${cite}`);
      const name = commonName(cite) ?? `${rule} ${section.number.replace(/^\d+\./, '')}`;
      return {
        id,
        cite,
        ...titled(section.heading, name, section.lines),
        url: ecfrReadUrl(title, section.number),
        retrieved: fetched.retrieved,
        track: unit.track,
        kind: unit.kind,
        source: `eCFR bulk data on govinfo (Office of the Federal Register and U.S. Government Publishing Office), not the official text, ${asOf}`,
        scheme: 'outline',
      } satisfies LawUnit;
    });
    return { units: out, numbers: sections.map((section) => section.number), result: { sections: out.length, asOf, fetched: fetched.retrieved, empty } };
  }

  async function buildDelaware(unit: PackUnit, read: Reader): Promise<Built> {
    if (unit.source.kind !== 'delaware') throw new Error('not the Delaware Code');
    const { title, chapter, subchapter } = unit.source;
    const chapterUrl = delawareChapterUrl(title, chapter);
    const index = await read.get(chapterUrl);
    const html = index.body.toString('utf8');
    const listed = delawareSubchapters(html, title, chapter);
    const subchapters = subchapter ? listed.filter((url) => url.endsWith(`/sc${subchapter}/index.html`)) : listed;
    if (subchapter && subchapters.length !== 1) throw new Error(`${unit.id}: chapter ${chapter} lists no subchapter ${subchapter}`);
    const out: LawUnit[] = [];
    const numbers: string[] = [];
    const empty: string[] = [];
    let volume = 0;
    let fetched = index.retrieved;
    for (const url of subchapters.length > 0 ? subchapters : [chapterUrl]) {
      const page = url === chapterUrl ? index : await read.get(url);
      if (page.retrieved > fetched) fetched = page.retrieved;
      const parsed = delawareSections(page.body.toString('utf8'), new URL(url).pathname);
      empty.push(...parsed.empty);
      volume = Math.max(volume, parsed.lawsVolume);
      for (const section of parsed.sections) {
        const cite = `${title} Del. C. § ${section.number}`;
        const id = unitIdFor(cite);
        if (!id) throw new Error(`${unit.id}: cannot read the citation ${cite}`);
        numbers.push(section.number);
        out.push({
          id,
          cite,
          ...titled(section.heading, unit.title, section.lines),
          url: `${url}#${section.number}`,
          retrieved: page.retrieved,
          track: unit.track,
          kind: unit.kind,
          source: 'Delaware Code Online (Delaware General Assembly), web text; the signed PDF of the title is the authenticated copy',
          scheme: 'outline',
        });
      }
    }
    const asOf = volume > 0 ? `amendments through volume ${volume} of the Delaware Laws` : 'current when fetched';
    return { units: out, numbers, result: { sections: out.length, asOf, fetched, empty } };
  }

  async function buildCrs(unit: PackUnit, read: Reader): Promise<Built> {
    if (unit.source.kind !== 'crs') throw new Error('not the C.R.S.');
    const { title, articles, sections: only, parts } = unit.source;
    // "24-34-402.5" is in part 4 of its article.
    const inParts = (number: string) => !parts || parts.includes(Math.floor(Number(number.split('-').at(-1)) / 100));
    for (const edition of OLLS_EDITIONS) {
      const fetched = await read.maybe(ollsDocxUrl(edition, title));
      if (!fetched) continue;
      const paragraphs = read.paragraphs(fetched);
      const out: LawUnit[] = [];
      const numbers: string[] = [];
      const empty: string[] = [];
      for (const article of articles) {
        const parsed = crsWholeArticle(paragraphs, title, article);
        if (!only) empty.push(...parsed.empty.filter(inParts));
        for (const section of parsed.sections) {
          if ((only && !only.includes(section.number)) || !inParts(section.number)) continue;
          const cite = `C.R.S. § ${section.number}`;
          const id = unitIdFor(cite);
          if (!id) throw new Error(`${unit.id}: cannot read the citation ${cite}`);
          numbers.push(section.number);
          out.push({
            id,
            cite,
            ...titled(section.heading, unit.title, section.lines),
            url: ollsPdfUrl(edition, title),
            retrieved: fetched.retrieved,
            track: unit.track,
            kind: unit.kind,
            source: `Colorado Office of Legislative Legal Services, C.R.S. ${edition}, uncertified and not the official statutes; case annotations left out`,
            scheme: 'crs',
          });
        }
      }
      return { units: out, numbers, result: { sections: out.length, asOf: `C.R.S. ${edition}`, fetched: fetched.retrieved, empty } };
    }
    throw new Error(`no C.R.S. edition of title ${title} could be downloaded`);
  }

  /** U.S. Code sections, one page each, from the Law Revision Counsel's current Code rather than govinfo's yearly edition. */
  async function buildUscode(unit: PackUnit, read: Reader): Promise<Built> {
    if (unit.source.kind !== 'uscode') throw new Error('not U.S. Code sections');
    const { title, sections, name } = unit.source;
    const out: LawUnit[] = [];
    const numbers: string[] = [];
    let asOf = '';
    let fetched = '';
    for (const number of sections) {
      const url = uscodeUrl(title, number);
      const page = await read.get(url);
      const html = page.body.toString('utf8');
      const { section, through } = uscodePage(html, number, `${title} U.S.C. ${number}`);
      asOf = `current through ${through}`;
      if (page.retrieved > fetched) fetched = page.retrieved;
      const cite = `${title} U.S.C. § ${number}`;
      const id = unitIdFor(cite);
      if (!id) throw new Error(`${unit.id}: cannot read the citation ${cite}`);
      numbers.push(section.number);
      out.push({
        id,
        cite,
        ...titled(section.heading, name, section.lines),
        url,
        retrieved: page.retrieved,
        track: unit.track,
        kind: unit.kind,
        source: `Office of the Law Revision Counsel (U.S. House of Representatives), United States Code, ${asOf}`,
        scheme: 'usc',
      });
    }
    return { units: out, numbers, result: { sections: out.length, asOf, fetched, empty: [] } };
  }

  /** C.F.R. sections, one file each from govinfo's annual edition; each links to its own page of the edition's PDF. */
  async function buildCfrSections(unit: PackUnit, read: Reader): Promise<Built> {
    if (unit.source.kind !== 'cfr-sections') throw new Error('not C.F.R. sections');
    const { title, sections, name } = unit.source;
    const out: LawUnit[] = [];
    const editions = new Set<string>();
    let fetched = '';
    for (const number of sections) {
      const file = await read.get(cfrAnnualUrl(title, number));
      const { revised, section } = cfrAnnualSection(file.body.toString('utf8'), title, number);
      editions.add(revised);
      if (file.retrieved > fetched) fetched = file.retrieved;
      const cite = `${title} C.F.R. § ${number}`;
      const id = unitIdFor(cite);
      if (!id) throw new Error(`${unit.id}: cannot read the citation ${cite}`);
      // The PDF of the edition just read. A "mostrecent" link could name a newer edition than the text stored.
      const url = cfrAnnualPdf(file.finalUrl);
      if (!url) throw new Error(`${unit.id}: ${cite} came from ${file.finalUrl}, not an edition's section file, so its PDF is unknown`);
      out.push({
        id,
        cite,
        ...titled(section.heading, `${name} § ${number}`, section.lines),
        url,
        retrieved: file.retrieved,
        track: unit.track,
        kind: unit.kind,
        source: `Code of Federal Regulations, annual edition revised as of ${revised}, XML on govinfo (Office of the Federal Register and U.S. Government Publishing Office); the edition's PDF is the official text, and later amendments are not in it`,
        scheme: 'outline',
      });
    }
    const asOf = `annual edition revised as of ${[...editions].sort().join(', ')}`;
    return { units: out, numbers: [...sections], result: { sections: out.length, asOf, fetched, empty: [] } };
  }

  /** A copy a person saved. Null until one is in the raw cache: never downloaded, whatever the run asks for. */
  async function buildPerson(unit: PackUnit, cache: RawCache): Promise<Built | null> {
    if (unit.source.kind !== 'person') throw new Error('not a person\'s copy');
    const { address, parser } = unit.source;
    if (!parser || !(await cache.peek(address))) return null;
    const fetched = await cache.get(address, { cacheOnly: 'a person downloads it' });
    if (!fetched) return null;
    // Loaded here so that listing or building the rest of the pack doesn't need the PDF reader.
    const { pdfLines } = await import('./pdf.ts');
    const parsed = coloradoRules(await pdfLines(fetched.body));
    const out = parsed.sections.map((section) => {
      const cite = `3 CCR 704-1, Rule ${section.number}`;
      const id = unitIdFor(cite);
      if (!id) throw new Error(`${unit.id}: cannot read the citation ${cite}`);
      return {
        id,
        cite,
        ...titled(section.heading, unit.title, section.lines),
        url: unit.link,
        retrieved: fetched.retrieved,
        track: unit.track,
        kind: unit.kind,
        source: `Code of Colorado Regulations (Colorado Secretary of State), a copy a person downloaded on ${fetched.retrieved}`,
        scheme: 'ccr',
      } satisfies LawUnit;
    });
    return { units: out, numbers: parsed.sections.map((section) => section.number), result: { sections: out.length, asOf: `copy downloaded ${fetched.retrieved}`, fetched: fetched.retrieved, empty: parsed.empty } };
  }

  async function buildSecInterpretations(unit: PackUnit, read: Reader): Promise<Built> {
    const fetched = await read.get(SEC_INTERPRETATIONS_URL);
    const { updated, items } = secInterpretations(fetched.body.toString('utf8'));
    const asOf = `page last updated ${updated}`;
    const out = items.map((item) => {
      const cite = `SEC CFI, Securities Act Rules, ${item.form} ${item.number}`;
      const id = unitIdFor(cite);
      if (!id) throw new Error(`${unit.id}: cannot read the citation ${cite}`);
      return {
        id,
        cite,
        ...titled(item.heading, 'SEC staff view, not a rule', item.lines),
        url: item.anchor ? `${unit.link}#${item.anchor}` : unit.link,
        retrieved: fetched.retrieved,
        track: unit.track,
        kind: unit.kind,
        source: `SEC Division of Corporation Finance, Corporation Finance Interpretations; staff views, not rules; ${asOf}`,
        scheme: 'outline',
      } satisfies LawUnit;
    });
    return { units: out, numbers: items.map((item) => item.number), result: { sections: out.length, asOf, fetched: fetched.retrieved, empty: [] } };
  }

  async function buildFormAdv(unit: PackUnit, read: Reader): Promise<Built> {
    const bulk = await read.get(ecfrBulkUrl(17));
    const part = ecfrPart(bulk.body.toString('utf8'), 279);
    const pdf = await read.get(FORM_ADV_URL);
    // Loaded here so that listing or building the rest of the pack doesn't need the PDF reader.
    const { pdfLines } = await import('./pdf.ts');
    const forms = formAdvParts(await pdfLines(pdf.body));
    const rules = part.sections.map((section) => {
      const cite = `17 C.F.R. § ${section.number}`;
      const id = unitIdFor(cite);
      if (!id) throw new Error(`${unit.id}: cannot read the citation ${cite}`);
      return {
        id,
        cite,
        ...titled(section.heading, 'Form ADV rules', section.lines),
        url: ecfrReadUrl(17, section.number),
        retrieved: bulk.retrieved,
        track: unit.track,
        kind: unit.kind,
        source: `eCFR bulk data on govinfo (Office of the Federal Register and U.S. Government Publishing Office), not the official text, amended through ${part.amended}`,
        scheme: 'outline',
      } satisfies LawUnit;
    });
    const instructions = forms.map((form) => {
      const cite = `Form ADV, ${form.name}`;
      const id = unitIdFor(cite);
      if (!id) throw new Error(`${unit.id}: cannot read the citation ${cite}`);
      return {
        id,
        cite,
        title: `Form ADV: ${form.name}`,
        url: FORM_ADV_URL,
        retrieved: pdf.retrieved,
        track: unit.track,
        kind: unit.kind,
        source: 'U.S. Securities and Exchange Commission, Form ADV instructions, the paper version on sec.gov',
        scheme: 'outline',
        lines: form.lines,
      } satisfies LawUnit;
    });
    return {
      units: [...rules, ...instructions],
      numbers: [...part.sections.map((section) => section.number), ...forms.map((form) => form.name)],
      result: { sections: rules.length + instructions.length, asOf: `amended through ${part.amended}`, fetched: pdf.retrieved, empty: part.reserved },
    };
  }

  async function buildFormD(unit: PackUnit, read: Reader): Promise<Built> {
    const pdf = await read.get(FORM_D_URL);
    // Loaded here so that listing or building the rest of the pack doesn't need the PDF reader.
    const { pdfLines } = await import('./pdf.ts');
    const { expires, edition, parts } = formD(await pdfLines(pdf.body));
    const asOf = `OMB 3235-0076, approval expires ${expires}${edition ? `; ${edition}` : ''}`;
    const out = parts.map((part) => {
      const cite = `Form D, ${part.name}`;
      const id = unitIdFor(cite);
      if (!id) throw new Error(`${unit.id}: cannot read the citation ${cite}`);
      return {
        id,
        cite,
        title: /^(?:Item|Signature)/.test(part.name) ? `Form D: instructions for ${part.heading}` : `Form D: ${part.heading}`,
        url: FORM_D_URL,
        retrieved: pdf.retrieved,
        track: unit.track,
        kind: unit.kind,
        source: `U.S. Securities and Exchange Commission, Form D and its instructions, the paper version on sec.gov; ${asOf}`,
        scheme: 'outline',
        lines: part.lines,
      } satisfies LawUnit;
    });
    return { units: out, numbers: parts.map((part) => part.name), result: { sections: out.length, asOf, fetched: pdf.retrieved, empty: [] } };
  }

  async function buildCourtRules(unit: PackUnit, read: Reader): Promise<Built> {
    if (unit.source.kind !== 'uscourts-rules') throw new Error('not a federal rule set');
    const { set } = unit.source;
    const url = USCOURTS_RULES_URLS[set];
    const pdf = await read.get(url);
    // Loaded here so that listing or building the rest of the pack doesn't need the PDF reader.
    const { pdfLines } = await import('./pdf.ts');
    const { asOf, rules, abrogated } = courtRules(await pdfLines(pdf.body), set);
    const prefix = set === 'civil' ? 'Fed. R. Civ. P.' : 'Fed. R. Evid.';
    const out = rules.map((rule) => {
      const cite = `${prefix} ${rule.number}`;
      const id = unitIdFor(cite);
      if (!id) throw new Error(`${unit.id}: cannot read the citation ${cite}`);
      return {
        id,
        cite,
        ...titled(rule.heading, `${unit.title}, Rule ${rule.number}`, rule.lines),
        url,
        retrieved: pdf.retrieved,
        track: unit.track,
        kind: unit.kind,
        source: `Administrative Office of the U.S. Courts, ${unit.title} as amended to ${asOf}, the House Judiciary Committee print posted on uscourts.gov`,
        scheme: 'outline',
      } satisfies LawUnit;
    });
    return { units: out, numbers: rules.map((rule) => rule.number), result: { sections: out.length, asOf: `as amended to ${asOf}`, fetched: pdf.retrieved, empty: abrogated } };
  }

  async function buildUnit(unit: PackUnit, read: Reader, cache: RawCache): Promise<Built | null> {
    switch (unit.source.kind) {
      case 'compilation':
        return buildCompilation(unit, read);
      case 'ecfr-parts':
        return buildEcfrParts(unit, read);
      case 'delaware':
        return buildDelaware(unit, read);
      case 'crs':
        return buildCrs(unit, read);
      case 'uscode':
        return buildUscode(unit, read);
      case 'cfr-sections':
        return buildCfrSections(unit, read);
      case 'person':
        return buildPerson(unit, cache);
      case 'sec-interpretations':
        return buildSecInterpretations(unit, read);
      case 'form-adv':
        return buildFormAdv(unit, read);
      case 'form-d':
        return buildFormD(unit, read);
      case 'uscourts-rules':
        return buildCourtRules(unit, read);
      case 'cited':
        return null;
    }
  }

  return {
    name: 'Legallas default law pack',
    hosts: STORED_HOSTS,
    urls: () => units.flatMap((unit) => sourceUrls(unit)),
    stagedUpload: (lawUnitId) => actOfLawUnit.get(lawUnitId),
    async build(cache, options) {
      const only = options.only;
      if (only) {
        const known = new Set(units.map((unit) => unit.id));
        const unknown = [...only].filter((id) => !known.has(id));
        if (unknown.length > 0) throw new Error(`no such unit in the default law pack: ${unknown.join(', ')}`);
      }
      // Required, so it stops a run before any download, not partway through one.
      if (!secAgent && units.some((unit) => needsContact(unit) && (!only || only.has(unit.id)))) {
        throw new Error(`${CONTACT_FIELD} must name a company and an email ("Example Company legal@example.com"): sec.gov refuses a machine client that doesn't say who it is. Setup asks for it.`);
      }
      const read = reader(cache, options);
      const built: LawUnit[] = [];
      const failures: string[] = [];
      for (const unit of units) {
        if (only && !only.has(unit.id)) continue;
        try {
          const result = await buildUnit(unit, read, cache);
          if (!result) continue;
          if (unit.whole) assertWhole(unit, unit.whole, result.numbers);
          result.units.forEach(assertCitable);
          result.units.forEach(assertClean);
          built.push(...result.units);
          for (const lawUnit of result.units) actOfLawUnit.set(lawUnit.id, unit.id);
          results.set(unit.id, result.result);
          options.log?.(`${unit.id}: ${result.result.sections} sections`);
        } catch (error) {
          failures.push(`${unit.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (failures.length > 0) throw new Error(`${failures.length} law pack unit${failures.length === 1 ? '' : 's'} failed, so nothing was built:\n  ${failures.join('\n  ')}`);
      return built;
    },
    async report(cache) {
      const stored = units.filter((unit) => unit.source.kind !== 'cited').length;
      const lines = [`Legallas default law pack: ${units.length} units, ${stored} stored whole and ${units.length - stored} cited only. No text ships with it: this install downloads it.`];
      const waiting: PackUnit[] = [];
      for (const unit of units) {
        if (unit.source.kind === 'person' && !results.has(unit.id) && !(unit.source.parser && (await cache.peek(unit.source.address)))) waiting.push(unit);
      }
      if (waiting.length > 0) lines.push(`WAITING for a person: ${waiting.map((unit) => unit.id).join(', ')}. The library has none of their text until then.`);
      for (const level of ['federal', 'Delaware', 'Colorado'] as const) {
        const here = units.filter((unit) => unit.level === level);
        if (here.length > 0) lines.push(`${level}:`);
        for (const unit of here) lines.push(...(await unitLines(unit, cache, results.get(unit.id))));
      }
      return lines;
    },
  };
}

/** One unit's report: what it is, where it comes from, when it was fetched and what came back. */
async function unitLines(unit: PackUnit, cache: RawCache, result: UnitResult | undefined): Promise<string[]> {
  const head = `  ${unit.id}: ${unit.title} (${unit.citation})`;
  if (unit.source.kind === 'cited') return [head, `    cited only, not stored; ${unit.link}`];
  const lines = [head];
  if (unit.source.kind === 'person') {
    const copy = await cache.peek(unit.source.address);
    lines.push(`    source ${unit.link}; ${copy ? `copy a person downloaded ${copy.retrieved}` : `WAITING: ${unit.source.steps}`}`);
  } else {
    // A newer edition that isn't out yet isn't a source, so show what was fetched, or else the current address.
    const urls = sourceUrls(unit);
    const peeks = await Promise.all(urls.map((url) => cache.peek(url)));
    const rows = urls.flatMap((url, i) => (peeks[i] ? [`    source ${url}; fetched ${peeks[i].retrieved}`] : []));
    lines.push(...(rows.length > 0 ? rows : [`    source ${urls.at(-1)}; not fetched yet`]));
  }
  if (result) lines.push(`    built: ${result.sections} sections, ${result.asOf}${result.empty.length > 0 ? `; no text in ${result.empty.join(', ')}` : ''}`);
  return lines;
}

/**
 * The setup field that adds the units a room built with the defaults doesn't hold yet (NEXT_PACK_UNITS). Off unless
 * "1", so a live room builds exactly what it did.
 */
export const NEXT_FIELD = 'LEGALLAS_LAW_NEXT';

/** The default law pack, with the next units added when its switch is on. */
export const lawPack = createDefaultPack(process.env[NEXT_FIELD] === '1' ? withNextUnits() : DEFAULT_PACK_UNITS);
