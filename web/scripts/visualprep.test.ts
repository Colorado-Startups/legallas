// SPDX-License-Identifier: Apache-2.0
// Preparing a page for the room: links, remote resources, the bridge, and what must never change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { BRIDGE_MARKER, BRIDGE_SCRIPT, joinRelative, prepareVisual, rewriteHref, type PageRef } from '../worker/visualprep.ts';
import { planExport } from './visuals.ts';

/** A bridge script's body: the one leading <script> and trailing </script> its builder wraps it in, sliced off. */
function scriptBody(tagged: string): string {
  const open = '<script>';
  const close = '</script>';
  let body = tagged;
  if (body.startsWith(open)) body = body.slice(open.length);
  if (body.endsWith(close)) body = body.slice(0, -close.length);
  return body;
}

const artifactUrl = (path: string) => `https://${'claude.ai'}/${path}`;
const PAGE: PageRef = { artifact: 'Hub1', path: 'index.html' };
const known: Record<string, string> = {
  'Hub1/index.html': 'hub',
  'Hub1/money.html': 'hub-money',
  'Other2/index.html': 'other',
};
const resolve = (page: PageRef) => known[`${page.artifact}/${page.path}`] ?? null;

test('links to other artifacts and sibling pages become binder slugs', () => {
  assert.deepEqual(rewriteHref(artifactUrl('artifact/Other2'), PAGE, resolve), { href: '#legallas=other' });
  assert.deepEqual(rewriteHref(artifactUrl('code/artifact/Other2/'), PAGE, resolve), { href: '#legallas=other' });
  assert.deepEqual(rewriteHref('money.html', PAGE, resolve), { href: '#legallas=hub-money' });
  assert.deepEqual(rewriteHref('./money.html?x=1#top', PAGE, resolve), { href: '#legallas=hub-money' });
  assert.deepEqual(rewriteHref('#section-2', PAGE, resolve), { href: '#section-2' });
});

test('unknown pages and odd schemes become inert, with a warning', () => {
  assert.equal(rewriteHref(artifactUrl('artifact/Nope'), PAGE, resolve).href, '#legallas-missing');
  assert.equal(rewriteHref('goal.html', PAGE, resolve).href, '#legallas-missing');
  assert.equal(rewriteHref('../../escape.html', PAGE, resolve).href, '#legallas-missing');
  const js = rewriteHref('javascript:alert(1)', PAGE, resolve);
  assert.equal(js.href, '#legallas-missing');
  assert.match(js.warning ?? '', /javascript/);
});

test('web links go through the room, entities decoded', () => {
  const out = rewriteHref('https://example.org/a?x=1&amp;y=2', PAGE, resolve);
  assert.equal(out.href, `#legallas-out=${encodeURIComponent('https://example.org/a?x=1&y=2')}`);
});

test('joinRelative stays inside the artifact', () => {
  assert.equal(joinRelative('a/b.html', '../c.html'), 'c.html');
  assert.equal(joinRelative('index.html', '../x.html'), null);
  assert.equal(joinRelative('index.html', 'x/./y.html'), 'x/y.html');
});

const SOURCE = `<!doctype html><html><head>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X">
<style>.a{background:url(#hatch)} a[href="x.html"]{color:red}</style></head><body>
<a class="nv" href="${artifactUrl('artifact/Other2')}" target="_blank" rel="noopener">Other</a>
<a href='money.html'>Money</a> <svg><use href="#i-doc"/></svg>
<script>var t = '<a href="money.html">' + x + '</a>'; el.href = "goal.html";</script>
</body></html>`;

test('prepareVisual rewrites markup, strips remote fonts, and injects the bridge once', () => {
  const { html, warnings } = prepareVisual(SOURCE, PAGE, resolve);
  assert.doesNotMatch(html, /fonts\.googleapis/);
  assert.match(html, /<a class="nv" href="#legallas=other" rel="noopener">Other<\/a>/);
  assert.match(html, /<a href="#legallas=hub-money">Money<\/a>/);
  assert.match(html, /<use href="#i-doc"\/>/);
  assert.doesNotMatch(html, /target=/);
  // Script and style bodies are byte-for-byte untouched.
  assert.match(html, /var t = '<a href="money\.html">' \+ x \+ '<\/a>'; el\.href = "goal\.html";/);
  assert.match(html, /a\[href="x\.html"\]\{color:red\}/);
  assert.equal(html.split(BRIDGE_MARKER).length, 2);
  assert.ok(html.indexOf(BRIDGE_MARKER) < html.lastIndexOf('</body>'));
  assert.deepEqual(warnings, []);

  const again = prepareVisual(html, PAGE, resolve);
  assert.equal(again.html, html);
});

