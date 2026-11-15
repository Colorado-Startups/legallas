// SPDX-License-Identifier: Apache-2.0
// The /doc/ page's first read, shared by its two scripts. doc-early.ts, the first script after the boot guard, starts it;
// doc-page.ts, last on the page, reads the same answer. /api/doc/:id is asked once (it writes the open's one `view` audit
// row), and a #page= link starts the PDF viewer beside it instead of after it.
import { getJson, pageFromHash, type DocMeta, type Loaded } from './files-api.ts';

/** The document the address names, or null. */
export function docIdIn(search: string): string | null {
  return new URLSearchParams(search).get('id') || null;
}

type GetDoc = (url: string) => Promise<Loaded<DocMeta>>;

let asked: { id: string; meta: Promise<Loaded<DocMeta>> } | null = null;

/** GET /api/doc/:id, asked once for the page however many scripts call. */
export function docMeta(id: string, get: GetDoc = (url) => getJson<DocMeta>(url)): Promise<Loaded<DocMeta>> {
  if (asked?.id !== id) asked = { id, meta: get(`/api/doc/${encodeURIComponent(id)}`) };
  return asked.meta;
}

/** Controls for warming the PDF viewer ahead of use, and stopping that if the file is not a PDF. */
export interface PdfWarmth {
  /** Starts the viewer's code and worker. */
  warm(): void;
  /** Stops the worker's download: the document turned out not to be a PDF. */
  cool(): void;
}

/**
 * Asks for the document. A link naming a page is a cite, nearly always into a PDF, so the viewer starts beside the
 * question. A cite into a text file carries #page=1 too; its worker is stopped once the answer says so.
 */
export function startDocPage(where: Pick<Location, 'search' | 'hash'>, pdf: PdfWarmth, get?: GetDoc): void {
  const id = docIdIn(where.search);
  if (!id) return;
  const meta = docMeta(id, get);
  if (!pageFromHash(where.hash)) return;
  pdf.warm();
  void meta.then((result) => {
    if (result.ok && result.value.viewer !== 'pdf') pdf.cool();
  });
}
