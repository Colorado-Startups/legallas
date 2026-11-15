// SPDX-License-Identifier: Apache-2.0
// The fictional Doe v. Harbor Labs fixture raises no SSN flag, so `npm run dev:seed` (sync --local --apply) never stops at
// the guard. PDF text is read with pdf.js, as the fixture's own tests do; Form D XML as rendered and raw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderFormD } from '../src/scripts/formd.ts';
import { fixtureFiles, loadFixtureInputs } from './dev-fixture.ts';
import { findPii } from './pii.ts';

async function pdfPages(bytes: Buffer): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join('\n'));
  }
  await task.destroy();
  return pages;
}

test('the dev fixture holds nothing the SSN guard flags', async () => {
  const files = fixtureFiles(await loadFixtureInputs());
  let read = 0;
  for (const file of files) {
    const name = file.rel.split('/').pop() ?? '';
    let texts: string[];
    if (/\.pdf$/i.test(name)) texts = await pdfPages(file.bytes);
    else if (/\.(md|csv|txt|json|xml)$/i.test(name)) {
      const raw = file.bytes.toString('utf8');
      texts = /\.xml$/i.test(name) ? [raw, renderFormD(raw, name) ?? ''] : [raw];
    } else continue;
    read += 1;
    for (const text of texts) assert.deepEqual(await findPii(text), [], file.rel);
  }
  assert.ok(read >= 20, `read ${read} fixture files`);
});
