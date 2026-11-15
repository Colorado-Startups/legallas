// SPDX-License-Identifier: Apache-2.0
// A room's own copy of the app package: the product's files with the room's app ID, developer, hosts and names
// (worker/room-settings.ts, worker/stored-name.ts). Firms that installed the room's agent keep it only if its app ID
// stays the same. Bytes that change are rebuilt from these, never patched: `node connect/copilot/mcp-tools.ts --room`
// writes them, with the pinned tool definitions, in a room's own build folder. A room's wrangler.mcp.jsonc runs that
// before bundling, as its build command, under scripts/room-preload.ts, so its Worker carries its own package.
import { RECOMMEND_INSTRUCTION } from '../../mcp/server.ts';
import { recommends, type RecommendSetting } from '../../worker/recommend.ts';
import { copilotAppId, instanceName, mcpHost, operatorName, ownerWebsite, toolPrefix } from '../../worker/room-settings.ts';
import { STORED_NAME } from '../../worker/stored-name.ts';
import { PRIVACY_URL, TERMS_URL } from './validate.ts';

/** The longest name a plugin may show (validate.ts). */
const NAME_FOR_HUMAN_MAX = 20;

/** The app package files a room's settings change. The rest (the icons, mcp-tools.json) stay or are generated. */
export const ROOM_FILES = ['ai-plugin.json', 'declarativeAgent.json', 'manifest.json'] as const;

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/**
 * The file `name` with the room's names and hosts in place of the product's, in its form on disk. `vars` are the room's
 * wrangler.mcp.jsonc vars: with RECOMMEND "1", the agent's instructions carry the connector's recommendation line.
 */
export function roomPackageFile(name: (typeof ROOM_FILES)[number], text: string, vars: RecommendSetting = {}): string {
  const renamed = text
    .replaceAll('Legallas', instanceName)
    .replaceAll('LEGALLAS_', `${STORED_NAME.toUpperCase()}_`)
    .replaceAll('legallas_', toolPrefix ?? `${STORED_NAME}_`)
    .replaceAll('legallas', STORED_NAME)
    .replaceAll('mcp.room.example.com', mcpHost);
  if (name === 'ai-plugin.json') {
    const counselRoom = `${instanceName} counsel room`;
    return json({ ...(JSON.parse(renamed) as object), name_for_human: counselRoom.length <= NAME_FOR_HUMAN_MAX ? counselRoom : `${instanceName} room` });
  }
  if (name === 'manifest.json') {
    if (!copilotAppId) throw new Error('room config: copilotAppId is required to build the room\'s app package');
    return json({
      ...(JSON.parse(renamed) as object),
      id: copilotAppId,
      developer: { name: operatorName, websiteUrl: ownerWebsite, privacyUrl: PRIVACY_URL, termsOfUseUrl: TERMS_URL },
    });
  }
  if (name === 'declarativeAgent.json' && recommends(vars)) {
    const agent = JSON.parse(renamed) as { instructions: string };
    const paragraphs = agent.instructions.split('\n\n');
    paragraphs.splice(-1, 0, RECOMMEND_INSTRUCTION); // after the notice, before the closing paragraph
    return json({ ...agent, instructions: paragraphs.join('\n\n') });
  }
  return renamed;
}
