// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { EAGER_BUDGET, entryScripts, pageBudget, staticImports } from './bundle-budget.ts';
import { auditDist, routeOf } from './dist-audit.ts';
import { checkCss, checkHtml, checkJs } from './dist-csp.ts';

const problems = (found: { problem: string }[]) => found.map((f) => f.problem);

test('checkHtml flags inline style, inline script and inline handlers', () => {
  const html = `<html><head><style>p{color:red}</style><script>alert(1)</script></head>
    <body><p style="color:red">x</p><button type="button" onclick="go()">Go</button></body></html>`;
  assert.deepEqual(problems(checkHtml('a.html', html)), [
    'inline <style> element',
    'inline <script> without src',
    'style= attribute on <p>',
    'inline event handler onclick= on <button>',
  ]);
});

test('checkHtml flags remote assets and javascript: URLs, not links to other sites', () => {
  const html = `<script type="module" src="https://cdn.example/x.js"></script>
    <link rel="stylesheet" href="//fonts.example/f.css"><img src="/a.png" srcset="/a.png 1x, https://img.example/b.png 2x">
    <svg><use href="http://sprites.example/s.svg#i"/></svg><iframe src="javascript:void 0"></iframe>
    <a href="https://www.example.com/help">Help</a>`;
  assert.deepEqual(problems(checkHtml('a.html', html)), [
    'remote asset src="https://cdn.example/x.js" on <script>',
    'remote asset href="//fonts.example/f.css" on <link>',
    'remote asset srcset="https://img.example/b.png" on <img>',
    'remote asset href="http://sprites.example/s.svg#i" on <use>',
    'javascript: URL in src= on <iframe>',
  ]);
});

test('checkHtml passes what Astro emits: external scripts and styles, JSON data, SVG namespaces, comments', () => {
  const html = `<!doctype html><html lang="en"><head><link rel="stylesheet" href="/_astro/Room.css">
    <script type="module" src="/_astro/Room.js"></script><script type="application/json" id="d">{"a":1}</script>
    </head><body><!-- <p style="x"> --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><path d="M0 0"/></svg>
    <p data-label='a > b'>The word style= in prose is fine.</p></body></html>`;
  assert.deepEqual(checkHtml('a.html', html), []);
});

test('checkCss flags remote url() and @import, not local files or data URIs', () => {
  const css = `@import url("https://fonts.example/a.css");@import '//cdn.example/b.css';
    .a{background:url(/_astro/x.svg)}.b{mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E")}
    @font-face{src:url(https://fonts.example/c.woff2)}`;
  assert.deepEqual(problems(checkCss('a.css', css)), [
    'remote stylesheet reference https://fonts.example/a.css',
    'remote stylesheet reference https://fonts.example/c.woff2',
    'remote stylesheet reference //cdn.example/b.css',
  ]);
});

test('checkJs flags remote modules and workers, not namespace strings', () => {
  const js = `import{a}from"https://cdn.example/a.js";const n="http://www.w3.org/2000/svg";
    import("https://cdn.example/b.js");new Worker("//cdn.example/w.js");import"./local.js";`;
  assert.deepEqual(problems(checkJs('a.js', js)), [
    'remote module https://cdn.example/a.js',
    'remote module https://cdn.example/b.js',
    'remote module //cdn.example/w.js',
  ]);
});

test('entryScripts reads script src and modulepreload links, skipping remote and commented ones', () => {
  const html = `<script type="module" src="/_astro/a.js"></script><link rel="modulepreload" href="/_astro/b.js">
    <link rel="stylesheet" href="/_astro/c.css"><!-- <script src="/_astro/old.js"></script> -->
    <script src="https://cdn.example/x.js"></script>`;
  assert.deepEqual(entryScripts(html), ['/_astro/a.js', '/_astro/b.js']);
});

test('staticImports keeps static imports and re-exports, never dynamic import()', () => {
  const js = `import{a as b}from"./core.js";import"./side.js";export{c}from"./c.js";export*from"./d.js";
    const p=()=>import("./pdf.js");import ( "./rive.js" );`;
  assert.deepEqual(staticImports(js), ['./core.js', './side.js', './c.js', './d.js']);
});

