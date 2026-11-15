// SPDX-License-Identifier: Apache-2.0
// The Harvey setup copy (web/connect/harvey.md and the /connect Harvey section) against what the server and
// Cloudflare Access really show, so a firm's "If something goes wrong" table never quotes a message that has changed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { refusedRedirectEmail } from '../alert.ts';
import { MCP_RESOURCE, PROFILE_OF } from '../contract.ts';
import { isAllowedRedirect } from '../redirects.ts';
import { clientKindOf } from '../server.ts';
import { renderConnectPage } from './connect.ts';
import { CONTACT } from './html.ts';

/** Harvey's app hosts in the US, the EU and Australia (the harvey.ai region menu, read 2026-10-20). */
const HARVEY_REGIONS = ['app.harvey.ai', 'eu.app.harvey.ai', 'au.app.harvey.ai'];

const here = import.meta.dirname;
const guide = readFileSync(join(here, '..', '..', 'connect', 'harvey.md'), 'utf8');
const source = (file: string) => readFileSync(join(here, '..', file), 'utf8');
const html = renderConnectPage();
const harveyAt = html.indexOf('<section class="cx-tool prose" id="harvey"');
const harvey = html.slice(harveyAt, html.indexOf('</section>', harveyAt));
const help = html.slice(html.indexOf('<section class="cx-tool prose" id="help"'));
/** The setup kit's shared sign-in code help (web/connect/README.md), which the guide links to instead of repeating. */
const CODE_HELP_LINK = "[If the sign-in code doesn't arrive](README.md#if-the-sign-in-code-doesnt-arrive)";

/** Messages the server renders (file, exact text): each must still exist there, and the guide must quote it. */
const SERVER_MESSAGES: ReadonlyArray<[string, string]> = [
  ['authorize.ts', 'Sign in first'],
  ['authorize.ts', 'which is not a member of the counsel room.'],
  ['authorize.ts', 'App not allowed'],
  ['authorize.ts', 'This link cannot be used'],
  ['authorize.ts', 'This page has expired'],
  ['authorize.ts', 'App details unavailable'],
  ['authorize.ts', 'Connection not made'],
  ['oauth.ts', "This redirect URI is not on the server's list."],
  ['oauth.ts', 'Client metadata is too large.'],
  ['oauth.ts', 'Dynamic client registration is not open on this server.'],
  ['server.ts', "'rate_limited', 'Too many tool calls in one minute."],
  ['server.ts', "'daily_limit', 'The daily limit for AI tool calls is reached."],
  ['server.ts', "'not_a_member', 'This connection no longer has access to the counsel room."],
  // The room's Access deny pages (web/src/pages/welcome/), which the sign-in app on mcp.room also uses.
  ['../src/pages/welcome/away/index.astro', 'Sign-in works only from the United States.'],
  ['../src/pages/welcome/denied/index.astro', 'This room is private.'],
];

/** Cloudflare Access's one-time PIN messages, from its documentation (the guide's Sources). */
const ACCESS_MESSAGES = ['A code has been emailed to you', 'This One-Time PIN has already been used', 'That account does not have access.'];

test('every message the Harvey guide quotes is one the server still shows', () => {
  const flat = guide.replace(/\n\s*/g, ' ');
  for (const [file, text] of SERVER_MESSAGES) {
    assert.ok(source(file).includes(text), `${file} still says: ${text}`);
    const quoted = text.replace(/\\'/g, "'").replace(/^'([a-z_]+)', '/, '$1: ');
    assert.ok(flat.includes(quoted), `harvey.md quotes: ${quoted}`);
  }
  for (const text of ACCESS_MESSAGES) assert.ok(flat.includes(text), `harvey.md quotes Access: ${text}`);
});

test('the guide links the shared sign-in code help, and names what to let through and the owner\'s /admin/clients steps', () => {
  assert.ok(readFileSync(join(here, '..', '..', 'connect', 'README.md'), 'utf8').includes("### If the sign-in code doesn't arrive"), 'the block the link opens');
  assert.ok(guide.split(CODE_HELP_LINK).length - 1 >= 2, 'linked for the lawyer and for IT');
  for (const text of [
    '`mcp.room.example.com`',
    '`room.cloudflareaccess.com`',
    '`room.example.com`',
    '### Checklist',
    '### For the owner: allowing a Harvey callback that is not on the list',
    '`https://mcp.room.example.com/admin/clients`',
    '**Sign-in callbacks waiting for approval**',
    'Legallas: an AI app sign-in callback was refused',
    MCP_RESOURCE,
  ]) {
    assert.ok(guide.includes(text), `harvey.md: ${text}`);
  }
  assert.equal(refusedRedirectEmail('https://evil.example/cb').subject, 'Legallas: an AI app sign-in callback was refused', 'the email subject the guide names');
  assert.ok(source('pages/admin.ts').includes("'Sign-in callbacks waiting for approval'"), 'the heading the guide names');
});

test('the /connect Harvey section links the shared help, and #help has an In Harvey group', () => {
  const it = harvey.slice(harvey.indexOf('<details class="cx-it" id="harvey-it">'));
  for (const text of ['href="#sign-in-code"', 'href="#help"', 'callback or redirect error', 'client ID and secret', `href="mailto:${CONTACT}"`]) {
    assert.ok(it.includes(text), `IT steps: ${text}`);
  }
  assert.ok(it.includes('Never let a member type their code into your session.'), 'the admin is warned off a member\'s code');
  const signIn = help.indexOf('<h3>On the sign-in page</h3>');
  const inClaude = help.indexOf('<h3>In Claude</h3>');
  const inCopilot = help.indexOf('<h3>In Microsoft 365 Copilot</h3>');
  const inHarvey = help.indexOf('<h3>In Harvey</h3>');
  assert.ok(signIn > 0 && signIn < inClaude && inClaude < inCopilot && inCopilot < inHarvey, 'order: the page\'s, Claude, Microsoft 365 Copilot, Harvey');
  assert.ok(help.slice(inHarvey, help.indexOf('<h3>', inHarvey + 1)).includes('&ldquo;App not allowed&rdquo;'), 'the Harvey row for a new callback');
});

test('every Harvey region the guide names needs no callback step and gets Harvey\'s standard text results', () => {
  for (const host of HARVEY_REGIONS) {
    const callback = `https://${host}/oauth/callback`;
    assert.ok(isAllowedRedirect(callback, {}), `${host}: allowed by default`);
    assert.equal(clientKindOf([callback]), 'harvey', host);
    assert.equal(PROFILE_OF[clientKindOf([callback])], 'standard', host);
    assert.ok(guide.includes(`\`${host}\``), `${host}: named in the guide`);
  }
});
