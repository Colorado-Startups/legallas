// SPDX-License-Identifier: Apache-2.0
// The real pdf.js everywhere, and the real Windows OCR API on a Windows runner (CI's sync-windows job). The image is drawn
// on the runner from invented text, and put in a PDF with no text layer, as a scanner makes one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pdfBytes } from './dev-pdf.ts';
import { pdfjsLayers, platformExtractor, windowsExtractor } from './extract-windows.ts';

const WINDOWS = process.platform === 'win32';
const notWindows = !WINDOWS && 'the Windows OCR API is on Windows';

async function inTemp<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'legallas-ocr-'));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Draws black text on white, large enough to read, with what Windows ships. */
function drawJpeg(file: string, lines: readonly string[]): { width: number; height: number } {
  const width = 1700;
  const height = 2200;
  const script = `
    Add-Type -AssemblyName System.Drawing
    $bitmap = New-Object System.Drawing.Bitmap ${width}, ${height}
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.Clear([System.Drawing.Color]::White)
    $font = New-Object System.Drawing.Font 'Arial', 48
    $y = 150
    foreach ($line in @(${lines.map((line) => `'${line}'`).join(', ')})) {
      $graphics.DrawString($line, $font, [System.Drawing.Brushes]::Black, 120, $y)
      $y += 120
    }
    $bitmap.Save('${file}', [System.Drawing.Imaging.ImageFormat]::Jpeg)
  `;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: ['ignore', 'ignore', 'inherit'] });
  return { width, height };
}

/** A one-page PDF holding only this JPEG: no text layer, as a scan is. */
function scannedPdf(jpeg: Buffer, width: number, height: number): Buffer {
  return pdfOf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>'),
    (() => {
      const content = 'q 612 0 0 792 0 0 cm /Im0 Do Q';
      return Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    })(),
    Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),
      jpeg,
      Buffer.from('\nendstream'),
    ]),
  ]);
}

/** A PDF of these objects, numbered from 1, with object 1 as its catalog. */
function pdfOf(objects: readonly Buffer[]): Buffer {
  const chunks: Buffer[] = [Buffer.from('%PDF-1.7\n')];
  const offsets: number[] = [];
  let at = chunks[0]!.length;
  objects.forEach((body, index) => {
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    offsets.push(at);
    chunks.push(chunk);
    at += chunk.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)].join('');
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

const stream = (content: string, entries = '') => Buffer.from(`<< ${entries} /Length ${content.length} >>\nstream\n${content}\nendstream`);

test('pdf.js reads each page\'s text layer, and grades it', async () => {
  await inTemp(async (dir) => {
    const file = path.join(dir, '000001.pdf');
    await writeFile(file, pdfBytes([['Stock Purchase Agreement', 'Harbor Labs'], ['Second page']]));
    const pages = await pdfjsLayers(file);
    assert.deepEqual(pages.map((page) => [page.n, page.text]), [[1, 'Stock Purchase Agreement\nHarbor Labs'], [2, 'Second page']]);
    assert.equal(pages[0]!.quality, 'sparse');
  });
});

test('a number typed into a filled form field is read with the page (#347)', async () => {
  await inTemp(async (dir) => {
    const file = path.join(dir, '000001.pdf');
    // The SSA's voided sample number, joined at run time.
    const number = ['078', '05', '1120'].join('-');
    await writeFile(file, pdfOf([
      Buffer.from('<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] >> >>'),
      Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
      Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Annots [5 0 R] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>'),
      stream('BT /F1 12 Tf 72 720 Td (visible) Tj ET'),
      Buffer.from(`<< /Type /Annot /Subtype /Widget /FT /Tx /T (ssn) /V (${number}) /Rect [72 600 300 620] /P 3 0 R >>`),
    ]));
    const [page] = await pdfjsLayers(file);
    assert.equal(page!.text, 'visible');
    assert.equal(page!.fields, number);
    const [read] = await windowsExtractor(async () => new Map(), pdfjsLayers)(file);
    assert.equal(read!.text, `visible\n${number}`);
  });
});

test('a PDF whose page tree says it has no pages fails, and its text is never counted as scanned', async () => {
  await inTemp(async (dir) => {
    const file = path.join(dir, '000001.pdf');
    await writeFile(file, pdfOf([
      Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
      Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 0 >>'),
      Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>'),
      stream('BT /F1 12 Tf 72 720 Td (Invented page) Tj ET'),
    ]));
    await assert.rejects(windowsExtractor(async () => new Map(), pdfjsLayers)(file), { message: 'pdf failed: unreadable' });
  });
});

test('a page past the tree\'s /Count fails the file, so its text is never counted as scanned (#349)', async () => {
  await inTemp(async (dir) => {
    const file = path.join(dir, '000001.pdf');
    // The SSA's voided sample number, joined at run time.
    const number = ['078', '05', '1120'].join('-');
    const font = '/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>';
    await writeFile(file, pdfOf([
      Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
      Buffer.from('<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 1 >>'),
      Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R ${font} >>`),
      Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R ${font} >>`),
      stream('BT /F1 12 Tf 72 720 Td (first) Tj ET'),
      stream(`BT /F1 12 Tf 72 720 Td (second ${number}) Tj ET`),
    ]));
    await assert.rejects(pdfjsLayers(file), { message: 'pdf failed: unreadable' });
  });
});

