// SPDX-License-Identifier: Apache-2.0
// The Copilot steps on /connect: the IT checklist, the Legallas agent, the connector as the alternative, Copilot
// Studio and the "If something goes wrong" table. The page and the setup guide carry the same text, the docs print the Reference ID the mcp config
// sets, and every message the table quotes from this server matches the code that sends it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readWranglerConfig } from '../../worker/wrangler-config.ts';
import { COPILOT_PACKAGE_PATH, MCP_ORIGIN, MCP_RESOURCE } from '../contract.ts';
import { TOOLS, renderConnectPage } from './connect.ts';
import {
  AGENT_ZIP_PATH,
  ALLOW_HOSTS,
  ANY_TEAMS_APP,
  COPILOT_CHECKLIST,
  COPILOT_TROUBLE,
  DLP_PATTERN,
  ORG_AGENTS_SETTING,
  REFERENCE_ID_FIELD,
  cellText,
  copilotConnectorSection,
  copilotPackageSection,
  troubleTable,
} from './connect-copilot.ts';
import { escapeHtml } from './html.ts';
import { CODE_SENDER, CODE_SENDER_IPS, SIGN_IN_CODE_GUIDE, SIGN_IN_CODE_ID } from './sign-in-code.ts';

const html = renderConnectPage();
const itStart = html.indexOf('<details class="cx-it" id="copilot-it">');
const it = html.slice(itStart, html.indexOf('</details>', itStart));
const guide = readFileSync(join(import.meta.dirname, '..', '..', 'connect', 'copilot.md'), 'utf8');
const source = (file: string) => readFileSync(join(import.meta.dirname, '..', file), 'utf8');
/** A shared registration's Reference ID, as mcp/oauth.ts passes it from COPILOT_REFERENCE_ID. */
const SHARED_ID = 'U2hhcmVkUmVnaXN0cmF0aW9uSWQ';
/** True when every part appears in `text`, each after the one before. */
const inOrder = (text: string, parts: readonly string[]) => {
  let at = 0;
  for (const part of parts) {
    const i = text.indexOf(part, at);
    if (i < 0) return false;
    at = i + part.length;
  }
  return true;
};

test('the Copilot IT steps open with the checklist, then the agent, the connector and Copilot Studio, and end with the table', () => {
  assert.ok(itStart > 0, 'the Copilot IT section exists');
  const at = ['<h4>Before you start: the IT checklist</h4>', copilotPackageSection(false),
    '<h4 id="copilot-connector">Alternative, if your firm prefers a connector</h4>', '<h4>Other option: Copilot Studio</h4>',
    'id="copilot-trouble"'].map((part) => it.indexOf(part));
  assert.ok(at.every((i, n) => i > 0 && (n === 0 || i > at[n - 1]!)), `in order: ${at.join(', ')}`);
  assert.ok(it.startsWith('<details class="cx-it" id="copilot-it">\n<summary>For your IT team (once)</summary>\n<div><h4>Before you start: the IT checklist</h4>'), 'the checklist first');
  assert.ok(!/known issue/i.test(html), 'no bug note: Microsoft fixed the tool index (live test 2026-10-21)');
  assert.equal(html.split('id="copilot-trouble"').length - 1, 1, 'one table');
});

test('the connector, the alternative: the admin center path, the server, OAuth 2.0 with the Reference ID, Authorize, rollout and Ready', () => {
  const shared = copilotConnectorSection(SHARED_ID);
  const steps = shared.match(/<ol>([\s\S]*?)<\/ol>/)?.[1]?.split('<li>').slice(1) ?? [];
  assert.equal(steps.length, 4);
  assert.ok(steps[0]!.includes('Microsoft 365 admin center &gt; <strong>Copilot</strong> &gt; <strong>Connectors</strong> &gt; <strong>Gallery</strong> &gt; <strong>Create a new connector</strong> &gt; <strong>Connect to MCP server</strong>'));
  for (const value of ['Legallas counsel room', MCP_RESOURCE, SHARED_ID]) assert.ok(steps[1]!.includes(`<code class="cx-copy">${value}</code>`), `step 2: ${value}`);
  assert.ok(steps[1]!.includes('<strong>OAuth 2.0</strong>, with the Reference ID'));
  assert.ok(inOrder(steps[2]!, ['<strong>Authorize</strong>', 'room email', 'notice terms', '<strong>Create</strong>']), 'step 3');
  assert.ok(inOrder(steps[3]!, ['staged rollout', '<strong>Ready</strong> in about 10 to 15 minutes']), 'step 4');
  assert.ok(shared.includes('A data source each member turns on in Copilot Chat') && shared.includes('with a Copilot licence per member'));
  assert.ok(!shared.includes('Send login code'), 'the sign-in steps stay in #sign-in');
  const own = copilotConnectorSection(null);
  assert.ok(!own.includes('Reference ID') && own.includes("your firm's own registration ID (the agent's steps 1 and 2)"), 'unset: the firm registers its own');
  assert.ok(own.includes('<strong>Connect to MCP server</strong>') && own.includes(`<code class="cx-copy">${MCP_RESOURCE}</code>`), 'unset: the path and the server, in one paragraph');
  assert.ok(html.includes(own), 'the default page');
  assert.ok(renderConnectPage({ copilotPackage: true, copilotReferenceId: SHARED_ID }).includes(shared), 'the page shows the shared ID');
});

