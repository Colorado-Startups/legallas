// SPDX-License-Identifier: Apache-2.0
// A tool result as the tool-step model reads it: compact, so four steps stay inside the question's ceiling
// (ceiling.ts), and safe. Links and fetch dates go (the model only chooses the next tool); document ids become this
// turn's aliases (evidence.ts); any string that addresses AI tools is withheld (worker/quarantine.ts) so it can never
// steer the next tool call; and the whole result is fitted to TOOL_RESULT_CHARS, still as JSON. The final answer never
// reads this text: it reads the evidence book.
import type { CallToolResult } from '@modelcontextprotocol/server';
import { CLOSE, fenceOf } from '../../../mcp/untrusted.ts';
import { addressesModel } from '../../quarantine.ts';
import { TOOL_RESULT_CHARS } from '../ceiling.ts';
import type { Evidence } from './evidence.ts';

/** Keys the tool-step model has no use for. */
const DROPPED = new Set(['link', 'source_url', 'retrieved', 'updated', 'notice', 'next_cursor']);
/** What a withheld passage reads as. Said plainly, so the model can tell the member's question is not answered by it. */
export const WITHHELD = '[withheld: this passage addresses AI tools, so it is not evidence]';
const CUT = ' [cut]';
const DOC_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** How short a string gets when a result is still too long once its passages are shortened. */
const SHORTEST_STRING = 60;
/** The list lengths tried after that, longest first. */
const LIST_CAPS = [16, 8, 4, 2, 1] as const;
/** Fields a cut would make useless: what the model passes back to a tool or cites by. */
const WHOLE = new Set(['id', 'doc', 'control', 'nextCursor']);

/** True for an object that describes a document: search passages and document rows carry a control number. */
function isDocument(value: Record<string, unknown>): boolean {
  return 'control' in value && typeof value.id === 'string';
}

/** Mints aliases for the document ids a result carries: `id` in a document object, and every `doc`. */
function learnIds(value: unknown, evidence: Evidence): void {
  if (Array.isArray(value)) return value.forEach((item) => learnIds(item, evidence));
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (isDocument(record) && DOC_ID.test(record.id as string)) evidence.alias(record.id as string);
  if (typeof record.doc === 'string' && DOC_ID.test(record.doc)) evidence.alias(record.doc);
  for (const child of Object.values(record)) learnIds(child, evidence);
}

/** Every aliased id inside `text` replaced by its alias. */
function aliasText(text: string, evidence: Evidence, ids: readonly string[]): string {
  let out = text;
  for (const id of ids) if (out.includes(id)) out = out.split(id).join(evidence.alias(id));
  return out;
}

/**
 * The result's value with dropped keys gone, ids aliased, and any string that addresses the model withheld: a
 * passage, and equally a title, a label or a summary, since a document's own words can sit in any field.
 */
function rewrite(value: unknown, evidence: Evidence, ids: readonly string[]): unknown {
  if (typeof value === 'string') return addressesModel(value) ? WITHHELD : aliasText(value, evidence, ids);
  if (Array.isArray(value)) return value.map((item) => rewrite(item, evidence, ids));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
    if (!DROPPED.has(name)) out[name] = rewrite(child, evidence, ids);
  }
  return out;
}

/** A string's own characters, without the case-data fence around it (mcp/format.ts caseData) when it has one. */
function inside(text: string): string {
  return fenceOf(text)?.inner ?? text;
}

/**
 * A string with at most `max` characters of its own, marked when cut. A fence marks text as evidence and not
 * instructions, so it stays whole around whatever is left.
 */
function capString(text: string, max: number): string {
  const fence = fenceOf(text);
  const inner = fence?.inner ?? text;
  if (inner.length <= max) return text;
  const kept = inner.endsWith(CUT) ? inner.slice(0, -CUT.length) : inner;
  const cut = `${kept.slice(0, max).trimEnd()}${CUT}`;
  return fence ? `${fence.open}${cut}${CLOSE}` : cut;
}

/** Halves every long `text` field (never below 200 characters of its own), marking each cut. */
function shrinkTexts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shrinkTexts);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
    if (name === 'text' && typeof child === 'string' && inside(child).length > 400) {
      out[name] = capString(child, Math.max(200, Math.floor(inside(child).length / 2)));
    } else out[name] = shrinkTexts(child);
  }
  return out;
}

/** `text` cut to `max` characters, marked. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - CUT.length)}${CUT}`;
}

/** `value` with every string capped, or, given `listMax`, every list too, apart from the WHOLE fields. */
function capped(value: unknown, stringMax: number, listMax = Infinity): unknown {
  if (typeof value === 'string') return capString(value, stringMax);
  if (Array.isArray(value)) return value.slice(0, listMax).map((item) => capped(item, stringMax, listMax));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
    out[name] = WHOLE.has(name) ? child : capped(child, stringMax, listMax);
  }
  return out;
}

/** `value` as JSON within `max` with the highest string cap that fits (so the least is cut), or null when none does. */
function fitStrings(value: unknown, max: number): string | null {
  let best: string | null = null;
  let low = SHORTEST_STRING;
  let high = max;
  while (low <= high) {
    const cap = Math.floor((low + high) / 2);
    const text = JSON.stringify(capped(value, cap));
    if (text.length <= max) {
      best = text;
      low = cap + 1;
    } else high = cap - 1;
  }
  return best;
}

/**
 * `value` as JSON within `max`, for a result still too long once its passages are shortened. A cut through the JSON
 * would leave the model text it cannot read, so the result keeps its shape: its longest strings are capped, each cut
 * marked, then lists, then all that is left is its top-level values. Anything dropped is flagged `truncated`, and the
 * cursor stays, so the rest can still be read.
 */
function fitJson(value: unknown, max: number): string {
  const strings = fitStrings(value, max);
  if (strings !== null) return strings;
  const record = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  for (const listMax of LIST_CAPS) {
    const text = JSON.stringify({ ...(capped(record, SHORTEST_STRING, listMax) as object), truncated: true });
    if (text.length <= max) return text;
  }
  const top = Object.entries(record).filter(([, child]) => !child || typeof child !== 'object');
  const text = JSON.stringify({ ...(capped(Object.fromEntries(top), SHORTEST_STRING) as object), truncated: true });
  if (text.length <= max) return text;
  return JSON.stringify({ ...('nextCursor' in record ? { nextCursor: record.nextCursor } : {}), truncated: true });
}

/**
 * The tool-step model's view of `result`, at most `max` characters. An error result is its stable code and hint (never
 * case text). Long passages are shortened before anything else is cut, and a structured result stays JSON (fitJson).
 */
export function compactResult(result: CallToolResult, evidence: Evidence, max: number = TOOL_RESULT_CHARS): string {
  if (result.isError || !result.structuredContent) {
    const text = result.content?.map((part) => (part.type === 'text' ? part.text : '')).join('\n') ?? '';
    return clip(text || 'error: the tool returned nothing', max);
  }
  learnIds(result.structuredContent, evidence);
  let value = rewrite(result.structuredContent, evidence, evidence.aliasedIds());
  let text = JSON.stringify(value);
  for (let round = 0; text.length > max && round < 5; round++) {
    value = shrinkTexts(value);
    text = JSON.stringify(value);
  }
  return text.length <= max ? text : fitJson(value, max);
}
