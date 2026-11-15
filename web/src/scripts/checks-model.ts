// SPDX-License-Identifier: Apache-2.0
// Pure helpers for the public-records approval page (checks.ts): the request id from the URL and the sentences the
// page shows. No DOM, so node tests import it.

/** GET /api/checks/:id as worker/routes/checks.ts checkView returns it. */
export interface CheckView {
  id: string;
  name: string;
  kind: 'person' | 'company';
  state: 'pending' | 'approved' | 'declined';
  via: string;
  createdAt: string;
  decidedAt: string | null;
  expiresAt: string;
  approvedMinutes: number;
  sendsTo: { source: string; operator: string; host: string }[];
  byHand: { source: string; link: string }[];
}

const ID = /^[A-Za-z0-9_-]{16,64}$/;

/** The request id from the page's query string, or null for a missing or malformed one. */
export function checkIdFrom(search: string): string | null {
  const id = new URLSearchParams(search).get('id');
  return id && ID.test(id) ? id : null;
}

/** The words for a check's subject: a person or a company. */
export function kindWords(kind: CheckView['kind']): string {
  return kind === 'person' ? 'a person' : 'a company';
}

/** Minutes from `now` until `iso`, at least 0. */
function minutesUntil(iso: string, now: Date): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - now.getTime()) / 60_000));
}

/** The line under the buttons: what state the request is in and what happens next. */
export function stateSentence(view: CheckView, now: Date): string {
  const left = minutesUntil(view.expiresAt, now);
  if (view.state === 'approved') return `Approved. Ask your AI to run the check now; the approval lasts ${left} more minute${left === 1 ? '' : 's'}.`;
  if (view.state === 'declined') return 'Declined. The name was not sent anywhere.';
  return `Waiting for your decision. This request lapses in ${left} minute${left === 1 ? '' : 's'}; an approval lasts ${view.approvedMinutes} minutes.`;
}
