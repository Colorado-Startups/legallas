// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlModel, layoutControl, type ControlGeometry, type ControlModel } from './control-layout.ts';
import { FULL_LINES, fullSize, placeLabels, shortName, shortSize, shortWords, wrapLines, type LabelSpec, type Rect } from './control-labels.ts';
import { DENSE_LINKS, DENSE_PARTIES, DENSE_VIOLATION, HUB } from './control-labels.test-data.ts';

const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (p: [number, number], r: Rect) => p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h;

/** Every pair of label boxes drawn together at a step that overlap, and every label box over a node, per step. */
function clashes(model: ControlModel, g: ControlGeometry): string[] {
  const nodes = [...g.nodes.entries()];
  return model.ties.flatMap((step, s) => {
    const shown = g.edges.filter((e) => step[e.link]);
    return shown.flatMap((a, i) => [
      ...shown.slice(i + 1).filter((b) => hit(a.label, b.label)).map((b) => `step ${s + 1}: ${a.link} over ${b.link}`),
      ...nodes.filter(([, n]) => hit(a.label, n)).map(([id]) => `step ${s + 1}: ${a.link} over ${id}`),
    ]);
  });
}

const dense = controlModel(DENSE_VIOLATION, DENSE_PARTIES, DENSE_LINKS);
const WIDTHS = [600, 640, 760, 900, 1024, 1100, 1200, 1400];

test('the busy fixture crowds one restaurant group: twenty-one ties, most of them at the busiest steps', () => {
  assert.equal(dense.links.length, 21);
  const touching = dense.links.filter((l) => l.from === HUB || l.to === HUB).length;
  assert.equal(touching, 18, 'eighteen ties meet at the restaurant group');
  assert.ok(dense.ties[3]!.filter(Boolean).length >= 18, 'the share sale step draws eighteen ties or more');
  assert.equal(dense.ties[1]!.find((t) => t?.later)?.state, 'denied', 'a denial a later source answers');
});

test('no label box overlaps another drawn at the same step, nor any node, at any width', () => {
  for (const width of WIDTHS) {
    const g = layoutControl(dense, width)!;
    assert.deepEqual(clashes(dense, g), [], `clear at ${width}`);
    assert.ok(g.edges.every((e) => e.label.x >= 0 && e.label.x + e.label.w <= width && e.label.y >= 0 && e.label.y + e.label.h <= g.height), `inside the canvas at ${width}`);
  }
});

test('a box off its line is joined to it: the leader runs from the line to the edge of the box', () => {
  let leaders = 0;
  for (const width of WIDTHS) {
    for (const e of layoutControl(dense, width)!.edges) {
      if (!e.leader) continue;
      leaders += 1;
      const end = e.leader.d.match(/L([\d.-]+) ([\d.-]+)$/)!.slice(1).map(Number) as [number, number];
      assert.ok(e.leader.d.startsWith(`M${e.leader.x} ${e.leader.y}L`), 'starts where it meets the line');
      assert.ok(inside(end, e.label), 'ends on the box');
      assert.ok(!inside([e.leader.x, e.leader.y], e.label), 'only for a box that sits off its point');
    }
  }
  assert.ok(leaders > 0, 'the busy fixture needs leaders');
});

test('the places are fixed for every step and the same width gives the same picture', () => {
  assert.deepEqual(layoutControl(dense, 1100), layoutControl(dense, 1100));
  const g = layoutControl(dense, 900)!;
  assert.equal(g.edges.length, dense.links.length, 'one label place per tie, whatever the step');
});

test('short words keep the tie, its state and the denied-then-claimed order', () => {
  const tie = (state: 'record' | 'claimed' | 'alleged' | 'denied', words: string, later: string | null = null) => ({ state, words, later });
  assert.deepEqual(shortWords('bank for', tie('denied', 'bank for, denied Mar. 1, 2012', 'Claimed Nov. 7, 2013 (Account statement): bank for, since Mar. 2011')), ['bank for, denied', 'Claimed later']);
  assert.deepEqual(shortWords('bank for', tie('denied', 'bank for, denied Mar. 1, 2012')), ['bank for, denied', '']);
  assert.deepEqual(shortWords('bank for', tie('claimed', 'Claimed Nov. 7, 2013 (Account statement): bank for, since Mar. 2011')), ['bank for, claimed later', '']);
  assert.deepEqual(shortWords('owner of', tie('record', 'owner of, 20 to 40%')), ['owner of, 20 to 40%', '']);
  assert.deepEqual(shortWords('runs', tie('alleged', 'runs, alleged')), ['runs, alleged', '']);
  const texts: [string, string][] = [['bank for, denied Mar. 1, 2012', 'Claimed Nov. 7, 2013 (Account statement): bank for, since Mar. 2011']];
  const full = fullSize(texts);
  const short = shortSize(texts.map(([w, l]) => shortWords('bank for', tie('denied', w, l))));
  assert.ok(short.h < full.h && short.w <= 150, 'the short box is smaller');
});

