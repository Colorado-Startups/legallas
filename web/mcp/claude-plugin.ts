// SPDX-License-Identifier: Apache-2.0
// GET /connect/legallas-claude-plugin.zip: the Agent Skills folder (connect/skill/legallas/) as a Claude plugin, its
// .mcp.json pointing at this room's MCP URL, so one upload in claude.ai or Cowork (Customize > Plugins > Add > Upload
// plugin) brings the room's connector and its six kits. Pro adds the route beside the Copilot package (mcp/pro.ts).
// Public like /connect: it holds the room's names, its MCP URL and the repository's skill text, nothing else from env.
//
// | File | Holds |
// |---|---|
// | .claude-plugin/plugin.json | name, version, description, licence, the /connect page |
// | .mcp.json | the room's MCP server, `{"type":"http","url":MCP_RESOURCE}`; each member signs in through its OAuth |
// | skills/legallas/ | SKILL.md and references/, tool names in the room's prefix |
//
// GET /connect/legallas-skill.zip: the same skill folder alone, `legallas/` at the top, for OpenCode and any other
// Agent Skills app (unzip it into ~/.agents/skills/). The /connect page offers it with the plugin.
import { SKILL_FILES } from '../connect/skill/skill-data.generated.ts';
import { CONNECT_PATH, MCP_ORIGIN, MCP_RESOURCE, SERVER_NAME, type McpEnv } from './contract.ts';
import { withToolPrefix } from './tool-prefix.ts';
import { zipStore, type ZipEntry } from './zip.ts';
import { roomNamesOf, type RoomNames } from '../worker/room-names.ts';
import { STORED_NAME } from '../worker/stored-name.ts';

export const CLAUDE_PLUGIN_NAME = `${STORED_NAME}-claude-plugin.zip`;
export const CLAUDE_PLUGIN_PATH = `/connect/${CLAUDE_PLUGIN_NAME}`;
/** The skill's folder, which its SKILL.md `name` matches (connect/skill/skill.test.ts). */
export const SKILL_NAME = 'legallas';
export const SKILL_ZIP_NAME = `${STORED_NAME}-skill.zip`;
export const SKILL_ZIP_PATH = `/connect/${SKILL_ZIP_NAME}`;
/** Raise it with any change to what the plugin holds, so Claude offers the update. */
export const CLAUDE_PLUGIN_VERSION = '1.0.0';

const json = (value: unknown): Uint8Array => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

/** The plugin's files for a room with these names, in archive order. */
export function pluginEntries(names: Pick<RoomNames, 'instanceName' | 'toolPrefix'>): ZipEntry[] {
  const plugin = {
    name: STORED_NAME,
    version: CLAUDE_PLUGIN_VERSION,
    description: `The ${names.instanceName} room in Claude: its read-only connector and six kits (matter board, review grid, cite check, chronology, entity-choice matrix, deviation board).`,
    author: { name: 'Colorado Startups' },
    license: 'Apache-2.0',
    homepage: `${MCP_ORIGIN}${CONNECT_PATH}`,
  };
  const mcp = { mcpServers: { [SERVER_NAME]: { type: 'http', url: MCP_RESOURCE } } };
  return [{ name: '.claude-plugin/plugin.json', data: json(plugin) }, { name: '.mcp.json', data: json(mcp) }, ...skillEntries(names, 'skills/')];
}

/** The skill folder's files under `base`, tool names in the room's prefix. */
export function skillEntries(names: Pick<RoomNames, 'toolPrefix'>, base = ''): ZipEntry[] {
  return Object.entries(SKILL_FILES).map(([path, text]) => ({
    name: `${base}${SKILL_NAME}/${path}`,
    data: new TextEncoder().encode(withToolPrefix(text, names.toolPrefix)),
  }));
}

/** GET or HEAD: a ZIP built per request (a few kilobytes, stored, no compression). */
function zipDownload(request: Request, filename: string, entries: () => ZipEntry[]): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  return new Response(request.method === 'HEAD' ? null : zipStore(entries()), {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

/** The room's Claude plugin. */
export async function claudePlugin(request: Request, env: McpEnv): Promise<Response> {
  return zipDownload(request, CLAUDE_PLUGIN_NAME, () => pluginEntries(roomNamesOf(env)));
}

/** The room's skill folder alone. */
export async function skillFolder(request: Request, env: McpEnv): Promise<Response> {
  return zipDownload(request, SKILL_ZIP_NAME, () => skillEntries(roomNamesOf(env)));
}
