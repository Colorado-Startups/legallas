// SPDX-License-Identifier: Apache-2.0
// Which pages go to OCR and which text wins, as PageTextExtractor.swift has it, with OCR and the PDF layer faked. Runs on
// every computer. extract-windows-api.test.ts runs the real pdf.js and the real Windows OCR API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExtractorUnavailable } from './extract.ts';
import { chooseText, fieldLines, layerQuality, layersOf, pageTreeUndercounts, OCR_THRESHOLD, SPARSE_THRESHOLD, windowsExtractor, type Ocr, type PdfDocument, type PdfLayers } from './extract-windows.ts';

const never = async () => {
  throw new Error('should not be asked');
};

test('a page is graded as the Mac grades it', async () => {
  assert.equal(await layerQuality('short', never), 'sparse');
  assert.equal(await layerQuality('x'.repeat(OCR_THRESHOLD - 1), never), 'sparse');
  // Mostly glyphs that are no letter: unmapped font codes.
  assert.equal(await layerQuality('\uE000'.repeat(40) + 'x'.repeat(20), never), 'thin');
  // A short sound layer: only the image decides, and only then is it asked.
  const short = 'word '.repeat(20);
  assert.equal(await layerQuality(short, async () => true), 'thin');
  assert.equal(await layerQuality(short, async () => false), 'good');
  // A full page never asks.
  assert.equal(await layerQuality('word '.repeat(SPARSE_THRESHOLD), never), 'good');
});

test('OCR replaces a sparse layer when it reads more, and a thin one only when it reads clearly more', () => {
  assert.deepEqual(chooseText('sparse', 'DOE000123', 'A whole page of scanned text'), { text: 'A whole page of scanned text', ocr: true });
  assert.deepEqual(chooseText('sparse', 'Cover sheet', 'Cover'), { text: 'Cover sheet', ocr: false });
  assert.deepEqual(chooseText('sparse', 'Cover sheet', ''), { text: 'Cover sheet', ocr: false });
  const layer = 'a'.repeat(100);
  assert.deepEqual(chooseText('thin', layer, 'b'.repeat(149)), { text: layer, ocr: false });
  assert.deepEqual(chooseText('thin', layer, 'b'.repeat(150)), { text: 'b'.repeat(150), ocr: true });
});

const fakeLayers = (pages: { text: string; quality: 'good' | 'sparse' | 'thin' }[]): PdfLayers => async () => pages.map((page, index) => ({ n: index + 1, ...page }));

test('a PDF keeps its good pages, and only its doubtful ones go to OCR, in one call', async () => {
  const good = 'word '.repeat(200);
  const calls: (readonly number[] | null)[] = [];
  const ocr: Ocr = async (_file, pages) => {
    calls.push(pages);
    return new Map(pages!.map((n) => [n, `Scanned text read from page ${n} of this document`]));
  };
  const layers = fakeLayers([{ text: good, quality: 'good' }, { text: '', quality: 'sparse' }, { text: 'Stamp 12', quality: 'sparse' }, { text: 'word '.repeat(30), quality: 'thin' }]);
  const pages = await windowsExtractor(ocr, layers)('C:\\cache\\000001.pdf');
  assert.deepEqual(calls, [[2, 3, 4]]);
  assert.deepEqual(pages[0], { n: 1, text: good, ocr: false });
  assert.deepEqual(pages.slice(1).map((page) => page.ocr), [true, true, false]);
  assert.equal(pages[1]!.text, 'Scanned text read from page 2 of this document');
  assert.equal(pages[3]!.text, 'word '.repeat(30), 'OCR read less than half again as much, so the layer stays');
});

test('a PDF with only good pages never starts OCR', async () => {
  const pages = await windowsExtractor(never, fakeLayers([{ text: 'word '.repeat(200), quality: 'good' }]))('a.pdf');
  assert.equal(pages[0]!.ocr, false);
});

