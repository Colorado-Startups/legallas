// SPDX-License-Identifier: Apache-2.0
// The site build, on invented metrics only: every page gets built, and the result passes the publish guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGE_GROUPS, PAGES, PUBLIC_PAGES } from '../contract/pages.ts';
import { buildSite, frameWords, readHistory } from './build.ts';
import { countWords, guardSite, SYNTHETIC_MARK } from './guard.ts';

const NOW = new Date('2026-11-01T12:00:00Z');
const example = readFileSync(new URL('../contract/example/manifest.json', import.meta.url), 'utf8');

async function inSite(run: (dirs: { pages: string; state: string; out: string }) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), 'qs-build-'));
  const dirs = { pages: path.join(dir, 'pages'), state: path.join(dir, 'state'), out: path.join(dir, 'out') };
  try {
    mkdirSync(path.join(dirs.pages, 'code'), { recursive: true });
    writeFileSync(path.join(dirs.pages, 'code', 'manifest.json'), example);
    mkdirSync(path.join(dirs.state, 'records'), { recursive: true });
    await run(dirs);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a synthetic build makes every page, marks itself, and the guard refuses it unless told', async () => {
  await inSite(async ({ pages, out }) => {
    await buildSite({ pagesDir: pages, state: null, out, now: NOW });
    for (const page of PUBLIC_PAGES) assert.ok(existsSync(path.join(out, page, 'index.html')), page);
    for (const page of PAGES.filter((p) => !PUBLIC_PAGES.includes(p))) assert.equal(existsSync(path.join(out, page)), false, `${page} is private`);
    assert.deepEqual(guardSite(out, { allowSynthetic: true }), []);
    assert.ok(readFileSync(path.join(out, 'index.html'), 'utf8').includes(SYNTHETIC_MARK));
    assert.match(guardSite(out).join(), /invented numbers/);
    assert.match(readFileSync(path.join(out, 'code', 'index.html'), 'utf8'), /total 100 of 100/);
    assert.match(readFileSync(path.join(out, 'sec', 'index.html'), 'utf8'), /no data, scores 0/);
    assert.match(readFileSync(path.join(out, 'sec', 'index.html'), 'utf8'), /<h1>Securities and Exchange Commission<\/h1>/);
  });
});

test('a real build scores from the records, shows a bad record as missing, and passes the guard', async () => {
  await inSite(async ({ pages, state, out }) => {
    const history = { at: '2026-10-31T08:37:00Z', page: 'code', quality: 40, speed: 20, total: 33 };
    writeFileSync(path.join(state, 'history.jsonl'), `${JSON.stringify(history)}\n${JSON.stringify({ ...history, at: 'x' })}\n`);
    writeFileSync(path.join(state, 'records', 'code.json'), JSON.stringify([{ id: 'line_coverage', title: 'a bad record' }]));
    await buildSite({ pagesDir: pages, state, out, now: NOW });
    assert.deepEqual(guardSite(out), []);
    const code = readFileSync(path.join(out, 'code', 'index.html'), 'utf8');
    assert.match(code, /total 0 of 100/);
    assert.match(code, />missing</);
    assert.doesNotMatch(code, />measured</);
    assert.match(readFileSync(path.join(out, 'index.html'), 'utf8'), /data-src="history\.json"/);
    assert.equal((JSON.parse(readFileSync(path.join(out, 'history.json'), 'utf8')) as unknown[]).length, 1);
  });
});

test("a renamed page's old history lines read under its new slug", async () => {
  await inSite(async ({ state }) => {
    const old = { at: '2026-11-08T08:00:00Z', page: 'documentation', quality: 43, speed: 49, consumption: 48, total: 46 };
    writeFileSync(path.join(state, 'history.jsonl'), `${JSON.stringify(old)}\n${JSON.stringify({ ...old, page: 'no-such-page' })}\n`);
    assert.deepEqual(readHistory(state), [{ ...old, page: 'repo-documentation' }]);
  });
});

