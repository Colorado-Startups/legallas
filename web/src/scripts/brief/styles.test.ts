// SPDX-License-Identifier: Apache-2.0
// The complaint brief's stylesheet (styles/brief.css): the accessibility floor rules QA found missing
// (DESIGN.md section 11), checked as text so a later edit cannot drop them quietly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../styles/brief.css', import.meta.url), 'utf8');

function block(selector: string, from = 0): string {
  const at = css.indexOf(`${selector} {`, from);
  assert.ok(at >= 0, `${selector} is styled`);
  return css.slice(at, css.indexOf('}', at));
}

test('a gap cell keeps a dashed edge in forced colors', () => {
  const forced = css.indexOf('@media (forced-colors: active)');
  assert.ok(forced >= 0);
  assert.match(block(".brief-map__cell.c-fog[data-state='gap']", forced), /border-style: dashed/);
});

test('the prior case link is at least the minimum target tall', () => {
  assert.match(block('.brief-foot__prior'), /min-height: var\(--target-min\)/);
});
