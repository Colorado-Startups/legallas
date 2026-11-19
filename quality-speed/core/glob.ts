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
