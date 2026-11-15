// SPDX-License-Identifier: Apache-2.0
// The renderer without Chrome: a fake DevTools session stands in, so the network rule (only the page itself is
// served, every other request fails), the CSP, the screenshot limits and the cache handling are pinned in plain Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withSecurityHeaders } from '../worker/headers.ts';
import { pngSize, VISUAL_PNG_MAX_PIXELS } from '../worker/visuals.ts';
import type { CdpEvent, VisualBrowser } from './visual-chrome.ts';
import { readVisualEntry, writeVisualEntry } from './visual-ai.ts';
import { answerRequest, htmlFiles, navigate, openRenderer, renderVisualTexts, RENDER_ORIGIN, shotScales, VISUAL_RENDER_CSP, type Renderer } from './visual-render.ts';
import type { WalkedVisual } from './visual-dom.ts';

const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** A PNG's signature and IHDR width and height, enough for pngSize. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

test('pages render under the same CSP the room serves visuals with', async () => {
  const served = withSecurityHeaders(new Response('x'), 'visual').headers.get('Content-Security-Policy');
  assert.equal(VISUAL_RENDER_CSP, served);
});

test('only the page itself is answered; every other request is refused', () => {
  const page = { url: `${RENDER_ORIGIN}/page-1.html`, body: 'PGh0bWw+' };
  const ok = answerRequest(page.url, page, 'r1');
  assert.equal(ok.method, 'Fetch.fulfillRequest');
  assert.deepEqual((ok.params.responseHeaders as { name: string; value: string }[]).find((h) => h.name === 'Content-Security-Policy')?.value, VISUAL_RENDER_CSP);
  for (const url of ['https://fonts.example.com/a.css', `${RENDER_ORIGIN}/page-2.html`, `${RENDER_ORIGIN}/page-1.html?x`, 'http://127.0.0.1:8787/api/documents']) {
    assert.deepEqual(answerRequest(url, page, 'r2'), { method: 'Fetch.failRequest', params: { requestId: 'r2', errorReason: 'BlockedByClient' } }, url);
  }
  assert.equal(answerRequest(page.url, null, 'r3').method, 'Fetch.failRequest', 'nothing is served between pages');
});

test('screenshots stay within one megapixel, smaller scales follow, and pngSize reads the header', () => {
  for (const [width, height] of [[1280, 900], [1280, 12_000], [400, 300]] as const) {
    const scales = shotScales(width, height);
    assert.ok(scales.length > 0);
    assert.ok(scales.every((scale, i) => scale <= 1 && (i === 0 || scale < scales[i - 1]!)));
    assert.ok(Math.round(width * scales[0]!) * Math.round(height * scales[0]!) <= VISUAL_PNG_MAX_PIXELS, `${width}x${height}`);
  }
  assert.deepEqual(shotScales(400, 300)[0], 1, 'a small page is shot at full size');
  assert.deepEqual(pngSize(pngHeader(640, 480)), { width: 640, height: 480 });
  assert.equal(pngSize(new Uint8Array([1, 2, 3])), null);
});

interface FakeOptions {
  /** Always this screenshot, instead of one the size of the clip. */
  shot?: Uint8Array;
  /** What location.href says after loading, instead of the page's own URL (a Chrome error page). */
  href?: string;
  /** How Page.navigate answers: normally, with an errorText, or by throwing. */
  navigate?: 'ok' | 'errorText' | 'throws';
}

/**
 * A DevTools session that loads the page, lets it request a remote font, and walks to `walked` in the isolated world it
 * hands out (context 7). Screenshots are the size the clip asks for unless `shot` is given.
 */
function fakeBrowser(walked: WalkedVisual, options: FakeOptions = {}) {
  const sent: { method: string; params: Record<string, unknown> }[] = [];
  const listeners = new Set<(event: CdpEvent) => void>();
  const emit = (method: string, params: Record<string, unknown>) => queueMicrotask(() => listeners.forEach((l) => l({ method, params, sessionId: 's1' })));
  let closed = false;
  let url = '';
  const cdp = {
    on(listener: (event: CdpEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async send(method: string, params: Record<string, unknown> = {}) {
      sent.push({ method, params });
      if (method === 'Page.navigate') {
        if (options.navigate === 'throws') throw new Error('Cannot navigate to invalid URL');
        if (options.navigate === 'errorText') return { frameId: 'f1', errorText: 'net::ERR_BLOCKED_BY_CLIENT' };
        url = String(params.url);
        emit('Fetch.requestPaused', { requestId: 'main', request: { url: params.url } });
        emit('Fetch.requestPaused', { requestId: 'font', request: { url: 'https://fonts.example.com/serif.woff2' } });
        emit('Page.loadEventFired', {});
      }
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'f1' } } };
      if (method === 'Page.createIsolatedWorld') return { executionContextId: 7 };
      if (method === 'Runtime.evaluate') {
        const expression = String(params.expression);
        if (expression === 'location.href') return { result: { value: options.href ?? url } };
        return { result: { value: expression.includes('walkVisual') ? walked : true } };
      }
      if (method === 'Page.getLayoutMetrics') return { cssContentSize: { width: 1280, height: 2000 } };
      if (method === 'Page.captureScreenshot') {
        const clip = params.clip as { width: number; height: number; scale: number };
        const png = options.shot ?? pngHeader(Math.round(clip.width * clip.scale), Math.round(clip.height * clip.scale));
        return { data: Buffer.from(png).toString('base64') };
      }
      return {};
    },
  };
  const browser: VisualBrowser = { cdp: cdp as VisualBrowser['cdp'], session: 's1', close: async () => void (closed = true) };
  return { browser, sent, closed: () => closed };
}

