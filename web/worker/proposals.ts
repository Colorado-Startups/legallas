// SPDX-License-Identifier: Apache-2.0
// Propose and approve (docs/design/propose-and-approve.md): an AI proposes work as one member, and a person in the
// room approves, edits and approves, or rejects it. This file holds the setting, the limits and making a proposal, for
// the remote MCP server's propose tool (mcp/tools/propose.ts); reviewing and deciding are in worker/proposal-review.ts,
// for the room's routes (worker/routes/proposals.ts). Off unless the room sets PROPOSALS_ENABLED to "1"; with it
// off neither Worker lists a tool, serves a route or touches these tables (migration 0013).
//
// What holds here, whoever calls:
// - A proposal is made as one member, whose role must allow `propose`, and can cite only documents that member can
//   see (live, not a room data file, the privilege rule). A source they cannot see answers like a missing one.
// - Every kind is live (LIVE_KINDS). Nothing in this file writes members, grants, settings or documents. Approving a
//   draft, filled template, prepared message or prepared filing changes the proposal row and adds an event; approving a
//   checklist update also marks one checklist item as applying or not (worker/proposal-checklist.ts). Nothing is ever
//   sent or filed: a prepared message or filing is text for a person to send or file.
// - A person sees and decides only the proposals their own AI made (the member whose AI made a proposal approves it,
//   docs/design/ai-connectors.md), only when they can see every document it cites, and decides only when their role
//   allows `approve`. The OWNER_DECIDES kinds are the exception: only the owner decides them, whoever's AI made them.
// - Approval needs a pending, unexpired proposal whose cited documents are unchanged, all checked in the one UPDATE
//   that approves, so nothing can change between the check and the write. The database refuses a second decision.
// - Every step writes a proposal_events row: who, when, which AI, a code. Never text.
// - Proposal text is data from a model that read documents anyone may have written: it is flagged when it reads as
//   instructions to an AI (quarantine.ts), and never reaches Ask, the index or an AI's context from here.
import { holdsPrintedNumber } from './printed-number.ts';
import { canPerform } from './auth.ts';
import { TEMPLATES } from './templates.generated.ts';
import type { Member, Role } from './env.ts';
import { NOT_HIDDEN_SQL } from './files-catalog.ts';
import { privilegeFilter } from './privilege.ts';
import { addressesModel } from './quarantine.ts';

/** The room setting (a Worker variable on both Workers): "1" turns proposals on; anything else, or unset, is off. */
export interface ProposalSetting {
  PROPOSALS_ENABLED?: string;
}

/** True only when the room has turned proposals on. */
export function proposalsEnabled(env: ProposalSetting): boolean {
  return env.PROPOSALS_ENABLED === '1';
}

/** Every kind the database accepts (migration 0013); LIVE_KINDS says which the code serves. */
export const PROPOSAL_KINDS = ['draft_document', 'filled_template', 'checklist_update', 'prepared_filing', 'prepared_message'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
/** The kinds an AI may propose today. Named one by one, so a kind added to the database is not live by accident. */
export const LIVE_KINDS: readonly ProposalKind[] = ['draft_document', 'filled_template', 'checklist_update', 'prepared_message', 'prepared_filing'];

/**
 * The kinds only the owner decides, whoever's AI proposed them: a checklist update changes the company's own
 * checklist, and sending and filing take the owner. Every other kind is decided by the member whose AI proposed it.
 */
export const OWNER_DECIDES: readonly ProposalKind[] = ['checklist_update', 'prepared_message', 'prepared_filing'];

/** The templates a filled_template proposal may fill: every one legallas_template serves (templates.generated.ts). */
export const TEMPLATE_PATHS: readonly string[] = TEMPLATES.map((template) => template.path);

/** Why a person rejected a proposal: codes only, so events and rows hold no reviewer text. */
export const REJECT_REASONS = ['not_needed', 'incorrect', 'unsafe', 'duplicate', 'other'] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

/** A proposal's state as people see it: `expired` is derived from expires_at, never stored. */
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'expired';

/** The AI behind a proposal: the MCP server's client kinds, and `ask` for the room's own assistant (later). */
export type ProposalClientKind = 'claude' | 'harvey' | 'microsoft' | 'unknown' | 'ask';

/** Bounds, matching migration 0013's CHECKs and caps. */
export const PROPOSAL_LIMITS = {
  title: 200,
  why: 2000,
  body: 60_000,
  sources: 20,
  /** Pending, unexpired proposals one member's AIs may have waiting at once. */
  pendingPerMember: 20,
  /** New proposals one member's AIs may make in a UTC day. */
  perDay: 50,
  /** Days a proposal may wait before it can no longer be approved. */
  ttlDays: 30,
} as const;

// C0 and C1 controls except tab and line feed, and the bidirectional embedding, override and isolate characters that
// can make text read differently from what it holds ("Trojan Source"). Removed from every proposal text.
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/** Proposal text as stored: CRLF and CR become LF, controls and bidi overrides go, then trimmed. Null when empty or too long. */
export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\r\n?/g, '\n').replace(CONTROLS, '').trim();
  // A printed SSN is refused like any other text a proposal can't hold (#267).
  return text.length >= 1 && text.length <= max && !holdsPrintedNumber(text) ? text : null;
}

/** A title as stored: one line (line breaks and tabs become spaces), otherwise as cleanText. */
export function cleanTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return cleanText(value.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' '), PROPOSAL_LIMITS.title);
}

/** One cited document: its id and, when the draft relies on one page, that page. */
export interface ProposalSource {
  documentId: string;
  page: number | null;
}

