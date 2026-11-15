// SPDX-License-Identifier: Apache-2.0
// Turn the install into a litigation room (migration 0018; quality-speed/pages/data-room/research/litigation.md, J1 to J21).
// From the owner's machine only, like npm run room.
//
//   npm run litigation -- status [--local]
//   npm run litigation -- director <email> [--local]                                 (the owner names a director's account)
//   npm run litigation -- decide <email> keep|remove --lawyer <counsel-email> [--local]  (the lawyer's decision, in their name)
//   npm run litigation -- convert [--local]
//
// | Conversion | |
// |---|---|
// | One act | One conversions row: actor, time, counts, the document manifest's SHA-256 |
// | Touches | Investor invitations only: each ends, with a grant_revoked event. No document, number, comment or event changes |
// | Refuses | While a named director has no lawyer's decision, at the start and at the finish |
// | Killed part way | D1 takes no BEGIN in a command, so every statement is idempotent: run convert again and it ends as a clean run |
import { createHash } from 'node:crypto';
import { normalizeEmail } from '../worker/email.ts';
import { sqlLiteral as v } from '../worker/sql.ts';
import { ACTOR, d1 } from './room.ts';

const USAGE = 'usage: litigation status | litigation director <email> | litigation decide <email> keep|remove --lawyer <email> | litigation convert   [--local]';

/** access_events.detail_code on each invitation the conversion ends. */
export const CONVERSION_CODE = 'litigation_conversion';

export type LitigationCommand =
  | { kind: 'status' }
  | { kind: 'director'; email: string }
  | { kind: 'decide'; email: string; decision: 'keep' | 'remove'; lawyer: string }
  | { kind: 'convert' };

function email(value: string | undefined): string {
  const out = normalizeEmail(value);
  if (out && !out.includes(':')) return out;
  throw new Error(USAGE);
}

/** Parses argv (without node and script path). Throws a usage message on bad input. */
export function parseLitigationArgs(argv: string[]): LitigationCommand {
  const args = argv.filter((arg) => arg !== '--local');
  const [verb] = args;
  if ((verb === 'status' || verb === 'convert') && args.length === 1) return { kind: verb };
  if (verb === 'director' && args.length === 2) return { kind: 'director', email: email(args[1]) };
  if (verb === 'decide' && args.length === 5 && (args[2] === 'keep' || args[2] === 'remove') && args[3] === '--lawyer') {
    return { kind: 'decide', email: email(args[1]), decision: args[2], lawyer: email(args[4]) };
  }
  throw new Error(USAGE);
}

/** Every document row, removed ones included, in number order: what the manifest hashes. */
export const MANIFEST_SQL = 'SELECT id, control_seq, sha256, etag, size, source, removed_at FROM documents ORDER BY control_seq, id;';

export interface ManifestRow {
  id: string;
  control_seq: number | null;
  sha256: string | null;
  etag: string | null;
  size: number;
  source: string;
  removed_at: string | null;
}

