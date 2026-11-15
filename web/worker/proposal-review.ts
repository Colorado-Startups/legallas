// SPDX-License-Identifier: Apache-2.0
// Reviewing proposals in the room (docs/design/propose-and-approve.md): what a person may see, and approving, editing
// and approving, rejecting and downloading. A member decides only the proposals their own AI made, and only when their
// role allows `approve`; the owner decides the OWNER_DECIDES kinds (a checklist update, a prepared message or filing),
// whoever's AI made them. They see their own, and the owner sees every member's (the owner's answer on issue #21).
// Proposals are made in worker/proposals.ts, which says what holds for both.
// Served by worker/routes/proposals.ts only while the room's PROPOSALS_ENABLED is "1".
import { canPerform } from './auth.ts';
import { draftText } from './draft-text.ts';
import type { Member, Role } from './env.ts';
import { NOT_HIDDEN_SQL } from './files-catalog.ts';
import { privilegeFilter } from './privilege.ts';
import { checklistApply } from './proposal-checklist.ts';
import { prepareProposedVisual, savedSlug, visualApply, visualSrc, type VisualRoom } from './proposal-visual.ts';
import { LIVE_KINDS, OWNER_DECIDES, type ProposalClientKind, type ProposalKind, type ProposalStatus, type RejectReason } from './proposals.ts';

// Reading proposals in the room.

/** Whether a member may open the proposals page at all: their AI may propose, or they may decide. */
export function canUseProposals(role: Role): boolean {
  return canPerform(role, 'propose') || canPerform(role, 'approve');
}

/** Whether `role` sees every member's proposals, not only its own AI's: the owner, who sees the whole room's activity. */
export function seesAllProposals(role: Role): boolean {
  return canPerform(role, 'viewActivity');
}

/**
 * The WHERE conditions (on `p`) for proposals `viewer` may see: those their own AI made, since the member whose AI made
 * a proposal decides it (docs/design/ai-connectors.md, "Propose and approve"), or every member's for the owner; and,
 * for a role without viewPrivileged, none that cites a privileged document. ?1 is the viewer's email.
 */
function visibleTo(viewer: Member): string {
  const privileged = canPerform(viewer.role, 'viewPrivileged')
    ? ''
    : " AND NOT EXISTS (SELECT 1 FROM proposal_sources s JOIN documents d ON d.id = s.document_id WHERE s.proposal_id = p.id AND d.path LIKE '%privileged%')";
  return `${seesAllProposals(viewer.role) ? '?1 IS NOT NULL' : 'p.proposed_by = ?1'}${privileged}`;
}

/**
 * Whether `viewer` decides this proposal: their role allows `approve`, and either it is an OWNER_DECIDES kind and they
 * are the owner, or it is any other kind and their own AI made it. The one rule; decidesWhere is its SQL.
 */
export function decides(viewer: Member, proposal: { proposed_by: string; kind: ProposalKind }): boolean {
  if (!canPerform(viewer.role, 'approve')) return false;
  return OWNER_DECIDES.includes(proposal.kind) ? seesAllProposals(viewer.role) : proposal.proposed_by === viewer.email;
}

/**
 * decides() as the WHERE condition of a deciding UPDATE, so the write checks it again: for the owner, an OWNER_DECIDES
 * kind or their own AI's; for anyone else, their own AI's of any other kind. ?2 is the viewer's email. The role's
 * `approve` is checked before the UPDATE runs.
 */
function decidesWhere(viewer: Member): string {
  const owners = OWNER_DECIDES.map((kind) => `'${kind}'`).join(', ');
  return seesAllProposals(viewer.role) ? `(kind IN (${owners}) OR proposed_by = ?2)` : `(kind NOT IN (${owners}) AND proposed_by = ?2)`;
}

/** One row of the proposals list. No body: the list never carries the draft's text. */
export interface ProposalSummary {
  id: string;
  kind: ProposalKind;
  status: ProposalStatus;
  title: string;
  proposed_by: string;
  via: string | null;
  client_kind: ProposalClientKind;
  untrusted: boolean;
  created_at: string;
  expires_at: string;
  decided_by: string | null;
  decided_at: string | null;
  sources: number;
  /** An HTML page for the binder (worker/proposal-visual.ts), not a text draft. */
  visual: boolean;
}

