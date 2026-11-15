// SPDX-License-Identifier: Apache-2.0
// The litigation room's privilege log (card #126): counsel's entries over the register (register.ts), exported only
// when every check passes. The room reports facts and a lawyer decides: nothing here says a document is privileged
// or a log is enough (product notices A1). Pure: the caller reads D1 and R2.
//
// | Check | Research | Problems |
// |---|---|---|
// | Each withheld number is in exactly one entry, a redacted one in at most one | L1 | not_logged, logged_twice |
// | Each entry's range is real, and every number in it withheld or redacted | L2 | bad_range, not_withheld |
// | Each entry states a basis from BASES | L4 | no_basis |
// | Each entry names a lawyer or says why not, and every name is a player | L5, L7 | no_lawyer, not_a_lawyer, unknown_player |
// | No text cell repeats an identifier or an 8-word run from any withheld or redacted text | L11 | leak |
// | Exports as .csv and .xlsx, one header row, one row per entry | L12 | |
//
// Problems name an entry (1-based, in the order given) and a column or number, never the text.
import { csvCell, formatControl } from '../export.ts';
import { xlsx } from '../xlsx.ts';
import type { NumberState, RegisterRow } from './register.ts';

export const BASES = {
  attorney_client: 'Attorney-client privilege',
  work_product: 'Work product',
  common_interest: 'Common interest',
} as const;
export type Basis = keyof typeof BASES;

/** One person in the players list (the log's legend). */
export interface Player {
  id: string;
  name: string;
  title: string;
  affiliation: string;
  lawyer: boolean;
}

/** One entry as counsel writes it. People are player ids. */
export interface LogEntry {
  begin: number;
  end: number;
  /** YYYY-MM-DD, or '' when undated. */
  date: string;
  docType: string;
  authors: readonly string[];
  recipients: readonly string[];
  basis: readonly Basis[];
  /** Each a player flagged as a lawyer. */
  lawyers: readonly string[];
  /** Why no lawyer is named; '' when one is. */
  noLawyerReason: string;
  description: string;
}

export interface LogInput {
  prefix: string;
  register: readonly RegisterRow[];
  entries: readonly LogEntry[];
  players: readonly Player[];
  /** The protected text behind a number: a withheld document's text, or a redacted one's redacted passages. */
  protectedText(seq: number): string;
}

export type LogProblem =
  | { problem: 'not_logged' | 'logged_twice'; seq: number }
  | { problem: 'bad_range' | 'bad_date' | 'no_basis' | 'no_lawyer'; entry: number }
  | { problem: 'not_withheld'; entry: number; seq: number }
  | { problem: 'unknown_player' | 'not_a_lawyer'; entry: number; player: string }
  | { problem: 'leak'; entry: number; column: (typeof LOG_HEADER)[number] };

export const LOG_HEADER = [
  'Entry', 'Begin', 'End', 'Date', 'Document type', 'Authors', 'Recipients', 'Withheld or redacted', 'Basis', 'Lawyer',
  'Why no lawyer is named', 'Description',
] as const;
/** Columns the room fills from checked numbers and dates; every other cell is checked for leaks. */
const STRUCTURED = 4;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A token keeps its inner - _ . /, so a code stays whole; its words are matched too. */
const TOKEN = /[\p{L}\p{N}]+(?:[-_./][\p{L}\p{N}]+)*/gu;
const WORD = /[\p{L}\p{N}]+/gu;
/** A shared run this long is copied text, not a description that happens to use the same words. */
const RUN = 8;

const fold = (text: string) => text.normalize('NFKC').toLowerCase();

/** Codes, account numbers and canaries: 4 or more characters mixing letters and digits, ordinals ("10th") aside. */
function identifiers(text: string): string[] {
  const folded = fold(text);
  const tokens = (folded.match(TOKEN) ?? []).map((t) => t.replace(/[_./]/g, '-'));
  return [...tokens, ...(folded.match(WORD) ?? [])].filter(
    (t) => t.length >= 4 && /\p{L}/u.test(t) && /\p{N}/u.test(t) && !/^\d+(?:st|nd|rd|th)$/.test(t),
  );
}

function runs(text: string): string[] {
  const words = fold(text).match(WORD) ?? [];
  const out: string[] = [];
  for (let i = 0; i + RUN <= words.length; i++) out.push(words.slice(i, i + RUN).join(' '));
  return out;
}

/** What no cell may repeat from the protected text: its identifiers and its 8-word runs. */
function fingerprint(text: string): { ids: Set<string>; runs: Set<string> } {
  return { ids: new Set(identifiers(text)), runs: new Set(runs(text)) };
}

function leaks(cell: string, print: ReturnType<typeof fingerprint>): boolean {
  return identifiers(cell).some((t) => print.ids.has(t)) || runs(cell).some((r) => print.runs.has(r));
}

