// SPDX-License-Identifier: Apache-2.0
// AI connections after the install becomes a litigation room (scripts/litigation.ts, migration 0018; research J21): every
// grant stops at the conversion, and one returns only when a person approves it again at /authorize, which stamps the
// new grant's Props.reapprovedAt. Before any conversion nothing reads or stamps anything new.
import type { Props } from './contract.ts';

/** When the conversion started, or null: none yet, or a database without migration 0018. */
export async function convertedAt(db: D1Database): Promise<string | null> {
  try {
    return (await db.prepare('SELECT min(started_at) AS at FROM conversions').first<{ at: string | null }>())?.at ?? null;
  } catch (error) {
    if (error instanceof Error && error.message.includes('no such table: conversions')) return null;
    throw error;
  }
}

/** Whether this grant stopped at the conversion: it was not approved again since. */
export function stoppedByConversion(props: Pick<Props, 'reapprovedAt'>, at: string | null): boolean {
  return at !== null && !(typeof props.reapprovedAt === 'string' && props.reapprovedAt >= at);
}
