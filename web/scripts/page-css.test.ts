// SPDX-License-Identifier: Apache-2.0
// One stylesheet per page (#204): a page's stylesheets joined in their order, the originals left as links the browser
// neither fetches nor applies, so Vite's lazy loader never adds one again out of order.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JOINED_TYPE, joinPageCss } from './page-css.ts';

const FILES: Record<string, string> = {
  '/_astro/room.css': '.a{color:red}',
  '/_astro/page.css': '.a{color:blue}',
  '/_astro/viewer.css': '.b{background:url(./icon.svg)}',
  '/_astro/charset.css': '@charset "utf-8";.c{}',
  '/_astro/imports.css': '@import url(./x.css);.d{}',
  '/_astro/namespace.css': '@namespace svg url(http://www.w3.org/2000/svg);.e{}',
};
const read = (url: string) => FILES[url];
const link = (href: string, extra = '') => `<link rel="stylesheet" href="${href}"${extra}>`;
const page = (head: string) => `<!doctype html><html><head><meta charset="utf-8">${head}<script type="module" src="/_astro/s.js"></script></head><body>${link('/_astro/late.css')}</body></html>`;
const linked = (html: string) => [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"( type="([^"]+)")?>/g)].map((m) => [m[1], m[3] ?? 'css']);

test('a page links one stylesheet holding its files in the order it linked them', () => {
  const joined = joinPageCss(page(link('/_astro/room.css') + link('/_astro/page.css') + link('/_astro/viewer.css')), read)!;
  assert.equal(joined.css, '.a{color:red}\n.a{color:blue}\n.b{background:url(./icon.svg)}', 'later files still win');
  assert.deepEqual(joined.joined, ['/_astro/room.css', '/_astro/page.css', '/_astro/viewer.css']);
  assert.match(joined.href, /^\/_astro\/page\.[A-Za-z0-9_-]{10}\.css$/, 'beside the files it joins, so relative urls still resolve');
  const head = joined.html.slice(0, joined.html.indexOf('</head>'));
  assert.deepEqual(linked(head), [
    [joined.href, 'css'],
    ['/_astro/room.css', JOINED_TYPE],
    ['/_astro/page.css', JOINED_TYPE],
    ['/_astro/viewer.css', JOINED_TYPE],
  ]);
  assert.ok(head.indexOf(joined.href) < head.indexOf('<script'), 'where the first stylesheet was');
});

test('the joined file name follows its content, so pages with the same stylesheets share it', () => {
  const one = joinPageCss(page(link('/_astro/room.css') + link('/_astro/page.css')), read)!;
  const two = joinPageCss(page(link('/_astro/room.css') + link('/_astro/page.css')), read)!;
  const other = joinPageCss(page(link('/_astro/page.css') + link('/_astro/room.css')), read)!;
  assert.equal(one.href, two.href);
  assert.notEqual(one.href, other.href, 'another order is another cascade');
});

test('the left-behind links are stylesheet links of a type that is not CSS, which Vite\'s loader sees and the browser skips', () => {
  assert.notEqual(JOINED_TYPE.toLowerCase(), 'text/css');
  // Vite's preload helper skips a CSS file any <link rel="stylesheet"> already names, by rel and href alone. If a Vite
  // upgrade starts reading the type too, this fails, and the lazy viewers would add their CSS a second time.
  const vite = readFileSync(new URL('../node_modules/vite/dist/node/chunks/node.js', import.meta.url), 'utf8');
  assert.match(vite, /if \(link\.rel === "stylesheet"\) preloadedHrefs\.styles\.add\(link\.href\);/);
  assert.match(vite, /if \(\(isCss \? preloadedHrefs\.styles : preloadedHrefs\.all\)\.has\(dep\.href\)\) return;/);
});

test('a page with one stylesheet, or none, is left alone', () => {
  assert.equal(joinPageCss(page(link('/_astro/room.css')), read), null);
  assert.equal(joinPageCss(page(''), read), null);
});

test('only plain same-origin stylesheets in the head are joined', () => {
  const files: Record<string, string> = { ...FILES, '/_astro/print.css': '.p{}', '/welcome/door.css': '.w{}' };
  const read2 = (url: string) => files[url];
  const html = page(link('/_astro/room.css') + link('/_astro/page.css') + link('/_astro/print.css', ' media="print"') + link('/welcome/door.css'));
  const joined = joinPageCss(html, read2)!;
  assert.deepEqual(joined.joined, ['/_astro/room.css', '/_astro/page.css'], 'a media query, or a file outside /_astro/, keeps its own link');
  const order = [...joined.html.matchAll(/<link rel="stylesheet" href="([^"]+)"[^>]*>/g)].map((m) => m[1]);
  assert.deepEqual(order.slice(-3), ['/_astro/print.css', '/welcome/door.css', '/_astro/late.css'], 'and stays after the joined rules, where it was');
  assert.match(joined.html, /<body><link rel="stylesheet" href="\/_astro\/late\.css"><\/body>/, 'a link in the body is not touched');
});

test('a stylesheet left alone between two joined ones leaves the page as built, so no rule moves past it', () => {
  const files: Record<string, string> = { ...FILES, '/_astro/print.css': '.p{}', '/welcome/door.css': '.w{}' };
  for (const between of [link('/_astro/print.css', ' media="print"'), link('/welcome/door.css'), link('/_astro/room.css', ' crossorigin')]) {
    assert.equal(joinPageCss(page(link('/_astro/room.css') + between + link('/_astro/page.css')), (url) => files[url]), null, between);
  }
});

test('a link inside an HTML comment is neither joined nor counted', () => {
  const joined = joinPageCss(page(link('/_astro/room.css') + `<!-- ${link('/welcome/door.css')} -->` + link('/_astro/page.css')), read)!;
  assert.deepEqual(joined.joined, ['/_astro/room.css', '/_astro/page.css']);
  assert.equal(joinPageCss(page(link('/_astro/room.css') + `<!-- ${link('/_astro/page.css')} -->`), read), null);
});

test('a missing file, or one with @charset, @import or @namespace, leaves the page as it was', () => {
  for (const odd of ['/_astro/gone.css', '/_astro/charset.css', '/_astro/imports.css', '/_astro/namespace.css']) {
    assert.equal(joinPageCss(page(link('/_astro/room.css') + link(odd)), read), null, odd);
  }
});

test('the build joins every page, before the dist audit checks the output', () => {
  const config = readFileSync(new URL('../astro.config.mjs', import.meta.url), 'utf8');
  const list = /integrations: \[([^\]]*)\]/.exec(config)?.[1] ?? '';
  const join = list.indexOf('pageCss()');
  assert.ok(join >= 0 && join < list.indexOf('distAudit()'), list);
});
