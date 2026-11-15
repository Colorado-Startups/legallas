// SPDX-License-Identifier: Apache-2.0
// CLI parsing, config, extractor plumbing, wrangler output parsing and the dry-run report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseSyncConfig, resolveConfigPath } from './config.ts';
import { diffSync, type SyncPlan } from './diff.ts';
import { cachedExtractor, extractorStatus, indexSource, isAgentFile, legallasExtractor, parseExtractorOutput, ExtractorUnavailable } from './extract.ts';
import { formatReport, planFingerprint } from './report.ts';
import { parseSyncArgs, pathRefusal, uploadRefusal } from './sync.ts';
import { assertKey, assertReadKey, parseD1Json } from './wrangler.ts';

test('sync args: dry run against production by default', () => {
  const options = parseSyncArgs([]);
  assert.deepEqual([options.apply, options.yes, options.target, options.summary, options.expect], [false, false, 'remote', false, null]);
  const apply = parseSyncArgs(['--apply', '--yes', '--local', '--expect', 'abcdef012345']);
  assert.deepEqual([apply.apply, apply.yes, apply.target, apply.expect], [true, true, 'local', 'abcdef012345']);
  assert.throws(() => parseSyncArgs(['--yes']), /only make sense with --apply/);
  assert.throws(() => parseSyncArgs(['--apply', '--expect', 'nothex']), /usage/);
  assert.throws(() => parseSyncArgs(['--remote-please']), /usage/);
});

test('through the room, a plan it can never take is refused in the dry run', () => {
  const GB = 1024 ** 3;
  const plan = (ops: Partial<SyncPlan>) => ({ adds: [], changes: [], renames: [], removals: [], unchanged: [], ...ops }) as SyncPlan;
  const op = (path: string, size: number) => ({ path, size }) as unknown as SyncPlan['adds'][number] & SyncPlan['changes'][number];

  assert.equal(uploadRefusal(plan({ adds: [op('a.pdf', 200 * GB)], changes: [op('b.pdf', 50 * GB)] })), null);
  assert.match(uploadRefusal(plan({ adds: [op('a.pdf', 200 * GB)], changes: [op('b.pdf', 51 * GB)] }))!, /upload 251 GB.*250 GB a month/);

  assert.equal(pathRefusal(plan({ adds: [op('notes/old.pdf', 1)] })), null);
  // A Mac file name can hold a backslash, which the room's record refuses.
  assert.match(pathRefusal(plan({ adds: [op('notes\\old.pdf', 1)] }))!, /notes\\old\.pdf/);
});

test('config: ~ expands, paths must be absolute, cache and inbox stay outside the source', () => {
  assert.equal(resolveConfigPath('~/Library/Caches/x', 'cacheDir', '/Users/me'), '/Users/me/Library/Caches/x');
  assert.throws(() => resolveConfigPath('relative/dir', 'inboxDir', '/Users/me'), /absolute/);
  assert.throws(() => resolveConfigPath('', 'inboxDir', '/Users/me'), /required/);
  const ok = parseSyncConfig({ sourceRoot: '/src/Shared', inboxDir: '/docs/inbox', cacheDir: '~/cache', banner: 'x' }, '/Users/me');
  assert.deepEqual(ok, { sourceRoot: '/src/Shared', inboxDir: '/docs/inbox', cacheDir: '/Users/me/cache' });
  assert.throws(() => parseSyncConfig({ sourceRoot: '/src/Shared', inboxDir: '/src/Shared/inbox', cacheDir: '/c' }), /inboxDir must be outside/);
  assert.throws(() => parseSyncConfig({ sourceRoot: '/c/Shared', inboxDir: '/i', cacheDir: '/c' }), /cacheDir must be outside/);
});

test('extractor output is validated', () => {
  assert.deepEqual(parseExtractorOutput('{"sha256":"x","pages":[{"n":1,"text":"hi","ocr":true}]}'), [{ n: 1, text: 'hi', ocr: true }]);
  assert.throws(() => parseExtractorOutput('{"pages":[{"n":0,"text":"x"}]}'), /malformed/);
  assert.throws(() => parseExtractorOutput('{}'), /no pages/);
  assert.equal(indexSource('pdf'), 'extractor');
  assert.equal(indexSource('csv'), 'direct');
  // Decision D8: a visual is indexed from its rendered text, read directly from the sync cache.
  assert.equal(indexSource('visual'), 'direct');
  assert.equal(indexSource('image', 'scan.PNG'), 'extractor');
  assert.equal(indexSource('image', 'chart.svg'), null);
  assert.equal(indexSource('image'), 'extractor');
});

test('agent instruction files are recognized by their path inside the shared folder', () => {
  for (const rel of ['CLAUDE.md', 'a/b/CLAUDE.md', 'a/claude.md', 'AGENTS.md', 'a/AGENTS.md', '.claude/notes.md', 'a/.claude/x/plan.csv', 'a\\CLAUDE.md']) {
    assert.equal(isAgentFile(rel), true, rel);
  }
  for (const rel of ['a/CLAUDE-notes.md', 'a/MY_CLAUDE.md', 'a/claude/notes.md', 'a/Claude_Reply.pdf', 'a/AGENTS.md.pdf']) {
    assert.equal(isAgentFile(rel), false, rel);
  }
});