const isSeq = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** The numbers an entry covers, or null when its range is not one the register can hold. */
function span(entry: LogEntry, registerSize: number): number[] | null {
  if (!isSeq(entry.begin) || !isSeq(entry.end) || entry.begin > entry.end || entry.end - entry.begin >= registerSize) return null;
  return Array.from({ length: entry.end - entry.begin + 1 }, (_, i) => entry.begin + i);
}

const KIND = { withheld: 'Withheld', redacted: 'Redacted' } as const;

/** Every problem with the log, in entry order then number order. None means it may be exported. */
export function logProblems(input: LogInput): LogProblem[] {
  const look = lookup(input);
  const { states, players } = look;
  const counts = new Map<number, number>();
  const problems: LogProblem[] = [];
  const isProtected = (state: string) => state === 'withheld' || state === 'redacted';
  const print = fingerprint(input.register.filter((r) => isProtected(r.state)).map((r) => input.protectedText(r.seq)).join('\n'));
  input.entries.forEach((entry, i) => {
    const n = i + 1;
    const numbers = span(entry, input.register.length);
    if (!numbers) problems.push({ problem: 'bad_range', entry: n });
    for (const seq of numbers ?? []) {
      const state = states.get(seq);
      if (!state || !isProtected(state)) problems.push({ problem: 'not_withheld', entry: n, seq });
      counts.set(seq, (counts.get(seq) ?? 0) + 1);
    }
    if (entry.date !== '' && !DATE.test(entry.date)) problems.push({ problem: 'bad_date', entry: n });
    if (entry.basis.length === 0 || entry.basis.some((b) => !Object.hasOwn(BASES, b))) problems.push({ problem: 'no_basis', entry: n });
    if (entry.lawyers.length === 0 && entry.noLawyerReason.trim() === '') problems.push({ problem: 'no_lawyer', entry: n });
    for (const id of new Set([...entry.authors, ...entry.recipients, ...entry.lawyers])) {
      if (!players.has(id)) problems.push({ problem: 'unknown_player', entry: n, player: id });
    }
    for (const id of entry.lawyers) if (players.get(id)?.lawyer === false) problems.push({ problem: 'not_a_lawyer', entry: n, player: id });
    row(look, entry, n).forEach((cell, c) => {
      if (c >= STRUCTURED && leaks(cell, print)) problems.push({ problem: 'leak', entry: n, column: LOG_HEADER[c]! });
    });
  });
  for (const { seq, state } of input.register) {
    const count = counts.get(seq) ?? 0;
    if (state === 'withheld' && count === 0) problems.push({ problem: 'not_logged', seq });
    if (isProtected(state) && count > 1) problems.push({ problem: 'logged_twice', seq });
  }
  return problems;
}

interface Lookup {
  prefix: string;
  states: ReadonlyMap<number, NumberState>;
  players: ReadonlyMap<string, Player>;
}

function lookup(input: LogInput): Lookup {
  return { prefix: input.prefix, states: new Map(input.register.map((r) => [r.seq, r.state])), players: new Map(input.players.map((p) => [p.id, p])) };
}

/** One entry as its export row, in LOG_HEADER's order. */
function row(look: Lookup, entry: LogEntry, n: number): string[] {
  const names = (ids: readonly string[]) => ids.map((id) => look.players.get(id)?.name ?? '').join('; ');
  const states = new Set((span(entry, look.states.size) ?? []).map((seq) => look.states.get(seq)));
  const kind = (['withheld', 'redacted'] as const).filter((s) => states.has(s)).map((s) => KIND[s]);
  return [
    String(n),
    formatControl(look.prefix, entry.begin),
    formatControl(look.prefix, entry.end),
    entry.date,
    entry.docType,
    names(entry.authors),
    names(entry.recipients),
    kind.join(' and '),
    entry.basis.map((b) => BASES[b] ?? '').join('; '),
    names(entry.lawyers),
    entry.noLawyerReason,
    entry.description,
  ];
}

export type LogExport =
  | { ok: true; csv: string; xlsx: Uint8Array; entries: number; withoutLawyer: number }
  | { ok: false; problems: LogProblem[] };

/** The log as .csv (UTF-8 with a byte order mark, CRLF) and .xlsx, or every problem that stops it. */
export function exportLog(input: LogInput): LogExport {
  const problems = logProblems(input);
  if (problems.length > 0) return { ok: false, problems };
  const look = lookup(input);
  const rows = [[...LOG_HEADER], ...input.entries.map((entry, i) => row(look, entry, i + 1))];
  return {
    ok: true,
    csv: `\uFEFF${rows.map((cells) => cells.map(csvCell).join(',')).join('\r\n')}\r\n`,
    xlsx: xlsx('Privilege log', rows),
    entries: input.entries.length,
    withoutLawyer: input.entries.filter((entry) => entry.lawyers.length === 0).length,
  };
}
