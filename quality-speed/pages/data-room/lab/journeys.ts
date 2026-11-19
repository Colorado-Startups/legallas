// SPDX-License-Identifier: Apache-2.0
// The lab's journeys: headless Chrome over CDP against the local room, as its signed-in owner, and legallas-mcp over HTTP
// with a local grant. Each one times what a person waits for, measured in the page (performance.now) so CDP's own traffic is
// left out. web/scripts/dev-shoot.ts supplies the probes for console errors, security-policy breaks and requests off localhost.
//
// Each page gets a cold cache, reduced motion and the light scheme, so samples compare, and Lighthouse's mobile throttling, because
// on localhost with no limit almost nothing could miss a goal. Each route is opened once unmeasured first, because the first request
// to a route compiles it inside workerd.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { jsLiteral } from '../../../core/escape.ts';
import { summarize, type JourneyResult, type Summary } from './report.ts';
import { devCdp, devShoot, mcpClient, mcpFence, mcpFlow, type Browser, type CdpEvent, type ShotRecord } from './web.ts';

const { launch } = devCdp;
const { CSP_PROBE, describeEvent, mediaFor, readShift, settle, SHIFT_PROBE } = devShoot;
const { LEGACY_VERSION, McpSession, resultValue, summarizeTool, toolCallOk } = mcpClient;
const { localGrant, localOptions, Report } = mcpFlow;

/**
 * Lighthouse's mobile default, as its constants give it for DevTools throttling: a CPU 4x slower and slow 4G (150 ms round trip and
 * 1.6 Mbps down, which it applies per request as 562.5 ms and 90% of the throughput).
 */
export const THROTTLE = {
  cpuRate: 4,
  network: { offline: false, latency: 562.5, downloadThroughput: Math.floor((1.6 * 1024 * 0.9 * 1024) / 8), uploadThroughput: Math.floor((750 * 0.9 * 1024) / 8) },
} as const;

/** dev-shoot's settle() gives up after 20 seconds; this is close enough to say it did. */
const SETTLE_CAP_MS = 19_000;
const WIDTH = 1280;
const HEIGHT = 800;
const WAIT_MS = 30_000;

/** ASK_LIMIT lets 6 questions through a minute (wrangler.example.jsonc); a little slower, so no sample is refused. */
const ASK_SPACING_MS = 10_500;
/** Ask's model is canned, so its timings aren't scored: a few samples show it works, without a wait of 10 seconds each. */
const ASK_SAMPLES = 3;
/** TOOL_LIMIT lets 60 tool calls through a minute (wrangler.mcp.example.jsonc); a little slower, for the same reason. */
const TOOL_SPACING_MS = 1_100;
/** Events shorter than this are not reported (Event Timing's smallest durationThreshold), so it is what a fast key press reads as. */
const EVENT_TIMING_FLOOR_MS = 16;

export interface QuestionSet {
  filter: { id: string; query: string; path: string };
  documents: { id: string; path: string; page: number }[];
  /** `paths`: any of these is a right answer. `pages`: each right document's cited page, where the answer has one. */
  questions: { id: string; question: string; paths: string[]; pages?: { path: string; page: number }[] }[];
}

export async function loadQuestions(file: string): Promise<QuestionSet> {
  return JSON.parse(await readFile(file, 'utf8')) as QuestionSet;
}

// The room's CSP does not apply to what CDP injects. __labWhen resolves on the first DOM change that passes the test, with
// the page's own clock; __labVitals holds the largest paint and the slowest interaction, as Core Web Vitals reads them.
const LAB_PROBE = `(() => {
  globalThis.__labWhen = (test, timeoutMs) => new Promise((resolve) => {
    let timer;
    const observer = new MutationObserver(() => check());
    const finish = (ok) => { observer.disconnect(); clearTimeout(timer); resolve({ ok, at: performance.now() }); };
    const check = () => { let passed = false; try { passed = !!test(); } catch {} if (passed) finish(true); };
    observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    timer = setTimeout(() => finish(false), timeoutMs);
    check();
  });
  const vitals = { lcp: 0, interaction: 0 };
  globalThis.__labVitals = vitals;
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) vitals.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => { for (const e of list.getEntries()) if (e.interactionId) vitals.interaction = Math.max(vitals.interaction, e.duration); }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  } catch {}
})();`;