test('extractor status: not built, needs a build when sources are newer, ready otherwise', async () => {
  const repo = await mkdtemp(path.join(tmpdir(), 'legallas-repo-'));
  try {
    assert.equal(await extractorStatus(repo), 'not-built');
    await assert.rejects(legallasExtractor(repo)('/tmp/x.pdf'), ExtractorUnavailable);
    await mkdir(path.join(repo, 'Sources', 'LegallasExtract'), { recursive: true });
    await writeFile(path.join(repo, 'Sources', 'LegallasExtract', 'main.swift'), '');
    assert.equal(await extractorStatus(repo), 'needs-build');
    await mkdir(path.join(repo, '.build', 'release'), { recursive: true });
    await writeFile(path.join(repo, '.build', 'release', 'LegallasExtract'), '');
    const old = new Date(Date.now() - 60_000);
    await utimes(path.join(repo, 'Sources', 'LegallasExtract', 'main.swift'), old, old);
    assert.equal(await extractorStatus(repo), 'ready');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('extraction results are cached by sha256', async () => {
  const cache = await mkdtemp(path.join(tmpdir(), 'legallas-cache-'));
  try {
    let calls = 0;
    const extract = cachedExtractor(async () => {
      calls += 1;
      return [{ n: 1, text: 'page one', ocr: false }];
    }, cache);
    const sha = 'a'.repeat(64);
    assert.deepEqual(await extract('/x.pdf', sha), [{ n: 1, text: 'page one', ocr: false }]);
    assert.deepEqual(await extract('/x.pdf', sha), [{ n: 1, text: 'page one', ocr: false }]);
    assert.equal(calls, 1);
    await assert.rejects(extract('/x.pdf', '../escape'), /bad sha256/);
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});

test('cached text from an older extractor version is extracted again', async () => {
  const cache = await mkdtemp(path.join(tmpdir(), 'legallas-cache-'));
  try {
    const sha = 'b'.repeat(64);
    const entry = path.join(cache, 'text', `${sha}.json`);
    await mkdir(path.dirname(entry), { recursive: true });
    // An entry written before versioning existed has no version field.
    await writeFile(entry, JSON.stringify({ sha256: sha, pages: [{ n: 1, text: 'column-first table', ocr: true }] }));
    let calls = 0;
    const extractor = (text: string) => async () => {
      calls += 1;
      return [{ n: 1, text, ocr: true }];
    };

    const v2 = cachedExtractor(extractor('row-by-row table'), cache, 2);
    assert.deepEqual(await v2('/scan.pdf', sha), [{ n: 1, text: 'row-by-row table', ocr: true }]);
    assert.deepEqual(await v2('/scan.pdf', sha), [{ n: 1, text: 'row-by-row table', ocr: true }]);
    assert.equal(calls, 1);

    const v3 = cachedExtractor(extractor('next version'), cache, 3);
    assert.deepEqual(await v3('/scan.pdf', sha), [{ n: 1, text: 'next version', ocr: true }]);
    assert.equal(calls, 2);
    assert.deepEqual(await v2('/scan.pdf', sha), [{ n: 1, text: 'row-by-row table', ocr: true }], 'a downgrade is a miss too');
    assert.equal(calls, 3);

    // A truncated entry (an interrupted write) is a miss that heals, not an error on every run.
    await writeFile(entry, '{"version":2,"sha256":"bbb');
    assert.deepEqual(await v2('/scan.pdf', sha), [{ n: 1, text: 'row-by-row table', ocr: true }]);
    assert.equal(calls, 4);
    assert.deepEqual(await v2('/scan.pdf', sha), [{ n: 1, text: 'row-by-row table', ocr: true }]);
    assert.equal(calls, 4);
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});

test('wrangler JSON output and key checks', () => {
  assert.deepEqual(parseD1Json('npm notice\n[{"results":[{"id":"a"}],"success":true,"meta":{}}]'), [{ id: 'a' }]);
  assert.throws(() => parseD1Json('[{"results":[],"success":false}]'), /did not succeed/);
  assert.throws(() => parseD1Json('error'), /no JSON/);
  const uuid = '0f8fad5b-d9cb-469f-a165-70867728950e';
  assert.equal(assertKey(uuid), uuid);
  assert.equal(assertKey(`text/${uuid}.p12.md`), `text/${uuid}.p12.md`);
  assert.throws(() => assertKey('Brief to court.pdf'), /did not generate/);
  assert.throws(() => assertKey(`text/${uuid}.p0.md`), /did not generate/);
  assert.equal(assertReadKey('counsel/abc-123'), 'counsel/abc-123');
  assert.throws(() => assertReadKey('../other-bucket/x'), /unexpected/);
  assert.throws(() => assertReadKey('-rf'), /unexpected/);
});

test('the dry-run report shows counts, paths and sizes, and a stable fingerprint', () => {
  const files = [
    { rel: 'A/brief.pdf', sha256: '1', size: 2048 },
    { rel: 'notes.md', sha256: '2', size: 10 },
  ];
  const plan = diffSync(files, []);
  const input = {
    plan,
    files,
    skipped: { dotfile: 3, 'lock-or-placeholder': 1 },
    iworkPackages: [],
    target: 'local',
    pendingPulls: 0,
    toIndex: { direct: 1, extracted: 1 },
    extractor: 'not-built',
    summary: false,
  };
  const report = formatReport(input);
  assert.match(report, /2 adds, 0 changes, 0 renames, 0 removals/);
  assert.match(report, /markdown 1 \(10 B\), pdf 1 \(2\.0 KB\)/);
  assert.match(report, /add\s+2\.0 KB {2}A\/brief\.pdf/);
  assert.equal(formatReport({ ...input, summary: true }).includes('A/brief.pdf'), false);
  // Random ids differ between runs; the fingerprint must not.
  assert.equal(planFingerprint(plan), planFingerprint(diffSync(files, [])));
  assert.notEqual(planFingerprint(plan), planFingerprint(diffSync(files.slice(1), [])));
});
