// SPDX-License-Identifier: Apache-2.0
// Per-file extractor timeout, driven through a fake LegallasExtract shell script in a temporary repo. The
// document paths are synthetic and never read; the fake binary ignores its argument.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkIndex, failureCode, formatIndexCheck } from './checkindex.ts';
import { cachedExtractor, EXTRACT_TIMEOUT_MS, ExtractorUnavailable, legallasExtractor } from './extract.ts';
import { buildIndex, type IndexJob } from './indexjob.ts';

const TIMEOUT_MS = 300;
// The limit for a run that must succeed. The OK fake answers in well under a second, but a busy machine can stall
// it: a 300 ms limit once failed the successful run on a busy CI machine. Web
// tests now run on Linux, yet a shared runner or a local run can be
// just as busy.
const PATIENT_MS = 60_000;
const FILE = '/synthetic/Private Name 2026.pdf';
const SHA = 'b'.repeat(64);
// `exec` replaces the shell, so SIGTERM reaches sleep itself. A plain `sleep` child would keep stdout open
// after the shell dies and execFile would wait for it.
const HANG = '#!/bin/sh\nexec sleep 30\n';
const OK = `#!/bin/sh\nprintf '%s' '{"sha256":"${SHA}","pages":[{"n":1,"text":"synthetic page","ocr":false}]}'\n`;

async function fakeRepo(script: string): Promise<{ repo: string; install: (script: string) => Promise<void> }> {
  const repo = await mkdtemp(path.join(tmpdir(), 'legallas-extract-'));
  const binary = path.join(repo, '.build', 'release', 'LegallasExtract');
  await mkdir(path.dirname(binary), { recursive: true });
  const install = async (body: string) => {
    await writeFile(binary, body);
    await chmod(binary, 0o755);
  };
  await install(script);
  return { repo, install };
}

const job: IndexJob = { id: 'doc-hung', kind: 'pdf', sha256: SHA, file: FILE, name: path.basename(FILE), staleParts: 0 };

test('the per-file timeout defaults to 180 s', () => {
  assert.equal(EXTRACT_TIMEOUT_MS, 180_000);
});

test('a hung extractor run fails as "timeout" without naming the file', async () => {
  const { repo } = await fakeRepo(HANG);
  try {
    const started = Date.now();
    const error = await legallasExtractor(repo, TIMEOUT_MS)(FILE).then(
      () => assert.fail('expected a timeout'),
      (caught: unknown) => caught,
    );
    assert.ok(Date.now() - started < 10_000, 'the run was killed, not waited out');
    assert.ok(error instanceof Error);
    assert.equal(error instanceof ExtractorUnavailable, false);
    assert.equal(error.message, 'LegallasExtract failed: timeout');
    assert.equal(failureCode(error), 'timeout');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('a timed-out run writes no cache entry; the next successful run does', async () => {
  const { repo, install } = await fakeRepo(HANG);
  const cache = await mkdtemp(path.join(tmpdir(), 'legallas-cache-'));
  try {
    // One cache over both runs. Only the hung run gets the short limit: a fake that never exits times out
    // however busy the machine is, while the successful run must not race that limit.
    let limit = TIMEOUT_MS;
    const extract = cachedExtractor((file) => legallasExtractor(repo, limit)(file), cache);
    await assert.rejects(extract(FILE, SHA), /^Error: LegallasExtract failed: timeout$/);
    assert.deepEqual(await readdir(path.join(cache, 'text')).catch(() => []), []);
    await install(OK);
    limit = PATIENT_MS;
    assert.deepEqual(await extract(FILE, SHA), [{ n: 1, text: 'synthetic page', ocr: false }]);
    assert.deepEqual(await readdir(path.join(cache, 'text')), [`${SHA}.json`]);
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(cache, { recursive: true, force: true });
  }
});

test('sync skips a timed-out document for a retry and --check-index counts it as "timeout"', async () => {
  const { repo } = await fakeRepo(HANG);
  const cache = await mkdtemp(path.join(tmpdir(), 'legallas-cache-'));
  const work = await mkdtemp(path.join(tmpdir(), 'legallas-work-'));
  try {
    const extractPdf = cachedExtractor(legallasExtractor(repo, TIMEOUT_MS), cache);
    const readText = async () => [{ n: 1, text: '# notes', ocr: false }];
    const notes: IndexJob = { id: 'doc-notes', kind: 'markdown', sha256: 'c'.repeat(64), file: '/synthetic/notes.md', name: 'notes.md', staleParts: 0 };

    const lines: string[] = [];
    const built = await buildIndex([job, notes], { extractPdf, readText, workDir: work, log: (line) => lines.push(line) });
    assert.equal(built.skipped, 1);
    assert.deepEqual([...built.parts.keys()], ['doc-notes']);
    assert.deepEqual(lines, ['  warning: could not extract text for document doc-hung; it will be retried next run']);

    const check = await checkIndex([job, notes], { extractPdf, readText });
    assert.deepEqual(check.failed, { timeout: 1 });
    assert.equal(check.textDocs, 1);
    const text = formatIndexCheck(check);
    assert.match(text, /Failed: timeout 1/);
    assert.equal(/synthetic|Private Name/.test(text + lines.join('\n')), false);
    assert.deepEqual(await readdir(path.join(cache, 'text')).catch(() => []), []);
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(cache, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
  }
});
