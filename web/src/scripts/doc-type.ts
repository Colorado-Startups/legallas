// SPDX-License-Identifier: Apache-2.0
// One rule for showing a document type (R64, card Q2), shared by Documents, the exhibit pane, the Overview
// feed, the doc page, the brief and the printed outline. Files follow DocType_Abbr__YYYYMMDD__Party__Qualifier
// (scripts/matter/catalog.ts): the DocType is terse ("Order_Compel", "Response-to-MTD", "Invoice-INV") and the
// Abbr is the file's own short code. Only generic legal document types live here, never names from a matter.

/** Generic abbreviations a DocType may use, as the words they stand for. */
const ABBREVIATIONS: Readonly<Record<string, string>> = {
  AFF: 'affidavit',
  AGMT: 'agreement',
  CMO: 'case management order',
  CORR: 'correspondence',
  DECL: 'declaration',
  DEPO: 'deposition',
  EML: 'email',
  EXH: 'exhibit',
  FAC: 'first amended complaint',
  LOI: 'letter of intent',
  LPA: 'limited partnership agreement',
  LTR: 'letter',
  MEM: 'memo',
  MIL: 'motion in limine',
  MOU: 'memorandum of understanding',
  MSJ: 'motion for summary judgment',
  MTC: 'motion to compel',
  MTD: 'motion to dismiss',
  NDA: 'nondisclosure agreement',
  OA: 'operating agreement',
  OPP: 'opposition',
  PPM: 'private placement memorandum',
  RESP: 'response',
  RFA: 'requests for admission',
  RFP: 'requests for production',
  ROG: 'interrogatories',
  ROGS: 'interrogatories',
  SAC: 'second amended complaint',
  STIP: 'stipulation',
  TRO: 'temporary restraining order',
  WP: 'work product',
};

/** Whole DocTypes that read better as a phrase than word by word (keys are lowercase words). */
const PHRASES: Readonly<Record<string, string>> = {
  'motion compel': 'motion to compel',
  'order compel': 'order compelling discovery',
  'order mil': 'order on the motion in limine',
  'order msj': 'order on the motion for summary judgment',
  'order mtc': 'order on the motion to compel',
  'order mtd': 'order on the motion to dismiss',
};

/** Words that never start a title alone; a trailing code after one of them is part of the type. */
const CONNECTORS = new Set(['to', 'of', 'for', 'on', 'in', 're', 'and', 'the']);
/** A trailing code the convention's "_" joins to the DocType: the file's Abbr ("Operating_Agreement_OA"). */
const UNDERSCORE_CODE = /_[A-Z][A-Z0-9]{1,5}$/;

/** Words of a DocType: underscores, spaces and hyphens split, but "W-9" and "W-2" stay whole. */
function words(type: string): string[] {
  return type.split(/[_\s]+|-(?!\d)/).filter(Boolean);
}

const isCode = (word: string) => /^[A-Z][A-Z0-9]{1,5}$/.test(word);
const initials = (list: readonly string[]) => list.map((w) => w[0]!.toUpperCase()).join('');
const lower = (list: readonly string[]) => list.join(' ').toLowerCase();

/** Expands known abbreviations word by word ("Response to MTD" reads "Response to motion to dismiss"). */
function expand(list: readonly string[]): string[] {
  const phrase = PHRASES[lower(list)];
  if (phrase) return phrase.split(' ');
  return list.flatMap((word) => ABBREVIATIONS[word.toUpperCase()]?.split(' ') ?? [word]);
}

/**
 * Drops the trailing Abbr when it is the file's own code ("Operating_Agreement_OA", "Memo_MEM", an unknown
 * code), keeps it when it carries meaning ("Order_MTD", "Response_to_MTD"), and prefers it when it names a
 * more specific form of the head ("Complaint_FAC" is a first amended complaint).
 */
function withoutAbbr(list: string[]): string[] {
  const last = list.at(-1);
  if (list.length < 2 || !last || !isCode(last)) return list;
  const head = list.slice(0, -1);
  if (CONNECTORS.has(head.at(-1)!.toLowerCase()) || PHRASES[lower(list)]) return list;
  const meaning = ABBREVIATIONS[last];
  if (!meaning || initials(head) === last || meaning === lower(head)) return head;
  return meaning.endsWith(lower(head)) ? meaning.split(' ') : list;
}

/** Title Case from a file name ("Repair Ticket") becomes sentence case; codes and W-9 keep their capitals. */
function sentenceCase(list: readonly string[], titleCase: boolean): string {
  const out = list.map((word, i) => {
    if (i === 0) return word[0]!.toUpperCase() + word.slice(1);
    const plain = /^\p{Lu}\p{Ll}+$/u.test(word);
    return titleCase && plain ? word.toLowerCase() : word;
  });
  return out.join(' ');
}

/** True when every word but small connectors is capitalized: the filename convention, not a written type. */
function isTitleCase(list: readonly string[]): boolean {
  return list.every((word) => CONNECTORS.has(word.toLowerCase()) || /^[\p{Lu}\d]/u.test(word));
}

/**
 * A document type in words, the one rule every room page uses: the filename convention's DocType reads as
 * words ("Supply-Agreement" reads "Supply agreement", "Invoice-INV" reads "Invoice INV"), known abbreviations
 * are spelled out ("Order Compel" reads "Order compelling discovery", "WP" reads "Work product"), a hyphen
 * with a digit after it stays ("W-9"), and a type already written as prose is kept. A trailing code joined
 * by "_" is the file's Abbr and is dropped when it is only the file code ("Operating_Agreement_OA"); a code
 * joined by a hyphen or a space is part of the type. A trailing "(work product)" is kept.
 */
export function docTypeWords(type: string): string {
  const marked = /\s*\(work product\)\s*$/i.exec(type);
  const base = marked ? type.slice(0, marked.index) : type;
  const list = words(base);
  if (list.length === 0) return type.trim();
  const titleCase = isTitleCase(list);
  const typed = UNDERSCORE_CODE.test(base.trim()) ? withoutAbbr(list) : list;
  const title = sentenceCase(expand(typed), titleCase);
  return marked ? `${title} (work product)` : title;
}
