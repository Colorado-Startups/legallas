// SPDX-License-Identifier: Apache-2.0
// /doc/ asks for its document from <head> (#918), read from a built page and its scripts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDocEarly } from './dist-doc-early.ts';

const files: Record<string, string> = {
  '/_astro/boot.js': 'document.documentElement.dataset.js="1";',
  '/_astro/early.js': 'import{s}from"./open.js";s(location);',
  '/_astro/page.js': 'import{m}from"./open.js";import"./other.js";m();',
  '/_astro/open.js': 'export const s=e=>fetch(`/api/doc/${encodeURIComponent(e)}`),m=()=>1;',
  '/_astro/other.js': 'export const o=1;',
};
const read = (url: string) => files[url];
const script = (name: string) => `<script type="module" src="/_astro/${name}.js"></script>`;
const page = (head: string, body: string) => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const problems = (html: string, route = '/doc/') => checkDocEarly('doc/index.html', route, html, read).map((f) => f.problem);

test('/doc/ passes when its first script that asks /api/doc/ is in <head>', () => {
  assert.deepEqual(problems(page(script('boot') + script('early'), script('page'))), []);
});

test('the early script out of <head> fails, naming it; with no early script the page script asks first and fails', () => {
  const found = problems(page(script('boot'), script('early') + script('page')));
  assert.equal(found.length, 1);
  assert.match(found[0]!, /\/_astro\/early\.js, is not in <head>/);
  assert.match(problems(page(script('boot'), script('page')))[0]!, /\/_astro\/page\.js, is not in <head>/);
});

test('a modulepreload or a commented script in <head> runs nothing, and a page with no ask fails', () => {
  const preload = '<link rel="modulepreload" href="/_astro/early.js"><!-- <script src="/_astro/early.js"></script> -->';
  assert.equal(problems(page(script('boot') + preload, script('page'))).length, 1);
  assert.deepEqual(problems(page(script('boot'), '')), ['no script asks /api/doc/']);
});

test('other routes are not checked', () => {
  assert.deepEqual(problems(page('', script('page')), '/documents/'), []);
});
