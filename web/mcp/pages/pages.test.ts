// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DECISIONS, FIELDS, LAW_TOOL_NAME, MCP_RESOURCE, TOOL_NAMES } from '../contract.ts';
import { FORM_FIELD, GRANT_FIELD } from '../forms.ts';
import { renderAdminClientsPage, type SmokeSweepView } from './admin.ts';
import { renderConnectPage } from './connect.ts';
import { ALREADY_ADDED, HELP_SECTION, NO_TOOLS_YET } from './connect-help.ts';
import { HELP_URL } from './consent.ts';
import { ROOM_URL, isoDate } from './html.ts';
import {
  escapeHtml,
  formPageResponse,
  htmlResponse,
  renderAdminClients,
  renderConnections,
  renderConsent,
  renderMessage,
  renderPrivacy,
  renderTerms,
  type AdminClientsView,
  type ConnectionsView,
  type ConsentView,
} from './index.ts';

const EVIL = '<script>alert(1)</script>"\'&';
const TOKEN = 'a'.repeat(43);

const consent: ConsentView = {
  memberEmail: 'counsel@example.com',
  clientName: 'Claude',
  clientDomain: 'claude.ai',
  redirectHost: 'claude.ai',
  redirectIsLoopback: false,
  clientKind: 'claude',
  handle: 'h-123',
};

const connections: ConnectionsView = {
  memberEmail: 'counsel@example.com',
  isOwner: false,
  formToken: TOKEN,
  rows: [{ grantId: 'g-1', email: 'counsel@example.com', clientName: 'Harvey', createdAt: 1_790_000_000, expiresAt: 1_792_592_000 }],
};

const admin: AdminClientsView = {
  formToken: TOKEN,
  list: 'static',
  nextCursor: null,
  clients: [{ clientId: 'c-1', clientName: 'Microsoft Copilot', redirectUris: ['https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect'], registrationDate: 1_790_000_000 }],
  created: { clientId: 'c-2', clientSecret: 's3cret-value', clientName: 'Harvey' },
};

function allPages(): [string, string][] {
  return [
    ['consent', renderConsent(consent)],
    ['consent loopback', renderConsent({ ...consent, clientDomain: undefined, redirectHost: '127.0.0.1', redirectIsLoopback: true })],
    ['connections', renderConnections(connections)],
    ['connections owner', renderConnections({ ...connections, isOwner: true, notice: 'Revoked.' })],
    ['connections empty', renderConnections({ ...connections, rows: [] })],
    ['admin', renderAdminClients(admin)],
    ['admin empty', renderAdminClients({ formToken: TOKEN, clients: [], list: 'all' })],
    ['admin more', renderAdminClients({ ...admin, created: undefined, list: 'all', nextCursor: '100' })],
    ['admin swept', renderAdminClientsPage({ ...admin, created: undefined, list: 'all', swept: { deleted: 2, more: true } })],
    ['privacy', renderPrivacy()],
    ['terms', renderTerms()],
    ['message', renderMessage({ status: 404, title: 'Not found', message: 'That page does not exist.' })],
  ];
}

test('escapeHtml escapes every character that could open markup or end an attribute', () => {
  assert.equal(escapeHtml(EVIL), '&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;&amp;');
  assert.equal(escapeHtml('a`b'), 'a&#96;b');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(42), '42');
  assert.equal(escapeHtml('plain text'), 'plain text');
});

test('isoDate formats Unix seconds and rejects missing values', () => {
  assert.equal(isoDate(0), null);
  assert.equal(isoDate(null), null);
  assert.equal(isoDate(Number.NaN), null);
  assert.equal(isoDate(1_790_000_000), '2026-09-21');
});

test('consent shows the member, app, verified domain, redirect host and both decisions', () => {
  const html = renderConsent(consent);
  assert.match(html, /<h1>Connect Claude to the counsel room<\/h1>/);
  assert.ok(html.includes('You are signed in as <strong>counsel@example.com</strong>.'));
  assert.ok(html.includes('Only connect if you started this just now from your own Harvey, Copilot or Claude account. If someone sent you this link, choose Cancel.'));
  assert.ok(html.includes(`<a href="${HELP_URL}">How this works</a>`));
  assert.equal(HELP_URL, '/connect');
  for (const text of ['Verified domain', 'Access goes to', '30 days', 'read-only', 'AI provider', 'room owner sees']) {
    assert.ok(html.includes(text), text);
  }
  assert.match(html, /<form method="post" action="\/authorize"/);
  assert.match(html, /<input type="hidden" name="handle" value="h-123">/);
  assert.ok(html.includes(`name="${FIELDS.decision}" value="${DECISIONS.approve}">Connect Claude</button>`));
  assert.ok(html.includes(`name="${FIELDS.decision}" value="${DECISIONS.deny}">Cancel</button>`));
  assert.ok(html.indexOf('Only connect if') < html.indexOf('>Connect Claude</button>'), 'the caution sits before the buttons');
});

