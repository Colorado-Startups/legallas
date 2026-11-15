// SPDX-License-Identifier: Apache-2.0
// The audit log: one shared way to write rows, and the owner's read of it (/api/activity).
// Rows record who, what, which document, when and from where. Never text: no comment bodies, questions,
// filenames or paths (the document name is joined in only when the owner reads the log).
import { normalizeEmail } from './email.ts';
import type { RequestContext } from './env.ts';

/** Every action audit_log accepts (its CHECK constraint, last rebuilt in migrations/0004_ai_connections.sql). */
export const AUDIT_ACTIONS = [
  'view',
  'download',
  'upload',
  'comment',
  'resolve',
  'reopen',
  'ai_question',
  'sync_added',
  'sync_changed',
  'sync_removed',
  'key',
  'unkey',
  // Written by legallas-mcp (mcp/audit.ts) with `via` naming the AI app.
  'ai_connect',
  'ai_disconnect',
  'ai_search',
  'ai_read',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** The activity page merges sign-ins (their own table) into the same feed under this action. */
export const ACTIVITY_ACTIONS = [...AUDIT_ACTIONS, 'sign_in'] as const;

/**
 * Proposal steps (proposal_events, migration 0013) the feed shows while the room's proposals are on, as
 * `proposal_<action>`. Not a filter choice, so with proposals off the page and its filters are as they were.
 */
export const PROPOSAL_ACTIVITY = ['proposal_proposed', 'proposal_approved', 'proposal_approved_edited', 'proposal_rejected'] as const;
/**
 * Checklist changes (checklist_events, migration 0024) the feed shows while the room's checklist is on, as
 * `checklist_<action>`, with the item's id in `via`. Not a filter choice, as with proposals.
 */
export const CHECKLIST_ACTIVITY = ['checklist_matched', 'checklist_match_changed', 'checklist_unmatched', 'checklist_not_applicable', 'checklist_applies'] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number] | (typeof PROPOSAL_ACTIVITY)[number] | (typeof CHECKLIST_ACTIVITY)[number];

const MAX_USER_AGENT = 256;

/** The caller's IP and a bounded user agent, as recorded in audit and sign-in rows. */
export function clientInfo(request: Request): { ip: string | null; userAgent: string | null } {
  return {
    ip: request.headers.get('CF-Connecting-IP'),
    userAgent: request.headers.get('User-Agent')?.slice(0, MAX_USER_AGENT) ?? null,
  };
}

/**
 * audit_log.via for a room row that is not one document's own read: the Documents index export (worker/export.ts) or
 * the audit log copy (worker/audit-chain.ts).
 */
export type RoomVia = 'index-csv' | 'audit-log';

/**
 * The INSERT for one audit row, for callers that batch it with their own write. `via` says how a room row was made
 * when the action alone does not (the index export's `download`); the room's other rows leave it NULL, as before.
 */
export function auditStatement(c: RequestContext, action: AuditAction, documentId: string | null, via: RoomVia | null = null): D1PreparedStatement {
  const { ip, userAgent } = clientInfo(c.request);
  return c.env.DB.prepare(
    'INSERT INTO audit_log (email, action, document_id, ip, user_agent, via) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
  ).bind(c.member.email, action, documentId, ip, userAgent, via);
}

/** How long a repeated read of the same document by the same member counts as one read. */
export const READ_DEDUPE_MINUTES = 10;

/**
 * Writes one audit row unless this member logged the same action on the same document within
 * READ_DEDUPE_MINUTES. File reads use it: PDF.js and resumed downloads make many requests for one read,
 * and every request must still be able to leave a row (a script pulling /files directly included).
 */
export async function auditOnce(c: RequestContext, action: 'view' | 'download', documentId: string): Promise<void> {
  const { ip, userAgent } = clientInfo(c.request);
  await c.env.DB.prepare(
    'INSERT INTO audit_log (email, action, document_id, ip, user_agent) SELECT ?1, ?2, ?3, ?4, ?5 ' +
      'WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE email = ?1 AND action = ?2 AND document_id = ?3 ' +
      "AND ts > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?6))",
  )
    .bind(c.member.email, action, documentId, ip, userAgent, `-${READ_DEDUPE_MINUTES} minutes`)
    .run();
}

/** Writes one audit row for the signed-in member (`via` as in auditStatement). */
export async function audit(c: RequestContext, action: AuditAction, documentId: string | null, via: RoomVia | null = null): Promise<void> {
  await auditStatement(c, action, documentId, via).run();
}

// Reading the log (owner only; the route checks canPerform 'viewActivity').

export const DEFAULT_PAGE = 50;
export const MAX_PAGE = 200;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface ActivityFilter {
  email: string | null;
  action: ActivityAction | null;
  /** Inclusive UTC start, YYYY-MM-DD. */
  from: string | null;
  /** Inclusive UTC end, YYYY-MM-DD. */
  to: string | null;
  cursor: Cursor | null;
  limit: number;
}

/** Position after the last row of a page: rows sort by (ts, src, id) descending. */
type Source = 'audit' | 'sign_in' | 'proposal' | 'checklist';
type Cursor = [ts: string, src: Source, id: number];

export interface ActivityRow {
  ts: string;
  email: string;
  action: ActivityAction;
  document_id: string | null;
  document_name: string | null;
  /** documents.control_seq of the joined document; null for sign-ins and unnumbered documents. */
  control_seq: number | null;
  ip: string | null;
  user_agent: string | null;
  country: string | null;
  /**
   * audit_log.via: the AI app ("Claude", "Harvey") for legallas-mcp rows; RoomVia for a room row that needs it
   * ('index-csv', the Documents index export); null for the room's other rows and sign-ins.
   */
  via: string | null;
}

