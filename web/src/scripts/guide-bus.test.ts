// SPDX-License-Identifier: Apache-2.0
// The guide bus: guideSend puts one 'legallas:guide' event on window with the event as its detail, guideLook
// aims at the element's centre, and a missing window is harmless.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUIDE_EVENT, guideLook, guideSend, type GuideEvent } from './guide-bus.ts';

/** Runs `body` with a bare EventTarget as window and returns the details it received. */
function withWindow(body: () => void): GuideEvent[] {
  const target = new EventTarget();
  const seen: GuideEvent[] = [];
  target.addEventListener(GUIDE_EVENT, (event) => seen.push((event as CustomEvent<GuideEvent>).detail));
  const g = globalThis as { window?: unknown };
  const before = g.window;
  g.window = target;
  try {
    body();
  } finally {
    if (before === undefined) delete g.window;
    else g.window = before;
  }
  return seen;
}

test('guideSend dispatches legallas:guide on window with the event as detail', () => {
  assert.equal(GUIDE_EVENT, 'legallas:guide');
  const events: GuideEvent[] = [{ type: 'open' }, { type: 'cite' }, { type: 'gap' }, { type: 'error' }, { type: 'rest' }, { type: 'look', x: 3, y: 4 }];
  const seen = withWindow(() => events.forEach(guideSend));
  assert.deepEqual(seen, events);
});

test('guideLook sends look toward the centre of the element', () => {
  const el = { getBoundingClientRect: () => ({ left: 100, top: 40, width: 60, height: 20 }) } as unknown as Element;
  assert.deepEqual(withWindow(() => guideLook(el)), [{ type: 'look', x: 130, y: 50 }]);
});

test('guideSend without a window does nothing and does not throw', () => {
  assert.equal(typeof (globalThis as { window?: unknown }).window, 'undefined');
  assert.doesNotThrow(() => guideSend({ type: 'rest' }));
});
