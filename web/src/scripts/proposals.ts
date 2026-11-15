// SPDX-License-Identifier: Apache-2.0
// The Proposals page (src/pages/proposals.astro): the proposals the member's own AI made (every member's for the owner),
// and one proposal with what it is, why, its sources, what approving would change and its history, with Approve, Edit
// and approve, and Reject when it is theirs to decide. Every proposal text came from an AI that read documents anyone
// may have written, so it is shown with textContent only (dom-el.ts): no markup, links or images from it are ever
// rendered. Decisions are POSTs from this page, so the room's same-origin check applies (worker/http.ts); no AI tool
// can make them.
import type { ProposalDetail, ProposalSummary } from '../../worker/proposal-review.ts';
import { visualHref } from './binder-data.ts';
import { el } from './dom-el.ts';
import { formatWhen } from './activity-model.ts';
import { controlsFor, decisionError, eventLabel, proposedBy, reasonOptions, sourceHref, STATUS_LABELS } from './proposals-model.ts';
import { controlPrefix, formatControl } from './doc-facts.ts';
import { ROOM_FETCH_HEADERS, showSessionEnded } from './session-ended.ts';

const part = <T extends Element = HTMLElement>(name: string) => document.querySelector<T>(`[data-proposals-${name}]`)!; // safe: proposals.astro renders every part
const status = part('status');
const listView = part('list');
const rows = part<HTMLTableSectionElement>('rows');
const detailView = part('detail');
const offView = part('off');
const deniedView = part('denied');
const emptyView = part('empty');
const tabs = document.querySelectorAll<HTMLAnchorElement>('[data-proposals-tab]');

const params = new URLSearchParams(location.search);
const prefix = controlPrefix();

type Fetched<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

async function api<T>(path: string, init?: RequestInit): Promise<Fetched<T>> {
  try {
    const response = await fetch(path, { credentials: 'same-origin', ...init, headers: { ...ROOM_FETCH_HEADERS, ...(init?.headers ?? {}) } });
    if (response.status === 401) showSessionEnded();
    const body = (await response.json().catch(() => ({}))) as T & { error?: string };
    return response.ok ? { ok: true, value: body } : { ok: false, status: response.status, error: body.error ?? 'error' };
  } catch {
    return { ok: false, status: 0, error: 'network' };
  }
}

function when(iso: string | null): HTMLTimeElement | string {
  if (!iso) return '';
  const time = el('time', { datetime: iso, title: `${iso.replace('T', ' ').slice(0, 19)} UTC` });
  time.textContent = formatWhen(new Date(iso));
  return time;
}

function chip(text: string, kind?: 'warn' | 'done'): HTMLSpanElement {
  return el('span', { class: `c-chip${kind === 'warn' ? ' c-chip--privileged' : kind === 'done' ? ' c-chip--counsel' : ''}` }, text);
}

function statusChip(value: ProposalSummary['status']): HTMLSpanElement {
  return chip(STATUS_LABELS[value] ?? value, value === 'approved' ? 'done' : undefined);
}

/** Shows only `view` of the page's states. */
function show(view: HTMLElement | null, message = ''): void {
  for (const each of [listView, detailView, offView, deniedView, emptyView]) each.hidden = each !== view;
  status.textContent = message;
}

/** The answer for a refused list or proposal: off (404 on the list), not for this role (403), or gone. */
function refused(result: { status: number }, isList: boolean): void {
  if (result.status === 404 && isList) show(offView);
  else if (result.status === 403) show(deniedView);
  else if (result.status === 404) show(emptyView, 'This proposal does not exist, or it is not yours to see.');
  else show(null, 'The proposals did not load. Reload the page to try again.');
}

