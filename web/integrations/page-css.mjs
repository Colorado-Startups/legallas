// SPDX-License-Identifier: Apache-2.0
// Joins each built page's stylesheets into one file, in the order the page links them (#204). The rules and why the
// cascade is unchanged are in scripts/page-css.ts. Listed before the dist audit in astro.config.mjs, which then checks
// the joined files and pages like any other.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { joinPageCss } from '../scripts/page-css.ts';

/** @returns {import('astro').AstroIntegration} */
export default function pageCss() {
  return {
    name: 'legallas-page-css',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const dist = fileURLToPath(dir).replace(/\/$/, '');
        const read = (urlPath) => {
          try {
            return readFileSync(path.join(dist, urlPath), 'utf8');
          } catch {
            return undefined;
          }
        };
        const written = new Set();
        let pages = 0;
        let before = 0;
        for (const entry of readdirSync(dist, { withFileTypes: true, recursive: true })) {
          if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
          const file = path.join(entry.parentPath, entry.name);
          const joined = joinPageCss(readFileSync(file, 'utf8'), read);
          if (!joined) continue;
          if (!written.has(joined.href)) {
            // Never over one of Astro's own files: their hashes are 8 characters and these 10, but it costs one check.
            if (existsSync(path.join(dist, joined.href))) throw new Error(`page-css: ${joined.href} already exists`);
            writeFileSync(path.join(dist, joined.href), joined.css);
            written.add(joined.href);
          }
          writeFileSync(file, joined.html);
          pages += 1;
          before += joined.joined.length;
        }
        logger.info(`${pages} pages: ${before} stylesheets joined into ${written.size} files, one a page`);
      },
    },
  };
}
