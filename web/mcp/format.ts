// SPDX-License-Identifier: Apache-2.0
// Result shapes shared by every tool, so search, overview and document tools read the same to a model.
import type { CallToolResult } from '@modelcontextprotocol/server';
import { COMPACT_LIMITS, CONTROL_PREFIX_FALLBACK, EMBED_MAX_BASE64_CHARS, ROOM_ORIGIN, type ResponseProfile, type ResultLimits } from './contract.ts';
import { CLOSE, openTag, untrustedReason, type Untrusted } from './untrusted.ts';

const PREFIX = /^[A-Z]{2,6}$/;

/** The room page for a document (and page), as worker/routes and src/scripts/files-api.ts link it. */
export function docLink(id: string, page?: number | null): string {
  const base = `${ROOM_ORIGIN}/doc/?id=${encodeURIComponent(id)}`;
  return page && page > 0 ? `${base}#page=${page}` : base;
}

/**
 * "<PREFIX>-000123" like the room (src/scripts/matter-api.ts formatControl), or null before a document is
 * numbered. A malformed prefix falls back to CONTROL_PREFIX_FALLBACK.
 */
export function formatControl(prefix: string | undefined, seq: number | null | undefined): string | null {
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) return null;
  const p = prefix && PREFIX.test(prefix) ? prefix : CONTROL_PREFIX_FALLBACK;
  return `${p}-${String(seq).padStart(6, '0')}`;
}

/**
 * Case text wrapped as data. Results carry documents written by parties to the case, including the other side;
 * the label tells the client model that what follows is a record to cite, not instructions to follow. Text that
 * quarantine.ts marks (mcp/untrusted.ts) is fenced with its mark instead. `judged` is the mark of the whole passage
 * when `body` is part of it (null: judged and trusted); left out, `body` is judged on its words alone.
 */
export function caseData(body: string, judged?: Untrusted | null): string {
  const reason = judged === undefined ? untrustedReason(body) : judged;
  return `${openTag(reason)}${body.replace(/<\s*\/\s*case-record\s*>/gi, '&lt;/case-record>')}${CLOSE}`;
}

/**
 * A short field a document's author or a source controls (a title, a folder, a party, a binder heading), judged as
 * caseData judges text: unchanged when trusted, so a list stays small; fenced with its mark when not, so markUntrusted
 * drops its item's cite fields and noted adds Ask's reminder. Judged on its words alone: a file named "Order" is no order.
 */
export function caseField<T extends string | null | undefined>(value: T): T | string {
  if (typeof value !== 'string' || value === '') return value;
  const reason = untrustedReason(value);
  return reason ? caseData(value, reason) : value;
}

/** The day (UTC) a result was read from the room, YYYY-MM-DD: its `retrieved`, the retrieved date of every row in it. */
export function retrievedOn(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The small structured content a compact result keeps (jsonResult's `view`), by result. */
const compactViews = new WeakMap<CallToolResult, Record<string, unknown>>();

/**
 * A successful result: the object as structured content, which the tool's outputSchema describes (tools/output.ts),
 * and the same object as minified JSON text, for clients that read text only (MCP spec: tools, structured content).
 * `view` is what a compact caller gets as structured content instead of none (forProfile).
 */
export function jsonResult(value: Record<string, unknown>, view?: Record<string, unknown>): CallToolResult {
  const result: CallToolResult = { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
  if (view) compactViews.set(result, view);
  return result;
}

/**
 * A result as `profile` sends it. `standard` is unchanged. `compact` (Microsoft and unknown clients) sends a
 * jsonResult's object once, as minified JSON text, with no structuredContent: their tools declare no outputSchema
 * (mcp/server.ts), so it is optional (MCP spec), text is the channel every client reads, and one copy halves what
 * Copilot counts against its 4,096 tokens (Microsoft Learn, declarative-agent-architecture, read 2026-10-20). A result
 * made with a `view` keeps that small object as its structured content, for the views that read it. Anything else
 * passes through as it is: errors, results without structured content, and results with more than the one text block
 * (an image or a PDF). isError and _meta stay.
 */
export function forProfile(profile: ResponseProfile, result: CallToolResult): CallToolResult {
  if (profile === 'standard' || result.isError || result.structuredContent === undefined) return result;
  if (result.content.length !== 1 || result.content[0]?.type !== 'text') return result;
  const view = compactViews.get(result);
  const { structuredContent, ...unstructured } = result;
  return { ...unstructured, content: [{ type: 'text', text: JSON.stringify(structuredContent) }], ...(view ? { structuredContent: view } : {}) };
}

/** A tool error the model can recover from: a stable code and a hint at the next step. Never case text. */
export function toolError(code: string, hint: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: `${code}: ${hint}` }] };
}

/** A tool's own caps for this caller: unchanged for `standard`, narrowed to COMPACT_LIMITS for `compact`. */
export function limitsFor(profile: ResponseProfile, own: ResultLimits): ResultLimits {
  if (profile === 'standard') return own;
  return { maxItems: Math.min(own.maxItems, COMPACT_LIMITS.maxItems), maxChars: Math.min(own.maxChars, COMPACT_LIMITS.maxChars) };
}

/**
 * Whole items from `start` while they fit `limits`: at most maxItems, and their sizes (as `size` measures them,
 * usually the characters they add to the result) summing to at most maxChars. The first item is always kept, so
 * a result never comes back empty while items remain; a tool trims an oversized single item itself. `next` is the
 * index to resume from, or null when everything fitted.
 */
