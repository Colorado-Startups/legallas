// SPDX-License-Identifier: Apache-2.0
// The room views (mcp/apps/) drawn in headless Chrome, offline, on the Doe v. Harbor Labs fixture (control prefix DOE):
//
// | Shot             | Mode                                                   | Proves                                       |
// |------------------|--------------------------------------------------------|----------------------------------------------|
// | `host-*`         | a test host page plays the AI (MCP Apps over postMessage) | the handshake, the result in, the size out |
// | `*-copilot`      | the same, with the compact result Copilot gets          | the view draws from the small structured copy |
// | `host-grid-read` | a cell clicked                                          | a cite calls legallas_read_pages via the host |
// | `binder-*`       | the page saved with its result, as the binder frames it | binder mode, under the room's `visual` policy |
//
// The tool results are the real tools' on the fixture catalog and matter (mcp/tools/overview-fixtures.ts), the same
// data `npm run dev:seed` puts in the fixture room. Chrome runs on a pipe with every host name unresolvable
// (scripts/visual-chrome.ts); the one page is served from memory and any other request is refused and recorded.
// PNGs and report.json go to --out. Exits 1 when a view draws nothing, throws, logs an error or asks for anything.
//
//   node mcp/apps/shoot.ts --out <dir> [--chrome <path>]
//
// It starts Chrome, so it runs in CI (the Views workflow, .github/workflows/mcp-views.yml), never on a laptop. It lives
// in mcp/ because it calls the tools, whose Worker types the scripts project cannot see (scripts/mcp-constants.ts).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { DEFAULT_CHROME } from '../../scripts/dev-cdp.ts';
import { launchVisualChrome, type CdpEvent, type VisualBrowser } from '../../scripts/visual-chrome.ts';
import { contentSecurityPolicy } from '../../worker/headers.ts';
import { MATTER_KEY } from '../../worker/matter-types.ts';
import type { ToolContext } from '../contract.ts';
import { forProfile } from '../format.ts';
import { catalogDb, toolCtx } from '../tools/doc-fixtures.ts';
import { listDocumentsTool } from '../tools/documents.ts';
import { DOC_IDS, MATTER_JSON, overviewCtx } from '../tools/overview-fixtures.ts';
import { overviewTool, resetOverviewCache } from '../tools/overview.ts';
import { scriptJson, viewConfig, viewDocument, viewHtml, VIEW_RESOURCE_META, type ViewName } from './views.ts';

const ORIGIN = 'https://views.invalid';
const VIEWPORT = { width: 1180, height: 900, deviceScaleFactor: 1, mobile: false };
const SETTLE_MS = 2000;
const CONFIG = viewConfig();

/** A JSON object whose fields the code checks before it reads them. */
type Json = Record<string, unknown>;

// Fixture results ------------------------------------------------------------------------------------------------

async function overview(ctx: ToolContext, section: string): Promise<CallToolResult> {
  const result = await overviewTool.handler(overviewTool.inputSchema.parse({ section }), ctx);
  return forProfile(ctx.profile, result);
}

/** The matter manifest in the files bucket: the one object the overview reads (a stand-in with the same shape). */
function matterFiles(): { get(key: string): Promise<unknown> } {
  return { get: async (key: string) => (key === MATTER_KEY ? { key, etag: 'e1', body: true, text: async () => MATTER_JSON } : null) };
}

/** The company checklist on the fixture catalog, one item matched (as overview-checklist.test.ts sets it up). */
function checklistCtx(): ToolContext {
  resetOverviewCache();
  const entries = Object.entries(DOC_IDS);
  const { db, sqlite } = catalogDb(entries.map(([docPath, id], i) => ({ id, path: docPath, controlSeq: i + 1 })));
  const matched = entries[1];
  if (!matched) throw new Error('the fixture catalog has fewer than two documents');
  sqlite
    .prepare("INSERT INTO checklist_matches (id, item_id, document_id, signed, doc_date, matched_by, matched_at) VALUES ('m1', 'founders.stock-purchase-agreement', ?, 'yes', '2026-09-20', 'ada@firm.example', '2026-09-21T00:00:00Z')")
    .run(matched[1]);
  const { ctx } = toolCtx(db);
  Object.assign(ctx.env, { CHECKLIST_ENABLED: '1', FILES: matterFiles() });
  return ctx;
}

