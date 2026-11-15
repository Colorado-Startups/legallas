// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkIndex, failureCode, formatIndexCheck } from './checkindex.ts';
import { ExtractorUnavailable, type ExtractedPage } from './extract.ts';
import type { IndexJob } from './indexjob.ts';
import { parseSyncArgs } from './sync.ts';

const job = (id: string, kind: IndexJob['kind']): IndexJob => ({ id, kind, sha256: id.padEnd(64, '0'), file: `/snap/${id}`, name: `${id}.bin`, staleParts: 0 });

const PDFS: Record<string, ExtractedPage[] | Error> = {
  text: [{ n: 1, text: 'typed page', ocr: false }, { n: 2, text: 'second', ocr: false }],
  scan: [{ n: 1, text: 'recognized words', ocr: true }, { n: 2, text: '', ocr: false }],
  mixed: [{ n: 1, text: 'typed', ocr: false }, { n: 2, text: 'scanned exhibit', ocr: true }],
  big: Array.from({ length: 40 }, (_, i) => ({ n: i + 1, text: 'evidence '.repeat(12_000), ocr: false })),
  locked: new Error('LegallasExtract failed: encrypted'),
  'photo.png': [{ n: 1, text: 'text in a screenshot', ocr: true }],
  'blank.jpg': [{ n: 1, text: '', ocr: true }],
  broken: new Error('LegallasExtract failed: unreadable'),
};

const deps = {
  async extractPdf(file: string) {
    const value = PDFS[file.slice('/snap/'.length)];
    if (value instanceof Error) throw value;
    return value;
  },
  async readText() {
    return [{ n: 1, text: '# notes', ocr: false }];
  },
};

test('the index check counts OCR, scans, splits and failures without naming files', async () => {
  const jobs = [...Object.keys(PDFS).map((id) => job(id, /\.(png|jpg)$/.test(id) ? 'image' : 'pdf')), job('notes', 'markdown')];
  const check = await checkIndex(jobs, deps);
  assert.equal(check.pdfs, 4);
  assert.equal(check.textDocs, 1);
  assert.deepEqual([check.images, check.imagesWithText], [2, 1]);
  assert.deepEqual(check.failed, { encrypted: 1, unreadable: 1 });
  assert.equal(check.pages, 46);
  assert.equal(check.ocrPages, 2);
  assert.equal(check.pdfsWithOcr, 2);
  assert.equal(check.scannedPdfs, 1);
  assert.equal(check.multiPartDocs, 1);
  assert.ok(check.largestPart < 3_500_000);
  const text = formatIndexCheck(check);
  assert.match(text, /fully scanned: 1/);
  assert.match(text, /Failed: encrypted 1, unreadable 1/);
  assert.equal(/locked|broken|\/snap\//.test(text), false);
});

test('a missing extractor stops the check instead of reporting zeros', async () => {
  const unavailable = { ...deps, extractPdf: async () => Promise.reject(new ExtractorUnavailable('extractor not built')) };
  await assert.rejects(checkIndex([job('text', 'pdf')], unavailable), ExtractorUnavailable);
});

test('failure codes are short words or "other"', () => {
  assert.equal(failureCode(new Error('LegallasExtract failed: ocr')), 'ocr');
  assert.equal(failureCode(new Error('LegallasExtract failed: Secret Name.pdf is broken!')), 'other');
  assert.equal(failureCode('nope'), 'other');
});

test('--check-index is a dry-run flag only', () => {
  assert.equal(parseSyncArgs(['--check-index', '--local']).checkIndex, true);
  assert.throws(() => parseSyncArgs(['--check-index', '--apply']), /cannot be combined/);
});
