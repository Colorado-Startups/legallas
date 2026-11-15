// SPDX-License-Identifier: Apache-2.0
// The deal-room guest's viewer (worker/routes/rooms.ts GUEST_ASSETS): guest/viewer.js and PDF.js's library and worker
// from the pinned pdfjs-dist, copied to dist/guest/ after each build. Nothing in them comes from the room's own build,
// so they carry none of its settings, and a guest is served these three files and no other asset.
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PDFJS = new URL('../node_modules/pdfjs-dist/build/', import.meta.url);
const VIEWER = new URL('../guest/viewer.js', import.meta.url);

/** @returns {import('astro').AstroIntegration} */
export default function guestViewer() {
  return {
    name: 'legallas-guest-viewer',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const out = new URL('guest/', dir);
        await mkdir(out, { recursive: true });
        await cp(fileURLToPath(VIEWER), fileURLToPath(new URL('viewer.js', out)));
        for (const file of ['pdf.min.mjs', 'pdf.worker.min.mjs']) await cp(fileURLToPath(new URL(file, PDFJS)), fileURLToPath(new URL(file, out)));
        logger.info('The guest viewer and PDF.js copied to dist/guest/');
      },
    },
  };
}