test('the agent leads: tested live in Outlook, Teams and Word, one primary download link and three IT steps', () => {
  const block = copilotPackageSection(true);
  assert.equal(AGENT_ZIP_PATH, '/connect/legallas-agent.zip');
  assert.ok(block.startsWith('<h4 id="copilot-agent">The Legallas agent for Microsoft 365</h4>'));
  assert.ok(block.includes('tested live on 2026-10-21 in Outlook, Teams and Word'));
  assert.ok(block.includes('Each needs a Microsoft 365 Copilot licence (or Copilot Business) or the firm\'s Copilot pay-as-you-go billing'), 'the licence it needs');
  assert.ok(!block.includes('no Copilot licence'), 'never the old claim that Copilot Chat alone is enough');
  assert.equal(block.split('<a ').length - 1, 1, 'the download only');
  assert.ok(block.includes(`<a class="btn btn--primary" href="${AGENT_ZIP_PATH}">Download the Legallas agent for Microsoft 365</a>`));
  assert.ok(!block.includes('<form') && !block.includes('client ID') && !block.includes('Developer Portal'), 'nothing to register');
  // The guide's three wizard steps (copilot.md, The Legallas agent for Microsoft 365), its "Before you upload" line first.
  const steps = block.match(/<ol>([\s\S]*?)<\/ol>/)?.[1]?.split('<li>').slice(1) ?? [];
  assert.equal(steps.length, 3);
  assert.match(steps[0]!, /Microsoft 365 admin center &gt; <strong>Agents<\/strong> &gt; <strong>All agents<\/strong> &gt; <strong>Add agent<\/strong>: choose the ZIP/);
  assert.ok(steps[1]!.includes('under both <strong>Publish</strong> and <strong>Install</strong>'), 'preinstalled, not left in the Agent Store');
  assert.ok(steps[2]!.includes('<strong>Next</strong>, <strong>Next</strong>, then <strong>Publish</strong>'), 'the pages that ask for nothing');
  const before = block.slice(0, block.indexOf('<ol>'));
  assert.ok(before.includes(`<strong>Agents</strong> &gt; <strong>Settings</strong>, "${ORG_AGENTS_SETTING}" is ticked and the members are in <strong>User access</strong>`));
  assert.ok(before.includes('checklist steps 5 and 6.'), 'the checklist holds the hosts and the sender');
  // ...and those two checks do: every host in step 5, the sender and the code help link in step 6.
  const checks = COPILOT_CHECKLIST.match(/<ol class="cx-check">([\s\S]*?)<\/ol>/)?.[1]?.split('<li>').slice(1) ?? [];
  assert.equal(checks.length, 7);
  for (const host of ALLOW_HOSTS) assert.ok(checks[4]!.includes(escapeHtml(host)), `checklist step 5: ${host}`);
  assert.ok(checks[5]!.includes(escapeHtml(CODE_SENDER)) && checks[5]!.includes(`<a href="#${SIGN_IN_CODE_ID}">`), 'checklist step 6: the sender and the code help');
  const own = copilotPackageSection(false);
  assert.ok(own.startsWith('<h4 id="copilot-agent">The Legallas agent</h4>') && own.includes('a Copilot licence (or pay-as-you-go) per member'), 'the per-firm block');
});

test('the per-firm block keeps the registration ID form posting to the package route', () => {
  const block = copilotPackageSection(false);
  assert.ok(block.includes(`<form method="post" action="${COPILOT_PACKAGE_PATH}">`));
  assert.ok(block.includes(`name="${REFERENCE_ID_FIELD}"`) && REFERENCE_ID_FIELD === 'reference_id');
  assert.ok(!block.includes(AGENT_ZIP_PATH));
});