/** What an AI asks to propose, already cleaned. The member and the AI come from the verified connection, never input. */
export interface NewDraft {
  title: string;
  why: string;
  body: string;
  sources: readonly ProposalSource[];
  /** Set for a filled_template only: the template it fills, one of TEMPLATE_PATHS. */
  template?: string;
  /** Set for a visual only (a draft_document whose body is an HTML page for the binder, worker/proposal-visual.ts). */
  visual?: { privileged: boolean };
}

/** Who proposes: the member re-read from D1 for this call, and the AI app as the OAuth client names it. */
export interface Proposer {
  member: Member;
  via: string | null;
  clientKind: ProposalClientKind;
}

export type CreateResult =
  | { ok: true; id: string; expiresAt: string }
  | { ok: false; error: 'forbidden' | 'source_not_found' | 'template_not_found' | 'pending_limit' | 'daily_limit'; index?: number };

const DAY_MS = 24 * 3600 * 1000;

function dayStart(now: Date): string {
  return `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

/** A live document a member with `role` may see: the room's own rule for lists and reads. Its updated_at, or null. */
async function visibleUpdatedAt(db: D1Database, id: string, role: Role): Promise<string | null> {
  const row = await db
    .prepare(`SELECT updated_at FROM documents WHERE id = ?1 AND removed_at IS NULL AND ${NOT_HIDDEN_SQL}${privilegeFilter(role)}`)
    .bind(id)
    .first<{ updated_at: string }>();
  return row?.updated_at ?? null;
}

/**
 * Stores a new proposal of `kind` as `pending`, with its sources pinned to their current versions and one `proposed`
 * event. The caller names the kind; a filled_template, and only it, carries `draft.template`, one of TEMPLATE_PATHS.
 * The caps (PROPOSAL_LIMITS.pendingPerMember and perDay) are checked in the INSERT itself, so parallel calls cannot
 * pass them together. Nothing else changes.
 */
export async function createDraftProposal(db: D1Database, proposer: Proposer, draft: NewDraft, now: Date, kind: ProposalKind = 'draft_document'): Promise<CreateResult> {
  const { member } = proposer;
  if (!canPerform(member.role, 'propose')) return { ok: false, error: 'forbidden' };
  if (kind === 'filled_template' ? !TEMPLATE_PATHS.includes(draft.template ?? '') : draft.template !== undefined) {
    return { ok: false, error: 'template_not_found' };
  }
  if (draft.visual && kind !== 'draft_document') return { ok: false, error: 'forbidden' };

  const pinned: { documentId: string; page: number | null; updatedAt: string }[] = [];
  for (const [index, source] of draft.sources.slice(0, PROPOSAL_LIMITS.sources).entries()) {
    const updatedAt = await visibleUpdatedAt(db, source.documentId, member.role);
    if (updatedAt === null) return { ok: false, error: 'source_not_found', index };
    pinned.push({ ...source, updatedAt });
  }

  const id = crypto.randomUUID();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + PROPOSAL_LIMITS.ttlDays * DAY_MS).toISOString();
  const untrusted = addressesModel(`${draft.title}\n${draft.why}\n${draft.body}`) ? 1 : 0;
  const written = 'SELECT 1 FROM proposals WHERE id = ?1';

  await db.batch([
    db
      .prepare(
        'INSERT INTO proposals (id, kind, title, why, body, proposed_by, via, client_kind, untrusted, created_at, expires_at) ' +
          'SELECT ?1, ?14, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10 ' +
          "WHERE (SELECT COUNT(*) FROM proposals WHERE proposed_by = ?5 AND status = 'pending' AND expires_at > ?9) < ?11 " +
          'AND (SELECT COUNT(*) FROM proposals WHERE proposed_by = ?5 AND created_at >= ?12) < ?13',
      )
      .bind(id, draft.title, draft.why, draft.body, member.email, proposer.via, proposer.clientKind, untrusted, createdAt, expiresAt,
        PROPOSAL_LIMITS.pendingPerMember, dayStart(now), PROPOSAL_LIMITS.perDay, kind),
    ...pinned.map((source, position) =>
      db
        .prepare(`INSERT INTO proposal_sources (proposal_id, position, document_id, page, document_updated_at) SELECT ?1, ?2, ?3, ?4, ?5 WHERE EXISTS (${written})`)
        .bind(id, position, source.documentId, source.page, source.updatedAt),
    ),
    db
      .prepare(`INSERT INTO proposal_events (ts, proposal_id, action, actor_email, via, detail_code) SELECT ?2, ?1, 'proposed', ?3, ?4, ?5 WHERE EXISTS (${written})`)
      .bind(id, createdAt, member.email, proposer.via, draft.visual ? 'visual' : kind),
    ...(draft.visual
      ? [db.prepare(`INSERT INTO proposal_visuals (proposal_id, privileged) SELECT ?1, ?2 WHERE EXISTS (${written})`).bind(id, draft.visual.privileged ? 1 : 0)]
      : []),
  ]);

  if (await db.prepare(written).bind(id).first()) return { ok: true, id, expiresAt };
  const pending = await db
    .prepare("SELECT COUNT(*) AS n FROM proposals WHERE proposed_by = ?1 AND status = 'pending' AND expires_at > ?2")
    .bind(member.email, createdAt)
    .first<{ n: number }>();
  return { ok: false, error: (pending?.n ?? 0) >= PROPOSAL_LIMITS.pendingPerMember ? 'pending_limit' : 'daily_limit' };
}
