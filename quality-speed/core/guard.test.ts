// SPDX-License-Identifier: Apache-2.0
// The publish guard. Each row plants one thing on a good build and expects its own error, and the last tests run the
// command itself, so its exit code is what's proved. Keys are built at run time, so no scanner reads this file as holding one.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES, REPO } from '../contract/pages.ts';
import { buildSite } from './build.ts';
import { countWords, guardSite, MAX_FIRST_VIEW_BYTES, MAX_PROCESS_BYTES, MAX_WORDS, PAGE_END, pageHead, processLink, SITE_CSP, SYNTHETIC_MARK } from './guard.ts';

const GUARD = fileURLToPath(new URL('./guard.ts', import.meta.url));
const NOW = new Date('2026-11-01T12:00:00Z');
const REPO_URL = `https://github.com/Colorado-Startups/${REPO}`;
const page = (body: string) => `${pageHead('Code', '../', true)}${body}${PAGE_END}`;
const words = (n: number) => 'word '.repeat(n);
const key = (prefix: string, length = 40) => `${prefix}${'a'.repeat(length)}`;
const GITHUB_KEY = key(['gh', 'p_'].join(''));

let work = '';
let good = '';

before(async () => {
  work = mkdtempSync(path.join(tmpdir(), 'qs-guard-'));
  good = path.join(work, 'good');
  mkdirSync(path.join(work, 'no-pages'));
  await buildSite({ pagesDir: path.join(work, 'no-pages'), state: null, out: good, now: NOW });
});

after(() => rmSync(work, { recursive: true, force: true }));

/** A good build with these files planted. */
function plant(files: Record<string, string>, prepare?: (site: string) => void) {
  const site = path.join(work, 'site');
  rmSync(site, { recursive: true, force: true });
  cpSync(good, site, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(site, name)), { recursive: true });
    writeFileSync(path.join(site, name), text);
  }
  prepare?.(site);
  return site;
}

/** The guard's problems with a test build holding these files. */
function run(files: Record<string, string>, allowSynthetic = true, prepare?: (site: string) => void) {
  const errors = guardSite(plant(files, prepare), { allowSynthetic, pagesDir: path.join(work, 'no-pages') }).join('\n');
  return { code: errors ? 1 : 0, errors };
}

/** The command, as CI runs it. */
function command(site: string, ...flags: string[]) {
  const result = spawnSync(process.execPath, [GUARD, '--site', site, ...flags], { encoding: 'utf8' });
  return { code: result.status, errors: result.stderr, output: result.stdout };
}

function refuses(label: string, expected: RegExp, files: Record<string, string>, allowSynthetic = true): void {
  const { code, errors } = run(files, allowSynthetic);
  assert.notEqual(code, 0, label);
  assert.match(errors, expected, label);
}

test('the rules a page relies on are the agreed ones', () => {
  assert.equal(SITE_CSP, "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'");
  assert.equal(MAX_WORDS, 80);
  assert.equal(MAX_FIRST_VIEW_BYTES, 100_000);
});

test('a good build passes, with every allowed kind of link and file', () => {
  const links = ['#a', '../', './', './#a', '../sync/', 'other.html', 'other.html#a', 'data.json', `${REPO_URL}/actions/runs/1`, `${REPO_URL}/pull/2`].map((href) => `<a href="${href}">x</a>`).join('');
  const { code, errors } = run({ 'code/other.html': page(`${links}<img src="frames/citation-to-page.webp" alt="x"/><p>a &amp; b &lt; c &gt; d &quot;e&quot; f&#39;s</p><script type="application/json">{"a":1}</script>`), 'code/data.json': `{"url":"${REPO_URL}/issues/1"}` });
  assert.equal(errors, '');
  assert.equal(code, 0);
});

test('a test build needs its flag, and the flag takes only a test build', () => {
  assert.equal(run({}).code, 0);
  refuses('no flag', /invented numbers/, {}, false);
  refuses('one real page with the flag', /a real page in a test build/, { 'code/x.html': page('x').replace(SYNTHETIC_MARK, '') });
});