/** A page's text layer has words on it: PDF.js has drawn page `n` and a reader can use it. */
export function pageDrawn(n: number): string {
  return `!!document.querySelector('.page[data-page-number="${n}"] .textLayer span')`;
}

/** The document id and page in a cite's href (/doc/?id=<id>#page=<n>), or null. */
export function citeTarget(href: string): { id: string; page: number } | null {
  const match = /^\/doc\/\?id=([A-Za-z0-9_-]{1,64})#page=([1-9][0-9]{0,5})/.exec(href);
  return match ? { id: match[1]!, page: Number(match[2]) } : null; // safe: both groups always take part in a match
}

/** A refused connection answers with no status, and Chrome's own error page paints, so a dead server would otherwise read as a quick load. */
export function refuseFailedNavigation(reply: { errorText?: unknown }): void {
  if (reply.errorText) throw new Error(`the page did not load: ${String(reply.errorText)}`);
}

interface Evaluated<T> {
  result: { value?: T };
  exceptionDetails?: { text?: string };
}

export class Lab {
  private readonly browser: Browser;
  private readonly origin: string;
  private readonly frames: string;
  private readonly inflight = new Set<string>();
  readonly record: ShotRecord = { file: '', url: '', width: WIDTH, variant: 'light', console: [], csp: [], httpErrors: [], external: [], layoutShift: 0, shiftSources: [] };
  requests = 0;
  private readonly urls = new Map<string, string>();

  private constructor(browser: Browser, origin: string, frames: string) {
    this.browser = browser;
    this.origin = origin;
    this.frames = frames;
  }

