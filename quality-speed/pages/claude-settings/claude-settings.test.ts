// SPDX-License-Identifier: Apache-2.0
// node --test quality-speed/pages/claude-settings/claude-settings.test.ts
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { Manifest, MetricRecord } from '../../contract/format.ts';
import { validateManifest, validateRecords } from '../../contract/validate.ts';
import { collect, loadedText, meets, openHours, parseExpected, startup, type Expected, type Version } from './collect.ts';

const read = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const EXPECTED = parseExpected(read('./expected.json')) as Expected;
const SETTINGS = read('../../../.claude/settings.json');
const RUN = { now: '2026-11-04T12:00:00Z', sourceUrl: 'https://github.com/Colorado-Startups/legallas/actions/runs/7' };
const TOOL = 'mcp__claude-code-remote__send_message';

type Permissions = { allow: string[]; deny: string[]; ask?: string[] };
const plant = (change: (p: Permissions) => void) => {
  const copy = structuredClone(SETTINGS) as { permissions: Permissions };
  change(copy.permissions);
  return copy;
};
const values = (records: MetricRecord[]) => Object.fromEntries(records.map((r) => [r.id, r.value]));

test('the checkout meets every repo row, its records pass the format, and the pinned list keeps every deny rule', () => {
  assert.ok(EXPECTED, 'expected.json passes its check');
  assert.ok((EXPECTED.rows.find((r) => r.id === 'deny_rules_kept')?.values?.length ?? 0) >= 60);
  const records = collect(EXPECTED, SETTINGS, [], RUN);
  assert.deepEqual(values(records), { settings_match: 100, deny_rules_kept: 1, drift_open_hours: 0 });
  const manifest = validateManifest({ ...read('./manifest.json'), signoff_comment: 1 }, 'claude-settings');
  assert.deepEqual(manifest.errors, []);
  assert.deepEqual(validateRecords(records, manifest.value as Manifest, new Date(RUN.now)).errors, []);
});

test('planted drift is caught', () => {
  const cases: [string, unknown, number, number][] = [
    ['an allow rule removed', plant((p) => p.allow.splice(0, 1)), 83.33, 1],
    ['a deny rule removed', plant((p) => p.deny.pop()), 83.33, 0],
    ['an ask rule over the server', plant((p) => (p.ask = ['mcp__claude-code-remote__*'])), 16.67, 1],
    ['a deny rule naming the server', plant((p) => p.deny.push('mcp__claude-code-remote')), 16.67, 1],
    ['a deny rule naming one tool', plant((p) => p.deny.push(TOOL)), 83.33, 1],
    ['every tool denied', plant((p) => p.deny.push('*')), 16.67, 1],
    ['no settings file', null, 0, 0],
  ];
  for (const [name, settings, match, deny] of cases) {
    const v = values(collect(EXPECTED, settings, [], RUN));
    assert.deepEqual([v.settings_match, v.deny_rules_kept, v.drift_open_hours], [match, deny, null], name);
  }
  const row = EXPECTED.rows.find((r) => r.values?.[0] === TOOL)!;
  assert.ok(meets(row, plant((p) => p.deny.push(`Bash(${TOOL})`))), 'a scoped rule never reaches an MCP tool');
  assert.ok(meets(row, plant((p) => p.deny.push('mcp__claude-code'))), 'another server with a shorter name');
});

test('drift counts from the oldest commit in the newest run short of its own expected.json', () => {
  const short = plant((p) => p.allow.splice(0, 1));
  const at = (t: string, expected: Expected | null, settings: unknown): Version => ({ at: t, expected, settings });
  const log = [at('2026-11-04T06:00:00Z', EXPECTED, short), at('2026-11-03T12:00:00Z', EXPECTED, short), at('2026-11-02T00:00:00Z', EXPECTED, SETTINGS)];
  assert.deepEqual(openHours(false, log, RUN.now), { hours: 24, read: 3 });
  assert.deepEqual(openHours(false, [log[0]!, at('2026-11-01T00:00:00Z', null, short)], RUN.now), { hours: 6, read: 2 }, 'nothing was declared before expected.json');
  assert.equal(openHours(false, log.slice(0, 2), RUN.now), null, 'a history that ends inside the run');
  assert.deepEqual(openHours(true, [], RUN.now), { hours: 0, read: 1 });
});

test('startup tokens: what .claude/ loads at launch, the root CLAUDE.md and a rule with paths left out, an import read as missing', () => {
  const checkout = startup(fileURLToPath(new URL('../../../', import.meta.url)));
  assert.ok(checkout && checkout.files >= 1 && checkout.tokens > 0, 'the pull-request skill');
  const dir = mkdtempSync(path.join(tmpdir(), 'startup-'));
  const put = (rel: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  };
  put('CLAUDE.md', 'counted on the Documentation page');
  put('.claude/CLAUDE.md', 'abcd<!-- a note -->efgh\n');
  put('.claude/rules/all.md', '1234');
  put('.claude/rules/web.md', '---\npaths:\n  - "web/**"\n---\nonly with a web file');
  put('.claude/skills/x/SKILL.md', '---\nname: x\ndescription: d\nmodel: m\n---\nthe body loads when invoked');
  // 9 bytes of .claude/CLAUDE.md, 4 of the rule, 22 of the listing: 35 bytes, 9 tokens. The root CLAUDE.md isn't read.
  assert.deepEqual(startup(dir), { tokens: 9, files: 3 });
  put('.claude/CLAUDE.md', 'See @docs/more.md');
  assert.equal(startup(dir), null, 'an import this count does not follow');
  assert.notEqual(loadedText('Write `@README` to keep it literal\n```\n@inside a fence\n```\nmail me@example.com'), null);
});
