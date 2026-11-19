// SPDX-License-Identifier: Apache-2.0
// A `*` glob matched by position. A pattern from a settings file is never compiled into a regular expression, so no
// character in it can mean anything but itself.

const LINE_END = /[\n\r\u2028\u2029]/;

/** Whether `text` fits `pattern`: `*` stands for any run of characters on one line, and every other character for itself. */
export function globMatch(pattern: string, text: string): boolean {
  const parts = pattern.split('*');
  const first = parts[0] ?? '';
  if (parts.length === 1) return text === first;
  const last = parts[parts.length - 1] ?? '';
  const end = text.length - last.length;
  if (end < first.length || !text.startsWith(first) || !text.endsWith(last)) return false;
  let at = first.length;
  for (const part of parts.slice(1, -1)) {
    const found = text.indexOf(part, at);
    if (found === -1 || found + part.length > end || LINE_END.test(text.slice(at, found))) return false;
    at = found + part.length;
  }
  return !LINE_END.test(text.slice(at, end));
}

/** Each plain pattern a `{a,b}` pattern stands for, innermost braces last. A brace with no partner stands for itself. */
function alternatives(pattern: string): string[] {
  const open = pattern.indexOf('{');
  if (open === -1) return [pattern];
  let depth = 0;
  let close = -1;
  for (let k = open; k < pattern.length && close === -1; k++) {
    if (pattern[k] === '{') depth++;
    else if (pattern[k] === '}' && --depth === 0) close = k;
  }
  if (close === -1) return [pattern];
  const options: string[] = [];
  let from = open + 1;
  depth = 0;
  for (let k = open + 1; k <= close; k++) {
    const c = pattern[k];
    if (c === '{') depth++;
    else if (c === '}' && k < close) depth--;
    if ((c === ',' && depth === 0) || k === close) {
      options.push(pattern.slice(from, k));
      from = k + 1;
    }
  }
  return options.flatMap((option) => alternatives(pattern.slice(0, open) + option + pattern.slice(close + 1)));
}

/** One plain pattern against a path: `**` is any run of characters, `*` any run with no `/`, and the rest stand for themselves. */
function plainPathMatch(pattern: string, path: string): boolean {
  const star = pattern.indexOf('*');
  if (star === -1) return pattern === path;
  if (!path.startsWith(pattern.slice(0, star))) return false;
  const deep = pattern[star + 1] === '*';
  const rest = pattern.slice(star + (deep ? 2 : 1));
  for (let end = star; end <= path.length; end++) {
    if (plainPathMatch(rest, path.slice(end))) return true;
    if (!deep && path[end] === '/') return false;
  }
  return false;
}

/** Whether a whole path fits a Vite-style glob with `**`, `*` and `{a,b}`. By position: the glob is never made into a pattern. */
export function pathGlobMatch(pattern: string, path: string): boolean {
  return alternatives(pattern).some((plain) => plainPathMatch(plain, path));
}
