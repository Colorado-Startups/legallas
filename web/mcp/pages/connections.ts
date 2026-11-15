// SPDX-License-Identifier: Apache-2.0
// /connections: a member's AI connections, or everyone's for the owner. Every Disconnect form carries the
// double-submit token under forms.ts FORM_FIELD and the grant id under GRANT_FIELD.
import { CONNECT_PATH } from '../contract.ts';
import { FORM_FIELD, GRANT_FIELD } from '../forms.ts';
import { escapeHtml, frame, hidden, timeCell } from './html.ts';
import type { ConnectionsView } from './index.ts';

type Connection = ConnectionsView['rows'][number];

function revokeForm(row: Connection, token: string): string {
  return `<form method="post" action="/connections">${hidden(FORM_FIELD, token)}${hidden(GRANT_FIELD, row.grantId)}` +
    `<button class="btn btn--small" type="submit">Disconnect<span class="u-vh"> ${escapeHtml(row.clientName)} for ${escapeHtml(row.email)}</span></button></form>`;
}

/**
 * Under the list. A Disconnect posted after the sign-in session behind this page has ended is lost: Access signs
 * the browser in again and returns it here as a GET, so the list looks unchanged and nothing says so.
 */
export const DISCONNECT_CHECK = 'When it works, the page says Disconnected. If the app is still listed, choose Disconnect again.';

function connectionsTable(view: ConnectionsView): string {
  const member = view.isOwner ? '<th scope="col">Member</th>' : '';
  const rows = view.rows
    .map((row) => `<tr><td>${escapeHtml(row.clientName)}</td>${view.isOwner ? `<td data-label="Member">${escapeHtml(row.email)}</td>` : ''}` +
      `<td data-label="Connected">${timeCell(row.createdAt, 'Unknown')}</td><td data-label="Ends">${timeCell(row.expiresAt, 'Not set')}</td>` +
      `<td class="cell-end">${revokeForm(row, view.formToken)}</td></tr>`)
    .join('');
  return `<div class="table-wrap"><table><caption class="u-vh">AI connections</caption><thead><tr><th scope="col">App</th>${member}` +
    `<th scope="col">Connected</th><th scope="col">Ends</th><th scope="col"><span class="u-vh">Action</span></th></tr></thead><tbody>${rows}</tbody></table></div>` +
    `\n<p>${DISCONNECT_CHECK}</p>`;
}

/** The member's connections (the owner sees every member's), each with a Disconnect button. */
export function renderConnectionsPage(view: ConnectionsView): string {
  const title = view.isOwner ? 'AI connections' : 'Your AI connections';
  const lead = view.isOwner
    ? "Every member's connected AI apps. Disconnecting one ends its access at once."
    : 'AI apps you connected to the counsel room. Disconnecting one ends its access at once.';
  const notice = view.notice ? `<p class="notice" role="status">${escapeHtml(view.notice)}</p>` : '';
  const list = view.rows.length > 0 ? connectionsTable(view) : `<p class="empty">No AI apps are connected. <a href="${CONNECT_PATH}">How to connect your AI</a>.</p>`;
  const nav = view.isOwner ? [{ href: '/admin/clients', label: 'Registered clients' }] : [];
  return frame({ title, who: view.memberEmail, nav, body: `<h1>${title}</h1>\n<p class="lead">${lead}</p>\n${notice}\n${list}` });
}
