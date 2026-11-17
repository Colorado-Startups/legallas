// SPDX-License-Identifier: Apache-2.0
//   node --test quality-speed/pages/launch-readiness/page.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { HistoryLine, Manifest } from '../../contract/format.ts';
import { joinMetrics } from '../../contract/validate.ts';
import type { PageContext } from '../../core/build.ts';
import { countWords, MAX_WORDS } from '../../core/guard.ts';
import { combine, scorePage, type ScoredRow } from '../../core/score.ts';
import { checks, type Conditions, detail, isScored, records } from './collect.ts';
import { LIST, metIn, render, road } from './page.ts';

const now = new Date('2026-11-20T06:00:00Z');
const manifest: Manifest = JSON.parse(readFileSync(new URL('manifest.json', import.meta.url), 'utf8'));
const run = 'https://github.com/Colorado-Startups/legallas/actions/runs/1';
// Two conditions met: the new description and the notices. Their numbers are ones no real row uses.
const list: Conditions = { ...LIST, conditions: LIST.conditions.map((c) => (c.id === 'description' ? { ...c, evidence: 901 } : c.id === 'notices' ? { ...c, evidence: 902 } : c)) };
const rows = detail(list, new Map([['issue:901', '2026-11-13T00:00:00Z'], ['issue:902', '2026-11-20T05:00:00Z']]));
const recs = records(list, rows, now, run);
const signed = { ...manifest, signoff_comment: 1 };
const history: HistoryLine[] = [
  { at: '2026-11-12T06:00:00Z', page: 'launch-readiness', quality: 0, speed: 0, total: 0 },
  { at: '2026-11-13T06:00:00Z', page: 'launch-readiness', quality: 3, speed: 0, total: 2 },
];
const context = (m: Manifest): PageContext => ({ score: scorePage('launch-readiness', m, recs, now), metrics: joinMetrics(m, recs), history, others: {}, detail: checks(rows) });

test('the body stays well inside the 80-word limit', () => {
  assert.ok(countWords(render(context(signed), list).body) <= MAX_WORDS - 15);
});

test("group counts come from the lane's verified checks", () => {
  const { detail } = context(signed);
  assert.equal(metIn(list, detail, 'claims'), 1);
  assert.equal(metIn(list, detail, 'ai'), 1);
  assert.equal(metIn(list, detail, 'security'), 0);
  assert.equal(metIn(list, null, 'claims'), 0);
});

test("Road to 100: the fixes take today's score to exactly 100", () => {
  const ctx = context(signed);
  const rows: ScoredRow[] = ctx.metrics.map((m, i) => ({ id: m.id, lens: m.lens, weight: m.weight, score: ctx.score.metrics[i]?.score ?? 0 }));
  const fixes = road(list, ctx);
  const q = fixes.reduce((a, f) => a + f.q, combine(rows).exact_quality);
  const s = fixes.reduce((a, f) => a + f.s, combine(rows).exact_speed);
  assert.equal(Math.floor(Number(((2 * q + s) / 3).toFixed(6))), 100);
});

test('Road to 100 lists the steps that add points and draws no cap mark', () => {
  const open = context(signed);
  assert.ok(road(list, open).every((f) => f.q + f.s > 0));
  assert.doesNotMatch(render(open, list).body, /qs-cap/);
});

test('each scored condition reads met or open from the lane\'s detail, card rows read Board, and blank without one', () => {
  const body = render(context(signed), list).body;
  assert.equal((body.match(/<td>Met<\/td>/g) ?? []).length, 2);
  assert.equal((body.match(/<td>Open<\/td>/g) ?? []).length, LIST.conditions.filter(isScored).length - 2);
  assert.equal((body.match(/<td>Board<\/td>/g) ?? []).length, 4);
  assert.doesNotMatch(render({ ...context(signed), detail: null }, list).body, /<td>(Met|Open)<\/td>/);
});

test("the owner's conditions show, and an unsigned list still renders", () => {
  const owners = LIST.conditions.filter((c) => c.owner);
  const met = owners.filter((c) => c.evidence !== null).length;
  assert.ok(render(context(signed), list).body.includes(`Needs the owner: ${met} of ${owners.length}`));
  assert.ok(render(context(manifest), list).body.length > 0);
});

test('a condition without evidence links the eval that tests it, and the eval exists (card 11.4)', () => {
  const body = render(context(signed), list).body;
  const withEval = LIST.conditions.filter((c) => c.eval !== undefined);
  assert.deepEqual(withEval.map((c) => [c.id, c.eval]), [['people_guard', 'web/scripts/ask-eval.people.json']]);
  for (const c of withEval) {
    assert.ok(existsSync(new URL(`../../../${c.eval}`, import.meta.url)), `${c.eval} exists`);
    assert.ok(body.includes(`<a href="https://github.com/Colorado-Startups/legallas/blob/main/${c.eval}">`), c.id);
  }
  assert.equal((body.match(/<td>Eval<\/td>/g) ?? []).length, withEval.length);
});
