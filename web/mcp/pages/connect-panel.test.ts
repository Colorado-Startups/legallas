// SPDX-License-Identifier: Apache-2.0
// The /connect panel (pages/connect.ts): the cards each reader sees, each AI's steps against the goal, the setup kit
// counting the same steps, and an invitation (worker/invite.ts) landing on its reader's panel in one click.
//
// | AI | Goal: steps, start to connected |
// |---|---|
// | Microsoft 365 Copilot | 10 or fewer |
// | Claude, Harvey, OpenCode | 5 or fewer |
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONNECT_PATH, MCP_RESOURCE } from '../contract.ts';
import { OPENCODE_CONFIG, PANEL_ORDER, ROOM_NOUN, STEPS, renderConnectPage, type AiId } from './connect.ts';
import { DEFAULT_READER, READERS, READER_AIS, aiList, connectLink, inviteMessage, readerOf, readerOfRole } from '../../worker/invite.ts';

const GOAL: Readonly<Record<AiId, number>> = { claude: 5, copilot: 10, harvey: 5, 'open-weight': 5 };
const guide = (name: string) => readFileSync(join(import.meta.dirname, '..', '..', 'connect', name), 'utf8');
/** Each AI's guide and the sections of its main path (quality-speed/pages/ai-connectors/guides.ts PATHS). */
const GUIDES: Readonly<Record<AiId, { file: string; you: string; once?: string }>> = {
  claude: { file: 'claude-ai.md', you: 'What you do' },
  copilot: { file: 'copilot.md', you: 'What you do', once: 'The Legallas agent for Microsoft 365' },
  harvey: { file: 'harvey.md', you: 'What you do', once: 'What your Harvey admin does once' },
  'open-weight': { file: 'open-weight.md', you: 'What you do', once: "What the room's owner does once" },
};