test('only the files the build writes pass', () => {
  for (const name of ['a.webp', 'code/a.webp', 'a.svg', 'code/a.svg', 'notes.md', 'code/a.csv', 'code/deep/a.json', 'blog/index.html', 'code/A.json', 'code/a_b.json', 'code/a.b.json', 'x.json', '.hidden', `code/${key('sk-or-v1-', 24)}.json`]) {
    refuses(name, /a file is not on the list/, { [name]: name.endsWith('.json') ? '{}' : 'x' });
  }
  refuses('a chart file changed', /charts\.js: differs from the source/, { 'charts.js': 'fetch("https://example.com")' });
  refuses('a style file changed', /site\.css: differs from the source/, { 'site.css': 'a{}' });
});

test('a site missing a page, or holding a symlink, fails', () => {
  const removed = (file: string) => run({}, true, (site) => rmSync(path.join(site, file), { recursive: true }));
  for (const file of ['index.html', 'history.json', 'charts.js', 'code', 'code/index.html']) assert.match(removed(file).errors, /always writes is missing/, file);
  const linked = run({}, true, (site) => symlinkSync(path.join(site, 'site.css'), path.join(site, 'code', 'link.json')));
  assert.match(linked.errors, /not a plain file/);
});

test('only the head the build writes passes', () => {
  const head = pageHead('Code', '../', true);
  const cases: [string, string][] = [
    ['no policy', `<!doctype html><html><head></head><body>x${PAGE_END}`],
    ['another policy', page('x').replace(SITE_CSP, `${SITE_CSP}; script-src 'unsafe-inline'`)],
    ['a commented-out policy', page('x').replace('<meta http-equiv', '<!-- <meta http-equiv').replace('form-action \'none\'">', 'form-action \'none\'"> -->')],
    ['a refresh in the head', page('x').replace('<title>', '<meta http-equiv="refresh" content="0;url=all.html"><title>')],
    ['an extra script', page('x').replace('</head>', '<script src="x.js"></script></head>')],
    ['a page at the wrong depth', page('x').replaceAll('../', '')],
    ['nothing after the body', head],
  ];
  for (const [label, html] of cases) refuses(label, /the head is not the build's/, { 'code/x.html': html });
});

test('anything in the body that is not on the lists fails', () => {
  const element = /an element is not on the list/;
  const attribute = /an attribute is not on the list/;
  const unread = /markup the guard can't read/;
  const cases: [string, RegExp][] = [
    ['<script>x()</script>', element],
    ['<script src="a.js"></script>', element],
    ['<script data-src="x"></script>', element],
    ['<script type="application/json" data-x="1">{}</script>', element],
    ['<style>a{}</style>', element],
    ['<iframe src="x"></iframe>', element],
    ['<object></object>', element],
    ['<base href="x">', element],
    ['<form></form>', element],
    ['<meta http-equiv="refresh" content="0;url=all.html">', element],
    ['<link rel="stylesheet" href="x.css">', element],
    ['<svg><foreignObject></foreignObject></svg>', unread],
    ['<svg><use></use></svg>', element],
    ['<svg><image></image></svg>', element],
    ['<a onclick="x()">a</a>', attribute],
    ['<a ONCLICK="x()">a</a>', attribute],
    ['<div style="x:y">a</div>', attribute],
    ['<a srcdoc="x">a</a>', attribute],
    ['<svg/onload=x()>', unread],
    ['<a title=">" onclick="x()">a</a>', unread],
    ['<a title=\'x\'>a</a>', unread],
    ['<a href=x>a</a>', unread],
    ['<a  href="x">a</a>', unread],
    ['<A HREF="x">a</A>', unread],
    ['<a\thref="x">a</a>', unread],
    ['<p title=a"id>id=<a/href=https:&#47;&#47;example.com/x>id=x">', unread],
    ['<!-- a comment -->', unread],
    ['<?php x ?>', unread],
    ['<a href="x', unread],
    ['5 > 3', unread],
    ['<script type="application/json">{not json}</script>', /not valid JSON/],
    ['<script type="application/json">"x</SCRIPT><a href=https:&#47;&#47;example.com/x>go</a><script type=application/json>"</script>', element],
    ['<script type="application/json">"</script>x"</script>', /not valid JSON/],
    ['<script type="application/json">"<!--<script>"</script>', element],
    ['&#104;ello', /an entity the guard can't read/],
    ['&#x68;ello', /an entity the guard can't read/],
    ['&colon;', /an entity the guard can't read/],
    ['&sol;&sol;example.com', /an entity the guard can't read/],
    ['a & b', /an entity the guard can't read/],
  ];
  for (const [body, expected] of cases) refuses(body, expected, { 'code/x.html': page(body) });
});

test('a link is only a local name or this repository, written plainly', () => {
  for (const href of [
    'https://example.com/',
    `${REPO_URL}`,
    `${REPO_URL}/../../evil/x`,
    `${REPO_URL}/a%2e%2e/x`,
    `${REPO_URL}/a?b=1`,
    `https://github.com/Colorado-Startups/${REPO}-other/`,
    'https://x@example.com/',
    'https://a_b.example.com/',
    'https:\\\\example.com/',
    '/\\example.com/',
    '//example.com/',
    '/code/',
    '../../code/',
    'mailto:x@example.com',
    'javascript:x()',
    'java&#115;cript:x()',
    'data:text/html,x',
    'a b.html',
    '',
  ]) {
    refuses(href, /links outside this repository/, { 'code/x.html': page(`<a href="${href}">x</a>`) });
    refuses(`data-src ${href}`, /links outside this repository/, { 'code/x.html': page(`<div data-src="${href}">x</div>`) });
  }
  for (const src of ['https://example.com/a.webp', 'data:image/png;base64,AAAA', 'frames/../a.webp', '../frames/a.webp', 'frames/a.png', 'a.webp', 'frames/doe-says-the-founder-took-money.webp', `frames/${'a'.repeat(30)}.webp`]) {
    refuses(src, /an image is not a frame/, { 'code/x.html': page(`<img src="${src}">`) });
  }
  refuses('src on another element', /an image is not a frame/, { 'code/x.html': page('<div src="frames/a.webp">x</div>') });
});

test('a link hiding in text or data fails, and a label that only looks like one passes', () => {
  for (const text of ['https://example.com/', 'https://x@example.com/', 'https://a_b.example.com/', 'https:\\\\example.com/', '/\\example.com/', '//example.com/', 'mailto:x@example.com', 'javascript:x()', 'data:text/html,x', `${REPO_URL}/../../evil/x`]) {
    refuses(`json ${text}`, /links outside this repository/, { 'code/x.json': JSON.stringify(text) });
    refuses(`text ${text}`, /links outside this repository/, { 'code/x.html': page(`<p>${text}</p>`) });
  }
  refuses('a JSON escape', /links outside this repository/, { 'code/x.json': '"https:\\u002f\\u002fexample.com"' });
  refuses('an escape in a data block', /links outside this repository/, { 'code/x.html': page('<script type="application/json">"https:\\u002f\\u002fexample.com"</script>') });
  for (const label of ['Data: 5', 'File: 3', 'Tel: 4', 'Agreed data: 40']) assert.equal(run({ 'code/x.html': page(`<p>${label}</p>`) }).errors, '', label);
});

test("a page links outside only to a source its own valid ideal.json lists, exactly as listed", () => {
  const listed = 'https://developers.cloudflare.com/workers/platform/limits/';
  const query = 'https://docs.example.org/guide?a=1&b=2';
  const pages = path.join(work, 'source-pages');
  const ideal = JSON.parse(readFileSync(new URL('../contract/example/ideal.json', import.meta.url), 'utf8')) as object;
  const source = (url: string, date = '2026-10-29') => ({ title: 'A source', url, date });
  // sync's only source is dated after today, so its ideal.json is invalid and lists nothing.
  for (const [slug, sources] of [['code', [source(listed), source(query)]], ['sync', [source(listed, '2099-01-01')]]] as const) {
    mkdirSync(path.join(pages, slug), { recursive: true });
    writeFileSync(path.join(pages, slug, 'ideal.json'), JSON.stringify({ ...ideal, sources }));
  }
  const check = (files: Record<string, string>) => guardSite(plant(files), { allowSynthetic: true, pagesDir: pages }).join('\n');
  const link = (href: string) => page(`<a href="${href}">x</a><p>${href}</p>`);
  const escaped = query.replace('&', '&amp;');
  assert.equal(check({ 'code/other.html': link(listed), 'code/more.html': link(escaped), 'code/data.json': JSON.stringify({ url: query }) }), '');
  for (const [label, files] of [
    ['an unlisted link', { 'code/other.html': link('https://example.com/') }],
    ['a listed link with more after it', { 'code/other.html': link(`${listed}#x`) }],
    ['a listed link, differently escaped', { 'code/other.html': link(query.replace('&', '&#38;')) }],
    ["another page's source", { 'issues/other.html': link(listed) }],
    ['a source in an invalid ideal.json', { 'sync/other.html': link(listed) }],
    ['the home page', { 'index.html': `${pageHead('Home', '', true)}<a href="${listed}">x</a>${PAGE_END}` }],
    ['a listed link as an image source', { 'code/other.html': page(`<div data-src="${listed}">x</div>`) }],
  ] as const) assert.match(check(files), /links outside this repository/, label);
  const site = plant({ 'code/other.html': link(listed) });
  assert.equal(command(site, '--allow-synthetic', '--pages', pages).code, 0, 'the command reads --pages');
  assert.match(command(site, '--allow-synthetic', '--pages', path.join(work, 'no-pages')).errors, /code\/other\.html: links outside this repository/);
});

test('secrets fail, encoded or not', () => {
  const secrets = [
    GITHUB_KEY,
    key(['github', '_pat_'].join('')),
    key(['sk', '-ant-'].join('')),
    key(['sk-or', '-v1-'].join('')),
    key(['hf', '_'].join('')),
    key(['gsk', '_'].join('')),
    key(['npm', '_'].join('')),
    key(['AI', 'za'].join('')),
    ['AK', 'IA', 'A'.repeat(16)].join(''),
    ['AS', 'IA', 'A'.repeat(16)].join(''),
    ['xo', 'xb-', 'a'.repeat(20)].join(''),
    ['-----BEGIN RSA', ' PRIVATE KEY'].join(''),
    ['ey', 'Jabcdefghijkl.ey', 'Jabc'].join(''),
    Buffer.from(GITHUB_KEY).toString('base64'),
    'x'.repeat(65),
  ];
  for (const secret of secrets) {
    refuses(`json ${secret.slice(0, 8)}`, /looks like a secret/, { 'code/x.json': JSON.stringify(secret) });
    refuses(`html ${secret.slice(0, 8)}`, /looks like a secret/, { 'code/x.html': page(`<p>${secret}</p>`) });
  }
  refuses('a JSON escape', /looks like a secret/, { 'code/x.json': JSON.stringify(GITHUB_KEY).replace('_', '\\u005f') });
  refuses('a duplicate key in a file', /looks like a secret/, { 'code/x.json': `{"a":${JSON.stringify(GITHUB_KEY)},"a":1}` });
  refuses('a duplicate key in a data block', /looks like a secret/, { 'code/x.html': page(`<script type="application/json">{"a":${JSON.stringify(GITHUB_KEY)},"a":1}</script>`) });
  refuses('in the title', /looks like a secret/, { 'code/x.html': `${pageHead(GITHUB_KEY, '../', true)}x${PAGE_END}` });
  refuses('a link in the title', /links outside this repository/, { 'code/x.html': `${pageHead('https://example.com/', '../', true)}x${PAGE_END}` });
  refuses('prose in the title', /holds prose/, { 'code/x.html': `${pageHead(words(26), '../', true)}x${PAGE_END}` });
  refuses('an entity in the title', /an entity the guard can't read/, { 'code/x.html': `${pageHead('&#104;', '../', true)}x${PAGE_END}` });
  refuses('a numeric entity', /an entity the guard can't read/, { 'code/x.html': page(`<p>&#103;${GITHUB_KEY.slice(1)}</p>`) });
});

test('what can hold case content fails, in any file the site serves', () => {
  for (const name of ['proposal_events', 'PROPOSAL_EVENTS', 'audit_log', 'audit/coverage-1.json', 'ask-eval-report', 'scripts/coverage', 'mcp/audit', 'replica-eval', 'ask-replica']) {
    refuses(`json ${name}`, /names something never published/, { 'code/x.json': JSON.stringify(name) });
    refuses(`html ${name}`, /names something never published/, { 'code/x.html': page(`<p>${name}</p>`) });
  }
});

test('the word and size budgets hold, and prose fails wherever it sits', () => {
  refuses('words on a first view', /81 visible words/, { 'code/index.html': page(`<p>${words(20)}</p>`.repeat(4) + `<p>${words(1)}</p>`) });
  const names = '<span class="qs-ring-name">Some page</span>'.repeat(100);
  assert.equal(run({ 'index.html': `${pageHead('Quality and Speed', '', true)}${`<p>${words(10)}</p>`.repeat(7)}${names}${PAGE_END}` }).errors, '', 'the home page lists any number of pages');
  refuses('ring names on a page', /270 visible words/, { 'code/index.html': page(`${`<p>${words(10)}</p>`.repeat(7)}${names}`) });
  const stale = '<span class="qs-state-word">Stale</span>'.repeat(30);
  assert.equal(run({ 'code/index.html': page(`<p>${words(20)}</p>`.repeat(4) + stale) }).errors, '', 'status words on stale readings');
  refuses('other words in a status span', /110 visible words/, { 'code/index.html': page(`<p>${words(20)}</p>`.repeat(4) + '<span class="qs-state-word">Stale now</span>'.repeat(15)) });
  refuses('words on an on-demand page', /81 visible words/, { 'code/all.html': page(`<p>${words(20)}</p>`.repeat(4) + `<p>${words(1)}</p>`) });
  for (const [label, word] of [['Cyrillic', 'слово '], ['joined by apostrophes', "a'"], ['joined by hyphens', 'a-'], ['in one long run', '字'.repeat(20)]] as const) {
    refuses(label, /visible words/, { 'code/all.html': page(`<p>${word.repeat(20)}</p>`.repeat(5)) });
  }
  refuses('a big first view', /first view is/, { 'code/index.html': page(`<div>${'1 '.repeat(MAX_FIRST_VIEW_BYTES / 2)}</div>`) });
  assert.equal(run({ 'code/big.html': page(`<div>${'1 '.repeat(MAX_FIRST_VIEW_BYTES / 2)}</div>`) }).code, 0, 'an on-demand page has no size budget');
  for (const [label, body] of [
    ['in a table', `<table><tr><td>${words(26)}</td></tr></table>`],
    ['in closed details', `<details><summary>x</summary>${words(26)}</details>`],
    ['in a filmstrip', `<section class="qs-film">${words(26)}</section>`],
    ['for screen readers', `<span class="qs-sr">${words(26)}</span>`],
    ['in an attribute', `<div title="${words(26)}">x</div>`],
    ['in a data block', `<script type="application/json">["${words(26)}"]</script>`],
  ] as const) {
    refuses(label, /holds prose/, { 'code/x.html': page(body) });
  }
  refuses('in a JSON value', /holds prose/, { 'code/x.json': JSON.stringify({ a: [{ b: words(26) }] }) });
  refuses('in a JSON key', /holds prose/, { 'code/x.json': JSON.stringify({ [words(26)]: 1 }) });
  refuses('broken JSON', /not valid JSON/, { 'code/x.json': '{' });
});

test('the command passes a clean build and fails each way, so its exit code can be trusted', () => {
  const stripMarks = (site: string) => {
    for (const file of ['index.html', ...PAGES.map((slug) => `${slug}/index.html`)]) {
      writeFileSync(path.join(site, file), readFileSync(path.join(site, file), 'utf8').replace(SYNTHETIC_MARK, ''));
    }
  };
  const testBuild = plant({});
  const passed = command(testBuild, '--allow-synthetic');
  assert.equal(passed.code, 0, passed.errors);
  assert.match(passed.output, /passed/);
  const invented = command(testBuild);
  assert.equal(invented.code, 1);
  assert.match(invented.errors, /invented numbers/);

  const real = plant({}, stripMarks);
  const published = command(real);
  assert.equal(published.code, 0, published.errors);
  const realInTest = command(real, '--allow-synthetic');
  assert.equal(realInTest.code, 1);
  assert.match(realInTest.errors, /a real page in a test build/);

  assert.equal(spawnSync(process.execPath, [GUARD], { encoding: 'utf8' }).status, 1, 'no site named');
});

test('the command fails on every kind of problem at once, with nothing printed but rules and allowed names', () => {
  const secretName = key(['hf', '_'].join(''));
  const site = plant({
    [`${secretName}.webp`]: GITHUB_KEY,
    'a.svg': '<svg onload="x()"></svg>',
    'code/key.json': JSON.stringify(GITHUB_KEY),
    'code/link.json': JSON.stringify('https://x@example.com/'),
    'code/never.json': JSON.stringify('audit/coverage-1.json'),
    'code/prose.json': JSON.stringify(words(26)),
    'code/script.html': page('<script data-src="x"></script>'),
    'code/head.html': page('x').replace('<title>', '<meta http-equiv="refresh" content="0;url=all.html"><title>'),
    'code/all.html': page(`<p>${words(20)}</p>`.repeat(4) + `<p>${words(1)}</p>`),
    'code/entity.html': page('&#104;'),
    'code/block.html': page('<script type="application/json">"x</SCRIPT><a href=https:&#47;&#47;example.com/x>go</a><script type=application/json>"</script>'),
    'code/duplicate.json': `{"a":${JSON.stringify(GITHUB_KEY)},"a":1}`,
    'code/title.html': `${pageHead(GITHUB_KEY, '../', true)}x${PAGE_END}`,
    'charts.js': 'changed',
  });
  const result = command(site, '--allow-synthetic');
  assert.equal(result.code, 1);
  for (const rule of [/a file is not on the list/, /code\/key\.json: looks like a secret/, /code\/link\.json: links outside/, /code\/never\.json: names something never published/, /code\/prose\.json: holds prose/, /code\/script\.html: an element/, /code\/head\.html: the head/, /code\/all\.html: 81 visible words/, /code\/entity\.html: an entity/, /code\/block\.html: an element/, /code\/duplicate\.json: looks like a secret/, /code\/title\.html: looks like a secret/, /charts\.js: differs/]) {
    assert.match(result.errors, rule);
  }
  assert.ok(!result.errors.includes(secretName), 'a refused file name stays out of the log');
  assert.ok(!result.errors.includes(GITHUB_KEY), 'a secret stays out of the log');
});

test('only words a person sees count, and numbers do not', () => {
  assert.equal(countWords('one two 3 40 <b>five</b> &amp;'), 3);
  assert.equal(countWords('one<table><tr><td>not this</td></tr></table><details>nor this</details><span class="qs-sr">nor this</span><section class="qs-film">nor this</section><script type="application/json">{"nor":"this"}</script>'), 1);
  assert.equal(countWords('<details open>one two<details>not this</details></details>'), 2);
  assert.equal(countWords('слово кот'), 2);
  assert.equal(countWords(`don't ${'a'.repeat(41)}`), 5);
  assert.equal(countWords('12 min, 3 s, 720 h, 40 KB'), 0, 'a unit after its number is part of the reading');
  assert.equal(countWords('min s h'), 3, 'a unit with no number is a word');
  const road = (name: string) => `<li class="qs-road-row"><label class="qs-road-name"><input type="checkbox"><span>${name}</span></label> +4</li>`;
  assert.equal(countWords(road('Lane in 5 min') + road('Dead code')), 0, 'a short Road to 100 name is a label');
  assert.equal(countWords(road('one two three four five')), 5, 'a long one counts');
  assert.equal(countWords('<span class="qs-road-name"><svg><path d="M0"/></svg><span>No fix yet</span></span>'), 0, 'the gap row');
});

test('the Process page passes with its own links, and fails each rule its folder has', () => {
  const html = `<!doctype html><html><head><style>a{}</style><script>let n = 1;</script></head><body><a href="${REPO_URL}/blob/main/CLAUDE.md">rule</a> <a href="https://github.com/SoulCraft-Org/git-crafter/blob/main/maps.json">map</a> <a href="https://trunkbaseddevelopment.com/short-lived-feature-branches/">TBD</a> <span title="${REPO_URL}/actions/runs/1; read 2026-11-05">x</span></body></html>`;
  assert.equal(run({ 'process/index.html': html }).errors, '');
  assert.match(run({ 'process/index.html': `${html}<a href="https://example.com/">x</a>` }).errors, /process\/index\.html: links outside this repository/);
  assert.match(run({ 'process/index.html': `${html}${GITHUB_KEY}` }).errors, /process\/index\.html: looks like a secret/);
  assert.match(run({ 'process/index.html': `${html}audit_log` }).errors, /process\/index\.html: names something never published/);
  assert.match(run({ 'process/index.html': 'a'.repeat(MAX_PROCESS_BYTES + 1) }).errors, new RegExp(`process/index\\.html: ${MAX_PROCESS_BYTES + 1} bytes`));
  const big = run({ 'process/index.html': `${'<p>1 2</p>'.repeat(MAX_PROCESS_BYTES / 10)}<a href="https://example.com/">x</a>` }).errors;
  assert.match(big, /bytes, the limit is/);
  assert.match(big, /links outside this repository/, 'a big file is still scanned');
  const start = Date.now();
  assert.match(run({ 'process/index.html': `${'a'.repeat(MAX_PROCESS_BYTES)}https://example.com/` }).errors, /links outside this repository/, 'a scheme after a long run');
  assert.ok(Date.now() - start < 5000, 'a long run of letters scans in linear time');
  for (const name of ['process/run.sh', 'process/Index.html', 'process/../x.html', 'process/.hidden.js']) {
    assert.match(run({ [name]: 'x' }).errors, /site: a file is not on the list/, name);
  }
});

test('a Process link is plain https to a listed host, or one of the two repositories', () => {
  for (const ok of ['https://docs.github.com/en/actions', 'https://dora.dev/guides/', 'https://sre.google/sre-book/', 'https://claude.dev/blog/solving-code-review-at-anthropic/', 'https://google.github.io/eng-practices/review/', 'https://trunkbaseddevelopment.com', `${REPO_URL}/actions/runs/1;`, 'https://github.com/SoulCraft-Org/git-crafter/blob/main/pages/maps/README.md']) assert.ok(processLink(ok), ok);
  for (const bad of ['http://code.claude.com/', 'https://code.claude.com:8443/', 'https://user@code.claude.com/', 'https://code.claude.com.example.com/', 'https://github.com/someone/else', 'https://github.com/SoulCraft-Org/git-crafter/../x', 'javascript:alert(1)', '//code.claude.com/']) assert.ok(!processLink(bad), bad);
});

test('every link the Process maps cite passes, so a new host fails its own PR, not the publish', () => {
  const dir = fileURLToPath(new URL('../process/', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.includes('maps.json'));
  for (const file of files) {
    for (const url of readFileSync(path.join(dir, file), 'utf8').match(/https?:\/\/[^\s"'<>)]+/g) ?? []) assert.ok(processLink(url), `${file}: ${url}`);
  }
});
