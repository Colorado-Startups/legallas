// SPDX-License-Identifier: Apache-2.0
// The retrieval replica for scripts/mcp-eval.ts --replica: the real legallas_search handler (mcp/tools/search.ts),
// run here in Node with
//   SEARCH: the AI Search REST search endpoint (/accounts/<id>/ai-search/namespaces/default/instances/legallas/search) on
//           wrangler's OAuth token, so the request the tool builds is the request production would send;
//   DB:     an in-memory SQLite copy of the room's `documents` table (worker/sqlite-d1.ts with every
//           migration), filled from one read-only remote query and never written to disk.
// Production quality can then be checked without a member session or the room's daily tool cap. Nothing
// here writes to production: one SELECT and search calls only. Each call runs under a response profile
// (mcp/contract.ts v2: compact for Microsoft and unknown clients, standard for Claude and Harvey), passed on the
// context the way the server's own profile override is, so `eval:mcp -- --replica` can size both.
//
// worker/ and mcp/ modules declare Workers binding types that the scripts tsconfig cannot resolve, so they
// are loaded at runtime through `loadModule` and used through the narrow shapes below.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MATTER_KEY } from '../worker/matter-types.ts';
import { loadModule } from './load-module.ts';
import { timeout, type Fetch } from './mcp-oauth.ts';
import { cliWrangler, FILES_BUCKET } from './wrangler.ts';
import { STORED_NAME } from '../worker/stored-name.ts';

// The replica's scripts have long imported these from here; they live in core modules now.
export { loadModule } from './load-module.ts';
export { accountId, wranglerToken } from './wrangler.ts';

const API = 'https://api.cloudflare.com/client/v4';
export const SEARCH_INSTANCE = STORED_NAME;
/**
 * The instances' AI Search namespace. Search goes to the namespaced path: Cloudflare deprecates the old
 * /ai-search/instances/<id>/search for /ai-search/namespaces/<namespace>/instances/<id>/search (same request and
 * response), and documents API-token permissions against the namespaced one.
 */
export const SEARCH_NAMESPACE = 'default';

/** The search response shape the Workers binding returns (AiSearchSearchResponse), as far as tools read it. */
export interface SearchResponse {
  search_query: string;
  chunks: { id: string; type: string; score: number; text: string; item: { key: string; metadata?: Record<string, unknown> } }[];
}

/**
 * The REST envelope's result as the binding's shape. REST answers `{ success, result }`; the result carries
 * `chunks` like the binding, or (older AutoRAG form) `data` with `filename` and `content[].text`.
 */
export function normalizeSearchResponse(body: unknown): SearchResponse {
  const envelope = (body ?? {}) as { success?: unknown; result?: Record<string, unknown>; errors?: { code?: unknown }[] };
  if (envelope.success === false || !envelope.result) throw new Error(`search_failed_${String(envelope.errors?.[0]?.code ?? 'unknown')}`);
  const result = envelope.result;
  const query = typeof result.search_query === 'string' ? result.search_query : '';
  if (Array.isArray(result.chunks)) return { search_query: query, chunks: result.chunks as SearchResponse['chunks'] };
  const data = Array.isArray(result.data) ? (result.data as Record<string, unknown>[]) : [];
  const chunks = data.map((entry, index) => ({
    id: typeof entry.file_id === 'string' ? entry.file_id : String(index),
    type: 'text',
    score: typeof entry.score === 'number' ? entry.score : 0,
    text: Array.isArray(entry.content) ? (entry.content as { text?: unknown }[]).map((c) => (typeof c.text === 'string' ? c.text : '')).join('\n') : '',
    item: { key: typeof entry.filename === 'string' ? entry.filename : '' },
  }));
  return { search_query: query, chunks };
}

/**
 * A SEARCH binding backed by the REST endpoint. Errors carry the status only. `instance` points it at another
 * instance than the room's, a staging copy of the index for example.
 */
export function restSearch(fetcher: Fetch, accountId: string, apiToken: string, instance = SEARCH_INSTANCE): { search(request: unknown): Promise<SearchResponse> } {
  if (!/^[0-9a-f]{32}$/.test(accountId)) throw new Error('account id must be 32 hex characters');
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(instance)) throw new Error('instance names are lowercase letters, digits and dashes');
  const url = `${API}/accounts/${accountId}/ai-search/namespaces/${SEARCH_NAMESPACE}/instances/${instance}/search`;
  return {
    async search(request) {
      const response = await fetcher(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(request),
        signal: timeout(),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`search_http_${response.status}`);
      return normalizeSearchResponse(body);
    },
  };
}

interface SqliteLike {
  exec(sql: string): void;
  prepare(sql: string): { all(...args: unknown[]): unknown[]; run(...args: unknown[]): unknown };
}