test('consent warns about loopback redirects and omits the domain when there is none', () => {
  const html = renderConsent({ ...consent, clientDomain: undefined, redirectHost: '127.0.0.1', redirectIsLoopback: true });
  assert.ok(html.includes('Any program on this computer could receive access'));
  assert.ok(html.includes('127.0.0.1'));
  assert.ok(!html.includes('Verified domain'));
  assert.ok(!renderConsent(consent).includes('Any program on this computer'));
});

test('a client name, host or handle carrying markup renders inert on every page', () => {
  const pages = [
    renderConsent({ ...consent, clientName: EVIL, clientDomain: EVIL, redirectHost: EVIL, memberEmail: EVIL, handle: EVIL }),
    renderConnections({ ...connections, isOwner: true, notice: EVIL, rows: [{ ...connections.rows[0]!, clientName: EVIL, email: EVIL, grantId: EVIL }] }),
    renderAdminClients({ formToken: EVIL, list: 'all', nextCursor: EVIL, clients: [{ clientId: EVIL, clientName: EVIL, redirectUris: [EVIL], registrationDate: null }], created: { clientId: EVIL, clientSecret: EVIL, clientName: EVIL } }),
    renderMessage({ status: 403, title: EVIL, message: EVIL }),
  ];
  for (const html of pages) {
    assert.ok(!html.includes('<script>'), 'raw script tag');
    assert.ok(!html.includes('"\'&<'), 'raw quote run');
    assert.ok(html.includes('&lt;script&gt;'));
  }
});

test('connections lists rows with ISO dates and a Disconnect form carrying the form token', () => {
  const html = renderConnections(connections);
  assert.match(html, /<h1>Your AI connections<\/h1>/);
  assert.ok(html.includes('Harvey'));
  assert.ok(html.includes('2026-09-21'));
  assert.ok(html.includes(`name="${FORM_FIELD}" value="${TOKEN}"`));
  assert.ok(html.includes(`name="${GRANT_FIELD}" value="g-1"`));
  assert.ok(html.includes('>Disconnect<'));
  assert.ok(!html.includes('Revoke'));
  assert.match(html, /action="\/connections"/);
  assert.ok(!html.includes('>Member<'), 'members see no member column');
  // A Disconnect lost to an expired sign-in comes back as a plain GET; the line under the list says how to tell.
  assert.ok(html.includes('</table></div>\n<p>When it works, the page says Disconnected. If the app is still listed, choose Disconnect again.</p>'), 'the check under the list');
  assert.ok(!renderConnections({ ...connections, rows: [] }).includes('choose Disconnect again'), 'not with nothing to disconnect');
});

test('the owner view adds the member column; an empty list says so in one sentence', () => {
  assert.ok(renderConnections({ ...connections, isOwner: true }).includes('<th scope="col">Member</th>'));
  const empty = renderConnections({ ...connections, rows: [] });
  assert.ok(empty.includes('No AI apps are connected.'));
  assert.ok(empty.includes('<a href="/connect">How to connect your AI</a>'), 'the empty state links to /connect');
  assert.ok(!empty.includes('<table'));
});

test('admin clients shows the one-time secret, the list, delete and create forms with the token', () => {
  const html = renderAdminClients(admin);
  assert.ok(html.includes('s3cret-value'));
  assert.ok(html.includes('It is not shown again.'));
  assert.ok(html.includes('Microsoft Copilot'));
  assert.ok(html.includes(`name="${FIELDS.action}" value="delete"`));
  assert.ok(html.includes(`name="${FIELDS.action}" value="create"`));
  assert.ok(html.includes(`name="${FIELDS.clientName}"`));
  assert.ok(html.includes(`name="${FIELDS.redirectUris}"`));
  assert.equal(html.split(`name="${FORM_FIELD}" value="${TOKEN}"`).length - 1, 2);
  assert.ok(!renderAdminClients({ ...admin, created: undefined }).includes('not shown again'));
  assert.ok(html.includes('<a href="/admin/clients?list=static" aria-current="page">Created here</a>'));
  assert.ok(html.includes('<a href="/admin/clients?list=all">All clients</a>'));
  assert.ok(!html.includes('Load more'));
});