interface Shot {
  name: string;
  view: ViewName;
  mode: 'host' | 'binder';
  result: CallToolResult;
  args: Json;
  /** Results the host answers tools/call with, by section (the overview's tabs and tiles). */
  sections?: Record<string, CallToolResult>;
  /** Click this in the view, then shoot again. */
  click?: string;
  /** Words the binder page must show. */
  expect?: string[];
}

async function shots(): Promise<Shot[]> {
  const standard = overviewCtx();
  const sections: Record<string, CallToolResult> = {};
  for (const section of ['summary', 'tracks', 'events', 'money', 'violations', 'people', 'claims', 'docs']) sections[section] = await overview(standard, section);
  const compact = overviewCtx({ profile: 'compact' });
  const compactTracks = await overview(compact, 'tracks');
  const checklist = await overview(checklistCtx(), 'checklist');
  const listed = forProfile('standard', await listDocumentsTool.handler(listDocumentsTool.inputSchema.parse({}), overviewCtx()));
  const listedCompact = forProfile('compact', await listDocumentsTool.handler(listDocumentsTool.inputSchema.parse({}), compact));
  const section = (name: string): CallToolResult => {
    const found = sections[name];
    if (!found) throw new Error(`no fixture result for the ${name} section`);
    return found;
  };
  const [summary, tracks, events] = [section('summary'), section('tracks'), section('events')];
  return [
    { name: 'host-summary', view: 'overview', mode: 'host', result: summary, args: { section: 'summary' }, sections },
    { name: 'host-board-tracks', view: 'overview', mode: 'host', result: tracks, args: { section: 'tracks' }, sections },
    { name: 'host-board-checklist', view: 'overview', mode: 'host', result: checklist, args: { section: 'checklist' }, sections },
    { name: 'host-timeline-events', view: 'overview', mode: 'host', result: events, args: { section: 'events' }, sections },
    { name: 'host-board-tracks-copilot', view: 'overview', mode: 'host', result: compactTracks, args: { section: 'tracks' } },
    { name: 'host-grid', view: 'grid', mode: 'host', result: listed, args: {} },
    { name: 'host-grid-copilot', view: 'grid', mode: 'host', result: listedCompact, args: {} },
    { name: 'host-grid-read', view: 'grid', mode: 'host', result: listed, args: {}, click: 'td .v-cell' },
    { name: 'binder-timeline-events', view: 'overview', mode: 'binder', result: events, args: { section: 'events' }, expect: ['Events', 'DOE-0000'] },
    { name: 'binder-board-tracks', view: 'overview', mode: 'binder', result: tracks, args: { section: 'tracks' }, expect: ['Tracks', 'DOE-0000'] },
    { name: 'binder-grid', view: 'grid', mode: 'binder', result: listed, args: {}, expect: ['Control', 'DOE-000001'] },
  ];
}

// Pages ------------------------------------------------------------------------------------------------------------

const attr = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/**
 * A page that plays an MCP Apps host for one view: answers ui/initialize, sends the tool's input and result after
 * initialized, sizes the frame to what the view reports, and answers tools/call from the fixture's results.
 */