test('a render serves the page, refuses the rest, walks the drawn page and takes a PNG within the limits', async () => {
  const walked: WalkedVisual = { title: 'Doe deliveries', blocks: [{ t: 'h', level: 1, text: 'Doe deliveries' }] };
  const fake = fakeBrowser(walked);
  const renderer = await openRenderer(async () => fake.browser);
  const out = await renderer.render(new TextEncoder().encode('<h1>Doe deliveries</h1>'), { png: true });
  await renderer.close();
  assert.deepEqual(out.walked, walked);
  const size = pngSize(out.png!);
  assert.ok(size && size.width * size.height <= VISUAL_PNG_MAX_PIXELS && size.width >= 700, JSON.stringify(size));
  const methods = fake.sent.map((call) => call.method);
  assert.ok(methods.indexOf('Fetch.enable') < methods.indexOf('Page.navigate'), 'requests are intercepted before the page loads');
  const fulfilled = fake.sent.filter((call) => call.method === 'Fetch.fulfillRequest').map((call) => call.params.requestId);
  const failed = fake.sent.filter((call) => call.method === 'Fetch.failRequest').map((call) => call.params.requestId);
  assert.deepEqual([fulfilled, failed], [['main'], ['font']]);
  const evaluations = fake.sent.filter((call) => call.method === 'Runtime.evaluate');
  assert.ok(evaluations.length >= 3 && evaluations.every((call) => call.params.contextId === 7), 'every walk step runs in the isolated world');
  assert.equal(fake.closed(), true);

  const tooBig = fakeBrowser(walked, { shot: pngHeader(1280, 2000) });
  const second = await openRenderer(async () => tooBig.browser);
  assert.equal((await second.render(new Uint8Array([60]), { png: true })).png, null, 'over a megapixel at every scale: no PNG');
});

test('a failed navigation or a Chrome error page is never walked, and leaves no waiter behind', async () => {
  const walked: WalkedVisual = { title: '', blocks: [{ t: 'p', text: 'This site cannot be reached' }] };
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    for (const [options, message] of [
      [{ navigate: 'throws' }, /Cannot navigate/],
      [{ navigate: 'errorText' }, /navigation failed: net::ERR_BLOCKED_BY_CLIENT/],
      [{ href: 'chrome-error://chromewebdata/' }, /the page did not load/],
    ] as const) {
      const fake = fakeBrowser(walked, options);
      const renderer = await openRenderer(async () => fake.browser);
      await assert.rejects(renderer.render(new TextEncoder().encode('<p>Doe</p>'), { png: true }), message);
      assert.ok(!fake.sent.some((call) => String(call.params.expression ?? '').includes('walkVisual')), 'never walked');
      assert.ok(!fake.sent.some((call) => call.method === 'Page.captureScreenshot'), 'never shot');
    }
    const lone = fakeBrowser(walked, { navigate: 'throws' });
    await assert.rejects(navigate(lone.browser.cdp, 's1', 'https://visual.invalid/x.html'), /Cannot navigate/);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'legallas-visual-error-'));
  try {
    await writeFile(path.join(dir, 'a.html'), '<p>Doe A</p>');
    const fake = fakeBrowser(walked, { href: 'chrome-error://chromewebdata/' });
    const run = await renderVisualTexts(await htmlFiles(dir), path.join(dir, 'cache'), () => {}, () => openRenderer(async () => fake.browser));
    assert.deepEqual(run, { rendered: 0, cached: 0, failed: 1 });
    assert.equal(await readVisualEntry(path.join(dir, 'cache'), sha('<p>Doe A</p>')), null, 'an error page is never cached');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a run renders only pages with no cached text, one at a time, and logs paths and counts, never text', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'legallas-visual-render-'));
  try {
    const root = path.join(dir, 'Visuals');
    await mkdir(path.join(root, '.hidden'), { recursive: true });
    await writeFile(path.join(root, 'a.html'), '<p>Doe A</p>');
    await writeFile(path.join(root, 'b.htm'), '<p>Doe B</p>');
    await writeFile(path.join(root, 'c.html'), '<p>Doe C</p>');
    await writeFile(path.join(root, 'notes.md'), '# not a page');
    await writeFile(path.join(root, '.hidden', 'd.html'), '<p>hidden</p>');
    const pages = await htmlFiles(root);
    assert.deepEqual(pages.map((page) => page.rel), ['a.html', 'b.htm', 'c.html']);

    const cache = path.join(dir, 'cache');
    await writeVisualEntry(cache, sha('<p>Doe A</p>'), 'cached', null);
    const rendered: string[] = [];
    const renderer: Renderer = {
      async render(html) {
        const text = new TextDecoder().decode(html);
        rendered.push(text);
        if (text.includes('Doe C')) throw new Error('Page.loadEventFired timed out');
        return { walked: { title: '', blocks: [{ t: 'p', text: 'Secret Doe B text' }] }, png: null };
      },
      close: async () => undefined,
    };
    const log: string[] = [];
    const run = await renderVisualTexts(pages, cache, (line) => log.push(line), async () => renderer);
    assert.deepEqual(run, { rendered: 1, cached: 1, failed: 1 });
    assert.deepEqual(rendered, ['<p>Doe B</p>', '<p>Doe C</p>']);
    assert.equal((await readVisualEntry(cache, sha('<p>Doe B</p>')))?.text, 'Secret Doe B text');
    assert.ok(log.every((line) => !line.includes('Secret')), 'no page text in the log');
    assert.match(log.join('\n'), /c\.html: could not render \(Page\.loadEventFired timed out\)/);

    await assert.rejects(renderVisualTexts(pages, path.join(dir, 'empty-cache'), () => {}, async () => { throw new Error('Chrome is missing'); }), /Chrome is missing/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
