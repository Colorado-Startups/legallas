// SPDX-License-Identifier: Apache-2.0
// Card F6 (binder theme): colours for the export-time theme pass (scripts/visualtheme.ts).
//
// The binder pages were drawn in a navy, crimson and teal palette. Each colour a page uses is placed in a hue
// family (OKLCH) and given the chambers token that plays the same part in web/DESIGN.md, chosen by where the
// colour is used: text, a ground (background), a mark (chart fill or stroke), or a line (border). Dark navy and
// near-black grounds become the deep forest (R52), and text inside them reads through DEEP_TEXT.
// Purples take the third-party encoding (R52). Colours outside every family are left as they are and reported.

/** A parsed colour: channels 0 to 255, alpha 0 to 1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Where a colour is used, which decides the token it maps to. `stroke` is an SVG stroke: a line when neutral
 * (grid lines, axes), a mark when coloured (a series). `any` is a custom property of unknown use.
 */
export type Context = 'text' | 'ground' | 'mark' | 'line' | 'stroke' | 'any';

/** The sides of web/worker/matter-types.ts SIDES. */
export type Party = 'client' | 'defendant' | 'nominal' | 'court' | 'third';

export type Family = 'neutral' | 'red' | 'warm' | 'green' | 'teal' | 'blue' | 'purple';

/** Values from web/DESIGN.md sections 2 and 3, plus the tints the binder needs. The room is light only (R67). */
export const TOKENS = {
  paper: '#FAF7F0',
  panel: '#F2EDE2',
  surface: '#FFFDF8',
  ink: '#1A1F1C',
  'ink-2': '#4A524D',
  'ink-3': '#666D68',
  forest: '#1F3A2E',
  'forest-tint': '#E3EBE5',
  'brass-rule': '#A98B4F',
  'brass-mark': '#8C7140',
  'brass-text': '#7A6232',
  // 12% brass-mark over surface.
  'brass-tint': '#F1ECE2',
  oxblood: '#6B1E23',
  'oxblood-tint': '#F3E4E2',
  rule: '#D9CFBB',
  border: '#8A8272',
  slate: '#4B5D6B',
  // 10% enc-company over surface.
  'company-tint': '#E6EDED',
  graphite: '#6B6B6B',
  'enc-client': '#3B9874',
  'enc-defendant': '#813537',
  'enc-company': '#045B8A',
  'enc-third': '#8D6813',
  'enc-court': '#6B6B6B',
  // R52: dark navy grounds (a header bar, a "Next" card) become deep forest. It equals forest, but is its own
  // token so a deep rule can redefine the forest text token without changing its own ground.
  deep: '#1F3A2E',
} as const satisfies Record<string, string>;

export type Token = keyof typeof TOKENS;

/**
 * Text tokens as they read on the deep ground (each 6:1 or more on #1F3A2E). A rule that paints the deep ground
 * redefines these for itself and everything inside it.
 */
export const DEEP_TEXT = {
  paper: '#FAF7F0',
  ink: '#FAF7F0',
  'ink-2': '#D5DDD7',
  'ink-3': '#B5C2B9',
  forest: '#A9D3B9',
  'brass-text': '#D8C08A',
  oxblood: '#F0A9AD',
  slate: '#B9C9D5',
  graphite: '#C4C4C4',
} as const satisfies Partial<Record<Token, string>>;

const PARTY_MARK: Record<Party, Token> = {
  client: 'enc-client',
  defendant: 'enc-defendant',
  nominal: 'enc-company',
  court: 'enc-court',
  third: 'enc-third',
};
const PARTY_LABEL: Record<Party, Token> = {
  client: 'forest',
  defendant: 'oxblood',
  nominal: 'slate',
  court: 'graphite',
  third: 'brass-text',
};
const PARTY_TINT: Record<Party, Token> = {
  client: 'forest-tint',
  defendant: 'oxblood-tint',
  nominal: 'company-tint',
  court: 'panel',
  third: 'brass-tint',
};

