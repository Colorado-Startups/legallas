// SPDX-License-Identifier: Apache-2.0
// The counsel room is light only (the owner, 2026-10-06). No stylesheet, page or Worker response may opt into a
// dark theme. The binder theme pass (scripts/visualtheme*) is exempt: it names dark-scheme rules in order to
// strip them from the exhibit pages it themes.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

const WEB = join(import.meta.dirname, '..');
const ROOTS = ['src', 'public', 'worker', 'scripts', 'mcp'];
const TEXT = /\.(css|astro|ts|html|svg|json|mjs)$/;
const EXEMPT = /^scripts\/(visualtheme[^/]*|light-only\.test)\.ts$/;
const DARK = /prefers-color-scheme\s*:\s*dark|color-scheme\s*[:=]\s*["']?light dark|data-theme=["']?dark/;

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (TEXT.test(name)) yield path;
  }
}

test('no file opts into a dark theme', () => {
  const offenders: string[] = [];
  for (const root of ROOTS) {
    for (const path of files(join(WEB, root))) {
      const rel = relative(WEB, path);
      if (EXEMPT.test(rel)) continue;
      if (DARK.test(readFileSync(path, 'utf8'))) offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], 'light only: remove dark-scheme rules from these files');
});