/** The numbered steps under a heading, up to the next heading: top-level list items and bold numbered paragraphs. */
function guideSteps(markdown: string, heading: string): number {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => /^#{1,6} /.test(line) && line.replace(/^#+ /, '').trim() === heading);
  assert.ok(start >= 0, `heading: ${heading}`);
  const end = lines.findIndex((line, i) => i > start && /^#{1,6} /.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).filter((line) => /^(\*\*)?\d+\.\s/.test(line)).length;
}

const total = (id: AiId) => STEPS[id].you.length + (STEPS[id].once?.steps.length ?? 0);
const cards = (html: string) => [...html.matchAll(/<li class="cx-card[^"]*" data-ai="([^"]+)">/g)].map((m) => m[1]);

test('each AI\'s main path meets its goal: Copilot 10 steps or fewer, every other AI 5 or fewer', () => {
  for (const id of Object.keys(GOAL) as AiId[]) assert.ok(total(id) <= GOAL[id], `${id}: ${total(id)} steps, goal ${GOAL[id]}`);
  assert.deepEqual(Object.fromEntries((Object.keys(GOAL) as AiId[]).map((id) => [id, total(id)])), { claude: 4, copilot: 7, harvey: 5, 'open-weight': 4 });
});

test('each reader\'s panel: Claude first, Harvey for counsel only, and every section still on the page', () => {
  assert.deepEqual(PANEL_ORDER, {
    founder: ['claude', 'copilot', 'open-weight'],
    counsel: ['claude', 'copilot', 'harvey', 'open-weight'],
    investor: ['claude', 'copilot', 'open-weight'],
  });
  for (const reader of READERS) {
    const html = renderConnectPage({ reader });
    assert.deepEqual(cards(html), PANEL_ORDER[reader], reader);
    for (const id of PANEL_ORDER.counsel) assert.ok(html.includes(`<section class="cx-tool prose" id="${id}"`), `${reader}: the ${id} section`);
  }
  assert.equal(renderConnectPage(), renderConnectPage({ reader: DEFAULT_READER }), 'no reader reads as counsel');
});

test('each card shows its step counts, a dot per step, and its one action with the room\'s link', () => {
  const html = renderConnectPage({ claudePlugin: true, copilotPackage: true });
  for (const id of PANEL_ORDER.counsel) {
    const card = html.slice(html.indexOf(`data-ai="${id}"`), html.indexOf('</li>', html.indexOf(`data-ai="${id}"`)));
    const counts = [...card.matchAll(/<p class="cx-n">([^<]+) <b aria-hidden="true">(●+)<\/b> (\d+) steps?<\/p>/g)].map((m) => [m[1], m[2]!.length, Number(m[3])]);
    const want = [...(STEPS[id].once ? [[STEPS[id].once!.who, STEPS[id].once!.steps.length]] : []), ['You', STEPS[id].you.length]];
    assert.deepEqual(counts, want.map(([who, n]) => [who, n, n]), id);
  }
  const card = (id: AiId) => html.slice(html.indexOf(`data-ai="${id}"`), html.indexOf('</li>', html.indexOf(`data-ai="${id}"`)));
  assert.ok(card('claude').includes(encodeURIComponent(MCP_RESOURCE)), 'Claude: the prefilled add link');
  assert.ok(card('copilot').includes('>Download the agent</a>'), 'Copilot: the package');
  assert.ok(card('harvey').includes(`URL <code class="cx-copy">${MCP_RESOURCE}</code>`) && card('harvey').includes('Authentication <strong>OAuth</strong>'), 'Harvey: the values');
  assert.ok(card('open-weight').includes(`"url": "${MCP_RESOURCE}"`), 'OpenCode: the config');
});

test('the setup guides count the same steps as the page', () => {
  for (const [id, where] of Object.entries(GUIDES) as [AiId, (typeof GUIDES)[AiId]][]) {
    const md = guide(where.file);
    assert.equal(guideSteps(md, where.you), STEPS[id].you.length, `${where.file}: ${where.you}`);
    if (where.once) assert.equal(guideSteps(md, where.once), STEPS[id].once?.steps.length, `${where.file}: ${where.once}`);
  }
  // The README's table: "4 steps" for the person, "Your IT team, 3 steps" for whoever turns it on.
  const readme = guide('README.md');
  const names: Readonly<Record<AiId, string>> = { claude: 'Claude', copilot: 'Microsoft 365 Copilot', harvey: 'Harvey', 'open-weight': 'OpenCode' };
  for (const id of PANEL_ORDER.counsel) {
    const row = readme.split('\n').find((line) => line.startsWith(`| ${names[id]} |`));
    assert.ok(row, `README: ${names[id]}`);
    const cells = row.split('|').map((cell) => cell.trim());
    const n = STEPS[id].you.length;
    assert.equal(cells[3], `${n} step${n === 1 ? '' : 's'}`, `README: ${id}, you`);
    const once = STEPS[id].once;
    assert.equal(cells[4], once ? `${once.who}, ${once.steps.length} step${once.steps.length === 1 ? '' : 's'}` : '', `README: ${id}, once`);
  }
});

test('the OpenCode card holds open-weight.md\'s config, with this room\'s link', () => {
  const md = guide('open-weight.md');
  const block = md.slice(md.indexOf('```json\n') + 8, md.indexOf('\n   ```', md.indexOf('```json\n')));
  assert.equal(block.split('\n').map((line) => line.replace(/^ {3}/, '')).join('\n'), OPENCODE_CONFIG);
  assert.ok(OPENCODE_CONFIG.includes(`"url": "${MCP_RESOURCE}"`) && JSON.parse(OPENCODE_CONFIG).provider.openrouter.models, 'valid JSON, with the model pin');
});

test('an invitation\'s one link opens its reader\'s panel', () => {
  for (const [role, reader] of [['owner', 'founder'], ['counsel', 'counsel'], ['investor', 'investor']] as const) {
    assert.equal(readerOfRole(role), reader);
    const link = connectLink(reader);
    const url = new URL(link);
    assert.equal(url.pathname, CONNECT_PATH, role);
    assert.equal(readerOf(url), reader, role);
    assert.deepEqual(cards(renderConnectPage({ reader: readerOf(url) })), PANEL_ORDER[reader], `${role}: one click, its panel`);
    const message = inviteMessage(reader, 'jane@example.com');
    assert.ok(message.includes(`Connect your AI first (${aiList(reader)}): ${link}`), `${role}: the link, first, naming its panel's AIs`);
    assert.ok(message.indexOf(link) < message.indexOf('To browse instead'), `${role}: the AI before the room`);
  }
  for (const odd of ['', 'FOUNDER', 'admin', 'founder,counsel']) assert.equal(readerOf(new URL(`https://x.test/connect?for=${odd}`)), DEFAULT_READER, odd);
  assert.equal(readerOf(new URL('https://x.test/connect')), DEFAULT_READER);
});

test('each reader is told of the AIs their panel offers, and reads their own room and Copilot admin', () => {
  const names: Readonly<Record<AiId, string>> = { claude: 'Claude', copilot: 'Microsoft 365 Copilot', harvey: 'Harvey', 'open-weight': 'OpenCode' };
  for (const reader of READERS) assert.deepEqual(READER_AIS[reader], PANEL_ORDER[reader].map((id) => names[id]), `${reader}: invite.ts names the panel's AIs`);
  assert.equal(aiList('investor'), 'Claude, Microsoft 365 Copilot or OpenCode');
  assert.equal(aiList('counsel'), 'Claude, Microsoft 365 Copilot, Harvey or OpenCode');
  const mails = (html: string) => [...html.matchAll(/href="(mailto:[^"]+)"/g)].map((m) => decodeURIComponent(m[1]!.replaceAll('&#39;', "'").replaceAll('&amp;', '&'))).join('\n');
  for (const reader of READERS) {
    const html = renderConnectPage({ copilotPackage: true, reader });
    const copilot = html.slice(html.indexOf('data-ai="copilot"'), html.indexOf('</li>', html.indexOf('data-ai="copilot"')));
    assert.ok(html.includes(`<title>Connect your AI | Legallas ${ROOM_NOUN[reader]}</title>`), `${reader}: the title`);
    if (reader === 'counsel') {
      assert.ok(copilot.includes('For your IT team to upload.') && copilot.includes('<p class="cx-n">Your IT team '), 'counsel: the firm\'s IT team');
      assert.ok(mails(html).includes("a client's case record"), 'counsel: the emails as before');
    } else {
      assert.ok(copilot.includes('Your Microsoft 365 admin uploads this once (often you).') && copilot.includes('<p class="cx-n">Your Microsoft 365 admin '), `${reader}: their own admin`);
      assert.ok(!mails(html).includes('counsel room') && !mails(html).includes('case record'), `${reader}: the emails name their room`);
    }
    // A company room: mcp/index.ts cannot reach the percent-encoded emails, so the page words them itself (#883).
    const company = renderConnectPage({ copilotPackage: true, reader, company: true });
    assert.ok(!mails(company).includes('counsel room') && !mails(company).includes('case record'), `${reader}, company room: the emails`);
  }
  const counsel = renderConnectPage({ company: true });
  assert.ok(counsel.includes('<title>Connect your AI | Legallas company room</title>'), 'counsel, company room: the title');
  assert.ok(mails(counsel).includes('Please add the Legallas company room to Microsoft 365 Copilot'), 'counsel, company room: the emails');
  assert.ok(renderConnectPage({ reader: 'founder' }).includes('href="#copilot-it">Steps for your Microsoft 365 admin</a>'), 'founder, no shared registration');
  assert.ok(renderConnectPage().includes('href="#copilot-it">Steps for your IT team</a>'), 'counsel, no shared registration');
});