const FAMILY_TEXT: Record<Exclude<Family, 'neutral'>, Token> = {
  red: 'oxblood',
  warm: 'brass-text',
  green: 'forest',
  teal: 'slate',
  blue: 'forest',
  purple: 'brass-text',
};
const FAMILY_GROUND: Record<Exclude<Family, 'neutral'>, Token> = {
  red: 'oxblood',
  warm: 'brass-mark',
  green: 'forest',
  teal: 'slate',
  blue: 'forest',
  purple: 'brass-tint',
};
// Teal is the company colour in the binder legends; navy stays brand forest rather than claiming a side.
const FAMILY_MARK: Record<Exclude<Family, 'neutral'>, Token> = {
  red: 'enc-defendant',
  warm: 'enc-third',
  green: 'enc-client',
  teal: 'enc-company',
  blue: 'forest',
  purple: 'enc-third',
};
const FAMILY_LINE: Record<Exclude<Family, 'neutral'>, Token> = {
  red: 'oxblood',
  warm: 'brass-mark',
  green: 'forest',
  teal: 'slate',
  blue: 'forest',
  purple: 'brass-mark',
};
const FAMILY_TINT: Record<Exclude<Family, 'neutral'>, Token> = {
  red: 'oxblood-tint',
  warm: 'brass-tint',
  green: 'forest-tint',
  teal: 'company-tint',
  blue: 'forest-tint',
  purple: 'brass-tint',
};

/** CSS named colours the binder pages may use. Others are left as written. */
export const NAMED: Record<string, string> = {
  white: '#ffffff', black: '#000000', gray: '#808080', grey: '#808080', silver: '#c0c0c0',
  lightgray: '#d3d3d3', lightgrey: '#d3d3d3', gainsboro: '#dcdcdc', whitesmoke: '#f5f5f5',
  dimgray: '#696969', dimgrey: '#696969', darkgray: '#a9a9a9', darkgrey: '#a9a9a9', snow: '#fffafa',
  ivory: '#fffff0', linen: '#faf0e6', beige: '#f5f5dc', navy: '#000080', darkblue: '#00008b',
  midnightblue: '#191970', steelblue: '#4682b4', slategray: '#708090', slategrey: '#708090',
  darkslategray: '#2f4f4f', darkslategrey: '#2f4f4f', teal: '#008080', darkcyan: '#008b8b',
  maroon: '#800000', darkred: '#8b0000', firebrick: '#b22222', crimson: '#dc143c', red: '#ff0000',
  gold: '#ffd700', goldenrod: '#daa520', darkgoldenrod: '#b8860b', green: '#008000', darkgreen: '#006400',
};

const NAMED_WORDS = Object.keys(NAMED).sort((a, b) => b.length - a.length).join('|');

/** Every colour literal in a CSS value: hex, rgb(a), hsl(a) and the named colours above. */
export const COLOUR_LITERAL = new RegExp(
  `#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z])|\\b(?:rgba?|hsla?)\\([^()]*\\)|(?<![-\\w#.])(?:${NAMED_WORDS})(?![-\\w(])`,
  'gi',
);

function channel(text: string, scale: number): number {
  const value = parseFloat(text);
  return text.trim().endsWith('%') ? (value / 100) * scale : value;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Parses one colour literal, or returns null when it is not one this pass understands. */
export function parseColour(literal: string): Rgba | null {
  const text = literal.trim().toLowerCase();
  const named = NAMED[text];
  if (named) return parseColour(named);
  const hex = /^#([0-9a-f]{3,8})$/.exec(text)?.[1];
  if (hex) {
    if (![3, 4, 6, 8].includes(hex.length)) return null;
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(text);
  if (!fn) return null;
  const parts = fn[2]!.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.some((p) => !/^-?[\d.]+(?:%|deg)?$/.test(p))) return null;
  const a = parts[3] === undefined ? 1 : Math.max(0, Math.min(1, channel(parts[3], 1)));
  if (fn[1]!.startsWith('rgb')) return { r: channel(parts[0]!, 255), g: channel(parts[1]!, 255), b: channel(parts[2]!, 255), a };
  const [r, g, b] = hslToRgb(parseFloat(parts[0]!), channel(parts[1]!, 1), channel(parts[2]!, 1));
  return { r, g, b, a };
}

const linear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** OKLCH lightness (0 to 1), chroma and hue in degrees. */
export function oklch({ r, g, b }: Rgba): { l: number; c: number; h: number } {
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h };
}

/** The hue family of a colour. Every colour has one; pale tints count as coloured from a lower chroma floor. */
export function familyOf(colour: Rgba): Family {
  const { l, c, h } = oklch(colour);
  if (c < (l >= 0.88 ? 0.025 : 0.045)) return 'neutral';
  if (h <= 38 || h >= 350) return 'red';
  if (h <= 110) return 'warm';
  if (h <= 170) return 'green';
  if (h <= 225) return 'teal';
  if (h <= 285) return 'blue';
  return 'purple';
}

