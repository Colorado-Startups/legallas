// SPDX-License-Identifier: Apache-2.0
// A production volume (litigation room, card #126; research F2, F3, F4, D1), from the documents counsel produces:
//
// | File | Holds |
// |---|---|
// | TEXT/<number>.txt | The text, pages split by form feeds |
// | IMAGES/<number>.pdf | That text drawn as pages, the number at the lower right of each |
// | DATA/<volume>.dat | Concordance load file: UTF-8 with a byte order mark, one header row, þ quotes, DC4 between fields |
// | DATA/<volume>.opt | Opticon image file: seven fields a line, one line a page |
//
// Redacted spans become a label before anything is written. Elsewhere in that document, metadata included, the same
// words and any code in them (letters and digits, like an account number) are replaced too, so they are in no file. Pure: the caller reads page text from R2
// and metadata from D1, and refuses a volume while `problems` has anything in it.
import { formatControl } from '../export.ts';

export const REDACTION_BASES = {
  attorney_client: 'Attorney-client privilege',
  work_product: 'Work product',
  personal_identifier: 'Personal identifier',
  order: 'Protective order',
} as const;
export type RedactionBasis = keyof typeof REDACTION_BASES;

/** A redacted span: characters start (inclusive) to end (exclusive) of a page's text, pages from 1. */
export interface Redaction {
  page: number;
  start: number;
  end: number;
  basis: RedactionBasis;
}

export interface ProductionItem {
  seq: number;
  pages: readonly string[];
  redactions: readonly Redaction[];
  custodian: string;
  fileName: string;
  /** YYYY-MM-DD, or '' when undated. */
  date: string;
  /** The stored SHA-256 of the native. */
  sha256: string;
}

export const DAT_FIELDS = ['BEGBATES', 'ENDBATES', 'PAGECOUNT', 'CUSTODIAN', 'FILENAME', 'DATE', 'SHA256', 'REDACTED', 'TEXTPATH', 'IMAGEPATH'] as const;

export type ProductionProblem =
  | { problem: 'bad_volume' }
  | { problem: 'twice' | 'bad_redaction' | 'bad_metadata'; seq: number };

const QUOTE = 'þ';
const FIELD = '\u0014';
const VOLUME = /^[A-Z0-9_]{1,20}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const encoder = new TextEncoder();

