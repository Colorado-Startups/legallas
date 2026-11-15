// SPDX-License-Identifier: Apache-2.0
// /admin/clients: the owner's OAuth clients. A toggle switches between clients created here and every client,
// Load more follows the cursor, and a just-created client's secret shows once. Sign-in callbacks a registration
// was refused for wait below the list with Allow and Dismiss, and allowed ones with Remove; a note at the top
// says when any are waiting. All clients also has Delete old smoke clients, with a note of what it deleted.
// Forms carry FORM_FIELD. No scripts: the page CSP has no script-src.
import { FIELDS, SMOKE_CLIENT_NAME } from '../contract.ts';
import { FORM_FIELD } from '../forms.ts';
import type { StoredRedirect } from '../redirects.ts';
import { MAX_SMOKE_DELETES_PER_RUN } from '../smoke-clients.ts';
import { escapeHtml, frame, hidden, timeCell } from './html.ts';
import type { AdminClientsView } from './index.ts';

type Client = AdminClientsView['clients'][number];

/** The sign-in callbacks /admin/clients shows; both sections are left out when the view has neither list. */
export interface RedirectsView {
  refused?: StoredRedirect[];
  allowed?: StoredRedirect[];
  /** Waiting callbacks the room's zero-retention policy refuses whatever the owner does (mcp/admin-clients.ts), so no Allow. */
  neverAllowed?: string[];
}

/** What a Delete old smoke clients post just did, carried in the query of the page it redirects to. */
export interface SmokeSweepView {
  swept?: { deleted: number; more: boolean };
}

function deleteForm(client: Client, token: string): string {
  return `<form method="post" action="/admin/clients">${hidden(FORM_FIELD, token)}${hidden(FIELDS.action, 'delete')}${hidden(FIELDS.clientId, client.clientId)}` +
    `<button class="btn btn--small" type="submit">Delete<span class="u-vh"> ${escapeHtml(client.clientName)}</span></button></form>`;
}

