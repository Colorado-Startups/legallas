// SPDX-License-Identifier: Apache-2.0
// Writes the package's pinned tool definitions from the server itself: appPackage/mcp-tools.json is buildServer's
// tools/list result with pro's tools added (mcp/pro.ts, as the room's MCP entry adds them), and ai-plugin.json's `functions` and `run_for_functions` name the same tools. /mcp answers
// tools/list only after OAuth sign-in, so pinned definitions (Microsoft's pinned mode, what Agents Toolkit's
// "Fetch Action from MCP" writes) let Copilot know the tools, and offer sign-in, before it has ever listed them.
// Run it after any change to a tool's name, title, description, input schema or annotations:
//   node connect/copilot/mcp-tools.ts            rewrites mcp-tools.json, ai-plugin.json and package-data.generated.ts
//   node connect/copilot/mcp-tools.ts --check    exits 1 when they have drifted from the server
//   node connect/copilot/mcp-tools.ts --room     a room's own package, in its build folder (room-package.ts)
// mcp-tools.test.ts runs the same check under npm test. Never edit mcp-tools.json by hand.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { McpEnv, Props } from '../../mcp/contract.ts';
import '../../mcp/pro.ts';
import { buildServer } from '../../mcp/server.ts';
import { APP_PACKAGE_DIR, readPackage } from './build.ts';
import { GENERATED_FILE, renderPackageData } from './package-data.ts';
import { readWranglerConfig } from '../../worker/wrangler-config.ts';
import { ROOM_FILES, roomPackageFile } from './room-package.ts';
import { TOOLS_FILE } from './validate.ts';

/** One tool as tools/list returns it. */
export interface ListedTool {
  name: string;
  description: string;
  [field: string]: unknown;
}

/** The tools/list result, which mcp-tools.json holds as it is. */
export interface ToolList {
  tools: ListedTool[];
}

export const PLUGIN_FILE = 'ai-plugin.json';

/** The law library is on in production (wrangler.mcp.jsonc LAW_LIBRARY "1"), so its tool is listed too. */
const LISTING_ENV = { LAW_LIBRARY: '1', LAW: {}, LAW_SEARCH: {} } as unknown as McpEnv;
/** tools/list reads no member or grant, so any caller lists the same tools. */
const LISTING_PROPS: Props = { email: 'tools-list@example.test', role: 'counsel', clientId: 'tools-list', clientName: 'tools-list' };

/** buildServer's tools/list result, asked of the real MCP handler in memory (no network, no bindings touched). */
export async function listTools(env: McpEnv = LISTING_ENV): Promise<ToolList> {
  const request = new Request('https://mcp.example.test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const text = await (await createMcpHandler(() => buildServer(env, LISTING_PROPS)).fetch(request)).text();
  const data = text.split('\n').find((line) => line.startsWith('data: '));
  const result = data ? (JSON.parse(data.slice('data: '.length)) as { result?: ToolList }).result : undefined;
  if (!Array.isArray(result?.tools)) throw new Error(`tools/list gave no tools: ${text.slice(0, 200)}`);
  return result;
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** mcp-tools.json: the tools/list result, unchanged. */
export function renderMcpTools(list: ToolList): string {
  return json(list);
}

/** ai-plugin.json with its tool list taken from tools/list; every other field (auth, placeholder) is kept. */
export function renderPlugin(pluginText: string, list: ToolList): string {
  const plugin = JSON.parse(pluginText) as { functions: unknown; runtimes: { run_for_functions: unknown; spec: Record<string, unknown> }[] };
  plugin.functions = list.tools.map(({ name, description }) => ({ name, description }));
  const runtime = plugin.runtimes[0]!; // safe: validate.ts requires exactly one runtime
  runtime.run_for_functions = list.tools.map((tool) => tool.name);
  runtime.spec.mcp_tool_description = { file: TOOLS_FILE };
  return json(plugin);
}

/** What the three generated files should hold, by path. */
export async function expectedFiles(env: McpEnv = LISTING_ENV): Promise<Map<string, string>> {
  const list = await listTools(env);
  const pluginPath = join(APP_PACKAGE_DIR, PLUGIN_FILE);
  const plugin = renderPlugin(readFileSync(pluginPath, 'utf8'), list);
  const tools = renderMcpTools(list);
  const files = readPackage();
  files.set(PLUGIN_FILE, Buffer.from(plugin));
  files.set(TOOLS_FILE, Buffer.from(tools));
  return new Map([
    [pluginPath, plugin],
    [join(APP_PACKAGE_DIR, TOOLS_FILE), tools],
    [GENERATED_FILE, renderPackageData(new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))))],
  ]);
}

/** The room's own names on its Worker's listing, with the product's package files rewritten as the room's. */
function useRoomPackage(): McpEnv {
  const { INSTANCE_NAME, ASSISTANT_NAME, MCP_TOOL_PREFIX, RECOMMEND } = readWranglerConfig('wrangler.mcp').config.vars as Record<string, string>;
  for (const name of ROOM_FILES) {
    const file = join(APP_PACKAGE_DIR, name);
    writeFileSync(file, roomPackageFile(name, readFileSync(file, 'utf8'), { RECOMMEND }));
  }
  return { ...LISTING_ENV, INSTANCE_NAME, ASSISTANT_NAME, MCP_TOOL_PREFIX };
}

async function main(argv: readonly string[]): Promise<number> {
  const expected = await expectedFiles(argv.includes('--room') ? useRoomPackage() : LISTING_ENV);
  const read = (path: string): string => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return '';
    }
  };
  const stale = [...expected].filter(([path, text]) => read(path) !== text).map(([path]) => path);
  if (argv.includes('--check')) {
    if (stale.length === 0) return 0;
    console.error(`Out of date with the server's tools/list: ${stale.join(', ')}. Run node connect/copilot/mcp-tools.ts`);
    return 1;
  }
  for (const path of stale) writeFileSync(path, expected.get(path)!); // safe: stale comes from expected's keys
  console.log(stale.length === 0 ? 'Already up to date.' : `Wrote ${stale.join(', ')}.`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