const label = (basis: RedactionBasis) => `[REDACTED: ${REDACTION_BASES[basis]}]`;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wholeWord = (words: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(words)}(?![\\p{L}\\p{N}])`, 'giu');
const TOKEN = /[\p{L}\p{N}]+(?:[-_./][\p{L}\p{N}]+)*/gu;
/** Codes, account numbers and canaries: 4 or more characters mixing letters and digits. */
const identifiers = (text: string) => (text.match(TOKEN) ?? []).filter((t) => t.length >= 4 && /\p{L}/u.test(t) && /\p{N}/u.test(t));

function validRedactions(item: ProductionItem): boolean {
  const byPage = new Map<number, Redaction[]>();
  for (const r of item.redactions) {
    const text = item.pages[r.page - 1];
    const ok = text !== undefined && Number.isSafeInteger(r.start) && Number.isSafeInteger(r.end) && r.start >= 0 && r.start < r.end && r.end <= text.length;
    if (!ok || !Object.hasOwn(REDACTION_BASES, r.basis)) return false;
    byPage.set(r.page, [...(byPage.get(r.page) ?? []), r]);
  }
  for (const spans of byPage.values()) {
    spans.sort((a, b) => a.start - b.start);
    if (spans.some((r, i) => i > 0 && r.start < spans[i - 1]!.end)) return false;
  }
  return true;
}

/** The pages and metadata with every redacted span replaced, and elsewhere its words and any code in it. */
function redact(item: ProductionItem): { pages: string[]; fileName: string; custodian: string } {
  const scrubs: [RegExp, string][] = [];
  const pages = item.pages.map((text, i) => {
    const spans = item.redactions.filter((r) => r.page === i + 1).sort((a, b) => b.start - a.start);
    for (const r of spans) {
      const words = text.slice(r.start, r.end).trim();
      for (const part of words ? [words, ...identifiers(words)] : []) scrubs.push([wholeWord(part), label(r.basis)]);
      text = text.slice(0, r.start) + label(r.basis) + text.slice(r.end);
    }
    return text;
  });
  const scrub = (text: string) => scrubs.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
  return { pages: pages.map(scrub), fileName: scrub(item.fileName), custodian: scrub(item.custodian) };
}

// The image: Courier 9 pt on US Letter, 93 characters a line, 60 lines a page, each source page on a new one.
const WIDTH = 93;
const LINES = 60;

/** Lines of at most WIDTH characters, broken at a space where there is one, so words stay whole and searchable. */
function wrap(text: string): string[] {
  const out: string[] = [];
  for (const line of text.replace(/\t/g, ' ').split(/\r?\n/)) {
    let rest = line;
    while (rest.length > WIDTH) {
      const space = rest.lastIndexOf(' ', WIDTH);
      const cut = space > 0 ? space : WIDTH;
      out.push(rest.slice(0, cut));
      rest = rest.slice(space > 0 ? cut + 1 : cut);
    }
    out.push(rest);
  }
  return out;
}

/** One WinAnsi character a byte: printable ASCII and Latin-1 kept, anything else drawn as ?. */
const pdfText = (text: string) =>
  Array.from(text, (ch) => {
    const code = ch.codePointAt(0)!;
    return (code >= 0x20 && code < 0x7f) || (code >= 0xa0 && code <= 0xff) ? ch : '?';
  })
    .join('')
    .replace(/[\\()]/g, '\\$&');

/** A PDF of the text, and its page count. */
function image(pages: readonly string[], control: string): { bytes: Uint8Array; count: number } {
  const sheets = pages.flatMap((page) => {
    const lines = wrap(page);
    return Array.from({ length: Math.max(1, Math.ceil(lines.length / LINES)) }, (_, i) => lines.slice(i * LINES, (i + 1) * LINES));
  });
  const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>'];
  const kids: string[] = [];
  for (const lines of sheets) {
    const body = lines.map((line, i) => `BT /F1 9 Tf 54 ${738 - i * 11.4} Td (${pdfText(line)}) Tj ET`).join('\n') + `\nBT /F1 9 Tf 450 30 Td (${pdfText(control)}) Tj ET`;
    objects.push(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length} 0 R >>`);
    kids.push(`${objects.length} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { bytes: Uint8Array.from(pdf, (ch) => ch.charCodeAt(0)), count: kids.length };
}

/** A load-file value: no quote, separator or line break inside. */
const field = (value: string) => value.replace(/[þ\u0014\r\n]+/g, ' ');

/** The volume's files by path, or every problem that stops it. */
export function buildProduction(
  volume: string,
  prefix: string,
  items: readonly ProductionItem[],
): { ok: true; files: Map<string, Uint8Array> } | { ok: false; problems: ProductionProblem[] } {
  const problems: ProductionProblem[] = [];
  if (!VOLUME.test(volume)) problems.push({ problem: 'bad_volume' });
  const seen = new Set<number>();
  for (const item of items) {
    if (seen.has(item.seq)) problems.push({ problem: 'twice', seq: item.seq });
    seen.add(item.seq);
    if (!validRedactions(item)) problems.push({ problem: 'bad_redaction', seq: item.seq });
    if (formatControl(prefix, item.seq) === '' || !SHA256.test(item.sha256) || (item.date !== '' && !DATE.test(item.date)) || item.pages.length === 0) {
      problems.push({ problem: 'bad_metadata', seq: item.seq });
    }
  }
  if (problems.length > 0) return { ok: false, problems };

  const files = new Map<string, Uint8Array>();
  const dat = [DAT_FIELDS as readonly string[]];
  const opt: string[] = [];
  for (const item of [...items].sort((a, b) => a.seq - b.seq)) {
    const control = formatControl(prefix, item.seq);
    const { pages, fileName, custodian } = redact(item);
    const pdf = image(pages, control);
    files.set(`TEXT/${control}.txt`, encoder.encode(pages.join('\f')));
    files.set(`IMAGES/${control}.pdf`, pdf.bytes);
    const date = DATE.exec(item.date);
    dat.push([
      control, control, String(pdf.count), custodian.trim() || 'Unknown', fileName, date ? `${date[2]}/${date[3]}/${date[1]}` : '', item.sha256,
      item.redactions.length > 0 ? 'Y' : 'N', `TEXT\\${control}.txt`, `IMAGES\\${control}.pdf`,
    ]);
    for (let page = 1; page <= pdf.count; page++) {
      const key = page === 1 ? control : `${control}-${String(page).padStart(4, '0')}`;
      opt.push([key, volume, `IMAGES\\${control}.pdf`, page === 1 ? 'Y' : '', '', '', page === 1 ? String(pdf.count) : ''].join(','));
    }
  }
  const lines = dat.map((cells) => cells.map((cell) => `${QUOTE}${field(cell)}${QUOTE}`).join(FIELD));
  files.set(`DATA/${volume}.dat`, encoder.encode(`\uFEFF${lines.join('\r\n')}\r\n`));
  files.set(`DATA/${volume}.opt`, encoder.encode(`${opt.join('\r\n')}\r\n`));
  return { ok: true, files };
}
