// SPDX-License-Identifier: Apache-2.0
// Card F6b follow-up (R78): the contrast checker on the synthetic checker fixture (Doe v. Harbor Labs only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { TOKENS, contrast, parseColour } from './visualtheme-color.ts';
import { contrastWarnings, resolveColour } from './visualtheme-contrast.ts';
import { newCssState, themeCss } from './visualtheme-css.ts';
import { parseElements } from './visualtheme-dom.ts';
import { colourExpressions, mixColours } from './visualtheme-mix.ts';
import { themeVisual, type ThemeFonts } from './visualtheme.ts';

const FONTS: ThemeFonts = { load: async () => 'X' };
const checker = async () =>
  themeVisual(await readFile(path.resolve(import.meta.dirname, '..', 'fixtures', 'visuals', 'checker.html'), 'utf8'), FONTS);

test('checker fixture: only the two real findings remain', async () => {
  const { warnings } = await checker();
  assert.deepEqual(warnings, ['contrast 1.5:1 for ".path .faint" (a mark, needs 3:1)', 'contrast 2.8:1 for ".note"']);
});

test('a rule that matches nothing in the page is skipped; without markup it is still read on the page', () => {
  const state = newCssState();
  themeCss('body{background:#fff}\n.next .k{color:#fbbf24}\n.tm i{color:#fff}\n.p{color:#fff}', state);
  const markup = '<html><body><p class="p">Doe</p><div class="tm">no italic here</div></body></html>';
  assert.deepEqual(contrastWarnings(state, parseElements(markup)), ['contrast 1.1:1 for ".p"']);
  assert.equal(contrastWarnings(state).length, 3, 'no markup: every rule falls back to the page ground');
});

test('color-mix() grounds resolve before measuring, and a pale wash of navy is not a deep ground', async () => {
  const { html, warnings } = await checker();
  assert.match(html, /\.chip\.conf \{ background: color-mix\(in srgb, var\(--legallas-deep\) 12%, var\(--legallas-surface\)\); color: var\(--legallas-forest\); \}/);
  assert.ok(!warnings.some((w) => /chip/.test(w)), warnings.join('\n'));
  const wash = resolveColour('color-mix(in srgb, var(--legallas-deep) 12%, var(--legallas-surface))', new Map())!;
  const ratio = contrast(parseColour(TOKENS.forest)!, wash);
  assert.ok(ratio > 9 && ratio < 13, `forest on the wash reads ${ratio.toFixed(1)}:1`);
});

test('mixColours follows CSS Color 5: default halves, one percentage, transparency and alpha', () => {
  const resolve = (text: string) => parseColour(text);
  assert.deepEqual(mixColours('color-mix(in srgb, #000000, #ffffff)', resolve), { r: 127.5, g: 127.5, b: 127.5, a: 1 });
  assert.deepEqual(mixColours('color-mix(in srgb, 25% #ffffff, #000000)', resolve), { r: 63.75, g: 63.75, b: 63.75, a: 1 });
  assert.deepEqual(mixColours('color-mix(in oklab, #ff0000 20%, transparent)', resolve), { r: 255, g: 0, b: 0, a: 0.2 });
  assert.deepEqual(mixColours('color-mix(in srgb, #ffffff 20%, #000000 30%)', resolve), { r: 102, g: 102, b: 102, a: 0.5 });
  assert.equal(mixColours('color-mix(#fff, #000)', resolve), null);
  assert.deepEqual(colourExpressions('url(x) no-repeat color-mix(in srgb, var(--a) 12%, white) 50%'), [
    'url', 'x', 'no', 'repeat', 'color-mix(in srgb, var(--a) 12%, white)',
  ]);
});

test('a mark that holds no words needs 3:1, text needs 4.5:1', async () => {
  const { warnings } = await checker();
  assert.ok(!warnings.some((w) => /\.path \.arrow/.test(w)), 'the 3.8:1 arrow passes as a mark');
  assert.ok(warnings.includes('contrast 2.8:1 for ".note"'), 'words stay at 4.5:1');
  const state = newCssState();
  themeCss('body{background:#fff}\n.icon{color:rgba(30,41,59,.55)}', state);
  const withWords = parseElements('<body><span class="icon"><b>i</b></span></body>');
  assert.match(contrastWarnings(state, withWords)[0]!, /^contrast 3\.\d:1 for "\.icon"$/, 'a word below the element makes it text');
});
