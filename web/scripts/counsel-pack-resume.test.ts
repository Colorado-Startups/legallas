// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, readdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { formatPackReport, parseCounselPackArgs, saveOnSignal } from './counsel-pack.ts';
import { buildPack } from './counsel-pack-build.ts';
import { cloneOrCopy } from './counsel-pack-copy.ts';
import { sweepTemps } from './counsel-pack-out.ts';
import { MANIFEST_NAME } from './counsel-pack-plan.ts';
import { fixture } from './counsel-pack-testkit.ts';

const readManifest = async (out: string) =>
  Object.keys((JSON.parse(await readFile(path.join(out, MANIFEST_NAME), 'utf8')) as { files: Record<string, unknown> }).files).sort();

/** Every file under `dir` with its size and mtime, to show a dry run changed nothing. */
async function snapshotTree(dir: string): Promise<string[]> {
  const rows: string[] = [];
  for (const name of (await readdir(dir, { recursive: true })).sort()) {
    const stats = await stat(path.join(dir, name));
    rows.push(`${name} ${stats.isFile() ? `${stats.size} ${stats.mtimeMs}` : 'dir'}`);
  }
  return rows;
}

/** Regular files under `dir` ('/'-separated, sorted). */
async function filesUnder(dir: string): Promise<string[]> {
  const names = await readdir(dir, { recursive: true });
  const files: string[] = [];
  for (const name of names) if ((await stat(path.join(dir, name))).isFile()) files.push(name.split(path.sep).join('/'));
  return files.sort();
}

