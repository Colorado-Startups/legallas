// SPDX-License-Identifier: Apache-2.0
// Every custom property the room reads is declared somewhere: in tokens.css, in a stylesheet that sets it
// locally, or by a script through el.style.setProperty('--x', ...). This keeps the retired section 10 aliases
// (--card, --muted, --accent, ...) from coming back, and catches a typo that would silently fall back to
// nothing. A var() with a fallback (var(--x, ...)) is optional by design and is not checked.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

const WEB = join(import.meta.dirname, '..');
const SRC = join(WEB, 'src');
const TEXT = /\.(css|astro|ts)$/;
const DECLARED = /(--[a-z][a-z0-9-]*)\s*:/g;
const SET_IN_SCRIPT = /['"`](--[a-z][a-z0-9-]*)['"`]/g;
const READ_WITHOUT_FALLBACK = /var\(\s*(--[a-z][a-z0-9-]*)\s*\)/g;
const RETIRED = [
  '--parchment', '--bg', '--parchment-deep', '--card', '--header-bg', '--text', '--ink-soft', '--muted', '--accent',
  '--forest-deep', '--accent-hover', '--gold', '--gold-text', '--frame', '--card-border', '--font-display',
  '--font-body', '--radius-small', '--page-width', '--shadow', '--elf-backdrop', '--banner-bg', '--banner-text',
];

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (TEXT.test(name) && !name.endsWith('.test.ts')) yield path;
  }
}

function scan(): { declared: Set<string>; reads: Map<string, string[]> } {
  const declared = new Set<string>();
  const reads = new Map<string, string[]>();
  for (const path of files(SRC)) {
    const text = readFileSync(path, 'utf8');
    for (const [, name] of text.matchAll(DECLARED)) declared.add(name!);
    if (!path.endsWith('.css')) for (const [, name] of text.matchAll(SET_IN_SCRIPT)) declared.add(name!);
    for (const [, name] of text.matchAll(READ_WITHOUT_FALLBACK)) {
      const where = reads.get(name!) ?? [];
      where.push(relative(WEB, path));
      reads.set(name!, where);
    }
  }
  return { declared, reads };
}

test('every var() without a fallback reads a declared custom property', () => {
  const { declared, reads } = scan();
  const missing = [...reads].filter(([name]) => !declared.has(name)).map(([name, where]) => `${name} in ${[...new Set(where)].join(', ')}`);
  assert.deepEqual(missing, [], 'declare these in tokens.css or use the DESIGN.md names');
});

test('the retired legacy aliases (DESIGN.md section 10) are gone from the room', () => {
  const { declared, reads } = scan();
  const back = RETIRED.filter((name) => declared.has(name) || reads.has(name));
  assert.deepEqual(back, [], 'use the DESIGN.md section 2 to 5 names instead');
});
