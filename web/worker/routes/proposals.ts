// SPDX-License-Identifier: Apache-2.0
// Proposals in the room (docs/design/propose-and-approve.md). Served only while the room's PROPOSALS_ENABLED is "1"
// (room.ts roomRoutes): with it off these paths answer like any unknown path. room.ts has already verified Access,
// loaded the member row and refused a write without the room's exact Origin and Sec-Fetch-Site; approving is therefore
// only ever a same-origin write in a person's own signed-in session, never something an AI tool can do.
//
//   GET  /api/proposals                ?view=pending (default) | decided | all: what the member may see, no text
//                                      (their own AI's proposals; every member's for the owner)
//   GET  /api/proposals/:id            one proposal: what, why, the text, its sources, what approving changes, history,
//                                      and can.approve: whether this member decides it (proposal-review.ts decides:
//                                      their own AI's, or for the owner the OWNER_DECIDES kinds)
//   POST /api/proposals/:id/approve    { title?, body? } approve, with the person's edits if any (approve, one they decide)
//   POST /api/proposals/:id/reject     { reason } one of REJECT_REASONS (approve, one they decide)
//   GET  /api/proposals/:id/draft      an approved draft as a Markdown attachment (recorded as `downloaded`)
//   GET  /api/proposals/:id/visual     a visual (proposal-visual.ts), only as a frame of the room's pages, under the
//                                      `visual` CSP: its binder page once approved (any member the binder shows it to),
//                                      else its preview (those who see the proposal)
//
// Responses carry proposal text as JSON strings; the page shows them with textContent only (src/scripts/proposals.ts).
import { clientInfo } from '../audit.ts';
import { canPerform } from '../auth.ts';
import { landCounselDraft } from '../counsel-drafts.ts';
import { readLimited } from '../comments.ts';
import type { RequestContext } from '../env.ts';
import { withSecurityHeaders } from '../headers.ts';
import { errorJson, isAllowedDocumentRead, json } from '../http.ts';
import {
  approvedDraft,
  approveProposal,
  canUseProposals,
  decides,
  getProposal,
  listProposals,
  rejectProposal,
  type DecideResult,
  type ProposalView,
} from '../proposal-review.ts';
import { prepareProposedVisual, savedPage, visualRoom } from '../proposal-visual.ts';
import { cleanText, cleanTitle, PROPOSAL_LIMITS, REJECT_REASONS, type RejectReason } from '../proposals.ts';
import type { Route } from '../router.ts';

/** The largest decision body: an edited draft at its limit, in UTF-8, with room for JSON escapes. */
export const MAX_DECISION_BYTES = 4 * PROPOSAL_LIMITS.body + 8192;

const VIEWS: readonly ProposalView[] = ['pending', 'decided', 'all'];
const ID = /^[A-Za-z0-9-]{1,64}$/;

/** The JSON object of a write, or an error response: a JSON content type, a bounded size and an object. */
async function readObject(c: RequestContext): Promise<{ value: Record<string, unknown> } | Response> {
  const type = c.request.headers.get('Content-Type') ?? '';
  if (!/^application\/json\s*(;|$)/i.test(type)) return errorJson('unsupported_media_type', 415);
  const text = await readLimited(c.request, MAX_DECISION_BYTES);
  if (text === null) return errorJson('payload_too_large', 413);
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return errorJson('invalid_request', 400);
    return { value: value as Record<string, unknown> };
  } catch {
    return errorJson('invalid_json', 400);
  }
}

/** An own field of a parsed body, never a prototype's. */
function field(value: Record<string, unknown>, name: string): unknown {
  return Object.hasOwn(value, name) ? value[name] : undefined;
}

const STATUS_OF: Record<Exclude<DecideResult, { ok: true }>['error'], number> = {
  forbidden: 403,
  not_found: 404,
  not_yours: 403,
  not_pending: 409,
  expired: 409,
  sources_changed: 409,
  not_served: 409,
};

function decided(result: DecideResult): Response {
  return result.ok ? json({ status: result.status, edited: result.edited }) : errorJson(result.error, STATUS_OF[result.error]);
}

