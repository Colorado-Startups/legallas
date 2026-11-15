// SPDX-License-Identifier: Apache-2.0
// The guest's PDF viewer (worker/routes/rooms.ts, the view page): draws each page of #pages[data-src] on a canvas with
// PDF.js, so a guest reads a PDF with no download button. Plain JavaScript, copied to dist/guest/ at build time with
// PDF.js's two files (integrations/guest-viewer.mjs), never from the room's own build, which carries its settings.
import * as pdfjs from '/guest/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = '/guest/pdf.worker.min.mjs';
const root = document.getElementById('pages');
try {
  const pdf = await pdfjs.getDocument({ url: root.dataset.src, isEvalSupported: false, enableXfa: false }).promise;
  root.textContent = '';
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const width = page.getViewport({ scale: 1 }).width;
    const viewport = page.getViewport({ scale: (Math.min(root.clientWidth || 800, 1200) / width) * (window.devicePixelRatio || 1) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.className = 'guest-page';
    canvas.setAttribute('aria-label', `Page ${number} of ${pdf.numPages}`);
    root.append(canvas);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  }
} catch {
  root.textContent = 'This document could not be shown. Reload the page to try again.';
}
