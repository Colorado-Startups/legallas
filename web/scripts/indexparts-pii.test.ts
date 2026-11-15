// SPDX-License-Identifier: Apache-2.0
// The index's last check (indexparts.ts PiiInPart) and how the sync's index step and --check-index handle it.
// Synthetic text only; numbers are joined at run time (area 078, group 05, serial 1120: the SSA's voided sample).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyPlan, type ApplyDeps } from './apply.ts';
import { checkIndex } from './checkindex.ts';
import { diffSync } from './diff.ts';
import { directTextPages } from './extract.ts';
import { guardWalk } from './guard.ts';
import type { IndexJob } from './indexjob.ts';
import { buildParts, PART_MAX_BYTES, PiiInPart } from './indexparts.ts';
import type { KnownMatcher } from './pii.ts';
import { cloneWithCp, createSnapshot, verifyOriginals, type Cloner } from './snapshot.ts';
import type { Wrangler } from './wrangler.ts';

// As apply.test.ts: an APFS clone on macOS, a plain copy elsewhere.
const clone: Cloner = process.platform === 'darwin' ? cloneWithCp : (source, destination) => copyFile(source, destination);

const DOC = '11111111-2222-4333-8444-555555555555';
const VOIDED = ['078', '05', '1120'];
const KNOWN = ['666', '12', '3456'];
const known: KnownMatcher = { matches: async (d) => d === KNOWN.join(''), matchesSync: (d) => d === KNOWN.join('') };
const sha = (c: string) => c.repeat(64);

test('no part is built from text that still holds a printed SSN; the error names the document, not the number', () => {
  for (const sep of ['-', ' ', '.']) {
    const pages = [{ n: 1, text: 'Staff roster' }, { n: 2, text: `Employee ${VOIDED.join(sep)} of record` }];
    assert.throws(
      () => buildParts(DOC, pages),
      (error: Error) => error instanceof PiiInPart && error.docId === DOC && error.message.includes(DOC) && !error.message.includes(VOIDED.join(sep)),
    );
  }
  const ein = [{ n: 1, text: `Harbor Labs EIN ${['12', '3456789'].join('-')}, ZIP 80202-1234, phone 303-555-0123` }];
  assert.equal(buildParts(DOC, ein).length, 1, 'EINs and other numbers build as before');
});

test('an acknowledged document passes the printed-form check; a known SSN never does', () => {
  const printed = [{ n: 1, text: `Row ${VOIDED.join('-')}` }];
  assert.equal(buildParts(DOC, printed, PART_MAX_BYTES, { acknowledged: true }).length, 1);
  const knownText = [{ n: 1, text: `Account ${['66', '6123456'].join('-')}` }];
  assert.equal(buildParts(DOC, knownText).length, 1, 'without the hashes it is just a number');
  assert.throws(() => buildParts(DOC, knownText, PART_MAX_BYTES, { known }), PiiInPart);
  assert.throws(() => buildParts(DOC, knownText, PART_MAX_BYTES, { known, acknowledged: true }), PiiInPart);
});

function fakeWrangler(calls: string[]): Wrangler {
  return {
    target: 'remote',
    async d1Query() {
      calls.push('d1Query');
      return [];
    },
    async d1File() {
      calls.push('d1File');
    },
    async r2Put(bucket, key) {
      calls.push(`put ${bucket}/${key}`);
    },
    async r2Get() {},
    async r2Delete(bucket, key) {
      calls.push(`delete ${bucket}/${key}`);
    },
    async aiSearchJobsAvailable() {
      return false;
    },
    async aiSearchJobCreate() {},
  };
}

test('an apply stops at the last check: the run removes its uploads and never writes D1', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'legallas-pii-apply-'));
  try {
    const root = path.join(parent, 'Shared');
    await mkdir(root);
    await writeFile(path.join(root, 'clean.md'), 'clean notes');
    await writeFile(path.join(root, 'ack.md'), `Row ${VOIDED.join('-')}`);
    await writeFile(path.join(root, 'held.md'), `Employee ${VOIDED.join(' ')}`);
    const snapshot = await createSnapshot((await guardWalk(root, async () => null)).files, path.join(parent, 'cache'), 'run', clone);
    const plan = diffSync(snapshot.files, []);
    const ackSha = snapshot.files.find((f) => f.rel === 'ack.md')?.sha256 ?? '';
    const run = (acknowledged: string[]) => {
      const calls: string[] = [];
      const deps: ApplyDeps = {
        wrangler: fakeWrangler(calls),
        extractPdf: async () => [],
        readText: directTextPages,
        verifyOriginals: () => verifyOriginals(snapshot),
        workDir: snapshot.dir,
        cacheDir: path.join(parent, 'cache'),
        inboxDir: path.join(parent, 'inbox'),
        now: '2026-10-04T00:00:00.000Z',
        log: () => {},
        pii: { known: null, acknowledged: new Set(acknowledged) },
      };
      return { calls, done: applyPlan(plan, deps) };
    };
    const stopped = run([ackSha]);
    await assert.rejects(stopped.done, (error: Error) => error instanceof PiiInPart && !error.message.includes(VOIDED.join(' ')));
    const puts = stopped.calls.filter((call) => call.startsWith('put legallas-files/'));
    assert.equal(puts.length, 3);
    assert.deepEqual(stopped.calls.filter((call) => call.startsWith('delete legallas-files/')).sort(), puts.map((call) => call.replace('put', 'delete')).sort());
    assert.equal(stopped.calls.some((call) => call.startsWith('d1') || call.includes('legallas-index')), false);

    const allowed = run([ackSha, snapshot.files.find((f) => f.rel === 'held.md')?.sha256 ?? '']);
    await allowed.done;
    assert.equal(allowed.calls.filter((call) => call.startsWith('put legallas-index/')).length, 3, 'acknowledged, every document is indexed');
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('--check-index counts a refused document under "ssn" and carries on', async () => {
  const jobs: IndexJob[] = [
    { id: 'd1', kind: 'markdown', sha256: sha('a'), file: '/snap/a.md', name: 'a.md', staleParts: 0 },
    { id: 'd2', kind: 'markdown', sha256: sha('b'), file: '/snap/b.md', name: 'b.md', staleParts: 0 },
  ];
  const check = await checkIndex(jobs, {
    extractPdf: async () => [],
    readText: async (file) => [{ n: 1, text: file.endsWith('a.md') ? 'clean' : `held ${VOIDED.join('.')}`, ocr: false }],
  });
  assert.deepEqual(check.failed, { ssn: 1 });
  assert.equal(check.textDocs, 2);
  assert.equal(check.parts, 1);
});
