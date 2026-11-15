// SPDX-License-Identifier: Apache-2.0
// Card F9. Screenshots of the LOCAL room in headless Chrome over CDP:
//
//   npm run dev:shoot -- --port <p> <route> [<route>...] [--out <dir>] [--widths 1440,1024,390]
//                        [--variants light,print] [--height 900] [--strict] [--max-shift 0.1] [--chrome <path>]
//
// Each route is shot full-page at every width, on screen and in print (emulated print media), after the network
// goes idle and the fonts load. The room is light only (R67), so the light scheme is emulated for both, with
// reduced motion so nothing is caught mid-animation. Phone widths (under 600) are shot as a mobile device at DPR 2
// (R63). PNGs go to --out (default <repo>/.claude/shots/, kept
// out of git by a .gitignore written there). Console errors, uncaught exceptions, CSP violations and HTTP errors
// are recorded in report.json; any request to a host other than localhost fails the run (--strict also fails
// on the rest). Each shot also records its layout shift while loading (the sum of the page's layout-shift
// entries, as in CLS) and the elements behind its five largest shifts; --max-shift <n> with --strict fails the
// run when an on-screen shot shifts more than n (print shots are left out: print emulation adds noise). Each shot
// records its content width (document.documentElement.scrollWidth); --strict fails the run when an on-screen shot is
// wider than its shot width, a page that scrolls sideways (#292, #308).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CHROME, launch, type Browser, type CdpEvent } from './dev-cdp.ts';
import { REPO_ROOT } from './dev-fixture.ts';

export const VARIANTS = ['light', 'dark', 'print'] as const;
export type Variant = (typeof VARIANTS)[number];
export const DEFAULT_WIDTHS = [1440, 1024, 390];
const IDLE_MS = 500;
const SETTLE_TIMEOUT_MS = 20_000;
const MAX_SHOT_HEIGHT = 16_000;
const MOBILE_BELOW = 600;
const PHONE_DPR = 2;

export interface ShootOptions {
  port: number;
  routes: string[];
  out: string;
  widths: number[];
  variants: Variant[];
  height: number;
  strict: boolean;
  /** The largest on-screen layout shift allowed with --strict; null when --max-shift is not given. */
  maxShift: number | null;
  chrome: string;
}

const USAGE =
  'usage: npm run dev:shoot -- --port <p> <route> [<route>...] [--out <dir>] [--widths 1440,1024,390] [--variants light,print] [--height 900] [--strict] [--max-shift 0.1] [--chrome <path>]';

function list<T>(value: string | undefined, parse: (item: string) => T | null): T[] {
  const items = (value ?? '').split(',').map((item) => parse(item.trim()));
  if (items.length === 0 || items.some((item) => item === null)) throw new Error(USAGE);
  return items as T[];
}

const positiveInt = (text: string) => (/^[1-9]\d{0,4}$/.test(text) ? Number(text) : null);
// A layout shift score: "0", "0.1", "0.025" (a leading digit, at most four places).
const decimal = (text: string) => (/^\d{1,3}(\.\d{1,4})?$/.test(text) ? Number(text) : null);

export function parseShootArgs(args: readonly string[], defaultOut = path.join(REPO_ROOT, '.claude', 'shots')): ShootOptions {
  const options: ShootOptions = {
    port: 0, routes: [], out: defaultOut, widths: DEFAULT_WIDTHS, variants: ['light', 'print'], height: 900, strict: false,
    maxShift: null, chrome: process.env.CHROME_PATH || DEFAULT_CHROME,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const value = () => {
      const next = args[++i];
      if (next === undefined) throw new Error(USAGE);
      return next;
    };
    if (arg === '--port') options.port = positiveInt(value()) ?? 0;
    else if (arg === '--out') options.out = path.resolve(value());
    else if (arg === '--widths') options.widths = list(value(), positiveInt);
    else if (arg === '--variants') options.variants = list(value(), (v) => ((VARIANTS as readonly string[]).includes(v) ? (v as Variant) : null));
    else if (arg === '--height') options.height = positiveInt(value()) ?? 0;
    else if (arg === '--chrome') options.chrome = value();
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--max-shift') options.maxShift = decimal(value()) ?? -1;
    else if (arg.startsWith('/')) options.routes.push(arg);
    else throw new Error(USAGE);
  }
  if (options.port < 1 || options.port > 65535 || options.height < 1 || options.routes.length === 0 || (options.maxShift ?? 0) < 0) {
    throw new Error(USAGE);
  }
  return options;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** True for URLs that stay on this machine: localhost over http(s)/ws(s), or an in-page scheme. */
export function isLocalUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (['data:', 'blob:', 'about:'].includes(parsed.protocol)) return true;
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) return false;
  return LOCAL_HOSTS.has(parsed.hostname) || parsed.hostname.endsWith('.localhost');
}

