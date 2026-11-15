// SPDX-License-Identifier: Apache-2.0
// What a PDF needs besides PDF.js itself, started the moment a page knows it has a PDF to show (#203). It imports
// nothing from pdfjs-dist but the worker's address, so the worker and a small file come in beside the library instead
// of after it: on a slow link each of those waits used to cost a round trip, and the worker its whole download.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { pdfWorkerSlot, prefetchPdf } from './doc-pdf-file.ts';

export { workerUrl };

/** What a PDF open starts early: the page's PDF.js worker and the file's bytes when small. */
export interface PdfStart {
  /** The page's one PDF.js worker, already downloading; null where a module worker can't start (PDF.js then makes its own). */
  readonly port: Worker | null;
  /** The file's bytes when it is small enough to read whole (doc-pdf-file.ts), else null and PDF.js reads it in ranges. */
  readonly bytes: Promise<Uint8Array | null>;
  /** Stops the file read, when the viewer closes before it is used. */
  abort(): void;
}

const worker = pdfWorkerSlot(() => new Worker(workerUrl, { type: 'module' }));

/** The page's one worker, started on first use (a chunk gone after a deploy or a network error drops it: doc-pdf-file.ts). */
export function pdfWorkerPort(): Worker | null {
  return worker.port();
}

/** Settles if the page's worker fails to load or is dropped, so the viewer opens the document again without it. */
export function pdfWorkerFailed(): Promise<void> {
  return worker.failed();
}

/** Stops the page's worker (the /doc/ page warmed it for a file that is not a PDF). */
export function dropPdfWorker(): void {
  worker.drop();
}

let viewer: Promise<typeof import('./doc-pdf.ts')> | null = null;

/**
 * The viewer's code and the page's worker, started together the moment a page expects a PDF: a #page= link, a click on a
 * cite, an answer citing a PDF. Neither waits for /api/doc then. A failed load is forgotten, so the next open tries again.
 */
export function loadPdfViewer(): Promise<typeof import('./doc-pdf.ts')> {
  pdfWorkerPort();
  viewer ??= import('./doc-pdf.ts').catch((error: unknown) => {
    viewer = null;
    throw error;
  });
  return viewer;
}

/** Starts the worker and, for a small file, the file itself. `size` is the document's size in bytes, when known. */
export function startPdf(id: string, size: number | null | undefined): PdfStart {
  const life = new AbortController();
  return {
    port: pdfWorkerPort(),
    bytes: prefetchPdf(id, size, life.signal),
    abort: () => life.abort(),
  };
}