async function list(c: RequestContext): Promise<Response> {
  if (!canUseProposals(c.member.role)) return errorJson('forbidden', 403);
  const view = (c.url.searchParams.get('view') ?? 'pending') as ProposalView;
  if (!VIEWS.includes(view)) return json({ error: 'invalid_filter', field: 'view' }, 400);
  return json({
    proposals: await listProposals(c.env.DB, c.member, view, new Date()),
    can: { approve: canPerform(c.member.role, 'approve') },
  });
}

async function one(c: RequestContext): Promise<Response> {
  if (!canUseProposals(c.member.role)) return errorJson('forbidden', 403);
  const id = c.params.id!;
  const proposal = ID.test(id) ? await getProposal(c.env.DB, c.member, id, new Date()) : null;
  if (!proposal) return errorJson('not_found', 404);
  return json({ proposal, can: { approve: decides(c.member, proposal) } });
}

async function approve(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'approve')) return errorJson('forbidden', 403);
  const input = await readObject(c);
  if (input instanceof Response) return input;
  const rawTitle = field(input.value, 'title');
  const rawBody = field(input.value, 'body');
  const title = rawTitle === undefined ? null : cleanTitle(rawTitle);
  const body = rawBody === undefined ? null : cleanText(rawBody, PROPOSAL_LIMITS.body);
  if (rawTitle !== undefined && title === null) return json({ error: 'invalid_request', field: 'title' }, 400);
  if (rawBody !== undefined && body === null) return json({ error: 'invalid_request', field: 'body' }, 400);
  const id = c.params.id!;
  if (!ID.test(id)) return errorJson('not_found', 404);
  const now = new Date();
  const result = await approveProposal(c.env.DB, c.member, id, { title, body }, now, clientInfo(c.request), visualRoom(c.env, c.url));
  if (result.ok) await landCounselDraft(c.env, c.member, id, now);
  return decided(result);
}

async function reject(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'approve')) return errorJson('forbidden', 403);
  const input = await readObject(c);
  if (input instanceof Response) return input;
  const reason = field(input.value, 'reason');
  if (typeof reason !== 'string' || !(REJECT_REASONS as readonly string[]).includes(reason)) {
    return json({ error: 'invalid_request', field: 'reason' }, 400);
  }
  const id = c.params.id!;
  if (!ID.test(id)) return errorJson('not_found', 404);
  return decided(await rejectProposal(c.env.DB, c.member, id, reason as RejectReason, new Date(), clientInfo(c.request)));
}

async function draft(c: RequestContext): Promise<Response> {
  if (!canUseProposals(c.member.role)) return errorJson('forbidden', 403);
  // A download writes an event row, so another site's page must not be able to trigger it (as /files, http.ts).
  if (!isAllowedDocumentRead(c.request)) return errorJson('forbidden', 403);
  const id = c.params.id!;
  const file = ID.test(id) ? await approvedDraft(c.env.DB, c.member, id, new Date(), clientInfo(c.request)) : null;
  if (!file) return errorJson('not_found', 404);
  return new Response(file.text, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function visual(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'view')) return errorJson('forbidden', 403);
  // Only a frame of the room's own pages: opened any other way, a page could navigate itself (as /files, files-http.ts).
  const dest = (c.request.headers.get('Sec-Fetch-Dest') ?? '').toLowerCase();
  const id = c.params.id!;
  if (dest !== 'iframe' || !isAllowedDocumentRead(c.request) || !ID.test(id)) return errorJson('not_found', 404);
  let page = await savedPage(c.env.DB, c.member.role, id);
  if (page === null && canUseProposals(c.member.role)) {
    const proposal = await getProposal(c.env.DB, c.member, id, new Date());
    if (proposal?.visual) page = await prepareProposedVisual(c.env.DB, c.member.role, proposal.final_body ?? proposal.body, id, visualRoom(c.env, c.url));
  }
  if (page === null) return errorJson('not_found', 404);
  return withSecurityHeaders(new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }), 'visual');
}

export const routes: Route[] = [
  { method: 'GET', path: '/api/proposals', handler: list },
  { method: 'GET', path: '/api/proposals/:id', handler: one },
  { method: 'POST', path: '/api/proposals/:id/approve', handler: approve },
  { method: 'POST', path: '/api/proposals/:id/reject', handler: reject },
  { method: 'GET', path: '/api/proposals/:id/draft', handler: draft },
  { method: 'GET', path: '/api/proposals/:id/visual', handler: visual },
];