test('the member steps: the agent in Outlook, Word and Teams, then the connector instead; the guide says the same', () => {
  const copilot = TOOLS.find((t) => t.id === 'copilot')!; // safe: TOOLS lists copilot
  const member = `${copilot.steps.you.join('\n')}\n${copilot.after({})}`;
  assert.ok(inOrder(member, ["Open Copilot's agents", 'in Outlook or Word, the <strong>Copilot</strong> pane', 'in Teams, the <strong>Copilot</strong> app in the left rail',
    '<strong>Agents</strong>, not the @ list', '<strong>Legallas counsel room</strong>', 'Ask a question', '<strong>Sign in to Legallas counsel room</strong>',
    '<a href="#sign-in">Signing in</a>', 'Choose <strong>Connect</strong>.', 'Your firm added the connector instead?', '<strong>+</strong> &gt; <strong>Change data sources</strong>',
    '<strong>Continue to Legallas counsel room</strong>', '<strong>New chat</strong>', '"read and write"', 'every Legallas tool is read-only']), 'the page, in order');
  const agent = guide.slice(guide.indexOf('## What you do'), guide.indexOf('### If your firm added the connector instead'));
  assert.ok(inOrder(agent, ["Open Copilot's agents and choose **Legallas counsel room**", 'In Outlook or Word: open the **Copilot** pane',
    'In Teams: open the **Copilot** app in the left rail, then **Agents**', 'not in the @ mention list', 'Ask a question.',
    '**Sign in to Legallas counsel room**', '**Send login code**', '**Connect**']), 'the guide: the agent');
  const connector = guide.slice(guide.indexOf('### If your firm added the connector instead'), guide.indexOf('### Good questions'));
  assert.ok(inOrder(connector, ['Microsoft 365 Copilot Chat (the Work tab)', '**+**, then **Change data sources**', '**Settings** > **Sources**',
    '**Legallas counsel room**', '**Connect**', '**Continue to Legallas counsel room**', '**Send login code**', '**Connect**',
    '"Legallas counsel room is now connected"', '**New chat**', '"read and write"', 'every Legallas tool is read-only']), 'the guide: the connector');
});

test('the guide leads with the Legallas agent and its per-firm fallback, then the connector, then Studio, and has the owner\'s appendix', () => {
  const agent = guide.indexOf('### The Legallas agent for Microsoft 365');
  const connector = guide.indexOf('### Alternative, if your firm prefers a connector');
  const studio = guide.indexOf('### Other option: Copilot Studio');
  assert.ok(agent > 0 && agent < connector && connector < studio, 'the agent leads, then the connector, then Studio');
  assert.ok(guide.slice(agent, connector).replace(/\n/g, ' ').includes('it signed in and answered in Outlook on the web, Teams and Word'), 'tested live in all three');
  assert.ok(!/known issue|gets no tools/i.test(guide), 'no bug note');
  assert.ok(!guide.includes('### Copilot Studio'), 'no Studio heading ahead of it');
  assert.ok(guide.includes(`${MCP_ORIGIN}${AGENT_ZIP_PATH}`), 'the download link');
  assert.ok(guide.includes('**Download the Legallas agent for Microsoft 365**'), 'the page button, by name');
  const fallback = guide.indexOf("#### If the download is not offered: your firm's own registration");
  assert.ok(fallback > agent && fallback < connector, 'the per-firm fallback sits under the agent');
  assert.ok(guide.includes('| Restrict usage by organization | My organization only (the default) |'), 'the firm registers for its own tenant');
  assert.ok(!guide.includes('MC1162288') && !guide.includes('without a Copilot licence (Microsoft lists'), 'no claim that Copilot Chat alone is enough');
  assert.ok(guide.includes('| The agent answers that no Legallas tools are available, and no Sign in button appears |'), 'the no-licence row');
  const founder = guide.slice(guide.indexOf('### I. For the owner: the shared registration'));
  assert.ok(founder.length > 0 && guide.includes('### I. For the owner: the shared registration'));
  for (const text of ['| Restrict usage by organization | **Any Microsoft 365 organization**', '`https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect`',
    '/admin/clients', '`COPILOT_REFERENCE_ID`', `| Restrict usage by Teams app | **${ANY_TEAMS_APP}**`]) {
    assert.ok(founder.includes(text), `appendix I: ${text}`);
  }
});