test('cites stay as written and the bridge posts them', () => {
  assert.deepEqual(rewriteHref('#legallas-cite=DOE-000412@3', PAGE, resolve), { href: '#legallas-cite=DOE-000412@3' });
  const { html } = prepareVisual('<body><a class="cite" href="#legallas-cite=DOE-000412@3">DOE-000412 at 3</a></body>', PAGE, resolve);
  assert.match(html, /href="#legallas-cite=DOE-000412@3"/);
  assert.match(html, /type:'cite',ref:decodeURIComponent\(h\.slice\(15\)\)/);
});

test('an older bridge script is swapped for the current one, once', () => {
  const old = `<script>/* ${BRIDGE_MARKER} */(function(){var p=window.parent;/* older bridge */})();</script>`;
  const { html } = prepareVisual(`<body><p>x</p>${old}\n</body>`, PAGE, resolve);
  assert.doesNotMatch(html, /older bridge/);
  assert.equal(html.split(BRIDGE_MARKER).length, 2);
  assert.match(html, /#legallas-cite=/);
  assert.equal(prepareVisual(html, PAGE, resolve).html, html);
});

test('remote images are reported, not silently kept', () => {
  const { warnings } = prepareVisual('<body><img src="https://example.org/x.png"></body>', PAGE, resolve);
  assert.match(warnings.join(), /remote resource/);
});

test('planExport names every file after its slug and strips sources from the manifest', async () => {
  const raw = {
    version: 1,
    sections: [{ slug: 'start', label: 'Start', title: 'Overview' }],
    visuals: [
      { slug: 'hub', section: 'start', title: 'Hub', overview: true, source: { artifact: 'Hub1', path: 'index.html' } },
      { slug: 'hub-money', section: 'start', title: 'Money', source: { artifact: 'Hub1', path: 'money.html' } },
    ],
  };
  const pages: Record<string, string> = {
    'Hub1/index.html': '<body><a href="money.html">m</a><a href="goal.html">g</a></body>',
    'Hub1/money.html': `<body><a href="${artifactUrl('artifact/Hub1')}">back</a></body>`,
  };
  const plan = await planExport(raw, async (p) => pages[`${p.artifact}/${p.path}`]!);
  assert.deepEqual(plan.files.map((f) => f.name), ['hub.html', 'hub-money.html']);
  assert.match(plan.files[0]!.html, /#legallas=hub-money/);
  assert.match(plan.files[1]!.html, /#legallas=hub"/);
  assert.deepEqual(plan.warnings, ['hub: no visual for goal.html in Hub1']);
  const written = JSON.parse(plan.manifest) as { visuals: Record<string, unknown>[] };
  assert.equal(written.visuals[0]!.file, 'hub.html');
  assert.equal('source' in written.visuals[0]!, false);
});

test('planExport refuses a visual without a usable source', async () => {
  const raw = { version: 1, sections: [{ slug: 's', label: 'S', title: 'S' }], visuals: [{ slug: 'a', section: 's', title: 'A', source: { artifact: 'x', path: '../y' } }] };
  await assert.rejects(planExport(raw, async () => ''), /needs "source"/);
});

test('the bridge posts what follows each link prefix: a slug, a web address, a cite', () => {
  const listeners: Record<string, (event: unknown) => void> = {};
  const posted: unknown[] = [];
  const parent = { postMessage: (message: unknown) => posted.push(JSON.parse(JSON.stringify(message))) };
  runInNewContext(scriptBody(BRIDGE_SCRIPT), {
    window: { parent },
    document: { addEventListener: (type: string, listener: (event: unknown) => void) => { listeners[type] = listener; } },
  });
  const click = (href: string) => listeners.click!({ target: { closest: () => ({ getAttribute: () => href }) }, preventDefault() {} });
  click('#legallas=other');
  click(`#legallas-out=${encodeURIComponent('https://example.org/a?x=1')}`);
  click(`#legallas-cite=${encodeURIComponent('DOE-000412@3')}`);
  assert.deepEqual(posted, [
    { type: 'nav', slug: 'other', legallas: 1 },
    { type: 'out', url: 'https://example.org/a?x=1', legallas: 1 },
    { type: 'cite', ref: 'DOE-000412@3', legallas: 1 },
  ]);
});
