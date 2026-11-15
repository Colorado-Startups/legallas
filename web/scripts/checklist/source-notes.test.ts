// SPDX-License-Identifier: Apache-2.0
// Source notes that must say what was and wasn't read (#195, #198). A source nobody read at its own site says so in its
// title, so the list never reads as if it had been checked there.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseBaseline } from './baseline.ts';

const { items } = parseBaseline(readFileSync(fileURLToPath(new URL('../../../docs/checklist/baseline.toml', import.meta.url)), 'utf8'));
const item = (id: string) => {
  const found = items.find((each) => each.id === id);
  assert.ok(found, id);
  return found;
};

test('a source not read at its own site is marked not checked', () => {
  const unread: [string, RegExp][] = [
    ['founders.section-83b-election', /mobile-friendly forms/],
    ['financing.state-limited-offering-notices', /Delaware Securities Act rules 502 and 503/],
  ];
  for (const [id, title] of unread) {
    const source = item(id).sources.find((each) => title.test(each.title));
    assert.ok(source, `${id}: ${title}`);
    assert.match(source.title, /\(not checked: [^)]+\)$/, id);
  }
});

test('a trademark registration names both maintenance windows and the grace period', () => {
  // USPTO, keeping your registration alive, in its own words: years 5 to 6, then 9 to 10 and every 10 years, with a
  // six-month grace period after each.
  const repeats = item('intellectual-property.trademark-registration').repeats ?? '';
  assert.match(repeats, /Between the fifth and sixth years after the registration date/);
  assert.match(repeats, /Between the ninth and 10th years after the registration date/);
  assert.match(repeats, /every 10 years/);
  assert.match(repeats, /six-month grace period/);
});
