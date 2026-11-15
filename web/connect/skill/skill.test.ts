// SPDX-License-Identifier: Apache-2.0
// The Agent Skills folder (connect/skill/legallas/): its bundle is current, its SKILL.md fits the Agent Skills rules
// claude.ai checks on upload, each kit has a reference whose steps name only tools the server lists, and nothing in it
// is case data. The kits' MCP prompts, built from these references: mcp/prompts.test.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { configuredControlPrefix } from '../../scripts/config.ts';
import { LAW_TOOL_NAME, TOOL_NAMES } from '../../mcp/contract.ts';
import { KITS } from '../../mcp/prompts.ts';
import { SKILL_NAME } from '../../mcp/claude-plugin.ts';
import { GENERATED_FILE, SKILL_DIR, readSkill, renderSkillData } from './skill-data.ts';
import { SKILL_FILES } from './skill-data.generated.ts';

const ALL_TOOLS: readonly string[] = [...TOOL_NAMES, LAW_TOOL_NAME];
const files = readSkill();
const skill = files.get('SKILL.md') ?? '';

test('skill-data.generated.ts is current: run node connect/skill/skill-data.ts after editing legallas/', () => {
  assert.equal(readFileSync(GENERATED_FILE, 'utf8'), renderSkillData(files));
  assert.deepEqual(Object.keys(SKILL_FILES), [...files.keys()]);
});

test('SKILL.md frontmatter: name and description only, the name its folder\'s, within the Agent Skills limits', () => {
  const match = skill.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'frontmatter first');
  const fields = Object.fromEntries(match[1]!.split('\n').map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()]));
  assert.deepEqual(Object.keys(fields), ['name', 'description'], 'claude.ai refuses unexpected keys');
  assert.equal(fields.name, SKILL_NAME);
  assert.ok(SKILL_DIR.endsWith(`/${SKILL_NAME}`), 'the folder is the name');
  assert.match(fields.name!, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(fields.name!.length <= 64);
  assert.ok(fields.description!.length > 0 && fields.description!.length <= 1024, `${fields.description!.length} characters`);
  assert.doesNotMatch(fields.description!, /[<>]/);
});

test('every kit has a reference with steps, a Write paragraph and the artifact to build in Claude; SKILL.md links each', () => {
  const references = [...files.keys()].filter((path) => path.startsWith('references/'));
  assert.deepEqual(references.sort(), KITS.map((kit) => `references/${kit.file}.md`).sort(), 'one reference per kit, none spare');
  for (const kit of KITS) {
    const reference = files.get(`references/${kit.file}.md`)!;
    assert.ok(skill.includes(`(references/${kit.file}.md)`), `SKILL.md links ${kit.file}`);
    assert.ok(skill.includes(`\`${kit.prompt}\``), `SKILL.md names the ${kit.prompt} prompt`);
    for (const heading of ['## Steps', '## Write', '## In Claude']) assert.ok(reference.includes(`\n${heading}\n`), `${kit.file}: ${heading}`);
    assert.ok((reference.match(/^\d+\. /gm) ?? []).length >= 3, `${kit.file}: numbered steps`);
    assert.match(reference.slice(reference.indexOf('## In Claude')), /artifact|claude-for-legal/, `${kit.file}: what to build in Claude`);
  }
});

test('each kit names only tools the server lists', () => {
  for (const [path, body] of files) {
    const named = [...new Set(body.match(/legallas_[a-z_]+/g) ?? [])];
    assert.deepEqual(named.filter((name) => !ALL_TOOLS.includes(name)), [], `${path} names only real tools`);
  }
  for (const kit of KITS) assert.ok(/legallas_[a-z]/.test(files.get(`references/${kit.file}.md`)!), `${kit.file} calls a tool`);
});

test('the claude-for-legal skills SKILL.md points to are the ones the kits name', () => {
  for (const name of ['tabular-review', 'chronology', 'closing-checklist', 'privilege-log-review']) {
    assert.ok(skill.includes(`\`${name}\``), `SKILL.md: ${name}`);
    assert.ok([...files.values()].some((body) => body !== skill && body.includes(`\`${name}\``)), `a reference runs ${name}`);
  }
});

test('no case data, no control numbers, no em dashes', () => {
  const prefix = configuredControlPrefix();
  const control = new RegExp(`\\bDOE-|${prefix ? `\\b${prefix}-|` : ''}\\b\\d{6}\\b`);
  for (const [path, body] of files) {
    assert.doesNotMatch(body, control, `${path}: no control numbers`);
    assert.doesNotMatch(body, /—/, `${path}: no em dash`);
  }
});
