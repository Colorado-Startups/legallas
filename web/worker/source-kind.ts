// SPDX-License-Identifier: Apache-2.0
// What kind of source a record document is, from its folder and file name alone: deterministic, generic rules,
// never names from a matter. Ask uses it to keep allegations apart from established fact (answer-shape.ts): a claim
// whose only support is a party's filing, a letter, an email or a press item is shown as attributed, never as Fact,
// and the room's own summaries (orientation notes, case analysis, research notes) never make a claim a Fact either.
//
// Files follow DocType_Abbr__YYYYMMDD__Party__Qualifier (scripts/matter/catalog.ts; src/scripts/doc-type.ts reads
// the same DocType for display). The folder tab names the zone ("03-Kitchen-Records", "04-Letters").

/**
 * - `record`: evidence and records (agreements, minutes, public records, filings with a regulator, financial
 *   records, court orders, exhibits); a Fact may rest on it.
 * - `filing`: a party's court paper or position (complaint, motion, brief, response, proposed order, mediation
 *   statement, a party's request), drafts of them included.
 * - `letter`: a letter, a demand or preservation letter, other correspondence.
 * - `email`: an email.
 * - `press`: a press or social media item.
 * - `summary`: the room's own notes and analysis (orientation, chronology, catalog, case analysis, research notes,
 *   memos), and anything filed as work product (a WP marker in the name). Never a Fact.
 */
export type SourceKind = 'record' | 'filing' | 'letter' | 'email' | 'press' | 'summary';

/** The document fields the rules read. */
export interface SourceFields {
  name: string;
  /** The folder the document sits in, '' for the root; absent when unknown (then the name alone decides). */
  folder?: string | null;
}

/** Court records a Fact may rest on, though they sit beside the parties' papers. */
const COURT_RECORD = new Set(['order', 'orders', 'summons', 'register', 'docket', 'judgment', 'certificate', 'return', 'waiver', 'transcript']);
/** Words of a DocType that name a party's court paper or position. */
const FILING = new Set([
  'complaint', 'petition', 'counterclaim', 'crossclaim', 'answer', 'motion', 'brief', 'response', 'reply', 'opposition',
  'objection', 'joinder', 'proposed', 'mediation', 'request', 'requests', 'mtd', 'msj', 'mtc', 'mil', 'fac',
  'sac', 'opp', 'resp', 'notice',
]);
/** Words that name a letter, the letters that state a party's position among them. */
const LETTER = new Set(['ltr', 'letter', 'letters', 'correspondence', 'corr', 'demand', 'preservation']);
const PRESS = new Set(['media', 'press', 'news', 'newsletter', 'social', 'blog', 'podcast']);
/** Folder words for the room's own notes and analysis. */
const SUMMARY_FOLDER = /(?:^|[-_ ])(?:orientation|analysis|maps|diagrams|visuals|research|notes|memos|work-?product)(?:$|[-_ ])/;
/** File words for summaries wherever they sit (a short name made of them: "chronology.csv", "CLAUDE.md"). */
const SUMMARY_FILE = new Set(['claude', 'readme', 'catalog', 'chronology', 'glossary', 'deadlines', 'index', 'timeline', 'summary']);
/** A name segment that marks work product ("Claim_Chart__WP__..."; scripts/matter/catalog.ts reads the same marker). */
const WORK_PRODUCT_SEGMENT = /^(?:A?WP|AC-?WP)$/i;
/** Court records that carry a ruling: an order or judgment, the register of actions or a docket, a transcript. */
const RULING_RECORD = new Set(['order', 'orders', 'register', 'docket', 'judgment', 'transcript']);