test('admin clients links Load more to the next cursor, encoded', () => {
  const html = renderAdminClients({ ...admin, list: 'all', nextCursor: 'a&b=c d' });
  assert.ok(html.includes('<a href="/admin/clients?list=all" aria-current="page">All clients</a>'));
  assert.ok(html.includes('href="/admin/clients?list=all&amp;cursor=a%26b%3Dc+d">Load more</a>'));
  assert.ok(html.includes('Every OAuth client'));
  assert.ok(renderAdminClients({ ...admin, list: 'all', clients: [] }).includes('No clients are registered.'));
});

test('All clients offers Delete old smoke clients with the form token and notes what it did; Created here does not', () => {
  const all = renderAdminClientsPage({ ...admin, created: undefined, list: 'all' });
  assert.ok(all.includes(`name="${FIELDS.action}" value="sweep_smoke"`));
  assert.ok(all.includes('>Delete old smoke clients</button>'));
  assert.ok(all.includes('<span class="u-mono">legallas-smoke</span>'));
  assert.ok(all.includes('Clients created here are never deleted.'));
  assert.equal(all.split(`name="${FORM_FIELD}" value="${TOKEN}"`).length - 1, 3, 'the sweep, a delete and the create form');
  assert.ok(!all.includes('<p class="notice"'));
  assert.ok(!renderAdminClientsPage(admin).includes('sweep_smoke'), 'not on Created here');
  const note = (swept: NonNullable<SmokeSweepView['swept']>) => renderAdminClientsPage({ ...admin, created: undefined, list: 'all', swept });
  assert.ok(note({ deleted: 0, more: false }).includes('<p class="notice" role="status">No old smoke clients were deleted.</p>'));
  assert.ok(note({ deleted: 1, more: false }).includes('<p class="notice" role="status">Deleted 1 old smoke client.</p>'));
  assert.ok(note({ deleted: 25, more: true }).includes('<p class="notice" role="status">Deleted 25 old smoke clients. More may remain: choose Delete old smoke clients again.</p>'));
});

test('privacy and terms name the operator, Colorado law and the security.txt contact', () => {
  const privacy = renderPrivacy();
  const terms = renderTerms();
  for (const html of [privacy, terms]) {
    assert.ok(html.includes('the owner'));
    assert.ok(html.includes('mailto:email@example.com'));
  }
  assert.ok(privacy.includes('30 days'));
  assert.ok(privacy.includes('IP address'));
  assert.ok(terms.includes('Colorado'));
  assert.ok(terms.includes('without warranty'));
});

test('consent, privacy and terms say what counsel\'s AI reads (the owner, 2026-10-20): files only where the app takes them', () => {
  const pages = { consent: renderConsent(consent), privacy: renderPrivacy(), terms: renderTerms() };
  for (const [name, html] of Object.entries(pages)) {
    assert.doesNotMatch(html, /download original files/, `${name}: the old promise is gone`);
    assert.match(html, /original file/, name);
    assert.match(html, /comment threads/, name);
  }
  for (const html of [pages.consent, pages.terms]) assert.ok(html.includes('It cannot change anything in the room.'), 'still read-only');
  // Only Claude is sent files (mcp/tools/files.ts, visuals.ts); its consent page says so.
  assert.ok(pages.consent.includes('It can also receive small original files and images of the visuals.'));
  assert.ok(pages.consent.includes('including every original file or visual image it receives'));
  for (const kind of ['harvey', 'microsoft', 'unknown'] as const) {
    const html = renderConsent({ ...consent, clientName: 'App', clientKind: kind });
    assert.doesNotMatch(html, /original file|images of the visuals|visual image/, `${kind}: text only`);
    assert.ok(html.includes('all as text and as you see them'), kind);
    assert.ok(html.includes('Text App reads goes to its AI provider'), kind);
  }
  for (const html of [pages.privacy, pages.terms]) assert.ok(html.includes('for apps that accept them, small original files and images of the visuals'));
  assert.ok(pages.terms.includes('Each original file or visual image it receives is logged.'));
  assert.ok(pages.privacy.includes('each original file or visual image sent'));
  assert.ok(pages.privacy.includes('What you asked is never recorded.'));
  assert.ok(renderConnectPage().includes('including the visuals, the comment threads and, for apps that accept them, small original files.'), 'Good to know');
});

