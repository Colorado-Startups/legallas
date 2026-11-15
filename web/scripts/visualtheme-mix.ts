// SPDX-License-Identifier: Apache-2.0
// Card F6b (binder theme fixes, R78): color-mix() and the colour expressions in a value, for the theme pass.
//
// A page may paint a wash as color-mix(in srgb, navy 12%, white). Reading only its first colour made the wash
// look like a solid navy ground. These helpers find the colour expressions in a value with their parentheses
// balanced and mix color-mix() operands by CSS Color 5 (premultiplied alpha, percentages normalised). Every
// colour space is mixed as sRGB, which is close enough for a contrast check.
import type { Rgba } from './visualtheme-color.ts';

/** Splits at top-level commas (outside parentheses). */
export function topLevelArgs(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] === '(') depth += 1;
    else if (inner[i] === ')') depth -= 1;
    else if (inner[i] === ',' && depth === 0) {
      out.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(inner.slice(start).trim());
  return out;
}

const START = /color-mix\(|var\(|(?:rgba?|hsla?)\(|#[0-9a-f]{3,8}\b|\b[a-z]+\b/gi;

/** The colour-like expressions in a value, in order: functions with balanced parentheses, hex and words. */
export function colourExpressions(value: string): string[] {
  const out: string[] = [];
  START.lastIndex = 0;
  for (let match = START.exec(value); match; match = START.exec(value)) {
    if (!match[0].endsWith('(')) {
      out.push(match[0]);
      continue;
    }
    let depth = 1;
    let end = match.index + match[0].length;
    for (; end < value.length && depth > 0; end += 1) {
      if (value[end] === '(') depth += 1;
      else if (value[end] === ')') depth -= 1;
    }
    out.push(value.slice(match.index, end));
    START.lastIndex = end;
  }
  return out;
}

const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

function operand(text: string): { colour: string; percent: number | null } {
  const percent = /(?:^|\s)(\d*\.?\d+)%\s*$|^\s*(\d*\.?\d+)%\s/.exec(text);
  const value = percent ? Number(percent[1] ?? percent[2]) : null;
  return { colour: text.replace(/(?:^|\s)\d*\.?\d+%(?=\s|$)/, ' ').trim(), percent: value };
}

/** Resolves color-mix(in <space>, a [p%], b [q%]); null when it is not one or an operand does not resolve. */
export function mixColours(expression: string, resolve: (operand: string) => Rgba | null): Rgba | null {
  const inner = /^color-mix\(([\s\S]*)\)$/i.exec(expression.trim())?.[1];
  const parts = inner ? topLevelArgs(inner) : [];
  if (parts.length !== 3 || !/^in\s/i.test(parts[0]!)) return null;
  const [a, b] = [operand(parts[1]!), operand(parts[2]!)];
  const colourOf = (text: string) => (/^transparent$/i.test(text) ? TRANSPARENT : resolve(text));
  const [ca, cb] = [colourOf(a.colour), colourOf(b.colour)];
  if (!ca || !cb) return null;
  const pa = a.percent ?? (b.percent === null ? 50 : 100 - b.percent);
  const pb = b.percent ?? 100 - pa;
  const sum = pa + pb;
  if (sum <= 0) return null;
  const [wa, wb] = [pa / sum, pb / sum];
  const alpha = ca.a * wa + cb.a * wb;
  const channel = (x: number, y: number) => (alpha === 0 ? 0 : (x * ca.a * wa + y * cb.a * wb) / alpha);
  return { r: channel(ca.r, cb.r), g: channel(ca.g, cb.g), b: channel(ca.b, cb.b), a: alpha * Math.min(1, sum / 100) };
}
