// SPDX-License-Identifier: Apache-2.0
// The header line an index v2 part opens with (scripts/indexparts-v2.ts headerLine), recognized without any Workers
// types, so the cite book (cite-book.ts) and retrieval (ai-search.ts) share one rule and the scripts that build the
// prompt still compile under Node's types alone.

/**
 * Passage text without the header line an index v2 part opens with (scripts/indexparts-v2.ts headerLine: six
 * fields joined by " | ", right before the first marker). The header names the file, so two copies of one page
 * differ only there. Plain string work, no regular expression over document text.
 */
export function withoutV2Header(text: string): string {
  const end = text.indexOf('\n');
  if (end < 0 || !text.startsWith('[[doc:', end + 1)) return text;
  return text.slice(0, end).split(' | ').length === 6 ? text.slice(end + 1) : text;
}
