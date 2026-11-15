// SPDX-License-Identifier: Apache-2.0
// The law library's citations (T21): unit ids, canonical citation strings and the [law:<id>] tag the model
// writes. Shared by the build (scripts/law/), the Worker (worker/law.ts) and the MCP tool, so a citation reads
// the same everywhere. Public law only: nothing here ever names a party or a fact of the matter.
//
// A unit is one citable piece of law: a statute or rule section, a jury instruction, or an opinion. A chunk is
// what the index holds: a unit, or one part of a long unit, keyed `<unit>~<n>`.

/** Which filings an authority may support. Regulator-only material (3 CCR 704-1) is never civil authority. */
export type LawTrack = 'civil' | 'regulator' | 'both';
export const LAW_TRACKS: readonly LawTrack[] = ['civil', 'regulator', 'both'];
export type LawKind = 'statute' | 'regulation' | 'guidance' | 'jury-instruction' | 'case';

/**
 * Which writing an opinion part comes from. Only `majority` (the opinion of the court) states what the court held;
 * a concurrence, a dissent or a concurrence in part and dissent in part is one judge's view, never the holding.
 */
export type LawOpinion = 'majority' | 'concurrence' | 'dissent' | 'concurrence-dissent';
export const LAW_OPINIONS: readonly LawOpinion[] = ['majority', 'concurrence', 'dissent', 'concurrence-dissent'];

/** True for a separate writing (concurrence, dissent or both): never authority for what the court held. */
export function isSeparateOpinion(opinion: string | null | undefined): boolean {
  return opinion === 'concurrence' || opinion === 'dissent' || opinion === 'concurrence-dissent';
}

/** One indexed chunk as the catalog (catalog.json in the legallas-law bucket) describes it. */
export interface LawChunk {
  /** `<unit>` or `<unit>~<n>`; also the stem of its R2 key, law/<track>/<id>.md. */
  id: string;
  /**
   * Canonical citation: the unit's for a first or only part; a later part adds its span, e.g. "(3)-(6)". An opinion
   * part gives the star page or range its text covers ("331 P.3d 140, 151-52") and, for a separate writing, the
   * parenthetical a brief uses ("305 P.3d 842, 851 (Fable, J., dissenting)").
   */
  cite: string;
  /** Section heading or case name, plain text. */
  title: string;
  /** The official (or public domain) page a reader opens. https only. */
  url: string;
  /** YYYY-MM-DD the text was fetched. */
  retrieved: string;
  track: LawTrack;
  kind: LawKind;
  /** Publisher and edition, e.g. "Colorado OLLS, C.R.S. 2024". */
  source: string;
  /** Opinion parts only: the writing the part comes from (absent in catalogs built before 2026-10-05). */
  opinion?: LawOpinion;
  /** Opinion parts only, when the opinion names one: its author, "Fable, J.". */
  author?: string;
}

/**
 * The last year the library's case law reaches (the Caselaw Access Project copy ends there for these reporters).
 * The room's law notice says so, because newer authority needs counsel's check. A room's own law pack test keeps it
 * equal to the newest opinion the pack names.
 */
export const CASE_LAW_THROUGH = 2019;

/** Hosts a law citation may link to: the official and public domain sources the build reads from. */
export const LAW_LINK_HOSTS: ReadonlySet<string> = new Set([
  'content.leg.colorado.gov',
  'olls.info',
  'www.coloradosos.gov',
  'delcode.delaware.gov',
  'www.ecfr.gov',
  'www.govinfo.gov',
  // The Office of the Law Revision Counsel's current U.S. Code, where govinfo's yearly edition lags.
  'uscode.house.gov',
  'www.sec.gov',
  // The Federal Rules of Civil Procedure and of Evidence, as the House Judiciary Committee prints them.
  'www.uscourts.gov',
  // The District of Colorado's and the District of Delaware's own local rules and discovery standard.
  'www.cod.uscourts.gov',
  'www.ded.uscourts.gov',
  'www.courtlistener.com',
  'static.case.law',
  'www.coloradojudicial.gov',
  'www.sos.state.co.us',
  'securities.colorado.gov',
]);

