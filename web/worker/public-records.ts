// SPDX-License-Identifier: Apache-2.0
// "Check who you're dealing with": before a deal or a signature, a member looks up a person or a company in public
// records (worker/public-records-sources.ts says which, and how). The name being checked leaves the room for those
// public sites, so nothing is sent until the member approves that exact name in the room (/checks/, worker/routes/
// checks.ts). An AI (a connected one through legallas_check_public_records, or Ask) can only ask; the approval is a
// click by the signed-in member, never something a model can give.
//
// Settings (wrangler.jsonc and wrangler.mcp.jsonc, the same in both):
// - PUBLIC_RECORDS: "1" turns the check on; "0" (the examples' value), or unset, keeps it off: the tool is not listed
//   and Ask is not offered it. Off unless set, so a room that never chose it sends no name out.
// - PUBLIC_RECORDS_CONTACT: the room owner's contact address, sent to the SEC in the User-Agent header as its fair-access
//   rules require of automated tools. Unset: EDGAR is not searched automatically, only linked.
// - COURTLISTENER_TOKEN (secret): the room owner's own CourtListener API token; CourtListener's REST API refuses
//   requests without one. Unset: CourtListener is only linked.
//
// Privacy: a request row holds the name until it lapses (migration 0014), and is deleted after, by the room's approval
// routes or the MCP Worker's daily cron (sweepLapsedChecks). What the sources return is never stored or logged. Logs
// carry reason words, never a name.

/** The Fair Credit Reporting Act notice every result and the approval page carry. */
export const NOT_A_CONSUMER_REPORT =
  'Not a consumer report. This check is not a consumer report as the Fair Credit Reporting Act defines one (15 U.S.C. § 1681a(d)), ' +
  'and Legallas does not act as a consumer reporting agency. Do not use it, in whole or in part, to decide whether a person is ' +
  'eligible for credit, insurance, employment or housing, or for any other purpose the Act covers (15 U.S.C. § 1681b). Use it only ' +
  'to research a party before a business deal or a signature.';

/** What a result is, and is not. */
export const RECORDS_NOT_CONCLUSIONS =
  "These are public records as each source shows them, not findings about anyone's honesty or conduct. A record can be wrong, " +
  'out of date, or about someone else with the same name; confirm identity with details such as an entity ID, CIK or CRD number.';

export const NOT_A_LAWYER =
  "Not a lawyer or law firm. You aren't receiving legal advice from a licensed lawyer. Have your own lawyer review anything " +
  'here that a decision depends on, especially a ' +
  'disclosure, a lawsuit or a regulatory action.';

/** The settings a room may set. Both Workers carry them. */
export interface PublicRecordsVars {
  PUBLIC_RECORDS?: string;
  PUBLIC_RECORDS_CONTACT?: string;
  COURTLISTENER_TOKEN?: string;
}

/** On only when the room sets PUBLIC_RECORDS to "1". */
export function publicRecordsEnabled(env: PublicRecordsVars): boolean {
  return env.PUBLIC_RECORDS?.trim() === '1';
}

/** A plain email address, the only shape the SEC contact may take (it goes into a header). */
const CONTACT = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;

/** The room's SEC contact address when it is a plain email address; null otherwise. */
export function secContact(env: PublicRecordsVars): string | null {
  const value = env.PUBLIC_RECORDS_CONTACT?.trim() ?? '';
  return CONTACT.test(value) ? value : null;
}

/** The room's CourtListener token when it looks like one (letters and digits only); null otherwise. */
export function courtListenerToken(env: PublicRecordsVars): string | null {
  const value = env.COURTLISTENER_TOKEN?.trim() ?? '';
  return /^[A-Za-z0-9]{20,128}$/.test(value) ? value : null;
}

export type CheckKind = 'person' | 'company';

export const MIN_NAME_CHARS = 2;
export const MAX_NAME_CHARS = 120;
/**
 * Letters (any script), digits, spaces and the punctuation names use: . , ' ’ & - ( ) /. Nothing that could be read as a
 * search operator beyond that, and no quotes, so a name can be put inside a quoted phrase safely.
 */
const NAME = /^[\p{L}\p{M}\p{N} .,'’&()/-]+$/u;

/** A name as the check will send it: spaces collapsed and trimmed, within the limits and NAME; null otherwise. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if ([...name].length < MIN_NAME_CHARS || [...name].length > MAX_NAME_CHARS) return null;
  if (!NAME.test(name) || !/[\p{L}\p{N}]/u.test(name)) return null;
  return name;
}

/** What makes two requests the same name: lower case, punctuation other than & dropped, spaces collapsed. */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,'’()/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** How long a request waits for the member, and how long an approval lasts once given. */
export const PENDING_MINUTES = 30;
export const APPROVED_MINUTES = 60;

export type CheckState = 'pending' | 'approved' | 'declined';

/** One request as the room and the tool read it. */
export interface CheckRequest {
  id: string;
  email: string;
  name: string;
  kind: CheckKind;
  /** The automated sources (ids) the name goes to once approved: shown on the page, and the only ones the check uses. */
  sources: string[];
  state: CheckState;
  via: string;
  createdAt: string;
  decidedAt: string | null;
  expiresAt: string;
}

interface Row {
  id: string;
  email: string;
  name: string;
  kind: CheckKind;
  sources: string;
  state: CheckState;
  via: string;
  created_at: string;
  decided_at: string | null;
  expires_at: string;
}

const COLUMNS = 'id, email, name, kind, sources, state, via, created_at, decided_at, expires_at';

function fromRow(row: Row): CheckRequest {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    kind: row.kind,
    sources: row.sources.split(',').filter(Boolean),
    state: row.state,
    via: row.via,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    expiresAt: row.expires_at,
  };
}

