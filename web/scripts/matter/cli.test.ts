// SPDX-License-Identifier: Apache-2.0
// Card F4. The CLI end to end on a temporary cache: build, check, report, diff and publish, the output
// guard, file modes, and that the terminal never carries case text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CATALOG_REL } from './catalog.ts';
import { parseMatterArgs, runMatter, type Deps, type MatterOptions } from './cli.ts';
import { assertSafeOutput, matterPaths, REPO_ROOT, writePrivate } from './paths.ts';
import { NOW, SOURCE_ROOT, fakeD1, tempCache } from './testkit.ts';

function deps(cacheDir: string, extra: Partial<Deps> = {}): Deps & { lines: string[]; puts: string[][] } {
  const lines: string[] = [];
  const puts: string[][] = [];
  return {
    config: { sourceRoot: SOURCE_ROOT, inboxDir: path.join(cacheDir, 'inbox'), cacheDir },
    d1Query: fakeD1().d1Query,
    r2Get: async () => { throw new Error('wrangler r2 object get failed:\n✘ [ERROR] The specified key does not exist.'); },
    run: async (args) => { puts.push(args); return ''; },
    now: () => NOW,
    log: (line) => lines.push(line),
    lines,
    puts,
    ...extra,
  };
}

const opts = (args: string[]): MatterOptions => parseMatterArgs(args);
const mode = async (file: string) => (await stat(file)).mode & 0o777;
// Names, titles and paths from the fixture that must never reach the terminal.
const CASE_TEXT = /Doe|Roe|Harbor|\.pdf|Meeting-Plan|p-doe|ev-000|count-1/;

test('parseMatterArgs', () => {
  assert.deepEqual(parseMatterArgs(['build']).target, 'remote');
  assert.equal(parseMatterArgs(['check', '--local']).target, 'local');
  const sha = 'a'.repeat(64);
  assert.equal(parseMatterArgs(['publish', '--expect', sha, '--local']).expect, sha);
  assert.throws(() => parseMatterArgs(['publish']), /needs --expect/);
  assert.throws(() => parseMatterArgs(['publish', '--expect', 'abc']), /usage/);
  assert.throws(() => parseMatterArgs(['build', '--expect', sha]), /only applies to publish/);
  assert.throws(() => parseMatterArgs([]), /usage/);
  assert.throws(() => parseMatterArgs(['deploy']), /usage/);
});

test('build writes mode 600 files and prints counts only; report and check follow', async () => {
  const cache = await tempCache();
  const d = deps(cache);
  assert.equal(await runMatter(opts(['build', '--local']), d), 0);
  const paths = matterPaths(cache);
  for (const file of [paths.matter, paths.sha, paths.info]) assert.equal(await mode(file), 0o600);
  assert.equal(await mode(paths.build), 0o700);
  const sha = (await readFile(paths.sha, 'utf8')).split(' ')[0];
  assert.match(sha, /^[0-9a-f]{64}$/);
  assert.equal(JSON.parse(await readFile(paths.matter, 'utf8')).meta.builtAt, NOW.toISOString());
  assert.equal(await runMatter(opts(['report']), d), 0);
  assert.equal(await mode(paths.report), 0o600);
  assert.match(await readFile(paths.report, 'utf8'), /Harbor Labs/);
  assert.equal(await runMatter(opts(['check']), d), 0);
  assert.ok(d.lines.some((line) => /Check: passes/.test(line)));
  assert.ok(d.lines.some((line) => /Keyword flags: offer 1/.test(line)));
  for (const line of d.lines) assert.doesNotMatch(line, CASE_TEXT);
});

