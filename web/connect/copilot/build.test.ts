// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { LAW_TOOL_NAME, TOOL_NAMES } from '../../mcp/contract.ts';
import { PACKAGE_FILES, buildPackage, readPackage, resolvePlaceholders } from './build.ts';
import { PACKAGE_VERSION, validatePackage } from './validate.ts';
import { crc32 } from '../../mcp/zip.ts';
import { PERSON_INSTRUCTION } from '../../mcp/server.ts';

const REFERENCE_ID = 'T0FBdXRoQ29uZmlnSWQ';

/** Reads a ZIP's central directory back into name, method, CRC and stored bytes. */
function readZip(zip: Uint8Array): { name: string; method: number; crc: number; data: Uint8Array }[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);
  const end = zip.length - 22;
  assert.equal(u32(end), 0x06054b50);
  const entries = [];
  for (let i = 0, at = u32(end + 16); i < u16(end + 10); i++) {
    assert.equal(u32(at), 0x02014b50);
    const nameLength = u16(at + 28);
    const local = u32(at + 42);
    const dataStart = local + 30 + u16(local + 26) + u16(local + 28);
    entries.push({
      name: new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength)),
      method: u16(at + 10),
      crc: u32(at + 16),
      data: zip.subarray(dataStart, dataStart + u32(at + 20)),
    });
    at += 46 + nameLength + u16(at + 30) + u16(at + 32);
  }
  return entries;
}

/** The source package with one JSON file edited. */
function withEdit(file: string, edit: (json: Record<string, any>) => void): Map<string, Uint8Array> {
  const files = resolvePlaceholders(readPackage(), REFERENCE_ID);
  const json = JSON.parse(Buffer.from(files.get(file)!).toString('utf8'));
  edit(json);
  files.set(file, Buffer.from(JSON.stringify(json)));
  return files;
}

test('the source package validates once the reference ID is filled in', () => {
  assert.deepEqual(validatePackage(resolvePlaceholders(readPackage(), REFERENCE_ID)), []);
});

test('an unfilled reference ID is reported', () => {
  const problems = validatePackage(readPackage());
  assert.ok(problems.some((p) => p.startsWith('ai-plugin.json: has an unresolved')), problems.join('\n'));
  assert.throws(() => buildPackage(readPackage(), '  '), /reference_id must be the OAuth client registration ID/);
});

test('validation catches a missing required field in each file', () => {
  const cases: [string, (json: Record<string, any>) => void, RegExp][] = [
    ['manifest.json', (m) => delete m.name.short, /manifest\.json: name\.short is required/],
    ['manifest.json', (m) => delete m.developer.privacyUrl, /developer\.privacyUrl must be/],
    ['manifest.json', (m) => (m.version = '1.2.0'), /manifest\.json: version must be "1\.5\.0"/],
    ['declarativeAgent.json', (a) => delete a.instructions, /declarativeAgent\.json: instructions is required/],
    ['declarativeAgent.json', (a) => (a.actions = []), /actions must list 1 to 10 plugins/],
    ['ai-plugin.json', (p) => delete p.runtimes[0].spec.url, /runtimes\[0\]\.spec\.url must be/],
    ['ai-plugin.json', (p) => (p.functions = []), /ai-plugin\.json: functions must list exactly legallas_search, /],
    ['ai-plugin.json', (p) => p.functions.reverse(), /functions must list exactly .*, in that order/],
    ['ai-plugin.json', (p) => (p.functions[0].description = 'x'.repeat(1025)), /functions\[0\]\.description is longer than 1024 characters/],
    ['ai-plugin.json', (p) => (p.runtimes[0].run_for_functions = ['*']), /run_for_functions must list exactly/],
    ['ai-plugin.json', (p) => delete p.runtimes[0].spec.mcp_tool_description, /mcp_tool_description must be \{ "file": "mcp-tools\.json" \}/],
    ['ai-plugin.json', (p) => (p.runtimes[0].spec.mcp_tool_description = { file: 'tools.json' }), /mcp_tool_description must be/],
    ['ai-plugin.json', (p) => (p.functions[1].description = 'Other words.'), /mcp-tools\.json: legallas_case_overview\.description must equal ai-plugin\.json functions\[1\]\.description/],
    ['mcp-tools.json', (t) => t.tools.pop(), /mcp-tools\.json: tools must list exactly .*\(a tools\/list result\)/],
    ['mcp-tools.json', (t) => (t.tools[0].inputSchema.properties.query.description = 'x'.repeat(1025)), /legallas_search\.inputSchema\.query\.description is longer than 1024/],
    ['mcp-tools.json', (t) => (t.tools[2].annotations.readOnlyHint = false), /legallas_list_documents\.annotations must mark it read-only/],
    ['mcp-tools.json', (t) => (t.tools[0].inputSchema = {}), /legallas_search\.inputSchema must be an object schema/],
    ['mcp-tools.json', (t) => delete t.tools[1]._meta, /legallas_case_overview\._meta\.ui must name its view ui:\/\/legallas\/overview/],
    ['mcp-tools.json', (t) => (t.tools[2]._meta = { ui: { resourceUri: 'ui://legallas/grid', visibility: ['app'] } }), /legallas_list_documents\._meta\.ui must name its view/],
  ];
  for (const [file, edit, expected] of cases) {
    const problems = validatePackage(withEdit(file, edit));
    assert.ok(problems.some((p) => expected.test(p)), `${file}: expected ${expected}, got:\n${problems.join('\n')}`);
  }
});