function hostPage(shot: Shot): string {
  const data = { result: shot.result, args: shot.args, sections: shot.sections ?? {}, tools: CONFIG.tools };
  const script = `
var frame = document.getElementById('view');
var data = JSON.parse(document.getElementById('data').textContent);
window.calls = [];
// legallas_read_pages for any page: one invented page of the fixture, fenced as case text, as the reader gets it.
function readPage(args) {
  var page = typeof args.from === 'number' ? args.from : 1;
  var link = 'https://room.invalid/doc/?id=' + encodeURIComponent(String(args.id)) + '#page=' + page;
  var value = { retrieved: '2026-11-06', id: args.id, total_pages: 1, pages: [{ page: page, link: link,
    text: '<case-record>\\nPage ' + page + ' of this fixture document, as the room\\'s reader returns it: the text a cite points to.\\n</case-record>' }] };
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
}
function canned(params) {
  var args = params.arguments || {};
  if (params.name === data.tools.read) return readPage(args);
  if (params.name === data.tools.overview && data.sections[args.section]) return data.sections[args.section];
  return { isError: true, content: [{ type: 'text', text: 'not_in_test_host: The test host has no result for that call.' }] };
}
window.addEventListener('message', function (event) {
  if (event.source !== frame.contentWindow) return;
  var m = event.data;
  if (!m || m.jsonrpc !== '2.0') return;
  var send = function (message) { message.jsonrpc = '2.0'; frame.contentWindow.postMessage(message, '*'); };
  if (m.method === 'ui/initialize') {
    send({ id: m.id, result: { protocolVersion: m.params.protocolVersion, hostInfo: { name: 'legallas-test-host', version: '1.0.0' },
      hostCapabilities: { openLinks: {}, serverTools: {} }, hostContext: { theme: 'light', displayMode: 'inline', locale: 'en-US' } } });
  } else if (m.method === 'ui/notifications/initialized') {
    send({ method: 'ui/notifications/tool-input', params: { arguments: data.args } });
    send({ method: 'ui/notifications/tool-result', params: data.result });
  } else if (m.method === 'ui/notifications/size-changed') {
    frame.style.height = Math.min(m.params.height, 6000) + 'px';
    document.body.dataset.height = String(m.params.height);
  } else if (m.method === 'tools/call') {
    window.calls.push(m.params);
    send({ id: m.id, result: canned(m.params) });
  } else if (m.id !== undefined) {
    send({ id: m.id, result: {} });
  }
});`;
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Test host</title><link rel="icon" href="data:,">' +
    '<style>body{margin:0;padding:24px;background:#30302e;font:14px system-ui}iframe{display:block;width:100%;height:240px;border:0;border-radius:12px;background:#fff}</style></head><body>' +
    `<iframe id="view" sandbox="allow-scripts" title="View" srcdoc="${attr(viewHtml(shot.view, CONFIG))}"></iframe>` +
    `<script type="application/json" id="data">${scriptJson(data)}</script><script>${script}</script></body></html>`
  );
}

// Chrome -----------------------------------------------------------------------------------------------------------

/** The one page of a shot, served from memory for the one origin. */
interface ServedPage {
  url: string;
  body: string;
  csp: string | null;
}

/** What the watcher collects while a shot loads and runs. */
interface Watch {
  page: ServedPage | null;
  requests: string[];
  errors: string[];
  /** Sandboxed frames Chrome put in a process of their own. */
  children: Set<string>;
}

/** A tools/call the test host recorded: only the fields the checks read. */
interface CallRecord {
  name?: unknown;
  arguments?: { id?: unknown };
}

interface Report {
  name: string;
  png: string;
  height: number | null;
  requests: string[];
  errors: string[];
  calls: CallRecord[];
  problems: string[];
}

// The parts of each DevTools reply and event this script reads.
type PausedParams = { requestId: string; request: { url: string } };
type SentParams = { request?: { url?: unknown } };
type ThrownParams = { exceptionDetails?: { text?: string; exception?: { description?: string } } };
type ConsoleParams = { type?: string; args?: { value?: unknown; description?: unknown }[] };
type AttachedParams = { sessionId?: unknown };
type EvalReply = { exceptionDetails?: unknown; result?: { value?: unknown } };
type FrameTreeReply = { frameTree: { childFrames?: { frame?: { id?: string } }[] } };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Answers a paused request: the shot's page from memory, anything else refused and recorded. */
function answerPaused(browser: VisualBrowser, watch: Watch, p: PausedParams): void {
  const served = watch.page !== null && p.request.url === watch.page.url ? watch.page : null;
  // Chrome asks for the top page's favicon itself; it is the browser's request, not the view's.
  if (!served && p.request.url !== `${ORIGIN}/favicon.ico`) watch.requests.push(p.request.url);
  const command = served
    ? {
      method: 'Fetch.fulfillRequest',
      params: {
        requestId: p.requestId, responseCode: 200, body: served.body,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }, ...(served.csp ? [{ name: 'Content-Security-Policy', value: served.csp }] : [])],
      },
    }
    : { method: 'Fetch.failRequest', params: { requestId: p.requestId, errorReason: 'BlockedByClient' } };
  void browser.cdp.send(command.method, command.params, browser.session).catch(() => undefined);
}