test('Microsoft\'s labels, as its screens show them, are the same on the page and in the guide', () => {
  assert.equal(ORG_AGENTS_SETTING, 'Allow apps, agents, and plugins built by your organization');
  assert.equal(ANY_TEAMS_APP, 'Any Teams app (for testing and store validation only)');
  assert.ok(it.includes(`"${ORG_AGENTS_SETTING}"`), 'page: the agent settings box');
  assert.equal(guide.split(`"${ORG_AGENTS_SETTING}"`).length - 1, 3, 'guide: before the upload, checklist step 4 and the blocked-plugin row');
  assert.ok(!guide.includes('Allow agents and plugins built by your organization'), 'the old label is gone');
  assert.ok(copilotPackageSection(false).includes(`<strong>${ANY_TEAMS_APP}</strong>`), 'page: the per-firm registration');
  assert.equal(guide.split(`| Restrict usage by Teams app | **${ANY_TEAMS_APP}**`).length - 1, 2, 'guide: both Developer Portal tables');
  assert.equal(guide.split('| Enable Proof Key for Code Exchange (PKCE) | Turn it on (it starts off) |').length - 1, 2, 'PKCE starts off');
  assert.ok(guide.includes('https://admin.cloud.microsoft/'), 'the admin center address');
});

test('the checklist names the hosts, the code sender and the data policy pattern, on the page and in the guide', () => {
  assert.deepEqual(ALLOW_HOSTS, ['mcp.room.example.com', 'room.example.com', 'room.cloudflareaccess.com']);
  assert.equal(DLP_PATTERN, `${MCP_ORIGIN}*`);
  for (const value of [...ALLOW_HOSTS, CODE_SENDER, DLP_PATTERN]) {
    assert.ok(it.includes(escapeHtml(value)), `page: ${value}`);
    assert.ok(guide.includes(value), `guide: ${value}`);
  }
  assert.equal(it.match(/<ol class="cx-check">([\s\S]*?)<\/ol>/)?.[1]?.split('<li>').length, 8, 'seven checks');
  assert.ok(it.includes('Members need no Copilot Studio licence, but the Legallas agent needs a Copilot licence or pay-as-you-go for each.'), 'step 1: what members need');
  assert.ok(it.includes('a Copilot licence (or pay-as-you-go) per member') && it.includes('(a Copilot licence each)'), 'what each member needs: the agent, then the connector');
  assert.ok(!it.includes('need none'), 'never that members need no licence at all');
  assert.ok(COPILOT_TROUBLE.some((r) => r.see === 'The agent answers that no Legallas tools are available, and no Sign in button appears'), 'the no-licence row is on the page');
});

test('the email step links the shared sign-in code block instead of repeating it', () => {
  assert.ok(it.includes(`<a href="#${SIGN_IN_CODE_ID}">If the sign-in code doesn't arrive</a>`), 'page step 6 links the block');
  assert.equal(html.split(`id="${SIGN_IN_CODE_ID}"`).length - 1, 1, 'the block is on the page once');
  assert.ok(!it.includes(CODE_SENDER_IPS), 'the sending IPs live in the block, not the Copilot steps');
  assert.ok(html.includes(CODE_SENDER_IPS), 'the block carries them');
  assert.ok(guide.includes(`(${SIGN_IN_CODE_GUIDE})`), 'the guide links the setup kit section');
  const readme = readFileSync(join(import.meta.dirname, '..', '..', 'connect', 'README.md'), 'utf8');
  assert.ok(readme.includes("### If the sign-in code doesn't arrive"), 'the anchor the guide links exists');
  assert.ok(!guide.includes(CODE_SENDER_IPS), 'the guide does not repeat the IPs');
});

test('every row is on the page, escaped, and its "what you see" text is in the guide word for word', () => {
  assert.ok(COPILOT_TROUBLE.length >= 20, `${COPILOT_TROUBLE.length} rows`);
  for (const row of COPILOT_TROUBLE) {
    assert.ok(it.includes(`<tr><td>${cellText(row.see)}</td><td>${cellText(row.fix)}</td></tr>`), row.see);
    assert.ok(guide.includes(`| ${row.see} |`), `guide row: ${row.see}`);
    assert.ok(!row.see.includes('|') && !row.fix.includes('|'), 'no pipes, so the guide table stays one row');
  }
  const seen = COPILOT_TROUBLE.map((row) => row.see);
  assert.equal(new Set(seen).size, seen.length, 'no duplicate rows');
});

test('the table escapes markup in its cells and keeps quotes as typed', () => {
  const out = troubleTable([{ see: '<b>"x"</b>', fix: "a & b's" }]);
  assert.ok(out.includes(`<td>&lt;b&gt;"x"&lt;/b&gt;</td><td>a &amp; b's</td>`));
  assert.ok(out.includes('<th scope="col">What you see</th><th scope="col">What to do</th>'));
});

