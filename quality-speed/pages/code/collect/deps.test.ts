// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installedDirect, judgeDependency } from './deps.ts';

const now = new Date('2030-03-01T00:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

test('a newer minor inside the 14-day window keeps a dependency current; past it, the dependency is overdue', () => {
  const time = { '1.0.0': daysAgo(400), '1.1.0': daysAgo(10) };
  assert.equal(judgeDependency('pkg', '1.0.0', time, now).current, true);
  const late = judgeDependency('pkg', '1.0.0', { ...time, '1.1.0': daysAgo(15) }, now);
  assert.equal(late.current, false);
  assert.equal(late.overdue, '1.1.0');
});

test('a new major gets 37 days; prereleases never count', () => {
  const time = { '2.0.0': daysAgo(300), '3.0.0': daysAgo(36), '4.0.0-beta.1': daysAgo(200) };
  const s = judgeDependency('pkg', '2.0.0', time, now);
  assert.equal(s.current, true);
  assert.equal(s.newest, '3.0.0');
  assert.ok(Math.abs(s.libyears - 264 / 365.25) < 1e-9);
  assert.equal(judgeDependency('pkg', '2.0.0', { ...time, '3.0.0': daysAgo(38) }, now).current, false);
});

test('an installed version the registry does not list is an error, never a pass', () => {
  assert.throws(() => judgeDependency('pkg', '9.9.9', { '1.0.0': daysAgo(1) }, now), /no release date/);
});

test('direct dependencies come from package.json at the versions the lockfile installs', () => {
  const pkg = { dependencies: { b: '^1.0.0' }, devDependencies: { a: '2.0.0' } };
  const lock = { packages: { 'node_modules/a': { version: '2.0.0' }, 'node_modules/b': { version: '1.4.2' } } };
  assert.deepEqual(installedDirect(pkg, lock), [{ name: 'a', version: '2.0.0' }, { name: 'b', version: '1.4.2' }]);
  assert.throws(() => installedDirect({ dependencies: { c: '1' } }, lock), /not in package-lock/);
});
