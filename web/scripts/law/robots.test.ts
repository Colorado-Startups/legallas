// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { robotsAllows } from './robots.ts';

test('a path the rules for every agent disallow is refused, and others pass', () => {
  const robots = 'User-agent: *\n  Disallow: /search\n  Disallow: /api/versioner/v1/full/\n';
  assert.equal(robotsAllows(robots, '/api/versioner/v1/full/2099-01-01/title-17.xml?part=230'), false);
  assert.equal(robotsAllows(robots, '/api/versioner/v1/titles.json'), true);
  assert.equal(robotsAllows(robots, '/current/title-17/section-230.506'), true);
});

test('no file or no rules allows everything', () => {
  assert.equal(robotsAllows('', '/a'), true);
  assert.equal(robotsAllows('# only a comment\n', '/a'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow:\n', '/a'), true);
});

test('rules for another agent do not count, and agents listed together share their rules', () => {
  assert.equal(robotsAllows('User-agent: SomeBot\nDisallow: /\n', '/a'), true);
  assert.equal(robotsAllows('User-agent: SomeBot\nDisallow: /\n\nUser-agent: *\nDisallow: /b\n', '/a'), true);
  assert.equal(robotsAllows('User-agent: SomeBot\nUser-agent: *\nDisallow: /a\n', '/a'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /a\nUser-agent: SomeBot\nDisallow: /b\n', '/b'), true);
});

test('the longest match wins, Allow on a tie, and * and $ work', () => {
  const robots = 'User-agent: *\nAllow: /core/*.css$\nDisallow: /core/\nDisallow: /tie\nAllow: /tie\n';
  assert.equal(robotsAllows(robots, '/core/x.css'), true);
  assert.equal(robotsAllows(robots, '/core/x.css?v=1'), false);
  assert.equal(robotsAllows(robots, '/core/x.js'), false);
  assert.equal(robotsAllows(robots, '/tie'), true);
});

test('wildcards match in order, and each piece must fit after the one before', () => {
  const allowed = (rule: string, target: string) => robotsAllows(`User-agent: *\nDisallow: ${rule}\n`, target);
  assert.equal(allowed('/a*c', '/abc'), false, 'matches, so it is refused');
  assert.equal(allowed('/a*c', '/ab'), true);
  assert.equal(allowed('/a*b*c', '/a1b2c3'), false, 'still a prefix match');
  assert.equal(allowed('/a*b*c', '/a1c2b'), true, 'out of order');
  assert.equal(allowed('/a*bc$', '/axbc'), false);
  assert.equal(allowed('/a*bc$', '/axbcd'), true, 'the end is anchored');
  assert.equal(allowed('/ab*b$', '/ab'), true, 'the last piece may not overlap the first');
  assert.equal(allowed('/a$', '/a'), false);
  assert.equal(allowed('/a$', '/ab'), true);
  assert.equal(allowed('/a.c', '/abc'), true, 'a dot is a plain character');
  assert.equal(allowed('*.pdf$', '/x/y.pdf'), false);
  // Each kills a mutant of matches() (#262).
  assert.equal(allowed('/a*a*z', '/a1z'), true, 'a middle piece is sought after the first, never inside it');
  assert.equal(allowed('/*ab*bc', '/abc'), true, 'pieces may not overlap');
  assert.equal(allowed('/a*b*c', '/a1c'), true, 'a missing middle piece fails the match');
  assert.equal(allowed('/a*c', '/x/ac'), true, 'the first piece is a prefix, not found anywhere');
  assert.equal(allowed('/a*c', '/x/a/c'), true, 'the first piece is a prefix, even with the last piece after it');
});

test('a rule with many wildcards from a remote server answers at once', () => {
  // In a child with a deadline: a backtracking matcher would block for minutes, and a check after the call never runs.
  const script = `import { robotsAllows } from ${JSON.stringify(new URL('./robots.ts', import.meta.url).href)};
    const rule = '/' + '*a'.repeat(60) + '*z';
    process.stdout.write(String(robotsAllows('User-agent: *\\nDisallow: ' + rule + '\\n', '/' + 'a'.repeat(4000))));`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(run.signal, null, 'answered within 10 seconds');
  assert.equal(run.stdout, 'true');
});
