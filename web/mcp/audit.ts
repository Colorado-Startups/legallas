// SPDX-License-Identifier: Apache-2.0
// audit_log rows for AI tool use and connections (owner: session C1). Never stores query text or page text.
// Same row shape as the room's worker/audit.ts plus migration 0004's nullable `via` column, which carries the
// client name ("Claude", "Harvey"). ai_read is deduped like the room's auditOnce; a byte pull through
// legallas_get_file or legallas_view_visual is the room's own `download` action (already in the CHECK), never deduped.
import { READ_DEDUPE_MINUTES, clientInfo } from '../worker/audit.ts';
import type { AiAuditAction, McpEnv } from './contract.ts';

export interface AiAuditEntry {
  email: string;
  action: AiAuditAction | 'download';
  documentId: string | null;
  /** The client app's name, for the activity feed's "via". */
  via: string;
  /** For ip and user agent, like the room's clientInfo(). Absent outside a request. */
  request?: Request;
}

/** audit_log.via's CHECK bound (migration 0004), counted in characters as SQLite's length() does. */
export const MAX_VIA_CHARS = 80;

/**
 * The client name as stored in `via`: control characters dropped, whitespace collapsed, at most MAX_VIA_CHARS
 * code points (never a split surrogate pair). Null when nothing is left, which the CHECK also allows.
 */
export function auditVia(name: string): string | null {
  const clean = name.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  const via = Array.from(clean).slice(0, MAX_VIA_CHARS).join('').trimEnd();
  return via === '' ? null : via;
}

const INSERT = 'INSERT INTO audit_log (email, action, document_id, ip, user_agent, via) ';

// A read repeated by the same member, through the same app, on the same document within READ_DEDUPE_MINUTES is
// one row: an AI tool often reads a document page range by page range while answering one question.
const INSERT_ONCE =
  INSERT +
  'SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE email = ?1 AND action = ?2 ' +
  "AND document_id IS ?3 AND via IS ?6 AND ts > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?7))";

/** Thrown when an audit row cannot be written. Its message is the log code only, never the D1 error's text. */
export class AuditError extends Error {
  override name = 'AuditError';
  constructor() {
    super('mcp_audit_failed');
  }
}

/**
 * Writes one row; ai_read is deduped per member, document and client within READ_DEDUPE_MINUTES.
 * Fails closed (a design rule): counsel are told every search and document read is logged, as in the
 * room, so a failed write logs `mcp_audit_failed` (codes only) and throws AuditError. Tools audit before they
 * return any text, and runTool turns the throw into an internal_error result, so nothing goes out unlogged.
 */
export async function aiAudit(env: Pick<McpEnv, 'DB'>, entry: AiAuditEntry): Promise<void> {
  try {
    const { ip, userAgent } = entry.request ? clientInfo(entry.request) : { ip: null, userAgent: null };
    const values = [entry.email, entry.action, entry.documentId, ip, userAgent, auditVia(entry.via)];
    const statement =
      entry.action === 'ai_read'
        ? env.DB.prepare(INSERT_ONCE).bind(...values, `-${READ_DEDUPE_MINUTES} minutes`)
        : env.DB.prepare(`${INSERT}VALUES (?1, ?2, ?3, ?4, ?5, ?6)`).bind(...values);
    await statement.run();
  } catch (error) {
    console.error('mcp_audit_failed', entry.action, error instanceof Error ? error.name : 'unknown');
    // A fresh error, not the original: D1 messages can quote the SQL values, and callers may log what they catch.
    throw new AuditError();
  }
}

/**
 * This member's byte pulls through AI tools on the UTC day `day` (YYYY-MM-DD): `download` rows with a client name in
 * `via`. The room's own downloads carry no via and are not counted. For DAILY_DOWNLOAD_CAP.
 */
export async function downloadsToday(db: D1Database, email: string, day: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE email = ?1 AND action = 'download' AND via IS NOT NULL AND ts >= ?2 AND ts < ?3")
    .bind(email, `${day}T00:00:00.000Z`, `${nextDay(day)}T00:00:00.000Z`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** `via` for a byte pull whose client name cleans to nothing, so the row still counts toward DAILY_DOWNLOAD_CAP. */
const UNNAMED_VIA = 'AI app';

/**
 * Writes one `download` row for a byte pull only while the member has fewer than `cap` on the UTC day `day`, counted
 * exactly as downloadsToday counts them. One statement checks and writes, so parallel pulls cannot pass the cap
 * together (D1 runs a database's statements one at a time). True when the row was written. Fails closed like
 * aiAudit: a failed write logs `mcp_audit_failed` and throws AuditError, so no bytes go out unlogged.
 */
export async function reserveDownload(db: D1Database, entry: Omit<AiAuditEntry, 'action'>, cap: number, day: string): Promise<boolean> {
  try {
    const { ip, userAgent } = entry.request ? clientInfo(entry.request) : { ip: null, userAgent: null };
    const result = await db
      .prepare(
        `${INSERT}SELECT ?1, 'download', ?2, ?3, ?4, ?5 WHERE (SELECT COUNT(*) FROM audit_log WHERE email = ?1 ` +
          "AND action = 'download' AND via IS NOT NULL AND ts >= ?6 AND ts < ?7) < ?8",
      )
      .bind(entry.email, entry.documentId, ip, userAgent, auditVia(entry.via) ?? UNNAMED_VIA, `${day}T00:00:00.000Z`, `${nextDay(day)}T00:00:00.000Z`, cap)
      .run();
    return result.meta.changes === 1;
  } catch (error) {
    console.error('mcp_audit_failed', 'download', error instanceof Error ? error.name : 'unknown');
    throw new AuditError();
  }
}

function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