interface ProposalRow {
  id: string;
  kind: ProposalKind;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  title: string;
  why: string;
  body: string;
  proposed_by: string;
  via: string | null;
  client_kind: ProposalClientKind;
  untrusted: number;
  created_at: string;
  expires_at: string;
  decided_by: string | null;
  decided_at: string | null;
  final_title: string | null;
  final_body: string | null;
  reject_reason: RejectReason | null;
  /** A visual's privileged flag (proposal_visuals); null for every other proposal. */
  visual_privileged: number | null;
}

/** The status people see: a pending proposal past its expiry reads as expired. */
export function statusOf(row: Pick<ProposalRow, 'status' | 'expires_at'>, now: Date): ProposalStatus {
  return row.status === 'pending' && row.expires_at <= now.toISOString() ? 'expired' : row.status;
}

/** Which proposals a list shows: those waiting for a decision, those decided (or expired), or all. */
export type ProposalView = 'pending' | 'decided' | 'all';

export const LIST_LIMIT = 100;

/** The proposals `viewer` may see, newest first, at most LIST_LIMIT. */
export async function listProposals(db: D1Database, viewer: Member, view: ProposalView, now: Date): Promise<ProposalSummary[]> {
  const at = now.toISOString();
  const which =
    view === 'pending'
      ? " AND p.status = 'pending' AND p.expires_at > ?2"
      : view === 'decided'
        ? " AND (p.status <> 'pending' OR p.expires_at <= ?2)"
        : ' AND ?2 IS NOT NULL';
  const { results } = await db
    .prepare(
      'SELECT p.id, p.kind, p.status, p.title, p.proposed_by, p.via, p.client_kind, p.untrusted, p.created_at, p.expires_at, ' +
        'p.decided_by, p.decided_at, (SELECT COUNT(*) FROM proposal_sources s WHERE s.proposal_id = p.id) AS sources, ' +
        'EXISTS (SELECT 1 FROM proposal_visuals v WHERE v.proposal_id = p.id) AS visual ' +
        `FROM proposals p WHERE ${visibleTo(viewer)}${which} ORDER BY p.created_at DESC, p.id LIMIT ${LIST_LIMIT}`,
    )
    .bind(viewer.email, at)
    .all<Omit<ProposalSummary, 'untrusted' | 'visual'> & { untrusted: number; visual: number; status: ProposalRow['status'] }>();
  return results.map((row) => ({ ...row, untrusted: row.untrusted === 1, visual: row.visual === 1, status: statusOf(row, now) }));
}

async function findVisible(db: D1Database, viewer: Member, id: string): Promise<ProposalRow | null> {
  return db
    .prepare(
      'SELECT p.id, p.kind, p.status, p.title, p.why, p.body, p.proposed_by, p.via, p.client_kind, p.untrusted, p.created_at, ' +
        'p.expires_at, p.decided_by, p.decided_at, p.final_title, p.final_body, p.reject_reason, ' +
        '(SELECT v.privileged FROM proposal_visuals v WHERE v.proposal_id = p.id) AS visual_privileged ' +
        `FROM proposals p WHERE p.id = ?2 AND ${visibleTo(viewer)}`,
    )
    .bind(viewer.email, id)
    .first<ProposalRow>();
}

/** One cited document as the reviewer sees it: still there and unchanged, or not. */
export interface SourceView {
  document_id: string;
  page: number | null;
  /** The document's name, or null when it is gone or the viewer may no longer see it. */
  name: string | null;
  control_seq: number | null;
  /** True when the document changed since the proposal was made, or is gone: approval would be refused. */
  changed: boolean;
}

/** One step in a proposal's history. Codes only. */
export interface EventView {
  ts: string;
  action: string;
  actor_email: string;
  via: string | null;
  detail_code: string | null;
}

