// SPDX-License-Identifier: Apache-2.0
// An ended sign-in: room fetches ask Access for a 401 instead of its login redirect, and a 401 shows one notice,
// "Your session ended. Reload to sign in.", with a link to this page and never an automatic reload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getJson } from './files-api.ts';
import { fetchMatter } from './doc-facts.ts';
import { settle, type LoadState } from './page-load.ts';
import { loadMe } from './room-me.ts';
import { isSessionEnded, ROOM_FETCH_HEADERS, SessionEndedError, showSessionEnded, type NoticeDoc } from './session-ended.ts';

/** A stand-in document: a <main> that records what is put at its top, and the notice once it is there. */
function fakeDoc(withMain = true) {
  const top: unknown[] = [];
  let notice: Record<string, unknown> | null = null;
  const node = (tag: string) => {
    const attrs = new Map<string, string>();
    const children: unknown[] = [];
    return {
      tag, className: '', textContent: null as string | null, attrs, children,
      setAttribute: (name: string, value: string) => attrs.set(name, value),
      append: (...nodes: unknown[]) => children.push(...nodes),
    };
  };
  const doc: NoticeDoc = {
    location: { href: 'https://room.example/documents/#from-counsel' },
    querySelector: (selector) => {
      if (selector === '[data-session-ended]') return notice as never;
      if (selector === 'main' && withMain) return { prepend: (n: unknown) => { top.unshift(n); notice = n as Record<string, unknown>; } };
      return null;
    },
    createElement: (tag) => node(tag),
    createTextNode: (text) => ({ text }),
  };
  return { doc, top };
}

test('the notice says the session ended, links to this page to sign in again, and is an alert', () => {
  const { doc, top } = fakeDoc();
  assert.equal(showSessionEnded(doc), true);
  assert.equal(top.length, 1);
  const notice = top[0] as ReturnType<ReturnType<typeof fakeDoc>['doc']['createElement']> & { attrs: Map<string, string>; children: unknown[] };
  assert.equal(notice.attrs.get('role'), 'alert');
  assert.ok(notice.attrs.has('data-session-ended'));
  const [text, link] = notice.children as [{ text: string }, { textContent: string; attrs: Map<string, string> }];
  assert.equal(`${text.text}${link.textContent}`, 'Your session ended. Reload to sign in.');
  assert.equal(link.attrs.get('href'), 'https://room.example/documents/#from-counsel', 'a link the reader follows, never an automatic reload');
});

test('the notice shows once however many requests answer 401, and only where there is a page', () => {
  const { doc, top } = fakeDoc();
  for (let i = 0; i < 4; i++) assert.equal(showSessionEnded(doc), true);
  assert.equal(top.length, 1);
  assert.equal(showSessionEnded(fakeDoc(false).doc), false, 'no <main>');
  assert.equal(showSessionEnded(undefined), false, 'no document (tests, the Worker)');
});

test('isSessionEnded knows the error, by class, by name, or as a cause', () => {
  assert.equal(isSessionEnded(new SessionEndedError('matter')), true);
  assert.equal(isSessionEnded(Object.assign(new Error('x'), { name: 'SessionEndedError' })), true, 'from another copy of the module');
  assert.equal(isSessionEnded(new Error('documents: the list did not load', { cause: new SessionEndedError() })), true);
  for (const other of [new Error('matter: 500'), new DOMException('timed out', 'TimeoutError'), null, undefined, 'x']) {
    assert.equal(isSessionEnded(other), false, String(other));
  }
});

test('the session module imports nothing at run time', () => {
  const source = readFileSync(join(import.meta.dirname, 'session-ended.ts'), 'utf8');
  assert.deepEqual(source.split('\n').filter((line) => /^\s*import\b/.test(line) || /\bimport\(/.test(line)), []);
});

/** Runs `body` with every fetch answering `status`, recording each request's headers. */
async function answering(status: number, body: (seen: Headers[]) => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  const seen: Headers[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Headers(init?.headers));
    return Response.json(status === 200 ? {} : { error: 'unauthorized' }, { status });
  }) as typeof fetch;
  try {
    await body(seen);
  } finally {
    globalThis.fetch = original;
  }
}

/** Runs `body` with a stand-in document (and window) in place, as the room's pages have. */
async function onPage(body: (top: unknown[]) => Promise<void>): Promise<void> {
  const g = globalThis as { document?: unknown; window?: unknown };
  const before = { document: g.document, window: g.window };
  const { doc, top } = fakeDoc();
  g.document = doc;
  g.window = {};
  try {
    await body(top);
  } finally {
    if (before.document === undefined) delete g.document;
    else g.document = before.document;
    if (before.window === undefined) delete g.window;
    else g.window = before.window;
  }
}

test('every room fetch asks for a 401 rather than the login redirect', async () => {
  assert.deepEqual({ ...ROOM_FETCH_HEADERS }, { 'X-Requested-With': 'XMLHttpRequest' });
  await onPage(async () => {
    await answering(200, async (seen) => {
      await fetchMatter();
      await getJson('/api/documents');
      await loadMe();
      assert.equal(seen.length, 3);
      for (const headers of seen) assert.equal(headers.get('X-Requested-With'), 'XMLHttpRequest');
    });
  });
});

test('a 401 from the matter, a room API or /api/me shows the notice; the matter also rejects as SessionEndedError', async () => {
  await onPage(async (top) => {
    await answering(401, async () => {
      await assert.rejects(fetchMatter(), (error) => isSessionEnded(error));
      assert.equal(top.length, 1);
    });
  });
  await onPage(async (top) => {
    await answering(401, async () => {
      assert.deepEqual(await getJson('/api/documents'), { ok: false, status: 401 }, 'still never throws');
      assert.equal(top.length, 1);
    });
  });
  await onPage(async (top) => {
    await answering(401, async () => {
      assert.equal(await loadMe(), null);
      assert.equal(top.length, 1);
    });
  });
  await onPage(async (top) => {
    await answering(403, async () => {
      await getJson('/api/comments');
      await assert.rejects(fetchMatter(), /matter: 403/);
      assert.equal(top.length, 0, 'a refusal is not an ended session');
    });
  });
});

test('settle ends on the error line and, for an ended session, shows the notice too: same API, same states', async () => {
  await onPage(async (top) => {
    const shown: LoadState[] = [];
    const heard: unknown[] = [];
    const state = await settle((s) => shown.push(s), async () => { throw new SessionEndedError('matter'); }, (e) => heard.push(e));
    assert.equal(state, 'error');
    assert.deepEqual(shown, ['error']);
    assert.equal(heard.length, 1);
    assert.equal(top.length, 1);
  });
  await onPage(async (top) => {
    assert.equal(await settle(() => undefined, async () => { throw new Error('matter: 500'); }), 'error');
    assert.equal(top.length, 0, 'any other failure: the error line alone');
  });
});
