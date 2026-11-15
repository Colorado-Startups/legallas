// SPDX-License-Identifier: Apache-2.0
// The public /connect page (pages/connect.ts) and its "If something goes wrong" section (pages/connect-help.ts):
// the panel, the tool sections, the sign-in steps once, the email buttons, the setup kit's parity, and help that
// is linked from the sign-in steps and every error page and quotes only messages that still exist where the lawyer
// sees them. The panel's order and step counts: connect-panel.test.ts. The other legallas-mcp pages: pages.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLAUDE_PLUGIN_PATH, SKILL_ZIP_PATH } from '../claude-plugin.ts';
import { CONNECT_PATH, COPILOT_PACKAGE_PATH, DEFAULT_DAILY_TOOL_CAP, MCP_ORIGIN, MCP_RESOURCE, type McpEnv } from '../contract.ts';
import { KITS } from '../kits.ts';
import { route } from '../oauth.ts';
import { AGENT_ZIP_PATH, copilotConnectorSection, copilotPackageSection } from './connect-copilot.ts';
import { HELP_SECTION, SIGN_IN_HOSTS } from './connect-help.ts';
import {
  CLAUDE_ADD_ORG_URL,
  CLAUDE_ADD_URL,
  CODE_SENDER,
  CODE_SENDER_IPS,
  CONNECT_URL,
  OPEN_WEIGHT_NAME,
  OPEN_WEIGHT_WHO,
  PANEL_ORDER,
  SIGN_IN_ID,
  STUDIO_DESCRIPTION,
  TOOLS,
  mailtoHref,
  renderConnectPage,
} from './connect.ts';
import { escapeHtml } from './html.ts';
import { HELP_PATH, renderMessagePage } from './message.ts';
import { SECURITY_PATH } from './security.ts';

const html = renderConnectPage();
/** A shared registration's Reference ID as long as the real one (100 characters), so the size check is honest. */
const SHARED_ID = `${'U2hhcmVkUmVnaXN0cmF0aW9uSWQ'.repeat(4).slice(0, 98)}==`;
/** The page once COPILOT_REFERENCE_ID is set: the connector shows the ID, and the agent can be downloaded. */
const sharedHtml = renderConnectPage({ copilotPackage: true, copilotReferenceId: SHARED_ID });
/** The page as pro serves it once the shared registration is set: the most it ever holds. */
const proHtml = renderConnectPage({ claudePlugin: true, copilotPackage: true, copilotReferenceId: SHARED_ID });
const web = join(import.meta.dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(web, ...parts), 'utf8');
/** The text a lawyer reads, with the quote entities and tags undone. */
const text = (h: string) => h.replaceAll('&ldquo;', '"').replaceAll('&rdquo;', '"').replaceAll('&gt;', '>').replaceAll('&#39;', "'").replace(/<[^>]+>/g, '');

/** Cloudflare Access's own one-time PIN messages (developers.cloudflare.com, one-time-pin, read 2026-10-20). */
const ACCESS_MESSAGES = ['This One-Time PIN has already been used', 'That account does not have access.'];
/** The shared sign-in code block in Signing in (pages/connect.ts SIGN_IN_CODE), which owns the sender. */
const CODE_LINK = '<a href="#sign-in-code">If the sign-in code doesn\'t arrive</a>';
/** Anthropic's connector messages (claude.com/docs/connectors/building/troubleshooting, read 2026-10-20). */
const CLAUDE_MESSAGES = ["Couldn't reach the MCP server", 'Authorization with the MCP server failed'];

test('connect carries the help section once, after Good to know and before Disconnect', () => {
  assert.equal(html.split('id="help"').length - 1, 1);
  assert.ok(html.includes('<h2 id="help-title">If something goes wrong</h2>'));
  const at = html.indexOf('id="help"');
  assert.ok(html.indexOf('id="know-title"') < at && at < html.indexOf('id="disconnect"'));
  const signIn = html.slice(html.indexOf('id="sign-in"'), html.indexOf('</section>', html.indexOf('id="sign-in"')));
  assert.equal(html.split('<a href="#help">If something goes wrong</a>').length - 1, 1, 'one link, under the one set of sign-in steps');
  assert.ok(signIn.includes('<a href="#help">If something goes wrong</a>'));
});

