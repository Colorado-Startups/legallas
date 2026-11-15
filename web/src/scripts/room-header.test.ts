// SPDX-License-Identifier: Apache-2.0
// The room header (DESIGN.md section 7): six sections in the nav, Ask only as the header's button, and who is signed
// in, Connect AI, the owner's Activity and Sign out inside the Account <details> at every width (the owner, 2026-10-03).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WEB = join(import.meta.dirname, '..', '..');
const room = readFileSync(join(WEB, 'src/layouts/Room.astro'), 'utf8');
const css = readFileSync(join(WEB, 'src/styles/components/header.css'), 'utf8');

/** The source between the first `open` and the `close` after it. */
function slice(source: string, open: string, close: string): string {
  const start = source.indexOf(open);
  assert.notEqual(start, -1, `missing ${open}`);
  const end = source.indexOf(close, start);
  assert.notEqual(end, -1, `missing ${close} after ${open}`);
  return source.slice(start, end + close.length);
}

test('the nav is the six sections in working order, with no Ask item', () => {
  const nav = slice(room, 'const nav = [', '];');
  const hrefs = [...nav.matchAll(/href: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ['/', '/complaint/', '/regulator/', '/chronology/', '/people/', '/documents/']);
  assert.doesNotMatch(slice(room, '<nav class="c-header__nav"', '</nav>'), /\/ask\b/);
});

test('the Account <details> holds who is signed in, Connect AI, Activity and Sign out', () => {
  const menu = slice(room, '<details', '</details>');
  assert.match(menu, /^<details class="c-header__menu" data-account>/);
  assert.match(menu, /<summary class="c-button c-button--quiet c-header__more">\s*Account\b/);
  assert.match(menu, /<span data-me-email><\/span>/);
  assert.match(menu, /<a [^>]*data-needs="connect"[^>]*>Connect AI<\/a>/);
  assert.match(menu, /<a class="[^"]*\bc-header__owner\b[^"]*" href="\/activity\/"/);
  assert.match(menu, /<a [^>]*href="\/cdn-cgi\/access\/logout"[^>]*>Sign out<\/a>/);
});

test('Ask stays a button that opens the drawer, with its shortcut', () => {
  const tools = slice(room, '<div class="c-header__tools">', '<details');
  const ask = slice(tools, '<button', '>');
  assert.match(ask, /\bdata-ask-open\b/);
  assert.match(ask, /aria-keyshortcuts="Control\+K Meta\+K"/);
});

test('panel rows never set display, so the role rules keep Activity and Connect AI hidden', () => {
  const rows = [...css.matchAll(/([^{}]*\.c-header__account >[^{}]*)\{([^}]*)\}/g)];
  assert.ok(rows.length >= 2, 'the panel row rules');
  for (const rule of rows) {
    const [, selector, body] = rule;
    if (/\.c-header__who/.test(selector!)) continue; // who's own :not(:empty) guard decides when it shows
    assert.doesNotMatch(body!, /(^|[\s;])display\s*:/, `${selector!.trim()} sets display`);
  }
  assert.match(css, /html:not\(\[data-role='owner'\]\) \.c-header__owner \{\s*display: none;/);
  assert.match(css, /\.c-header__who:has\(\[data-me-email\]:not\(:empty\)\)/);
});