test('an image is one page of OCR, and a failure there is the file\'s', async () => {
  const pages = await windowsExtractor(async (_file, requested) => {
    assert.equal(requested, null);
    return new Map([[1, 'From the photo']]);
  }, never)('C:\\cache\\000002.JPG');
  assert.deepEqual(pages, [{ n: 1, text: 'From the photo', ocr: true }]);

  await assert.rejects(windowsExtractor(async () => { throw new ExtractorUnavailable('no language'); }, fakeLayers([{ text: '', quality: 'sparse' }]))('a.pdf'), ExtractorUnavailable);
});

test('a PDF with no pages fails, and never reads as a clean file', async () => {
  await assert.rejects(windowsExtractor(never, fakeLayers([]))('a.pdf'), { message: 'pdf failed: unreadable' });
});

test('each page is graded where it is read, and let go once it is', async () => {
  const cleaned: number[] = [];
  const asked: number[] = [];
  const doc: PdfDocument = {
    numPages: 2,
    getPage: async (n) => ({
      getTextContent: async () => ({ items: n === 1 ? [{ str: 'word '.repeat(200), transform: [0, 0, 0, 0, 0, 0] }] : [{ str: 'word '.repeat(30), transform: [0, 0, 0, 0, 0, 0] }, { type: 'beginMarkedContent' }] }),
      getOperatorList: async () => {
        asked.push(n);
        return { fnArray: [7] };
      },
      cleanup: () => cleaned.push(n),
    }),
  };
  const layers = await layersOf(doc, new Set([7]));
  assert.deepEqual(layers.map((page) => [page.n, page.quality]), [[1, 'good'], [2, 'thin']]);
  assert.deepEqual(asked, [2], 'a full page never asks whether it holds an image');
  assert.deepEqual(cleaned, [1, 2]);
});

test('form field values ride after the page text, apart from its grade (#347)', async () => {
  assert.equal(fieldLines([{ fieldType: 'Tx', fieldValue: ' Jane Doe ' }, { fieldType: 'Ch', fieldValue: ['Delaware', ''] }, { fieldType: 'Btn', fieldValue: 'Yes' }, { fieldType: 'Tx', fieldValue: 7 }, null]), 'Jane Doe\nDelaware');
  const doc: PdfDocument = {
    numPages: 2,
    getPage: async (n) => ({
      getTextContent: async () => ({ items: [{ str: 'word '.repeat(200), transform: [0, 0, 0, 0, 0, 0] }] }),
      getOperatorList: async () => ({ fnArray: [] }),
      getAnnotations: async () => (n === 1 ? [{ fieldType: 'Tx', fieldValue: 'Harbor Labs' }] : []),
      cleanup: () => undefined,
    }),
  };
  const layers = await layersOf(doc, new Set());
  assert.deepEqual(layers.map((page) => [page.quality, page.fields]), [['good', 'Harbor Labs'], ['good', undefined]]);
  const pages = await windowsExtractor(async () => new Map(), async () => [{ n: 1, text: 'Body', quality: 'good', fields: 'Harbor Labs' }, { n: 2, text: '', quality: 'sparse', fields: 'Doe' }])('a.pdf');
  assert.deepEqual(pages.map((page) => page.text), ['Body\nHarbor Labs', 'Doe']);
});

test('a page tree node with more kids than its /Count is caught (#349)', () => {
  assert.equal(pageTreeUndercounts('1 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 1 >>\nendobj'), true);
  assert.equal(pageTreeUndercounts('<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>'), false);
  assert.equal(pageTreeUndercounts('<< /Count 1 /Kids [ 3 0 R\n4 0 R ] /Type /Pages >>'), true, 'keys in any order, refs across lines');
  assert.equal(pageTreeUndercounts('<< /Type /Pages /Kids [5 0 R] /Count 7 >>'), false, 'a node over intermediate nodes counts their leaves');
  assert.equal(pageTreeUndercounts('<< /Type /Page /Parent 2 0 R >>'), false, 'a page is not a page tree node');
});
