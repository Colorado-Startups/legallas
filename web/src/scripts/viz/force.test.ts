// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MatterLink, MatterOrg, MatterPerson, MoneyFact, MoneyKind } from '../../../worker/matter-types.ts';
import {
  bendControl, buildGraph, collideRadius, degrees, directionalNext, fitView, groupBox, labelPlan, layoutForce, membersByOrg, moneyEdges, moneyWidth,
  PACK_GAP, seededRandom, toScreen, zoomAt, ZOOM_MAX,
} from './force-layout.ts';
import { MARK_R, RING_MARK_R, RING_START, ringSlots, satellites } from './force-rings.ts';

const person = (id: string, name: string, side: MatterPerson['side'], orgs: string[] = []): MatterPerson => ({
  id, name, role: side === 'client' ? 'plaintiff' : 'defendant', side, title: null, orgs, cites: [],
});
const orgs: MatterOrg[] = [
  { id: 'o-harbor-labs', name: 'Harbor Labs, Inc.', kind: 'company', side: 'nominal', parent: null, formed: null, cites: [] },
  { id: 'o-dock', name: 'Roe Dock I', kind: 'company', side: 'nominal', parent: 'o-harbor-labs', formed: null, cites: [] },
  { id: 'o-court', name: 'District Court', kind: 'court', side: 'court', parent: null, formed: null, cites: [] },
];
const people = [
  person('p-doe', 'Jane Doe', 'client'),
  person('p-roe', 'Richard Roe', 'defendant', ['o-harbor-labs']),
  person('p-poe', 'Pat Poe', 'defendant', ['o-harbor-labs', 'o-dock']),
  person('p-moe', 'Morgan Moe', 'third'),
];
const links: MatterLink[] = [
  { from: 'p-doe', to: 'o-harbor-labs', label: 'Supplied', cites: [] },
  { from: 'p-roe', to: 'p-ghost', label: 'Emailed', cites: [] },
  { from: 'p-roe', to: 'p-roe', label: 'Self', cites: [] },
];

test('the graph joins people to orgs and orgs to parents, and drops edges to unknown ids', () => {
  const g = buildGraph(people, orgs, links);
  assert.equal(g.nodes.length, 7);
  assert.equal(g.nodes.find((n) => n.id === 'p-poe')?.cluster, 'o-harbor-labs', 'a person clusters on their first org');
  assert.equal(g.nodes.find((n) => n.id === 'o-dock')?.cluster, 'o-harbor-labs');
  const kinds = g.edges.map((e) => `${e.kind}:${e.source}>${e.target}`).sort();
  assert.deepEqual(kinds, [
    'link:p-doe>o-harbor-labs', 'member:p-poe>o-dock', 'member:p-poe>o-harbor-labs', 'member:p-roe>o-harbor-labs', 'parent:o-dock>o-harbor-labs',
  ]);
});

