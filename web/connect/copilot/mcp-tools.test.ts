// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { LAW_TOOL_NAME, READ_ONLY_ANNOTATIONS, TOOL_NAMES } from '../../mcp/contract.ts';
import { APP_PACKAGE_DIR } from './build.ts';
import { PLUGIN_FILE, expectedFiles, listTools, renderMcpTools, renderPlugin, type ListedTool, type ToolList } from './mcp-tools.ts';
import { MAX_TOOL_DESCRIPTION, PLUGIN_TOOLS, REFERENCE_PLACEHOLDER, TOOLS_FILE } from './validate.ts';

const source = (name: string): string => readFileSync(join(APP_PACKAGE_DIR, name), 'utf8');

test('mcp-tools.json, ai-plugin.json and package-data.generated.ts match the server (run node connect/copilot/mcp-tools.ts)', async () => {
  for (const [path, text] of await expectedFiles()) assert.equal(readFileSync(path, 'utf8'), text, path);
});

test('the server lists the contract tools, read-only, with descriptions Microsoft reads in full', async () => {
  const { tools } = await listTools();
  assert.deepEqual(tools.map((tool) => tool.name), [...TOOL_NAMES, LAW_TOOL_NAME]);
  assert.deepEqual(PLUGIN_TOOLS, [...TOOL_NAMES, LAW_TOOL_NAME]);
  for (const tool of tools) {
    assert.match(tool.name, /^[A-Za-z0-9_]+$/);
    assert.ok(tool.description.length <= MAX_TOOL_DESCRIPTION, tool.name);
    assert.deepEqual(tool.annotations, { title: tool.title, ...READ_ONLY_ANNOTATIONS }, tool.name);
    assert.equal((tool.inputSchema as { type?: unknown }).type, 'object', tool.name);
  }
});

test('the plugin pins every tool by name and description and keeps its auth placeholder', () => {
  const plugin = JSON.parse(source(PLUGIN_FILE));
  const { tools } = JSON.parse(source(TOOLS_FILE)) as ToolList;
  assert.deepEqual(plugin.functions, tools.map(({ name, description }) => ({ name, description })));
  assert.deepEqual(plugin.runtimes[0].run_for_functions, PLUGIN_TOOLS);
  assert.deepEqual(plugin.runtimes[0].spec.mcp_tool_description, { file: TOOLS_FILE });
  assert.equal(plugin.runtimes[0].auth.reference_id, REFERENCE_PLACEHOLDER);
});

test('a change to a tool name, description, input schema or annotation is drift', async () => {
  const list = await listTools();
  const edits: [string, (tool: ListedTool) => void][] = [
    ['name', (tool) => (tool.name = 'legallas_renamed')],
    ['description', (tool) => (tool.description += ' More.')],
    ['inputSchema', (tool) => (tool.inputSchema = { type: 'object', properties: {} })],
    ['annotations', (tool) => (tool.annotations = { readOnlyHint: false })],
  ];
  for (const [field, edit] of edits) {
    const changed: ToolList = structuredClone(list);
    edit(changed.tools[0]!); // safe: the server lists ten tools
    assert.notEqual(renderMcpTools(changed), source(TOOLS_FILE), `${field}: mcp-tools.json`);
    if (field === 'name' || field === 'description') assert.notEqual(renderPlugin(source(PLUGIN_FILE), changed), source(PLUGIN_FILE), `${field}: ai-plugin.json`);
  }
});
