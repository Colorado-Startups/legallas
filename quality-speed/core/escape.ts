// SPDX-License-Identifier: Apache-2.0
// The one place the pages clean up text on its way into a regex, a table, markup or a browser expression. Each helper
// repeats until nothing is left to remove, so a removal can never join its neighbours into the thing it removed.

/** Removes every `<!-- ... -->`. An opener with no closer stays, as a lazy `/<!--[\s\S]*?-->/g` leaves it. */
export function stripHtmlComments(text: string): string {
  let out = text;
  for (;;) {
    const open = out.indexOf('<!--');
    if (open < 0) return out;
    const close = out.indexOf('-->', open + 4);
    if (close < 0) return out;
    out = out.slice(0, open) + out.slice(close + 3);
  }
}

/** Removes every `<...>` tag, as `/<[^>]+>/g` does, until none is left (`<<b>b>` does not become `<b>`). */
export function stripHtmlTags(text: string): string {
  let out = text;
  for (;;) {
    let next = '';
    let from = 0;
    let at = out.indexOf('<');
    while (at >= 0) {
      const close = out.indexOf('>', at + 1);
      if (close < 0) break;
      if (close === at + 1) {
        at = out.indexOf('<', at + 1);
        continue;
      }
      next += out.slice(from, at);
      from = close + 1;
      at = out.indexOf('<', from);
    }
    next += out.slice(from);
    if (next === out) return out;
    out = next;
  }
}

/** Text that a RegExp matches as itself: every character the pattern syntax reads, backslash first among them. */
export function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');
}

/** A Markdown table cell: its backslashes, pipes and line breaks cannot end the cell or the row. */
export function escapeTableCell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

const UNSAFE_IN_SCRIPT: Record<string, string> = {
  '<': '\\u003C',
  '>': '\\u003E',
  '/': '\\u002F',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

/** A value as a JavaScript string literal for code sent to a browser: JSON plus the characters JSON leaves raw. */
export function jsLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/[<>/\u2028\u2029]/g, (char) => UNSAFE_IN_SCRIPT[char] ?? char);
}
