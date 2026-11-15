// SPDX-License-Identifier: Apache-2.0
// What each investor could see on a past date (research J6; scripts/litigation.ts). The conversion ends invitations and
// removes no row, so a date before it still answers: each investor invitation active at that instant (worker/rooms.ts
// ACTIVE_SQL, read then) and what its room showed (worker/versions.ts roomAsOf).
import type { Env } from './env.ts';
import { roomAsOf, type ShownDocument } from './versions.ts';

export interface InvestorView {
  email: string;
  roomId: string;
  documents: ShownDocument[];
}

/** ?1 is the instant. Joined by then, or still inside the accept window, as access is derived on every request. */
const ACTIVE_AT_SQL =
  "SELECT g.email, g.room_id FROM room_members g JOIN rooms r ON r.id = g.room_id WHERE g.role = 'investor' AND r.kind = 'deal' " +
  'AND g.invited_at <= ?1 AND g.expires_at > ?1 AND (g.revoked_at IS NULL OR g.revoked_at > ?1) ' +
  'AND ((g.joined_at IS NOT NULL AND g.joined_at <= ?1) OR g.accept_by > ?1) ORDER BY g.email, g.room_id';

/** Every investor who could see a room at `at`, and what it showed them; a room archived by then shows nothing. */
export async function investorsAsOf(env: Pick<Env, 'DB' | 'FILES'>, at: string, now: Date): Promise<InvestorView[]> {
  const { results } = await env.DB.prepare(ACTIVE_AT_SQL).bind(at).all<{ email: string; room_id: string }>();
  const views: InvestorView[] = [];
  for (const row of results) views.push({ email: row.email, roomId: row.room_id, documents: (await roomAsOf(env, row.room_id, at, now)) ?? [] });
  return views;
}
