// SPDX-License-Identifier: Apache-2.0
// A page's load always settles: whatever throws or rejects on the way (the fetch, a missing hook, a section that
// fails to draw, a chunk that fails to import) ends on the error line, never on Loading.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settle, type LoadState } from './page-load.ts';

/** A show() that records every state it is asked for. */
function recorder(): { show: (state: LoadState) => void; shown: LoadState[] } {
  const shown: LoadState[] = [];
  return { show: (state) => shown.push(state), shown };
}

test('a load that ends ready or empty shows that state and nothing else', async () => {
  for (const end of ['ready', 'empty'] as const) {
    const { show, shown } = recorder();
    let heard = false;
    assert.equal(await settle(show, async () => end, () => { heard = true; }), end);
    assert.deepEqual(shown, [end]);
    assert.equal(heard, false, 'failed() is for errors only');
  }
});

test('a failed fetch ends on the error line, and failed() hears the error', async () => {
  const { show, shown } = recorder();
  const heard: unknown[] = [];
  const boom = new Error('matter: 503');
  const state = await settle(show, async () => { throw boom; }, (error) => heard.push(error));
  assert.equal(state, 'error');
  assert.deepEqual(shown, ['error']);
  assert.deepEqual(heard, [boom]);
});

test('a section that throws while drawing, after the page showed ready, still ends on the error line', async () => {
  const { show, shown } = recorder();
  const state = await settle(show, async () => {
    show('ready');
    throw new TypeError("Cannot read properties of undefined (reading 'mark')");
  });
  assert.equal(state, 'error');
  assert.deepEqual(shown, ['ready', 'error'], 'the error replaces the half-drawn page');
});

test('a dynamic import that rejects inside the load ends on the error line', async () => {
  const { show, shown } = recorder();
  const state = await settle(show, async () => {
    await import('./no-such-chunk.ts' as string);
    return 'ready';
  });
  assert.equal(state, 'error');
  assert.deepEqual(shown, ['error']);
});

test('a rejection that is not an Error (an event, undefined) still ends on the error line', async () => {
  for (const reason of [undefined, null, 'failed', { type: 'error' }]) {
    const { show, shown } = recorder();
    assert.equal(await settle(show, () => Promise.reject(reason)), 'error', String(reason));
    assert.deepEqual(shown, ['error']);
  }
});

test('a show() that throws on ready falls through to the error line', async () => {
  const shown: LoadState[] = [];
  const show = (state: LoadState) => {
    shown.push(state);
    if (state === 'ready') throw new Error('no [data-brief-root]');
  };
  assert.equal(await settle(show, async () => 'ready'), 'error');
  assert.deepEqual(shown, ['ready', 'error']);
});

test('without failed(), an error is still shown and settle() itself never rejects', async () => {
  const { show, shown } = recorder();
  await assert.doesNotReject(settle(show, async () => { throw new Error('x'); }));
  assert.deepEqual(shown, ['error']);
});
