// SPDX-License-Identifier: Apache-2.0
// Card F6 (binder theme): rewrites CSS declarations for the theme pass (scripts/visualtheme.ts).
//
// Only style sheets and style attributes pass through here; script bodies are never touched. Colours become
// chambers tokens (visualtheme-color.ts), font stacks become the DESIGN.md stacks, and each rule's text and
// ground colours are recorded so the contrast check can resolve them afterwards.
//
// The room is light only (R67): the page's own dark scheme is removed before any rule reaches this module
// (visualtheme-scheme.ts), so every rule here is light.
import {
  COLOUR_LITERAL, DEEP_TEXT, chipTokens, isDeepGround, isLight, isSolidGround, mapColour, oklch, parseColour, tokenValue,
  type Context, type Party, type Rgba, type Token,
} from './visualtheme-color.ts';
import { FAMILY, weightOf } from './visualtheme-fonts.ts';
import { mask, rawColour, rawGround, walkRules, type Scope } from './visualtheme-scheme.ts';

export type StackKind = 'serif' | 'sans' | 'mono';

/** The DESIGN.md section 4 stacks. The embedded faces carry the first family name of each (FAMILY). */
export const STACKS: Record<StackKind, string> = {
  serif: `'${FAMILY.serif}', 'Source Serif 4', Georgia, 'Times New Roman', serif`,
  sans: `'${FAMILY.sans}', Inter, system-ui, -apple-system, 'Segoe UI', sans-serif`,
  mono: `'${FAMILY.mono}', ui-monospace, 'SF Mono', Menlo, Consolas, monospace`,
};

/** One rule's resolved-later colours, for the contrast check. */
export interface RulePair {
  selector: string;
  text?: string;
  ground?: string;
  /** The rule paints the deep ground, so its text reads through DEEP_TEXT. */
  deep?: boolean;
}

/** A rule that sets the font family or style, for the characters each embedded face must carry. */
export interface FontRule {
  selector: string;
  stack: StackKind | null;
  italic: boolean | null;
}

/** What one page's CSS told the theme pass. */
export interface CssState {
  stacks: Set<StackKind>;
  italic: boolean;
  /** Font weights the page sets, for the embedded faces. */
  weights: Set<number>;
  /** Rules that set a font family or style, in source order. */
  fontRules: FontRule[];
  /** Text of every content: property, which any face may draw. */
  content: string;
  /** Rules that set a text or ground colour, in source order. Dark-scheme and print rules are left out. */
  pairs: RulePair[];
  /** Custom properties as rewritten, last definition wins. */
  vars: Map<string, string>;
  /**
   * Custom properties the page sets on :root, html or body, as rewritten. A value that names a token is computed
   * where it is declared, so deep rules declare these again for the deep text tokens to reach them.
   */
  rootVars: Map<string, string>;
  /** Custom properties as the page wrote them (light scheme), read before any rewriting. */
  rawVars: Map<string, string>;
  /** Selectors of rules that paint the deep ground, and of rules that paint a light ground. */
  deepSelectors: Set<string>;
  lightSelectors: Set<string>;
}

export function newCssState(): CssState {
  return {
    stacks: new Set(), italic: false, weights: new Set(), fontRules: [], content: '', pairs: [], vars: new Map(), rootVars: new Map(), rawVars: new Map(),
    deepSelectors: new Set(), lightSelectors: new Set(),
  };
}


const PARTIES: [Party, RegExp][] = [
  ['defendant', /defendant|adverse|respondent/i],
  ['client', /client|plaintiff|petitioner/i],
  ['nominal', /company|nominal|\bentity\b|corporate/i],
  ['court', /court|judge|judicial|tribunal/i],
  ['third', /third[-_ ]?part|non-?party|witness/i],
];

/** The one party a selector or name refers to, or null when it names none or several. */
export function partyOf(text: string): Party | null {
  const hits = PARTIES.filter(([, pattern]) => pattern.test(text));
  return hits.length === 1 ? hits[0]![0] : null;
}

