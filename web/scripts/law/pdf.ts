// SPDX-License-Identifier: Apache-2.0
// Text lines from a text PDF (3 CCR 704-1), with the room's own pdfjs-dist: items on one baseline join into a
// line, and a blank line separates what pdfjs marks as the end of a line followed by a gap. pdfItems keeps each run's
// place and size instead, for the slip opinions (slip.ts), whose footnotes and marks only size and spacing tell
// apart. No OCR: these PDFs carry their text.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

interface TextItem {
  str: string;
  transform: number[];
  width?: number;
  hasEOL?: boolean;
}

/** One text run with its place on the page (PDF points, origin bottom left) and font size. */
export interface PdfItem {
  page: number;
  str: string;
  x: number;
  y: number;
  width: number;
  size: number;
}

/** Every non-empty text run of every page with its position and size, for layouts that lines alone cannot tell apart. */
export async function pdfItems(data: Buffer): Promise<PdfItem[]> {
  const doc = await getDocument({ data: new Uint8Array(data), verbosity: 0 }).promise;
  const items: PdfItem[] = [];
  const round = (n: number) => Math.round(n * 10) / 10;
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    for (const raw of content.items) {
      if (!('str' in raw)) continue;
      const item = raw as TextItem;
      if (!item.str.trim()) continue;
      const [a = 0, b = 0, , d = 0, x = 0, y = 0] = item.transform;
      items.push({ page: p, str: item.str, x: round(x), y: round(y), width: round(item.width ?? 0), size: round(Math.max(Math.hypot(a, b), Math.abs(d))) });
    }
  }
  await doc.cleanup();
  return items;
}

/** Every line of every page, in reading order, with an empty line between paragraphs and pages. */
export async function pdfLines(data: Buffer): Promise<string[]> {
  const doc = await getDocument({ data: new Uint8Array(data), verbosity: 0 }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    let line = '';
    let lastY: number | null = null;
    for (const raw of content.items) {
      if (!('str' in raw)) continue;
      const item = raw as TextItem;
      const y = item.transform[5]!;
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        lines.push(line);
        line = '';
      }
      line += item.str;
      lastY = y;
      if (item.hasEOL) {
        lines.push(line);
        line = '';
        lastY = null;
      }
    }
    lines.push(line, '');
  }
  await doc.cleanup();
  return lines;
}