/** True for an https link on an official source host, the only links the room shows for law. */
export function isOfficialLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && LAW_LINK_HOSTS.has(parsed.hostname) && !parsed.username && !parsed.password && !parsed.port;
  } catch {
    return false;
  }
}

/** Chunk ids: lowercase words joined by hyphens, an optional ~part number. Never a path. */
export const LAW_ID = /^[a-z0-9]+(?:-[a-z0-9]+){1,10}(?:~[1-9][0-9]{0,2})?$/;
const MAX_ID = 96;

export function isLawId(id: string): boolean {
  return id.length <= MAX_ID && LAW_ID.test(id);
}

// law/<track>/<id>.md, as scripts/law/plan.ts lawKey() writes it.
const LAW_KEY = /^law\/(civil|regulator|both)\/([a-z0-9~-]{3,96})\.md$/;

/** The chunk id and track an AI Search item key belongs to, or null for anything that is not a law chunk. */
export function lawFromKey(key: string): { id: string; track: LawTrack } | null {
  const match = LAW_KEY.exec(key);
  if (!match || !isLawId(match[2]!)) return null;
  return { id: match[2]!, track: match[1] as LawTrack };
}

export function lawKey(chunk: Pick<LawChunk, 'id' | 'track'>): string {
  if (!isLawId(chunk.id) || !LAW_TRACKS.includes(chunk.track)) throw new Error('not a law chunk id');
  return `law/${chunk.track}/${chunk.id}.md`;
}

/** The unit a chunk belongs to: its id without the ~part. */
export function unitOf(id: string): string {
  return id.replace(/~[0-9]+$/, '');
}

// What the model writes: [law:<id>], or gpt-oss's native fullwidth brackets 【law:<id>】 (worker/citations.ts).
export const ANSWER_LAW_CITE = /[[【]law:\s*([a-z0-9~-]{3,96})\s*[\]】]/g;

/** Every [law:<id>] in an answer, in order, duplicates included. */
export function citedLaw(answer: string): string[] {
  return [...answer.matchAll(ANSWER_LAW_CITE)].map((match) => match[1]!).filter(isLawId);
}

// ---------------------------------------------------------------------------------------------------
// Canonical citations. normalizeCitation() reads the loose forms people and models write ("CRS 7-80-714(1)",
// "17 CFR 230.506(b)", "Rule 10b-5", "412 P. 2d 77") and returns one spelling, or null when it is not a
// citation this library knows how to read. baseCitation() drops the pinpoint, for comparing a cite to a unit.
// ---------------------------------------------------------------------------------------------------

const PIN = String.raw`((?:\s?\([0-9A-Za-z]{1,6}\))*)`;
const SECTION = String.raw`(?:§§?|sec(?:tion|\.)?|s\.)?\s*`;

function pin(raw: string | undefined): string {
  return (raw ?? '').replace(/\s+/g, '');
}

type Reader = (match: RegExpExecArray) => string;