export class FilterError extends Error {
  override name = 'FilterError';
}

function validDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function encodeCursor(cursor: Cursor): string {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCursor(value: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/')));
    if (
      Array.isArray(parsed) &&
      parsed.length === 3 &&
      typeof parsed[0] === 'string' &&
      (parsed[1] === 'audit' || parsed[1] === 'sign_in' || parsed[1] === 'proposal' || parsed[1] === 'checklist') &&
      Number.isSafeInteger(parsed[2])
    ) {
      return parsed as Cursor;
    }
  } catch {
    // fall through
  }
  throw new FilterError('cursor');
}

/** Reads and validates the query string. Throws FilterError naming the bad parameter. */
export function parseActivityFilter(params: URLSearchParams): ActivityFilter {
  const text = (name: string) => params.get(name)?.trim() || null;

  const rawEmail = text('email');
  const email = rawEmail === null ? null : normalizeEmail(rawEmail);
  if (rawEmail !== null && email === null) throw new FilterError('email');

  const action = text('action');
  if (action !== null && !(ACTIVITY_ACTIONS as readonly string[]).includes(action)) throw new FilterError('action');

  const from = text('from');
  const to = text('to');
  if (from !== null && !validDay(from)) throw new FilterError('from');
  if (to !== null && !validDay(to)) throw new FilterError('to');

  const rawLimit = text('limit');
  const limit = rawLimit === null ? DEFAULT_PAGE : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) throw new FilterError('limit');

  const before = text('before');
  return {
    email,
    action: action as ActivityAction | null,
    from,
    to,
    cursor: before === null ? null : decodeCursor(before),
    limit,
  };
}

// Sign-ins and audit rows in one feed. Filters are applied in each branch so the indexes on
// (email, ts) and ts can be used, then the merged rows are ordered and cut at limit + 1.
const FILTERS = (ts: string, email: string) =>
  `(?1 IS NULL OR ${email} = ?1) AND (?3 IS NULL OR ${ts} >= ?3) AND (?4 IS NULL OR ${ts} < ?4)`;

// Proposal steps, by the person or AI app that took them; never a title or text (proposal_events holds none).
const PROPOSAL_SQL = `
  UNION ALL
  SELECT 'proposal', e.id, e.ts, e.actor_email, 'proposal_' || e.action, NULL, NULL, NULL AS control_seq, e.ip, e.user_agent, NULL AS country, e.via
    FROM proposal_events e
   WHERE e.action IN ('proposed', 'approved', 'approved_edited', 'rejected') AND (?2 IS NULL OR ?2 = 'proposal_' || e.action)
     AND ${FILTERS('e.ts', 'e.actor_email')}`;

// Checklist changes, by the person who made them: the item's id in via, and the document's name joined as for audit rows.
const CHECKLIST_SQL = `
  UNION ALL
  SELECT 'checklist', e.id, e.ts, e.email, 'checklist_' || e.action, e.document_id, d.name, d.control_seq, NULL, NULL, NULL AS country, e.item_id
    FROM checklist_events e LEFT JOIN documents d ON d.id = e.document_id
   WHERE (?2 IS NULL OR ?2 = 'checklist_' || e.action) AND ${FILTERS('e.ts', 'e.email')}`;

const activitySql = (proposals: boolean, checklist: boolean) => `
SELECT src, id, ts, email, action, document_id, document_name, control_seq, ip, user_agent, country, via FROM (
  SELECT 'audit' AS src, a.id AS id, a.ts AS ts, a.email AS email, a.action AS action,
         a.document_id AS document_id, d.name AS document_name, d.control_seq AS control_seq, a.ip AS ip, a.user_agent AS user_agent,
         NULL AS country, a.via AS via
    FROM audit_log a LEFT JOIN documents d ON d.id = a.document_id
   WHERE (?2 IS NULL OR a.action = ?2) AND ${FILTERS('a.ts', 'a.email')}
  UNION ALL
  SELECT 'sign_in', s.id, s.created_at, s.email, 'sign_in', NULL, NULL, NULL AS control_seq, s.ip, s.user_agent, s.country, NULL AS via
    FROM sign_ins s
   WHERE (?2 IS NULL OR ?2 = 'sign_in') AND ${FILTERS('s.created_at', 's.email')}${proposals ? PROPOSAL_SQL : ''}${checklist ? CHECKLIST_SQL : ''}
)
WHERE ?5 IS NULL OR (ts, src, id) < (?5, ?6, ?7)
ORDER BY ts DESC, src DESC, id DESC
LIMIT ?8`;

/**
 * One page of activity, newest first, and the cursor for the next page (null on the last). `proposals`: the room's
 * PROPOSALS_ENABLED; `checklist`: its CHECKLIST_ENABLED.
 */
export async function readActivity(
  db: D1Database,
  filter: ActivityFilter,
  proposals = false,
  checklist = false,
): Promise<{ rows: ActivityRow[]; next: string | null }> {
  const [cursorTs, cursorSrc, cursorId] = filter.cursor ?? [null, null, null];
  const { results } = await db
    .prepare(activitySql(proposals, checklist))
    .bind(
      filter.email,
      filter.action,
      filter.from === null ? null : `${filter.from}T00:00:00.000Z`,
      filter.to === null ? null : `${nextDay(filter.to)}T00:00:00.000Z`,
      cursorTs,
      cursorSrc,
      cursorId,
      filter.limit + 1,
    )
    .all<ActivityRow & { src: Source; id: number }>();

  const page = results.slice(0, filter.limit);
  const last = page.at(-1);
  const next = results.length > filter.limit && last ? encodeCursor([last.ts, last.src, last.id]) : null;
  return { rows: page.map(({ src: _src, id: _id, ...row }) => row), next };
}