const iso = (date: Date) => date.toISOString();
const plusMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);

/** An id nobody can guess: 128 random bits, base64url. */
export function newCheckId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const CHECK_ID = /^[A-Za-z0-9_-]{16,64}$/;

/** The app name stored with a request, kept short and plain. */
function cleanVia(via: string): string {
  const plain = via.replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return plain || 'an AI app';
}

/** The member's approval for this name and kind, if one is still in force. */
export async function findApproved(db: D1Database, email: string, name: string, kind: CheckKind, now: Date): Promise<CheckRequest | null> {
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM record_checks WHERE email = ? AND name_key = ? AND kind = ? AND state = 'approved' AND expires_at > ? ORDER BY expires_at DESC LIMIT 1`)
    .bind(email, nameKey(name), kind, iso(now))
    .first<Row>();
  return row ? fromRow(row) : null;
}

/**
 * Deletes every request past its expiry, anyone's, so lapsed names do not stay in the room; returns how many. Run by the
 * room's approval routes (worker/routes/checks.ts) and the MCP Worker's daily cron, never by the tool, whose only write
 * is the request itself.
 */
export async function sweepLapsedChecks(db: D1Database, now: Date): Promise<number> {
  const result = await db.prepare('DELETE FROM record_checks WHERE expires_at <= ?').bind(iso(now)).run();
  return result.meta.changes ?? 0;
}

/** Requests one member may have waiting at once: an AI caught in a loop cannot fill the room with names. */
export const MAX_PENDING = 10;

/**
 * A request for the member to approve: their pending one for this name, kind and sources if it is still open, else a new
 * one. Null when the member already has MAX_PENDING requests waiting: nothing is stored.
 */
export async function requestCheck(db: D1Database, input: { email: string; name: string; kind: CheckKind; sources: readonly string[]; via: string; now: Date }): Promise<CheckRequest | null> {
  const now = iso(input.now);
  const sources = [...input.sources].join(',');
  const open = await db
    .prepare(`SELECT ${COLUMNS} FROM record_checks WHERE email = ? AND name_key = ? AND kind = ? AND sources = ? AND state = 'pending' AND expires_at > ? ORDER BY created_at DESC LIMIT 1`)
    .bind(input.email, nameKey(input.name), input.kind, sources, now)
    .first<Row>();
  if (open) return fromRow(open);
  const waiting = await db
    .prepare("SELECT COUNT(*) AS n FROM record_checks WHERE email = ? AND state = 'pending' AND expires_at > ?")
    .bind(input.email, now)
    .first<number>('n');
  if ((waiting ?? 0) >= MAX_PENDING) return null;
  const row: Row = {
    id: newCheckId(),
    email: input.email,
    name: input.name,
    kind: input.kind,
    sources,
    state: 'pending',
    via: cleanVia(input.via),
    created_at: now,
    decided_at: null,
    expires_at: iso(plusMinutes(input.now, PENDING_MINUTES)),
  };
  await db
    .prepare('INSERT INTO record_checks (id, email, name, name_key, kind, sources, state, via, created_at, decided_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(row.id, row.email, row.name, nameKey(row.name), row.kind, row.sources, row.state, row.via, row.created_at, row.decided_at, row.expires_at)
    .run();
  return fromRow(row);
}

/** The member's own request by id, while it has not lapsed. Another member's, or a lapsed one, reads as null. */
export async function readCheck(db: D1Database, id: string, email: string, now: Date): Promise<CheckRequest | null> {
  if (!CHECK_ID.test(id)) return null;
  const row = await db.prepare(`SELECT ${COLUMNS} FROM record_checks WHERE id = ? AND email = ? AND expires_at > ?`).bind(id, email, iso(now)).first<Row>();
  return row ? fromRow(row) : null;
}

export type Decision = 'approve' | 'decline';

/**
 * The member's decision on their own pending request. Approving starts the approval's hour; declining keeps the row
 * until the request would have lapsed, so the AI can be told it was declined. Null when there is no such pending request.
 */
export async function decideCheck(db: D1Database, id: string, email: string, decision: Decision, now: Date): Promise<CheckRequest | null> {
  const current = await readCheck(db, id, email, now);
  if (!current || current.state !== 'pending') return null;
  const state: CheckState = decision === 'approve' ? 'approved' : 'declined';
  const expires = decision === 'approve' ? iso(plusMinutes(now, APPROVED_MINUTES)) : current.expiresAt;
  const result = await db
    .prepare("UPDATE record_checks SET state = ?, decided_at = ?, expires_at = ? WHERE id = ? AND email = ? AND state = 'pending'")
    .bind(state, iso(now), expires, id, email)
    .run();
  if (result.meta.changes !== 1) return null;
  return { ...current, state, decidedAt: iso(now), expiresAt: expires };
}

/** The member's latest declined request for this name and kind, if it has not lapsed: the AI is told, not asked again. */
export async function findDeclined(db: D1Database, email: string, name: string, kind: CheckKind, now: Date): Promise<CheckRequest | null> {
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM record_checks WHERE email = ? AND name_key = ? AND kind = ? AND state = 'declined' AND expires_at > ? ORDER BY decided_at DESC LIMIT 1`)
    .bind(email, nameKey(name), kind, iso(now))
    .first<Row>();
  return row ? fromRow(row) : null;
}
