// SPDX-License-Identifier: Apache-2.0
// Defined terms in running text (DESIGN.md sections 7 and 9): which spans of a string are a manifest term
// (`meta.definedTerms`). Pure, so it runs under node --test; terms.ts turns the matches into c-term elements.
//
// The rules, in order:
// - whole words only: the characters either side of a match are not letters or digits ("HOA" never in "HOAX");
// - longest match first: "Harbor Labs" wins over "Harbor" at the same place, and a repeat of the long term still
//   consumes its words, so the short term inside it is never marked;
// - abbreviations (a term with no lower-case letter, such as "CRG" or "W-9") match exactly; other terms keep their
//   first letter as defined and ignore case after it ("Supply agreement" is "Supply Agreement", "company" is
//   not "Company"), since the leading capital is what marks a defined term in brief style;
// - first occurrence per scope only: a term already in `seen` stays plain;
// - never inside a cite ("DOE-000412 at 3") or a written-out link.

/** A defined term as the manifest serves it; extra fields (a cite) are ignored. */
export interface TermDef {
  term: string;
  means: string;
}

/** One marked span of the input: `text` is what the input says there, `term` the definition it matched. */
export interface TermMatch {
  start: number;
  end: number;
  text: string;
  term: TermDef;
}

/** Terms grouped by lower-cased first character, each group longest first. Build once per term list. */
export interface TermIndex {
  readonly byFirst: ReadonlyMap<string, readonly TermDef[]>;
}

/** Cite chips as prose prints them, `DOE-000412 at 3` or `at 3-4`, and bare control numbers. */
const CITE = /\b[A-Z]{2,6}-\d{6}(?:\s+at\s+\d+(?:-\d+)?)?/g;
/** Links written into the text. */
const URL_TEXT = /\bhttps?:\/\/\S+/g;
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Whether a term has capitals and no lowercase letters, as an abbreviation does. */
export function isAbbreviation(term: string): boolean {
  return !/\p{Ll}/u.test(term) && /\p{Lu}/u.test(term);
}

/** Groups the usable terms (trimmed, non-empty, first definition wins on a repeat) for findTerms. */
export function indexTerms(terms: readonly TermDef[]): TermIndex {
  const byFirst = new Map<string, TermDef[]>();
  const known = new Set<string>();
  for (const raw of terms) {
    const term = raw.term.trim();
    const means = raw.means.trim();
    if (!term || !means || known.has(term)) continue;
    known.add(term);
    const key = term[0]!.toLowerCase(); // safe: term is non-empty
    const group = byFirst.get(key) ?? [];
    group.push({ term, means });
    byFirst.set(key, group);
  }
  for (const group of byFirst.values()) group.sort((a, b) => b.term.length - a.term.length);
  return { byFirst };
}

/** Does `candidate` (a slice of the text the same length as `term`) say the term, under the case rule above? */
export function sameTerm(candidate: string, term: string): boolean {
  if (candidate.length !== term.length) return false;
  if (isAbbreviation(term)) return candidate === term;
  return candidate[0] === term[0] && candidate.slice(1).toLowerCase() === term.slice(1).toLowerCase();
}

/** Ranges of the text no term may touch: cites and written-out links, as [start, end) pairs in order. */
export function protectedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const pattern of [CITE, URL_TEXT]) {
    for (const m of text.matchAll(pattern)) ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

function wordCharAt(text: string, i: number): boolean {
  return i >= 0 && i < text.length && WORD_CHAR.test(text[i]!); // safe: bounds checked
}

/**
 * The spans of `text` to mark as defined terms, in order. `seen` holds the terms already marked in this scope
 * (the page); this call adds the ones it marks, so the next call leaves them plain.
 */
export function findTerms(text: string, index: TermIndex, seen: Set<string>): TermMatch[] {
  const matches: TermMatch[] = [];
  const guarded = protectedRanges(text);
  let guard = 0;
  let i = 0;
  while (i < text.length) {
    while (guard < guarded.length && guarded[guard]![1] <= i) guard += 1; // safe: guard < length
    const inside = guard < guarded.length && guarded[guard]![0] <= i; // safe: guard < length
    if (inside) {
      i = guarded[guard]![1]; // safe: guard < length
      continue;
    }
    const group = wordCharAt(text, i - 1) ? undefined : index.byFirst.get(text[i]!.toLowerCase()); // safe: i < length
    const hit = group?.find(({ term }) => {
      const end = i + term.length;
      const clear = guard >= guarded.length || guarded[guard]![0] >= end; // safe: guard < length
      return clear && !wordCharAt(text, end) && sameTerm(text.slice(i, end), term);
    });
    if (!hit) {
      i += 1;
      continue;
    }
    const end = i + hit.term.length;
    if (!seen.has(hit.term)) {
      seen.add(hit.term);
      matches.push({ start: i, end, text: text.slice(i, end), term: hit });
    }
    i = end;
  }
  return matches;
}
