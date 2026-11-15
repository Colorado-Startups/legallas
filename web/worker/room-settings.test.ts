// SPDX-License-Identifier: Apache-2.0
// Each room setting reaches what counsel and the room's own mail read, and with none set the room says what it always did.
// A Node process with the globals set sees what a build with the same defines sees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sentence } from './room-settings.ts';

const WEB = join(import.meta.dirname, '..');

const SET = {
  ROOM_INSTANCE_NAME: 'Acme Room',
  ROOM_HOST: 'room.acme.example',
  ROOM_MCP_HOST: 'ai.acme.example',
  ROOM_ACCESS_HOST: 'acme.cloudflareaccess.com',
  ROOM_CONTACT_EMAIL: 'help@acme.example',
  ROOM_ALERT_TO: 'pat@acme.example',
  ROOM_ALERT_FROM: 'room@acme.example',
  ROOM_OWNER_NAME: 'Pat',
  ROOM_OWNER_FULL_NAME: 'Pat Doe',
  ROOM_OWNER_TITLED: 'Pat Doe, who runs the room',
  ROOM_OWNER_ALLOWS: 'she allows',
  ROOM_OPERATOR_NAME: 'Acme, Inc.',
  ROOM_PRIOR_STATUS: 'dismissed',
  ROOM_PRIOR_CASE_LABEL: 'Earlier case (dismissed)',
  ROOM_CURRENT_PLEADING: 'revised',
  ROOM_LAW_LIBRARY_HOLDS: 'Lease statutes only.',
  ROOM_REGULATOR_ORDERS: [{ label: 'Who applied', question: ['Who applied, and when?'] }],
  ROOM_EXTRA_CLAIM_TYPES: ['leaseDefault'],
};

/** Runs `body` in a fresh Node process, with `set` as globals, and returns what it prints as JSON. */
function run(set: Record<string, unknown>, body: string): any {
  const preload = `data:text/javascript,Object.assign(globalThis,${encodeURIComponent(JSON.stringify(set))})`;
  const imports = `const load = (file) => import(${JSON.stringify(`file://${WEB}/`)} + file);`;
  const out = execFileSync(process.execPath, ['--import', preload, '--input-type=module', '--eval', `${imports}\nconsole.log(JSON.stringify(await (async () => {${body}})()));`], { cwd: WEB, encoding: 'utf8' });
  return JSON.parse(out);
}

const EVERYTHING = `
  const { CONTACT } = await load('mcp/pages/html.ts');
  const { MCP_HOST, MCP_ORIGIN, ROOM_ORIGIN } = await load('mcp/contract.ts');
  const { SIGN_IN_HOSTS } = await load('mcp/pages/connect-help.ts');
  const { ACCESS_HOST } = await load('mcp/pages/connect-copilot.ts');
  const { CONNECT_URL } = await load('worker/redirects.ts');
  const { ALERT_TO, ALERT_FROM, ALERT_HEADERS } = await load('worker/signins.ts');
  const { ANSWER_RULES, MATTER_REMINDER, MATTER_REMINDER_FILED } = await load('worker/prompt.ts');
  const { MCP_ORIGIN: scriptsOrigin } = await load('scripts/mcp-constants.ts');
  const { MCP_ORIGIN: pagesOrigin } = await load('src/scripts/connect-first.ts');
  const { ROOM_ORIGIN: packOrigin } = await load('scripts/counsel-pack-plan.ts');
  return { CONTACT, MCP_HOST, MCP_ORIGIN, ROOM_ORIGIN, SIGN_IN_HOSTS, ACCESS_HOST, CONNECT_URL, ALERT_TO, ALERT_FROM, list: ALERT_HEADERS['List-Id'], rules: ANSWER_RULES, MATTER_REMINDER, MATTER_REMINDER_FILED, scriptsOrigin, pagesOrigin, packOrigin };
`;

