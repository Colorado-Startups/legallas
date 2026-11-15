// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inline, renderMarkdown, slug } from './markdown.ts';

test('inline: code, bold and https links; every other character escaped', () => {
  assert.equal(inline('Choose **Connect <app>** or `Cancel`'), 'Choose <strong>Connect &lt;app&gt;</strong> or <code>Cancel</code>');
  assert.equal(inline('Steps at https://mcp.example.com/connect.'), 'Steps at <a href="https://mcp.example.com/connect">https://mcp.example.com/connect</a>.');
  assert.equal(inline('`https://x.example/mcp` stays code'), '<code>https://x.example/mcp</code> stays code');
  assert.equal(inline("the owner's `/admin` & co"), 'the owner&#39;s <code>/admin</code> &amp; co');
});

test('no source text adds markup, an attribute or a script link', () => {
  const hostile = [
    '<script>alert(1)</script>',
    '[x](javascript:alert(1))',
    'https://a.example/x"onmouseover="alert(1)',
    "https://a.example/x'><img src=x onerror=alert(1)>",
    '`</code><script>x</script>`',
    '**<img src=x>**',
    'a \u0000 0 \u0000 b',
  ];
  const md = [
    `# ${hostile[0]}`,
    '',
    ...hostile.map((line) => `${line}\n`),
    '| <b>head</b> | `x` |',
    '|---|---|',
    `| ${hostile[0]} | ${hostile[2]} |`,
    '',
    `- ${hostile[0]}`,
    '',
    '```',
    hostile[0],
    '```',
  ].join('\n');
  const html = renderMarkdown(md);
  // Every tag is one the renderer writes, with only its own attributes; the hostile text stays text.
  const tag = /^<\/?(h[2-4]|p|ul|li|strong|code|pre|a|div|table|thead|tbody|tr|th|td)((?: (?:id|href|class|scope|data-label)="[^"<>]*")*)>$/;
  for (const [found] of html.matchAll(/<[^>]*>/g)) assert.match(found, tag);
  for (const href of html.matchAll(/href="([^"]*)"/g)) assert.match(href[1], /^https:\/\/[A-Za-z0-9\-._~/?#=%+:]+$/);
});

test('blocks: headings with ids, paragraphs, lists with continuation lines, tables and fenced code', () => {
  const html = renderMarkdown(
    [
      '## Subprocessors and location',
      'One line',
      'and the next.',
      '',
      '- first item',
      '  carries on',
      '- second',
      '',
      '| Who | How |',
      '|---|---|',
      '| The lawyer | `/connections`, **Disconnect** |',
      '| A \\| pipe | two |',
      '',
      '```',
      'a  |  b',
      '```',
      '### Small',
      '#nospace stays text',
    ].join('\n'),
  );
  assert.ok(html.includes('<h2 id="subprocessors-and-location">Subprocessors and location</h2>'));
  assert.ok(html.includes('<p>One line and the next.</p>'));
  assert.ok(html.includes('<ul><li>first item carries on</li><li>second</li></ul>'));
  assert.ok(html.includes('<thead><tr><th scope="col">Who</th><th scope="col">How</th></tr></thead>'));
  assert.ok(html.includes('<td data-label="Who">The lawyer</td><td data-label="How"><code>/connections</code>, <strong>Disconnect</strong></td>'));
  assert.ok(html.includes('<td data-label="Who">A | pipe</td>'));
  assert.ok(html.includes('<pre><code>a  |  b</code></pre>'));
  assert.ok(html.includes('<h3 id="small">Small</h3>'));
  assert.ok(html.includes('<p>#nospace stays text</p>'));
  assert.equal(slug('Revoking access'), 'revoking-access');
});
