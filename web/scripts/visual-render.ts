// SPDX-License-Identifier: Apache-2.0
// Renders visual pages in local headless Chrome (scripts/visual-chrome.ts) to read their text as drawn, one page at a time.
// Charts are drawn by the pages' own scripts (worker/visualprep.ts), so the markup alone misses their labels.
//
// Nothing leaves the Mac: Chrome runs over a pipe with name resolution and non-proxied UDP shut off (visual-chrome.ts),
// every request the page makes is paused by the Fetch domain, and only the page itself is answered, from memory;
// everything else fails as blocked. The page is served under the room's `visual` CSP (worker/headers.ts) with no
// network origin at all (`.invalid` never resolves). After the load event the page gets a short settle time for its
// scripts, then visual-dom.ts walks the DOM from an isolated world (the page's scripts cannot reach the built-ins it
// uses), only once the frame is confirmed to hold this page and not a Chrome error page. A PNG of at most one megapixel
// and VISUAL_PNG_MAX_BYTES is taken when one fits.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { sidePngFits, VISUAL_PNG_MAX_PIXELS } from '../worker/visuals.ts';
import { launchVisualChrome, type CdpClient, type VisualBrowser } from './visual-chrome.ts';
import { readVisualEntry, writeVisualEntry } from './visual-ai.ts';
import { formatVisualText, pageExpression, type WalkedVisual } from './visual-dom.ts';

/** Where pages are served inside the browser. A fresh path per page, so no cache ever answers. */
export const RENDER_ORIGIN = 'https://visual.invalid';
/** The room's `visual` CSP (worker/headers.ts); visual-render.test.ts keeps the two equal. */
export const VISUAL_RENDER_CSP = [
  'sandbox allow-scripts',
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "frame-ancestors 'self'",
].join('; ');

const VIEWPORT = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
const LOAD_TIMEOUT_MS = 20_000;
/** The settle wait: done once the DOM has been quiet this long, or at the cap (count-up animations). */
const QUIET_MS = 400;
const SETTLE_MAX_MS = 5_000;
/** Screenshots stop at this height (CSS pixels): a longer page is shot from the top. */
const MAX_SHOT_HEIGHT = 12_000;
const MAX_SHOT_WIDTH = 4_000;

/** How the page's request is answered: the page itself from memory, anything else refused. */
export function answerRequest(url: string, page: { url: string; body: string } | null, requestId: string): { method: string; params: Record<string, unknown> } {
  if (page && url === page.url) {
    const headers = [
      { name: 'Content-Type', value: 'text/html; charset=utf-8' },
      { name: 'Content-Security-Policy', value: VISUAL_RENDER_CSP },
      { name: 'Cache-Control', value: 'no-store' },
    ];
    return { method: 'Fetch.fulfillRequest', params: { requestId, responseCode: 200, responseHeaders: headers, body: page.body } };
  }
  return { method: 'Fetch.failRequest', params: { requestId, errorReason: 'BlockedByClient' } };
}

/** Screenshot scales to try, largest first: one megapixel or less (with room for rounding), then smaller. */
export function shotScales(width: number, height: number): number[] {
  const first = Math.min(1, Math.sqrt((VISUAL_PNG_MAX_PIXELS * 0.98) / Math.max(1, width * height)));
  return [1, 0.75, 0.56, 0.42].map((step) => first * step).filter((scale) => width * scale >= 320);
}

/** Waits for one event on the session. `cancel` stops waiting for good: the promise then never settles. */
function waitForEvent(cdp: CdpClient, session: string, method: string, timeoutMs: number): { promise: Promise<void>; cancel: () => void } {
  let cancel = () => {};
  const promise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`${method} timed out`));
    }, timeoutMs);
    const stop = cdp.on((event) => {
      if (event.sessionId !== session || event.method !== method) return;
      clearTimeout(timer);
      stop();
      resolve();
    });
    cancel = () => {
      clearTimeout(timer);
      stop();
    };
  });
  return { promise, cancel };
}

/** Navigates and waits for the load event. A navigation Chrome refuses or reports failed throws, leaving no waiter behind. */
export async function navigate(cdp: CdpClient, session: string, url: string): Promise<void> {
  const loaded = waitForEvent(cdp, session, 'Page.loadEventFired', LOAD_TIMEOUT_MS);
  try {
    const result = (await cdp.send('Page.navigate', { url }, session)) as { errorText?: string };
    if (result.errorText) throw new Error(`navigation failed: ${result.errorText.slice(0, 60)}`);
  } catch (error) {
    loaded.cancel();
    throw error;
  }
  await loaded.promise;
}

/** A fresh isolated world in the page's main frame, so the walk uses built-ins the page's scripts never touched. */
async function isolatedWorld(cdp: CdpClient, session: string): Promise<number> {
  const tree = (await cdp.send('Page.getFrameTree', {}, session)) as { frameTree: { frame: { id: string } } };
  const world = (await cdp.send('Page.createIsolatedWorld', { frameId: tree.frameTree.frame.id, worldName: 'legallas-visual-walk' }, session)) as {
    executionContextId: number;
  };
  return world.executionContextId;
}

