// SPDX-License-Identifier: Apache-2.0
// A minimal MCP client over streamable HTTP for the legallas-mcp smoke and eval scripts. It speaks both wire
// forms the server serves (mcp/server.ts):
//   2025-11-25: `initialize` handshake, then requests with the MCP-Protocol-Version header.
//   2026-07-28: no handshake; every request carries the version in `_meta` (the per-request envelope) and
//               the MCP-Protocol-Version, Mcp-Method and (for tools/call and prompts/get) Mcp-Name headers. `server/discover`
//               replaces `initialize`.
// Responses may be JSON or an SSE stream (src/scripts/chat-sse.ts parses the frames). Results are summarized
// as codes and lengths: tool text is case content and never leaves this module unless a caller asks for it.
import { sseParser } from '../src/scripts/chat-sse.ts';
import { timeout, type Fetch } from './mcp-oauth.ts';

export const LEGACY_VERSION = '2025-11-25';
export const MODERN_VERSION = '2026-07-28';
export type ProtocolVersion = typeof LEGACY_VERSION | typeof MODERN_VERSION;

const CLIENT_INFO = { name: 'legallas-mcp-smoke', version: '1.0.0' };

/**
 * 2026-07-28: the body field the Mcp-Name header mirrors, per method (SEP-2243; the MCP SDK's MCP_NAME_HEADER_SOURCE).
 * The server refuses a request on this list without it (-32020).
 */
const MCP_NAME_FIELD: Readonly<Record<string, string>> = { 'tools/call': 'name', 'prompts/get': 'name', 'resources/read': 'uri' };

export interface RpcReply {
  status: number;
  /** The JSON-RPC `result`, or null on a transport or JSON-RPC error. */
  result: Record<string, unknown> | null;
  /** The JSON-RPC error code, `http_<status>` or `no_reply`. */
  error: string | null;
}

/** Picks the reply to `id` out of a JSON body or an SSE stream. */
export function replyFrom(status: number, contentType: string, body: string, id: number): RpcReply {
  let messages: unknown[] = [];
  if (contentType.includes('text/event-stream')) {
    const parser = sseParser();
    messages = [...parser.push(body), ...parser.end()].map((event) => event.data);
  } else {
    try {
      const parsed: unknown = JSON.parse(body);
      messages = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      messages = [];
    }
  }
  const message = messages.find((m) => (m as { id?: unknown } | null)?.id === id) as { result?: unknown; error?: { code?: unknown } } | undefined;
  if (!message) return { status, result: null, error: status >= 400 ? `http_${status}` : 'no_reply' };
  if (message.error) return { status, result: null, error: `rpc_${String(message.error.code ?? 'error')}` };
  return { status, result: (message.result ?? {}) as Record<string, unknown>, error: null };
}

/** One stateless MCP connection: an endpoint, a bearer token and a protocol version. */
export class McpSession {
  readonly endpoint: string;
  readonly version: ProtocolVersion;
  private readonly fetcher: Fetch;
  private readonly token: string | null;
  private nextId = 1;
  private sessionId: string | null = null;
  private negotiated: string | null = null;

  constructor(fetcher: Fetch, endpoint: string, token: string | null, version: ProtocolVersion) {
    this.fetcher = fetcher;
    this.endpoint = endpoint;
    this.token = token;
    this.version = version;
  }

