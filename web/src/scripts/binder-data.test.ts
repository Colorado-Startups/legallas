// SPDX-License-Identifier: Apache-2.0
// The binder's copy helpers (card P8): counts, read progress, the viewer kicker and page labels, and the
// icon sprite, whose ids are identifiers in the private manifest and must match ICONS (R11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ICONS } from '../../worker/visuals.ts';
import { binderCount, pageKicker, partLabel, plural, readProgress, visualHref, type RoomSection, type RoomVisual } from './binder-data.ts';

function visual(slug: string, overview = false): RoomVisual {
  return { slug, id: `id-${slug}`, section: 'tab', title: `Title ${slug}`, summary: null, overview };
}

function section(slugs: string[]): RoomSection {
  return { slug: 'tab', label: 'Tab 03', title: 'Timeline', summary: null, accent: 'forest', icon: 'timeline', visuals: slugs };
}

const withOverview = new Map(['hub', 'a', 'b', 'c'].map((s, i) => [s, visual(s, i === 0)]));
const noOverview = new Map(['a', 'b'].map((s) => [s, visual(s)]));

test('plural and the header count', () => {
  assert.equal(plural(1, 'page'), '1 page');
  assert.equal(plural(0, 'page'), '0 pages');
  const sections = Array.from({ length: 13 }, () => section([]));
  const visuals = Array.from({ length: 74 }, (_, i) => visual(`v${i}`));
  assert.equal(binderCount({ sections, visuals }), '13 tabs, 74 pages');
  assert.equal(binderCount({ sections: [section([])], visuals: [visual('x')] }), '1 tab, 1 page');
});

test('readProgress counts only this tab, and says "read" once any page is', () => {
  const tab = section(['hub', 'a', 'b', 'c']);
  assert.deepEqual(readProgress(tab, new Set()), { done: 0, total: 4, label: '4 pages' });
  assert.deepEqual(readProgress(tab, new Set(['a', 'elsewhere'])), { done: 1, total: 4, label: '1 of 4 pages read' });
  assert.equal(readProgress(section(['a']), new Set(['a'])).label, '1 of 1 page read');
});

test('partLabel: the overview first, then the parts from 1', () => {
  const tab = section(['hub', 'a', 'b', 'c']);
  assert.deepEqual(['hub', 'a', 'c'].map((s) => partLabel(tab, withOverview, s)), ['Overview', '1', '3']);
  assert.deepEqual(['a', 'b'].map((s) => partLabel(section(['a', 'b']), noOverview, s)), ['1', '2']);
});

test('pageKicker counts parts without the overview', () => {
  const tab = section(['hub', 'a', 'b', 'c']);
  assert.equal(pageKicker(tab, withOverview, 'hub'), 'Tab 03, overview');
  assert.equal(pageKicker(tab, withOverview, 'b'), 'Tab 03, page 2 of 3');
  assert.equal(pageKicker(section(['a', 'b']), noOverview, 'b'), 'Tab 03, page 2 of 2');
});

test('visualHref encodes the slug', () => {
  assert.equal(visualHref('case-at-a-glance'), '/visual/?v=case-at-a-glance');
  assert.equal(visualHref('a b'), '/visual/?v=a%20b');
});

test('the sprite has exactly one symbol per manifest icon', () => {
  const sprite = readFileSync(new URL('../components/VisualIcons.astro', import.meta.url), 'utf8');
  const ids = [...sprite.matchAll(/<symbol id="vi-([a-z-]+)" viewBox="0 0 20 20">/g)].map((m) => m[1]);
  assert.deepEqual(ids.sort(), [...ICONS].sort(), 'no missing, duplicate or stray symbols');
  // Line icons only: no fills, no inline style (CSP), stroke set by the stylesheet.
  assert.doesNotMatch(sprite, /\s(fill|style|stroke-width)=/);
});
