// SPDX-License-Identifier: Apache-2.0
// The room's retention schedule (web/README.md, "Retention and close-out"). Off by default: a room that sets nothing keeps
// everything, as before. The MCP Worker's daily cron (mcp/index.ts) runs sweepRetention; `npm run close-out` ends a
// matter by hand (scripts/close-out.ts).
//
// | Setting (wrangler.mcp.jsonc vars) | Removes | Runs |
// |---|---|---|
// | RETAIN_SIGNINS_DAYS | sign_ins rows (email, IP, browser, country) older than the setting, at least 30 days | daily |
// | RETAIN_AUDIT_DAYS_AFTER_CLOSE | the audit log, once the matter closed that many days ago; a chained copy is saved first | daily, 10,000 rows a run |
//
// A legal hold that is on blocks every purge, here and in the database (migration 0022). A setting that isn't a whole
// number keeps everything and logs `retention.setting_invalid`.
//
// How the audit log stays append-only (migration 0019) while a closed matter's rows go. The purge is one D1 batch, which
// D1 runs as one transaction: record the purge in audit_purges, drop audit_log_no_delete, delete the rows up to the
// recorded id, create the trigger again from its own text in sqlite_master. If any statement fails the whole batch rolls
// back, trigger included. No other statement runs inside the batch, so a live row is never without the trigger. The
// audit_purges triggers refuse the record, and so the batch, while a hold is on, when it goes backwards, or when its count
// isn't exactly the rows it removes. The copy is in the room's own files bucket before the batch runs.
import { AUDIT_COPY_FIELDS, chainLines, type AuditCopyRow } from './audit-chain-core.ts';
import { NO_HOLD_SQL } from './sync-rules.ts';

export interface RetentionVars {
  /** Days to keep sign-in records. "" or "0": keep them all. Below MIN_SIGNIN_DAYS counts as MIN_SIGNIN_DAYS. */
  RETAIN_SIGNINS_DAYS?: string;
  /** Days to keep the audit log after the matter closes. "" or "0": keep it. */
  RETAIN_AUDIT_DAYS_AFTER_CLOSE?: string;
}

export interface RetentionEnv extends RetentionVars {
  DB: D1Database;
  /** The room's files bucket: the audit log's copy goes there before any row is removed. */
  FILES: Pick<R2Bucket, 'put'>;
}

const DAY_MS = 86_400_000;
/**
 * The owner's routine sign-in check reads the last 30 days of sign-ins (worker/signins.ts OWNER_FAMILIAR_DAYS), so
 * fewer would email the owner about their own browser again. signins.test.ts keeps the two equal.
 */
export const MIN_SIGNIN_DAYS = 30;
export const MAX_RETENTION_DAYS = 3650;
/** Sign-in rows removed per run, oldest first; the rest wait for tomorrow. */
export const SIGNIN_BATCH = 5000;
/** Audit rows copied and removed per run, oldest first; the rest wait for tomorrow. About 4 MB of copy. */
export const AUDIT_PURGE_BATCH = 10_000;
/** Where each copy goes in the files bucket (migration 0022 checks the shape). */
export const AUDIT_COPY_PREFIX = 'retention/audit-log/';
const NO_DELETE_TRIGGER = 'audit_log_no_delete';

export type Days = { on: true; days: number } | { on: false; invalid: boolean };

/** A setting's days: "" or "0" is off; a whole number is raised to `min` and capped; anything else is off and invalid. */
export function parseDays(raw: string | undefined, min: number): Days {
  const value = (raw ?? '').trim();
  if (value === '' || value === '0') return { on: false, invalid: false };
  if (!/^[0-9]{1,6}$/.test(value)) return { on: false, invalid: true };
  return { on: true, days: Math.min(Math.max(Number(value), min), MAX_RETENTION_DAYS) };
}

/** The settings as the sweep reads them. */
export function retentionSettings(vars: RetentionVars): { signIns: Days; auditAfterClose: Days } {
  return {
    signIns: parseDays(vars.RETAIN_SIGNINS_DAYS, MIN_SIGNIN_DAYS),
    auditAfterClose: parseDays(vars.RETAIN_AUDIT_DAYS_AFTER_CLOSE, 1),
  };
}

/** Removes up to SIGNIN_BATCH sign-in rows older than `days`, unless a hold is on. Returns how many went. */
export async function purgeSignIns(db: D1Database, now: Date, days: number): Promise<number> {
  const cutoff = new Date(now.getTime() - days * DAY_MS).toISOString();
  const result = await db
    .prepare(`DELETE FROM sign_ins WHERE id IN (SELECT id FROM sign_ins WHERE created_at < ?1 ORDER BY id LIMIT ?2) AND ${NO_HOLD_SQL}`)
    .bind(cutoff, SIGNIN_BATCH)
    .run();
  return Number(result.meta?.changes ?? 0);
}

/** When the matter closed (`npm run close-out -- --revoke`), or null while it is open. */
export async function matterClosedAt(db: D1Database): Promise<string | null> {
  const row = await db.prepare('SELECT closed_at FROM matter_close WHERE id = 1').first<{ closed_at: string }>();
  return row?.closed_at ?? null;
}

export interface AuditPurge {
  rows: number;
  throughId: number;
  /** The chain of the copy's last line: the next copy, and the room's own export, carry on from it. */
  chain: string;
  copyKey: string;
}

