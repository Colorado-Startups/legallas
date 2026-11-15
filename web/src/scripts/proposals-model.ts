// SPDX-License-Identifier: Apache-2.0
// The pure half of the Proposals page (src/scripts/proposals.ts): what each status, event and reject reason reads as,
// who and which AI a proposal came from, and which controls a person gets. No DOM, so node --test covers it. The words
// for a proposal's effect come from the server (worker/proposal-review.ts changesOf), never from the AI's text.
// Type imports only: the page's bundle must not pull in the Worker's modules (proposals-model.test.ts checks the
// reasons match the server's REJECT_REASONS).
import type { ProposalStatus, RejectReason } from '../../worker/proposals.ts';

/** What each status reads as. */
export const STATUS_LABELS = {
  pending: 'Waiting for a decision',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
} as const satisfies Record<ProposalStatus, string>;

/** What each reject reason reads as, in the order the form offers them. */
export const REASON_LABELS = {
  not_needed: 'Not needed',
  incorrect: 'Incorrect or incomplete',
  unsafe: 'Unsafe or out of scope',
  duplicate: 'A duplicate',
  other: 'Another reason',
} as const satisfies Record<RejectReason, string>;

/** The reject form's options: every reason the server accepts, in its order. */
export function reasonOptions(): [RejectReason, string][] {
  return Object.entries(REASON_LABELS) as [RejectReason, string][];
}

/** What each step in a proposal's history reads as; an action this page does not know reads as its code. */
const EVENT_LABELS: Readonly<Record<string, string>> = {
  proposed: 'Proposed',
  approved: 'Approved',
  approved_edited: 'Edited and approved',
  rejected: 'Rejected',
  approve_refused: 'Approval refused',
  withdrawn: 'Withdrawn',
  downloaded: 'Downloaded the draft',
};

/** Detail codes the history explains. */
const DETAIL_LABELS: Readonly<Record<string, string>> = {
  sources_changed: 'a cited document changed',
  draft_document: 'a new draft document',
  filled_template: 'a filled template',
  checklist_update: 'a checklist update',
  prepared_message: 'a prepared message',
  prepared_filing: 'a prepared filing',
  visual: 'a visual for the binder',
  ...REASON_LABELS,
};

/** The words for an audit event: its action label, then its detail label when it has one. */
export function eventLabel(action: string, detail: string | null): string {
  const label = Object.hasOwn(EVENT_LABELS, action) ? EVENT_LABELS[action]! : action;
  if (!detail) return label;
  return `${label}: ${Object.hasOwn(DETAIL_LABELS, detail) ? DETAIL_LABELS[detail] : detail}`;
}

/** "ada@firm.example through Claude", or the email alone when the AI app is unnamed. */
export function proposedBy(email: string, via: string | null): string {
  return via ? `${email} through ${via}` : email;
}

/** The controls a person gets for one proposal: decide only while pending and only with `approve`; download once approved. */
export function controlsFor(status: ProposalStatus, canApprove: boolean): { approve: boolean; reject: boolean; download: boolean } {
  return {
    approve: canApprove && status === 'pending',
    reject: canApprove && (status === 'pending' || status === 'expired'),
    download: status === 'approved',
  };
}

/** The room link for one cited document and page. */
export function sourceHref(documentId: string, page: number | null): string {
  const base = `/doc/?id=${encodeURIComponent(documentId)}`;
  return page ? `${base}#page=${page}` : base;
}

/** What a failed decision says, from the server's error code. */
export function decisionError(code: string): string {
  switch (code) {
    case 'sources_changed':
      return 'A document this draft relies on has changed or is gone, so it cannot be approved. Reject it, and ask for a new draft.';
    case 'expired':
      return 'This proposal waited more than 30 days and can no longer be approved. Reject it to clear it.';
    case 'not_pending':
      return 'Someone already decided this proposal. Reload to see the decision.';
    case 'forbidden':
      return 'Your role in the room cannot decide proposals.';
    case 'not_yours':
      return 'Only the member whose AI made this proposal can decide it.';
    case 'invalid_request':
      return 'The edited title and text must each hold some text, within their limits.';
    default:
      return 'The decision did not go through. Try again.';
  }
}
