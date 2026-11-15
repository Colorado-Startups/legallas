// SPDX-License-Identifier: Apache-2.0
// Self-hosts the two fonts the front door (/welcome/) uses. The room's own fonts are bundled by Vite
// under /_astro/, which stays behind Cloudflare Access, so a visitor who has not signed in could not
// load them. These copies keep fixed names under dist/welcome/fonts/, and the Worker's public list
// (worker/public.ts) names each one.
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const MODULES = new URL('../node_modules/@fontsource-variable/', import.meta.url);
export const DOOR_FONTS = ['source-serif-4/files/source-serif-4-latin-wght-normal.woff2', 'inter/files/inter-latin-wght-normal.woff2'];

/** @returns {import('astro').AstroIntegration} */
export default function doorAssets() {
  return {
    name: 'legallas-door-assets',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const out = new URL('welcome/fonts/', dir);
        await mkdir(out, { recursive: true });
        for (const file of DOOR_FONTS) {
          const name = file.split('/').pop();
          await cp(fileURLToPath(new URL(file, MODULES)), fileURLToPath(new URL(name, out)));
        }
        logger.info('Front door fonts copied to dist/welcome/fonts/');
      },
    },
  };
}
