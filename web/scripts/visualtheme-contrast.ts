// SPDX-License-Identifier: Apache-2.0
// Card F6 (binder theme): the WCAG contrast check of the theme pass (scripts/visualtheme.ts).
//
// After the colours are mapped, each rule that sets a text colour is resolved in both themes. A rule that sets
// its own background is checked against it. Otherwise the check finds the rule's elements in the page's static
// markup (visualtheme-dom.ts) and uses the nearest ancestor ground, so a label inside a deep card is read on
// the card (F6b). When the markup is given, a rule that matches none of it is skipped (R78, shared stylesheets);
// without it, the rule is read on the page ground. A rule whose elements hold no words (an arrow, an icon) is a
// mark and needs 3:1, not 4.5:1. Text under
// the deep ground reads through DEEP_TEXT. The page's dark scheme is stripped before this runs, so the
// effective value of every token is the one the light design set (the room is light only, R67). Pairs that cannot be
// resolved (gradients, images, colours from scripts) are skipped.
import { DEEP_TEXT, TOKENS, composite, contrast, parseColour, type Rgba } from './visualtheme-color.ts';
import type { CssState, RulePair } from './visualtheme-css.ts';
import { colourExpressions, mixColours } from './visualtheme-mix.ts';
import { hasPseudoElement, indexElements, parseComplex, select, splitSelectors, type Element, type Matcher } from './visualtheme-dom.ts';

/** WCAG 2.2 AA for body text. The pass cannot see type size, so large text is held to it too. */
export const MIN_TEXT_CONTRAST = 4.5;

/** WCAG 2.2 non-text contrast (1.4.11), for marks drawn in a text colour: arrows, icons, separators (R78). */
export const MIN_MARK_CONTRAST = 3;

function tokenColour(name: string, deep = false): Rgba | null {
  const value = (deep ? (DEEP_TEXT as Record<string, string>)[name] : undefined) ?? (TOKENS as Record<string, string>)[name];
  return value ? parseColour(value) : null;
}