test('the sign-in steps ask for the exact address, name the Email box and sit right above the code help', () => {
  const signIn = html.slice(html.indexOf('id="sign-in"'), html.indexOf('</section>', html.indexOf('id="sign-in"')));
  for (const text of [
    'type the exact address your room invitation went to, not an alias or forwarding address.',
    'Ignore the <strong>Cloudflare</strong> button',
    'for example <strong>Connect claude.ai</strong>', // Claude's consent button names its verified domain
  ]) {
    assert.equal(html.split(text).length - 1, 1, `once on the page: ${text}`);
    assert.ok(signIn.includes(text), `in Signing in: ${text}`);
  }
  assert.equal(html.split('id="sign-in-code"').length - 1, 1, 'the code help is on the page once');
  assert.ok(signIn.indexOf('id="sign-in-code"') > signIn.indexOf('</ol>'), 'right after the steps');
  assert.ok(HELP_SECTION.includes(`See ${CODE_LINK} under Signing in.`), 'the help row says where it is');
});

test('help quotes each sign-in message, and the room pages it quotes still say it', () => {
  const help = text(HELP_SECTION);
  for (const message of ACCESS_MESSAGES) assert.ok(help.includes(`"${message}"`), message);
  // The Access app's deny pages (custom_non_identity_deny_url and custom_deny_url) are the room's own.
  assert.ok(read('src', 'pages', 'welcome', 'away', 'index.astro').includes('Sign-in works only from the United States.'));
  assert.ok(help.includes('"Sign-in works only from the United States."'));
  assert.ok(read('src', 'pages', 'welcome', 'denied', 'index.astro').includes('This room is private.'));
  assert.ok(help.includes('"This room is private."'));
  // The legallas-mcp pages (mcp/authorize.ts).
  const authorize = read('mcp', 'authorize.ts');
  for (const title of ['This page has expired', 'No access', 'This link cannot be used']) {
    assert.ok(authorize.includes(`'${title}'`), `authorize.ts still titles a page ${title}`);
    assert.ok(help.includes(`"${title}"`), title);
  }
  for (const message of CLAUDE_MESSAGES) assert.ok(help.includes(`"${message}"`), message);
});

test('help names the sign-in hosts, leaves the sender to the code help, and links only to mail and the page\'s own blocks', () => {
  assert.deepEqual([...SIGN_IN_HOSTS], ['mcp.room.example.com', 'room.cloudflareaccess.com']);
  for (const host of SIGN_IN_HOSTS) assert.ok(HELP_SECTION.includes(`<code class="cx-copy">${host}</code>`), host);
  assert.ok(!HELP_SECTION.includes(CODE_SENDER), 'the sender lives in one place, the code help');
  assert.ok(HELP_SECTION.includes(CODE_LINK));
  const links = [...HELP_SECTION.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
  assert.ok(links.length > 0);
  for (const href of links) assert.ok(['mailto:email@example.com', '#sign-in-code', '#copilot-it'].includes(href), href);
  assert.ok(!/[!—]/.test(HELP_SECTION), 'no exclamation marks or em dashes');
});

test('help groups follow the page order, and the Copilot group points to the Copilot table instead of copying it', () => {
  const groups = [...HELP_SECTION.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]);
  assert.deepEqual(groups, ['On the sign-in page', 'In Claude', 'In Microsoft 365 Copilot', 'In Harvey', 'For your IT team']);
  const copilot = HELP_SECTION.slice(HELP_SECTION.indexOf('<h3>In Microsoft 365 Copilot</h3>'), HELP_SECTION.indexOf('<h3>In Harvey</h3>'));
  assert.ok(copilot.includes('<a href="#copilot-it">For your IT team</a>'));
  assert.ok(html.includes('<details class="cx-it" id="copilot-it">') && html.includes('id="copilot-trouble"'), 'the table it points to');
});

test('every error page links to the help section', () => {
  assert.equal(HELP_PATH, '/connect#help');
  const page = renderMessagePage({ title: 'This page has expired', message: 'x', status: 400 });
  assert.ok(page.includes('<a href="/connect#help">Setup help</a>'));
  assert.ok(page.indexOf('Setup help') < page.indexOf('Your AI connections'), 'help first in the footer');
});

