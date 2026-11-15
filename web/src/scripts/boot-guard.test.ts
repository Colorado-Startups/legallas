// SPDX-License-Identifier: Apache-2.0
// The boot guard: it hears only this build's own scripts failing, trades a page's Loading line for its error block
// only while that line still shows, reloads at most once in a short window, and stays importable with no imports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GUIDE_EVENT as BUS_EVENT } from './guide-bus.ts';
import {
  GUIDE_EVENT, isBuildScript, RELOAD_KEY, RELOAD_WINDOW_MS, reloadOnce, showLoadFailed, stillLoading, type LoadHooks,
  type ReloadStore,
} from './boot-guard.ts';

const ORIGIN = 'https://room.example';
const WEB = join(import.meta.dirname, '..', '..');

test('a failed /_astro/ module script on this origin is a build script; anything else is not', () => {
  const script = (src: string) => ({ tagName: 'SCRIPT', src });
  assert.equal(isBuildScript(script(`${ORIGIN}/_astro/index.astro_astro_type_script_index_0_lang.Ed1DoGRH.js`), ORIGIN), true);
  assert.equal(isBuildScript(script(`${ORIGIN}/_astro/matter-api.DOn-3zUM.js`), ORIGIN), true);
  assert.equal(isBuildScript(script('https://elsewhere.example/_astro/x.js'), ORIGIN), false, 'another origin');
  assert.equal(isBuildScript(script(`${ORIGIN}/pdfjs/pdf.worker.mjs`), ORIGIN), false, 'not a build chunk');
  assert.equal(isBuildScript(script(''), ORIGIN), false, 'an inline script has no src');
  assert.equal(isBuildScript(script('not a url'), ORIGIN), false);
  assert.equal(isBuildScript({ tagName: 'IMG', src: `${ORIGIN}/_astro/seal.svg` }, ORIGIN), false, 'an image is not a script');
  assert.equal(isBuildScript({ tagName: 'LINK', href: `${ORIGIN}/_astro/a.css` }, ORIGIN), false);
  for (const none of [null, undefined, windowLike()]) assert.equal(isBuildScript(none, ORIGIN), false);
});

/** What event.target is for an uncaught script error: the window, which is no script. */
function windowLike(): unknown {
  return { addEventListener() {}, location: { origin: ORIGIN } };
}

/** A stand-in document: the page's Loading line and error block, as flags. */
function page(pending: boolean[], failed: boolean[] = [true]): LoadHooks & { pending: { hidden: boolean }[]; failed: { hidden: boolean }[] } {
  const p = pending.map((hidden) => ({ hidden }));
  const f = failed.map((hidden) => ({ hidden }));
  return {
    pending: p,
    failed: f,
    querySelectorAll: (selector: string) => (selector === '[data-load-pending]' ? p : selector === '[data-load-failed]' ? f : []),
  };
}

test('stillLoading is true only while a declared Loading line shows', () => {
  assert.equal(stillLoading(page([false])), true);
  assert.equal(stillLoading(page([true])), false, 'the page script hid it: the page drew itself');
  assert.equal(stillLoading(page([])), false, 'a page without the hooks');
});

test('giving up trades the Loading line for the error block, and only while the page is still loading', () => {
  const stuck = page([false], [true]);
  assert.equal(showLoadFailed(stuck), true);
  assert.deepEqual(stuck.pending.map((el) => el.hidden), [true]);
  assert.deepEqual(stuck.failed.map((el) => el.hidden), [false]);

  const drawn = page([true], [true]);
  assert.equal(showLoadFailed(drawn), false, 'a page that drew itself is never covered by an error');
  assert.deepEqual(drawn.failed.map((el) => el.hidden), [true]);

  assert.equal(showLoadFailed(page([], [])), false, 'no hooks, nothing to do');
});