  static async open(chrome: string, origin: string, out: string): Promise<Lab> {
    const browser = await launch(chrome);
    const frames = path.join(out, 'frames');
    await mkdir(frames, { recursive: true });
    const lab = new Lab(browser, origin, frames);
    const { cdp, session } = browser;
    for (const domain of ['Page', 'Runtime', 'Network', 'Log']) await cdp.send(`${domain}.enable`, {}, session);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }, session);
    await cdp.send('Network.emulateNetworkConditions', { ...THROTTLE.network }, session);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE.cpuRate }, session);
    await cdp.send('Runtime.addBinding', { name: '__legallasShootCsp' }, session);
    for (const source of [CSP_PROBE, SHIFT_PROBE, LAB_PROBE]) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source }, session);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false }, session);
    await cdp.send('Emulation.setEmulatedMedia', mediaFor('light'), session);
    cdp.on((event: CdpEvent) => {
      if (event.sessionId !== session) return;
      if (event.method === 'Network.requestWillBeSent') {
        lab.requests += 1;
        const { requestId, request } = event.params as { requestId: string; request: { url: string } };
        lab.urls.set(requestId, new URL(request.url).pathname);
      }
      describeEvent(event, lab.record, lab.inflight);
      // Chrome reports a response's end only once its body is read, and a page that stops at the status (fetchMatter on a 404) never reads it.
      if (event.method === 'Network.responseReceived') {
        const { requestId, response } = event.params as { requestId: string; response: { status: number } };
        if (response.status >= 400) lab.inflight.delete(requestId);
      }
    });
    return lab;
  }

  close(): Promise<void> {
    return this.browser.close();
  }

  private send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return this.browser.cdp.send(method, params, this.browser.session);
  }

  async evaluate<T>(expression: string): Promise<T> {
    const reply = (await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })) as unknown as Evaluated<T>;
    if (reply.exceptionDetails) throw new Error(`In the page: ${reply.exceptionDetails.text ?? 'exception'}`);
    return reply.result.value as T;
  }

  /** Waits for `test` (an expression) in the page. `at` is milliseconds since the page's navigation began. */
  when(test: string, timeoutMs = WAIT_MS): Promise<{ ok: boolean; at: number }> {
    return this.evaluate(`__labWhen(() => (${test}), ${timeoutMs})`);
  }

  /** Opens a route from blank, so the same URL twice is a real load, not a jump to its #page. */
  async open(route: string): Promise<void> {
    await this.load('about:blank');
    await this.load(`${this.origin}${route}`);
  }

  private async load(url: string): Promise<void> {
    const { cdp, session } = this.browser;
    // A request cut off by leaving a page may never report its end, and settle() would wait on it for good.
    this.inflight.clear();
    const loaded = new Promise<void>((resolve) => {
      const stop = cdp.on((event) => { if (event.sessionId === session && event.method === 'Page.loadEventFired') { stop(); resolve(); } });
    });
    refuseFailedNavigation(await this.send('Page.navigate', { url }));
    await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, WAIT_MS))]);
  }

  /** Waits for the page to go quiet. A wait that reaches settle()'s cap says which requests kept it busy, because that is a finding. */
  async settle(): Promise<void> {
    const start = Date.now();
    await settle(this.browser, this.inflight);
    if (Date.now() - start < SETTLE_CAP_MS) return;
    const open = [...this.inflight].map((id) => this.urls.get(id) ?? 'unknown');
    process.stdout.write(`  never went quiet after ${Date.now() - start} ms; still open: ${open.length ? open.join(', ') : 'none now, but requests kept starting'}\n`);
  }

  /** Forgets what the room keeps in the browser (Ask's history), so samples start alike. */
  clearStorage(): Promise<unknown> {
    return this.send('Storage.clearDataForOrigin', { origin: this.origin, storageTypes: 'indexeddb,local_storage' });
  }

  async vitals(): Promise<{ lcp_ms: number; cls: number; ttfb_ms: number; load_ms: number }> {
    const shift = await readShift(this.browser);
    const page = await this.evaluate<{ lcp: number; ttfb: number; load: number }>(
      "(() => { const nav = performance.getEntriesByType('navigation')[0]; return { lcp: __labVitals.lcp, ttfb: nav.responseStart, load: nav.loadEventEnd }; })()",
    );
    return { lcp_ms: page.lcp, cls: shift.layoutShift, ttfb_ms: page.ttfb, load_ms: page.load };
  }

  /** The slowest key press, as INP reads it. Throws if the page counted none, so a zero can never mean nothing was measured. */
  async interaction(): Promise<number> {
    const { slowest, presses } = await this.evaluate<{ slowest: number; presses: number }>("({ slowest: __labVitals.interaction, presses: performance.eventCounts.get('keydown') ?? 0 })");
    if (presses === 0) throw new Error('the page counted no key presses');
    return Math.max(slowest, EVENT_TIMING_FLOOR_MS);
  }

  /** Real key presses, so the room's input handlers and Event Timing both see them. */
  async type(text: string): Promise<void> {
    for (const ch of text) {
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch });
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    }
  }

  /** A real click at the middle of the first element `selector` matches. */
  async click(selector: string): Promise<void> {
    const { x, y } = await this.evaluate<{ x: number; y: number }>(
      `(() => { const el = document.querySelector(${jsLiteral(selector)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
    );
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  /** The screen as a small webp, for the page's filmstrip. Returns its path relative to the report. */
  async frame(name: string): Promise<string> {
    const shot = (await this.send('Page.captureScreenshot', { format: 'webp', quality: 50 })) as { data: string };
    await writeFile(path.join(this.frames, `${name}.webp`), Buffer.from(shot.data, 'base64'));
    return `frames/${name}.webp`;
  }
}

/** Collects named series and failures for one journey. */
class Samples {
  private readonly series = new Map<string, number[]>();
  private failures = 0;

  add(values: Record<string, number>): void {
    for (const [name, value] of Object.entries(values)) this.series.set(name, [...(this.series.get(name) ?? []), value]);
  }

  /** Samples that finished. */
  get count(): number {
    return Math.max(0, ...[...this.series.values()].map((values) => values.length));
  }

  fail(error?: unknown): void {
    this.failures += 1;
    if (error) process.stdout.write(`  sample failed: ${error instanceof Error ? error.message.slice(0, 200) : 'error'}\n`);
  }

  /** `names` keeps a series present when nothing finished, so a broken journey shows as empty rather than vanishing. */
  result(id: string, names: readonly string[], extra: Pick<JourneyResult, 'tallies' | 'frame'> = {}): JourneyResult {
    const series: Record<string, Summary> = {};
    for (const name of new Set([...names, ...this.series.keys()])) series[name] = summarize(this.series.get(name) ?? []);
    return { id, series, failures: this.failures, ...extra };
  }
}

function log(id: string, result: JourneyResult): JourneyResult {
  const cells = Object.entries(result.series).map(([name, s]) => `${name} p50 ${s.p50 ?? '-'} p95 ${s.p95 ?? '-'} (n ${s.n})`);
  process.stdout.write(`${id}: ${cells.join(', ')}${result.failures ? `, ${result.failures} failed` : ''}\n`);
  return result;
}

const LOAD_SERIES = ['lcp_ms', 'cls', 'ttfb_ms', 'load_ms'];

/** Why a load's numbers mean nothing, if they don't: a page that painted nothing, or a request that answered with an error, which can make a page quick. */
export function loadProblem(lcpMs: number, httpErrors: readonly string[]): string | null {
  if (httpErrors.length > 0) return `a request answered with an error: ${httpErrors[0]}`;
  return lcpMs > 0 ? null : 'the page painted nothing';
}

/** Core Web Vitals, as far as a load shows them, for one route. */
export async function pageLoad(lab: Lab, id: string, route: string, samples: number): Promise<JourneyResult> {
  const run = new Samples();
  await lab.open(route);
  await lab.settle();
  for (let i = 0; i < samples; i += 1) {
    try {
      const before = lab.record.httpErrors.length;
      await lab.open(route);
      await lab.settle();
      const vitals = await lab.vitals();
      const problem = loadProblem(vitals.lcp_ms, lab.record.httpErrors.slice(before));
      if (problem) throw new Error(problem);
      run.add(vitals);
    } catch (error) {
      run.fail(error);
    }
  }
  return log(id, run.result(id, LOAD_SERIES, { frame: await lab.frame(id) }));
}

/** Types in the documents filter until the table has narrowed to a set holding the wanted row, and the slowest key press. */
export async function filterDocuments(lab: Lab, set: QuestionSet['filter'], docId: string, samples: number): Promise<JourneyResult> {
  const run = new Samples();
  const id = 'filter-documents';
  const rows = "document.querySelectorAll('tr.docs-row')";
  const wanted = `a[href^="/doc/?id=${docId}"]`;
  await lab.open('/documents/');
  await lab.settle();
  for (let i = 0; i < samples; i += 1) {
    try {
      await lab.open('/documents/');
      await lab.settle();
      const total = await lab.evaluate<number>(`${rows}.length`);
      await lab.evaluate(
        `(() => { document.querySelector('[data-docs-filter]').focus(); globalThis.__labStart = performance.now(); ` +
          `globalThis.__labDone = __labWhen(() => ${rows}.length < ${total} && document.querySelector('tr.docs-row ${wanted}'), ${WAIT_MS}); })()`,
      );
      await lab.type(set.query);
      const { ok, ms } = await lab.evaluate<{ ok: boolean; ms: number }>('__labDone.then((done) => ({ ok: done.ok, ms: done.at - __labStart }))');
      if (!ok) throw new Error('the filter never narrowed to the wanted row');
      run.add({ narrowed_ms: ms, interaction_ms: await lab.interaction() });
    } catch (error) {
      run.fail(error);
    }
  }
  return log(id, run.result(id, ['narrowed_ms', 'interaction_ms'], { frame: await lab.frame(id) }));
}

/** From the address to the wanted page drawn with its text. */
export async function openDocument(lab: Lab, id: string, docId: string, page: number, samples: number): Promise<JourneyResult> {
  const run = new Samples();
  const route = `/doc/?id=${encodeURIComponent(docId)}#page=${page}`;
  await lab.open(route);
  await lab.when(pageDrawn(page));
  for (let i = 0; i < samples; i += 1) {
    try {
      await lab.open(route);
      const drawn = await lab.when(pageDrawn(page));
      if (!drawn.ok) throw new Error(`page ${page} was never drawn`);
      // Bytes over the wire by the time the page is drawn: the cache is off, so every response counts.
      const bytes = await lab.evaluate<number>(`${BYTES_SO_FAR}`);
      run.add({ page_drawn_ms: drawn.at, bytes_drawn: bytes });
    } catch (error) {
      run.fail(error);
    }
  }
  return log(id, run.result(id, ['page_drawn_ms', 'bytes_drawn'], { frame: await lab.frame(id) }));
}

/** The page's own count of bytes received so far: the document and every resource, as their transfer sizes. */
const BYTES_SO_FAR = "[...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')].reduce((n, e) => n + (e.transferSize || 0), 0)";

interface AskTurn {
  ok: boolean;
  firstText: number;
  done: number;
  hrefs: string[];
}

/** Asks in the Ask page and waits for the answer. The turn is watched from before the question goes. */
async function askOnce(lab: Lab, question: string): Promise<AskTurn> {
  const turn = 'document.querySelector("[data-chat-log]").children[__labBefore]';
  await lab.evaluate(
    `(() => { globalThis.__labBefore = document.querySelector('[data-chat-log]').children.length; globalThis.__labStart = performance.now(); ` +
      `globalThis.__labText = __labWhen(() => ${turn}?.querySelector('.ask-turn__a')?.textContent.trim(), ${WAIT_MS}); ` +
      `globalThis.__labFinal = __labWhen(() => ['done', 'failed'].includes(${turn}?.dataset.state), ${WAIT_MS}); ` +
      `document.querySelector('[data-chat-input]').value = ${jsLiteral(question)}; document.querySelector('[data-chat-form]').requestSubmit(); })()`,
  );
  return lab.evaluate<AskTurn>(
    `Promise.all([__labText, __labFinal]).then(([text, final]) => { const root = ${turn}; return { ok: text.ok && final.ok && root?.dataset.state === 'done', firstText: text.at - __labStart, ` +
      `done: final.at - __labStart, hrefs: [...(root?.querySelectorAll('a[data-cite]') ?? [])].map((a) => a.getAttribute('href') ?? '') }; })`,
  );
}

/** The right answers among `ids`. */
const wantedIds = (paths: readonly string[], ids: ReadonlyMap<string, string>) => new Set(paths.flatMap((rel) => ids.get(rel) ?? []));

/**
 * Ask on keyword search with the room's canned answer, a few times, spaced under the room's burst limit. The canned answer cites
 * whatever the prompt lists first, the case picture before the passages, so it says nothing about whether the search found the
 * right document: `connector` scores that.
 */
/** One question from an empty history, so only this answer stays saved in the browser. */
async function askAlone(lab: Lab, question: string): Promise<AskTurn> {
  await lab.clearStorage();
  await lab.open('/ask');
  await lab.settle();
  const turn = await askOnce(lab, question);
  // The page saves the answer just after it draws it, then shows Clear history. Leaving before that would lose the saved answer.
  if (turn.ok) await lab.when("document.querySelector('[data-chat-clear]')?.hidden === false");
  return turn;
}

async function askSamples(lab: Lab, questions: QuestionSet['questions'], samples: number): Promise<{ result: JourneyResult; href: string | null }> {
  const asked = new Samples();
  const pageCite = (turn: AskTurn) => turn.hrefs.find((candidate) => citeTarget(candidate) !== null) ?? null;
  let href: string | null = null;
  let citing: string | null = null;
  for (let i = 0; i < samples; i += 1) {
    const item = questions[i % questions.length]!; // safe: index is modulo the array's length
    const started = Date.now();
    href = null;
    try {
      const turn = await askAlone(lab, item.question);
      if (!turn.ok) throw new Error('the answer never finished');
      asked.add({ first_text_ms: turn.firstText, answer_done_ms: turn.done });
      href = pageCite(turn);
      if (href !== null) citing = item.question;
    } catch (error) {
      asked.fail(error);
    }
    const wait = ASK_SPACING_MS - (Date.now() - started);
    if (wait > 0 && i + 1 < samples) await new Promise((resolve) => setTimeout(resolve, wait));
  }
  // citationToPage reopens the saved answer, and only the last one asked is saved, so it has to be one that cites a page.
  if (href === null && citing !== null) {
    await new Promise((resolve) => setTimeout(resolve, ASK_SPACING_MS));
    const again = await askAlone(lab, citing).catch(() => null);
    href = again && pageCite(again);
  }
  return { result: log('ask', asked.result('ask', ['first_text_ms', 'answer_done_ms'])), href };
}

/**
 * From a citation to the page it names. Each sample reopens Ask, whose saved answer brings the citation back with no new question,
 * so these samples are free of the burst limit. Reopening keeps the document out of the browser's memory, and the cache is off.
 */
async function citationToPage(lab: Lab, href: string | null, samples: number): Promise<JourneyResult> {
  const cited = new Samples();
  const id = 'citation-to-page';
  const target = href === null ? null : citeTarget(href);
  if (href === null || target === null) {
    cited.fail(new Error('no answer cited a document page'));
    return log(id, cited.result(id, ['page_drawn_ms']));
  }
  for (let i = 0; i < samples; i += 1) {
    try {
      await lab.open('/ask');
      await lab.settle();
      // The saved answer is drawn after the page goes quiet: it comes from the browser's own storage, and a slow CPU takes a while.
      const cite = `a[data-cite][href=${JSON.stringify(href)}]`;
      const shown = await lab.when(`document.querySelector(${jsLiteral(cite)})`);
      if (!shown.ok) throw new Error('the saved answer never showed its citation');
      const start = await lab.evaluate<number>('performance.now()');
      await lab.click(cite);
      const drawn = await lab.when(pageDrawn(target.page));
      if (!drawn.ok) throw new Error(`cited page ${target.page} was never drawn`);
      cited.add({ page_drawn_ms: drawn.at - start });
    } catch (error) {
      cited.fail(error);
    }
  }
  return log(id, cited.result(id, ['page_drawn_ms'], { frame: await lab.frame(id) }));
}

export async function askAndCite(lab: Lab, questions: QuestionSet['questions'], samples: number): Promise<JourneyResult[]> {
  const { result, href } = await askSamples(lab, questions, Math.min(samples, ASK_SAMPLES));
  return [result, await citationToPage(lab, href, samples)];
}

/**
 * Text wrapped exactly once as case data (mcp/format.ts caseData), so a planted instruction reaches an AI as a record. The
 * fence is read as the tools write it (mcp/untrusted.ts fenceOf): plain, or with the quarantine's mark, which a planted
 * instruction gets.
 */
export function wrappedOnce(text: string): boolean {
  const fence = mcpFence.fenceOf(text);
  return fence !== null && !/<\s*\/\s*case-record\s*>/i.test(fence.inner);
}

const plain = (text: string) => text.replace(/<\/?case-record>/g, ' ').replace(/\[[^\]]* p\. \d+\]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * A passage's opening words, read from just after its own page's cite when it has one, because text before that cite belongs to
 * the page before. Twelve words: long enough not to match by chance, short enough to end before the page does.
 */
export function quoteOf(passage: string, page: number): string {
  const cite = [...passage.matchAll(/\[[^\]]* p\. (\d+)\]/g)].find((found) => found[1] === String(page));
  const from = cite ? passage.slice(cite.index + cite[0].length) : passage;
  return plain(from.replace(/\u2026\s*$/, '')).split(' ').slice(0, 12).join(' ');
}

