// SPDX-License-Identifier: Apache-2.0
// Card F8 (R68), plan PR-L2. The small Legallas: the rig's raster miniature (LegallasGlyph.astro, glyph.css) and its
// tiny state API (glyph.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { brandAssetsDir } from '../../scripts/config.ts';
import { DONE_HOLD_MS, GLYPH_SIZES, GLYPH_STATES, glyphWhile, isGlyphState, setGlyph, type GlyphHost } from './glyph.ts';

const miniature = readFileSync(path.join(brandAssetsDir(), 'miniature.webp'));
const component = readFileSync(new URL('../components/LegallasGlyph.astro', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/glyph.css', import.meta.url), 'utf8');

/** A stand-in element: a glyph (data-glyph) or a slot that holds one. */
function host(isGlyph: boolean, child: GlyphHost | null = null): GlyphHost {
  return {
    dataset: {},
    hasAttribute: (name) => isGlyph && name === 'data-glyph',
    querySelector: (selectors) => (selectors === '[data-glyph]' ? child : null),
  };
}

test('only the four states pass', () => {
  for (const state of GLYPH_STATES) assert.equal(isGlyphState(state), true, state);
  for (const value of ['Idle', 'thinking', 'working-1', '', null, undefined, 0, ['idle'], new String('idle')]) {
    assert.equal(isGlyphState(value), false, String(value));
  }
});

test('the miniature is a square WebP, big enough for the largest glyph at 2x and small enough to stay a miniature', () => {
  assert.equal(miniature.toString('latin1', 0, 4), 'RIFF');
  assert.equal(miniature.toString('latin1', 8, 12), 'WEBP');
  const chunk = miniature.toString('latin1', 12, 16);
  let width = 0;
  let height = 0;
  if (chunk === 'VP8X') [width, height] = [1 + miniature.readUIntLE(24, 3), 1 + miniature.readUIntLE(27, 3)];
  else if (chunk === 'VP8L') {
    const bits = miniature.readUInt32LE(21);
    [width, height] = [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
  } else [width, height] = [miniature.readUInt16LE(26) & 0x3fff, miniature.readUInt16LE(28) & 0x3fff];
  assert.equal(width, height, 'square');
  assert.ok(width >= Math.max(...GLYPH_SIZES) * 2, `${width}px covers ${Math.max(...GLYPH_SIZES)}px at 2x`);
  assert.ok(width <= 160, `${width}px is a miniature, not the bust`);
  assert.ok(miniature.length <= 8 * 1024, `${miniature.length} bytes`);
});

test('the component is one image through astro:assets, decorative, with the glyph hooks setGlyph reads', () => {
  assert.match(component, /import \{ Image \} from 'astro:assets'/);
  assert.match(component, /import miniature from '@brand\/miniature\.webp'/);
  assert.match(component, /<span class="c-glyph" data-glyph data-state="idle" data-size=\{size\} aria-hidden="true">/);
  assert.match(component, /<Image src=\{miniature\} widths=\{\[size, size \* 2\]\}[^>]* alt=""/);
  assert.doesNotMatch(component, /miniature\.(src|width|height)\b|\{\.\.\.miniature\}/, 'reading the import keeps the original in the build');
  assert.doesNotMatch(component, /style=|set:html|<svg/);
  assert.match(component, /GLYPH_SIZES[^\n]*includes\(size\)/, 'unknown sizes are refused at build time');
});

test('glyph.css boxes every size and shows each state on the ring', () => {
  for (const size of GLYPH_SIZES) {
    assert.match(css, new RegExp(`\\.c-glyph\\[data-size='${size}'\\] \\{\\s*width: ${size}px;\\s*height: ${size}px;`), `${size}px box`);
  }
  assert.match(css, /\.c-glyph::after \{[^}]*box-shadow: inset 0 0 0 1px var\(--forest\);/, 'a 1px forest ring at rest');
  for (const state of GLYPH_STATES.filter((s) => s !== 'idle')) assert.match(css, new RegExp(`\\.c-glyph\\[data-state='${state}'\\]::after \\{`), state);
  assert.match(css, /\.c-glyph\[data-state='error'\]::after \{\s*box-shadow: inset 0 0 0 1px var\(--oxblood\);/, 'error is a 1px oxblood edge');
  // The working pulse runs only when the reader allows motion.
  const motion = css.indexOf('@media (prefers-reduced-motion: no-preference)');
  assert.ok(motion > 0 && css.indexOf('animation:') > motion, 'every animation sits under no-preference');
  assert.equal(css.split('animation:').length, 2, 'one animation');
});

test('the drawer clones the 24px miniature from the room template, never parses markup', { skip: !existsSync(new URL('chat-drawer.ts', import.meta.url)) && 'the drawer comes with pro' }, () => {
  const room = readFileSync(new URL('../layouts/Room.astro', import.meta.url), 'utf8');
  assert.match(room, /<template data-glyph-template><LegallasGlyph size=\{24\} \/><\/template>/);
  const drawer = readFileSync(new URL('chat-drawer.ts', import.meta.url), 'utf8');
  assert.match(drawer, /template\[data-glyph-template\]/);
  assert.match(drawer, /\.content\.cloneNode\(true\)/);
  assert.doesNotMatch(drawer, /DOMParser|innerHTML|glyph-art/);
});

test('setGlyph finds the glyph in its slot and refuses unknown states', () => {
  const glyph = host(true);
  const slot = host(false, glyph);
  assert.equal(setGlyph(slot, 'working'), true);
  assert.equal(glyph.dataset.state, 'working');
  assert.equal(setGlyph(slot, 'thinking' as never), false);
  assert.equal(glyph.dataset.state, 'working');
  assert.equal(setGlyph(host(false), 'idle'), false, 'an empty slot');
  assert.equal(setGlyph(null, 'idle'), false);
});

test('done settles to idle; error holds; a newer state cancels the settle', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const glyph = host(true);
  setGlyph(glyph, 'done');
  t.mock.timers.tick(DONE_HOLD_MS - 1);
  assert.equal(glyph.dataset.state, 'done');
  t.mock.timers.tick(1);
  assert.equal(glyph.dataset.state, 'idle');
  setGlyph(glyph, 'done');
  setGlyph(glyph, 'working');
  t.mock.timers.tick(DONE_HOLD_MS * 2);
  assert.equal(glyph.dataset.state, 'working', 'a request that starts during done keeps working');
  setGlyph(glyph, 'error');
  t.mock.timers.tick(DONE_HOLD_MS * 2);
  assert.equal(glyph.dataset.state, 'error');
});

test('glyphWhile mirrors the request: working, then done or error', async () => {
  const glyph = host(true);
  const ok = glyphWhile(glyph, Promise.resolve(7));
  assert.equal(glyph.dataset.state, 'working');
  assert.equal(await ok, 7);
  await Promise.resolve();
  assert.equal(glyph.dataset.state, 'done');
  const failed = glyphWhile(glyph, Promise.reject(new Error('offline')));
  await assert.rejects(failed, /offline/);
  await Promise.resolve();
  assert.equal(glyph.dataset.state, 'error');
});
