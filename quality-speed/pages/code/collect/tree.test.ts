// SPDX-License-Identifier: Apache-2.0
// File and folder scores on invented files, and tree.json read as untrusted.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findingCounts } from './docs.ts';
import { folderScores, outsideCode, readRows, scoreFile } from './tree.ts';

test('a short clean file scores 100 on all three; findings, words and tokens pull each lens down', () => {
  assert.deepEqual(scoreFile('a.md', '# A\n\nShort.\n', 0), ['a.md', 100, 100, 100]);
  assert.deepEqual(scoreFile('b.ts', 'word '.repeat(2380), 5), ['b.ts', 0, 0, 87], '5 findings and 10 minutes are each floor; 2,975 tokens');
  const big = scoreFile('c.ts', 'x'.repeat(24_000), 1);
  assert.equal(big[1], 80, 'one finding: a fifth of the way to the floor');
  assert.equal(big[3], 50, '6,000 tokens: halfway from 10,000 to 2,000');
});

test('a folder is the mean of every file under it, rounded down', () => {
  const f = folderScores([['a.md', 100, 100, 100], ['w/x.ts', 0, 51, 100], ['w/y/z.ts', 50, 50, 50]]);
  assert.deepEqual(f.get(''), { q: 50, s: 67, c: 83 });
  assert.deepEqual(f.get('w'), { q: 25, s: 50, c: 75 });
  assert.deepEqual(f.get('w/y'), { q: 50, s: 50, c: 50 });
});

test('the site stays out, and a bad row is dropped', () => {
  assert.ok(outsideCode('quality-speed/BRIEF.md') && outsideCode('.github/workflows/quality-speed.yml'));
  assert.ok(!outsideCode('.github/workflows/ci.yml'));
  const raw = { files: [['ok.md', 1, 2, 3], ['quality-speed/a.ts', 1, 1, 1], ['../x', 1, 1, 1], ['b.md', 101, 1, 1], ['c.md', '<b>', 1, 1], 'x'] };
  assert.deepEqual(readRows(raw), [['ok.md', 1, 2, 3]]);
  assert.deepEqual(readRows(null), []);
});

test('findings per file add the doc findings and the nightly lane code findings', () => {
  const counts = findingCounts(
    { links: [{ path: 'a.md', line: 1, target: 'x', reason: 'r' }], names: [{ path: 'a.md', line: 2, name: 'n', kind: 'k' }] },
    [{ path: 'a.md', line: 3, words: 26 }, { path: 'a.md', line: 4, words: 25 }],
    [{ path: 'w/x.ts', line: 1, name: 'f', documented: false }, { path: 'w/x.ts', line: 2, name: 'g', documented: true }],
    { shapes: { longFunctions: [{ file: 'w/x.ts' }], escapes: [{ file: 'w/x.ts', count: 3 }] }, deadCode: [{ file: 'w/y.ts' }] },
  );
  assert.deepEqual(Object.fromEntries(counts), { 'a.md': 3, 'w/x.ts': 5, 'w/y.ts': 1 });
});
