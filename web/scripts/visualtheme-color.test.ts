// SPDX-License-Identifier: Apache-2.0
// Card F6 (binder theme): colour parsing, the palette map, CSS rewriting and the contrast check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { TOKENS, composite, contrast, mapColour, parseColour, tokenValue } from './visualtheme-color.ts';
import { contrastWarnings, resolveColour } from './visualtheme-contrast.ts';
import { STACKS, newCssState, partyOf, stackKind, themeCss } from './visualtheme-css.ts';

/** `text` as a regular expression that matches it literally. */
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const c = (literal: string) => parseColour(literal)!;

test('parseColour reads hex, rgb, hsl and named colours, and refuses the rest', () => {
  assert.deepEqual(parseColour('#1e3a5f'), { r: 30, g: 58, b: 95, a: 1 });
  assert.deepEqual(parseColour('#FFF'), { r: 255, g: 255, b: 255, a: 1 });
  assert.equal(parseColour('#1e3a5f80')!.a.toFixed(2), '0.50');
  assert.deepEqual(parseColour('rgba(30, 58, 95, 0.25)'), { r: 30, g: 58, b: 95, a: 0.25 });
  assert.deepEqual(parseColour('rgb(30 58 95 / 50%)'), { r: 30, g: 58, b: 95, a: 0.5 });
  assert.deepEqual(parseColour('Navy'), { r: 0, g: 0, b: 128, a: 1 });
  const red = parseColour('hsl(0, 100%, 50%)')!;
  assert.deepEqual([red.r, red.g, red.b].map(Math.round), [255, 0, 0]);
  assert.equal(parseColour('#12345'), null);
  assert.equal(parseColour('rgb(var(--x))'), null);
  assert.equal(parseColour('currentColor'), null);
});

test('the binder palette maps to chambers tokens by family and use', () => {
  // Navy is the brand ink: forest for text and marks, the constant deep forest as a ground (R52); pale navy
  // washes become the forest tint.
  assert.equal(mapColour(c('#1e3a5f'), 'text'), 'forest');
  assert.equal(mapColour(c('#1e3a5f'), 'ground'), 'deep');
  assert.equal(mapColour(c('#1e3a5f'), 'mark'), 'forest');
  assert.equal(mapColour(c('#dbeafe'), 'ground'), 'forest-tint');
  // Crimson is adverse: oxblood text, the defendant mark in charts, the oxblood tint as a wash.
  assert.equal(mapColour(c('#b91c1c'), 'text'), 'oxblood');
  assert.equal(mapColour(c('crimson'), 'mark'), 'enc-defendant');
  assert.equal(mapColour(c('#fee2e2'), 'ground'), 'oxblood-tint');
  // Teal is the company: the company mark, slate for text.
  assert.equal(mapColour(c('#0d9488'), 'mark'), 'enc-company');
  assert.equal(mapColour(c('#0d9488'), 'text'), 'slate');
  // Gold goes to brass; neutrals step through the ink and ground ramps.
  assert.equal(mapColour(c('#b7791f'), 'text'), 'brass-text');
  assert.equal(mapColour(c('#0f172a'), 'text'), 'ink');
  assert.equal(mapColour(c('#64748b'), 'text'), 'ink-2');
  assert.equal(mapColour(c('#ffffff'), 'ground'), 'surface');
  assert.equal(mapColour(c('#f1f5f9'), 'ground'), 'paper');
  assert.equal(mapColour(c('#e2e8f0'), 'line'), 'rule');
  // Purple is the third-party family (R52): brass text, the third-party mark, the brass tint as a fill.
  assert.equal(mapColour(c('#7c3aed'), 'text'), 'brass-text');
  assert.equal(mapColour(c('#7d4e8c'), 'mark'), 'enc-third');
  assert.equal(mapColour(c('#b58cc4'), 'ground'), 'brass-tint');
  assert.equal(mapColour(c('#2b2140'), 'ground'), 'deep');
});

test('light text becomes paper on a dark ground and ink-3 on its own light ground', () => {
  assert.equal(mapColour(c('#ffffff'), 'text'), 'paper');
  assert.equal(mapColour(c('#cbd5e1'), 'text', null, true), 'ink-3');
});

test('a named side wins over the colour family', () => {
  assert.equal(mapColour(c('#1e3a5f'), 'mark', 'client'), 'enc-client');
  assert.equal(mapColour(c('#6b7280'), 'ground', 'court'), 'enc-court');
  assert.equal(mapColour(c('#0d9488'), 'text', 'nominal'), 'slate');
  assert.equal(mapColour(c('#fee2e2'), 'ground', 'defendant'), 'oxblood-tint');
  assert.equal(partyOf('.legend .dot-defendants'), 'defendant');
  assert.equal(partyOf('[data-side="third"], .third-party'), 'third');
  assert.equal(partyOf('.client, .court'), null);
});

test('tokenValue keeps alpha through color-mix', () => {
  assert.equal(tokenValue('forest'), 'var(--legallas-forest)');
  assert.equal(tokenValue('forest', 0.4), 'color-mix(in srgb, var(--legallas-forest) 40%, transparent)');
});