/** Lowercase words of the file's DocType (the name before the first "__"), extension dropped. */
function typeWords(name: string): string[] {
  const base = name.split('__')[0]!.replace(/\.[A-Za-z0-9]{1,5}$/, ''); // safe: split always yields one element
  return base.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Lowercase folder segments. */
function segments(folder: string | null | undefined): string[] {
  return (folder ?? '').toLowerCase().split('/').filter(Boolean);
}

const hasAny = (words: readonly string[], set: ReadonlySet<string>) => words.some((w) => set.has(w));

/** The kind of source a document is (see SourceKind). Unknown shapes are `record`, as before this check existed. */
export function sourceKind(doc: SourceFields): SourceKind {
  const words = typeWords(doc.name);
  const folders = segments(doc.folder);
  if (folders.some((f) => PRESS.has(f)) || hasAny(words, PRESS)) return 'press';
  if ((hasAny(words, SUMMARY_FILE) && words.length <= 3) || folders.some((f) => SUMMARY_FOLDER.test(f)) || isWorkProduct(doc)) return 'summary';
  // An exhibit is the underlying document, wherever it is filed; an order is the court's, not a party's.
  if (words.includes('exhibit') || folders.some((f) => f === 'exhibits' || f === 'exhibit')) return 'record';
  if (isCourtRecord(doc)) return 'record';
  if (words.includes('eml') || words.some((w) => w.endsWith('mail') || w.endsWith('mails')) || /\.eml$/i.test(doc.name)) return 'email';
  // A side letter is an agreement.
  if (hasAny(words, LETTER) && !words.includes('side')) return 'letter';
  if (hasAny(words, FILING) || folders.some((f) => f.includes('pleading'))) return 'filing';
  if (folders.some((f) => f.includes('correspondence')) && !words.includes('att')) return 'letter';
  return 'record';
}

/** True for the court's own records (an order, judgment, summons, the register, a transcript), never a proposed order. */
export function isCourtRecord(doc: SourceFields): boolean {
  const words = typeWords(doc.name);
  return (hasAny(words, COURT_RECORD) && !words.includes('proposed')) || segments(doc.folder).some((f) => f === 'order' || f === 'orders');
}

/**
 * True for a court record that carries a ruling (an order, a judgment, the register of actions or a docket, a
 * transcript), never a summons, a return or waiver of service, or a certificate: only these support a claim that a
 * court ruled (answer-shape.ts).
 */
export function isRulingRecord(doc: SourceFields): boolean {
  if (!isCourtRecord(doc)) return false;
  return hasAny(typeWords(doc.name), RULING_RECORD) || segments(doc.folder).some((f) => f === 'order' || f === 'orders');
}

/** Folders where the room files official records: public records, filings with a regulator, the court-procedural tab. */
const OFFICIAL_FOLDER = /(?:^|[-_ ])(?:public[-_ ]records?|regulatory[-_ ]filings?|court[-_ ]procedural)$/;

/**
 * True when the document is filed where official records live: a public-records or regulatory-filings folder, the
 * court-procedural tab, or the court's own record (isCourtRecord). A passage that calls itself an official record
 * (provenance.ts selfDescribedOfficialRecord) supports a Fact only here (answer-shape.ts). A "certificate" in the
 * name alone is not enough: that word makes a certificate of service a court record, and would make any file so
 * named an official one.
 */
export function isOfficialHome(doc: SourceFields): boolean {
  if (segments(doc.folder).some((f) => OFFICIAL_FOLDER.test(f))) return true;
  return isCourtRecord(doc) && (isRulingRecord(doc) || !typeWords(doc.name).includes('certificate'));
}

/**
 * True when the room files the document as counsel's work product: a WP marker segment in its name, or "work
 * product" in its type. A folder marked privileged is an access label (privilege.ts) that also holds signed
 * agreements and letters, so it does not make a file work product; a passage that calls itself privileged work
 * product is caught by its text instead (provenance.ts).
 */
export function isWorkProduct(doc: SourceFields): boolean {
  const words = typeWords(doc.name);
  const marked = doc.name.replace(/\.[A-Za-z0-9]{1,5}$/, '').split('__').slice(1).some((s) => WORK_PRODUCT_SEGMENT.test(s));
  return marked || /(?:^| )work ?product(?: |$)/.test(words.join(' '));
}

/** Kinds that state a party's position or report one: a claim resting only on them is attributed, never a Fact. */
export function isPosition(kind: SourceKind): boolean {
  return kind === 'filing' || kind === 'letter' || kind === 'email' || kind === 'press';
}

/** "DRAFT" in capitals as its own word anywhere in the name ("Complaint__20120719__Moe_DRAFT.docx"). */
const DRAFT_TOKEN = /(?:^|[^A-Za-z0-9])DRAFT(?:[^A-Za-z0-9]|$)/;

/**
 * True when the document is a draft: a "drafts" folder, "draft" in its type, or the DRAFT mark in its name. A
 * lower-case "draft" outside the type ("EML__20120611__Draft_Patch_Estimate") names the subject of an
 * email or letter, not the document, so only the capitals count there.
 */
export function isDraft(doc: SourceFields): boolean {
  return isWorkingDraft(doc) || typeWords(doc.name).includes('draft') || DRAFT_TOKEN.test(doc.name);
}

/** Types a draft is named by in an attribution ("a draft complaint"); any other draft filing is "a draft filing". */
const DRAFT_NOUN = new Set(['complaint', 'petition', 'counterclaim', 'answer', 'motion', 'brief', 'response', 'reply', 'opposition', 'objection']);

/** How an attribution names drafts: "a draft complaint" when every one is of that type, else "a draft filing". */
export function draftNoun(docs: readonly SourceFields[]): string {
  const nouns = new Set(docs.map((doc) => typeWords(doc.name).find((w) => DRAFT_NOUN.has(w)) ?? 'filing'));
  const [only] = nouns;
  return `a draft ${nouns.size === 1 && only ? only : 'filing'}`;
}

/**
 * True for counsel's own working drafts: a document in a "drafts" folder. Never a Fact (answer-shape.ts). A draft
 * filed as evidence (an agreement's draft one party sent another, in an evidence folder) is a record of that draft.
 */
export function isWorkingDraft(doc: SourceFields): boolean {
  return segments(doc.folder).some((f) => f === 'drafts' || f === 'draft');
}

/**
 * Who an attributed claim is attributed to ("According to an email, ..."), from the kinds of its sources. `speaker`
 * names who wrote a letter or email when every cited one has the same kind of writer (speaker.ts): "the other side's
 * counsel", so a party's own letter reads as that party's statement. `draft` is true, or draftNoun's words, when
 * every cited filing is a draft: a draft is never "a party's filing".
 */
export function attributionNoun(kinds: readonly SourceKind[], draft: boolean | string = false, speaker: string | null = null): string {
  const distinct = [...new Set(kinds)];
  if (distinct.length !== 1) return 'the cited documents';
  const from = speaker ? ` from ${speaker}` : '';
  switch (distinct[0]) {
    case 'filing':
      if (typeof draft === 'string') return draft;
      return draft ? 'a draft filing' : "a party's filing";
    case 'letter':
      return `a letter${from}`;
    case 'email':
      return `an email${from}`;
    case 'press':
      return 'a press report';
    default:
      return 'the cited document';
  }
}
