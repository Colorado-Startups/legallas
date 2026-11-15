// SPDX-License-Identifier: Apache-2.0
// The tool calls scripts/kit-run.ts makes for a kit: one recorded call per tool step (waiting out the rate limit),
// cursors followed, and the small readers over their results (documents listed, hits searched, pages read).
import { BURST_RETRY_AFTER_SECONDS } from './kit-checks.ts';
import { McpSession, resultValue, summarizeTool, toolCallOk } from './mcp-client.ts';

/** Bounds, so a loop in a cursor never runs away. */
const MAX_CURSOR_CALLS = 8;
const MAX_WHOLE_READS = 6;
/** TOOL_LIMIT allows 60 calls a member a minute; six kits back to back pass it, so a limited call waits out the window. */
const RATE_LIMIT_TRIES = 3;

export type Value = Record<string, unknown>;

export interface CallRecord {
  tool: string;
  args: Value;
  ok: boolean;
  /** The coded error, `not_listed` for a tool this caller was not offered, or null. */
  code: string | null;
  value: Value | null;
}

export class Calls {
  readonly log: CallRecord[] = [];
  private readonly session: McpSession;
  private readonly offered: ReadonlySet<string>;

  constructor(session: McpSession, offered: ReadonlySet<string>) {
    this.session = session;
    this.offered = offered;
  }

  async call(tool: string, args: Value): Promise<Value | null> {
    if (!this.offered.has(tool)) {
      this.log.push({ tool, args, ok: true, code: 'not_listed', value: null });
      return null;
    }
    let reply = await this.session.callTool(tool, args);
    let summary = summarizeTool(reply.result);
    for (let tries = 1; summary.code === 'rate_limited' && tries < RATE_LIMIT_TRIES; tries++) {
      await new Promise((resolve) => setTimeout(resolve, (BURST_RETRY_AFTER_SECONDS + 1) * 1000));
      reply = await this.session.callTool(tool, args);
      summary = summarizeTool(reply.result);
    }
    const value = reply.error === null && !summary.isError ? resultValue(reply.result) : null;
    // toolCallOk passes coded refusals a caller can act on; one still limited after the waits means the kit got no answer.
    const ok = reply.error === null && toolCallOk(summary) && summary.code !== 'rate_limited';
    this.log.push({ tool, args, ok, code: reply.error ?? summary.code, value });
    return value;
  }

  /** One call, then the rest through its cursor field. */
  async all(tool: string, args: Value, cursorField: 'next_cursor' | 'nextCursor'): Promise<Value[]> {
    const out: Value[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < MAX_CURSOR_CALLS; i++) {
      const value = await this.call(tool, cursor ? { ...args, cursor } : args);
      if (!value) break;
      out.push(value);
      cursor = typeof value[cursorField] === 'string' ? (value[cursorField] as string) : null;
      if (!cursor) break;
    }
    return out;
  }

  /** A document read whole with legallas_read_pages, following next_cursor and next. */
  async readWhole(id: string): Promise<Value[]> {
    const out: Value[] = [];
    let args: Value = { id };
    for (let i = 0; i < MAX_WHOLE_READS; i++) {
      const value = await this.call('legallas_read_pages', args);
      if (!value) break;
      out.push(value);
      if (typeof value.next_cursor === 'string') args = { id, cursor: value.next_cursor };
      else if (typeof value.next === 'number') args = { id, from: value.next };
      else break;
    }
    return out;
  }
}

export function rows(values: readonly (Value | null)[], field: string): Value[] {
  return values.flatMap((value) => (value && Array.isArray(value[field]) ? (value[field] as Value[]) : []));
}

/** Distinct (id, page) pairs from search results, in order. */
export function hitPages(results: readonly Value[], max: number): { id: string; page: number }[] {
  const seen = new Set<string>();
  const out: { id: string; page: number }[] = [];
  for (const row of results) {
    if (typeof row.id !== 'string' || typeof row.page !== 'number') continue;
    const key = `${row.id}#${row.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: row.id, page: row.page });
    if (out.length === max) break;
  }
  return out;
}

export async function searchAll(calls: Calls, queries: readonly string[], limit = 5): Promise<Value[]> {
  const found: Value[] = [];
  for (const query of queries) found.push(...rows([await calls.call('legallas_search', { query, limit })], 'results'));
  return found;
}

export async function readHits(calls: Calls, hits: readonly { id: string; page: number }[]): Promise<void> {
  for (const hit of hits) await calls.call('legallas_read_pages', { id: hit.id, from: hit.page, to: hit.page });
}

export async function listAll(calls: Calls, args: Value = {}): Promise<Value[]> {
  return rows(await calls.all('legallas_list_documents', args, 'next_cursor'), 'documents');
}