const READERS: [RegExp, Reader][] = [
  // Colorado Revised Statutes: C.R.S. § 7-80-714(1)
  [
    new RegExp(String.raw`^(?:C\.?\s?R\.?\s?S\.?(?:\s?A\.?)?|Colo\.?\s*Rev\.?\s*Stat\.?(?:\s*Ann\.?)?)\s*,?\s*${SECTION}(\d{1,2}(?:\.\d)?)-(\d{1,3}(?:\.\d)?)-(\d{3,4}(?:\.\d{1,2})?)${PIN}`, 'i'),
    (m) => `C.R.S. § ${m[1]}-${m[2]}-${m[3]}${pin(m[4])}`,
  ],
  // Code of Federal Regulations: 17 C.F.R. § 230.506(b). SEC rules named for a statute's subsection keep it in
  // the section number: 17 C.F.R. § 275.203(l)-1 is one rule, not § 275.203 subsection (l).
  [
    new RegExp(String.raw`^(\d{1,2})\s*C\.?\s?F\.?\s?R\.?\s*${SECTION}(\d{1,4}[a-z]?)\.(\d{1,4}(?:[a-z]{1,3}\d{0,3})?(?:(?:\([0-9a-z]{1,4}\))+-\d{1,3}[a-z]?|-\d{1,3}[a-z]?)?)${PIN}`, 'i'),
    (m) => `${m[1]} C.F.R. § ${m[2]!.toLowerCase()}.${m[3]!.toLowerCase()}${pin(m[4])}`,
  ],
  // United States Code: 15 U.S.C. § 80b-6
  [
    new RegExp(String.raw`^(\d{1,2})\s*U\.?\s?S\.?\s?C\.?(?:\s?A\.?)?\s*${SECTION}(\d{1,5}[a-z]{0,3}(?:-\d{1,3}[a-z]?)?)${PIN}`, 'i'),
    (m) => `${m[1]} U.S.C. § ${m[2]}${pin(m[3])}`,
  ],
  // SEC rule shorthand: Rule 506(b) of Regulation D, SEC Rule 506(b), Rule 10b-5
  // Only with Regulation D context: "Rule 501" alone is as likely the Rules of Evidence.
  [new RegExp(String.raw`^(?:SEC|Regulation\s+D,?)\s+Rule\s+(50[0-8])\b${PIN}`, 'i'), (m) => `17 C.F.R. § 230.${m[1]}${pin(m[2])}`],
  [new RegExp(String.raw`^Rule\s+(50[0-8])\b${PIN}\s*(?:of|under)\s+Regulation\s+D\b`, 'i'), (m) => `17 C.F.R. § 230.${m[1]}${pin(m[2])}`],
  [/^(?:SEC\s+)?Rule\s+10b-5(?:\(([a-c])\))?/i, (m) => `17 C.F.R. § 240.10b-5${m[1] ? `(${m[1].toLowerCase()})` : ''}`],
  // Advisers Act sections 202 to 206 (203A included): 15 U.S.C. § 80b-2 to 80b-6, so section 206 is § 80b-6.
  [
    new RegExp(String.raw`^(?:Investment\s+)?Advisers\s+Act(?:\s+of\s+1940)?\s*,?\s*${SECTION}20([2-6])(A)?(?![0-9A-Za-z])${PIN}`, 'i'),
    (m) => `15 U.S.C. § 80b-${m[1]}${m[2] ? 'a' : ''}${pin(m[3])}`,
  ],
  // Investment Company Act sections 2 and 3 (definitions, the 3(c) exclusions): 15 U.S.C. § 80a-2 and 80a-3.
  [
    new RegExp(String.raw`^Investment\s+Company\s+Act(?:\s+of\s+1940)?\s*,?\s*${SECTION}([23])(?![0-9A-Za-z])${PIN}`, 'i'),
    (m) => `15 U.S.C. § 80a-${m[1]}${pin(m[2])}`,
  ],
  // Delaware Code: 8 Del. C. § 141(a), 6 Del. C. § 18-1101(c), Del. Code Ann. tit. 8, § 141(a). The General Corporation
  // Law and the LLC Act go by their own short names too: DGCL § 141, DLLCA § 18-1101.
  [
    // A year after the name is a history line ("8 Del. C. 1953, § 101"), not a citation.
    new RegExp(String.raw`^(\d{1,2})\s*Del\.?\s*C(?:ode)?\.?(?:\s*Ann\.?)?(?!\s*\d{4},)\s*,?\s*${SECTION}(\d{1,4}[a-z]?(?:-\d{1,4}[a-z]?)?)${PIN}`, 'i'),
    (m) => `${m[1]} Del. C. § ${m[2]}${pin(m[3])}`,
  ],
  [
    new RegExp(String.raw`^Del\.?\s*Code\s*Ann\.?\s*tit\.?\s*(\d{1,2})\s*,?\s*${SECTION}(\d{1,4}[a-z]?(?:-\d{1,4}[a-z]?)?)${PIN}`, 'i'),
    (m) => `${m[1]} Del. C. § ${m[2]}${pin(m[3])}`,
  ],
  [new RegExp(String.raw`^DGCL\s*${SECTION}(\d{1,4}[a-z]?)${PIN}`, 'i'), (m) => `8 Del. C. § ${m[1]}${pin(m[2])}`],
  [new RegExp(String.raw`^DLLCA\s*${SECTION}(18-\d{1,4}[a-z]?)${PIN}`, 'i'), (m) => `6 Del. C. § ${m[1]}${pin(m[2])}`],
  // Court rules: Fed. R. Civ. P. 26(b)(1), Fed. R. Evid. 502, C.R.C.P. 16.1 and 121 § 1-15, Ct. Ch. R. 37(e), and the
  // District of Colorado's local rules as they name themselves, D.C.COLO.LCivR 7.1(a).
  [new RegExp(String.raw`^(?:Fed\.?\s*R\.?\s*Civ\.?\s*P\.?|F\.?R\.?C\.?P\.?)\s*(?:Rule\s*)?(\d{1,3}(?:\.\d)?)${PIN}`, 'i'), (m) => `Fed. R. Civ. P. ${m[1]}${pin(m[2])}`],
  [new RegExp(String.raw`^(?:Fed\.?\s*R\.?\s*Evid\.?|F\.?R\.?E\.?)\s*(?:Rule\s*)?(\d{3,4})${PIN}`, 'i'), (m) => `Fed. R. Evid. ${m[1]}${pin(m[2])}`],
  [
    new RegExp(String.raw`^(?:C\.?\s?R\.?\s?C\.?\s?P\.?|Colo\.?\s*R\.?\s*Civ\.?\s*P\.?)\s*(?:Rule\s*)?(\d{1,3}(?:\.\d{1,2})?)(?:\s*,?\s*${SECTION}(1-\d{1,2}))?${PIN}`, 'i'),
    (m) => `C.R.C.P. ${m[1]}${m[2] ? ` § ${m[2]}` : ''}${pin(m[3])}`,
  ],
  [new RegExp(String.raw`^(?:Ct\.?\s*Ch\.?\s*R\.?|Del\.?\s*Ch\.?\s*(?:Ct\.?\s*)?R\.?|Court\s+of\s+Chancery\s+Rule)\s*(\d{1,3}(?:\.\d)?)${PIN}`, 'i'), (m) => `Ct. Ch. R. ${m[1]}${pin(m[2])}`],
  [new RegExp(String.raw`^D\.?\s?C\.?\s?COLO\.?\s?L\.?\s?Civ\.?\s?R\.?\s*(\d{1,2}\.\d{1,2})${PIN}`, 'i'), (m) => `D.C.COLO.LCivR ${m[1]}${pin(m[2])}`],
  [new RegExp(String.raw`^D\.\s*Colo\.\s*L\.?\s*Civ\.?\s*R\.?\s*(\d{1,2}\.\d{1,2})${PIN}`, 'i'), (m) => `D.C.COLO.LCivR ${m[1]}${pin(m[2])}`],
  // SEC staff interpretations of the Securities Act rules: C&DI 256.23, CFI Question 110.01. Questions are numbered under
  // 500 and interpretive responses from 500 up, so the number says which.
  [
    /^(?:SEC\s+)?(?:Securities\s+Act\s+Rules\s+)?(?:C&DI|CDI|CFI)s?\s*,?\s*(?:Securities\s+Act\s+Rules\s*,?\s*)?(?:Question\s+|Interpretive\s+Response\s+)?(\d{3}\.\d{2})/i,
    (m) => `SEC CFI, Securities Act Rules, ${Number(m[1]) < 500 ? 'Question' : 'Interpretive Response'} ${m[1]}`,
  ],
  // Form D's own parts: Form D, Item 7; Item 7 of Form D; Form D, General Instructions. The rule naming the form is
  // 17 C.F.R. § 239.500, read above. Its items run 1 to 16, and Form D-1 is another form.
  [
    /^Form\s+D\s*,?\s*(?:(?:Instructions?\s+(?:to|for)\s+)?Item\s+(1[0-6]|[1-9])(?![0-9A-Za-z])|(Terms\s+of\s+Submission|General\s+Instructions|Signature\s+and\s+Submission)\b)/,
    (m) => `Form D, ${m[1] ? `Item ${m[1]}` : m[2]!.replace(/\s+/g, ' ')}`,
  ],
  [/^Item\s+(1[0-6]|[1-9])\s+of\s+Form\s+D(?![0-9A-Za-z-])/, (m) => `Form D, Item ${m[1]}`],
  // Colorado civil jury instructions: CJI-Civ 6:1
  [/^(?:CJI[-\s]?Civ\.?|Colo\.?\s*Jury\s*Instr\.?,?\s*Civ\.?)\s*(?:\d(?:st|nd|rd|th)\s*)?(\d{1,2}):(\d{1,3}[A-Z]?)/i, (m) => `CJI-Civ ${m[1]}:${m[2]!.toUpperCase()}`],
  // Code of Colorado Regulations, Division of Securities: 3 CCR 704-1, Rule 51-4.1
  [
    /^(\d)\s*C\.?\s?C\.?\s?R\.?\s*(\d{3,4})-(\d{1,2})(?:\s*,?\s*(?:Rule|R\.)\s*([0-9][0-9A-Za-z.()-]{0,20}))?/i,
    (m) => `${m[1]} CCR ${m[2]}-${m[3]}${m[4] ? `, Rule ${m[4].replace(/[.,;]+$/, '').replace(/\(ia\)/i, '(IA)')}` : ''}`,
  ],
  // Reporters: 412 P.2d 77, 2016 CO 4, 2019 COA 152
  [/^(\d{1,4})\s+P\.?\s?([23])d\s+(\d{1,5})/i, (m) => `${m[1]} P.${m[2]}d ${m[3]}`],
  [/^(\d{1,4})\s+P\.\s+(\d{1,5})/i, (m) => `${m[1]} P. ${m[2]}`],
  [/^(\d{1,3})\s+Colo\.\s*(App\.\s*)?(\d{1,4})/i, (m) => `${m[1]} Colo.${m[2] ? ' App.' : ''} ${m[3]}`],
  [/^((?:19|20)\d\d)\s+(CO|COA)\s+(\d{1,4})/i, (m) => `${m[1]} ${m[2]!.toUpperCase()} ${m[3]}`],
];