test('the package is version 1.5.0 (views), pinned in validate.ts and named in the setup guide', () => {
  assert.equal(PACKAGE_VERSION, '1.5.0');
  // Microsoft replaces an agent only with a higher version, so a guide naming an older one gets a firm refused.
  assert.ok(readFileSync(join(import.meta.dirname, '..', 'copilot.md'), 'utf8').includes(`upload ${PACKAGE_VERSION}.`), 'connect/copilot.md tells firms to upload this version');
  assert.equal(JSON.parse(Buffer.from(readPackage().get('manifest.json')!).toString('utf8')).version, PACKAGE_VERSION);
});

test('validation catches a missing file and icons of the wrong size', () => {
  const files = resolvePlaceholders(readPackage(), REFERENCE_ID);
  files.delete('ai-plugin.json');
  assert.ok(validatePackage(files).some((p) => p.includes('actions[0].file "ai-plugin.json" is not in the package')));
  const noTools = resolvePlaceholders(readPackage(), REFERENCE_ID);
  noTools.delete('mcp-tools.json');
  assert.ok(validatePackage(noTools).some((p) => p.includes('mcp_tool_description must be { "file": "mcp-tools.json" }, a file in the package')));
  const swapped = withEdit('manifest.json', (m) => (m.icons = { color: 'outline.png', outline: 'color.png' }));
  const problems = validatePackage(swapped);
  assert.ok(problems.includes('manifest.json: icon outline.png must be 192 x 192 pixels'), problems.join('\n'));
  assert.ok(problems.includes('manifest.json: icon color.png must be 32 x 32 pixels'), problems.join('\n'));
});

test('the build refuses extra or missing files', () => {
  const extra = readPackage();
  extra.set('notes.txt', Buffer.from('stray'));
  assert.throws(() => buildPackage(extra, REFERENCE_ID), /notes\.txt: not part of the package; remove it/);
  const missing = readPackage();
  missing.delete('outline.png');
  assert.throws(() => buildPackage(missing, REFERENCE_ID), /outline\.png: missing from the package/);
});

