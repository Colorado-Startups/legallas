// SPDX-License-Identifier: Apache-2.0
// The drawer shortcut: ⌘K on Apple platforms, Ctrl K elsewhere, and nothing else opens it. A prefilled
// question (openAsk) is cleaned the way the Ask page cleans ?q=.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanQuestion, isApple, shortcut } from './ask-drawer.ts';

const key = (k: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods,
});

test('Apple platforms are told apart by userAgentData first, then the user agent', () => {
  assert.equal(isApple({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }), true);
  assert.equal(isApple({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }), true);
  assert.equal(isApple({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }), false);
  assert.equal(isApple({ userAgent: 'Macintosh', userAgentData: { platform: 'Windows' } }), false);
});

test('the hint and the key check follow the platform', () => {
  const mac = shortcut(true);
  const other = shortcut(false);
  assert.equal(mac.hint, '⌘K');
  assert.equal(other.hint, 'Ctrl K');
  assert.equal(mac.matches(key('k', { metaKey: true })), true);
  assert.equal(mac.matches(key('K', { metaKey: true })), true);
  assert.equal(mac.matches(key('k', { ctrlKey: true })), false);
  assert.equal(other.matches(key('k', { ctrlKey: true })), true);
  assert.equal(other.matches(key('k', { metaKey: true })), false);
  assert.equal(other.matches(key('k', { ctrlKey: true, shiftKey: true })), false);
  assert.equal(other.matches(key('j', { ctrlKey: true })), false);
});

test('a prefilled question loses control characters and outer space, keeps line breaks and tabs inside', () => {
  assert.equal(cleanQuestion('  Who signed\u0000 the\u0007 delivery slip?\n', 2000), 'Who signed the delivery slip?');
  assert.equal(cleanQuestion('First line\nsecond\tline', 2000), 'First line\nsecond\tline');
  assert.equal(cleanQuestion('\u007f', 2000), '');
});

test('a prefilled question is capped by code points, never splitting a pair', () => {
  assert.equal(cleanQuestion('abcdef', 4), 'abcd');
  assert.equal(cleanQuestion('😀😀😀', 2), '😀😀');
  assert.equal(cleanQuestion('short', Infinity), 'short');
});
