// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repo } from './fixture.ts';
import { type Question } from './questions.ts';
import { percentile, reachAll } from './reach.ts';

const q = (id: string, pattern: string, audience: 'agent' | 'person' = 'agent'): Question => ({
  id,
  audience,
  question: id,
  accept: [],
  doc: { path: 'docs/deep.md', pattern },
  truth: [],
});

test('reading time follows links from the entry, skimming headings and reading one section', () => {
  const r = repo({
    'CLAUDE.md': '# Start\n\nOne two three.\n\n## Where\n\nRead docs/deep.md for it.\n',
    'README.md': '# Hello\n\nNothing here links on.\n',
    'docs/deep.md': '# Deep\n\n## Part\n\nfour five six seven answer-here\n',
  });
  try {
    const [hit, miss, unreached] = reachAll(r.corpus(), [q('hit', 'answer-here'), q('miss', 'absent'), q('none', 'answer-here', 'person')]);
    // CLAUDE.md: headings "Start" and "Where" (2 words), then section "Where" down to the link: "Where" and 4 words (5).
    // deep.md: headings "Deep" and "Part" (2), then section "Part" down to the answer: "Part" and 5 words (6).
    assert.equal(hit?.words, 2 + 5 + 2 + 6);
    assert.deepEqual(hit?.path, ['CLAUDE.md', 'docs/deep.md']);
    assert.equal(miss?.words, null);
    assert.equal(unreached?.words, null, 'README.md never reaches the doc');
  } finally {
    r.done();
  }
});

test('the answer counts wherever the docs state it, so a quicker place needs no change to the set', () => {
  const r = repo({
    'CLAUDE.md': '# Start\n\nanswer-here\n\nAlso docs/deep.md.\n',
    'docs/deep.md': '# Deep\n\nanswer-here\n',
  });
  try {
    const [hit] = reachAll(r.corpus(), [q('hit', 'answer-here')]);
    assert.deepEqual(hit?.path, ['CLAUDE.md']);
  } finally {
    r.done();
  }
});

test('percentile: nearest rank, nulls sort last', () => {
  assert.equal(percentile([3, 1, 2, 4, 5, 6, 7, 8, 9, 10], 90), 9);
  assert.equal(percentile([1, null], 50), 1);
  assert.equal(percentile([1, null], 90), null);
  assert.equal(percentile([], 90), null);
});
