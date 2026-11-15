// SPDX-License-Identifier: Apache-2.0
// The Claude plugin download (mcp/claude-plugin.ts), through oauth.ts route() as pro adds it: the files Claude reads,
// the room's MCP URL and tool prefix, nothing from env beyond the room's names, and the /connect link to it; and the
// skill folder alone, for OpenCode.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SKILL_FILES } from '../connect/skill/skill-data.generated.ts';
import { CLAUDE_PLUGIN_NAME, CLAUDE_PLUGIN_PATH, CLAUDE_PLUGIN_VERSION, SKILL_NAME, SKILL_ZIP_NAME, SKILL_ZIP_PATH, pluginEntries, skillEntries } from './claude-plugin.ts';
import { CONNECT_PATH, MCP_ORIGIN, MCP_RESOURCE, SERVER_NAME, type McpEnv } from './contract.ts';
import { route } from './oauth.ts';
import { renderConnectPage } from './pages/connect.ts';
import { readZipStore } from './zip.ts';
import './pro.ts';

const URL_ = `${MCP_ORIGIN}${CLAUDE_PLUGIN_PATH}`;
const text = (data: Uint8Array) => new TextDecoder().decode(data);

async function download(env: Partial<McpEnv> = {}): Promise<Map<string, string>> {
  const response = await route(new Request(URL_), env as McpEnv);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/zip');
  assert.equal(response.headers.get('content-disposition'), `attachment; filename="${CLAUDE_PLUGIN_NAME}"`);
  return new Map(readZipStore(new Uint8Array(await response.arrayBuffer())).map((entry) => [entry.name, text(entry.data)]));
}

test('GET gives the plugin: its manifest, the room\'s MCP server and the skill folder, nothing else', async () => {
  const files = await download();
  assert.deepEqual([...files.keys()], ['.claude-plugin/plugin.json', '.mcp.json', ...Object.keys(SKILL_FILES).map((path) => `skills/${SKILL_NAME}/${path}`)]);
  for (const [path, body] of Object.entries(SKILL_FILES)) assert.equal(files.get(`skills/${SKILL_NAME}/${path}`), body, `${path} as in the repository`);
  assert.deepEqual(JSON.parse(files.get('.mcp.json')!), { mcpServers: { [SERVER_NAME]: { type: 'http', url: MCP_RESOURCE } } });
});

test('plugin.json: a kebab-case name Claude allows, a version, the licence and the /connect page', async () => {
  const plugin = JSON.parse((await download()).get('.claude-plugin/plugin.json')!);
  assert.match(plugin.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.doesNotMatch(plugin.name, /^(claude|anthropic)-/);
  assert.equal(plugin.version, CLAUDE_PLUGIN_VERSION);
  assert.equal(plugin.license, 'Apache-2.0');
  assert.ok(plugin.description && plugin.author?.name);
  assert.equal(new URL(plugin.homepage).href, `${MCP_ORIGIN}${CONNECT_PATH}`);
});

test('a room\'s names: its instance name in the description, its tool prefix in every skill file', async () => {
  const files = await download({ INSTANCE_NAME: 'Acme', MCP_TOOL_PREFIX: 'acme_' });
  assert.match(JSON.parse(files.get('.claude-plugin/plugin.json')!).description, /^The Acme room in Claude/);
  const skill = [...files].filter(([name]) => name.startsWith('skills/')).map(([, body]) => body).join('\n');
  assert.doesNotMatch(skill, /legallas_[a-z]/, 'no default tool name is left');
  assert.match(skill, /acme_case_overview/);
  assert.match(skill, /acme_search_law/);
});

test('nothing from env reaches the ZIP beyond the room\'s names', async () => {
  const secret = 'not-in-the-zip-7c41';
  const files = await download({ COPILOT_REFERENCE_ID: secret, ACCESS_AUD: secret, TEAM_DOMAIN: secret } as Partial<McpEnv>);
  for (const [name, body] of files) assert.ok(!body.includes(secret), name);
});

test('HEAD has no body; any other method is refused', async () => {
  const head = await route(new Request(URL_, { method: 'HEAD' }), {} as McpEnv);
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const refused = await route(new Request(URL_, { method }), {} as McpEnv);
    assert.equal(refused.status, 405, method);
    assert.equal(refused.headers.get('allow'), 'GET, HEAD');
  }
});

test('/connect links the plugin on the Claude card and in its Owner steps, the skill folder on the OpenCode card, only when offered', () => {
  const offered = renderConnectPage({ claudePlugin: true });
  const card = (id: string) => offered.slice(offered.indexOf(`data-ai="${id}"`), offered.indexOf('</li>', offered.indexOf(`data-ai="${id}"`)));
  assert.equal(offered.split(`href="${CLAUDE_PLUGIN_PATH}"`).length - 1, 2, 'once for a member, once for an Owner');
  assert.ok(card('claude').includes(`href="${CLAUDE_PLUGIN_PATH}"`), 'on the Claude card');
  const it = offered.slice(offered.indexOf('id="claude-it"'), offered.indexOf('</details>', offered.indexOf('id="claude-it"')));
  assert.ok(it.includes(`href="${CLAUDE_PLUGIN_PATH}"`), 'in the Owner steps');
  assert.equal(offered.split(`href="${SKILL_ZIP_PATH}"`).length - 1, 1);
  assert.ok(card('open-weight').includes(`href="${SKILL_ZIP_PATH}"`), 'on the OpenCode card');
  for (const path of [CLAUDE_PLUGIN_PATH, SKILL_ZIP_PATH]) assert.ok(!renderConnectPage().includes(path), `a core-only room does not offer ${path}`);
});

test('GET the skill folder alone: legallas/ at the top, the same files as the plugin\'s skills/legallas/, in the room\'s prefix', async () => {
  const response = await route(new Request(`${MCP_ORIGIN}${SKILL_ZIP_PATH}`), {} as McpEnv);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-disposition'), `attachment; filename="${SKILL_ZIP_NAME}"`);
  const files = new Map(readZipStore(new Uint8Array(await response.arrayBuffer())).map((entry) => [entry.name, text(entry.data)]));
  assert.deepEqual([...files.keys()], Object.keys(SKILL_FILES).map((path) => `${SKILL_NAME}/${path}`));
  const plugin = new Map(pluginEntries({ instanceName: 'Legallas', toolPrefix: 'acme_' }).map((entry) => [entry.name, text(entry.data)]));
  for (const entry of skillEntries({ toolPrefix: 'acme_' })) assert.equal(text(entry.data), plugin.get(`skills/${entry.name}`), entry.name);
  assert.equal((await route(new Request(`${MCP_ORIGIN}${SKILL_ZIP_PATH}`, { method: 'POST' }), {} as McpEnv)).status, 405);
});

test('the entries are the same for the same names (a stable download)', () => {
  const names = { instanceName: 'Legallas', toolPrefix: 'legallas_' };
  assert.deepEqual(pluginEntries(names), pluginEntries(names));
});