test('a PDF that draws itself for ever stops at the deadline, and one that fills the heap fails alone', async () => {
  await inTemp(async (dir) => {
    const file = path.join(dir, '000001.pdf');
    // Nine levels of forms, each painting the next ten times: small on disk, and about a billion paints.
    const forms = Array.from({ length: 9 }, (_, level) => {
      const resources = level < 8 ? `/XObject << /F ${level + 6} 0 R >>` : '/Font << /T << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >>';
      return stream(level < 8 ? '/F Do '.repeat(10) : 'BT /T 1 Tf (x) Tj ET', `/Type /XObject /Subtype /Form /BBox [0 0 1 1] /Resources << ${resources} >>`);
    });
    await writeFile(file, pdfOf([
      Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
      Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
      Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /F 5 0 R >> >> /Contents 4 0 R >>'),
      stream('/F Do'),
      ...forms,
    ]));
    await assert.rejects(pdfjsLayers(file, { timeoutMs: 3000 }), { message: 'pdf failed: timeout' });
    await writeFile(file, pdfBytes([['Invented page']]));
    await assert.rejects(pdfjsLayers(file, { heapMb: 4 }), { message: /pdf failed: (too-large|unreadable)/ });
  });
});

test('a file that is no PDF fails with a short code', async () => {
  await inTemp(async (dir) => {
    const file = path.join(dir, '000001.pdf');
    await writeFile(file, 'not a pdf, and a secret word');
    await assert.rejects(pdfjsLayers(file), { message: 'pdf failed: unreadable' });
  });
});

test('Windows OCR reads an image', { skip: notWindows }, async () => {
  await inTemp(async (dir) => {
    const file = path.join(dir, '000001.jpg');
    drawJpeg(file, ['Harbor Labs Incorporated', 'Founder Stock Agreement']);
    const pages = await platformExtractor()(file);
    assert.equal(pages.length, 1);
    assert.equal(pages[0]!.ocr, true);
    assert.match(pages[0]!.text, /Harbor Labs/);
    assert.match(pages[0]!.text, /Stock Agreement/);
  });
});

test('Windows OCR reads a scanned PDF, which has no text layer at all', { skip: notWindows }, async () => {
  await inTemp(async (dir) => {
    const jpeg = path.join(dir, 'scan.jpg');
    const { width, height } = drawJpeg(jpeg, ['Convertible Note', 'Principal Fifty Thousand']);
    const file = path.join(dir, '000002.pdf');
    await writeFile(file, scannedPdf(await readFile(jpeg), width, height));
    const pages = await pdfjsLayers(file);
    assert.equal(pages[0]!.text, '');
    assert.equal(pages[0]!.quality, 'sparse');

    const read = await platformExtractor()(file);
    assert.equal(read.length, 1);
    assert.equal(read[0]!.ocr, true);
    assert.match(read[0]!.text, /Convertible Note/);
  });
});