/** A file-safe name for a route: "/" is "home", "/doc/?id=abc" is "doc-id-abc". */
export function routeSlug(route: string): string {
  const slug = route.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return slug || 'home';
}

export function shotName(route: string, width: number, variant: Variant): string {
  return `${routeSlug(route)}-${width}-${variant}.png`;
}

/**
 * Light unless asked for dark, which only the Quality and Speed site uses, and reduced motion always: a shot shows the
 * page at rest, never mid-transition (the front door's seal draws itself and fades its text in unless motion is reduced).
 */
export function mediaFor(variant: Variant): { media: string; features: { name: string; value: string }[] } {
  return {
    media: variant === 'print' ? 'print' : '',
    features: [{ name: 'prefers-color-scheme', value: variant === 'dark' ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }],
  };
}

/** Device metrics for a width: phones are mobile at DPR 2 (R63), the rest desktop at DPR 1. */
export function metricsFor(width: number, height: number): { width: number; height: number; deviceScaleFactor: number; mobile: boolean } {
  const mobile = width < MOBILE_BELOW;
  return { width, height, deviceScaleFactor: mobile ? PHONE_DPR : 1, mobile };
}

export interface ShotRecord {
  file: string;
  url: string;
  width: number;
  variant: Variant;
  console: string[];
  csp: string[];
  httpErrors: string[];
  external: string[];
  /** Sum of the layout-shift entries without recent input, up to the shot (rounded to four places). */
  layoutShift: number;
  /** Short selectors (tag, id, first class) of the elements behind the five largest shifts, largest first. */
  shiftSources: string[];
  /** document.documentElement.scrollWidth in CSS pixels, read after the page settles. Past `width`, it scrolls sideways. */
  contentWidth: number;
}

// Reports CSP violations through a CDP binding. CDP-injected scripts are not subject to the page's CSP.
export const CSP_PROBE = `document.addEventListener('securitypolicyviolation', (e) => {
  globalThis.__legallasShootCsp?.(JSON.stringify({ directive: e.violatedDirective, blocked: e.blockedURI, source: e.sourceFile, line: e.lineNumber }));
}, true);`;

// Sums layout shifts from the first paint. Sources are named when observed, while the nodes are still in the page.
export const SHIFT_PROBE = `(() => {
  const state = { total: 0, top: [], flush: () => {} };
  const name = (node) => {
    const el = node instanceof Element ? node : node?.parentElement;
    if (!el) return null;
    return el.localName + (el.id ? '#' + el.id : '') + (el.classList[0] ? '.' + el.classList[0] : '');
  };
  const take = (entries) => {
    for (const entry of entries) {
      if (entry.hadRecentInput) continue;
      state.total += entry.value;
      state.top.push({ value: entry.value, sources: (entry.sources ?? []).map((s) => name(s.node)).filter(Boolean) });
      state.top.sort((a, b) => b.value - a.value).splice(5);
    }
  };
  try {
    const observer = new PerformanceObserver((list) => take(list.getEntries()));
    observer.observe({ type: 'layout-shift', buffered: true });
    state.flush = () => take(observer.takeRecords());
  } catch {}
  globalThis.__legallasShootShift = state;
})();`;

// Reads the probe after settle(): takeRecords() first, for shifts the observer has not delivered yet.
const SHIFT_READ = `(() => {
  const state = globalThis.__legallasShootShift;
  if (!state) return { total: 0, sources: [] };
  state.flush();
  return { total: state.total, sources: [...new Set(state.top.flatMap((t) => t.sources))] };
})()`;

export async function readShift(browser: Browser): Promise<Pick<ShotRecord, 'layoutShift' | 'shiftSources'>> {
  const reply = (await browser.cdp.send('Runtime.evaluate', { expression: SHIFT_READ, returnByValue: true }, browser.session)) as {
    result: { value?: { total: number; sources: string[] } };
  };
  const value = reply.result.value ?? { total: 0, sources: [] };
  return { layoutShift: Math.round(value.total * 10_000) / 10_000, shiftSources: value.sources };
}

