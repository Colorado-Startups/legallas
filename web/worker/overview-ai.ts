// SPDX-License-Identifier: Apache-2.0
// The Overview's "connect your own AI" panel (components/ConnectFirst.astro), drawn in its final shape before the page
// leaves the Worker (#204). The build draws it held invisible (aria-busy) until a script learns the member's shape from
// GET /api/me/ai, so that it never shows the cards and then shrinks to the one Connected line. On a phone that script
// runs seconds after the first paint, and the panel was the page's largest paint: it showed only when its 1.5 s
// failsafe let it. The Worker knows the member and can ask the same question, so it draws the panel's shape itself and
// nothing is held.
//
// The lookup gets SHAPE_WAIT_MS. Slower, or failing, the page goes out as built and the panel's script shapes it as
// before: the one thing that never changes is that the page loads.
import { canPerform } from './auth.ts';
import type { Member } from './env.ts';
import type { MemberGrantsApi } from '../mcp/member-grants.ts';
import { appLabel, ORDER_COOKIE, ORDER_PARAM } from './ai-label.ts';
import { aiStatus } from './routes/me.ts';

/** How long the page may wait on the member's AI status before it goes out as built. */
export const SHAPE_WAIT_MS = 250;

export type PanelShape = { state: 'none' } | { state: 'open' } | { state: 'connected'; via: string };

/** The member's panel: none for a role that may not connect, else the cards or the one line. Null when it is unknown in time. */
export async function panelShape(grants: MemberGrantsApi | undefined, member: Pick<Member, 'role' | 'email'>, waitMs = SHAPE_WAIT_MS): Promise<PanelShape | null> {
  if (!canPerform(member.role, 'connect')) return { state: 'none' };
  // No binding means the room has no legallas-mcp to ask (local dev, an older config): the client's answer is the same.
  if (!grants) return { state: 'open' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), waitMs);
  });
  try {
    const status = await Promise.race([aiStatus(grants, member.email), late]);
    if (!status) return null;
    return status.connected ? { state: 'connected', via: appLabel(status.via) } : { state: 'open' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A load that chooses a card order (?ai=) or comes from a browser that keeps its own (ORDER_COOKIE) goes out as built:
 * the panel's script reorders the cards while the panel is held, so they never move on screen.
 */
export function keepsOwnOrder(request: Request, url: URL): boolean {
  if (url.searchParams.has(ORDER_PARAM)) return true;
  return (request.headers.get('Cookie') ?? '').split(';').some((pair) => pair.trim().startsWith(`${ORDER_COOKIE}=`));
}

/**
 * The cards a role's panel leaves out, as the /connect panel does for its reader (mcp/pages/connect.ts PANEL_ORDER;
 * overview-ai.test.ts checks): Harvey is a law firm's tool, so the founder's panel has none. Counsel keep every card.
 */
export function trimmedCards(role: Member['role']): readonly string[] {
  return role === 'owner' ? ['harvey'] : [];
}

/**
 * The Overview with its panel in `shape`, held no longer, without the cards `role` leaves out. Marked
 * data-shaped="server" so the panel's script keeps it.
 */
export function shapePanel(page: Response, shape: PanelShape, role?: Member['role']): Response {
  const rewriter = new HTMLRewriter();
  for (const app of role ? trimmedCards(role) : []) rewriter.on(`[data-connect-first] [data-ai="${app}"]`, { element: (card) => void card.remove() });
  return rewriter
    .on('[data-connect-first]', {
      element: (panel) => {
        panel.setAttribute('data-state', shape.state);
        panel.setAttribute('data-shaped', 'server');
        panel.removeAttribute('aria-busy');
        if (shape.state === 'none') panel.setAttribute('hidden', '');
        if (shape.state === 'connected') panel.setAttribute('aria-labelledby', 'ov-ai-line');
      },
    })
    .on('[data-connect-first] [data-ov-ai-via]', {
      element: (via) => {
        if (shape.state === 'connected') via.setInnerContent(shape.via);
      },
    })
    .transform(withoutEtag(page));
}

/** The asset's ETag describes the built file, not this member's page. */
export function withoutEtag(page: Response): Response {
  if (!page.headers.has('ETag')) return page;
  const copy = new Response(page.body, page);
  copy.headers.delete('ETag');
  return copy;
}