/** Whether a passage's quote is on the page read back, compared as plain words. */
export const quoteOnPage = (passage: string, page: number, pageText: string): boolean => {
  const quote = quoteOf(passage, page);
  return quote.length > 0 && plain(pageText).includes(quote);
};

/** Tokens as an AI app counts them, roughly: four characters a token, the usual rule of thumb for English. */
export const tokensOf = (text: string): number => Math.ceil(text.length / 4);

interface Passage {
  id: string;
  page: number | null;
  text: string;
}

/**
 * Connector round trips through legallas-mcp, as a member's AI makes them: search by keyword, then read a page. Each question
 * is scored once: whether its document is among the search's first five passages, and whether one of those is at the cited
 * page. Each passage's page is read back once, to check its quote is on that page, and every text handed over is checked for
 * its case-data wrapper. A search that did not come from the keyword index counts as failed, because a lab number must never
 * rest on anything else.
 */
export async function connector(base: string, questions: QuestionSet['questions'], ids: ReadonlyMap<string, string>, docId: string, samples: number): Promise<JourneyResult[]> {
  const report = new Report();
  const grant = await localGrant(report, fetch, base, await localOptions());
  if (!grant) throw new Error(`The local grant failed: ${report.checks.filter((check) => check.outcome === 'fail').map((check) => check.name).join(', ')}`);
  const session = new McpSession(fetch, `${base}/mcp`, grant.accessToken, LEGACY_VERSION);
  await session.open();
  const call = async (run: Samples, name: string, args: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    const start = performance.now();
    const reply = await session.callTool(name, args);
    const ms = performance.now() - start;
    if (reply.result === null || !toolCallOk(summarizeTool(reply.result))) {
      run.fail(new Error(`${name}: status ${reply.status}`));
      return null;
    }
    // The whole result as it crosses the wire: the text and the same object as structured content.
    run.add({ round_trip_ms: ms, result_tokens: tokensOf(JSON.stringify(reply.result)) });
    return resultValue(reply.result);
  };
  const search = new Samples();
  const read = new Samples();
  const tallies = { asked: 0, rightDocumentTop5: 0, notKeyword: 0, pageAsked: 0, rightPageTop5: 0, quotes: 0, quotesOnPage: 0, texts: 0, unwrapped: 0 };
  const pageTexts = new Map<string, string | null>();
  const readPage = async (id: string, page: number): Promise<string | null> => {
    const key = `${id}:${page}`;
    if (!pageTexts.has(key)) {
      const value = await call(read, 'legallas_read_pages', { id, from: page, to: page });
      const entry = Array.isArray(value?.pages) ? (value.pages as { page?: unknown; text?: unknown }[]).find((p) => p.page === page) : undefined;
      const text = typeof entry?.text === 'string' ? entry.text : null;
      if (text) (tallies.texts += 1), wrappedOnce(text) || (tallies.unwrapped += 1);
      pageTexts.set(key, text);
      await new Promise((resolve) => setTimeout(resolve, TOOL_SPACING_MS));
    }
    return pageTexts.get(key) ?? null;
  };
  for (let i = 0; i < Math.max(samples, questions.length); i += 1) {
    const item = questions[i % questions.length]!; // safe: index is modulo the array's length
    const value = await call(search, 'legallas_search', { query: item.question, limit: 5 });
    const found = (Array.isArray(value?.results) ? (value.results as Partial<Passage>[]) : []).filter((p): p is Passage => typeof p.id === 'string' && typeof p.text === 'string');
    if (found.length > 0 && value?.fallback !== 'keyword') tallies.notKeyword += 1;
    await new Promise((resolve) => setTimeout(resolve, TOOL_SPACING_MS));
    if (i >= questions.length) continue;
    // A search that errors counts as asked and missed, so a failing tool can't lift the rate.
    tallies.asked += 1;
    const cited = (item.pages ?? []).flatMap(({ path: rel, page }) => (ids.has(rel) ? [{ id: ids.get(rel)!, page }] : [])); // safe: has() just checked
    if (cited.length) tallies.pageAsked += 1;
    if (!value) continue;
    const wanted = wantedIds(item.paths, ids);
    if (found.some((passage) => wanted.has(passage.id))) tallies.rightDocumentTop5 += 1;
    if (cited.length) {
      if (found.some((passage) => cited.some((c) => c.id === passage.id && c.page === passage.page))) tallies.rightPageTop5 += 1;
    }
    for (const passage of found) {
      tallies.texts += 1;
      if (!wrappedOnce(passage.text)) tallies.unwrapped += 1;
      if (passage.page === null) continue;
      const pageText = await readPage(passage.id, passage.page);
      tallies.quotes += 1;
      if (pageText !== null && quoteOnPage(passage.text, passage.page, pageText)) tallies.quotesOnPage += 1;
    }
  }
  // Round trips for pages not yet read, up to the samples asked, so the read timing has its samples on a small question set.
  for (let page = 1; read.count < samples && page <= samples; page += 1) await readPage(docId, page);
  if (tallies.notKeyword > 0) search.fail(new Error(`${tallies.notKeyword} searches did not come from the keyword index`));
  return [log('connector-search', search.result('connector-search', ['round_trip_ms', 'result_tokens'], { tallies })), log('connector-read-page', read.result('connector-read-page', ['round_trip_ms']))];
}