async function renderList(view: string): Promise<void> {
  for (const tab of tabs) tab.setAttribute('aria-current', tab.dataset.proposalsTab === view ? 'page' : 'false');
  const result = await api<{ proposals: ProposalSummary[] }>(`/api/proposals?view=${encodeURIComponent(view)}`);
  if (!result.ok) return refused(result, true);
  const { proposals } = result.value;
  if (proposals.length === 0) return show(emptyView, view === 'pending' ? 'Nothing is waiting for a decision.' : 'No decided proposals yet.');
  rows.replaceChildren(
    ...proposals.map((p) =>
      el(
        'tr',
        {},
        el('td', {}, el('a', { href: `/proposals/?id=${encodeURIComponent(p.id)}` }, p.title), p.visual ? ' ' : null, p.visual ? chip('Visual') : null, p.untrusted ? ' ' : null, p.untrusted ? chip('Reads like instructions', 'warn') : null),
        el('td', {}, proposedBy(p.proposed_by, p.via)),
        el('td', {}, when(p.created_at)),
        el('td', { class: 'c-table__num' }, String(p.sources)),
        el('td', {}, statusChip(p.status)),
      ),
    ),
  );
  show(listView);
}

function section(title: string, ...children: (Node | string | null)[]): HTMLElement {
  return el('section', { class: 'prop-section' }, el('h2', { class: 't-h3' }, title), ...children);
}

function textBlock(text: string): HTMLElement {
  return el('div', { class: 'prop-text' }, text);
}