test('the Claude guide carries the same messages as the page', () => {
  const guide = read('connect', 'claude-ai.md');
  for (const message of [...ACCESS_MESSAGES, ...CLAUDE_MESSAGES, 'A code has been emailed to you', 'Sign-in works only from the United States.', 'This room is private.', 'This page has expired']) {
    assert.ok(guide.includes(`"${message}`), message);
  }
  assert.ok(guide.includes("(README.md#if-the-sign-in-code-doesnt-arrive)") && guide.includes('connect#sign-in-code'), 'links the code help');
  assert.ok(read('connect', 'README.md').includes("### If the sign-in code doesn't arrive"), 'the README heading the link targets');
  assert.ok(!guide.includes(CODE_SENDER) && guide.includes('room.cloudflareaccess.com'), 'the sender lives in one place');
  assert.ok(guide.includes('the exact address your'), 'no alias');
  assert.ok(guide.includes('**Always allow**') && guide.includes('**Reconnect**'));
  assert.ok(!guide.includes('—'), 'no em dashes');
});

// The public "Connect your AI" page (session S4, reworked for counsel onboarding, then for every invitee): static, no
// scripts, the panel, the kits, one section per tool (Claude, Microsoft 365 Copilot, Harvey, OpenCode), the sign-in
// steps once, mailto: links and the package form.

const connectHtml = html;

/** Every href, src and action value on a page, with the HTML entities in it undone. */
function urls(html: string): string[] {
  const unescape = (v: string) => v.replaceAll('&amp;', '&').replaceAll('&#39;', "'").replaceAll('&quot;', '"');
  return [...html.matchAll(/(?:href|src|action)="([^"]+)"/g)].map((m) => unescape(m[1]!));
}

/** One tool's section, from its opening tag to its own closing tag. */
function toolHtml(id: string): string {
  const at = connectHtml.indexOf(`<section class="cx-tool prose" id="${id}"`);
  return connectHtml.slice(at, connectHtml.indexOf('</section>', at));
}

test('connect renders one h1, the panel, the link in a select-all box and a section per tool', () => {
  assert.equal(connectHtml.split('<h1').length - 1, 1);
  assert.match(connectHtml, /^<!doctype html>\n<html lang="en">/);
  assert.ok(connectHtml.includes(`<code>${MCP_RESOURCE}</code>`));
  assert.match(connectHtml, /\.cx-link code\{[^}]*user-select:all/);
  assert.equal(connectHtml.match(/<\/style>/g)?.length, 1, 'the page rules join the one style sheet in <head>');
  assert.ok(connectHtml.indexOf('.cx-link') < connectHtml.indexOf('</head>'));
  for (const tool of TOOLS) {
    assert.ok(connectHtml.includes(`<section class="cx-tool prose" id="${tool.id}"`), tool.id);
    assert.ok(connectHtml.includes(`<details class="cx-it" id="${tool.id}-it">`), tool.id);
    assert.ok(toolHtml(tool.id).includes(`<p class="cx-who">${tool.who}</p>`), `${tool.id}: who does what, under its name`);
    assert.ok(toolHtml(tool.id).includes(`<summary>For ${tool.admin} (once)</summary>`), tool.id);
    // toolHtml here and harvey-guide.test.ts slice a tool's section up to its first </section>: no nested sections.
    assert.ok(!toolHtml(tool.id).includes('<section', 1), `${tool.id}: no nested <section>, so its own </section> ends it`);
  }
  assert.equal(connectHtml.split('<h3>What you do</h3>').length - 1, 4, 'the three tools and OpenCode');
  const headings = [...connectHtml.matchAll(/<h([1-3])/g)].map((m) => Number(m[1]));
  headings.forEach((level, i) => assert.ok(i === 0 || level <= headings[i - 1]! + 1, `heading ${i} skips a level`));
});

