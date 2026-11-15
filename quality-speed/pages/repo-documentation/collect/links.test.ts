// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repo } from './fixture.ts';
import { brokenLinks, externalLinks, resolveLink } from './links.ts';

test('resolveLink: relative, root-relative and same-doc anchors', () => {
  assert.deepEqual(resolveLink('docs/a.md', '../b.md#x'), { path: 'b.md', frag: 'x' });
  assert.deepEqual(resolveLink('docs/a.md', '/web/README.md'), { path: 'web/README.md', frag: '' });
  assert.deepEqual(resolveLink('docs/a.md', '#top'), { path: 'docs/a.md', frag: 'top' });
});

test('broken links: a missing file, a missing heading, a line past the end; good ones pass', () => {
  const r = repo({
    'README.md': '# Start\n\n[ok](docs/b.md#the-part) [gone](docs/none.md) [bad](docs/b.md#nope) [self](#start)\n[line](web/x.ts#L2) [far](web/x.ts#L9) [dir](docs/) [ext](https://example.com/x)\nSee <https://example.com/auto> or https://example.com/bare. Not `https://example.com/code`.\n',
    'docs/b.md': '# B\n\n## The part\n',
    'web/x.ts': 'one\ntwo\n',
  });
  try {
    const found = brokenLinks(r.corpus()).map((f) => [f.target, f.reason]);
    assert.deepEqual(found, [
      ['docs/none.md', 'no such file'],
      ['docs/b.md#nope', 'no such heading'],
      ['web/x.ts#L9', 'past the end of the file'],
    ]);
    assert.deepEqual(externalLinks(r.corpus()).map((l) => l.url), ['https://example.com/x', 'https://example.com/auto', 'https://example.com/bare']);
  } finally {
    r.done();
  }
});

test('a link may point at an HTML anchor', () => {
  const r = repo({ 'a.md': '<a id="here"></a>\n\n[x](#here)\n' });
  try {
    assert.deepEqual(brokenLinks(r.corpus()), []);
  } finally {
    r.done();
  }
});
