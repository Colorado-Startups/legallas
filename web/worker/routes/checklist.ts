// SPDX-License-Identifier: Apache-2.0
// The company checklist in the room (worker/checklist.ts). Served only while the room's CHECKLIST_ENABLED is "1" (room.ts
// roomRoutes). room.ts has already verified Access, loaded the member row and refused a write without the room's exact
// Origin and Sec-Fetch-Site. `flag`, the action for marking documents, covers matching them too. No MCP tool reaches these.
//
//   GET    /api/checklist                     the whole list for this company, and its facts (`company`)
//   GET    /api/checklist/summary             counts, stages and the next dates, for the Overview's card
//   GET    /api/checklist/questions           "questions for your lawyer", a Markdown attachment
//   POST   /api/checklist/matches             { itemId, documentId, signed?, date?, nextDate?, parties?, amount? }
//   DELETE /api/checklist/matches/:id         removes a match, never the document
//   PUT    /api/checklist/items/:id/applies   { applies: boolean }
//   PUT    /api/checklist/company             { entityType?, formationDate?, reportMonth? }, the room owner only (setCompany)
import { canPerform } from '../auth.ts';
import { buildChecklist, checklistSummary, itemExists, parseMatchInput, type ChecklistView } from '../checklist.ts';
import { questionsFileName, questionsPack } from '../checklist-questions.ts';
import { readMatches, readNotApplicable, removeMatch, saveMatch, setApplies } from '../checklist-store.ts';
import { readLimited } from '../comments.ts';
import { entityTypeOptions, parseCompanyInput, readCompany, saveCompany, type CompanyRecord, type ServedChecklist } from '../company-settings.ts';
import type { RequestContext, Role } from '../env.ts';
import { exportPrefix } from '../export.ts';
import { errorJson, isAllowedDocumentRead, json } from '../http.ts';
import type { Route } from '../router.ts';

const MAX_BODY_BYTES = 4096;

/** The zone "today" falls back to when the room sets none, or one Intl doesn't know. */
export const FALLBACK_TIME_ZONE = 'UTC';

/** The calendar day at `now` in the room's TIME_ZONE, as YYYY-MM-DD, so a date doesn't read as passed hours early. */
export function roomToday(timeZone: string | undefined, now = new Date()): string {
  const day = (zone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  try {
    return day(timeZone || FALLBACK_TIME_ZONE);
  } catch {
    return day(FALLBACK_TIME_ZONE);
  }
}

/** The list as `role` sees it, worked out from the company's facts in force (company-settings.ts), and those facts. */
export async function readChecklist(db: D1Database, role: Role, timeZone: string | undefined): Promise<{ view: ChecklistView; company: CompanyRecord }> {
  const [matches, notApplicable, company] = await Promise.all([readMatches(db, role), readNotApplicable(db), readCompany(db)]);
  return { view: buildChecklist(company, matches, notApplicable, roomToday(timeZone)), company };
}

const loadChecklist = (c: RequestContext) => readChecklist(c.env.DB, c.member.role, c.env.TIME_ZONE);

function served(c: RequestContext, view: ChecklistView, company: CompanyRecord): ServedChecklist {
  return { ...view, company: { ...company, editable: canPerform(c.member.role, 'setCompany'), entityTypes: entityTypeOptions() } };
}

/** The JSON object of a write, or an error response. */
async function readObject(c: RequestContext): Promise<Record<string, unknown> | Response> {
  if (!/^application\/json\s*(;|$)/i.test(c.request.headers.get('Content-Type') ?? '')) return errorJson('unsupported_media_type', 415);
  const text = await readLimited(c.request, MAX_BODY_BYTES);
  if (text === null) return errorJson('payload_too_large', 413);
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : errorJson('invalid_request', 400);
  } catch {
    return errorJson('invalid_json', 400);
  }
}

async function getQuestions(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'view')) return errorJson('forbidden', 403);
  // It holds what's in the room, so only the room's own pages may ask for it.
  if (!isAllowedDocumentRead(c.request)) return errorJson('forbidden', 403);
  const { view } = await loadChecklist(c);
  return new Response(questionsPack(view, exportPrefix(c.env, c.url)), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${questionsFileName(view.today)}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function postMatch(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'flag')) return errorJson('forbidden', 403);
  const body = await readObject(c);
  if (body instanceof Response) return body;
  const input = parseMatchInput(body, roomToday(c.env.TIME_ZONE));
  if (!input.ok) return json({ error: 'invalid_request', field: input.field }, 400);
  return (await saveMatch(c.env.DB, c.member, input.value, new Date())) ? json({ saved: true }) : errorJson('not_found', 404);
}

async function deleteMatch(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'flag')) return errorJson('forbidden', 403);
  return (await removeMatch(c.env.DB, c.member.role, c.params.id ?? '', c.member.email, new Date())) ? json({ removed: true }) : errorJson('not_found', 404);
}

async function putApplies(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'flag')) return errorJson('forbidden', 403);
  const itemId = c.params.id ?? '';
  if (!itemExists(itemId)) return errorJson('not_found', 404);
  const body = await readObject(c);
  if (body instanceof Response) return body;
  if (typeof body.applies !== 'boolean') return json({ error: 'invalid_request', field: 'applies' }, 400);
  await setApplies(c.env.DB, c.member, itemId, body.applies, new Date());
  return json({ applies: body.applies });
}

/** The owner changes the company's facts; the list's items and dates follow on the next read. Answers with the list worked out again. */
async function putCompany(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'setCompany')) return errorJson('forbidden', 403);
  const body = await readObject(c);
  if (body instanceof Response) return body;
  const input = parseCompanyInput(body, roomToday(c.env.TIME_ZONE));
  if (!input.ok) return json({ error: 'invalid_request', field: input.field }, 400);
  await saveCompany(c.env.DB, c.member, input.value, new Date());
  const { view, company } = await loadChecklist(c);
  return json(served(c, view, company));
}

async function getChecklist(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'view')) return errorJson('forbidden', 403);
  const { view, company } = await loadChecklist(c);
  return json(served(c, view, company));
}

export const routes: Route[] = [
  { method: 'GET', path: '/api/checklist', handler: getChecklist },
  {
    method: 'GET',
    path: '/api/checklist/summary',
    handler: async (c) => (canPerform(c.member.role, 'view') ? json(checklistSummary((await loadChecklist(c)).view)) : errorJson('forbidden', 403)),
  },
  { method: 'GET', path: '/api/checklist/questions', handler: getQuestions },
  { method: 'POST', path: '/api/checklist/matches', handler: postMatch },
  { method: 'DELETE', path: '/api/checklist/matches/:id', handler: deleteMatch },
  { method: 'PUT', path: '/api/checklist/items/:id/applies', handler: putApplies },
  { method: 'PUT', path: '/api/checklist/company', handler: putCompany },
];
