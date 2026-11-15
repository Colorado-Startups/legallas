// SPDX-License-Identifier: Apache-2.0
// The site's type check installs TypeScript and Node's types from its own lockfile, and nothing bumps them there (#872).
// So they follow web/'s: every package in quality-speed's lockfile is the one web's lockfile resolves, and package.json pins
// it. ci.yml runs this on a change to web/package-lock.json too (changed-paths.sh), so the bump that drifts fails, not a later
// pull request. The fix copies web's lock entry, so no install is needed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

type Lock = { packages: Record<string, { version?: string; resolved?: string; integrity?: string }> };
const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')) as T;

test('the type check uses web\'s TypeScript and Node types, so its pins never drift behind', () => {
  const site = read<Lock>('quality-speed/package-lock.json').packages;
  const web = read<Lock>('web/package-lock.json').packages;
  const pins = read<{ devDependencies: Record<string, string> }>('quality-speed/package.json').devDependencies;
  const installed = Object.keys(site).filter((key) => key.startsWith('node_modules/'));
  assert.ok(installed.length > 0);
  for (const key of installed) {
    const [mine, theirs] = [site[key]!, web[key]];
    const fix = `${key.slice('node_modules/'.length)}: copy web/package-lock.json's entry (version, resolved, integrity) into quality-speed/package-lock.json, and pin its version in quality-speed/package.json`;
    assert.ok(theirs, `${fix}: web resolves none`);
    assert.deepEqual([mine.version, mine.resolved, mine.integrity], [theirs.version, theirs.resolved, theirs.integrity], fix);
  }
  for (const [name, pin] of Object.entries(pins)) assert.equal(pin, site[`node_modules/${name}`]?.version, `${name}: package.json pins ${pin}, the lockfile has another`);
});
