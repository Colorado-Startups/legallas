// SPDX-License-Identifier: Apache-2.0
// R83: the /doc/ viewer demotes a Markdown file's headings one level, so the page keeps a single h1.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { renderMarkdown, renderUnderPageTitle } from './markdown.ts';

const SAMPLE = '# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n';

test('headings keep their levels by default (folder guides)', () => {
  const html = renderMarkdown(SAMPLE);
  for (let n = 1; n <= 6; n++) assert.match(html, new RegExp(`<h${n}>`));
});

test('a shift of one turns h1 into h2 and so on, capped at h6', () => {
  const html = renderMarkdown(SAMPLE, 1);
  assert.doesNotMatch(html, /<h1[ >]/);
  assert.match(html, /<h2>One<\/h2>/);
  assert.match(html, /<h3>Two<\/h3>/);
  assert.match(html, /<h6>Five<\/h6>/);
  assert.match(html, /<h6>Six<\/h6>/);
  assert.equal((html.match(/<h6>/g) ?? []).length, 2);
});

test('setext headings and the shift do not leak into the next render', () => {
  assert.match(renderMarkdown('Title\n=====\n', 1), /<h2>Title<\/h2>/);
  assert.match(renderMarkdown('# Plain\n'), /<h1>Plain<\/h1>/);
});

test('a file shown under the page h1 starts at h2 (R89)', () => {
  const html = renderUnderPageTitle(SAMPLE);
  assert.doesNotMatch(html, /<h1[ >]/);
  assert.match(html, /<h2>One<\/h2>/);
  assert.match(html, /<h3>Two<\/h3>/);
});

test('every viewer under a page h1 renders through renderUnderPageTitle: the doc viewer, the pane and the folder guide', () => {
  for (const file of ['doc-views.ts', 'documents-table-view.ts']) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.match(source, /renderUnderPageTitle\(/, `${file} renders through renderUnderPageTitle`);
    assert.doesNotMatch(source, /renderMarkdown\(/, `${file} does not render with a bare shift`);
  }
});
