// SPDX-License-Identifier: Apache-2.0
// Card P1a: the Overview news model (visit record, new documents, uploads, Key documents, discussions, titles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FolderNode } from './files-api.ts';
import {
  applyKey, FIRST_VISIT_DAYS, flattenTree, keyDocuments, localDay, newDocuments, newsCutoff,
  newUploads, nextVisit, openThreads, lastActivity, pagesText, parseVisit, VISIT_GAP_MS, type CounselUpload, type FeedComment, type NewsDoc,
} from './overview-news-model.ts';

const doc = (id: string, over: Partial<NewsDoc> = {}): NewsDoc => ({
  id, name: `${id}.pdf`, kind: 'pdf', pages: 3, updated_at: '2026-09-01T00:00:00.000Z', source: 'mirror',
  control_seq: null, key_at: null, ...over,
});

const comment = (id: string, document_id: string, created_at: string, over: Partial<FeedComment> = {}): FeedComment => ({
  id, document_id, document_name: `${document_id}.pdf`, control_seq: 7, author_name: 'Ann Smith', created_at,
  resolved_at: null, excerpt: 'A note.', ...over,
});

test('parseVisit accepts only a well-formed record', () => {
  const seen = '2026-09-24T10:00:00.000Z';
  assert.deepEqual(parseVisit(JSON.stringify({ since: null, seen })), { since: null, seen });
  assert.deepEqual(parseVisit(JSON.stringify({ since: '2026-09-01T00:00:00Z', seen })), { since: '2026-09-01T00:00:00Z', seen });
  assert.deepEqual(parseVisit(JSON.stringify({ since: 'yesterday', seen })), { since: null, seen }, 'a bad since is dropped');
  for (const bad of [null, '', '{', '[]', '"x"', JSON.stringify({ seen: 'soon' }), JSON.stringify({ since: seen })]) {
    assert.equal(parseVisit(bad), null, String(bad));
  }
});

test('nextVisit keeps a visit across reloads and starts a new one after the gap', () => {
  const t0 = new Date('2026-09-24T10:00:00.000Z');
  const first = nextVisit(null, t0);
  assert.deepEqual(first, { since: null, seen: t0.toISOString() });

  const reload = new Date(t0.getTime() + VISIT_GAP_MS - 1);
  assert.deepEqual(nextVisit(first, reload), { since: null, seen: reload.toISOString() }, 'same visit');

  const later = new Date('2026-09-30T08:00:00.000Z');
  const second = nextVisit({ since: null, seen: reload.toISOString() }, later);
  assert.deepEqual(second, { since: reload.toISOString(), seen: later.toISOString() }, 'new visit from the last seen');

  const skewed = nextVisit({ since: null, seen: '2027-01-01T00:00:00.000Z' }, later);
  assert.equal(skewed.since, '2027-01-01T00:00:00.000Z', 'a future seen (clock change) still starts a new visit');
});

test('newsCutoff falls back to FIRST_VISIT_DAYS on a first visit', () => {
  const now = new Date('2026-10-01T00:00:00.000Z');
  assert.equal(newsCutoff({ since: '2026-09-24T00:00:00.000Z', seen: now.toISOString() }, now), '2026-09-24T00:00:00.000Z');
  const back = new Date(now.getTime() - FIRST_VISIT_DAYS * 86_400_000).toISOString();
  assert.equal(newsCutoff({ since: null, seen: now.toISOString() }, now), back);
});

test('flattenTree walks every folder and skips guides', () => {
  const guide = doc('guide', { name: 'CLAUDE.md' });
  const tree = {
    path: '', name: '', guide, count: 3, size: 0, files: [doc('a')],
    folders: [{ path: 'x', name: 'x', guide, count: 2, size: 0, files: [doc('b')], folders: [
      { path: 'x/y', name: 'y', guide: null, count: 1, size: 0, files: [doc('c')], folders: [] },
    ] }],
  } as unknown as FolderNode;
  assert.deepEqual(flattenTree(tree).map((d) => d.id), ['a', 'b', 'c']);
});