// connect-help.test.ts holds the rest of /connect; it is at the 400-line limit, so the live-test copy is pinned here.
test('/connect Claude copy matches the live test as test counsel (2026-10-20): Continue, Connect, two messages', () => {
  const page = renderConnectPage();
  const at = page.indexOf('<section class="cx-tool prose" id="claude"');
  const it = page.indexOf('<details class="cx-it" id="claude-it">', at);
  const steps = page.slice(page.indexOf('<ol>', at), page.indexOf('</ol>', at));
  // The prefilled dialog warns that an external link suggested it and confirms with Continue; Connect opens sign-in.
  assert.ok(steps.includes(`Claude warns that an external link suggested it: check that the link reads <code class="cx-copy">${MCP_RESOURCE}</code>, then choose <strong>Continue</strong>.`));
  assert.ok(steps.includes('see <a href="#sign-in">Signing in</a>. If no sign-in page opens, choose <strong>Connect</strong> next to Legallas.'));
  assert.ok(steps.includes('<li>Choose <strong>Connect claude.ai</strong>.</li>'));
  assert.ok(!page.slice(at, it).includes('<strong>Add</strong>'), 'the member dialog says Continue, not Add');
  // Anthropic's docs say Add on the Owner path, which the live test did not cover.
  assert.ok(page.slice(it, page.indexOf('</details>', it)).includes('leave the client ID and secret blank, and choose <strong>Add</strong>.'));
  // claude.ai's own words, which Anthropic does not document, each with its fix in the In Claude group.
  assert.equal(ALREADY_ADDED, 'A connector with this URL already exists in your organization.');
  assert.equal(NO_TOOLS_YET, 'This connector has no tools available.');
  const help = HELP_SECTION.slice(HELP_SECTION.indexOf('<h3>In Claude</h3>'), HELP_SECTION.indexOf('<h3>In Microsoft 365 Copilot</h3>'));
  assert.ok(help.includes(`<strong>&ldquo;${ALREADY_ADDED}&rdquo;</strong> Claude has it already (on Team or Enterprise, your Owner added it): in Customize &gt; Connectors, choose Legallas, then <strong>Connect</strong>.`));
  assert.ok(help.includes(`<strong>&ldquo;${NO_TOOLS_YET}&rdquo;</strong> Reload the page a few seconds after connecting: all ten tools appear.`));
  assert.equal([...TOOL_NAMES, LAW_TOOL_NAME].length, 10, 'the ten tools the help promises');
  assert.ok(page.includes(HELP_SECTION));
  const readme = readFileSync(join(import.meta.dirname, '..', '..', 'connect', 'README.md'), 'utf8').replace(/\n\s*/g, ' ');
  assert.ok(readme.includes('| Claude | **Add to Claude**, and the Claude plugin with the kits | 4 steps |'), 'README: the Claude card and its steps');
  const guide = readFileSync(join(import.meta.dirname, '..', '..', 'connect', 'claude-ai.md'), 'utf8').replace(/\n\s*/g, ' ');
  assert.ok(guide.includes('Choose **Continue** (or **Add**).') && guide.includes('choose **Connect claude.ai**'), 'the Claude guide: Continue, then sign in and Connect claude.ai');
  for (const message of [ALREADY_ADDED, NO_TOOLS_YET]) assert.ok(readme.includes(`"${message}"`), `README sources: ${message}`);
});

test('message pages show the title, the sentence and the status code', () => {
  const html = renderMessage({ status: 403, title: 'Not a member', message: 'Ask the room owner for an invitation.' });
  assert.ok(html.includes('<h1>Not a member</h1>'));
  assert.ok(html.includes('Error 403'));
});