test('catalog internal notes: counted in the summary, listed in the report, and never fail check or publish', async () => {
  const clean = deps(await tempCache());
  assert.equal(await runMatter(opts(['check']), clean), 0);
  assert.ok(clean.lines.some((line) => /^Catalog internal notes \(flagged only\): none$/m.test(line)));
  // The fixture catalog with one summary that still carries a filing note and a note of the room's own.
  const source = await mkdtemp(path.join(tmpdir(), 'legallas-source-'));
  const fixture = await readFile(path.join(SOURCE_ROOT, CATALOG_REL), 'utf8');
  await mkdir(path.join(source, path.dirname(CATALOG_REL)), { recursive: true });
  await writeFile(path.join(source, CATALOG_REL), fixture.replace('"Counsel notes."', '"Counsel notes. Renamed for the folder scheme, from scanner batch 3."'));
  const cache = await tempCache();
  const d = deps(cache, { internalNotes: [{ note: 'scanner batch', pattern: /\bscanner batch\b/i }] });
  d.config = { ...d.config, sourceRoot: source };
  assert.equal(await runMatter(opts(['check']), d), 0);
  assert.ok(d.lines.some((line) => /^Catalog internal notes \(flagged only\): 1 row \(scanner batch 1, rename or move 1\)$/m.test(line)));
  assert.ok(d.lines.some((line) => /Check: passes/.test(line)));
  assert.equal(await runMatter(opts(['build']), d), 0);
  assert.equal(await runMatter(opts(['report']), d), 0);
  const paths = matterPaths(cache);
  const html = await readFile(paths.report, 'utf8');
  assert.match(html, /Catalog internal notes: <b>2<\/b>/);
  assert.match(html, /<td>rename or move<\/td><td><span class="mono">07-Lawyer-Notes-PRIVILEGED\/Memo_MEM__20120528__Lisa-Low__Removal-Summary\.pdf<\/span><\/td>/);
  const sha = (await readFile(paths.sha, 'utf8')).split(' ')[0];
  assert.equal(await runMatter(opts(['publish', '--expect', sha, '--local']), d), 0);
  // Build info written before the notes existed still reports, as having none.
  const { catalogNotes, ...older } = JSON.parse(await readFile(paths.info, 'utf8'));
  assert.equal(catalogNotes.length, 2);
  await writePrivate(paths.info, JSON.stringify(older));
  assert.equal(await runMatter(opts(['report']), d), 0);
  assert.match(await readFile(paths.report, 'utf8'), /Catalog internal notes: <b>0<\/b>/);
  for (const line of [...clean.lines, ...d.lines]) assert.doesNotMatch(line, CASE_TEXT);
});

test('an unresolved cite fails check and refuses the build, without naming it; the report lists it', async () => {
  const cache = await tempCache();
  await writeFile(
    path.join(cache, 'matter', 'fragments', 'M9.json'),
    JSON.stringify({ card: 'M9', events: [{ id: 'ev-9', date: '2012', title: 'Roe meeting', summary: null, type: 'meeting', actors: [], claims: [], cites: [{ path: '09/Roe_Missing.pdf', page: 1 }] }] }),
  );
  const d = deps(cache);
  assert.equal(await runMatter(opts(['check']), d), 1);
  assert.ok(d.lines.some((line) => /Unresolved cites: 1/.test(line)));
  // Its only cite is gone, so parseMatter refuses the event: by field, never by value.
  assert.ok(d.lines.some((line) => /^Validation: refused: events\[\d\]\.cites must cite at least one document$/m.test(line)));
  assert.equal(await runMatter(opts(['build']), d), 1);
  const paths = matterPaths(cache);
  await assert.rejects(stat(paths.matter));
  assert.equal(await runMatter(opts(['report']), d), 0);
  const html = await readFile(paths.report, 'utf8');
  assert.match(html, /09\/Roe_Missing\.pdf/);
  assert.match(html, /The build was refused/);
  await assert.rejects(runMatter(opts(['publish', '--expect', 'd'.repeat(64)]), d), /No built manifest/);
  for (const line of d.lines) assert.doesNotMatch(line, CASE_TEXT);
});

