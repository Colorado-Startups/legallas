// SPDX-License-Identifier: Apache-2.0
// The force graph's fit and label geometry (R81, R88), on small fictional boxes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitContent, FIT_MAX, frameHeight, marginsOf, NARROW, NARROW_ZOOM, separateLabels, type EdgeLabel } from './force-fit.ts';
import { toScreen } from './force-layout.ts';

test('fit frames the nodes and their drawn margins with the padding on every side (R81)', () => {
  const world = { x0: -200, y0: -150, x1: 200, y1: 150 };
  const margins = { left: 10, right: 120, top: 30, bottom: 12 };
  const view = fitContent(world, margins, 800, 400, 24);
  const tl = toScreen(view, { x: world.x0, y: world.y0 });
  const br = toScreen(view, { x: world.x1, y: world.y1 });
  // Whatever reaches furthest stays at least 24px inside the frame.
  assert.ok(tl.x - margins.left >= 24 - 1e-9 && br.x + margins.right <= 800 - 24 + 1e-9);
  assert.ok(tl.y - margins.top >= 24 - 1e-9 && br.y + margins.bottom <= 400 - 24 + 1e-9);
  // The tighter axis (height here) is filled exactly: 2 x 24 padding plus content.
  assert.ok(Math.abs(br.y + margins.bottom + 24 - 400) < 1e-6 && Math.abs(tl.y - margins.top - 24) < 1e-6);
});

test('fit never zooms a small graph past its cap', () => {
  const view = fitContent({ x0: 0, y0: 0, x1: 10, y1: 10 }, { left: 0, right: 0, top: 0, bottom: 0 }, 800, 600);
  assert.equal(view.k, FIT_MAX);
});

test('margins measure how far drawings reach past the node centers, never negative', () => {
  assert.deepEqual(marginsOf({ x0: 10, y0: 10, x1: 90, y1: 90 }, { x0: 0, y0: -8, x1: 150, y1: 90 }), { left: 10, right: 60, top: 18, bottom: 0 });
});

test('the People frame follows the drawing between 360px and 78% of the viewport, 820 at most (R88)', () => {
  assert.equal(frameHeight(1200, 0.5, 900), 600);
  assert.equal(frameHeight(1200, 0.8, 900), 702, '78% of a 900px viewport');
  assert.equal(frameHeight(1200, 1, 1400), 820);
  assert.equal(frameHeight(NARROW, 0.8, 900), 480, 'a wide frame follows the drawing');
  assert.equal(frameHeight(NARROW, 0.1, 900), 360);
});

test('a phone frame is as tall as its drawing at the legible floor, within 360px and 70% of the viewport (640 at most)', () => {
  assert.equal(frameHeight(330, 0.9, 900, 900), 900 * NARROW_ZOOM + 96, 'a big drawing at the floor zoom');
  assert.equal(frameHeight(330, 1.2, 900, 400), Math.round(330 * 1.2 + 96), 'a small drawing fitted whole');
  assert.equal(frameHeight(330, 2, 2000, 2000), 640);
  assert.equal(frameHeight(330, 2, 600, 2000), 420, '70% of a short viewport');
  assert.equal(frameHeight(330, 0.2, 900, 100), 360);
  const world = { x0: -500, y0: -200, x1: 500, y1: 200 };
  const none = { left: 0, right: 0, top: 0, bottom: 0 };
  const phone = fitContent(world, none, 330, 448, 24);
  assert.equal(phone.k, NARROW_ZOOM, 'the 1000-unit width would need 0.28: held at the floor');
  assert.ok(Math.abs(toScreen(phone, { x: 0, y: 0 }).x - 165) < 1e-9, 'centred across');
  assert.equal(fitContent(world, none, 800, 448, 24).k, (800 - 48) / 1000, 'a wide frame fits the width');
  const small = { x0: -100, y0: -100, x1: 100, y1: 100 };
  assert.equal(fitContent(small, none, 330, 448, 24).k, (330 - 48) / 200, 'a small graph fits the phone whole, not the height');
});

test('money labels are pushed apart; ones that still collide are dropped, lower priority first (R81)', () => {
  const label = (id: string, x: number, y: number, priority: number): EdgeLabel => ({ id, x, y, w: 50, h: 14, priority });
  const kept = separateLabels([label('a', 0, 0, 3), label('b', 10, 4, 2), label('c', 300, 0, 1)]);
  assert.deepEqual(kept.map((l) => l.id), ['a', 'b', 'c']);
  const [a, b] = kept as [EdgeLabel, EdgeLabel];
  assert.ok(b.y >= a.y + a.h, 'b moved below a');
  // With no rounds to move in, the lower-priority overlap is dropped.
  assert.deepEqual(separateLabels([label('a', 0, 0, 3), label('b', 10, 4, 2)], [], 0).map((l) => l.id), ['a']);
  for (const x of kept) for (const y of kept) {
    if (x !== y) assert.ok(!(x.x < y.x + y.w && y.x < x.x + x.w && x.y < y.y + y.h && y.y < x.y + x.h), 'no kept pair overlaps');
  }
});

test('money labels step clear of node names and marks, or are dropped (R81)', () => {
  const name = { x: 0, y: 0, w: 80, h: 13 };
  const [moved] = separateLabels([{ id: 'm', x: 20, y: 5, w: 40, h: 14, priority: 1 }], [name]);
  assert.ok(moved && moved.y >= name.y + name.h, 'pushed below the name it leaned toward');
  // Boxed in above and below with no rounds left: dropped.
  assert.equal(separateLabels([{ id: 'm', x: 20, y: 5, w: 40, h: 14, priority: 1 }], [name], 0).length, 0);
});