export interface ProposalDetail extends ProposalSummary {
  why: string;
  body: string;
  /** A visual only: whether it is privileged, where the frame loads it, and its binder slug once approved. */
  privileged: boolean | null;
  preview: string | null;
  binder_slug: string | null;
  final_title: string | null;
  final_body: string | null;
  reject_reason: RejectReason | null;
  /** What approving would change, written by the room from the kind, never by the AI. */
  changes: readonly string[];
  source_list: SourceView[];
  events: EventView[];
}

/** What approving a proposal of `kind` changes, in the room's own words; `privileged` set for a visual. */
export function changesOf(kind: ProposalKind, privileged: boolean | null = null): readonly string[] {
  if (kind === 'draft_document' && privileged !== null) {
    return [
      "Adds this page to the binder's Saved by AI tab. It runs in the binder's sandbox with no network, and its cites open the documents.",
      privileged ? 'Marked privileged: only members who see privileged documents see it.' : 'Every member who opens the binder sees it.',
      'Changes no document, person, access, setting or AI connection. Nothing is filed, sent or shared.',
    ];
  }
  if (kind === 'draft_document' || kind === 'filled_template') {
    return [
      kind === 'filled_template'
        ? "Adds one filled copy of a template from the room's library, with the title and text shown, to the approved drafts in this room."
        : 'Adds one draft document, with the title and text shown, to the approved drafts in this room.',
      // Save-back (worker/sync.ts UNSAVED_DRAFTS) writes draft_document only, so only it says the folder.
      kind === 'filled_template'
        ? 'The proposal itself stays outside the record. It can be downloaded once approved.'
        : 'The proposal itself stays outside the record. If you own the room and it saves drafts to your company folder, the draft is saved there in Drafts/ and comes into the room from there like any file you save.',
      'Changes no document, person, access, setting or AI connection. Nothing is filed, sent or shared.',
    ];
  }
  if (kind === 'checklist_update') {
    return [
      'Marks one item on the company checklist as applying or not, as shown. Only the owner approves it.',
      'Changes no document, person, access, setting or AI connection. Nothing is filed, sent or shared.',
    ];
  }
  if (kind === 'prepared_message' || kind === 'prepared_filing') {
    return [
      kind === 'prepared_message'
        ? 'Approves one message, with the title and text shown, for a person to send. The room never sends it.'
        : "Approves one filing, with the title and text shown, for a person to file on the agency's own site. The room never files it.",
      'Only the owner approves it. It stays outside the record and can be downloaded once approved.',
      'Changes no document, person, access, setting or AI connection. Nothing is filed, sent or shared.',
    ];
  }
  return ['This kind of proposal is not served yet: it cannot be approved.'];
}

/** One proposal with its sources and history, if `viewer` may see it; else null (a missing one reads the same). */
export async function getProposal(db: D1Database, viewer: Member, id: string, now: Date): Promise<ProposalDetail | null> {
  const row = await findVisible(db, viewer, id);
  if (!row) return null;
  const { results: sources } = await db
    .prepare(
      `SELECT s.document_id, s.page, s.document_updated_at, d.name, d.control_seq, d.updated_at FROM proposal_sources s ` +
        `LEFT JOIN documents d ON d.id = s.document_id AND d.removed_at IS NULL AND ${NOT_HIDDEN_SQL}${privilegeFilter(viewer.role, 'd.path')} ` +
        'WHERE s.proposal_id = ?1 ORDER BY s.position',
    )
    .bind(id)
    .all<{ document_id: string; page: number | null; document_updated_at: string; name: string | null; control_seq: number | null; updated_at: string | null }>();
  const { results: events } = await db
    .prepare('SELECT ts, action, actor_email, via, detail_code FROM proposal_events WHERE proposal_id = ?1 ORDER BY id')
    .bind(id)
    .all<EventView>();
  const { visual_privileged: flag, ...rest } = row;
  const privileged = flag === null ? null : flag === 1;
  return {
    ...rest,
    untrusted: row.untrusted === 1,
    status: statusOf(row, now),
    sources: sources.length,
    visual: privileged !== null,
    privileged,
    preview: privileged === null ? null : visualSrc(id),
    binder_slug: privileged !== null && row.status === 'approved' ? savedSlug(id) : null,
    changes: changesOf(row.kind, privileged),
    source_list: sources.map((s) => ({
      document_id: s.document_id,
      page: s.page,
      name: s.name,
      control_seq: s.name === null ? null : s.control_seq,
      changed: s.updated_at === null || s.updated_at !== s.document_updated_at,
    })),
    events,
  };
}

