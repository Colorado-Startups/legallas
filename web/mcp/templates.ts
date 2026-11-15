// SPDX-License-Identifier: Apache-2.0
// What legallas_template returns (mcp/tools/templates.ts): the template library's list, or one template, a part at a
// time. Templates are the product's own text, the same in every room and never case data, so no fence and no audit row.
// Each result carries A5's line (docs/legal/product-notices.md): the list's notice, or a template's card notice.
//
// | Caller   | A part holds at most                                         | The list                  |
// |----------|--------------------------------------------------------------|---------------------------|
// | standard | TEMPLATE_PART_TOKENS, as the Templates page counts           | one part                  |
// | compact  | what fits COMPACT_LIMITS as sent (format.ts compactChars)    | parts that fit it, too    |
import type { CallToolResult } from '@modelcontextprotocol/server';
import { BASELINE } from '../worker/checklist-baseline.ts';
import { splitText, TEMPLATE_PART_TOKENS } from '../worker/template-parts.ts';
import { TEMPLATES } from '../worker/templates.generated.ts';
import { COMPACT_LIMITS, type ResponseProfile } from './contract.ts';
import { compactChars, jsonResult, toolError, wireChars } from './format.ts';
import { TEMPLATE_TEXT } from './template-text.generated.ts';

/** A compact part's text, as sent: COMPACT_LIMITS less room for the rest of the result (templates.test.ts checks it). */
const COMPACT_TEXT_CHARS = COMPACT_LIMITS.maxChars - 1_000;

const cache = new Map<string, string[]>();

/** One template's parts for this caller, or null for a path that is no template. */
export function partsOf(path: string, profile: ResponseProfile): string[] | null {
  const text = Object.hasOwn(TEMPLATE_TEXT, path) ? TEMPLATE_TEXT[path] : undefined;
  if (text === undefined) return null;
  const key = `${profile}:${path}`;
  let parts = cache.get(key);
  if (!parts) {
    parts = profile === 'standard' ? splitText(text, TEMPLATE_PART_TOKENS * 4) : splitText(text, COMPACT_TEXT_CHARS, wireChars);
    cache.set(key, parts);
  }
  return parts;
}

type Row = { path: string; title: string; entity: readonly string[]; parts: number };

const lists = new Map<ResponseProfile, Row[][]>();

/** The list's rows in parts: one for standard; for compact, as many rows as fit COMPACT_LIMITS each. */
function listParts(profile: ResponseProfile): Row[][] {
  const cached = lists.get(profile);
  if (cached) return cached;
  const rows = TEMPLATES.map((t) => ({ ...t, parts: partsOf(t.path, profile)!.length }));
  const pages: Row[][] = [[]];
  for (const row of rows) {
    const page = pages.at(-1)!;
    const next = [...page, row];
    const full = profile === 'compact' && (next.length > COMPACT_LIMITS.maxItems || compactChars(listValue(next, 99, 99)) > COMPACT_LIMITS.maxChars);
    if (page.length > 0 && full) pages.push([row]);
    else pages[pages.length - 1] = next;
  }
  lists.set(profile, pages);
  return pages;
}

function listValue(rows: Row[], part: number, parts: number): Record<string, unknown> {
  return { notice: BASELINE.template_notice, templates: rows, part, parts, next_part: part < parts ? part + 1 : null };
}

const outOfRange = (parts: number) => toolError('not_found', `part runs from 1 to ${parts}.`);

/** The library's list, part `part`: each template's path, title, entity types and part count. */
export function templateList(profile: ResponseProfile, part = 1): CallToolResult {
  const pages = listParts(profile);
  const rows = pages[part - 1];
  return rows ? jsonResult(listValue(rows, part, pages.length)) : outOfRange(pages.length);
}

/** Part `part` of the template at `path`. */
export function templatePart(path: string, profile: ResponseProfile, part = 1): CallToolResult {
  const parts = partsOf(path, profile);
  const entry = TEMPLATES.find((t) => t.path === path);
  if (!parts || !entry) return toolError('not_found', 'No template has that path. Leave path out for the list.');
  const text = parts[part - 1];
  if (text === undefined) return outOfRange(parts.length);
  return jsonResult({
    path,
    title: entry.title,
    notice: BASELINE.template_card_notice,
    part,
    parts: parts.length,
    next_part: part < parts.length ? part + 1 : null,
    text,
  });
}