/** Resolves one colour value as the theme pass writes it; `deep` reads text tokens on the deep ground. */
export function resolveColour(value: string, vars: Map<string, string>, depth = 0, deep = false): Rgba | null {
  const v = value.replace(/!important\s*$/i, '').trim();
  const token = /^var\(--legallas-([\w-]+)\)$/.exec(v);
  if (token) return tokenColour(token[1]!, deep);
  if (/^color-mix\(/i.test(v)) return depth > 5 ? null : mixColours(v, (part) => resolveColour(part, vars, depth + 1, deep));
  const ref = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/.exec(v);
  if (ref) {
    if (depth > 5) return null;
    const defined = vars.get(ref[1]!.toLowerCase()) ?? ref[2];
    return defined === undefined ? null : resolveColour(defined, vars, depth + 1, deep);
  }
  return parseColour(v);
}

/** The colour a background value paints, or null for gradients, images and anything unresolvable. */
function groundOf(value: string, vars: Map<string, string>): Rgba | null {
  if (/gradient\(|url\(/i.test(value)) return null;
  if (/^\s*(?:none|transparent)\b/i.test(value)) return { r: 0, g: 0, b: 0, a: 0 };
  for (const expression of colourExpressions(value)) {
    const colour = resolveColour(expression, vars);
    if (colour) return colour;
  }
  return null;
}

const PAGE_SELECTOR = /^(?:html|body|:root)$/i;

function pageGround(pairs: RulePair[], vars: Map<string, string>): Rgba {
  const paper = tokenColour('paper')!;
  const rule = [...pairs].reverse().find((p) => p.ground && p.selector.split(',').some((s) => PAGE_SELECTOR.test(s.trim())));
  const ground = rule?.ground ? groundOf(rule.ground, vars) : null;
  return ground ? composite(ground, paper) : paper;
}

/** A ground as an element paints it: the value, and whether it is the deep ground. */
interface Paint {
  value: string;
  deep: boolean;
}

/** One rule with its selectors parsed and the elements each of them reaches. */
interface Rule {
  pair: RulePair;
  order: number;
  /** Element to the specificity of the most specific selector that matches it as itself (not a pseudo-element). */
  own: Map<Element, number>;
  /** Elements whose pseudo-elements the rule styles. */
  pseudo: Set<Element>;
}

/** The parsed rules, the rules that reach each element as itself (in source order), and the winners found so far. */
interface Sheet {
  /** True when the page's markup was given, so a rule that matches no element styles nothing here (R78). */
  markup: boolean;
  rules: Rule[];
  reaching: Map<Element, Rule[]>;
  won: Map<string, Map<Element, Won | null>>;
}

interface Won {
  value: string;
  rule: Rule | null;
}

function prepare(pairs: RulePair[], elements: Element[]): Sheet {
  const index = indexElements(elements);
  const rules = pairs.map((pair, order) => {
    const rule: Rule = { pair, order, own: new Map(), pseudo: new Set() };
    for (const selector of splitSelectors(pair.selector)) {
      const matcher: Matcher | null = parseComplex(selector);
      if (!matcher) continue;
      const pseudo = hasPseudoElement(selector);
      for (const element of select(matcher, index)) {
        if (pseudo) rule.pseudo.add(element);
        else rule.own.set(element, Math.max(matcher.specificity, rule.own.get(element) ?? -1));
      }
    }
    return rule;
  });
  const reaching = new Map<Element, Rule[]>();
  for (const rule of rules) for (const element of rule.own.keys()) reaching.set(element, [...(reaching.get(element) ?? []), rule]);
  return { markup: elements.length > 0, rules, reaching, won: new Map([['text', new Map()], ['ground', new Map()]]) };
}

const INLINE = (name: string) => new RegExp(`(?:^|;)\\s*${name}\\s*:([^;]*)`, 'i');

const PICK = {
  text: { inline: INLINE('color'), pick: (pair: RulePair) => pair.text },
  ground: { inline: INLINE('background(?:-color)?'), pick: (pair: RulePair) => pair.ground },
};

/** The rule (or the inline style) that wins the text or ground colour of an element, as its value. */
function winner(element: Element, sheet: Sheet, what: keyof typeof PICK): Won | null {
  const memo = sheet.won.get(what)!;
  if (memo.has(element)) return memo.get(element)!;
  const { inline: pattern, pick } = PICK[what];
  const inline = pattern.exec(element.style)?.[1];
  let best: Rule | null = null;
  for (const rule of inline ? [] : sheet.reaching.get(element) ?? []) {
    if (pick(rule.pair) && rule.own.get(element)! >= (best?.own.get(element) ?? -1)) best = rule;
  }
  const won = inline ? { value: inline, rule: null } : best ? { value: pick(best.pair)!, rule: best } : null;
  memo.set(element, won);
  return won;
}

function paintOf(element: Element, sheet: Sheet): Paint | null {
  const won = winner(element, sheet, 'ground');
  if (!won) return null;
  return { value: won.value, deep: won.rule ? Boolean(won.rule.pair.deep) : /--legallas-ink:#FAF7F0/.test(element.style) };
}

/** The ground under an element and whether text there reads through DEEP_TEXT; null when it cannot be resolved. */
function groundAt(start: Element | null, sheet: Sheet, vars: Map<string, string>, page: Rgba) {
  const layers: Rgba[] = [];
  let deep: boolean | null = null;
  for (let element = start; element; element = element.parent) {
    const paint = paintOf(element, sheet);
    if (!paint) continue;
    const colour = groundOf(paint.value, vars);
    if (!colour) return null;
    if (colour.a === 0) continue;
    deep ??= paint.deep;
    layers.push(colour);
    if (colour.a >= 1) break;
  }
  const ground = layers.reduceRight((under, top) => composite(top, under), page);
  return { ground, deep: deep ?? false };
}

function ratio(text: string, ground: Rgba, deep: boolean, vars: Map<string, string>): number | null {
  const colour = resolveColour(text, vars, 0, deep);
  return colour ? contrast(composite(colour, ground), ground) : null;
}

/** The worst ratio of one text rule, or null when nothing about it resolves. */
function ruleRatio(rule: Rule, sheet: Sheet, vars: Map<string, string>, page: Rgba): number | null {
  const { pair } = rule;
  const own = pair.ground ? groundOf(pair.ground, vars) : undefined;
  if (own === null) return null;
  const places = [...rule.pseudo, ...[...rule.own.keys()].filter((e) => winner(e, sheet, 'text')?.rule === rule)];
  if (!places.length && (rule.own.size || rule.pseudo.size || sheet.markup)) return null;
  const grounds = places.length
    ? places.map((e) => groundAt(own && rule.own.has(e) ? e.parent : e, sheet, vars, page))
    : [{ ground: page, deep: false }];
  let worst: number | null = null;
  for (const under of grounds) {
    if (!under) continue;
    const ground = own ? composite(own, under.ground) : under.ground;
    const deep = own && own.a > 0 ? Boolean(pair.deep) : under.deep;
    const value = ratio(pair.text!, ground, deep, vars);
    if (value !== null) worst = worst === null ? value : Math.min(worst, value);
  }
  return worst;
}

function inlineWarnings(elements: Element[], sheet: Sheet, vars: Map<string, string>, page: Rgba): number[] {
  const out: number[] = [];
  for (const element of elements) {
    const text = INLINE('color').exec(element.style)?.[1];
    if (!text) continue;
    const under = groundAt(element, sheet, vars, page);
    const value = under && ratio(text, under.ground, under.deep, vars);
    if (value !== null && value !== undefined && value < MIN_TEXT_CONTRAST) out.push(value);
  }
  return out;
}

const label = (selector: string) => (selector.length > 60 ? `${selector.slice(0, 57)}...` : selector);

const WORDY = /[\p{L}\p{N}]/u;

/** Elements that hold a letter or digit, in their own text or below them (entities do not count). */
function textual(elements: Element[]): Set<Element> {
  const out = new Set<Element>();
  for (const element of elements) {
    if (!WORDY.test(element.text.replace(/&#?\w+;/g, ''))) continue;
    for (let up: Element | null = element; up && !out.has(up); up = up.parent) out.add(up);
  }
  return out;
}

/** True when every element a rule reaches holds no words: an arrow, an icon or a separator drawn in a text colour. */
function isMark(rule: Rule, words: Set<Element>): boolean {
  const reached = [...rule.own.keys(), ...rule.pseudo];
  return rule.pseudo.size === 0 && reached.length > 0 && reached.every((element) => !words.has(element));
}

/**
 * One warning per rule whose text falls under MIN_TEXT_CONTRAST (or MIN_MARK_CONTRAST for a mark that holds no
 * words), given the page's elements.
 */
export function contrastWarnings(state: CssState, elements: Element[] = []): string[] {
  const warnings = new Set<string>();
  const sheet = prepare(state.pairs.filter((p) => p.selector), elements);
  const page = pageGround(state.pairs, state.vars);
  const words = textual(elements);
  for (const rule of sheet.rules) {
    if (!rule.pair.text) continue;
    const value = ruleRatio(rule, sheet, state.vars, page);
    const mark = isMark(rule, words);
    if (value === null || value >= (mark ? MIN_MARK_CONTRAST : MIN_TEXT_CONTRAST)) continue;
    warnings.add(`contrast ${value.toFixed(1)}:1 for "${label(rule.pair.selector)}"${mark ? ' (a mark, needs 3:1)' : ''}`);
  }
  for (const value of inlineWarnings(elements, sheet, state.vars, page)) warnings.add(`contrast ${value.toFixed(1)}:1 for "inline style"`);
  return [...warnings];
}