/** An in-memory D1 with the migrations applied and `rows` copied into `documents` (columns both sides know). */
export async function documentsDb(rows: readonly Record<string, unknown>[]): Promise<unknown> {
  const { testDb } = await loadModule<{ testDb(): { db: unknown; sqlite: SqliteLike } }>('worker/sqlite-d1.ts');
  const { db, sqlite } = testDb();
  sqlite.exec('PRAGMA foreign_keys = OFF');
  const known = new Set((sqlite.prepare('PRAGMA table_info(documents)').all() as { name: string }[]).map((c) => c.name));
  for (const row of rows) {
    const columns = Object.keys(row).filter((c) => known.has(c));
    if (columns.length === 0) continue;
    const marks = columns.map(() => '?').join(', ');
    sqlite.prepare(`INSERT OR REPLACE INTO documents (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${marks})`).run(...columns.map((c) => row[c] ?? null));
  }
  return db;
}

/** A tool handler as mcp/contract.ts ToolDefinition declares it, reduced to what the replica calls. */
export interface ToolHandler {
  handler(args: Record<string, unknown>, ctx: unknown): Promise<Record<string, unknown>>;
}

export type ReplicaTool = 'legallas_search' | 'legallas_case_overview' | 'legallas_list_documents';

/** The response profiles (mcp/contract.ts v2), in the order a size probe runs them. */
export const REPLICA_PROFILES = ['standard', 'compact'] as const;
export type ReplicaProfile = (typeof REPLICA_PROFILES)[number];

export interface Replica {
  /**
   * Runs a tool exactly as the server would, minus the membership, cap and audit wrapper, under `profile` (default:
   * the replica's own), and shapes the result for that profile as runTool does (mcp/format.ts forProfile), so a size
   * probe measures what the client receives.
   */
  callTool(name: ReplicaTool, args: Record<string, unknown>, profile?: ReplicaProfile): Promise<Record<string, unknown>>;
  search(query: string, limit: number, profile?: ReplicaProfile): Promise<Record<string, unknown>>;
}

/** A FILES binding that serves one object (the published matter manifest) from memory, read-only. */
export function memoryFiles(key: string, text: string | null): { get(k: string): Promise<{ etag: string; body: true; text(): Promise<string> } | null> } {
  return {
    async get(k) {
      return k === key && text !== null ? { etag: 'replica', body: true, text: async () => text } : null;
    },
  };
}

export interface ReplicaParts {
  search: { search(request: unknown): Promise<SearchResponse> };
  rows: readonly Record<string, unknown>[];
  controlPrefix: string | undefined;
  /** The published meta/matter.json text, or null when none is published. */
  matter?: string | null;
  /** Handlers by tool name; default to the real mcp/tools exports. */
  tools?: Partial<Record<ReplicaTool, ToolHandler>>;
  /** The profile calls run under unless a call names one; default standard. */
  profile?: ReplicaProfile;
}

async function realTools(): Promise<Record<ReplicaTool, ToolHandler>> {
  const [{ searchTool }, { overviewTool }, { listDocumentsTool }] = await Promise.all([
    loadModule<{ searchTool: ToolHandler }>('mcp/tools/search.ts'),
    loadModule<{ overviewTool: ToolHandler }>('mcp/tools/overview.ts'),
    loadModule<{ listDocumentsTool: ToolHandler }>('mcp/tools/documents.ts'),
  ]);
  return { legallas_search: searchTool, legallas_case_overview: overviewTool, legallas_list_documents: listDocumentsTool };
}

/** Builds the replica from its parts. */
export async function createReplica(parts: ReplicaParts): Promise<Replica> {
  const tools = { ...(await realTools()), ...parts.tools };
  const { forProfile } = await loadModule<{ forProfile(profile: ReplicaProfile, result: Record<string, unknown>): Record<string, unknown> }>('mcp/format.ts');
  const env = { DB: await documentsDb(parts.rows), SEARCH: parts.search, FILES: memoryFiles(MATTER_KEY, parts.matter ?? null), CONTROL_PREFIX: parts.controlPrefix };
  const member = { email: 'replica@example.test', role: 'owner', name: 'Replica' };
  const callTool = async (name: ReplicaTool, args: Record<string, unknown>, profile: ReplicaProfile = parts.profile ?? 'standard') => {
    const props = { email: member.email, role: 'owner', clientId: `replica-${profile}`, clientName: 'Replica' };
    // The client kind that gets this profile (mcp/contract.ts v2 PROFILE_OF): Claude standard, Microsoft compact.
    const clientKind = profile === 'compact' ? 'microsoft' : 'claude';
    const result = await tools[name].handler(args, { env, props, member, now: new Date(), clientKind, profile, audit: async () => {} });
    return forProfile(profile, result);
  };
  return { callTool, search: (query, limit, profile) => callTool('legallas_search', { query, limit }, profile) };
}

/**
 * The published meta/matter.json from legallas-files (read-only), via a private temp directory (mode 700) that
 * is removed before this returns, so the case manifest never stays on disk. `get` is injectable for tests.
 */
export async function publishedMatter(get: (file: string) => Promise<void> = (file) => cliWrangler('remote').r2Get(FILES_BUCKET, MATTER_KEY, file)): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'legallas-replica-'));
  try {
    const file = path.join(dir, 'matter.json');
    await get(file);
    return await readFile(file, 'utf8');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
