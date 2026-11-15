// SPDX-License-Identifier: Apache-2.0
// `npm run sync -- --check-index`: extract and split every indexable document locally and print aggregate
// counts only. Nothing is uploaded and D1 is not written; extracted text lands only in the sha256 cache
// (<cacheDir>/text/), where a later --apply reuses it. Proves OCR on scanned PDFs and part splitting on large
// ones before anything reaches Cloudflare.
import { ExtractorUnavailable, indexSource, renderKind, type ExtractedPage } from './extract.ts';
import type { IndexJob } from './indexjob.ts';
import { buildParts, PiiInPart, type IndexPart } from './indexparts.ts';
import { mapLimit } from './pool.ts';
import { formatBytes } from './report.ts';

export interface IndexCheck {
  pdfs: number;
  images: number;
  /** Images where OCR found text. */
  imagesWithText: number;
  textDocs: number;
  /** Text documents set out as text by a renderer (SEC Form D XML). */
  renderedDocs: number;
  /** Emails (.eml) set out as headers, attachment names and text. */
  emailDocs: number;
  /** Office documents (Word, RTF, OpenDocument text, PowerPoint, Excel) read as text. */
  officeDocs: number;
  /** Pages, Numbers and Keynote documents read as text. */
  iworkDocs: number;
  /** HTML visuals read from their rendered text (scripts/visual-ai.ts); one with none yet fails as "visual-text". */
  visualDocs: number;
  /** Failures by extractor error code (unreadable, encrypted, ocr, ...). Never file names. */
  failed: Record<string, number>;
  pages: number;
  ocrPages: number;
  pdfsWithOcr: number;
  /** PDFs whose text came only from OCR (scans with no text layer). */
  scannedPdfs: number;
  emptyDocs: number;
  parts: number;
  multiPartDocs: number;
  largestPart: number;
}

export interface CheckDeps {
  extractPdf: (file: string, sha256: string) => Promise<ExtractedPage[]>;
  readText: (file: string, name: string) => Promise<ExtractedPage[]>;
  onProgress?: (done: number, total: number) => void;
}

const CONCURRENCY = 4;
const encoder = new TextEncoder();

/** The extractor's short stderr code from a failure message, or "other". */
export function failureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const code = message.split(':').pop()?.trim().split(/\s+/).pop() ?? '';
  return /^[a-z][a-z_-]{0,29}$/.test(code) ? code : 'other';
}

export async function checkIndex(jobs: readonly IndexJob[], deps: CheckDeps): Promise<IndexCheck> {
  const result: IndexCheck = {
    pdfs: 0, images: 0, imagesWithText: 0, textDocs: 0, renderedDocs: 0, emailDocs: 0, officeDocs: 0, iworkDocs: 0, visualDocs: 0, failed: {}, pages: 0, ocrPages: 0,
    pdfsWithOcr: 0, scannedPdfs: 0, emptyDocs: 0, parts: 0, multiPartDocs: 0, largestPart: 0,
  };
  let done = 0;
  await mapLimit(jobs, CONCURRENCY, async (job) => {
    const viaExtractor = indexSource(job.kind, job.file) === 'extractor';
    let pages: ExtractedPage[];
    try {
      pages = viaExtractor ? await deps.extractPdf(job.file, job.sha256) : await deps.readText(job.file, job.name);
    } catch (error) {
      // Without the extractor the check cannot say anything about PDFs, so stop rather than report zeros.
      if (error instanceof ExtractorUnavailable) throw error;
      const code = failureCode(error);
      result.failed[code] = (result.failed[code] ?? 0) + 1;
      return;
    } finally {
      deps.onProgress?.(++done, jobs.length);
    }
    if (job.kind === 'image') {
      result.images += 1;
      if (pages.some((page) => page.text.trim() !== '')) result.imagesWithText += 1;
    } else if (viaExtractor) {
      result.pdfs += 1;
      const withText = pages.filter((page) => page.text.trim() !== '');
      const ocr = withText.filter((page) => page.ocr).length;
      result.pages += pages.length;
      result.ocrPages += ocr;
      if (ocr > 0) result.pdfsWithOcr += 1;
      if (withText.length > 0 && ocr === withText.length) result.scannedPdfs += 1;
    } else {
      result.textDocs += 1;
      const rendered = pages.some((page) => page.rendered) ? renderKind(job.name) : null;
      if (rendered === 'formd') result.renderedDocs += 1;
      if (rendered === 'email') result.emailDocs += 1;
      if (rendered === 'office') result.officeDocs += 1;
      if (rendered === 'iwork') result.iworkDocs += 1;
      if (rendered === 'visual') result.visualDocs += 1;
    }
    let parts: IndexPart[];
    try {
      parts = buildParts(job.id, pages);
    } catch (error) {
      // The index's last check refused the text: it holds a printed SSN (pii.ts rule ssn-form).
      if (!(error instanceof PiiInPart)) throw error;
      result.failed.ssn = (result.failed.ssn ?? 0) + 1;
      return;
    }
    if (parts.length === 0) result.emptyDocs += 1;
    if (parts.length > 1) result.multiPartDocs += 1;
    result.parts += parts.length;
    for (const part of parts) result.largestPart = Math.max(result.largestPart, encoder.encode(part.body).length);
  });
  return result;
}

export function formatIndexCheck(check: IndexCheck): string {
  const failed = Object.entries(check.failed).sort(([a], [b]) => (a < b ? -1 : 1));
  return [
    'Index check (local only: nothing uploaded, D1 untouched)',
    `  PDFs extracted: ${check.pdfs} (${check.pages} pages, ${check.ocrPages} pages by OCR)`,
    `  PDFs using OCR: ${check.pdfsWithOcr}, of which fully scanned: ${check.scannedPdfs}`,
    `  Images OCR'd: ${check.images}, with text found: ${check.imagesWithText}`,
    `  Text documents read: ${check.textDocs}, of which SEC Form D XML set out as text: ${check.renderedDocs}, ` +
      `emails set out as text: ${check.emailDocs}, office documents read as text: ${check.officeDocs}, ` +
      `Pages, Numbers and Keynote documents read as text: ${check.iworkDocs}, ` +
      `visuals read from their rendered text: ${check.visualDocs}`,
    `  Failed: ${failed.length === 0 ? 'none' : failed.map(([code, n]) => `${code} ${n}`).join(', ')}`,
    `  Documents with no text: ${check.emptyDocs}`,
    `  Index parts: ${check.parts}; documents split into several parts: ${check.multiPartDocs}; ` +
      `largest part ${formatBytes(check.largestPart)}`,
  ].join('\n');
}
