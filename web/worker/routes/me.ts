// SPDX-License-Identifier: Apache-2.0
// GET /api/me: who the room thinks you are. Used by every page to greet the member and pick a UI.
// `can` lists the actions the page offers controls for, so a read-only member never sees a button the
// Worker would refuse (the routes still check every request).
// While the room's PROPOSALS_ENABLED is "1", /api/me also says `proposals: { approve }`, so the Account menu offers the
// Proposals page; with it off the answer is exactly what it was before proposals existed. CHECKLIST_ENABLED works the
// same way: `checklist: true` while it's "1", nothing otherwise.
// GET /api/me/ai: whether the member's own AI app is connected, for the Overview's "connect your own AI" panel only,
// so no other page pays for the lookup. It asks legallas-mcp's live grants over the MCP_GRANTS service binding.
import type { AiStatus, MemberGrantsApi } from '../../mcp/member-grants.ts';
import { canPerform, type Action } from '../auth.ts';
import type { RequestContext } from '../env.ts';
import { checklistEnabled } from '../checklist.ts';
import { canUseProposals } from '../proposal-review.ts';
import { proposalsEnabled } from '../proposals.ts';
import { json } from '../http.ts';
import type { Route } from '../router.ts';

/** The actions the front end hides or shows controls for; viewActivity keeps /activity/ from asking for a 403. */
export const UI_ACTIONS: readonly Action[] = ['readComments', 'comment', 'upload', 'flag', 'connect', 'viewActivity'];

export const AI_PATH = '/api/me/ai';

const NOT_CONNECTED: AiStatus = { connected: false, via: null, at: null };

/** The binding's answer, kept to its three fields and their types; anything else is not connected. */
function asStatus(value: unknown): AiStatus {
  const v = value as Partial<AiStatus> | null;
  if (v?.connected !== true) return NOT_CONNECTED;
  return { connected: true, via: typeof v.via === 'string' ? v.via : null, at: typeof v.at === 'string' ? v.at : null };
}

/**
 * The member's own live connection. No binding (local dev without legallas-mcp, an older config) or a failed call is
 * not connected: `ai` only shapes the Overview panel, so it never fails the request.
 */
export async function aiStatus(grants: MemberGrantsApi | undefined, email: string): Promise<AiStatus> {
  if (!grants) return NOT_CONNECTED;
  try {
    return asStatus(await grants.live(email));
  } catch (error) {
    console.error('me_ai_unavailable', error instanceof Error ? error.name : 'unknown');
    return NOT_CONNECTED;
  }
}

async function getAi({ env, member }: RequestContext): Promise<Response> {
  if (!canPerform(member.role, 'connect')) return json({ ai: NOT_CONNECTED });
  return json({ ai: await aiStatus(env.MCP_GRANTS, member.email) });
}

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/api/me',
    handler: async ({ env, member }) =>
      json({
        email: member.email,
        role: member.role,
        name: member.name,
        can: Object.fromEntries(UI_ACTIONS.map((action) => [action, canPerform(member.role, action)])),
        ...(proposalsEnabled(env) && canUseProposals(member.role) ? { proposals: { approve: canPerform(member.role, 'approve') } } : {}),
        ...(checklistEnabled(env) ? { checklist: true } : {}),
      }),
  },
  { method: 'GET', path: AI_PATH, handler: getAi },
];
