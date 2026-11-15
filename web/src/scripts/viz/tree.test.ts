// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formedOf, gutterX, hexPath, layoutTree, moveElbow, moveRoute, parentsOf, routeMove, wrapName, type TreeOrg,
} from './tree.ts';
import { tileSpan, type RouteTile } from './tree-geometry.ts';

const org = (id: string, parent: string | null = null, extra: Partial<TreeOrg> = {}): TreeOrg => ({
  id, name: extra.name ?? id, kind: 'company', side: 'nominal', parent, ...extra,
});

test('a parent sits centred over its children and leaves take one column each', () => {
  const layout = layoutTree([org('top'), org('a', 'top'), org('b', 'top'), org('c', 'top')], { collapseOver: 6 });
  const at = new Map(layout.nodes.map((n) => [n.key, n]));
  assert.deepEqual(['a', 'b', 'c'].map((k) => at.get(k)?.col), [0, 1, 2]);
  assert.equal(at.get('top')?.col, 1);
  assert.equal(at.get('top')?.descendants, 3);
  assert.equal(layout.columns, 3);
  assert.equal(layout.levels, 2);
  assert.deepEqual(layout.edges, [{ from: 'top', to: 'a' }, { from: 'top', to: 'b' }, { from: 'top', to: 'c' }]);
});

test('subtrees never overlap: each level reads left to right without sharing a column', () => {
  const orgs = [org('r'), org('x', 'r'), org('y', 'r'), org('x1', 'x'), org('x2', 'x'), org('x3', 'x'), org('y1', 'y'), org('lone')];
  const layout = layoutTree(orgs, { collapseOver: 6 });
  for (let depth = 0; depth < layout.levels; depth += 1) {
    const cols = layout.nodes.filter((n) => n.depth === depth).map((n) => n.col);
    assert.equal(new Set(cols).size, cols.length, `level ${depth} shares a column`);
    assert.deepEqual(cols, [...cols].sort((a, b) => a - b), `level ${depth} is out of order`);
  }
  assert.deepEqual(layout.nodes.map((n) => n.row), layout.nodes.map((_, i) => i), 'rows are the preorder');
  assert.equal(layout.nodes.at(-1)?.key, 'lone', 'lone entities come after the structures');
});

test('siblings run oldest formed first; unknown and malformed dates last', () => {
  const layout = layoutTree([
    org('p'), org('late', 'p', { formed: '2013-06' }), org('none', 'p'), org('early', 'p', { formed: '2011' }),
    org('bad', 'p', { formed: '2013-13-01' }),
  ], { collapseOver: 6 });
  assert.deepEqual(layout.nodes.filter((n) => n.depth === 1).map((n) => n.key), ['early', 'late', 'bad', 'none']);
  assert.equal(formedOf({ formed: '2012-01-01' }), '2012-01-01');
  assert.equal(formedOf({ formed: '2013-13-01' }), null);
  assert.equal(formedOf({}), null, 'a manifest without formed reads as unknown');
});

test('unknown, self and cyclic parents become roots instead of looping', () => {
  const parents = parentsOf([org('a', 'b'), org('b', 'a'), org('c', 'c'), org('d', 'gone')]);
  assert.equal(parents.get('c'), null);
  assert.equal(parents.get('d'), null);
  assert.ok(parents.get('a') === null || parents.get('b') === null, 'one edge of the cycle is cut');
  const layout = layoutTree([org('a', 'b'), org('b', 'a'), org('c', 'c'), org('d', 'gone')], { collapseOver: 6 });
  assert.equal(layout.nodes.length, 4);
});

test('a sibling group over the limit folds into one node until expanded', () => {
  const orgs = [org('holdco'), ...Array.from({ length: 9 }, (_, i) => org(`site-${i}`, 'holdco', { formed: `2011-05-1${i}` })), org('site-0-sub', 'site-0')];
  const folded = layoutTree(orgs, { collapseOver: 6 });
  const group = folded.nodes.find((n) => n.type === 'group');
  assert.ok(group);
  assert.equal(group.key, 'group:holdco');
  assert.equal(group.members.length, 9);
  assert.equal(group.descendants, 10, 'a folded member brings its own subtree');
  assert.equal(folded.keyOf.get('site-3'), 'group:holdco');
  assert.equal(folded.keyOf.get('site-0-sub'), 'group:holdco');
  assert.deepEqual(folded.groups, [{ parent: 'holdco', size: 9, expanded: false }]);
  assert.equal(folded.nodes.length, 2);

  const open = layoutTree(orgs, { collapseOver: 6, expanded: new Set(['holdco']) });
  assert.equal(open.nodes.some((n) => n.type === 'group'), false);
  assert.equal(open.nodes.length, 11);
  assert.deepEqual(open.groups, [{ parent: 'holdco', size: 9, expanded: true }]);
});

test('pinned entities and their parents stay out of the fold', () => {
  const orgs = [org('holdco'), ...Array.from({ length: 8 }, (_, i) => org(`site-${i}`, 'holdco')), org('deep', 'site-5')];
  const layout = layoutTree(orgs, { collapseOver: 6, pinned: new Set(['site-2', 'deep']) });
  const keys = layout.nodes.map((n) => n.key);
  assert.ok(keys.includes('site-2'));
  assert.ok(keys.includes('site-5') && keys.includes('deep'), 'a pinned grandchild keeps its parent visible');
  const group = layout.nodes.find((n) => n.type === 'group');
  assert.equal(group?.members.length, 6);
  // Pinning all but one member leaves nothing worth folding.
  const most = layoutTree(orgs, { collapseOver: 6, pinned: new Set(['site-0', 'site-1', 'site-2', 'site-3', 'site-4', 'site-5', 'site-6']) });
  assert.equal(most.nodes.some((n) => n.type === 'group'), false);
});