/** The page's content width in CSS pixels: wider than the viewport when something escapes its scroll region (#292). */
export async function readContentWidth(browser: Browser): Promise<number> {
  const reply = (await browser.cdp.send('Runtime.evaluate', { expression: 'document.documentElement.scrollWidth', returnByValue: true }, browser.session)) as {
    result: { value?: number };
  };
  return reply.result.value ?? 0;
}

export function describeEvent(event: CdpEvent, record: ShotRecord, inflight: Set<string>): void {
  // CDP event params are loosely typed JSON; only the fields read below are relied on.
  const p = event.params as Record<string, any>;
  switch (event.method) {
    case 'Network.requestWillBeSent':
      inflight.add(p.requestId);
      if (!isLocalUrl(p.request.url)) record.external.push(p.request.url);
      break;
    case 'Network.loadingFinished':
    case 'Network.loadingFailed':
      inflight.delete(p.requestId);
      break;
    case 'Network.responseReceived':
      if (p.response.status >= 400) record.httpErrors.push(`${p.response.status} ${p.response.url}`);
      break;
    case 'Runtime.consoleAPICalled':
      if (p.type === 'error' || p.type === 'assert') record.console.push(p.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description ?? '').join(' '));
      break;
    case 'Runtime.exceptionThrown':
      record.console.push(`Uncaught: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`);
      break;
    case 'Log.entryAdded':
      if (p.entry.level === 'error') record.console.push(`${p.entry.source}: ${p.entry.text}`);
      break;
    case 'Runtime.bindingCalled':
      if (p.name === '__legallasShootCsp') record.csp.push(p.payload);
      break;
  }
}

export async function settle(browser: Browser, inflight: Set<string>): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    if (inflight.size > 0) quietSince = Date.now();
    else if (Date.now() - quietSince >= IDLE_MS) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await browser.cdp.send('Runtime.evaluate', {
    expression: 'document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))',
    awaitPromise: true,
  }, browser.session);
}

async function shoot(browser: Browser, route: string, width: number, variant: Variant, options: ShootOptions): Promise<ShotRecord> {
  const { cdp, session } = browser;
  const url = `http://localhost:${options.port}${route}`;
  const record: ShotRecord = {
    file: path.join(options.out, shotName(route, width, variant)), url, width, variant, console: [], csp: [], httpErrors: [], external: [],
    layoutShift: 0, shiftSources: [], contentWidth: 0,
  };
  const inflight = new Set<string>();
  const off = cdp.on((event) => { if (event.sessionId === session) describeEvent(event, record, inflight); });
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', metricsFor(width, options.height), session);
    await cdp.send('Emulation.setEmulatedMedia', mediaFor(variant), session);
    const loaded = new Promise<void>((resolve) => {
      const stop = cdp.on((e) => { if (e.sessionId === session && e.method === 'Page.loadEventFired') { stop(); resolve(); } });
    });
    await cdp.send('Page.navigate', { url }, session);
    await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, SETTLE_TIMEOUT_MS))]);
    await settle(browser, inflight);
    Object.assign(record, await readShift(browser));
    record.contentWidth = await readContentWidth(browser);
    const metrics = (await cdp.send('Page.getLayoutMetrics', {}, session)) as { cssContentSize: { height: number } };
    const height = Math.min(MAX_SHOT_HEIGHT, Math.max(options.height, Math.ceil(metrics.cssContentSize.height)));
    const shot = (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } }, session)) as { data: string };
    await writeFile(record.file, Buffer.from(shot.data, 'base64'));
    return record;
  } finally {
    off();
  }
}

async function prepareOut(out: string): Promise<void> {
  await mkdir(out, { recursive: true });
  const rel = path.relative(REPO_ROOT, out);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) await writeFile(path.join(out, '.gitignore'), '# dev:shoot output, never committed\n*\n');
}