/** A sandboxed frame Chrome put in a process of its own: watch its scripts and requests too. */
function watchChild(browser: VisualBrowser, watch: Watch, sessionId: string): void {
  watch.children.add(sessionId);
  for (const method of ['Runtime.enable', 'Network.enable', 'Runtime.runIfWaitingForDebugger']) {
    void browser.cdp.send(method, {}, sessionId).catch(() => undefined);
  }
}

/** Notes what a DevTools event says about the page: requests it made, scripts that threw, errors it logged. */
function recordEvent(browser: VisualBrowser, watch: Watch, event: CdpEvent): void {
  if (event.method === 'Fetch.requestPaused') {
    answerPaused(browser, watch, event.params as PausedParams);
  } else if (event.method === 'Network.requestWillBeSent' && event.sessionId !== browser.session) {
    const url = String((event.params as SentParams).request?.url ?? '');
    if (!/^(about:|data:)/.test(url)) watch.requests.push(url);
  } else if (event.method === 'Runtime.exceptionThrown') {
    const details = (event.params as ThrownParams).exceptionDetails;
    watch.errors.push(String(details?.exception?.description ?? details?.text ?? 'exception').slice(0, 300));
  } else if (event.method === 'Runtime.consoleAPICalled' && (event.params as ConsoleParams).type === 'error') {
    const args = (event.params as ConsoleParams).args;
    watch.errors.push(String(args?.map((a) => a.value ?? a.description).join(' ') ?? 'console error').slice(0, 300));
  } else if (event.method === 'Target.attachedToTarget') {
    const sessionId = (event.params as AttachedParams).sessionId;
    if (typeof sessionId === 'string') watchChild(browser, watch, sessionId);
  }
}

/** Turns on the DevTools domains the shots need, and sizes and calms the page. */
async function prepareChrome(browser: VisualBrowser): Promise<void> {
  const { cdp, session } = browser;
  await cdp.send('Page.enable', {}, session);
  await cdp.send('Runtime.enable', {}, session);
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, session);
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, session);
  await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT, session);
  await cdp.send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, session);
}

async function evaluate(browser: VisualBrowser, expression: string, target: string = browser.session): Promise<unknown> {
  const reply = (await browser.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, target)) as EvalReply;
  if (reply.exceptionDetails) throw new Error(`evaluate failed: ${expression.slice(0, 60)}`);
  return reply.result?.value;
}

/** Evaluates inside the view's frame: its own session when Chrome isolated it, else a world in the child frame. */
async function inView(browser: VisualBrowser, watch: Watch, expression: string): Promise<unknown> {
  const child = [...watch.children].at(-1);
  if (child) return evaluate(browser, expression, child);
  const { cdp, session } = browser;
  const tree = (await cdp.send('Page.getFrameTree', {}, session)) as FrameTreeReply;
  const frameId = tree.frameTree.childFrames?.[0]?.frame?.id;
  if (!frameId) throw new Error('no view frame');
  const world = (await cdp.send('Page.createIsolatedWorld', { frameId, worldName: 'views-shoot' }, session)) as { executionContextId: number };
  const reply = (await cdp.send('Runtime.evaluate', { expression, contextId: world.executionContextId, returnByValue: true }, session)) as EvalReply;
  return reply.result?.value;
}

/** Writes the page's PNG to `out`. */
async function capture(browser: VisualBrowser, out: string, file: string): Promise<void> {
  const { cdp, session } = browser;
  const metrics = (await cdp.send('Page.getLayoutMetrics', {}, session)) as { cssContentSize: { height: number } };
  const height = Math.ceil(Math.min(metrics.cssContentSize.height, 8000));
  // A frame in its own process paints only inside the viewport, so the viewport grows to the page for the shot.
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, height: Math.max(VIEWPORT.height, height) }, session);
  await sleep(300);
  const shot = (await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: VIEWPORT.width, height, scale: 1 } }, session)) as { data: string };
  await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT, session);
  await writeFile(path.join(out, file), Buffer.from(shot.data, 'base64'));
}

