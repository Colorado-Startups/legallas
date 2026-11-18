// SPDX-License-Identifier: Apache-2.0
// A visual's links, under the default stored name and a room's own: the export writes them, the bridge inside the page
// posts them, the room page reads the message, and the text walker notes where they go. All four must agree, or links
// and arrow keys in every stored visual stop with no error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { pageExpression, type DomDocument, type DomNode } from './visual-dom.ts';
import { bridgeScript, BRIDGE_SCRIPT, prepareVisual, rewriteHref, type ResolvePage } from '../worker/visualprep.ts';

const PAGE = { artifact: 'A1', path: 'index.html' };
const resolve: ResolvePage = (page) => (page.artifact === 'A1' && page.path === 'other.html' ? 'other' : null);

/** A bridge script's body: the one leading <script> and trailing </script> its builder wraps it in, sliced off. */
function scriptBody(tagged: string): string {
  const open = '<script>';
  const close = '</script>';
  let body = tagged;
  if (body.startsWith(open)) body = body.slice(open.length);
  if (body.endsWith(close)) body = body.slice(0, -close.length);
  return body;
}

/** Runs a page's bridge script over a fake window, and returns what each click and key posts. */
function runBridge(script: string): { click(href: string): void; key(key: string): void; posted: Record<string, unknown>[] } {
  const listeners: Record<string, (event: unknown) => void> = {};
  const posted: Record<string, unknown>[] = [];
  const parent = { postMessage: (message: unknown) => posted.push(JSON.parse(JSON.stringify(message))) };
  runInNewContext(scriptBody(script), {
    window: { parent },
    document: { addEventListener: (type: string, listener: (event: unknown) => void) => { listeners[type] = listener; } },
  });
  return {
    posted,
    click: (href) => listeners.click!({
      target: { closest: (selector: string) => (selector === `a[href^="#${href.slice(1).split(/[=-]/)[0]}"]` ? { getAttribute: () => href } : null) },
      preventDefault() {},
    }),
    key: (key) => listeners.keydown!({ key, target: { tagName: 'BODY' } }),
  };
}

/** The viewer's own check from its source, run with the stored name as the build would write it. */
function viewerAccepts(name: string, data: unknown): boolean {
  const source = readFileSync(new URL('../src/scripts/visual-viewer.ts', import.meta.url), 'utf8');
  const body = /function isBridgeMessage\(data: unknown\): data is BridgeMessage \{\n([\s\S]*?)\n\}/.exec(source)?.[1];
  assert.ok(body, 'visual-viewer.ts has isBridgeMessage');
  const plain = body.replace(/\(data as Record<string, unknown>\)/, 'data');
  return new Function('ROOM_STORED_NAME', 'data', plain)(name, data) as boolean;
}

function el(name: string, attrs: Record<string, string>, text: string): DomNode {
  const childNodes = [{ nodeType: 3, nodeValue: text, textContent: text, childNodes: [] }];
  return { nodeType: 1, localName: name, childNodes, textContent: text, getAttribute: (key: string) => attrs[key] ?? null };
}