function clientsTable(view: AdminClientsView): string {
  if (view.clients.length === 0) return `<p class="empty">${view.list === 'all' ? 'No clients are registered.' : 'No clients have been created here.'}</p>`;
  const rows = view.clients
    .map((c) => `<tr><td>${escapeHtml(c.clientName)}</td><td data-label="Client ID"><span class="u-mono">${escapeHtml(c.clientId)}</span></td>` +
      `<td class="cell-wrap" data-label="Redirect URIs"><div>${c.redirectUris.map((u) => `<span class="u-mono">${escapeHtml(u)}</span>`).join('<br>')}</div></td>` +
      `<td data-label="Created">${timeCell(c.registrationDate, 'Unknown')}</td><td class="cell-end">${deleteForm(c, view.formToken)}</td></tr>`)
    .join('');
  return `<div class="table-wrap"><table><caption class="u-vh">Registered clients</caption><thead><tr><th scope="col">Name</th><th scope="col">Client ID</th>` +
    `<th scope="col">Redirect URIs</th><th scope="col">Created</th><th scope="col"><span class="u-vh">Action</span></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function secretPanel(created: NonNullable<AdminClientsView['created']>): string {
  return `<section class="secret" role="status" aria-labelledby="secret-title"><h2 id="secret-title">Copy the secret for ${escapeHtml(created.clientName)} now</h2>
<p>It is not shown again. Paste both values into the app's connector settings.</p>
<p class="label">Client ID</p><code>${escapeHtml(created.clientId)}</code>
<p class="label">Client secret</p><code>${escapeHtml(created.clientSecret)}</code></section>`;
}

const CREATE_FORM = (token: string) => `<h2>Add a client</h2>
<p class="prose">For example, Microsoft's federated connector.</p>
<form method="post" action="/admin/clients">${hidden(FORM_FIELD, token)}${hidden(FIELDS.action, 'create')}
<div class="field"><label for="client-name">Name</label><input class="input" id="client-name" name="${FIELDS.clientName}" required maxlength="80" autocomplete="off"></div>
<div class="field"><label for="redirect-uris">Redirect URIs</label><textarea class="input" id="redirect-uris" name="${FIELDS.redirectUris}" rows="3" required autocomplete="off" spellcheck="false" aria-describedby="redirect-hint"></textarea>
<small id="redirect-hint">One per line. Each must be a Harvey, Microsoft or Claude address on the allow list.</small></div>
<div class="actions"><button class="btn btn--primary" type="submit">Create client</button></div></form>`;

const LISTS = [
  { list: 'static', label: 'Created here', lead: 'OAuth clients created by hand for apps that cannot register themselves.' },
  { list: 'all', label: 'All clients', lead: 'Every OAuth client, including apps that registered themselves.' },
] as const;

function listHref(list: AdminClientsView['list'], cursor?: string): string {
  const query = new URLSearchParams({ [FIELDS.list]: list });
  if (cursor) query.set(FIELDS.cursor, cursor);
  return `/admin/clients?${query.toString()}`;
}

/** The Created here / All clients toggle; the current list is aria-current. */
function listToggle(current: AdminClientsView['list']): string {
  const links = LISTS.map((l) => `<a href="${escapeHtml(listHref(l.list))}"${l.list === current ? ' aria-current="page"' : ''}>${l.label}</a>`);
  return `<nav class="toggle" aria-label="Which clients">${links.join('')}</nav>`;
}

function callbackForm(token: string, action: string, uri: string, label: string, primary = false): string {
  return `<form method="post" action="/admin/clients">${hidden(FORM_FIELD, token)}${hidden(FIELDS.action, action)}${hidden(FIELDS.redirectUris, uri)}` +
    `<button class="btn btn--small${primary ? ' btn--primary' : ''}" type="submit">${label}<span class="u-vh"> ${escapeHtml(uri)}</span></button></form>`;
}

function callbackTable(caption: string, when: string, rows: StoredRedirect[], buttons: (uri: string) => string): string {
  const body = rows
    .map((r) => `<tr><td class="cell-wrap" data-label="Callback"><span class="u-mono">${escapeHtml(r.uri)}</span></td>` +
      `<td data-label="${when}">${timeCell(r.at, 'Unknown')}</td><td class="cell-end"><div class="actions">${buttons(r.uri)}</div></td></tr>`)
    .join('');
  return `<div class="table-wrap"><table><caption class="u-vh">${caption}</caption><thead><tr><th scope="col">Callback</th><th scope="col">${when}</th>` +
    `<th scope="col"><span class="u-vh">Actions</span></th></tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Waiting callbacks (Allow, Dismiss) and allowed ones (Remove), or nothing when the view carries neither. */
function callbackSections(view: AdminClientsView & RedirectsView): string {
  if (!view.refused && !view.allowed) return '';
  const token = view.formToken;
  const refused = view.refused ?? [];
  const allowed = view.allowed ?? [];
  const blocked = new Set(view.neverAllowed ?? []);
  const waiting = refused.length === 0
    ? '<p class="empty">No sign-in callbacks are waiting.</p>'
    : callbackTable('Sign-in callbacks waiting for approval', 'Refused', refused, (uri) =>
      (blocked.has(uri) ? '<span class="u-quiet">Can\'t be allowed: this room is zero retention only</span>' : callbackForm(token, 'allow_callback', uri, 'Allow', true)) +
      callbackForm(token, 'dismiss_callback', uri, 'Dismiss'));
  const kept = allowed.length === 0
    ? '<p class="empty">No callbacks have been allowed here.</p>'
    : callbackTable('Allowed callbacks', 'Allowed', allowed, (uri) => callbackForm(token, 'remove_callback', uri, 'Remove'));
  return `<h2 id="callbacks">Sign-in callbacks waiting for approval</h2>
<p class="prose">An AI app tried to connect and named a sign-in callback (the address it returns people to after they sign in) that is not on the list. Allow it only if you expect that app, for example Harvey. Then ask the firm to connect again. Each one is kept for 14 days.</p>
${waiting}
<h2>Allowed callbacks</h2>
<p class="prose">Callbacks you allowed here. Remove one and new sign-ins through it stop.</p>
${kept}`;
}

/** All clients only: the one button that clears the production smoke's old registrations, and what it did last. */
function smokeSweep(view: AdminClientsView & SmokeSweepView): string {
  if (view.list !== 'all') return '';
  const swept = view.swept;
  const what = !swept ? '' : swept.deleted === 0 ? 'No old smoke clients were deleted.' : swept.deleted === 1 ? 'Deleted 1 old smoke client.' : `Deleted ${swept.deleted} old smoke clients.`;
  const note = !swept ? '' : `<p class="notice" role="status">${what}${swept.more ? ' More may remain: choose Delete old smoke clients again.' : ''}</p>`;
  return `${note}<form method="post" action="/admin/clients">${hidden(FORM_FIELD, view.formToken)}${hidden(FIELDS.action, 'sweep_smoke')}
<p class="prose">The production smoke check registers clients named <span class="u-mono">${escapeHtml(SMOKE_CLIENT_NAME)}</span> on every run, and a daily sweep deletes them a day later. This deletes those that are more than a day old and have no connection now, up to ${MAX_SMOKE_DELETES_PER_RUN} at a time. Clients created here are never deleted.</p>
<div class="actions"><button class="btn btn--small" type="submit">Delete old smoke clients</button></div></form>`;
}

/** The note at the top when callbacks are waiting, linking down to them. */
function waitingNote(view: RedirectsView): string {
  const count = view.refused?.length ?? 0;
  if (count === 0) return '';
  const what = count === 1 ? '1 sign-in callback is' : `${count} sign-in callbacks are`;
  return `<p class="notice" role="status">${what} waiting for approval. <a href="#callbacks">Review</a></p>`;
}

/**
 * The owner's registered clients: the one-time secret panel, the list toggle, Delete old smoke clients (All clients
 * only), the list with Delete and Load more, the sign-in callbacks (when the view carries them), and the create form.
 */
export function renderAdminClientsPage(view: AdminClientsView & RedirectsView & SmokeSweepView): string {
  const created = view.created ? secretPanel(view.created) : '';
  const lead = LISTS.find((l) => l.list === view.list)?.lead ?? LISTS[0].lead;
  const more = view.nextCursor ? `<p class="more"><a class="btn" href="${escapeHtml(listHref(view.list, view.nextCursor))}">Load more</a></p>` : '';
  const body = `<h1>Registered clients</h1>
<p class="lead">${lead}</p>
${created}
${waitingNote(view)}
${listToggle(view.list)}
${smokeSweep(view)}
${clientsTable(view)}
${more}
${callbackSections(view)}
${CREATE_FORM(view.formToken)}`;
  return frame({ title: 'Registered clients', body, nav: [{ href: '/connections', label: 'AI connections' }] });
}
