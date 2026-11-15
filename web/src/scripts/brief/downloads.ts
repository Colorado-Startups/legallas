// SPDX-License-Identifier: Apache-2.0
// The complaint brief, the drafts: each draft counsel can take away (the complaint, a demand letter, a memo) as a
// row with its control number, Download (the file itself) and Open (the exhibit pane). Every role sees them; the
// worker serves only drafts whose documents are live, so an empty list hides the section.
import { downloadUrl } from '../files-api.ts';
import { controlPrefix, formatControl, type RoomDraftLink } from '../matter-api.ts';
import { citeHref, el } from '../track-dom.ts';

/** Draws the drafts into `parent`. */
export function renderDrafts(parent: Element, drafts: readonly RoomDraftLink[]): void {
  const list = el('ul', { class: 'brief-drafts' }, parent);
  for (const draft of drafts) {
    const item = el('li', { class: 'brief-drafts__row' }, list);
    const name = el('p', { class: 'brief-drafts__name' }, item);
    el('span', { class: 'brief-drafts__label' }, name, draft.label);
    const control = formatControl(controlPrefix(), draft.control);
    if (control) el('span', { class: 'brief-drafts__control t-mono' }, name, control);
    const actions = el('p', { class: 'brief-drafts__actions' }, item);
    el('a', { class: 'c-button c-button--primary', href: downloadUrl(draft.doc), download: '', 'aria-label': `Download ${draft.label}` }, actions, 'Download');
    el('a', { class: 'c-button', href: citeHref({ doc: draft.doc, page: null }), 'data-exhibit': '', 'aria-label': `Open ${draft.label}` }, actions, 'Open');
  }
}