test('stackKind reads the generic family first, then the named faces', () => {
  assert.equal(stackKind("Georgia, 'Times New Roman', serif"), 'serif');
  assert.equal(stackKind('-apple-system, BlinkMacSystemFont, sans-serif'), 'sans');
  assert.equal(stackKind("'SF Mono', Menlo, monospace"), 'mono');
  assert.equal(stackKind('Georgia'), 'serif');
  assert.equal(stackKind('inherit'), null);
});

test('themeCss rewrites colours and stacks and leaves comments, strings, url() and @font-face alone', () => {
  const state = newCssState();
  const css = [
    "/* { not a rule; color: #b91c1c } */ :root{--navy:#1e3a5f;--muted-text:#94a3b8;--defendant:#b91c1c;--serif:Georgia, serif}",
    "@font-face{font-family:'Old Face';src:url(data:font/woff2;base64,AA;BB)}",
    '.hero{background:url(data:image/svg+xml;utf8,<svg fill="%23b91c1c"/>) #f8fafc;color:#1e3a5f !important}',
    ".q::before{content:'{#b91c1c}'} @media print{.legend .court{background:#6b7280}}",
    ".mark{background:url(\"data:image/svg+xml,<svg fill='#b91c1c'/>\") no-repeat #1e3a5f}",
    'h1{font:italic 600 28px/1.2 Georgia, serif} code{font-family:Menlo, monospace} .x{border-left:4px solid crimson}',
  ].join('\n');
  const out = themeCss(css, state);
  assert.match(out, /\/\* \{ not a rule; color: #b91c1c \} \*\//);
  assert.match(out, /--navy:var\(--legallas-forest\);--muted-text:var\(--legallas-ink-3\);--defendant:var\(--legallas-enc-defendant\)/);
  assert.match(out, new RegExp(`--serif:${escapeRegex(STACKS.serif)}\\}`));
  assert.match(out, /@font-face\{font-family:'Old Face';src:url\(data:font\/woff2;base64,AA;BB\)\}/);
  assert.match(out, /fill="%23b91c1c"\/>\) var\(--legallas-paper\);color:var\(--legallas-forest\) !important/);
  assert.match(out, /content:'\{#b91c1c\}'/);
  assert.match(out, /url\("data:image\/svg\+xml,<svg fill='#b91c1c'\/>"\) no-repeat var\(--legallas-deep\);--legallas-paper:#FAF7F0;/);
  assert.match(out, /\.legend \.court\{background:var\(--legallas-enc-court\)\}/);
  assert.match(out, /font:italic 600 28px\/1\.2 'Binder Serif'/);
  assert.match(out, /code\{font-family:'Binder Mono'/);
  assert.match(out, /border-left:4px solid var\(--legallas-oxblood\)/);
  assert.deepEqual([...state.stacks].sort(), ['mono', 'serif']);
  assert.equal(state.italic, true);
});

test('the contrast check resolves page variables and grounds (light only)', () => {
  const state = newCssState();
  themeCss(
    [
      ':root{--wash:#fee2e2;--soft:rgba(30,58,95,0.4)}',
      'body{background:#ffffff;color:#1e293b}',
      '.ok{background:var(--wash);color:#991b1b}',
      '.faint{color:var(--soft)}',
      '.odd{color:#a855f7}',
      '.ghost{color:rgba(255,255,255,0.3)}',
      '.grad{background:linear-gradient(#000,#fff);color:#94a3b8}',
    ].join('\n'),
    state,
  );
  const warnings = contrastWarnings(state);
  assert.ok(warnings.some((w) => /^contrast \d\.\d:1 for "\.faint"$/.test(w)), warnings.join('\n'));
  assert.ok(warnings.some((w) => /for "\.ghost"/.test(w)), warnings.join('\n'));
  assert.ok(!warnings.some((w) => /"\.ok"|"body"|"\.grad"|"\.odd"/.test(w)), warnings.join('\n'));
  assert.deepEqual(resolveColour('var(--legallas-ink)', new Map()), parseColour(TOKENS.ink));
  assert.deepEqual(resolveColour('var(--legallas-ink)', new Map(), 0, true), parseColour('#FAF7F0'));
});

test('every chambers text token reads at 4.5:1 on paper, panel and surface', () => {
  for (const text of ['ink', 'ink-2', 'ink-3', 'forest', 'oxblood', 'slate', 'graphite', 'brass-text'] as const) {
    for (const ground of ['paper', 'panel', 'surface'] as const) {
      const ratio = contrast(c(TOKENS[text]), c(TOKENS[ground]));
      assert.ok(ratio >= 4.5, `${text} on ${ground} is ${ratio.toFixed(2)}:1`);
    }
  }
});

test('the binder accent values in visuals.css read at 5:1 on the card, its tint and the page (light only)', async () => {
  const css = await readFile(path.resolve(import.meta.dirname, '..', 'src', 'styles', 'visuals.css'), 'utf8');
  const found = [...css.matchAll(/data-accent='(\w+)'\] \{ --tab-accent: (#[0-9a-f]{6}); \}/g)];
  const card = c(TOKENS.surface);
  assert.equal(found.length, 5, 'gold, teal, rust, plum and crimson');
  for (const [, name, hex] of found) {
    const accent = c(hex!);
    const tint = composite({ ...accent, a: 0.11 }, card);
    for (const ground of [card, tint, c(TOKENS.paper), c(TOKENS.panel)]) {
      assert.ok(contrast(accent, ground) >= 5, `${name} ${contrast(accent, ground).toFixed(2)}:1`);
    }
  }
});
