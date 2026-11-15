// SPDX-License-Identifier: Apache-2.0
// The colors in charts.css hold up in both themes: readable text, visible marks, an ordered heat ramp, and two
// dark blocks that can't drift apart.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'charts.css'), 'utf8');

function tokens(block: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const match of block.matchAll(/(--qs-[\w-]+):\s*(#[0-9a-f]{6})\b/g)) {
    if (match[1] && match[2]) found[match[1]] = match[2];
  }
  return found;
}

function blockAfter(selector: string): string {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `missing ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

const light = tokens(blockAfter(':root {'));
const dark = tokens(blockAfter(":root[data-theme='dark'] {"));
const systemDark = tokens(blockAfter(":root:not([data-theme='light']) {"));

function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = { light, dark } as const;

function get(theme: Record<string, string>, name: string): string {
  const value = theme[name];
  assert.ok(value, `missing ${name}`);
  return value;
}

test('the two dark blocks hold the same values', () => {
  assert.deepEqual(systemDark, dark);
});

test('every light token has a dark value', () => {
  assert.deepEqual(Object.keys(dark).sort(), Object.keys(light).sort());
});

for (const [name, theme] of Object.entries(THEMES)) {
  test(`${name}: body text reads at 4.5:1 on every surface it sits on`, () => {
    const text = ['--qs-ink', '--qs-ink-2', '--qs-ink-3', '--qs-mark-text', '--qs-good', '--qs-warn', '--qs-crit'];
    for (const surface of ['--qs-page', '--qs-surface', '--qs-panel']) {
      for (const ink of text) {
        const ratio = contrast(get(theme, ink), get(theme, surface));
        assert.ok(ratio >= 4.5, `${ink} on ${surface}: ${ratio.toFixed(2)}`);
      }
    }
  });

  test(`${name}: red text reads on its own tint`, () => {
    const ratio = contrast(get(theme, '--qs-crit'), get(theme, '--qs-crit-tint'));
    assert.ok(ratio >= 4.5, `${ratio.toFixed(2)}`);
  });

  test(`${name}: the number in every heat cell reads at 4.5:1`, () => {
    const low = get(theme, '--qs-h-ink-low');
    const high = get(theme, '--qs-h-ink-high');
    for (const [step, ink] of [['--qs-h1', low], ['--qs-h2', low], ['--qs-h3', low], ['--qs-h4', high], ['--qs-h5', high]] as const) {
      const ratio = contrast(ink, get(theme, step));
      assert.ok(ratio >= 4.5, `${step}: ${ratio.toFixed(2)}`);
    }
  });

  test(`${name}: series and reference marks are visible at 3:1 on the chart surface`, () => {
    for (const mark of ['--qs-q', '--qs-s', '--qs-c', '--qs-mark', '--qs-crit']) {
      const ratio = contrast(get(theme, mark), get(theme, '--qs-surface'));
      assert.ok(ratio >= 3, `${mark}: ${ratio.toFixed(2)}`);
    }
  });

  test(`${name}: an arc stands out from its own track at 2:1`, () => {
    for (const [arc, track] of [['--qs-q', '--qs-q-track'], ['--qs-s', '--qs-s-track'], ['--qs-c', '--qs-c-track']] as const) {
      const ratio = contrast(get(theme, arc), get(theme, track));
      assert.ok(ratio >= 2, `${arc} on ${track}: ${ratio.toFixed(2)}`);
    }
  });

  test(`${name}: the focus ring is visible at 3:1`, () => {
    for (const surface of ['--qs-page', '--qs-surface', '--qs-panel']) {
      const ratio = contrast(get(theme, '--qs-focus'), get(theme, surface));
      assert.ok(ratio >= 3, `${surface}: ${ratio.toFixed(2)}`);
    }
  });
}

test('the heat ramp moves steadily away from the page, in both themes', () => {
  const steps = ['--qs-h1', '--qs-h2', '--qs-h3', '--qs-h4', '--qs-h5'];
  for (const theme of Object.values(THEMES)) {
    const ratios = steps.map((step) => contrast(get(theme, step), get(theme, '--qs-page')));
    for (let i = 1; i < ratios.length; i++) {
      assert.ok((ratios[i] ?? 0) > (ratios[i - 1] ?? 0), `step ${i + 1} is not further from the page than step ${i}: ${ratios.join(', ')}`);
    }
  }
});

test('no chart markup or style uses a literal color outside the token blocks', () => {
  const afterTokens = css.slice(css.indexOf('/* Basics every chart relies on. */'));
  const literals = afterTokens.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
  assert.deepEqual(literals, []);
});