// Deciding.

/** Where a decision came from, for the event row: the room's clientInfo. */
export interface DecisionClient {
  ip: string | null;
  userAgent: string | null;
}

/** Optional edits a person makes before approving, already cleaned. */
export interface DraftEdits {
  title: string | null;
  body: string | null;
}

export type DecideResult =
  | { ok: true; status: 'approved' | 'rejected'; edited: boolean }
  | { ok: false; error: 'forbidden' | 'not_found' | 'not_yours' | 'not_pending' | 'expired' | 'sources_changed' | 'not_served' };

/**
 * The INSERT for one event by a person (never an AI: `via` is NULL). Given `decision`, it writes only when the
 * proposal carries that decision id, that is when this decision's UPDATE took effect in the same batch.
 */
function eventStatement(db: D1Database, values: { id: string; ts: string; action: string; actor: string; detail: string | null; client: DecisionClient }, decision?: string): D1PreparedStatement {
  const sql =
    'INSERT INTO proposal_events (ts, proposal_id, action, actor_email, via, detail_code, ip, user_agent) SELECT ?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7' +
    (decision === undefined ? '' : ' WHERE EXISTS (SELECT 1 FROM proposals WHERE id = ?2 AND decision_id = ?8)');
  const args = [values.ts, values.id, values.action, values.actor, values.detail, values.client.ip, values.client.userAgent];
  return db.prepare(sql).bind(...(decision === undefined ? args : [...args, decision]));
}

/** Whether the proposal now carries `decision`: this decision, and no other, took effect. */
async function tookEffect(db: D1Database, id: string, decision: string): Promise<boolean> {
  return (await db.prepare('SELECT 1 FROM proposals WHERE id = ?1 AND decision_id = ?2').bind(id, decision).first()) !== null;
}

/** Why a pending decision did not happen, read after the guarded UPDATE changed nothing. */
async function whyNot(db: D1Database, approver: Member, id: string, now: Date): Promise<'not_found' | 'not_pending' | 'expired' | null> {
  const row = await findVisible(db, approver, id);
  if (!row) return 'not_found';
  if (row.status !== 'pending') return 'not_pending';
  if (row.expires_at <= now.toISOString()) return 'expired';
  return null;
}

/**
 * Approves a pending draft as `approver`, with their edits if any. One UPDATE checks everything that must hold (the
 * role is checked here, the visibility, the approver decides it, pending, unexpired, a live kind, every source
 * live, visible to the approver and unchanged) and the event is written in the same batch only when that UPDATE took
 * effect. An edit that leaves the text as proposed is no edit. A refusal for changed sources is recorded as
 * `approve_refused`. The owner sees other members' proposals but gets `not_yours` for them, and nothing is written,
 * except the OWNER_DECIDES kinds, which only the owner decides. A checklist update writes its one checklist row in the
 * same batch, only when the decision took effect (worker/proposal-checklist.ts); a visual writes its page, prepared for
 * `room` (worker/proposal-visual.ts), the same way, and without `room` it is not served.
 */