test('newDocuments lists mirrored files after the cutoff, newest first', () => {
  const docs = [
    doc('old', { updated_at: '2026-09-01T00:00:00.000Z' }),
    doc('mid', { updated_at: '2026-09-25T00:00:00.000Z' }),
    doc('new', { updated_at: '2026-09-28T00:00:00.000Z' }),
    doc('counsel', { updated_at: '2026-09-29T00:00:00.000Z', source: 'counsel' }),
  ];
  assert.deepEqual(newDocuments(docs, '2026-09-24T00:00:00.000Z').map((d) => d.id), ['new', 'mid']);
  assert.deepEqual(newDocuments(docs, '2026-09-30T00:00:00.000Z'), []);
});

test('newUploads lists counsel uploads after the cutoff, newest first', () => {
  const up = (id: string, uploaded_at: string): CounselUpload => ({
    id, name: `${id}.pdf`, kind: 'pdf', size: 1, uploaded_at, uploaded_by: null, uploader_name: null, pulled: false,
  });
  const uploads = [up('a', '2026-09-20T00:00:00.000Z'), up('b', '2026-09-27T00:00:00.000Z'), up('c', '2026-09-26T00:00:00.000Z')];
  assert.deepEqual(newUploads(uploads, '2026-09-24T00:00:00.000Z').map((u) => u.id), ['b', 'c']);
});

test('keyDocuments keeps Key files in control-number order, unnumbered last', () => {
  const docs = [
    doc('plain', { control_seq: 1 }),
    doc('k3', { control_seq: 30, key_at: '2026-09-01T00:00:00.000Z' }),
    doc('k1', { control_seq: 10, key_at: '2026-09-02T00:00:00.000Z' }),
    doc('kx', { control_seq: null, key_at: '2026-09-03T00:00:00.000Z' }),
  ];
  assert.deepEqual(keyDocuments(docs).map((d) => d.id), ['k1', 'k3', 'kx']);
});

test('openThreads keeps unresolved top-level comments, newest first', () => {
  const feed = [
    comment('c2', 'd1', '2026-09-27T00:00:00.000Z', { page: 4 }),
    comment('c4', 'd2', '2026-09-29T00:00:00.000Z', { parent_id: null }),
    comment('c3', 'd1', '2026-09-28T00:00:00.000Z', { parent_id: 'c2' }),
    comment('c1', 'd3', '2026-09-26T00:00:00.000Z', { resolved_at: '2026-09-27T00:00:00.000Z' }),
  ];
  assert.deepEqual(openThreads(feed).map((c) => c.id), ['c4', 'c2'], 'a reply and a resolved thread are left out');
  assert.equal(openThreads(feed)[1]!.page, 4);
});

test('openThreads orders by last activity, so a new reply lifts an older thread', () => {
  const feed = [
    comment('newer', 'd1', '2026-09-28T00:00:00.000Z'),
    comment('older', 'd2', '2026-09-20T00:00:00.000Z', { last_activity_at: '2026-09-29T00:00:00.000Z', reply_count: 2 }),
  ];
  assert.deepEqual(openThreads(feed).map((c) => c.id), ['older', 'newer']);
  assert.equal(lastActivity(feed[0]!), '2026-09-28T00:00:00.000Z', 'falls back to created_at');
});

test('pagesText and localDay', () => {
  assert.equal(pagesText(214), '214 pp.');
  assert.equal(pagesText(1), '1 p.');
  for (const none of [null, undefined, 0, 2.5]) assert.equal(pagesText(none), '', String(none));
  assert.match(localDay('2026-09-24T12:00:00.000Z'), /^2026-09-2[345]$/);
  assert.equal(localDay('nope'), '');
});

test('applyKey marks or clears Key on a listed document and ignores anything else', () => {
  const docs = [doc('a', { control_seq: 1 }), doc('b', { control_seq: 2, key_at: '2026-09-01T00:00:00.000Z' })];
  assert.equal(applyKey(docs, { id: 'a', key: true, key_at: '2026-10-01T00:00:00.000Z', key_by: 'x@example.test' }), true);
  assert.equal(applyKey(docs, { id: 'b', key: false, key_at: null, key_by: null }), true);
  assert.deepEqual(keyDocuments(docs).map((d) => d.id), ['a']);
  for (const bad of [null, undefined, 'a', { id: 'zzz', key_at: null }, { id: 'a' }, { id: 'a', key_at: 5 }]) {
    assert.equal(applyKey(docs, bad), false, JSON.stringify(bad));
  }
});
