// SPDX-License-Identifier: Apache-2.0
// A room's own app package, built from its settings, is a valid package under its own names. A Node process with the
// globals set sees what a room's build sees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { PERSON_INSTRUCTION, RECOMMEND_INSTRUCTION } from '../../mcp/server.ts';

const WEB = join(import.meta.dirname, '..', '..');

const SET = {
  ROOM_INSTANCE_NAME: 'Acme',
  ROOM_STORED_NAME: 'acme',
  ROOM_MCP_HOST: 'ai.acme.example',
  ROOM_OPERATOR_NAME: 'Acme, Inc.',
  ROOM_OWNER_WEBSITE: 'https://acme.example',
  ROOM_COPILOT_APP_ID: '11111111-2222-4333-8444-555555555555',
  ROOM_TOOL_PREFIX: 'acme_',
};

function run(set: Record<string, unknown>, body: string): any {
  const preload = `data:text/javascript,Object.assign(globalThis,${encodeURIComponent(JSON.stringify(set))})`;
  const load = `const load = (file) => import(${JSON.stringify(`file://${WEB}/`)} + file);`;
  const out = execFileSync(process.execPath, ['--import', preload, '--input-type=module', '--eval', `${load}\nconsole.log(JSON.stringify(await (async () => {${body}})()));`], { cwd: WEB, encoding: 'utf8' });
  return JSON.parse(out);
}

/** The room's package, built and validated; `recommend` is its wrangler.mcp.jsonc RECOMMEND. */
const build = (recommend = '0'): string => `
  const { readPackage } = await load('connect/copilot/build.ts');
  const { ROOM_FILES, roomPackageFile } = await load('connect/copilot/room-package.ts');
  const { buildPackage } = await load('connect/copilot/package.ts');
  const { renderMcpTools, renderPlugin, listTools } = await load('connect/copilot/mcp-tools.ts');
  const files = readPackage();
  const text = (name) => new TextDecoder().decode(files.get(name));
  const room = Object.fromEntries(ROOM_FILES.map((name) => [name, roomPackageFile(name, text(name), { RECOMMEND: ${JSON.stringify(recommend)} })]));
  const list = await listTools({ LAW_LIBRARY: '1', LAW: {}, LAW_SEARCH: {}, MCP_TOOL_PREFIX: 'acme_', INSTANCE_NAME: 'Acme' });
  files.set('manifest.json', new TextEncoder().encode(room['manifest.json']));
  files.set('declarativeAgent.json', new TextEncoder().encode(room['declarativeAgent.json']));
  files.set('ai-plugin.json', new TextEncoder().encode(renderPlugin(room['ai-plugin.json'], list)));
  files.set('mcp-tools.json', new TextEncoder().encode(renderMcpTools(list)));
  const zip = buildPackage(files, 'a-reference-id');
  room['ai-plugin.json'] = text('ai-plugin.json');
  return { room, zipBytes: zip.length, tools: list.tools.map((tool) => tool.name) };
`;

test('a room\'s package is valid, and says the room\'s app ID, developer, hosts and names', () => {
  const { room, zipBytes, tools } = run(SET, build());
  assert.ok(zipBytes > 1000, 'buildPackage validated every file and zipped them');
  assert.ok(tools.every((name: string) => name.startsWith('acme_')));
  const manifest = JSON.parse(room['manifest.json']);
  assert.equal(manifest.id, SET.ROOM_COPILOT_APP_ID);
  assert.deepEqual(manifest.developer, { name: 'Acme, Inc.', websiteUrl: 'https://acme.example', privacyUrl: 'https://ai.acme.example/privacy', termsOfUseUrl: 'https://ai.acme.example/terms' });
  assert.equal(manifest.name.short, 'Acme');
  const plugin = JSON.parse(room['ai-plugin.json']);
  assert.equal(plugin.namespace, 'acme');
  assert.equal(plugin.name_for_human, 'Acme counsel room');
  assert.equal(plugin.runtimes[0].spec.url, 'https://ai.acme.example/mcp');
  assert.equal(plugin.runtimes[0].auth.reference_id, '${{ACME_OAUTH_REFERENCE_ID}}');
  for (const text of Object.values<string>(room)) assert.doesNotMatch(text, /Legallas|legallas|LEGALLAS|room\.example\.com/);
});

test('the agent gives options and a recommendation only while the room\'s RECOMMEND is "1"', () => {
  const instructions = (recommend: string): string => JSON.parse(run(SET, build(recommend)).room['declarativeAgent.json']).instructions;
  const on = instructions('1');
  const off = instructions('0');
  assert.ok(on.includes(`\n\n${RECOMMEND_INSTRUCTION}\n\n`), 'its own paragraph, before the closing one');
  assert.ok(!off.includes(RECOMMEND_INSTRUCTION));
  assert.equal(on.replace(`${RECOMMEND_INSTRUCTION}\n\n`, ''), off, 'nothing else changes');
  for (const text of [on, off]) assert.ok(text.includes(`\n\n${PERSON_INSTRUCTION}\n\n`), 'the person guard, RECOMMEND on or off (#785)');
  assert.ok(on.indexOf(PERSON_INSTRUCTION) < on.indexOf(RECOMMEND_INSTRUCTION), 'the guard before the recommendation line');
});

test('a name too long for the plugin\'s label loses "counsel" and not its meaning', () => {
  const { room } = run({ ...SET, ROOM_INSTANCE_NAME: 'Acme Law' }, build().replace("INSTANCE_NAME: 'Acme'", "INSTANCE_NAME: 'Acme Law'"));
  assert.equal(JSON.parse(room['ai-plugin.json']).name_for_human, 'Acme Law room');
});

test('the room\'s package needs its own app ID, so nothing replaces an installed app by accident', () => {
  const { ROOM_COPILOT_APP_ID: _unused, ...withoutId } = SET;
  assert.throws(() => run(withoutId, build()), /copilotAppId is required/);
});