test('a page opens with its ideal state and sources, and a missing or bad ideal.json shows the red tile', async () => {
  const ideal = readFileSync(new URL('../contract/example/ideal.json', import.meta.url), 'utf8');
  await inSite(async ({ pages, out }) => {
    writeFileSync(path.join(pages, 'code', 'ideal.json'), ideal);
    mkdirSync(path.join(pages, 'testing'));
    writeFileSync(path.join(pages, 'testing', 'ideal.json'), JSON.stringify({ ...JSON.parse(ideal), ideal: '<b>bold</b>' }));
    // The example's newest source is dated 2026-11-03, so the clock is after it.
    await buildSite({ pagesDir: pages, state: null, out, now: new Date('2026-11-04T12:00:00Z') });
    assert.deepEqual(guardSite(out, { allowSynthetic: true, pagesDir: pages }), []);
    const code = readFileSync(path.join(out, 'code', 'index.html'), 'utf8');
    for (const caption of ['Ideal state', 'Sources']) assert.match(code, new RegExp(`<caption class="qs-sr">${caption}</caption>`));
    for (const part of ['Ideal', 'Quality', 'Speed', 'Consumption']) assert.match(code, new RegExp(`>${part}</td>`));
    assert.match(code, /href="https:\/\/developers\.cloudflare\.com\/workers\/platform\/limits\/">1\. Cloudflare Workers limits</);
    assert.match(code, /href="https:\/\/google\.github\.io\/eng-practices\/review\/reviewer\/looking-for\.html">2\. Google Engineering/);
    assert.match(code, />2026-10-29</);
    assert.doesNotMatch(code, /blob\/main\/quality-speed\/pages\/code\/ideal\.json/);
    assert.match(guardSite(out, { allowSynthetic: true, pagesDir: path.join(pages, 'none') }).join(), /code\/index\.html: links outside this repository/, 'only the ideal.json that lists a source allows it');
    assert.ok(code.indexOf('Ideal state') < code.indexOf('Metrics'));
    assert.doesNotMatch(code, /is-missing/);
    mkdirSync(path.join(pages, 'issues'));
    writeFileSync(path.join(pages, 'issues', 'ideal.json'), '{"ideal": "not closed"');
    for (const page of ['testing', 'sec', 'issues']) {
      const html = readFileSync(path.join(out, page, 'index.html'), 'utf8');
      assert.match(html, /qs-tile is-missing"><span class="qs-tile-label">Ideal state</);
      assert.doesNotMatch(html, /bold/);
    }
  });
});

test("frameWords is what the build adds around a page's body, with and without an ideal", async () => {
  const ideal = readFileSync(new URL('../contract/example/ideal.json', import.meta.url), 'utf8');
  const now = new Date('2026-11-04T12:00:00Z');
  await inSite(async ({ pages, out }) => {
    mkdirSync(path.join(pages, 'issues'));
    writeFileSync(path.join(pages, 'issues', 'ideal.json'), ideal);
    writeFileSync(path.join(pages, 'issues', 'manifest.json'), example.replace('"page": "code"', '"page": "issues"'));
    await buildSite({ pagesDir: pages, state: null, out, now });
    const words = (page: string) => countWords(readFileSync(path.join(out, page, 'index.html'), 'utf8').split('<body>')[1] ?? '');
    // A signed-off page with no page.ts shows only tables, so its words are its frame's alone.
    for (const page of ['code', 'issues'] as const) assert.equal(words(page), frameWords(page, pages, now), page);
    assert.ok(words('testing') <= frameWords('testing', pages, now), 'a page with no list shows no ring key, so fewer');
    assert.equal(frameWords('issues', pages, now), frameWords('code', pages, now) - 2, 'a valid ideal drops the red tile\'s two words (its status word is a label)');
  });
});

test('a signed-off page with no consumption metric fails its check, so it shows no data and scores 0', async () => {
  await inSite(async ({ pages, out }) => {
    const noUse = JSON.parse(example);
    noUse.page = 'testing';
    noUse.metrics = noUse.metrics.filter((m: { lens: string }) => m.lens !== 'consumption');
    mkdirSync(path.join(pages, 'testing'));
    writeFileSync(path.join(pages, 'testing', 'manifest.json'), JSON.stringify(noUse));
    await buildSite({ pagesDir: pages, state: null, out, now: NOW });
    assert.deepEqual(guardSite(out, { allowSynthetic: true }), []);
    const testing = readFileSync(path.join(out, 'testing', 'index.html'), 'utf8');
    assert.match(testing, /no data, scores 0/, 'every other metric at goal, and still 0');
    assert.doesNotMatch(testing, /line_coverage/, 'a list that fails its check shows none of its metrics');
    assert.doesNotMatch(readFileSync(path.join(out, 'code', 'index.html'), 'utf8'), /tile-label">Consumption</);
    assert.doesNotMatch(readFileSync(path.join(out, 'sec', 'index.html'), 'utf8'), /tile-label">Consumption</, 'a page with no list has nothing to flag yet');
    assert.equal(frameWords('testing', pages, NOW), frameWords('code', pages, NOW) + 1, 'the tile is one more word (its status word is a label)');
  });
});

test('a page can only write under safe names, so it cannot overwrite another page', async () => {
  for (const output of ["pages: { '../code/index': 'x' }", "data: { '../../outside': 1 }", "pages: { 'a.b': 'x' }", "data: { '': 1 }"]) {
    await inSite(async ({ pages, out }) => {
      writeFileSync(path.join(pages, 'code', 'page.ts'), `export const render = () => ({ body: '', ${output} });`);
      await assert.rejects(buildSite({ pagesDir: pages, state: null, out, now: NOW }), /on-demand file's name/);
    });
  }
});

test('a build refuses an output folder with anything in it', async () => {
  await inSite(async ({ pages, out }) => {
    mkdirSync(out);
    writeFileSync(path.join(out, 'old.json'), '{}');
    await assert.rejects(buildSite({ pagesDir: pages, state: null, out, now: NOW }), /--out must be empty/);
  });
});

test('a long list with no page code stays in a table, and an unsigned one shows nothing yet', async () => {
  await inSite(async ({ pages, out }) => {
    const lens = (i: number) => (i === 0 ? 'speed' : i === 1 ? 'consumption' : 'quality');
    const metrics = Array.from({ length: 150 }, (_, i) => ({ id: `some_long_metric_name_${i}`, lens: lens(i), unit: 'pass', direction: 'higher', floor: 0, goal: 1, weight: 1, max_age_hours: 48, min_samples: 1, goal_source: 'https://example.com/goal' }));
    writeFileSync(path.join(pages, 'code', 'manifest.json'), JSON.stringify({ page: 'code', signoff_comment: 9, metrics, changes: [] }));
    mkdirSync(path.join(pages, 'issues'));
    writeFileSync(path.join(pages, 'issues', 'manifest.json'), JSON.stringify({ page: 'issues', metrics, changes: [] }));
    await buildSite({ pagesDir: pages, state: null, out, now: NOW });
    assert.deepEqual(guardSite(out, { allowSynthetic: true }), []);
    assert.match(readFileSync(path.join(out, 'code', 'index.html'), 'utf8'), /some_long_metric_name_149/);
    assert.doesNotMatch(readFileSync(path.join(out, 'issues', 'index.html'), 'utf8'), /some_long_metric_name/);
  });
});

test("a page's own code gives the body and its drill-down data", async () => {
  await inSite(async ({ pages, out }) => {
    writeFileSync(path.join(pages, 'code', 'page.ts'), `export const render = (c) => ({ body: '<p id="own">' + c.metrics.length + ' ' + c.others.code.total + ' ' + c.others.sec.total + '</p>', data: { drill: [1] }, pages: { panels: '<p id="panel">x</p>' } });`);
    await buildSite({ pagesDir: pages, state: null, out, now: NOW });
    assert.match(readFileSync(path.join(out, 'code', 'index.html'), 'utf8'), /<p id="own">7 100 0<\/p>/);
    assert.equal(readFileSync(path.join(out, 'code', 'drill.json'), 'utf8'), '[1]');
    assert.match(readFileSync(path.join(out, 'code', 'panels.html'), 'utf8'), /Content-Security-Policy[\s\S]*<p id="panel">x<\/p>/);
    assert.deepEqual(guardSite(out, { allowSynthetic: true }), []);
  });
});

const BUILD = fileURLToPath(new URL('./build.ts', import.meta.url));

/** The build command with a page planted, as CI and the daily run call it. */
function fenced(pageCode: string, extra: Record<string, string> = {}, env: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'qs-fence-'));
  const pages = path.join(dir, 'pages');
  const out = path.join(dir, 'out');
  const outside = path.join(dir, 'outside.txt');
  try {
    writeFileSync(outside, 'an outside file');
    mkdirSync(path.join(pages, 'code'), { recursive: true });
    for (const [name, text] of Object.entries({ 'page.ts': pageCode, ...extra })) writeFileSync(path.join(pages, 'code', name), text.replaceAll('OUTSIDE', outside));
    const result = spawnSync(process.execPath, [BUILD, '--synthetic', '--pages', pages, '--out', out], { encoding: 'utf8', env: { ...process.env, ...env } });
    const page = path.join(out, 'code', 'index.html');
    return { code: result.status, errors: result.stderr, page: existsSync(page) ? readFileSync(page, 'utf8') : '' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SHOWS = (expression: string) => `export const render = () => ({ body: '<p id="got">' + (${expression}) + '</p>' });`;

test('a page reaching outside the fence stops the build, and nothing of it is published', () => {
  const cases: [string, RegExp, string, Record<string, string>?][] = [
    ['fs with no spaces', /FileSystemRead/, `import{readFileSync}from'node:fs';${SHOWS("readFileSync('OUTSIDE','utf8')")}`],
    ['fs from a collector it imports', /FileSystemRead/, `import{got}from'./collect.ts';${SHOWS('got')}`, { 'collect.ts': "import{readFileSync}from'node:fs';export const got=readFileSync('OUTSIDE','utf8');" }],
    ['a dynamic import', /FileSystemRead/, `const fs=await import/**/('node:fs');${SHOWS("fs.readFileSync('OUTSIDE','utf8')")}`],
    ['a name built from pieces', /FileSystemRead/, SHOWS("global['pro'+'cess'].getBuiltinModule('fs').readFileSync('OUTSIDE','utf8')")],
    ['a helper in another file type', /FileSystemRead/, `import{got}from'./helper.mjs';${SHOWS('got')}`, { 'helper.mjs': "import{readFileSync}from'node:fs';export const got=readFileSync('OUTSIDE','utf8');" }],
    ['writing outside the output', /FileSystemWrite/, `import{writeFileSync}from'node:fs';writeFileSync('OUTSIDE','changed');${SHOWS('1')}`],
    ['a child process', /ChildProcess/, `import{execFileSync}from'node:child_process';${SHOWS("execFileSync('/bin/cat',['OUTSIDE'])")}`],
    ['a worker', /WorkerThreads/, `import{Worker}from'node:worker_threads';new Worker('OUTSIDE');${SHOWS('1')}`],
  ];
  for (const [label, permission, code, extra] of cases) {
    const result = fenced(code, extra);
    assert.notEqual(result.code, 0, label);
    assert.match(result.errors, /ERR_ACCESS_DENIED/, label);
    assert.match(result.errors, permission, label);
    assert.match(result.errors, /outside\.txt|ChildProcess|WorkerThreads/, label);
    assert.ok(!result.page.includes('an outside file'), label);
  }
});

test('a page inside the fence builds, with an empty environment', () => {
  const result = fenced(SHOWS("(process.env.PROBE_TOKEN ?? 'no token') + ' ' + Object.keys(process.env).filter((k) => k === 'PATH' || k === 'HOME').length"), {}, { PROBE_TOKEN: 'a-secret-value' });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.page, /<p id="got">no token 0<\/p>/);
});

test('the fenced command writes the same site, and refuses an output folder with anything in it', () => {
  const clean = fenced(SHOWS("'fine'"));
  assert.equal(clean.code, 0, clean.errors);
  assert.match(clean.page, /<p id="got">fine<\/p>/);
  const dir = mkdtempSync(path.join(tmpdir(), 'qs-fence-'));
  try {
    writeFileSync(path.join(dir, 'old.json'), '{}');
    const result = spawnSync(process.execPath, [BUILD, '--synthetic', '--out', dir], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--out must be empty/);
    assert.notEqual(spawnSync(process.execPath, [BUILD], { encoding: 'utf8' }).status, 0, 'no output named');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the change log is its own page, so it never spends the first view's bytes", async () => {
  await inSite(async ({ pages, out }) => {
    const manifest = JSON.parse(example) as { changes: unknown[] };
    const change = { date: '2026-11-01', metric: 'retired_metric_xyz', field: 'retired', from: null, to: null, reason: 'superseded', issue: 1, signoff_comment: 2 };
    manifest.changes = Array.from({ length: 200 }, () => change);
    writeFileSync(path.join(pages, 'code', 'manifest.json'), JSON.stringify(manifest));
    await buildSite({ pagesDir: pages, state: null, out, now: NOW });
    const index = readFileSync(path.join(out, 'code', 'index.html'), 'utf8');
    assert.match(index, /href="changes\.html"/);
    assert.doesNotMatch(index, /retired_metric_xyz/);
    assert.equal(readFileSync(path.join(out, 'code', 'changes.html'), 'utf8').match(/<tr>/g)?.length, 201, 'a header row and every change');
    assert.ok(!existsSync(path.join(out, 'sec', 'changes.html')), 'a page with no changes gets no change log');
    assert.deepEqual(guardSite(out, { allowSynthetic: true }), []);
  });
});

test('a page cannot take the change log\'s name for its own page', async () => {
  await inSite(async ({ pages, out }) => {
    writeFileSync(path.join(pages, 'code', 'page.ts'), `export const render = () => ({ body: '', pages: { changes: '<p>x</p>' } });`);
    await assert.rejects(buildSite({ pagesDir: pages, state: null, out, now: NOW }), /change log/);
  });
});

test('no public page shows a dollar figure, from records, detail or committed files', async () => {
  // The real pages over an empty state: what a page shows when its records are missing and its detail is gone, so
  // committed baselines and constants are what renders. Law pages may quote a legal amount, so they are left out.
  const dir = mkdtempSync(path.join(tmpdir(), 'qs-dollars-'));
  const state = path.join(dir, 'state');
  const out = path.join(dir, 'out');
  mkdirSync(path.join(state, 'records'), { recursive: true });
  try {
    await buildSite({ pagesDir: fileURLToPath(new URL('../pages', import.meta.url)), state, out, now: NOW });
    const law: readonly string[] = PAGE_GROUPS.law;
    const shown = PUBLIC_PAGES.filter((page) => !law.includes(page)).filter((page) => {
      const html = readFileSync(path.join(out, page, 'index.html'), 'utf8');
      // A figure, not the word: an ideal may say a job costs as few dollars as it can.
      return /\$\s?\d|\d\s?(?:usd|dollars?)\b/i.test(html.replace(/<script\b[\s\S]*?<\/script>/g, ''));
    });
    assert.deepEqual(shown, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