test('an interrupt between placing a copy and recording it still saves that copy in the manifest', async () => {
  const f = await fixture();
  try {
    let stop: (() => Promise<void>) | null = null;
    let atExit: Promise<string[]> | null = null;
    let unblock: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const deps = {
      ...f.deps,
      // Every copy but CLAUDE.md waits, so the run cannot save the manifest on its own: what is on disk
      // when `stop` resolves is exactly what the CLI would leave behind when it exits.
      copy: async (source: string, destination: string) => {
        if (!source.endsWith('CLAUDE.md')) await blocked;
        await cloneOrCopy(source, destination);
      },
      onInterrupt: (fn: () => Promise<void>) => {
        stop = fn;
        return () => undefined;
      },
      // The interrupt lands right after CLAUDE.md is renamed into place, before that row is recorded.
      afterPlace: () => {
        atExit ??= stop?.().then(() => readManifest(f.out)) ?? null;
      },
      interruptWaitMs: 100,
    };
    const run = buildPack(f.options(), deps);
    const deadline = Date.now() + 5000;
    while (!atExit && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(await atExit, ['CLAUDE.md']);
    unblock();
    await assert.rejects(run, /Interrupted/);
    assert.deepEqual(await filesUnder(f.out), [MANIFEST_NAME, 'CLAUDE.md']);
    const rerun = await buildPack(f.options(), f.deps);
    assert.deepEqual([rerun.outcomes.conflict, rerun.outcomes.copied, rerun.outcomes.unchanged], [0, 3, 1]);
  } finally {
    await f.done();
  }
});

/** A fake process: records exit codes and stderr lines. */
function fakeTarget() {
  return Object.assign(new EventEmitter(), {
    codes: [] as number[],
    warnings: [] as string[],
    exit(code: number) {
      this.codes.push(code);
    },
    warn(line: string) {
      this.warnings.push(line);
    },
  });
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('SIGINT and SIGTERM stop first, then exit with the signal code', async () => {
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
    const target = fakeTarget();
    let stops = 0;
    const release = saveOnSignal(async () => {
      stops += 1;
    }, target);
    target.emit(signal);
    await tick();
    assert.deepEqual([stops, target.codes, target.warnings], [1, [code], []]);
    release();
    assert.deepEqual([target.listenerCount('SIGINT'), target.listenerCount('SIGTERM')], [0, 0]);
  }
});

test('a failed save on interrupt is reported by its code only, and still exits', async () => {
  const target = fakeTarget();
  saveOnSignal(async () => {
    throw Object.assign(new Error("ENOSPC: no space left on device, open '/Users/x/Copperline/.counsel-pack-manifest.json'"), { code: 'ENOSPC' });
  }, target);
  target.emit('SIGINT');
  await tick();
  assert.deepEqual(target.codes, [130]);
  assert.deepEqual(target.warnings, ['Could not save the pack manifest on interrupt (ENOSPC).']);
});

test('a second signal exits at once without starting another save', async () => {
  const target = fakeTarget();
  let stops = 0;
  let finish: () => void = () => undefined;
  saveOnSignal(() => {
    stops += 1;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  }, target);
  target.emit('SIGINT');
  target.emit('SIGTERM');
  assert.deepEqual([stops, target.codes], [1, [143]]);
  finish();
  await tick();
  assert.deepEqual(target.codes, [143, 130]);
});

test('the sweep skips folders and files that vanish mid-sweep', async () => {
  const f = await fixture();
  try {
    await buildPack(f.options(), f.deps);
    assert.equal(await sweepTemps(f.out, false, path.join(f.out, 'gone')), 0);
    assert.equal(await sweepTemps(f.out, false, path.join(f.out, 'CLAUDE.md')), 0);
    for (let round = 0; round < 10; round += 1) {
      const sub = path.join(f.out, 'scratch');
      await mkdir(path.join(sub, 'deeper'), { recursive: true });
      for (let i = 0; i < 10; i += 1) await writeFile(path.join(sub, i % 2 ? 'deeper' : '', `${i}.pdf.counsel-pack-0000000${i}`), 'x');
      await Promise.all([sweepTemps(f.out), sweepTemps(f.out), rm(sub, { recursive: true, force: true })]);
    }
    assert.deepEqual(await filesUnder(f.out), [MANIFEST_NAME, ...(await readManifest(f.out)), 'INDEX.csv', 'README.txt'].sort());
  } finally {
    await f.done();
  }
});

test('partial zips beside --out are cleared, and a dry run only counts them', async () => {
  const f = await fixture();
  try {
    await buildPack(f.options(), f.deps);
    const partial = `${f.out}.zip.partial-0123abcd`;
    const others = [`${f.out}.zip.partial-xyz`, `${f.out}-old.zip.partial-0123abcd`];
    for (const file of [partial, ...others]) await writeFile(file, 'half a zip');
    await writeFile(path.join(f.out, 'README.txt.counsel-pack-0123abcd'), 'half a readme');
    const dry = await buildPack(f.options({ dryRun: true }), f.deps);
    assert.equal(dry.sweptTemps, 2);
    assert.match(formatPackReport(dry, false), /Would clear 2 temp files/);
    assert.ok(await stat(partial));
    const real = await buildPack(f.options(), f.deps);
    assert.equal(real.sweptTemps, 2);
    assert.equal(await stat(partial).catch(() => null), null);
    for (const file of others) assert.equal(await readFile(file, 'utf8'), 'half a zip');
  } finally {
    await f.done();
  }
});

test('a run clears temp files an interrupted run left, matching the exact pattern only', async () => {
  const f = await fixture();
  try {
    await buildPack(f.options(), f.deps);
    const outside = path.join(f.parent, 'Elsewhere');
    await mkdir(outside);
    await writeFile(path.join(outside, 'x.pdf.counsel-pack-0123abcd'), 'not ours to delete');
    await symlink(outside, path.join(f.out, 'linked'));
    await writeFile(path.join(f.out, '01-Contracts', 'Job-Schedule__20110914__Tally-Payroll.pdf.counsel-pack-0123abcd'), 'half a copy');
    await writeFile(path.join(f.out, 'INDEX.csv.counsel-pack-deadbeef'), 'half an index');
    for (const kept of ['notes.counsel-pack-0123abcd.txt', 'memo.counsel-pack-xyz', 'memo.counsel-pack-0123ABCD']) {
      await writeFile(path.join(f.out, kept), 'counsel file');
    }
    const report = await buildPack(f.options(), f.deps);
    assert.equal(report.sweptTemps, 2);
    assert.deepEqual((await readdir(path.join(f.out, '01-Contracts'))).sort(), ['Job-Schedule__20110914__Tally-Payroll.pdf', 'Service-Contract__20110809__Tally-Payroll.pdf']);
    assert.ok((await readdir(f.out)).includes('memo.counsel-pack-xyz'));
    assert.equal(await readFile(path.join(outside, 'x.pdf.counsel-pack-0123abcd'), 'utf8'), 'not ours to delete');
    assert.match(formatPackReport(report, false), /Cleared 2 temp files/);
  } finally {
    await f.done();
  }
});

test('--dry-run creates nothing for a new pack and counts what a run would copy', async () => {
  const f = await fixture();
  try {
    const report = await buildPack(f.options({ dryRun: true, zip: true }), f.deps);
    assert.deepEqual([report.dryRun, report.outcomes.copied, report.zip], [true, 4, null]);
    assert.ok(report.copiedBytes > 0);
    assert.equal(await stat(f.out).catch(() => null), null);
    assert.equal(await stat(`${f.out}.zip`).catch(() => null), null);
    assert.match(formatPackReport(report, false), /^Dry run, nothing was written\. Would pack 4 documents/);
  } finally {
    await f.done();
  }
});

test('--dry-run on an existing pack changes nothing and predicts the real run', async () => {
  const f = await fixture();
  try {
    await buildPack(f.options(), f.deps);
    await rename(path.join(f.root, '01-Contracts'), path.join(f.root, 'tmp-rename'));
    await rename(path.join(f.root, 'tmp-rename'), path.join(f.root, '01-contracts'));
    for (const row of f.rows) row.path = String(row.path).replace('01-Contracts/', '01-contracts/');
    f.rows.splice(f.rows.findIndex((row) => row.path === 'CLAUDE.md'), 1);
    await writeFile(path.join(f.out, '01-Contracts', 'Job-Schedule__20110914__Tally-Payroll.pdf.counsel-pack-0123abcd'), 'half a copy');
    const before = await snapshotTree(f.out);
    const dry = await buildPack(f.options({ dryRun: true }), f.deps);
    assert.deepEqual(await snapshotTree(f.out), before);
    const real = await buildPack(f.options(), f.deps);
    const counts = (r: typeof dry) => [r.outcomes.copied, r.outcomes.unchanged, r.outcomes.conflict, r.removed, r.left];
    assert.deepEqual(counts(dry), [2, 1, 0, 3, 0]);
    assert.deepEqual(counts(dry), counts(real));
  } finally {
    await f.done();
  }
});

test('--dry-run is parsed', () => {
  assert.equal(parseCounselPackArgs(['--out', '/tmp/p', '--dry-run']).dryRun, true);
  assert.equal(parseCounselPackArgs(['--out', '/tmp/p']).dryRun, false);
});
