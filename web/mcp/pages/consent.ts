// SPDX-License-Identifier: Apache-2.0
// The consent page on /authorize: a member approves or denies one AI app's read-only connection, and, while the room's
// proposals are on, chooses whether it may also propose drafts.
// The redirect host is always shown, because it is where the access code goes.
import { CONNECT_PATH, DECISIONS, FIELDS, REFRESH_TOKEN_TTL_SECONDS, type ClientKind } from '../contract.ts';
import { escapeHtml, frame, hidden } from './html.ts';
import type { ConsentView } from './index.ts';

const DAYS = Math.round(REFRESH_TOKEN_TTL_SECONDS / 86_400);
/** The public "Connect your AI" page on this server (pages/connect.ts). */
export const HELP_URL = CONNECT_PATH;

/** 16px line icons (1.5px stroke, currentColor), one per fact so the list is not color or bullet alone. */
const ICON = {
  search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/>',
  lock: '<rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
  clock: '<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/>',
  send: '<path d="M2 8h10M8.5 4.5 12 8l-3.5 3.5"/><path d="M14 2.5v11"/>',
  eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/>',
  caution: '<path d="M8 1.75 14.75 13.5H1.25Z"/><path d="M8 6v3.5"/><path d="M8 11.5v.25"/>',
};

function icon(paths: string): string {
  return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

/**
 * What the app may read and where it goes (the owner, 2026-10-20). Only Claude is sent files: small originals
 * (mcp/tools/files.ts) and images of the visuals (mcp/tools/visuals.ts). Every other app, unknown ones included,
 * gets text, so its page promises text only.
 */
function facts(app: string, kind: ClientKind, proposes = false): string {
  const files = kind === 'claude';
  const items: [string, string][] = [
    files
      ? [ICON.search, `${app} can search the room and read document pages and details, the case overview, the visuals and the comment threads, as you see them. It can also receive small original files and images of the visuals.`]
      : [ICON.search, `${app} can search the room and read document pages and details, the case overview, the visuals and the comment threads, all as text and as you see them.`],
    proposes
      ? [ICON.lock, 'It is read-only unless you tick the box below. A proposal changes nothing until you approve it in the room.']
      : [ICON.lock, 'It is read-only. It cannot change anything in the room.'],
    [ICON.clock, `Access lasts ${DAYS} days, then you sign in again with an email code. You can end it sooner on Your AI connections.`],
    files
      ? [ICON.send, `What ${app} reads, text and those files and images, goes to its AI provider, under your firm's agreement with that provider.`]
      : [ICON.send, `Text ${app} reads goes to its AI provider, under your firm's agreement with that provider.`],
    files
      ? [ICON.eye, 'The room owner sees this connection and each search and read it makes, including every original file or visual image it receives.']
      : [ICON.eye, 'The room owner sees this connection and each search and read it makes.'],
  ];
  return `<ul class="facts">${items.map(([i, text]) => `<li>${icon(i)}<span>${text}</span></li>`).join('')}</ul>`;
}

function destination(view: ConsentView, app: string): string {
  const domain = view.clientDomain
    ? `<div class="dest__row"><p class="label">Published by</p><p class="dest__value">${escapeHtml(view.clientDomain)}</p>` +
      `<p class="verified">${icon('<path d="m3.5 8.5 3 3 6-7"/>')}Verified domain</p></div>`
    : '';
  const loopback = view.redirectIsLoopback
    ? `<div class="warn" role="note">${icon(ICON.caution)}<p><strong>This app receives access on this computer.</strong>` +
      'Any program on this computer could receive access. Connect only if you started this from an app you trust.</p></div>'
    : '';
  return `<section class="dest" aria-labelledby="dest-title"><h2 id="dest-title" class="u-vh">Where access goes</h2>
<div class="dest__row"><p class="label">App</p><p class="dest__name">${app}</p></div>
${domain}
<div class="dest__row"><p class="label">Access goes to</p><p class="dest__value">${escapeHtml(view.redirectHost)}</p>
<p class="dest__note">After you choose, your browser returns to this address.</p>${loopback}</div>
</section>`;
}

/**
 * Shown next to the Connect button: the Claude and Microsoft callbacks are shared by every user of those products, so a
 * stranger could add this server to their own account and send a member the consent link (OAuth review).
 */
const CAUTION = `<div class="warn" role="note">${icon(ICON.caution)}<p>Only connect if you started this just now from your own Harvey, Copilot or Claude account. If someone sent you this link, choose Cancel.</p></div>`;

/**
 * The choice to let the app propose drafts or public-records checks too (docs/design/propose-and-approve.md,
 * docs/design/public-records-sources.md), unticked: a connection stays read-only unless its member opts in here. Offered
 * only while the room's proposals or checks are on, so with both off the page is exactly what it was. The words name
 * what the room has on.
 */
function proposeChoice(app: string, kinds: { drafts: boolean; records: boolean } = { drafts: true, records: false }): string {
  const what = kinds.drafts && kinds.records
    ? 'new drafts and public-records checks'
    : kinds.records
      ? 'public-records checks (a check sends a name to public sites only after you approve it)'
      : 'new drafts';
  // Styled inline (the pages' CSP allows inline styles), so the shared sheet, and every page with it, stays as it was.
  return `<label style="display:flex;gap:0.5rem;align-items:flex-start;flex-basis:100%"><input type="checkbox" name="${FIELDS.propose}" value="1"> <span>Also let ${app} propose ${what} for you ` +
    'to approve in the room. A proposal changes nothing until you approve it there, and the app cannot approve it.</span></label>\n';
}

/** "Connect <app> to the counsel room": who, where the access goes, what it can do, Connect or Cancel. */
export function renderConsentPage(view: ConsentView): string {
  const app = escapeHtml(view.clientName);
  const body = `<h1>Connect ${app} to the counsel room</h1>
<p class="lead">${app} is asking for read-only access to the counsel room.</p>
<p class="signed">You are signed in as <strong>${escapeHtml(view.memberEmail)}</strong>.</p>
${destination(view, app)}
<h2>What it can do</h2>
${facts(app, view.clientKind, view.offerPropose === true)}
${CAUTION}
<form method="post" action="/authorize" class="actions">
${hidden(FIELDS.handle, view.handle)}
${view.offerPropose ? proposeChoice(app, view.proposes) : ''}<button class="btn btn--primary" type="submit" name="${FIELDS.decision}" value="${DECISIONS.approve}">Connect ${app}</button>
<button class="btn" type="submit" name="${FIELDS.decision}" value="${DECISIONS.deny}">Cancel</button>
</form>
<p class="fine"><a href="${HELP_URL}">How this works</a>. By connecting you agree to the <a href="/terms">terms</a>; the <a href="/privacy">privacy notice</a> explains what is kept.</p>`;
  return frame({ title: `Connect ${view.clientName}`, body, who: view.memberEmail, nav: [{ href: '/connections', label: 'Your AI connections' }] });
}
