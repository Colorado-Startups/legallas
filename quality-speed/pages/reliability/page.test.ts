// SPDX-License-Identifier: Apache-2.0
// The page renders from invented records, every metric shows, a broken reading stays red, and the words stay in budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Manifest } from '../../contract/format.ts';
import { joinMetrics } from '../../contract/validate.ts';
import { countWords, MAX_WORDS } from '../../core/guard.ts';
import { scorePage } from '../../core/score.ts';
import { METRIC_IDS, toRecord, type Reading } from './measure.ts';
import { render, reviewMatrix } from './page.ts';

const NOW = new Date('2026-11-02T12:00:00Z');
const AT = '2026-11-02T06:00:00Z';
const RUN = 'https://github.com/Colorado-Startups/legallas/actions/runs/1';
const manifest = { ...JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8')), signoff_comment: 1 } as Manifest;

function context(reading: (id: string, goal: number) => Reading) {
  const records = METRIC_IDS.map((id) => toRecord(id, reading(id, manifest.metrics.find((m) => m.id === id)!.goal), AT, RUN));
  return { score: scorePage('reliability' as Manifest['page'], manifest, records, NOW), metrics: joinMetrics(manifest, records) };
}

test('every metric at its goal reads 100, with its label on the page', () => {
  const ctx = context((_, goal) => ({ value: goal, samples: 1 }));
  assert.equal(ctx.score.total, 100);
  const { body } = render(ctx);
  for (const label of ['Open high', 'To find', 'Fix high', 'SSN guard']) assert.ok(body.includes(label), label);
});

test('a metric that could not be read scores 0 and stays on the page, in red', () => {
  const ctx = context((id, goal) => (id === 'open_bugs_critical_high' ? null : { value: goal, samples: 1 }));
  assert.equal(ctx.score.metrics.find((m) => m.id === 'open_bugs_critical_high')?.score, 0);
  const { body } = render(ctx);
  assert.ok(body.includes('Open high'));
  assert.ok(body.includes('missing'));
});

test('a page with no signed-off list still renders', () => {
  const { body } = render({ score: scorePage('reliability' as Manifest['page'], null, [], NOW), metrics: [] });
  assert.ok(body.includes('SSN guard'));
});

test('the words stay in budget and there is no em dash', () => {
  const { body } = render(context((_, goal) => ({ value: goal, samples: 1 })));
  assert.ok(countWords(body) <= MAX_WORDS, `${countWords(body)} words`);
  assert.equal(body.includes('\u2014'), false);
});

test('an area a review skipped shows as failed for that review', () => {
  const html = reviewMatrix([{ date: '2026-11-02', areas: ['citations'], bugs: [] }]);
  assert.ok(html.includes('qs-dm-pass') && html.includes('qs-dm-fail'));
});
