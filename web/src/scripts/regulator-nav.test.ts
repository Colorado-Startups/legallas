// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { regulatorNav } from './regulator-nav.ts';

test('an acronym label is spelled out by the configured name', () => {
  assert.deepEqual(regulatorNav({ regulatorLabel: ' ABC ', regulatorName: ' Agency of Business Conduct ' }), { label: 'ABC', title: 'Agency of Business Conduct' });
});

test('with no configured name there is no title, never a guess or "undefined"', () => {
  for (const config of [{ regulatorLabel: 'ABC' }, { regulatorLabel: 'ABC', regulatorName: '  ' }, undefined]) {
    assert.equal(regulatorNav(config).title, undefined, JSON.stringify(config));
  }
  assert.deepEqual(regulatorNav(undefined), { label: 'Regulator', title: undefined });
  assert.equal(regulatorNav({ regulatorLabel: 'Health office', regulatorName: 'Agency of Business Conduct' }).title, undefined, 'a worded label needs no expansion');
});

test('Room.astro takes the nav item from regulatorNav and writes the title only through attributes that drop undefined', () => {
  const room = readFileSync(join(import.meta.dirname, '..', 'layouts', 'Room.astro'), 'utf8');
  assert.match(room, /regulatorNav\(config\)/);
  assert.match(room, /title=\{item\.title\}/);
  assert.match(room, /\{item\.title && <span class="u-vh"> \(\{item\.title\}\)<\/span>\}/);
});
