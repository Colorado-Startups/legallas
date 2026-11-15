// SPDX-License-Identifier: Apache-2.0
// pdf_viewer.mjs reads the core library from globalThis.pdfjsLib as it evaluates. doc-pdf.ts imports this module just
// before the viewer, so ES module order sets the global first, and the browser fetches both chunks at once (#203)
// instead of the viewer only after the library had arrived.
import * as pdfjs from 'pdfjs-dist';

(globalThis as { pdfjsLib?: unknown }).pdfjsLib = pdfjs;

export { pdfjs };
