// SPDX-License-Identifier: Apache-2.0
// Every deadline on the reviewed list has a place on the SEC clock and draws one dot, filled only when law.json says the
// product states it, so a new flag can't go unseen and a missing view never reads as good.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { joinMetrics, validateManifest } from '../../contract/validate.ts';
import { frameWords } from '../../core/build.ts';
import { countWords, MAX_WORDS } from '../../core/guard.ts';
import type { LawView } from '../../core/law/law.ts';
import { scorePage } from '../../core/score.ts';
import { body, clock, marks } from './page.ts';

const { needs } = JSON.parse(readFileSync(new URL('./needs.json', import.meta.url), 'utf8')) as { needs: { id: string; flags?: { kind: string; text: string }[] }[] };
const count = needs.reduce((sum, n) => sum + (n.flags?.length ?? 0), 0);

test('every flag on the list sits on the clock and draws one dot; with no view, none reads as stated', () => {
  assert.equal(marks(needs).length, count);
  const html = clock(needs, null);
  assert.equal(html.match(/<circle /g)?.length, count);
  assert.equal(html.match(/qs-dot-q/g), null);
});

test('a flag the view marks found draws filled, and only that one', () => {
  const first = needs.find((n) => n.flags?.length)!;
  const view = { rows: [{ id: first.id, flags: [{ ...first.flags![0]!, found: true }] }] } as unknown as LawView;
  assert.equal(clock(needs, view).match(/qs-dot-q/g)?.length, 1);
});

test('the first view stays inside the word budget with a view and every reading missing, so Road to 100 is longest', () => {
  const manifest = validateManifest({ ...JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8')), signoff_comment: 1 }, 'sec').value!;
  const now = new Date('2026-11-06T12:00:00Z');
  const context = { score: scorePage('sec', manifest, [], now), metrics: joinMetrics(manifest, []), history: [], others: {}, detail: null };
  const view = { rows: needs.map((n) => ({ id: n.id, flags: (n.flags ?? []).map((f) => ({ ...f, found: false })) })) } as unknown as LawView;
  const words = countWords(body(context, needs, view));
  assert.ok(words <= MAX_WORDS - frameWords('sec'), `visible words: ${words}, frame: ${frameWords('sec')}`);
});