test('connect leads with the panel, a card per AI, then the kits, then the sections in the panel\'s order', () => {
  assert.deepEqual(TOOLS.map((t) => t.id), ['claude', 'copilot', 'harvey']);
  assert.deepEqual(TOOLS.map((t) => [t.name, t.who]), [
    ['Claude', 'You, about two minutes.'],
    ['Microsoft 365 Copilot', 'In Outlook, Teams and Word. Your IT team adds Legallas once, then you sign in.'],
    ['Harvey', 'Your Harvey admin turns it on once, then you sign in.'],
  ]);
  const panel = connectHtml.indexOf('<ul class="cx-cards"');
  assert.ok(panel > connectHtml.indexOf('<h1') && panel < connectHtml.indexOf('<div class="cx-link">'), 'right under the h1');
  const cards = [...connectHtml.matchAll(/<li class="cx-card[^"]*" data-ai="([^"]+)"><a href="#([^"]+)">/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(cards, PANEL_ORDER.counsel.map((id) => [id, id]), 'counsel\'s panel by default, each card linked to its section');
  assert.ok(connectHtml.includes(`<h2 id="open-weight-title">${OPEN_WEIGHT_NAME}</h2>\n<p class="cx-who">${OPEN_WEIGHT_WHO}</p>`));
  const sections = PANEL_ORDER.counsel.map((id) => connectHtml.indexOf(`<section class="cx-tool prose" id="${id}"`));
  assert.ok(sections.every((at) => at > 0), 'a section per card');
  assert.deepEqual([...sections].sort((a, b) => a - b), sections, 'the sections follow the same order');
  assert.ok(sections[3]! < connectHtml.indexOf(`id="${SIGN_IN_ID}"`), 'OpenCode before the sign-in steps');
  const kits = connectHtml.indexOf('<h2 id="kits-title">Ask your AI for a kit</h2>');
  assert.ok(kits > panel && kits < sections[0]!, 'the kits between the panel and the sections');
  for (const kit of KITS) assert.ok(connectHtml.includes(`<li>${kit.title}</li>`), kit.title);
  const lead = connectHtml.slice(connectHtml.indexOf('<p class="lead">'), panel);
  assert.ok(!/IT team|admin/.test(lead), 'the lead no longer says IT is needed for every tool');
  assert.ok(!/<h2[^>]*>Microsoft Copilot</.test(connectHtml), 'the old name is gone');
});

test('connect keeps the anchors the emails and the room link to, each once', () => {
  for (const id of ['claude', 'copilot', 'harvey', 'open-weight', 'kits', 'claude-it', 'copilot-it', 'harvey-it', SIGN_IN_ID, 'sign-in-code', 'help', 'disconnect']) {
    assert.equal(connectHtml.split(`id="${id}"`).length - 1, 1, id);
  }
  assert.equal(SIGN_IN_ID, 'sign-in');
});

test('the sign-in steps appear once, in #sign-in, and every tool links there instead of repeating them', () => {
  assert.equal(connectHtml.split('Choose <strong>Send login code</strong>, then type the code from your inbox.').length - 1, 1);
  const signIn = connectHtml.indexOf(`<section class="cx-tool prose" id="${SIGN_IN_ID}"`);
  assert.ok(signIn > connectHtml.indexOf('id="harvey"'), 'after the three tools');
  assert.ok(connectHtml.indexOf('Send login code') > signIn, 'the steps sit in it');
  for (const tool of TOOLS) {
    const section = toolHtml(tool.id);
    const steps = section.slice(section.indexOf('<h3>What you do</h3>'), section.indexOf('<h3>Not there yet?</h3>'));
    assert.ok(steps.includes(`<a href="#${SIGN_IN_ID}">Signing in</a>`), `${tool.id}: links the sign-in steps`);
    assert.ok(!section.includes('Send login code'), `${tool.id}: does not repeat them`);
  }
});

test('Microsoft 365 Copilot: the checklist, the agent, then the connector either way; the shared registration adds the download and its Reference ID', () => {
  const it = (html: string) => html.slice(html.indexOf('id="copilot-it"'), html.indexOf('</details>', html.indexOf('id="copilot-it"')));
  const off = it(connectHtml);
  const on = it(sharedHtml);
  assert.equal(renderConnectPage({ copilotPackage: false }), connectHtml, 'off is the default');
  const heads = ['<h4>Before you start: the IT checklist</h4>', '<h4 id="copilot-agent">', '<h4 id="copilot-connector">', '<h4>Other option: Copilot Studio</h4>', 'id="copilot-trouble"'];
  for (const [name, part] of [['off', off], ['on', on]] as const) {
    const at = heads.map((h) => part.indexOf(h));
    assert.ok(at.every((i, n) => i > 0 && (n === 0 || i > at[n - 1]!)), `${name}: checklist, agent, connector, Copilot Studio, table: ${at.join(', ')}`);
  }
  assert.ok(off.includes(copilotConnectorSection(null)) && off.includes(copilotPackageSection(false)), 'off: the firm\'s own registration and the form');
  assert.ok(off.includes('<form') && !off.includes(AGENT_ZIP_PATH), 'off: no download');
  assert.ok(on.includes(copilotConnectorSection(SHARED_ID)) && on.includes(copilotPackageSection(true)), 'on: the Reference ID and the download');
  assert.ok(!on.includes('<form') && !on.includes('Recommended: <strong>Copilot Studio</strong>'), 'on: no per-firm form');
  const card = (html: string) => html.slice(html.indexOf('<li class="cx-card" data-ai="copilot">'), html.indexOf('</li>', html.indexOf('data-ai="copilot"')));
  assert.ok(card(sharedHtml).includes(`href="${AGENT_ZIP_PATH}">Download the agent</a>`) && card(connectHtml).includes('href="#copilot-it">Steps for your IT team</a>'), 'the card: the download, or the IT steps');
  assert.equal(sharedHtml.replace(on, '').replace(card(sharedHtml), ''), connectHtml.replace(off, '').replace(card(connectHtml), ''), 'only the Copilot IT steps and card change');
});

test('connect carries the shared Good to know list and Disconnect', () => {
  for (const text of [
    'It cannot change, upload or delete anything.',
    'The connection lasts 30 days.',
    'Sign-in works from the United States only.',
    `Each member has ${DEFAULT_DAILY_TOOL_CAP.toLocaleString('en-US')} AI look-ups a day. The count resets at midnight UTC.`,
    'The owner sees which documents were opened and through which AI tool, never what you asked.',
    'Removing the connector inside your AI tool alone does not end it on our side.',
  ]) assert.ok(connectHtml.includes(text), text);
  assert.ok(connectHtml.includes('<a href="/connections">Your AI connections</a>, sign in with your room email'));
  assert.ok(connectHtml.includes('<a href="/privacy">Privacy</a>') && connectHtml.includes('<a href="/terms">Terms</a>'));
});

test('connect carries the sign-in code help inside Signing in, under the fixed #sign-in-code heading', () => {
  // Cloudflare's one-time PIN docs (read 2026-10-20): the sender, its IPs, single use, 10 minutes, and that a
  // blocked address gets no email while the page still says one was sent.
  assert.equal(CODE_SENDER, 'noreply@notify.cloudflare.com');
  assert.equal(CODE_SENDER_IPS, '104.30.16.2 to 104.30.16.7');
  const heading = '<h3 id="sign-in-code">If the sign-in code doesn\'t arrive</h3>';
  assert.equal(connectHtml.split(heading).length - 1, 1, 'one heading, the per-tool guides link to its id');
  const at = connectHtml.indexOf(heading);
  assert.ok(at > connectHtml.indexOf('<h2 id="sign-in-title">'), 'inside Signing in');
  assert.ok(at < connectHtml.indexOf('<h2 id="know-title">'), 'right after the steps');
  for (const text of [
    'Use the exact email address your room invitation went to. For any other address no code is sent, even though the page says one was.',
    `The code comes from <code>${CODE_SENDER}</code> (Cloudflare, which runs the sign-in). Check your junk or quarantine folder.`,
    'A code works once, for 10 minutes. If the page says it was already used or has expired, request a new code.',
    `Ask your IT team to allowlist <code>${CODE_SENDER}</code> (domain <code>notify.cloudflare.com</code>, sending IPs ${CODE_SENDER_IPS}) and to exempt it from link rewriting or scanning: a scanner that opens the message first can use up the code.`,
  ]) assert.ok(connectHtml.slice(at).includes(text), text);
});

test('connect is self-contained: no scripts, no style attributes, no em dashes, light only, under 42 KB at its fullest', () => {
  assert.ok(!/<script/i.test(connectHtml));
  assert.ok(!/style=/.test(connectHtml));
  assert.ok(!connectHtml.includes('—') && !decodeURIComponent(urls(connectHtml).join(' ')).includes('—'), 'no em dashes, in mailto bodies too');
  assert.ok(!connectHtml.replace('<!doctype html>', '').includes('!'), 'no exclamation marks');
  assert.ok(!connectHtml.includes('prefers-color-scheme') && connectHtml.includes('color-scheme:light'));
  // 40 KB until the panel (2026-11-06): one action per AI with the room's link in it, the OpenCode config included.
  for (const [name, page] of [['unset', connectHtml], ['shared registration', sharedHtml], ['pro, shared registration', proHtml]] as const) {
    const bytes = new TextEncoder().encode(page).length;
    assert.ok(bytes < 42_000, `${name}: ${bytes} bytes`);
  }
  for (const m of connectHtml.matchAll(/<input class="input" id="([^"]+)"/g)) assert.ok(connectHtml.includes(`<label for="${m[1]}">`), m[1]);
});

test('every email button decodes to its subject and body, with no recipient', () => {
  const mails = urls(connectHtml).filter((u) => u.startsWith('mailto:?'));
  assert.equal(mails.length, TOOLS.length);
  for (const [i, tool] of TOOLS.entries()) {
    const href = mails[i]!;
    assert.equal(href, mailtoHref(tool.mail.subject, tool.mail.lines), tool.id);
    assert.ok(href.length < 2000, `${tool.id}: short enough for every mail client`);
    assert.ok(!/[\s<>"]/.test(href), `${tool.id}: fully encoded`);
    const params = Object.fromEntries(href.slice('mailto:?'.length).split('&').map((p) => p.split('=') as [string, string]));
    assert.deepEqual(Object.keys(params), ['subject', 'body'], tool.id);
    assert.equal(decodeURIComponent(params.subject!), tool.mail.subject);
    const body = decodeURIComponent(params.body!);
    assert.equal(body, tool.mail.lines.join('\r\n'));
    assert.ok(body.includes(MCP_RESOURCE), `${tool.id}: the link`);
    assert.ok(body.includes(`${CONNECT_URL}#${tool.id}-it`), `${tool.id}: the IT steps`);
  }
  assert.equal(mailtoHref('A & B?', ['x=1', 'y #2']), 'mailto:?subject=A%20%26%20B%3F&body=x%3D1%0D%0Ay%20%232');
});

test('every link on connect is https, mailto, a fragment on the page or a known path, with the agent on or off', () => {
  // AGENT_ZIP_PATH: the shared agent's download (copilot-package.ts), linked once the agent is configured.
  // SECURITY_PATH: the public security page (security.ts).
  // CLAUDE_PLUGIN_PATH, SKILL_ZIP_PATH: the kits' downloads (claude-plugin.ts), linked when pro offers them.
  const known = new Set(['/connections', '/privacy', '/terms', COPILOT_PACKAGE_PATH, AGENT_ZIP_PATH, SECURITY_PATH, CLAUDE_PLUGIN_PATH, SKILL_ZIP_PATH]);
  for (const html of [connectHtml, sharedHtml, proHtml]) {
    for (const url of urls(html)) {
      if (url.startsWith('#')) assert.ok(html.includes(`id="${url.slice(1)}"`), `${url}: target exists`);
      else if (url.startsWith('/')) assert.ok(known.has(url), `${url}: known path`);
      else assert.ok(url.startsWith('https://') || url.startsWith('mailto:'), `${url}: https or mailto`);
    }
  }
});

test('Add to Claude: the documented prefill links, one per audience, opening claude.ai in a new tab', () => {
  // claude.com/docs/connectors/building/directory-vs-custom (read 2026-10-20): the same query on both paths.
  const query = 'modal=add-custom-connector&connectorName=Legallas&connectorUrl=https%3A%2F%2Fmcp.room.example.com%2Fmcp';
  assert.equal(CLAUDE_ADD_URL, `https://claude.ai/customize/connectors?${query}`);
  assert.equal(CLAUDE_ADD_ORG_URL, `https://claude.ai/admin-settings/connectors?${query}`);
  for (const href of [CLAUDE_ADD_URL, CLAUDE_ADD_ORG_URL]) {
    const url = new URL(href);
    assert.deepEqual([...url.searchParams.keys()], ['modal', 'connectorName', 'connectorUrl']);
    assert.equal(url.searchParams.get('connectorUrl'), MCP_RESOURCE, 'decodes to exactly the resource');
  }
  const card = connectHtml.slice(connectHtml.indexOf('data-ai="claude"'), connectHtml.indexOf('</li>', connectHtml.indexOf('data-ai="claude"')));
  const section = connectHtml.slice(connectHtml.indexOf('<section class="cx-tool prose" id="claude"'));
  const it = section.indexOf('<details class="cx-it" id="claude-it">');
  const button = (href: string, label: string) =>
    `<a class="btn btn--primary" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}<span class="u-vh"> (opens claude.ai in a new tab)</span></a>`;
  assert.ok(card.includes(button(CLAUDE_ADD_URL, 'Add to Claude')), 'the member button sits on the Claude card');
  const org = section.indexOf(button(CLAUDE_ADD_ORG_URL, 'Add to Claude for your organization'));
  assert.ok(org > it && org < section.indexOf('</details>'), 'the Owner button sits in the IT steps');
  assert.equal(connectHtml.split('target="_blank"').length - 1, 2, 'only these two open a new tab');
  assert.ok(TOOLS.find((t) => t.id === 'claude')!.mail.lines.some((line) => line.includes(CLAUDE_ADD_ORG_URL)), 'the Owner email carries the link');
});

test('the setup guides carry the same links and Copilot Studio values as the page', () => {
  const guide = (name: string) => readFileSync(join(import.meta.dirname, '..', '..', 'connect', name), 'utf8');
  const claude = guide('claude-ai.md');
  assert.ok(claude.includes(CLAUDE_ADD_URL) && claude.includes(CLAUDE_ADD_ORG_URL));
  const copilot = guide('copilot.md');
  assert.ok(copilot.includes(STUDIO_DESCRIPTION) && copilot.includes('**Dynamic discovery**'));
  const [guideAgent, guideConnector, guideStudio] = ['### The Legallas agent', '### Alternative, if your firm prefers a connector', '### Other option: Copilot Studio'].map((h) => copilot.indexOf(h));
  assert.ok(guideAgent > 0 && guideAgent < guideConnector && guideConnector < guideStudio, 'the guide: the agent leads, the connector second, Copilot Studio after');
  const [download, connector, studio] = [AGENT_ZIP_PATH, '<h4 id="copilot-connector">', '<h4>Other option: Copilot Studio</h4>'].map((t) => sharedHtml.indexOf(t));
  assert.ok(download > 0 && download < connector && connector < studio, 'the configured page too');
  const cap = `Each member has ${DEFAULT_DAILY_TOOL_CAP.toLocaleString('en-US')} AI look-ups a day.`;
  for (const name of ['README.md', 'claude-ai.md', 'copilot.md', 'harvey.md']) {
    assert.ok(guide(name).includes(cap), `${name}: the same daily cap as the page`);
    assert.ok(guide(name).replace(/\n\s*/g, ' ').includes('the comment threads and, for apps that accept them, small original files.'), `${name}: the hedged Good to know`);
  }
});

test('the README carries the sign-in code help the page has', () => {
  const flat = (name: string) => readFileSync(join(import.meta.dirname, '..', '..', 'connect', name), 'utf8').replace(/\n\s*/g, ' ');
  const readme = flat('README.md');
  assert.ok(readme.includes("### If the sign-in code doesn't arrive"), 'README: the heading the guides link to');
  assert.ok(readme.includes(`${CONNECT_URL}#sign-in-code`), 'README: points at the page block');
  for (const text of [
    'Use the exact email address your room invitation went to.',
    'A code works once, for 10 minutes.',
    `sending IPs ${CODE_SENDER_IPS}) and to exempt it from link rewriting or scanning`,
  ]) assert.ok(readme.includes(text), `README: ${text}`);
});

test('the README says what the page says: the same ways in, in the panel\'s order, and the same sign-in steps', () => {
  const readme = readFileSync(join(import.meta.dirname, '..', '..', 'connect', 'README.md'), 'utf8');
  const ways = readme.slice(readme.indexOf('## Connect your AI'), readme.indexOf('## Signing in'));
  assert.ok(ways.length > 0, 'README: Connect your AI comes before Signing in');
  const rows = TOOLS.map((t) => ways.indexOf(`| ${t.name} |`));
  for (const [i, tool] of TOOLS.entries()) assert.ok(rows[i]! > 0, `README: ${tool.name}`);
  assert.deepEqual([...rows].sort((a, b) => a - b), rows, 'README: the same order as the page');
  assert.ok(ways.indexOf('| OpenCode |') > rows[2]!, 'README: the fourth way in, last');
  assert.ok(ways.includes('[open-weight.md](open-weight.md)'), 'README: its guide');
  assert.ok(!/Microsoft Copilot(?! Studio)/.test(readme.replaceAll('Microsoft 365 Copilot', '')), 'README: the new name everywhere');
  // The page's three steps, as Markdown: <strong> is **, &gt; is >, and the README wraps long lines.
  const flat = readme.replace(/\n\s*/g, ' ');
  const signIn = connectHtml.slice(connectHtml.indexOf(`id="${SIGN_IN_ID}"`));
  const steps = [...signIn.slice(0, signIn.indexOf('</ol>')).matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]!);
  assert.equal(steps.length, 3);
  for (const [i, step] of steps.entries()) {
    const md = step.replaceAll('<strong>', '**').replaceAll('</strong>', '**').replaceAll('&gt;', '>').replaceAll('&#39;', "'");
    assert.ok(flat.includes(`${i + 1}. ${md}`), `README step ${i + 1}: ${md}`);
  }
  assert.ok(flat.indexOf("### If the sign-in code doesn't arrive") > flat.indexOf('## Signing in'), 'README: the code help sits under Signing in');
  assert.ok(flat.indexOf("### If the sign-in code doesn't arrive") < flat.indexOf('## Good to know'), 'README: as on the page');
});

test('the Copilot form posts the registration ID to the package route', () => {
  const form = connectHtml.match(/<form method="post" action="([^"]+)">([\s\S]*?)<\/form>/);
  assert.ok(form, 'one form');
  assert.equal(form[1], COPILOT_PACKAGE_PATH);
  assert.equal(COPILOT_PACKAGE_PATH, '/connect/copilot-package');
  assert.ok(form[2]!.includes('<label for="reference-id">OAuth client registration ID (from the Teams Developer Portal)</label>'));
  assert.match(form[2]!, /<input class="input" id="reference-id" name="reference_id" type="text" required/);
  assert.ok(form[2]!.includes('<button class="btn btn--primary" type="submit">Download the Legallas agent</button>'));
  assert.equal(connectHtml.split('<form').length - 1, 1);
  assert.ok(connectHtml.indexOf(form[0]) > connectHtml.indexOf('id="copilot-it"'), 'inside the Copilot IT steps');
});

test('the /connect route serves GET and HEAD with the page headers, and refuses other methods', async () => {
  // oauth.ts route() serves /connect through publicPage since #426; connect.ts no longer has its own handler.
  const get = (env: Partial<McpEnv>, method = 'GET') => route(new Request(`${MCP_ORIGIN}${CONNECT_PATH}`, { method }), env as McpEnv);
  for (const method of ['GET', 'HEAD']) {
    const res = await get({}, method);
    assert.equal(res.status, 200, method);
    assert.ok(!(res.headers.get('content-security-policy') ?? '').includes('script-src'), method);
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  }
  const page = await (await get({})).text();
  assert.ok(page.includes('Connect your AI') && page === connectHtml, 'no shared registration ID: today\'s page');
  // Pro sets the agent options from COPILOT_REFERENCE_ID (mcp/pro.ts; copilot-package.test.ts); the core alone has none.
  assert.equal(await (await get({ COPILOT_REFERENCE_ID: 'test-registration-id' })).text(), connectHtml, 'without pro, the ID changes nothing');
  const founder = await (await route(new Request(`${MCP_ORIGIN}${CONNECT_PATH}?for=founder`), {} as McpEnv)).text();
  assert.equal(founder, renderConnectPage({ reader: 'founder' }), '?for= picks the panel (worker/invite.ts)');
  assert.ok(!founder.includes('data-ai="harvey"') && founder.includes('id="harvey"'), 'the founder\'s panel has no Harvey card; the section stays');
  const post = await get({}, 'POST');
  assert.deepEqual([post.status, post.headers.get('allow')], [405, 'GET, HEAD']);
});
