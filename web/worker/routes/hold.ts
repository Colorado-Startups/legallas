// SPDX-License-Identifier: Apache-2.0
// The hold screen's API (worker/hold.ts, src/pages/hold/). Any member reads it; every step is a change to the record, so
// it needs `flag`, as Key and the checklist do. room.ts already checked the member and the write origin.
//
//   GET  /api/hold                    { hold | null, custodians, notice, cannot_reach }
//   POST /api/hold                    { case_number? }: starts a hold, 201; 409 when one is on
//   POST /api/hold/custodians         { email, name? }: adds a custodian, 201
//   POST /api/hold/notice             records the notice sent to every custodian who hasn't had it
//   POST /api/hold/acknowledgments    { email }: records that custodian's acknowledgment
//   POST /api/hold/reminders          records a reminder to every custodian notified and not acknowledged
//   POST /api/hold/release            { reason }: releases the hold
// With no hold on, every step but starting one answers 409 no_hold.
import { canPerform } from '../auth.ts';
import { readLimited } from '../comments.ts';
import type { RequestContext } from '../env.ts';
import {
  activeHold,
  addCustodian,
  custodians,
  HOLD_CANNOT_REACH,
  holdNotice,
  MAX_RELEASE_REASON,
  parseCaseNumber,
  recordAcknowledgment,
  recordNotice,
  recordReminders,
  releaseHold,
  startHold,
  type Hold,
} from '../hold.ts';
import { errorJson, json } from '../http.ts';
import type { Route } from '../router.ts';

const MAX_BODY_BYTES = 4096;

async function view(db: D1Database, hold: Hold | null, contact: string) {
  return {
    hold: hold && { started_at: hold.started_at, started_by: hold.started_by, case_number: hold.case_number },
    custodians: hold ? await custodians(db, hold.id) : [],
    notice: holdNotice(contact),
    cannot_reach: HOLD_CANNOT_REACH,
  };
}

/** The JSON object body, {} when empty, or null for anything else. */
async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const raw = await readLimited(request, MAX_BODY_BYTES);
  if (raw === null) return null;
  try {
    const value: unknown = raw === '' ? {} : JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** An optional short text: absent or empty is null; else 1 to `max` characters with no control character, trimmed. */
function text(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= max && !/[\u0000-\u001f\u007f]/.test(trimmed) ? trimmed : undefined;
}

async function getHold({ env, member }: RequestContext): Promise<Response> {
  if (!canPerform(member.role, 'view')) return errorJson('forbidden', 403);
  return json(await view(env.DB, await activeHold(env.DB), member.email));
}

async function postHold({ env, member, request }: RequestContext): Promise<Response> {
  if (!canPerform(member.role, 'flag')) return errorJson('forbidden', 403);
  const body = await readBody(request);
  const caseNumber = body && parseCaseNumber(body.case_number);
  if (caseNumber === undefined || body === null) return errorJson('bad_request', 400);
  const hold = await startHold(env.DB, member.email, new Date(), caseNumber);
  return hold ? json(await view(env.DB, hold, member.email), 201) : errorJson('hold_on', 409);
}

/** A step on the hold that is on: `flag`, a body, a hold, then `run`. */
function step(run: (c: RequestContext, hold: Hold, body: Record<string, unknown>, now: Date) => Promise<Response | null>) {
  return async (c: RequestContext): Promise<Response> => {
    if (!canPerform(c.member.role, 'flag')) return errorJson('forbidden', 403);
    const body = await readBody(c.request);
    if (body === null) return errorJson('bad_request', 400);
    const hold = await activeHold(c.env.DB);
    if (!hold) return errorJson('no_hold', 409);
    const refused = await run(c, hold, body, new Date());
    return refused ?? json(await view(c.env.DB, await activeHold(c.env.DB), c.member.email));
  };
}

const addOne = step(async ({ env, member }, hold, body, now) => {
  const name = text(body.name, 120);
  if (name === undefined) return errorJson('bad_request', 400);
  return (await addCustodian(env.DB, hold.id, member.email, body.email, name, now)) ? null : errorJson('not_added', 409);
});

const notice = step(async ({ env, member }, hold, _body, now) => {
  await recordNotice(env.DB, hold.id, member.email, now);
  return null;
});

const acknowledge = step(async ({ env, member }, hold, body, now) =>
  (await recordAcknowledgment(env.DB, hold.id, member.email, body.email, now)) ? null : errorJson('not_recorded', 409),
);

const remind = step(async ({ env, member }, hold, _body, now) => {
  await recordReminders(env.DB, hold.id, member.email, now);
  return null;
});

const release = step(async ({ env, member }, _hold, body, now) => {
  const reason = text(body.reason, MAX_RELEASE_REASON);
  if (!reason) return errorJson('reason_needed', 400);
  return (await releaseHold(env.DB, member.email, reason, now)) ? null : errorJson('no_hold', 409);
});

export const routes: Route[] = [
  { method: 'GET', path: '/api/hold', handler: getHold },
  { method: 'POST', path: '/api/hold', handler: postHold },
  { method: 'POST', path: '/api/hold/custodians', handler: addOne },
  { method: 'POST', path: '/api/hold/notice', handler: notice },
  { method: 'POST', path: '/api/hold/acknowledgments', handler: acknowledge },
  { method: 'POST', path: '/api/hold/reminders', handler: remind },
  { method: 'POST', path: '/api/hold/release', handler: release },
];