/** Loads the shot's page into Chrome and waits for it to settle. */
async function loadShot(browser: VisualBrowser, watch: Watch, shot: Shot, count: number): Promise<void> {
  watch.requests = [];
  watch.errors = [];
  watch.children.clear();
  const html = shot.mode === 'host' ? hostPage(shot) : viewDocument(shot.view, shot.result, CONFIG, shot.args);
  // A binder page runs under the room's `visual` policy (worker/headers.ts), as /visual/ frames it.
  const page: ServedPage = { url: `${ORIGIN}/${shot.name}-${count}.html`, body: Buffer.from(html).toString('base64'), csp: shot.mode === 'binder' ? contentSecurityPolicy('visual') : null };
  watch.page = page;
  await browser.cdp.send('Page.navigate', { url: page.url }, browser.session);
  await sleep(SETTLE_MS);
}

/** What the loaded page drew: a host page must report a height, a binder page must show its words. */
async function checkDrawn(browser: VisualBrowser, shot: Shot): Promise<{ height: number | null; problems: string[] }> {
  const problems: string[] = [];
  if (shot.mode === 'binder') {
    const text = String(await evaluate(browser, 'document.body.innerText'));
    for (const word of shot.expect ?? []) if (!text.includes(word)) problems.push(`the page does not show "${word}"`);
    return { height: null, problems };
  }
  const height = Number(await evaluate(browser, 'document.body.dataset.height || 0')) || null;
  if (!height || height < 120) problems.push(`the view reported no height (${height})`);
  return { height, problems };
}

/** Clicks the shot's target in the view, shoots again, and checks the host saw the read call. */
async function clickAndShoot(browser: VisualBrowser, watch: Watch, out: string, shot: Shot, target: string): Promise<{ calls: CallRecord[]; problems: string[] }> {
  await inView(browser, watch, `document.querySelector(${JSON.stringify(target)}).click()`);
  await sleep(SETTLE_MS);
  const calls = (await evaluate(browser, 'window.calls')) as CallRecord[];
  const problems: string[] = [];
  if (!calls.some((call) => call.name === CONFIG.tools.read && typeof call.arguments?.id === 'string')) problems.push(`no ${CONFIG.tools.read} call after the click`);
  await capture(browser, out, `${shot.name}-after.png`);
  return { calls, problems };
}

/** Draws one shot and reports what went wrong with it. */
async function runShot(browser: VisualBrowser, watch: Watch, out: string, shot: Shot, count: number): Promise<Report> {
  await loadShot(browser, watch, shot, count);
  const { height, problems } = await checkDrawn(browser, shot);
  await capture(browser, out, `${shot.name}.png`);
  let calls: CallRecord[] = [];
  if (shot.click) {
    const clicked = await clickAndShoot(browser, watch, out, shot, shot.click);
    calls = clicked.calls;
    problems.push(...clicked.problems);
  }
  const { requests, errors } = watch;
  if (requests.length) problems.push(`requests beyond the page: ${requests.join(', ')}`);
  if (errors.length) problems.push(`script errors: ${errors.join(' | ')}`);
  return { name: shot.name, png: `${shot.name}.png`, height, requests, errors, calls, problems };
}

function reportLine(report: Report): string {
  const { problems, name, height } = report;
  return `${problems.length ? 'FAIL' : 'ok  '}  ${name}${height ? `  ${height}px` : ''}${problems.length ? `  ${problems.join('; ')}` : ''}`;
}

async function main(argv: readonly string[]): Promise<number> {
  const flag = (name: string) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const out = path.resolve(flag('--out') ?? 'views-shots');
  await mkdir(out, { recursive: true });
  const browser = await launchVisualChrome(flag('--chrome') ?? DEFAULT_CHROME);
  const watch: Watch = { page: null, requests: [], errors: [], children: new Set() };
  browser.cdp.on((event) => recordEvent(browser, watch, event));
  await prepareChrome(browser);

  const reports: Report[] = [];
  try {
    for (const shot of await shots()) {
      const report = await runShot(browser, watch, out, shot, reports.length + 1);
      reports.push(report);
      console.log(reportLine(report));
    }
  } finally {
    watch.page = null;
    await browser.close();
  }
  await writeFile(path.join(out, 'report.json'), `${JSON.stringify({ resourceMeta: VIEW_RESOURCE_META, shots: reports }, null, 2)}\n`);
  return reports.some((r) => r.problems.length) ? 1 : 0;
}

process.exitCode = await main(process.argv.slice(2));