export async function approveProposal(db: D1Database, approver: Member, id: string, edits: DraftEdits, now: Date, client: DecisionClient, room?: VisualRoom): Promise<DecideResult> {
  if (!canPerform(approver.role, 'approve')) return { ok: false, error: 'forbidden' };
  const row = await findVisible(db, approver, id);
  if (!row) return { ok: false, error: 'not_found' };
  if (!decides(approver, row)) return { ok: false, error: 'not_yours' };
  if (!LIVE_KINDS.includes(row.kind)) return { ok: false, error: 'not_served' };

  // A checklist update applies the room's own text, so it takes no edits.
  const editable = row.kind !== 'checklist_update';
  const finalTitle = editable && edits.title !== null && edits.title !== row.title ? edits.title : null;
  const finalBody = editable && edits.body !== null && edits.body !== row.body ? edits.body : null;
  const edited = finalTitle !== null || finalBody !== null;
  const at = now.toISOString();
  const kinds = LIVE_KINDS.map((kind) => `'${kind}'`).join(', ');
  const stale =
    'SELECT 1 FROM proposal_sources s LEFT JOIN documents d ON d.id = s.document_id AND d.removed_at IS NULL ' +
    `AND ${NOT_HIDDEN_SQL}${privilegeFilter(approver.role, 'd.path')} ` +
    'WHERE s.proposal_id = ?1 AND (d.id IS NULL OR d.updated_at <> s.document_updated_at)';

  const decision = crypto.randomUUID();
  let apply = row.kind === 'checklist_update' ? checklistApply(db, row.body, approver.email, at, id, decision) : undefined;
  if (row.visual_privileged !== null) {
    // A visual lands in the binder as the room prepared it (worker/proposal-visual.ts), written only if this decision takes effect.
    const page = room ? await prepareProposedVisual(db, approver.role, finalBody ?? row.body, id, room) : null;
    apply = page === null ? null : [visualApply(db, id, decision, page)];
  }
  if (apply === null) return { ok: false, error: 'not_served' };

  await db.batch([
    db
      .prepare(
        "UPDATE proposals SET status = 'approved', decided_by = ?2, decided_at = ?3, decision_id = ?6, final_title = ?4, final_body = ?5 " +
          `WHERE id = ?1 AND ${decidesWhere(approver)} AND status = 'pending' AND expires_at > ?3 AND kind IN (${kinds}) AND NOT EXISTS (${stale})`,
      )
      .bind(id, approver.email, at, finalTitle, finalBody, decision),
    eventStatement(db, { id, ts: at, action: edited ? 'approved_edited' : 'approved', actor: approver.email, detail: null, client }, decision),
    ...(apply ?? []),
  ]);

  if (await tookEffect(db, id, decision)) return { ok: true, status: 'approved', edited };
  const reason = await whyNot(db, approver, id, now);
  if (reason) return { ok: false, error: reason };
  await eventStatement(db, { id, ts: at, action: 'approve_refused', actor: approver.email, detail: 'sources_changed', client }).run();
  return { ok: false, error: 'sources_changed' };
}

/** Rejects a pending proposal (an expired one too, to clear it) as `approver`, with a reason code: one they decide only. */
export async function rejectProposal(db: D1Database, approver: Member, id: string, reason: RejectReason, now: Date, client: DecisionClient): Promise<DecideResult> {
  if (!canPerform(approver.role, 'approve')) return { ok: false, error: 'forbidden' };
  const row = await findVisible(db, approver, id);
  if (!row) return { ok: false, error: 'not_found' };
  if (!decides(approver, row)) return { ok: false, error: 'not_yours' };
  const at = now.toISOString();
  const decision = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        "UPDATE proposals SET status = 'rejected', decided_by = ?2, decided_at = ?3, decision_id = ?5, reject_reason = ?4 " +
          `WHERE id = ?1 AND ${decidesWhere(approver)} AND status = 'pending'`,
      )
      .bind(id, approver.email, at, reason, decision),
    eventStatement(db, { id, ts: at, action: 'rejected', actor: approver.email, detail: reason, client }, decision),
  ]);
  return (await tookEffect(db, id, decision)) ? { ok: true, status: 'rejected', edited: false } : { ok: false, error: 'not_pending' };
}

/** An approved draft as a Markdown file, with a provenance line, if `viewer` may see it; else null. Records the download. */
export async function approvedDraft(db: D1Database, viewer: Member, id: string, now: Date, client: DecisionClient): Promise<{ filename: string; text: string } | null> {
  const row = await findVisible(db, viewer, id);
  if (!row || row.status !== 'approved') return null;
  await eventStatement(db, { id, ts: now.toISOString(), action: 'downloaded', actor: viewer.email, detail: null, client }).run();
  return { filename: `draft-${id.slice(0, 8)}.md`, text: draftText(row) };
}
