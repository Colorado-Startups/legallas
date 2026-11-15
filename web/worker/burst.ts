// SPDX-License-Identifier: Apache-2.0
// Per-member burst limits (Workers Rate Limiting bindings), shared by the room (ASK_LIMIT) and legallas-mcp
// (TOOL_LIMIT). They sit in front of the daily caps in D1 (usage.questions, usage.tool_calls), so a runaway
// loop or a double submit is slowed down before it can spend a member's whole day in a minute.

/** Seconds a limited caller is told to wait: both limits use a 60 s period (wrangler.jsonc, wrangler.mcp.jsonc). */
export const BURST_RETRY_AFTER_SECONDS = 60;

/**
 * True when `key` (a member's normalized email) is within the limit. A missing binding (an old local config)
 * or one that throws fails open and logs `code`: availability over strictness, because the daily cap still
 * holds for every caller. Sign-in has none, so it fails closed (mcp/gates.ts). Logs carry the code only, never the key.
 */
export async function withinBurst(limiter: RateLimit | undefined, key: string, code: string): Promise<boolean> {
  if (!limiter) return true;
  try {
    const { success } = await limiter.limit({ key });
    return success;
  } catch {
    console.error(code);
    return true;
  }
}
