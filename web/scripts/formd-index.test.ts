// SPDX-License-Identifier: Apache-2.0
// The sync's reader for SEC Form D XML: the index holds the rendered page (src/scripts/formd.ts), the same text the
// room's viewer shows. The fictional Copperline fixture only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderFormD } from '../src/scripts/formd.ts';
import { FORM_D_FIXTURE_NAME, FORM_D_FIXTURE_XML } from '../src/scripts/formd.test-data.ts';
import { checkIndex } from './checkindex.ts';
import { directTextPages, renderVersion, RENDER_VERSION } from './extract.ts';
import type { IndexJob } from './indexjob.ts';

async function withFiles(files: Record<string, string>, run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'legallas-formd-'));
  try {
    for (const [name, body] of Object.entries(files)) await writeFile(path.join(dir, name), body);
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('the reader sets out a Form D by the document name, since the snapshot clone has an opaque one', async () => {
  await withFiles({ '7.xml': FORM_D_FIXTURE_XML, '8.xml': '<catalog><book>One</book></catalog>', '9.md': '# Notes' }, async (dir) => {
    const formD = await directTextPages(path.join(dir, '7.xml'), FORM_D_FIXTURE_NAME);
    assert.deepEqual(formD, [{ n: 1, text: renderFormD(FORM_D_FIXTURE_XML, FORM_D_FIXTURE_NAME), ocr: false, rendered: true }]);
    assert.ok(formD[0]!.text.includes('Accession number (from the file name): 0009990007-12-000031'));
    assert.deepEqual(await directTextPages(path.join(dir, '8.xml'), 'catalog.xml'), [{ n: 1, text: '<catalog><book>One</book></catalog>', ocr: false }]);
    assert.deepEqual(await directTextPages(path.join(dir, '9.md'), 'notes.md'), [{ n: 1, text: '# Notes', ocr: false }]);
  });
});

test('XML carries the Form D render version; Markdown and JSON carry none', () => {
  assert.equal(renderVersion('a/Repair-Log__20120907__Tally-Payroll.xml'), RENDER_VERSION);
  assert.equal(renderVersion('a/FORM.XML'), RENDER_VERSION);
  assert.equal(renderVersion('a/notes.md'), null);
  assert.equal(renderVersion('a/data.json'), null);
});

test('the index check counts Form D filings set out as text', async () => {
  await withFiles({ '7.xml': FORM_D_FIXTURE_XML, '9.md': '# Notes' }, async (dir) => {
    const job = (id: string, file: string, name: string): IndexJob => ({ id, kind: 'text', sha256: id.padEnd(64, '0'), file: path.join(dir, file), name, staleParts: 0 });
    const check = await checkIndex([job('formd', '7.xml', FORM_D_FIXTURE_NAME), job('notes', '9.md', 'notes.md')], {
      extractPdf: () => Promise.reject(new Error('no PDFs here')),
      readText: directTextPages,
    });
    assert.equal(check.textDocs, 2);
    assert.equal(check.renderedDocs, 1);
  });
});
