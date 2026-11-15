// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { join } from 'node:path';
import { isTemplateFile, splitText, TEMPLATE_PART_TOKENS, templateParts, tokensOf } from './template-parts.ts';

const DIR = join(import.meta.dirname, '..', '..', 'templates');
const TEMPLATES = readdirSync(DIR, { recursive: true, encoding: 'utf8' }).filter(isTemplateFile).sort();

test('templates are the .md files under templates/, less READMEs, the licence record and held-back/', () => {
  for (const path of ['founders/founders-agreement.md', 'raise/x.md', 'investors/groups/x.md']) assert.ok(isTemplateFile(path), path);
  for (const path of ['README.md', 'founders/README.md', 'bundled-forms.md', 'held-back/x.md', 'LICENSE', 'founders/x.html']) assert.ok(!isTemplateFile(path), path);
  assert.ok(TEMPLATES.length >= 65, `${TEMPLATES.length} templates`);
});

test('a template fits one part when it can, and splits before a heading when it cannot', () => {
  const text = '# A\n\nOne.\n\n## B\n\nTwo.\n';
  assert.deepEqual(templateParts(text), [text]);
  assert.deepEqual(splitText(text, 12), ['# A\n\nOne.\n\n', '## B\n\nTwo.\n']);
});

test('a section over the limit splits at paragraph breaks, then sentence ends, never inside a sentence', () => {
  const section = `## A\n\n${'Para one is here. '.repeat(3)}\n\n${'Para two is here. '.repeat(3)}\n`;
  const parts = splitText(section, 70);
  assert.equal(parts.join(''), section);
  assert.ok(parts.every((part) => part.length <= 70), parts.map((p) => p.length).join(','));
  for (const part of parts.slice(0, -1)) assert.match(part, /(\n\n|\. )$/, `"${part.slice(-12)}" ends a paragraph or sentence`);
  const sentence = `A sentence with no end ${'word '.repeat(40)}`;
  assert.deepEqual(splitText(sentence, 50), [sentence], 'one sentence over the limit stays whole');
  assert.deepEqual(splitText('See U.S.C. 77l and Inc. the rest. Next one.', 20), ['See U.S.C. 77l and Inc. the rest. ', 'Next one.'], 'no split before a number or a lower-case word');
});

test('every template splits into parts of at most 10,000 tokens that join back to its text', () => {
  let largest = 0;
  for (const path of TEMPLATES) {
    const text = readFileSync(join(DIR, path), 'utf8');
    const parts = templateParts(text);
    assert.equal(parts.join(''), text, path);
    for (const part of parts) assert.ok(tokensOf(part) <= TEMPLATE_PART_TOKENS, `${path}: ${tokensOf(part)} tokens`);
    largest = Math.max(largest, ...parts.map(tokensOf));
  }
  assert.ok(largest > 5_000, `the largest part, ${largest} tokens, is a real part`);
});

test('a cost other than characters packs by that cost', () => {
  const wire = (t: string) => JSON.stringify(JSON.stringify(t)).length - 2;
  const text = `# A\n\n${'"Quoted" line.\n\n'.repeat(20)}# B\n\nplain\n`;
  const parts = splitText(text, 200, wire);
  assert.equal(parts.join(''), text);
  assert.ok(parts.every((part) => wire(part) <= 200), parts.map(wire).join(','));
});
