// SPDX-License-Identifier: Apache-2.0
// The page on invented readings: inside the word budget with the build's title and ring, and a metric with no reading
// shows as missing, never a number.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Manifest, MetricRecord } from '../../contract/format.ts';
import { joinMetrics } from '../../contract/validate.ts';
import { countWords, MAX_WORDS } from '../../core/guard.ts';
import { scorePage } from '../../core/score.ts';
import type { FileRow } from './collect/tree.ts';
import { LABELS, render, tree } from './page.ts';

const ROWS: FileRow[] = [
  ['README.md', 100, 100, 100],
  ['web/a.ts', 40, 100, 80],
  ['web/src/b.ts', 60, 50, 100],
];

// Scored as a signed-off list: an unsigned list takes no readings.
const manifest = { ...JSON.parse(readFileSync(new URL('manifest.json', import.meta.url), 'utf8')), signoff_comment: 1 } as Manifest;
const now = new Date('2030-01-02T00:00:00Z');
const reading = (id: string, value: number): MetricRecord => ({
  id,
  page: 'code',
  value,
  status: 'ok',
  stage: 'lab',
  measured_at: '2030-01-01T12:00:00Z',
  source_url: 'https://github.com/Colorado-Startups/legallas/actions/runs/7',
  sample_size: 100000,
});

test('every metric has a label, the page stays inside 80 visible words, and a missing reading shows as missing', () => {
  for (const m of manifest.metrics) assert.ok(LABELS[m.id], m.id);
  const records = manifest.metrics.filter((m) => m.id !== 'mac_loop_seconds').map((m) => reading(m.id, m.goal));
  const score = scorePage('code', manifest, records, now);
  const { body } = render({ score, metrics: joinMetrics(manifest, records), history: [], others: {}, detail: null }, ROWS);
  // The build adds the title and the score ring's legend: four more words.
  assert.ok(countWords(body) + 4 <= MAX_WORDS, `visible words: ${countWords(body) + 4}`);
  assert.equal(score.metrics.filter((m) => m.reading !== 'measured').length, 1, 'only the one left out reads missing');
  assert.match(body, /Missing/);
  assert.match(body, /Faster Mac/, 'the one metric short of goal has its fix on the Road');
});

test('the tree: the repo and its top folders first, each folder a page of its folders and files, none yet reads missing', () => {
  const { body, pages } = tree(ROWS);
  // The repo: the mean of its three files. web/: of its two.
  assert.match(body, /aria-label="Repo, Quality: 66"/);
  assert.match(body, /aria-label="web\/, Quality: 50"/);
  assert.match(body, /href="tree-1\.html"/);
  assert.deepEqual(Object.keys(pages).sort(), ['tree-0', 'tree-1', 'tree-2']);
  assert.match(pages['tree-1'] ?? '', /src\/.*a\.ts/s, 'web/ lists its folder, then its file');
  assert.match(pages['tree-2'] ?? '', /<a href="tree-1\.html">web<\/a>/, 'a folder links up to its parent');
  assert.match(tree([]).body, /Missing/);
  const hidden: FileRow[] = [...ROWS, ['web/scripts/ask-eval-gate.ts', 10, 10, 10]];
  assert.doesNotMatch(Object.values(tree(hidden).pages).join(''), /ask-eval-/, 'a never-published name stays off the tree');
});
