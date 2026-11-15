// SPDX-License-Identifier: Apache-2.0
// Legal hold (migrations 0017, 0019). A member turns it on when a dispute is expected: the duty to preserve can attach before
// any suit (FRCP 37(e), 2015 note; Ct. Ch. R. 37(e)), so a hold needs no case number. Then its custodians, the notice, each
// acknowledgment, reminders and the release are recorded (Sedona Legal Holds G8, G10, G11). Every date and actor is the
// server's. The hold screen also names what the room can't reach, word for word from docs/legal/product-notices.md (A7).
import { normalizeEmail } from './email.ts';

/** The A7 "can't reach" list, in its order. product-notices.md joins it with "; " after the heading below. */
export const HOLD_CANNOT_REACH = [
  "each AI account's chat history and any auto-delete",
  "Claude Code's local transcripts",
  "Copilot's retention policy",
  'messaging apps',
  'iCloud or OneDrive version history',
  'old phones and personal devices',
] as const;

export const HOLD_CANNOT_REACH_HEADING = "Your room can't reach these, so check them yourself:";

/** The notice's first sentence, for a hold on since `date` (YYYY-MM-DD). */
export const holdOnLine = (date: string) => `Legal hold is on since ${date}.`;

/**
 * What the screen says in place of A7's sentence on blocking: nothing refuses a removal yet, so the screen must not imply
 * it does. The change that makes removals refused replaces this line.
 */
export const HOLD_RECORDS_ONLY = "This records the hold. It doesn't block deleting, cleanup or uninstall yet, so don't delete or replace anything.";

export interface Hold {
  id: number;
  started_at: string;
  started_by: string;
  case_number: string | null;
}

/** The hold that is on, or null. */
export async function activeHold(db: D1Database): Promise<Hold | null> {
  return db
    .prepare('SELECT id, started_at, started_by, case_number FROM legal_holds WHERE released_at IS NULL ORDER BY id LIMIT 1')
    .first<Hold>();
}

export const MAX_CASE_NUMBER = 120;

