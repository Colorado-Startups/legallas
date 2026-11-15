// SPDX-License-Identifier: Apache-2.0
// The template page's pure half: only a founder template opens, and every real template splits into its facts and text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileHref, pageHref, splitTemplate, templatePath } from './template-page-model.ts';
import { BASELINE } from '../../worker/checklist-baseline.ts';

const FOUNDERS = path.join(import.meta.dirname, '..', '..', '..', 'templates', 'founders');

test('only a founder template opens', () => {
  assert.equal(templatePath('founders/advisor-agreement.md'), 'founders/advisor-agreement.md');
  for (const bad of [null, '', '../secrets.md', 'founders/../x.md', 'founders/x.html', '/templates/founders/x.md', 'founders/sub/x.md', 'founders/X.md']) {
    assert.equal(templatePath(bad), null, String(bad));
  }
  assert.equal(pageHref('founders/advisor-agreement.md'), '/template/?path=founders%2Fadvisor-agreement.md');
  assert.equal(fileHref('founders/advisor-agreement.md'), '/templates/founders/advisor-agreement.md');
});

test('every template the checklist links opens on the page, with its title and no front matter left in the text', () => {
  const linked = new Set(BASELINE.items.flatMap((item) => (item.templates ?? []).map((template) => template.path)));
  assert.ok(linked.size > 0);
  for (const file of linked) {
    assert.equal(templatePath(file), file, file);
    const { meta, body } = splitTemplate(readFileSync(path.join(FOUNDERS, file.slice('founders/'.length)), 'utf8'));
    assert.ok(meta.title, `${file} has a title`);
    assert.doesNotMatch(body.slice(0, 200), /^---|^id: /m, `${file}: the front matter is gone from the text`);
  }
  assert.ok(readdirSync(FOUNDERS).length >= linked.size);
});

test('front matter: scalars kept, lists left out, text untouched', () => {
  const { meta, body } = splitTemplate('---\ntitle: "Advisor Agreement"\nlevel: [colorado, delaware]\nstatutes:\n  - C.R.S. 8-2-113\ndate_checked: 2026-11-02\n---\n# Advisor Agreement\n\nText.\n');
  assert.deepEqual(meta, { title: 'Advisor Agreement', date_checked: '2026-11-02' });
  assert.equal(body, '# Advisor Agreement\n\nText.\n');
  assert.deepEqual(splitTemplate('# No front matter\n'), { meta: {}, body: '# No front matter\n' });
});
