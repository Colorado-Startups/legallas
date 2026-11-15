// SPDX-License-Identifier: Apache-2.0
// The 403, 404 and error pages: one heading, one sentence saying what happened and what to do, and the code.
import { CONNECT_PATH } from '../contract.ts';
import { escapeHtml, frame } from './html.ts';
import type { MessageView } from './index.ts';

/** The "If something goes wrong" section of the public setup page (pages/connect.ts). */
export const HELP_PATH = `${CONNECT_PATH}#help`;

/** A short message page. Title, message and links may carry client or config values, so all are escaped. */
export function renderMessagePage(view: MessageView): string {
  const status = Number.isInteger(view.status) ? view.status : 500;
  const links = (view.links ?? []).map((link) => `<p><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></p>\n`).join('');
  const body = `<h1>${escapeHtml(view.title)}</h1>
<p class="lead">${escapeHtml(view.message)}</p>
${links}<p class="code">Error ${status}</p>`;
  return frame({ title: view.title, body, nav: [{ href: HELP_PATH, label: 'Setup help' }, { href: '/connections', label: 'Your AI connections' }] });
}