test('the seeded generator repeats exactly and stays in [0, 1)', () => {
  const a = seededRandom(42);
  const b = seededRandom(42);
  const xs = Array.from({ length: 50 }, () => a());
  assert.deepEqual(xs, Array.from({ length: 50 }, () => b()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.notDeepEqual(xs, Array.from({ length: 50 }, seededRandom(43)));
});

test('the layout is the same on every run and whatever order the matter lists things in', () => {
  const g = buildGraph(people, orgs, links);
  const once = layoutForce(g);
  const again = layoutForce(buildGraph([...people].reverse(), [...orgs].reverse(), [...links].reverse()));
  assert.deepEqual([...once].sort(), [...again].sort());
  for (const p of once.values()) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});

test('sides settle where the encoding puts them: client left of defendants, court above third parties', () => {
  const at = layoutForce(buildGraph(people, orgs, links));
  const x = (id: string) => at.get(id)?.x ?? Number.NaN;
  const y = (id: string) => at.get(id)?.y ?? Number.NaN;
  assert.ok(x('p-doe') < x('p-roe'));
  assert.ok(y('o-court') < y('p-moe'));
  const d = (a: string, b: string) => Math.hypot(x(a) - x(b), y(a) - y(b));
  assert.ok(d('p-poe', 'o-harbor-labs') < d('p-poe', 'p-moe'), 'members sit near their org');
});

test('fit, zoom and screen transforms', () => {
  const pts = [{ x: -100, y: -50 }, { x: 100, y: 50 }];
  const v = fitView(pts, 400, 300, 50);
  const a = toScreen(v, pts[0]);
  const b = toScreen(v, pts[1]);
  assert.ok(a.x >= 50 - 0.01 && b.x <= 350 + 0.01, 'fits within the padding');
  assert.ok(Math.abs((a.x + b.x) / 2 - 200) < 0.01 && Math.abs((a.y + b.y) / 2 - 150) < 0.01, 'centered');
  const z = zoomAt(v, 2, 200, 150);
  assert.deepEqual(toScreen(z, { x: 0, y: 0 }), toScreen(v, { x: 0, y: 0 }), 'the zoom center stays put');
  assert.equal(zoomAt({ k: 3, x: 0, y: 0 }, 10, 0, 0).k, ZOOM_MAX);
});

test('arrows move to the nearest node that way, preferring what is level', () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 5 }, { x: 60, y: 80 }, { x: -50, y: 0 }, { x: 0, y: -90 }];
  assert.equal(directionalNext(pts, 0, 'ArrowRight'), 1);
  assert.equal(directionalNext(pts, 0, 'ArrowLeft'), 3);
  assert.equal(directionalNext(pts, 0, 'ArrowUp'), 4);
  assert.equal(directionalNext(pts, 0, 'ArrowDown'), 2);
  assert.equal(directionalNext(pts, 3, 'ArrowLeft'), -1);
  assert.equal(directionalNext(pts, 0, 'Tab'), -1);
});

const money = (id: string, from: string | null, to: string | null, amountCents: number, kind?: MoneyKind): MoneyFact => ({
  id, date: '2012-04', amountCents, kind, from, to, label: '', cites: [],
});

test('money edges sum per ordered pair per series and never mix promises with movements', () => {
  const known = new Set(['p-doe', 'o-harbor-labs', 'p-roe']);
  const edges = moneyEdges([
    money('c1', 'o-harbor-labs', 'p-doe', 18_420_55, 'commitment'),
    money('k1', 'o-harbor-labs', 'p-doe', 6_310_40, 'call'),
    money('m1', 'o-harbor-labs', 'p-doe', 4_212_00, 'payment'),
    money('m2', 'o-harbor-labs', 'p-doe', 1_250_75, 'payment'),
    money('d1', 'p-doe', 'o-harbor-labs', 3_700_00, 'transfer'),
    money('x1', 'o-harbor-labs', 'o-ghost', 1_00, 'payment'),
    money('n1', 'o-harbor-labs', 'p-doe', 9_00),
    money('z1', null, 'p-doe', 9_00, 'fee'),
  ], known);
  const view = edges.map((e) => `${e.series}:${e.from}>${e.to}=${e.cents}:${e.facts.join(',')}`).sort();
  assert.deepEqual(view, [
    'movements:o-harbor-labs>p-doe=546275:m1,m2',
    'movements:p-doe>o-harbor-labs=370000:d1',
    'promises:o-harbor-labs>p-doe=2473095:c1,k1',
  ]);
  assert.throws(() => moneyEdges([money('bad', 'o-harbor-labs', 'p-doe', 0.5, 'fee')], known), /whole cents/);
});

test('money edge widths scale within their own series only', () => {
  const edges = moneyEdges([
    money('c1', 'a', 'b', 1_000_000_00, 'commitment'),
    money('m1', 'a', 'b', 100_00, 'payment'),
    money('m2', 'b', 'a', 25_00, 'payment'),
  ], new Set(['a', 'b']));
  const w = (id: string) => moneyWidth(edges.find((e) => e.facts.includes(id)) as (typeof edges)[number], edges);
  assert.equal(w('c1'), 8);
  assert.equal(w('m1'), 8, 'the largest movement is full width even beside a much larger promise');
  assert.equal(w('m2'), 5);
});

