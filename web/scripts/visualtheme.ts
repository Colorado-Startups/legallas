// SPDX-License-Identifier: Apache-2.0
// Card F6 (binder theme): re-skins a prepared binder page in the chambers design (web/DESIGN.md) at export.
//
// `npm run visuals` runs it after prepareVisual unless --no-theme is given. The page's words, layout and
// script bodies are left as they are. The pass:
//   1. maps every colour in style sheets and style attributes to a chambers token (visualtheme-color.ts).
//      The room is light only (R67): the page's own dark scheme is removed (visualtheme-scheme.ts), the page
//      declares color-scheme: light and the tokens carry their light values; dark navy grounds become deep forest;
//   2. embeds Source Serif 4, Inter and IBM Plex Mono as data: URI faces (the visual CSP allows font-src
//      data: and inline style), trimmed to the weights and characters the page uses (visualtheme-fonts.ts),
//      and swaps each font stack for its DESIGN.md stack;
//   3. restyles the work-product header bar as a quiet privilege bar (visualtheme-bar.ts);
//   4. colours party marks with the --enc-* tokens where a rule or a script's colour table names a side;
//   5. warns about text pairs under 4.5:1, on the nearest ground in the markup
//      (visualtheme-contrast.ts, visualtheme-dom.ts).
// SVG fill and stroke attributes, whether written in the page or set by its scripts, are restyled through
// zero-specificity :where() rules, so the page's own rules still win wherever they did before.
import { BAR_ATTRIBUTE, markPrivilegeBar } from './visualtheme-bar.ts';
import { DEEP_TEXT, NAMED, TOKENS, mapColour, parseColour, tokenValue, type Party } from './visualtheme-color.ts';
import { contrastWarnings } from './visualtheme-contrast.ts';
import { STACKS, newCssState, partyOf, rootRedeclarations, stackKind, themeCss, themeDeclarations, type CssState } from './visualtheme-css.ts';
import { hasPseudoElement, parseElements, splitSelectors, type Element } from './visualtheme-dom.ts';
import { faceTexts } from './visualtheme-facetext.ts';
import { fontFaces, pageText, weightOf, type ThemeFonts } from './visualtheme-fonts.ts';
import { collectRawVars } from './visualtheme-scheme.ts';

export { loadThemeFonts, type ThemeFonts } from './visualtheme-fonts.ts';

export const THEME_MARKER = 'data-legallas-theme';

export interface ThemedVisual {
  html: string;
  warnings: string[];
  /** Bytes the theme added to the page, fonts included. */
  addedBytes: number;
  /** Trimmed faces embedded with the full page set because a script writes text into them (R75). */
  fullFaces: string[];
}

function tokenBlock(): string {
  const entries: [string, string][] = Object.entries(TOKENS);
  // The base copies let a light ground inside a deep one restore the text tokens the deep rule redefined.
  const base = entries.filter(([name]) => name in DEEP_TEXT).map(([name, value]): [string, string] => [`base-${name}`, value]);
  return `:root{color-scheme:light;${[...entries, ...base].map(([name, value]) => `--legallas-${name}:${value}`).join(';')}}`;
}

// Presentation attributes lose to any page rule, so these overrides use :where() and add no specificity.
const FONT_ATTRIBUTE_RULES = [
  `:where([font-family*="serif" i],[font-family*="georgia" i],[font-family*="times" i]){font-family:${STACKS.serif}}`,
  `:where([font-family*="sans" i],[font-family*="system-ui" i],[font-family*="helvetica" i],[font-family*="arial" i],[font-family*="inter" i]){font-family:${STACKS.sans}}`,
  `:where([font-family*="mono" i],[font-family*="menlo" i],[font-family*="courier" i],[font-family*="consolas" i]){font-family:${STACKS.mono}}`,
].join('\n');

// A bar the page drew on navy is a deep rule; the reset gives it the ordinary text tokens back.
const BAR_RESET = Object.keys(DEEP_TEXT).map((name) => `--legallas-${name}:var(--legallas-base-${name})!important;`).join('');

const BAR_RULES =
  `[${BAR_ATTRIBUTE}][${BAR_ATTRIBUTE}]{${BAR_RESET}background:var(--legallas-panel)!important;color:var(--legallas-oxblood)!important;` +
  'border:0!important;border-bottom:1px solid var(--legallas-rule)!important;border-radius:0!important;box-shadow:none!important;' +
  `text-shadow:none!important;font-family:${STACKS.sans}!important;font-size:12px!important;line-height:16px!important;` +
  'font-weight:500!important;letter-spacing:0.04em!important;font-variant-caps:all-small-caps!important;' +
  'text-transform:none!important;text-align:left!important;padding:6px 16px!important}\n' +
  `[${BAR_ATTRIBUTE}] *{color:inherit!important;background:transparent!important;font:inherit!important;` +
  'letter-spacing:inherit!important;text-transform:none!important;border-color:var(--legallas-rule)!important}';

