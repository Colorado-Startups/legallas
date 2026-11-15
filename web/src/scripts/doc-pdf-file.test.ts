// SPDX-License-Identifier: Apache-2.0
// Opening a PDF (#203): on a slow link every wait in a row costs a round trip, so the worker, the file and the library
// must come in beside each other. These tests run the small-file read, and read the viewer's source for the order of
// its loads, since the viewer itself needs a browser.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PREFETCH_MAX_BYTES, pdfWorkerSlot, prefetchPdf } from './doc-pdf-file.ts';

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');

type Call = { url: string; init?: RequestInit };

async function withFetch<T>(answer: (call: Call) => Response | Promise<Response>, run: (calls: Call[]) => Promise<T>): Promise<T> {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = real;
  }
}

test('a small PDF is read whole, same-origin, from /files/:id', async () => {
  await withFetch(() => new Response(new Uint8Array([37, 80, 68, 70])), async (calls) => {
    const bytes = await prefetchPdf('doc 1', 4096, new AbortController().signal);
    assert.deepEqual(bytes && [...bytes], [37, 80, 68, 70]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, '/files/doc%201');
    assert.equal(calls[0]!.init?.credentials, 'same-origin');
  });
});

test('a large or unknown size is left to PDF.js, which reads it in ranges', async () => {
  await withFetch(() => new Response('unused'), async (calls) => {
    for (const size of [PREFETCH_MAX_BYTES + 1, 0, -1, null, undefined, Number.NaN]) {
      assert.equal(await prefetchPdf('doc', size, new AbortController().signal), null, String(size));
    }
    assert.equal(calls.length, 0, 'nothing fetched');
  });
  await withFetch(() => new Response(new Uint8Array(1)), async (calls) => {
    assert.ok(await prefetchPdf('doc', PREFETCH_MAX_BYTES, new AbortController().signal), 'the limit itself is read');
    assert.equal(calls.length, 1);
  });
});

test('a failed read gives null and closes the body it will not read', async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel: () => { cancelled = true; } });
  await withFetch(() => new Response(body, { status: 404 }), async () => {
    assert.equal(await prefetchPdf('gone', 10, new AbortController().signal), null);
  });
  assert.ok(cancelled, 'the 404 body is cancelled, not left open');
  await withFetch(() => Promise.reject(new TypeError('offline')), async () => {
    assert.equal(await prefetchPdf('doc', 10, new AbortController().signal), null, 'a network error falls back to PDF.js');
  });
});

test('a stopped read gives null', async () => {
  const stop = new AbortController();
  await withFetch(({ init }) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')));
  }), async () => {
    const read = prefetchPdf('doc', 10, stop.signal);
    stop.abort();
    assert.equal(await read, null);
  });
});

class FakeWorker extends EventTarget {
  stopped = false;
  terminate(): void {
    this.stopped = true;
  }
}

/** A slot over fake workers, and every worker it made. */
function fakeSlot() {
  const made: FakeWorker[] = [];
  const slot = pdfWorkerSlot(() => {
    const worker = new FakeWorker();
    made.push(worker);
    return worker as unknown as Worker;
  });
  return { slot, made };
}