test('a name wraps to two lines at most, ending in an ellipsis when it still runs over', () => {
  assert.deepEqual(wrapName('Roe Cafe', 120), ['Roe Cafe']);
  const two = wrapName('Harbor Labs Harbor Street Grill, LLC', 120);
  assert.equal(two.length, 2);
  assert.ok(two.join(' ').startsWith('Harbor Labs'));
  const long = wrapName('Harbor Labs Copperline Cafe Walk-in Cooler and Freezer Replacement Company, LLC', 100);
  assert.equal(long.length, 2);
  assert.ok(long[1].endsWith('…'));
});

test('the hex is the company shape and a move ends in a downward arrowhead just over the target tile', () => {
  assert.equal(hexPath(8, 8, 6.5), 'M8.0 1.5 L13.6 4.8 L13.6 11.3 L8.0 14.5 L2.4 11.3 L2.4 4.7Z');
  const m = moveRoute({ x: 0, y: 100 }, { x: 200, y: 100 }, 20, 999);
  assert.equal(m.d, 'M0 77V70H200V77', 'on one level it runs in the band above the hexes; the gutter is not used');
  assert.equal(m.head, 'M200 77L195.5 68L204.5 68Z', 'the head points down into the hex top');
  assert.deepEqual(m.label, { x: 100, y: 65 });
});

test('gutterX picks the gap between tiles that adds the least travel, else the room beside them', () => {
  assert.equal(gutterX([[0, 100], [120, 220], [300, 400]], 50, 350, [0, 500]), 110, 'of the gaps on the way, the nearest the source');
  assert.equal(gutterX([[0, 100], [120, 220], [300, 400]], 450, 350, [0, 500]), 406, 'beside the last tile when that is shorter');
  assert.equal(gutterX([[20, 100], [110, 220]], 50, 150, [0, 500]), 14, 'a gap under twice the margin is closed');
  assert.equal(gutterX([[100, 200]], 150, 150, [0, 500]), 94, 'level ties go to the side nearer the source');
  assert.equal(gutterX([[2, 200]], 150, 150, [4, 500]), 206, 'never outside the drawing');
  assert.equal(gutterX([], 10, 90, [0, 500]), 50);
});

// A fixture's structure, top-down: Holdco (over Grill and Cafe), Commissary beside it, Cooler under Grill.
const FRAME = { col: 140, hex: 44, block: 66, width: 460 };
const tile = (col: number, depth: number): RouteTile => ({ x: 16 + (col + 0.5) * 140, y: 56 + depth * 150, r: 22 });
const TILES = { holdco: tile(0.5, 0), commissary: tile(2, 0), grill: tile(0, 1), cafe: tile(1, 1), cooler: tile(0, 2) };

/** The axis-aligned runs of a route's path. */
function runs(d: string): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  let x = 0;
  let y = 0;
  for (const [, cmd, a, b] of d.matchAll(/([MVH])([\d.-]+)(?: ([\d.-]+))?/g)) {
    const [nx, ny] = cmd === 'M' ? [Number(a), Number(b)] : cmd === 'H' ? [Number(a), y] : [x, Number(a)];
    if (cmd !== 'M') out.push([x, y, nx, ny]);
    [x, y] = [nx, ny];
  }
  return out;
}

test('a move between levels climbs a gutter and never crosses a name or a tile', () => {
  const m = routeMove(Object.values(TILES), TILES.cooler, TILES.commissary, FRAME);
  assert.equal(m.d, 'M86 331V324H296V24H366V31', 'up out of Cooler, over to the Cafe and Commissary gutter, up, across, down');
  assert.deepEqual(m.label, { x: 331, y: 19 }, 'the label sits over the last run, above the first level');
  const path = runs(m.d);
  path.forEach(([x1, y1, x2, y2], i) => {
    for (const [name, t] of Object.entries(TILES)) {
      if ((i === 0 && t === TILES.cooler) || (i === path.length - 1 && t === TILES.commissary)) continue;
      const span = tileSpan(t, FRAME);
      const crosses = Math.max(x1, x2) > span.x[0] && Math.min(x1, x2) < span.x[1] && Math.max(y1, y2) > span.y[0] && Math.min(y1, y2) < span.y[1];
      assert.ok(!crosses, `run ${i} crosses ${name}`);
    }
  });
  const second = routeMove(Object.values(TILES), TILES.cooler, TILES.commissary, { ...FRAME, lane: 1 });
  assert.equal(second.d, 'M86 331V320H296V20H366V31', 'a second move runs higher');
});

test('in the indented list a move runs through the left gutter, never across a tile', () => {
  const m = moveElbow({ x: 100, y: 300 }, { x: 60, y: 40 }, 13, 13, 20);
  assert.equal(m.d, 'M87 300H20V40H47');
  assert.ok(m.head.startsWith('M47 40'), 'the head points into the target tile');
});