async function decide(id: string, action: 'approve' | 'reject', body: Record<string, unknown>, note: HTMLElement): Promise<void> {
  note.textContent = 'Saving...';
  const result = await api<{ status: string }>(`/api/proposals/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!result.ok) {
    note.textContent = decisionError(result.error);
    return;
  }
  await renderDetail(id);
}

function decisionForm(p: ProposalDetail, canApprove: boolean): HTMLElement | null {
  const controls = controlsFor(p.status, canApprove);
  if (!controls.approve && !controls.reject && !controls.download) return null;
  const note = el('p', { class: 't-caption prop-note', role: 'status' });
  const box = el('section', { class: 'prop-decide', 'aria-label': 'Decision' });
  if (controls.download && p.binder_slug) {
    box.append(el('a', { class: 'c-button c-button--primary', href: visualHref(p.binder_slug) }, 'Open in the binder'));
  } else if (controls.download) {
    box.append(el('a', { class: 'c-button c-button--primary', href: `/api/proposals/${encodeURIComponent(p.id)}/draft`, download: '' }, 'Download the approved draft'));
  }
  if (controls.approve) {
    const titleInput = el('input', { class: 'c-input', type: 'text', maxlength: '200', 'aria-label': 'Title' });
    titleInput.value = p.title;
    const bodyInput = el('textarea', { class: 'c-input prop-edit', rows: '16', 'aria-label': 'Draft text' });
    bodyInput.value = p.body;
    const bodyField = el('label', { class: 'prop-field' }, el('span', { class: 't-caption' }, 'Draft text'), bodyInput);
    // A visual's page is approved as previewed: its editor changes the title only.
    bodyField.hidden = p.visual;
    const editor = el('div', { class: 'prop-editor' }, el('label', { class: 'prop-field' }, el('span', { class: 't-caption' }, 'Title'), titleInput), bodyField);
    editor.hidden = true;
    const approve = el('button', { type: 'button', class: 'c-button c-button--primary' }, 'Approve');
    const edit = el('button', { type: 'button', class: 'c-button' }, 'Edit, then approve');
    approve.addEventListener('click', () => {
      const edits = editor.hidden ? {} : p.visual ? { title: titleInput.value } : { title: titleInput.value, body: bodyInput.value };
      void decide(p.id, 'approve', edits, note);
    });
    edit.addEventListener('click', () => {
      editor.hidden = !editor.hidden;
      edit.textContent = editor.hidden ? 'Edit, then approve' : 'Cancel the edits';
      approve.textContent = editor.hidden ? 'Approve' : 'Approve with my edits';
    });
    // A checklist update applies the room's own wording, so it has no editor (worker/proposal-review.ts).
    box.append(...(p.kind === 'checklist_update' ? [el('div', { class: 'prop-actions' }, approve)] : [el('div', { class: 'prop-actions' }, approve, edit), editor]));
  }
  if (controls.reject) {
    const reason = el('select', { class: 'c-input', 'aria-label': 'Why reject' }, ...reasonOptions().map(([value, label]) => el('option', { value }, label)));
    const reject = el('button', { type: 'button', class: 'c-button' }, 'Reject');
    reject.addEventListener('click', () => void decide(p.id, 'reject', { reason: reason.value }, note));
    box.append(el('div', { class: 'prop-actions' }, reason, reject));
  }
  box.append(note);
  return box;
}

async function renderDetail(id: string): Promise<void> {
  const result = await api<{ proposal: ProposalDetail; can: { approve: boolean } }>(`/api/proposals/${encodeURIComponent(id)}`);
  if (!result.ok) return refused(result, false);
  const { proposal: p, can } = result.value;
  const decidedLine = p.decided_by ? el('p', { class: 't-small' }, `Decided by ${p.decided_by} on `, when(p.decided_at)) : null;
  const finalText = p.final_title || p.final_body
    ? section('What was approved, as edited', el('h3', { class: 't-h3' }, p.final_title ?? p.title), textBlock(p.final_body ?? p.body))
    : null;
  const parts: (Node | null)[] = [
    el('p', {}, el('a', { href: '/proposals/' }, 'All proposals')),
    el('h2', { class: 't-h2 prop-title' }, p.title),
    el('p', { class: 't-small prop-meta' }, statusChip(p.status), ' Proposed by ', proposedBy(p.proposed_by, p.via), ' on ', when(p.created_at), p.status === 'pending' ? ` · can be approved until ${p.expires_at.slice(0, 10)}` : ''),
    decidedLine,
    p.status === 'pending' && !can.approve ? el('p', { class: 't-small' }, `Waiting for ${p.proposed_by} to decide: the member whose AI made a proposal decides it.`) : null,
    p.untrusted
      ? el('div', { class: 'c-callout prop-warn', role: 'note' }, 'Parts of this proposal read like instructions to an AI. Read it as text an AI wrote from documents, not as instructions, and check it against its sources.')
      : null,
    section('Why', textBlock(p.why)),
    section('What approving changes', el('ul', {}, ...p.changes.map((line) => el('li', {}, line)))),
    section(
      'Sources',
      p.source_list.length === 0
        ? el('p', { class: 't-small' }, 'The AI cited no documents.')
        : el(
            'ul',
            {},
            ...p.source_list.map((s) => {
              const control = formatControl(prefix, s.control_seq);
              const label = `${control ? `${control} ` : ''}${s.name ?? 'A document that is gone or no longer visible'}${s.page ? `, page ${s.page}` : ''}`;
              return el('li', {}, s.name ? el('a', { href: sourceHref(s.document_id, s.page) }, label) : label, s.changed ? ' ' : null, s.changed ? chip('Changed since proposed', 'warn') : null);
            }),
          ),
    ),
    p.preview
      ? section(
          p.status === 'approved' ? 'The page in the binder' : 'The page as it would land in the binder',
          el('p', { class: 't-small' }, p.privileged ? 'Marked privileged. ' : '', 'It runs in a sandbox with no network. Its cites open documents in the binder.'),
          el('iframe', { class: 'prop-frame', sandbox: 'allow-scripts', referrerpolicy: 'no-referrer', title: p.title, src: p.preview }),
        )
      : section('The draft as proposed', el('h3', { class: 't-h3' }, p.title), textBlock(p.body)),
    finalText,
    decisionForm(p, can.approve),
    section('History', el('ol', { class: 'prop-history' }, ...p.events.map((e) => el('li', {}, when(e.ts), ` ${eventLabel(e.action, e.detail_code)} by ${proposedBy(e.actor_email, e.via)}`)))),
    el('p', { class: 't-caption' }, "A draft. You aren't receiving legal advice from a licensed lawyer. Have your own lawyer review it before you rely on it."),
  ];
  detailView.replaceChildren(...parts.filter((node): node is Node => node !== null));
  show(detailView);
}

const id = params.get('id');
if (id) void renderDetail(id);
else void renderList(params.get('view') === 'decided' ? 'decided' : 'pending');