/** True when `promise` has settled by the end of this turn. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  return Promise.race([promise.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 0))]);
}

test('the page has one worker, made on first use', async () => {
  const { slot, made } = fakeSlot();
  assert.equal(slot.port(), slot.port());
  assert.equal(made.length, 1);
  assert.equal(await settled(slot.failed()), false);
});

test('a worker that fails to load settles failed and is not made again: PDF.js makes its own', async () => {
  const { slot, made } = fakeSlot();
  slot.port();
  made[0].dispatchEvent(new Event('error'));
  assert.equal(made[0].stopped, true);
  assert.equal(await settled(slot.failed()), true);
  assert.equal(slot.port(), null);
  assert.equal(made.length, 1);
});

test('a dropped worker settles what raced it, and the next PDF gets a new worker with a fresh failed', async () => {
  const { slot, made } = fakeSlot();
  slot.port();
  const raced = slot.failed();
  slot.drop();
  assert.equal(made[0].stopped, true);
  assert.equal(await settled(raced), true, 'a viewer racing the dropped worker opens the document without it');
  const next = slot.port();
  assert.equal(made.length, 2);
  assert.equal(next, made[1] as unknown as Worker);
  assert.equal(await settled(slot.failed()), false, 'the new worker has not failed');
  made[0].dispatchEvent(new Event('error'));
  assert.equal(slot.port(), next, 'the old worker cannot drop the new one');
});

test('the viewer loads pdf.js and its viewer as one static graph, the global first', () => {
  const viewer = source('doc-pdf.ts');
  assert.doesNotMatch(viewer, /await import\(['"]pdfjs-dist/, 'no library loaded only after another');
  const global = viewer.indexOf("from './pdfjs-global.ts'");
  const pages = viewer.indexOf("from 'pdfjs-dist/web/pdf_viewer.mjs'");
  assert.ok(global > 0 && pages > global, 'pdfjs-global.ts is imported just before pdf_viewer.mjs, which reads its global');
  assert.match(source('pdfjs-global.ts'), /globalThis as \{ pdfjsLib\?: unknown \}\)\.pdfjsLib = pdfjs;/);
  assert.match(viewer, /\.\.\.\(worker \? \{ worker \} : \{\}\)/, 'the shared worker is passed in, so no loading task owns it');
});

test('the /doc/ page and the exhibit pane start the worker and file before importing the viewer', () => {
  for (const name of ['doc-page.ts', 'exhibit-pane-view.ts'] as const) {
    const text = source(name);
    const started = text.indexOf('startPdf(doc.id, doc.size)');
    const imported = text.indexOf('await loadPdfViewer()');
    assert.ok(started > 0 && imported > started, `${name} starts the PDF before it waits for the library`);
    assert.match(text.slice(imported, imported + 400), /\bstart,/, `${name} hands the start to openPdf`);
  }
  const start = source('doc-pdf-start.ts');
  const loader = start.slice(start.indexOf('export function loadPdfViewer'));
  assert.match(start, /pdfWorkerSlot\(\(\) => new Worker\(workerUrl, \{ type: 'module' \}\)\)/, 'the page worker lives in the slot tested above');
  const worker = loader.indexOf('pdfWorkerPort()');
  assert.ok(worker > 0 && loader.indexOf("??= import('./doc-pdf.ts')") > worker, 'loadPdfViewer starts the worker before the library');
});

test('Ask loads the PDF viewer for its newest answer and a cite under the pointer or focus, never per saved cite', () => {
  const render = source('chat-render.ts');
  const inline = render.slice(render.indexOf('function inlineNodes'), render.indexOf('function blockNode'));
  assert.doesNotMatch(inline, /loadPdfViewer/, 'drawing a cite loads nothing');
  assert.match(inline, /link\.dataset\.pdf = ''/, 'a PDF cite is marked');
  const wire = render.slice(render.indexOf('export function wireCites'));
  assert.match(wire, /addEventListener\('focusin', warm\)/);
  assert.match(wire, /addEventListener\('pointerover', warm\)/);
  const history = source('chat.ts');
  const show = history.slice(history.indexOf('function showHistory'), history.indexOf('function showHistory') + 500);
  assert.equal(show.match(/warmPdfCites\(/g)?.length, 1, 'saved answers: only the newest warms the viewer');
  assert.match(show, /const newest = views\.at\(-1\);\s+if \(newest\) warmPdfCites\(newest\.root\);/);
  const drawer = source('chat-drawer.ts');
  const older = drawer.slice(drawer.indexOf('for (const turn of older)'), drawer.indexOf('d.earlier.hidden'));
  assert.doesNotMatch(older, /warmPdfCites/, 'the drawer\'s earlier answers warm nothing');
});
