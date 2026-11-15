// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstFit, fitLabels, MIN_LABEL, PACK_GAP, packLane, truncate } from './timeline-pack.ts';

test('first fit keeps clear marks in one row and stacks overlapping ones', () => {
  const { rows, rowCount } = firstFit([
    { x0: 0, x1: 16 },
    { x0: 10, x1: 26 },
    { x0: 40, x1: 56 },
    { x0: 12, x1: 28 },
  ]);
  assert.deepEqual(rows, [0, 1, 0, 2]);
  assert.equal(rowCount, 3);
});

test('the gap counts: touching marks are not clear', () => {
  assert.deepEqual(firstFit([{ x0: 0, x1: 16 }, { x0: 16 + PACK_GAP - 1, x1: 40 }]).rows, [0, 1]);
  assert.deepEqual(firstFit([{ x0: 0, x1: 16 }, { x0: 16 + PACK_GAP, x1: 40 }]).rows, [0, 0]);
});

test('input order does not change the packing, only the start does', () => {
  const a = firstFit([{ x0: 50, x1: 60 }, { x0: 0, x1: 55 }]);
  assert.deepEqual(a.rows, [1, 0]);
});

test('no two marks in a row overlap after packing, for a dense random lane', () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const spans = Array.from({ length: 200 }, () => {
    const x0 = random() * 800;
    return { x0, x1: x0 + 16 + (random() < 0.2 ? random() * 120 : 0), label: 0 };
  });
  const { rows } = firstFit(spans);
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      if (rows[i] !== rows[j]) continue;
      const clear = spans[i].x1 + PACK_GAP <= spans[j].x0 || spans[j].x1 + PACK_GAP <= spans[i].x0;
      assert.ok(clear, `marks ${i} and ${j} collide in row ${rows[i]}`);
    }
  }
});

test('a label gets the room up to the next mark in its row, and is hidden when that is too small', () => {
  const extents = [
    { x0: 0, x1: 16, label: 200 },
    { x0: 120, x1: 136, label: 200 },
    { x0: 150, x1: 166, label: 30 },
  ];
  const labels = fitLabels(extents, [0, 0, 0], 400);
  assert.equal(labels[0], 120 - PACK_GAP - (16 + PACK_GAP));
  assert.equal(labels[1], 0, `only ${150 - PACK_GAP - 142}px before the next mark, under ${MIN_LABEL}`);
  assert.equal(labels[2], 30, 'a short label that fits whole is kept');
});

test('packLane gives full labels when rows allow, and falls back to tight rows when they do not', () => {
  const crowd = Array.from({ length: 6 }, (_, i) => ({ x0: i * 30, x1: i * 30 + 16, label: 160 }));
  const roomy = packLane(crowd, 1000, 6);
  assert.ok(roomy.labels.every((width) => width === 160), 'each label whole');
  assert.ok(roomy.rowCount > 1);
  const tight = packLane(crowd, 1000, 2);
  assert.equal(tight.rowCount, 1, 'marks alone fit one row');
  assert.equal(tight.labels.slice(0, 5).every((width) => width === 0), true, 'no room between marks');
  assert.equal(tight.labels[5], 160, 'the last mark has the open plot');
});

test('labels never run past the plot end', () => {
  const packed = packLane([{ x0: 800, x1: 816, label: 300 }], 1000, 4);
  assert.equal(packed.labels[0], 1000 - 816 - PACK_GAP);
  const cramped = packLane([{ x0: 900, x1: 916, label: 300 }], 1000, 4);
  assert.equal(cramped.labels[0], 0, `${1000 - 916 - PACK_GAP}px would show a stub under ${MIN_LABEL}px`);
});

test('truncate cuts on the estimate and marks the cut', () => {
  assert.equal(truncate('Doe sends the spring invoices', 1000, 7), 'Doe sends the spring invoices');
  assert.equal(truncate('Doe sends the spring invoices', 70, 7), 'Doe sends…');
  assert.equal(truncate('Roe', 7, 7), '');
});