/** A stand-in with a busy region (the Overview's header holds its filled height while aria-busy). */
function busyPage(drawn: boolean) {
  const pending = { hidden: drawn };
  const failed = { hidden: true };
  const region = { hidden: false, busy: 'true', setAttribute(name: string, value: string) { if (name === 'aria-busy') this.busy = value; } };
  const doc: LoadHooks = {
    querySelectorAll: (selector) =>
      selector === '[data-load-pending]' ? [pending]
        : selector === '[data-load-failed]' ? [failed]
          : selector === '[aria-busy="true"]' && region.busy === 'true' ? [region] : [],
  };
  return { doc, failed, region };
}

test('giving up ends the busy regions, so the error is read and a reserved height lets go', () => {
  const stuck = busyPage(false);
  assert.equal(showLoadFailed(stuck.doc), true);
  assert.equal(stuck.failed.hidden, false);
  assert.equal(stuck.region.busy, 'false');

  const drawn = busyPage(true);
  assert.equal(showLoadFailed(drawn.doc), false);
  assert.equal(drawn.region.busy, 'true', 'a page that drew itself keeps its own aria-busy');
});

test("the guard's guide event is the bus's, written out so the guard imports nothing", () => {
  assert.equal(GUIDE_EVENT, BUS_EVENT);
});

