// SPDX-License-Identifier: Apache-2.0
// legallas_propose_draft (docs/design/propose-and-approve.md): a member's connected AI proposes a new draft document for
// that member to approve in the room. Listed only while the room's PROPOSALS_ENABLED is "1" and the member let this
// connection propose when they connected it (Props.propose; mcp/server.ts listsPropose). The proposal
// is made as the member this connection belongs to, re-read from D1 for this call (runTool), and through the AI app
// the OAuth client names: neither comes from the arguments, and the strict schema refuses any field it does not list
// (a status, a kind, another member, another app). The kind follows from `template` (a filled template) or `prepared`
// (a message or filing for a person to send or file, which only the owner approves); a call setting both is refused.
// With `visual`, the body is an HTML page the member approves into the room's binder (worker/proposal-visual.ts);
// counsel's are privileged unless `privileged` says otherwise.
// It can cite only documents the member can see; one they cannot answers like a missing one. The result carries the id, `pending` and the room link, never the text back, and no tool
// reads proposals, so a proposal never returns into an AI's context as if it were the record.
import { z } from 'zod';
import { canPerform } from '../../worker/auth.ts';
import { privilegedByDefault, savedSlug } from '../../worker/proposal-visual.ts';
import { cleanText, cleanTitle, createDraftProposal, PROPOSAL_LIMITS, proposalsEnabled, TEMPLATE_PATHS, type CreateResult, type ProposalKind, type ProposalSource } from '../../worker/proposals.ts';
import { auditVia } from '../audit.ts';
import { PROPOSE_TOOL_NAME, ROOM_ORIGIN, type ToolContext, type ToolDefinition } from '../contract.ts';
import { jsonResult, toolError } from '../format.ts';
import { PROPOSAL_OUTPUT } from './output.ts';

const DOC_ID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).describe('A document id from search or list results.');

const inputSchema = z.strictObject({
  title: z.string().min(1).max(PROPOSAL_LIMITS.title).describe("The draft's title."),
  body: z.string().min(1).max(PROPOSAL_LIMITS.body).describe("The draft's full text, in Markdown or plain text."),
  why: z.string().min(1).max(PROPOSAL_LIMITS.why).describe('Why this draft is proposed, for the person who will review it.'),
  sources: z
    .array(z.strictObject({ document_id: DOC_ID, page: z.number().int().min(1).max(100_000).optional().describe('A page the draft relies on.') }))
    .max(PROPOSAL_LIMITS.sources)
    .default([])
    .describe(`The documents the draft relies on, at most ${PROPOSAL_LIMITS.sources}.`),
  template: z
    .enum(TEMPLATE_PATHS as [string, ...string[]])
    .optional()
    .describe("When the draft fills a template from legallas_template, that template's path. Not with prepared."),
  prepared: z
    .enum(['message', 'filing'])
    .optional()
    .describe('When the draft is a message for a person to send, or a filing for a person to file. Only the room owner approves those, and the room never sends or files anything. Not with template.'),
  visual: z
    .boolean()
    .optional()
    .describe("True when body is a self-contained HTML page (a kit's grid, board or chronology, or an artifact) for the room's binder. Link cites to each result's link: they open the document there. No network in the binder. Not with template or prepared."),
  privileged: z.boolean().optional().describe('A visual only. Defaults to true for counsel, false for the owner.'),
});

/** The kind a message or filing prepared for a person to send or file is stored as. */
const PREPARED_KIND = { message: 'prepared_message', filing: 'prepared_filing' } as const;

/** The kind a call proposes: a filled template, a prepared message or filing, or else a new draft. Null for both at once. */
function kindOf(args: { template?: string; prepared?: keyof typeof PREPARED_KIND }): ProposalKind | null {
  if (args.template !== undefined && args.prepared !== undefined) return null;
  if (args.template !== undefined) return 'filled_template';
  return args.prepared === undefined ? 'draft_document' : PREPARED_KIND[args.prepared];
}

/** The room page where a person reviews one proposal. */
export function reviewLink(id: string): string {
  return `${ROOM_ORIGIN}/proposals/?id=${encodeURIComponent(id)}`;
}

