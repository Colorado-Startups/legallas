// SPDX-License-Identifier: Apache-2.0
// The founder templates, served under /templates/founders/ so the company checklist can link to them (worker/checklist.ts).
// Behind the room's gate like every static file.
import { cpSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export default function templateAssets() {
  return {
    name: 'template-assets',
    hooks: {
      'astro:build:done': ({ dir }) => {
        cpSync(fileURLToPath(new URL('../../templates/founders/', import.meta.url)), fileURLToPath(new URL('templates/founders/', dir)), {
          recursive: true,
          // A link would serve whatever it points at, so one stops the build. Only the templates themselves are served.
          filter: (source) => {
            const file = lstatSync(source);
            if (file.isSymbolicLink()) throw new Error(`templates: ${source} is a link`);
            return file.isDirectory() || source.endsWith('.md');
          },
        });
      },
    },
  };
}
