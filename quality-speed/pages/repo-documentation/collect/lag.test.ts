// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runDrill } from './drill.ts';
import { episodes } from './lag.ts';

const c = (sha: string, at: string) => ({ sha, at });

test('episodes: opened at the commit that brings a finding, closed at the one that clears it', () => {
  const commits = [c('a', '2026-11-01T00:00:00.000Z'), c('b', '2026-11-01T02:00:00.000Z'), c('c', '2026-11-01T05:00:00.000Z')];
  const sets = [new Set(['x']), new Set(['x', 'y']), new Set(['y'])];
  const eps = episodes(commits, sets, '2026-11-02T00:00:00.000Z');
  assert.deepEqual(
    eps.map((e) => [e.key, e.closed, e.hours]),
    [['x', '2026-11-01T05:00:00.000Z', 5], ['y', null, 22]],
  );
});

test('a finding that comes back is a new episode', () => {
  const commits = [c('a', '2026-11-01T00:00:00.000Z'), c('b', '2026-11-01T01:00:00.000Z'), c('c', '2026-11-01T03:00:00.000Z')];
  const eps = episodes(commits, [new Set(['x']), new Set(), new Set(['x'])], '2026-11-01T04:00:00.000Z');
  assert.deepEqual(eps.map((e) => e.hours), [1, 1]);
});

test('the planted drill finds its one break and times it at five hours', () => {
  assert.equal(runDrill(), true);
});

test('a replay that runs out of time keeps its progress and reads as unavailable, never as a short lag', async () => {
  const { docLag, LagUnavailable } = await import('./lag.ts');
  const { mkdtempSync, rmSync, writeFileSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { GIT_ENV } = await import('./fixture.ts');
  const dir = mkdtempSync(join(tmpdir(), 'qs-docs-lag-'));
  try {
    const repo = join(dir, 'repo');
    const config = join(dir, 'config');
    execFileSync('mkdir', ['-p', repo, config]);
    writeFileSync(join(config, 'not-in-tree.json'), '[]');
    writeFileSync(join(config, 'questions.json'), '{"questions":[]}');
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { env: { ...GIT_ENV, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test' }, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'a.md'), '# A\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'one');
    const cache = join(dir, 'cache.json');
    assert.throws(() => docLag(repo, 'main', config, new Date().toISOString(), cache, 0), LagUnavailable);
    assert.equal(existsSync(cache), true, 'progress is saved for the next run');
    assert.deepEqual(docLag(repo, 'main', config, new Date().toISOString(), cache), []);
    // A shallow clone can't show when a finding opened.
    const shallow = join(dir, 'shallow');
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${repo}`, shallow], { env: GIT_ENV, stdio: 'ignore' });
    assert.throws(() => docLag(shallow, 'HEAD', config, new Date().toISOString()), LagUnavailable);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
