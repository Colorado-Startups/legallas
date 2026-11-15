// SPDX-License-Identifier: Apache-2.0
// The MCP tool prefix (worker/room-names.ts): the tools are written with their default names (contract.ts
// TOOL_NAMES, `legallas_search` and so on), and the server renames them, and every mention of them in its own text, when
// the room sets MCP_TOOL_PREFIX. Applied only to text the server writes (tool names and descriptions, the
// instructions, the prompts, a tool's hints and notes), never to case data in a result. With the default prefix it
// returns its input unchanged, so a server on the default lists exactly what it did before (tool-prefix.test.ts).
import { DEFAULT_TOOL_PREFIX } from '../worker/room-names.ts';
import { LAW_TOOL_NAME, PROPOSE_TOOL_NAME, RECORDS_TOOL_NAME, TOOL_NAMES } from './contract.ts';

/** The part after the prefix of every tool the server can list, longest first so `search_law` wins over `search`. */
const BASES = [...TOOL_NAMES, LAW_TOOL_NAME, PROPOSE_TOOL_NAME, RECORDS_TOOL_NAME]
  .map((name) => name.slice(DEFAULT_TOOL_PREFIX.length))
  .sort((a, b) => b.length - a.length);
/** A whole default tool name; only the prefix is matched, so the replacement keeps the rest of the name. */
const MENTION = new RegExp(`\\b${DEFAULT_TOOL_PREFIX}(?=(?:${BASES.join('|')})\\b)`, 'g');

/** `text` with each default tool name given `prefix` instead. Unset or default prefix: `text` unchanged. */
export function withToolPrefix(text: string, prefix: string | undefined): string {
  if (!prefix || prefix === DEFAULT_TOOL_PREFIX) return text;
  return text.replace(MENTION, prefix);
}