/** The canonical spelling of a citation, or null when `raw` is not one this library reads. */
export function normalizeCitation(raw: string): string | null {
  const text = raw.replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
  return readCitation(text)?.cite ?? null;
}

/** The citation `text` opens with: its canonical spelling and how many characters it spans, or null. */
function readCitation(text: string): { cite: string; length: number } | null {
  for (const [pattern, read] of READERS) {
    const match = pattern.exec(text);
    if (match) return { cite: read(match), length: match[0].replace(/[\s.,;:]+$/, '').length };
  }
  return null;
}

/** Every citation in running text that normalizeCitation reads, in order: where it starts, its length, its canonical spelling. */
export function citationsIn(text: string): { index: number; length: number; cite: string }[] {
  const found: { index: number; length: number; cite: string }[] = [];
  for (let i = 0; i < text.length; i++) {
    // Only where a word starts: "free 500" holds no Fed. R. Evid. 500, nor "U.S.C." an "S.C.".
    if (!/[0-9A-Za-z]/.test(text[i]!) || /[0-9A-Za-z.]/.test(text[i - 1] ?? ' ')) continue;
    const hit = readCitation(text.slice(i, i + 160));
    if (!hit) continue;
    found.push({ index: i, ...hit });
    i += hit.length - 1;
  }
  return found;
}