test('orgs gather their members and child orgs', () => {
  const members = membersByOrg(buildGraph(people, orgs, links));
  assert.deepEqual(members.get('o-harbor-labs')?.sort(), ['o-dock', 'p-poe', 'p-roe']);
  assert.deepEqual(members.get('o-dock'), ['p-poe']);
  assert.equal(members.get('o-court'), undefined);
});

test('a group box wraps its org and members with room to spare', () => {
  assert.deepEqual(groupBox([{ x: 0, y: 10 }, { x: 100, y: 40 }, { x: 30, y: -5 }], 20), { x: -20, y: -25, w: 140, h: 85 });
  assert.deepEqual(groupBox([{ x: 5, y: 5 }], 10), { x: -5, y: -5, w: 20, h: 20 });
  assert.equal(groupBox([], 10), null);
});

test('money bends to the right of its direction, so A to B and B to A never overlap', () => {
  const ab = bendControl({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.2);
  const ba = bendControl({ x: 100, y: 0 }, { x: 0, y: 0 }, 0.2);
  assert.deepEqual(ab, { x: 50, y: 20 });
  assert.deepEqual(ba, { x: 50, y: -20 });
});

test('labels go highest priority first, at their first free side, never over a kept label or another mark (R65, R74)', () => {
  const box = (id: string, x: number, priority: number) => ({
    id, w: 60, h: 14, priority, at: [{ side: 'right' as const, x, y: 0 }, { side: 'left' as const, x: x - 100, y: 0 }],
  });
  // b's right box overlaps a (placed first) so b goes left; c is clear on the right.
  assert.deepEqual([...labelPlan([box('a', 0, 5), box('b', 30, 1), box('c', 200, 3)], [])].sort(), [['a', 'right'], ['b', 'left'], ['c', 'right']]);
  // Blocked on both sides by other marks: dropped. Its own mark never counts.
  const marks = [{ id: 'z', x: 30, y: 7, r: 6 }, { id: 'y', x: -70, y: 7, r: 6 }];
  assert.equal(labelPlan([box('a', 0, 5)], marks).size, 0);
  assert.deepEqual([...labelPlan([box('a', 0, 5)], [{ id: 'a', x: 30, y: 7, r: 6 }])], [['a', 'right']]);
  // At most `max`, ties broken by id so the same view always labels the same nodes.
  assert.deepEqual([...labelPlan([box('b', 0, 1), box('a', 300, 1), box('c', 600, 1)], [], 2).keys()], ['a', 'b']);
});

test('degrees count each node\'s ties in the graph', () => {
  const deg = degrees(buildGraph(people, orgs, links));
  assert.equal(deg.get('o-harbor-labs'), 4, 'Roe and Poe are members, the Dock is part of it, Doe supplied it');
  assert.equal(deg.get('o-court'), 0);
});

test('a cluster with no tie to the rest packs in beside it, on its own side (R65)', () => {
  const graph = buildGraph(people, orgs, links);
  const at = layoutForce(graph);
  const r = new Map(graph.nodes.map((n) => [n.id, collideRadius(n)]));
  const court = at.get('o-court') as { x: number; y: number };
  const tied = ['p-doe', 'p-roe', 'p-poe', 'o-harbor-labs', 'o-dock'];
  const top = Math.min(...tied.map((id) => (at.get(id)?.y ?? 0) - (r.get(id) ?? 0)));
  const gap = top - (court.y + (r.get('o-court') ?? 0));
  assert.ok(court.y < top, 'the court stays above the parties');
  assert.ok(gap <= PACK_GAP + 1, `the court sits within the gap, not at its far anchor (gap ${gap.toFixed(1)})`);
});

test('satellites: a node whose only tie has other ties; never a lone pair or a node with two ties', () => {
  const sat = satellites(buildGraph(people, orgs, links));
  assert.equal(sat.get('o-dock'), undefined, 'the dock has two ties (Poe and its parent)');
  assert.equal(sat.get('p-doe'), 'o-harbor-labs', 'client and defendant tie one each: the ring takes the first side in SIDES');
  assert.equal(sat.get('p-roe'), undefined, 'the other side lays out by its own anchor');
  assert.equal(sat.get('o-court'), undefined, 'no ties at all');
  const pair = buildGraph([person('p-a', 'A', 'third', ['o-x'])], [{ id: 'o-x', name: 'X', kind: 'company', side: 'third', parent: null, formed: null, cites: [] }], []);
  assert.equal(satellites(pair).size, 0, 'two nodes tied only to each other');
});

test('ring places sit at least two mark rooms apart, inside out, centred on the cluster middle', () => {
  const slots = ringSlots(30);
  assert.equal(slots.length, 30);
  assert.equal(slots[0].ring, RING_START);
  for (let i = 1; i < slots.length; i += 1) assert.ok(slots[i].ring >= slots[i - 1].ring, 'inner rings fill first');
  const at = slots.map((s) => ({ x: s.ring * Math.cos(s.turn), y: s.ring * Math.sin(s.turn) }));
  for (let i = 0; i < at.length; i += 1) for (let j = i + 1; j < at.length; j += 1) {
    assert.ok(Math.hypot(at[i].x - at[j].x, at[i].y - at[j].y) >= 2 * RING_MARK_R - 1, `places ${i} and ${j} too close`);
  }
  for (const s of slots) assert.ok(Math.abs(s.turn) <= Math.PI / 2 + 1e-9, 'half a turn at most');
  assert.deepEqual(ringSlots(1), [{ ring: RING_START, turn: 0 }], 'one satellite sits in the middle');
});

/** A fictional dense matter: a restaurant group with 30 kitchens under it, a defendant web and a few loose parties. */
function denseGraph() {
  const org = (id: string, side: MatterOrg['side'], parent: string | null = null): MatterOrg => ({ id, name: `Example ${id} Cafe Kitchen, LLC`, kind: 'company', side, parent, formed: null, cites: [] });
  const os: MatterOrg[] = [org('o-mgr', 'nominal'), ...Array.from({ length: 30 }, (_, i) => org(`o-f${i}`, 'third', 'o-mgr'))];
  for (let i = 0; i < 8; i += 1) os.push(org(`o-d${i}`, 'defendant'));
  const ps = Array.from({ length: 8 }, (_, i) => person(`p-d${i}`, `Pat Sample ${i}`, 'defendant', [`o-d${i}`]));
  const ls: MatterLink[] = [];
  for (let i = 0; i < 8; i += 1) {
    ls.push({ from: `p-d${i}`, to: 'o-mgr', label: 'Manages', cites: [] }, { from: `p-d${i}`, to: `o-d${(i + 1) % 8}`, label: 'Signs for', cites: [] });
  }
  return buildGraph([...ps, person('p-c', 'Casey Client', 'client')], os, [...ls, { from: 'p-c', to: 'o-mgr', label: 'Supplied', cites: [] }]);
}

test('a dense graph stays compact: satellites ring their hub, no two marks overlap, named nodes keep room', () => {
  const g = denseGraph();
  const at = layoutForce(g);
  const hub = at.get('o-mgr') as { x: number; y: number };
  const sat = satellites(g);
  assert.equal([...sat.values()].filter((h) => h === 'o-mgr').length, 30, 'the 30 kitchens; the lone client lays out on its own side');
  for (let i = 0; i < 30; i += 1) {
    const p = at.get(`o-f${i}`) as { x: number; y: number };
    const d = Math.hypot(p.x - hub.x, p.y - hub.y);
    assert.ok(d >= RING_START - 1 && d <= RING_START + 4 * 2 * RING_MARK_R + 1, `kitchen ${i} at ${d.toFixed(0)} from its group`);
  }
  const ids = [...at.keys()];
  for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) {
    const a = at.get(ids[i]) as { x: number; y: number };
    const b = at.get(ids[j]) as { x: number; y: number };
    const room = (sat.has(ids[i]) ? RING_MARK_R : MARK_R) + (sat.has(ids[j]) ? RING_MARK_R : MARK_R);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= room * 0.9, `${ids[i]} and ${ids[j]} overlap`);
  }
  const xs = ids.map((id) => (at.get(id) as { x: number }).x);
  assert.ok(Math.max(...xs) - Math.min(...xs) < 1400, 'the drawing stays within a screen or two');
  assert.ok((at.get('p-c') as { x: number }).x < hub.x, 'the client still settles left of the group');
});