/** Colour literals a page sets as SVG attributes or holds in its scripts, and the sides its colour tables name. */
interface Collected {
  attributes: Map<string, Set<string>>;
  parties: Map<string, Party | null>;
  scriptStyles: boolean;
  canvas: boolean;
  scripts: string[];
}

const SVG_COLOUR_ATTRIBUTE = /\s(fill|stroke|stop-color|flood-color)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const STYLE_ATTRIBUTE = /(\sstyle\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;
const QUOTED_COLOUR = new RegExp(`(["'\`])(#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?)\\([^()'"\`]*\\)|${Object.keys(NAMED).join('|')})\\1`, 'g');
const KEYED_COLOUR = /([A-Za-z_$][\w$-]*|"[^"\n]*"|'[^'\n]*')\s*:\s*(["'`])(#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?)\([^()'"`]*\))\2/g;
const QUOTED_STRING = /(["'`])([^"'`\n]{3,200})\1/g;

function addAttribute(collected: Collected, attribute: string, literal: string): void {
  if (!parseColour(literal)) return;
  const set = collected.attributes.get(attribute) ?? new Set<string>();
  collected.attributes.set(attribute, set.add(literal));
}

function themeMarkup(markup: string, state: CssState, collected: Collected): string {
  for (const match of markup.matchAll(SVG_COLOUR_ATTRIBUTE)) addAttribute(collected, match[1]!.toLowerCase(), match[2] ?? match[3] ?? '');
  for (const match of markup.matchAll(/\sfont-family\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const kind = stackKind(match[1] ?? match[2] ?? '');
    if (kind) state.stacks.add(kind);
  }
  if (/<(?:em|i)\b|font-style\s*=\s*["']italic/i.test(markup)) state.italic = true;
  if (/<(?:b|strong|h[1-6]|th)\b/i.test(markup)) state.weights.add(700);
  for (const match of markup.matchAll(/\sfont-weight\s*=\s*["']([^"']*)["']/gi)) addWeight(state, match[1]!);
  if (/<canvas\b/i.test(markup)) collected.canvas = true;
  return markup.replace(STYLE_ATTRIBUTE, (_whole, lead: string, double?: string, single?: string) => {
    const themed = themeDeclarations(double ?? single ?? '', '', state);
    return `${lead}"${themed.replace(/"/g, '&quot;')}"`;
  });
}

function scanScript(body: string, state: CssState, collected: Collected): void {
  collected.scripts.push(body);
  const literals = [...body.matchAll(QUOTED_COLOUR)].map((m) => m[2]!);
  for (const literal of literals) for (const attribute of ['fill', 'stroke', 'stop-color']) addAttribute(collected, attribute, literal);
  for (const match of body.matchAll(KEYED_COLOUR)) {
    const party = partyOf(match[1]!.replace(/^["']|["']$/g, ''));
    if (!party) continue;
    const key = match[3]!.toLowerCase();
    const seen = collected.parties.get(key);
    collected.parties.set(key, seen === undefined || seen === party ? party : null);
  }
  for (const match of body.matchAll(QUOTED_STRING)) {
    const kind = /serif|sans|mono|system-ui/i.test(match[2]!) ? stackKind(match[2]!) : null;
    if (kind) state.stacks.add(kind);
  }
  for (const match of body.matchAll(/font-?weight["'`]?\s*[,:=]\s*["'`]?(\d{3}|bold|bolder|lighter|normal)/gi)) addWeight(state, match[1]!);
  if (literals.length && /\.style\s*[.(]|style\s*=|cssText/.test(body)) collected.scriptStyles = true;
  if (/getContext\(/.test(body)) collected.canvas = true;
}

function addWeight(state: CssState, value: string): void {
  const weight = weightOf(value);
  if (weight) state.weights.add(weight);
}

const cssString = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

function attributeRules(collected: Collected): string {
  const rules: string[] = [];
  const textRules: string[] = [];
  for (const [attribute, literals] of collected.attributes) {
    for (const literal of literals) {
      const colour = parseColour(literal);
      if (!colour || colour.a === 0) continue;
      const party = collected.parties.get(literal.toLowerCase()) ?? null;
      const mark = mapColour(colour, attribute === 'stroke' ? 'stroke' : 'mark', party);
      const selector = `[${attribute}="${cssString(literal)}" i]`;
      rules.push(`:where(${selector}){${attribute}:${tokenValue(mark, colour.a)}}`);
      const text = attribute === 'fill' ? mapColour(colour, 'text', party) : null;
      if (text !== null && text !== mark) {
        textRules.push(`:where(text${selector},tspan${selector},textPath${selector}){fill:${tokenValue(text, colour.a)}}`);
      }
    }
  }
  return [...rules, ...textRules].join('\n');
}

const PROTECTED = /(<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>|<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>)/gi;
const STYLE_ELEMENT = /^(<style\b[^>]*>)([\s\S]*?)(<\/style\b[^>]*>)$/i;
const SCRIPT_ELEMENT = /^<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>$/i;

function themePieces(html: string, state: CssState, collected: Collected): string[] {
  const pieces = html.split(PROTECTED);
  return pieces.map((piece, i) => {
    if (i % 2 === 0) return themeMarkup(piece, state, collected);
    const style = STYLE_ELEMENT.exec(piece);
    if (style) return style[1]! + themeCss(style[2]!, state) + style[3]!;
    scanScript(SCRIPT_ELEMENT.exec(piece)?.[1] ?? '', state, collected);
    return piece;
  });
}

// At the end of the head, so a <meta charset> stays within the first 1024 bytes. Every theme rule has zero
// specificity or !important, so the order against the page's own sheets does not change the result.
function insertStyle(html: string, css: string): string {
  const block = `<style ${THEME_MARKER}>\n${css}\n</style>\n`;
  const at = html.search(/<\/head\s*>|<body\b/i);
  return at < 0 ? `${block}${html}` : `${html.slice(0, at)}${block}${html.slice(at)}`;
}

// A light ground nested in a deep one gets the text tokens back (zero specificity, so page rules still win).
function deepResetRule(state: CssState): string {
  const usable = (set: Set<string>) =>
    [...set].flatMap(splitSelectors).filter((s) => !hasPseudoElement(s) && !/^(?:html|body|:root)$/i.test(s));
  const [deep, light] = [usable(state.deepSelectors), usable(state.lightSelectors)];
  if (!deep.length || !light.length) return '';
  const resets = [
    ...Object.keys(DEEP_TEXT).map((name) => `--legallas-${name}:var(--legallas-base-${name})`),
    rootRedeclarations(state),
  ].filter(Boolean).join(';');
  return `:where(${deep.join(',')}) :where(${light.join(',')}){${resets}}`;
}

function report(state: CssState, collected: Collected, barFound: boolean, elements: Element[]): string[] {
  const warnings: string[] = [];
  if (!barFound) warnings.push('no work-product bar found');
  if (collected.scriptStyles) warnings.push('a script sets inline style colours, which keep their original values');
  if (collected.canvas) warnings.push('draws on a canvas, which keeps its own colours and fonts');
  return [...warnings, ...contrastWarnings(state, elements)];
}

/** Themes one prepared page. Running it again on its own output changes nothing. */
export async function themeVisual(html: string, fonts: ThemeFonts): Promise<ThemedVisual> {
  if (html.includes(THEME_MARKER)) return { html, warnings: [], addedBytes: 0, fullFaces: [] };
  const state = newCssState();
  const collected: Collected = { attributes: new Map(), parties: new Map(), scriptStyles: false, canvas: false, scripts: [] };
  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) collectRawVars(match[1]!, state.rawVars);
  const pieces = themePieces(html, state, collected);

  // The bar search sees markup only: script and style elements are masked by their index.
  const masked = pieces.map((piece, i) => (i % 2 ? `\u0001${i}\u0001` : piece)).join('');
  const barred = markPrivilegeBar(masked);
  const body = (barred ?? masked).replace(/\u0001(\d+)\u0001/g, (_whole, i: string) => pieces[Number(i)]!);

  // The privilege bar sets Inter at 500.
  if (barred !== null) state.weights.add(500);
  const elements = parseElements((barred ?? masked).replace(/\u0001\d+\u0001/g, ''));
  const texts = faceTexts(state.fontRules, elements, { content: state.content, scripts: collected.scripts });
  const use = { stacks: state.stacks, italic: state.italic, weights: state.weights, text: pageText(html), faces: texts };
  const faces = await fontFaces(fonts, use);
  const css = [
    faces,
    tokenBlock(),
    `:where(html){background:var(--legallas-paper);color:var(--legallas-ink);font-family:${STACKS.sans}}`,
    attributeRules(collected),
    deepResetRule(state),
    FONT_ATTRIBUTE_RULES,
    BAR_RULES,
  ].filter(Boolean);
  const out = insertStyle(body, css.join('\n'));
  return {
    html: out,
    warnings: report(state, collected, barred !== null, elements),
    addedBytes: Buffer.byteLength(out) - Buffer.byteLength(html),
    fullFaces: texts.safeguard
      .filter((face) => (face === 'mono' ? state.stacks.has('mono') : state.stacks.has('serif') && state.italic))
      .map((face) => (face === 'mono' ? 'mono' : 'serif italic')),
  };
}
