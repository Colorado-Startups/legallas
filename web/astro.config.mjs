// SPDX-License-Identifier: Apache-2.0
// @ts-check
import { defineConfig } from 'astro/config';
import brandPublic from './integrations/brand-public.mjs';
import buildMeta from './integrations/build-meta.mjs';
import distAudit from './integrations/dist-audit.mjs';
import doorAssets from './integrations/door-assets.mjs';
import pageCss from './integrations/page-css.mjs';
import pdfjsAssets from './integrations/pdfjs-assets.mjs';
import guestViewer from './integrations/guest-viewer.mjs';
import templateAssets from './integrations/template-assets.mjs';
import { brandAssetsDir, brandHasRig, configuredRoomDefines } from './scripts/config.ts';

// Static build served by the legallas-web Worker. No sitemap and no site URL: the room is private.
export default defineConfig({
  // PDF.js data files (cMaps, standard fonts, decoders), self-hosted under /pdfjs/; the front door's
  // two fonts, at fixed public paths under /welcome/fonts/; the brand pack's icons (its public/ folder);
  // templates/founders/ for the checklist's links; each page's stylesheets joined into one file, in their order (#204).
  // The dist audit (CSP and eager script budget) runs last, over the finished output. With LEGALLAS_METAFILE set, the
  // build also records what it drew from, for the release's third-party notices (scripts/notices.ts).
  integrations: [pdfjsAssets(), guestViewer(), doorAssets(), brandPublic(), templateAssets(), pageCss(), buildMeta(), distAudit()],
  build: {
    // The Worker sends a CSP without 'unsafe-inline', so every stylesheet must be an external file.
    inlineStylesheets: 'never',
  },
  vite: {
    // What the room's build fixes, as literals in the pages' scripts (worker/room-settings.ts, worker/stored-name.ts).
    // scripts/dist-audit.ts checks the built viewer reads the stored name. BRAND_HAS_RIG leaves the Rive runtime out of
    // a build whose brand pack has no rig (src/scripts/companion-rive.ts).
    define: { ...configuredRoomDefines(), BRAND_HAS_RIG: JSON.stringify(brandHasRig(brandAssetsDir())) },
    // @brand is the brand pack (the mark, icons, miniature, and any stills and Rive rig): `brandAssets` in the room
    // config, else src/assets/legallas where the checkout has it, else the neutral pack (scripts/config.ts). Vite names
    // built files by their own name and content, so the alias changes no output path.
    resolve: { alias: { '@brand': brandAssetsDir() } },
    // Same reason for scripts: Astro inlines small scripts below Vite's limit, which the CSP would block.
    build: {
      assetsInlineLimit: 0,
      // markdown-it and its dependencies get their own lazy chunk. Without the Rive runtime in the graph (plan PR-L1),
      // Rolldown otherwise merged its small runtime helpers into the markdown chunk, and every chunk using a helper
      // then imported markdown-it statically, about 36 KB gzipped of eager script on most pages (R20).
      rollupOptions: {
        output: {
          codeSplitting: {
            groups: [{ name: 'markdown-it', test: /node_modules[\\/](markdown-it|mdurl|uc\.micro|linkify-it|punycode\.js|entities)[\\/]/ }],
          },
        },
      },
    },
  },
});
