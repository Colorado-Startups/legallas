// SPDX-License-Identifier: Apache-2.0
// Proof the scan reached what it says it scanned, read from ZAP's own exports. Counts and tool names only.

/** Requests in one of ZAP's URL exports: one line per message. Null when the export is missing. */
export function countUrls(text: string | null): number | null {
  if (text === null) return null;
  return text.split('\n').filter((line) => /^https?:\/\//.test(line.trim())).length;
}

/** A JSON-RPC message from a response body: plain JSON, or the first `data:` line with an id in a server-sent event stream. */
export function rpcReply(body: string): Record<string, unknown> | null {
  const parse = (text: string) => {
    try {
      const value: unknown = JSON.parse(text);
      return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) return parse(trimmed);
  for (const line of trimmed.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const message = parse(line.slice(5).trim());
    if (message && 'id' in message) return message;
  }
  return null;
}

interface HarEntry {
  request?: { postData?: { text?: unknown } };
  response?: { status?: unknown; content?: { text?: unknown; encoding?: unknown } };
}

/** One tools/call ZAP's import made: the tool, the HTTP status, and what came back. No argument or result is kept. */
export interface McpCall {
  name: string;
  status: number;
  /** result: the tool ran and answered; tool-error: it ran and refused the placeholder arguments; rpc-error: it never ran. */
  outcome: 'result' | 'tool-error' | 'rpc-error';
}

/**
 * The tools the MCP server listed, and each tools/call ZAP's import made. From the import's HAR, which holds the token,
 * so run.ts keeps only this and deletes the HAR. Null when there is no HAR or no tool list.
 */
export function mcpCalls(har: unknown): { listed: string[]; calls: McpCall[] } | null {
  const entries = (har as { log?: { entries?: unknown } } | null)?.log?.entries;
  if (!Array.isArray(entries)) return null;
  const listed = new Set<string>();
  const calls: McpCall[] = [];
  let sawList = false;
  for (const entry of entries as HarEntry[]) {
    const sent = rpcReply(typeof entry.request?.postData?.text === 'string' ? entry.request.postData.text : '');
    const content = entry.response?.content;
    let body = typeof content?.text === 'string' ? content.text : '';
    if (content?.encoding === 'base64') body = Buffer.from(body, 'base64').toString('utf8');
    const reply = rpcReply(body);
    if (!sent || !reply) continue;
    const result = reply.result as Record<string, unknown> | undefined;
    if (sent.method === 'tools/list' && Array.isArray(result?.tools)) {
      sawList = true;
      for (const tool of result.tools as { name?: unknown }[]) if (typeof tool.name === 'string') listed.add(tool.name);
    }
    const name = (sent.params as { name?: unknown } | undefined)?.name;
    if (sent.method === 'tools/call' && typeof name === 'string') {
      const outcome = !result ? 'rpc-error' : result.isError === true ? 'tool-error' : 'result';
      calls.push({ name, status: typeof entry.response?.status === 'number' ? entry.response.status : 0, outcome });
    }
  }
  return sawList ? { listed: [...listed].sort(), calls } : null;
}

/** How many listed tools ZAP's import reached (they ran, whatever they answered), and how many of those refused its placeholders. */
export function mcpToolCoverage(har: unknown): { listed: number; reached: number; toolErrors: number } | null {
  const seen = mcpCalls(har);
  if (!seen) return null;
  const ran = (outcome: McpCall['outcome']) => new Set(seen.calls.filter((c) => c.outcome === outcome && seen.listed.includes(c.name)).map((c) => c.name));
  const answered = ran('result');
  const refused = [...ran('tool-error')].filter((name) => !answered.has(name));
  return { listed: seen.listed.length, reached: answered.size + refused.length, toolErrors: refused.length };
}
