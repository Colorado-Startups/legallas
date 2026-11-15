// SPDX-License-Identifier: Apache-2.0
// j and k on the Documents table (card P5a).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keyAction, stepIndex } from './documents-table-keys.ts';

test('j and k start at an end, step one row, and stop at either end', () => {
  assert.equal(stepIndex(-1, 1, 5), 0);
  assert.equal(stepIndex(-1, -1, 5), 4);
  assert.equal(stepIndex(2, 1, 5), 3);
  assert.equal(stepIndex(2, -1, 5), 1);
  assert.equal(stepIndex(4, 1, 5), 4);
  assert.equal(stepIndex(0, -1, 5), 0);
  assert.equal(stepIndex(-1, 1, 0), -1);
});

// WCAG 2.1.4 (ruling R80): single-key shortcuts work only while focus is in the Documents work area.
const key = (k: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {}) =>
  ({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...mods });

test('/, j and k act only inside the work area', () => {
  assert.equal(keyAction(key('/'), false, true), 'filter');
  assert.equal(keyAction(key('j'), false, true), 'next');
  assert.equal(keyAction(key('k'), false, true), 'prev');
  for (const k of ['/', 'j', 'k']) assert.equal(keyAction(key(k), false, false), null, `${k} outside the area`);
});

test('typing, a modifier or another key is never a shortcut', () => {
  for (const k of ['/', 'j', 'k']) assert.equal(keyAction(key(k), true, true), null, `${k} while typing`);
  assert.equal(keyAction(key('k', { metaKey: true }), false, true), null);
  assert.equal(keyAction(key('k', { ctrlKey: true }), false, true), null);
  assert.equal(keyAction(key('j', { altKey: true }), false, true), null);
  assert.equal(keyAction(key('x'), false, true), null);
  assert.equal(keyAction(key('J'), false, true), null);
});