// A Division of Securities rule number, "(IA)" included: the investment adviser rules (51-4.1(IA)) are rules of
// their own beside the broker-dealer rules of the same number (51-4.1), so the marker is never a pinpoint.
const CCR_BASE = /^(\d CCR \d{3,4}-\d{1,2}, Rule \d{1,2}-\d{1,2}(?:\.\d{1,2}){0,3}[A-Z]?(?:\(IA\))?)(?:\([0-9A-Za-z]{1,6}\))*(?:-(?:\([0-9A-Za-z]{1,6}\))+)?$/;

/** A canonical citation without its pinpoint or span: "C.R.S. § 7-80-404(3)-(6)" becomes "C.R.S. § 7-80-404". */
export function baseCitation(cite: string): string {
  const ccr = CCR_BASE.exec(cite);
  if (ccr) return ccr[1]!;
  return cite.replace(/(?:\([0-9A-Za-z]{1,6}\))+(?:-(?:\([0-9A-Za-z]{1,6}\))+)?$/, '');
}

/** Unit id prefixes for the court rules unitIdFor reads. */
const COURT_RULE_IDS: Readonly<Record<string, string>> = {
  'Fed. R. Civ. P.': 'frcp',
  'Fed. R. Evid.': 'fre',
  'Ct. Ch. R.': 'ctch',
  'D.C.COLO.LCivR': 'dcolo-lcivr',
};

