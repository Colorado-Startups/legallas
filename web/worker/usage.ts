// SPDX-License-Identifier: Apache-2.0
// The usage table (migrations 0001 and 0004): per member and UTC day, Ask's questions (ask.ts) and the MCP's tool
// calls (mcp/caps.ts). No imports, so both Workers can use it.

/** The usage table's day key: the UTC date, YYYY-MM-DD. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