  private headers(method: string, params: Record<string, unknown>): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    if (this.version === MODERN_VERSION) {
      headers['MCP-Protocol-Version'] = MODERN_VERSION;
      headers['Mcp-Method'] = method;
      const named = MCP_NAME_FIELD[method];
      if (named && typeof params[named] === 'string') headers['Mcp-Name'] = params[named];
    } else if (this.negotiated) {
      headers['MCP-Protocol-Version'] = this.negotiated;
    }
    return headers;
  }

  private envelope(params: Record<string, unknown>): Record<string, unknown> {
    if (this.version !== MODERN_VERSION) return params;
    const meta = {
      ...((params._meta as Record<string, unknown> | undefined) ?? {}),
      'io.modelcontextprotocol/protocolVersion': MODERN_VERSION,
      'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
      'io.modelcontextprotocol/clientCapabilities': {},
    };
    return { ...params, _meta: meta };
  }

  /** Sends one request and waits for its reply. */
  async request(method: string, params: Record<string, unknown> = {}): Promise<RpcReply> {
    const id = this.nextId++;
    const response = await this.fetcher(this.endpoint, {
      method: 'POST',
      headers: this.headers(method, params),
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params: this.envelope(params) }),
      redirect: 'manual',
      signal: timeout(),
    });
    this.sessionId = response.headers.get('Mcp-Session-Id') ?? this.sessionId;
    return replyFrom(response.status, response.headers.get('Content-Type') ?? '', await response.text(), id);
  }

  /** A notification (no id, no reply expected). Returns the HTTP status. */
  async notify(method: string): Promise<number> {
    const response = await this.fetcher(this.endpoint, {
      method: 'POST',
      headers: this.headers(method, {}),
      body: JSON.stringify({ jsonrpc: '2.0', method }),
      redirect: 'manual',
      signal: timeout(),
    });
    await response.body?.cancel();
    return response.status;
  }

  /**
   * Opens the connection: `initialize` plus `notifications/initialized` for 2025-11-25, `server/discover` for
   * 2026-07-28. Returns the reply with the version the server agreed to (null when it refused).
   */
  async open(): Promise<RpcReply & { agreed: string | null }> {
    if (this.version === MODERN_VERSION) {
      const reply = await this.request('server/discover');
      const versions = (reply.result?.supportedVersions as unknown[] | undefined) ?? [];
      return { ...reply, agreed: versions.includes(MODERN_VERSION) ? MODERN_VERSION : null };
    }
    const reply = await this.request('initialize', { protocolVersion: LEGACY_VERSION, capabilities: {}, clientInfo: CLIENT_INFO });
    const agreed = typeof reply.result?.protocolVersion === 'string' ? reply.result.protocolVersion : null;
    if (agreed) {
      this.negotiated = agreed;
      await this.notify('notifications/initialized');
    }
    return { ...reply, agreed };
  }

  listTools(): Promise<RpcReply> {
    return this.request('tools/list');
  }

  callTool(name: string, args: Record<string, unknown>): Promise<RpcReply> {
    return this.request('tools/call', { name, arguments: args });
  }
}

/** A raw tool result (a null result means a transport failure, with a code). */
export interface ToolReply {
  result: Record<string, unknown> | null;
  error: string | null;
}

/** A tool result reduced to what may be printed: the error flag, the error code, and sizes. */
export interface ToolSummary {
  isError: boolean;
  /** The code before the colon of a coded tool error (mcp/format.ts toolError), else null. */
  code: string | null;
  textLength: number;
  structured: boolean;
}

const CODED = /^([a-z][a-z0-9_]*):\s/;

export function summarizeTool(result: Record<string, unknown> | null): ToolSummary {
  const content = Array.isArray(result?.content) ? (result.content as { type?: unknown; text?: unknown }[]) : [];
  const texts = content.filter((c) => c.type === 'text' && typeof c.text === 'string').map((c) => c.text as string);
  const isError = result?.isError === true;
  const code = isError ? (CODED.exec(texts[0] ?? '')?.[1] ?? 'uncoded') : null;
  const structured = typeof result?.structuredContent === 'object' && result.structuredContent !== null;
  return { isError, code, textLength: texts.reduce((n, t) => n + t.length, 0), structured };
}

/**
 * Coded errors that mean the server is not working for this caller, as opposed to a harmless answer such as
 * "no such document" to a probe argument.
 */
export const FAILING_CODES: ReadonlySet<string> = new Set(['internal_error', 'not_a_member', 'not_implemented', 'daily_limit', 'uncoded']);

/** True for a non-error result or a known coded error that is not in FAILING_CODES. */
export function toolCallOk(summary: ToolSummary): boolean {
  return !summary.isError || (summary.code !== null && !FAILING_CODES.has(summary.code));
}

/**
 * A successful result's object: its structuredContent, or the JSON in its first text block when there is none
 * (mcp/format.ts forProfile sends compact callers one minified text copy). null when neither holds an object.
 */
export function resultValue(result: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  const structured = result?.structuredContent;
  if (structured && typeof structured === 'object' && !Array.isArray(structured)) return structured as Record<string, unknown>;
  const content = Array.isArray(result?.content) ? (result.content as { type?: unknown; text?: unknown }[]) : [];
  const text = content.find((c) => c.type === 'text')?.text;
  if (typeof text !== 'string') return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The first string `id` found in a structured result (depth-first), used to pick a document for later probes. */
export function firstId(value: unknown, depth = 0): string | null {
  if (depth > 6 || value === null || typeof value !== 'object') return null;
  if (!Array.isArray(value) && typeof (value as { id?: unknown }).id === 'string') return (value as { id: string }).id;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = firstId(child, depth + 1);
    if (found) return found;
  }
  return null;
}
