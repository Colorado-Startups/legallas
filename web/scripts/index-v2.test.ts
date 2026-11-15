// SPDX-License-Identifier: Apache-2.0
// The index v2 staging build (scripts/index-v2.ts): what it skips, how it plans, and that an apply can only ever
// write the staging bucket. Fictional rows and a temporary folder only; nothing remote runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EXTRACTOR_VERSION } from './extract.ts';
import { applyV2, assertV2Key, buildV2, bulkPutArgs, controlOf, deleteArgs, holdsSsn, INDEX_V2_BUCKET, instanceState, parseV2Args, planV2, skipReason, type V2Row } from './index-v2.ts';
import type { KnownMatcher } from './pii.ts';
import { INDEX_BUCKET } from './wrangler.ts';

const SHA = 'a'.repeat(64);
const row = (over: Partial<V2Row> = {}): V2Row => ({
  id: '11111111-2222-4333-8444-555555555555',
  path: '08-Pleadings/Motion-to-Strike__20130226__Tally-Payroll.pdf',
  folder: '08-Pleadings',
  name: 'Motion-to-Strike__20130226__Tally-Payroll.pdf',
  kind: 'pdf',
  sha256: SHA,
  control_seq: 412,
  ...over,
});

test('the same documents as sync: agent files, room data, unindexed kinds and privileged office files are left out', () => {
  assert.equal(skipReason(row()), null);
  assert.equal(skipReason(row({ path: '08-Pleadings/CLAUDE.md', name: 'CLAUDE.md', kind: 'markdown' })), 'agent file');
  assert.equal(skipReason(row({ path: 'legallas-binder.json', name: 'legallas-binder.json', kind: 'file' })), 'room data file');
  // Decision D8: a visual is indexed from its rendered text.
  assert.equal(skipReason(row({ path: 'Visuals/map.html', name: 'map.html', kind: 'visual' })), null);
  assert.equal(skipReason(row({ path: 'Visuals/deck.zip', name: 'deck.zip', kind: 'file' })), 'not indexed (kind)');
  assert.equal(skipReason(row({ path: '07-Lawyer-Notes-PRIVILEGED/Memo__2011__Dee.docx', name: 'Memo__2011__Dee.docx', kind: 'file' })), 'privileged office file');
  assert.equal(skipReason(row({ path: 'Drafts/consent.docx', name: 'consent.docx', kind: 'file' })), 'saved draft');
  assert.equal(controlOf('DOE', 412), 'DOE-000412');
  assert.equal(controlOf('DOE', null), null);
});

test('the plan is sorted and fingerprinted, and names the staging bucket', () => {
  const built = { 'text/b.p1.md': '2', 'text/a.p1.md': '1' };
  const plan = planV2(built, { 'text/a.p1.md': '1', 'text/gone.p1.md': '9' });
  assert.deepEqual(plan.put, ['text/b.p1.md']);
  assert.deepEqual(plan.remove, ['text/gone.p1.md']);
  assert.equal(plan.unchanged, 1);
  assert.match(plan.fingerprint, /^[0-9a-f]{12}$/);
  assert.equal(planV2({ 'text/a.p1.md': '1', 'text/b.p1.md': '2' }, { 'text/gone.p1.md': '9', 'text/a.p1.md': '1' }).fingerprint, plan.fingerprint);
  assert.notEqual(planV2({ ...built, 'text/b.p1.md': '3' }, {}).fingerprint, planV2(built, {}).fingerprint);
});

test('an apply writes only v2 part keys, only to legallas-index-v2, and needs the reviewed fingerprint', () => {
  assert.equal(INDEX_V2_BUCKET, 'legallas-index-v2');
  assert.notEqual(INDEX_V2_BUCKET, INDEX_BUCKET);
  assert.deepEqual(bulkPutArgs('/tmp/list.json').slice(0, 4), ['r2', 'bulk', 'put', 'legallas-index-v2']);
  assert.ok(bulkPutArgs('/tmp/list.json').includes('--remote'));
  assert.deepEqual(deleteArgs('text/abc.p2.md'), ['r2', 'object', 'delete', 'legallas-index-v2/text/abc.p2.md', '--remote']);
  for (const bad of ['meta/matter.json', 'text/../x.p1.md', 'text/Roe Menu.p1.md', 'catalog.json']) assert.throws(() => assertV2Key(bad));
  assert.throws(() => parseV2Args(['--apply']), /--expect/);
  assert.throws(() => parseV2Args(['--apply', '--expect', 'nothex']));
  assert.deepEqual(parseV2Args(['--apply', '--expect', 'b4919bda9738']), { apply: true, expect: 'b4919bda9738', out: null });
});

