// SPDX-License-Identifier: Apache-2.0
// What doc-pdf-start.ts starts, in its own file so tests can run it under Node: the page's one PDF.js worker, and a small
// PDF read whole beside the library's download (#203), so PDF.js has the bytes the moment it starts instead of asking for
// them after its worker is up.
import { fileUrl } from './files-api.ts';

/** The page's one PDF.js worker, shared by every viewer it opens (the exhibit pane opens many). */
export interface WorkerSlot {
  /** The worker, started on the first call; null where a module worker can't start or failed (PDF.js then makes its own). */
  port(): Worker | null;
  /**
   * Settles when the current worker fails to load or is dropped. PDF.js trusts a port it is given and never hears of
   * either, so a viewer races its first answer against this and opens the document again without the port.
   */
  failed(): Promise<void>;
  /** Stops the worker. A viewer racing it gets `failed`; the next `port()` starts a new one. */
  drop(): void;
}

/** A slot whose worker `start` makes. A worker that fails to load is dropped for good, so later PDFs use PDF.js's own. */
export function pdfWorkerSlot(start: () => Worker): WorkerSlot {
  let port: Worker | null | undefined;
  let failed: Promise<void> = new Promise(() => undefined);
  let fail: () => void = () => undefined;
  return {
    port() {
      if (port !== undefined) return port;
      try {
        const worker = start();
        failed = new Promise<void>((resolve) => {
          fail = () => resolve();
        });
        const gone = fail;
        worker.addEventListener('error', () => {
          if (port === worker) port = null;
          worker.terminate();
          gone();
        }, { once: true });
        port = worker;
      } catch {
        port = null;
      }
      return port;
    },
    failed: () => failed,
    drop() {
      port?.terminate();
      port = undefined;
      fail();
      failed = new Promise(() => undefined);
      fail = () => undefined;
    },
  };
}

/**
 * Files up to this size are read whole, at once. A larger file is left to PDF.js, which asks for the ranges it needs, so
 * a page deep in a long PDF draws before the whole file is in.
 */
export const PREFETCH_MAX_BYTES = 1024 * 1024;

/** The file's bytes, or null when it is too big to read whole, the read failed or it was stopped (PDF.js then fetches it). */
export async function prefetchPdf(id: string, size: number | null | undefined, signal: AbortSignal): Promise<Uint8Array | null> {
  if (typeof size !== 'number' || !(size > 0) || size > PREFETCH_MAX_BYTES) return null;
  try {
    const res = await fetch(fileUrl(id), { credentials: 'same-origin', signal });
    if (!res.ok) {
      // Nothing will read this body, so it is closed rather than left open.
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}