/** The sources once each, in the order given: the same document and page twice is one source. */
function uniqueSources(sources: readonly { document_id: string; page?: number }[]): ProposalSource[] {
  const seen = new Set<string>();
  const out: ProposalSource[] = [];
  for (const source of sources) {
    const key = `${source.document_id}#${source.page ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ documentId: source.document_id, page: source.page ?? null });
  }
  return out;
}

type ProposeArgs = z.infer<typeof inputSchema>;

/** The call's kind and cleaned text, or the error to give back: switched off, read-only, a role that cannot propose, or bad arguments. */
function checkCall(args: ProposeArgs, ctx: ToolContext): { error: ReturnType<typeof toolError> } | { kind: ProposalKind; title: string; body: string; why: string } {
  // Not listed while the setting is off, so a call cannot reach here then; refused anyway, as an unknown tool reads.
  if (!proposalsEnabled(ctx.env)) return { error: toolError('not_found', 'Proposals are off in this counsel room.') };
  if (ctx.props.propose !== true) {
    return { error: toolError('forbidden', 'This connection is read-only. Its member can connect it again and allow proposals.') };
  }
  if (!canPerform(ctx.member.role, 'propose')) {
    return { error: toolError('forbidden', "This member's role cannot propose drafts in the counsel room.") };
  }
  const kind = kindOf(args);
  if (kind === null) return { error: toolError('invalid_arguments', 'Set template or prepared, not both.') };
  if (args.visual === true ? kind !== 'draft_document' : args.privileged !== undefined) {
    return { error: toolError('invalid_arguments', 'A visual takes no template or prepared; privileged is for a visual only.') };
  }
  const title = cleanTitle(args.title);
  const body = cleanText(args.body, PROPOSAL_LIMITS.body);
  const why = cleanText(args.why, PROPOSAL_LIMITS.why);
  if (!title || !body || !why) {
    return { error: toolError('invalid_arguments', 'The title, body and why must each hold text within their limits.') };
  }
  return { kind, title, body, why };
}

/** What a refused proposal says. */
function refusedResult(result: Extract<CreateResult, { ok: false }>): ReturnType<typeof toolError> {
  switch (result.error) {
    case 'template_not_found':
      return toolError('not_found', "That template is not one of the room's templates.");
    case 'source_not_found':
      return toolError('not_found', `Source ${(result.index ?? 0) + 1} is not a document this connection can see. Use ids from search or list results.`);
    case 'pending_limit':
      return toolError('pending_limit', `This member already has ${PROPOSAL_LIMITS.pendingPerMember} proposals waiting. A person must decide some first.`);
    case 'daily_limit':
      return toolError('daily_limit', `The daily limit of ${PROPOSAL_LIMITS.perDay} proposals is reached. It resets at midnight UTC.`);
    default:
      return toolError('forbidden', "This member's role cannot propose drafts in the counsel room.");
  }
}

/** The id, `pending` and the room link: never the text back. */
function proposedResult(result: Extract<CreateResult, { ok: true }>, visual: boolean): ReturnType<typeof toolError> {
  return jsonResult({
    proposal: {
      id: result.id,
      status: 'pending',
      expires: result.expiresAt.slice(0, 10),
      review_link: reviewLink(result.id),
      ...(visual ? { binder_link: `${ROOM_ORIGIN}/visual/?v=${encodeURIComponent(savedSlug(result.id))}` } : {}),
    },
    note: visual
      ? 'A person must approve this proposal in the counsel room. Then it shows at binder_link.'
      : 'A person must approve this proposal in the counsel room. Until then nothing changes.',
  });
}

/** The tool that proposes a draft. */
export const proposeDraftTool:ToolDefinition<typeof inputSchema> = {
  name: PROPOSE_TOOL_NAME,
  title: 'Propose a draft',
  description:
    'Proposes a new draft document for a person to review in the counsel room. The draft is kept as a pending proposal: ' +
    'nothing is added to the record, filed, sent or shared unless a person approves it in the room, and this tool cannot ' +
    "approve. When the draft fills one of the room's templates, name it in template. Set prepared for a message or filing " +
    'a person will send or file. Set visual to save an HTML page you built into the binder. One of the three at most. ' +
    'Returns the proposal id and the link where it is reviewed.',
  inputSchema,
  outputSchema: PROPOSAL_OUTPUT,
  async handler(args, ctx) {
    const checked = checkCall(args, ctx);
    if ('error' in checked) return checked.error;
    const { kind, title, body, why } = checked;
    const visual = args.visual === true;
    const result = await createDraftProposal(
      ctx.env.DB,
      // The app's name as audit_log.via stores it (mcp/audit.ts).
      { member: ctx.member, via: auditVia(ctx.props.clientName), clientKind: ctx.props.ask === true ? 'ask' : ctx.clientKind },
      {
        title,
        why,
        body,
        sources: uniqueSources(args.sources),
        ...(args.template === undefined ? {} : { template: args.template }),
        ...(visual ? { visual: { privileged: args.privileged ?? privilegedByDefault(ctx.member.role) } } : {}),
      },
      ctx.now,
      kind,
    );
    return result.ok ? proposedResult(result, visual) : refusedResult(result);
  },
};