const MARKISH = /legend|swatch|\bdot\b|-dot\b|marker|bullet|\bbar\b|-bar\b|\bnode\b|series|lane/i;
const TEXTISH = /\btext\b|tspan|label|title|caption|axis|tick/i;
const COLOUR_PROP = /^(?:color|background(?:-color|-image)?|border(?:-[a-z]+)*|outline(?:-color)?|fill|stroke|stop-color|flood-color|lighting-color|box-shadow|text-shadow|text-decoration(?:-color)?|column-rule(?:-color)?|caret-color|accent-color|-webkit-text-fill-color|-webkit-text-stroke(?:-color)?)$/;

function contextOf(prop: string, selector: string): Context {
  if (prop === 'color' || prop === 'caret-color' || prop === '-webkit-text-fill-color') return 'text';
  if (prop.startsWith('background')) return MARKISH.test(selector) ? 'mark' : 'ground';
  if (prop === 'fill' || /^(stop|flood|lighting)-color$/.test(prop)) {
    return TEXTISH.test(selector) ? 'text' : 'mark';
  }
  if (prop === 'stroke') return 'stroke';
  return 'line';
}

/** The context a custom property's name suggests: the last role word in it wins (`--card-border` is a line). */
function contextOfName(name: string): Context {
  const words: [Context, RegExp][] = [
    ['ground', /bg|background|surface|card|paper|panel|fill|tint|wash/g],
    ['text', /text|ink|fg|foreground|heading|label|muted|body/g],
    ['line', /border|rule|line|grid|stroke|divider|outline/g],
  ];
  let best: Context = 'any';
  let at = -1;
  for (const [context, pattern] of words) {
    for (const match of name.matchAll(pattern)) {
      if (match.index > at) [best, at] = [context, match.index];
    }
  }
  return best;
}

const VAR_REF = /var\(\s*(--[\w-]+)\s*(?:,[^()]*)?\)/g;

/** How a rule's own ground and text are restyled: the deep ground (R52), a solid chip, or by colour alone. */
interface RuleKind {
  deep: boolean;
  chip: { ground: Token; text: Token } | null;
}

/**
 * Rewrites every colour literal in a value. In a ground, page variables that name a deep colour become the deep
 * token at the point of use, so a variable used both as text and as a ground reads right in each.
 */
export function themeColours(value: string, context: Context, party: Party | null, state: CssState, onLight = false): string {
  const { masked, unmask } = mask(value);
  const deepRefs = context === 'ground' && !party
    ? masked.replace(VAR_REF, (whole) => (isDeep(rawColour(whole, state.rawVars)) ? tokenValue('deep') : whole))
    : masked;
  return unmask(deepRefs.replace(COLOUR_LITERAL, (literal) => {
    const colour = parseColour(literal);
    if (!colour || colour.a === 0) return literal;
    return tokenValue(mapColour(colour, context, party, onLight), colour.a);
  }));
}

const isDeep = (colour: Rgba | null) => colour !== null && isDeepGround(colour);

/** Which DESIGN.md stack a font-family list stands for, or null when it names none this pass knows. */
export function stackKind(value: string): StackKind | null {
  const v = value.toLowerCase();
  const generic = /(ui-monospace|monospace|ui-serif|ui-sans-serif|sans-serif|system-ui|serif)\s*(?:!important)?\s*$/.exec(v)?.[1];
  if (generic) return generic.includes('mono') ? 'mono' : generic.includes('sans') || generic === 'system-ui' ? 'sans' : 'serif';
  if (/mono|menlo|consolas|courier|monaco/.test(v)) return 'mono';
  if (/georgia|times|garamond|cambria|palatino|baskerville|charter|merriweather|playfair|\blora\b|source serif|didot|bodoni/.test(v)) return 'serif';
  if (/sans|helvetica|arial|segoe|roboto|inter|verdana|tahoma|-apple-system|blinkmacsystemfont|avenir|\blato\b/.test(v)) return 'sans';
  return null;
}

