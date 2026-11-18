// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  CLIENT_REGISTRATION_TTL_SECONDS,
  CONNECT_PATH,
  DAILY_DOWNLOAD_CAP,
  DEFAULT_DAILY_TOOL_CAP,
  MCP_ORIGIN,
  REFRESH_TOKEN_TTL_SECONDS,
} from '../contract.ts';
import { route } from '../oauth.ts';
import { COUNSEL, OWNER, fakeEnv } from '../oauth-fakes.ts';
import { BRIEF_FILE, GENERATED_FILE, renderBriefModule } from '../../scripts/security-brief.ts';
import { renderConnectPage } from './connect.ts';
import { SECURITY_BRIEF_MD } from './security-brief.generated.ts';
import { BRIEF_PLACEHOLDERS, SECURITY_PATH, fillBrief, renderSecurityPage, type BriefNames } from './security.ts';
import { slug } from './markdown.ts';

const BRIEF = readFileSync(BRIEF_FILE, 'utf8');
const GENERATED = readFileSync(GENERATED_FILE, 'utf8');
const page = renderSecurityPage();
/** `html` with every tag (`<`, at least one character, `>`) taken out, as `/<[^>]+>/g` would, without a regular expression. */
function stripTags(html: string): string {
  let out = '';
  let from = 0;
  let open = html.indexOf('<');
  while (open !== -1) {
    const close = html.indexOf('>', open + 1);
    if (close === -1) break;
    if (close > open + 1) {
      out += html.slice(from, open);
      from = close + 1;
      open = html.indexOf('<', from);
    } else open = html.indexOf('<', open + 1);
  }
  return out + html.slice(from);
}
/** The page's text: tags out, entities undone, `&amp;` last so `&amp;lt;` reads `&lt;`. */
const text = (html: string) => stripTags(html).replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&');

test('the page carries connect/security-brief.md word for word: the generated module is the brief', () => {
  assert.equal(SECURITY_BRIEF_MD, BRIEF, 'run node scripts/security-brief.ts');
  assert.equal(GENERATED, renderBriefModule(BRIEF), 'run node scripts/security-brief.ts');
});

