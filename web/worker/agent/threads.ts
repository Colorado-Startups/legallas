// SPDX-License-Identifier: Apache-2.0
// Research threads (plan D12), kept on Cloudflare in Durable Object SQLite:
// - The member's index lives in the member's own instance (instance.ts researchInstanceName): which threads exist,
//   their titles and when each was last used. It remembers its member's email so its own sweep (a schedule) can name
//   the thread instances to delete. A row leaves the index only once its thread's instance is gone: a delete or an
//   expiry first hides the row, and the sweep retries until the instance is destroyed.
// - Each thread is its own instance (researchThreadName; one AIChatAgent holds one conversation, as the Agents SDK
//   recommends for many chats per user). It records its owner, its last activity (any question, answered or refused,
//   since the transcript keeps the question either way) and the turns as the server wrote them, the only history a
//   model ever reads (steps.ts). It deletes itself THREAD_TTL_DAYS after its last activity.
// Deleted rows stay in Cloudflare's point-in-time recovery for up to 30 days (README). Pure over a small SQL surface,
// so Node tests run it on node:sqlite.
import { THREAD_TTL_DAYS, type ThreadSummary } from './protocol.ts';
import type { PastTurn } from './steps.ts';

/** The part of Durable Object SQL storage (ctx.storage.sql) these functions use. */
export interface Sql {
  exec<T = Record<string, unknown>>(query: string, ...bindings: (string | number | null)[]): { toArray(): T[] };
}

/** Threads one member may keep at once. */
export const MAX_THREADS = 200;
/** Turns a thread keeps for the model's context; the transcript itself is the AIChatAgent's. */
export const KEPT_TURNS = 20;
/** The longest thread title, in characters. */
export const TITLE_CHARS = 80;
const DAY_MS = 86_400_000;
const TTL_MS = THREAD_TTL_DAYS * DAY_MS;
/** A sweep or expiry runs this long after the moment it is due, so nothing is deleted a moment early. */
export const SWEEP_MARGIN_MS = 3_600_000;
/** How soon a sweep that could not delete an instance tries again. */
export const SWEEP_RETRY_MS = 3_600_000;

/** When a thread expires, given when it was last used. */
export function expiresAt(lastUsed: number): number {
  return lastUsed + TTL_MS;
}