test('diff: with nothing published every entry is new; with the build published nothing changed', async () => {
  const cache = await tempCache();
  const d = deps(cache);
  await runMatter(opts(['build']), d);
  await runMatter(opts(['diff']), d);
  assert.ok(d.lines.some((line) => line.startsWith('Nothing is published yet; every entry is new:')));
  assert.ok(d.lines.some((line) => /events\s+\+2\s+-0\s+~0\s+=0/.test(line)));
  const built = await readFile(matterPaths(cache).matter, 'utf8');
  const published = deps(cache, { r2Get: async (bucket, key, file) => { assert.deepEqual([bucket, key], ['legallas-files', 'meta/matter.json']); await writeFile(file, built); } });
  await runMatter(opts(['diff', '--local']), published);
  assert.ok(published.lines.some((line) => /events\s+\+0\s+-0\s+~0\s+=2/.test(line)));
  // The fetched copy does not linger.
  await assert.rejects(stat(path.join(matterPaths(cache).build, 'published.json')));
  const broken = deps(cache, { r2Get: async () => { throw new Error('wrangler r2 object get failed:\n✘ [ERROR] Authentication error [code: 10000]'); } });
  await assert.rejects(runMatter(opts(['diff']), broken), /Authentication/);
});

test('publish: only the reviewed sha, only a passing build, only to legallas-files meta/matter.json', async () => {
  const cache = await tempCache();
  const d = deps(cache);
  await assert.rejects(runMatter(opts(['publish', '--expect', 'b'.repeat(64)]), d), /No built manifest/);
  await runMatter(opts(['build']), d);
  const paths = matterPaths(cache);
  const sha = (await readFile(paths.sha, 'utf8')).split(' ')[0];
  await assert.rejects(runMatter(opts(['publish', '--expect', 'b'.repeat(64)]), d), /does not match --expect/);
  assert.equal(d.puts.length, 0);
  assert.equal(await runMatter(opts(['publish', '--expect', sha, '--local']), d), 0);
  assert.deepEqual(d.puts, [['r2', 'object', 'put', 'legallas-files/meta/matter.json', '--file', paths.matter, '--content-type', 'application/json', '--local']]);
  // A build that fails check cannot be published even with its own sha.
  await writeFile(path.join(cache, 'matter', 'fragments', 'M9.json'), JSON.stringify({ card: 'M9', money: [{ id: 'm-9', date: '2012', amountCents: 1, from: null, to: null, label: 'x', cites: [] }] }));
  await runMatter(opts(['build']), d);
  const failing = (await readFile(paths.sha, 'utf8')).split(' ')[0];
  await assert.rejects(runMatter(opts(['publish', '--expect', failing]), d), /does not pass check/);
  assert.equal(d.puts.length, 1);
});

test('report refuses a manifest edited after the build', async () => {
  const cache = await tempCache();
  const d = deps(cache);
  await runMatter(opts(['build']), d);
  await writePrivate(matterPaths(cache).matter, '{}\n');
  await assert.rejects(runMatter(opts(['report']), d), /changed since it was built/);
  await assert.rejects(runMatter(opts(['publish', '--expect', 'c'.repeat(64)]), d), /does not match/);
});

test('output guard: never inside the repo, the case folder or any git checkout', async () => {
  await assert.rejects(assertSafeOutput(path.join(REPO_ROOT, 'web', 'tmp-matter'), SOURCE_ROOT), /inside the repository/);
  const outside = await mkdtemp(path.join(tmpdir(), 'legallas-guard-'));
  const source = path.join(outside, 'Shared');
  await mkdir(source);
  await assert.rejects(assertSafeOutput(path.join(source, 'cache', 'matter', 'build'), source), /inside the case folder/);
  const checkout = path.join(outside, 'checkout');
  await mkdir(path.join(checkout, '.git'), { recursive: true });
  await assert.rejects(assertSafeOutput(path.join(checkout, 'cache', 'build'), source), /inside a git checkout/);
  await assertSafeOutput(path.join(outside, 'cache', 'matter', 'build'), source);
  // runMatter applies the guard before any subcommand.
  const d = deps(path.join(REPO_ROOT, 'web', '.matter-cache'));
  await assert.rejects(runMatter(opts(['check']), d), /inside the repository/);
});
