// SPDX-License-Identifier: Apache-2.0
// The per-member daily tool-call cap (owner: session C1), on usage.tool_calls from migration 0004.
import { DEFAULT_DAILY_TOOL_CAP, type McpEnv } from './contract.ts';

/** DAILY_TOOL_CAP as a positive integer, else the default. */
export function dailyToolCap(env: Pick<McpEnv, 'DAILY_TOOL_CAP'>): number {
  const n = Number(env.DAILY_TOOL_CAP);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DAILY_TOOL_CAP;
}

/**
 * Counts one call for `email` on `day` (YYYY-MM-DD UTC); false once the cap is reached. One atomic upsert, like
 * worker/ask.ts takeQuestion: the UPDATE only runs below the cap, and RETURNING yields no row when it does not,
 * so concurrent calls can never pass the cap. It shares the row with Ask's `questions` and never changes it.
 */
export async function takeToolCall(db: D1Database, email: string, cap: number, day: string): Promise<boolean> {
  if (cap <= 0) return false;
  const row = await db
    .prepare(
      'INSERT INTO usage (email, day, tool_calls) VALUES (?1, ?2, 1) ' +
        'ON CONFLICT (email, day) DO UPDATE SET tool_calls = tool_calls + 1 WHERE tool_calls < ?3 ' +
        'RETURNING tool_calls',
    )
    .bind(email, day, cap)
    .first<{ tool_calls: number }>();
  return row !== null;
}
