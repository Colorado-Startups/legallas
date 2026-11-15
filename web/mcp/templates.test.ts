// SPDX-License-Identifier: Apache-2.0
// legallas_template's results (mcp/templates.ts) on the real template library: the list, every part of every template
// for both profiles, and the errors a model recovers from.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASELINE } from '../worker/checklist-baseline.ts';
import { TEMPLATE_PART_TOKENS, tokensOf } from '../worker/template-parts.ts';
import { TEMPLATES } from '../worker/templates.generated.ts';
import { COMPACT_LIMITS, type ResponseProfile } from './contract.ts';
import { compactChars } from './format.ts';
import { TEMPLATE_TEXT } from './template-text.generated.ts';
import { templateList, templatePart } from './templates.ts';

type Obj = Record<string, any>;
const value = (result: { structuredContent?: unknown }) => result.structuredContent as Obj;

/** Every part of a list or a template, following next_part from part 1. */
function walk(read: (part: number) => { structuredContent?: unknown; isError?: boolean }): Obj[] {
  const out: Obj[] = [];
  for (let part: number | null = 1; part !== null; part = out.at(-1)!.next_part) {
    const result = read(part);
    assert.equal(result.isError, undefined, `part ${part}`);
    out.push(value(result));
    assert.equal(out.at(-1)!.part, part);
  }
  return out;
}

test('the list names every template once, with its title, entity types and part count, under the A5 notice', () => {
  for (const profile of ['standard', 'compact'] as ResponseProfile[]) {
    const parts = walk((part) => templateList(profile, part));
    const rows = parts.flatMap((p) => p.templates);
    assert.deepEqual(rows.map((r) => r.path), TEMPLATES.map((t) => t.path), profile);
    for (const p of parts) assert.equal(p.notice, BASELINE.template_notice);
    for (const r of rows) assert.ok(r.title && r.entity.length > 0 && r.parts >= 1, `${profile} ${r.path}`);
    if (profile === 'standard') assert.equal(parts.length, 1, 'standard: one part');
    else for (const p of parts) assert.ok(p.templates.length <= COMPACT_LIMITS.maxItems && compactChars(p) <= COMPACT_LIMITS.maxChars, `compact list part ${p.part}: ${compactChars(p)}`);
  }
});

test('every template reads back whole, part by part: 10,000 tokens a part for Claude, within 9,000 characters as sent for Copilot', () => {
  let largest = 0;
  for (const { path, title } of TEMPLATES) {
    for (const profile of ['standard', 'compact'] as ResponseProfile[]) {
      const parts = walk((part) => templatePart(path, profile, part));
      assert.equal(parts.map((p) => p.text).join(''), TEMPLATE_TEXT[path], `${profile} ${path}`);
      for (const p of parts) {
        assert.deepEqual([p.path, p.title, p.notice, p.parts], [path, title, BASELINE.template_card_notice, parts.length]);
        if (profile === 'standard') assert.ok(tokensOf(p.text) <= TEMPLATE_PART_TOKENS, `${path} part ${p.part}`);
        else assert.ok(compactChars(p) <= COMPACT_LIMITS.maxChars, `${path} part ${p.part}: ${compactChars(p)} characters as sent`);
      }
      assert.equal(parts.at(-1)!.next_part, null);
      if (profile === 'standard') largest = Math.max(largest, ...parts.map((p) => tokensOf(p.text)));
    }
  }
  assert.ok(largest <= TEMPLATE_PART_TOKENS, `largest part ${largest} tokens`);
});

test('part 1 when left out; an unknown path or a part out of range says how to recover', () => {
  assert.deepEqual(value(templatePart('founders/founders-agreement.md', 'standard')), value(templatePart('founders/founders-agreement.md', 'standard', 1)));
  const errors = [templatePart('founders/missing.md', 'standard'), templatePart('../secrets.md', 'standard'), templatePart('constructor', 'standard'), templatePart('founders/founders-agreement.md', 'standard', 99), templateList('standard', 2)];
  for (const result of errors) {
    assert.equal(result.isError, true);
    assert.match((result.content[0] as { text: string }).text, /^not_found: (No template has that path\. Leave path out for the list\.|part runs from 1 to \d+\.)$/);
  }
});