test('build reads cached extractor text and mirrored files, then apply uploads in batches and indexes once', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'legallas-v2-test-'));
  try {
    const cacheDir = path.join(dir, 'cache');
    const sourceRoot = path.join(dir, 'source');
    await mkdir(path.join(cacheDir, 'text'), { recursive: true });
    await mkdir(path.join(sourceRoot, '10-Analysis'), { recursive: true });
    const pages = [{ n: 1, text: 'The fictional motion, page one.', ocr: false }, { n: 2, text: 'Page two.', ocr: true }];
    await writeFile(path.join(cacheDir, 'text', `${SHA}.json`), JSON.stringify({ version: EXTRACTOR_VERSION, sha256: SHA, pages }));
    await writeFile(path.join(sourceRoot, '10-Analysis', 'Notes__2011__Moe.md'), 'Fictional notes.');
    const rows = [
      row(),
      row({ id: 'doc-md', path: '10-Analysis/Notes__2011__Moe.md', folder: '10-Analysis', name: 'Notes__2011__Moe.md', kind: 'markdown', sha256: null, control_seq: 7 }),
      row({ id: 'doc-uncached', sha256: 'b'.repeat(64), control_seq: 8 }),
      row({ id: 'doc-agent', path: 'CLAUDE.md', folder: '', name: 'CLAUDE.md', kind: 'markdown', control_seq: 9 }),
    ];
    const out = path.join(dir, 'out');
    const build = await buildV2(rows, { cacheDir, sourceRoot }, 'DOE', out, () => {});
    assert.equal(build.documents, 2);
    assert.deepEqual(build.skipped, { 'no cached text': 1, 'agent file': 1 });
    assert.deepEqual(Object.keys(build.built).sort(), ['text/11111111-2222-4333-8444-555555555555.p1.md', 'text/11111111-2222-4333-8444-555555555555.p2.md', 'text/doc-md.p1.md']);
    const body = await readFile(path.join(out, 'parts', 'text', 'doc-md.p1.md'), 'utf8');
    assert.match(body, /^DOE-000007 \| Notes, Moe \| 2011 \| notes \| analysis \| 10-Analysis\n\[\[doc:doc-md p:1\]\]\nFictional notes\.\n$/);

    const calls: string[][] = [];
    const plan = planV2(build.built, {});
    await applyV2(out, plan, build.built, async (args) => (calls.push(args), ''), () => {});
    assert.equal(calls.length, 2, 'one bulk put for three parts, then one indexing job');
    assert.deepEqual(calls[1], ['ai-search', 'jobs', 'create', 'legallas-v2']);
    const uploaded = JSON.parse(await readFile(path.join(out, 'state', 'uploaded.json'), 'utf8')) as Record<string, string>;
    assert.deepEqual(uploaded, build.built);
    assert.equal(planV2(build.built, uploaded).put.length, 0, 'a second apply has nothing to do');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a document holding a number in Social Security form is refused: no part of it is written', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'legallas-v2-ssn-'));
  try {
    const cacheDir = path.join(dir, 'cache');
    const sourceRoot = path.join(dir, 'source');
    await mkdir(path.join(cacheDir, 'text'), { recursive: true });
    await mkdir(path.join(sourceRoot, '03-Kitchen-Records'), { recursive: true });
    // Fictional, joined at run time so no such literal sits in the source.
    const number = ['123', '45', '6789'].join('-');
    const pages = [{ n: 1, text: 'Clean first page.', ocr: false }, { n: 2, text: `Taxpayer number ${number}.`, ocr: false }];
    await writeFile(path.join(cacheDir, 'text', `${SHA}.json`), JSON.stringify({ version: EXTRACTOR_VERSION, sha256: SHA, pages }));
    await writeFile(path.join(sourceRoot, '03-Kitchen-Records', 'Note__2011__Moe.md'), `EIN ${['12', '3456789'].join('-')} only.`);
    const rows = [row(), row({ id: 'doc-ein', path: '03-Kitchen-Records/Note__2011__Moe.md', folder: '03-Kitchen-Records', name: 'Note__2011__Moe.md', kind: 'markdown', sha256: null, control_seq: 9 })];
    const out = path.join(dir, 'out');
    const build = await buildV2(rows, { cacheDir, sourceRoot }, 'DOE', out, () => {});
    assert.deepEqual(build.refused, ['DOE-000412']);
    assert.deepEqual(Object.keys(build.built), ['text/doc-ein.p1.md'], 'the refused document has no part, not even its clean page');
    assert.deepEqual(build.scan, { dashed: 0, spaced: 0, plain: 0 });
    const files = await readFile(path.join(out, 'parts', 'text', 'doc-ein.p1.md'), 'utf8');
    assert.equal(files.includes(number), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the last check is the sync's detector plus the builder's own rule: every printed form, and known hashes", async () => {
  // Fictional digits, joined at run time so no such literal sits in the source.
  const groups = ['123', '45', '6789'];
  const known: KnownMatcher = { matchesSync: (digits) => digits === groups.join(''), matches: async (digits) => digits === groups.join('') };
  assert.equal(holdsSsn(`a ${groups.join('-')} b`), true);
  assert.equal(holdsSsn(`a ${groups.join(' ')} b`), true, 'spaced (pii.ts ssn-form)');
  assert.equal(holdsSsn(`a ${groups.join('.')} b`), true, 'dotted (pii.ts ssn-form)');
  assert.equal(holdsSsn(`an ITIN area ${['912', '45', '6789'].join('-')}`), true, 'the builder also counts areas 900 to 999');
  assert.equal(holdsSsn(`EIN ${['12', '3456789'].join('-')}`), false, 'an EIN alone is fine');
  assert.equal(holdsSsn(`EIN-grouped ${['12', '3456789'].join('-')}`, { ...known, matchesSync: (digits) => digits === '123456789' }), true, 'unless its digits are a known SSN');
  assert.equal(holdsSsn('nothing here'), false);

  const dir = await mkdtemp(path.join(os.tmpdir(), 'legallas-v2-known-'));
  try {
    const cacheDir = path.join(dir, 'cache');
    await mkdir(path.join(cacheDir, 'text'), { recursive: true });
    const pages = [{ n: 1, text: `Box: ${groups.join('')}`, ocr: false }];
    await writeFile(path.join(cacheDir, 'text', `${SHA}.json`), JSON.stringify({ version: EXTRACTOR_VERSION, sha256: SHA, pages }));
    const out = path.join(dir, 'out');
    const plain = await buildV2([row()], { cacheDir, sourceRoot: dir }, 'DOE', out, () => {});
    assert.deepEqual(plain.refused, [], 'nine plain digits are not a printed SSN');
    const checked = await buildV2([row()], { cacheDir, sourceRoot: dir }, 'DOE', out, () => {}, known);
    assert.deepEqual(checked.refused, ['DOE-000412'], 'but a known one is refused');
    assert.deepEqual(Object.keys(checked.built), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the staging instance reads paused from wrangler ai-search get, so --apply refuses while it is', () => {
  assert.deepEqual(instanceState('Getting...\n{"id":"legallas-v2","paused":true,"status":"paused_user"}'), { paused: true, status: 'paused_user' });
  assert.deepEqual(instanceState('{"result":{"paused":false,"status":"waiting"}}'), { paused: false, status: 'waiting' });
  assert.equal(instanceState('{"paused":false,"status":"paused_inactive"}').paused, true, "Cloudflare's own pause after 31 idle days counts too");
});
