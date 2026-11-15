// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  auditCounts, cachedPages, catalogEntries, citeCounts, listAiItems, listR2Keys, retrievalFiles, retrievedCounts, roomText, scanCaseFolder, toDocRow,
} from './coverage-sources.ts';
import type { RestGet } from './law/replica.ts';
import { CATALOG_COLUMNS } from './matter/catalog.ts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

async function temp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'legallas-coverage-'));
}

test('the case folder: root files listed, private files hashed without names, other folders unread, the room skipped', async () => {
  const root = await temp();
  try {
    const room = path.join(root, 'Room');
    await mkdir(path.join(room, 'sub'), { recursive: true });
    await mkdir(path.join(root, '_PRIVATE-Notes', 'deep'), { recursive: true });
    await mkdir(path.join(root, 'Other'), { recursive: true });
    await writeFile(path.join(room, 'sub', 'in-room.pdf'), 'room');
    await writeFile(path.join(root, 'loose.pdf'), 'loose');
    await writeFile(path.join(root, '.DS_Store'), 'x');
    await writeFile(path.join(root, '_PRIVATE-Notes', 'deep', 'secret-name.pdf'), 'room');
    await writeFile(path.join(root, 'Other', 'unread.pdf'), 'other');
    const scan = await scanCaseFolder(root, room);
    assert.deepEqual(scan.outside, [{ rel: 'loose.pdf', sha256: sha('loose') }]);
    assert.deepEqual([...scan.privateShas], [sha('room')]);
    assert.deepEqual([scan.privateFiles, scan.foldersNotRead, scan.unreadable], [1, 1, 0]);
    assert.ok(!JSON.stringify({ ...scan, privateShas: [...scan.privateShas] }).includes('secret-name'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('documents rows are read field by field; rows without an id, path or key are dropped', () => {
  const row = toDocRow({ id: 'a', path: 'x/y.pdf', name: 'y.pdf', sha256: 'f', size: 3, kind: 'pdf', pages: 2, r2_key: 'k', source: 'mirror', control_seq: 7, removed_at: null, uploaded_by: 'e' });
  assert.deepEqual(row, { id: 'a', path: 'x/y.pdf', name: 'y.pdf', sha256: 'f', size: 3, kind: 'pdf', pages: 2, r2_key: 'k', source: 'mirror', control_seq: 7, removed_at: null });
  assert.equal(toDocRow({ id: 'a', path: 'x' }), null);
  assert.deepEqual(auditCounts([{ document_id: 'a', action: 'view', n: 3 }, { document_id: 'a', action: 'download', n: 1 }, { document_id: null, action: 'ai_question', n: 9 }]), new Map([['a', { view: 3, download: 1 }]]));
});

test('R2 keys are listed page by page until the listing is not truncated', async () => {
  const calls: string[] = [];
  const get: RestGet = async (resource) => {
    calls.push(resource);
    return resource.includes('cursor=c1')
      ? { success: true, result: [{ key: 'k3' }], result_info: { is_truncated: false } }
      : { success: true, result: [{ key: 'k1' }, { key: 'k2' }], result_info: { is_truncated: true, cursor: 'c1' } };
  };
  assert.deepEqual(await listR2Keys(get, 'legallas-index'), ['k1', 'k2', 'k3']);
  assert.deepEqual(calls, ['r2/buckets/legallas-index/objects?per_page=1000', 'r2/buckets/legallas-index/objects?per_page=1000&cursor=c1']);
  await assert.rejects(listR2Keys(get, '../x'), /bad bucket/);
});

test('AI Search items are listed 50 to a page with their status and chunks', async () => {
  const page = (n: number, count: number) => Array.from({ length: count }, (_, i) => ({ key: `text/${n}-${i}.p1.md`, status: i === 0 ? 'error' : 'completed', chunks_count: 2 }));
  const get: RestGet = async (resource) => {
    const n = Number(/[?&]page=(\d+)/.exec(resource)![1]);
    return { success: true, result: n === 1 ? page(1, 50) : page(2, 3), result_info: { total_count: 53 } };
  };
  const items = await listAiItems(get, 'legallas');
  assert.equal(items.size, 53);
  assert.deepEqual(items.get('text/1-0.p1.md'), { status: 'error', chunks: 2 });
});

test('cached text is read as it is, with its version; direct kinds are read from the file', async () => {
  const dir = await temp();
  try {
    const key = sha('pdf');
    await mkdir(path.join(dir, 'text'));
    await writeFile(path.join(dir, 'text', `${key}.json`), JSON.stringify({ version: 2, sha256: key, pages: [{ n: 1, text: 'page one', ocr: true }] }));
    assert.deepEqual(await cachedPages(dir, key), { pages: [{ n: 1, text: 'page one', ocr: true }], version: 2 });
    assert.equal(await cachedPages(dir, sha('missing')), null);
    assert.equal(await cachedPages(dir, '../x'), null);
    await writeFile(path.join(dir, 'notes.md'), '# Notes');
    assert.deepEqual(await roomText({ rel: 'a/notes.md', abs: path.join(dir, 'notes.md'), sha256: sha('x') }, dir), { pages: [{ n: 1, text: '# Notes', ocr: false }], version: null });
    assert.equal(await roomText({ rel: 'a/bundle.zip', abs: '/nowhere', sha256: sha('x') }, dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('catalog entries carry md5, size, privilege and summary by documents.path', () => {
  const header = CATALOG_COLUMNS.join(',');
  const line = (p: string, size: string, md5: string, priv: string, summary: string) => [p, 'b', p.split('/').pop(), 'pdf', size, md5, '', priv, summary, '', '', ''].join(',');
  const csv = [header, line('A/one.pdf', '12', 'ABC', '', '"A summary, with a comma."'), line('A/two.pdf', '', 'def', 'PRIVILEGED', 'Two.'), line('', '1', 'x', '', 'skip')].join('\n');
  const entries = catalogEntries(csv, '/case/Room');
  assert.deepEqual(entries.get('A/one.pdf'), { md5: 'abc', size: 12, privileged: false, summary: 'A summary, with a comma.' });
  assert.deepEqual(entries.get('A/two.pdf'), { md5: 'def', size: null, privileged: true, summary: 'Two.' });
  assert.equal(entries.size, 2);
});

test('cites are counted wherever they sit in the case picture, except the docs map', () => {
  const matter = {
    events: [{ cites: [{ doc: 'a', page: 1 }, { doc: 'b', page: null }] }],
    tracks: [{ brief: { exhibits: [{ cite: { doc: 'a', page: 3, note: 'x' } }] } }],
    docs: { a: { doc: 'not-a-cite', page: 1 } },
  };
  assert.deepEqual(citeCounts(matter), new Map([['a', 2], ['b', 1]]));
  assert.deepEqual(citeCounts(null), new Map());
});

test('retrievals count each question once per document', async () => {
  const cache = { q1: { chunks: [{ docId: 'a' }, { docId: 'a' }, { docId: 'b' }] }, q2: { chunks: [{ docId: 'a' }] }, bad: { chunks: 'x' } };
  assert.deepEqual(retrievedCounts([cache, null]), new Map([['a', 2], ['b', 1]]));
  const dir = await temp();
  try {
    await mkdir(path.join(dir, 'ask-replica-main'));
    await mkdir(path.join(dir, 'ask-replica-empty'));
    await mkdir(path.join(dir, 'staging', 'T1', 'deep'), { recursive: true });
    await writeFile(path.join(dir, 'ask-replica-main', 'retrieval.json'), '{}');
    await writeFile(path.join(dir, 'staging', 'T1', 'deep', 'retrieval.json'), '{}');
    await writeFile(path.join(dir, 'staging', 'T1', 'other.json'), '{}');
    assert.deepEqual(await retrievalFiles(dir), [path.join(dir, 'ask-replica-main', 'retrieval.json'), path.join(dir, 'staging', 'T1', 'deep', 'retrieval.json')]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
