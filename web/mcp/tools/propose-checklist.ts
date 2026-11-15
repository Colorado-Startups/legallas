// SPDX-License-Identifier: Apache-2.0
// legallas_propose_checklist (worker/proposal-checklist.ts): a member's connected AI proposes, by the item's id, that one
// company checklist item does or doesn't apply. Listed with legallas_propose_draft (mcp/server.ts), and only while the
// room's CHECKLIST_ENABLED is "1" too. The owner approves it in the room; nothing changes until then. As the draft tool:
// made as the connection's member, re-read from D1 for this call; a strict schema; the text is never echoed back.
import { z } from 'zod';
import { canPerform } from '../../worker/auth.ts';
import { checklistEnabled } from '../../worker/checklist.ts';
import { createChecklistProposal } from '../../worker/proposal-checklist.ts';
import { cleanText, PROPOSAL_LIMITS, proposalsEnabled } from '../../worker/proposals.ts';
import { auditVia } from '../audit.ts';
import { PROPOSE_CHECKLIST_TOOL_NAME, type ToolDefinition } from '../contract.ts';
import { jsonResult, toolError } from '../format.ts';
import { PROPOSAL_OUTPUT } from './output.ts';
import { reviewLink } from './propose.ts';

const inputSchema = z.strictObject({
  item_id: z.string().regex(/^[a-z0-9.-]{1,100}$/).describe('The checklist item id, such as formation.bylaws.'),
  applies: z.boolean().describe('Whether the item applies to this company.'),
  why: z.string().min(1).max(PROPOSAL_LIMITS.why).describe('Why, for the owner who will review it.'),
});

/** The tool that proposes a checklist change. */
export const proposeChecklistTool: ToolDefinition<typeof inputSchema> = {
  name: PROPOSE_CHECKLIST_TOOL_NAME,
  title: 'Propose a checklist change',
  description:
    "Proposes that one item on the company checklist does or doesn't apply to this company, for the room owner to " +
    'approve in the counsel room. Nothing changes unless the owner approves it, and this tool cannot approve. Returns ' +
    'the proposal id and the link where it is reviewed.',
  inputSchema,
  outputSchema: PROPOSAL_OUTPUT,
  async handler(args, ctx) {
    if (!proposalsEnabled(ctx.env) || !checklistEnabled(ctx.env)) return toolError('not_found', 'Checklist proposals are off in this counsel room.');
    if (ctx.props.propose !== true) {
      return toolError('forbidden', 'This connection is read-only. Its member can connect it again and allow proposals.');
    }
    if (!canPerform(ctx.member.role, 'propose')) return toolError('forbidden', "This member's role cannot propose in the counsel room.");
    const why = cleanText(args.why, PROPOSAL_LIMITS.why);
    if (!why) return toolError('invalid_arguments', 'The why must hold text within its limit.');
    const result = await createChecklistProposal(
      ctx.env.DB,
      { member: ctx.member, via: auditVia(ctx.props.clientName), clientKind: ctx.clientKind },
      { itemId: args.item_id, applies: args.applies },
      why,
      ctx.now,
    );
    if (!result.ok) {
      switch (result.error) {
        case 'item_not_found':
          return toolError('not_found', 'That is not an item on the company checklist.');
        case 'pending_limit':
          return toolError('pending_limit', `This member already has ${PROPOSAL_LIMITS.pendingPerMember} proposals waiting. A person must decide some first.`);
        case 'daily_limit':
          return toolError('daily_limit', `The daily limit of ${PROPOSAL_LIMITS.perDay} proposals is reached. It resets at midnight UTC.`);
        default:
          return toolError('forbidden', "This member's role cannot propose in the counsel room.");
      }
    }
    return jsonResult({
      proposal: { id: result.id, status: 'pending', expires: result.expiresAt.slice(0, 10), review_link: reviewLink(result.id) },
      note: 'The room owner must approve this proposal in the counsel room. Until then nothing changes.',
    });
  },
};
