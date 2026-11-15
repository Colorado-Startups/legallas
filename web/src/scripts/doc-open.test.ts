// SPDX-License-Identifier: Apache-2.0
// The /doc/ page's first read: one /api/doc request (one `view` audit row) however many scripts ask, and the PDF viewer
// started beside it for a cite. Invented fixture ids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docIdIn, docMeta, startDocPage } from './doc-open.ts';
import type { DocMeta, Loaded } from './files-api.ts';

function recorder(viewer: DocMeta['viewer'] = 'pdf') {
  const urls: string[] = [];
  const get = (url: string): Promise<Loaded<DocMeta>> => {
    urls.push(url);
    return Promise.resolve({ ok: true, value: { id: url.split('/').pop()!, viewer } as DocMeta }); // safe: url ends in the id
  };
  return { urls, get };
}

function warmth() {
  const calls: string[] = [];
  return { calls, pdf: { warm: () => calls.push('warm'), cool: () => calls.push('cool') } };
}

test('docIdIn reads ?id=, and nothing else', () => {
  assert.equal(docIdIn('?id=doe-001'), 'doe-001');
  assert.equal(docIdIn('?id='), null);
  assert.equal(docIdIn(''), null);
});

test('the page asks /api/doc once per document, however many scripts call', async () => {
  const { urls, get } = recorder();
  const first = docMeta('doe-open-1', get);
  assert.equal(docMeta('doe-open-1', get), first);
  await first;
  await docMeta('doe-open-2', get);
  assert.deepEqual(urls, ['/api/doc/doe-open-1', '/api/doc/doe-open-2']);
});

test('no id: no request and no viewer', () => {
  const { urls, get } = recorder();
  const { calls, pdf } = warmth();
  startDocPage({ search: '', hash: '#page=3' }, pdf, get);
  assert.deepEqual(urls, []);
  assert.deepEqual(calls, []);
});

test('a cite into a PDF starts the viewer beside the request; a plain link does not', async () => {
  const cite = recorder();
  const a = warmth();
  startDocPage({ search: '?id=doe-cite', hash: '#page=3' }, a.pdf, cite.get);
  assert.deepEqual(cite.urls, ['/api/doc/doe-cite']);
  assert.deepEqual(a.calls, ['warm'], 'warmed before the answer');
  await docMeta('doe-cite');
  assert.deepEqual(a.calls, ['warm'], 'a PDF keeps its worker');

  const plain = recorder();
  const b = warmth();
  startDocPage({ search: '?id=doe-plain', hash: '' }, b.pdf, plain.get);
  assert.deepEqual(plain.urls, ['/api/doc/doe-plain']);
  assert.deepEqual(b.calls, []);
});

test('a cite into a text file stops the worker once the answer says so', async () => {
  const { get } = recorder('markdown');
  const { calls, pdf } = warmth();
  startDocPage({ search: '?id=doe-note', hash: '#page=1&q=terms' }, pdf, get);
  await docMeta('doe-note');
  await Promise.resolve();
  assert.deepEqual(calls, ['warm', 'cool']);
});