const READ_BY_COUNSEL = `
  const { renderConnectPage } = await load('mcp/pages/connect.ts');
  (await load('mcp/pages/html.ts')).usePageNames({ INSTANCE_NAME: globalThis.ROOM_INSTANCE_NAME });
  const { renderPrivacyPage, renderTermsPage } = await load('mcp/pages/legal.ts');
  const { FALLBACK_ERROR } = await load('src/scripts/chat-client.ts');
  const { GUIDE_COPY } = await load('src/scripts/guide-copy.ts');
  const { suitMilestone } = await load('src/scripts/people-dates.ts');
  const { caseHeading } = await load('src/scripts/overview-case-model.ts');
  const { searchLawTool } = await load('mcp/tools/search-law.ts');
  const { overviewTool } = await load('mcp/tools/overview.ts');
  return {
    connect: renderConnectPage(),
    privacy: renderPrivacyPage(),
    terms: renderTermsPage(),
    FALLBACK_ERROR,
    regulator: GUIDE_COPY.regulator.orders.map((order) => order.label),
    claimsBrief: GUIDE_COPY.claims.brief.join(' '),
    suit: suitMilestone({ filed: null, priorCase: { filed: '2011-01-01' } }).label,
    heading: caseHeading({ meta: { caption: 'C' }, tracks: [{ kind: 'complaint', title: 'T' }] }, []).line[0],
    law: searchLawTool.description,
    overview: overviewTool.description,
  };
`;

const CLAIM = `
  const { readFileSync } = await import('node:fs');
  const { parseMatter } = await load('worker/matter.ts');
  const raw = JSON.parse(readFileSync('fixtures/matter.example.json', 'utf8'));
  raw.claims[0].type = 'leaseDefault';
  try {
    return { kept: parseMatter(raw, { now: new Date('2030-01-01') }).claims[0].type };
  } catch (error) {
    return { refused: error.message };
  }
`;

test('with nothing set, hosts, addresses and the reminders are the neutral ones', () => {
  const seen = run({}, EVERYTHING);
  assert.equal(seen.MCP_HOST, 'mcp.room.example.com');
  assert.equal(seen.ROOM_ORIGIN, 'https://room.example.com');
  assert.deepEqual(seen.SIGN_IN_HOSTS, ['mcp.room.example.com', 'room.cloudflareaccess.com']);
  assert.equal(seen.CONNECT_URL, 'https://mcp.room.example.com/connect');
  assert.equal(seen.ALERT_TO, 'owner@example.com');
  assert.equal(seen.ALERT_FROM, 'room@example.com');
  assert.equal(seen.list, 'Legallas alerts <alerts.room.example.com>');
  assert.equal(seen.CONTACT, 'email@example.com');
  assert.match(seen.MATTER_REMINDER, /The current complaint has not /);
  assert.match(seen.MATTER_REMINDER_FILED, /The current complaint has been /);
  assert.match(seen.MATTER_REMINDER, /called closed\. /);
  assert.match(seen.rules, /any prior case that closed\./);
  assert.match(seen.rules, /say that it closed\./);
});

