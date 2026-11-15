// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repo } from './fixture.ts';
import { longShare, sentences } from './readability.ts';

test('sentences: wrapped prose joins, code, tables and headings stay out, abbreviations do not split', () => {
  const r = repo({
    'a.md': [
      '# A heading that is not counted',
      '',
      'The room runs on Workers, e.g. on the free plan, version 1.2 today.',
      'It reads `web/worker/auth.ts` first.',
      '',
      '| a table | row |',
      '',
      '```',
      'code is not prose at all here',
      '```',
      '',
      '- A list item counts as its own sentence here.',
    ].join('\n'),
  });
  try {
    const list = sentences(r.corpus());
    assert.deepEqual(list.map((s) => s.words), [13, 4, 9]);
  } finally {
    r.done();
  }
});

test('longShare counts sentences over 25 words', () => {
  assert.equal(longShare([{ path: 'a', line: 1, words: 26 }, { path: 'a', line: 2, words: 25 }]), 0.5);
  assert.equal(longShare([]), 0);
});
