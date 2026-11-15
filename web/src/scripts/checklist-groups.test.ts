// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASELINE } from '../../worker/checklist-baseline.ts';
import { buildChecklist, type ChecklistStatus } from '../../worker/checklist.ts';
import { groupingOf, groupItems, STATUS_MEANINGS } from './checklist-groups.ts';

const view = buildChecklist({ entityType: 'delaware-c-corporation', formationDate: '2026-09-28' }, [], [], '2026-11-01');

test('the stage view is the page unless a link asks for relationships', () => {
  assert.equal(groupingOf(null), 'stage');
  assert.equal(groupingOf('nonsense'), 'stage');
  assert.equal(groupingOf('relationship'), 'relationship');
});

test('either grouping holds every item once, in the list order', () => {
  for (const grouping of ['stage', 'relationship'] as const) {
    const groups = groupItems(view, view.items, grouping);
    assert.deepEqual(groups.flatMap((group) => group.items.map((item) => item.id)).sort(), view.items.map((item) => item.id).sort());
  }
  assert.deepEqual(
    groupItems(view, view.items, 'relationship').map((group) => group.id),
    BASELINE.vocabulary.relationships.filter((id) => view.items.some((item) => item.relationship === id)),
  );
});

test('a relationship group carries its label, and an empty group is left out', () => {
  const groups = groupItems(view, view.items.filter((item) => item.relationship === 'founders-and-company'), 'relationship');
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.label, BASELINE.labels.relationships['founders-and-company']);
  assert.equal(groupItems(view, [], 'stage').length, 0);
});

test('a relationship opens on its own only while it holds something besides "not yet"', () => {
  const later = view.items.filter((item) => item.status === 'not_yet');
  assert.ok(later.length > 0);
  for (const group of groupItems(view, later, 'relationship')) assert.equal(group.active, false);
  assert.ok(groupItems(view, view.items, 'relationship').some((group) => group.active));
});

test('every status has a meaning, in words that never say a company needs it', () => {
  const statuses = Object.keys(view.counts) as ChecklistStatus[];
  assert.deepEqual(Object.keys(STATUS_MEANINGS).sort(), statuses.sort());
  for (const meaning of Object.values(STATUS_MEANINGS)) assert.doesNotMatch(meaning, /\b(must|required|need[s]? to|should have)\b|—/i);
});