test('the guard imports nothing at run time, so its chunk keeps its name from build to build', () => {
  const source = readFileSync(join(WEB, 'src/scripts/boot-guard.ts'), 'utf8');
  const imports = source.split('\n').filter((line) => /^\s*import\b/.test(line) || /\bimport\(/.test(line));
  assert.deepEqual(imports.filter((line) => !/^\s*import type\b/.test(line)), [], 'type-only imports are erased');
});

test('Room.astro loads the guard first, in <head>, before any other script', () => {
  const room = readFileSync(join(WEB, 'src/layouts/Room.astro'), 'utf8');
  const head = room.slice(room.indexOf('<head>'), room.indexOf('</head>'));
  assert.match(head, /<script src="\.\.\/scripts\/boot-guard\.ts"><\/script>/);
  const scripts = [...room.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(scripts[0], '../scripts/boot-guard.ts');
});

test('every page shell with a guarded Loading line also has the error block the guard shows', () => {
  const pages = join(WEB, 'src/pages');
  const shells = readdirSync(pages, { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.astro'));
  const guarded = shells.filter((name) => readFileSync(join(pages, name), 'utf8').includes('data-load-pending'));
  assert.deepEqual(guarded.sort(), [
    'chronology/index.astro', 'claims/index.astro', 'complaint/index.astro', 'documents/index.astro', 'index.astro',
    'people/index.astro', 'regulator/index.astro',
  ]);
  for (const name of guarded) {
    const source = readFileSync(join(pages, name), 'utf8');
    assert.match(source, /data-load-pending[^>]*role="status"|role="status"[^>]*data-load-pending/, `${name}: the Loading line`);
    assert.match(source, /data-load-failed[^>]*\bhidden\b/, `${name}: the error block, hidden until needed`);
  }
});

/** The opening tag in `source` that carries `attr`, or ''. */
function tagWith(source: string, attr: string): string {
  return new RegExp(`<[a-z]+\\b[^>]*\\b${attr}\\b[^>]*>`).exec(source)?.[0] ?? '';
}

// The Overview, Chronology and Documents: the hooks the guard flips are the ones each page script settles, so the
// guard (no script ran) and settle() (the script ran and failed) end on the same error line.
const SETTLED = [
  { page: 'index.astro', script: 'overview-news.ts', loading: 'data-ov-loading', error: 'data-ov-failed' },
  { page: 'chronology/index.astro', script: 'chronology.ts', loading: 'data-chron-loading', error: 'data-chron-error' },
  { page: 'documents/index.astro', script: 'documents-table.ts', loading: 'data-docs-loading', error: 'data-docs-error' },
] as const;

test("each page script settles the guard's own hooks: it hides the Loading line and owns the error block", () => {
  for (const { page: name, script, loading, error } of SETTLED) {
    const shell = readFileSync(join(WEB, 'src/pages', name), 'utf8');
    assert.match(tagWith(shell, 'data-load-pending'), new RegExp(`\\b${loading}\\b`), `${name}: the Loading line is ${loading}`);
    assert.match(tagWith(shell, 'data-load-failed'), new RegExp(`\\b${error}\\b`), `${name}: the error block is ${error}`);
    assert.ok(shell.includes(`../scripts/${script}`) || shell.includes(`../../scripts/${script}`), `${name} loads ${script}`);
    const source = readFileSync(join(WEB, 'src/scripts', script), 'utf8');
    assert.match(source, /import \{[^}]*\bsettle\b[^}]*\} from '\.\/page-load\.ts'/, `${script} settles its load`);
    for (const hook of [loading, error]) assert.ok(source.includes(hook), `${script} shows or hides ${hook}`);
  }
});

test("the Overview's static frame steps aside while its error line shows, so zero counts never pass for news", () => {
  const css = readFileSync(join(WEB, 'src/styles/overview-news.css'), 'utf8');
  assert.match(css, /main:has\(\[data-ov-failed\]:not\(\[hidden\]\)\) \.ov-news \{\s*display: none;/);
  const shell = readFileSync(join(WEB, 'src/pages/index.astro'), 'utf8');
  assert.match(tagWith(shell, 'data-ov-failed'), /class="ov-case__note"/, 'the error line sits under the caption');
  assert.match(tagWith(shell, 'data-overview-caption'), /aria-busy="true"/, 'the header the guard releases');
});

/** sessionStorage as a Map; `fail` makes a call throw the way blocked or full storage does. */
function store(initial?: string, fail: { get?: boolean; set?: boolean } = {}): ReloadStore & { data: Map<string, string> } {
  const data = new Map<string, string>(initial === undefined ? [] : [[RELOAD_KEY, initial]]);
  return {
    data,
    getItem: (key) => {
      if (fail.get) throw new DOMException('The operation is insecure.', 'SecurityError');
      return data.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (fail.set) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      data.set(key, value);
    },
  };
}

const NOW = 1_790_000_000_000;

test('the first failure in a tab reloads, and records the time before it does', () => {
  const tab = store();
  assert.equal(reloadOnce(tab, NOW), true);
  assert.equal(tab.data.get(RELOAD_KEY), String(NOW));
});

test('a second failure inside the window shows the error line instead: no reload loop', () => {
  const tab = store();
  assert.equal(reloadOnce(tab, NOW), true);
  assert.equal(reloadOnce(tab, NOW + 1), false, 'the reloaded page failing at once');
  assert.equal(reloadOnce(tab, NOW + RELOAD_WINDOW_MS - 1), false);
  assert.equal(tab.data.get(RELOAD_KEY), String(NOW), 'a refusal writes nothing');
});

test('after the window a tab left open can heal itself again, on a later deploy', () => {
  const tab = store(String(NOW));
  assert.equal(reloadOnce(tab, NOW + RELOAD_WINDOW_MS), true);
  assert.equal(tab.data.get(RELOAD_KEY), String(NOW + RELOAD_WINDOW_MS));
  assert.equal(reloadOnce(tab, NOW + 3 * 24 * 3_600_000), true, 'days later');
});

test('without working storage there is never a reload: nothing could stop a loop', () => {
  assert.equal(reloadOnce(null, NOW), false, 'sessionStorage switched off');
  assert.equal(reloadOnce(store(undefined, { get: true }), NOW), false, 'reading throws');
  const full = store(undefined, { set: true });
  assert.equal(reloadOnce(full, NOW), false, 'writing throws: the reloaded page could not tell it was reloaded');
  assert.equal(full.data.size, 0);
});

test('a time it cannot read, or one ahead of now, counts as a reload just made', () => {
  for (const odd of ['', 'yesterday', '1.5', '-5', '1e12', ' 12', 'NaN', 'Infinity', '9'.repeat(20)]) {
    const tab = store(odd);
    assert.equal(reloadOnce(tab, NOW), false, JSON.stringify(odd));
    assert.equal(tab.data.get(RELOAD_KEY), odd, 'left as found');
  }
  assert.equal(reloadOnce(store(String(NOW + 1)), NOW), false, 'the clock moved back');
  assert.equal(reloadOnce(store('0'), NOW), true, 'a plain old time is readable');
});
