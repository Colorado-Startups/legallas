// SPDX-License-Identifier: Apache-2.0
// Ask's prompt-injection quarantine (worker/quarantine.ts) on what the tools send to a member's own AI app. Ask fences a
// passage that addresses an AI, or reads as a court order outside the court's record, under an "untrusted" header,
// keeps it out of the cite book and adds a reminder before the question. A tool result gets the same three things:
//
// | Ask (worker/prompt.ts)                | A tool result                                                            |
// |---------------------------------------|--------------------------------------------------------------------------|
// | "untrusted" block header              | `<case-record untrusted="...">` fence, and `untrusted` on the item       |
// | no document id, not in the cite book  | the item loses its cite fields: control number, page, room link, cites   |
// | UNTRUSTED_REMINDER, UNFILED_ORDER_... | `untrusted_note`, first in the result: the same reminders, word for word |
//
// The judgment is quarantine.ts's own call, never a copy of its rules. format.ts caseData judges every string it fences,
// so no tool can send case text that was not judged; tools judge a whole page or passage when they send part of it.
import { quarantine } from '../worker/quarantine.ts';
import { UNFILED_ORDER, UNFILED_ORDER_REMINDER, UNTRUSTED_REMINDER } from '../worker/prompt.ts';
import type { SourceFields } from '../worker/source-kind.ts';

/** Why a text is untrusted: it addresses AI tools, or it reads as a court's order but is not in the court's record. */
export type Untrusted = 'addressed-to-ai' | typeof UNFILED_ORDER;

/** Every mark, in Ask's order: quarantine.ts tests for words to a model first. */
export const UNTRUSTED_MARKS: readonly Untrusted[] = ['addressed-to-ai', UNFILED_ORDER];

/**
 * Why `text` is untrusted, or null: quarantine.ts on one passage. With its document (name and folder), a court order
 * outside the court's record counts too; without, the words alone decide, as in quarantine.ts.
 */
export function untrustedReason(text: string, doc?: SourceFields): Untrusted | null {
  const [marked] = quarantine([{ text }], doc ? () => doc : undefined).chunks;
  if (marked?.unfiledRuling) return UNFILED_ORDER;
  return marked?.untrusted ? 'addressed-to-ai' : null;
}

/** The fence's closing tag. A text cannot close it early: caseData escapes any closing tag inside. */
export const CLOSE = '\n</case-record>';

/** The fence's opening tag: plain for case text, with its mark for untrusted text. */
export function openTag(reason: Untrusted | null): string {
  return reason ? `<case-record untrusted="${reason}">\n` : '<case-record>\n';
}

const OPENING = /^<case-record(?: untrusted="(addressed-to-ai|unfiled-court-order)")?>\n/;

/** A fenced string's opening tag, the text inside and its mark, or null for a string caseData did not fence. */
export function fenceOf(text: string): { open: string; inner: string; reason: Untrusted | null } | null {
  const open = OPENING.exec(text);
  if (!open || !text.endsWith(CLOSE) || text.length < open[0].length + CLOSE.length) return null;
  return { open: open[0], inner: text.slice(open[0].length, -CLOSE.length), reason: (open[1] as Untrusted | undefined) ?? null };
}

/** Ask's reminders (worker/prompt.ts), word for word, by the mark they explain. */
export const UNTRUSTED_NOTES: Readonly<Record<Untrusted, string>> = {
  'addressed-to-ai': UNTRUSTED_REMINDER,
  [UNFILED_ORDER]: UNFILED_ORDER_REMINDER,
};

/** The key of the note a result carries when it holds untrusted text. */
export const NOTE_KEY = 'untrusted_note';

/** Every mark on a fenced string inside `value`, in Ask's order. */
export function untrustedIn(value: unknown): Untrusted[] {
  const found = new Set<Untrusted>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      const reason = fenceOf(v)?.reason;
      if (reason) found.add(reason);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(walk);
    }
  };
  walk(value);
  return UNTRUSTED_MARKS.filter((mark) => found.has(mark));
}

/** The reminders for `marks`, in Ask's order, or null for none. */
export function untrustedNote(marks: readonly Untrusted[]): string | null {
  const notes = UNTRUSTED_MARKS.filter((mark) => marks.includes(mark)).map((mark) => UNTRUSTED_NOTES[mark]);
  return notes.length ? notes.join(' ') : null;
}

/**
 * `value` with its note first, for the marks it holds (or `marks`, when a tool sizes a result before its items are
 * chosen), and without one when it holds none. An earlier note is replaced, so a tool can note a page again once fitted.
 */
export function noted<T extends Record<string, unknown>>(value: T, marks: readonly Untrusted[] = untrustedIn(value)): T {
  const { [NOTE_KEY]: _old, ...rest } = value;
  const note = untrustedNote(marks);
  return (note ? { [NOTE_KEY]: note, ...rest } : rest) as unknown as T;
}

/** Characters the note for `marks` adds at the top of a result's text (jsonResult's indented JSON): what a fit leaves for it. */
export function noteChars(marks: readonly Untrusted[]): number {
  const note = untrustedNote(marks);
  return note ? JSON.stringify({ [NOTE_KEY]: note, x: 0 }, null, 2).length - JSON.stringify({ x: 0 }, null, 2).length : 0;
}

/** The fields a model cites by: a control number, a page, a room link, a document id in a cite, a cite or a list of them. */
const CITE_FIELDS: ReadonlySet<string> = new Set(['control', 'page', 'link', 'doc', 'cite', 'cites']);

/**
 * `value` with every object that holds untrusted text as one of its own fields marked `untrusted` (the first mark, in
 * Ask's order) and stripped of its cite fields, so the text is never offered as citable. `keep` names cite fields an item
 * keeps: a page entry keeps its page number, which places it among the pages read. Ids stay, so a person can find it.
 */
export function markUntrusted<T>(value: T, keep: readonly string[] = []): T {
  if (Array.isArray(value)) return value.map((item) => markUntrusted(item, keep)) as T;
  if (!value || typeof value !== 'object') return value;
  const fields: [string, unknown][] = Object.entries(value);
  const marks = new Set(fields.flatMap(([, field]) => (typeof field === 'string' ? [fenceOf(field)?.reason] : [])));
  const reason = UNTRUSTED_MARKS.find((mark) => marks.has(mark));
  const out: Record<string, unknown> = {};
  for (const [key, field] of fields) {
    if (reason && CITE_FIELDS.has(key) && !keep.includes(key)) continue;
    out[key] = markUntrusted(field, keep);
  }
  if (reason) out.untrusted = reason;
  return out as unknown as T;
}
