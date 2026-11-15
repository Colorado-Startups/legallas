// SPDX-License-Identifier: Apache-2.0
// Card F6b (binder theme fixes): the colour schemes a binder page declares, for the theme pass (visualtheme-css.ts).
//
// Each source page writes its colours twice: once for light, and again inside a prefers-color-scheme: dark
// block or under a [data-theme="dark"] selector. Mapping both made dark mode inverted (a light ground with mint
// cards). The room is light only (R67), so the theme removes the page's dark scheme whole: dark media blocks
// and dark-selector rules go, and a light-scheme media block is made to apply always. A visitor may also drop
// a rule. Print blocks are themed but not used for contrast.
import { COLOUR_LITERAL, parseColour, type Rgba } from './visualtheme-color.ts';
import { colourExpressions, mixColours } from './visualtheme-mix.ts';

/** Where a rule applies: always, or only in print. */
export type Scope = 'normal' | 'print';

// Comments, strings and url() hold braces and semicolons that are not structure; they are masked first.
const OPAQUE = /\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\burl\(\s*[^)"'\s][^)]*\)/g;
const MASK = /\u0000(\d+)\u0000/g;

/** Masks comments, strings and url() so braces and semicolons in them read as text. */
export function mask(css: string): { masked: string; unmask: (text: string) => string } {
  const saved: string[] = [];
  const masked = css.replace(OPAQUE, (whole) => `\u0000${saved.push(whole) - 1}\u0000`);
  return { masked, unmask: (text) => text.replace(MASK, (_whole, i: string) => saved[Number(i)]!) };
}

function mediaKind(prelude: string): 'dark' | 'light' | 'print' | null {
  const p = prelude.toLowerCase();
  const negated = /\bnot\b/.test(p);
  if (/prefers-color-scheme\s*:\s*dark/.test(p)) return negated ? 'light' : 'dark';
  if (/prefers-color-scheme\s*:\s*light/.test(p)) return negated ? 'dark' : 'light';
  if (/\bprint\b/.test(p) && !/\bscreen\b/.test(p) && !negated) return 'print';
  return null;
}

/** Index of the brace that closes the block opened just before `from`, or -1. */
function closingBrace(masked: string, from: number): number {
  let depth = 1;
  for (let i = from; i < masked.length; i += 1) {
    if (masked[i] === '{') depth += 1;
    else if (masked[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** Called for each innermost rule with its selector (or at-rule prelude), body and scope; returns the new body. */
export type RuleVisitor = (selector: string, body: string, scope: Scope) => string;

function visitRules(masked: string, scope: Scope, visit: RuleVisitor, unmask: (text: string) => string): string {
  return masked.replace(/([^{}]*)\{([^{}]*)\}/g, (_whole, prelude: string, body: string) => {
    const lead = prelude.slice(0, prelude.lastIndexOf(';') + 1);
    const selector = unmask(prelude.slice(lead.length)).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (isDarkSelector(selector)) return lead;
    return `${prelude}{${visit(selector, unmask(body), scope)}}`;
  });
}

function walk(masked: string, scope: Scope, visit: RuleVisitor, unmask: (text: string) => string): string {
  const media = /@media\b([^{};]*)\{/gi;
  let out = '';
  let at = 0;
  for (let match = media.exec(masked); match; match = media.exec(masked)) {
    const kind = mediaKind(match[1]!);
    if (!kind) continue;
    const open = match.index + match[0].length;
    const close = closingBrace(masked, open);
    if (close < 0) break;
    out += visitRules(masked.slice(at, match.index), scope, visit, unmask);
    if (kind !== 'dark') {
      const prelude = kind === 'light' ? match[0].replace(/\(\s*prefers-color-scheme\s*:\s*light\s*\)/i, '(min-width: 0)') : match[0];
      out += `${prelude}${walk(masked.slice(open, close), kind === 'print' ? 'print' : scope, visit, unmask)}}`;
    }
    at = close + 1;
    media.lastIndex = at;
  }
  return out + visitRules(masked.slice(at), scope, visit, unmask);
}

/**
 * Visits every innermost rule of a style sheet with its scope. The dark scheme (media blocks and dark-selector
 * rules) is removed and light-scheme media is rewritten to apply always.
 */
export function walkRules(css: string, visit: RuleVisitor): string {
  const { masked, unmask } = mask(css);
  return unmask(walk(masked, 'normal', visit, unmask));
}

const DARK_MARK = /\[\s*data-(?:theme|mode|scheme|color-scheme|colou?r-mode)\s*=\s*["']?dark["']?\s*(?:i\s*)?\]|\.(?:dark|dark-mode|dark-theme|theme-dark)(?![-\w])/i;

/** True when every selector in the list applies only to the page's own dark scheme (outside any :not()). */
export function isDarkSelector(selector: string): boolean {
  const list = selector.replace(/:not\((?:[^()]|\([^()]*\))*\)/gi, '').split(',');
  return list.length > 0 && list.every((one) => DARK_MARK.test(one));
}

/** The colour a raw value names, following the page's own custom properties. */
export function rawColour(value: string, vars: Map<string, string>, depth = 0): Rgba | null {
  const v = value.replace(/!important\s*$/i, '').trim();
  const ref = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/.exec(v);
  if (ref) {
    const defined = vars.get(ref[1]!.toLowerCase()) ?? ref[2];
    return defined === undefined || depth > 5 ? null : rawColour(defined, vars, depth + 1);
  }
  if (/^color-mix\(/i.test(v)) return depth > 5 ? null : mixColours(v, (part) => rawColour(part, vars, depth + 1));
  const literal = v.match(COLOUR_LITERAL)?.[0];
  return literal && literal.length === v.length ? parseColour(literal) : null;
}

/** The first colour a background value paints (a literal, a var() of one or a color-mix()), as the page wrote it. */
export function rawGround(value: string, vars: Map<string, string>): Rgba | null {
  if (/url\(/i.test(value)) value = mask(value).masked;
  for (const expression of colourExpressions(value)) {
    const colour = rawColour(expression, vars);
    if (colour) return colour;
  }
  return null;
}

/** Records the page's light-scheme custom properties before any rewriting (dark and print ones are skipped). */
export function collectRawVars(css: string, vars: Map<string, string>): void {
  walkRules(css, (_selector, body, scope) => {
    if (scope !== 'normal') return body;
    for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) vars.set(match[1]!.toLowerCase(), match[2]!.trim());
    return body;
  });
}
