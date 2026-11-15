// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseBaseline } from './baseline.ts';
import { expectedFiles, README_PATH } from './generate.ts';

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const source = read('../../../docs/checklist/baseline.toml');

test('README.md and worker/checklist-baseline.ts match baseline.toml (run npm run checklist in web/)', () => {
  for (const [path, text] of expectedFiles()) assert.equal(readFileSync(path, 'utf8'), text, path);
});

test('the list carries the product notice, word for word', () => {
  const { notice, status, template_notice, template_card_notice, template_licence_notice } = parseBaseline(source);
  // Whole lines: a sentence added to A2 must fail here, not match as a prefix.
  const notices = read('../../../docs/legal/product-notices.md').split('\n');
  assert.ok(notices.includes(`> ${notice}`), 'notice must be the short line in A2');
  for (const line of [template_notice, template_card_notice, template_licence_notice]) assert.ok(notices.includes(`> ${line}`), `A5: ${line}`);
  const readme = readFileSync(README_PATH, 'utf8');
  assert.ok(readme.split('\n').includes(`> ${notice}`));
  assert.ok(readme.includes(status));
});

test('the 83(b) deadline runs from transfer, and a weekend or holiday moves it', () => {
  // 26 CFR 1.83-2(b) and 26 U.S.C. 7503. A missed election can't be fixed, so this wording must not drift.
  const deadline = parseBaseline(source).items.find((item) => item.id === 'founders.section-83b-election')?.deadline ?? '';
  assert.match(deadline, /30 days after the transfer/);
  assert.doesNotMatch(deadline, /issued/);
  assert.match(deadline, /weekend or legal holiday moves to the next business day/);
});

test('a list the product could not rely on is refused', () => {
  const refused: [string, string, RegExp][] = [
    ['why = "Set how the board, officers and stockholders act; investors and lenders rely on them."', 'why = "You need this."', /may not say "You"/],
    ['url = "https://www.irs.gov/businesses/small-businesses-self-employed/business-structures"', 'url = "http://www.irs.gov/x"', /must be an https link/],
    ['stage = "pre-formation"', 'stage = "someday"', /unknown word someday/],
    ['id = "formation.operating-agreement"', 'id = "formation.bylaws"', /appears twice/],
    ['  "formation.bylaws",\n', '', /formation\.bylaws: has investors in its rooms and sits in no folder/],
    ['"founders/founders-agreement.md"', '"investors/README.md"', /isn't a file the build serves/],
    ['"founders/founders-agreement.md"', '"founders/no-such-file.md"', /isn't a file the build serves/],
  ];
  for (const [from, to, message] of refused) {
    assert.ok(source.includes(from), from);
    assert.throws(() => parseBaseline(source.replace(from, to)), message, to);
  }
  const noSource = /(id = "formation\.bylaws"[\s\S]*?)sources = \[[\s\S]*?\n\]\n/;
  assert.throws(() => parseBaseline(source.replace(noSource, '$1sources = []\n')), /every item keeps a public source/);
});