test('every section, table row and list item of the brief is on the page, with no Markdown left over', () => {
  const shown = text(page).replace(/\s+/g, ' ');
  const headings = [...BRIEF.matchAll(/^## +(.+)$/gm)].map((m) => m[1]!.trim());
  for (const name of ['Data flow', 'Controls', 'Prompt injection', 'Subprocessors and location', 'Revoking access']) assert.ok(headings.includes(name), name);
  for (const heading of headings) {
    assert.ok(page.includes(`<h2 id="${slug(heading)}">`), heading);
    assert.ok(page.includes(`<li><a href="#${slug(heading)}">`), `contents: ${heading}`);
  }
  const plain = (s: string) => s.replace(/`|\*\*/g, '').replace(/\\\|/g, '|').replace(/\s+/g, ' ').trim();
  for (const row of BRIEF.matchAll(/^\| *([^|]+?) *\|/gm)) {
    if (!/^:?-+:?$/.test(row[1]!)) assert.ok(shown.includes(plain(row[1]!)), `table cell: ${row[1]}`);
  }
  for (const item of BRIEF.matchAll(/^- (.+)$/gm)) assert.ok(shown.includes(plain(item[1]!).slice(0, 60)), `list item: ${item[1]}`);
  assert.ok(!/\*\*|```|\|---|^#+ /m.test(text(page)), 'no raw Markdown');
  assert.ok(page.includes('<p class="lead">For the security, IT and risk teams (a firm&#39;s or a company&#39;s)'), 'the opening paragraph leads');
  assert.ok(!page.includes('legallas-mcp: security brief'), 'the page keeps its own h1');
});

test("the brief takes the room's names and hosts in one pass, escaped on the page", () => {
  const room: BriefNames = {
    mcpOrigin: 'https://mcp.rooms.test',
    mcpHost: 'mcp.rooms.test',
    contact: 'security@rooms.test',
    website: 'https://rooms.test',
    owner: 'Sam <b>Doe</b>',
    operator: 'Doe Holdings, L.L.C.',
  };
  const filled = fillBrief(BRIEF, room);
  for (const placeholder of ['example.com', 'the owner', 'The owner']) assert.ok(!filled.includes(placeholder), placeholder);
  assert.ok(filled.includes('Operator: **Doe Holdings, L.L.C.**'));
  assert.ok(filled.includes('Security contact: security@rooms.test (as published in https://rooms.test/.well-known/security.txt)'));
  assert.ok(filled.includes('legallas-mcp (Cloudflare Worker, mcp.rooms.test)'));
  assert.ok(filled.includes('`https://mcp.rooms.test/connections`'));
  assert.equal(fillBrief(BRIEF, BRIEF_PLACEHOLDERS), BRIEF, 'a room with no settings shows the brief as written');
  const html = renderSecurityPage(room);
  assert.ok(html.includes('Sam &lt;b&gt;Doe&lt;/b&gt;') && !html.includes('<b>Doe</b>'));
  assert.ok(html.includes('<a href="https://mcp.rooms.test/connect">https://mcp.rooms.test/connect</a>'));
});

test("the brief's numbers are the code's", () => {
  const flat = BRIEF.replace(/\s+/g, ' ');
  const days = (seconds: number) => `${seconds / 86_400} days`;
  assert.ok(flat.includes(`Access tokens last ${ACCESS_TOKEN_TTL_SECONDS / 3600} hour.`));
  assert.ok(flat.includes(`expire ${days(REFRESH_TOKEN_TTL_SECONDS)} after sign-in`));
  assert.ok(flat.includes(`a registration left unused for ${days(CLIENT_REGISTRATION_TTL_SECONDS)} expires`));
  assert.ok(flat.includes(`A daily cap of ${DEFAULT_DAILY_TOOL_CAP.toLocaleString('en-US')} tool calls per member`));
  assert.ok(flat.includes(`at most ${DAILY_DOWNLOAD_CAP} file pulls`));
});

test('GET /security is public, with the same headers as /connect, and the same whatever the room sets', async () => {
  const secrets = {
    AI_ZDR_CLIENTS: 'zdr-client-7f3a',
    MCP_REDIRECT_ALLOW: 'https://callback.firm-only.test/cb,http://localhost',
    CONTROL_PREFIX: 'ZZQ',
    COPILOT_REFERENCE_ID: 'ref-91b2',
    PUBLIC_RECORDS_CONTACT: 'records@firm-only.test',
  };
  const loose = { ...secrets, REQUIRE_MFA: '0', DCR_ENABLED: '1', MCP_ORIGIN_ENFORCE: '0', DAILY_TOOL_CAP: '9999' };
  const strict = { REQUIRE_MFA: '1', DCR_ENABLED: '0', MCP_ORIGIN_ENFORCE: '1', AI_POLICY: 'zdr' };
  const env = fakeEnv(undefined, loose as never);
  const response = await route(new Request(`${MCP_ORIGIN}${SECURITY_PATH}`), env);
  assert.equal(response.status, 200);
  const connect = await route(new Request(`${MCP_ORIGIN}${CONNECT_PATH}`), env);
  for (const name of ['content-type', 'content-security-policy', 'x-frame-options', 'referrer-policy', 'x-content-type-options', 'cache-control']) {
    assert.equal(response.headers.get(name), connect.headers.get(name), name);
  }
  assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  const html = await response.text();
  const other = await (await route(new Request(`${MCP_ORIGIN}${SECURITY_PATH}`), fakeEnv(undefined, strict as never))).text();
  assert.equal(html, other, 'no live setting reaches the public page');
  for (const value of [...Object.values(secrets), COUNSEL, OWNER, 'firm-only', '9,999', '9999']) assert.ok(!html.includes(value), value);
  assert.ok(!/<script|<form|<iframe|<img/i.test(html), 'no scripts, forms, frames or images');
  assert.equal((await route(new Request(`${MCP_ORIGIN}${SECURITY_PATH}`, { method: 'HEAD' }), env)).status, 200);
  assert.equal((await route(new Request(`${MCP_ORIGIN}${SECURITY_PATH}`, { method: 'POST' }), env)).status, 405);
});

test('/connect links to /security, and /security back to /connect; every contents link has its target', () => {
  const connect = renderConnectPage();
  assert.ok(connect.includes(`<a href="${SECURITY_PATH}">Security</a>`));
  assert.equal(connect.split(`href="${SECURITY_PATH}"`).length - 1, 1, 'the footer');
  assert.ok(page.includes(`<a href="${CONNECT_PATH}">Connect your AI</a>`));
  for (const [, id] of page.matchAll(/<li><a href="#([^"]+)">/g)) assert.ok(page.includes(` id="${id}"`), id);
});
