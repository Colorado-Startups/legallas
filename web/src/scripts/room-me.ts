// SPDX-License-Identifier: Apache-2.0
// Who is signed in, fetched once per page and shared through window.legallasMe. `can` says which
// controls to offer: counsel get no Activity, the owner's ledger. The Worker checks every request
// anyway; this only keeps refused buttons and 403 noise off the page.
import { ROOM_FETCH_HEADERS, showSessionEnded } from './session-ended.ts';

/** The actions /api/me reports (worker/routes/me.ts UI_ACTIONS). */
export type UiAction = 'readComments' | 'comment' | 'upload' | 'flag' | 'connect' | 'viewActivity';

/** The signed-in member: email, role and name. */
export interface Me {
  email: string;
  role: 'owner' | 'counsel';
  name: string | null;
  can?: Partial<Record<UiAction, boolean>>;
  /** Present only while the room's proposals are on (worker/routes/me.ts): whether this member may decide them. */
  proposals?: { approve: boolean };
  /** Present only while the room's company checklist is on (worker/routes/me.ts). */
  checklist?: true;
}

/** The member's own AI connection (GET /api/me/ai, mcp/member-grants.ts AiStatus): the app and when, or nulls. */
export interface AiStatus {
  connected: boolean;
  via: string | null;
  at: string | null;
}

declare global {
  interface Window {
    legallasMe?: Promise<Me | null>;
  }
}

/** How long /api/me may take before it counts as no answer (as files-api.ts FETCH_TIMEOUT_MS). */
export const ME_TIMEOUT_MS = 30_000;

/**
 * The shared /api/me request; the first caller starts it. A request that stalls past ME_TIMEOUT_MS is no answer,
 * like a failed one, so a page that waits on it (Documents, the Overview) still settles.
 */
export function loadMe(): Promise<Me | null> {
  window.legallasMe ??= fetch('/api/me', { credentials: 'same-origin', signal: AbortSignal.timeout(ME_TIMEOUT_MS), headers: ROOM_FETCH_HEADERS })
    .then((response) => {
      // Every room page asks for /api/me, so an ended sign-in shows its notice here first (session-ended.ts).
      if (response.status === 401) showSessionEnded();
      return response.ok ? (response.json() as Promise<Me>) : null;
    })
    .catch(() => null);
  return window.legallasMe;
}

/**
 * May the signed-in member do `action`? Unknown (no answer, or an older Worker without `can`) counts as
 * yes, so the page behaves as before and the Worker's own check decides.
 */
export async function meCan(action: UiAction): Promise<boolean> {
  const me = await loadMe();
  return me?.can?.[action] !== false;
}

/**
 * GET /api/me/ai, asked only by the Overview's connect panel (components/ConnectFirst.astro), so no other page pays
 * for the lookup. No answer, a stalled one or an older Worker without the route is null: the panel keeps its cards.
 */
export function loadAi(): Promise<AiStatus | null> {
  return fetch('/api/me/ai', { credentials: 'same-origin', signal: AbortSignal.timeout(ME_TIMEOUT_MS), headers: ROOM_FETCH_HEADERS })
    .then((response) => (response.ok ? (response.json() as Promise<{ ai?: AiStatus }>) : null))
    .then((body) => body?.ai ?? null)
    .catch(() => null);
}
