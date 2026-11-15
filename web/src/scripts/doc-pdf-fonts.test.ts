// SPDX-License-Identifier: Apache-2.0
// The viewer ships only the standard fonts pdf.js can fetch in a browser (integrations/pdfjs-assets.mjs, #31). These
// tests read pdf.js itself, so an upgrade that fetches more fonts, or a viewer option that turns system fonts off,
// fails here instead of leaving a page drawn without its font.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { SANS_FALLBACK, STANDARD_FONTS } from '../../integrations/pdfjs-assets.mjs';

const pdfjs = new URL('../../node_modules/pdfjs-dist/', import.meta.url);
const library = readFileSync(new URL('build/pdf.mjs', pdfjs), 'utf8');
const worker = readFileSync(new URL('build/pdf.worker.mjs', pdfjs), 'utf8');
const viewer = readFileSync(new URL('doc-pdf.ts', import.meta.url), 'utf8');
const has = (text: string, pattern: RegExp) => pattern.test(text);

test('with system fonts on, pdf.js fetches a file only for Symbol and ZapfDingbats', () => {
  assert.ok(has(library, /useSystemFonts = typeof src\.useSystemFonts === "boolean" \? src\.useSystemFonts : !isNodeJS && !disableFontFace;/), 'on by default in a browser');
  assert.ok(has(worker, /if \(this\.options\.useSystemFonts && name !== "Symbol" && name !== "ZapfDingbats"\) \{\s*return null;/), 'no fetch for the other twelve');
  assert.ok(!has(viewer, /useSystemFonts|disableFontFace/), 'the viewer leaves system fonts on');
});

test('the build copies exactly those two fonts and their licence, and no Liberation Sans', () => {
  const file = (name: string) => worker.match(new RegExp(`t\\.${name} = "(Foxit[A-Za-z]+\\.pfb)";`))?.[1];
  assert.deepEqual(STANDARD_FONTS, [file('Symbol'), file('ZapfDingbats'), 'LICENSE_FOXIT']);
  for (const name of STANDARD_FONTS) assert.ok(existsSync(new URL(`standard_fonts/${name}`, pdfjs)), name);
  assert.ok(!STANDARD_FONTS.some((name) => name.startsWith('Liberation')));
});

test('every LiberationSans file pdf.js names as a last source is served, by Arimo under OFL-1.1 (#285)', () => {
  // pdf.js names these as the url() source of Helvetica and Arial after the local() fonts.
  const named = [...worker.matchAll(/\] = "(LiberationSans-[A-Za-z]+\.ttf)";|\.Helvetica = "(LiberationSans-[A-Za-z]+\.ttf)";/g)].map((m) => (m[1] ?? m[2])!);
  assert.ok(named.length >= 4, 'pdf.js still names its sans fallback files');
  assert.deepEqual([...new Set(named)].sort(), Object.keys(SANS_FALLBACK).sort(), 'one served file for each name');
  assert.match(worker, /src\.push\(`url\(\$\{localFontPath\}\$\{path\}\)`\);/, 'as a url() under standardFontDataUrl');
  const arimo = new URL('../../node_modules/@expo-google-fonts/arimo/', import.meta.url);
  for (const face of Object.values(SANS_FALLBACK)) {
    const bytes = readFileSync(new URL(face, arimo));
    assert.equal(bytes.readUInt32BE(0), 0x00010000, `${face} is a TrueType font`);
  }
  assert.match(readFileSync(new URL('LICENSE_FONT', arimo), 'utf8'), /SIL Open Font License, Version 1\.1/);
});