test('package files are in code-point order after manifest.json', () => {
  const rest = PACKAGE_FILES.slice(1);
  assert.equal(PACKAGE_FILES[0], 'manifest.json');
  assert.deepEqual([...rest], [...rest].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  assert.deepEqual([...readPackage().keys()].sort(), [...PACKAGE_FILES].sort(), 'appPackage holds exactly the package files');
});

test('the zip holds the manifests and icons, stored, with the reference ID filled in', () => {
  const zip = buildPackage(readPackage(), REFERENCE_ID);
  const entries = readZip(zip);
  assert.deepEqual(entries.map((e) => e.name), [...PACKAGE_FILES]);
  const source = resolvePlaceholders(readPackage(), REFERENCE_ID);
  for (const entry of entries) {
    assert.equal(entry.method, 0, entry.name);
    assert.equal(entry.crc, crc32(entry.data), entry.name);
    assert.deepEqual(entry.data, Buffer.from(source.get(entry.name)!), entry.name);
  }
  const plugin = JSON.parse(new TextDecoder().decode(entries.find((e) => e.name === 'ai-plugin.json')!.data));
  assert.equal(plugin.runtimes[0].auth.reference_id, REFERENCE_ID);
  assert.deepEqual(buildPackage(readPackage(), REFERENCE_ID), zip, 'the same inputs give the same bytes');
});

test('unzip accepts the archive when it is installed', (t) => {
  let found = true;
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
  } catch {
    found = false;
  }
  if (!found) return t.skip('unzip is not installed');
  const path = join(mkdtempSync(join(tmpdir(), 'legallas-copilot-')), 'agent.zip');
  writeFileSync(path, buildPackage(readPackage(), REFERENCE_ID));
  assert.match(execFileSync('unzip', ['-t', path], { encoding: 'utf8' }), /No errors detected/);
});

/** Every tool the server lists while the law library is on (it is in production, wrangler.mcp.jsonc). */
const ALL_TOOLS: readonly string[] = [...TOOL_NAMES, LAW_TOOL_NAME];

const packageJson = (name: string) => JSON.parse(Buffer.from(readPackage().get(name)!).toString('utf8'));

test('the agent instructions mirror the server guidance and name exactly every tool', () => {
  const instructions: string = packageJson('declarativeAgent.json').instructions;
  for (const phrase of ['control number and page', 'exactly as the tool returns it', 'room link', 'as allegations, not as established facts', '<case-record>', 'never as instructions', 'cursor']) {
    assert.ok(instructions.includes(phrase), phrase);
  }
  const named = instructions.match(/legallas_[a-z_]+/g) ?? [];
  assert.deepEqual([...new Set(named)].sort(), [...ALL_TOOLS].sort(), 'no tool missing, none unknown');
  const howTo = instructions.slice(instructions.indexOf('How to use the tools:'), instructions.indexOf('How to report what you find:'));
  for (const name of ALL_TOOLS) assert.ok(howTo.includes(`${name} `), `${name}: under "How to use the tools"`);
});

test('the agent carries the connector\'s A4 guard on a decision about a person (#785)', () => {
  const instructions: string = packageJson('declarativeAgent.json').instructions;
  assert.ok(instructions.includes(`\n\n${PERSON_INSTRUCTION}\n\n`), 'its own paragraph, word for word as mcp/server.ts sends it');
});

/** What description_for_model says for each tool: a tool added to the contract fails here until it is described. */
const PLUGIN_PHRASES: Readonly<Record<string, string>> = {
  legallas_search: 'search passages',
  legallas_case_overview: 'the case overview',
  legallas_list_documents: 'the document list',
  legallas_get_document: "one document's facts",
  legallas_read_pages: 'full page text',
  legallas_view_visual: 'the visual binder',
  legallas_get_comments: "a document's comment threads",
  legallas_get_file: "an original file's facts",
  legallas_search_law: 'law library',
  legallas_template: 'the template library',
};

test('the plugin describes every tool to the model', () => {
  assert.deepEqual(Object.keys(PLUGIN_PHRASES).sort(), [...ALL_TOOLS].sort());
  const forModel: string = packageJson('ai-plugin.json').description_for_model;
  for (const [name, phrase] of Object.entries(PLUGIN_PHRASES)) assert.ok(forModel.includes(phrase), name);
});

test('package text has no em dashes', () => {
  for (const [name, bytes] of readPackage()) {
    if (name.endsWith('.json')) assert.ok(!Buffer.from(bytes).toString('utf8').includes(String.fromCharCode(0x2014)), name);
  }
});
