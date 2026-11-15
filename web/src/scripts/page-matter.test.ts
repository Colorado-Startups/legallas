// SPDX-License-Identifier: Apache-2.0
// #274: a page's scripts share one GET /api/matter, and a body nothing reads is closed instead of left open.
// pageMatter keeps its answer for the module's life, as a page does, so the tests run in order in one file.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fetchMatter, pageMatter } from './doc-facts.ts';

type Answer = () => Response | Promise<Response>;

async function withFetch<T>(answer: Answer, run: (calls: string[]) => Promise<T>): Promise<T> {
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return answer();
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = real;
  }
}

function watchedBody(text: string): { body: ReadableStream<Uint8Array>; cancelled: () => boolean } {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start: (controller) => controller.enqueue(new TextEncoder().encode(text)),
    cancel: () => {
      cancelled = true;
    },
  });
  return { body, cancelled: () => cancelled };
}

test('a 404 or an error answer closes the body fetchMatter will not read', async () => {
  const missing = watchedBody('{"error":"not_built"}');
  await withFetch(() => new Response(missing.body, { status: 404 }), async () => {
    assert.equal(await fetchMatter(), null);
  });
  assert.ok(missing.cancelled(), 'a 404 leaves nothing open');
  const broken = watchedBody('{"error":"bad_matter"}');
  await withFetch(() => new Response(broken.body, { status: 500 }), async () => {
    await assert.rejects(fetchMatter(), /matter: 500/);
  });
  assert.ok(broken.cancelled(), 'nor does an error answer');
});

test('a failed request is forgotten, so a later script may try again', async () => {
  await withFetch(() => new Response(null, { status: 503 }), async (calls) => {
    await assert.rejects(pageMatter(), /matter: 503/);
    await assert.rejects(pageMatter(), /matter: 503/);
    assert.equal(calls.length, 2);
  });
});

test('every script on the page shares one request and one answer', async () => {
  const matter = { version: 1, docs: {}, people: [], orgs: [], events: [] };
  await withFetch(() => Response.json(matter), async (calls) => {
    const answers = await Promise.all([pageMatter(), pageMatter(), pageMatter()]);
    assert.deepEqual(answers[0], matter);
    assert.ok(answers.every((answer) => answer === answers[0]), 'the same object');
    assert.equal(await pageMatter(), answers[0], 'a script that asks later gets it too');
    assert.deepEqual(calls, ['/api/matter'], 'one GET /api/matter');
  });
});

test('the room pages draw from pageMatter, not a request of their own', () => {
  const pages = [
    'overview-news.ts', 'overview-case.ts', 'guide.ts', 'documents-table.ts', 'documents-intake-heat.ts', 'exhibit-pane.ts',
    'doc-page.ts', 'people.ts', 'claims.ts', 'track.ts', 'chronology.ts', 'brief/page.ts',
  ];
  for (const name of pages) {
    const text = readFileSync(new URL(name, import.meta.url), 'utf8');
    assert.match(text, /\bpageMatter\(\)/, name);
    assert.doesNotMatch(text, /\bfetchMatter\(/, `${name} sends its own GET /api/matter`);
  }
});
