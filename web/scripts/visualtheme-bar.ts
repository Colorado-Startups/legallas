// SPDX-License-Identifier: Apache-2.0
// Card F6 (binder theme): finds the work-product header bar of a binder page (scripts/visualtheme.ts).
//
// The bar is the outermost short block around the first "work product" or "privileged" text near the top of
// the body: under 160 characters of text and holding no heading, table, list or chart. It gets the attribute
// data-legallas-privilege, which the theme styles as a quiet privilege bar. Its text is not changed.

export const BAR_ATTRIBUTE = 'data-legallas-privilege';

const WORK_PRODUCT = /work[\s-]*product|attorney[\s-]*client|privileged|confidential/i;
const TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)\b[^>]*>|[^<]+|</g;
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const BLOCK = new Set(['div', 'header', 'section', 'aside', 'nav', 'p', 'footer', 'address', 'blockquote', 'figure']);
const STOP = new Set(['html', 'body', 'main', 'article']);
const HEAVY = /<(?:h[1-6]|table|ul|ol|svg|canvas|img)\b/i;
const MAX_TEXT = 160;
const MAX_HITS = 3;

interface OpenTag {
  name: string;
  start: number;
  end: number;
}

/** Index of the tag that closes `open`, counting nested tags of the same name; -1 when there is none. */
function closeOf(markup: string, open: OpenTag): number {
  const tags = new RegExp(`<(/?)${open.name}\\b[^>]*>`, 'gi');
  tags.lastIndex = open.end;
  let depth = 1;
  for (let match = tags.exec(markup); match; match = tags.exec(markup)) {
    if (match[1]) depth -= 1;
    else if (!match[0].endsWith('/>')) depth += 1;
    if (depth === 0) return match.index;
  }
  return -1;
}

/** Walks out from the innermost open element and keeps the outermost block that still reads as a bar. */
function chooseBar(markup: string, stack: OpenTag[]): OpenTag | null {
  let best: OpenTag | null = null;
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const element = stack[i]!;
    if (STOP.has(element.name)) break;
    const close = closeOf(markup, element);
    if (close < 0) break;
    const inner = markup.slice(element.end, close);
    if (HEAVY.test(inner)) break;
    if (inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().length > MAX_TEXT) break;
    if (BLOCK.has(element.name)) best = element;
  }
  return best;
}

function track(stack: OpenTag[], match: RegExpExecArray): void {
  const name = match[2]!.toLowerCase();
  if (match[1]) {
    const at = stack.map((t) => t.name).lastIndexOf(name);
    if (at >= 0) stack.length = at;
  } else if (!VOID.has(name) && !match[0].endsWith('/>')) {
    stack.push({ name, start: match.index, end: match.index + match[0].length });
  }
}

/** The markup with the bar marked, or null when the page has no bar. Script and style bodies must be masked. */
export function markPrivilegeBar(markup: string): string | null {
  if (markup.includes(BAR_ATTRIBUTE)) return markup;
  const stack: OpenTag[] = [];
  let hits = 0;
  TOKEN.lastIndex = Math.max(0, markup.search(/<body\b/i));
  for (let match = TOKEN.exec(markup); match; match = TOKEN.exec(markup)) {
    if (match[2]) {
      track(stack, match);
      continue;
    }
    if (match[0].startsWith('<') || !WORK_PRODUCT.test(match[0])) continue;
    const bar = chooseBar(markup, stack);
    if (bar) {
      const tag = markup.slice(bar.start, bar.end).replace(/(\s*\/?>)$/, ` ${BAR_ATTRIBUTE}$1`);
      return markup.slice(0, bar.start) + tag + markup.slice(bar.end);
    }
    if (++hits >= MAX_HITS) break;
  }
  return null;
}
