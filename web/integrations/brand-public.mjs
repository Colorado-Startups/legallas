// SPDX-License-Identifier: Apache-2.0
// Copies the brand pack's public/ folder (the room's icon at /favicon.svg, the front door's /welcome/favicon.svg and
// the Access login logo /welcome/seal-access.svg) into the build root as it is, after Astro has copied web/public/.
// The pack is @brand's folder (scripts/config.ts brandAssetsDir), so a room's icons follow its brand pack; the
// Worker's public list (worker/public.ts) names the front door's two. Listed before the dist audit in astro.config.mjs.
import { cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brandAssetsDir } from '../scripts/config.ts';

/** @returns {import('astro').AstroIntegration} */
export default function brandPublic() {
  return {
    name: 'legallas-brand-public',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const pack = brandAssetsDir();
        await cp(path.join(pack, 'public'), fileURLToPath(dir), { recursive: true });
        logger.info(`Brand icons copied to dist/ from ${path.relative(process.cwd(), pack) || pack}/public/`);
      },
    },
  };
}