test('every page is a complete, accessible, self-contained document', () => {
  for (const [name, html] of allPages()) {
    assert.match(html, /^<!doctype html>\n<html lang="en">/, name);
    assert.match(html, /<title>[^<]+<\/title>/, name);
    assert.ok(html.includes('<meta name="viewport"'), name);
    assert.ok(!/<script/i.test(html), `${name}: no scripts`);
    assert.ok(!/style=/.test(html), `${name}: no style attributes`);
    assert.ok(!html.includes('\u2014'), `${name}: no em dashes`);
    assert.ok(!html.replace('<!doctype html>', '').includes('!'), `${name}: no exclamation marks`);
    const external = [...html.matchAll(/(?:href|src|action)="([^"]+)"/g)].map((m) => m[1]!).filter((u) => !u.startsWith('/'));
    assert.deepEqual(external.filter((u) => u !== 'mailto:email@example.com' && u !== ROOM_URL), [], `${name}: no external URLs but the room`);
    assert.ok(html.includes(`<a class="bar__room" href="${ROOM_URL}">Back to the room</a>`), `${name}: the way back to the room`);
    assert.ok(!/https?:\/\//.test(html.replaceAll(admin.clients[0]!.redirectUris[0]!, '').replace(`href="${ROOM_URL}"`, '')), `${name}: no other absolute URLs`);
    assert.ok(html.includes('<meta name="color-scheme" content="light">') && html.includes('color-scheme:light'), `${name}: light only`);
    assert.ok(!html.includes('prefers-color-scheme'), `${name}: no color-scheme media queries`);
    assert.ok(!html.includes('light dark'), `${name}: no dual color scheme`);
    assert.equal(html.match(/name="theme-color"/g)?.length, 1, `${name}: one theme-color`);
    assert.ok(html.includes('<meta name="theme-color" content="#1F3A2E">') && !html.includes('#0F1412'), `${name}: light theme-color only`);
    assert.ok(new TextEncoder().encode(html).length < 20_000, `${name}: under 20 KB`);
  }
});

test('every input has a label and every page uses one h1', () => {
  for (const [name, html] of allPages()) {
    assert.equal(html.split('<h1').length - 1, 1, name);
    for (const m of html.matchAll(/<(?:input|textarea) class="input" id="([^"]+)"/g)) assert.ok(html.includes(`<label for="${m[1]}">`), `${name}: ${m[1]}`);
  }
});

test('htmlResponse keeps the strict CSP, with no scripts and no form-action', () => {
  const res = htmlResponse('<p>x</p>', 404);
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.equal(res.status, 404);
  assert.ok(csp.includes("default-src 'none'"));
  assert.ok(!csp.includes('script-src'));
  assert.ok(!csp.includes('form-action'));
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
});

test('formPageResponse is htmlResponse with a same-origin referrer policy, for pages that post their own forms', () => {
  const plain = htmlResponse('<p>x</p>', 200, { 'set-cookie': 'a=b' });
  const form = formPageResponse('<p>x</p>', 200, { 'set-cookie': 'a=b' });
  // Under no-referrer a browser posts a form with Origin: null even to this origin, which checkForm refuses.
  assert.equal(form.headers.get('referrer-policy'), 'same-origin');
  for (const name of ['content-type', 'content-security-policy', 'x-frame-options', 'x-content-type-options', 'cache-control', 'set-cookie']) {
    assert.equal(form.headers.get(name), plain.headers.get(name), name);
  }
});

test('propose on: the consent page and /connect say a proposal waits for approval; off, they say read-only as before', () => {
  const off = renderConsent(consent);
  assert.ok(off.includes('It is read-only. It cannot change anything in the room.'));
  const on = renderConsent({ ...consent, offerPropose: true, proposes: { drafts: true, records: false } });
  assert.ok(on.includes('It is read-only unless you tick the box below. A proposal changes nothing until you approve it in the room.'));
  assert.ok(!on.includes('It cannot change anything in the room.'), 'no longer claims what a ticked box makes untrue');

  const plain = renderConnectPage();
  assert.ok(plain.includes('allow every tool. All are read-only.</li>'));
  assert.ok(!plain.includes('propose'), 'off: the page never mentions proposing');
  const proposing = renderConnectPage({ proposals: true });
  assert.ok(proposing.includes('except that a member may let their connection propose a draft, which changes nothing until they approve it in the room.'));
  assert.ok(proposing.includes('If you let it propose when you connect, it can also propose a draft'));
  for (const html of [plain, proposing]) assert.ok(!/all are read-only/.test(html), 'Always allow names the read-only tools only');
});