test('pageBudget sums the static closure once per module and leaves lazy chunks out', () => {
  const files: Record<string, string> = {
    '/_astro/page.js': 'import"./shared.js";import{x}from"../lib/util.js";const l=()=>import("./lazy.js");',
    '/_astro/room.js': 'import"./shared.js";',
    '/_astro/shared.js': 'export const s=1;',
    '/lib/util.js': 'export const x=2;',
    '/_astro/lazy.js': 'x'.repeat(100_000),
  };
  const html = '<script type="module" src="/_astro/page.js"></script><script type="module" src="/_astro/room.js"></script>';
  const budget = pageBudget(html, (url) => files[url]);
  assert.deepEqual(budget.modules.map((m) => m.path), ['/_astro/page.js', '/_astro/room.js', '/_astro/shared.js', '/lib/util.js']);
  assert.equal(budget.total, budget.modules.reduce((sum, m) => sum + m.gzip, 0));
  assert.deepEqual(budget.missing, []);
  assert.deepEqual(pageBudget('<script src="/_astro/gone.js"></script>', () => undefined).missing, ['/_astro/gone.js']);
});

test('routeOf maps built files to the routes they answer', () => {
  assert.equal(routeOf('index.html'), '/');
  assert.equal(routeOf(path.join('chronology', 'index.html')), '/chronology/');
  assert.equal(routeOf('404.html'), '/404.html');
});

test('auditDist passes a clean build and fails an inline script and an over-budget page', () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'legallas-dist-audit-'));
  try {
    mkdirSync(path.join(dist, '_astro'));
    mkdirSync(path.join(dist, 'heavy'));
    writeFileSync(path.join(dist, '_astro', 'room.js'), 'export const r=1;');
    // Random bytes do not compress, so this one module is over the gzipped budget on its own.
    writeFileSync(path.join(dist, '_astro', 'big.js'), `const b="${randomBytes(EAGER_BUDGET).toString('base64')}";`);
    writeFileSync(path.join(dist, 'index.html'), '<script type="module" src="/_astro/room.js"></script>');
    assert.deepEqual(auditDist(dist).findings, []);

    writeFileSync(path.join(dist, 'heavy', 'index.html'), '<script type="module" src="/_astro/big.js"></script><script>x()</script>');
    const audit = auditDist(dist);
    assert.deepEqual(audit.pages.map((p) => p.route), ['/heavy/', '/']);
    const heavy = audit.findings.filter((f) => f.file === path.join('heavy', 'index.html')).map((f) => f.problem);
    assert.equal(heavy.length, 2);
    assert.equal(heavy[0], 'inline <script> without src');
    assert.match(heavy[1], /^eager script \d+\.\d KB gzipped is over the 60\.0 KB budget$/);

    writeFileSync(path.join(dist, '_headers'), '/*\n  Content-Security-Policy: default-src *\n');
    assert.deepEqual(auditDist(dist).findings.filter((f) => f.file === '_headers').length, 1);

    // A page a founder can open says "counsel room" with no data-case-only mark (#218).
    mkdirSync(path.join(dist, 'documents'));
    writeFileSync(path.join(dist, 'documents', 'index.html'), '<main><p>Legallas counsel room</p></main>');
    const words = auditDist(dist).findings.filter((f) => f.file === path.join('documents', 'index.html'));
    assert.equal(words.length, 1);
    assert.match(words[0]!.problem, /^a room with no matter shows "Legallas counsel room"/);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('auditDist fails a /doc/ page whose first ask for its document is not in <head>', () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'legallas-dist-doc-'));
  try {
    mkdirSync(path.join(dist, '_astro'));
    mkdirSync(path.join(dist, 'doc'));
    writeFileSync(path.join(dist, '_astro', 'open.js'), 'export const s=e=>fetch(`/api/doc/${e}`);');
    writeFileSync(path.join(dist, '_astro', 'early.js'), 'import{s}from"./open.js";s(1);');
    const write = (head: string, body: string) => writeFileSync(path.join(dist, 'doc', 'index.html'), `<html><head>${head}</head><body>${body}</body></html>`);
    const doc = () => auditDist(dist, null).findings.filter((f) => f.file === path.join('doc', 'index.html')).map((f) => f.problem);
    write('<script type="module" src="/_astro/early.js"></script>', '');
    assert.deepEqual(doc(), []);
    write('', '<script type="module" src="/_astro/early.js"></script>');
    assert.equal(doc().length, 1);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('the built viewer must read the bridge message by the stored name, once there is a visual page', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dist-audit-'));
  try {
    mkdirSync(path.join(dir, '_astro'));
    writeFileSync(path.join(dir, '_astro', 'viewer.js'), 'function f(e){return typeof e==`object`&&!!e&&e.acme===1}');
    const flagged = (name: string) => auditDist(dir, null, name).findings.filter((found) => found.problem.includes('bridge message')).map((found) => found.file);
    assert.deepEqual(flagged('other'), [], 'no visual page, nothing to read it');
    mkdirSync(path.join(dir, 'visual'));
    writeFileSync(path.join(dir, 'visual', 'index.html'), '<html></html>');
    assert.deepEqual(flagged('acme'), []);
    assert.deepEqual(flagged('other'), ['visual/index.html']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