function themeStack(value: string, state: CssState): string {
  const kind = stackKind(value);
  if (!kind) return value;
  state.stacks.add(kind);
  return /^\s*/.exec(value)![0] + STACKS[kind] + (/!important\s*$/i.test(value) ? ' !important' : '');
}

const FONT_SIZE = /^([\s\S]*?(?:\d*\.?\d+(?:px|r?em|pt|%|ex|ch|vw|vh|vmin|vmax|cm|mm|in|pc)|xx-small|x-small|small|medium|x-large|xx-large|large|smaller|larger)(?:\s*\/\s*[^\s,]+)?\s+)([\s\S]+)$/i;

function themeFontShorthand(value: string, state: CssState): string {
  if (/italic|oblique/i.test(value)) state.italic = true;
  const weight = weightOf(value.split(/\d*\.?\d+(?:px|r?em|pt|%)/)[0] ?? '');
  if (weight) state.weights.add(weight);
  const match = FONT_SIZE.exec(value.trim());
  return match ? match[1]! + themeStack(match[2]!, state) : value;
}

const GROUND_PROP = /^background(?:-color)?$/;

/** One declaration: fonts, then colours, with the rule's selector and kind as context. */
export function themeDeclaration(
  prop: string, value: string, selector: string, state: CssState, onLight = false, kind: RuleKind = PLAIN,
): string {
  const name = prop.toLowerCase();
  if (name === 'font-family') return themeStack(value, state);
  if (name === 'font') return themeFontShorthand(value, state);
  if (name === 'font-style' && /italic|oblique/i.test(value)) state.italic = true;
  if (name === 'font-weight' && weightOf(value)) state.weights.add(weightOf(value)!);
  if (name.startsWith('--')) {
    if (value.search(COLOUR_LITERAL) < 0 && stackKind(value)) return themeStack(value, state);
    return themeColours(value, contextOfName(name), partyOf(name) ?? partyOf(selector), state);
  }
  if (!COLOUR_PROP.test(name)) return value;
  if (kind.chip && GROUND_PROP.test(name)) return recolour(value, tokenValue(kind.chip.ground));
  if (kind.chip && name === 'color') return recolour(value, tokenValue(kind.chip.text));
  if (kind.deep && GROUND_PROP.test(name)) return themeColours(value, 'ground', null, state);
  return themeColours(value, contextOf(name, selector), partyOf(selector), state, onLight);
}

/** Every colour in a value (literal or page variable) replaced by one token. */
function recolour(value: string, token: string): string {
  const { masked, unmask } = mask(value);
  return unmask(masked.replace(VAR_REF, token).replace(COLOUR_LITERAL, (literal) => (parseColour(literal) ? token : literal)));
}

const PLAIN: RuleKind = { deep: false, chip: null };

/** The custom properties a deep rule sets, so text inside it reads in both themes (R52). */
export const DEEP_DECLARATIONS = Object.entries(DEEP_TEXT).map(([name, value]) => `--legallas-${name}:${value}`).join(';');

/** The page's root custom properties that name a token or variable, declared again so they recompute in place. */
export function rootRedeclarations(state: CssState): string {
  return [...state.rootVars].filter(([, value]) => value.includes('var(')).map(([name, value]) => `${name}:${value}`).join(';');
}

const ROOT_SELECTOR = /^(?::root|html|body)$/i;

const DECLARATION = /^(\s*)([-\w]+)(\s*:)([\s\S]*)$/;

interface Declaration {
  text: string;
  parts: [string, string, string, string, string] | null;
}

/** The last value the rule gives any of the named properties. */
function lastValue(declarations: Declaration[], names: RegExp): string | null {
  const found = declarations.filter((d) => d.parts && names.test(d.parts[2].toLowerCase()));
  return found.length ? found[found.length - 1]!.parts![4] : null;
}

