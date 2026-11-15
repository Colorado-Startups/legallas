// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatVisualText, pageExpression, VISUAL_TEXT_MAX_CHARS, walkVisual, type DomDocument, type DomNode } from './visual-dom.ts';

// A small DOM: elements with lowercase local names (as SVG and HTML report them), attributes and text nodes.
type Child = DomNode | string;

function text(value: string): DomNode {
  return { nodeType: 3, nodeValue: value, textContent: value, childNodes: [] };
}

function el(name: string, attrs: Record<string, string> = {}, ...children: Child[]): DomNode {
  const childNodes = children.map((child) => (typeof child === 'string' ? text(child) : child));
  return {
    nodeType: 1,
    localName: name,
    childNodes,
    getAttribute: (key: string) => attrs[key] ?? null,
    get textContent(): string {
      return childNodes.map((child) => child.textContent ?? '').join('');
    },
  };
}

function page(title: string, ...children: Child[]): DomDocument {
  return { title, body: el('body', {}, ...children) };
}

const FIXTURE = page(
  'Copperline deliveries',
  el('script', {}, 'var secret = "never read";'),
  el('style', {}, '.x { color: red }'),
  el('h1', {}, 'Copperline deliveries'),
  el('p', {}, 'Harbor Labs supplied ', el('strong', {}, 'Copperline'), ' in 2012.'),
  el('ul', {}, el('li', {}, 'Harbor Street Grill', el('ul', {}, el('li', {}, 'Wedding order'))), el('li', {}, 'Copperline Cafe')),
  el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Month'), el('th', {}, 'Invoiced'))), el('tbody', {}, el('tr', {}, el('td', {}, 'April 2012'), el('td', {}, '$18,420.55')))),
  el(
    'svg',
    { 'aria-label': 'Meals delivered by month' },
    el('style', {}, 'text { fill: red }'),
    el('g', {}, el('rect', {}, el('title', {}, 'April: 212')), el('text', {}, 'April')),
    el('g', { 'aria-label': 'Copperline bar' }, el('text', {}, el('tspan', {}, 'May'))),
  ),
  el('svg', {}, el('path', {})),
  el('canvas', {}),
  el('img', { alt: 'Floor plan of the Harbor Street kitchen' }),
  el('select', {}, el('option', {}, 'All months'), el('option', {}, 'April')),
  el('p', {}, 'See ', el('a', { href: '#legallas-cite=DOE-000412@3' }, 'the supply agreement'), ' and ', el('a', { href: '#legallas-cite=DOE-000413' }, 'DOE-000413'), '.'),
  el('p', {}, el('a', { href: '#legallas=delivery-map' }, 'Delivery map'), ' and ', el('a', { href: '#legallas-out=https%3A%2F%2Fexample.com%2Finspection' }, 'the inspection')),
  el('a', { href: '#legallas=timeline' }, el('h3', {}, 'Timeline'), el('p', {}, 'Every event in order')),
  el('div', { 'aria-label': 'Status: pending' }),
  el('div', {}, 'Line one', el('br', {}), 'Line two'),
);

test('walkVisual reads headings, lines, lists, rows, figures and notes, and never script or style text', () => {
  const walked = walkVisual(FIXTURE);
  assert.equal(walked.title, 'Copperline deliveries');
  assert.deepEqual(walked.blocks, [
    { t: 'h', level: 1, text: 'Copperline deliveries' },
    { t: 'p', text: 'Harbor Labs supplied Copperline in 2012.' },
    { t: 'li', depth: 0, text: 'Harbor Street Grill' },
    { t: 'li', depth: 1, text: 'Wedding order' },
    { t: 'li', depth: 0, text: 'Copperline Cafe' },
    { t: 'row', head: true, cells: ['Month', 'Invoiced'] },
    { t: 'row', head: false, cells: ['April 2012', '$18,420.55'] },
    { t: 'figure', label: 'Meals delivered by month', items: ['April: 212', 'April', 'Copperline bar', 'May'] },
    { t: 'note', text: 'Chart drawn on a canvas; its values are not in the page text' },
    { t: 'note', text: 'Image: Floor plan of the Harbor Street kitchen' },
    { t: 'p', text: 'Options: All months; April' },
    { t: 'p', text: 'See the supply agreement [cite: DOE-000412 at 3] and DOE-000413.' },
    { t: 'p', text: 'Delivery map [visual: delivery-map] and the inspection [link: https://example.com/inspection]' },
    { t: 'h', level: 3, text: 'Timeline' },
    { t: 'p', text: 'Every event in order' },
    { t: 'p', text: '[visual: timeline]' },
    { t: 'note', text: 'Status: pending' },
    { t: 'p', text: 'Line one' },
    { t: 'p', text: 'Line two' },
  ]);
  assert.ok(!JSON.stringify(walked).includes('never read'));
});

test('pageExpression is self-contained and walks a page exactly as walkVisual does', () => {
  const run = new Function('document', `return ${pageExpression()};`) as (doc: DomDocument) => unknown;
  assert.deepEqual(run(FIXTURE), walkVisual(FIXTURE));
  // No module-level name leaks in: every function the page calls is defined inside the expression.
  assert.match(pageExpression(), /^\(function \(\) \{\nconst SKIP = /);
});

test('formatVisualText sets the blocks out as plain text, title first unless the first heading repeats it', () => {
  const text = formatVisualText(walkVisual(FIXTURE));
  assert.equal(
    text.split('\n').slice(0, 14).join('\n'),
    [
      '# Copperline deliveries',
      'Harbor Labs supplied Copperline in 2012.',
      '- Harbor Street Grill',
      '  - Wedding order',
      '- Copperline Cafe',
      '',
      '| Month | Invoiced |',
      '| April 2012 | $18,420.55 |',
      '',
      'Figure: Meals delivered by month',
      'April: 212; April; Copperline bar; May',
      '',
      '[Chart drawn on a canvas; its values are not in the page text]',
      '[Image: Floor plan of the Harbor Street kitchen]',
    ].join('\n'),
  );
  const titled = formatVisualText({ title: 'Doe binder', blocks: [{ t: 'p', text: 'Body' }, { t: 'p', text: 'Body' }, { t: 'row', head: false, cells: ['a|b'] }] });
  assert.equal(titled, '# Doe binder\nBody\n\n| a/b |');
});

test('formatVisualText cuts a page past the limit and says so', () => {
  const long = formatVisualText({ title: '', blocks: [{ t: 'p', text: 'x'.repeat(VISUAL_TEXT_MAX_CHARS + 50) }] });
  assert.ok(long.startsWith('x'.repeat(VISUAL_TEXT_MAX_CHARS)));
  assert.match(long, /\[The page continues; its text was cut at 200,000 characters\.\]$/);
});
