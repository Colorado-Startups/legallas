// SPDX-License-Identifier: Apache-2.0
// The By date picture's layout (story-layout.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anyDated, compareDates, placeable, storyRows, type StoryMilestone, type StoryOrg } from './story-layout.ts';

const org = (id: string, formed: string | null, parent: string | null = null, name = id): StoryOrg => ({
  id, name, side: 'defendant', parent, formed,
});
const step = (date: string, mark = 'C'): StoryMilestone => ({ date, label: `On ${date}`, kind: 'step', mark });
const suit = (date: string): StoryMilestone => ({ date, label: 'Suit filed', kind: 'suit', mark: null });

test('partial dates order by the day they start, the more precise first on a tie', () => {
  const dates = ['2014', '2012', '2012-01-01', '2011', '2013-02-10', '2012-01'];
  assert.deepEqual([...dates].sort(compareDates), ['2011', '2012-01-01', '2012-01', '2012', '2013-02-10', '2014']);
});

test('only real partial ISO dates are placeable', () => {
  assert.equal(placeable('2012-05-09'), '2012-05-09');
  assert.equal(placeable('2013'), '2013');
  for (const bad of ['2013-13', '2013-02-32', '', 'soon', null, undefined]) assert.equal(placeable(bad), null);
});

test('a same-day batch shares one row; milestones get rows of their own, undated entities come last', () => {
  const orgs = [org('grp', '2011'), org('d', '2012-05-09'), org('a', '2012-05-09'), org('vi', '2014'), org('x', null)];
  const milestones = [step('2012-05-09'), step('2013-02-10', 'A'), suit('2014-04-03'), step('2014-06-15')];
  const rows = storyRows(orgs, milestones);
  assert.deepEqual(rows.map((r) => r.date), ['2011', '2012-05-09', '2013-02-10', '2014', '2014-04-03', '2014-06-15', null]);
  assert.deepEqual(rows[1], { date: '2012-05-09', orgs: ['a', 'd'], milestones: [0] });
  assert.deepEqual(rows[2], { date: '2013-02-10', orgs: [], milestones: [1] });
  assert.deepEqual(rows[4].milestones, [2]);
  assert.deepEqual(rows[6].orgs, ['x']);
});

test('two milestones on one day share its row, in the order given', () => {
  const rows = storyRows([], [step('2014-05-08', 'C'), suit('2014-05-08')]);
  assert.deepEqual(rows, [{ date: '2014-05-08', orgs: [], milestones: [0, 1] }]);
});

test('within a row a parent comes before the entities under it, then names in order', () => {
  const orgs = [org('kid', '2012-05-09', 'top', 'Alpha Cafe'), org('top', '2012-05-09', null, 'Zulu Labs'), org('b', '2012-05-09', null, 'Bravo Grill')];
  assert.deepEqual(storyRows(orgs, [])[0].orgs, ['b', 'top', 'kid']);
});

test('a milestone with an unplaceable date gets no row', () => {
  assert.deepEqual(storyRows([org('a', '2013')], [step('later')]).map((r) => r.milestones), [[]]);
});

test('anyDated is false only when no entity has a placeable formation date', () => {
  assert.equal(anyDated([org('a', null), org('b', 'soon')]), false);
  assert.equal(anyDated([org('a', null), org('b', '2012')]), true);
  assert.equal(anyDated([]), false);
});