/** How a rule's own ground and text colours are restyled, from the colours the page wrote. */
function ruleKind(ground: Rgba | null, text: Rgba | null, selector: string): RuleKind {
  const party = partyOf(selector);
  const lightText = text !== null && oklch(text).l >= 0.8;
  if (!ground) return PLAIN;
  if (party && lightText && ground.a >= 0.5 && oklch(ground).l < 0.88) return { deep: false, chip: chipTokens(ground, party) };
  if (!party && isDeepGround(ground) && (text !== null || !MARKISH.test(selector))) return { deep: true, chip: null };
  if (lightText && isSolidGround(ground)) return { deep: false, chip: chipTokens(ground, party) };
  return PLAIN;
}

/** Rewrites a declaration list (a rule body or a style attribute) and records its colour pair. */
export function themeDeclarations(body: string, selector: string, state: CssState, scope: Scope = 'normal'): string {
  const { masked, unmask } = mask(body);
  const declarations: Declaration[] = masked.split(';').map((piece) => {
    const text = unmask(piece);
    return { text, parts: DECLARATION.exec(text) as Declaration['parts'] };
  });
  const groundValue = lastValue(declarations, GROUND_PROP);
  const ground = groundValue === null ? null : rawGround(groundValue, state.rawVars);
  const textValue = lastValue(declarations, /^color$/);
  const kind = ruleKind(ground, textValue === null ? null : rawColour(textValue, state.rawVars), selector);
  const onLight = ground !== null && ground.a >= 0.5 && isLight(ground);
  const pair: RulePair = { selector, ...(kind.deep ? { deep: true } : {}) };
  const out = declarations.map(({ text, parts }) => {
    if (!parts) return text;
    const [, lead, prop, colon, value] = parts;
    const themed = themeDeclaration(prop, value, selector, state, onLight, kind);
    const name = prop.toLowerCase();
    if (name === 'color') pair.text = themed;
    if (GROUND_PROP.test(name)) pair.ground = themed;
    if (name.startsWith('--') && scope === 'normal') {
      state.vars.set(name, themed.trim());
      if (selector.split(',').every((one) => ROOT_SELECTOR.test(one.trim()))) state.rootVars.set(name, themed.trim());
    }
    return themed === value ? text : `${lead}${prop}${colon}${themed}`;
  });
  if (kind.deep) {
    const extra = [DEEP_DECLARATIONS, rootRedeclarations(state)].filter(Boolean).join(';');
    out.splice(out.length - (out[out.length - 1]!.trim() ? 0 : 1), 0, extra);
  }
  if (scope === 'normal' && selector) {
    if (kind.deep) state.deepSelectors.add(selector);
    else if (onLight || kind.chip) state.lightSelectors.add(selector);
  }
  if (scope === 'normal' && (pair.text || pair.ground)) state.pairs.push(pair);
  if (scope === 'normal' && selector) recordFont(declarations, selector, state);
  return out.join(';');
}

function recordFont(declarations: Declaration[], selector: string, state: CssState): void {
  const rule: FontRule = { selector, stack: null, italic: null };
  for (const { parts } of declarations) {
    if (!parts) continue;
    const [name, value] = [parts[2].toLowerCase(), parts[4]];
    if (name === 'font-family') rule.stack = stackKind(value);
    if (name === 'font') {
      rule.stack = stackKind(FONT_SIZE.exec(value.trim())?.[2] ?? '') ?? rule.stack;
      rule.italic = /italic|oblique/i.test(value);
    }
    if (name === 'font-style') rule.italic = /italic|oblique/i.test(value);
    if (name === 'content') for (const match of value.matchAll(/(["'])((?:(?!\1)[^\\]|\\.)*)\1/g)) state.content += match[2];
  }
  if (rule.stack !== null || rule.italic !== null) state.fontRules.push(rule);
}

/** Rewrites every rule body of a style sheet, by scheme (visualtheme-scheme.ts). @font-face rules are left alone. */
export function themeCss(css: string, state: CssState): string {
  return walkRules(css, (selector, body, scope) => (/^@font-face/i.test(selector) ? body : themeDeclarations(body, selector, state, scope)));
}
