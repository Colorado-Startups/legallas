// SPDX-License-Identifier: Apache-2.0
// Entities & People, the By date view's pure half (people-dates.ts), against the fictional fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServedMatter } from './matter-api.ts';
import {
  datedOrgs, datesPicture, dateViolations, pickViolation, suitMilestone, violationEntities, withParents,
} from './people-dates.ts';
import { anyDated, storyRows } from './viz/story-layout.ts';

function matter(): ServedMatter {
  return JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'fixtures', 'matter.example.json'), 'utf8')) as ServedMatter;
}

test('the view draws every organization but courts and agencies; the fixture leaves five undated', () => {
  const orgs = datedOrgs(matter());
  assert.ok(!orgs.some((o) => o.id === 'org-court' || o.id === 'org-labor'));
  assert.ok(orgs.some((o) => o.id === 'org-low-law'));
  assert.deepEqual(orgs.filter((o) => !o.formed).map((o) => o.id), ['org-board', 'org-ceo-office', 'org-copperline', 'org-acme-bank', 'org-tally']);
  assert.equal(anyDated(orgs), true);
});

test('chips come in letter order; a deep link only picks a violation the matter has', () => {
  const m = matter();
  assert.deepEqual(dateViolations(m).map((v) => v.mark), ['A', 'B', 'C', 'D']);
  assert.equal(pickViolation(m, 'viol-repurchase')?.mark, 'C');
  assert.equal(pickViolation(m, 'v-z'), null);
  assert.equal(pickViolation(m, null), null);
  assert.deepEqual(dateViolations({ ...m, violations: undefined }), []);
});

test("a violation's entities include its steps' entities and both ends of their moves", () => {
  const c = pickViolation(matter(), 'viol-repurchase');
  assert.ok(c);
  const ids = violationEntities(c);
  for (const id of ['org-unvested', 'org-treasury']) assert.ok(ids.has(id), id);
});

test('withParents climbs to the top and stops at a loop', () => {
  const orgs = [
    { id: 'top', name: 'Top', side: 'defendant' as const, parent: null },
    { id: 'mid', name: 'Mid', side: 'defendant' as const, parent: 'top' },
    { id: 'kid', name: 'Kid', side: 'nominal' as const, parent: 'mid' },
    { id: 'x', name: 'X', side: 'nominal' as const, parent: 'y' },
    { id: 'y', name: 'Y', side: 'nominal' as const, parent: 'x' },
  ];
  assert.deepEqual([...withParents(orgs, new Set(['kid']))].sort(), ['kid', 'mid', 'top']);
  assert.deepEqual([...withParents(orgs, new Set(['x']))].sort(), ['x', 'y']);
});

test('All draws every entity, every step under its mark and the suit, with each entity\'s marks', () => {
  const m = matter();
  const pic = datesPicture(m, null);
  assert.equal(pic.focus, null);
  assert.equal(pic.orgs.length, datedOrgs(m).length);
  const steps = (m.violations ?? []).reduce((n, v) => n + v.steps.length, 0);
  assert.equal(pic.milestones.filter((x) => x.kind === 'step').length, steps);
  assert.deepEqual(pic.milestones.filter((x) => x.kind === 'suit').map((x) => x.date), [m.meta.filed]);
  assert.deepEqual(pic.marks.get('org-board'), ['A', 'B']);
  assert.equal(pic.marks.get('org-low-law'), undefined);
});

test('one violation narrows to its entities, their parents and its own steps; the suit stays', () => {
  const pic = datesPicture(matter(), 'viol-notice');
  assert.deepEqual(pic.orgs.map((o) => o.id).sort(), ['org-board', 'org-ceo-office', 'org-harbor']);
  assert.deepEqual(pic.focus && [...pic.focus.ids].sort(), ['org-board', 'org-ceo-office']);
  assert.equal(pic.focus?.mark, 'A');
  assert.ok(pic.milestones.every((x) => x.kind === 'suit' || x.mark === 'A'));
  assert.equal(pic.milestones.filter((x) => x.kind === 'suit').length, 1);
});

test('an unknown violation id draws All', () => {
  assert.equal(datesPicture(matter(), 'v-z').focus, null);
});

test('the suit is the matter\'s filing, else the closed prior case\'s, else none', () => {
  const meta = matter().meta;
  assert.equal(suitMilestone(meta)?.label, 'Suit filed');
  const prior = { caption: 'x', court: 'x', caseNumber: null, division: null, judge: null, filed: '2012-12-17', operativePleading: null };
  assert.deepEqual(suitMilestone({ ...meta, filed: null, priorCase: prior }),
    { date: '2012-12-17', label: 'Suit filed (prior case, closed)', kind: 'suit', mark: null });
  assert.equal(suitMilestone({ ...meta, filed: null, priorCase: null }), null);
});

test('the fixture lays out earliest first with the steps on the spine', () => {
  const pic = datesPicture(matter(), 'viol-repurchase');
  const rows = storyRows(pic.orgs, pic.milestones);
  const dates = rows.map((r) => r.date);
  assert.deepEqual(dates, [...dates].filter((d) => d !== null).sort(), 'no undated row under C, ascending');
  assert.equal(storyRows(datesPicture(matter(), null).orgs, []).at(-1)?.date, null, 'All ends on the undated row');
  const formedRow = rows.find((r) => r.date === '2011-06-07');
  assert.ok(formedRow && formedRow.milestones.length === 1 && formedRow.orgs.includes('org-unvested'));
});
