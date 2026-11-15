// SPDX-License-Identifier: Apache-2.0
// Card F6b (binder theme fixes): the four synthetic fixture pages in web/fixtures/visuals (Doe v. Harbor Labs, Inc.
// only, never a real binder), one per issue a re-export found, plus the pieces behind them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DEEP_TEXT, TOKENS, contrast, parseColour } from './visualtheme-color.ts';
import { contrastWarnings, resolveColour } from './visualtheme-contrast.ts';
import { DEEP_DECLARATIONS, newCssState, themeCss } from './visualtheme-css.ts';
import { parseComplex, parseElements } from './visualtheme-dom.ts';
import { isDarkSelector } from './visualtheme-scheme.ts';
import { themeVisual, type ThemeFonts } from './visualtheme.ts';

const TAGS = { sans: 'SANS', serif: 'SERIF', serifItalic: 'SERIFITALIC', mono400: 'MONO4', mono500: 'MONO5' } as const;
const FONTS: ThemeFonts = { load: async (request) => TAGS[request.face] };
const fixture = (name: string) => readFile(path.resolve(import.meta.dirname, '..', 'fixtures', 'visuals', `${name}.html`), 'utf8');
const themed = async (name: string) => await themeVisual(await fixture(name), FONTS);

test('dark-scheme fixture: the page dark scheme is removed whole and the page is light only (R67)', async () => {
  const { html, warnings } = await themed('dark-scheme');
  assert.doesNotMatch(html, /prefers-color-scheme: dark|data-theme="dark"|--radius: 12px|invert\(/);
  assert.match(html, /:root\{color-scheme:light;--legallas-paper:#FAF7F0;/);
  assert.doesNotMatch(html, /color-scheme:light dark/);
  // The light values are the only values.
  assert.match(html, /--accent: var\(--legallas-forest\);/);
  assert.match(html, /--muted: var\(--legallas-ink-2\);/);
  assert.match(html, /--radius: 10px;/);
  assert.deepEqual(warnings, []);
});

test('the contrast check reads the light value, not the last definition', async () => {
  const css = ':root{--num:#1e3a5f}\n@media (prefers-color-scheme: dark){:root{--num:#f8fafc}}\n.num{color:var(--num)}';
  const state = newCssState();
  assert.equal(themeCss(css, state), ':root{--num:var(--legallas-forest)}\n\n.num{color:var(--num)}');
  assert.equal(state.vars.get('--num'), 'var(--legallas-forest)');
  assert.deepEqual(contrastWarnings(state), []);
});

test('a light-scheme block applies always; dark selectors outside :not() are removed', async () => {
  const out = themeCss('@media screen and (prefers-color-scheme: light){.a{color:#1e3a5f}}', newCssState());
  assert.equal(out, '@media screen and (min-width: 0){.a{color:var(--legallas-forest)}}');
  const rules = themeCss('@import url(x.css);[data-theme="dark"] .a{color:#fff}\n.b{color:#000}', newCssState());
  assert.equal(rules, '@import url(x.css);\n.b{color:var(--legallas-ink)}');
  assert.ok(isDarkSelector(':root[data-theme="dark"]'));
  assert.ok(isDarkSelector("html.dark .card, [data-mode='dark'] .card"));
  assert.ok(!isDarkSelector(':root:not([data-theme="dark"])'));
  assert.ok(!isDarkSelector(':root, [data-theme="dark"]'));
});

test('next-card fixture: navy grounds become deep forest and brass on them reads', async () => {
  const { html, warnings } = await themed('next-card');
  assert.match(html, /:root\{color-scheme:light;[^}]*--legallas-deep:#1F3A2E/);
  for (const selector of ['.topbar', '.next']) {
    const rule = new RegExp(`\\${selector} \\{ background: var\\(--legallas-deep\\);[^}]*${DEEP_DECLARATIONS.replace(/[()]/g, '\\$&')};--bar:var\\(--legallas-forest\\);--gold:var\\(--legallas-brass-text\\)`);
    assert.match(html, rule, selector);
  }
  // The white pill inside the card gets the light text tokens back.
  assert.match(html, /:where\(\.topbar,\.next\) :where\(\.pill\)\{--legallas-paper:var\(--legallas-base-paper\);/);
  assert.deepEqual(warnings, []);
  const brass = resolveColour('var(--gold)', new Map([['--gold', 'var(--legallas-brass-text)']]), 0, true)!;
  assert.ok(contrast(brass, parseColour(TOKENS.deep)!) >= 4.5, 'brass on deep');
});

test('every deep text value reads at 4.5:1 on the deep ground', async () => {
  const deep = parseColour(TOKENS.deep)!;
  for (const [name, value] of Object.entries(DEEP_TEXT)) {
    assert.ok(contrast(parseColour(value)!, deep) >= 4.5, `${name} ${contrast(parseColour(value)!, deep).toFixed(2)}:1`);
  }
});

test('purple-legend fixture: purples take the third-party encoding', async () => {
  const { html, warnings } = await themed('purple-legend');
  assert.match(html, /\.swatch\.others \{ background: var\(--legallas-enc-third\); \}/);
  assert.match(html, /\.others-label \{ color: var\(--legallas-brass-text\);/);
  assert.match(html, /\.note \{ background: var\(--legallas-brass-tint\); border-left: 4px solid var\(--legallas-brass-mark\);[^}]*color: var\(--legallas-brass-text\); \}/);
  assert.match(html, /\.aside \{ background: var\(--legallas-deep\); color: var\(--legallas-paper\);/);
  assert.match(html, /:where\(\[fill="#a87bc4" i\]\)\{fill:var\(--legallas-enc-third\)\}/);
  assert.match(html, /:where\(text\[fill="#7d4e8c" i\][^)]*\)\{fill:var\(--legallas-brass-text\)\}/);
  assert.deepEqual(warnings, []);
});

test('nested-grounds fixture: chips and nodes become tint and label; text inherits its ancestor ground', async () => {
  const { html, warnings } = await themed('nested-grounds');
  assert.match(html, /\.node\.defendant \{ background: var\(--legallas-oxblood-tint\); color: var\(--legallas-oxblood\); \}/);
  assert.match(html, /\.node\.client \{ background: var\(--legallas-forest-tint\); color: var\(--legallas-forest\); \}/);
  assert.match(html, /\.chip \{ background: var\(--legallas-company-tint\); color: var\(--legallas-slate\);/);
  assert.match(html, /\.icon \{ background: var\(--legallas-brass-tint\); color: var\(--legallas-brass-text\);/);
  assert.match(html, /\.band \{ background: var\(--legallas-deep\);/);
  assert.deepEqual(warnings, []);
});

test('the contrast check takes the nearest ancestor ground from the markup', async () => {
  const state = newCssState();
  themeCss('body{background:#ffffff}\n.band{background:#0f172a}\n.num{color:#ffffff}\n.cap{color:#94a3b8}', state);
  const markup = '<html><body><div class="band"><span class="num">1</span><span class="cap">a</span></div></body></html>';
  assert.deepEqual(contrastWarnings(state, parseElements(markup)), []);
  // Without the markup the rule falls back to the page ground, where white text cannot read.
  assert.ok(contrastWarnings(state).some((w) => /for "\.num"/.test(w)));
  // A rule overridden on every element it reaches is not checked against that element.
  const lost = newCssState();
  themeCss('body{background:#fff}\n.x{color:#fff}\n.y.x{color:#1e293b}', lost);
  assert.deepEqual(contrastWarnings(lost, parseElements('<body><p class="x y">t</p></body>')), []);
});

test('the selector matcher reads compounds, combinators, :not() and attributes', async () => {
  const [html, body, card, title, em] = parseElements(
    '<html><body><div id="c" class="card next" data-side="third"><h2 class="title">T <em>x</em></h2></div></body></html>',
  );
  assert.equal(html!.tag, 'html');
  assert.ok(parseComplex('.card .title em')!.matches(em!));
  assert.ok(parseComplex('div.next > h2')!.matches(title!));
  assert.ok(!parseComplex('body > h2')!.matches(title!));
  assert.ok(parseComplex('[data-side="third" i]:not(.old)')!.matches(card!));
  assert.ok(!parseComplex(':root .card:not(.next)')!.matches(card!));
  assert.ok(parseComplex(':root')!.matches(html!) && !parseComplex(':root')!.matches(body!));
  assert.equal(parseComplex('#c .title')!.specificity, 10100);
  assert.equal(parseComplex(':where(#c) h2')!.specificity, 1);
});
