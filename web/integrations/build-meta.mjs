// SPDX-License-Identifier: Apache-2.0
// Records what the site build drew from, for the release bundle's third-party notices (scripts/notices.ts): every
// module in the browser chunks, and the source of every emitted asset (fonts and images included). It writes an
// esbuild-style metafile ({ inputs }) to the path in LEGALLAS_METAFILE, the same shape `wrangler --metafile` writes for
// the Workers. Without that variable it does nothing, so an ordinary build is unchanged.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** @returns {import('astro').AstroIntegration} */
export default function buildMeta() {
  const out = process.env.LEGALLAS_METAFILE;
  /** @type {Set<string>} */
  const inputs = new Set();
  return {
    name: 'legallas-build-meta',
    hooks: {
      'astro:build:setup': ({ vite }) => {
        if (!out) return;
        (vite.plugins ??= []).push({
          name: 'legallas-build-meta',
          generateBundle(_options, bundle) {
            for (const file of Object.values(bundle)) {
              // Prerender chunks only render pages at build time; their code never ships. Their CSS and fonts do.
              if (file.type === 'chunk' && this.environment.name === 'client') for (const id of file.moduleIds) inputs.add(id);
              if (file.type === 'asset') for (const name of file.originalFileNames) inputs.add(name);
            }
          },
        });
      },
      'astro:build:done': () => {
        if (!out) return;
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, JSON.stringify({ inputs: Object.fromEntries([...inputs].sort().map((id) => [id, {}])) }, null, 1));
      },
    },
  };
}
