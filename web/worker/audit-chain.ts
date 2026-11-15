// SPDX-License-Identifier: Apache-2.0
// The audit log as a copy that shows any change (litigation room, card #126; research A1; FRE 902(13), (14)).
// GET /api/activity/audit-log.jsonl (owner: viewActivity) gives one JSON line per audit_log row, oldest first, each
// with `chain`: the SHA-256 of the line before's chain and this row. No row can change (migration 0019), so the
// room gives the same chain every time, and its own export row is the copy's last line.
//
// | A copy with | verifyCopy fails at |
// |---|---|
// | A field changed, chain left alone | That row |
// | A row removed | The row after it |
// | A field changed and every chain after it rebuilt | That row, given a fresh copy from the room |
//
// After a retention purge (worker/data-retention.ts) the removed rows are in the files bucket as copies, each chained on
// from the one before, and the room's own copy carries on from the last purge's chain (audit_purges), so every row
// keeps its chain. verifyCopy takes that chain as `start` for a copy that doesn't begin at the log's first row.
import { audit } from './audit.ts';
import { canPerform } from './auth.ts';
import type { RequestContext } from './env.ts';
import { attachment } from './files-http.ts';
import { withSecurityHeaders } from './headers.ts';
import { errorJson, isAllowedDocumentRead } from './http.ts';
import type { Route } from './router.ts';
import { chainLines, FIELDS, type AuditCopyRow } from './audit-chain-core.ts';
import { chainStart } from './data-retention.ts';

export { AUDIT_COPY_FIELDS, chainLines, verifyCopy, type AuditCopyRow, type Verdict } from './audit-chain-core.ts';

export const AUDIT_COPY_PATH = '/api/activity/audit-log.jsonl';

const PAGE = 1000;

async function exportAuditLog(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'viewActivity')) return errorJson('forbidden', 403);
  // The export writes an audit row, so another site's page must not be able to trigger it (like the index export).
  if (!isAllowedDocumentRead(c.request)) return errorJson('forbidden', 403);
  await audit(c, 'download', null, 'audit-log');
  const lines: string[] = [];
  let previous = await chainStart(c.env.DB);
  for (let after = 0; ; ) {
    const { results } = await c.env.DB.prepare(`SELECT ${FIELDS.join(', ')} FROM audit_log WHERE id > ?1 ORDER BY id LIMIT ?2`)
      .bind(after, PAGE)
      .all<AuditCopyRow>();
    const page = await chainLines(results, previous);
    lines.push(...page.lines);
    previous = page.last;
    if (results.length < PAGE) break;
    after = Number(results.at(-1)!.id);
  }
  const headers = new Headers({
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Content-Disposition': attachment(`audit-log-${new Date().toISOString().slice(0, 10)}.jsonl`),
  });
  return withSecurityHeaders(new Response(lines.map((line) => `${line}\n`).join(''), { headers }), 'file');
}

export const routes: Route[] = [{ method: 'GET', path: AUDIT_COPY_PATH, handler: exportAuditLog }];
