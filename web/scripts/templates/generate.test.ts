// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TEMPLATE_TEXT } from '../../mcp/template-text.generated.ts';
import { TEMPLATES } from '../../worker/templates.generated.ts';
import { expectedFiles, readTemplates } from './generate.ts';

test('worker/templates.generated.ts and mcp/template-text.generated.ts match templates/ (run npm run templates in web/)', () => {
  for (const [path, text] of expectedFiles()) assert.equal(readFileSync(path, 'utf8'), text, path);
});

test('every template is listed once, with a title, its entity types and its text word for word', () => {
  const templates = readTemplates();
  assert.deepEqual(TEMPLATES.map((t) => t.path), templates.map((t) => t.path));
  assert.deepEqual(Object.keys(TEMPLATE_TEXT), templates.map((t) => t.path));
  for (const { path, title, entity, text } of templates) {
    assert.equal(TEMPLATE_TEXT[path], text, path);
    assert.ok(title.length > 0 && !title.startsWith('"'), `${path}: title`);
    assert.ok(entity.every((type) => /^[a-z][a-z-]*$/.test(type)), `${path}: entity ${entity.join(',')}`);
  }
  assert.ok(TEMPLATES.some((t) => t.path === 'founders/founders-agreement.md'));
  assert.ok(TEMPLATES.some((t) => t.path.startsWith('raise/')) && TEMPLATES.some((t) => t.path.startsWith('investors/')), 'all three folders');
});