/** SHA-256 of the manifest: one JSON line per row, in MANIFEST_SQL's order. */
export function manifestHash(rows: readonly ManifestRow[]): string {
  const lines = rows.map((r) => JSON.stringify([r.id, r.control_seq, r.sha256, r.etag, r.size, r.source, r.removed_at]));
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/** One row: open_id (a run that stopped part way), finished_at, unresolved (named directors with no decision, comma-separated). */
export const STATE_SQL =
  'SELECT (SELECT id FROM conversions WHERE finished_at IS NULL) AS open_id, (SELECT max(finished_at) FROM conversions) AS finished_at, ' +
  '(SELECT group_concat(email, \', \') FROM (SELECT email FROM directors WHERE decision IS NULL ORDER BY email)) AS unresolved;';

export interface ConversionState {
  openId: string | null;
  finishedAt: string | null;
  unresolved: string | null;
}

const UNRESOLVED = 'EXISTS (SELECT 1 FROM directors WHERE decision IS NULL)';
/** A live investor invitation the conversion ends: every one, except a director's the lawyer decided to keep. */
const INVESTOR_LIVE =
  "role = 'investor' AND revoked_at IS NULL AND room_id IN (SELECT id FROM rooms WHERE kind = 'deal') " +
  "AND email NOT IN (SELECT email FROM directors WHERE decision = 'keep')";
const EVENTS = '(SELECT count(*) FROM access_events) + (SELECT count(*) FROM audit_log)';

/**
 * The conversion's statements, in order, each idempotent. `id` is the open run's, or a new one. A statement whose guard
 * fails does nothing, so a refused run changes nothing and the finish never marks a run that left an investor in.
 */
export function conversionStatements(id: string, manifestSha256: string, now: Date): string[] {
  const at = v(now.toISOString());
  const open = `EXISTS (SELECT 1 FROM conversions WHERE id = ${v(id)} AND finished_at IS NULL)`;
  const started = `(SELECT started_at FROM conversions WHERE id = ${v(id)})`;
  const endedNoEvent =
    `role = 'investor' AND room_id IN (SELECT id FROM rooms WHERE kind = 'deal') AND revoked_by = ${v(ACTOR)} AND revoked_at >= ${started} ` +
    "AND NOT EXISTS (SELECT 1 FROM access_events e WHERE e.grant_id = room_members.id AND e.action = 'grant_revoked')";
  return [
    'INSERT INTO conversions (id, actor, started_at, manifest_sha256, documents, comments, invitations, events_before) ' +
      `SELECT ${v(id)}, ${v(ACTOR)}, ${at}, ${v(manifestSha256)}, (SELECT count(*) FROM documents), (SELECT count(*) FROM comments), ` +
      `(SELECT count(*) FROM room_members), ${EVENTS} WHERE NOT EXISTS (SELECT 1 FROM conversions) AND NOT ${UNRESOLVED};`,
    `UPDATE room_members SET revoked_at = ${at}, revoked_by = ${v(ACTOR)} WHERE ${INVESTOR_LIVE} AND ${open} AND NOT ${UNRESOLVED};`,
    'INSERT INTO access_events (actor, action, room_id, grant_id, subject_email, detail_code) ' +
      `SELECT ${v(ACTOR)}, 'grant_revoked', room_id, id, email, '${CONVERSION_CODE}' FROM room_members WHERE ${endedNoEvent} AND ${open};`,
    `UPDATE conversions SET finished_at = ${at}, events_after = ${EVENTS}, ` +
      `investors_out = (SELECT count(*) FROM access_events WHERE action = 'grant_revoked' AND detail_code = '${CONVERSION_CODE}') ` +
      `WHERE id = ${v(id)} AND finished_at IS NULL AND NOT ${UNRESOLVED} AND NOT EXISTS (SELECT 1 FROM room_members WHERE ${INVESTOR_LIVE}) ` +
      `AND NOT EXISTS (SELECT 1 FROM room_members WHERE ${endedNoEvent});`,
  ];
}

/** The SQL convert runs, or the reason it won't: already converted, or a director with no decision. */
export function conversionSql(state: ConversionState, manifest: readonly ManifestRow[], now: Date, newId: string): string {
  if (state.finishedAt) throw new Error(`This install was converted to a litigation room on ${state.finishedAt}. Nothing to do.`);
  if (state.unresolved) {
    throw new Error(`Conversion can't start or finish until a lawyer records a decision for each director's account: ${state.unresolved}.\n` +
      'npm run litigation -- decide <email> keep|remove --lawyer <counsel-email>');
  }
  return conversionStatements(state.openId ?? newId, manifestHash(manifest), now).join('\n');
}

/** The SQL for status, director and decide. */
export function litigationSql(command: Exclude<LitigationCommand, { kind: 'convert' }>, now: Date): string {
  switch (command.kind) {
    case 'status':
      return (
        "SELECT 'conversion' AS what, id AS who, started_at AS since, finished_at AS done, investors_out AS detail FROM conversions " +
        "UNION ALL SELECT 'director', email, named_at, decided_at, COALESCE(decision || ' by ' || decided_by, 'no decision yet') FROM directors ORDER BY 1, 2;"
      );
    case 'director':
      return `INSERT INTO directors (email, named_by) VALUES (${v(command.email)}, ${v(ACTOR)}) ON CONFLICT (email) DO NOTHING;`;
    case 'decide':
      return (
        `UPDATE directors SET decision = ${v(command.decision)}, decided_by = ${v(command.lawyer)}, decided_at = ${v(now.toISOString())} ` +
        `WHERE email = ${v(command.email)} AND decision IS NULL;`
      );
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  try {
    const command = parseLitigationArgs(args);
    const where = args.includes('--local') ? '--local' : '--remote';
    const now = new Date();
    if (command.kind === 'convert') {
      const row = d1(STATE_SQL, where, true)[0] ?? {};
      const state: ConversionState = {
        openId: typeof row.open_id === 'string' ? row.open_id : null,
        finishedAt: typeof row.finished_at === 'string' ? row.finished_at : null,
        unresolved: typeof row.unresolved === 'string' ? row.unresolved : null,
      };
      d1(conversionSql(state, d1(MANIFEST_SQL, where, true) as unknown as ManifestRow[], now, crypto.randomUUID()), where);
      const done = d1(STATE_SQL, where, true)[0] ?? {};
      if (typeof done.finished_at !== 'string') throw new Error('The conversion did not finish. Run npm run litigation -- convert again.');
      process.stdout.write(
        `\nConverted. Every investor invitation has ended, except a director's a lawyer decided to keep.\n` +
          'Remove the investors from the room\'s Access policy and revoke their sessions by hand, as for npm run room -- revoke.\n',
      );
    } else {
      d1(litigationSql(command, now), where);
      if (command.kind === 'decide') {
        const row = d1(`SELECT decision, decided_by FROM directors WHERE email = ${v(command.email)};`, where, true)[0];
        if (row?.decided_by !== command.lawyer || row?.decision !== command.decision) {
          throw new Error(`Not recorded: ${command.email} isn't named as a director (npm run litigation -- director <email>), or a decision is already recorded.`);
        }
      }
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