/** The chain the room's audit log starts from: the last purge's, or '' when nothing was purged (or before migration 0022). */
export async function chainStart(db: D1Database): Promise<string> {
  try {
    const row = await db.prepare('SELECT chain FROM audit_purges ORDER BY id DESC LIMIT 1').first<{ chain: string }>();
    return row?.chain ?? '';
  } catch {
    return '';
  }
}

/** True while a legal hold is on (worker/hold.ts activeHold, read here without its email and auth imports). */
async function holdIsOn(db: D1Database): Promise<boolean> {
  return (await db.prepare('SELECT 1 AS on_hold FROM legal_holds WHERE released_at IS NULL LIMIT 1').first()) !== null;
}

const pad = (id: number) => String(id).padStart(12, '0');

/** An error whose name is its code, so the cron's log line names it (mcp/index.ts logs names only). */
const failure = (code: string) => Object.assign(new Error(code), { name: code });

/**
 * Copies the oldest AUDIT_PURGE_BATCH audit rows, chained on from the last purge, to the files bucket, then removes them
 * in one transaction (the header says how). Null when there is nothing to remove. Throws, removing nothing, when the copy
 * isn't saved whole, the trigger is missing, or the database refuses (a hold, a count that changed).
 */
export async function purgeAuditBatch(env: Pick<RetentionEnv, 'DB' | 'FILES'>, now: Date): Promise<AuditPurge | null> {
  const db = env.DB;
  const { results } = await db
    .prepare(`SELECT ${AUDIT_COPY_FIELDS.join(', ')} FROM audit_log ORDER BY id LIMIT ?1`)
    .bind(AUDIT_PURGE_BATCH)
    .all<AuditCopyRow>();
  if (results.length === 0) return null;
  const { lines, last } = await chainLines(results, await chainStart(db));
  const firstId = Number(results[0]!.id); // safe: results is not empty
  const throughId = Number(results.at(-1)!.id); // safe: as above
  const copyKey = `${AUDIT_COPY_PREFIX}${pad(firstId)}-${pad(throughId)}.jsonl`;
  const body = new TextEncoder().encode(lines.map((line) => `${line}\n`).join(''));
  const saved = await env.FILES.put(copyKey, body, {
    httpMetadata: { contentType: 'application/x-ndjson; charset=utf-8' },
    customMetadata: { chain: last, rows: String(results.length), through: String(throughId) },
  });
  if (!saved || saved.size !== body.byteLength) throw failure('retention_copy_not_saved');
  const trigger = await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?1").bind(NO_DELETE_TRIGGER).first<{ sql: string }>();
  if (!trigger?.sql) throw failure('retention_trigger_missing');
  await db.batch([
    db.prepare('INSERT INTO audit_purges (ts, through_id, rows, chain, copy_key) VALUES (?1, ?2, ?3, ?4, ?5)').bind(now.toISOString(), throughId, results.length, last, copyKey),
    db.prepare(`DROP TRIGGER ${NO_DELETE_TRIGGER}`),
    db.prepare('DELETE FROM audit_log WHERE id <= ?1').bind(throughId),
    db.prepare(trigger.sql),
  ]);
  return { rows: results.length, throughId, chain: last, copyKey };
}

export interface RetentionResult {
  /** True when a legal hold stopped every purge. */
  held: boolean;
  /** Sign-in rows removed, or null when that setting is off. */
  signIns: number | null;
  /** This run's audit purge, null when none was due or nothing was left. */
  audit: AuditPurge | null;
}

const log = (event: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({ event, ...fields }));

/**
 * The daily retention step. Reads the hold first and does nothing while one is on; each purge also refuses in SQL.
 * Logs counts and codes only. A failure of the sign-in purge never stops the audit step.
 */
export async function sweepRetention(env: RetentionEnv, now: Date): Promise<RetentionResult> {
  const settings = retentionSettings(env);
  for (const [name, days] of [['RETAIN_SIGNINS_DAYS', settings.signIns], ['RETAIN_AUDIT_DAYS_AFTER_CLOSE', settings.auditAfterClose]] as const) {
    if (!days.on && days.invalid) console.error(JSON.stringify({ event: 'retention.setting_invalid', setting: name }));
  }
  const result: RetentionResult = { held: false, signIns: null, audit: null };
  if (!settings.signIns.on && !settings.auditAfterClose.on) return result;
  if (await holdIsOn(env.DB)) {
    log('retention.held');
    return { ...result, held: true };
  }
  if (settings.signIns.on) {
    try {
      result.signIns = await purgeSignIns(env.DB, now, settings.signIns.days);
    } catch (error) {
      console.error(JSON.stringify({ event: 'retention.signins_failed', code: error instanceof Error ? error.name : 'unknown' }));
    }
  }
  if (settings.auditAfterClose.on) {
    const closed = await matterClosedAt(env.DB);
    if (closed !== null && Date.parse(closed) + settings.auditAfterClose.days * DAY_MS <= now.getTime()) {
      result.audit = await purgeAuditBatch(env, now);
    }
  }
  log('retention.sweep', { signIns: result.signIns, auditRows: result.audit?.rows ?? 0, auditThrough: result.audit?.throughId ?? null });
  return result;
}
