// SPDX-License-Identifier: Apache-2.0
// What a room is about: its company, or a case (issue #18). While COMPANY_ROOM_ENABLED is "1", no published matter means a
// company room. The shape is never stored, so publishing a matter later makes the same room a case room with nothing lost.
//
// One build serves both shapes, so the Worker shapes a company room's pages as they leave: it removes data-case-only parts
// and shows data-company-only ones, which the build leaves hidden. With the setting off, or with a matter, a page is the
// asset itself and the room makes no extra call.
import { CASE_PAGE } from './case-pages.ts';
import type { Member } from './env.ts';
import type { MemberGrantsApi } from '../mcp/member-grants.ts';
import { MATTER_KEY } from './matter-types.ts';
import { keepsOwnOrder, panelShape, shapePanel } from './overview-ai.ts';
import { checklistCard, shapeChecklistCard, type ChecklistCardEnv } from './overview-checklist.ts';
import type { ChecklistSummary } from './checklist.ts';

export interface CompanyRoomSetting {
  COMPANY_ROOM_ENABLED?: string;
}

/** A failed lookup keeps the case room, today's room. */
export async function isCompanyRoom(env: CompanyRoomSetting & { FILES?: R2Bucket }): Promise<boolean> {
  if (env.COMPANY_ROOM_ENABLED !== '1') return false;
  if (!env.FILES) {
    // A misconfigured Worker: the type requires the binding, so say so instead of quietly keeping the case room (#220).
    console.error('room_shape_no_files');
    return false;
  }
  try {
    return (await env.FILES.head(MATTER_KEY)) === null;
  } catch (error) {
    console.error('room_shape_unavailable', error instanceof Error ? error.name : 'unknown');
    return false;
  }
}

/** `page` as a room with no matter serves it. Anything but HTML, such as the front door's fonts, passes through. */
export function shapedPage(page: Response): Response {
  if (!(page.headers.get('Content-Type') ?? '').includes('text/html')) return page;
  return new HTMLRewriter()
    .on('html', { element: (html) => void html.setAttribute('data-room-shape', 'company') })
    .on('[data-case-only]', { element: (part) => void part.remove() })
    .on('[data-company-only]', { element: (part) => void part.removeAttribute('hidden') })
    .transform(page);
}

/**
 * A HEAD for `page` as a room with no matter answers it: the headers a shaped GET sends. The rewrite streams its body,
 * so the asset's Content-Length, which is the unshaped page's size, never goes out (#220).
 */
export function shapedHead(page: Response): Response {
  if (!(page.headers.get('Content-Type') ?? '').includes('text/html')) return page;
  const headers = new Headers(page.headers);
  headers.delete('Content-Length');
  return new Response(null, { status: page.status, statusText: page.statusText, headers });
}

/**
 * Only a page load asks about the shape, so a script or a stylesheet never costs an R2 call. With the member, the
 * Overview also leaves with its AI panel drawn in their shape (overview-ai.ts), asked for alongside the asset, and a
 * company room's Overview with its checklist card drawn (overview-checklist.ts).
 */
export async function servePage(
  request: Request,
  env: CompanyRoomSetting & ChecklistCardEnv & { ASSETS: Fetcher; FILES: R2Bucket; MCP_GRANTS?: MemberGrantsApi },
  url: URL,
  member?: Pick<Member, 'role' | 'email'>,
): Promise<Response> {
  const isPageLoad = request.method === 'GET' && (request.headers.get('Accept') ?? '').includes('text/html');
  if (!isPageLoad) return env.ASSETS.fetch(request);
  const overview = member && url.pathname === '/';
  const panel = overview && !keepsOwnOrder(request, url) ? panelShape(env.MCP_GRANTS, member).catch(() => null) : null;
  let page: Response;
  let card: Promise<ChecklistSummary | null> | null = null;
  if (!(await isCompanyRoom(env))) page = await env.ASSETS.fetch(request);
  else if (CASE_PAGE.test(url.pathname)) return Response.redirect(new URL('/', url).href, 302);
  else {
    card = overview ? checklistCard(env, member).catch(() => null) : null;
    page = shapedPage(await env.ASSETS.fetch(request));
  }
  const [shape, summary] = await Promise.all([panel, card]);
  if (!page.ok || !(page.headers.get('Content-Type') ?? '').includes('text/html')) return page;
  if (shape) page = shapePanel(page, shape, member?.role);
  return summary ? shapeChecklistCard(page, summary) : page;
}
