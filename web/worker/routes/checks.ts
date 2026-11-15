// SPDX-License-Identifier: Apache-2.0
// The member's approval of a public-records check (worker/public-records.ts): an AI asks to check a name, and nothing
// leaves the room until the member who asked approves it here, on /checks/?id=<id>. index.ts already authenticated the
// caller, loaded their member row and checked the write origin; a request is only ever its own member's, and anyone
// else's id reads as not found.
//
//   GET  /api/checks/:id   the request: the name, person or company, which sites it would go to, which are searched by
//                          hand, its state and when it lapses, and the notices (approve)
//   POST /api/checks/:id   { decision: "approve" | "decline" } on a pending request (approve)
//
// Nothing here is audited or logged with the name. Each call first deletes every lapsed request (sweepLapsedChecks), so
// lapsed names leave the room as soon as anyone uses this page; the MCP Worker's daily cron catches the rest.
import { canPerform } from '../auth.ts';
import { readLimited } from '../comments.ts';
import type { RequestContext } from '../env.ts';
import { errorJson, json } from '../http.ts';
import { APPROVED_MINUTES, decideCheck, NOT_A_CONSUMER_REPORT, NOT_A_LAWYER, publicRecordsEnabled, readCheck, RECORDS_NOT_CONCLUSIONS, sweepLapsedChecks, type CheckRequest } from '../public-records.ts';
import { SOURCES } from '../public-records-sources.ts';
import type { Route } from '../router.ts';

export const CHECK_PATH = '/api/checks/:id';
const MAX_BODY_BYTES = 200;

/** The request as the page shows it: what the member is approving, and nothing about anyone else. */
export function checkView(check: CheckRequest) {
  const sendsTo = SOURCES.filter((source) => check.sources.includes(source.id)).map((source) => ({ source: source.name, operator: source.operator, host: source.host ?? '' }));
  const byHand = SOURCES.filter((source) => source.kinds.includes(check.kind) && !check.sources.includes(source.id)).map((source) => ({ source: source.name, link: source.link }));
  return {
    id: check.id,
    name: check.name,
    kind: check.kind,
    state: check.state,
    via: check.via,
    createdAt: check.createdAt,
    decidedAt: check.decidedAt,
    expiresAt: check.expiresAt,
    approvedMinutes: APPROVED_MINUTES,
    sendsTo,
    byHand,
    notices: { consumerReport: NOT_A_CONSUMER_REPORT, records: RECORDS_NOT_CONCLUSIONS, lawyer: NOT_A_LAWYER },
  };
}

async function getCheck({ env, member, params }: RequestContext): Promise<Response> {
  if (!canPerform(member.role, 'approve')) return errorJson('forbidden', 403);
  if (!publicRecordsEnabled(env)) return errorJson('records_off', 404);
  const now = new Date();
  await sweepLapsedChecks(env.DB, now);
  const check = await readCheck(env.DB, params.id ?? '', member.email, now);
  return check ? json(checkView(check)) : errorJson('not_found', 404);
}

async function postCheck({ env, member, params, request }: RequestContext): Promise<Response> {
  if (!canPerform(member.role, 'approve')) return errorJson('forbidden', 403);
  if (!publicRecordsEnabled(env)) return errorJson('records_off', 404);
  const raw = await readLimited(request, MAX_BODY_BYTES);
  if (raw === null) return errorJson('too_large', 413);
  let decision: unknown;
  try {
    decision = (JSON.parse(raw) as { decision?: unknown } | null)?.decision;
  } catch {
    return errorJson('bad_request', 400);
  }
  if (decision !== 'approve' && decision !== 'decline') return errorJson('bad_request', 400);
  const now = new Date();
  await sweepLapsedChecks(env.DB, now);
  const decided = await decideCheck(env.DB, params.id ?? '', member.email, decision, now);
  if (decided) return json(checkView(decided));
  // Not pending: lapsed, someone else's, or already decided. Say which only for the member's own live request.
  const current = await readCheck(env.DB, params.id ?? '', member.email, now);
  return current ? errorJson('already_decided', 409) : errorJson('not_found', 404);
}

export const routes: Route[] = [
  { method: 'GET', path: CHECK_PATH, handler: getCheck },
  { method: 'POST', path: CHECK_PATH, handler: postCheck },
];
