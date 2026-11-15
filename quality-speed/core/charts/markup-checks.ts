// SPDX-License-Identifier: Apache-2.0
// The markup checks the chart kit's tests and a page's tests share: tags balanced, and nothing a strict security policy refuses.
import assert from 'node:assert/strict';

const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link']);

/** Fails on a tag that is left open, closed twice or closed out of order. */
export function assertBalanced(html: string, name: string): void {
  const body = html.replace(/<script type="application\/json">[\s\S]*?<\/script>/g, '');
  const stack: string[] = [];
  for (const match of body.matchAll(/<(\/?)([a-zA-Z][\w:-]*)((?:\s[^<>]*?)?)(\/?)>/g)) {
    const [, closing, tag = '', , selfClose] = match;
    if (selfClose || VOID.has(tag)) continue;
    if (closing) assert.equal(stack.pop(), tag, `${name}: </${tag}> closes the wrong tag`);
    else stack.push(tag);
  }
  assert.deepEqual(stack, [], `${name}: left open`);
}

/** The kit's promise to a strict security policy and to its readers. */
export function assertSafe(html: string, name: string): void {
  assert.doesNotMatch(html, /\sstyle=/, `${name}: an inline style would break a strict security policy`);
  assert.doesNotMatch(html, /\son[a-z]+=/, `${name}: an inline handler would break a strict security policy`);
  assert.doesNotMatch(html, /<script(?! type="application\/json")/, `${name}: only JSON data blocks may be inline`);
  assert.doesNotMatch(html, /https?:\/\/(?!github\.com\/)/, `${name}: links stay on GitHub or on the site`);
  assert.doesNotMatch(html, /—/, `${name}: no em dashes`);
  assert.doesNotMatch(html, /calc\(/, `${name}: calc() in an SVG attribute fails in some browsers`);
  assert.doesNotMatch(html, /undefined|NaN/, `${name}: a value leaked into the markup`);
}
