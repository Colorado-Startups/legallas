// SPDX-License-Identifier: Apache-2.0
// Self-hosts the PDF.js data files the viewer loads at run time: character maps (CJK and other
// non-embedded encodings), the 14 standard fonts, the image decoders (JPEG 2000, JBIG2, color
// management) and the ICC profile. They are copied from the pinned pdfjs-dist into dist/pdfjs/ after
// each build, so nothing is fetched from a CDN. The worker script itself is bundled by Vite
// (src/scripts/doc-pdf.ts imports it with ?url).
//
// Deliberately left out: quickjs-eval.* (the PDF JavaScript sandbox; the room never runs PDF scripts)
// and the *_nowasm_fallback.js decoders (WebAssembly is allowed by 'wasm-unsafe-eval').
//
// Of pdf.js's standard fonts, only the two a browser fetches as data: with system fonts on (pdf.js's default in a
// browser, and src/scripts/doc-pdf.ts leaves it on), pdf.js loads a file only for Symbol and ZapfDingbats and draws the
// other twelve with the reader's own fonts. So pdf.js's Liberation Sans 1.07 files (GPL-2.0 with a font exception, #31)
// never ship.
//
// For Helvetica and Arial, though, pdf.js still names its LiberationSans-*.ttf as the last source of the face it
// declares, after the local() fonts. A reader with none of those (Android Chrome) asked for them and got a 404 (#285).
// Those four paths now hold Arimo (Liberation Sans 2.x is derived from it): the same metrics as Arial, and under
// OFL-1.1 (@expo-google-fonts/arimo, which ships Google Fonts' files; LICENSE_ARIMO beside them). Only the file names
// say Liberation, because pdf.js chose them; the font names itself Arimo.
// src/scripts/doc-pdf-fonts.test.ts checks both lists against pdf.js itself.
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PDFJS = new URL('../node_modules/pdfjs-dist/', import.meta.url);
// The decoders' licence files travel with them, for the release's third-party notices (scripts/notices.ts).
const WASM = ['openjpeg.wasm', 'jbig2.wasm', 'qcms_bg.wasm', 'LICENSE_OPENJPEG', 'LICENSE_PDFJS_OPENJPEG', 'LICENSE_JBIG2', 'LICENSE_PDFJS_JBIG2', 'LICENSE_QCMS', 'LICENSE_PDFJS_QCMS'];
export const STANDARD_FONTS = ['FoxitSymbol.pfb', 'FoxitDingbats.pfb', 'LICENSE_FOXIT'];
const ARIMO = new URL('../node_modules/@expo-google-fonts/arimo/', import.meta.url);
/** The file pdf.js names for each Helvetica and Arial style, and the Arimo face served there. */
export const SANS_FALLBACK = {
  'LiberationSans-Regular.ttf': '400Regular/Arimo_400Regular.ttf',
  'LiberationSans-Bold.ttf': '700Bold/Arimo_700Bold.ttf',
  'LiberationSans-Italic.ttf': '400Regular_Italic/Arimo_400Regular_Italic.ttf',
  'LiberationSans-BoldItalic.ttf': '700Bold_Italic/Arimo_700Bold_Italic.ttf',
};

/** @returns {import('astro').AstroIntegration} */
export default function pdfjsAssets() {
  return {
    name: 'legallas-pdfjs-assets',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const out = new URL('pdfjs/', dir);
        const copyDir = (name) => cp(fileURLToPath(new URL(`${name}/`, PDFJS)), fileURLToPath(new URL(`${name}/`, out)), { recursive: true });
        await copyDir('cmaps');
        await mkdir(new URL('standard_fonts/', out), { recursive: true });
        for (const file of STANDARD_FONTS) await cp(fileURLToPath(new URL(`standard_fonts/${file}`, PDFJS)), fileURLToPath(new URL(`standard_fonts/${file}`, out)));
        for (const [name, face] of Object.entries(SANS_FALLBACK)) await cp(fileURLToPath(new URL(face, ARIMO)), fileURLToPath(new URL(`standard_fonts/${name}`, out)));
        await cp(fileURLToPath(new URL('LICENSE_FONT', ARIMO)), fileURLToPath(new URL('standard_fonts/LICENSE_ARIMO', out)));
        await copyDir('iccs');
        await mkdir(new URL('wasm/', out), { recursive: true });
        for (const file of WASM) await cp(fileURLToPath(new URL(`wasm/${file}`, PDFJS)), fileURLToPath(new URL(`wasm/${file}`, out)));
        logger.info('PDF.js cMaps, the two fetched standard fonts, the Arimo sans fallback, decoders, ICC profile and their licences copied to dist/pdfjs/');
      },
    },
  };
}