/** The unit id for a canonical statute, rule or instruction citation; null for cases (the catalog names those). */
export function unitIdFor(cite: string): string | null {
  const base = baseCitation(cite);
  let m = /^C\.R\.S\. § ([0-9.]+)-([0-9.]+)-([0-9.]+)$/.exec(base);
  if (m) return `crs-${m[1]}-${m[2]}-${m[3]}`.replace(/\./g, '-');
  m = /^(\d+) C\.F\.R\. § (\d+[a-z]?)\.([0-9A-Za-z]+(?:\([0-9A-Za-z]+\))*(?:-[0-9A-Za-z]+)?)$/.exec(base);
  if (m) return `cfr-${m[1]}-${m[2]}-${m[3]!.toLowerCase().replace(/\(([0-9a-z]+)\)/g, '-$1')}`;
  m = /^(\d+) U\.S\.C\. § ([0-9A-Za-z-]+)$/.exec(base);
  if (m) return `usc-${m[1]}-${m[2]!.toLowerCase()}`;
  m = /^(\d+) Del\. C\. § ([0-9A-Za-z-]+)$/.exec(base);
  if (m) return `del-${m[1]}-${m[2]!.toLowerCase()}`;
  m = /^SEC CFI, Securities Act Rules, (?:Question|Interpretive Response) (\d{3})\.(\d{2})$/.exec(base);
  if (m) return `cfi-sar-${m[1]}-${m[2]}`;
  m = /^Form ADV, (General Instructions|Instructions for Part 1A|Glossary of Terms)$/.exec(base);
  if (m) return `form-adv-${m[1]!.toLowerCase().replace(/ /g, '-')}`;
  m = /^Form D, (Terms of Submission|General Instructions|Item (?:1[0-6]|[1-9])|Signature and Submission)$/.exec(base);
  if (m) return `form-d-${m[1]!.toLowerCase().replace(/ /g, '-')}`;
  m = /^(Fed\. R\. Civ\. P\.|Fed\. R\. Evid\.|Ct\. Ch\. R\.|D\.C\.COLO\.LCivR) (\d+(?:\.\d+)?)$/.exec(base);
  if (m) return `${COURT_RULE_IDS[m[1]!]}-${m[2]!.replace('.', '-')}`;
  m = /^C\.R\.C\.P\. (\d+(?:\.\d+)?)(?: § (1-\d+))?$/.exec(base);
  if (m) return `crcp-${m[1]!.replace('.', '-')}${m[2] ? `-${m[2]}` : ''}`;
  m = /^CJI-Civ (\d+):([0-9A-Z]+)$/.exec(base);
  if (m) return `cji-${m[1]}-${m[2]!.toLowerCase()}`;
  m = /^(\d) CCR (\d+)-(\d+), Rule ([0-9A-Za-z.-]+(?:\(IA\))?)$/.exec(base);
  if (m) return `ccr-${m[2]}-${m[3]}-r${m[4]!.toLowerCase().replace('(ia)', '-ia').replace(/[.]/g, '-')}`;
  return null;
}

/** The unit id for a reporter citation: "412 P.2d 77" becomes "case-412-p2d-77". */
export function caseIdFor(reporterCite: string): string | null {
  const cite = normalizeCitation(reporterCite);
  if (!cite) return null;
  const m = /^(\d+) (P\.[23]d|P\.|Colo\.(?: App\.)?|CO|COA) (\d+)$/.exec(cite);
  if (!m) return null;
  const reporter = m[2]!.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `case-${m[1]}-${reporter}-${m[3]}`;
}
