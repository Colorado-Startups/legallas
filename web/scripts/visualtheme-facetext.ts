// SPDX-License-Identifier: Apache-2.0
// Card F6b (binder theme fixes): which characters each embedded face must carry (visualtheme-fonts.ts).
//
// Sans and upright serif carry printable ASCII and every character in the page (visualtheme-fonts.ts). Serif
// italic and mono, whose text is short, carry only the text of the elements that render in them (R75): the
// page's font rules (family, style, the font shorthand) are cascaded over its static markup
// (visualtheme-dom.ts), with inline styles, SVG font attributes and the italic default of em, i and cite, plus
// digits and content: strings. Safeguard: when a script writes text and reaches an italic or mono context, that
// face carries the full page set, so a script-drawn label never falls back to another font.
import { stackKind, type FontRule, type StackKind } from './visualtheme-css.ts';
import { indexElements, parseComplex, select, splitSelectors, type Element } from './visualtheme-dom.ts';

export type TrimmedFace = 'serifItalic' | 'mono';

/** The text each trimmed face must draw, and the faces the safeguard gives the full page set. */
export interface FaceTexts {
  serifItalic: string;
  mono: string;
  safeguard: TrimmedFace[];
}

interface Font {
  stack: StackKind;
  italic: boolean;
}

interface Winning {
  value: StackKind | boolean;
  weight: number;
  order: number;
}

const ITALIC_TAGS = new Set(['em', 'i', 'cite', 'dfn', 'var', 'address']);

/** The value of the most specific (then latest) rule per element, for one property of the font rules. */
function cascade(rules: FontRule[], elements: Element[], pick: (rule: FontRule) => StackKind | boolean | null): Map<Element, Winning> {
  const index = indexElements(elements);
  const won = new Map<Element, Winning>();
  rules.forEach((rule, order) => {
    const value = pick(rule);
    if (value === null) return;
    for (const selector of splitSelectors(rule.selector)) {
      const matcher = /::|:(?:before|after)\b/i.test(selector) ? null : parseComplex(selector);
      if (!matcher) continue;
      for (const element of select(matcher, index)) {
        const best = won.get(element);
        if (!best || matcher.specificity > best.weight || (matcher.specificity === best.weight && order >= best.order)) {
          won.set(element, { value, weight: matcher.specificity, order });
        }
      }
    }
  });
  return won;
}

function inlineFont(element: Element): { stack: StackKind | null; italic: boolean | null } {
  const family = /(?:^|;)\s*font(?:-family)?\s*:([^;]*)/i.exec(element.style)?.[1];
  const style = /(?:^|;)\s*font(?:-style)?\s*:([^;]*)/i.exec(element.style)?.[1];
  const attribute = element.attrs.get('font-family');
  const italicAttribute = element.attrs.get('font-style');
  return {
    stack: (family && stackKind(family)) || (attribute && stackKind(attribute)) || null,
    italic: style ? /italic|oblique/i.test(style) : italicAttribute ? /italic|oblique/i.test(italicAttribute) : null,
  };
}

/** Each element's family and style after the cascade and inheritance (html defaults to sans, upright). */
export function computedFonts(rules: FontRule[], elements: Element[]): Map<Element, Font> {
  const stacks = cascade(rules, elements, (rule) => rule.stack);
  const styles = cascade(rules, elements, (rule) => rule.italic);
  const out = new Map<Element, Font>();
  for (const element of elements) {
    const parent = (element.parent && out.get(element.parent)) || { stack: 'sans' as StackKind, italic: false };
    const inline = inlineFont(element);
    const stack = inline.stack ?? (stacks.get(element)?.value as StackKind | undefined) ?? parent.stack;
    const ruled = styles.get(element)?.value as boolean | undefined;
    const italic = inline.italic ?? ruled ?? (ITALIC_TAGS.has(element.tag) || parent.italic);
    out.set(element, { stack, italic });
  }
  return out;
}

const WRITES_TEXT = /\.(?:textContent|innerText|innerHTML|outerHTML)\s*=|\.(?:text|html)\(|insertAdjacent(?:HTML|Text)|createTextNode|\.append\(\s*["'`]/;

// Signs that a script works in a face's context: it names the style, the family or the tags, or it names a class
// or id that one of the page's italic or mono rules styles.
const SCRIPT_SIGNS: Record<TrimmedFace, RegExp> = {
  serifItalic: /italic|oblique|<(?:em|i|cite)\b|["'`](?:i|[^"'`\n]*(?<![\w-])(?:em|cite)(?![\w-])[^"'`\n]*)["'`]/i,
  mono: /monospace|\bmono\b|menlo|courier|consolas|plex mono|<(?:code|pre|kbd|samp)\b|["'`](?:code|pre|kbd|samp)["'`]/i,
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The classes and ids a face's rules style, as a pattern over script text; null when there are none. */
function ruleNames(rules: FontRule[], face: TrimmedFace): RegExp | null {
  const styled = rules.filter((rule) => (face === 'mono' ? rule.stack === 'mono' : rule.italic === true));
  const names = new Set(styled.flatMap((rule) => [...rule.selector.matchAll(/[.#]([\w-]+)/g)].map((m) => m[1]!)));
  return names.size ? new RegExp(`(?<![\\w-])(?:${[...names].map(escape).join('|')})(?![\\w-])`) : null;
}

/** The trimmed faces a page's scripts write text into (R75). */
export function safeguardFaces(rules: FontRule[], scripts: string[]): TrimmedFace[] {
  if (!scripts.some((body) => WRITES_TEXT.test(body))) return [];
  const all = scripts.join('\n');
  return (['serifItalic', 'mono'] as const).filter((face) => SCRIPT_SIGNS[face].test(all) || ruleNames(rules, face)?.test(all));
}

/** The text each trimmed face must draw: its elements' own text, digits and content: strings. */
export function faceTexts(rules: FontRule[], elements: Element[], extra: { content: string; scripts: string[] }): FaceTexts {
  const texts: FaceTexts = { serifItalic: '', mono: '', safeguard: safeguardFaces(rules, extra.scripts) };
  for (const [element, font] of computedFonts(rules, elements)) {
    if (!element.text.trim()) continue;
    if (font.stack === 'serif' && font.italic) texts.serifItalic += element.text;
    if (font.stack === 'mono') texts.mono += element.text;
  }
  for (const key of ['serifItalic', 'mono'] as const) if (texts[key]) texts[key] += ` 0123456789${extra.content}`;
  return texts;
}