/** Shoots every route, width and variant; returns one record per PNG. */
export async function shootAll(options: ShootOptions, log: (line: string) => void): Promise<ShotRecord[]> {
  await prepareOut(options.out);
  const browser = await launch(options.chrome);
  const records: ShotRecord[] = [];
  try {
    const { cdp, session } = browser;
    for (const domain of ['Page', 'Runtime', 'Network', 'Log']) await cdp.send(`${domain}.enable`, {}, session);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }, session);
    await cdp.send('Runtime.addBinding', { name: '__legallasShootCsp' }, session);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: CSP_PROBE }, session);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: SHIFT_PROBE }, session);
    for (const route of options.routes) {
      for (const width of options.widths) {
        for (const variant of options.variants) {
          const record = await shoot(browser, route, width, variant, options);
          const issues = record.console.length + record.csp.length + record.httpErrors.length + record.external.length;
          const notes = [
            issues ? `${issues} issue${issues === 1 ? '' : 's'}` : '',
            record.layoutShift > 0 ? `shift ${record.layoutShift}` : '',
            widerShots([record]).length > 0 ? `${record.contentWidth} px wide` : '',
          ].filter(Boolean);
          log(`${issues === 0 ? 'ok  ' : 'WARN'} ${record.file}${notes.length ? ` (${notes.join(', ')})` : ''}`);
          records.push(record);
        }
      }
    }
  } finally {
    await browser.close();
  }
  return records;
}

/** The on-screen shots that shift more than the limit. Print shots never count: print emulation adds noise. */
export function shiftedShots(records: readonly ShotRecord[], limit: number): ShotRecord[] {
  return records.filter((r) => r.variant === 'light' && r.layoutShift > limit);
}

/** The on-screen shots whose content is wider than the shot: a page that scrolls sideways. Print shots never count. */
export function widerShots(records: readonly ShotRecord[]): ShotRecord[] {
  return records.filter((r) => r.variant !== 'print' && r.contentWidth > r.width);
}

/**
 * Totals over the records, and whether the run fails: external requests always; the rest, an on-screen shift over
 * shiftLimit (--max-shift) and an on-screen shot wider than its width, only with --strict. maxShift is the largest
 * shift among the on-screen shots; wide counts the shots wider than their width.
 */
export function verdict(records: readonly ShotRecord[], strict: boolean, shiftLimit: number | null = null): { failed: boolean; totals: Record<string, number> } {
  const sum = (key: 'console' | 'csp' | 'httpErrors' | 'external') => records.reduce((n, r) => n + r[key].length, 0);
  const maxShift = Math.max(0, ...records.filter((r) => r.variant === 'light').map((r) => r.layoutShift));
  const wide = widerShots(records).length;
  const totals = { shots: records.length, console: sum('console'), csp: sum('csp'), httpErrors: sum('httpErrors'), external: sum('external'), maxShift, wide };
  const shifted = shiftLimit !== null && shiftedShots(records, shiftLimit).length > 0;
  return { failed: totals.external > 0 || (strict && (totals.console + totals.csp + totals.httpErrors + wide > 0 || shifted)), totals };
}

async function main(): Promise<void> {
  const options = parseShootArgs(process.argv.slice(2));
  const log = (line: string) => process.stdout.write(`${line}\n`);
  const records = await shootAll(options, log);
  const { failed, totals } = verdict(records, options.strict, options.maxShift);
  await writeFile(path.join(options.out, 'report.json'), `${JSON.stringify({ totals, records }, null, 2)}\n`);
  const limit = options.maxShift === null ? '' : ` (limit ${options.maxShift}${options.strict ? '' : ', reported only without --strict'})`;
  log(`\n${totals.shots} shots in ${options.out}; console errors ${totals.console}, CSP violations ${totals.csp}, HTTP errors ${totals.httpErrors}, requests off localhost ${totals.external}, largest layout shift on screen ${totals.maxShift}${limit}, wider than the shot ${totals.wide}.`);
  for (const r of records) for (const url of r.external) log(`  OFF LOCALHOST ${url} (${path.basename(r.file)})`);
  for (const r of widerShots(records)) log(`  WIDE ${r.contentWidth} px at ${r.width} px ${path.basename(r.file)}`);
  if (options.maxShift !== null) {
    for (const r of shiftedShots(records, options.maxShift)) log(`  SHIFT ${r.layoutShift} ${path.basename(r.file)}: ${r.shiftSources.join(', ') || 'no sources named'}`);
  }
  if (failed) {
    log(totals.external > 0 ? 'FAILED: a request left localhost.' : 'FAILED (--strict): see report.json.');
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