/** An optional case number: absent, null or empty is none; else 1 to 120 printable characters, trimmed. */
export function parseCaseNumber(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_CASE_NUMBER || /[\u0000-\u001f\u007f]/.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * Starts a hold as `actor` at `now`, unless one is on: one INSERT that checks, so two can't start together. Writes the
 * hold_started event in the same batch. Null when a hold was already on.
 */
export async function startHold(db: D1Database, actor: string, now: Date, caseNumber: string | null = null): Promise<Hold | null> {
  const at = now.toISOString();
  const [inserted] = await db.batch([
    db
      .prepare(
        'INSERT INTO legal_holds (started_at, started_by, case_number) SELECT ?1, ?2, ?3 ' +
          'WHERE NOT EXISTS (SELECT 1 FROM legal_holds WHERE released_at IS NULL)',
      )
      .bind(at, actor, caseNumber),
    db
      .prepare(
        "INSERT INTO hold_events (ts, hold_id, actor, action) SELECT ?1, id, ?2, 'hold_started' FROM legal_holds " +
          'WHERE released_at IS NULL AND started_at = ?1 AND started_by = ?2',
      )
      .bind(at, actor),
  ]);
  if ((inserted?.meta.changes ?? 0) === 0) return null;
  return activeHold(db);
}

/**
 * The notice a member sends each custodian (the room sends no email), with what to keep, the auto-delete and device
 * instructions, and the contact: the member who records it (Sedona Legal Holds G8; research P6, P10).
 */
export const holdNotice = (contact: string) =>
  'A legal hold is on. Keep everything about this dispute: documents, email, chats, texts and files, on every device and ' +
  "account you use. Turn off auto-delete in each app and account. Don't wipe, sell or replace a phone or computer until " +
  `it is backed up. Questions: ${contact}. Reply to say you got this notice.`;

export interface Custodian {
  email: string;
  name: string | null;
  added_at: string;
  notified_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  last_reminded_at: string | null;
  /** No acknowledgment recorded yet: the screen flags it. */
  unacknowledged: boolean;
}

/** The hold's custodians, by email. */
export async function custodians(db: D1Database, holdId: number): Promise<Custodian[]> {
  const { results } = await db
    .prepare('SELECT email, name, added_at, notified_at, acknowledged_at, acknowledged_by, last_reminded_at FROM hold_custodians WHERE hold_id = ?1 ORDER BY email')
    .bind(holdId)
    .all<Omit<Custodian, 'unacknowledged'>>();
  return results.map((row) => ({ ...row, unacknowledged: row.acknowledged_at === null }));
}

const EVENT = 'INSERT INTO hold_events (ts, hold_id, actor, action, subject) ';

/** Adds a custodian to hold `holdId`; false when the email isn't one or they are on it already. */
export async function addCustodian(db: D1Database, holdId: number, actor: string, rawEmail: unknown, name: string | null, now: Date): Promise<boolean> {
  const email = normalizeEmail(rawEmail);
  if (!email || email.includes(':')) return false;
  const at = now.toISOString();
  const [added] = await db.batch([
    db.prepare('INSERT INTO hold_custodians (hold_id, email, name, added_by, added_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT DO NOTHING').bind(holdId, email, name, actor, at),
    // A custodian is added once per hold (no remove), so a repeat in the same millisecond, which ON CONFLICT turns away,
    // logs no second event either.
    db.prepare(
      `${EVENT}SELECT ?3, ?1, ?4, 'custodian_added', ?2 FROM hold_custodians WHERE hold_id = ?1 AND email = ?2 AND added_at = ?3 ` +
        "AND NOT EXISTS (SELECT 1 FROM hold_events WHERE hold_id = ?1 AND action = 'custodian_added' AND subject = ?2)",
    ).bind(holdId, email, at, actor),
  ]);
  return (added?.meta.changes ?? 0) > 0;
}

/** Records that `actor` sent the notice to every custodian who hasn't had it. Returns how many. */
export async function recordNotice(db: D1Database, holdId: number, actor: string, now: Date): Promise<number> {
  return stamp(db, holdId, actor, now, 'notified_at', 'notified_at IS NULL', 'notice_sent');
}

/** Records a reminder to every custodian notified and not yet acknowledged. Returns how many. */
export async function recordReminders(db: D1Database, holdId: number, actor: string, now: Date): Promise<number> {
  return stamp(db, holdId, actor, now, 'last_reminded_at', 'notified_at IS NOT NULL AND acknowledged_at IS NULL', 'reminder_sent');
}

/** Records custodian `email`'s acknowledgment, once. False when they aren't a custodian or acknowledged already. */
export async function recordAcknowledgment(db: D1Database, holdId: number, actor: string, rawEmail: unknown, now: Date): Promise<boolean> {
  const email = normalizeEmail(rawEmail);
  if (!email) return false;
  const at = now.toISOString();
  const [done] = await db.batch([
    db.prepare('UPDATE hold_custodians SET acknowledged_at = ?3, acknowledged_by = ?4 WHERE hold_id = ?1 AND email = ?2 AND acknowledged_at IS NULL').bind(holdId, email, at, actor),
    // A custodian acknowledges once, so a second event for them is refused outright: matching the time alone wrote a
    // second one when a repeat landed in the same millisecond.
    db.prepare(
      `${EVENT}SELECT ?3, ?1, ?4, 'notice_acknowledged', ?2 FROM hold_custodians WHERE hold_id = ?1 AND email = ?2 AND acknowledged_at = ?3 ` +
        "AND NOT EXISTS (SELECT 1 FROM hold_events WHERE hold_id = ?1 AND action = 'notice_acknowledged' AND subject = ?2)",
    ).bind(holdId, email, at, actor),
  ]);
  return (done?.meta.changes ?? 0) > 0;
}

/** Sets `column` to now on the custodians `which` selects, with one event each. */
async function stamp(db: D1Database, holdId: number, actor: string, now: Date, column: 'notified_at' | 'last_reminded_at', which: string, action: 'notice_sent' | 'reminder_sent'): Promise<number> {
  const at = now.toISOString();
  const [done] = await db.batch([
    db.prepare(`UPDATE hold_custodians SET ${column} = ?2 WHERE hold_id = ?1 AND ${which}`).bind(holdId, at),
    db.prepare(`${EVENT}SELECT ?2, ?1, ?3, '${action}', email FROM hold_custodians WHERE hold_id = ?1 AND ${column} = ?2 ORDER BY email`).bind(holdId, at, actor),
  ]);
  return done?.meta.changes ?? 0;
}

export const MAX_RELEASE_REASON = 2000;

/** Releases the hold that is on, as `actor` at `now`, with a reason; the server's time, so never back-dated. Null when none is on. */
export async function releaseHold(db: D1Database, actor: string, reason: string, now: Date): Promise<number | null> {
  const hold = await activeHold(db);
  if (!hold) return null;
  const at = now.toISOString();
  const [done] = await db.batch([
    db.prepare('UPDATE legal_holds SET released_at = ?2, released_by = ?3, release_reason = ?4 WHERE id = ?1 AND released_at IS NULL').bind(hold.id, at, actor, reason),
    db.prepare(`${EVENT}SELECT ?2, id, ?3, 'hold_released', NULL FROM legal_holds WHERE id = ?1 AND released_at = ?2`).bind(hold.id, at, actor),
  ]);
  return (done?.meta.changes ?? 0) > 0 ? hold.id : null;
}