test('the messages the page and guide quote are the ones the code sends', () => {
  const authorize = source('authorize.ts');
  const server = source('server.ts');
  const away = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'pages', 'welcome', 'away', 'index.astro'), 'utf8');
  const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // [error page title, a sentence of its message as authorize.ts sends it]: the guide quotes each.
  for (const [title, sentence] of [
    ['App not allowed', 'Only Harvey, Microsoft Copilot and Claude (claude.ai and the Claude apps) can connect to the counsel room.'],
    ['No access', 'which is not a member of the counsel room.'],
    ['This page has expired', 'A sign-in page works once, for 10 minutes, in the browser that opened it.'],
  ] as const) {
    assert.ok(authorize.includes(`'${title}'`) && authorize.includes(sentence), `authorize.ts sends ${title}`);
    assert.match(guide, new RegExp(`\\| "${escaped(title)}: [^"|]*${escaped(sentence)}`), `the guide quotes ${title}`);
  }
  assert.ok(COPILOT_TROUBLE.some((r) => r.see.startsWith('"App not allowed: Only Harvey, Microsoft Copilot and Claude (claude.ai and the Claude apps)')), 'the page row');
  assert.ok(away.includes('Sign-in works only from the United States.') && COPILOT_TROUBLE.some((r) => r.see.startsWith('"Sign-in works only from the United States."')));
  assert.ok(guide.includes('| "Sign-in works only from the United States." for a member who is in the United States |'), 'the guide quotes it');
  for (const [code, message] of [
    ['daily_limit', 'The daily limit for AI tool calls is reached. It resets at midnight UTC.'],
    ['rate_limited', 'Too many tool calls in one minute. Wait a minute, then try again.'],
    ['not_a_member', 'This connection no longer has access to the counsel room. Ask the room owner.'],
  ] as const) {
    assert.ok(server.includes(`toolError('${code}', '${message}')`), `server.ts sends ${code}`);
    assert.ok(COPILOT_TROUBLE.some((r) => r.see.includes(`"${code}: ${message}"`)), `a row quotes ${code}`);
    assert.ok(guide.includes(`| "${code}: ${message}" |`), `the guide quotes ${code}`);
  }
  assert.ok(source('oauth.ts').includes("code: 'invalid_redirect_uri'"), 'a refused registration names invalid_redirect_uri');
  assert.ok(COPILOT_TROUBLE.some((r) => r.see.includes('invalid_redirect_uri')));
});

test('the Copilot table links the page\'s own sign-in help instead of repeating its rows', () => {
  assert.ok(it.includes('<a href="#help">On the sign-in page</a>'), 'links the shared section');
  assert.ok(html.includes('id="help"'), 'which is on the page');
  for (const shared of ['"No access', '"This page has expired', '"That account does not have access.', '"This One-Time PIN', 'No sign-in code']) {
    assert.ok(!COPILOT_TROUBLE.some((r) => r.see.startsWith(shared)), `not repeated on the page: ${shared}`);
  }
});

test('the IT email points at the checklist', () => {
  const copilot = TOOLS.find((t) => t.id === 'copilot')!; // safe: TOOLS lists copilot
  assert.ok(copilot.mail.lines.some((line) => line.includes('IT checklist')));
});

test('the guide prints the Reference ID that wrangler.mcp.jsonc sets', () => {
  // The room's own file, or in a checkout without one the example, whose ID is empty: then the docs print none.
  const { raw: config, example } = readWranglerConfig('wrangler.mcp');
  const id = config.match(/"COPILOT_REFERENCE_ID":\s*"([^"]*)"/)?.[1];
  assert.ok(id !== undefined, 'the config sets COPILOT_REFERENCE_ID');
  // A Reference ID is long base64; nothing else in these docs is. Unset (""), the docs must print none.
  const printed = (text: string) => [...new Set(text.match(/[A-Za-z0-9+/]{60,}={0,2}/g) ?? [])];
  // This guide is the product's, and a room's ID is never in it, so the example prints none. In a room's checkout the
  // guide may still be the product's; if a room's own copy prints an ID, it must be exactly the one its config sets.
  const shown = printed(guide);
  if (example) assert.deepEqual(shown, [], 'copilot.md: the connector steps and appendix G');
  else assert.deepEqual(shown.filter((one) => one !== id), [], 'copilot.md: the connector steps and appendix G');
});