test('a room\'s settings reach its hosts, its addresses and Ask\'s rules and reminders', () => {
  const seen = run(SET, EVERYTHING);
  assert.equal(seen.MCP_HOST, 'ai.acme.example');
  assert.equal(seen.MCP_ORIGIN, 'https://ai.acme.example');
  assert.equal(seen.ROOM_ORIGIN, 'https://room.acme.example');
  assert.deepEqual(seen.SIGN_IN_HOSTS, ['ai.acme.example', 'acme.cloudflareaccess.com']);
  assert.equal(seen.ACCESS_HOST, 'acme.cloudflareaccess.com');
  assert.equal(seen.CONNECT_URL, 'https://ai.acme.example/connect');
  assert.equal(seen.scriptsOrigin, 'https://ai.acme.example');
  assert.equal(seen.pagesOrigin, 'https://ai.acme.example');
  assert.equal(seen.packOrigin, 'https://room.acme.example');
  assert.equal(seen.ALERT_TO, 'pat@acme.example');
  assert.equal(seen.ALERT_FROM, 'room@acme.example');
  assert.equal(seen.list, 'Legallas alerts <alerts.room.acme.example>');
  assert.equal(run({ ROOM_STORED_NAME: 'acme' }, EVERYTHING).list, 'Acme alerts <alerts.room.example.com>');
  assert.equal(seen.CONTACT, 'help@acme.example');
  assert.match(seen.MATTER_REMINDER, /The revised complaint has not /);
  assert.match(seen.MATTER_REMINDER_FILED, /The revised complaint has been /);
  assert.match(seen.MATTER_REMINDER, /called dismissed\. /);
  assert.doesNotMatch(seen.MATTER_REMINDER, /\bclosed\b|\bcurrent\b/);
  assert.match(seen.rules, /any prior case that dismissed\./);
  assert.match(seen.rules, /say that it dismissed\./);
  assert.doesNotMatch(seen.rules, /prior case that closed|that it closed/);
});

test('with nothing set, what counsel reads names no one and keeps the neutral words', () => {
  const seen = run({}, READ_BY_COUNSEL);
  assert.match(seen.connect, /The owner sees which documents/);
  assert.match(seen.connect, /email the owner at/);
  assert.match(seen.connect, /once they allow it/);
  assert.match(seen.connect, /Operated by the owner/);
  assert.match(seen.FALLBACK_ERROR, /tell the owner if it keeps happening/);
  assert.deepEqual(seen.regulator, ['What the parties were told', 'Key counts', 'Gaps']);
  assert.match(seen.claimsBrief, /the closed pleading/);
  assert.equal(seen.suit, 'Suit filed (prior case, closed)');
  assert.equal(seen.heading, 'Current complaint');
  assert.match(seen.law, /^Search the law library: the public statutes, rules and opinions this room chose to hold\. Public law/);
  assert.match(seen.overview, /that pleading closed and its claims are history/);
});

test('a room\'s settings reach what counsel reads, in place of the neutral words', () => {
  const seen = run(SET, READ_BY_COUNSEL);
  assert.match(seen.connect, /Pat sees which documents/);
  assert.match(seen.connect, /email Pat at <a href="mailto:help@acme\.example">/);
  assert.match(seen.connect, /once she allows it/);
  assert.match(seen.connect, /Operated by Acme, Inc\./);
  assert.match(seen.connect, /ai\.acme\.example/);
  assert.match(seen.connect, /connectorName=Acme%20Room&amp;/);
  assert.match(seen.connect, /Your IT team adds Acme Room once/);
  assert.doesNotMatch(seen.connect, /Legallas/);
  assert.doesNotMatch(seen.connect, /\b(?:email|ask|tell|send) the owner\b|\bThe owner sees\b|once they allow it|Operated by the owner|room\.example\.com|email@example\.com/);
  assert.match(seen.privacy, /Acme, Inc\./);
  assert.match(seen.terms, /Acme, Inc\./);
  assert.match(seen.FALLBACK_ERROR, /tell Pat if it keeps happening/);
  assert.deepEqual(seen.regulator, ['Who applied', 'Gaps']);
  assert.match(seen.claimsBrief, /the dismissed pleading/);
  assert.equal(seen.suit, 'Suit filed (prior case, dismissed)');
  assert.equal(seen.heading, 'Revised complaint');
  assert.match(seen.law, /^Search the law library: Lease statutes only\. Public law/);
  assert.match(seen.overview, /that pleading dismissed and its claims are history/);
});