/** A new thread id: 128 random bits, base64url (protocol.ts THREAD_ID). */
export function mintThreadId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A thread's title: its first question on one line, cut at a word within TITLE_CHARS. */
export function titleFrom(question: string): string {
  const line = question.replace(/\s+/g, ' ').trim();
  if (line.length <= TITLE_CHARS) return line;
  const cut = line.slice(0, TITLE_CHARS - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > TITLE_CHARS / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// --- The member's index -------------------------------------------------------------------------------------

/** Creates the research threads table when it is missing. */
export function ensureIndex(sql: Sql): void {
  sql.exec(
    "CREATE TABLE IF NOT EXISTS research_threads (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER)",
  );
  sql.exec('CREATE TABLE IF NOT EXISTS research_member (email TEXT NOT NULL)');
}

/** The index's member, or null before its first request. */
export function memberOf(sql: Sql): string | null {
  ensureIndex(sql);
  return sql.exec<{ email: string }>('SELECT email FROM research_member').toArray()[0]?.email ?? null;
}

/** True when `email` is this index's member: the first verified email to reach it, and every later one. */
export function indexOf(sql: Sql, email: string): boolean {
  const member = memberOf(sql);
  if (member === null) {
    sql.exec('INSERT INTO research_member (email) VALUES (?1)', email);
    return true;
  }
  return member === email;
}

/** A row the member can use: not deleted and not past its expiry (?1 is the expiry cutoff). */
const LIVE = 'deleted_at IS NULL AND updated_at >= ?1';

/** A new empty thread, or thread_limit when the member already keeps MAX_THREADS. */
export function createThread(sql: Sql, now: number): { id: string } | { error: 'thread_limit' } {
  ensureIndex(sql);
  const [{ n }] = sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM research_threads').toArray() as [{ n: number }];
  if (n >= MAX_THREADS) return { error: 'thread_limit' };
  const id = mintThreadId();
  sql.exec("INSERT INTO research_threads (id, title, created_at, updated_at) VALUES (?1, '', ?2, ?3)", id, now, now);
  return { id };
}

/** The member's live threads, newest first. */
export function listThreads(sql: Sql, now: number): ThreadSummary[] {
  ensureIndex(sql);
  return sql
    .exec<{ id: string; title: string; updated_at: number }>(`SELECT id, title, updated_at FROM research_threads WHERE ${LIVE} ORDER BY updated_at DESC, id`, now - TTL_MS)
    .toArray()
    .map((row) => ({ id: row.id, title: row.title, updatedAt: new Date(row.updated_at).toISOString(), expiresAt: new Date(expiresAt(row.updated_at)).toISOString() }));
}

/** Whether a live thread with the given id exists. */
export function hasThread(sql: Sql, id: string, now: number): boolean {
  ensureIndex(sql);
  return sql.exec(`SELECT 1 FROM research_threads WHERE ${LIVE} AND id = ?2`, now - TTL_MS, id).toArray().length > 0;
}

/** Marks activity on a thread: its time, and its title when one is given and the thread has none yet. */
export function touchThread(sql: Sql, id: string, title: string | null, now: number): void {
  ensureIndex(sql);
  sql.exec(
    "UPDATE research_threads SET updated_at = MAX(updated_at, ?2), title = CASE WHEN title = '' AND ?3 IS NOT NULL THEN ?3 ELSE title END WHERE id = ?1 AND deleted_at IS NULL",
    id,
    now,
    title,
  );
}

/** Hides a thread at once; its row goes when its instance is destroyed (sweepIndex). */
export function markDeleted(sql: Sql, id: string, now: number): void {
  ensureIndex(sql);
  sql.exec('UPDATE research_threads SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL', id, now);
}

/** Ids whose instance must go: deleted, or past expiry. */
export function dueThreads(sql: Sql, now: number): string[] {
  ensureIndex(sql);
  return sql
    .exec<{ id: string }>('SELECT id FROM research_threads WHERE deleted_at IS NOT NULL OR updated_at < ?1 ORDER BY id', now - TTL_MS)
    .toArray()
    .map((row) => row.id);
}

/** Drops a row, once its instance is destroyed. */
export function removeThread(sql: Sql, id: string): void {
  ensureIndex(sql);
  sql.exec('DELETE FROM research_threads WHERE id = ?1', id);
}

/** When the index's sweep is next due: soon while rows wait, else the first expiry, else never (null). */
export function nextSweep(sql: Sql, now: number): number | null {
  if (dueThreads(sql, now).length > 0) return now + SWEEP_RETRY_MS;
  const [row] = sql.exec<{ at: number | null }>('SELECT MIN(updated_at) AS at FROM research_threads').toArray();
  return typeof row?.at === 'number' ? expiresAt(row.at) + SWEEP_MARGIN_MS : null;
}

/**
 * Destroys the instance of every due thread, dropping its row only when `destroy` succeeds, and returns when to sweep
 * next. It runs whatever the kill switch says: the switch stops spend, never deletion.
 */
export async function sweepIndex(sql: Sql, now: number, destroy: (id: string) => Promise<boolean>): Promise<number | null> {
  for (const id of dueThreads(sql, now)) if (await destroy(id)) removeThread(sql, id);
  return nextSweep(sql, now);
}

// --- One thread ---------------------------------------------------------------------------------------------

function ensureThread(sql: Sql): void {
  sql.exec('CREATE TABLE IF NOT EXISTS research_owner (email TEXT NOT NULL, thread TEXT NOT NULL, last_activity INTEGER NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS research_turns (seq INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL, answer TEXT NOT NULL, at INTEGER NOT NULL)');
}

/** The thread's owner and id, or null before its first request. */
export function ownerOf(sql: Sql): { email: string; thread: string } | null {
  ensureThread(sql);
  return sql.exec<{ email: string; thread: string }>('SELECT email, thread FROM research_owner').toArray()[0] ?? null;
}

/**
 * Whether `email` owns this thread: the first verified email and thread id to reach it become its owner (`created`,
 * which starts its expiry), and every later request must carry the same pair. The name already derives from both
 * (instance.ts), so this is belt and braces.
 */
export function ownedBy(sql: Sql, email: string, thread: string, now: number): { owned: boolean; created: boolean } {
  const owner = ownerOf(sql);
  if (!owner) {
    sql.exec('INSERT INTO research_owner (email, thread, last_activity) VALUES (?1, ?2, ?3)', email, thread, now);
    return { owned: true, created: true };
  }
  return { owned: owner.email === email && owner.thread === thread, created: false };
}

/** Marks activity: a question arrived, answered or not. */
export function touchActivity(sql: Sql, now: number): void {
  ensureThread(sql);
  sql.exec('UPDATE research_owner SET last_activity = MAX(last_activity, ?1)', now);
}

/** The thread's last activity (ms), or null before its first request. */
export function lastActivity(sql: Sql): number | null {
  ensureThread(sql);
  return sql.exec<{ at: number }>('SELECT last_activity AS at FROM research_owner').toArray()[0]?.at ?? null;
}

/** The thread's expiry, decided: delete now, or look again at `next`. */
export function expiryOf(last: number | null, now: number): { due: true } | { due: false; next: number } {
  if (last === null || now >= expiresAt(last)) return { due: true };
  return { due: false, next: expiresAt(last) + SWEEP_MARGIN_MS };
}

/** Records one answered turn, keeping the last KEPT_TURNS. */
export function addTurn(sql: Sql, turn: PastTurn, now: number): void {
  ensureThread(sql);
  sql.exec('INSERT INTO research_turns (question, answer, at) VALUES (?1, ?2, ?3)', turn.question, turn.answer, now);
  sql.exec('DELETE FROM research_turns WHERE seq NOT IN (SELECT seq FROM research_turns ORDER BY seq DESC LIMIT ?1)', KEPT_TURNS);
}

/** The thread's turns as the server wrote them, oldest first. */
export function pastTurns(sql: Sql): PastTurn[] {
  ensureThread(sql);
  return sql.exec<PastTurn>('SELECT question, answer FROM research_turns ORDER BY seq').toArray();
}
