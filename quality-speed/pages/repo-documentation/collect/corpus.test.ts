// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { headingText, parseComments, parseMarkdown, slugBase } from './corpus.ts';
import { repo } from './fixture.ts';

test('heading slugs follow GitHub: lower case, punctuation dropped, spaces to hyphens', () => {
  assert.equal(slugBase(headingText('What runs where')), 'what-runs-where');
  assert.equal(slugBase(headingText('`npm run dev:seed`')), 'npm-run-devseed');
  assert.equal(slugBase(headingText('Q&A: the [room](x.md)!')), 'qa-the-room');
  assert.equal(slugBase(headingText('Cloudflare and Claude')), 'cloudflare-and-claude');
  assert.equal(slugBase(headingText('snake_case stays')), 'snake_case-stays');
});

test('a repeated heading gets -1, -2', () => {
  const doc = parseMarkdown('a.md', '# Setup\n\n## Setup\n\n## Setup\n');
  assert.deepEqual(doc.headings.map((h) => h.slug), ['setup', 'setup-1', 'setup-2']);
});

test('links, code spans and fences are read apart; a link inside code is not a link', () => {
  const doc = parseMarkdown('a.md', 'See [b](b.md#top) and `[c](c.md)`.\n\n```bash\nnpm run dev\n```\n\n[ref]: d.md\n');
  assert.deepEqual(doc.links.map((l) => l.target), ['b.md#top', 'd.md']);
  assert.deepEqual(doc.spans.map((s) => s.code), ['[c](c.md)']);
  assert.equal(doc.fences.length, 1);
  assert.equal(doc.fences[0]?.lang, 'bash');
  assert.match(doc.fences[0]?.body ?? '', /npm run dev/);
});

test('a heading inside a fence is not a heading', () => {
  const doc = parseMarkdown('a.md', '```\n# not a heading\n```\n# Real\n');
  assert.deepEqual(doc.headings.map((h) => h.text), ['Real']);
});

test('comments: full lines only, shebangs skipped', () => {
  const list = parseComments('x.sh', '#!/bin/sh\n# One `a.sh`\necho hi # trailing\n  # two\n');
  assert.deepEqual(list.map((c) => [c.line, c.text]), [[2, 'One `a.sh`'], [4, 'two']]);
});

test('the corpus leaves out quality-speed/, keeps templates/ and .github comments', () => {
  const r = repo({
    'README.md': '# R\n',
    'templates/form.md': '# F\n',
    'quality-speed/pages/x/PLAN.md': '# P\n',
    '.github/workflows/ci.yml': '# A comment\non: push\n',
  });
  try {
    const c = r.corpus();
    assert.deepEqual([...c.docs.keys()], ['README.md', 'templates/form.md']);
    assert.deepEqual(c.comments.map((m) => m.path), ['.github/workflows/ci.yml']);
    assert.ok(c.fileSet.has('quality-speed/pages/x/PLAN.md'));
  } finally {
    r.done();
  }
});