test('words wrap by whole words, and a word wider than the line takes more than one', () => {
  assert.equal(wrapLines('', 100), 0);
  assert.equal(wrapLines('owner of', 100), 1);
  assert.equal(wrapLines('bank for, denied Mar. 1, 2012', 100), 3);
  assert.equal(wrapLines('x'.repeat(30), 100), 3);
});

/** A spec whose line runs from (x0, y) to (x1, y), drawn at the steps `shown`. */
const along = (x0: number, x1: number, y: number, size: { w: number; h: number }, shown = [true]): LabelSpec => ({
  at: (t) => [x0 + (x1 - x0) * t, y], full: size, short: { w: Math.min(size.w, 60), h: 21 }, shown,
});

test('boxes never drawn at the same step may share a place before either moves off its line', () => {
  const nodes: Rect[] = [{ x: 0, y: 0, w: 400, h: 40 }, { x: 0, y: 100, w: 400, h: 40 }];
  const a = along(200, 200, 70, { w: 80, h: 21 }, [true, false]);
  const b = along(200, 200, 70, { w: 80, h: 21 }, [false, true]);
  const { labels } = placeLabels([a, b], nodes, 400, 140);
  assert.deepEqual(labels[1]!.box, labels[0]!.box, 'the same place, one step each');
  assert.equal(labels[1]!.leader, null);
  const both = placeLabels([a, { ...b, shown: [true, true] }], nodes, 400, 140).labels;
  assert.ok(!hit(both[0]!.box, both[1]!.box), 'drawn together, they part');
});

test('with no room anywhere the words go short, then below the picture; nothing ever overlaps', () => {
  // Forty ties through one point of a canvas the nodes nearly fill.
  const nodes: Rect[] = [{ x: 0, y: 0, w: 600, h: 120 }, { x: 0, y: 180, w: 600, h: 120 }];
  const specs = Array.from({ length: 40 }, () => along(100, 500, 150, { w: 200, h: 96 }));
  const { labels, height } = placeLabels(specs, nodes, 600, 300);
  assert.ok(labels.some((l) => l.short), 'short words first');
  assert.ok(height > 300, 'then the canvas grows');
  const boxes = labels.map((l) => l.box);
  assert.ok(boxes.every((a, i) => boxes.every((b, j) => i === j || !hit(a, b))), 'no two boxes overlap');
  assert.ok(boxes.every((b) => nodes.every((n) => !hit(b, n))), 'no box covers a node');
  assert.ok(boxes.every((b) => b.x >= 0 && b.x + b.w <= 600 && b.y + b.h <= height), 'inside the canvas');
  assert.ok(labels.filter((l) => l.box.y >= 300).every((l) => l.leader !== null), 'a box below the picture keeps a leader');
});

test('a series name keeps the series, the rest stays in the tooltip, the accessible name and the table', () => {
  assert.equal(shortName('Roe Cooler Unit 1, a series of Roe Commissary Equipment, LLC'), 'Roe Cooler Unit 1');
  assert.equal(shortName('Harbor Labs, Inc.'), 'Harbor Labs, Inc.');
});

test('a two-claim label (a denial and the later claim) gets a box that holds every word', () => {
  const texts: [string, string][] = [['bank for, denied Mar. 1, 2012', 'Claimed Nov. 7, 2013 (Account statement): bank for, since Mar. 2011']];
  const box = fullSize(texts);
  const inner = box.w - 12;
  const words = wrapLines(texts[0][0], inner);
  const later = wrapLines(texts[0][1], inner);
  assert.ok(words <= FULL_LINES[0] && later <= FULL_LINES[1], `fits ${words} + ${later} lines at ${box.w}px`);
  assert.ok(box.h >= (words + later) * 15, 'the box is tall enough for those lines');
  assert.ok(box.w <= 220, 'and no wider than a full label may be');
});

test('the busy fixture: its two-claim tie, drawn in full, holds every word, and no box overlaps another or a node', () => {
  const two = dense.links.findIndex((_, i) => dense.ties.some((step) => step[i]?.later));
  assert.ok(two >= 0, 'the fixture has a two-claim tie');
  for (const width of WIDTHS) {
    const g = layoutControl(dense, width)!;
    assert.deepEqual(clashes(dense, g), [], `no overlaps at ${width}`);
    const edge = g.edges.find((e) => e.link === two)!;
    if (edge.short) continue;
    for (const step of dense.ties) {
      const tie = step[two];
      if (!tie) continue;
      assert.ok(wrapLines(tie.words, edge.label.w - 12) <= FULL_LINES[0], `words fit at ${width}`);
      assert.ok(wrapLines(tie.later ?? '', edge.label.w - 12) <= FULL_LINES[1], `the later claim fits at ${width}`);
    }
  }
});
