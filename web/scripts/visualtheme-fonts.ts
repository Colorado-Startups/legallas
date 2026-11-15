// SPDX-License-Identifier: Apache-2.0
// Card F6b (binder theme fixes): the embedded faces of the theme pass (scripts/visualtheme.ts), trimmed per page.
//
// Embedding the whole variable latin files added about 212 KB to every page. Each page now embeds only the
// faces it uses (sans always; serif, its italic and mono when the page asks for them), with the weight axis
// pinned to the one weight the page uses or limited to the range between its lightest and heaviest (R56).
// Sans and upright serif are subset to printable ASCII plus every other character in the page (markup,
// entities, style sheets and script strings). Serif italic and mono, whose text is short, are subset to the text
// that renders in them, or to the full page set when a script writes into them (visualtheme-facetext.ts, R75).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import subsetFont from 'subset-font';
import { NOTICE_IDS, renameFont } from './font-rename.ts';
import type { StackKind } from './visualtheme-css.ts';

/**
 * The family each embedded face carries, in the font and the CSS (visualtheme-css.ts takes these for its stacks).
 * IBM Plex Mono and Source Serif 4 have OFL Reserved Font Names ("Plex" and "Source") that a subset may not use, so
 * theirs are renamed (font-rename.ts). Inter has none and keeps its name.
 */
export const FAMILY: Record<StackKind, string> = { sans: 'Inter Variable', serif: 'Binder Serif', mono: 'Binder Mono' };

const SERIF = { 'Source Serif 4': FAMILY.serif, SourceSerif4: 'BinderSerif' };
const MONO = { 'IBM Plex Mono': FAMILY.mono, IBMPlexMono: 'BinderMono' };
const RESERVED = ['Source', 'Plex'];

/** The source faces, latin subsets from @fontsource. Variable faces carry a wght axis over `range`. */
export const FACES = {
  sans: { file: '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', range: [100, 900], rename: null },
  serif: { file: '@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2', range: [200, 900], rename: SERIF },
  serifItalic: { file: '@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-italic.woff2', range: [200, 900], rename: SERIF },
  mono400: { file: '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', range: null, rename: MONO },
  mono500: { file: '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', range: null, rename: MONO },
} as const;

export type FaceName = keyof typeof FACES;

/** One face to embed: which, the weight axis (one weight or a range; none for a static face) and the text. */
export interface FaceRequest {
  face: FaceName;
  wght: number | { min: number; max: number } | null;
  text: string;
}

/** Turns a request into base64 woff2. The real one subsets with harfbuzz; tests pass a fake. */
export interface ThemeFonts {
  load(request: FaceRequest): Promise<string>;
}

/** What a page asks of its type: the stacks it uses, italic, the weights it sets and its characters. */
export interface TypeUse {
  stacks: Set<StackKind>;
  italic: boolean;
  weights: Set<number>;
  /** Every character of the page (pageText), for sans and for any face without its own text. */
  text: string;
  /**
   * The text of serif italic and mono contexts (visualtheme-facetext.ts); a face with none is left out, and a
   * face the safeguard names carries `text` instead.
   */
  faces?: { serifItalic: string; mono: string; safeguard: readonly ('serifItalic' | 'mono')[] };
}

/** A font-weight value (or a font shorthand) as a number, or null when it names none. */
export function weightOf(value: string): number | null {
  const v = value.toLowerCase();
  const word = /\b(bold|bolder|lighter|normal)\b/.exec(v)?.[1];
  const numeric = /(?:^|\s)([1-9]\d{2})(?=\s|$|!)/.exec(v)?.[1];
  if (numeric) return Number(numeric);
  if (word === 'bold' || word === 'bolder') return 700;
  if (word === 'lighter') return 300;
  return word === 'normal' ? 400 : null;
}

const ENTITIES: Record<string, string> = {
  nbsp: '\u00a0', mdash: '\u2014', ndash: '\u2013', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  hellip: '\u2026', bull: '\u2022', middot: '\u00b7', sect: '\u00a7', para: '\u00b6', copy: '\u00a9', reg: '\u00ae',
  trade: '\u2122', deg: '\u00b0', plusmn: '\u00b1', times: '\u00d7', divide: '\u00f7', minus: '\u2212', rarr: '\u2192',
  larr: '\u2190', uarr: '\u2191', darr: '\u2193', harr: '\u2194', laquo: '\u00ab', raquo: '\u00bb', euro: '\u20ac',
  pound: '\u00a3', cent: '\u00a2', frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be', le: '\u2264', ge: '\u2265',
  ne: '\u2260', prime: '\u2032', Prime: '\u2033', thinsp: '\u2009', ensp: '\u2002', emsp: '\u2003', check: '\u2713',
};

const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');

const fromCode = (hex: string, radix = 16) => {
  const code = parseInt(hex, radix);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
};