/** Evaluates `expression` in `contextId`, returning its value; a thrown exception in the page throws here. */
async function evaluate(cdp: CdpClient, session: string, contextId: number, expression: string, awaitPromise = false): Promise<unknown> {
  const reply = (await cdp.send('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise }, session)) as {
    result?: { value?: unknown };
    exceptionDetails?: unknown;
  };
  if (reply.exceptionDetails) throw new Error('a script in the walk failed');
  return reply.result?.value;
}

// Resolves once the DOM has had no mutation for QUIET_MS, or after SETTLE_MAX_MS.
const SETTLE = `new Promise(function (done) {
  var timer, finish = function () { observer.disconnect(); done(true); };
  var observer = new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(finish, ${QUIET_MS}); });
  observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  timer = setTimeout(finish, ${QUIET_MS});
  setTimeout(finish, ${SETTLE_MAX_MS});
})`;

export interface RenderedVisual {
  walked: WalkedVisual;
  png: Uint8Array | null;
}

export interface Renderer {
  render(html: Uint8Array, options: { png: boolean }): Promise<RenderedVisual>;
  close(): Promise<void>;
}

async function screenshot(cdp: CdpClient, session: string): Promise<Uint8Array | null> {
  const metrics = (await cdp.send('Page.getLayoutMetrics', {}, session)) as { cssContentSize: { width: number; height: number } };
  const width = Math.ceil(Math.min(metrics.cssContentSize.width, MAX_SHOT_WIDTH));
  const height = Math.ceil(Math.min(metrics.cssContentSize.height, MAX_SHOT_HEIGHT));
  for (const scale of shotScales(width, height)) {
    const params = { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale } };
    const shot = (await cdp.send('Page.captureScreenshot', params, session)) as { data: string };
    const png = new Uint8Array(Buffer.from(shot.data, 'base64'));
    if (sidePngFits(png)) return png;
  }
  return null;
}

/**
 * Opens one headless Chrome for a run of pages. `open` is injectable for tests; `onRequest` sees each request the
 * page makes and whether it was served (only the page itself ever is).
 */
export async function openRenderer(open: () => Promise<VisualBrowser> = () => launchVisualChrome(), onRequest?: (url: string, served: boolean) => void): Promise<Renderer> {
  const browser = await open();
  const { cdp, session } = browser;
  let page: { url: string; body: string } | null = null;
  let count = 0;
  cdp.on((event) => {
    if (event.sessionId !== session || event.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = event.params as { requestId: string; request: { url: string } };
    const answer = answerRequest(request.url, page, requestId);
    onRequest?.(request.url, answer.method === 'Fetch.fulfillRequest');
    void cdp.send(answer.method, answer.params, session).catch(() => undefined);
  });
  await cdp.send('Page.enable', {}, session);
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, session);
  await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT, session);
  const features = [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }];
  await cdp.send('Emulation.setEmulatedMedia', { media: 'screen', features }, session);
  return {
    async render(html, options) {
      count += 1;
      page = { url: `${RENDER_ORIGIN}/page-${count}.html`, body: Buffer.from(html).toString('base64') };
      try {
        await navigate(cdp, session, page.url);
        const world = await isolatedWorld(cdp, session);
        // A Chrome error page (or anything but this page) is never read: its text would be cached as the visual's.
        if ((await evaluate(cdp, session, world, 'location.href')) !== page.url) throw new Error('the page did not load');
        await evaluate(cdp, session, world, SETTLE, true);
        const walked = (await evaluate(cdp, session, world, pageExpression())) as WalkedVisual | undefined;
        if (!walked || !Array.isArray(walked.blocks)) throw new Error('the page walk failed');
        return { walked, png: options.png ? await screenshot(cdp, session) : null };
      } finally {
        page = null;
      }
    },
    close: () => browser.close(),
  };
}

/** Every .html or .htm file under `root`, skipping dot files and folders, sorted by relative path. */
export async function htmlFiles(root: string): Promise<{ rel: string; file: string }[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.html?$/i.test(entry.name))
    .map((entry) => ({ file: path.join(entry.parentPath, entry.name), rel: path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/') }))
    .filter(({ rel }) => !rel.split('/').some((part) => part.startsWith('.')))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

export interface RenderRun {
  rendered: number;
  cached: number;
  failed: number;
}

/**
 * Renders each page that has no current text in the cache and keeps its text (and PNG) there, one page at a time.
 * Chrome starts only when a page needs it, and a failure to start it throws. A page that fails is logged by relative
 * path and skipped (the next run tries it again); logs carry paths and counts, never page text.
 */
export async function renderVisualTexts(
  pages: readonly { rel: string; file: string }[],
  cacheDir: string,
  log: (line: string) => void,
  open: () => Promise<Renderer> = () => openRenderer(),
): Promise<RenderRun> {
  const run: RenderRun = { rendered: 0, cached: 0, failed: 0 };
  let renderer: Renderer | null = null;
  try {
    for (const page of pages) {
      const html = new Uint8Array(await readFile(page.file));
      const sha256 = createHash('sha256').update(html).digest('hex');
      if (await readVisualEntry(cacheDir, sha256)) {
        run.cached += 1;
        continue;
      }
      // A browser that cannot start stops the run; a page that cannot render is skipped.
      renderer ??= await open();
      try {
        const rendered = await renderer.render(html, { png: true });
        const text = formatVisualText(rendered.walked);
        await writeVisualEntry(cacheDir, sha256, text, rendered.png);
        const png = rendered.png ? `, PNG ${Math.ceil(rendered.png.byteLength / 1024)} KB` : ', no PNG within the limit';
        log(`ai text  ${page.rel}  ${text.length} characters${png}`);
        run.rendered += 1;
      } catch (error) {
        run.failed += 1;
        log(`warning  ${page.rel}: could not render (${error instanceof Error ? error.message.slice(0, 80) : 'unknown'}); the next run tries again`);
      }
    }
  } finally {
    await renderer?.close();
  }
  return run;
}
