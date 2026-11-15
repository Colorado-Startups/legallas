// SPDX-License-Identifier: Apache-2.0
// The guide band with no stills in the brand pack (#211, #103): the sentence takes the band's width, never the 88px
// art column. A browser run showed it (1280 wide: the sentence 88px before, its 548px measure after); this keeps the
// two pieces that make it work from drifting apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles/guide.css', import.meta.url), 'utf8');
const guide = readFileSync(new URL('../components/LegallasGuide.astro', import.meta.url), 'utf8');

test('an empty bust window turns the band into one column above 48rem, and hides Quiet', () => {
  const at = css.indexOf('@media not all and (max-width: 48rem) {');
  assert.ok(at > 0, 'the rule applies only where the bust would show; below 48rem the small Legallas has its column');
  const block = css.slice(at);
  assert.match(block, /\.c-guide:has\(> \.guide-band__bust:empty\) \{\s*grid-template-columns: minmax\(0, 1fr\);\s*\}/);
  assert.match(block, /\.c-guide:has\(> \.guide-band__bust:empty\) > \.guide-band__quiet \{\s*display: none;\s*\}/);
});

test('the bust window holds only the stills, so it is :empty when the brand pack has none', () => {
  assert.match(guide, /<div class="c-guide__art companion-art guide-band__bust"[^>]*><LegallasStills width=\{88\} \/><\/div>/);
});