for (const name of ['legallas', 'acme']) {
  test(`${name}: the export writes links the bridge posts and the room page reads`, () => {
    const { html, warnings } = prepareVisual(
      `<body><a href="other.html">Other</a><a href="https://example.org/a?x=1">Web</a><a href="nope.html">Gone</a><a href="#${name}-cite=DOE-000412@3">Cite</a></body>`,
      PAGE,
      resolve,
      name,
    );
    assert.match(html, new RegExp(`href="#${name}=other"`));
    assert.match(html, new RegExp(`href="#${name}-out=https%3A%2F%2Fexample\\.org%2Fa%3Fx%3D1"`));
    assert.match(html, new RegExp(`href="#${name}-missing"`));
    assert.match(html, new RegExp(`href="#${name}-cite=DOE-000412@3"`));
    assert.equal(warnings.length, 1);
    assert.equal(html.split(`/* ${name}-bridge */`).length - 1, 1, 'one bridge');

    const bridge = runBridge(bridgeScript(name));
    bridge.click(`#${name}=other`);
    bridge.click(`#${name}-out=${encodeURIComponent('https://example.org/a?x=1')}`);
    bridge.click(`#${name}-cite=${encodeURIComponent('DOE-000412@3')}`);
    bridge.key('ArrowRight');
    assert.deepEqual(bridge.posted, [
      { type: 'nav', slug: 'other', [name]: 1 },
      { type: 'out', url: 'https://example.org/a?x=1', [name]: 1 },
      { type: 'cite', ref: 'DOE-000412@3', [name]: 1 },
      { type: 'key', key: 'ArrowRight', [name]: 1 },
    ]);
    for (const message of bridge.posted) assert.equal(viewerAccepts(name, message), true);
  });

  test(`${name}: the room page ignores a message under any other name`, () => {
    const other = name === 'acme' ? 'legallas' : 'acme';
    assert.equal(viewerAccepts(name, { type: 'nav', slug: 'other', [other]: 1 }), false);
    assert.equal(viewerAccepts(name, { type: 'nav', slug: 'other', [name]: 2 }), false);
    assert.equal(viewerAccepts(name, null), false);
    assert.equal(viewerAccepts(name, 'text'), false);
  });

  test(`${name}: a page exported before keeps one bridge, the current one`, () => {
    const older = `<script>/* ${name}-bridge */old()</script>`;
    const { html } = prepareVisual(`<body><p>x</p>${older}</body>`, PAGE, resolve, name);
    assert.ok(html.includes(bridgeScript(name)));
    assert.ok(!html.includes('old()'));
    assert.equal(prepareVisual(html, PAGE, resolve, name).html, html, 'a second export changes nothing');
  });

  test(`${name}: the text walker in the page notes where each link goes`, () => {
    const document: DomDocument = {
      body: {
        nodeType: 1,
        localName: 'body',
        textContent: '',
        getAttribute: () => null,
        childNodes: [
          {
            nodeType: 1,
            localName: 'p',
            textContent: '',
            getAttribute: () => null,
            childNodes: [
              el('a', { href: `#${name}=other` }, 'Other'),
              el('a', { href: `#${name}-out=${encodeURIComponent('https://example.org/a')}` }, 'Web'),
              el('a', { href: `#${name}-cite=DOE-000412@3` }, 'Cite'),
            ],
          },
        ],
      },
    } as unknown as DomDocument;
    const walked = new Function('document', `return ${pageExpression(name)};`)(document) as unknown;
    const text = JSON.stringify(walked);
    assert.match(text, /\[visual: other\]/);
    assert.match(text, /\[link: https:\/\/example\.org\/a\]/);
    assert.match(text, /\[cite: DOE-000412 at 3\]/);
  });
}

test('a link under the other name is not rewritten or noted as a link of this room', () => {
  assert.deepEqual(rewriteHref('#legallas=other', PAGE, resolve, 'acme'), { href: '#legallas=other' });
});

test('the bridge is pinned, byte for byte: stored pages hold it, and an export replaces any other', () => {
  assert.equal(BRIDGE_SCRIPT, bridgeScript());
  assert.equal(
    bridgeScript('example'),
    "<script>/* example-bridge */(function(){var p=window.parent;if(!p||p===window)return;function send(m){m.example=1;p.postMessage(m,'*')}" +
      "document.addEventListener('click',function(e){var t=e.target,a=t&&t.closest?t.closest('a[href^=\"#example\"]'):null;" +
      "if(!a)return;e.preventDefault();var h=a.getAttribute('href')||'';" +
      "if(h.indexOf('#example=')===0)send({type:'nav',slug:h.slice(9)});" +
      "else if(h.indexOf('#example-out=')===0)send({type:'out',url:decodeURIComponent(h.slice(13))});" +
      "else if(h.indexOf('#example-cite=')===0)send({type:'cite',ref:decodeURIComponent(h.slice(14))})});" +
      "document.addEventListener('keydown',function(e){if(e.altKey||e.ctrlKey||e.metaKey)return;" +
      "if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;var n=e.target&&e.target.tagName;" +
      "if(n==='INPUT'||n==='SELECT'||n==='TEXTAREA')return;send({type:'key',key:e.key})})})();</script>",
  );
});
