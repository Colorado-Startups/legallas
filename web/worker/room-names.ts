// SPDX-License-Identifier: Apache-2.0
/**
 * The three names a room owner may change, with the owner's values as the defaults, so an unset name renders
 * exactly what the room showed before they were configurable (room-names.test.ts pins the defaults):
 *
 * - the instance name: the room's own name in page titles, the header, emails and the MCP server's title;
 * - the assistant name: the AI character in Ask and its research step;
 * - the MCP tool prefix: the start of every tool name the remote MCP server lists (mcp/tool-prefix.ts).
 *
 * The Astro build reads `instanceName` and `assistantName` from the room's gitignored config, room.config.json or
 * legallas.config.json (src/scripts/room-config.ts). The Workers read the optional vars INSTANCE_NAME, ASSISTANT_NAME and MCP_TOOL_PREFIX. The
 * character's email signature, portrait and mailbox (signature.ts) stay the owner's and follow neither.
 *
 * A value that is unset, blank or malformed falls back to the default, as CONTROL_PREFIX does. This file has no
 * imports, so the room's browser scripts and the scripts tsconfig can use it as well.
 */

export const DEFAULT_INSTANCE_NAME = 'Legallas';
export const DEFAULT_ASSISTANT_NAME = 'Legallas';
export const DEFAULT_TOOL_PREFIX = 'legallas_';

/**
 * A name: 1 to 40 characters with no markup or header characters (`<`, `>`, `&`, `"`, `'`, control characters),
 * so it is safe as written in HTML, an email subject or a From name.
 */
const NAME = /^[^<>&"'\p{Cc}]{1,40}$/u;
/**
 * A tool prefix: a lower-case letter, up to 15 more letters or digits, and an underscore. Every tool name then fits
 * Microsoft's `^[A-Za-z0-9_]+$` and Claude's 64-character limit, and Sources/LegallasMCP accepts the same pattern.
 */
export const TOOL_PREFIX_PATTERN = /^[a-z][a-z0-9]{0,15}_$/;

export interface RoomNames {
  instanceName: string;
  assistantName: string;
  toolPrefix: string;
}

/** The Worker vars that set the names (wrangler vars; all optional). */
export interface RoomNameVars {
  INSTANCE_NAME?: string;
  ASSISTANT_NAME?: string;
  MCP_TOOL_PREFIX?: string;
}

/** docs/legal/product-notices.md A1, word for word (room-names.test.ts). */
export const ASSISTANT_NAME_REFUSED = 'That name could make people think a lawyer is answering. Please pick another.';

/** A1's words as whole words, any case, plurals too. "Esq" only ever follows a person's name. */
const REFUSED = /(?:^| )(?:lawyer|attorney|counsel|counsell?or|esquire|esq|advocate|law firm|legal advis[eo]r)(?:e?s)?(?= |$)/;

/** ASSISTANT_NAME_REFUSED if a name could pass for a lawyer, else null. Words split at non-letters and "LawyerBot". */
export function assistantNameProblem(name: string): string | null {
  const words = name.replace(/(\p{Ll})(\p{Lu})|(\p{Lu})(?=\p{Lu}\p{Ll})/gu, '$1$3 $2').toLowerCase().split(/[^\p{L}]+/u).join(' ');
  return REFUSED.test(words) ? ASSISTANT_NAME_REFUSED : null;
}

function nameOr(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return NAME.test(trimmed) ? trimmed : fallback;
}

/** The names from config values (the room config's keys), each falling back to its default. */
export function roomNames(values: { instanceName?: unknown; assistantName?: unknown; toolPrefix?: unknown } = {}): RoomNames {
  const prefix = typeof values.toolPrefix === 'string' ? values.toolPrefix.trim() : '';
  const assistantName = nameOr(values.assistantName, DEFAULT_ASSISTANT_NAME);
  return {
    instanceName: nameOr(values.instanceName, DEFAULT_INSTANCE_NAME),
    assistantName: assistantNameProblem(assistantName) === null ? assistantName : DEFAULT_ASSISTANT_NAME,
    toolPrefix: TOOL_PREFIX_PATTERN.test(prefix) ? prefix : DEFAULT_TOOL_PREFIX,
  };
}

/** The names from a Worker's vars. */
export function roomNamesOf(env: RoomNameVars): RoomNames {
  return roomNames({ instanceName: env.INSTANCE_NAME, assistantName: env.ASSISTANT_NAME, toolPrefix: env.MCP_TOOL_PREFIX });
}