function decode(html: string): string {
  return html
    .replace(/&#x([0-9a-f]+);/gi, (_w, hex: string) => fromCode(hex))
    .replace(/&#(\d+);/g, (_w, dec: string) => fromCode(dec, 10))
    .replace(/&([a-z][a-z0-9]*);/gi, (whole, name: string) => ENTITIES[name] ?? whole)
    .replace(/\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})/gi, (_w, a?: string, b?: string) => fromCode(a ?? b!))
    .replace(/\\([0-9a-f]{2,6})\s?/gi, (whole, hex: string) => (parseInt(hex, 16) >= 0xa0 ? fromCode(hex) : whole));
}

/** Printable ASCII plus every other character the page holds, once each, entities and escapes decoded. */
export function pageText(html: string): string {
  const extra = new Set([...decode(html)].filter((c) => c.codePointAt(0)! >= 0xa0));
  return ASCII + [...extra].sort().join('');
}

/** The printable characters of some text, once each, entities and escapes decoded. */
export function charactersOf(text: string): string {
  return [...new Set([...decode(text)].filter((c) => c.codePointAt(0)! >= 0x20 && c !== '\x7f'))].sort().join('');
}

function axis(weights: number[], [low, high]: readonly [number, number]): FaceRequest['wght'] {
  const clamped = weights.map((w) => Math.min(high, Math.max(low, w)));
  const [min, max] = [Math.min(...clamped), Math.max(...clamped)];
  return min === max ? min : { min, max };
}

/** One face to embed, with its @font-face descriptors. */
export interface PlannedFace {
  request: FaceRequest;
  family: string;
  style: string;
  weight: string;
}

/** The faces a page needs, with their font-face descriptors. */
export function planFaces(use: TypeUse): PlannedFace[] {
  const weights = [...new Set([400, ...use.weights])].sort((a, b) => a - b);
  const textOf = (key: 'serifItalic' | 'mono') =>
    !use.faces || use.faces.safeguard.includes(key) ? use.text : charactersOf(use.faces[key]);
  const variable = (face: 'sans' | 'serif' | 'serifItalic', family: string, style: string, text: string): PlannedFace => {
    const wght = axis(weights, FACES[face].range);
    const weight = typeof wght === 'number' ? String(wght) : `${wght!.min} ${wght!.max}`;
    return { request: { face, wght, text }, family, style, weight };
  };
  const mono = (face: 'mono400' | 'mono500', weight: string): PlannedFace =>
    ({ request: { face, wght: null, text: textOf('mono') }, family: FAMILY.mono, style: 'normal', weight });
  const out = [variable('sans', FAMILY.sans, 'normal', use.text)];
  if (use.stacks.has('serif')) out.push(variable('serif', FAMILY.serif, 'normal', use.text));
  if (use.stacks.has('serif') && use.italic) out.push(variable('serifItalic', FAMILY.serif, 'italic', textOf('serifItalic')));
  if (use.stacks.has('mono')) out.push(mono('mono400', '400'));
  if (use.stacks.has('mono') && weights.some((w) => w >= 500)) out.push(mono('mono500', '500'));
  return out.filter((face) => face.request.text.trim() !== '');
}

/** The @font-face rules for a page, each face loaded (and trimmed) through `fonts`. */
export async function fontFaces(fonts: ThemeFonts, use: TypeUse): Promise<string> {
  const faces = await Promise.all(
    planFaces(use).map(async ({ request, family, style, weight }) => {
      const data = await fonts.load(request);
      return `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${data}) format('woff2')}`;
    }),
  );
  return faces.join('\n');
}

/** A source face, renamed first when it has a Reserved Font Name (unpacked to sfnt for that, with every glyph kept). */
export async function readFace(face: FaceName, modules = path.resolve(import.meta.dirname, '..', 'node_modules')): Promise<Buffer> {
  const { file, rename } = FACES[face];
  const font = await readFile(path.join(modules, file));
  if (!rename) return font;
  return renameFont(await subsetFont(font, '', { targetFormat: 'sfnt', keepAllGlyphs: true, preserveNameIds: NOTICE_IDS }), rename, RESERVED);
}

/** The real faces: read from web/node_modules, subset and instanced with harfbuzz, cached for the run. */
export async function loadThemeFonts(modules = path.resolve(import.meta.dirname, '..', 'node_modules')): Promise<ThemeFonts> {
  const sources = new Map<FaceName, Promise<Buffer>>();
  const cache = new Map<string, Promise<string>>();
  const source = (face: FaceName) => {
    if (!sources.has(face)) sources.set(face, readFace(face, modules));
    return sources.get(face)!;
  };
  return {
    load(request) {
      const key = JSON.stringify(request);
      if (!cache.has(key)) {
        const axes = request.wght === null ? undefined : { wght: request.wght };
        // The copyright and licence records stay in every subset (OFL-1.1 asks each copy to carry them, or a file beside it).
        const options = { targetFormat: 'woff2' as const, variationAxes: axes, preserveNameIds: NOTICE_IDS };
        cache.set(key, source(request.face).then(async (font) => (await subsetFont(font, request.text, options)).toString('base64')));
      }
      return cache.get(key)!;
    },
  };
}