test('code that can only be read says what a room sets too: the messages behind sign-in, and the built pages', () => {
  const read = (file: string) => readFileSync(join(WEB, file), 'utf8');
  assert.match(read('mcp/authorize.ts'), /Ask \$\{ownerTitled\} to add it\./);
  assert.match(read('mcp/authorize.ts'), /tell \$\{ownerFullName\} \(\$\{CONTACT\}\)/);
  assert.match(read('mcp/authorize.ts'), /ask \$\{ownerFullName\} \(\$\{CONTACT\}\)/);
  assert.match(read('mcp/authorize.ts'), /ask \$\{ownerName\} to allow it/);
  assert.match(read('mcp/copilot-package.ts'), /or ask \$\{ownerFullName\}\./);
  assert.match(read('mcp/tools/overview-summary.ts'), /status: priorStatus,/);
  assert.match(read('worker/ask-brief.ts'), /Prior case \(\$\{priorStatus\}; history only/);
  assert.match(read('src/layouts/Room.astro'), /href=\{`https:\/\/\$\{mcpHost\}\/connect`\}/);
  assert.match(read('src/pages/ask.astro'), /\{sentence\(ownerName\)\} runs this room/);
  assert.match(read('src/pages/claims/index.astro'), /<Room title=\{priorCaseLabel\}/);
  assert.match(read('src/pages/claims/index.astro'), /in the \{priorStatus\} complaint/);
  assert.match(read('src/pages/complaint/index.astro'), /\{priorCaseLabel\}<\/a>/);
  assert.match(read('src/pages/regulator/index.astro'), /\{priorCaseLabel\}<\/a>/);
  assert.match(read('src/scripts/brief/page.ts'), /Drafting brief for a \$\{currentPleading\} complaint/);
  assert.match(read('src/scripts/claims.ts'), /in the \$\{priorStatus\} \$\{pleading\}/);
  assert.match(read('scripts/matter/report.ts'), /Prior case \(\$\{priorStatus\}\)/);
});

test('a stored manifest\'s own claim type is refused by default and accepted once the room names it', () => {
  assert.match(run({}, CLAIM).refused, /type/);
  assert.equal(run(SET, CLAIM).kept, 'leaseDefault');
});

test('what a page draws while it is built, with no document, names a renamed room', () => {
  const drawn = `
    const { instanceName } = await load('src/scripts/room-names.ts');
    const { AI_CARDS, CLAUDE_ADD } = await load('src/scripts/connect-first.ts');
    return {
      name: instanceName(),
      connector: new URL(CLAUDE_ADD).searchParams.get('connectorName'),
      who: AI_CARDS.find((card) => card.app === 'copilot').who,
    };
  `;
  assert.deepEqual(run({}, drawn), {
    name: 'Legallas',
    connector: 'Legallas',
    who: 'Your IT team adds Legallas once; then it is in Outlook, Teams and Word',
  });
  assert.deepEqual(run(SET, drawn), {
    name: 'Acme Room',
    connector: 'Acme Room',
    who: 'Your IT team adds Acme Room once; then it is in Outlook, Teams and Word',
  });
});

// Astro sorts a page's <link> tags by the position of each import, added up along the way to the stylesheet (astro
// core/build/graph.js, runtime.js cssOrder). A settings import above a stylesheet or a component moves that page's
// styles behind others, and the cascade can change, so a page's settings import comes last.
test('a settings import in an .astro file comes after every other import', () => {
  const SRC = join(WEB, 'src');
  const astro = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.astro'));
  const importing = astro.flatMap((file) => {
    const frontmatter = readFileSync(join(SRC, file), 'utf8').split(/^---$/m)[1] ?? '';
    const imports = frontmatter.split('\n').filter((line) => line.startsWith('import '));
    return imports.some((line) => line.includes('worker/room-settings.ts')) ? [{ file, last: imports.at(-1) ?? '' }] : [];
  });
  assert.ok(importing.length > 0, 'the layout and some pages import the settings');
  for (const { file, last } of importing) assert.match(last, /worker\/room-settings\.ts/, `${file}: move the settings import to the end`);
});

test('sentence capitalizes only the first letter', () => {
  assert.equal(sentence('the owner'), 'The owner');
  assert.equal(sentence('Pat Doe'), 'Pat Doe');
  assert.equal(sentence(''), '');
});