function neutralToken(l: number, context: Context): Token {
  if (context === 'any') return neutralToken(l, l >= 0.9 ? 'ground' : l < 0.45 ? 'text' : 'line');
  if (context === 'text') return l < 0.4 ? 'ink' : l < 0.6 ? 'ink-2' : 'ink-3';
  if (context === 'line') return l >= 0.8 ? 'rule' : l >= 0.5 ? 'border' : 'ink-2';
  if (context === 'mark') return l >= 0.97 ? 'surface' : l >= 0.9 ? 'panel' : l >= 0.8 ? 'rule' : l >= 0.6 ? 'ink-3' : l >= 0.4 ? 'ink-2' : 'ink';
  return l >= 0.985 ? 'surface' : l >= 0.955 ? 'paper' : l >= 0.9 ? 'panel' : l >= 0.8 ? 'rule' : l >= 0.55 ? 'border' : l >= 0.35 ? 'ink-2' : 'ink';
}

/** True when a colour reads as a light ground (OKLCH lightness 0.6 or more). */
export function isLight(colour: Rgba): boolean {
  return oklch(colour).l >= 0.6;
}

const DEEP_FAMILIES: ReadonlySet<Family> = new Set(['neutral', 'blue', 'purple']);

/** True when a colour painted as a ground becomes the deep forest: dark navy, purple or near black, mostly opaque. */
export function isDeepGround(colour: Rgba): boolean {
  return colour.a >= 0.5 && oklch(colour).l < 0.5 && DEEP_FAMILIES.has(familyOf(colour));
}

/**
 * True when a colour painted as a ground is a solid block (a chip or a diagram node): not pale, mostly opaque
 * and not deep. Light text on one is restyled as a label on the matching tint (see chipTokens).
 */
export function isSolidGround(colour: Rgba): boolean {
  return colour.a >= 0.5 && oklch(colour).l < 0.88 && !isDeepGround(colour);
}

/** The tint ground and label text a solid chip of this colour becomes; they read at 4.5:1 in both themes. */
export function chipTokens(colour: Rgba, party: Party | null): { ground: Token; text: Token } {
  const family = familyOf(colour);
  if (party) return { ground: PARTY_TINT[party], text: PARTY_LABEL[party] };
  if (family === 'neutral') return { ground: 'panel', text: 'ink' };
  return { ground: FAMILY_TINT[family], text: FAMILY_TEXT[family] };
}

/**
 * The chambers token for a colour used in `context`. Light text is taken to sit on a dark ground (it becomes
 * paper, which reads on forest and ink, and on the deep ground through DEEP_TEXT) unless `onLight` says its own
 * rule paints a light ground, where it becomes the faintest legible ink.
 */
export function mapColour(colour: Rgba, use: Context, party: Party | null = null, onLight = false): Token {
  const family = familyOf(colour);
  const context = use === 'stroke' ? (family === 'neutral' && !party ? 'line' : 'mark') : use;
  const { l } = oklch(colour);
  const light = l >= 0.88;
  if (context === 'text' && l >= 0.8) return onLight ? 'ink-3' : 'paper';
  if (party) {
    if (context === 'text') return PARTY_LABEL[party];
    if (light && family !== 'neutral') return PARTY_TINT[party];
    return light ? neutralToken(l, context) : PARTY_MARK[party];
  }
  if (context === 'ground' && isDeepGround(colour)) return 'deep';
  if (family === 'neutral') return neutralToken(l, context);
  if (context === 'text') return FAMILY_TEXT[family];
  if (light) return context === 'line' ? 'rule' : FAMILY_TINT[family];
  if (context === 'ground') return FAMILY_GROUND[family];
  if (context === 'mark') return FAMILY_MARK[family];
  if (context === 'line') return FAMILY_LINE[family];
  return FAMILY_TEXT[family];
}

/** The CSS for a token at an alpha: a plain var(), or a color-mix toward transparent. */
export function tokenValue(token: Token, alpha = 1): string {
  if (alpha >= 1) return `var(--legallas-${token})`;
  return `color-mix(in srgb, var(--legallas-${token}) ${Math.round(alpha * 100)}%, transparent)`;
}

/** `top` composited over an opaque `under`. */
export function composite(top: Rgba, under: Rgba): Rgba {
  const mix = (a: number, b: number) => a * top.a + b * (1 - top.a);
  return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a: 1 };
}

const luminance = ({ r, g, b }: Rgba) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

/** WCAG 2 contrast ratio of two opaque colours. */
export function contrast(a: Rgba, b: Rgba): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
