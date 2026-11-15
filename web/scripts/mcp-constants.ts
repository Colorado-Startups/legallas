// SPDX-License-Identifier: Apache-2.0
// The values from mcp/contract.ts that the smoke and eval clients need. contract.ts declares Workers binding
// types (D1Database, R2Bucket, ...) that the scripts tsconfig (Node types only) cannot resolve, so they are
// mirrored here; scripts/mcp-client.test.ts loads contract.ts at runtime and fails if any of them drift.
import { mcpHost, toolPrefix } from '../worker/room-settings.ts';
import { STORED_NAME } from '../worker/stored-name.ts';

export const MCP_ORIGIN = `https://${mcpHost}`;
/** The canonical protected resource (RFC 8707 audience and RFC 9728 `resource`). */
export const MCP_RESOURCE = `${MCP_ORIGIN}/mcp`;
export const SCOPE_READ = 'case.read';
export const MAX_SEARCH_RESULTS = 20;
/** The name of every client the production smoke registers; legallas-mcp's daily sweep deletes them a day later. */
export const SMOKE_CLIENT_NAME = `${STORED_NAME}-smoke`;

/**
 * The room's MCP tool prefix: its `toolPrefix` setting (room-preload.ts sets it for a script) under the Workers' own rule,
 * `legallas_` when unset or malformed. A room with its own prefix lists its own names (#58). The rule is room-names.ts
 * roomNames's, written out so this file stays out of the Mac and Windows jobs' import lists; mcp-constants-prefix.test.ts
 * holds the two equal.
 */
export function toolPrefixOf(raw: unknown): string {
  const prefix = typeof raw === 'string' ? raw.trim() : '';
  return /^[a-z][a-z0-9]{0,15}_$/.test(prefix) ? prefix : 'legallas_';
}
export const TOOL_PREFIX = toolPrefixOf(toolPrefix);
/** A tool's name in this room: `search` reads `legallas_search` by default. */
export const tool = (name: string): string => `${TOOL_PREFIX}${name}`;

export const TOOL_NAMES = [
  tool('search'),
  tool('case_overview'),
  tool('list_documents'),
  tool('get_document'),
  tool('read_pages'),
  tool('view_visual'),
  tool('get_comments'),
  tool('get_file'),
  tool('template'),
] as const;
/** The law library's search, listed beside the nine only while the law library is on. */
export const LAW_TOOL_NAME = tool('search_law');

export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