export function fitToProfile<T>(items: readonly T[], limits: ResultLimits, size: (item: T) => number, start = 0): { items: T[]; next: number | null } {
  const kept: T[] = [];
  let used = 0;
  let index = Math.max(0, start);
  while (index < items.length && kept.length < limits.maxItems) {
    const cost = size(items[index]);
    if (kept.length > 0 && used + cost > limits.maxChars) break;
    kept.push(items[index]);
    used += cost;
    index += 1;
  }
  return { items: kept, next: index < items.length ? index : null };
}

const toBase64Url = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** An opaque cursor for a list of strings and numbers (a section and an offset, a last id). base64url JSON. */
export function encodeCursor(parts: readonly (string | number)[]): string {
  return toBase64Url(JSON.stringify(parts));
}

/** The parts of a cursor encodeCursor made, or null for anything else (never throws on client input). */
export function decodeCursor(cursor: string | undefined | null): (string | number)[] | null {
  if (!cursor || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const binary = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'));
    const parts: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
    if (!Array.isArray(parts) || !parts.every((p) => typeof p === 'string' || typeof p === 'number')) return null;
    return parts as (string | number)[];
  } catch {
    return null;
  }
}

/**
 * Characters of a result as indented JSON: what a profile's character budget counts. Every caller gets the same object
 * minified (jsonResult, forProfile), so the text sent is shorter still.
 */
export function resultChars(value: Record<string, unknown>): number {
  return JSON.stringify(value, null, 2).length;
}

/** Characters `value` takes as JSON inside a JSON string: what it adds to a result's text block as sent. */
export function wireChars(value: unknown): number {
  return JSON.stringify(JSON.stringify(value)).length - 2;
}

/** Characters a compact result takes as sent (forProfile): its object once, as minified text, and its view when it keeps one. */
export function compactChars(value: Record<string, unknown>, view?: Record<string, unknown>): number {
  return JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(value) }], ...(view ? { structuredContent: view } : {}) }).length;
}

/** Room for the list a compact view gains once it holds a row: its key, quotes, brackets and comma. */
const VIEW_LIST_ROOM = 40;

/** Characters `value` adds as one item of a list two levels deep in a result as indented JSON, separator included. */
export function itemChars(value: unknown): number {
  const text = JSON.stringify(value, null, 2);
  return text.length + 4 * text.split('\n').length + 2;
}

/**
 * How fitItems measures an item: a tool's own standard measure, the value a result shows for it (itself by default),
 * and, for a compact result that keeps a view (jsonResult), the view it makes of a result.
 */
export interface ItemMeasure<T> {
  own?: (item: T) => number;
  shown?: (item: T) => unknown;
  view?: (value: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * The items one result sends (fitToProfile under limitsFor). A tool with its own standard measure (`measure.own`,
 * legallas_search's passage characters) keeps it for standard; otherwise items are counted on the result as indented
 * JSON, in either profile. `envelope` is the result with no items and its longest cursor, so the item list (2
 * characters more than an empty one) gets exactly what the rest leaves: the result stays within maxChars, and the
 * minified text sent is shorter.
 */
export function fitItems<T>(profile: ResponseProfile, items: readonly T[], own: ResultLimits, envelope: Record<string, unknown>, measure: ItemMeasure<T> = {}): { items: T[]; next: number | null } {
  const limits = limitsFor(profile, own);
  if (profile === 'standard' && measure.own) return fitToProfile(items, limits, measure.own);
  const shown = measure.shown ?? ((item: T) => item);
  const { view } = measure;
  if (profile === 'compact' && view) {
    // Counted as sent: each item's text, escaped in the text block, and its row of the view, each with a comma, against
    // the whole result (compactChars), so text and view together stay within maxChars.
    const cost = (item: T) => {
      const row = (view({ rows: [shown(item)] }).rows as unknown[] | undefined)?.[0];
      return wireChars(shown(item)) + 1 + (row === undefined ? 0 : JSON.stringify(row).length + 1);
    };
    return fitToProfile(items, { maxItems: limits.maxItems, maxChars: limits.maxChars - compactChars(envelope, view(envelope)) - VIEW_LIST_ROOM }, cost);
  }
  return fitToProfile(items, { maxItems: limits.maxItems, maxChars: limits.maxChars - resultChars(envelope) - 2 }, (item) => itemChars(shown(item)));
}

/** True when base64 of `byteLength` bytes fits EMBED_MAX_BASE64_CHARS. */
export function embeddable(byteLength: number): boolean {
  return Math.ceil(byteLength / 3) * 4 <= EMBED_MAX_BASE64_CHARS;
}

/** jsonResult plus an image block (base64), for clients that take images (only Claude, ToolContext.clientKind). */
export function imageResult(value: Record<string, unknown>, image: { data: string; mimeType: string }): CallToolResult {
  const result = jsonResult(value);
  return { ...result, content: [...result.content, { type: 'image', data: image.data, mimeType: image.mimeType }] };
}

/** jsonResult plus an embedded resource (a PDF, base64 blob), for Claude only. `uri` names the room page. */
export function embeddedResult(value: Record<string, unknown>, resource: { uri: string; mimeType: string; blob: string }): CallToolResult {
  const result = jsonResult(value);
  return { ...result, content: [...result.content, { type: 'resource', resource }] };
}
