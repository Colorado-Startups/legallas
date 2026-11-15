// SPDX-License-Identifier: Apache-2.0
// Options and a recommendation, always (the owner, issue #19; docs/legal/product-notices.md A4 and A11). Ask's prompt
// (prompt.ts RECOMMEND_RULES, Research mode's too: agent/final.ts), the connector's instructions (mcp/server.ts
// RECOMMEND_INSTRUCTION) and a room's Copilot agent (connect/copilot/room-package.ts) add them only while the room's
// RECOMMEND is "1", set once the replica eval passes, so a room that updates answers as before.

/** RECOMMEND: "1" turns options and a recommendation on; anything else, or unset, leaves them off. */
export interface RecommendSetting {
  RECOMMEND?: string;
}

export function recommends(env: RecommendSetting): boolean {
  return env.RECOMMEND === '1';
}
